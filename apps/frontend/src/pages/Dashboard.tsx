import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Users, Calendar, CheckCircle2, AlertTriangle, Clock, FileSpreadsheet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api-client";
import { useAuthStore } from "../stores/auth.store";
import { BarList, LineChart, Donut } from "../components/Charts";

const SOURCE_COLORS: Record<string, string> = {
  QR_SCAN: "#6366f1",
  OCR_SCAN: "#a855f7",
  MANUAL: "#94a3b8",
};

interface Stats {
  kpis: {
    totalLeads: number;
    todayLeads: number;
    activeEvents: number;
    crmSynced: number;
    sheetsSynced: number;
    failedSyncs: number;
    pendingSyncs: number;
  };
  leadsOverTime: { date: string; count: number }[];
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  byEvent: { id: string; name: string; count: number }[];
  byVisitorType: { id: string; name: string; color?: string | null; count: number }[];
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`rounded-lg p-2.5 ${accent}`}>
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const res = await api.dashboard.stats();
      return res.data as Stats;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="mt-1 text-gray-500">Welcome back, {user?.name ?? "Admin"}.</p>
      </div>

      {isLoading && <p className="text-gray-500">Loading dashboard…</p>}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load dashboard stats. Is the API running?
        </div>
      )}

      {data && !data.kpis && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          The API returned an unexpected response (no <code>kpis</code>). This usually means a stale
          backend process is still serving old code — restart the backend.
        </div>
      )}

      {data?.kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total Data" value={data.kpis.totalLeads} icon={Users} accent="bg-indigo-600" />
            <KpiCard label="Today's Data" value={data.kpis.todayLeads} icon={Clock} accent="bg-blue-600" />
            <KpiCard label="Active Events" value={data.kpis.activeEvents} icon={Calendar} accent="bg-emerald-600" />
            <KpiCard label="Failed Syncs" value={data.kpis.failedSyncs} icon={AlertTriangle} accent="bg-red-600" />
            <KpiCard label="CRM Synced" value={data.kpis.crmSynced} icon={CheckCircle2} accent="bg-green-600" />
            <KpiCard label="Sheets Synced" value={data.kpis.sheetsSynced} icon={FileSpreadsheet} accent="bg-teal-600" />
            <KpiCard label="Pending Syncs" value={data.kpis.pendingSyncs} icon={Clock} accent="bg-amber-500" />
          </div>

          {/* Leads over time */}
          <Panel
            title="Data Over Time (last 14 days)"
            action={
              <Link to="/leads" className="text-sm font-medium text-indigo-600 hover:underline">
                View all leads →
              </Link>
            }
          >
            <LineChart data={data.leadsOverTime} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Data by Source">
              <Donut
                data={data.bySource.map((s) => ({
                  label: s.source.replace("_", " "),
                  value: s.count,
                  color: SOURCE_COLORS[s.source] ?? "#94a3b8",
                }))}
              />
            </Panel>

            <Panel title="Data by Visitor Type">
              <BarList
                data={data.byVisitorType.map((v) => ({
                  label: v.name,
                  value: v.count,
                  color: v.color ?? "#6366f1",
                }))}
                emptyText="No leads yet"
              />
            </Panel>
          </div>

          <Panel title="Data by Event">
            <BarList
              data={data.byEvent.map((e) => ({ label: e.name, value: e.count }))}
              emptyText="No leads yet"
            />
          </Panel>
        </>
      )}
    </div>
  );
}
