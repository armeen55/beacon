/**
 * Architecture invariant — no raw prompt UUID may reach an operator-
 * visible SHIP-AS-IS or attribution field on an active recommended_edits
 * row.
 *
 * Operator M2 contract (2026-05-05, post-audit):
 *   "Active recommended_edits MUST NOT contain raw prompt UUIDs in
 *    operator-visible fields. Internal evidence arrays + debug
 *    diagnostics keep raw IDs."
 *
 * Layer model (forward-pinning, no production-data mutation):
 *
 *   1. RUNTIME SANITIZER (sanitizeOperatorEvidenceText) — defense in
 *      depth at the drawer + at save time. Drops UUIDs into a snippet
 *      lookup or a "prompt evidence" placeholder before the operator
 *      sees them. Tested in src/domains/recommendations/copy-sanitize.test.ts.
 *
 *   2. THIS TEST — pins the persisted queue. Active rows
 *      (`recommended` / `accepted` / `verified_live` /
 *      `verified_live_modified`) MUST NOT contain a UUID-shaped
 *      substring on any field that flows to the operator UNCHANGED:
 *
 *        • `display_label`     — chip text on the action table row
 *        • `proposed_text`     — ship-as-is body the operator pastes
 *        • `current_text`      — ship-as-is "before" body
 *        • `expected_impact`   — narrative attribution copy
 *        • `measurement_plan`  — narrative attribution copy
 *
 *      `why` is INTENTIONALLY excluded. The operator's brief said:
 *      "Run sanitizer on … why text … if rendered." `why` is always
 *      routed through `sanitizeOperatorEvidenceText` at render time,
 *      so historical UUIDs in persisted `why` strings don't reach the
 *      operator surface. A separate informational test below counts
 *      legacy `why` leaks without failing the build — operator
 *      constraint "no recommendation queue mutation" forbids
 *      rewriting those rows.
 *
 *   3. INTERNAL ARRAYS — `evidence: [{type:"prompt", promptId:UUID}]`
 *      and the various `live_*` debug columns are intentionally NOT
 *      inspected; raw IDs are the audit trail.
 *
 * If this test ever fails, the UUID leak is back. Do not relax it;
 * fix the root cause (a generator that emitted UUIDs into a ship-as-is
 * field, or a sanitizer that didn't run at save time).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { containsUuid } from "@/domains/recommendations/copy-sanitize";

const REPO_ROOT = resolve(__dirname, "../..");
const TENANTS_DIR = join(REPO_ROOT, ".data/tenants");

// Ship-as-is + attribution fields that flow to the operator without
// passing through the runtime sanitizer. UUIDs here are unambiguously
// a bug.
const SHIP_AS_IS_FIELDS = [
  "display_label",
  "proposed_text",
  "current_text",
  "expected_impact",
  "measurement_plan",
] as const;

// Statuses that count as "active" for this invariant. Dismissed rows
// are pre-M2 history; we leave them alone.
const ACTIVE_STATUSES = new Set([
  "recommended",
  "accepted",
  "verified_live",
  "verified_live_modified",
]);

describe("Architecture — no UUID in ship-as-is fields of active recs", () => {
  const tenantDirs = (() => {
    if (!existsSync(TENANTS_DIR)) return [];
    return readdirSync(TENANTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(TENANTS_DIR, entry.name));
  })();

  const queueFiles = tenantDirs.filter((tenantDir) =>
    existsSync(join(tenantDir, "recommended-edits.json")),
  );

  if (queueFiles.length === 0) {
    it("no tenant queues present — skipping queue audit", () => {
      expect(queueFiles).toEqual([]);
    });
    return;
  }

  for (const tenantDir of queueFiles) {
    const editsPath = join(tenantDir, "recommended-edits.json");
    if (!existsSync(editsPath)) continue;
    const tenantSlug = tenantDir.split("/").pop() ?? "(unknown)";

    it(`${tenantSlug} active recs contain zero raw UUIDs in ship-as-is fields`, () => {
      let edits: Array<Record<string, unknown>> = [];
      try {
        edits = JSON.parse(readFileSync(editsPath, "utf-8"));
      } catch (err) {
        throw new Error(
          `Failed to parse ${editsPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const violations: Array<{
        id: string;
        status: string;
        field: string;
        snippet: string;
      }> = [];

      for (const edit of edits) {
        const status = edit.implementation_status as string | undefined;
        if (!status || !ACTIVE_STATUSES.has(status)) continue;

        for (const field of SHIP_AS_IS_FIELDS) {
          const text = edit[field];
          if (typeof text !== "string" || text.length === 0) continue;
          if (containsUuid(text)) {
            violations.push({
              id: String(edit.id ?? "(unknown)"),
              status,
              field,
              snippet: text.slice(0, 160),
            });
          }
        }
      }

      expect(
        violations,
        `Found ${violations.length} active rec(s) with raw UUIDs in ship-as-is fields. ` +
          `The fields ${SHIP_AS_IS_FIELDS.join(", ")} flow to the operator ` +
          `unchanged; UUIDs there are unambiguously a leak. Internal ` +
          `evidence arrays + debug diagnostics keep raw IDs. ` +
          `Violations: ${JSON.stringify(violations, null, 2)}`,
      ).toEqual([]);
    });
  }
});

/**
 * Informational counter — pre-M2 generators wrote UUIDs into `why`
 * strings. The runtime sanitizer scrubs those at render, so they don't
 * reach the operator surface. The operator constraint "no
 * recommendation queue mutation" forbids rewriting those rows. This
 * test reports the count without failing the build, so a regression in
 * the runtime sanitizer (or a future generator that re-introduces the
 * pattern) shows up as a rising count rather than a silent fix-required
 * state.
 *
 * As of M2 cutover (2026-05-05): expected count is up to ~10 on the
 * Ritz tenant. Anything higher means a NEW leak landed and the runtime
 * sanitizer / save-time sanitizer must be re-checked.
 *
 * LLM-DryRun-2 cutover (2026-05-05): the validator now rejects edits
 * whose `why` contains a UUID before they ever land in the file. The
 * separate `LLM-DryRun-2 — no LLM-source UUID-in-why row` invariant
 * below pins this forward contract: any active row with
 * `source: "openai"` (or any future LLM provider) must have a clean
 * why. Pre-LLM-DryRun-2 rows source-tagged `deterministic` /
 * `operator_edited` / `historical_recovered` keep their cap-of-10
 * legacy ceiling.
 */
describe("Diagnostic — legacy UUID leaks in `why` (sanitized at render)", () => {
  const tenantDirs = (() => {
    if (!existsSync(TENANTS_DIR)) return [];
    return readdirSync(TENANTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(TENANTS_DIR, entry.name));
  })();

  const queueFiles = tenantDirs.filter((tenantDir) =>
    existsSync(join(tenantDir, "recommended-edits.json")),
  );

  if (queueFiles.length === 0) {
    it("no tenant queues — skipping legacy-why count", () => {
      expect(queueFiles).toEqual([]);
    });
    return;
  }

  for (const tenantDir of queueFiles) {
    const editsPath = join(tenantDir, "recommended-edits.json");
    if (!existsSync(editsPath)) continue;
    const tenantSlug = tenantDir.split("/").pop() ?? "(unknown)";

    it(`${tenantSlug} legacy \`why\` leaks stay at-or-below the M2 cutover baseline`, () => {
      let edits: Array<Record<string, unknown>> = [];
      try {
        edits = JSON.parse(readFileSync(editsPath, "utf-8"));
      } catch {
        return;
      }
      let leakCount = 0;
      for (const edit of edits) {
        const status = edit.implementation_status as string | undefined;
        if (!status || !ACTIVE_STATUSES.has(status)) continue;
        const why = edit.why;
        if (typeof why === "string" && containsUuid(why)) leakCount += 1;
      }
      // M2 cutover (2026-05-05): up to 10 is the legacy ceiling. New
      // generators / providers must not push this number up; the
      // runtime sanitizer scrubs them at render so the operator never
      // sees a UUID either way.
      expect(
        leakCount,
        `${tenantSlug}: \`why\` UUID leak count ${leakCount} exceeds the M2 ` +
          `cutover ceiling (10). The runtime sanitizer scrubs these at ` +
          `render, but a rising count means a NEW path is writing UUIDs ` +
          `into \`why\` — re-check the deterministic generators and the ` +
          `OpenAI provider system prompt.`,
      ).toBeLessThanOrEqual(10);
    });
  }
});

/**
 * LLM-DryRun-2 cutover invariant (operator audit, 2026-05-05).
 *
 * After LLM-DryRun-2, the validator rejects edits with raw prompt
 * UUIDs in `why` / `expectedImpact` / `measurementPlan` (see
 * `validateNoUuidInOperatorCopy` in specific-edit-validator.ts). This
 * means NO new LLM-sourced edit should ever reach the persisted store
 * with a UUID-bearing why.
 *
 * Pre-cutover legacy rows: per operator constraint "no recommendation
 * queue mutation," we DO NOT rewrite the existing
 * `.data/tenants/<slug>/recommended-edits.json` rows that pre-date this
 * validator gate. The Ritz tenant has 9 pre-cutover LLM-sourced rows
 * with UUIDs in `why` from earlier dogfood runs — those stay,
 * sanitized at render via the M2 sanitizer.
 *
 * The forward contract this invariant pins: the LLM-sourced UUID-
 * in-why count MUST NOT grow above the pre-cutover baseline (9 on the
 * Ritz tenant). Any NEW LLM-sourced row with a UUID in `why` would
 * push the count above the ceiling and fail this test loud — that's
 * the signal of a validator regression.
 */
describe("Architecture — LLM-DryRun-2: no NEW LLM-source UUID-in-why row", () => {
  const tenantDirs = (() => {
    if (!existsSync(TENANTS_DIR)) return [];
    return readdirSync(TENANTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(TENANTS_DIR, entry.name));
  })();

  const queueFiles = tenantDirs.filter((tenantDir) =>
    existsSync(join(tenantDir, "recommended-edits.json")),
  );

  if (queueFiles.length === 0) {
    it("no tenant queues — skipping LLM-source UUID-in-why audit", () => {
      expect(queueFiles).toEqual([]);
    });
    return;
  }

  // LLM source values — extend if a future provider lands.
  const LLM_SOURCES = new Set(["openai", "anthropic"]);

  // LLM-DryRun-2 cutover baseline: pre-validator-gate, the Ritz tenant
  // had 9 LLM-sourced rows with UUID-bearing `why` from earlier
  // dogfood runs. New rows after the cutover MUST NOT push the count
  // higher — the new validator gate (validateNoUuidInOperatorCopy)
  // rejects them at validation time.
  const PRE_CUTOVER_LLM_UUID_IN_WHY_CEILING = 9;

  for (const tenantDir of queueFiles) {
    const editsPath = join(tenantDir, "recommended-edits.json");
    if (!existsSync(editsPath)) continue;
    const tenantSlug = tenantDir.split("/").pop() ?? "(unknown)";

    it(`${tenantSlug} LLM-source UUID-in-why count stays at-or-below the LLM-DryRun-2 cutover ceiling`, () => {
      let edits: Array<Record<string, unknown>> = [];
      try {
        edits = JSON.parse(readFileSync(editsPath, "utf-8"));
      } catch {
        return;
      }
      let leakCount = 0;
      const samples: Array<{ id: string; whyExcerpt: string }> = [];
      for (const edit of edits) {
        const source = edit.source as string | undefined;
        if (!source || !LLM_SOURCES.has(source)) continue;
        const why = edit.why;
        if (typeof why !== "string" || why.length === 0) continue;
        if (containsUuid(why)) {
          leakCount += 1;
          if (samples.length < 3) {
            samples.push({
              id: String(edit.id ?? "(unknown)"),
              whyExcerpt: why.slice(0, 120),
            });
          }
        }
      }
      expect(
        leakCount,
        `${tenantSlug}: LLM-source UUID-in-why count ${leakCount} exceeds the ` +
          `LLM-DryRun-2 cutover ceiling (${PRE_CUTOVER_LLM_UUID_IN_WHY_CEILING}). ` +
          `The validator should have rejected new LLM rows with UUIDs in \`why\`. ` +
          `Re-check validateNoUuidInOperatorCopy in specific-edit-validator.ts ` +
          `and the OpenAI SYSTEM_PROMPT good/bad UUID example. ` +
          `Sample violations: ${JSON.stringify(samples, null, 2)}`,
      ).toBeLessThanOrEqual(PRE_CUTOVER_LLM_UUID_IN_WHY_CEILING);
    });
  }
});
