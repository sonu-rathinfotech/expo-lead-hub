import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle2, TrendingUp, CalendarClock, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { publicApi } from "../lib/api-client";
import { inr } from "../lib/profit-calc";

interface PlaySession {
  visitor: { name: string; company: string; email?: string; phone?: string };
  event: { id: string; name: string };
}

type Period = "month" | "year";

const SERVICES = ["SEO", "Web Development", "Social Media", "Performance Marketing", "Content Writing"];
const LEVELS = ["Head", "Specialist", "Executive", "Intern"] as const;
type Level = (typeof LEVELS)[number];

// Sensible starting counts + monthly salaries (₹) per level — all editable.
const DEFAULT_TEAM: Record<Level, { count: string; salary: string }> = {
  Head: { count: "1", salary: "80000" },
  Specialist: { count: "2", salary: "40000" },
  Executive: { count: "2", salary: "25000" },
  Intern: { count: "1", salary: "12000" },
};
const initTeam = () =>
  Object.fromEntries(LEVELS.map((l) => [l, { ...DEFAULT_TEAM[l] }])) as Record<Level, { count: string; salary: string }>;

export function ProfitCalculator() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = useState(1); // 1 services · 2 inputs + results
  const [services, setServices] = useState<string[]>(["SEO"]);
  const [period, setPeriod] = useState<Period>("month");

  const [clients, setClients] = useState("");
  const [retainer, setRetainer] = useState(""); // avg monthly retainer / client
  const [fixedCost, setFixedCost] = useState("");
  const [perProject, setPerProject] = useState("");
  const [rathCharge, setRathCharge] = useState("");
  const [team, setTeam] = useState(initTeam());

  const [done, setDone] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const effToken = token;

  const session = useQuery({
    queryKey: ["play-session", token],
    queryFn: async () => (await publicApi.getPlaySession(token!)).data as PlaySession,
    enabled: !!token,
    retry: false,
  });

  const n = (s: string) => parseFloat(s || "0") || 0;

  // ── Live computation (monthly base, then scaled by the period) ──
  const r = useMemo(() => {
    const mult = period === "year" ? 12 : 1;
    const clientsN = n(clients);
    const revenueM = clientsN * n(retainer);
    const teamCostM = LEVELS.reduce((sum, l) => sum + n(team[l].count) * n(team[l].salary), 0);
    // All in-house expenses: team + fixed + per-project.
    const inHouseCostM = teamCostM + n(fixedCost) + n(perProject) * clientsN;
    const rathChargesM = clientsN * n(rathCharge);

    const revenue = revenueM * mult;
    const teamCost = teamCostM * mult;
    const inHouseCost = inHouseCostM * mult;
    const rathCharges = rathChargesM * mult;
    const inHouseProfit = revenue - inHouseCost;
    const rathProfit = revenue - rathCharges;
    const extra = rathProfit - inHouseProfit;
    // Per-client expense — auto: every in-house expense spread across clients.
    const costPerClient = clientsN > 0 ? inHouseCost / clientsN : 0;

    return { clientsN, revenue, teamCost, inHouseCost, rathCharges, inHouseProfit, rathProfit, extra, costPerClient };
  }, [clients, retainer, fixedCost, perProject, rathCharge, team, period]);

  const submit = useMutation({
    // Map the wizard's headline numbers into the existing calculator pipeline
    // (revenue − Rath charges = the partner profit).
    mutationFn: () =>
      publicApi.submitCalculator({
        clients: n(clients),
        avgRetainer: n(retainer),
        employeeCost: 0,
        operationalCost: 0,
        miscCost: 0,
        rathFeePerClient: n(rathCharge),
        period,
        playToken: effToken ?? undefined,
      }),
    onSuccess: (res: any) => {
      setEmailed(Boolean(res?.data?.emailed));
      setDone(true);
    },
  });

  const canSubmit = n(clients) > 0;
  const per = period === "year" ? "yearly" : "monthly";

  const card = "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl";
  const inputCls = "w-full bg-transparent py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none";
  const moneyField = (value: string, onChange: (v: string) => void, placeholder = "0") => (
    <div className="flex items-center rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-emerald-500/70">
      <span className="text-sm text-slate-500">₹</span>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} inputMode="numeric" placeholder={placeholder} className={`${inputCls} px-2`} />
    </div>
  );

  return (
    <div className="relative min-h-screen bg-[#060a0f] p-4 text-white sm:p-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(70rem_45rem_at_50%_-10%,rgba(16,185,129,0.14),transparent)]" />

      <div className="relative mx-auto max-w-5xl">
        <Link
          to={token ? `/play/${token}` : "/booth"}
          className="mb-5 inline-flex items-center gap-2 text-lg font-semibold text-slate-300 transition hover:text-white"
        >
          <ArrowLeft size={22} /> Back to home
        </Link>

        {/* Header */}
        <div className="mb-7 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            Rath Infotech Profitability Calculator
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            {step === 1 ? "What do you offer?" : "SEO profitability"}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
            {session.data?.visitor.company ? `${session.data.visitor.company} — ` : ""}
            see how much more you earn by outsourcing to Rath Infotech instead of running an in-house team.
          </p>
        </div>

        {/* Step dots */}
        <div className="mb-7 flex items-center justify-center gap-2">
          {[1, 2].map((s) => (
            <span key={s} className={`h-2 rounded-full transition-all ${s === step ? "w-8 bg-emerald-400" : s < step ? "w-2 bg-emerald-500/60" : "w-2 bg-white/15"}`} />
          ))}
        </div>

        {/* ── Step 1: services checklist ── */}
        {step === 1 && (
          <div className={`${card} mx-auto max-w-xl p-6`}>
            <h2 className="mb-1 text-base font-semibold">Which services do you offer?</h2>
            <p className="mb-4 text-sm text-slate-400">Pick all that apply — then we'll show the SEO numbers for outsourcing to Rath.</p>
            <div className="space-y-2.5">
              {SERVICES.map((s) => {
                const on = services.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => setServices((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                      on ? "border-emerald-500/60 bg-emerald-500/10 text-white" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${on ? "border-emerald-400 bg-emerald-500 text-black" : "border-white/20"}`}>
                      {on && <Check size={13} strokeWidth={3} />}
                    </span>
                    {s}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={services.length === 0}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
            >
              Continue <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* ── Step 2: inputs + live results ── */}
        {step === 2 && (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              {/* Inputs */}
              <section className={`${card} p-6`}>
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Your team &amp; costs (monthly)</h2>
                  <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs">
                    {(["month", "year"] as Period[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`rounded-md px-3 py-1 font-medium transition ${period === p ? "bg-emerald-500 text-black" : "text-slate-400 hover:text-white"}`}
                      >
                        {p === "month" ? "Monthly" : "Yearly"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-300">Number of clients</label>
                      <div className="flex items-center rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-emerald-500/70">
                        <input value={clients} onChange={(e) => setClients(e.target.value.replace(/[^\d.]/g, ""))} inputMode="numeric" placeholder="0" className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-300">Avg. monthly retainer / client</label>
                      {moneyField(retainer, setRetainer)}
                    </div>
                  </div>

                  {/* Team by level */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-300">In-house team (count &amp; salary per level)</p>
                    <div className="space-y-2">
                      {LEVELS.map((l) => (
                        <div key={l} className="grid grid-cols-[auto_1fr_1.4fr] items-center gap-2">
                          <span className="w-16 text-xs font-semibold text-slate-400">{l}</span>
                          <div className="flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5">
                            <input
                              value={team[l].count}
                              onChange={(e) => setTeam((t) => ({ ...t, [l]: { ...t[l], count: e.target.value.replace(/[^\d]/g, "") } }))}
                              inputMode="numeric"
                              placeholder="0"
                              className={`${inputCls} py-2`}
                            />
                          </div>
                          <div className="flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5">
                            <span className="text-xs text-slate-500">₹</span>
                            <input
                              value={team[l].salary}
                              onChange={(e) => setTeam((t) => ({ ...t, [l]: { ...t[l], salary: e.target.value.replace(/[^\d.]/g, "") } }))}
                              inputMode="numeric"
                              placeholder="salary / mo"
                              className={`${inputCls} px-1.5 py-2`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-300">Fixed cost (operations &amp; misc)</label>
                      {moneyField(fixedCost, setFixedCost)}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-300">Per-project expense</label>
                      {moneyField(perProject, setPerProject)}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-300">Rath charges for SEO / client</label>
                    {moneyField(rathCharge, setRathCharge)}
                  </div>
                </div>

                <button onClick={() => setStep(1)} className="mt-4 text-sm text-slate-400 hover:text-white">← Back</button>
              </section>

              {/* Results */}
              <section className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Kpi label={`Revenue (${per})`} value={inr(r.revenue)} />
                  <Kpi label={`In-house cost (${per})`} value={inr(r.inHouseCost)} />
                  <Kpi label={`In-house profit (${per})`} value={inr(r.inHouseProfit)} />
                  <Kpi label={`Profit with Rath (${per})`} value={inr(r.rathProfit)} highlight />
                </div>

                {/* Per-client expense — auto (all in-house expenses ÷ clients) */}
                <div className={`${card} flex items-center justify-between px-5 py-3`}>
                  <span className="text-xs uppercase tracking-wider text-slate-400">Per-client expense · auto ({per})</span>
                  <span className="text-lg font-black tabular-nums text-white">{inr(r.costPerClient)}</span>
                </div>

                <div className={`${card} p-5`}>
                  <div className="flex items-start gap-3">
                    <TrendingUp className="mt-0.5 shrink-0 text-emerald-400" size={20} />
                    <div className="text-sm leading-relaxed text-slate-300">
                      <p>
                        Outsourcing to Rath earns you{" "}
                        <span className="font-semibold text-emerald-400">{inr(Math.max(0, r.extra))}</span> more {per} on{" "}
                        <span className="font-semibold text-white">{r.clientsN}</span> client{r.clientsN === 1 ? "" : "s"}.
                      </p>
                      <ul className="mt-3 space-y-1.5 text-xs text-slate-400">
                        <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" /> No in-house salaries — save {inr(r.teamCost)} {per}</li>
                        <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" /> No fixed operational or compliance overhead</li>
                        <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" /> No hiring, training or team management</li>
                        <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" /> Scale up or down instantly, per client</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Save / demo — the lead is already captured, so no form here */}
                <div className="text-center">
                  {done ? (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
                      <CheckCircle2 size={16} /> {emailed ? "Sent to your email — we'll be in touch!" : "Saved — we'll be in touch!"}
                    </div>
                  ) : (
                    <button
                      onClick={() => submit.mutate()}
                      disabled={!canSubmit || submit.isPending}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-8 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
                      Schedule a Demo
                    </button>
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        <p className="mt-6 text-center text-xs text-slate-600">Runs live in your browser · {session.data?.event.name ?? "Rath Infotech"}</p>
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 backdrop-blur-xl transition ${
        highlight ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_40px_-12px_rgba(16,185,129,0.5)]" : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-black tabular-nums ${highlight ? "text-emerald-400" : "text-white"}`}>{value}</p>
    </div>
  );
}
