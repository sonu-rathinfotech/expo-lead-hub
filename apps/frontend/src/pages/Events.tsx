import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Loader2, CheckCircle2, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api-client";
import { formatDate } from "../components/badges";

interface EventRow {
  id: string;
  name: string;
  venue: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  startDate: string;
  leadCount?: number;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-gray-100 text-gray-600",
  COMPLETED: "bg-slate-200 text-slate-600",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export function EventsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", venue: "", activate: true });

  const { data, isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => (await api.events.list({ take: 100 })).data,
  });
  const events: EventRow[] = data?.events ?? [];

  const create = useMutation({
    mutationFn: () => api.events.quickCreate({ name: form.name.trim(), venue: form.venue.trim() || undefined, activate: form.activate }),
    onSuccess: (res: any) => {
      toast.success(res?.data?.message ?? "Event created");
      setShowAdd(false);
      setForm({ name: "", venue: "", activate: true });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Create failed"),
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.events.activate(id),
    onSuccess: () => {
      toast.success("Event set active — Capture Lead now uses it");
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Failed"),
  });

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CalendarDays className="text-indigo-600" size={24} /> Events
          </h2>
          <p className="mt-1 text-sm text-gray-500">The active event is where new captured leads land.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> Add event
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["Event", "Venue", "Status", "Leads", "Created", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No events yet.</td></tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{e.name}</td>
                  <td className="px-4 py-3 text-gray-600">{e.venue}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status] ?? "bg-gray-100"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{e.leadCount ?? 0}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">{formatDate(e.startDate)}</td>
                  <td className="px-4 py-3 text-right">
                    {e.status === "ACTIVE" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <CheckCircle2 size={14} /> Active
                      </span>
                    ) : (
                      <button
                        onClick={() => activate.mutate(e.id)}
                        disabled={activate.isPending}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        Set active
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add event</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Event name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bombay Exhibition Centre" className={input} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Venue (optional)</label>
                <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Defaults to the event name" className={input} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.activate} onChange={(e) => setForm({ ...form, activate: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                Make this the active event (capture starts using it right away)
              </label>
              <p className="text-xs text-gray-400">A default booth, visitor type and lead form are created automatically — nothing else to set up.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={create.isPending} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  {create.isPending && <Loader2 size={16} className="animate-spin" />} Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
