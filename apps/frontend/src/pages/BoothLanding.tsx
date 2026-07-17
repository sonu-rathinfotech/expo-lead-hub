import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Calculator, Gamepad2, ArrowRight, ArrowLeft } from "lucide-react";
import { publicApi } from "../lib/api-client";

interface BoothContext {
  event: { id: string; name: string; logoUrl?: string | null };
  booth: { id: string; name: string } | null;
}

// Where "Back to home" goes. Defaults to the app's own base path (e.g. /mmd2026/)
// so it stays inside the hosted sub-path; override with VITE_MAIN_SITE_URL.
const MAIN_SITE_URL = import.meta.env.VITE_MAIN_SITE_URL || import.meta.env.BASE_URL;

export function BoothLanding() {
  const { data } = useQuery({
    queryKey: ["booth-context"],
    queryFn: async () => (await publicApi.getBoothContext()).data as BoothContext,
    retry: false,
  });

  return (
    <div className="booth-bg relative flex flex-col items-center justify-center p-6">
      {/* Back to the main website */}
      <a
        href={MAIN_SITE_URL}
        className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/70 transition hover:bg-white/15 hover:text-white sm:left-6 sm:top-6"
      >
        <ArrowLeft size={16} /> Back to home
      </a>

      {/* Header */}
      <div className="mb-10 text-center">
        {data?.event?.logoUrl && (
          <img src={data.event.logoUrl} alt="" className="mx-auto mb-4 h-16 object-contain" />
        )}
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          {data?.event?.name ?? "Welcome"}
        </h1>
        <p className="mt-3 text-lg text-white/60">Pick an experience — takes under a minute.</p>
      </div>

      {/* Two options */}
      <div className="grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        <Link
          to="/booth/calculator"
          className="glass-card group flex flex-col items-start gap-4 p-8 transition-transform duration-200 hover:-translate-y-1 hover:bg-white/15"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg">
            <Calculator size={32} />
          </div>
          <h2 className="text-2xl font-bold">Profitability Calculator</h2>
          <p className="text-white/60">
            Enter your numbers and instantly see your profit, costs and margin.
          </p>
          <span className="mt-auto inline-flex items-center gap-1.5 font-semibold text-emerald-300 group-hover:gap-2.5">
            Start <ArrowRight size={18} />
          </span>
        </Link>

        <Link
          to="/booth/score"
          className="glass-card group flex flex-col items-start gap-4 p-8 transition-transform duration-200 hover:-translate-y-1 hover:bg-white/15"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white shadow-lg">
            <Gamepad2 size={32} />
          </div>
          <h2 className="text-2xl font-bold">AI Score Game</h2>
          <p className="text-white/60">
            Your website vs a partner — get an instant head-to-head score and how to win.
          </p>
          <span className="mt-auto inline-flex items-center gap-1.5 font-semibold text-indigo-300 group-hover:gap-2.5">
            Play <ArrowRight size={18} />
          </span>
        </Link>
      </div>

      <p className="mt-10 text-sm text-white/30">
        {data?.booth ? `${data.booth.name} · ` : ""}Powered by Exhibition Lead Capture
      </p>
    </div>
  );
}
