import axios from "axios";
import dns from "dns";
import { setting, pageSpeedKeys } from "./settings.service";

export interface PageScores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
}

export interface PageCapture {
  url: string;
  finalUrl: string;
  title?: string;
  description?: string;
  desktopShot?: string; // base64 data URL
  mobileShot?: string; // base64 data URL
  scores: PageScores;
}

export interface PageAnalyzer {
  analyze(url: string): Promise<PageCapture>;
}

// Normalize a user-entered URL (add scheme if missing).
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// Pull the bare hostname out of a (normalized) URL for display / DNS.
export function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Does this domain actually exist? A DNS lookup catches clear typos like
// "flipcart.com" that don't resolve, so we can warn the visitor before wasting
// a ~60s audit. (A typo that happens to resolve to a parked page can't be
// caught here — that's on the visitor to eyeball before hitting Start.)
export async function checkReachable(url: string): Promise<boolean> {
  try {
    const host = new URL(normalizeUrl(url)).hostname;
    await dns.promises.lookup(host);
    return true;
  } catch {
    return false;
  }
}

// Free, keyless screenshot fallback for when PageSpeed Insights is unavailable
// (no PSI key / quota exhausted). Scores are unknown in this path; the AI still
// roasts the actual rendered design from the image.
async function fallbackScreenshot(url: string): Promise<string | undefined> {
  const services = [
    `https://image.thum.io/get/width/1280/${url}`,
    `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=1280`,
  ];
  for (const shotUrl of services) {
    try {
      const { data } = await axios.get<ArrayBuffer>(shotUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      const buf = Buffer.from(data);
      if (buf.length > 3000) return `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

async function fetchMeta(url: string): Promise<{ title?: string; description?: string }> {
  try {
    const { data: html } = await axios.get<string>(url, {
      timeout: 15000,
      maxContentLength: 3_000_000,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
    });
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const description =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim() ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]?.trim();
    return { title, description };
  } catch {
    return {};
  }
}

// ── Google PageSpeed Insights (free, hosted Lighthouse) ──
class PageSpeedAnalyzer implements PageAnalyzer {
  private endpoint = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

  private async run(url: string, strategy: "mobile" | "desktop") {
    const cats = ["performance", "seo", "accessibility", "best-practices"]
      .map((c) => `category=${c}`)
      .join("&");
    const base = `${this.endpoint}?url=${encodeURIComponent(url)}&strategy=${strategy}&${cats}`;
    // Try each PageSpeed key in turn; roll to the next only on a quota/auth
    // error (429/403). A different error (bad URL) fails fast — no point
    // burning the other keys on it.
    const keys = pageSpeedKeys();
    const urls = keys.length ? keys.map((k) => `${base}&key=${k}`) : [base];
    let lastErr: any;
    for (const requestUrl of urls) {
      try {
        const { data } = await axios.get(requestUrl, { timeout: 70000 });
        return data;
      } catch (e: any) {
        lastErr = e;
        const status = e?.response?.status;
        if (status !== 429 && status !== 403) throw e;
      }
    }
    throw lastErr;
  }

  private extractScreenshot(lhr: any): string | undefined {
    return (
      lhr?.fullPageScreenshot?.screenshot?.data ||
      lhr?.audits?.["final-screenshot"]?.details?.data ||
      undefined
    );
  }

  private score(lhr: any, cat: string): number | null {
    const s = lhr?.categories?.[cat]?.score;
    return typeof s === "number" ? Math.round(s * 100) : null;
  }

  async analyze(url: string): Promise<PageCapture> {
    // Mobile drives scores + mobile screenshot; desktop only for its screenshot.
    const [mobile, meta, desktop] = await Promise.allSettled([
      this.run(url, "mobile"),
      fetchMeta(url),
      this.run(url, "desktop"),
    ]);

    const metaData = meta.status === "fulfilled" ? meta.value : {};

    // PageSpeed Insights unavailable (no key / quota) → free screenshot, no scores.
    if (mobile.status !== "fulfilled") {
      const shot = await fallbackScreenshot(url);
      if (!shot) {
        throw new Error("Could not analyze this URL — the site may be unreachable or blocking crawlers.");
      }
      return {
        url,
        finalUrl: url,
        title: metaData.title,
        description: metaData.description,
        mobileShot: shot,
        scores: { performance: null, seo: null, accessibility: null, bestPractices: null },
      };
    }

    const mLhr = mobile.value.lighthouseResult;
    const dLhr = desktop.status === "fulfilled" ? desktop.value.lighthouseResult : undefined;

    return {
      url,
      finalUrl: mLhr?.finalUrl || mobile.value.id || url,
      title: metaData.title,
      description: metaData.description,
      mobileShot: this.extractScreenshot(mLhr),
      desktopShot: this.extractScreenshot(dLhr),
      scores: {
        performance: this.score(mLhr, "performance"),
        seo: this.score(mLhr, "seo"),
        accessibility: this.score(mLhr, "accessibility"),
        bestPractices: this.score(mLhr, "best-practices"),
      },
    };
  }
}

// ── DataForSEO (paid, deeper audit) ───────────
// Uses the LIVE On-Page "Instant Pages" endpoint (no async polling) for a real
// on-page score + meta, and keeps the free screenshot for the image. Activated
// only when DATAFORSEO_LOGIN/PASSWORD are set; falls back to PSI on any error.
class DataForSeoAnalyzer implements PageAnalyzer {
  private auth = Buffer.from(`${setting("DATAFORSEO_LOGIN")}:${setting("DATAFORSEO_PASSWORD")}`).toString("base64");

  async analyze(url: string): Promise<PageCapture> {
    try {
      const { data } = await axios.post(
        "https://api.dataforseo.com/v3/on_page/instant_pages",
        [{ url, enable_javascript: true }],
        {
          headers: { Authorization: `Basic ${this.auth}`, "Content-Type": "application/json" },
          timeout: 60000,
        },
      );
      const item = data?.tasks?.[0]?.result?.[0]?.items?.[0];
      if (!item) throw new Error("DataForSEO returned no page data");

      const meta = item.meta ?? {};
      const onpage = typeof item.onpage_score === "number" ? Math.round(item.onpage_score) : null;
      const [shot, metaFallback] = await Promise.all([fallbackScreenshot(url), fetchMeta(url)]);

      return {
        url,
        finalUrl: item.url || url,
        title: meta.title || metaFallback.title,
        description: meta.description || metaFallback.description,
        mobileShot: shot,
        scores: {
          // DataForSEO's on-page score is an overall quality signal; map to SEO.
          performance: null,
          seo: onpage,
          accessibility: null,
          bestPractices: null,
        },
      };
    } catch (err) {
      console.warn("DataForSEO failed, falling back to PageSpeed Insights:", (err as Error).message);
      return new PageSpeedAnalyzer().analyze(url);
    }
  }
}

// ── Provider factory ──────────────────────────
// Controlled by SEO_PROVIDER:
//  - "pagespeed"  → always the free PSI analyzer
//  - "dataforseo" → DataForSEO (requires creds; falls back to PSI on error)
//  - "auto"       → DataForSEO when creds are set, else PSI
export function getPageAnalyzer(): PageAnalyzer {
  const hasCreds = Boolean(setting("DATAFORSEO_LOGIN") && setting("DATAFORSEO_PASSWORD"));
  if (setting("SEO_PROVIDER") === "pagespeed") return new PageSpeedAnalyzer();
  if (setting("SEO_PROVIDER") === "dataforseo") {
    if (!hasCreds) {
      console.warn("SEO_PROVIDER=dataforseo but DATAFORSEO creds are missing — using PageSpeed.");
      return new PageSpeedAnalyzer();
    }
    return new DataForSeoAnalyzer();
  }
  // auto
  return hasCreds ? new DataForSeoAnalyzer() : new PageSpeedAnalyzer();
}

// Always the free PageSpeed (Lighthouse) analyzer — used by the Score game so
// the report always has Core Web Vitals (performance / a11y / best-practices),
// while DataForSEO supplies the authority/keyword/backlink data separately.
export function getLighthouseAnalyzer(): PageAnalyzer {
  return new PageSpeedAnalyzer();
}

// True when DataForSEO domain metrics (DA/PA/keywords) should be fetched.
export function dataForSeoEnabled(): boolean {
  return (
    setting("SEO_PROVIDER") !== "pagespeed" &&
    Boolean(setting("DATAFORSEO_LOGIN") && setting("DATAFORSEO_PASSWORD"))
  );
}
