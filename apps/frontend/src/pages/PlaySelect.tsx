import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Sparkles, Calculator, ArrowRight, CalendarClock } from "lucide-react";
import { publicApi } from "../lib/api-client";
import { MeetingModal } from "../components/MeetingModal";

interface Game {
  type: "AI_SCORE" | "PROFIT_CALC";
  title: string;
  subtitle: string;
  path: string;
}

interface PlaySession {
  token: string;
  visitor: { name: string; company: string; email?: string; phone?: string };
  event: { id: string; name: string };
  games: Game[];
}

const ICONS: Record<Game["type"], typeof Sparkles> = {
  AI_SCORE: Sparkles,
  PROFIT_CALC: Calculator,
};

const ACCENT: Record<Game["type"], string> = {
  AI_SCORE: "from-indigo-500 to-violet-600",
  PROFIT_CALC: "from-emerald-500 to-teal-600",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}

export function PlaySelect() {
  const { token } = useParams<{ token: string }>();
  const [showMeeting, setShowMeeting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["play-session", token],
    queryFn: async () => (await publicApi.getPlaySession(token!)).data as PlaySession,
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-slate-300">
          <Loader2 className="animate-spin" />
          Loading…
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow-xl">
          <AlertTriangle className="mx-auto mb-3 text-amber-500" size={40} />
          <h1 className="text-lg font-semibold text-gray-900">Link expired</h1>
          <p className="mt-1 text-sm text-gray-500">
            This play link is invalid or has expired. Please ask a staff member for a new one.
          </p>
        </div>
      </Shell>
    );
  }

  const firstName = (data.visitor.name || "").split(" ")[0];

  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">
          {firstName ? `Nice to meet you, ${firstName}!` : "Pick your game"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Choose an experience below — results show on our stall screen and land in your inbox.
        </p>

        {/* Captured contact — confirm who this session belongs to. */}
        {(data.visitor.email || data.visitor.phone) && (
          <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
            {data.visitor.company && <span className="font-medium text-white">{data.visitor.company}</span>}
            {data.visitor.email && <span>{data.visitor.email}</span>}
            {data.visitor.phone && <span>{data.visitor.phone}</span>}
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-4">
        {data.games.map((game) => {
          const Icon = ICONS[game.type] ?? Sparkles;
          // AI Score has a dedicated public page under the play session; other
          // games carry the token as a query param.
          const to =
            game.type === "AI_SCORE"
              ? `/play/${data.token}/score`
              : game.type === "PROFIT_CALC"
                ? `/play/${data.token}/calculator`
                : `${game.path}${game.path.includes("?") ? "&" : "?"}play=${data.token}`;
          return (
            <Link
              key={game.type}
              to={to}
              className="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${ACCENT[game.type]} text-white`}
              >
                <Icon size={26} />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <h2 className="text-base font-semibold text-gray-900">{game.title}</h2>
                <p className="mt-0.5 text-sm text-gray-500">{game.subtitle}</p>
              </div>
              <ArrowRight className="shrink-0 text-gray-300 transition group-hover:translate-x-1 group-hover:text-indigo-500" />
            </Link>
          );
        })}
      </div>

      {/* Book a meeting — for visitors who want to talk after playing */}
      <div className="mt-6 text-center">
        <button
          onClick={() => setShowMeeting(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <CalendarClock size={18} className="text-indigo-300" /> Want to talk? Book a meeting
        </button>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">Powered by Rath Infotech · {data.event.name}</p>

      {showMeeting && <MeetingModal token={data.token} name={firstName} onClose={() => setShowMeeting(false)} />}
    </Shell>
  );
}
