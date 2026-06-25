import type { MoveCard } from "@/domains/demand-graph/move-card";

const EFFORT_STYLE: Record<MoveCard["effort"], string> = {
  quick: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  big: "bg-rose-100 text-rose-800",
};
const CONF_STYLE: Record<MoveCard["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-sky-100 text-sky-800",
  low: "bg-gray-100 text-gray-600",
};
const INTENT_LABEL: Record<MoveCard["intent"], string> = {
  informational: "learn",
  commercial: "compare/buy",
  transactional: "ready to buy",
  navigational: "find a place/action",
};

/**
 * The §7 "Move ritual" card view — the operator-facing, plain-language render of
 * the demand-graph worklist (one card per Move). Presentational only; the data is
 * formatted by formatMoveCard() in the page. Operator-gated surface.
 */
export function MoveCardList({ cards }: { cards: MoveCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((c, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${EFFORT_STYLE[c.effort]}`}>
              {c.effort === "quick" ? "quick win" : c.effort}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONF_STYLE[c.confidence]}`}>
              {c.confidence} confidence
            </span>
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              {INTENT_LABEL[c.intent]}
            </span>
          </div>

          <h3 className="text-sm font-semibold text-gray-900">{c.move}</h3>
          <p className="mt-1 text-xs text-gray-600">{c.why}</p>

          <dl className="mt-3 space-y-1.5 text-xs">
            <div>
              <dt className="font-medium text-gray-700">What wins</dt>
              <dd className="text-gray-600">{c.whatWins}</dd>
            </div>
            {c.yourGap.length > 0 ? (
              <div>
                <dt className="font-medium text-gray-700">Your gap</dt>
                <dd className="text-gray-600">
                  <ul className="ml-4 list-disc">
                    {c.yourGap.slice(0, 3).map((g, j) => (
                      <li key={j}>{g}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {c.also.length > 0 ? (
              <div>
                <dt className="font-medium text-gray-700">Also on this page</dt>
                <dd className="text-gray-500">{c.also.join(" · ")}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-gray-700">Best shape</dt>
              <dd className="text-gray-500">{c.intentHint}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Proof</dt>
              <dd className="text-gray-500">{c.proof}</dd>
            </div>
          </dl>

          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white">{c.ship}</span>
            {c.draftReady ? (
              <span className="text-[11px] text-green-700" title="A grounded outline + answer-block brief is ready — not paste-ready copy yet (LLM drafting is gated).">✓ outline ready</span>
            ) : (
              <span className="text-[11px] text-gray-400">plan first</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
