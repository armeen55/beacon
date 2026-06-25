import { currentTenantId } from "@/lib/tenant-context";
import {
  loadTopDecliningPagesForTenant,
  loadTopRisingQueriesForTenant,
  loadTopPagesWithQueriesForTenant,
  loadTopStrikingPagesForTenant,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadLatestPageSnapshots } from "@/domains/recommendation-intelligence/page-freshness";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { estimatedCtr } from "@/domains/recommendation-intelligence/ctr-curve";
import { workbenchHref } from "@/domains/insight/workbench-route";
import { buildThinPages } from "./today-thin-rows";
import { buildCtrGapRows } from "./today-ctrgap-rows";
import { buildLeveragePages, type PageSignalInput, type LeveragePage } from "./today-leverage-rows";

/**
 * today-leverage-section (2026-06-25) — signal FUSION: pages that trip several
 * opportunity lenses at once (declining + thin + rising …). One edit on such a
 * page wins several ways, so it's the highest-leverage place to spend a session.
 * Reuses the request-cached lens loaders (cheap), canonicalizes to a shared key,
 * counts distinct signals per page. Self-hides when nothing is multi-signal.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  return (s.split("/").filter(Boolean).pop() || url).replace(/[-_]+/g, " ").trim() || url;
}
const SIGNAL_STYLE: Record<string, string> = {
  Declining: "bg-rose-100 text-rose-700",
  Rising: "bg-teal-100 text-teal-700",
  Thin: "bg-amber-100 text-amber-700",
  Striking: "bg-emerald-100 text-emerald-700",
  Snippet: "bg-orange-100 text-orange-700",
};

export async function TodayLeverageSection() {
  let rows: LeveragePage[] = [];
  try {
    const tenantId = await currentTenantId();
    const [declines, rising, pages, snaps, striking] = await Promise.all([
      loadTopDecliningPagesForTenant(tenantId).catch(() => []),
      loadTopRisingQueriesForTenant(tenantId).catch(() => []),
      loadTopPagesWithQueriesForTenant(tenantId).catch(() => []),
      loadLatestPageSnapshots(tenantId).catch(() => []),
      loadTopStrikingPagesForTenant(tenantId).catch(() => []),
    ]);
    const canon = (u: string) => canonicalizeCitationUrl(u) ?? u;
    const signals: PageSignalInput[] = [];
    for (const d of declines) {
      signals.push({ page: canon(d.page), signal: "Declining", clicksAtStake: d.topDecline.priorClicks });
    }
    for (const r of rising) {
      signals.push({ page: canon(r.page), signal: "Rising", clicksAtStake: r.recentClicks });
    }
    for (const s of striking) {
      // Striking-distance: a few-spot rank gain captures outsized clicks ≈ a share
      // of the impressions it already earns.
      signals.push({ page: canon(s.page), signal: "Striking", clicksAtStake: Math.round(s.topQuery.impressions * 0.1) });
    }
    // Thin needs impressions joined to snapshots.
    const imprByUrl = new Map<string, number>();
    for (const p of pages) {
      const u = canon(p.page);
      imprByUrl.set(u, (imprByUrl.get(u) ?? 0) + p.queries.reduce((s, q) => s + q.impressions, 0));
    }
    for (const t of buildThinPages(snaps.map((s) => ({ url: s.url, wordCount: s.wordCount })), imprByUrl)) {
      signals.push({ page: canon(t.url), signal: "Thin", clicksAtStake: Math.round(t.impressions * 0.15) });
    }
    // Snippet (CTR-gap) — reuse the already-loaded pages; clicksLeft is the stake.
    for (const c of buildCtrGapRows(pages, estimatedCtr)) {
      signals.push({ page: canon(c.page), signal: "Snippet", clicksAtStake: c.clicksLeft });
    }
    rows = buildLeveragePages(signals);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  return (
    <section className="rounded-3xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50/40 via-white to-violet-50/20 p-6 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <span className="text-fuchsia-500">✦</span> Highest-leverage pages — fix once, win several ways
        </h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          These pages trip more than one opportunity signal at the same time, so a single edit pays off on
          several fronts — the best place to spend today&apos;s session.
        </p>
      </div>

      <ul className="mt-4 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-fuchsia-100 bg-white/70 px-3 py-2 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{slugOf(r.page)}</span>
              {r.signals.map((sig) => (
                <span key={sig} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SIGNAL_STYLE[sig] ?? "bg-gray-100 text-gray-600"}`}>
                  {sig}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-fuchsia-600">{r.signalCount} signals · ~{fmtNum(r.clicksAtStake)} clicks</span>
              <a href={workbenchHref(r.page)} className="font-semibold text-violet-600 hover:text-violet-800">Fix →</a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
