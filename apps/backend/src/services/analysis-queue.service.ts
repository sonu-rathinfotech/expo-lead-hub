import { prisma } from "@elc/db";
import { env } from "../config/env";
import { getPageAnalyzer, getLighthouseAnalyzer } from "./page-analyzer.service";
import { generateRoast } from "./ai-roast.service";
import { gatherSignals, buildSiteVisibility, generateVisibilityReport } from "./ai-visibility.service";
import { fetchAiMentions, aiMentionsEnabled } from "./dataforseo.service";
import { emailService } from "./email.service";
import { buildReportEmail } from "./email-templates.service";
import { reportLink } from "../utils/play-link";
import { alertOwnerOnKeyError } from "./owner-alert.service";
import type { VisibilityReport } from "./ai-visibility.service";

// In-process job queue for website analyses. Up to AI_CONCURRENCY run at once;
// additional requests wait in line. Keeps a busy booth from overloading the
// AI provider (and hitting its rate limits) when several people play at once.
// A job with `competitorUrl` runs the head-to-head Score Game; otherwise it
// runs the (legacy) single-site roast.

interface Job {
  analysisId: string;
  url: string;
  competitorUrl?: string;
  competitorUrl2?: string; // optional 2nd competitor (additive, Phase 3.2)
  company?: string;
  email?: string; // where to email the finished report (public play sessions)
  playToken?: string; // links this analysis to a visitor's GameResult row
}

// Email the finished report to the visitor (public play sessions only).
async function emailReport(job: Job, result: VisibilityReport) {
  if (!job.email || !emailService.isEmailConfigured()) return;

  const body = buildReportEmail({
    yourScore: `${result.your?.score ?? "—"} (${result.your?.grade ?? "—"})`,
    competitorScore: `${result.competitor?.score ?? "—"} (${result.competitor?.grade ?? "—"})`,
    reasoning: result.comparison?.paragraph ?? "",
    // AI Visibility report doesn't fetch domain-authority metrics — leave blank.
    da: "—",
    pa: "—",
    referringDomains: "—",
    backlinks: "—",
    keywords: "—",
    traffic: "—",
    reportLink: reportLink(job.analysisId),
  });

  await emailService
    .sendEmail(job.email, "Your AI Visibility report is ready", body)
    .then(async () => {
      // Reflect the auto-send in the lead's "Sent" counter (Leads list).
      if (job.playToken) {
        await prisma.lead
          .updateMany({ where: { playToken: job.playToken }, data: { reportsSentCount: { increment: 1 } } })
          .catch(() => {});
      }
    })
    .catch((e) => console.error("[score] result email failed:", (e as Error)?.message));
}

// Keep the visitor's GameResult row (TV + email use it) in sync with the job.
async function syncGameResult(job: Job, status: "COMPLETED" | "FAILED", error?: string) {
  if (!job.playToken) return;
  await prisma.gameResult
    .updateMany({
      where: { playToken: job.playToken, gameType: "AI_SCORE", refId: job.analysisId },
      data: { status, ...(error ? { error: error.slice(0, 500) } : {}) },
    })
    .catch(() => {});
}

// Retry a transient-failing AI call (429/503/overloaded) with backoff.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const retryable = /429|503|Too Many Requests|Service Unavailable|overloaded/i.test(
        String(e?.message || ""),
      );
      if (!retryable || attempt === RETRY_DELAYS.length) throw e;
      await sleep(RETRY_DELAYS[attempt]!);
    }
  }
  throw lastErr;
}

const queue: Job[] = [];
let active = 0;
const MAX = env.AI_CONCURRENCY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY_DELAYS = [2000, 5000, 12000]; // backoff for transient AI errors
const SCORE_DEADLINE_MS = 90_000; // spec: each analysis takes ≤ 90 seconds

// Reject if `p` doesn't settle within `ms`. Keeps a single analysis inside the
// 90-second booth budget even if a provider hangs.
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s time budget`)), ms),
    ),
  ]);
}

export function enqueueAnalysis(job: Job) {
  queue.push(job);
  pump();
}

export function queueInfo() {
  return { waiting: queue.length, active, max: MAX };
}

function pump() {
  while (active < MAX && queue.length > 0) {
    const job = queue.shift()!;
    active++;
    void runJob(job).finally(() => {
      active--;
      pump();
    });
  }
}

async function runJob(job: Job) {
  try {
    await prisma.websiteAnalysis.update({
      where: { id: job.analysisId },
      data: { status: "PROCESSING" },
    });

    if (job.competitorUrl) {
      // ── AI Visibility Report: how discoverable/understandable each site is to
      // AI assistants. Lighthouse captures + real AI-visibility signal checks
      // (llms.txt / robots.txt / structured data / content) run in parallel for
      // every site, then one Gemini call writes the prose. Scores are computed
      // deterministically here. The whole thing is capped at the 90s budget.
      const has2 = Boolean(job.competitorUrl2);
      // Paid AI-citation check (LLM Mentions) — capped to you + competitor only
      // (never competitor2) so a busy booth's spend stays bounded. Degrade-safe.
      const withAiMentions = aiMentionsEnabled();
      const scoredComparison = async () => {
        const [you, competitor, competitor2, youSig, compSig, comp2Sig, youMentions, compMentions] = await Promise.all([
          getLighthouseAnalyzer().analyze(job.url),
          getLighthouseAnalyzer().analyze(job.competitorUrl!),
          has2 ? getLighthouseAnalyzer().analyze(job.competitorUrl2!) : Promise.resolve(undefined),
          gatherSignals(job.url),
          gatherSignals(job.competitorUrl!),
          has2 ? gatherSignals(job.competitorUrl2!) : Promise.resolve(undefined),
          withAiMentions ? fetchAiMentions(job.url).catch(() => null) : Promise.resolve(null),
          withAiMentions ? fetchAiMentions(job.competitorUrl!).catch(() => null) : Promise.resolve(null),
        ]);
        const youViz = buildSiteVisibility(you, youSig);
        const compViz = buildSiteVisibility(competitor, compSig);
        const comp2Viz = competitor2 && comp2Sig ? buildSiteVisibility(competitor2, comp2Sig) : undefined;
        const result = await withRetry(() => generateVisibilityReport(youViz, compViz, comp2Viz));
        return { you, competitor, competitor2, result, youMentions, compMentions };
      };

      const { you, competitor, competitor2, result, youMentions, compMentions } = await withDeadline(
        scoredComparison(),
        SCORE_DEADLINE_MS,
        "Analysis",
      );

      await prisma.websiteAnalysis.update({
        where: { id: job.analysisId },
        data: {
          status: "COMPLETED",
          url: you.finalUrl,
          competitorUrl: competitor.finalUrl,
          competitorUrl2: competitor2?.finalUrl ?? null,
          title: you.title ?? null,
          description: you.description ?? null,
          desktopShot: you.desktopShot ?? null,
          mobileShot: you.mobileShot ?? null,
          competitorShot: competitor.mobileShot ?? competitor.desktopShot ?? null,
          competitor2Shot: competitor2 ? competitor2.mobileShot ?? competitor2.desktopShot ?? null : null,
          // AI-citation presence (LLM Mentions) rides alongside the report.
          audit: { ...result, aiMentions: { your: youMentions, competitor: compMentions } } as any,
        },
      });
      await syncGameResult(job, "COMPLETED");
      void emailReport(job, result); // fire-and-forget the result email
      return;
    }

    // ── Legacy single-site roast ──
    const capture = await getPageAnalyzer().analyze(job.url);
    const ai = await withRetry(() => generateRoast(capture));

    await prisma.websiteAnalysis.update({
      where: { id: job.analysisId },
      data: {
        status: "COMPLETED",
        url: capture.finalUrl,
        title: capture.title ?? null,
        description: capture.description ?? null,
        desktopShot: capture.desktopShot ?? null,
        mobileShot: capture.mobileShot ?? null,
        roast: ai.roast as any,
        audit: { ...ai.audit, lighthouse: capture.scores } as any,
        suggestions: ai.suggestions as any,
      },
    });
  } catch (e: any) {
    await prisma.websiteAnalysis
      .update({
        where: { id: job.analysisId },
        data: { status: "FAILED", error: String(e?.message || "Analysis failed").slice(0, 500) },
      })
      .catch(() => {});
    const msg = String(e?.message || "Analysis failed");
    await syncGameResult(job, "FAILED", msg);
    void alertOwnerOnKeyError("AI Score analysis", msg);
  }
}
