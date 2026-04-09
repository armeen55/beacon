import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import type { CompetitorUniverseRuntime } from "./universe-types";

/** Short note when live UI classification may not match the era of a pinned run. */
export function competitorUniverseDriftNote(
  current: CompetitorUniverseRuntime,
  visibilityRun: VisibilityObservationRun | null
): string | null {
  if (!visibilityRun) return null;
  const st = visibilityRun.competitor_universe_pin_status;
  if (st === "synthetic_unpinned" || st === "legacy_unpinned" || st == null) {
    return "Visibility run is not pinned to a competitor universe — Sample history / Today domain labels use the current workspace universe and may not match historical sample era.";
  }
  if (st !== "pinned") return null;

  const cv = current.pin.universe_version;
  const cf = current.pin.universe_fingerprint;
  const rv = visibilityRun.competitor_universe_version;
  const rf = visibilityRun.competitor_universe_fingerprint;

  if (rf && cf && rf !== cf) {
    return `Visibility run pinned universe ${rf.slice(0, 18)}… (v${rv ?? "—"}) · current workspace ${cf.slice(0, 18)}… (v${cv ?? "—"}) — live competitor labels use current unless you re-pin imports.`;
  }
  if (rv != null && cv != null && rv !== cv && rf === cf) {
    return `Visibility run universe version v${rv} vs current v${cv} — fingerprint matches (metadata-only bump).`;
  }
  return null;
}

export function visibilityRunUniverseSummaryLine(
  v: VisibilityObservationRun
): string {
  const st = v.competitor_universe_pin_status;
  if (st === "synthetic_unpinned" || st == null) {
    return "Competitor universe: synthetic / unpinned — classifications in UI use current workspace universe at read time.";
  }
  if (st === "legacy_unpinned") {
    return "Competitor universe: legacy unpinned — run predates universe pinning; treat competitor labels as approximate.";
  }
  if (st === "pinned") {
    const fp = v.competitor_universe_fingerprint?.slice(0, 14) ?? "—";
    const sc = v.competitor_universe_scope ?? "—";
    return `Competitor universe: pinned · scope ${sc} · v${v.competitor_universe_version ?? "—"} · ${fp}…`;
  }
  return "Competitor universe: unknown pin state.";
}

export function websiteRunUniverseSummaryLine(run: {
  competitor_universe_pin_status?: "pinned" | "legacy_unpinned";
  competitor_universe_version?: number | null;
  competitor_universe_fingerprint?: string | null;
  competitor_universe_scope?: string | null;
}): string {
  if (
    run.competitor_universe_pin_status === "legacy_unpinned" ||
    run.competitor_universe_pin_status == null
  ) {
    return "Competitor universe: legacy unpinned (pre-pinning crawl or field missing).";
  }
  if (run.competitor_universe_pin_status === "pinned") {
    const fp = run.competitor_universe_fingerprint?.slice(0, 14) ?? "—";
    return `Competitor universe: pinned · ${run.competitor_universe_scope ?? "—"} · v${run.competitor_universe_version ?? "—"} · ${fp}…`;
  }
  return "Competitor universe: unknown pin state.";
}
