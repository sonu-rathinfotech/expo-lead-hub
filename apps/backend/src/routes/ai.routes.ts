import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@elc/db";
import { authenticate } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { asyncHandler } from "../utils/async-handler";
import { normalizeUrl, checkReachable, hostOf } from "../services/page-analyzer.service";
import { enqueueAnalysis, queueInfo } from "../services/analysis-queue.service";
import { searchBni } from "../services/bni-cache.service";

const router = Router();

const roastSchema = z.object({
  url: z.string().min(3, "Enter a website URL"),
  eventId: z.string().uuid().optional(),
  boothId: z.string().uuid().optional(),
});

const scoreSchema = z.object({
  url: z.string().min(3, "Enter your website URL"),
  competitorUrl: z.string().min(3, "Enter a competitor URL"),
  competitorUrl2: z.string().optional(),
  company: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  eventId: z.string().uuid().optional(),
  boothId: z.string().uuid().optional(),
});

const leadSchema = z.object({
  eventId: z.string().uuid().optional(),
  boothId: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required"),
  company: z.string().optional(),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  designation: z.string().optional(),
  consent: z.boolean().optional(),
});

// ── POST /api/ai/roast — queue an analysis (staff/booth) ──
// Returns immediately with a PENDING record; the client polls GET /analysis/:id.
router.post(
  "/roast",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, eventId, boothId } = roastSchema.parse(req.body);
    const target = normalizeUrl(url);

    const analysis = await prisma.websiteAnalysis.create({
      data: {
        url: target,
        status: "PENDING",
        eventId: eventId ?? null,
        boothId: boothId ?? null,
        createdBy: req.user?.id ?? null,
      },
    });

    const info = queueInfo();
    enqueueAnalysis({ analysisId: analysis.id, url: target });

    res.status(202).json({
      analysis,
      // Rough queue position: jobs already waiting/active beyond the concurrency cap.
      queuePosition: Math.max(0, info.waiting + info.active - info.max + 1),
    });
  }),
);

// ── POST /api/ai/score — queue a head-to-head comparison (AI Score Game) ──
router.post(
  "/score",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, competitorUrl, competitorUrl2, company, eventId, boothId } = scoreSchema.parse(req.body);
    const target = normalizeUrl(url);
    const competitor = normalizeUrl(competitorUrl);
    const competitor2 = competitorUrl2 ? normalizeUrl(competitorUrl2) : undefined;

    // Catch typo'd / non-existent domains before running a 60s audit.
    const toCheck = [target, competitor, ...(competitor2 ? [competitor2] : [])];
    const reach = await Promise.all(toCheck.map((u) => checkReachable(u)));
    const unreachable = toCheck.filter((_, i) => !reach[i]).map((u) => hostOf(u));
    if (unreachable.length) {
      throw new AppError(400, `We couldn't reach ${unreachable.join(" and ")}. Please check the spelling.`);
    }

    const analysis = await prisma.websiteAnalysis.create({
      data: {
        url: target,
        competitorUrl: competitor,
        competitorUrl2: competitor2 ?? null,
        company: company ?? null,
        status: "PENDING",
        eventId: eventId ?? null,
        boothId: boothId ?? null,
        createdBy: req.user?.id ?? null,
      },
    });

    const info = queueInfo();
    enqueueAnalysis({ analysisId: analysis.id, url: target, competitorUrl: competitor, competitorUrl2: competitor2, company: company ?? undefined });

    res.status(202).json({
      analysis,
      queuePosition: Math.max(0, info.waiting + info.active - info.max + 1),
    });
  }),
);

// ── GET /api/ai/bni?q= — BNI member lookup by name or phone ──
router.get(
  "/bni",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // Served from an in-memory cache (see bni-cache.service) so typeahead is
    // instant and doesn't hit the DB on every keystroke.
    const members = await searchBni(String(req.query.q ?? ""));
    res.json({ members });
  }),
);

// ── GET /api/ai/analysis/:id — public report (QR target) ──
router.get(
  "/analysis/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const analysis = await prisma.websiteAnalysis.findUnique({ where: { id } });
    if (!analysis) throw new AppError(404, "Report not found");
    res.json({ analysis });
  }),
);

// ── POST /api/ai/analysis/:id/lead — capture visitor as a lead ──
router.post(
  "/analysis/:id/lead",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const data = leadSchema.parse(req.body);

    const analysis = await prisma.websiteAnalysis.findUnique({ where: { id } });
    if (!analysis) throw new AppError(404, "Analysis not found");

    const evId = data.eventId ?? analysis.eventId;
    const bId = data.boothId ?? analysis.boothId;
    if (!evId || !bId) throw new AppError(400, "Event and booth are required to save the lead");

    const [visitorType, form] = await Promise.all([
      prisma.visitorType.findFirst({ where: { eventId: evId, isActive: true }, orderBy: { displayOrder: "asc" } }),
      prisma.formDefinition.findFirst({ where: { eventId: evId, isActive: true } }),
    ]);
    if (!visitorType || !form) {
      throw new AppError(400, "This event has no active visitor type / form configured.");
    }

    const lead = await prisma.lead.create({
      data: {
        eventId: evId,
        boothId: bId,
        visitorTypeId: visitorType.id,
        formDefinitionId: form.id,
        source: "MANUAL",
        submittedBy: req.user?.id ?? null,
        rawFormData: {
          contact_person: data.name,
          company_name: data.company ?? "",
          email: data.email,
          mobile_number: data.phone ?? "",
          designation: data.designation ?? "",
          _source: analysis.competitorUrl ? "SCORE_GAME" : "AI_ROAST",
          _website: analysis.url,
          _competitorWebsite: analysis.competitorUrl ?? undefined,
          _company: analysis.company ?? data.company ?? undefined,
          _analysisId: analysis.id,
          _consent: data.consent ?? false,
        } as any,
        status: "NEW",
      },
    });

    await Promise.all([
      prisma.syncQueue.create({ data: { leadId: lead.id, target: "CRM", status: "PENDING" } }),
      prisma.syncQueue.create({ data: { leadId: lead.id, target: "GOOGLE_SHEETS", status: "PENDING" } }),
      prisma.websiteAnalysis.update({
        where: { id },
        data: { leadId: lead.id, eventId: evId, boothId: bId },
      }),
    ]);

    res.status(201).json({ lead, message: "Lead saved" });
  }),
);

// ── GET /api/ai/history — recent analyses (staff/admin) ──
router.get(
  "/history",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { skip = "0", take = "20" } = req.query as any;
    const [items, total] = await Promise.all([
      prisma.websiteAnalysis.findMany({
        select: {
          id: true,
          url: true,
          title: true,
          audit: true,
          leadId: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: parseInt(skip) || 0,
        take: Math.min(parseInt(take) || 20, 100),
      }),
      prisma.websiteAnalysis.count(),
    ]);
    res.json({ items, total });
  }),
);

export { router as aiRouter };
