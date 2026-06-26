import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";

/**
 * proof-summary-section (2026-06-25) — premium "Proof at a glance" hero for /proof:
 * the Results act of the Move → Ship → Prove loop. Reads the (request-cached)
 * re-measured ledger and shows the scoreboard (winning / measuring / no-change) +
 * the confirmed wins. Read-only; self-hides when nothing is shipped yet.
 */

type Bucket = "winning" | "measuring" | "flat";

function bucketOf(verdict: string): Bucket {
  const v = verdict.toLowerCase();
  // GscProofVerdict: won | lost | measuring | inconclusive | insufficient_data.
  if (/help|won|improv|\bwin\b|lift/.test(v)) return "winning";
  // "Still measuring" = genuinely not done yet (window open, or not enough data
  // to judge). "inconclusive" is FINALIZED with no meaningful lift → that's a
  // "no clear lift" result, NOT pending — bucketing it as measuring would tell
  // the operator a finished null result is still cooking.
  if (/measur|insufficient|pending|not_enough|baseline/.test(v)) return "measuring";
  return "flat"; // nothing / hurting / lost / regressed / inconclusive (finalized null)
}

function prettyPath(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? path;
  return slug.replace(/[-_]+/g, " ").trim() || path;
}

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

export async function ProofSummarySection() {
  let records;
  try {
    const tenantId = await currentTenantId();
    records = await loadProofLedgerCached(tenantId);
  } catch {
    return null;
  }
  if (!records.length) return null;

  const buckets = { winning: 0, measuring: 0, flat: 0 };
  const wins: { path: string; actionType: string; confidence: string }[] = [];
  for (const r of records) {
    const b = bucketOf(String(r.verdict));
    buckets[b] += 1;
    if (b === "winning") wins.push({ path: r.path, actionType: r.actionType, confidence: String(r.confidence) });
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-sky-50/40 p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Proof at a glance</h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          What your shipped changes actually drove — re-measured against Google Search Console vs control
          pages, every time you load this.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatTile value={String(buckets.winning)} label="Winning ↑" accent="text-emerald-600" />
        <StatTile value={String(buckets.measuring)} label="Still measuring" accent="text-amber-600" />
        <StatTile value={String(buckets.flat)} label="No clear lift" accent="text-gray-500" />
      </div>

      {wins.length > 0 ? (
        <div className="mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">Confirmed wins</div>
          <ul className="mt-2 space-y-1.5">
            {wins.slice(0, 6).map((w, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-800">{prettyPath(w.path)}</span>
                <span className="text-xs text-emerald-700">
                  {w.actionType.replace(/_/g, " ")} · {w.confidence} confidence ✓
                </span>
              </li>
            ))}
          </ul>
          {wins.length > 6 ? (
            <p className="mt-2 text-xs text-gray-500">
              + {wins.length - 6} more confirmed {wins.length - 6 === 1 ? "win" : "wins"} (showing the top 6)
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">
          Nothing has cleared the bar yet — changes need a couple of weeks of data before a verdict lands.
        </p>
      )}
    </section>
  );
}
