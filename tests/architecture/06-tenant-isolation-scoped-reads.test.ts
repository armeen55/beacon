/**
 * 2026-06-10 — TENANT-ISOLATION RATCHET (audit #1/#2/#10).
 *
 * Beacon's tenant isolation is APP-LAYER ONLY: every tenant table is RLS
 * deny-all and the app reads via the service-role key, which bypasses
 * RLS. So isolation rests entirely on every tenant-data read going
 * through `getRepository().forTenant(tenantId)`. A single unscoped
 * `getRepository().getX()` returns EVERY tenant's rows — a silent
 * cross-tenant breach (proven live: the perplexity poll consumed Ritz's
 * prompts on Iranopedia's first run, fixed 2026-06-10).
 *
 * This test FREEZES the current set of unscoped tenant-data reads as a
 * documented allowlist (tech debt to burn down) and FAILS on any NEW
 * one. New code must call `.forTenant(tenantId)`. To remove an entry:
 * scope the read, then delete it from the allowlist here.
 *
 * Scope: only methods that return TENANT-OWNED rows are policed.
 * Genuinely global reads (the tenant registry itself, cross-tenant
 * aggregate stores) are not repository.getX tenant reads and don't match.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Known unscoped tenant-data reads remaining as of 2026-06-10. Each is
 * a derive-on-read module-cache store that predates multi-tenancy.
 * SHRINK THIS LIST; never grow it. Format: "relpath:getMethod".
 */
const ALLOWLIST = new Set<string>([
  // seed-data.server.ts — BURNED DOWN 2026-06-12. loadFromRepoOrSeed now
  // reads through getRepository().forTenant(tenantId) into a per-tenant
  // `_stateByTenant` Map (was the non-tenant-filtered base getRepository()
  // behind one process-global `_state`, which bled the founder's changelog
  // into every other tenant — caught on the per-tenant proof cron). All 5
  // reads are forTenant-scoped now, so the entries are removed.
  // (domains/actions/store.ts:getActionStates and
  // domains/brief-generation/store.ts:getBriefStates removed 2026-07-20:
  // the pre-ActionPack brief/action compute cluster was retired.)
  "domains/pages/asset-response.ts:getAssetResponses",
  "domains/pages/frontier-planner.ts:getFrontierOpportunities",
  "domains/pages/outcome-watch.ts:getOutcomeObservations",
  "domains/pages/wave-planner.ts:getRolloutWaves",
  "domains/observations/visibility-observation-explicit-store.ts:getVisibilityObservationRunsExplicit",
]);

/** repo getters that return TENANT-OWNED rows (must be scoped). */
/** Strip // and *-prefixed comment lines so docstrings can MENTION the
 *  unscoped pattern without tripping the ratchet (night-shift 2026-06-11:
 *  the recommendation-response-store entry was a comment false-positive). */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

const TENANT_GETTERS =
  /getRepository\(\)\.(getAssetResponses|getChangeContracts|getFrontierOpportunities|getOutcomeObservations|getRecommendationResponses|getRolloutWaves|getVisibilityObservationRunsExplicit|getTrackedPrompts|getTrackedEntities|getRecommendedEdits|getChangelogEntries|getImportRuns|getDailyMetricSnapshots|getObservationRuns|getUrlChangeOutcomes|getScanFindings|getPageSnapshots|getPageIssues|getEventDecisions|getCandidateLinks|getOpportunities|getCompetitors|getResults)\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("tenant-isolation ratchet — no unscoped tenant-data reads (audit #1/#2/#10)", () => {
  it("every getRepository().getX() tenant read is .forTenant-scoped or allowlisted", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = file.slice(SRC.length + 1);
      let m: RegExpExecArray | null;
      // Night-shift (2026-06-11): also catch the `const repo =
      // getRepository(); repo.getX()` shape — the original regex only
      // saw direct chains, which is exactly how the seed-data/issues/
      // attribution stores stayed invisible. Only applies to files
      // that actually build an UNSCOPED repo variable; the back-look
      // below still clears inline `.forTenant(...).` chains.
      const buildsUnscopedRepoVar = /=\s*getRepository\(\)\s*;/.test(src);
      const getterNames = TENANT_GETTERS.source.match(/\((get[^)]+)\)/)?.[1] ?? "";
      const scanRegexes = buildsUnscopedRepoVar
        ? [TENANT_GETTERS, new RegExp(`\\brepo\\.(${getterNames})\\(`, "g")]
        : [TENANT_GETTERS];
      for (const re of scanRegexes) {
      re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) {
        // Is THIS occurrence preceded by `.forTenant(...)`? Look back at
        // the ~80 chars before the match for the forTenant chain.
        const back = src.slice(Math.max(0, m.index - 80), m.index);
        if (/\.forTenant\([^)]*\)\.$/.test(back)) continue; // scoped — ok
        const key = `${rel}:${m[1]}`;
        if (ALLOWLIST.has(key)) continue; // known debt
        offenders.push(`${key}  (${rel})`);
      }
      }
    }
    expect(offenders, `NEW unscoped tenant-data read(s) — call .forTenant(tenantId):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("allowlist has no STALE entries (each still exists — keeps the ratchet honest)", () => {
    const stale: string[] = [];
    for (const key of ALLOWLIST) {
      const [rel, method] = key.split(":");
      let src = "";
      try {
        src = stripComments(readFileSync(join(SRC, rel!), "utf8"));
      } catch {
        stale.push(`${key} (file gone)`);
        continue;
      }
      // Match BOTH call shapes (direct chain + unscoped repo var) —
      // same coverage as the offender scan above.
      const direct = src.includes(`getRepository().${method}(`);
      const viaVar =
        /=\s*getRepository\(\)\s*;/.test(src) &&
        new RegExp(`\\brepo\\.${method}\\(`).test(src);
      if (!direct && !viaVar) {
        stale.push(`${key} (read scoped/removed — delete from allowlist)`);
      }
    }
    expect(stale, `Stale allowlist entries (good news — burn them down):\n${stale.join("\n")}`).toEqual([]);
  });
});
