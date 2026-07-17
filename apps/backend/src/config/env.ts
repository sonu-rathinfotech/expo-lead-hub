import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRY: z.string().default("1d"), // booth day — one login lasts all day
  JWT_REFRESH_EXPIRY: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  // Public base URL of the frontend (used to build visitor "extra links",
  // e.g. https://booth.example.com/play/<token>). Falls back to CORS_ORIGIN.
  PUBLIC_APP_URL: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  // AI Experience Hub (all optional — feature is disabled until keys are set)
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_KEY_2: z.string().optional(), // backup 1 — used if the primary errors
  GEMINI_API_KEY_3: z.string().optional(), // backup 2
  GEMINI_API_KEY_4: z.string().optional(), // backup 3
  GEMINI_API_KEY_5: z.string().optional(), // backup 4
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3), // roasts running at once; rest queue
  PAGESPEED_API_KEY: z.string().optional(), // optional; PSI works without one at lower rate limits
  PAGESPEED_API_KEY_2: z.string().optional(), // backup 1
  PAGESPEED_API_KEY_3: z.string().optional(), // backup 2
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  // Which analyzer to use for the AI Score game:
  //  - "auto"       → DataForSEO when creds are set, else PageSpeed/Gemini (default)
  //  - "dataforseo" → force DataForSEO (DA/PA + keywords); errors fall back to PSI
  //  - "pagespeed"  → force free PageSpeed + Gemini only (no DataForSEO calls)
  SEO_PROVIDER: z.enum(["auto", "dataforseo", "pagespeed"]).default("auto"),
  // Market for DataForSEO keyword/rank data (defaults: USA / English).
  DATAFORSEO_LOCATION_CODE: z.coerce.number().int().default(2840),
  DATAFORSEO_LANGUAGE_CODE: z.string().default("en"),
  // Paid AI-citation check (LLM Mentions) for the AI Visibility report — on by
  // default when DataForSEO creds are set. Set to "off" to skip the ~$0.40/audit
  // AI calls while keeping the rest of DataForSEO working.
  DATAFORSEO_AI_MENTIONS: z.enum(["on", "off"]).default("on"),
  // WhatsApp (OpenWA self-hosted gateway) — all optional; feature is disabled
  // until OPENWA_BASE_URL + OPENWA_API_KEY are set.
  OPENWA_BASE_URL: z.string().optional(),
  OPENWA_API_KEY: z.string().optional(),
  OPENWA_SESSION_ID: z.string().default("default"),
  // Email — optional; feature disabled until configured.
  // Preferred: Resend HTTP API (works everywhere, no SMTP ports needed).
  // Fallback: raw SMTP. EMAIL_FROM applies to both (falls back to SMTP_FROM).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
