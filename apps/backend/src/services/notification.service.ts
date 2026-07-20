import { prisma } from "@elc/db";
import { setting } from "./settings.service";
import { whatsAppService } from "./whatsapp.service";
import { emailService } from "./email.service";
import { syncLeadToSheet } from "./sheets.service";
import { playLink } from "../utils/play-link";

// ── Field extraction (tolerant of camelCase / snake_case form keys) ──
const NAME_KEYS = ["contactPerson", "contact_person", "name", "fullName", "full_name", "contactName"];
const COMPANY_KEYS = ["companyName", "company_name", "company", "organization"];
const PHONE_KEYS = ["mobileNumber", "mobile_number", "phone", "phoneNumber", "phone_number", "mobile"];
const EMAIL_KEYS = ["email", "emailAddress", "email_address"];

function pick(data: Record<string, any> | null | undefined, keys: string[]): string {
  if (!data) return "";
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

interface ChannelConfig {
  sessionId?: string; // WhatsApp only — which OpenWA session to use
  welcomeEnabled?: boolean;
  reportEnabled?: boolean;
  welcomeTemplate?: string;
  reportTemplate?: string;
  subject?: string; // Email only
}

const DEFAULT_WELCOME =
  "Hi {name}! Thanks for visiting {event}. We've received your details and our team will get in touch soon.";
const DEFAULT_REPORT = "Here's what we captured:\nName: {name}\nCompany: {company}";

// Email gets a longer, signed follow-up by default (WhatsApp stays short above).
const DEFAULT_EMAIL_WELCOME = `Hi {name},

You walked into {event} today. We are glad you did.

Thank you for taking the time to stop by and have a conversation with us. In a room full of people moving fast, that meant something.

Whatever we spoke about at the stall, that conversation does not have to end there.

A quick 30-minute call is all it takes to figure out if there is something here worth building together. No pressure, no pitch deck, just a straight conversation.

Whenever you are ready, I am here.

Akshay Narvekar
Rath Infotech and Web Solutions
sales@rathinfotech.com
+91 727 727 1 727
rathinfotech.com`;

const DEFAULT_EMAIL_SUBJECT = "Great meeting you at {event}, {name}";

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

// Fire notifications for a freshly captured lead. The "visitor" who submitted
// the form is our client, so the welcome message + lead report are sent to that
// visitor (phone for WhatsApp, email for Email) on every enabled channel.
// Safe to call fire-and-forget; all failures are logged and swallowed.
export async function notifyLeadReceived(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { event: { select: { id: true, name: true } } },
  });
  if (!lead) return;

  // Push the lead to the Google Sheet (best-effort, independent of email/WA).
  void syncLeadToSheet(lead.id).catch(() => {});

  const configs = await prisma.notificationConfig.findMany({
    where: { eventId: lead.eventId, isActive: true },
  });

  const data = (lead.rawFormData ?? {}) as Record<string, any>;
  const vars = {
    name: pick(data, NAME_KEYS) || "there",
    company: pick(data, COMPANY_KEYS),
    event: lead.event.name,
    link: lead.playToken ? playLink(lead.playToken) : "",
  };
  const sessionId = setting("OPENWA_SESSION_ID") || "default";
  const visitorPhone = pick(data, PHONE_KEYS);
  const visitorEmail = pick(data, EMAIL_KEYS);
  if (!visitorPhone && !visitorEmail) return; // nowhere to send

  // Track whether an explicit config handled each channel; if not, we fall back
  // to a sensible default below (so email/WhatsApp still go out with zero setup).
  let emailWelcomeSent = false;
  let waHandled = false;

  for (const cfg of configs) {
    const triggers = (cfg.events as string[] | null) ?? [];
    if (!triggers.includes("LEAD_RECEIVED")) continue;
    const c = (cfg.config ?? {}) as ChannelConfig;
    if (cfg.channel === "WHATSAPP") waHandled = true;

    if (cfg.channel === "WHATSAPP" && visitorPhone) {
      const chatId = whatsAppService.toChatId(visitorPhone);
      const sid = await whatsAppService
        .resolveSessionId(c.sessionId || sessionId)
        .catch(() => c.sessionId || sessionId);
      if (c.welcomeEnabled !== false) {
        const text = render(c.welcomeTemplate || DEFAULT_WELCOME, vars);
        await whatsAppService
          .sendText(sid, chatId, text)
          .catch((e) => console.error("[whatsapp] welcome failed:", (e as Error)?.message));
      }
      if (c.reportEnabled !== false) {
        const text = render(c.reportTemplate || DEFAULT_REPORT, vars);
        await whatsAppService
          .sendText(sid, chatId, text)
          .catch((e) => console.error("[whatsapp] report failed:", (e as Error)?.message));
      }
    }

    if (cfg.channel === "EMAIL" && visitorEmail) {
      const subject = render(c.subject || DEFAULT_EMAIL_SUBJECT, vars);
      const parts: string[] = [];
      const includeWelcome = c.welcomeEnabled !== false;
      if (includeWelcome) parts.push(render(c.welcomeTemplate || DEFAULT_EMAIL_WELCOME, vars));
      // Report is opt-in for email — the welcome already reads as a full signed
      // message; appending a "captured fields" block would look odd.
      if (c.reportEnabled === true) parts.push(render(c.reportTemplate || DEFAULT_REPORT, vars));
      if (parts.length) {
        await emailService
          .sendEmail(visitorEmail, subject, parts.join("\n\n"))
          .catch((e) => console.error("[email] notification failed:", (e as Error)?.message));
        if (includeWelcome) emailWelcomeSent = true;
      }
    }
  }

  // ── Defaults when no config exists for a channel ──
  // Booth "just works": a visitor with an email always gets the welcome (with
  // their game link), even if no Email automation was configured for the event.
  // Welcome email always goes out — if no active config sent one, send the
  // default. (Automatic; needs no Automation setup.)
  if (!emailWelcomeSent && visitorEmail && emailService.isEmailConfigured()) {
    await emailService
      .sendEmail(visitorEmail, render(DEFAULT_EMAIL_SUBJECT, vars), render(DEFAULT_EMAIL_WELCOME, vars))
      .catch((e) => console.error("[email] default welcome failed:", (e as Error)?.message));
  }
  if (!waHandled && visitorPhone && setting("OPENWA_BASE_URL") && setting("OPENWA_API_KEY")) {
    const chatId = whatsAppService.toChatId(visitorPhone);
    const sid = await whatsAppService.resolveSessionId(sessionId).catch(() => sessionId);
    await whatsAppService
      .sendText(sid, chatId, render(DEFAULT_WELCOME, vars))
      .catch((e) => console.error("[whatsapp] default notification failed:", (e as Error)?.message));
  }
}
