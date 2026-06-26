import { currentTenantId } from "@/lib/tenant-context";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { loadProfoundDeepSignals } from "@/domains/profound-deep/load-profound-deep";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";

/**
 * profound-deep-section (2026-06-25, Sprint 6) — surfaces the previously-DEAD Profound
 * bot + referral data: (1) AI assistants that ACTUALLY sent you visitors (the realest
 * money signal), (2) valuable pages AI crawlers aren't hitting (crawlability Moves),
 * (3) AI-source/crawler summary. READ-ONLY, $0. Self-hides when there's no data
 * (e.g. the tenant's Profound account doesn't track this site yet) — honest, no fake
 * numbers.
 */
export async function ProfoundDeepSection() {
  const operator = await isOperatorModeServer();
  let tenantId = "";
  try {
    tenantId = await currentTenantId();
  } catch {
    return null;
  }

  // Valuable pages (for crawlability gaps) — derived from the demand graph (demand =
  // value). Fail-soft to none.
  let valuablePages: { path: string; value: number }[] = [];
  try {
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    valuablePages = graph.moves
      .filter((m): m is typeof m & { ownedUrl: string } => !!m.ownedUrl)
      .map((m) => ({ path: m.ownedUrl, value: m.components?.demand ?? 1 }));
  } catch {
    /* no graph → no crawlability gaps */
  }

  let sig;
  try {
    sig = await loadProfoundDeepSignals(tenantId, valuablePages);
  } catch {
    return null;
  }
  if (!sig.hasData) return null; // no resurrected data for this tenant → stay quiet

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-violet-50/40 via-white to-gray-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">AI is sending you traffic</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Real visitors AI assistants sent to your pages, and valuable pages AI crawlers can&apos;t reach yet.
          </p>
        </div>
        <span className="text-[11px] text-gray-400">
          {fmt(sig.referralSummary.totalVisits)} AI-referred visits
          {sig.referralTrend.direction !== "unknown" ? ` (${sig.referralTrend.direction === "rising" ? "↑ rising" : sig.referralTrend.direction === "declining" ? "↓ declining" : "→ flat"})` : ""}
          {" · "}{fmt(sig.botSummary.totalHits)} crawler hits
        </span>
      </div>

      {/* AI-referral traffic by page */}
      {sig.referralsByPage.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-bold tracking-tight text-gray-800">🤖➡️ Pages AI assistants send visitors to</h3>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {sig.referralsByPage.slice(0, 6).map((p) => (
              <div key={p.path} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate text-[13px] font-semibold text-gray-900">{p.path}</span>
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200">{fmt(p.visits)} visits</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">from {p.sources.slice(0, 3).map((s) => `${s.source} (${fmt(s.visits)})`).join(", ")}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Crawlability gaps — valuable pages AI can't reach */}
      {sig.crawlabilityGaps.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-bold tracking-tight text-gray-800">🚫 Valuable pages AI crawlers aren&apos;t hitting</h3>
          <p className="mt-0.5 text-[11px] text-gray-400">These can&apos;t be cited by AI until crawlers can reach them — a technical fix.</p>
          <div className="mt-2.5 space-y-2">
            {sig.crawlabilityGaps.slice(0, 5).map((g) => (
              <div key={g.path} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate text-[13px] font-semibold text-gray-900">{g.path}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${g.severity === "high" ? "bg-red-100 text-red-800 ring-1 ring-red-300" : "bg-amber-100 text-amber-800 ring-1 ring-amber-300"}`}>
                    {g.botHits === 0 ? "0 crawls" : `${g.botHits} crawls`}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-amber-800">{g.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {operator ? (
        <p className="mt-5 text-[10px] text-gray-400">
          AI crawlers: {sig.botSummary.topBots.slice(0, 5).map((b) => `${b.bot} (${fmt(b.hits)})`).join(" · ") || "none recorded"}
        </p>
      ) : null}
    </section>
  );
}
