import axios from "axios";
import { prisma } from "@elc/db";
import { setting } from "./settings.service";

// Appends captured leads to a Google Sheet via an Apps Script Web App webhook.
// Sends { header, row } — the same columns as the Leads "Export CSV" — and the
// doPost appends the header once (if the sheet is empty) then the row.

const pick = (d: Record<string, any>, keys: string[]): string => {
  for (const k of keys) {
    const v = d?.[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return "";
};

// Column order = the Export CSV columns + the new fields.
const HEADER = [
  "Date", "Event", "Booth", "Visitor Type", "Source", "Status",
  "Company", "Name", "Mobile", "Email", "Designation",
  "City", "State", "Country", "Website", "GST", "Industry",
  "Annual Turnover", "Products Interested", "Budget", "Remarks",
  "Category", "BNI Chapter", "Notes",
];

export function sheetsEnabled(): boolean {
  return Boolean(setting("SHEETS_WEBHOOK_URL"));
}

// Push one lead (by id) to the sheet. Best-effort; marks sheetsSynced on success.
export async function syncLeadToSheet(leadId: string): Promise<boolean> {
  const url = setting("SHEETS_WEBHOOK_URL");
  if (!url) return false;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, source: true, status: true, createdAt: true, rawFormData: true,
      event: { select: { name: true } },
      booth: { select: { name: true } },
      visitorType: { select: { name: true } },
    },
  });
  if (!lead) return false;

  const d = (lead.rawFormData ?? {}) as Record<string, any>;
  const g = (...keys: string[]) => pick(d, keys);
  const row = [
    lead.createdAt.toISOString(),
    lead.event?.name ?? "",
    lead.booth?.name ?? "",
    lead.visitorType?.name ?? "",
    lead.source ?? "",
    lead.status ?? "",
    g("companyName", "company_name", "company", "organization"),
    g("contactPerson", "contact_person", "name", "full_name", "fullName", "contactName"),
    g("mobileNumber", "mobile_number", "phone", "phoneNumber", "phone_number", "mobile"),
    g("email", "emailAddress", "email_address"),
    g("designation", "title", "role"),
    g("city"),
    g("state"),
    g("country"),
    g("website", "url", "web"),
    g("gstNumber", "gst_number", "gst"),
    g("industry"),
    g("annualTurnover", "annual_turnover"),
    g("productsInterested", "products_interested"),
    g("budget"),
    g("remarks"),
    g("category"),
    g("bni_chapter", "bniChapter"),
    g("notes"),
  ];

  try {
    await axios.post(url, { header: HEADER, row }, { timeout: 15_000, maxRedirects: 5, headers: { "Content-Type": "application/json" } });
    await prisma.lead.update({ where: { id: lead.id }, data: { sheetsSynced: true } }).catch(() => {});
    return true;
  } catch (e) {
    console.error("[sheets] sync failed:", (e as Error)?.message);
    return false;
  }
}

// Push every not-yet-synced lead (used by the "Sync to Sheet" button).
export async function syncUnsyncedLeads(): Promise<{ synced: number; failed: number; total: number }> {
  if (!sheetsEnabled()) return { synced: 0, failed: 0, total: 0 };
  const leads = await prisma.lead.findMany({
    where: { sheetsSynced: false },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  let synced = 0;
  let failed = 0;
  for (const l of leads) {
    if (await syncLeadToSheet(l.id)) synced++;
    else failed++;
  }
  return { synced, failed, total: leads.length };
}
