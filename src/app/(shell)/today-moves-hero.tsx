import Link from "next/link";
import { loadTodayMovesHeroData, type TodayMove } from "./today-moves-data";

/**
 * today-moves-hero (2026-06-24) — the premium "Today's Moves" ritual hero that
 * leads the cockpit. Renders the live Rank-&-Revenue Moves (demand-graph engine,
 * now flowing into the real queue) as rich §7 cards: the move, why now, who AI
 * cites instead + what wins, the grounded outline, the proof plan, and a one-tap
 * route to ship. Silent (renders nothing) when the engine is off for the tenant.
 */

const TONE: Record<
  TodayMove["actionTone"],
  { bar: string; pill: string; ring: string; dot: string }
> = {
  citation: {
    bar: "bg-gradient-to-b from-violet-500 to-indigo-500",
    pill: "bg-violet-50 text-violet-700 ring-violet-200",
    ring: "hover:ring-violet-200",
    dot: "bg-violet-500",
  },
  clicks: {
    bar: "bg-gradient-to-b from-sky-500 to-blue-600",
    pill: "bg-sky-50 text-sky-700 ring-sky-200",
    ring: "hover:ring-sky-200",
    dot: "bg-sky-500",
  },
  experience: {
    bar: "bg-gradient-to-b from-amber-400 to-orange-500",
    pill: "bg-amber-50 text-amber-700 ring-amber-200",
    ring: "hover:ring-amber-200",
    dot: "bg-amber-500",
  },
  page: {
    bar: "bg-gradient-to-b from-emerald-400 to-green-600",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ring: "hover:ring-emerald-200",
    dot: "bg-emerald-500",
  },
};

const CONF: Record<TodayMove["confidence"], { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  medium: { label: "Medium confidence", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  low: { label: "Worth a look", cls: "bg-gray-100 text-gray-600 ring-gray-200" },
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white/70 px-4 py-3">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

function MoveCard({ m, rank }: { m: TodayMove; rank: number }) {
  const tone = TONE[m.actionTone];
  const conf = CONF[m.confidence];
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 pl-6 shadow-sm ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg ${tone.ring}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${tone.bar}`} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
          {rank}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${tone.pill}`}>
          {m.actionLabel}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${conf.cls}`}>
          {conf.label}
        </span>
        {m.demand != null && m.demand > 0 ? (
          <span className="rounded-full bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
            {fmtNum(m.demand)} {m.demandBasis === "ai_attention" ? "AI demand" : "monthly demand"}
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-gray-900">
        {titleCase(m.query)}
      </h3>
      <p className="mt-0.5 text-xs text-gray-400">on {m.pageLabel}</p>

      <p className="mt-2 text-sm leading-relaxed text-gray-600">{m.why}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Who AI cites now
          </div>
          <div className="mt-0.5 text-sm font-medium text-gray-700">
            {m.whoCited ? (
              m.whoCited
            ) : m.looselyMatched ? (
              <span className="text-gray-500">AI cites a tangential page — confirm with a quick search</span>
            ) : (
              <span className="text-emerald-600">Open — no one owns this yet</span>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            What wins
          </div>
          <div className="mt-0.5 text-sm font-medium text-gray-700">
            {m.whatWins ? m.whatWins : <span className="text-gray-400">Add a clear, quotable answer up top</span>}
          </div>
        </div>
      </div>

      {m.outline.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Cover</span>
          {m.outline.map((o, i) => (
            <span
              key={i}
              className="rounded-md bg-white px-2 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200"
            >
              {o}
            </span>
          ))}
        </div>
      ) : null}

      {m.proof ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
          {m.proof}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
        <Link
          href="/recommendations"
          className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700"
        >
          Review &amp; ship →
        </Link>
        <a
          href={m.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          View page ↗
        </a>
      </div>
    </div>
  );
}

export async function TodayMovesHeroSection() {
  let data;
  try {
    data = await loadTodayMovesHeroData();
  } catch {
    return null; // never break the cockpit on a moves-hero load failure
  }
  if (!data.moves.length) return null;

  const { moves, stats } = data;
  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-gray-50 via-white to-violet-50/40 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
            </span>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">Today&apos;s Moves</h2>
          </div>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            The highest-leverage moves Beacon found across your Google + AI demand — each with who
            wins it now, what it takes, and how you&apos;ll know it worked. Review, then ship.
          </p>
        </div>
        <Link
          href="/recommendations"
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
        >
          See all in the queue →
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(stats.movesReady)} label="Moves ready" accent="text-gray-900" />
        <StatTile value={fmtNum(stats.demandAtStake)} label="Monthly demand at stake" accent="text-sky-600" />
        <StatTile value={String(stats.citationsContested)} label="AI citations to win" accent="text-violet-600" />
        <StatTile value={String(stats.pagesCovered)} label="Pages" accent="text-emerald-600" />
      </div>

      <div className="mt-5 grid gap-3">
        {moves.map((m, i) => (
          <MoveCard key={m.id} m={m} rank={i + 1} />
        ))}
      </div>
    </section>
  );
}
