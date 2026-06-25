import {
  loadTopPagesWithQueriesForTenant,
  loadDailyClicksByPagesForTenant,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import { currentTenantId } from "@/lib/tenant-context";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { buildPageMomentum, type PageMomentum } from "./today-momentum-rows";
import { recentlyShippedPageKeys } from "./today-recoveries-rows";
import { buildSparklinePaths } from "./sparkline";

/**
 * today-momentum-section (2026-06-25) — "Which pages are moving": per-page weekly
 * momentum (risers + fallers) with mini-sparklines, the drill-down the macro
 * traffic-trend CTA promises. Bounded page-filtered daily read (top pages only).
 * Deterministic; self-hides when no page has enough weekly history.
 */

function slugOf(page: string): string {
  try {
    const p = new URL(page).pathname.replace(/\/$/, "");
    return p.split("/").filter(Boolean).pop() || p || page;
  } catch {
    return page.split("/").filter(Boolean).pop() || page;
  }
}

function workbenchHref(page: string): string {
  return `/workbench?url=${encodeURIComponent(page)}`;
}

function MoverRow({ m, color, measuring }: { m: PageMomentum; color: string; measuring?: boolean }) {
  const deltaLabel = m.deltaPct > 0 ? `+${m.deltaPct}%` : `${m.deltaPct}%`;
  const netLabel = m.netChange > 0 ? `+${m.netChange}` : `${m.netChange}`;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 text-sm">
      <a href={workbenchHref(m.page)} className="flex min-w-0 items-center gap-2 font-medium text-gray-800 hover:text-gray-950" title={m.page}>
        <span className="truncate">{slugOf(m.page)}</span>
        {measuring ? (
          <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
            Measuring
          </span>
        ) : null}
      </a>
      <div className="flex shrink-0 items-center gap-3">
        <svg viewBox="0 0 80 24" className="h-6 w-20" preserveAspectRatio="none" aria-hidden="true">
          <path d={buildSparklinePaths(m.points, 80, 24, 2).line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <span className="w-16 text-right text-xs font-semibold" style={{ color }}>
          {deltaLabel}
          <span className="ml-1 font-normal text-gray-400">{netLabel}</span>
        </span>
      </div>
    </li>
  );
}

export async function TodayMomentumSection() {
  let risers: PageMomentum[] = [];
  let fallers: PageMomentum[] = [];
  let measuringKeys = new Set<string>();
  const normUrl = (u: string) => canonicalizeCitationUrl(u) ?? u;
  try {
    const tenantId = await currentTenantId();
    const pages = await loadTopPagesWithQueriesForTenant(tenantId).catch(() => []);
    const pageUrls = pages.map((p) => p.page).slice(0, 16);
    if (pageUrls.length === 0) return null;
    const [byPage, shipped] = await Promise.all([
      loadDailyClicksByPagesForTenant(tenantId, pageUrls, 70).catch(() => new Map<string, never>()),
      loadShippedChanges().catch(() => []),
    ]);
    const entries = [...byPage.entries()].map(([page, daily]) => ({ page, daily }));
    ({ risers, fallers } = buildPageMomentum(entries, { cap: 5 }));
    // A page that just had a fix shipped is mid-measurement, not "failing" — mark
    // it so the operator doesn't re-fix a page whose experiment is still running.
    measuringKeys = recentlyShippedPageKeys(
      shipped.map((s) => ({ page: s.page, shippedAt: s.shippedAt })),
      Date.now(),
      normUrl,
    );
  } catch {
    return null;
  }
  if (risers.length === 0 && fallers.length === 0) return null;

  return (
    <section className="rounded-3xl border border-gray-200/70 bg-white p-6 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <span className="text-gray-400">⇅</span> Which pages are moving
        </h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          Per-page weekly momentum over the last 8 weeks — what's gaining, what's slipping.
        </p>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {fallers.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-600">Slipping (fix first)</h3>
            <ul className="space-y-1.5">
              {fallers.map((m) => (
                <MoverRow key={m.page} m={m} color="#e11d48" measuring={measuringKeys.has(normUrl(m.page))} />
              ))}
            </ul>
          </div>
        ) : null}
        {risers.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">Gaining</h3>
            <ul className="space-y-1.5">
              {risers.map((m) => (
                <MoverRow key={m.page} m={m} color="#059669" />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
