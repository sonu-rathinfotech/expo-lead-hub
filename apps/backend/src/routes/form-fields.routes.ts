import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma, FieldType } from "@elc/db";
import { authenticate, requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { asyncHandler } from "../utils/async-handler";
import { fieldOptionRouter } from "./field-options.routes";

const router = Router({ mergeParams: true });

// ── Field Type Options ─────────────────────
const FIELD_TYPES = [
  "TEXT",
  "EMAIL",
  "PHONE",
  "NUMBER",
  "TEXTAREA",
  "DROPDOWN",
  "RADIO",
  "CHECKBOX",
  "DATE",
  "MULTI_SELECT",
  "FILE_UPLOAD",
  "URL",
] as const;

// ── Validation Schemas ────────────────────
const createFormFieldSchema = z.object({
  fieldKey: z.string().regex(/^[a-z0-9_]+$/, "Field key must be lowercase alphanumeric with underscores"),
  fieldType: z.enum(FIELD_TYPES),
  label: z.string().min(1, "Label is required"),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  isRequired: z.boolean().default(false),
  defaultValue: z.any().optional(),
  validationRules: z.object({}).passthrough().optional(),
  conditionalRules: z.object({}).passthrough().optional(),
});

const updateFormFieldSchema = createFormFieldSchema.partial();

const reorderFieldsSchema = z.object({
  fieldIds: z.array(z.string().uuid("Invalid field ID")),
});

// Auth on every field route. GET is allowed for STAFF (used by /scan);
// mutations stay ADMIN+.
router.use(authenticate);
router.use((req, res, next) => {
  if (req.method === "GET") return next();
  return requireRole("SUPER_ADMIN", "ADMIN")(req, res, next);
});

// ── GET /api/events/:eventId/forms/:formId/fields ──────
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;

    // Verify form exists and belongs to event
    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    const fields = await prisma.formField.findMany({
      where: { formDefinitionId: formId },
      include: {
        options: { orderBy: { displayOrder: "asc" } },
      },
      orderBy: { displayOrder: "asc" },
    });

    res.json({
      fields,
      total: fields.length,
    });
  }),
);

// ── GET /api/events/:eventId/forms/:formId/fields/:fieldId ──
router.get(
  "/:fieldId",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId, fieldId } = req.params;

    const field = await prisma.formField.findFirst({
      where: { id: fieldId, formDefinitionId: formId },
      include: {
        formDefinition: { select: { eventId: true } },
        options: { orderBy: { displayOrder: "asc" } },
      },
    });

    if (!field || field.formDefinition.eventId !== eventId) {
      throw new AppError(404, "Field not found");
    }

    res.json({ field });
  }),
);

// ── POST /api/events/:eventId/forms/:formId/fields ──────
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;
    const data = createFormFieldSchema.parse(req.body);

    // Verify form exists and belongs to event
    const form = await prisma.formDefinition.findFirst({
      where: { id: formId, eventId },
    });

    if (!form) {
      throw new AppError(404, "Form not found");
    }

    // Check fieldKey uniqueness within form
    const existing = await prisma.formField.findFirst({
      where: { formDefinitionId: formId, fieldKey: data.fieldKey },
    });

    if (existing) {
      throw new AppError(409, "A field with this key already exists in this form");
    }

    // Get next display order
    const maxDisplayOrder = await prisma.formField.aggregate({
      where: { formDefinitionId: formId },
      _max: { displayOrder: true },
    });

    const field = await prisma.formField.create({
      data: {
        ...data,
        formDefinitionId: formId,
        displayOrder: (maxDisplayOrder._max.displayOrder ?? -1) + 1,
      },
      include: {
        options: true,
      },
    });

    res.status(201).json({ field });
  }),
);

// ── PUT /api/events/:eventId/forms/:formId/fields/:fieldId ──
router.put(
  "/:fieldId",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId, fieldId } = req.params;
    const updateData = updateFormFieldSchema.parse(req.body);

    // Verify field exists and belongs to form
    const field = await prisma.formField.findFirst({
      where: { id: fieldId, formDefinitionId: formId },
      include: { formDefinition: { select: { eventId: true } } },
    });

    if (!field || field.formDefinition.eventId !== eventId) {
      throw new AppError(404, "Field not found");
    }

    // Check fieldKey uniqueness if updated
    if (updateData.fieldKey && updateData.fieldKey !== field.fieldKey) {
      const existing = await prisma.formField.findFirst({
        where: { formDefinitionId: formId, fieldKey: updateData.fieldKey },
      });

      if (existing) {
        throw new AppError(409, "A field with this key already exists in this form");
      }
    }

    const updated = await prisma.formField.update({
      where: { id: fieldId },
      data: updateData,
      include: { options: true },
    });

    res.json({ field: updated });
  }),
);

// ── DELETE /api/events/:eventId/forms/:formId/fields/:fieldId ──
router.delete(
  "/:fieldId",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId, fieldId } = req.params;

    // Verify field exists and belongs to form
    const field = await prisma.formField.findFirst({
      where: { id: fieldId, formDefinitionId: formId },
      include: { formDefinition: { select: { eventId: true } } },
    });

    if (!field || field.formDefinition.eventId !== eventId) {
      throw new AppError(404, "Field not found");
    }

    await prisma.formField.delete({ where: { id: fieldId } });

    res.json({ message: "Field deleted successfully", fieldId });
  }),
);

// ── POST /api/events/:eventId/forms/:formId/fields/reorder ──
router.post(
  "/reorder",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId } = req.params;
    const { fieldIds } = reorderFieldsSchema.parse(req.body);

    // Verify all fields belong to the form
    const fields = await prisma.formField.findMany({
      where: { formDefinitionId: formId, id: { in: fieldIds } },
    });

    if (fields.length !== fieldIds.length) {
      throw new AppError(400, "Some fields not found or don't belong to this form");
    }

    // Update display order for all fields
    const updated = await Promise.all(
      fieldIds.map((id, index) =>
        prisma.formField.update({
          where: { id },
          data: { displayOrder: index },
          include: { options: true },
        }),
      ),
    );

    res.json({ fields: updated, message: "Fields reordered successfully" });
  }),
);

// ── Activate/Deactivate Field ──────────────
router.post(
  "/:fieldId/activate",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId, fieldId } = req.params;

    const field = await prisma.formField.findFirst({
      where: { id: fieldId, formDefinitionId: formId },
      include: { formDefinition: { select: { eventId: true } } },
    });

    if (!field || field.formDefinition.eventId !== eventId) {
      throw new AppError(404, "Field not found");
    }

    const updated = await prisma.formField.update({
      where: { id: fieldId },
      data: { isActive: true },
      include: { options: true },
    });

    res.json({ field: updated, message: "Field activated" });
  }),
);

router.post(
  "/:fieldId/deactivate",
  asyncHandler(async (req: Request, res: Response) => {
    const { eventId, formId, fieldId } = req.params;

    const field = await prisma.formField.findFirst({
      where: { id: fieldId, formDefinitionId: formId },
      include: { formDefinition: { select: { eventId: true } } },
    });

    if (!field || field.formDefinition.eventId !== eventId) {
      throw new AppError(404, "Field not found");
    }

    const updated = await prisma.formField.update({
      where: { id: fieldId },
      data: { isActive: false },
      include: { options: true },
    });

    res.json({ field: updated, message: "Field deactivated" });
  }),
);

// ── Nested Routes ──────────────────────────
// Field options nested under fields
router.use("/:fieldId/options", fieldOptionRouter);

export { router as formFieldRouter };
