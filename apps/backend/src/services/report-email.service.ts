import { prisma } from "@elc/db";
import { emailService } from "./email.service";
import { reportLink } from "../utils/play-link";
import { buildReportEmail } from "./email-templates.service";

// Manually (re)send the game result report(s) for a lead — used when the
// automatic result email didn't go out. Sends to the email on the lead's form.
export async function sendReportsForLead(
  leadId: string,
): Promise<{ sent: number; email: string | null; sentCount?: number; reason?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { playToken: true, rawFormData: true },
  });
  if (!lead?.playToken) return { sent: 0, email: null, reason: "No game session for this lead" };

  const d = (lead.rawFormData ?? {}) as Record<string, any>;
  const email: string | null = d.email ?? d.emailAddress ?? d.email_address ?? null;
  if (!email) return { sent: 0, email: null, reason: "No email captured on this lead" };
  if (!emailService.isEmailConfigured()) return { sent: 0, email, reason: "Email is not configured" };

  const games = await prisma.gameResult.findMany({
    where: { playToken: lead.playToken, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });

  let sent = 0;
  for (const g of games) {
    try {
      // Only the AI report email is (re)sent — calculator results are not emailed.
      if (g.gameType === "AI_SCORE" && g.refId) {
        const a = await prisma.websiteAnalysis.findUnique({ where: { id: g.refId } });
        if (a && a.status === "COMPLETED") {
          await emailService.sendEmail(email, "Your AI Visibility report is ready", scoreEmailText(a));
          sent++;
        }
      }
    } catch (e) {
      console.error("[report-email] send failed:", (e as Error)?.message);
    }
  }

  // Count one send per action (a click that emailed ≥1 report bumps the counter).
  let sentCount: number | undefined;
  if (sent > 0) {
    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { reportsSentCount: { increment: 1 } },
      select: { reportsSentCount: true },
    });
    sentCount = updated.reportsSentCount;
  }

  return { sent, email, sentCount, reason: sent === 0 ? "No completed game result to send" : undefined };
}

function scoreEmailText(a: any): string {
  const au = a.audit ?? {};
  // AI Visibility report — score reads like "82 (B)".
  const fmt = (s: any) => (s ? `${s.score ?? "—"} (${s.grade ?? "—"})` : "—");
  return buildReportEmail({
    yourScore: fmt(au.your),
    competitorScore: fmt(au.competitor),
    reasoning: au.comparison?.paragraph ?? au.verdict?.reasoning ?? "",
    da: "—",
    pa: "—",
    referringDomains: "—",
    backlinks: "—",
    keywords: "—",
    traffic: "—",
    reportLink: reportLink(a.id),
  });
}

