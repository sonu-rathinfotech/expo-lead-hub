import { settingWithDefault } from "./settings.service";

// Renders the DB-editable result-email templates (Settings → Email templates).
// Placeholders look like {clients}; unknown ones render as empty. The signature
// (also editable) is appended so it lands as the final block for textToHtml.

function render(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

function withSignature(body: string): string {
  return `${body.trim()}\n\n${settingWithDefault("EMAIL_SIGNATURE")}`;
}

export interface CalcVars {
  [k: string]: string | number;
  period: string; // "monthly" | "yearly"
  clients: string | number;
  revenue: string;
  rathCharges: string;
  internalExpenses: string;
  profit: string;
}

export function buildCalcEmail(vars: CalcVars): string {
  return withSignature(render(settingWithDefault("EMAIL_CALC_TEMPLATE"), vars));
}

export interface ReportVars {
  [k: string]: string | number;
  yourScore: string | number;
  competitorScore: string | number;
  reasoning: string;
  da: string;
  pa: string;
  referringDomains: string;
  backlinks: string;
  keywords: string;
  traffic: string;
  reportLink: string;
}

export function buildReportEmail(vars: ReportVars): string {
  return withSignature(render(settingWithDefault("EMAIL_REPORT_TEMPLATE"), vars));
}

export interface MeetingVars {
  [k: string]: string;
  name: string;
  company: string;
  datetime: string;
}

// Visitor-facing meeting confirmation — uses the meeting template + its OWN
// signature (distinct from the report signature).
export function buildMeetingEmail(vars: MeetingVars): string {
  const body = render(settingWithDefault("EMAIL_MEETING_TEMPLATE"), vars).trim();
  return `${body}\n\n${settingWithDefault("EMAIL_MEETING_SIGNATURE")}`;
}

// Internal "new meeting booked" notification (to the sales inbox).
export function buildMeetingNotice(v: {
  name: string;
  company: string;
  email: string;
  phone: string;
  datetime: string;
  note: string;
  event?: string;
}): string {
  const lines = [
    "New meeting booked from the booth 🎉",
    "",
    `When:     ${v.datetime}`,
    `Name:     ${v.name || "—"}`,
    `Company:  ${v.company || "—"}`,
    `Email:    ${v.email || "—"}`,
    `Phone:    ${v.phone || "—"}`,
  ];
  if (v.event) lines.push(`Event:    ${v.event}`);
  if (v.note) lines.push("", `Note: ${v.note}`);
  return lines.join("\n");
}
