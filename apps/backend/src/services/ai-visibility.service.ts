import axios from "axios";
import { withGeminiModel } from "./gemini.service";
import { AppError } from "../middleware/error-handler";
import { normalizeUrl, hostOf, type PageCapture, type PageScores } from "./page-analyzer.service";

// ── AI Visibility Report (newaigame.md) ───────────────────────────────────────
// Real, deterministic checks of how discoverable/understandable a site is to AI
// assistants: llms.txt, AI-crawler access (robots.txt), structured data, entity
// recognition, content structure, page performance. Scores are computed here (not
// guessed by the model); Gemini only writes the prose (summary, comparison
// paragraph, opportunities).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// The four AI crawlers the report calls out.
const AI_BOTS = ["GPTBot", "ClaudeBot", "Google-Extended", "PerplexityBot"] as const;

export type SignalStatus = "good" | "warn" | "missing"; // ✅ / ⚠ / ❌
export type SignalKey =
  | "llms_txt"
  | "ai_crawlers"
  | "structured_data"
  | "entity_recognition"
  | "content_structure"
  | "page_performance";

export interface Signal {
  key: SignalKey;
  label: string;
  status: SignalStatus;
}

export interface SiteVisibility {
  url: string;
  score: number; // 0–100 AI Visibility Score
  grade: string; // A+ | A | B+ | B | C | D
  readiness: number; // 0–100 AI Readiness (signals excluding performance)
  performance: number | null; // Lighthouse performance
  lighthouse?: PageScores; // full Lighthouse breakdown (perf/seo/a11y/best-practices)
  signals: Signal[];
  summary?: string; // filled by generateVisibilityReport for YOUR site
}

export interface VisibilityReport {
  your: SiteVisibility;
  competitor: SiteVisibility;
  competitor2?: SiteVisibility;
  comparison: { advantage: "you" | "competitor" | "competitor2" | "tie"; paragraph: string };
  opportunities: string[];
}

// Raw findings from the real checks — turned into Signals by buildSiteVisibility.
interface SignalData {
  llms: { present: boolean; length: number };
  robots: { fetched: boolean; blocked: Record<string, boolean> }; // per-bot blocked
  jsonLd: { blocks: number; parsed: number; types: string[]; org: "full" | "partial" | "none" };
  microdataOrOg: boolean;
  content: { h1: number; h2: number; landmarks: number; textLen: number };
}

// ── Real checks ───────────────────────────────────────────────────────────────

async function getText(url: string, timeout = 10000): Promise<{ status: number; body: string; contentType: string }> {
  const res = await axios.get<string>(url, {
    timeout,
    responseType: "text",
    maxContentLength: 3_000_000,
    maxRedirects: 5,
    validateStatus: () => true, // we inspect the status ourselves
    headers: { "User-Agent": UA },
    transformResponse: [(d) => d], // keep raw text (don't let axios JSON-parse)
  });
  return {
    status: res.status,
    body: typeof res.data === "string" ? res.data : String(res.data ?? ""),
    contentType: String(res.headers?.["content-type"] || ""),
  };
}

// robots.txt → map of user-agent (lowercased) → whether the whole site is Disallowed.
function parseRobots(txt: string): Record<string, boolean> {
  const blocked: Record<string, boolean> = {};
  let agents: string[] = [];
  let sawRuleForGroup = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      // Consecutive User-agent lines share the following rule block.
      if (sawRuleForGroup) {
        agents = [];
        sawRuleForGroup = false;
      }
      agents.push(ua[1]!.trim().toLowerCase());
      for (const a of agents) if (!(a in blocked)) blocked[a] = false;
      continue;
    }
    const dis = line.match(/^disallow:\s*(.*)$/i);
    if (dis) {
      sawRuleForGroup = true;
      const path = dis[1]!.trim();
      if (path === "/") for (const a of agents) blocked[a] = true;
      continue;
    }
    if (/^allow:\s*/i.test(line)) {
      sawRuleForGroup = true;
      // An explicit Allow: / clears a site-wide block for the current group.
      if (/^allow:\s*\/\s*$/i.test(line)) for (const a of agents) blocked[a] = false;
    }
  }
  return blocked;
}

function botBlocked(blockedMap: Record<string, boolean>, bot: string): boolean {
  const b = bot.toLowerCase();
  if (b in blockedMap) return blockedMap[b]!;
  if ("*" in blockedMap) return blockedMap["*"]!;
  return false; // no matching rule → allowed by default
}

// Pull and parse every <script type="application/ld+json"> block.
function parseJsonLd(html: string): { blocks: number; parsed: number; types: string[]; org: "full" | "partial" | "none" } {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const types: string[] = [];
  let blocks = 0;
  let parsed = 0;
  let org: "full" | "partial" | "none" = "none";
  const ORG_TYPES = /^(organization|localbusiness|corporation|ngo|person|store|professionalservice)/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    blocks++;
    try {
      const json = JSON.parse(m[1]!.trim());
      parsed++;
      const nodes = Array.isArray(json) ? json : json["@graph"] && Array.isArray(json["@graph"]) ? json["@graph"] : [json];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const t = ([] as string[]).concat(node["@type"] ?? []).map(String);
        types.push(...t);
        if (t.some((x) => ORG_TYPES.test(x)) && node.name) {
          const hasIdentity = Boolean(node.sameAs || node.url || node.logo);
          if (hasIdentity) org = "full";
          else if (org !== "full") org = "partial";
        }
      }
    } catch {
      /* malformed block — counted in `blocks` but not `parsed` */
    }
  }
  return { blocks, parsed, types: Array.from(new Set(types)), org };
}

function analyzeContent(html: string): { h1: number; h2: number; landmarks: number; textLen: number } {
  const count = (re: RegExp) => (html.match(re) || []).length;
  const h1 = count(/<h1[\s>]/gi);
  const h2 = count(/<h2[\s>]/gi);
  const landmarks =
    (/<main[\s>]/i.test(html) ? 1 : 0) +
    (/<article[\s>]/i.test(html) ? 1 : 0) +
    (/<section[\s>]/i.test(html) ? 1 : 0) +
    (/<nav[\s>]/i.test(html) ? 1 : 0) +
    (/<header[\s>]/i.test(html) ? 1 : 0) +
    (/<footer[\s>]/i.test(html) ? 1 : 0);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const textLen = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  return { h1, h2, landmarks, textLen };
}

// Run every real check for one URL. Never throws — failed fetches degrade to
// "missing"/allowed defaults so one flaky site can't fail the whole analysis.
export async function gatherSignals(rawUrl: string): Promise<SignalData> {
  const base = new URL(normalizeUrl(rawUrl));
  const origin = base.origin;

  const [llmsR, robotsR, htmlR] = await Promise.allSettled([
    getText(`${origin}/llms.txt`),
    getText(`${origin}/robots.txt`),
    getText(base.toString(), 15000),
  ]);

  // llms.txt — present when it 200s with real text (not an HTML 404 page).
  let llms = { present: false, length: 0 };
  if (llmsR.status === "fulfilled" && llmsR.value.status === 200) {
    const b = llmsR.value.body.trim();
    const looksHtml = /^<(!doctype|html)/i.test(b) || /text\/html/i.test(llmsR.value.contentType);
    if (b.length >= 20 && !looksHtml) llms = { present: true, length: b.length };
    else if (b.length > 0 && !looksHtml) llms = { present: false, length: b.length };
  }

  // robots.txt — per-bot site-wide block.
  let robots = { fetched: false, blocked: {} as Record<string, boolean> };
  if (robotsR.status === "fulfilled" && robotsR.value.status === 200 && /disallow|user-agent/i.test(robotsR.value.body)) {
    const map = parseRobots(robotsR.value.body);
    robots = { fetched: true, blocked: Object.fromEntries(AI_BOTS.map((b) => [b, botBlocked(map, b)])) };
  } else {
    robots = { fetched: false, blocked: Object.fromEntries(AI_BOTS.map((b) => [b, false])) }; // no robots.txt → allowed
  }

  const html = htmlR.status === "fulfilled" ? htmlR.value.body : "";
  const jsonLd = parseJsonLd(html);
  const microdataOrOg = /itemtype=|property=["']og:/i.test(html);
  const content = analyzeContent(html);

  return { llms, robots, jsonLd, microdataOrOg, content };
}

// ── Signals → statuses → score ────────────────────────────────────────────────

const WEIGHTS: Record<SignalKey, number> = {
  ai_crawlers: 20,
  structured_data: 20,
  llms_txt: 15,
  entity_recognition: 15,
  content_structure: 15,
  page_performance: 15,
};

function perfStatus(perf: number | null): SignalStatus {
  if (perf == null) return "warn";
  if (perf >= 90) return "good";
  if (perf >= 50) return "warn";
  return "missing";
}

function computeSignals(d: SignalData, perf: number | null): Signal[] {
  // AI crawlers: none blocked → good, some → warn, all four → missing.
  const blockedCount = AI_BOTS.filter((b) => d.robots.blocked[b]).length;
  const crawlers: SignalStatus = blockedCount === 0 ? "good" : blockedCount >= AI_BOTS.length ? "missing" : "warn";

  // Structured data: valid JSON-LD → good; only microdata/OG → warn; nothing → missing.
  const structured: SignalStatus = d.jsonLd.parsed > 0 ? "good" : d.microdataOrOg || d.jsonLd.blocks > 0 ? "warn" : "missing";

  // Entity: an Organization/Person with identity links.
  const entity: SignalStatus = d.jsonLd.org === "full" ? "good" : d.jsonLd.org === "partial" ? "warn" : "missing";

  // Content structure: single h1 + headings + landmarks + real text.
  const c = d.content;
  const points =
    (c.h1 === 1 ? 1 : 0) + (c.h2 >= 2 ? 1 : 0) + (c.landmarks >= 2 ? 1 : 0) + (c.textLen > 800 ? 1 : 0);
  const structure: SignalStatus = points >= 3 ? "good" : points >= 1 ? "warn" : "missing";

  const llms: SignalStatus = d.llms.present ? "good" : "missing";

  return [
    { key: "llms_txt", label: "LLMs.txt", status: llms },
    { key: "ai_crawlers", label: "AI Crawler Accessibility", status: crawlers },
    { key: "structured_data", label: "Structured Data", status: structured },
    { key: "entity_recognition", label: "Entity Recognition", status: entity },
    { key: "content_structure", label: "Content Structure", status: structure },
    { key: "page_performance", label: "Page Performance", status: perfStatus(perf) },
  ];
}

const statusFactor = (s: SignalStatus) => (s === "good" ? 1 : s === "warn" ? 0.5 : 0);

function gradeFor(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

// Turn a capture + raw signal data into the scored per-site object.
export function buildSiteVisibility(capture: PageCapture, data: SignalData): SiteVisibility {
  const perf = capture.scores.performance;
  const signals = computeSignals(data, perf);

  let score = 0;
  let readinessEarned = 0;
  let readinessMax = 0;
  for (const sig of signals) {
    const earned = WEIGHTS[sig.key] * statusFactor(sig.status);
    score += earned;
    if (sig.key !== "page_performance") {
      readinessEarned += earned;
      readinessMax += WEIGHTS[sig.key];
    }
  }
  score = Math.round(score);
  const readiness = readinessMax ? Math.round((readinessEarned / readinessMax) * 100) : 0;

  return { url: capture.finalUrl, score, grade: gradeFor(score), readiness, performance: perf, lighthouse: capture.scores, signals };
}

// ── Gemini prose (summary + comparison paragraph + opportunities) ─────────────

const SYSTEM_PROMPT = `You are an AI Visibility Analyst. You are given the ALREADY-COMPUTED AI-visibility signals and scores for a visitor's website ("YOUR SITE") and one or two competitors. Do NOT recompute or change any score — treat the numbers and signal ratings as facts.

Write a concise, professional, sales-oriented AI Visibility Report as JSON. Return ONLY valid JSON with EXACTLY this shape:
{
  "summary": "2-3 sentence professional summary of YOUR SITE's AI visibility — how well AI assistants (ChatGPT, Gemini, Perplexity, Claude) can discover, understand and cite it. Reference its score/grade band. No implementation detail.",
  "comparisonParagraph": "ONE short paragraph comparing YOUR SITE with the competitor(s) across AI Visibility Score, AI Readiness and Performance, and clearly stating who currently has the advantage and why.",
  "opportunities": ["exactly three high-level AI visibility opportunities for YOUR SITE, phrased as short outcome-focused titles, NOT step-by-step instructions"]
}

Keep it professional, concise and sales-oriented. Do not add any other sections or fields.`;

const statusWord = (s: SignalStatus) => (s === "good" ? "Good" : s === "warn" ? "Needs Improvement" : "Missing");

function factLine(label: string, s: SiteVisibility): string {
  const sig = s.signals.map((x) => `${x.label}: ${statusWord(x.status)}`).join("; ");
  return `${label} (${hostOf(s.url)}): AI Visibility Score ${s.score}/100 (grade ${s.grade}), AI Readiness ${s.readiness}/100, Performance ${s.performance ?? "n/a"}. Signals — ${sig}.`;
}

// Deterministic advantage: highest AI Visibility Score wins; equal top → tie.
function computeAdvantage(you: SiteVisibility, comp: SiteVisibility, comp2?: SiteVisibility): VisibilityReport["comparison"]["advantage"] {
  const field: Array<{ key: "you" | "competitor" | "competitor2"; score: number }> = [
    { key: "you", score: you.score },
    { key: "competitor", score: comp.score },
  ];
  if (comp2) field.push({ key: "competitor2", score: comp2.score });
  field.sort((a, b) => b.score - a.score);
  if (field.length > 1 && field[0]!.score === field[1]!.score) return "tie";
  return field[0]!.key;
}

export async function generateVisibilityReport(
  you: SiteVisibility,
  competitor: SiteVisibility,
  competitor2?: SiteVisibility,
): Promise<VisibilityReport> {
  const facts = [factLine("YOUR SITE", you), factLine("COMPETITOR", competitor)];
  if (competitor2) facts.push(factLine("COMPETITOR 2", competitor2));

  let text: string;
  try {
    text = await withGeminiModel(
      { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 1024 },
      async (model) => (await model.generateContent(`${SYSTEM_PROMPT}\n\n${facts.join("\n")}`)).response.text() as string,
    );
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(502, `AI request failed: ${err?.message ?? "unknown error"}`);
  }

  let parsed: { summary?: string; comparisonParagraph?: string; opportunities?: string[] };
  try {
    parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim());
  } catch {
    throw new AppError(502, "AI returned an unexpected response. Please try again.");
  }

  const opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities.filter(Boolean).slice(0, 3) : [];
  return {
    your: { ...you, summary: parsed.summary ?? "" },
    competitor,
    competitor2,
    comparison: {
      advantage: computeAdvantage(you, competitor, competitor2),
      paragraph: parsed.comparisonParagraph ?? "",
    },
    opportunities,
  };
}
