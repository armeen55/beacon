import { currentTenantId } from "@/lib/tenant-context";
import { loadLatestPageSnapshots } from "@/domains/recommendation-intelligence/page-freshness";
import { loadTopPagesWithQueriesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { workbenchHref } from "@/domains/insight/workbench-route";
import { buildThinPages, thinImpressionsAtStake } from "./today-thin-rows";

/**
 * today-thin-section (2026-06-25) — "Thin pages with demand → expand them": pages
 * with a low word count that still earn real Google impressions. The ranking is
 * earned but the content under-serves the query; expanding it captures the clicks
 * the thin page leaves on the table. Joins page_snapshots word_count with per-page
 * GSC impressions. Self-hides when none / no snapshot data.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  return (s.split("/").filter(Boolean).pop() || url).replace(/[-_]+/g, " ").trim() || url;
}

export async function TodayThinSection() {
  let rows: ReturnType<typeof buildThinPages> = [];
  try {
    const tenantId = await currentTenantId();
    const [snaps, pages] = await Promise.all([
      loadLatestPageSnapshots(tenantId).catch(() => []),
      loadTopPagesWithQueriesForTenant(tenantId).catch(() => []),
    ]);
    if (snaps.length === 0) return null;
    const impressionsByUrl = new Map<string, number>();
    for (const p of pages) {
      const u = canonicalizeCitationUrl(p.page) ?? p.page;
      const impr = p.queries.reduce((s, q) => s + q.impressions, 0);
      impressionsByUrl.set(u, (impressionsByUrl.get(u) ?? 0) + impr);
    }
    rows = buildThinPages(
      snaps.map((s) => ({ url: s.url, wordCount: s.wordCount })),
      impressionsByUrl,
    );
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const atStake = thinImpressionsAtStake(rows);

  return (
    <section className="rounded-3xl border border-amber-200/70 bg-gradient-to-br from-amber-50/50 via-white to-yellow-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-amber-500">✎</span> Thin pages with demand — expand them
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            These pages are short on content but already earn real impressions — Google sends people, the page
            just under-answers them. Expanding the content (more depth, an answer block, examples) captures the
            clicks the thin page is leaving on the table.
          </p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-amber-600">~{fmtNum(atStake)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly impressions under-served</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-white/70 px-3 py-2 text-sm">
            <span className="min-w-0 font-medium text-gray-900">{slugOf(r.url)}</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-amber-600">{fmtNum(r.impressions)} impressions</span>
              <span className="text-gray-500">only {fmtNum(r.wordCount)} words — thin</span>
              <a href={workbenchHref(r.url)} className="font-semibold text-violet-600 hover:text-violet-800">Expand →</a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
