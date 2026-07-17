import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@elc/db";
import { LEAD_FORM_FIELDS } from "@elc/shared";
import { authenticate, requireRole } from "../middleware/auth";
import { AppError } from "../middleware/error-handler";
import { asyncHandler } from "../utils/async-handler";
import { sendReportsForLead } from "../services/report-email.service";
import { bookMeeting } from "../services/meeting.service";

const router = Router();
router.use(authenticate);

// Keys we surface as a lead's summary regardless of the dynamic form shape.
// Tolerant of both camelCase and snake_case field keys.
const NAME_KEYS = ["contactPerson", "contact_person", "name", "fullName", "full_name", "contactName"];
const COMPANY_KEYS = ["companyName", "company_name", "company", "organization"];
const EMAIL_KEYS = ["email", "emailAddress", "email_address"];
const PHONE_KEYS = ["mobileNumber", "mobile_number", "phone", "phoneNumber", "phone_number", "mobile"];

function pick(data: Record<string, any> | null | undefined, keys: string[]): string {
  if (!data) return "";
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function summarize(rawFormData: any) {
  const data = (rawFormData ?? {}) as Record<string, any>;
  return {
    name: pick(data, NAME_KEYS),
    company: pick(data, COMPANY_KEYS),
    email: pick(data, EMAIL_KEYS),
    phone: pick(data, PHONE_KEYS),
  };
}

// Build a Prisma `where` clause from query filters.
function buildWhere(query: any) {
  const { eventId, boothId, visitorTypeId, source, status, dateFrom, dateTo, search } = query;
  const where: any = {};

  if (eventId) where.eventId = eventId;
  if (boothId) where.boothId = boothId;
  if (visitorTypeId) where.visitorTypeId = visitorTypeId;
  if (source) where.source = source;
  if (status) where.status = status;

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  if (search && String(search).trim()) {
    const term = String(search).trim();
    // Search across the common contact keys inside the JSON form payload
    // (both camelCase and snake_case variants).
    where.OR = [
      "contactPerson",
      "contact_person",
      "companyName",
      "company_name",
      "email",
      "mobileNumber",
      "mobile_number",
      "designation",
    ].map((key) => ({ rawFormData: { path: [key], string_contains: term } }));
  }

  return where;
}

const SORTABLE = new Set(["createdAt", "status", "source"]);

// ── GET /api/leads (paginated, sortable, filterable) ──
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { skip = "0", take = "20", sortBy = "createdAt", sortDir = "desc" } = req.query as any;
    const where = buildWhere(req.query);

    const orderField = SORTABLE.has(sortBy) ? sortBy : "createdAt";
    const orderDir = sortDir === "asc" ? "asc" : "desc";

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          source: true,
          status: true,
          crmSynced: true,
          sheetsSynced: true,
          rawFormData: true,
          playToken: true,
          meetingAt: true,
          createdAt: true,
          event: { select: { id: true, name: true } },
          booth: { select: { id: true, name: true } },
          visitorType: { select: { id: true, name: true, color: true } },
          submittedByUser: { select: { id: true, name: true } },
        },
        orderBy: { [orderField]: orderDir },
        skip: parseInt(skip) || 0,
        take: Math.min(parseInt(take) || 20, 100),
      }),
      prisma.lead.count({ where }),
    ]);

    // Which of these leads have a completed game (to disable "Open game" and
    // enable "Send report").
    const tokens = leads.map((l: any) => l.playToken).filter(Boolean) as string[];
    const played = tokens.length
      ? await prisma.gameResult.findMany({
          where: { playToken: { in: tokens }, status: "COMPLETED" },
          select: { playToken: true },
        })
      : [];
    const playedSet = new Set(played.map((g) => g.playToken));

    res.json({
      leads: leads.map((l: any) => ({
        id: l.id,
        source: l.source,
        status: l.status,
        crmSynced: l.crmSynced,
        sheetsSynced: l.sheetsSynced,
        createdAt: l.createdAt,
        event: l.event,
        booth: l.booth,
        visitorType: l.visitorType,
        submittedByUser: l.submittedByUser,
        playToken: l.playToken,
        gamePlayed: l.playToken ? playedSet.has(l.playToken) : false,
        reportsSentCount: l.reportsSentCount,
        meetingAt: l.meetingAt,
        ...summarize(l.rawFormData),
      })),
      total,
      skip: parseInt(skip) || 0,
      take: Math.min(parseInt(take) || 20, 100),
    });
  }),
);

// ── POST /api/leads/export (CSV) ────────────────────
// Placed before "/:id" so "export" isn't treated as an id.
router.post(
  "/export",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const where = buildWhere({ ...req.query, ...req.body });

    const leads = await prisma.lead.findMany({
      where,
      select: {
        id: true,
        source: true,
        status: true,
        crmSynced: true,
        sheetsSynced: true,
        rawFormData: true,
        createdAt: true,
        event: { select: { name: true } },
        booth: { select: { name: true } },
        visitorType: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });

    const baseColumns = [
      "Created At",
      "Event",
      "Booth",
      "Visitor Type",
      "Source",
      "Status",
      "CRM Synced",
      "Sheets Synced",
    ];
    const formColumns = [...LEAD_FORM_FIELDS];
    const header = [...baseColumns, ...formColumns];

    const escape = (val: any) => {
      const s = val === undefined || val === null ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = leads.map((l: any) => {
      const data = (l.rawFormData ?? {}) as Record<string, any>;
      const base = [
        l.createdAt.toISOString(),
        l.event?.name ?? "",
        l.booth?.name ?? "",
        l.visitorType?.name ?? "",
        l.source,
        l.status,
        l.crmSynced ? "Yes" : "No",
        l.sheetsSynced ? "Yes" : "No",
      ];
      const form = formColumns.map((key) => data[key] ?? "");
      return [...base, ...form].map(escape).join(",");
    });

    const csv = [header.map(escape).join(","), ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send("﻿" + csv); // BOM for Excel compatibility
  }),
);

// ── GET /api/leads/:id (full detail + sync history + audit trail) ──
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        event: { select: { id: true, name: true } },
        booth: { select: { id: true, name: true } },
        visitorType: { select: { id: true, name: true, color: true } },
        formDefinition: {
          select: {
            id: true,
            name: true,
            fields: {
              orderBy: { displayOrder: "asc" },
              select: { fieldKey: true, label: true, fieldType: true },
            },
          },
        },
        submittedByUser: { select: { id: true, name: true, email: true } },
        syncQueue: true,
        syncLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!lead) throw new AppError(404, "Lead not found");

    const auditTrail = await prisma.auditLog.findMany({
      where: { entityType: "LEAD", entityId: id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    res.json({ lead, summary: summarize(lead.rawFormData), auditTrail });
  }),
);

// ── POST /api/leads/:id/send-report (Manually re-send the game result email) ──
router.post(
  "/:id/send-report",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { sent, email, sentCount, reason } = await sendReportsForLead(id);
    if (sent === 0) throw new AppError(400, reason ?? "Nothing to send");
    res.json({ sent, email, sentCount, message: `Report sent to ${email}` });
  }),
);

// ── POST /api/leads/:id/meeting (Staff books a meeting for a lead) ──
const meetingBodySchema = z.object({
  date: z.string().min(8),
  time: z.string().min(3),
  note: z.string().max(500).optional(),
});
router.post(
  "/:id/meeting",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { date, time, note } = meetingBodySchema.parse(req.body);
    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, rawFormData: true, event: { select: { name: true } } },
    });
    if (!lead) throw new AppError(404, "Lead not found");
    const r = await bookMeeting(lead, date, time, note);
    res.json({ ok: true, ...r });
  }),
);

// ── DELETE /api/leads/:id (Super Admin only — remove a lead) ──
// Cascades to its sync queue + logs (FK onDelete: Cascade).
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, "Lead not found");

    await prisma.lead.delete({ where: { id } });

    if (res.locals.logAudit) {
      await res.locals.logAudit({
        userId: req.user?.id,
        action: "LEAD_DELETED",
        entityType: "LEAD",
        entityId: id,
      });
    }

    res.json({ message: "Lead deleted", id });
  }),
);

export { router as leadsRouter };
