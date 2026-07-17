import { useEffect, useState } from "react";
import { Trophy, Crown, Sparkles, Monitor, Download } from "lucide-react";
import { ScoreRing, scoreColor } from "./ScoreRing";

const YOU_COLOR = "#10b981"; // emerald
const COMP_COLOR = "#f43f5e"; // rose
const COMP2_COLOR = "#f59e0b"; // amber

// ── Radar (spider) chart — you vs competitor across the AI dimensions ──
function RadarChart({
  axes,
  series,
  size = 260,
}: {
  axes: string[];
  series: { label: string; color: string; values: number[] }[];
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 42;
  const n = axes.length;
  const angle = (i: number) => (-90 + (i * 360) / n) * (Math.PI / 180);
  const pt = (i: number, v: number) => {
    const r = (R * Math.max(0, Math.min(100, v))) / 100;
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  };
  const poly = (values: number[]) => values.map((v, i) => pt(i, v).join(",")).join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-[300px]">
      {/* grid rings */}
      {[25, 50, 75, 100].map((ring) => (
        <polygon
          key={ring}
          points={axes.map((_, i) => pt(i, ring).join(",")).join(" ")}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={1}
        />
      ))}
      {/* spokes */}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth={1} />;
      })}
      {/* series polygons */}
      {series.map((s, si) => (
        <polygon key={si} points={poly(s.values)} fill={s.color} fillOpacity={0.18} stroke={s.color} strokeWidth={2} />
      ))}
      {/* axis labels */}
      {axes.map((label, i) => {
        const [x, y] = pt(i, 118);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-gray-500 text-[10px] font-semibold uppercase"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

interface SiteScore {
  overallScore?: number;
  ui?: number;
  ux?: number;
  seo?: number;
  conversion?: number;
  llmScore?: number;
  summary?: string;
  lighthouse?: { performance?: number | null; seo?: number | null; accessibility?: number | null; bestPractices?: number | null };
}

interface DomainMetrics {
  da?: number | null;
  pa?: number | null;
  keywordCount?: number | null;
  organicTraffic?: number | null;
  referringDomains?: number | null;
  backlinks?: number | null;
  topKeywords?: string[];
}

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
    your?: SiteScore;
    competitor?: SiteScore;
    competitor2?: SiteScore;
    verdict?: { winner?: "you" | "competitor" | "competitor2" | "tie"; perCategory?: Array<{ key: string; youWin: boolean; note: string }>; reasoning?: string };
    metrics?: { your?: DomainMetrics | null; competitor?: DomainMetrics | null; competitor2?: DomainMetrics | null } | null;
    competitors?: { domain: string; sharedKeywords?: number | null }[] | null;
  } | null;
  suggestions?: {
    heroHeadline?: string;
    cta?: string;
    colorPalette?: string[];
    trustElements?: string[];
    missingSections?: string[];
    conversion?: string[];
    mobile?: string[];
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

function BigScore({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const v = useCountUp(value);
  return (
    <div className={`flex flex-1 flex-col items-center rounded-2xl border p-5 ${highlight ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
      {highlight && <Crown className="mb-1 text-amber-500" size={20} />}
      <div style={{ color: scoreColor(value) }}>
        <ScoreRing value={v} size={128} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-gray-800" title={label}>{label}</p>
    </div>
  );
}

function MetricsCol({ title, m, accent }: { title: string; m: DomainMetrics | null; accent: string }) {
  const stat = (label: string, val: number | null | undefined) => (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold ${accent}`}>{val == null ? "–" : val.toLocaleString()}</span>
    </div>
  );
  return (
    <div>
      <p className="mb-2 truncate text-sm font-semibold text-gray-800" title={title}>{title}</p>
      <div className="space-y-1.5">
        {stat("Domain Authority", m?.da)}
        {stat("Page Authority", m?.pa)}
        {stat("Referring domains", m?.referringDomains)}
        {stat("Backlinks", m?.backlinks)}
        {stat("Ranking keywords", m?.keywordCount)}
        {stat("Est. organic traffic", m?.organicTraffic)}
      </div>
      {m?.topKeywords && m.topKeywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.topKeywords.slice(0, 5).map((k, i) => (
            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Darker, print-legible shades for the score numbers (the bar keeps the
// brighter scoreColor). Light amber text was near-invisible on white before.
function scoreTextColor(v?: number | null) {
  if (v == null) return "#6b7280";
  if (v >= 90) return "#15803d"; // green-700
  if (v >= 50) return "#b45309"; // amber-700
  return "#b91c1c"; // red-700
}

function Bar({ label, you, comp }: { label: string; you?: number; comp?: number }) {
  const y = you ?? 0;
  const c = comp ?? 0;
  const youWins = y > c;
  const compWins = c > y;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
      <div className="flex items-center justify-end gap-2">
        <span className="font-bold tabular-nums" style={{ color: scoreTextColor(you) }}>{you ?? "–"}</span>
        <div className={`h-2.5 w-24 overflow-hidden rounded-full bg-gray-100 ${compWins ? "opacity-50" : ""}`}>
          <div className="ml-auto h-full rounded-full" style={{ width: `${y}%`, backgroundColor: scoreColor(you), marginLeft: "auto", float: "right" }} />
        </div>
      </div>
      <span className="w-24 text-center text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <div className={`h-2.5 w-24 overflow-hidden rounded-full bg-gray-100 ${youWins ? "opacity-50" : ""}`}>
          <div className="h-full rounded-full" style={{ width: `${c}%`, backgroundColor: scoreColor(comp) }} />
        </div>
        <span className="font-bold tabular-nums" style={{ color: scoreTextColor(comp) }}>{comp ?? "–"}</span>
      </div>
    </div>
  );
}

export function ScoreReport({ data }: { data: Comparison }) {
  const your = data.audit?.your ?? {};
  const comp = data.audit?.competitor ?? {};
  const verdict = data.audit?.verdict ?? {};
  const sug = data.suggestions ?? {};
  const youWin = verdict.winner === "you";
  const tie = verdict.winner === "tie";
  const lh = your.lighthouse ?? {};
  const clh = comp.lighthouse ?? {};
  const comp2 = data.audit?.competitor2 ?? null;
  const myMetrics = data.audit?.metrics?.your ?? null;
  const compMetrics = data.audit?.metrics?.competitor ?? null;
  const comp2Metrics = data.audit?.metrics?.competitor2 ?? null;
  const competitors = data.audit?.competitors ?? [];

  // Who this report is for — drives the header + the saved PDF filename.
  const who = data.company || hostOf(data.url) || "Website Audit";

  const downloadPdf = () => {
    const prev = document.title;
    const date = new Date().toISOString().slice(0, 10);
    // Browsers use document.title as the default "Save as PDF" filename, so
    // name it after the client/company instead of the app title.
    document.title = `Website Audit — ${who} — ${date}`;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 1500); // fallback if afterprint doesn't fire
  };

  const radarAxes = ["UI", "UX", "SEO", "Conv", "AI"];
  const radarSeries = [
    { label: hostOf(data.url) || "You", color: YOU_COLOR, values: [your.ui ?? 0, your.ux ?? 0, your.seo ?? 0, your.conversion ?? 0, your.llmScore ?? 0] },
    { label: hostOf(data.competitorUrl) || "Partner", color: COMP_COLOR, values: [comp.ui ?? 0, comp.ux ?? 0, comp.seo ?? 0, comp.conversion ?? 0, comp.llmScore ?? 0] },
  ];
  if (comp2)
    radarSeries.push({
      label: hostOf(data.competitorUrl2) || "Partner 2",
      color: COMP2_COLOR,
      values: [comp2.ui ?? 0, comp2.ux ?? 0, comp2.seo ?? 0, comp2.conversion ?? 0, comp2.llmScore ?? 0],
    });

  return (
    <div
      data-report
      className="space-y-6 antialiased [font-variant-numeric:tabular-nums] [-webkit-font-smoothing:antialiased]"
      style={{
        fontFamily:
          '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* Report header — identifies whose audit this is (on screen + in the PDF).
          Only the download button is hidden when printing. */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-500">Website Audit Report</p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-gray-900" title={who}>{who}</h1>
          <p className="mt-0.5 truncate text-sm text-gray-500">{hostOf(data.url) || data.url}</p>
        </div>
        <button
          onClick={downloadPdf}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 print:hidden"
        >
          <Download size={16} /> Download PDF
        </button>
      </div>

      {/* Verdict banner */}
      <div className={`rounded-2xl p-6 text-center text-white shadow-lg ${youWin ? "bg-gradient-to-r from-emerald-500 to-teal-600" : tie ? "bg-gradient-to-r from-slate-500 to-slate-700" : "bg-gradient-to-r from-orange-500 to-rose-600"}`}>
        <Trophy className="mx-auto mb-1.5" size={26} />
        <h2 className="text-2xl font-bold tracking-tight">
          {youWin ? "Your site leads" : tie ? "It's a close call" : "How your site compares"}
        </h2>
        <p className="mx-auto mt-0.5 text-xs font-medium uppercase tracking-wide text-white/70">
          {who} vs {hostOf(data.competitorUrl) || "partner"}
        </p>
        <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-relaxed text-white/80">{verdict.reasoning}</p>
      </div>

      {/* Big scores head-to-head */}
      <div className="flex flex-col items-stretch gap-4 sm:flex-row">
        <BigScore label={data.company || hostOf(data.url) || "Your site"} value={your.overallScore ?? 0} highlight={youWin} />
        <div className="flex items-center justify-center px-2 text-lg font-black text-gray-400">VS</div>
        <BigScore label={hostOf(data.competitorUrl) || "Partner"} value={comp.overallScore ?? 0} highlight={verdict.winner === "competitor"} />
        {comp2 && (
          <>
            <div className="flex items-center justify-center px-2 text-lg font-black text-gray-400">VS</div>
            <BigScore label={hostOf(data.competitorUrl2) || "Partner 2"} value={comp2.overallScore ?? 0} highlight={verdict.winner === "competitor2"} />
          </>
        )}
      </div>

      {/* What the score means */}
      <p className="text-center text-xs leading-relaxed text-gray-500">
        Overall score is out of 100 — <span className="font-semibold text-emerald-600">90–100 Excellent</span>,{" "}
        <span className="font-semibold text-amber-600">50–89 Good</span>,{" "}
        <span className="font-semibold text-rose-600">below 50 Needs work</span>. It blends design, UX, SEO, conversion &amp; AI-search; the higher score wins.
      </p>

      {/* Radar + category comparison */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        {/* Radar */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">At a glance</h3>
          <RadarChart axes={radarAxes} series={radarSeries} />
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {radarSeries.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Category comparison */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 grid grid-cols-[1fr_auto_1fr] text-xs font-semibold uppercase tracking-wide text-gray-400">
            <span className="text-right">You</span><span className="w-24 text-center">Metric</span><span>Partner</span>
          </div>
          <div className="space-y-3">
            <Bar label="UI" you={your.ui} comp={comp.ui} />
            <Bar label="UX" you={your.ux} comp={comp.ux} />
            <Bar label="SEO" you={your.seo} comp={comp.seo} />
            <Bar label="Conversion" you={your.conversion} comp={comp.conversion} />
            {(your.llmScore != null || comp.llmScore != null) && <Bar label="AI Search" you={your.llmScore} comp={comp.llmScore} />}
            {(lh.performance != null || clh.performance != null) && <Bar label="Performance" you={lh.performance ?? undefined} comp={clh.performance ?? undefined} />}
            {(lh.accessibility != null || clh.accessibility != null) && <Bar label="Accessibility" you={lh.accessibility ?? undefined} comp={clh.accessibility ?? undefined} />}
            {(lh.bestPractices != null || clh.bestPractices != null) && <Bar label="Best Practices" you={lh.bestPractices ?? undefined} comp={clh.bestPractices ?? undefined} />}
          </div>
          <p className="mt-3 text-center text-xs text-gray-400">
            The stronger side shows in full colour. UI / UX / Conversion are AI scores;
            <span className="font-medium"> AI Search</span> = how likely AI assistants (ChatGPT, Gemini) are to recommend the site;
            Performance / Accessibility are Lighthouse.
          </p>
        </div>
      </div>

      {/* Domain authority + keywords (DataForSEO) */}
      {(myMetrics || compMetrics) && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-gray-500">Domain authority &amp; keywords</h3>
          <div className={`grid gap-4 ${comp2 ? "grid-cols-3" : "grid-cols-2"}`}>
            <MetricsCol title={data.company || hostOf(data.url) || "Your site"} m={myMetrics} accent="text-emerald-600" />
            <MetricsCol title={hostOf(data.competitorUrl) || "Partner"} m={compMetrics} accent="text-rose-600" />
            {comp2 && <MetricsCol title={hostOf(data.competitorUrl2) || "Partner 2"} m={comp2Metrics} accent="text-rose-600" />}
          </div>
          <p className="mt-3 text-center text-xs text-gray-400">DA / PA are DataForSEO domain &amp; page ranks (0–1000). Keywords &amp; traffic are organic estimates.</p>
        </div>
      )}

      {/* Top organic competitors (DataForSEO) */}
      {competitors.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Your top organic competitors</h3>
          <div className="flex flex-wrap gap-2">
            {competitors.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm">
                <span className="font-medium text-gray-800">{c.domain}</span>
                {c.sharedKeywords != null && <span className="text-xs text-gray-500">{c.sharedKeywords} shared</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Summaries + screenshots */}
      <div className={`grid grid-cols-1 gap-4 ${comp2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <SiteCard title={data.company || "Your site"} url={data.url} shot={data.mobileShot || data.desktopShot} summary={your.summary} tone="emerald" />
        <SiteCard title="Partner" url={data.competitorUrl} shot={data.competitorShot} summary={comp.summary} tone="rose" />
        {comp2 && <SiteCard title="Partner 2" url={data.competitorUrl2} shot={data.competitor2Shot} summary={comp2.summary} tone="rose" />}
      </div>

      {/* Suggestions to win */}
      {data.suggestions && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
            <Sparkles size={18} className="text-indigo-500" /> How to beat them
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sug.heroHeadline && <Sg title="Stronger headline">{sug.heroHeadline}</Sg>}
            {sug.cta && <Sg title="Better CTA">{sug.cta}</Sg>}
            {sug.colorPalette && sug.colorPalette.length > 0 && (
              <div className="print:hidden">
                <Sg title="Suggested palette">
                  <div className="flex gap-1.5">
                    {sug.colorPalette.map((c, i) => <span key={i} className="h-7 w-7 rounded-md border border-gray-200" style={{ backgroundColor: c }} />)}
                  </div>
                </Sg>
              </div>
            )}
            {list(sug.trustElements, "Trust elements")}
            {list(sug.missingSections, "Missing sections")}
            {list(sug.conversion, "Conversion tips")}
            {list(sug.mobile, "Mobile tips")}
          </div>
        </div>
      )}
    </div>
  );
}

function SiteCard({ title, url, shot, summary, tone }: { title: string; url?: string | null; shot?: string | null; summary?: string; tone: "emerald" | "rose" }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className={`px-4 py-2 text-sm font-semibold text-white ${tone === "emerald" ? "bg-emerald-600" : "bg-rose-600"}`}>{title}</div>
      {shot ? (
        <img src={shot} alt="" className="max-h-64 w-full object-cover object-top" />
      ) : (
        <div className="flex h-40 items-center justify-center bg-gray-50 text-gray-300"><Monitor size={28} /></div>
      )}
      <div className="p-4">
        <p className="truncate text-xs text-gray-400">{url}</p>
        {summary && <p className="mt-1 text-sm text-gray-700">{summary}</p>}
      </div>
    </div>
  );
}

function Sg({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-500">{title}</p>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  );
}

function list(items: string[] | undefined, title: string) {
  if (!items || items.length === 0) return null;
  return (
    <Sg title={title}>
      <ul className="list-disc space-y-0.5 pl-4">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </Sg>
  );
}

function hostOf(u?: string | null) {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
