import Link from "next/link";
import { currentTenantId } from "@/lib/tenant-context";
import { loadTopStrikingPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { bestTitle } from "@/domains/demand-graph/ctr-title-scorer";
import { workbenchHref } from "@/domains/insight/workbench-route";

/**
 * today-quickwins-section (2026-06-25) — "Quick CTR wins": the symmetric opposite
 * of Recover-lost-ground. Site-wide pages already ranking in striking distance
 * (position 4–15 with real demand) — a sharper title/snippet climbs a few spots
 * for outsized clicks. Bounded server-aggregated scan; self-hides when none.
 * Per B54 (every signal ships an artifact) each row carries a deterministic
 * CTR-scored title suggestion the operator can copy straight in.
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
function brandFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const label = h.split(".")[0] ?? h;
    return label.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

export async function TodayQuickWinsSection() {
  let pages: Awaited<ReturnType<typeof loadTopStrikingPagesForTenant>> = [];
  try {
    pages = await loadTopStrikingPagesForTenant(await currentTenantId());
  } catch {
    return null;
  }
  const rows = pages.slice(0, 8);
  if (rows.length === 0) return null;

  const impressionsAtStake = rows.reduce((s, r) => s + r.topQuery.impressions, 0);

  return (
    <section className="rounded-3xl border border-amber-200/70 bg-gradient-to-br from-amber-50/50 via-white to-sky-50/30 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-amber-500">↑</span> Quick CTR wins
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Pages already ranking just off the top (position 4–15) with real demand. A sharper title or
            snippet can climb a few spots and capture far more of these clicks — the fastest, highest-certainty wins.
          </p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-amber-600">~{fmtNum(impressionsAtStake)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly impressions in reach</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => {
          const suggestedTitle = bestTitle(r.topQuery.query, brandFromUrl(r.page));
          return (
            <li
              key={i}
              className="rounded-xl border border-amber-100 bg-white/70 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{r.topQuery.query}</span>
                  <span className="ml-2 text-xs text-gray-400">on {slugOf(r.page)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-semibold text-amber-600">position {r.topQuery.position.toFixed(1)}</span>
                  <span className="text-gray-500">{r.topQuery.impressions.toLocaleString()} impr/mo</span>
                  {/* Route to the per-page Workbench — the optimizer where the operator
                      actually does the work (full page picture + AI analysis). */}
                  <Link
                    href={workbenchHref(r.page)}
                    className="font-semibold text-violet-600 hover:text-violet-800"
                  >
                    Improve →
                  </Link>
                </div>
              </div>
              {/* The artifact: a CTR-scored title the operator can paste in. */}
              <div className="mt-1.5 text-xs text-gray-500">
                Try this title: <code className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">{suggestedTitle}</code>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
