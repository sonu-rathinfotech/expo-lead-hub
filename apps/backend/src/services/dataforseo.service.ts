import axios from "axios";
import { setting, settingInt } from "./settings.service";

// Domain-level SEO metrics for the AI Score game. These describe the whole
// domain (not just the homepage): DA/PA-style authority ranks + keyword data.
// Every call is wrapped so a failure degrades to null rather than failing the
// analysis — the booth must never hang on a slow/paid API.
export interface DomainMetrics {
  da: number | null; // domain rank 0-1000 (DataForSEO), ~ Domain Authority
  pa: number | null; // page rank 0-1000 for the submitted URL, ~ Page Authority
  keywordCount: number | null; // organic keywords the domain ranks for
  organicTraffic: number | null; // estimated traffic value (etv)
  referringDomains: number | null; // unique domains linking to this site
  backlinks: number | null; // total backlinks
  topKeywords: string[]; // a few example ranking keywords
}

export interface CompetitorLite {
  domain: string;
  sharedKeywords: number | null;
}

const EMPTY: DomainMetrics = {
  da: null,
  pa: null,
  keywordCount: null,
  organicTraffic: null,
  referringDomains: null,
  backlinks: null,
  topKeywords: [],
};

function authHeader(): string {
  return "Basic " + Buffer.from(`${setting("DATAFORSEO_LOGIN")}:${setting("DATAFORSEO_PASSWORD")}`).toString("base64");
}

// Remaining account balance (USD) via appendix/user_data — for the Settings page.
export async function fetchAccountBalance(): Promise<{ balance: number | null; currency: string }> {
  if (!setting("DATAFORSEO_LOGIN") || !setting("DATAFORSEO_PASSWORD")) return { balance: null, currency: "USD" };
  try {
    const { data } = await axios.get("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: authHeader() },
      timeout: 12000,
    });
    const money = data?.tasks?.[0]?.result?.[0]?.money ?? {};
    return {
      balance: typeof money.balance === "number" ? money.balance : null,
      currency: money.currency ?? "USD",
    };
  } catch {
    return { balance: null, currency: "USD" };
  }
}

async function post(path: string, body: unknown, timeout = 20_000): Promise<any> {
  const { data } = await axios.post(`https://api.dataforseo.com/v3/${path}`, body, {
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    timeout,
  });
  return data;
}

// Strip to a bare hostname (no scheme, no path, no www).
function toDomain(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]!;
  }
}

// DA (domain) + PA (page) via one Backlinks bulk_ranks call.
async function fetchRanks(domain: string, url: string): Promise<{ da: number | null; pa: number | null }> {
  try {
    const data = await post("backlinks/bulk_ranks/live", [{ targets: [domain, url] }]);
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    const byTarget = (t: string) =>
      items.find((i) => (i?.target ?? "").replace(/^www\./i, "") === t.replace(/^www\./i, ""));
    const daItem = byTarget(domain);
    const paItem = items.find((i) => (i?.target ?? "").includes(url.replace(/^https?:\/\//i, ""))) ?? byTarget(url);
    const num = (v: any) => (typeof v === "number" ? Math.round(v) : null);
    return { da: num(daItem?.rank), pa: num(paItem?.rank) };
  } catch (e) {
    console.warn("[dataforseo] bulk_ranks failed:", (e as Error).message);
    return { da: null, pa: null };
  }
}

// Organic keyword count + traffic value via Labs domain_rank_overview.
async function fetchKeywordOverview(domain: string): Promise<{ keywordCount: number | null; organicTraffic: number | null }> {
  try {
    const data = await post("dataforseo_labs/google/domain_rank_overview/live", [
      { target: domain, location_code: settingInt("DATAFORSEO_LOCATION_CODE", 2840), language_code: setting("DATAFORSEO_LANGUAGE_CODE") },
    ]);
    const organic = data?.tasks?.[0]?.result?.[0]?.items?.[0]?.metrics?.organic ?? {};
    const num = (v: any) => (typeof v === "number" ? Math.round(v) : null);
    return { keywordCount: num(organic.count), organicTraffic: num(organic.etv) };
  } catch (e) {
    console.warn("[dataforseo] domain_rank_overview failed:", (e as Error).message);
    return { keywordCount: null, organicTraffic: null };
  }
}

// Referring domains + total backlinks via Backlinks summary.
async function fetchBacklinks(domain: string): Promise<{ referringDomains: number | null; backlinks: number | null }> {
  try {
    const data = await post("backlinks/summary/live", [
      { target: domain, internal_list_limit: 1, backlinks_status_type: "live" },
    ]);
    const r = data?.tasks?.[0]?.result?.[0] ?? {};
    const num = (v: any) => (typeof v === "number" ? v : null);
    return { referringDomains: num(r.referring_domains), backlinks: num(r.backlinks) };
  } catch (e) {
    console.warn("[dataforseo] backlinks summary failed:", (e as Error).message);
    return { referringDomains: null, backlinks: null };
  }
}

// Top organic competitors (by shared keywords) via Labs competitors_domain.
// Filters out the site itself and obvious non-competitors (social/directories).
const NON_COMPETITORS = /(facebook|instagram|linkedin|twitter|x|youtube|pinterest|justdial|indiamart|wikipedia|google|amazon)\./i;
export async function fetchCompetitors(domain: string, limit = 5): Promise<CompetitorLite[]> {
  if (!setting("DATAFORSEO_LOGIN") || !setting("DATAFORSEO_PASSWORD")) return [];
  try {
    const data = await post("dataforseo_labs/google/competitors_domain/live", [
      { target: domain, location_code: settingInt("DATAFORSEO_LOCATION_CODE", 2840), language_code: setting("DATAFORSEO_LANGUAGE_CODE"), limit: limit + 6 },
    ]);
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    const self = domain.replace(/^www\./, "");
    return items
      .map((i) => ({ domain: String(i?.domain ?? ""), sharedKeywords: typeof i?.intersections === "number" ? i.intersections : null }))
      .filter((c) => c.domain && c.domain.replace(/^www\./, "") !== self && !NON_COMPETITORS.test(c.domain))
      .slice(0, limit);
  } catch (e) {
    console.warn("[dataforseo] competitors failed:", (e as Error).message);
    return [];
  }
}

// A few example ranking keywords via Labs ranked_keywords.
async function fetchTopKeywords(domain: string, limit = 10): Promise<string[]> {
  try {
    const data = await post("dataforseo_labs/google/ranked_keywords/live", [
      {
        target: domain,
        location_code: settingInt("DATAFORSEO_LOCATION_CODE", 2840),
        language_code: setting("DATAFORSEO_LANGUAGE_CODE"),
        limit,
        order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
      },
    ]);
    const items: any[] = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    return items
      .map((i) => i?.keyword_data?.keyword)
      .filter((k): k is string => typeof k === "string" && k.length > 0)
      .slice(0, limit);
  } catch (e) {
    console.warn("[dataforseo] ranked_keywords failed:", (e as Error).message);
    return [];
  }
}

// ── AI Search Presence (AI Optimization → LLM Mentions) ───────────────────────
// Is this domain actually CITED by AI answers? One live call per platform:
//  - platform "google"   → cited in Google AI Overviews
//  - platform "chat_gpt" → cited in ChatGPT answers
// This is a domain/keyword lookup against DataForSEO's index — it does NOT crawl
// the visitor's site, so a heavy site costs exactly the same as a small one.
// Bounded to 2 calls/site (~$0.10 each). Degrade-safe: any failure → null.
export interface AiMention {
  googleAio: boolean | null; // cited in Google AI Overviews
  chatgpt: boolean | null; // cited in ChatGPT answers
  sampleQuery: string | null; // an example question where this domain IS cited
  samplePlatform: string | null; // "Google AI Overview" | "ChatGPT"
}

// On only when DataForSEO creds are set AND not explicitly turned off. Lets the
// booth cap spend — set DATAFORSEO_AI_MENTIONS=off to disable the paid AI check.
export function aiMentionsEnabled(): boolean {
  return (
    Boolean(setting("DATAFORSEO_LOGIN") && setting("DATAFORSEO_PASSWORD")) &&
    setting("DATAFORSEO_AI_MENTIONS") !== "off"
  );
}

// Returns whether the domain is cited on this platform + a sample question where
// it's cited (for the "what AI actually said" booth moment). null on API error.
async function checkCited(
  domain: string,
  platform: "google" | "chat_gpt",
): Promise<{ cited: boolean; question?: string } | null> {
  try {
    const data = await post(
      "ai_optimization/llm_mentions/search/live",
      [
        {
          target: [{ domain, search_scope: ["sources"] }],
          platform,
          location_code: settingInt("DATAFORSEO_LOCATION_CODE", 2840),
          language_code: setting("DATAFORSEO_LANGUAGE_CODE") || "en",
          limit: 1, // one row is enough to know IF it's cited + one sample query
        },
      ],
      20_000,
    );
    const result = data?.tasks?.[0]?.result?.[0];
    const items: any[] = Array.isArray(result?.items) ? result.items : [];
    const total = result?.total_count;
    const cited = typeof total === "number" ? total > 0 : items.length > 0;
    const question = typeof items[0]?.question === "string" ? items[0].question : items[0]?.keyword;
    return { cited, question: cited && typeof question === "string" ? question : undefined };
  } catch (e) {
    console.warn(`[dataforseo] llm_mentions (${platform}) failed:`, (e as Error).message);
    return null;
  }
}

export async function fetchAiMentions(url: string): Promise<AiMention> {
  if (!aiMentionsEnabled()) return { googleAio: null, chatgpt: null, sampleQuery: null, samplePlatform: null };
  const domain = toDomain(url);
  const [g, c] = await Promise.all([checkCited(domain, "google"), checkCited(domain, "chat_gpt")]);

  // Prefer a Google AI Overview sample (most relatable), else ChatGPT.
  let sampleQuery: string | null = null;
  let samplePlatform: string | null = null;
  if (g?.cited && g.question) {
    sampleQuery = g.question;
    samplePlatform = "Google AI Overview";
  } else if (c?.cited && c.question) {
    sampleQuery = c.question;
    samplePlatform = "ChatGPT";
  }

  return {
    googleAio: g ? g.cited : null,
    chatgpt: c ? c.cited : null,
    sampleQuery,
    samplePlatform,
  };
}

export async function fetchDomainMetrics(url: string): Promise<DomainMetrics> {
  if (!setting("DATAFORSEO_LOGIN") || !setting("DATAFORSEO_PASSWORD")) return EMPTY;
  const domain = toDomain(url);
  const [ranks, overview, backlinks, topKeywords] = await Promise.all([
    fetchRanks(domain, url),
    fetchKeywordOverview(domain),
    fetchBacklinks(domain),
    fetchTopKeywords(domain),
  ]);
  return { ...ranks, ...overview, ...backlinks, topKeywords };
}
