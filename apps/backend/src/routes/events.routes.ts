import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@elc/db";
import { authenticate, requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { asyncHandler } from "../utils/async-handler";
import { boothRouter } from "./booths.routes";
import { visitorTypeRouter } from "./visitor-types.routes";
import { formDefinitionRouter } from "./forms.routes";
import { crmConfigRouter } from "./crm-config.routes";
import { sheetsConfigRouter } from "./sheets-config.routes";
import { provisionEvent, activateEvent } from "../services/event-provision.service";

const router = Router();

// Quick-create: name (+ optional venue/dates) → a fully-usable event with a
// default booth, visitor type and form. Optionally make it the active event.
const quickEventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  venue: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  activate: z.boolean().default(true),
});

// ── Validation Schemas ────────────────────
const createEventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  description: z.string().optional(),
  organizer: z.string().min(1, "Organizer is required"),
  venue: z.string().min(1, "Venue is required"),
  city: z.string().min(1, "City is required"),
  country: z.string().min(1, "Country is required"),
  startDate: z.string().datetime("Invalid start date format"),
  endDate: z.string().datetime("Invalid end date format"),
  status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]).default("DRAFT"),
  bannerImageUrl: z.string().url().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
});

const updateEventSchema = createEventSchema.partial();

// All event routes require authentication
router.use(authenticate);

// ── POST /api/events/quick (Admin — create a ready-to-use event) ──
router.post(
  "/quick",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const p = quickEventSchema.parse(req.body);
    const event = await provisionEvent({
      name: p.name,
      venue: p.venue || p.name,
      startDate: p.startDate ? new Date(p.startDate) : undefined,
      endDate: p.endDate ? new Date(p.endDate) : undefined,
      createdBy: req.user!.id,
      activate: p.activate,
    });
    res.status(201).json({ event, message: `Event "${event.name}" created${p.activate ? " and set active" : ""}.` });
  }),
);

// ── PATCH /api/events/:id/activate (Admin — make this the active event) ──
router.patch(
  "/:id/activate",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    await activateEvent(String(req.params.id));
    res.json({ message: "Event activated" });
  }),
);

// ── GET /api/events (List all events) ─────
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { status, skip = 0, take = 20 } = req.query;

    const where = status ? { status: status as string } : {};

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          organizer: true,
          venue: true,
          city: true,
          country: true,
          startDate: true,
          endDate: true,
          status: true,
          bannerImageUrl: true,
          logoUrl: true,
          createdAt: true,
          creator: { select: { id: true, name: true, email: true } },
          booths: { select: { id: true } },
          visitorTypes: { select: { id: true } },
          _count: { select: { leads: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: typeof skip === "string" ? parseInt(skip) : 0,
        take: typeof take === "string" ? parseInt(take) : 20,
      }),
      prisma.event.count({ where }),
    ]);

    res.json({
      events: events.map((e) => ({
        ...e,
        boothCount: e.booths.length,
        visitorTypeCount: e.visitorTypes.length,
        leadCount: e._count.leads,
      })),
      total,
      page: typeof skip === "string" ? Math.floor(parseInt(skip) / (typeof take === "string" ? parseInt(take) : 20)) : 0,
    });
  }),
);

// ── GET /api/events/:id (Get event details) ─
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        booths: true,
        visitorTypes: { orderBy: { displayOrder: "asc" } },
        formDefinitions: true,
        crmConfigurations: {
          select: {
            id: true,
            apiUrl: true,
            method: true,
            isActive: true,
            authType: true,
          },
        },
        sheetsConfig: {
          select: {
            id: true,
            spreadsheetId: true,
            worksheetName: true,
            isActive: true,
          },
        },
      },
    });

    if (!event) {
      throw new AppError(404, "Event not found");
    }

    res.json({ event });
  }),
);

// ── POST /api/events (Create event) ───────
router.post(
  "/",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const data = createEventSchema.parse(req.body);

    // Validate that endDate is after startDate
    if (new Date(data.endDate) <= new Date(data.startDate)) {
      throw new AppError(400, "End date must be after start date");
    }

    const event = await prisma.event.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        createdBy: req.user!.id,
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json({ event });
  }),
);

// ── PUT /api/events/:id (Update event) ────
router.put(
  "/:id",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = updateEventSchema.parse(req.body);

    // Verify event exists
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new AppError(404, "Event not found");
    }

    // Convert date strings if provided
    const data: any = { ...updateData };
    if (data.startDate) {
      data.startDate = new Date(data.startDate);
    }
    if (data.endDate) {
      data.endDate = new Date(data.endDate);
    }

    // Validate date logic
    const startDate = data.startDate || event.startDate;
    const endDate = data.endDate || event.endDate;
    if (endDate <= startDate) {
      throw new AppError(400, "End date must be after start date");
    }

    const updated = await prisma.event.update({
      where: { id },
      data,
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({ event: updated });
  }),
);

// ── DELETE /api/events/:id (Delete event) ──
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Verify event exists
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new AppError(404, "Event not found");
    }

    // Delete event (cascades to related records)
    await prisma.event.delete({ where: { id } });

    res.json({ message: "Event deleted successfully", eventId: id });
  }),
);

// ── Nested Routes ──────────────────────────
// Booths nested under events
router.use("/:eventId/booths", boothRouter);

// Visitor Types nested under events
router.use("/:eventId/visitor-types", visitorTypeRouter);

// Form Definitions nested under events
router.use("/:eventId/forms", formDefinitionRouter);

// CRM Configurations nested under events
router.use("/:eventId/crm-config", crmConfigRouter);

// Google Sheets Configurations nested under events
router.use("/:eventId/sheets-config", sheetsConfigRouter);

export { router as eventRouter };
