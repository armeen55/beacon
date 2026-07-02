import { currentTenantId } from "@/lib/tenant-context";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";

/**
 * forecast-calibration-section (2026-07-02, master plan item 27) - the "How honest are my
 * forecasts" card for /proof. Compact, self-hiding: renders nothing until at least
 * MIN_SETTLED_FOR_CALIBRATION picks have settled at their 28-day window (see
 * forecast-calibration-store.ts's calibration writer). Read-only, $0 (reads the already-written
 * calibration ledger; no measurement here).
 */
export async function ForecastCalibrationSection() {
  let summary;
  try {
    const tenantId = await currentTenantId();
    const records = await loadCalibrationRecords(tenantId);
    summary = summarizeForecastCalibration(records);
  } catch {
    return null;
  }
  if (summary.settledCount < MIN_SETTLED_FOR_CALIBRATION || !summary.sentence) return null;

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-[15px] font-semibold text-gray-900">How honest are my forecasts</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{summary.sentence}</p>
      <p className="mt-2 text-[12px] text-gray-500 tabular-nums">
        Of {summary.settledCount} settled forecast{summary.settledCount === 1 ? "" : "s"}: {summary.insideCount} landed
        inside the range, {summary.aboveCount} beat it, {summary.belowCount} fell short.
      </p>
    </section>
  );
}
