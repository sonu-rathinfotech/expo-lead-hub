import { useEffect, useState } from "react";
import { Sparkles, Download, CheckCircle2, AlertTriangle, XCircle, Lock, CalendarClock, TrendingUp, Monitor, Info, Zap, Quote, ArrowRight } from "lucide-react";
import { ScoreRing, scoreColor } from "./ScoreRing";

const YOU_COLOR = "#10b981"; // emerald
const COMP_COLOR = "#f43f5e"; // rose
const COMP2_COLOR = "#f59e0b"; // amber

type SignalStatus = "good" | "warn" | "missing";

interface Signal {
  key: string;
  label: string;
  status: SignalStatus;
}

interface Lighthouse {
  performance?: number | null;
  seo?: number | null;
  accessibility?: number | null;
  bestPractices?: number | null;
}

interface AiMention {
  googleAio?: boolean | null; // cited in Google AI Overviews
  chatgpt?: boolean | null; // cited in ChatGPT answers
  sampleQuery?: string | null; // example question where this domain is cited
  samplePlatform?: string | null; // "Google AI Overview" | "ChatGPT"
}

interface SiteVisibility {
  url?: string;
  score?: number;
  grade?: string;
  readiness?: number;
  performance?: number | null;
  lighthouse?: Lighthouse;
  signals?: Signal[];
  summary?: string;
}

// The report shape stored in WebsiteAnalysis.audit (see ai-visibility.service.ts).
export interface Comparison {
  id: string;
  url: string;
  competitorUrl?: string | null;
  competitorUrl2?: string | null;
  company?: string | null;
  mobileShot?: string | null;
  desktopShot?: string | null;
  competitorShot?: string | null;
  competitor2Shot?: string | null;
  audit?: {
    your?: SiteVisibility;
    competitor?: SiteVisibility;
    competitor2?: SiteVisibility;
    comparison?: { advantage?: "you" | "competitor" | "competitor2" | "tie"; paragraph?: string };
    opportunities?: string[];
    aiMentions?: { your?: AiMention | null; competitor?: AiMention | null } | null;
  } | null;
}

// Animate a number 0 → target on mount.
function useCountUp(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function gradeColor(grade?: string) {
  if (!grade) return "#6b7280";
  if (grade.startsWith("A")) return "#15803d"; // green-700
  if (grade.startsWith("B")) return "#b45309"; // amber-700
  return "#b91c1c"; // red-700 (C / D)
}

// ── Section 2: signal status icon (✅ / ⚠ / ❌) ──
const STATUS_META: Record<SignalStatus, { cls: string; text: string }> = {
  good: { cls: "text-emerald-600", text: "Good" },
  warn: { cls: "text-amber-600", text: "Needs Improvement" },
  missing: { cls: "text-rose-600", text: "Missing" },
};

function StatusIcon({ status, size = 18 }: { status?: SignalStatus; size?: number }) {
  if (!status) return <span className="text-gray-300">–</span>;
  const cls = STATUS_META[status].cls;
  if (status === "good") return <CheckCircle2 size={size} className={cls} />;
  if (status === "warn") return <AlertTriangle size={size} className={cls} />;
  return <XCircle size={size} className={cls} />;
}

// Plain-language definitions shown as tooltips (hover the ⓘ) so sales & visitors
// don't need to memorize what each signal means.
const SIGNAL_INFO: Record<string, string> = {
  llms_txt: "An llms.txt file tells AI models what your site is about and what to read — like a welcome guide for AI. Missing = AI has to guess.",
  ai_crawlers: "Whether you allow AI bots (GPTBot, ClaudeBot, Google-Extended, PerplexityBot) to read your site. Blocked = you're invisible to that AI.",
  structured_data: "Hidden schema/JSON-LD code that spells out your business in a format AI trusts. Present = AI can quote you accurately.",
  entity_recognition: "Whether AI can clearly identify who you are as a business (name, brand, links). Missing = AI doesn't recognize you as a known entity.",
  content_structure: "Clean headings and real text (not just images) so AI can read and summarize you. Poor structure = AI can't extract your message.",
  page_performance: "How fast and technically healthy the page is (Google Lighthouse). Slow sites get crawled and cited less by AI.",
};

// Signals for YOUR site vs the competitor(s), side by side.
function SignalCompare({ cols }: { cols: { label: string; color: string; site: SiteVisibility }[] }) {
  const base = cols[0]?.site.signals ?? [];
  const statusOf = (site: SiteVisibility, key: string) => site.signals?.find((s) => s.key === key)?.status;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            <th className="py-2 text-left">Signal</th>
            {cols.map((c, i) => (
              <th key={i} className="px-2 py-2 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="max-w-[7rem] truncate" title={c.label}>{c.label}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {base.map((sig) => (
            <tr key={sig.key} className="border-t border-gray-100">
              <td className="py-2.5 text-left font-medium text-gray-700">
                <span className="inline-flex items-center gap-1.5">
                  {sig.label}
                  {SIGNAL_INFO[sig.key] && (
                    <span title={SIGNAL_INFO[sig.key]} className="cursor-help text-gray-300 hover:text-gray-500 print:hidden">
                      <Info size={13} />
                    </span>
                  )}
                </span>
              </td>
              {cols.map((c, i) => (
                <td key={i} className="px-2 py-2.5">
                  <div className="flex justify-center"><StatusIcon status={statusOf(c.site, sig.key)} /></div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-600" /> Good</span>
        <span className="inline-flex items-center gap-1"><AlertTriangle size={13} className="text-amber-600" /> Needs Improvement</span>
        <span className="inline-flex items-center gap-1"><XCircle size={13} className="text-rose-600" /> Missing</span>
      </div>
    </div>
  );
}

// ── Section 5: Lighthouse technical-health bar (you vs competitor) ──
function HealthBar({ label, you, comp }: { label: string; you?: number | null; comp?: number | null }) {
  const y = you ?? 0;
  const c = comp ?? 0;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
      <div className="flex min-w-0 items-center justify-end gap-2">
        <span className="font-bold tabular-nums" style={{ color: you == null ? "#9ca3af" : scoreColor(you) }}>{you ?? "–"}</span>
        <div className="h-2 w-full min-w-0 max-w-[80px] flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="ml-auto h-full rounded-full" style={{ width: `${y}%`, backgroundColor: scoreColor(you), float: "right" }} />
        </div>
      </div>
      <span className="w-16 text-center text-[11px] font-medium uppercase tracking-wide text-gray-500 sm:w-28 sm:text-xs">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-2 w-full min-w-0 max-w-[80px] flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full" style={{ width: `${c}%`, backgroundColor: scoreColor(comp) }} />
        </div>
        <span className="font-bold tabular-nums" style={{ color: comp == null ? "#9ca3af" : scoreColor(comp) }}>{comp ?? "–"}</span>
      </div>
    </div>
  );
}

// ── Section 6: captured screenshot card ──
function Shot({ title, url, shot, tone }: { title: string; url?: string | null; shot?: string | null; tone: "you" | "comp" | "comp2" }) {
  const bar = tone === "you" ? "bg-emerald-600" : tone === "comp" ? "bg-rose-600" : "bg-amber-500";
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* print fallback: dark text + light bar so the title stays legible even if
          the browser drops background colours in the PDF */}
      <div className={`px-4 py-2 text-sm font-semibold text-white ${bar} print:bg-gray-100 print:text-gray-800`}>{title}</div>
      {shot ? (
        <img src={shot} alt="" className="report-shot max-h-64 w-full object-cover object-top" />
      ) : (
        <div className="flex h-40 items-center justify-center bg-gray-50 text-gray-300 print:hidden"><Monitor size={28} /></div>
      )}
      <div className="p-3"><p className="truncate text-xs text-gray-400">{url}</p></div>
    </div>
  );
}

// ── AI Search Presence — are you actually cited by AI answers? (DataForSEO) ──
function CitedCell({ v }: { v?: boolean | null }) {
  if (v == null) return <span className="text-xs text-gray-400">–</span>;
  return v ? (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600"><CheckCircle2 size={16} /> Cited</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600"><XCircle size={16} /> Not cited</span>
  );
}

function AiPresence({
  you,
  competitor,
  youLabel,
  compLabel,
}: {
  you?: AiMention | null;
  competitor?: AiMention | null;
  youLabel: string;
  compLabel: string;
}) {
  const rows: { label: string; key: "googleAio" | "chatgpt" }[] = [
    { label: "Google AI Overview", key: "googleAio" },
    { label: "ChatGPT", key: "chatgpt" },
  ];
  const youCited = you?.googleAio === true || you?.chatgpt === true;
  const compCited = competitor?.googleAio === true || competitor?.chatgpt === true;
  const headline =
    compCited && !youCited
      ? "Your competitor already shows up in AI answers — you don't, yet."
      : youCited && !compCited
        ? "You're ahead — AI already cites you over your competitor."
        : youCited && compCited
          ? "Both of you appear in AI answers — but there's room to lead."
          : "Neither site is cited by AI yet — a wide-open opportunity to be first.";

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-violet-600">
        <Sparkles size={16} /> AI Search Presence
      </h3>
      <p className="mb-3 text-base font-semibold text-gray-900">{headline}</p>
      <p className="mb-3 text-xs text-gray-500">
        When buyers ask ChatGPT or Google's AI, does your business get named? AI assistants increasingly answer people before they ever visit a website — if they don't cite you, you're invisible at the moment of decision. (sample check)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              <th className="py-2 text-left">AI Assistant</th>
              <th className="px-2 py-2 text-center"><span className="max-w-[8rem] truncate" title={youLabel}>{youLabel}</span></th>
              <th className="px-2 py-2 text-center"><span className="max-w-[8rem] truncate" title={compLabel}>{compLabel}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100">
                <td className="py-2.5 text-left font-medium text-gray-700">{r.label}</td>
                <td className="px-2 py-2.5 text-center"><CitedCell v={you?.[r.key]} /></td>
                <td className="px-2 py-2.5 text-center"><CitedCell v={competitor?.[r.key]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* "What AI actually said" — the real question where someone gets cited.
          Prefer the competitor's (strongest hook), else the visitor's own win. */}
      {(() => {
        const compSample = competitor?.sampleQuery ? competitor : null;
        const youSample = you?.sampleQuery ? you : null;
        if (compSample && !youCited) {
          return (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-600"><Quote size={13} /> What AI actually said</p>
              <p className="mt-1.5 text-sm text-gray-700">
                When people ask <span className="font-semibold text-gray-900">“{compSample.sampleQuery}”</span> on {compSample.samplePlatform || "AI"},{" "}
                <span className="font-semibold text-rose-700">{compLabel}</span> gets named — <span className="font-semibold">{youLabel}</span> does not.
              </p>
            </div>
          );
        }
        if (youSample) {
          return (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600"><Quote size={13} /> What AI actually said</p>
              <p className="mt-1.5 text-sm text-gray-700">
                AI already cites <span className="font-semibold text-emerald-700">{youLabel}</span> when people ask{" "}
                <span className="font-semibold text-gray-900">“{youSample.sampleQuery}”</span> on {youSample.samplePlatform || "AI"}.
              </p>
            </div>
          );
        }
        return null;
      })()}
      <p className="mt-3 text-xs text-gray-400">Full AI citation audit — every assistant &amp; query — is included in your complete report.</p>
    </div>
  );
}

// ── #3 Fix-it priority: fastest path to a higher grade (frontend-only) ──
const SIGNAL_ACTIONS: Record<string, string> = {
  llms_txt: "Add an llms.txt guide so AI models know what to read",
  ai_crawlers: "Allow the AI crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot)",
  structured_data: "Add structured data (schema markup) that AI can trust",
  entity_recognition: "Define your business entity so AI recognizes your brand",
  content_structure: "Improve content structure — clear headings & readable text",
  page_performance: "Improve page speed & technical health",
};

function gradeForScore(score: number): string {
  return (GRADE_BANDS.find((b) => score >= b.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1]!).g;
}

function FixItPanel({ site, onBookMeeting }: { site: SiteVisibility; onBookMeeting?: () => void }) {
  const gaps = (site.signals ?? [])
    .map((s) => {
      const max = SIGNAL_WEIGHTS[s.key] ?? 0;
      return { ...s, gain: max - Math.round(max * (STATUS_FACTOR[s.status] ?? 0)) };
    })
    .filter((g) => g.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  if (!gaps.length) return null;

  const cur = site.score ?? 0;
  const potential = Math.min(100, cur + gaps.reduce((n, g) => n + g.gain, 0));
  const curGrade = site.grade ?? gradeForScore(cur);
  const potGrade = gradeForScore(potential);
  const jumps = potGrade !== curGrade;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-700">
        <TrendingUp size={16} /> Your fastest path to a higher grade
      </h3>
      <p className="mb-4 text-sm text-gray-700">
        Fix these {gaps.length} and your AI Visibility Score could rise from{" "}
        <span className="font-bold text-gray-900">{cur} ({curGrade})</span> to about{" "}
        <span className="font-bold text-emerald-700">{potential} ({potGrade})</span>
        {jumps ? " — a full grade jump." : "."}
      </p>
      <ol className="space-y-2.5">
        {gaps.map((g, i) => (
          <li key={g.key} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{i + 1}</span>
            <span className="flex-1 text-sm text-gray-800">{SIGNAL_ACTIONS[g.key] ?? g.label}</span>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">+{g.gain} pts</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">Our team can implement all of this for you.</p>
        {onBookMeeting && (
          <button
            onClick={onBookMeeting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 print:hidden"
          >
            Book a session <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── #4 Urgency banner (static, no API) ──
function UrgencyBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <Zap size={18} className="mt-0.5 shrink-0 text-amber-500" />
      <p className="text-sm leading-relaxed text-amber-900">
        <span className="font-bold">AI is the new front page.</span> More buyers now ask ChatGPT, Gemini and Google's AI for
        recommendations before visiting any website. If AI can't read and cite your site, you're invisible at the exact
        moment they decide.
      </p>
    </div>
  );
}

// Mirror of the backend weights (ai-visibility.service.ts) so the report can
// show exactly how each signal contributed to the score.
const SIGNAL_WEIGHTS: Record<string, number> = {
  ai_crawlers: 20,
  structured_data: 20,
  llms_txt: 15,
  entity_recognition: 15,
  content_structure: 15,
  page_performance: 15,
};
const STATUS_FACTOR: Record<SignalStatus, number> = { good: 1, warn: 0.5, missing: 0 };
const GRADE_BANDS = [
  { g: "A+", min: 95 },
  { g: "A", min: 85 },
  { g: "B+", min: 75 },
  { g: "B", min: 65 },
  { g: "C", min: 50 },
  { g: "D", min: 0 },
];

function PointBar({ label, earned, max, status }: { label: string; earned: number; max: number; status: SignalStatus }) {
  const pct = max ? (earned / max) * 100 : 0;
  const color = status === "good" ? "#16a34a" : status === "warn" ? "#f59e0b" : "#dc2626";
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-36 shrink-0 truncate text-gray-700" title={label}>{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-11 shrink-0 text-right font-semibold tabular-nums" style={{ color }}>+{earned}<span className="text-gray-400">/{max}</span></span>
    </div>
  );
}

// "Why this grade" — transparent breakdown of the score for visitors & sales.
function ScoreBreakdown({ site }: { site: SiteVisibility }) {
  const rows = (site.signals ?? []).map((s) => {
    const max = SIGNAL_WEIGHTS[s.key] ?? 0;
    return { ...s, max, earned: Math.round(max * (STATUS_FACTOR[s.status] ?? 0)) };
  });
  if (!rows.length) return null;
  const boosting = rows.filter((r) => r.status === "good");
  const gaps = rows.filter((r) => r.status !== "good").sort((a, b) => b.max - b.earned - (a.max - a.earned));
  const lost = gaps.reduce((n, r) => n + (r.max - r.earned), 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Why this grade</h3>

      {/* Grade scale — current grade highlighted */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {GRADE_BANDS.map((b) => {
          const active = b.g === site.grade;
          return (
            <span
              key={b.g}
              className={`rounded-lg px-2.5 py-1 text-center text-xs font-bold ${active ? "text-white shadow" : "text-gray-400"}`}
              style={{ backgroundColor: active ? gradeColor(site.grade) : "#f3f4f6" }}
            >
              {b.g}<span className={`ml-1 font-normal ${active ? "text-white/70" : "text-gray-300"}`}>{b.min}+</span>
            </span>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-gray-600">
        You scored <span className="font-bold text-gray-900">{site.score}/100</span>. {boosting.length} signal{boosting.length === 1 ? "" : "s"} {boosting.length === 1 ? "is" : "are"} working in your favour;
        {gaps.length > 0 ? <> closing the {gaps.length} gap{gaps.length === 1 ? "" : "s"} below could add up to <span className="font-bold text-emerald-600">+{lost} points</span>.</> : " you've covered every signal."}
      </p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600"><CheckCircle2 size={14} /> Boosting your score</p>
          <div className="space-y-2.5">
            {boosting.length ? boosting.map((r) => <PointBar key={r.key} label={r.label} earned={r.earned} max={r.max} status={r.status} />) : <p className="text-sm text-gray-400">None yet.</p>}
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-600"><AlertTriangle size={14} /> Holding you back</p>
          <div className="space-y-2.5">
            {gaps.length ? gaps.map((r) => <PointBar key={r.key} label={r.label} earned={r.earned} max={r.max} status={r.status} />) : <p className="text-sm text-gray-400">Nothing — great job!</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section 1: the big AI Visibility Score ring + grade ──
function VisibilityScore({ site }: { site: SiteVisibility }) {
  const v = useCountUp(site.score ?? 0);
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:gap-8">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div style={{ color: scoreColor(site.score) }}>
          <ScoreRing value={v} size={148} />
        </div>
        <span
          className="rounded-full px-3 py-0.5 text-sm font-bold"
          style={{ color: gradeColor(site.grade), backgroundColor: `${gradeColor(site.grade)}18` }}
        >
          Grade {site.grade ?? "—"}
        </span>
      </div>
      <div className="text-center sm:text-left">
        <p className="text-xs font-bold uppercase tracking-wide text-indigo-500">AI Visibility Score</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-700">{site.summary || "AI visibility analysis complete."}</p>
        {site.readiness != null && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm">
            <span className="font-semibold text-indigo-700">AI Readiness</span>
            <span className="font-bold tabular-nums" style={{ color: scoreColor(site.readiness) }}>{site.readiness}/100</span>
            <span className="text-xs text-gray-500">how ready your content is for AI to cite</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section 3: competitor comparison table ──
function CompareTable({ cols }: { cols: { label: string; color: string; site: SiteVisibility }[] }) {
  const rows: { label: string; get: (s: SiteVisibility) => number | null | undefined }[] = [
    { label: "AI Visibility Score", get: (s) => s.score },
    { label: "AI Readiness", get: (s) => s.readiness },
    { label: "Performance", get: (s) => s.performance },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            <th className="py-2 text-left font-semibold">Metric</th>
            {cols.map((c, i) => (
              <th key={i} className="px-2 py-2 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="max-w-[8rem] truncate" title={c.label}>{c.label}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const vals = cols.map((c) => r.get(c.site));
            const best = Math.max(...vals.map((v) => (v == null ? -1 : v)));
            return (
              <tr key={ri} className="border-t border-gray-100">
                <td className="py-2.5 text-left font-medium text-gray-600">{r.label}</td>
                {vals.map((v, ci) => (
                  <td key={ci} className="px-2 py-2.5 text-center">
                    <span
                      className="tabular-nums font-bold"
                      style={{ color: v != null && v === best ? "#15803d" : "#374151" }}
                    >
                      {v == null ? "–" : Math.round(v)}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ScoreReport({ data, onBookMeeting }: { data: Comparison; onBookMeeting?: () => void }) {
  const your = data.audit?.your ?? {};
  const comp = data.audit?.competitor ?? {};
  const comp2 = data.audit?.competitor2 ?? null;
  const comparison = data.audit?.comparison ?? {};
  const opportunities = data.audit?.opportunities ?? [];
  const signals = your.signals ?? [];
  const aiMentions = data.audit?.aiMentions ?? null;
  const hasAiMentions =
    !!aiMentions &&
    [aiMentions.your?.googleAio, aiMentions.your?.chatgpt, aiMentions.competitor?.googleAio, aiMentions.competitor?.chatgpt].some(
      (v) => v != null,
    );

  // Who this report is for — drives the header + the saved PDF filename.
  const who = data.company || hostOf(data.url) || "Website";
  const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  // Drop a real logo at apps/frontend/public/rath-logo.png (or .svg) — it shows
  // automatically; until then we fall back to the "R" wordmark below.
  const [logoOk, setLogoOk] = useState(true);
  const logoSrc = `${import.meta.env.BASE_URL}rath-logo.png`;

  const downloadPdf = () => {
    const prev = document.title;
    const date = new Date().toISOString().slice(0, 10);
    document.title = `AI Visibility Report — ${who} — ${date}`;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 1500); // fallback if afterprint doesn't fire
  };

  const cols = [
    { label: hostOf(data.url) || "You", color: YOU_COLOR, site: your },
    { label: hostOf(data.competitorUrl) || "Competitor", color: COMP_COLOR, site: comp },
  ];
  if (comp2) cols.push({ label: hostOf(data.competitorUrl2) || "Competitor 2", color: COMP2_COLOR, site: comp2 });

  return (
    <div
      data-report
      className="space-y-6 antialiased [font-variant-numeric:tabular-nums] [-webkit-font-smoothing:antialiased]"
      style={{
        fontFamily:
          '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* ── Report header — stacks on mobile, one row on md+ ── */}
      <div className="border-b-2 border-gray-900/90 pb-5">
        <div className="flex flex-col items-center gap-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
          {/* Left: logo */}
          <div className="flex justify-center md:justify-start">
            {logoOk ? (
              <img src={logoSrc} onError={() => setLogoOk(false)} alt="Rath Infotech & Web Solutions Pvt. Ltd." className="h-11 w-auto max-w-[220px] object-contain sm:h-12" />
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-xl font-black text-white shadow-md ring-1 ring-black/5">
                  R
                </span>
                <div className="leading-tight">
                  <p className="text-lg font-extrabold tracking-[0.15em] text-gray-900">RATH</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Infotech &amp; Web Solutions</p>
                </div>
              </div>
            )}
          </div>

          {/* Centre: heading */}
          <div className="min-w-0 text-center">
            <h1 className="flex items-center justify-center gap-2 text-xl font-black tracking-tight text-gray-900 sm:text-2xl md:text-3xl">
              <Sparkles className="shrink-0 text-indigo-500" size={22} /> AI Visibility Report
            </h1>
            <p className="mt-0.5 truncate text-sm font-bold text-gray-700" title={who}>{who}</p>
          </div>

          {/* Right: download */}
          <div className="flex justify-center md:justify-end">
            <button
              onClick={downloadPdf}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 print:hidden"
            >
              <Download size={16} /> Download PDF
            </button>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-gray-400">
          How discoverable <span className="font-medium text-gray-500">{hostOf(data.url) || "your site"}</span> is to AI
          assistants — ChatGPT, Gemini, Perplexity &amp; Google AI Overviews · Prepared {reportDate}
        </p>
      </div>

      {/* Urgency framing (static) */}
      <UrgencyBanner />

      {/* 1. AI Visibility Score */}
      <VisibilityScore site={your} />

      {/* Why this grade — score breakdown */}
      <ScoreBreakdown site={your} />

      {/* Fastest path to a higher grade — actionable, ties to the CTA */}
      <FixItPanel site={your} onBookMeeting={onBookMeeting} />

      {/* AI Search Presence — are you cited by AI? (moved up: strongest hook) */}
      {hasAiMentions && (
        <AiPresence
          you={aiMentions!.your}
          competitor={aiMentions!.competitor}
          youLabel={hostOf(data.url) || "You"}
          compLabel={hostOf(data.competitorUrl) || "Competitor"}
        />
      )}

      {/* 2. AI Visibility Signals — you vs competitor */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">AI Visibility Signals</h3>
        {signals.length > 0 ? (
          <SignalCompare cols={cols} />
        ) : (
          <p className="text-sm text-gray-400">No signals available.</p>
        )}
      </div>

      {/* 3. Competitor Comparison */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Competitor Comparison</h3>
        <CompareTable cols={cols} />
        {comparison.paragraph && (
          <p className="mt-4 text-sm leading-relaxed text-gray-700">{comparison.paragraph}</p>
        )}
      </div>

      {/* Technical health (Lighthouse) — supports the Page Performance signal */}
      {(your.lighthouse || comp.lighthouse) && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-gray-500">Technical health</h3>
          <div className="mb-3 grid grid-cols-[1fr_auto_1fr] text-xs font-semibold uppercase tracking-wide text-gray-400">
            <span className="text-right">You</span><span className="w-16 text-center sm:w-28">Metric</span><span>Partner</span>
          </div>
          <div className="space-y-3">
            <HealthBar label="Performance" you={your.lighthouse?.performance} comp={comp.lighthouse?.performance} />
            <HealthBar label="SEO" you={your.lighthouse?.seo} comp={comp.lighthouse?.seo} />
            <HealthBar label="Accessibility" you={your.lighthouse?.accessibility} comp={comp.lighthouse?.accessibility} />
            <HealthBar label="Best Practices" you={your.lighthouse?.bestPractices} comp={comp.lighthouse?.bestPractices} />
          </div>
          <p className="mt-3 text-center text-xs text-gray-400">Google Lighthouse scores (0–100). Higher is better; the stronger side shows in green.</p>
        </div>
      )}

      {/* Captured screenshots */}
      {(data.mobileShot || data.desktopShot || data.competitorShot) && (
        <div className={`grid grid-cols-1 gap-4 ${comp2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          <Shot title={data.company || "Your site"} url={data.url} shot={data.mobileShot || data.desktopShot} tone="you" />
          <Shot title={hostOf(data.competitorUrl) || "Competitor"} url={data.competitorUrl} shot={data.competitorShot} tone="comp" />
          {comp2 && <Shot title={hostOf(data.competitorUrl2) || "Competitor 2"} url={data.competitorUrl2} shot={data.competitor2Shot} tone="comp2" />}
        </div>
      )}

      {/* 4. Top 3 AI Opportunities */}
      {opportunities.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
            <Sparkles size={18} className="text-indigo-500" /> Top 3 AI Opportunities
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {opportunities.slice(0, 3).map((o, i) => (
              <div key={i} className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                  <TrendingUp size={16} />
                </div>
                <p className="text-sm font-medium text-gray-800">{o}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Premium Report CTA — print falls back to dark-on-light so it stays
          legible even if the PDF drops the dark gradient background. */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-900 p-6 text-white shadow-lg print:bg-none print:bg-white print:text-gray-900">
        <h3 className="flex items-center justify-center gap-2 text-center text-xl font-bold print:text-gray-900">
          <Lock size={20} /> Unlock Your Complete AI Visibility Report
        </h3>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-white/70 print:text-gray-600">
          Your free analysis provides a snapshot of your AI readiness. Book a strategy session to receive:
        </p>
        <ul className="mx-auto mt-4 grid max-w-xl grid-cols-1 gap-2 text-sm text-white/90 sm:grid-cols-2 print:text-gray-800">
          {[
            "Complete AI Visibility Audit",
            "Competitor Gap Analysis",
            "GEO/AEO Strategy",
            "AI Citation Opportunities",
            "Personalized Action Plan",
          ].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400 print:text-emerald-600" /> {f}
            </li>
          ))}
        </ul>
        {onBookMeeting && (
          <div className="mt-5 text-center print:hidden">
            <button
              onClick={onBookMeeting}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-2.5 text-sm font-bold text-indigo-900 shadow hover:bg-indigo-50"
            >
              <CalendarClock size={16} /> Book a Strategy Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function hostOf(u?: string | null) {
  if (!u) return "";
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
