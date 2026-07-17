import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Loader2, X, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { publicApi, api } from "../lib/api-client";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const to12h = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ap = (h ?? 0) >= 12 ? "PM" : "AM";
  return `${(h ?? 0) % 12 || 12}:${pad(m ?? 0)} ${ap}`;
};

// Next 7 days as tap-friendly chips.
function dayOptions() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return {
      value: toDateValue(d),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
    };
  });
}
const TIME_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

// "Book a meeting" dialog. Public flow (visitor) uses the play `token`; the
// staff flow (Leads page) passes `leadId`. Emails the visitor + our sales inbox.
export function MeetingModal({
  token,
  leadId,
  name,
  currentMeetingAt,
  onClose,
  onBooked,
}: {
  token?: string;
  leadId?: string;
  name?: string;
  currentMeetingAt?: string | null;
  onClose: () => void;
  onBooked?: () => void;
}) {
  const existing = currentMeetingAt ? new Date(currentMeetingAt) : null;
  const [date, setDate] = useState(existing ? toDateValue(existing) : "");
  const [time, setTime] = useState(existing ? `${pad(existing.getHours())}:${pad(existing.getMinutes())}` : "");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const days = dayOptions();

  const book = useMutation({
    mutationFn: () => {
      const payload = { date, time, note: note.trim() || undefined };
      return leadId ? api.leads.bookMeeting(leadId, payload) : publicApi.bookMeeting({ playToken: token!, ...payload });
    },
    onSuccess: (res: any) => {
      setConfirmed(res?.data?.datetime ?? null);
      toast.success("Meeting booked!");
      onBooked?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Could not book the meeting"),
  });

  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-sm font-medium transition ${
      active ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        {confirmed ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={44} />
            <h3 className="text-lg font-bold text-gray-900">Meeting booked!</h3>
            <p className="mt-2 text-sm text-gray-600">
              Confirmed for <span className="font-semibold">{confirmed}</span>. A confirmation is on its way to the inbox.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <CalendarClock size={20} className="text-indigo-600" /> {existing ? "Reschedule meeting" : "Book a meeting"}
              </h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {name && <p className="mb-3 -mt-1 text-sm text-gray-500">for {name}</p>}

            {existing && (
              <p className="mb-4 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">
                Currently booked: {existing.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              </p>
            )}

            {/* Day chips */}
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Pick a day</label>
            <div className="mb-2 grid grid-cols-3 gap-2">
              {days.map((d) => (
                <button key={d.value} onClick={() => setDate(d.value)} className={chip(date === d.value)}>
                  {d.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 focus:border-indigo-500 focus:outline-none"
            />

            {/* Time-slot chips */}
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Pick a time</label>
            <div className="mb-2 grid grid-cols-3 gap-2">
              {TIME_SLOTS.map((t) => (
                <button key={t} onClick={() => setTime(t)} className={chip(time === t)}>
                  {to12h(t)}
                </button>
              ))}
            </div>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 focus:border-indigo-500 focus:outline-none"
            />

            <label className="mb-1.5 block text-sm font-medium text-gray-700">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything to discuss?"
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />

            <button
              onClick={() => book.mutate()}
              disabled={!date || !time || book.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {book.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
              {existing ? "Reschedule" : "Confirm meeting"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
