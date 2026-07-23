/**
 * investigation/run-investigation (2026-07-02, master plan item 53) - the
 * nightly trigger + orchestrator. Fired from cron-sync.ts as an isolated
 * phase AFTER the family-collapse detector (family-collapse.ts) and the
 * algorithm-weather guard (item 32, already computed by an earlier phase)
 * have both run for the night.
 *
 * Trigger condition: a HIGH-severity family collapse (dropped >= 60 percent
 * week over week off a real baseline - family-collapse.ts's
 * COLLAPSE_HIGH_DROP) OR a high-magnitude sitewide changepoint (item 32's
 * CUSUM alarm, magnitude >= HIGH_MAGNITUDE_THRESHOLD) fires an investigation.
 * A sitewide changepoint alone has no single family to investigate, so it
 * investigates the single biggest family by clicks (the family most exposed
 * to a sitewide drop) - this keeps the "changepoint detector also triggers
 * an investigation" contract from the plan without inventing a family that
 * doesn't exist.
 *
 * Bounds: MAX_INVESTIGATIONS_PER_NIGHT (2), and idempotent per (family, week)
 * via investigation-store.ts's key - a family that already collapsed this
 * week is never re-investigated even if it fires again tomorrow.
 *
 * $0: every collector is either a live polite fetch (free HTTP) or a cached
 * read (SERP history, push ledger, algorithm-weather store) - see
 * collect-evidence.ts's header for the full accounting.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  detectFamilyCollapses,
  biggestFamilyTarget,
  COLLAPSE_HIGH_DROP,
  type FamilyCollapse,
  type FamilyTarget,
} from "./family-collapse";
import { loadFamilyDailyRows } from "./load-family-rows";
import { rankCauses, type InvestigationFindings } from "./rank-causes";
import {
  collectIndexabilityEvidence,
  collectSerpEvidence,
  collectRecentChangeEvidence,
  collectWeatherEvidence,
} from "./collect-evidence";
import { hasRecentInvestigation, writeInvestigation, investigationKey } from "./investigation-store";
import { readAlgorithmWeatherSummary } from "@/domains/algorithm-weather/algorithm-weather-store";
import type { Changepoint } from "@/domains/algorithm-weather/changepoint";

/** Cap: at most this many fresh investigations run per tenant per night. */
export const MAX_INVESTIGATIONS_PER_NIGHT = 2;
/** A sitewide CUSUM changepoint at/beyond this magnitude (fraction of the
 *  trailing mean, matches changepoint.ts's own units) counts as high severity
 *  on its own, even with no family-level collapse detected. */
export const CHANGEPOINT_HIGH_MAGNITUDE = 0.5;

export type InvestigationTrigger =
  | { source: "family_collapse"; collapse: FamilyCollapse }
  | { source: "sitewide_changepoint"; changepoint: Changepoint; family: FamilyTarget | null };

/**
 * PURE: decide which collapses/changepoints actually warrant an investigation
 * tonight, deduplicated by family (a family already covered by its own
 * collapse never also fires the sitewide-changepoint path), ranked
 * highest-severity first, capped at `max`. Exported for unit testing the
 * trigger logic without any I/O.
 */
export function selectTriggers(args: {
  collapses: ReadonlyArray<FamilyCollapse>;
  sitewideChangepoints: ReadonlyArray<Changepoint>;
  /** The single biggest-clicks family across ALL loaded rows (not just
   *  collapsing ones), used as the sitewide-changepoint investigation target
   *  when no family-level collapse already covers it. Null when there is no
   *  family data at all. */
  biggestFamily: FamilyTarget | null;
  max?: number;
}): InvestigationTrigger[] {
  const max = args.max ?? MAX_INVESTIGATIONS_PER_NIGHT;
  const out: InvestigationTrigger[] = [];
  const coveredFamilies = new Set<string>();

  const highCollapses = [...args.collapses]
    .filter((c) => c.severity === "high" && c.dropPct <= -COLLAPSE_HIGH_DROP)
    .sort((a, b) => a.dropPct - b.dropPct); // most negative (biggest drop) first
  for (const c of highCollapses) {
    if (out.length >= max) break;
    out.push({ source: "family_collapse", collapse: c });
    coveredFamilies.add(c.family);
  }

  const highChangepoints = args.sitewideChangepoints
    .filter((cp) => cp.direction === "down" && cp.magnitude >= CHANGEPOINT_HIGH_MAGNITUDE)
    .sort((a, b) => b.magnitude - a.magnitude);
  for (const cp of highChangepoints) {
    if (out.length >= max) break;
    if (args.biggestFamily && coveredFamilies.has(args.biggestFamily.family)) continue; // already investigating this family
    out.push({ source: "sitewide_changepoint", changepoint: cp, family: args.biggestFamily });
    if (args.biggestFamily) coveredFamilies.add(args.biggestFamily.family);
  }

  return out.slice(0, max);
}

/** PURE: the effective family + collapse date + drop fraction for a trigger,
 *  regardless of which source fired it. Null family (no page data at all)
 *  means the trigger can't be investigated (nothing to fetch/check). */
function targetOf(trigger: InvestigationTrigger): { family: string; pages: string[]; collapseDate: string; dropPct: number | null } | null {
  if (trigger.source === "family_collapse") {
    return {
      family: trigger.collapse.family,
      pages: trigger.collapse.pages,
      collapseDate: trigger.collapse.collapseDate,
      dropPct: trigger.collapse.dropPct,
    };
  }
  if (!trigger.family) return null;
  return {
    family: trigger.family.family,
    pages: trigger.family.pages,
    collapseDate: trigger.changepoint.date,
    dropPct: null,
  };
}

export type InvestigationRunResult = {
  triggered: number;
  investigated: number;
  skippedIdempotent: number;
  errors: number;
};

/**
 * Run tonight's investigation pass for one tenant. Detects family collapses
 * fresh (bounded read), reads the already-computed sitewide changepoints
 * (item 32's nightly pass, no re-detection), selects up to
 * MAX_INVESTIGATIONS_PER_NIGHT triggers, skips anything already investigated
 * this (family, week), and for the rest: collects evidence, ranks causes,
 * and persists a diagnosis card. Every step is fail-soft; one investigation's
 * failure never blocks another.
 */
export async function runInvestigationForTenant(tenantId: string, now: Date = new Date()): Promise<InvestigationRunResult> {
  const result: InvestigationRunResult = { triggered: 0, investigated: 0, skippedIdempotent: 0, errors: 0 };
  if (!tenantId) return result;

  let collapses: FamilyCollapse[] = [];
  let biggestFamily: FamilyTarget | null = null;
  try {
    const rows = await loadFamilyDailyRows(tenantId);
    collapses = detectFamilyCollapses(rows);
    // The sitewide-changepoint target comes from ALL loaded rows, not just
    // collapsing families - a sitewide drop needs a target even when no
    // single family tripped its own collapse threshold.
    biggestFamily = biggestFamilyTarget(rows);
  } catch (e) {
    log.warn("[investigation] family collapse detection failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  let sitewideChangepoints: Changepoint[] = [];
  try {
    const weather = await readAlgorithmWeatherSummary(tenantId, now);
    sitewideChangepoints = weather?.clicksChangepoints ?? [];
  } catch (e) {
    log.warn("[investigation] weather read failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  const triggers = selectTriggers({ collapses, sitewideChangepoints, biggestFamily });
  result.triggered = triggers.length;

  for (const trigger of triggers) {
    const target = targetOf(trigger);
    if (!target) continue;
    try {
      const already = await hasRecentInvestigation(tenantId, target.family, target.collapseDate);
      if (already) {
        result.skippedIdempotent += 1;
        continue;
      }

      const [indexability, serp, recentChanges, weatherFindings] = await Promise.all([
        collectIndexabilityEvidence(target.pages, now),
        collectSerpEvidence(tenantId, target.pages, target.collapseDate, now),
        collectRecentChangeEvidence(tenantId, target.pages, target.collapseDate),
        collectWeatherEvidence(tenantId, target.collapseDate),
      ]);

      const findings: InvestigationFindings = {
        familyLabel: target.family,
        collapseDate: target.collapseDate,
        clicksDropPct: target.dropPct,
        indexability,
        serp,
        recentChanges,
        weather: weatherFindings,
      };
      const diagnosis = rankCauses(findings);

      await writeInvestigation({
        tenant_id: tenantId,
        key: investigationKey(target.family, target.collapseDate),
        family: target.family,
        collapse_date: target.collapseDate,
        investigated_at: now.toISOString(),
        diagnosis,
      });
      result.investigated += 1;
      log.info("[investigation] diagnosis filed", {
        tenantId,
        family: target.family,
        source: trigger.source,
        hasCause: diagnosis.hasCause,
        topCause: diagnosis.causes[0]?.kind ?? null,
      });
    } catch (e) {
      result.errors += 1;
      log.warn("[investigation] investigation failed", {
        tenantId,
        family: target.family,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  return result;
}
