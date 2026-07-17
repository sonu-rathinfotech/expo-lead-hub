import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "@elc/db";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../middleware/error-handler";
import { TtlCache } from "../utils/cache";
import { notifyLeadReceived } from "../services/notification.service";
import { newPlayToken, playLink } from "../utils/play-link";
import { searchBni, lookupBniByPhone } from "../services/bni-cache.service";
import { parseCardWithAI } from "../services/card-parser.service";
import { normalizeUrl, checkReachable, hostOf } from "../services/page-analyzer.service";
import { enqueueAnalysis, queueInfo } from "../services/analysis-queue.service";
import { computeProfit, inr } from "../services/profit-calc.service";
import { emailService } from "../services/email.service";
import { buildCalcEmail } from "../services/email-templates.service";
import { synthesizeSpeech } from "../services/tts.service";
import { bookMeeting } from "../services/meeting.service";

const router = Router();

// The games a visitor can pick from their "extra link". Backend owns the list
// so availability can be gated later without a frontend change.
const GAMES = [
  {
    type: "AI_SCORE",
    title: "AI Competitor Analysis",
    subtitle: "Score your website vs 2 competitors — DA, keywords, AI score & more.",
    path: "/ai/score",
  },
  {
    type: "PROFIT_CALC",
    title: "Profitability Calculator",
    subtitle: "See your agency's profit, costs and margins in seconds.",
    path: "/booth/calculator",
  },
] as const;

// Public endpoints that hit AI (card scan) or scan the directory (BNI lookup)
// get their own tighter limiter on top of the global one.
const publicScanLimiter = rateLimit({ windowMs: 60_000, max: 15, standardHeaders: true, legacyHeaders: false });
const publicLookupLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });

// Form definitions per event change rarely but are read on every QR scan and
// lead submission. Cache them briefly to skip a hot Postgres query each time.
const activeFormInclude = {
  fields: {
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    include: { options: { orderBy: { displayOrder: "asc" } } },
  },
} as const;

type ActiveForm = NonNullable<
  Awaited<ReturnType<typeof prisma.formDefinition.findFirst<{ include: typeof activeFormInclude }>>>
>;

const formCache = new TtlCache<ActiveForm>(60_000);
// Hot public reads that change rarely / are static per key — short TTLs shave a
// Postgres round-trip per visitor without any noticeable staleness.
const boothContextCache = new TtlCache<unknown>(30_000);
const playSessionCache = new TtlCache<unknown>(15_000);

async function getActiveForm(eventId: string): Promise<ActiveForm | null> {
  const cached = formCache.get(eventId);
  if (cached) return cached;
  const form = await prisma.formDefinition.findFirst({
    where: { eventId, isActive: true },
    include: activeFormInclude,
  });
  if (form) formCache.set(eventId, form);
  return form;
}

// ── GET /booth-context (Public — active event + booth for the kiosk) ──
router.get(
  "/booth-context",
  asyncHandler(async (_req: Request, res: Response) => {
    const cached = boothContextCache.get("ctx");
    if (cached) return res.json(cached);

    const event = await prisma.event.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        bannerImageUrl: true,
        booths: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, name: true },
        },
      },
    });

    if (!event) {
      throw new AppError(404, "No active event configured");
    }

    const payload = {
      event: {
        id: event.id,
        name: event.name,
        logoUrl: event.logoUrl,
        bannerImageUrl: event.bannerImageUrl,
      },
      booth: event.booths[0] ?? null,
    };
    boothContextCache.set("ctx", payload);
    res.json(payload);
  }),
);

// ── POST /booth-lead (Public — optional lead from the calculator) ──
const boothLeadSchema = z.object({
  eventId: z.string().uuid().optional(),
  boothId: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  company: z.string().optional(),
  phone: z.string().optional(),
  designation: z.string().optional(),
  calculator: z.record(z.any()).optional(),
});

router.post(
  "/booth-lead",
  asyncHandler(async (req: Request, res: Response) => {
    const data = boothLeadSchema.parse(req.body);

    // Resolve event + booth (fall back to the active event / its first booth).
    let eventId = data.eventId;
    let boothId = data.boothId;
    if (!eventId || !boothId) {
      const active = await prisma.event.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        select: { id: true, booths: { where: { isActive: true }, take: 1, select: { id: true } } },
      });
      eventId = eventId ?? active?.id;
      boothId = boothId ?? active?.booths[0]?.id;
    }
    if (!eventId || !boothId) {
      throw new AppError(400, "No active event/booth to attach this lead to");
    }

    // Same resolution pattern as ai.routes: first active visitor type + form.
    const [visitorType, form] = await Promise.all([
      prisma.visitorType.findFirst({
        where: { eventId, isActive: true },
        orderBy: { displayOrder: "asc" },
      }),
      getActiveForm(eventId),
    ]);
    if (!visitorType || !form) {
      throw new AppError(400, "This event has no active visitor type / form configured");
    }

    const playToken = newPlayToken();
    const lead = await prisma.lead.create({
      data: {
        eventId,
        boothId,
        visitorTypeId: visitorType.id,
        formDefinitionId: form.id,
        source: "MANUAL",
        playToken,
        rawFormData: {
          contact_person: data.name,
          company_name: data.company ?? "",
          email: data.email,
          mobile_number: data.phone ?? "",
          designation: data.designation ?? "",
          _source: "CALCULATOR",
          _calculator: data.calculator ?? {},
        } as any,
        status: "NEW",
      },
    });

    await Promise.all([
      prisma.syncQueue.create({ data: { leadId: lead.id, target: "CRM", status: "PENDING" } }),
      prisma.syncQueue.create({ data: { leadId: lead.id, target: "GOOGLE_SHEETS", status: "PENDING" } }),
    ]);

    // WhatsApp: welcome the visitor + send the lead report to the client (non-blocking).
    void notifyLeadReceived(lead.id).catch(() => {});

    res.status(201).json({ leadId: lead.id, playToken, playLink: playLink(playToken), message: "Saved" });
  }),
);

// ── GET /v/:shortCode (Public QR redirect) ────────
router.get(
  "/v/:shortCode",
  asyncHandler(async (req: Request, res: Response) => {
    const { shortCode } = req.params;

    // Find QR code
    const qrCode = await prisma.qrCode.findUnique({
      where: { shortCode },
      include: {
        event: { select: { id: true, name: true } },
        booth: { select: { id: true, name: true } },
        visitorType: { select: { id: true, name: true, slug: true, audience: true } },
      },
    });

    if (!qrCode || !qrCode.isActive) {
      throw new AppError(404, "QR code not found or inactive");
    }

    // Scan count is analytics only — don't block the form response on it.
    void prisma.qrCode
      .update({ where: { id: qrCode.id }, data: { scanCount: { increment: 1 } } })
      .catch(() => {});

    // Form definitions per event are cached (they change rarely).
    const formDefinition = await getActiveForm(qrCode.eventId);

    // Return form data for frontend to render
    res.json({
      qrCode: {
        id: qrCode.id,
        shortCode: qrCode.shortCode,
        eventId: qrCode.eventId,
        boothId: qrCode.boothId,
        visitorTypeId: qrCode.visitorType.id,
      },
      event: qrCode.event,
      booth: qrCode.booth,
      visitorType: qrCode.visitorType,
      form: formDefinition,
    });
  }),
);

// ── POST /api/public/leads (Submit lead) ──────────
const submitLeadSchema = z.object({
  qrCodeId: z.string().uuid("Invalid QR code ID"),
  visitorTypeId: z.string().uuid("Invalid visitor type ID"),
  boothId: z.string().uuid("Invalid booth ID"),
  formDefinitionId: z.string().uuid("Invalid form definition ID"),
  eventId: z.string().uuid("Invalid event ID"),
  formData: z.record(z.any()).refine((data) => Object.keys(data).length > 0, {
    message: "Form data cannot be empty",
  }),
});

router.post(
  "/leads",
  asyncHandler(async (req: Request, res: Response) => {
    const payload = submitLeadSchema.parse(req.body);
    const { qrCodeId, visitorTypeId, boothId, formDefinitionId, eventId, formData } = payload;

    // Verify QR code and the event's active form in parallel. The form is
    // served from cache when warm (it rarely changes), saving a round-trip.
    const [qrCode, form] = await Promise.all([
      prisma.qrCode.findUnique({ where: { id: qrCodeId } }),
      getActiveForm(eventId),
    ]);

    if (!qrCode || !qrCode.isActive) {
      throw new AppError(400, "Invalid or inactive QR code");
    }

    if (!form || form.id !== formDefinitionId) {
      throw new AppError(400, "Form not found or inactive");
    }

    // Create lead
    const playToken = newPlayToken();
    const lead = await prisma.lead.create({
      data: {
        eventId,
        boothId,
        visitorTypeId,
        formDefinitionId,
        source: "QR_SCAN",
        playToken,
        rawFormData: formData,
        status: "NEW",
      },
      include: {
        event: { select: { id: true, name: true } },
        booth: { select: { id: true, name: true } },
        visitorType: { select: { id: true, name: true } },
        formDefinition: { select: { id: true, name: true } },
      },
    });

    // Create sync queue entries for CRM and Google Sheets
    await Promise.all([
      prisma.syncQueue.create({
        data: {
          leadId: lead.id,
          target: "CRM",
          status: "PENDING",
        },
      }),
      prisma.syncQueue.create({
        data: {
          leadId: lead.id,
          target: "GOOGLE_SHEETS",
          status: "PENDING",
        },
      }),
    ]);

    // WhatsApp: welcome the visitor + send the lead report to the client (non-blocking).
    void notifyLeadReceived(lead.id).catch(() => {});

    res.status(201).json({
      lead,
      playToken,
      playLink: playLink(playToken),
      message: "Lead submitted successfully. Syncing to CRM and Google Sheets...",
    });
  }),
);

// ── GET /api/public/leads/status/:leadId (Check lead sync status) ──────
router.get(
  "/leads/status/:leadId",
  asyncHandler(async (req: Request, res: Response) => {
    const { leadId } = req.params;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        syncQueue: true,
        syncLogs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    if (!lead) {
      throw new AppError(404, "Lead not found");
    }

    res.json({
      lead,
      syncQueue: lead.syncQueue,
      recentLogs: lead.syncLogs,
    });
  }),
);

// ── GET /api/public/play/:token (Resolve a visitor's play session) ──
// Opens from the "extra link". Returns the visitor's name + the games they can
// play. No auth — the token itself is the capability.
router.get(
  "/play/:token",
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.params.token as string;

    const cached = playSessionCache.get(token);
    if (cached) return res.json(cached);

    const lead = await prisma.lead.findUnique({
      where: { playToken: token },
      select: {
        id: true,
        rawFormData: true,
        event: { select: { id: true, name: true } },
      },
    });
    if (!lead) throw new AppError(404, "This link is invalid or has expired");

    const data = (lead.rawFormData ?? {}) as Record<string, any>;
    const name =
      data.contact_person ?? data.contactPerson ?? data.name ?? data.full_name ?? "";
    const company = data.company_name ?? data.companyName ?? data.company ?? "";
    const email = data.email ?? data.emailAddress ?? data.email_address ?? "";
    const phone =
      data.mobile_number ?? data.mobileNumber ?? data.phone ?? data.phone_number ?? data.mobile ?? "";

    const payload = {
      token,
      visitor: { name, company, email, phone },
      event: lead.event,
      games: GAMES,
    };
    playSessionCache.set(token, payload);
    res.json(payload);
  }),
);

// ── GET /api/public/find-session?q= (Match a walk-up to their lead) ──
// A visitor who filled the form but opens a game directly can be linked to
// their lead by name, email, or mobile. Returns the play token (email stays
// server-side) so results still reach them.
const FS_NAME = ["contact_person", "contactPerson", "name", "full_name", "fullName"];
const FS_EMAIL = ["email", "emailAddress", "email_address"];
const FS_PHONE = ["mobile_number", "mobileNumber", "phone", "phone_number", "phoneNumber", "mobile"];
const COMPANY_KEYS_FS = ["company_name", "companyName", "company", "organization"];
const fsPick = (d: Record<string, any>, keys: string[]) => {
  for (const k of keys) {
    const v = d[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return "";
};

router.get(
  "/find-session",
  publicLookupLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ match: null });

    const active = await prisma.event.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { startDate: "desc" },
      select: { id: true },
    });
    if (!active) return res.json({ match: null });

    const leads = await prisma.lead.findMany({
      where: { eventId: active.id, playToken: { not: null } },
      select: { playToken: true, rawFormData: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const lower = q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    const byDigits = digits.length >= 5 ? digits.slice(-8) : "";

    for (const l of leads) {
      const d = (l.rawFormData ?? {}) as Record<string, any>;
      const name = fsPick(d, FS_NAME);
      const email = fsPick(d, FS_EMAIL);
      const phone = fsPick(d, FS_PHONE).replace(/\D/g, "");
      const hit =
        (name && name.toLowerCase().includes(lower)) ||
        (email && email.toLowerCase().includes(lower)) ||
        (byDigits && phone.includes(byDigits));
      if (hit) {
        return res.json({ match: { token: l.playToken, name, company: fsPick(d, COMPANY_KEYS_FS) } });
      }
    }
    res.json({ match: null });
  }),
);

// ── GET /api/public/bni?q= (Public BNI directory lookup) ──
// Name or phone typeahead used by the phone-first entry + card-scan flows.
router.get(
  "/bni",
  publicLookupLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ members: [] });
    const members = await searchBni(q, 8);
    res.json({ members });
  }),
);

// ── POST /api/public/card-scan (Public business-card OCR + BNI enrich) ──
const cardScanSchema = z.object({ image: z.string().min(1, "Image is required") });

router.post(
  "/card-scan",
  publicScanLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { image } = cardScanSchema.parse(req.body);
    const { parsed, rawText } = await parseCardWithAI(image);

    // If the card's phone matches a BNI member, return the enriched record so
    // the visitor can just confirm instead of typing everything.
    let bni = null;
    if (parsed.mobileNumber) {
      bni = await lookupBniByPhone(parsed.mobileNumber).catch(() => null);
    }

    res.json({ parsed, rawText, bni });
  }),
);

// ── POST /api/public/score (Public AI Score game — no auth) ──
// Queues a head-to-head website comparison from a visitor's play session.
// Poll the result at GET /api/ai/analysis/:id (already public).
const publicScoreSchema = z.object({
  url: z.string().min(3, "Enter your website URL"),
  competitorUrl: z.string().min(3, "Enter a competitor URL"),
  competitorUrl2: z.string().optional(),
  playToken: z.string().optional(),
  email: z.string().email().optional(),
});

router.post(
  "/score",
  publicScanLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const p = publicScoreSchema.parse(req.body);
    const target = normalizeUrl(p.url);
    const competitor = normalizeUrl(p.competitorUrl);
    const competitor2 = p.competitorUrl2 ? normalizeUrl(p.competitorUrl2) : undefined;

    // Catch typo'd / non-existent domains (e.g. "flipcart.com") up front so we
    // don't run a 60s audit against a site that doesn't exist.
    const toCheck = [target, competitor, ...(competitor2 ? [competitor2] : [])];
    const reach = await Promise.all(toCheck.map((u) => checkReachable(u)));
    const unreachable = toCheck.filter((_, i) => !reach[i]).map((u) => hostOf(u));
    if (unreachable.length) {
      throw new AppError(400, `We couldn't reach ${unreachable.join(" and ")}. Please check the spelling.`);
    }

    // Attribute to the visitor's event/booth + recover their email from the lead.
    let eventId: string | null = null;
    let boothId: string | null = null;
    let email: string | null = p.email ?? null;
    if (p.playToken) {
      const lead = await prisma.lead.findUnique({
        where: { playToken: p.playToken },
        select: { eventId: true, boothId: true, rawFormData: true },
      });
      if (lead) {
        eventId = lead.eventId;
        boothId = lead.boothId;
        if (!email) {
          const d = (lead.rawFormData ?? {}) as Record<string, any>;
          email = d.email ?? d.emailAddress ?? d.email_address ?? null;
        }
      }
    }

    const analysis = await prisma.websiteAnalysis.create({
      data: { url: target, competitorUrl: competitor, status: "PENDING", eventId, boothId },
    });

    const info = queueInfo();
    enqueueAnalysis({
      analysisId: analysis.id,
      url: target,
      competitorUrl: competitor,
      competitorUrl2: competitor2,
      email: email ?? undefined,
      playToken: p.playToken,
    });

    // Track under the play session so the TV + result email can find it later.
    if (p.playToken) {
      await prisma.gameResult
        .create({
          data: { playToken: p.playToken, gameType: "AI_SCORE", status: "PENDING", refId: analysis.id, email },
        })
        .catch(() => {});
    }

    res.status(202).json({
      analysisId: analysis.id,
      queuePosition: Math.max(0, info.waiting + info.active - info.max + 1),
    });
  }),
);

// ── POST /api/public/calculator (Profitability Calculator — Game 2) ──
// Computes the P&L server-side, records it against the play session (for the TV
// display), and emails the results to the visitor.
const calculatorSchema = z.object({
  clients: z.number().nonnegative().default(0),
  avgRetainer: z.number().nonnegative().default(0),
  employeeCost: z.number().nonnegative().default(0),
  operationalCost: z.number().nonnegative().default(0),
  miscCost: z.number().nonnegative().default(0),
  rathFeePerClient: z.number().nonnegative().default(0),
  period: z.enum(["month", "year"]).default("month"),
  playToken: z.string().optional(),
  email: z.string().email().optional(),
  // Walk-up entry (no play session) can pass a name/company to capture as a lead.
  name: z.string().optional(),
  company: z.string().optional(),
});

router.post(
  "/calculator",
  publicLookupLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const p = calculatorSchema.parse(req.body);
    const results = computeProfit(p);

    let email: string | null = p.email ?? null;
    let playToken: string | null = p.playToken ?? null;

    if (p.playToken) {
      // Came from a play session — recover the email from the lead if needed.
      if (!email) {
        const lead = await prisma.lead.findUnique({
          where: { playToken: p.playToken },
          select: { rawFormData: true },
        });
        const d = (lead?.rawFormData ?? {}) as Record<string, any>;
        email = d.email ?? d.emailAddress ?? d.email_address ?? null;
      }
    } else if (email) {
      // Walk-up (Booth Mode → Calculator): capture as a lead so it's saved +
      // appears on the TV, using the active event/booth.
      const active = await prisma.event.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        select: { id: true, booths: { where: { isActive: true }, take: 1, select: { id: true } } },
      });
      const evId = active?.id;
      const bId = active?.booths[0]?.id;
      if (evId && bId) {
        const [visitorType, form] = await Promise.all([
          prisma.visitorType.findFirst({ where: { eventId: evId, isActive: true }, orderBy: { displayOrder: "asc" } }),
          getActiveForm(evId),
        ]);
        if (visitorType && form) {
          playToken = newPlayToken();
          const lead = await prisma.lead.create({
            data: {
              eventId: evId,
              boothId: bId,
              visitorTypeId: visitorType.id,
              formDefinitionId: form.id,
              source: "MANUAL",
              playToken,
              rawFormData: {
                contact_person: p.name ?? "",
                company_name: p.company ?? "",
                email,
                _source: "CALCULATOR",
                _calculator: { inputs: p, results },
              } as any,
              status: "NEW",
            },
          });
          await Promise.all([
            prisma.syncQueue.create({ data: { leadId: lead.id, target: "CRM", status: "PENDING" } }),
            prisma.syncQueue.create({ data: { leadId: lead.id, target: "GOOGLE_SHEETS", status: "PENDING" } }),
          ]);
        }
      }
    }

    // Record against the play session so the TV display can pick it up.
    if (playToken) {
      await prisma.gameResult
        .create({
          data: {
            playToken,
            gameType: "PROFIT_CALC",
            status: "COMPLETED",
            payload: { inputs: p, results } as any,
            email,
          },
        })
        .catch(() => {});
    }

    // Email the results (best-effort).
    if (email && emailService.isEmailConfigured()) {
      const per = p.period === "year" ? "yearly" : "monthly";
      const text = buildCalcEmail({
        period: per,
        clients: results.clients,
        revenue: inr(results.revenue),
        rathCharges: inr(results.rathCharges),
        internalExpenses: inr(results.internalExpenses),
        profit: inr(results.profit),
      });
      void emailService
        .sendEmail(email, "Your partnership profitability snapshot", text)
        .catch((e) => console.error("[calculator] email failed:", (e as Error)?.message));
    }

    res.json({ results, emailed: Boolean(email && emailService.isEmailConfigured()) });
  }),
);

// ── GET /api/public/tv-feed (Booth TV / stall display) ──
// Live queue stats + latest game results + leaderboards. Polled by the /tv
// screen every few seconds. No auth.
router.get(
  "/tv-feed",
  asyncHandler(async (_req: Request, res: Response) => {
    const [event, analyses, calcs] = await Promise.all([
      prisma.event.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        select: { name: true },
      }),
      // AI Score results (head-to-head only) — richest data lives on the analysis.
      prisma.websiteAnalysis.findMany({
        where: { status: "COMPLETED", NOT: { competitorUrl: null } },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: { id: true, url: true, competitorUrl: true, company: true, audit: true, updatedAt: true },
      }),
      prisma.gameResult.findMany({
        where: { gameType: "PROFIT_CALC", status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
    ]);

    const hostOf = (u?: string | null) => {
      if (!u) return "";
      try {
        return new URL(u).hostname.replace(/^www\./, "");
      } catch {
        return u;
      }
    };

    const scoreItems = analyses.map((a) => {
      const au = (a.audit ?? {}) as any;
      return {
        type: "AI_SCORE" as const,
        at: a.updatedAt,
        label: a.company || hostOf(a.url),
        yourScore: au.your?.overallScore ?? null,
        competitorScore: au.competitor?.overallScore ?? null,
        winner: au.verdict?.winner ?? null,
        url: hostOf(a.url),
        competitor: hostOf(a.competitorUrl),
      };
    });

    const calcItems = calcs.map((c) => {
      const p = (c.payload ?? {}) as any;
      const r = p.results ?? {};
      const margin = r.revenue > 0 ? Math.round((r.profit / r.revenue) * 100) : null;
      return {
        type: "PROFIT_CALC" as const,
        at: c.createdAt,
        revenue: r.revenue ?? null,
        profit: r.profit ?? null,
        margin,
      };
    });

    const scoreBoard = [...scoreItems]
      .filter((s) => typeof s.yourScore === "number")
      .sort((a, b) => (b.yourScore ?? 0) - (a.yourScore ?? 0))
      .slice(0, 5)
      .map((s) => ({ label: s.label || s.url, value: s.yourScore }));

    const marginBoard = [...calcItems]
      .filter((c) => typeof c.margin === "number")
      .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))
      .slice(0, 5)
      .map((c) => ({ value: c.margin, profit: c.profit }));

    res.json({
      event: event ?? null,
      queue: queueInfo(),
      scoreItems,
      calcItems,
      leaderboard: { scores: scoreBoard, margins: marginBoard },
    });
  }),
);

// ── POST /api/public/meeting (Book a follow-up meeting after the game) ──
// No auth — the play token is the capability.
const meetingSchema = z.object({
  playToken: z.string().min(3),
  date: z.string().min(8), // YYYY-MM-DD
  time: z.string().min(3), // HH:MM
  note: z.string().max(500).optional(),
});

router.post(
  "/meeting",
  asyncHandler(async (req: Request, res: Response) => {
    const { playToken, date, time, note } = meetingSchema.parse(req.body);
    const lead = await prisma.lead.findUnique({
      where: { playToken },
      select: { id: true, rawFormData: true, event: { select: { name: true } } },
    });
    if (!lead) throw new AppError(404, "This session was not found.");

    const r = await bookMeeting(lead, date, time, note);
    res.json({ ok: true, ...r });
  }),
);

// ── POST /api/public/tts (narration voice for the audit screen) ──
// Returns a WAV data URL from Gemini TTS, or { audio: null } when the AI voice
// is disabled or unavailable (the client then uses the free browser voice).
const ttsLimiter = rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false });
router.post(
  "/tts",
  ttsLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const text = String(req.body?.text ?? "").slice(0, 400);
    const audio = await synthesizeSpeech(text).catch(() => null);
    res.json({ audio });
  }),
);

export { router as publicRouter };
