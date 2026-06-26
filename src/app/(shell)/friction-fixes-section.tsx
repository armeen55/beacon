import { currentTenantId } from "@/lib/tenant-context";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { routeClarityFriction, type ClarityMoveType } from "@/domains/recommendation-intelligence/clarity-move-router";

/**
 * friction-fixes-section (2026-06-25, Sprint 6 · plan P13) — Clarity as a Move
 * ROUTER, not just a score. For each page with friction, the router picks the
 * SPECIFIC fix (JS errors / dead click / rage / intent mismatch / buried answer)
 * from the dominant pattern. READ-ONLY, $0 (reuses the cached Clarity loader).
 * Self-hides when no page clears the friction floor.
 */

const LABELS: Record<ClarityMoveType, { title: string; hint: string; tone: string }> = {
  fix_js_errors: { title: "Fix the page's errors", hint: "Broken scripts hurt visitors and can block AI crawlers", tone: "bg-red-50 text-red-700 ring-red-200" },
  fix_dead_click: { title: "Fix a dead click near the button", hint: "People click something that looks clickable but isn't", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  fix_rage_interaction: { title: "Fix a frustrating spot", hint: "Rapid repeated clicks signal something isn't working", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  fix_intent_mismatch: { title: "Match the page to the search", hint: "Visitors leave fast — the page isn't what they expected", tone: "bg-orange-50 text-orange-700 ring-orange-200" },
  raise_answer: { title: "Move the answer higher", hint: "Visitors don't scroll far — the answer is buried", tone: "bg-blue-50 text-blue-700 ring-blue-200" },
};

export async function FrictionFixesSection() {
  let rows: { url: string; moveType: ClarityMoveType; severity: "high" | "medium"; reason: string; evidence: string }[] = [];
  try {
    const tenantId = await currentTenantId();
    const map = await loadClarityPageSignalsForTenant(tenantId);
    for (const [url, signal] of map) {
      const d = routeClarityFriction(signal);
      if (d) rows.push({ url, moveType: d.moveType, severity: d.severity, reason: d.reason, evidence: d.evidence });
    }
    rows.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">Fix what frustrates visitors</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            From how people actually behave on each page — and the exact thing to fix, not just &quot;improve UX.&quot;
          </p>
        </div>
        <span className="text-[11px] text-gray-400">{rows.length} page{rows.length === 1 ? "" : "s"} with a clear fix</span>
      </div>

      <div className="mt-5 space-y-2.5">
        {rows.slice(0, 8).map((r) => {
          const l = LABELS[r.moveType];
          return (
            <div key={r.url} className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 p-3.5">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${l.tone}`}>{r.severity === "high" ? "High" : "Medium"}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-gray-900">{l.title}</p>
                <p className="truncate text-[11px] text-gray-500">{r.url}</p>
              </div>
              <p className="basis-full text-[12px] text-gray-600 sm:basis-auto sm:text-right" style={{ maxWidth: "20rem" }}>
                {l.hint}
                <span className="mt-0.5 block text-[11px] text-gray-400">{r.evidence}</span>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
