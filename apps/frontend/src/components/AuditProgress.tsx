import { useEffect, useState } from "react";
import { Volume2, VolumeX, Check } from "lucide-react";
import { publicApi } from "../lib/api-client";
import { playUrl, stopAudio } from "../lib/audio";

function host(u?: string) {
  if (!u) return "the site";
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

// Pick the best-sounding *free* voice available in the browser. On the booth
// iPad this lands on Apple's high-quality voices (Samantha / enhanced), which
// sound natural — no API key, no cost.
function pickVoice(): SpeechSynthesisVoice | null {
  const vs = window.speechSynthesis.getVoices();
  if (!vs.length) return null;
  const prefs = [
    /samantha/i,
    /ava|allison|aaron|nicky|evan/i, // Apple enhanced voices
    /google us english/i,
    /microsoft.*(aria|jenny|guy|natural)/i,
    /natural|enhanced|premium/i,
    /en[-_]?in/i, // Indian English
    /google uk english female/i,
  ];
  for (const re of prefs) {
    const v = vs.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return vs.find((x) => /^en/i.test(x.lang)) ?? vs[0] ?? null;
}

// Attack words the two sites fire at each other. 3 lanes per side are visible
// at a time; a rotating "volley" cycles through the whole pool for variety.
const RIGHT_WORDS = [
  "SEO", "SPEED", "UX", "MOBILE", "CTA", "SCHEMA", "H1 TAGS", "META", "HTTPS", "SITEMAP",
  "CANONICAL", "LCP", "ALT TAGS", "PAGESPEED", "INDEXING", "CONTENT", "INTERNAL LINKS", "RICH SNIPPETS", "CORE VITALS", "A11Y",
];
const LEFT_WORDS = [
  "BACKLINKS", "DESIGN", "KEYWORDS", "DOMAIN RANK", "TRAFFIC", "RANKING", "AUTHORITY", "CONVERSION", "BOUNCE RATE", "DWELL TIME",
  "CRAWL", "OG TAGS", "CDN", "CACHE", "REDIRECTS", "404 FIXES", "ANCHOR TEXT", "SERP", "ROBOTS.TXT", "AMP",
];

// Full-screen, video-like "audit in progress" scene with live voice narration.
export function AuditProgress({
  company,
  yourUrl,
  competitorUrl,
  queuePosition,
}: {
  company?: string;
  yourUrl?: string;
  competitorUrl?: string;
  queuePosition?: number;
}) {
  const [tick, setTick] = useState(0);
  const [volley, setVolley] = useState(0); // rotates the attack words
  const [muted, setMuted] = useState(false);

  const messages = [
    `Capturing ${host(yourUrl)}…`,
    competitorUrl ? `Capturing ${host(competitorUrl)}…` : "Capturing competitors…",
    "Measuring domain authority & backlinks…",
    "Analyzing your ranking keywords…",
    "Checking speed & Core Web Vitals…",
    "Scoring design, UX & conversion…",
    "Checking AI-search visibility…",
    "Comparing head-to-head…",
    "Building your report…",
  ];
  // Shown on a loop once the main steps are done, so the scene keeps feeling
  // alive for the full ~50–70s the audit can take (instead of freezing).
  const tail = ["Almost ready…", "Finalizing your score…", "Putting the finishing touches…", "Wrapping up…"];

  // Advance ~every 6s → the 9 steps span ~50s, matching a typical audit; after
  // that the tail lines cycle until the report arrives (component unmounts).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 6000);
    const v = setInterval(() => setVolley((n) => n + 1), 3000);
    return () => {
      clearInterval(t);
      clearInterval(v);
    };
  }, []);

  const step = Math.min(tick, messages.length - 1); // timeline position (holds at last)
  const currentMessage = tick < messages.length ? messages[tick] : tail[(tick - messages.length) % tail.length];

  // Narrate the audit. The voice returns a few times (spread across ~50s) so it
  // stays lively for the whole audit. It tries the AI voice (Gemini TTS, if the
  // owner enabled it) and falls back to the free browser voice per line.
  useEffect(() => {
    if (muted) return;
    const name = company?.trim() ? company.trim() : "there";
    const comp = competitorUrl ? host(competitorUrl) : "your competitor";
    const segments = [
      { at: 0, text: `Hey ${name}! Let's see how you stack up against ${comp}. Starting your audit now.` },
      { at: 17000, text: "Still analyzing — measuring your S E O, page speed and design." },
      { at: 34000, text: "The audit is still running. Comparing both sites head to head." },
      { at: 50000, text: "Almost done — putting your report together." },
    ];

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let keepAlive: ReturnType<typeof setInterval> | undefined;

    const speakBrowser = (text: string) => {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 0.97;
      u.pitch = 1.03;
      window.speechSynthesis.speak(u);
      if (!keepAlive) {
        keepAlive = setInterval(() => {
          if (window.speechSynthesis?.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }, 9000);
      }
    };

    // Ask the server for AI audio; returns true only if it actually played.
    const sayAi = async (text: string): Promise<boolean> => {
      try {
        const { data } = await publicApi.tts(text);
        if (cancelled || !data?.audio) return false;
        return await playUrl(data.audio);
      } catch {
        return false;
      }
    };

    // Line 1 speaks INSTANTLY via the free browser voice (Gemini would add a
    // 1–2s synth delay before the first word). Lines 2+ use the premium Gemini
    // voice, fetched in the background while line 1 plays (falling back to the
    // browser voice per line if Gemini is off/slow/failing).
    const run = () => {
      speakBrowser(segments[0]!.text);
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i]!;
        timers.push(
          setTimeout(async () => {
            if (cancelled) return;
            const ok = await sayAi(seg.text);
            if (!ok && !cancelled) speakBrowser(seg.text);
          }, seg.at),
        );
      }
    };
    run();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      if (keepAlive) clearInterval(keepAlive);
      window.speechSynthesis?.cancel();
      stopAudio();
    };
  }, [company, competitorUrl, muted]);

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (next) {
        window.speechSynthesis?.cancel();
        stopAudio();
      }
      return next;
    });
  };

  return (
    <div className="booth-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-6 text-center">
      {/* Animated aurora background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="au au1" />
        <div className="au au2" />
        <div className="au au3" />
      </div>

      {/* Mute toggle */}
      <button
        onClick={toggleMute}
        className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur hover:bg-white/20"
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} className="animate-pulse" />}
        {muted ? "Muted" : "Voice on"}
      </button>

      {/* ── Battle scene: your site vs the competitor, clashing head-to-head ── */}
      <div className="relative z-10 mb-9 flex items-center justify-center gap-1 sm:gap-4">
        {/* Attack words the two sites fire at each other across the centre.
            3 lanes per side, rotating through the full pool each volley. */}
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          {[0, 1, 2].map((i) => {
            const w = RIGHT_WORDS[(volley * 3 + i) % RIGHT_WORDS.length]!;
            return (
              <span
                key={`r${volley}-${i}`}
                className="absolute left-1/4 whitespace-nowrap rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow-lg"
                style={{ top: `${24 + i * 20}%`, animation: `flyRight 3s ${i * 0.4}s ease-in-out` }}
              >
                {w} →
              </span>
            );
          })}
          {[0, 1, 2].map((i) => {
            const w = LEFT_WORDS[(volley * 3 + i) % LEFT_WORDS.length]!;
            return (
              <span
                key={`l${volley}-${i}`}
                className="absolute right-1/4 whitespace-nowrap rounded-md bg-rose-500/90 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow-lg"
                style={{ top: `${34 + i * 20}%`, animation: `flyLeft 3s ${i * 0.4 + 0.6}s ease-in-out` }}
              >
                ← {w}
              </span>
            );
          })}
        </div>

        <BattleDevice url={yourUrl} label="You" tone="you" attack="attackYou" />

        {/* Center clash + VS */}
        <div className="relative flex flex-col items-center">
          {/* spark burst on each clash */}
          <span
            aria-hidden
            className="absolute h-16 w-16 rounded-full"
            style={{ animation: "clashBurst 3s ease-in-out infinite", background: "radial-gradient(circle, rgba(253,224,71,0.9), rgba(244,63,94,0.4) 45%, transparent 70%)" }}
          />
          <span
            className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/30 bg-slate-900/80 text-sm font-black italic text-white shadow-xl"
            style={{ animation: "vsPulse 3s ease-in-out infinite" }}
          >
            VS
          </span>
        </div>

        <BattleDevice url={competitorUrl} label="Competitor" tone="comp" attack="attackComp" />
      </div>

      <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
        {company?.trim() ? `Hey ${company.trim()},` : "Hang tight,"} your audit is running
      </h2>
      <p className="mt-3 flex items-center justify-center gap-2 text-lg text-indigo-200">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-400" />
        </span>
        {currentMessage}
      </p>

      {/* Step timeline */}
      <div className="mt-6 flex items-center gap-2">
        {messages.map((_, i) => (
          <span
            key={i}
            className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] transition-all ${
              i < step ? "bg-emerald-500 text-white" : i === step ? "scale-125 bg-indigo-400" : "bg-white/15"
            }`}
          >
            {i < step && <Check size={9} strokeWidth={3.5} />}
          </span>
        ))}
      </div>

      {queuePosition && queuePosition > 0 ? (
        <p className="mt-6 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white/70">
          You're #{queuePosition} in the queue — starting shortly…
        </p>
      ) : (
        <div className="mt-6 h-1.5 w-64 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 rounded-full bg-indigo-400" style={{ animation: "indeterminate 1.6s ease-in-out infinite" }} />
        </div>
      )}

      <p className="mt-8 max-w-md text-sm text-white/40">
        This usually takes about a minute — we're capturing both sites and scoring them with AI.
      </p>

      <style>{`
        @keyframes scanBeam { 0%{top:-12%;opacity:0} 12%{opacity:1} 88%{opacity:1} 100%{top:100%;opacity:0} }
        /* Head-to-head clash: each device lunges toward the centre and recoils */
        @keyframes attackYou  { 0%,100%{transform:translateX(0)} 44%{transform:translateX(14px) scale(1.04)} 56%{transform:translateX(9px)} 68%{transform:translateX(0)} }
        @keyframes attackComp { 0%,100%{transform:translateX(0)} 44%{transform:translateX(-14px) scale(1.04)} 56%{transform:translateX(-9px)} 68%{transform:translateX(0)} }
        @keyframes clashBurst { 0%,38%,62%,100%{opacity:0;transform:scale(.4)} 50%{opacity:1;transform:scale(1.35)} }
        @keyframes vsPulse { 0%,100%{transform:scale(1) rotate(-4deg)} 50%{transform:scale(1.3) rotate(4deg)} }
        /* Attack words fired across the centre, meeting at the clash (~50%) */
        @keyframes flyRight {
          0%{opacity:0;transform:translateX(-30px) scale(.7)}
          15%{opacity:1;transform:translateX(0) scale(1)}
          50%{opacity:1;transform:translateX(70px) scale(1.05)}
          72%{opacity:0;transform:translateX(120px) scale(.7)}
          100%{opacity:0}
        }
        @keyframes flyLeft {
          0%{opacity:0;transform:translateX(30px) scale(.7)}
          15%{opacity:1;transform:translateX(0) scale(1)}
          50%{opacity:1;transform:translateX(-70px) scale(1.05)}
          72%{opacity:0;transform:translateX(-120px) scale(.7)}
          100%{opacity:0}
        }
        /* Build up (staggered per block), hold, then glitch & shatter, then rebuild */
        @keyframes buildBreak {
          0%   { opacity:0; transform: translateY(10px) scale(.9); filter:none; }
          12%  { opacity:1; transform: translateY(0) scale(1); }
          60%  { opacity:1; transform: translateY(0) scale(1); filter:none; }
          70%  { transform: translateX(-2px) skewX(-7deg); filter: hue-rotate(-45deg) brightness(1.5); }
          74%  { transform: translateX(3px)  skewX(7deg); }
          78%  { transform: translateX(-2px) skewX(-4deg); }
          88%  { opacity:0; transform: translateY(-16px) scale(.82) rotate(3deg); filter: brightness(1.6); }
          100% { opacity:0; transform: translateY(10px) scale(.9); }
        }
        @keyframes glitchFlash {
          0%,66%,100% { background: rgba(244,63,94,0); }
          70% { background: rgba(244,63,94,0.20); }
          74% { background: rgba(244,63,94,0.05); }
          80% { background: rgba(244,63,94,0.22); }
          86% { background: rgba(244,63,94,0.04); }
        }
        @keyframes deviceGlitch {
          0%,66%,100% { transform: translate(0,0); box-shadow: 0 0 0 rgba(244,63,94,0); }
          70% { transform: translate(-2px,1px); box-shadow: 0 0 26px rgba(244,63,94,0.6); }
          75% { transform: translate(2px,-1px); }
          80% { transform: translate(-1px,1px); box-shadow: 0 0 26px rgba(244,63,94,0.5); }
          84% { transform: translate(1px,0); }
        }
        @keyframes indeterminate { 0%{margin-left:-33%} 100%{margin-left:100%} }
        @keyframes auroraMove { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(28px,-22px) scale(1.18)} }
        .au { position:absolute; border-radius:9999px; filter:blur(70px); opacity:.5; }
        .au1 { width:340px;height:340px;top:-60px;left:-40px;background:rgba(99,102,241,.55); animation:auroraMove 9s ease-in-out infinite; }
        .au2 { width:300px;height:300px;bottom:-50px;right:-30px;background:rgba(168,85,247,.45); animation:auroraMove 11s ease-in-out infinite reverse; }
        .au3 { width:260px;height:260px;bottom:20%;left:30%;background:rgba(56,189,248,.30); animation:auroraMove 13s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .au,[style*="animation"]{ animation:none !important; } }
      `}</style>
    </div>
  );
}

// One combatant in the battle: a website mock that builds block-by-block, then
// glitches & shatters, while lunging toward the centre on each clash beat.
function BattleDevice({
  url,
  label,
  tone,
  attack,
}: {
  url?: string;
  label: string;
  tone: "you" | "comp";
  attack: string;
}) {
  const glow = tone === "you" ? "border-emerald-400/50" : "border-rose-400/50";
  const bar = tone === "you" ? "bg-emerald-500/25" : "bg-rose-500/25";
  const accent = tone === "you" ? "bg-emerald-400/35" : "bg-rose-400/35";
  const beam = tone === "you" ? "rgba(52,211,153,0.55)" : "rgba(251,113,133,0.55)";
  const labelColor = tone === "you" ? "text-emerald-300" : "text-rose-300";

  return (
    <div className="flex flex-col items-center" style={{ animation: `${attack} 3s ease-in-out infinite` }}>
      <div
        className={`relative h-28 w-28 overflow-hidden rounded-xl border-2 ${glow} bg-slate-800/80 shadow-2xl backdrop-blur sm:h-36 sm:w-40`}
        style={{ animation: "deviceGlitch 5.5s ease-in-out infinite" }}
      >
        <div className={`flex h-5 items-center gap-1 px-2 ${bar}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          <span className="ml-1 truncate text-[8px] text-white/50">{host(url)}</span>
        </div>
        <div className="relative space-y-1.5 p-2.5">
          {["h-3 w-3/4 bg-white/25", "h-2 w-full bg-white/10", "h-2 w-5/6 bg-white/10", `mt-2 h-7 w-full ${accent}`, "h-2 w-2/3 bg-white/10"].map((c, i) => (
            <div key={i} className={`rounded ${c}`} style={{ animation: `buildBreak 5.5s ${i * 0.16}s ease-in-out infinite` }} />
          ))}
          <div className="pointer-events-none absolute inset-0" style={{ animation: "glitchFlash 5.5s ease-in-out infinite" }} />
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 h-10"
          style={{
            animation: "scanBeam 2.4s ease-in-out infinite",
            background: `linear-gradient(to bottom, transparent, ${beam}, transparent)`,
            boxShadow: `0 0 22px ${beam}`,
          }}
        />
      </div>
      <p className={`mt-2 text-xs font-bold uppercase tracking-wide ${labelColor}`}>{label}</p>
    </div>
  );
}
