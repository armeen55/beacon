/**
 * Architecture invariants — EGRESS-P0 (2026-05-07).
 *
 * Supabase Free-Plan egress incident. The free quota was 5 GB/month,
 * production hit 15.52 GB by 2026-05-07 with statement-timeout errors
 * on `page_snapshots` and `prompt_answer_observations`. These pins
 * lock the emergency mitigations so a future "small refactor" cannot
 * silently re-introduce the unbounded reads.
 *
 * Locked invariants:
 *   1. /recommendations load-queue passes a 60-day observations window.
 *   2. /settings/prompts passes a tight (1-day) observations + snapshots window.
 *   3. /prompts/[id] passes a 60-day observations window.
 *   4. Tenant-scoped getPageSnapshots is capped at LIMIT 500 (was 5000).
 *   5. Tenant-scoped getPageSnapshots uses an explicit column projection
 *      that omits the heavy payload fields (body_paragraph_sample,
 *      card_texts, internal_links, schema_entity_names,
 *      schema_validation_warnings).
 *   6. /today memoizes page_snapshots — only one fetch per render.
 *   7. Command Center kill switch (BEACON_COMMAND_CENTER_ENABLED=false)
 *      short-circuits the resolver call.
 *   8. Recommendations Executive Strip kill switch
 *      (NEXT_PUBLIC_BEACON_RECOMMENDATIONS_STRIP_ENABLED=false)
 *      short-circuits the strip render.
 *
 * Negative pins:
 *   - No bare `loadFreshCanonicalData()` call (no opts) in route loaders.
 *   - No `select("*")` on page_snapshots in the tenant-scoped backend.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const LOAD_QUEUE = join(
  REPO_ROOT,
  "src/domains/recommendations/load-queue.ts",
);
const SETTINGS_PROMPTS_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/settings/prompts/page.tsx",
);
const PROMPTS_DETAIL_PAGE = join(
  REPO_ROOT,
  "src/app/(shell)/prompts/[id]/page.tsx",
);
const TODAY_DATA = join(REPO_ROOT, "src/app/(shell)/today-data.ts");
const SUPABASE_BACKEND = join(
  REPO_ROOT,
  "src/lib/persistence/repositories/supabase-backend.ts",
);
const REC_CLIENT = join(
  REPO_ROOT,
  "src/app/(shell)/recommendations/recommendations-client.tsx",
);

const LOAD_QUEUE_SRC = readFileSync(LOAD_QUEUE, "utf8");
const SETTINGS_PROMPTS_SRC_RAW = readFileSync(SETTINGS_PROMPTS_PAGE, "utf8");
// Strip comments so call-site checks below ignore the deploy-hardening
// docstring that legitimately mentions `loadFreshCanonicalData` /
// `ensureCanonicalStoresSeeded` to explain why they're no longer used.
const SETTINGS_PROMPTS_SRC = SETTINGS_PROMPTS_SRC_RAW.replace(
  /^\s*\/\/.*$/gm,
  "",
).replace(/\/\*[\s\S]*?\*\//g, "");
const PROMPTS_DETAIL_SRC = readFileSync(PROMPTS_DETAIL_PAGE, "utf8");
const TODAY_DATA_SRC = readFileSync(TODAY_DATA, "utf8");
const SUPABASE_BACKEND_SRC = readFileSync(SUPABASE_BACKEND, "utf8");
const REC_CLIENT_SRC = readFileSync(REC_CLIENT, "utf8");

describe("EGRESS-P0.1 — /recommendations load-queue passes observations window", () => {
  it("calls loadFreshCanonicalData with observationsSince + skipSnapshots", () => {
    // 2026-06-15 — load-queue never consumes dailyMetricSnapshots, so it now
    // SKIPS that read entirely (stronger than the prior bounded snapshotsSince
    // window — was ~9 MB + ~19 paged round-trips of pure waste per render).
    expect(LOAD_QUEUE_SRC).toMatch(
      /loadFreshCanonicalData\(\{[\s\S]{0,200}observationsSince[\s\S]{0,200}skipSnapshots:\s*true/,
    );
  });

  it("does NOT call bare loadFreshCanonicalData() with no args", () => {
    expect(LOAD_QUEUE_SRC).not.toMatch(/loadFreshCanonicalData\(\s*\)/);
  });

  it("uses a 60-day observations window (operator-locked)", () => {
    expect(LOAD_QUEUE_SRC).toMatch(/60\s*\*\s*86_400_000/);
  });
});

describe("EGRESS-P0.2 — /settings/prompts reads only the small tracked_prompts table", () => {
  // Deploy hardening (2026-05-12) — the page no longer uses
  // `loadFreshCanonicalData` (which fanned out 4 parallel reads
  // including the heavy `prompt_answer_observations`) and instead
  // reads `tracked_prompts` directly via the tenant repo. Strictly
  // better than the prior windowed fan-out: zero observation reads,
  // zero snapshot reads, zero entity reads. See
  // `tests/architecture/deploy-settings-prompts-dynamic.test.ts`
  // for the full deploy-hardening pin including `force-dynamic`.

  it("does NOT call loadFreshCanonicalData (would fan out into PAO + snaps)", () => {
    expect(SETTINGS_PROMPTS_SRC).not.toMatch(/loadFreshCanonicalData\s*\(/);
  });

  it("does NOT call ensureCanonicalStoresSeeded (would seed the full canonical store)", () => {
    expect(SETTINGS_PROMPTS_SRC).not.toMatch(/ensureCanonicalStoresSeeded\s*\(/);
  });

  it("uses the direct tenant-repo `getTrackedPrompts()` reader", () => {
    expect(SETTINGS_PROMPTS_SRC).toMatch(
      /getRepository\(\)[\s\S]*?\.forTenant\([^)]+\)[\s\S]*?\.getTrackedPrompts\(\s*\)/,
    );
  });
});

describe("EGRESS-P0.3 — /prompts/[id] uses a prompt-scoped, windowed observation read", () => {
  // Emergency P0 fix (2026-05-12) — the page no longer calls
  // `loadFreshCanonicalData`. It reads directly from the tenant repo
  // with a `promptId` filter so Postgres returns only the rows for
  // ONE prompt (cuts ~15k rows → <500). The window stays at 60 days
  // to cover the classifier's worst-case lookback. See
  // `tests/architecture/perf-prompts-scoped-reads.test.ts` for the
  // full new-architecture pin.

  it("uses a prompt-scoped tenant-repo read instead of loadFreshCanonicalData", () => {
    expect(PROMPTS_DETAIL_SRC).toMatch(
      /tenantRepo\.getPromptAnswerObservations\(\s*\{[\s\S]*?promptId/,
    );
    // Comments may still mention `loadFreshCanonicalData` to explain
    // the old behavior; strip comments before the negative pin.
    const stripped = PROMPTS_DETAIL_SRC.replace(/^\s*\/\/.*$/gm, "").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(stripped).not.toMatch(/loadFreshCanonicalData\s*\(/);
  });

  it("uses a 60-day observations window (covers the classifier worst-case lookback)", () => {
    expect(PROMPTS_DETAIL_SRC).toMatch(/60\s*\*\s*86_400_000/);
  });
});

describe("EGRESS-P0.4 — tenant-scoped getPageSnapshots is capped + projected", () => {
  it("caps tenant-scoped page_snapshots at LIMIT 500 (was 5000)", () => {
    // Pin the tenant-scoped getPageSnapshots block contains .limit(500).
    const block = SUPABASE_BACKEND_SRC.match(
      /getPageSnapshots:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\.eq\("tenant_id"[\s\S]*?\.limit\((\d+)\)/,
    );
    expect(block).toBeTruthy();
    if (block) {
      expect(block[1]).toBe("500");
    }
  });

  it("does NOT use select('*') in the tenant-scoped page_snapshots query", () => {
    // Anchor on the tenant-scoped variant via the EGRESS-P0 comment
    // header (added in the same edit). This avoids matching past
    // the global getPageSnapshots block above it.
    const tenantBlock = SUPABASE_BACKEND_SRC.match(
      /EGRESS-P0[\s\S]*?getPageSnapshots:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\.limit\(500\)/,
    );
    expect(tenantBlock).toBeTruthy();
    if (tenantBlock) {
      expect(tenantBlock[0]).not.toMatch(/\.select\("\*"\)/);
      // The select call is wrapped over multiple lines with indentation;
      // match `.select(` followed by any whitespace then the column list.
      expect(tenantBlock[0]).toMatch(/\.select\(\s*"id, page_id/);
    }
  });

  it("explicitly drops the heavy payload columns from the projection", () => {
    // Same anchor approach. The .select() call wraps onto multiple
    // lines so we use [\s\S] inside the column-string match.
    const tenantBlock = SUPABASE_BACKEND_SRC.match(
      /EGRESS-P0[\s\S]*?getPageSnapshots:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\.limit\(500\)/,
    );
    expect(tenantBlock).toBeTruthy();
    if (tenantBlock) {
      const select = tenantBlock[0].match(/\.select\(\s*"([^"]+)",?\s*\)/);
      expect(select).toBeTruthy();
      if (select) {
        const cols = select[1];
        expect(cols).not.toMatch(/\bbody_paragraph_sample\b/);
        expect(cols).not.toMatch(/\bcard_texts\b/);
        expect(cols).not.toMatch(/\binternal_links\b/);
        expect(cols).not.toMatch(/\bschema_entity_names\b/);
        // fix_schema slice (2026-06-12): `schema_validation_warnings`
        // is deliberately BACK in the projection — the invalid-schema
        // trigger consumes it (without it the trigger silently reads
        // undefined on every hosted/cron read). Warnings are short
        // one-line strings (hundreds of bytes/row worst case), not the
        // 5-15KB payload fields this egress pin protects against.
        expect(cols).toMatch(/\bschema_validation_warnings\b/);
      }
    }
  });

  it("logs egress with the 'projected' marker so the operator can see the fix is live", () => {
    expect(SUPABASE_BACKEND_SRC).toMatch(
      /table:\s*"page_snapshots\[capped\+dedup\+projected\]"/,
    );
  });
});

describe("EGRESS-P0.5 — /today memoizes page_snapshots within a single render", () => {
  it("declares getPageSnapshotsShared helper", () => {
    expect(TODAY_DATA_SRC).toMatch(/getPageSnapshotsShared\s*=/);
    expect(TODAY_DATA_SRC).toMatch(/_pageSnapshotsPromise/);
  });

  it("both call sites use getPageSnapshotsShared (not raw .getPageSnapshots())", () => {
    // The two render call sites both go through the shared helper.
    expect(TODAY_DATA_SRC).toMatch(
      /pageSnapshotsForInventory =\s*await getPageSnapshotsShared\(\)/,
    );
    expect(TODAY_DATA_SRC).toMatch(
      /const pageSnapshots = await getPageSnapshotsShared\(\)/,
    );
    // The helper itself contains exactly one .getPageSnapshots() call
    // — the chained `.forTenant(tenantId).getPageSnapshots()`. Count
    // direct calls in the file: should be exactly 1 (inside the helper).
    const directCalls = TODAY_DATA_SRC.match(/\.getPageSnapshots\(\)/g);
    expect(directCalls).toBeTruthy();
    if (directCalls) {
      expect(directCalls.length).toBe(1);
    }
  });
});

describe("EGRESS-P0.6 — Command Center kill switch", () => {
  it("BEACON_COMMAND_CENTER_ENABLED=false short-circuits the resolver call", () => {
    expect(TODAY_DATA_SRC).toMatch(
      /BEACON_COMMAND_CENTER_ENABLED[\s\S]{0,100}===\s*"false"/,
    );
    // When disabled, returns the empty CommandCenterData shape directly.
    expect(TODAY_DATA_SRC).toMatch(
      /BEACON_COMMAND_CENTER_ENABLED[\s\S]{0,300}hasAnyData:\s*false[\s\S]{0,200}brain:\s*null[\s\S]{0,200}manifest:\s*null/,
    );
  });
});

describe("EGRESS-P0.7 — Recommendations Executive Strip kill switch", () => {
  it("NEXT_PUBLIC_BEACON_RECOMMENDATIONS_STRIP_ENABLED=false hides the strip", () => {
    expect(REC_CLIENT_SRC).toMatch(
      /NEXT_PUBLIC_BEACON_RECOMMENDATIONS_STRIP_ENABLED[\s\S]{0,100}!==\s*"false"/,
    );
    // Strip render is gated by the flag.
    expect(REC_CLIENT_SRC).toMatch(
      /\{stripEnabled \?\s*\(\s*<ExecutiveStrip/,
    );
  });
});

describe("EGRESS-P0 — broad sweep: no unbounded route-render reads", () => {
  it("no bare loadFreshCanonicalData() in any (shell) route page", () => {
    // Every loadFreshCanonicalData() call in /src/app/(shell)/**/page.tsx
    // OR in route-render data resolvers (today-data, etc.) must pass a
    // since window. Scripts and tests that need full history pass it
    // explicitly.
    const allRouteSrc = [
      LOAD_QUEUE_SRC,
      SETTINGS_PROMPTS_SRC,
      PROMPTS_DETAIL_SRC,
      TODAY_DATA_SRC,
    ].join("\n");
    expect(allRouteSrc).not.toMatch(/loadFreshCanonicalData\(\s*\)/);
  });
});
