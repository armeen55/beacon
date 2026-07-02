import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  isMatureOutcome,
  type MeasurementPresentation,
} from "@/domains/proof-gsc/measurement-maturity";
import { readAaCalibration, type AaCalibrationRow } from "@/domains/proof-gsc/aa-calibration-store";
import { TARGET_FALSE_POSITIVE_RATE } from "@/domains/proof-gsc/aa-calibration";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { buildForecastHitRateLine } from "@/domains/experiments/forecast-receipts";

/**
 * proof-summary-section (2026-06-25; Move 2) — "Proof at a glance" for /proof. Counts
 * are MATURITY-STRATIFIED: only changes that reached the 28-day window with sufficient
 * data count as final outcomes (Helped / No clear lift / Did not help). Everything
 * earlier stays in "Measuring" — a 7-day signal is never tallied as a win or loss, so
 * the scoreboard can't read "2 no-lift" when those are only 7-day checkpoints. Read-only.
 */

function prettyPath(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? path;
  return slug.replace(/[-_]+/g, " ").trim() || path;
}

/**
 * Item 75's one honest sentence, extended by item 22: append the dollar sum
 * ONLY when at least one mature win actually has a dollar value (a revenue
 * model is configured and that win's lift is positive). Pulled out as a pure
 * function (no JSX, no data reads) so the append rule is unit-testable
 * without rendering the async server component.
 */
export function buildProofHonestySentence(args: {
  counts: { measuring: number; helped: number; noLift: number; didNotHelp: number };
  winsDollarUsdPerMonth: number;
  winsWithDollarCount: number;
  soonestLabel: string | null;
}): string | null {
  const { counts, winsDollarUsdPerMonth, winsWithDollarCount, soonestLabel } = args;
  const sentenceParts: string[] = [];
  if (counts.measuring > 0) sentenceParts.push(`${counts.measuring} measuring`);
  if (counts.helped > 0) sentenceParts.push(`${counts.helped} win${counts.helped === 1 ? "" : "s"}`);
  if (counts.noLift > 0) sentenceParts.push(`${counts.noLift} with no clear lift`);
  if (counts.didNotHelp > 0) sentenceParts.push(`${counts.didNotHelp} that did not help`);
  if (sentenceParts.length === 0) return null;
  // A negative sum should never append here: this clause only ever reads as
  // encouragement ("worth about $X a month"), so it appears only when the
  // real total across dollar-bearing wins is actually positive.
  const dollarClause =
    winsWithDollarCount > 0 && winsDollarUsdPerMonth > 0
      ? `, worth about $${Math.round(winsDollarUsdPerMonth).toLocaleString("en-US")} a month at your rates`
      : "";
  return `${sentenceParts.join(", ")}${dollarClause}${soonestLabel ? `, next verdicts ${soonestLabel}` : ""}.`;
}


/**
 * Item 31's one honest line: how often Beacon's own measurement calls a win
 * or a loss on pages it never touched (its empirical false-positive rate),
 * and that it tunes itself to stay under the 5% target. SILENT until a real
 * nightly pass has run at least once for this tenant (no data -> no claim).
 * Plain business words only (no "experiment/control/baseline/treatment" -
 * this surface is jargon-guarded, see proof-jargon-guard.test.ts).
 */
export function buildAaHonestySentence(row: AaCalibrationRow | null): string | null {
  if (!row || row.sampleSize <= 0) return null;
  // Same maturity bar as floor tuning (MIN_SAMPLES_TO_DERIVE): a cold-start
  // run of ~40 pages on a seasonal site reads 100 in 100 and would be
  // mistaken for "the product does not work" - the number only goes on a
  // customer surface once it means something and the tuner can act on it.
  if (row.cumulativeSampleSize < 100) return null;
  const per100 = Math.round(row.falsePositiveRate * 100);
  const targetPer100 = Math.round(TARGET_FALSE_POSITIVE_RATE * 100);
  return `We test our own measurement on pages we did not touch. Right now it cries wolf ${per100} ${
    per100 === 1 ? "time" : "times"
  } in 100, and we tune it to stay under ${targetPer100}.`;
}

export async function ProofSummarySection() {
  let records;
  let latestGsc: string | null = null;
  let aaCalibration: AaCalibrationRow | null = null;
  let forecastHitRateLine: string | null = null;
  try {
    const tenantId = await currentTenantId();
    records = await loadProofLedgerCached(tenantId);
    latestGsc = await readLastFinalizedDate(tenantId).catch(() => null);
    aaCalibration = await readAaCalibration(tenantId).catch(() => null);
    // Item 42 - the running forecast hit-rate line, sibling to the honesty sentence below.
    // Same store + same MIN_SETTLED_FOR_CALIBRATION threshold as the /proof aggregate card
    // (forecast-calibration-section.tsx), so the two surfaces self-hide and reappear together.
    const calibrationRecords = await loadCalibrationRecords(tenantId).catch(() => []);
    forecastHitRateLine = buildForecastHitRateLine(calibrationRecords);
  } catch {
    return null;
  }
  if (!records.length) return null;

  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const presOf = (r: (typeof records)[number]): MeasurementPresentation => {
    const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
    return buildMeasurementPresentation({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: latestGsc,
      windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: basisWin?.controlsUsed ?? 0,
      baselineImpressions: r.baseline?.impressions ?? 0,
      overlap: overlaps.get(r.id) ?? null,
      live: true,
      // Parallel-trends veto (master plan item 33), additive: a mature win
      // whose comparison pages were a fallback match still counts toward the
      // at-a-glance totals below (this section counts outcomes, it doesn't
      // gate learning), but the flag rides along so future counts can split
      // on it without another data pass.
      weakComparison: r.controlMatchWeak === true,
    });
  };

  const counts = { measuring: 0, helped: 0, noLift: 0, didNotHelp: 0, attributionLimited: 0 };
  const wins: { path: string; actionType: string; confidence: string }[] = [];
  // Item 22: sum the dollar value of every mature win that has one (positive
  // lift + the operator has a revenue model set), so the honesty sentence can
  // append one plain money line without ever projecting off a measuring row.
  let winsDollarUsdPerMonth = 0;
  let winsWithDollarCount = 0;
  for (const r of records) {
    const p = presOf(r);
    if (p.attributionQuality === "limited") counts.attributionLimited += 1;
    if (!isMatureOutcome(p.maturity)) {
      counts.measuring += 1;
      continue;
    }
    if (p.verdict === "helped") {
      counts.helped += 1;
      wins.push({ path: r.path, actionType: r.actionType, confidence: p.confidence });
      const usd = r.dollarValue?.usdPerMonth;
      if (usd != null && usd > 0) {
        winsDollarUsdPerMonth += usd;
        winsWithDollarCount += 1;
      }
    } else if (p.verdict === "did_not_help") counts.didNotHelp += 1;
    else counts.noLift += 1;
  }
  const matureTotal = counts.helped + counts.noLift + counts.didNotHelp;

  // Items 73 + 75 - the upcoming read dates: every un-ran 7/14/28 window projects a calendar
  // date (shippedAt + day). The strip shows the next 14 days; the sentence names the soonest.
  const DAY_MS = 86_400_000;
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const readsByDay = new Map<string, number>();
  let soonestMs: number | null = null;
  for (const r of records) {
    const shipMs = Date.parse(r.shippedAt.slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(shipMs)) continue;
    for (const w of r.windows ?? []) {
      if (w.ran) continue;
      const dueMs = shipMs + w.day * DAY_MS;
      const clampedMs = Math.max(dueMs, todayMs); // overdue reads land "today" (GSC lag)
      const key = new Date(clampedMs).toISOString().slice(0, 10);
      if (clampedMs < todayMs + 14 * DAY_MS) readsByDay.set(key, (readsByDay.get(key) ?? 0) + 1);
      if (soonestMs == null || clampedMs < soonestMs) soonestMs = clampedMs;
    }
  }
  const soonestLabel =
    soonestMs == null
      ? null
      : soonestMs <= todayMs
        ? "any day now"
        : new Date(soonestMs).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const calendarDays = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(todayMs + i * DAY_MS);
    return {
      key: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" }),
      dayNum: d.getUTCDate(),
      reads: readsByDay.get(d.toISOString().slice(0, 10)) ?? 0,
    };
  });
  // Item 75 - one honest sentence instead of four stat tiles. Item 22 extends
  // it with the dollar sum, ONLY when at least one mature win has one.
  const honestySentence = buildProofHonestySentence({
    counts,
    winsDollarUsdPerMonth,
    winsWithDollarCount,
    soonestLabel,
  });
  // Item 31 - Beacon's own measured false-positive rate, silent until a real
  // nightly A/A pass has run at least once for this tenant.
  const aaSentence = buildAaHonestySentence(aaCalibration);

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-sky-50/40 p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Proof at a glance</h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          What your shipped changes actually drove, re-measured against Search Console vs comparison pages you did not change.
          Only changes that reach the full 28-day window count as final results; the rest are still measuring.
        </p>
      </div>

      {honestySentence ? (
        <p className="mt-4 text-[15px] font-semibold text-gray-800 tabular-nums dark:text-neutral-200">{honestySentence}</p>
      ) : null}

      {/* Item 31 - Beacon's own measured false-positive rate (silent without data). */}
      {aaSentence ? (
        <p className="mt-2 text-[12px] text-gray-500 tabular-nums dark:text-neutral-400">{aaSentence}</p>
      ) : null}

      {/* Item 42 - the running forecast hit-rate line, next to the honesty sentence above.
          Self-hides below MIN_SETTLED_FOR_CALIBRATION settled calibration records, the same
          threshold the /proof aggregate card uses, so the two never contradict each other. */}
      {forecastHitRateLine ? (
        <p className="mt-2 text-[12px] font-medium text-gray-600 tabular-nums dark:text-neutral-300">
          {forecastHitRateLine}
        </p>
      ) : null}

      {/* Item 73 - the verdict calendar: the next 14 days, a dot per scheduled read, so the
          operator knows exactly when to come back. */}
      {readsByDay.size > 0 ? (
        <div className="mt-3 flex items-end gap-1" role="img" aria-label="Upcoming result reads over the next 14 days">
          {calendarDays.map((d, i) => (
            <div key={d.key} className="flex w-7 flex-col items-center gap-0.5" title={d.reads > 0 ? `${d.reads} read${d.reads === 1 ? "" : "s"} due ${d.key}` : d.key}>
              <div className="flex h-4 items-end gap-0.5">
                {Array.from({ length: Math.min(d.reads, 3) }, (_, j) => (
                  <span key={j} className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
                ))}
                {d.reads > 3 ? <span className="text-[9px] font-semibold text-indigo-600 tabular-nums">+{d.reads - 3}</span> : null}
              </div>
              <span className={`text-[9px] tabular-nums ${i === 0 ? "font-bold text-gray-700 dark:text-neutral-200" : "text-gray-400 dark:text-neutral-500"}`}>{d.weekday}{d.dayNum}</span>
            </div>
          ))}
        </div>
      ) : null}
      {counts.attributionLimited > 0 ? (
        <p className="mt-3 text-xs text-amber-700">
          {counts.attributionLimited} measurement{counts.attributionLimited === 1 ? "" : "s"} are directional only,
          because another edit overlapped the same page, so attribution is weakened.
        </p>
      ) : null}

      {matureTotal === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No mature results yet. Your active changes are still collecting data. Search Console needs the full
          28-day window before a final verdict lands.
        </p>
      ) : wins.length > 0 ? (
        <div className="mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">Confirmed wins (28-day)</div>
          <ul className="mt-2 space-y-1.5">
            {wins.slice(0, 6).map((w, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-800">{prettyPath(w.path)}</span>
                <span className="text-xs text-emerald-700">
                  {w.actionType.replace(/_/g, " ")} · {w.confidence} confidence
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
          {matureTotal} mature {matureTotal === 1 ? "result" : "results"} so far. None cleared the win bar.
        </p>
      )}
    </section>
  );
}
