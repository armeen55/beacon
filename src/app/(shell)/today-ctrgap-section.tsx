import { currentTenantId } from "@/lib/tenant-context";
import { loadTopPagesWithQueriesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { estimatedCtr } from "@/domains/recommendation-intelligence/ctr-curve";
import { workbenchHref } from "@/domains/insight/workbench-route";
import { buildCtrGapRows, ctrGapClicksLeft } from "./today-ctrgap-rows";

/**
 * today-ctrgap-section (2026-06-25) — "Seen but not clicked": pages that already
 * RANK WELL but earn far fewer clicks than their position should — a title/snippet
 * problem, not a ranking one. The cheapest wins on the board (rank is already
 * earned). Deterministic (CTR-by-position model); self-hides when none.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export async function TodayCtrGapSection() {
  let rows: ReturnType<typeof buildCtrGapRows> = [];
  try {
    const tenantId = await currentTenantId();
    const pages = await loadTopPagesWithQueriesForTenant(tenantId).catch(() => []);
    rows = buildCtrGapRows(pages, estimatedCtr);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const clicksLeft = ctrGapClicksLeft(rows);

  return (
    <section className="rounded-3xl border border-orange-200/70 bg-gradient-to-br from-orange-50/50 via-white to-amber-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-orange-500">👁</span> Seen but not clicked
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            These pages already rank near the top — people see them in Google but don&apos;t click. The
            ranking is earned; the title or description just isn&apos;t compelling. The cheapest wins here:
            rewrite the listing, keep the rank.
          </p>
        </div>
        <div className="rounded-xl border border-orange-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-orange-600">~{fmtNum(clicksLeft)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly clicks left on the table</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium text-gray-900">{r.query}</span>
              <span className="ml-2 text-xs text-gray-400">on {slugOf(r.page)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-orange-600">position {r.position.toFixed(1)}</span>
              <span className="text-gray-500">{pct(r.actualCtr)} CTR vs ~{pct(r.expectedCtr)} expected</span>
              <a href={workbenchHref(r.page)} className="font-semibold text-violet-600 hover:text-violet-800">
                Fix snippet →
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
