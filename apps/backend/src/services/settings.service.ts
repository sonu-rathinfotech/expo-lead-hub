import crypto from "crypto";
import { prisma } from "@elc/db";
import { env } from "../config/env";

// Only this account can view/change integration settings — even other super
// admins cannot. Kept here so the routes and guards share one source of truth.
export const OWNER_EMAIL = "sonu.prajapati@rathinfotech.com";

export interface SettingDef {
  key: string;
  label: string;
  group: string;
  secret?: boolean; // masked in the UI + never returned in full
  type?: "text" | "select" | "textarea";
  options?: string[];
  hint?: string; // e.g. available placeholders
}

// Default email copy — editable from the portal, stored in the DB when changed.
export const DEFAULT_SIGNATURE =
  "Rath Infotech and Web Solutions Pvt Ltd\n7277271727\nsales@rathinfotech.com";

export const DEFAULT_CALC_TEMPLATE = `Hi,

Here's your Rath Infotech partnership profitability snapshot ({period}):

Clients: {clients}
Total {period} revenue: {revenue}
Rath Infotech charges: {rathCharges}
Your internal expenses: {internalExpenses}
Total {period} profit: {profit}

By partnering with Rath Infotech, you can manage {clients} clients and earn an estimated {period} profit of {profit} without hiring and managing an in-house development team.

Ready to increase your agency profits? Let's schedule a demo.`;

export const DEFAULT_REPORT_TEMPLATE = `Hi,

Your AI website audit is ready:

Overall score — Your site: {yourScore}/100  |  Competitor: {competitorScore}/100

{reasoning}

── Your site's SEO snapshot ──
Domain Authority: {da}   Page Authority: {pa}
Referring domains: {referringDomains}   Backlinks: {backlinks}
Ranking keywords: {keywords}   Est. organic traffic: {traffic}

See the full report: {reportLink}`;

// Meeting confirmation email — its own copy + signature (distinct from reports).
export const DEFAULT_MEETING_TEMPLATE = `Hi {name},

Thank you for visiting Rath Infotech at MMD 2026! Your meeting is confirmed:

🗓  {datetime}

We're looking forward to discussing how we can help {company} grow online. If you need to reschedule, just reply to this email and we'll sort it out.

See you soon!`;

export const DEFAULT_MEETING_SIGNATURE =
  "Team Rath Infotech\nRath Infotech and Web Solutions Pvt Ltd\n7277271727\nsales@rathinfotech.com";

const DEFAULTS: Record<string, string> = {
  EMAIL_SIGNATURE: DEFAULT_SIGNATURE,
  EMAIL_CALC_TEMPLATE: DEFAULT_CALC_TEMPLATE,
  EMAIL_REPORT_TEMPLATE: DEFAULT_REPORT_TEMPLATE,
  EMAIL_MEETING_TEMPLATE: DEFAULT_MEETING_TEMPLATE,
  EMAIL_MEETING_SIGNATURE: DEFAULT_MEETING_SIGNATURE,
  AI_VOICE_PROVIDER: "browser",
  GEMINI_TTS_VOICE: "Kore",
};

// The integration credentials that can be managed from the portal.
export const SETTINGS: SettingDef[] = [
  { key: "GEMINI_API_KEY", label: "Gemini API key", group: "Gemini (AI scoring + card OCR + voice)", secret: true },
  { key: "GEMINI_API_KEY_2", label: "Gemini API key — backup 1", group: "Gemini (AI scoring + card OCR + voice)", secret: true },
  { key: "GEMINI_API_KEY_3", label: "Gemini API key — backup 2", group: "Gemini (AI scoring + card OCR + voice)", secret: true },
  { key: "GEMINI_API_KEY_4", label: "Gemini API key — backup 3", group: "Gemini (AI scoring + card OCR + voice)", secret: true },
  { key: "GEMINI_API_KEY_5", label: "Gemini API key — backup 4", group: "Gemini (AI scoring + card OCR + voice)", secret: true },
  { key: "GEMINI_MODEL", label: "Gemini model", group: "Gemini (AI scoring + card OCR + voice)" },
  { key: "PAGESPEED_API_KEY", label: "PageSpeed API key", group: "PageSpeed (Lighthouse)", secret: true },
  { key: "PAGESPEED_API_KEY_2", label: "PageSpeed API key — backup 1", group: "PageSpeed (Lighthouse)", secret: true },
  { key: "PAGESPEED_API_KEY_3", label: "PageSpeed API key — backup 2", group: "PageSpeed (Lighthouse)", secret: true },
  { key: "DATAFORSEO_LOGIN", label: "DataForSEO login (email)", group: "DataForSEO (DA / PA / keywords)" },
  { key: "DATAFORSEO_PASSWORD", label: "DataForSEO password", group: "DataForSEO (DA / PA / keywords)", secret: true },
  { key: "SEO_PROVIDER", label: "SEO provider", group: "DataForSEO (DA / PA / keywords)", type: "select", options: ["auto", "dataforseo", "pagespeed"] },
  { key: "DATAFORSEO_LOCATION_CODE", label: "Market location code (2356 = India)", group: "DataForSEO (DA / PA / keywords)" },
  { key: "DATAFORSEO_LANGUAGE_CODE", label: "Language code", group: "DataForSEO (DA / PA / keywords)" },
  { key: "RESEND_API_KEY", label: "Resend API key", group: "Email (Resend)", secret: true },
  { key: "EMAIL_FROM", label: "From address", group: "Email (Resend)" },
  { key: "OPENWA_BASE_URL", label: "OpenWA base URL", group: "WhatsApp (OpenWA)" },
  { key: "OPENWA_API_KEY", label: "OpenWA API key", group: "WhatsApp (OpenWA)", secret: true },
  { key: "OPENWA_SESSION_ID", label: "OpenWA session id", group: "WhatsApp (OpenWA)" },
  {
    key: "AI_VOICE_PROVIDER",
    label: "Audit narration voice",
    group: "Voice (audit narration)",
    type: "select",
    options: ["browser", "gemini"],
    hint: "‘browser’ = free device voice (always works). ‘gemini’ = AI voice via your Gemini key (falls back to browser if it fails).",
  },
  {
    key: "GEMINI_TTS_VOICE",
    label: "Gemini voice name",
    group: "Voice (audit narration)",
    hint: "Used when the voice is set to ‘gemini’. Options: Kore, Aoede, Puck, Charon, Fenrir, Leda, Orus, Zephyr.",
  },
  {
    key: "EMAIL_SIGNATURE",
    label: "Email signature (sign-off block)",
    group: "Email templates",
    type: "textarea",
    hint: "First line is shown bold as the sender name. Email & website lines auto-link.",
  },
  {
    key: "EMAIL_CALC_TEMPLATE",
    label: "Calculator result email",
    group: "Email templates",
    type: "textarea",
    hint: "Placeholders: {period} {clients} {revenue} {rathCharges} {internalExpenses} {profit}. The signature is added automatically.",
  },
  {
    key: "EMAIL_REPORT_TEMPLATE",
    label: "AI Score report email",
    group: "Email templates",
    type: "textarea",
    hint: "Placeholders: {yourScore} {competitorScore} {reasoning} {da} {pa} {referringDomains} {backlinks} {keywords} {traffic} {reportLink}. The signature is added automatically.",
  },
  {
    key: "MEETING_NOTIFY_EMAIL",
    label: "Meeting alerts go to (internal)",
    group: "Meeting emails",
    hint: "Where the internal 'new meeting booked' copy is sent. Defaults to sales@rathinfotech.com.",
  },
  {
    key: "EMAIL_MEETING_TEMPLATE",
    label: "Meeting confirmation email (to the visitor)",
    group: "Meeting emails",
    type: "textarea",
    hint: "Placeholders: {name} {company} {datetime}. The meeting signature below is added automatically.",
  },
  {
    key: "EMAIL_MEETING_SIGNATURE",
    label: "Meeting email signature",
    group: "Meeting emails",
    type: "textarea",
    hint: "Sign-off for meeting emails (separate from the report signature).",
  },
];
const MANAGED = new Set(SETTINGS.map((s) => s.key));

// ── Encryption (AES-256-GCM, key derived from ENCRYPTION_KEY) ──
function encKey(): Buffer {
  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY ?? "elc-default-encryption-key").digest();
}
function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv.toString("hex"), c.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}
function decrypt(blob: string): string {
  const [ivh, tagh, ench] = blob.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivh!, "hex"));
  d.setAuthTag(Buffer.from(tagh!, "hex"));
  return Buffer.concat([d.update(Buffer.from(ench!, "hex")), d.final()]).toString("utf8");
}

// ── In-memory override cache (synchronous getter for hot paths) ──
let cache: Record<string, string> = {};

export async function refreshSettings(): Promise<void> {
  try {
    const rows = await prisma.appSetting.findMany();
    const next: Record<string, string> = {};
    for (const r of rows) {
      try {
        next[r.key] = decrypt(r.value);
      } catch {
        /* skip undecryptable */
      }
    }
    cache = next;
  } catch (e) {
    console.error("[settings] load failed:", (e as Error).message);
  }
}

// Effective value: portal override → else env → else "".
export function setting(key: string): string {
  const o = cache[key];
  if (o != null && o !== "") return o;
  return String((env as any)[key] ?? "");
}

export function settingInt(key: string, fallback: number): number {
  const v = parseInt(setting(key), 10);
  return Number.isFinite(v) ? v : fallback;
}

// Like setting(), but falls back to a built-in default (used for email copy).
export function settingWithDefault(key: string): string {
  return setting(key) || DEFAULTS[key] || "";
}

// Gemini keys in priority order (primary + backups), non-empty only.
export function geminiKeys(): string[] {
  return [
    setting("GEMINI_API_KEY"),
    setting("GEMINI_API_KEY_2"),
    setting("GEMINI_API_KEY_3"),
    setting("GEMINI_API_KEY_4"),
    setting("GEMINI_API_KEY_5"),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
}

// PageSpeed keys in priority order (primary + backups), non-empty only.
export function pageSpeedKeys(): string[] {
  return [setting("PAGESPEED_API_KEY"), setting("PAGESPEED_API_KEY_2"), setting("PAGESPEED_API_KEY_3")]
    .map((s) => s.trim())
    .filter(Boolean);
}

// Save (empty value removes the override so it falls back to env).
export async function saveSettings(updates: Record<string, string>, userId?: string): Promise<void> {
  for (const [key, raw] of Object.entries(updates)) {
    if (!MANAGED.has(key)) continue;
    const val = String(raw ?? "").trim();
    if (val === "") {
      await prisma.appSetting.deleteMany({ where: { key } });
      delete cache[key];
    } else {
      const value = encrypt(val);
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: userId },
        update: { value, updatedBy: userId },
      });
      cache[key] = val;
    }
  }
}

// Masked status for the UI — never returns secrets in full.
export function settingsStatus() {
  return SETTINGS.map((s) => {
    const override = cache[s.key];
    const envVal = String((env as any)[s.key] ?? "");
    const def = DEFAULTS[s.key] ?? "";
    const hasOverride = override != null && override !== "";
    const effective = hasOverride ? override : envVal || def;
    const mask = (v: string) => (!v ? "" : s.secret ? "••••" + v.slice(-4) : v);
    return {
      key: s.key,
      label: s.label,
      group: s.group,
      secret: !!s.secret,
      type: s.type ?? "text",
      options: s.options,
      hint: s.hint,
      configured: Boolean(effective),
      source: hasOverride ? "portal" : envVal ? "env" : def ? "default" : "none",
      display: mask(effective),
    };
  });
}
