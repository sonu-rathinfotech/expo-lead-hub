import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@elc/db";
import { authenticate, requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { asyncHandler } from "../utils/async-handler";
import { formFieldRouter } from "./form-fields.routes";

const router = Router({ mergeParams: true });

// ── Validation Schemas ────────────────────
const createFormDefinitionSchema = z.object({
  name: z.string().min(1, "Form name is required"),
});

const updateFormDefinitionSchema = createFormDefinitionSchema.partial();

// Auth on every form route. Staff must be able to GET fields (Capture Lead);
// creating/editing forms stays ADMIN+.
router.use(authenticate);
router.use((req, res, next) => {
  if (req.method === "GET") return next();
  return requireRole("SUPER_ADMIN", "ADMIN")(req, res, next);
});

// ── GET /api/events/:eventId/forms ──────
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId } = req.params;

    // Verify event exists
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new AppError(404, "Event not found");
    }

    const forms = await prisma.formDefinition.findMany({
      where: { eventId },
      include: {
        fields: {
          orderBy: { displayOrder: "asc" },
          select: {
            id: true,
            fieldKey: true,
            label: true,
            fieldType: true,
            isRequired: true,
            displayOrder: true,
            isActive: true,
          },
        },
        leads: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      forms: forms.map((f) => ({
        ...f,
        fieldCount: f.fields.length,
        leadCount: f.leads.length,
      })),
      total: forms.length,
    });
  }),
);

// ── GET /api/events/:eventId/forms/:formId ──
router.get(
  "/:formId",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;

    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
      include: {
        fields: {
          where: { isActive: true },
          orderBy: { displayOrder: "asc" },
          include: {
            options: { orderBy: { displayOrder: "asc" } },
          },
        },
        event: { select: { id: true, name: true } },
      },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    res.json({ form });
  }),
);

// ── POST /api/events/:eventId/forms ──────
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const data = createFormDefinitionSchema.parse(req.body);

    // Verify event exists
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new AppError(404, "Event not found");
    }

    const form = await prisma.formDefinition.create({
      data: {
        ...data,
        eventId,
      },
      include: {
        fields: { orderBy: { displayOrder: "asc" } },
      },
    });

    res.status(201).json({ form });
  }),
);

// ── PUT /api/events/:eventId/forms/:formId ──
router.put(
  "/:formId",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;
    const updateData = updateFormDefinitionSchema.parse(req.body);

    // Verify form exists and belongs to event
    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    const updated = await prisma.formDefinition.update({
      where: { id: formId },
      data: updateData,
      include: {
        fields: { orderBy: { displayOrder: "asc" } },
      },
    });

    res.json({ form: updated });
  }),
);

// ── DELETE /api/events/:eventId/forms/:formId ──
router.delete(
  "/:formId",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;

    // Verify form exists and belongs to event
    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    await prisma.formDefinition.delete({ where: { id: formId } });

    res.json({ message: "Form deleted successfully", formId });
  }),
);

// ── Activate/Deactivate Form ──────────────
router.post(
  "/:formId/activate",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;

    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    const updated = await prisma.formDefinition.update({
      where: { id: formId },
      data: { isActive: true },
    });

    res.json({ form: updated, message: "Form activated" });
  }),
);

router.post(
  "/:formId/deactivate",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;

    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    const updated = await prisma.formDefinition.update({
      where: { id: formId },
      data: { isActive: false },
    });

    res.json({ form: updated, message: "Form deactivated" });
  }),
);

// ── Nested Routes ──────────────────────────
// Form fields nested under forms
router.use("/:formId/fields", formFieldRouter);

export { router as formDefinitionRouter };
