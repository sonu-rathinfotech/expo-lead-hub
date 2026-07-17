import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Gamepad2, Search, Globe, Swords, Loader2, UserPlus, CheckCircle2, X, QrCode as QrIcon } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api-client";
import { appUrl } from "../lib/app-url";
import { AuditProgress } from "../components/AuditProgress";
import { ScoreReport, type Comparison } from "../components/ScoreReport";
import { QrImage } from "../components/QrImage";
import { unlockAudio } from "../lib/audio";

interface BniMatch {
  id: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
  chapter?: string | null;
  region?: string | null;
}

export function ScoreGamePage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [picked, setPicked] = useState<BniMatch | null>(null);
  const [manual, setManual] = useState(false);

  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [url, setUrl] = useState("");
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [competitorUrl2, setCompetitorUrl2] = useState("");

  const [eventId, setEventId] = useState("");
  const [boothId, setBoothId] = useState("");

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [queuePos, setQueuePos] = useState(0);
  const [analysis, setAnalysis] = useState<Comparison | null>(null);
  const [showLead, setShowLead] = useState(false);
  const [leadSaved, setLeadSaved] = useState(false);
  const [lead, setLead] = useState({ name: "", company: "", email: "", phone: "" });

  // Event/booth for lead association.
  const { data: eventsData } = useQuery({ queryKey: ["events-filter"], queryFn: async () => (await api.events.list({ take: 100 })).data });
  const events: { id: string; name: string }[] = eventsData?.events ?? [];
  const { data: eventDetail } = useQuery({ queryKey: ["event-detail", eventId], queryFn: async () => (await api.events.get(eventId)).data, enabled: !!eventId });
  const booths = eventDetail?.event?.booths ?? [];
  useEffect(() => { if (!eventId && events.length) setEventId(events[0]!.id); }, [events, eventId]);
  useEffect(() => { if (eventId && !boothId && booths.length) setBoothId(booths[0].id); }, [eventId, booths, boothId]);

  // Debounced BNI lookup.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data: bniData, isFetching: bniLoading } = useQuery({
    queryKey: ["bni", debouncedQ],
    queryFn: async () => (await api.ai.bniLookup(debouncedQ)).data,
    enabled: debouncedQ.length >= 2 && !picked,
  });
  const matches: BniMatch[] = bniData?.members ?? [];

  const pick = (m: BniMatch) => {
    setPicked(m);
    setCompany(m.company ?? "");
    setName(m.name);
    setPhone(m.phone ?? "");
    if (m.website) setUrl(m.website);
    setQ(m.name);
  };
  const clearPick = () => { setPicked(null); setQ(""); };

  const scoreMutation = useMutation({
    mutationFn: () => api.ai.score({ url, competitorUrl, competitorUrl2: competitorUrl2.trim() || undefined, company: company || undefined, name: name || undefined, phone: phone || undefined, eventId: eventId || undefined, boothId: boothId || undefined }),
    onSuccess: (res: any) => { setAnalysis(null); setLeadSaved(false); setPendingId(res.data.analysis.id); setQueuePos(res.data.queuePosition ?? 0); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Could not start the audit. Check the URLs."),
  });

  const { data: polled } = useQuery({
    queryKey: ["score-poll", pendingId],
    queryFn: async () => (await api.ai.get(pendingId!)).data.analysis,
    enabled: !!pendingId,
    refetchInterval: (query: any) => {
      const s = query.state.data?.status;
      return s === "COMPLETED" || s === "FAILED" ? false : 3000;
    },
  });
  useEffect(() => {
    if (!polled) return;
    if (polled.status === "COMPLETED") { setAnalysis(polled); setPendingId(null); toast.success("Your score is ready!"); }
    else if (polled.status === "FAILED") { setPendingId(null); toast.error(polled.error || "Audit failed. Try again."); }
  }, [polled]);

  const leadMutation = useMutation({
    mutationFn: () => api.ai.saveLead(analysis!.id, { ...lead, eventId: eventId || undefined, boothId: boothId || undefined }),
    onSuccess: () => { setLeadSaved(true); setShowLead(false); toast.success("Lead saved 🎉"); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Could not save lead"),
  });

  const busy = scoreMutation.isPending || !!pendingId;
  const canStart = url.trim().length > 3 && competitorUrl.trim().length > 3;
  const reportUrl = analysis ? appUrl(`/ai/report/${analysis.id}`) : "";

  // While running → full audit-in-progress animation.
  if (busy) {
    return (
      <div className="-m-4 lg:-m-6">
        <AuditProgress company={company || name} yourUrl={url} competitorUrl={competitorUrl} queuePosition={polled?.status === "PROCESSING" ? 0 : queuePos} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Gamepad2 className="text-indigo-600" /> AI Score Game</h2>
        <p className="mt-1 text-sm text-gray-500">Look up the visitor, enter their site and a partner's — get a head-to-head score.</p>
      </div>

      {!analysis && (
        <>
          {/* Step 1 — identify */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold text-gray-900">1 · Who's playing?</h3>
            {picked ? (
              <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-gray-900">{picked.name}{picked.company ? ` · ${picked.company}` : ""}</p>
                  <p className="text-xs text-gray-500">{[picked.chapter, picked.region].filter(Boolean).join(" · ")}</p>
                </div>
                <button onClick={clearPick} className="text-sm text-indigo-600 hover:underline">Change</button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search BNI member by name or mobile…" className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                {debouncedQ.length >= 2 && (
                  <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-gray-200">
                    {bniLoading && <p className="px-3 py-2 text-sm text-gray-400">Searching…</p>}
                    {!bniLoading && matches.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No match — use manual entry below.</p>}
                    {matches.map((m) => (
                      <button key={m.id} onClick={() => pick(m)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50">
                        <span><b className="text-gray-900">{m.name}</b>{m.company ? ` · ${m.company}` : ""}</span>
                        <span className="text-xs text-gray-400">{m.chapter}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setManual((v) => !v)} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
                  {manual ? "Hide manual entry" : "Can't find them? Enter manually"}
                </button>
              </div>
            )}

            {(manual || picked) && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              </div>
            )}
          </div>

          {/* Step 2 — websites */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold text-gray-900">2 · The match-up</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <Field icon={<Globe size={16} />} value={url} onChange={setUrl} placeholder="Your website" tone="emerald" />
              <span className="text-center font-black text-gray-400">VS</span>
              <Field icon={<Swords size={16} />} value={competitorUrl} onChange={setCompetitorUrl} placeholder="Competitor website" tone="rose" />
            </div>
            <div className="mt-4">
              <Field icon={<Swords size={16} />} value={competitorUrl2} onChange={setCompetitorUrl2} placeholder="2nd competitor website (optional)" tone="rose" />
            </div>
            <button
              onClick={() => {
                unlockAudio();
                scoreMutation.mutate();
              }}
              disabled={!canStart}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Gamepad2 size={18} /> Start the Score Game
            </button>
          </div>
        </>
      )}

      {/* Result */}
      {analysis && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <QrImage value={reportUrl} size={88} />
              <div>
                <p className="flex items-center gap-1.5 font-semibold text-gray-900"><QrIcon size={16} /> Scan to keep this report</p>
                <a href={reportUrl} target="_blank" className="text-xs text-indigo-600 hover:underline">{reportUrl}</a>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setAnalysis(null); setCompetitorUrl(""); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">New game</button>
              {leadSaved ? (
                <span className="inline-flex items-center gap-2 rounded-lg bg-green-50 px-4 py-2 text-sm font-medium text-green-700"><CheckCircle2 size={16} /> Lead saved</span>
              ) : (
                <button onClick={() => { setLead({ name, company, email: "", phone }); setShowLead(true); }} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"><UserPlus size={16} /> Save as lead</button>
              )}
            </div>
          </div>

          <ScoreReport data={analysis} />
        </>
      )}

      {/* Lead modal */}
      {showLead && analysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Save as lead</h3>
              <button onClick={() => setShowLead(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); leadMutation.mutate(); }} className="space-y-3">
              {[["name", "Name *", true], ["company", "Company", false], ["email", "Email *", true], ["phone", "Phone", false]].map(([key, label, req]) => (
                <input key={key as string} type={key === "email" ? "email" : "text"} required={req as boolean} placeholder={label as string} value={(lead as any)[key as string]} onChange={(e) => setLead({ ...lead, [key as string]: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              ))}
              <button type="submit" disabled={leadMutation.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                {leadMutation.isPending && <Loader2 size={16} className="animate-spin" />} Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ icon, value, onChange, placeholder, tone }: { icon: React.ReactNode; value: string; onChange: (v: string) => void; placeholder: string; tone: "emerald" | "rose" }) {
  return (
    <div className="relative">
      <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${tone === "emerald" ? "text-emerald-500" : "text-rose-500"}`}>{icon}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
    </div>
  );
}
