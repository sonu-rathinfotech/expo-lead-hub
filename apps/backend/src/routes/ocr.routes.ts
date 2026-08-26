import { Router, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "@elc/db";
import { authenticate, requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { asyncHandler } from "../utils/async-handler";
import { ocrManager } from "../services/ocr.service";
import { parseCardWithAI } from "../services/card-parser.service";
import { notifyLeadReceived } from "../services/notification.service";
import { newPlayToken, playLink } from "../utils/play-link";

const router = Router();

// ── Multer Setup for Image Upload ────────┘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// ── Validation Schemas ────────────────────
const submitOcrLeadSchema = z.object({
  eventId: z.string().uuid("Invalid event ID"),
  boothId: z.string().uuid("Invalid booth ID"),
  visitorTypeId: z.string().uuid("Invalid visitor type ID"),
  formDefinitionId: z.string().uuid("Invalid form definition ID"),
  ocrRawText: z.string().default(""),
  ocrConfidence: z.number().min(0).max(1).default(0),
  formData: z.record(z.any()),
  submittedBy: z.string().uuid("Invalid user ID"),
  // "MANUAL" when staff typed the lead by hand (no card scan); default OCR_SCAN.
  source: z.enum(["OCR_SCAN", "MANUAL"]).default("OCR_SCAN"),
});

// All OCR routes require authentication and STAFF+ role
router.use(authenticate);
router.use(requireRole("SUPER_ADMIN", "ADMIN", "STAFF"));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/ocr/setup (Booth capture context — no CRM/Sheets includes) ──
// /scan used to chain GET /events + GET /events/:id (which pulls CRM + Sheets
// config) + GET form fields (ADMIN-only). Any of those 500ing blanked the page.
router.get(
  "/setup",
  asyncHandler(async (_req: Request, res: Response) => {
    let events: { id: string; name: string; status: string }[] = [];
    try {
      events = await prisma.event.findMany({
        select: { id: true, name: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    } catch (err) {
      console.error("ocr setup: event list failed", err);
      throw new AppError(500, "Could not load events. Try again in a moment.");
    }

    const active = events.find((e) => e.status === "ACTIVE") ?? events[0] ?? null;
    if (!active) {
      return res.json({ events, event: null, booths: [], visitorTypes: [], form: null, fields: [] });
    }

    try {
      const event = await prisma.event.findUnique({
        where: { id: active.id },
        include: {
          booths: true,
          visitorTypes: { orderBy: { displayOrder: "asc" } },
          formDefinitions: {
            where: { isActive: true },
            take: 1,
            include: {
              fields: {
                where: { isActive: true },
                orderBy: { displayOrder: "asc" },
                include: { options: { orderBy: { displayOrder: "asc" } } },
              },
            },
          },
        },
      });
      const form = event?.formDefinitions?.[0] ?? null;
      return res.json({
        events,
        event,
        booths: event?.booths ?? [],
        visitorTypes: event?.visitorTypes ?? [],
        form,
        fields: form?.fields ?? [],
      });
    } catch (err) {
      console.error("ocr setup: event detail failed", err);
      return res.json({
        events,
        event: active,
        booths: [],
        visitorTypes: [],
        form: null,
        fields: [],
      });
    }
  }),
);

// ── POST /api/ocr/smart-scan (Gemini vision — reliable card reading) ──
const smartScanSchema = z.object({ image: z.string().min(20, "Image is required") });
router.post(
  "/smart-scan",
  asyncHandler(async (req: Request, res: Response) => {
    const { image } = smartScanSchema.parse(req.body);
    const { parsed, rawText } = await parseCardWithAI(image);
    res.json({ parsed, rawText });
  }),
);

// ── POST /api/ocr/scan (Upload and OCR image) ──────
router.post(
  "/scan",
  upload.single("image"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(400, "Image file is required");
    }

    try {
      // Extract text from image
      const ocrResult = await ocrManager.extractText(req.file.buffer, req.file.mimetype);

      res.json({
        ocrResult,
        message: "Image processed successfully",
        confidence: ocrResult.confidence,
      });
    } catch (error) {
      console.error("OCR processing error:", error);
      throw new AppError(500, "Failed to process image. Please try again.");
    }
  }),
);

// ── POST /api/ocr/submit (Submit OCR lead) ──────
router.post(
  "/submit",
  asyncHandler(async (req: Request, res: Response) => {
    const payload = submitOcrLeadSchema.parse(req.body);
    const { eventId, boothId, visitorTypeId, formDefinitionId, ocrRawText, ocrConfidence, formData, submittedBy, source } =
      payload;
    if (![eventId, boothId, visitorTypeId, formDefinitionId, submittedBy].every((id) => UUID_RE.test(id))) {
      throw new AppError(400, "Invalid capture IDs — pick the active event and try again.");
    }

    // Verify form exists and belongs to event
    const form = await prisma.formDefinition.findFirst({
      where: { id: formDefinitionId, eventId, isActive: true },
    });

    if (!form) {
      throw new AppError(400, "Form not found or inactive");
    }

    // Create lead with OCR data
    const playToken = newPlayToken();
    const lead = await prisma.lead.create({
      data: {
        eventId,
        boothId,
        visitorTypeId,
        formDefinitionId,
        source,
        playToken,
        rawFormData: formData,
        ocrRawText,
        ocrConfidence,
        submittedBy,
        status: "NEW",
      },
      include: {
        event: { select: { id: true, name: true } },
        booth: { select: { id: true, name: true } },
        visitorType: { select: { id: true, name: true } },
        formDefinition: { select: { id: true, name: true } },
        submittedByUser: { select: { id: true, name: true, email: true } },
      },
    });

    // Create sync queue entries
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

    // Log audit event
    if (res.locals.logAudit) {
      await res.locals.logAudit({
        userId: req.user?.id,
        action: "LEAD_CREATED_OCR",
        entityType: "Lead",
        entityId: lead.id,
        newValue: lead,
      });
    }

    res.status(201).json({
      lead,
      playToken,
      playLink: playLink(playToken),
      message: "Lead created from OCR scan and queued for sync",
    });
  }),
);

// ── GET /api/ocr/history (Get OCR submission history) ──────
router.get(
  "/history",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, skip = 0, take = 20 } = req.query;

    if (!eventId) {
      throw new AppError(400, "Event ID is required");
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where: {
          eventId: eventId as string,
          source: "OCR_SCAN",
          submittedBy: req.user?.id,
        },
        include: {
          booth: { select: { id: true, name: true } },
          visitorType: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: typeof skip === "string" ? parseInt(skip) : 0,
        take: typeof take === "string" ? parseInt(take) : 20,
      }),
      prisma.lead.count({
        where: {
          eventId: eventId as string,
          source: "OCR_SCAN",
          submittedBy: req.user?.id,
        },
      }),
    ]);

    res.json({
      leads,
      total,
      page: typeof skip === "string" ? Math.floor(parseInt(skip) / (typeof take === "string" ? parseInt(take) : 20)) : 0,
    });
  }),
);

export { router as ocrRouter };
