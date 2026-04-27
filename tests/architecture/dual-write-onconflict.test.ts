/**
 * Architecture invariant — dual-write onConflict targets must match
 * the actual Supabase unique indexes.
 *
 * History of regressions this would have caught:
 *   - Sprint 6A.2f (2026-04-26): syncRecommendedEdits used
 *     "rec_id,action_type,target_element_key" but the production index
 *     ux_re_tenant_rec_action_element added tenant_id as the leading
 *     column. Every Accept against the live tenant threw "no unique or
 *     exclusion constraint matching the ON CONFLICT specification".
 *   - 2026-04-27 Accept-bug fix: syncRecommendationResponses used
 *     "rec_id" but the Phase 7.2 migration swapped the PK to
 *     (tenant_id, rec_id). Same error class. Patched in this commit.
 *
 * The invariant pins the onConflict string for tenant-scoped tables
 * known to share a rec_id across tenants — the leading `tenant_id`
 * column is what allows the underlying UNIQUE constraint to coexist
 * with cross-tenant duplicates of the inner key.
 *
 * Pure source-scan — no DB calls. The hard pairing of "code says X"
 * vs "DB has X" is enforced separately by the Supabase pg_indexes
 * query inline in the dual-write helper's docstring (verified by
 * the original committer); this test prevents drift.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DUAL_WRITE_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/persistence/dual-write.ts"),
  "utf8",
);

describe("dual-write onConflict invariants", () => {
  it("syncRecommendationResponses uses tenant_id,rec_id (matches recommendation_responses_pkey)", () => {
    // Production PK: CREATE UNIQUE INDEX recommendation_responses_pkey
    //   ON public.recommendation_responses USING btree (tenant_id, rec_id)
    // The 2026-04-27 Accept-bug fix matched the spec to the index.
    // Regression check: the call body for `syncRecommendationResponses`
    // must contain a dualWriteUpsert against `recommendation_responses`
    // with onConflict="tenant_id,rec_id".
    const fnStart = DUAL_WRITE_SRC.indexOf(
      "export async function syncRecommendationResponses",
    );
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = DUAL_WRITE_SRC.indexOf("\n}\n", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = DUAL_WRITE_SRC.slice(fnStart, fnEnd + 2);

    expect(body).toMatch(
      /dualWriteUpsert(?:Scoped)?\(\s*["']recommendation_responses["']/,
    );
    expect(body).toMatch(/["']tenant_id,rec_id["']/);
    // Defense against silent regression: a bare "rec_id" must NOT
    // appear as the third argument to dualWriteUpsert in this body.
    // (We allow the substring "rec_id" inside the compound key.)
    expect(body).not.toMatch(/dualWriteUpsert(?:Scoped)?\(\s*["']recommendation_responses["'][^)]*,\s*mapped,\s*["']rec_id["']\s*\)/);
  });

  it("syncRecommendedEdits uses tenant_id,rec_id,action_type,target_element_key (matches ux_re_tenant_rec_action_element)", () => {
    // Sprint 6A.2f regression — the four-column compound. Pinned again
    // here so future drift in either direction is caught at one spot.
    const fnStart = DUAL_WRITE_SRC.indexOf(
      "export async function syncRecommendedEdits",
    );
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = DUAL_WRITE_SRC.indexOf("\n}\n", fnStart);
    const body = DUAL_WRITE_SRC.slice(fnStart, fnEnd + 2);
    expect(body).toMatch(
      /["']tenant_id,rec_id,action_type,target_element_key["']/,
    );
  });

  it("syncUrlChangeOutcomes uses change_id,url (matches url_change_outcomes compound PK)", () => {
    const fnStart = DUAL_WRITE_SRC.indexOf(
      "export async function syncUrlChangeOutcomes",
    );
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = DUAL_WRITE_SRC.indexOf("\n}\n", fnStart);
    const body = DUAL_WRITE_SRC.slice(fnStart, fnEnd + 2);
    expect(body).toMatch(/["']change_id,url["']/);
  });

  it("syncPageElementInventory uses source_snapshot_id,element_key (matches ux_pei_snapshot_element_key)", () => {
    const fnStart = DUAL_WRITE_SRC.indexOf(
      "export async function syncPageElementInventory",
    );
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = DUAL_WRITE_SRC.indexOf("\n}\n", fnStart);
    const body = DUAL_WRITE_SRC.slice(fnStart, fnEnd + 2);
    expect(body).toMatch(/["']source_snapshot_id,element_key["']/);
  });

  it("syncChangelogEntries uses id (matches changelog_entries_pkey on id alone)", () => {
    const fnStart = DUAL_WRITE_SRC.indexOf(
      "export async function syncChangelogEntries",
    );
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = DUAL_WRITE_SRC.indexOf("\n}\n", fnStart);
    const body = DUAL_WRITE_SRC.slice(fnStart, fnEnd + 2);
    // changelog_entries PK is `id` — single column. Confirmed via
    // SELECT indexdef WHERE tablename='changelog_entries':
    //   changelog_entries_pkey USING btree (id)
    expect(body).toMatch(
      /dualWriteUpsert\(\s*["']changelog_entries["'][^)]*,\s*mapped,\s*["']id["']\s*\)/,
    );
  });
});
