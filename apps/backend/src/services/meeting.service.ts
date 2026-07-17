import { prisma } from "@elc/db";
import { emailService } from "./email.service";
import { buildMeetingEmail, buildMeetingNotice } from "./email-templates.service";
import { setting } from "./settings.service";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtMeetingDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return `${day} ${MONTHS[m - 1]} ${y}`;
}
export function fmtMeetingTime(t: string): string {
  const [hRaw, mn] = t.split(":").map(Number);
  if (hRaw == null || mn == null) return t;
  const ap = hRaw >= 12 ? "PM" : "AM";
  const h = hRaw % 12 || 12;
  return `${h}:${String(mn).padStart(2, "0")} ${ap}`;
}

interface LeadForMeeting {
  id: string;
  rawFormData: unknown;
  event?: { name: string } | null;
}

// Records the meeting on the lead and emails the visitor + our sales inbox.
// Shared by the public (play token) and staff (lead id) flows.
export async function bookMeeting(lead: LeadForMeeting, date: string, time: string, note?: string) {
  const d = (lead.rawFormData ?? {}) as Record<string, any>;
  const name = d.contact_person ?? d.contactPerson ?? d.name ?? d.full_name ?? "";
  const company = d.company_name ?? d.companyName ?? d.company ?? "";
  const email = d.email ?? d.emailAddress ?? d.email_address ?? "";
  const phone = d.mobile_number ?? d.mobileNumber ?? d.phone ?? d.phone_number ?? d.mobile ?? "";

  const datetime = `${fmtMeetingDate(date)} at ${fmtMeetingTime(time)}`;
  const meetingAt = new Date(`${date}T${time}:00`);

  await prisma.lead.update({
    where: { id: lead.id },
    data: { meetingAt: isNaN(meetingAt.getTime()) ? null : meetingAt },
  });

  if (emailService.isEmailConfigured()) {
    if (email) {
      void emailService
        .sendEmail(email, "Your meeting with Rath Infotech is confirmed", buildMeetingEmail({ name, company, datetime }))
        .catch((e) => console.error("[meeting] visitor email failed:", (e as Error)?.message));
    }
    const notify = setting("MEETING_NOTIFY_EMAIL") || "sales@rathinfotech.com";
    void emailService
      .sendEmail(
        notify,
        `New meeting: ${name || company || "visitor"} — ${datetime}`,
        buildMeetingNotice({ name, company, email, phone, datetime, note: note ?? "", event: lead.event?.name }),
      )
      .catch((e) => console.error("[meeting] notify email failed:", (e as Error)?.message));
  }

  return { datetime, emailed: Boolean(email) };
}
