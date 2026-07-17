import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, Search, Loader2, Trash2, Gamepad2, Mail, Copy, CalendarClock, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api-client";
import { appUrl } from "../lib/app-url";
import { useAuthStore } from "../stores/auth.store";
import { SourceBadge, formatDate } from "../components/badges";
import { MeetingModal } from "../components/MeetingModal";

const PAGE_SIZE = 20;
const SOURCES = ["QR_SCAN", "OCR_SCAN", "MANUAL"];
const STATUSES = ["NEW", "SYNCED", "FAILED", "RETRYING"];

interface LeadRow {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  createdAt: string;
  event?: { id: string; name: string } | null;
  booth?: { id: string; name: string } | null;
  visitorType?: { id: string; name: string; color?: string | null } | null;
  submittedByUser?: { id: string; name: string } | null;
  playToken?: string | null;
  gamePlayed?: boolean;
  reportsSentCount?: number;
  meetingAt?: string | null;
}

export function LeadsPage() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canDelete = role === "SUPER_ADMIN";
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [eventId, setEventId] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [meetingLead, setMeetingLead] = useState<LeadRow | null>(null);

  const filters = {
    ...(eventId ? { eventId } : {}),
    ...(source ? { source } : {}),
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
  };

  const { data: eventsData } = useQuery({
    queryKey: ["events-filter"],
    queryFn: async () => (await api.events.list({ take: 100 })).data,
  });
  const events: { id: string; name: string }[] = eventsData?.events ?? [];

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["leads", page, filters],
    queryFn: async () =>
      (await api.leads.list({ ...filters, skip: page * PAGE_SIZE, take: PAGE_SIZE })).data,
    placeholderData: keepPreviousData,
  });

  const leads: LeadRow[] = data?.leads ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.leads.remove(id),
    onSuccess: () => {
      toast.success("Lead deleted");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Delete failed"),
  });

  const confirmDelete = (lead: LeadRow) => {
    if (window.confirm(`Delete lead${lead.name ? ` "${lead.name}"` : ""}? This cannot be undone.`)) {
      deleteMutation.mutate(lead.id);
    }
  };

  const sendReport = useMutation({
    mutationFn: (id: string) => api.leads.sendReport(id),
    onSuccess: (res: any) => {
      const n = res?.data?.sentCount;
      toast.success(res?.data?.message ?? "Report sent");
      if (n != null) toast.success(`Sent ${n} time${n === 1 ? "" : "s"} so far`);
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Couldn't send report"),
  });

  const resetPageAnd = (fn: () => void) => {
    fn();
    setPage(0);
  };

  const btn = "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium";

  // The per-lead action buttons — shared by the desktop table + the mobile cards.
  const leadActions = (lead: LeadRow) => (
    <>
      {/* Play / Played */}
      {lead.playToken && !lead.gamePlayed ? (
        <a
          href={appUrl(`/play/${lead.playToken}`)}
          target="_blank"
          rel="noreferrer"
          title="Open game on this device"
          className={`${btn} border-indigo-200 text-indigo-600 hover:bg-indigo-50`}
        >
          <Gamepad2 size={14} /> Play
        </a>
      ) : lead.gamePlayed ? (
        <span title="Game finished" className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-700`}>
          <CheckCircle2 size={14} /> Played
        </span>
      ) : (
        <span title="No game session yet" className={`${btn} border-gray-100 text-gray-300`}>
          <Gamepad2 size={14} /> Play
        </span>
      )}

      {/* Copy play link — only while the game hasn't been played yet */}
      {lead.playToken && !lead.gamePlayed && (
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(appUrl(`/play/${lead.playToken}`));
              toast.success("Play link copied");
            } catch {
              toast.error("Couldn't copy — copy it manually from the address bar");
            }
          }}
          title="Copy play link (share to their phone)"
          className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}
        >
          <Copy size={14} /> Link
        </button>
      )}

      {/* Send / Resend report — clearer states */}
      <button
        onClick={() => sendReport.mutate(lead.id)}
        disabled={!lead.gamePlayed || sendReport.isPending}
        title={
          !lead.gamePlayed
            ? "No report yet — play the game first"
            : lead.reportsSentCount
              ? `Sent ${lead.reportsSentCount} time(s) — click to resend`
              : "Email the report to this lead"
        }
        className={`${btn} disabled:cursor-not-allowed ${
          !lead.gamePlayed
            ? "border-gray-100 text-gray-300"
            : lead.reportsSentCount
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-indigo-200 text-indigo-600 hover:bg-indigo-50"
        }`}
      >
        <Mail size={14} /> {!lead.gamePlayed ? "Send" : lead.reportsSentCount ? "Sent" : "Send report"}
        {!!lead.reportsSentCount && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
            {lead.reportsSentCount}
          </span>
        )}
      </button>

      {/* Book / reschedule meeting */}
      <button
        onClick={() => setMeetingLead(lead)}
        title={
          lead.meetingAt
            ? `Booked: ${new Date(lead.meetingAt).toLocaleString()} — click to reschedule`
            : "Book a meeting for this lead"
        }
        className={`${btn} whitespace-nowrap ${
          lead.meetingAt
            ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
            : "border-gray-200 text-gray-600 hover:bg-gray-50"
        }`}
      >
        <CalendarClock size={14} />
        {lead.meetingAt
          ? new Date(lead.meetingAt).toLocaleString(undefined, {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })
          : "Meet"}
      </button>

      {canDelete && (
        <button
          onClick={() => confirmDelete(lead)}
          disabled={deleteMutation.isPending}
          title="Delete lead"
          className="inline-flex items-center rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 size={16} />
        </button>
      )}
    </>
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.leads.export(filters);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Data</h2>
          <p className="mt-1 text-sm text-gray-500">{total} total</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resetPageAnd(() => setSearch(searchInput));
          }}
          className="relative flex-1 min-w-[220px]"
        >
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, company, email, phone…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </form>

        <select
          value={eventId}
          onChange={(e) => resetPageAnd(() => setEventId(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All events</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>

        <select
          value={source}
          onChange={(e) => resetPageAnd(() => setSource(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => resetPageAnd(() => setStatus(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Table — desktop only; cards below take over on iPad / phones */}
      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white lg:block">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["Name", "Company", "Contact", "Visitor Type", "Captured by", "Source", "Date"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600">
                  {h}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  Loading leads…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  No leads match your filters.
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/leads/${lead.id}`} className="font-medium text-indigo-600 hover:underline">
                      {lead.name || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{lead.company || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{lead.email || "—"}</div>
                    <div className="text-xs text-gray-400">{lead.phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.visitorType ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-gray-700"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: lead.visitorType.color ?? "#94a3b8" }}
                        />
                        {lead.visitorType.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lead.submittedByUser?.name ?? <span className="text-gray-400">Public (QR)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <SourceBadge source={lead.source} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {formatDate(lead.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">{leadActions(lead)}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Card list — used on iPad / phones where the wide table would overflow */}
      <div className="space-y-3 lg:hidden">
        {isLoading ? (
          <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-400">Loading leads…</p>
        ) : leads.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-400">No leads match your filters.</p>
        ) : (
          leads.map((lead) => (
            <div key={lead.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/leads/${lead.id}`} className="text-base font-semibold text-indigo-600">
                  {lead.name || "—"}
                </Link>
                <SourceBadge source={lead.source} />
              </div>
              {lead.company && <p className="text-sm text-gray-600">{lead.company}</p>}
              <div className="mt-2 space-y-0.5 text-sm text-gray-600">
                <div className="break-all">{lead.email || "—"}</div>
                {lead.phone && <div className="text-xs text-gray-400">{lead.phone}</div>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                {lead.visitorType && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lead.visitorType.color ?? "#94a3b8" }} />
                    {lead.visitorType.name}
                  </span>
                )}
                <span>By {lead.submittedByUser?.name ?? "Public (QR)"}</span>
                <span>{formatDate(lead.createdAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{leadActions(lead)}</div>
            </div>
          ))
        )}
      </div>

      {meetingLead && (
        <MeetingModal
          leadId={meetingLead.id}
          name={meetingLead.name || undefined}
          currentMeetingAt={meetingLead.meetingAt}
          onClose={() => setMeetingLead(null)}
          onBooked={() => qc.invalidateQueries({ queryKey: ["leads"] })}
        />
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Page {page + 1} of {totalPages}
          {isFetching && !isLoading && <span className="ml-2 text-gray-400">updating…</span>}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
