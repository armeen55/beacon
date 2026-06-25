import { currentTenantId } from "@/lib/tenant-context";
import { loadGscCannibalizationForTenant } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { buildCannibalizationCaseRows } from "./today-declines-rows";

/**
 * today-cannibalization-section (2026-06-25) — "Stop competing with yourself":
 * site-wide queries where 2+ of your OWN pages co-rank and split the clicks,
 * confusing Google about the canonical page. Each row names the consolidation
 * lead + the fix (+ paste-ready internal link). GSC-grounded; self-hides when none.
 */

function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}
const canon = (u: string) => canonicalizeCitationUrl(u) ?? u;

export async function TodayCannibalizationSection() {
  let rows: ReturnType<typeof buildCannibalizationCaseRows> = [];
  try {
    const tenantId = await currentTenantId();
    const cases = await loadGscCannibalizationForTenant(tenantId).catch(() => []);
    rows = buildCannibalizationCaseRows(cases, canon, slugOf);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const clicksAtStake = rows.reduce((s, r) => s + r.clicksAtStake, 0);

  return (
    <section className="rounded-3xl border border-purple-200/70 bg-gradient-to-br from-purple-50/50 via-white to-fuchsia-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-purple-500">⚔</span> Stop competing with yourself
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Queries where two or more of your own pages rank against each other — splitting the clicks and
            confusing Google about which page to show. Consolidate to one strong page and reclaim the lost
            clicks.
          </p>
        </div>
        <div className="rounded-xl border border-purple-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-purple-600">{rows.length}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            self-competing queries · {clicksAtStake.toLocaleString()} clicks/mo split
          </div>
        </div>
      </div>

      <ul className="mt-5 space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="rounded-xl border border-purple-100 bg-white/70 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{r.query}</span>
                <span className="ml-2 text-xs text-gray-400">{r.others.length + 1} pages competing</span>
              </div>
              <span className="text-xs font-semibold text-purple-600">{r.clicksAtStake.toLocaleString()} clicks/mo split</span>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">{r.fix}</p>
            {r.linkSnippet ? (
              <code className="mt-1 block overflow-x-auto rounded bg-purple-50 px-2 py-1 text-[11px] text-purple-800">
                {r.linkSnippet}
              </code>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
