import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  MessageSquare,
  Loader2,
  Send,
  Trash2,
  CheckCircle2,
  XCircle,
  Plus,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api-client";

type Channel = "WHATSAPP" | "EMAIL";

interface NConfig {
  id: string;
  eventId: string;
  channel: string;
  isActive: boolean;
  config: Record<string, any>;
  events: string[];
}

const DEFAULTS: Record<Channel, { subject?: string; welcomeTemplate: string; reportTemplate: string }> = {
  WHATSAPP: {
    welcomeTemplate:
      "Hi {name}! Thanks for visiting {event}. We've received your details and our team will get in touch soon.",
    reportTemplate: "Here's what we captured:\nName: {name}\nCompany: {company}",
  },
  EMAIL: {
    subject: "Great meeting you at {event}, {name}",
    welcomeTemplate: `Hi {name},

You walked into {event} today. We are glad you did.

Thank you for taking the time to stop by and have a conversation with us. In a room full of people moving fast, that meant something.

Whatever we spoke about at the stall, that conversation does not have to end there.

A quick 30-minute call is all it takes to figure out if there is something here worth building together. No pressure, no pitch deck, just a straight conversation.

Whenever you are ready, I am here.

Akshay Narvekar
Rath Infotech and Web Solutions
sales@rathinfotech.com
+91 727 727 1 727
rathinfotech.com`,
    reportTemplate: "Here's what we captured:\nName: {name}\nCompany: {company}",
  },
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      <CheckCircle2 size={12} /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      <XCircle size={12} /> {label}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      {label}
    </label>
  );
}

function ChannelEditor({
  eventId,
  channel,
  config,
  onSaved,
  sessions,
}: {
  eventId: string;
  channel: Channel;
  config: NConfig | null;
  onSaved: () => void;
  sessions?: any[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    isActive: config?.isActive ?? true,
    welcomeEnabled: config?.config?.welcomeEnabled ?? true,
    reportEnabled: config?.config?.reportEnabled ?? channel !== "EMAIL",
    sessionId: config?.config?.sessionId ?? "",
    subject: config?.config?.subject ?? DEFAULTS.EMAIL.subject,
    welcomeTemplate: config?.config?.welcomeTemplate ?? DEFAULTS[channel].welcomeTemplate,
    reportTemplate: config?.config?.reportTemplate ?? DEFAULTS[channel].reportTemplate,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: any = {
        isActive: form.isActive,
        config: {
          welcomeEnabled: form.welcomeEnabled,
          reportEnabled: form.reportEnabled,
          welcomeTemplate: form.welcomeTemplate,
          reportTemplate: form.reportTemplate,
        },
        events: ["LEAD_RECEIVED"],
      };
      if (channel === "WHATSAPP") payload.config.sessionId = form.sessionId || undefined;
      if (channel === "EMAIL") payload.config.subject = form.subject;
      return config
        ? api.notifications.update(config.id, payload)
        : api.notifications.create({ eventId, channel, ...payload });
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["notifications", eventId] });
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Save failed"),
  });

  const remove = useMutation({
    mutationFn: () => api.notifications.remove(config!.id),
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["notifications", eventId] });
      onSaved();
    },
    onError: () => toast.error("Remove failed"),
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Toggle checked={form.isActive} onChange={(v) => set({ isActive: v })} label="Enabled" />
        <Toggle
          checked={form.welcomeEnabled}
          onChange={(v) => set({ welcomeEnabled: v })}
          label="Send welcome message"
        />
        <Toggle
          checked={form.reportEnabled}
          onChange={(v) => set({ reportEnabled: v })}
          label="Send lead report"
        />
      </div>

      {channel === "WHATSAPP" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">OpenWA Session</label>
          <select
            value={form.sessionId}
            onChange={(e) => set({ sessionId: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Default / first session</option>
            {(sessions ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id} — {s.status}
                {s.phone ? ` (${s.phone})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            The WhatsApp account (scanned into OpenWA) that sends the messages. Pick the authenticated session.
          </p>
        </div>
      )}

      {channel === "EMAIL" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email subject</label>
          <input
            value={form.subject}
            onChange={(e) => set({ subject: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Welcome template</label>
        <textarea
          rows={channel === "EMAIL" ? 16 : 3}
          value={form.welcomeTemplate}
          onChange={(e) => set({ welcomeTemplate: e.target.value })}
          className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Report template</label>
        <textarea
          rows={3}
          value={form.reportTemplate}
          onChange={(e) => set({ reportTemplate: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <p className="text-xs text-gray-400">
        Available placeholders: <code>{"{name}"}</code>, <code>{"{company}"}</code>, <code>{"{event}"}</code>. Messages
        are sent to the visitor's phone/email captured in the lead form.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        {config && (
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 size={16} /> Remove
          </button>
        )}
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {save.isPending && <Loader2 size={16} className="animate-spin" />}
          {config ? "Save changes" : "Enable"}
        </button>
      </div>
    </div>
  );
}

export function AutomationPage() {
  const qc = useQueryClient();
  const [eventId, setEventId] = useState<string>("");

  const eventsQuery = useQuery({
    queryKey: ["events-mini"],
    queryFn: async () => (await api.events.list({ take: 100 })).data,
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", eventId],
    queryFn: async () => (await api.notifications.list(eventId)).data,
    enabled: Boolean(eventId),
  });

  const waStatus = useQuery({
    queryKey: ["wa-status"],
    queryFn: async () => (await api.notifications.whatsappStatus()).data,
  });

  const emailStatus = useQuery({
    queryKey: ["email-status"],
    queryFn: async () => (await api.notifications.emailStatus()).data,
  });

  const testMutation = useMutation({
    mutationFn: (phone: string) =>
      api.notifications.whatsappTest({ phone, message: "Test message from Exhibition Lead Capture" }),
    onSuccess: () => toast.success("Test message sent"),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Test failed"),
  });

  const emailTestMutation = useMutation({
    mutationFn: (email: string) => api.notifications.emailTest({ email }),
    onSuccess: () => toast.success("Test email sent"),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Test failed"),
  });

  const events: { id: string; name: string }[] = eventsQuery.data?.events ?? [];

  // Default the selector to MMD 2026 (or the first event) once events load.
  useEffect(() => {
    if (!eventId && events.length) {
      const mmd = events.find((e) => /mmd\s*2026/i.test(e.name));
      setEventId(mmd?.id ?? events[0]!.id);
    }
  }, [events, eventId]);

  const configs: NConfig[] = notificationsQuery.data?.configs ?? [];
  const waConfig = configs.find((c) => c.channel === "WHATSAPP") ?? null;
  const emailConfig = configs.find((c) => c.channel === "EMAIL") ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Automation</h2>
          <p className="mt-1 text-sm text-gray-500">
            Notify your client (the visitor) with a welcome message and lead report on every captured lead.
          </p>
        </div>
        <select
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Select event…</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
      </div>

      {!eventId && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Select an event to configure its WhatsApp and Email automations.
        </div>
      )}

      {eventId && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* WhatsApp */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-900">WhatsApp</h3>
              <span className="ml-auto">
                {waStatus.isLoading ? (
                  <Loader2 size={14} className="animate-spin text-gray-400" />
                ) : (
                  <StatusBadge ok={Boolean(waStatus.data?.connected)} label={waStatus.data?.connected ? "Connected" : "Not connected"} />
                )}
              </span>
            </div>

            <div className="mb-4 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>OpenWA URL set</span>
                <StatusBadge ok={Boolean(waStatus.data?.baseUrlSet)} label={waStatus.data?.baseUrlSet ? "Yes" : "No"} />
              </div>
              <div className="flex justify-between">
                <span>API key set</span>
                <StatusBadge ok={Boolean(waStatus.data?.apiKeySet)} label={waStatus.data?.apiKeySet ? "Yes" : "No"} />
              </div>
              {waStatus.data?.baseUrl && (
                <div className="flex justify-between">
                  <span>Gateway</span>
                  <span className="font-mono text-gray-500">{waStatus.data.baseUrl}</span>
                </div>
              )}
              {Array.isArray(waStatus.data?.sessions) && waStatus.data.sessions.length > 0 && (
                <div className="pt-1">
                  <span>Sessions:</span>{" "}
                  {waStatus.data.sessions
                    .map((s: any) => `${s.name ?? s.id}${s.status ? ` (${s.status})` : ""}`)
                    .join(", ")}
                </div>
              )}
              {!waStatus.data?.configured && (
                <p className="pt-1 text-amber-600">
                  Set OPENWA_BASE_URL + OPENWA_API_KEY in the backend .env, then scan a session in the OpenWA
                  dashboard.
                </p>
              )}
            </div>

            {/* Session readiness indicator */}
            {(() => {
              const sessions: any[] = Array.isArray(waStatus.data?.sessions) ? waStatus.data.sessions : [];
              const active =
                sessions.find((s: any) => s.id === waConfig?.config?.sessionId) ??
                sessions.find(
                  (s: any) =>
                    s.status === "ready" || s.status === "authenticated" || s.status === "connected",
                ) ??
                sessions[0] ??
                null;
              const ready = Boolean(
                active &&
                  (active.status === "ready" ||
                    active.status === "authenticated" ||
                    active.status === "connected") &&
                  active.phone,
              );
              return (
                <div
                  className={`mb-4 flex items-center gap-2 rounded-lg p-3 text-sm ${
                    ready ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  <StatusBadge ok={ready} label={ready ? "Ready" : "Not ready"} />
                  {ready ? (
                    <span>
                      Sending from <b>{active.phone}</b> (session “{active.name || active.id}”).
                    </span>
                  ) : active ? (
                    <span>
                      Session “{active.name || active.id}” is <b>{active.status}</b> — scan its QR in OpenWA to
                      authenticate before messages can send.
                    </span>
                  ) : (
                    <span>No OpenWA session yet — create one in the OpenWA dashboard and scan the QR.</span>
                  )}
                </div>
              );
            })()}

            <div className="mb-3">
              <button
                onClick={() => {
                  const phone = window.prompt("Send a test WhatsApp to this number (with country code, no +):");
                  if (phone) testMutation.mutate(phone.trim());
                }}
                disabled={testMutation.isPending || !waStatus.data?.configured}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Send size={14} /> Send test
              </button>
            </div>

            <ChannelEditor eventId={eventId} channel="WHATSAPP" config={waConfig} sessions={waStatus.data?.sessions} onSaved={() => qc.invalidateQueries({ queryKey: ["notifications", eventId] })} />
          </section>

          {/* Email */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Email</h3>
              <span className="ml-auto">
                {emailStatus.isLoading ? (
                  <Loader2 size={14} className="animate-spin text-gray-400" />
                ) : (
                  <StatusBadge ok={Boolean(emailStatus.data?.configured)} label={emailStatus.data?.configured ? "Configured" : "Not configured"} />
                )}
              </span>
            </div>

            <div className="mb-4 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>SMTP configured</span>
                <StatusBadge ok={Boolean(emailStatus.data?.configured)} label={emailStatus.data?.configured ? "Yes" : "No"} />
              </div>
              {emailStatus.data?.from && (
                <div className="flex justify-between">
                  <span>From</span>
                  <span className="font-mono text-gray-500">{emailStatus.data.from}</span>
                </div>
              )}
              {!emailStatus.data?.configured && (
                <p className="pt-1 text-amber-600">
                  Set SMTP_HOST + SMTP_FROM (and SMTP_USER/PASS if needed) in the backend .env.
                </p>
              )}
            </div>

            <div className="mb-3">
              <button
                onClick={() => {
                  const email = window.prompt("Send a test email to this address:");
                  if (email) emailTestMutation.mutate(email.trim());
                }}
                disabled={emailTestMutation.isPending || !emailStatus.data?.configured}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Send size={14} /> Send test
              </button>
            </div>

            <ChannelEditor eventId={eventId} channel="EMAIL" config={emailConfig} onSaved={() => qc.invalidateQueries({ queryKey: ["notifications", eventId] })} />
          </section>
        </div>
      )}

      {eventId && notificationsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading automations…
        </div>
      )}

      {eventId && !waConfig && !emailConfig && !notificationsQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
          <Plus size={16} /> No automations yet for this event. Use the “Enable” buttons above to turn on WhatsApp or
          Email.
        </div>
      )}
    </div>
  );
}
