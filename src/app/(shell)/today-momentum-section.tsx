import {
  loadTopPagesWithQueriesForTenant,
  loadDailyClicksByPagesForTenant,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import { currentTenantId } from "@/lib/tenant-context";
import { buildPageMomentum, type PageMomentum } from "./today-momentum-rows";
import { type WeekPoint } from "./today-trend-rows";

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

/** Tiny inline sparkline path across the week points. */
function miniSpark(points: WeekPoint[], w: number, h: number, pad = 2): string {
  const max = Math.max(1, ...points.map((p) => p.clicks));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (c: number) => h - pad - (c / max) * (h - 2 * pad);
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.clicks).toFixed(1)}`).join(" ");
}

function MoverRow({ m, color }: { m: PageMomentum; color: string }) {
  const deltaLabel = m.deltaPct > 0 ? `+${m.deltaPct}%` : `${m.deltaPct}%`;
  const netLabel = m.netChange > 0 ? `+${m.netChange}` : `${m.netChange}`;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 text-sm">
      <a href={workbenchHref(m.page)} className="min-w-0 truncate font-medium text-gray-800 hover:text-gray-950" title={m.page}>
        {slugOf(m.page)}
      </a>
      <div className="flex shrink-0 items-center gap-3">
        <svg viewBox="0 0 80 24" className="h-6 w-20" preserveAspectRatio="none" aria-hidden="true">
          <path d={miniSpark(m.points, 80, 24)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
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
  try {
    const tenantId = await currentTenantId();
    const pages = await loadTopPagesWithQueriesForTenant(tenantId).catch(() => []);
    const pageUrls = pages.map((p) => p.page).slice(0, 16);
    if (pageUrls.length === 0) return null;
    const byPage = await loadDailyClicksByPagesForTenant(tenantId, pageUrls, 70).catch(
      () => new Map<string, never>(),
    );
    const entries = [...byPage.entries()].map(([page, daily]) => ({ page, daily }));
    ({ risers, fallers } = buildPageMomentum(entries, { cap: 5 }));
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
                <MoverRow key={m.page} m={m} color="#e11d48" />
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
