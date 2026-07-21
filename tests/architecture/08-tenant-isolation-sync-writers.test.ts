/**
 * Architecture invariant — every Supabase `sync*` writer in
 * `src/lib/persistence/dual-write.ts` either:
 *   (a) takes a required `tenantId: string` parameter (tenant-scoped
 *       table; rows are stamped via `tenantizeRows` or via the row
 *       mapper before upsert), OR
 *   (b) targets a table in `GLOBAL_TABLES` (registry, singleton,
 *       global learning, or operator-shared config — no tenant_id
 *       column).
 *
 * Static analysis only — reads the dual-write.ts source and parses
 * each exported `sync*` declaration. Pinning this contract prevents
 * a future PR from adding a tenant-scoped writer that silently
 * bypasses tenantId coercion.
 *
 * Stage D1 (2026-05-09) introduces this invariant alongside the
 * `tenant_id: ""` literal-scan ratchet.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const DUAL_WRITE_PATH = join(REPO_ROOT, "src/lib/persistence/dual-write.ts");
const SOURCE = readFileSync(DUAL_WRITE_PATH, "utf-8");

/** Strip TS comments before scanning so JSDoc references don't trip
 *  the regex (same pattern as the customer-nav-exposure test). */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const STRIPPED = stripComments(SOURCE);

/** Extract the `GLOBAL_TABLES` set members. Single source of truth in
 *  dual-write.ts; this test parses it rather than duplicating the list. */
function extractGlobalTables(): Set<string> {
  const re = /export const GLOBAL_TABLES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/;
  const match = STRIPPED.match(re);
  if (!match) {
    throw new Error(
      "Could not locate `export const GLOBAL_TABLES` in dual-write.ts. " +
        "If the constant was renamed, update this test in the same commit.",
    );
  }
  const body = match[1];
  const names = [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  return new Set(names);
}

const GLOBAL_TABLES = extractGlobalTables();

/** A sync* function declaration extracted from dual-write.ts source. */
type SyncFn = {
  name: string;
  signatureBlock: string;
  bodyBlock: string;
};

/** Parse each `export async function sync<Name>( ... ): Promise<...> { ... }`.
 *  Captures the signature (param block) and body (between matching braces).
 *  Uses a paren-depth walker so signatures containing `import("...")` (which
 *  has its own parens) are captured intact. */
function extractSyncFunctions(): SyncFn[] {
  const out: SyncFn[] = [];
  const re = /export async function (sync[A-Z][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(STRIPPED)) !== null) {
    const name = m[1];
    // Walk parens to find the matching close.
    let i = m.index + m[0].length;
    const sigStart = i;
    let pDepth = 1;
    for (; i < STRIPPED.length; i++) {
      if (STRIPPED[i] === "(") pDepth++;
      else if (STRIPPED[i] === ")") {
        pDepth--;
        if (pDepth === 0) break;
      }
    }
    if (pDepth !== 0) continue;
    const signatureBlock = STRIPPED.slice(sigStart, i);
    // Walk to the body's opening brace.
    while (i < STRIPPED.length && STRIPPED[i] !== "{") i++;
    if (i >= STRIPPED.length) continue;
    let depth = 0;
    const bodyStart = i;
    for (; i < STRIPPED.length; i++) {
      if (STRIPPED[i] === "{") depth++;
      else if (STRIPPED[i] === "}") {
        depth--;
        if (depth === 0) {
          out.push({
            name,
            signatureBlock,
            bodyBlock: STRIPPED.slice(bodyStart, i + 1),
          });
          break;
        }
      }
    }
  }
  return out;
}

const SYNC_FNS = extractSyncFunctions();

/** True when the signature declares `tenantId: string` (required). */
function takesTenantId(sig: string): boolean {
  return /\btenantId:\s*string\b/.test(sig);
}

/** True when the body fail-loud-asserts that the row carries a non-empty
 *  `tenant_id`. Equivalent to taking a tenantId param at the signature
 *  level — single-row writers (e.g., syncRawPollChunk) use this pattern
 *  because there is no batch to stamp. */
function bodyAssertsTenantIdOnRow(body: string): boolean {
  // Match shapes like:
  //   if (!row.tenant_id) throw …
  //   if (!row.run_id || !row.tenant_id) { throw … }
  //   throw new Error("… tenant_id required …")
  if (/!\s*[A-Za-z_][A-Za-z0-9_]*\.tenant_id\b/.test(body)) return true;
  if (/tenant_id (?:is required|required)/i.test(body)) return true;
  return false;
}

/** Find the first `from("table_name")` or first `dualWriteUpsert*("table_name", …)`
 *  argument inside the body — that's the table this sync writes to. */
function extractWrittenTable(body: string): string | null {
  // First-priority: dualWriteUpsert / dualWriteUpsertScoped explicit calls.
  const re1 = /dualWriteUpsert(?:Scoped)?\(\s*"([a-z_]+)"/;
  const m1 = body.match(re1);
  if (m1) return m1[1];
  // Fallback: direct sb.from("table") for the few wrappers that bypass
  // the helpers (singletons + answer_texts).
  const re2 = /\.from\(\s*"([a-z_]+)"\s*\)/;
  const m2 = body.match(re2);
  if (m2) return m2[1];
  return null;
}

describe("Architecture — every sync* writer either requires tenantId or targets a global table", () => {
  it("dual-write.ts source loaded + at least 17 sync* exports detected", () => {
    // Floor 25 → 17 on 2026-07-21 (CORE 100K Lane O): the dead writers
    // syncResults, syncOpportunities, syncCompetitors, syncEventDecisions,
    // syncCandidateLinks, syncChangeContracts, syncPageIssues,
    // syncGuardrailAlerts, and syncGuardrailAlertsForUrl were deleted with
    // zero prod callers. 17 sync* exports survive; the per-writer contract
    // below is unchanged.
    expect(SYNC_FNS.length).toBeGreaterThanOrEqual(17);
  });

  it("GLOBAL_TABLES set is parsed and non-trivial (sanity)", () => {
    expect(GLOBAL_TABLES.size).toBeGreaterThanOrEqual(8);
    expect(GLOBAL_TABLES.has("tenants")).toBe(true);
    expect(GLOBAL_TABLES.has("change_patterns")).toBe(true);
  });

  it("every sync* exporter passes the contract", () => {
    const violations: Array<{
      name: string;
      table: string | null;
      tenantId: boolean;
      reason: string;
    }> = [];

    for (const fn of SYNC_FNS) {
      const tenantId = takesTenantId(fn.signatureBlock);
      const table = extractWrittenTable(fn.bodyBlock);
      const isGlobalTable = table != null && GLOBAL_TABLES.has(table);
      const bodyAssertsTenant = bodyAssertsTenantIdOnRow(fn.bodyBlock);

      // Pass condition: takes tenantId param, OR targets a global
      // table, OR fail-loud-asserts row.tenant_id in the body
      // (single-row writers).
      if (tenantId) continue;
      if (isGlobalTable) continue;
      if (bodyAssertsTenant) continue;

      // Also accept if the function never directly writes (e.g., a
      // helper that delegates) — those have no table at all and no
      // tenantId; flag them so the operator can verify.
      if (table == null) {
        violations.push({
          name: fn.name,
          table: null,
          tenantId: false,
          reason:
            "no detectable upsert target in body — verify it does not silently write",
        });
        continue;
      }

      violations.push({
        name: fn.name,
        table,
        tenantId: false,
        reason: `writes to non-global table "${table}" without tenantId parameter`,
      });
    }

    expect(
      violations,
      `${violations.length} sync* writer(s) violate the contract:\n` +
        violations
          .map(
            (v) =>
              `  ${v.name} → table=${v.table ?? "(none)"} tenantId=${v.tenantId} :: ${v.reason}`,
          )
          .join("\n"),
    ).toEqual([]);
  });

  it("the contract distinguishes tenant-scoped from global writers (sanity check)", () => {
    // A floor on each bucket so a structural change that accidentally
    // moves everyone to one bucket is caught. The global floor dropped
    // 2 -> 1 on 2026-07-21 (CORE 100K): the dead writers syncAnswerTexts,
    // syncRawPollChunk, syncCitationEvidenceIndex, syncAnswerIntelligenceIndex,
    // and syncPageVisibility were deleted with their callers, leaving
    // syncBusinessConfig as the one live global-table writer.
    // 2026-07-21 (Lane O): 9 more dead tenant-scoped writers deleted
    // (results/opportunities/competitors/attribution/candidate-link/
    // change-contract/page-issue/guardrail syncs); 16 tenant-scoped
    // writers survive, so the >= 15 floor holds unchanged.
    const tenantScoped = SYNC_FNS.filter((f) =>
      takesTenantId(f.signatureBlock),
    );
    const globalScoped = SYNC_FNS.filter((f) => {
      if (takesTenantId(f.signatureBlock)) return false;
      const t = extractWrittenTable(f.bodyBlock);
      return t != null && GLOBAL_TABLES.has(t);
    });
    expect(tenantScoped.length).toBeGreaterThanOrEqual(15);
    expect(globalScoped.length).toBeGreaterThanOrEqual(1);
  });
});
