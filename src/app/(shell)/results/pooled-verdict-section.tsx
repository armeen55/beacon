import { currentTenantId } from "@/lib/tenant-context";
import { loadLatestPooledVerdict } from "@/domains/proof-gsc/pooled-verdict-store";
import { isCalibratedPooledVerdict } from "@/domains/proof-gsc/verdict-calibration";

/**
 * pooled-verdict-section (2026-07-02, master plan item 34) - the compact "as a group" batch line
 * for /results. A daily batch ships one lever across many sibling pages at once; each page's own
 * read is individually noisy, but pooled together the batch can read a confident helped / did not
 * help / no clear lift. Self-hides when no batch has reached the pooling floor (>= 3 measured
 * pages under the same plan + lever) - see pooled-verdict-runner.ts for how the row is computed
 * and pooled-verdict.ts for the estimator itself. Read-only, $0 (reads the already-computed
 * pooled-verdicts store; no measurement here).
 */
const TONE: Record<string, string> = {
  helped: "border-emerald-200 bg-emerald-50 text-emerald-800",
  did_not_help: "border-rose-200 bg-rose-50 text-rose-800",
  no_clear_lift: "border-border bg-muted/40 text-foreground/80",
};

export async function PooledVerdictSection() {
  let row;
  try {
    const tenantId = await currentTenantId();
    row = await loadLatestPooledVerdict(tenantId);
  } catch {
    return null;
  }
  if (!row || !row.sentence) return null;

  // Fail-closed calibration quarantine (2026-07-11): the pooled sign-flip inference has not passed
  // Beacon's self-test, so an uncertified pooled row may never render a helped / did not help line
  // or any win-or-loss wording. Self-hide (honest absence) until a pooled classifier registers its
  // version in verdict-calibration.ts; from that moment a stamped row flows through unchanged.
  if (!isCalibratedPooledVerdict(row)) return null;

  const tone = TONE[row.verdict] ?? TONE.no_clear_lift!;

  return (
    <div className={`mb-5 rounded-lg border px-3.5 py-2.5 text-[13px] ${tone}`}>
      <p className="font-medium">{row.sentence}</p>
      <p className="mt-1 text-[11px] opacity-75">
        Pooled from {row.n} pages shipped together on {row.plan_date}, weighted so the steadiest
        pages count for more than the noisiest one.
      </p>
    </div>
  );
}
