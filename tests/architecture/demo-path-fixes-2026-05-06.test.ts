/**
 * Demo-path fixes — 2026-05-06 war-room implementation bundle.
 *
 * Pins the 5 customer-facing copy/UX fixes shipped during the
 * 2026-05-06 war-room day:
 *
 *   1. "Imported legacy" → "Pre-launch history" (tab + pill + at-a-glance).
 *   2. /recommendations drawer Debug-block gate + UUID data-attr strip.
 *   3. /diagnostics + /diagnostics/spikes + /settings/health operator guard.
 *   4. /today first-run welcome card + "(URL-level Z-score)" → "(measured per page)".
 *   5. /changes/truth verdict labels + math-drawer humanization
 *      (μ_pre / σ_pre / μ_post / z-score / ±2 significance → plain English).
 *
 * Each invariant is a static-source check (read file → grep). No DOM
 * rendering, no live route hits — invariants run in CI without env
 * setup. Source files cited inline so future readers know what's pinned.
 *
 * Customer-mode contract:
 *   - rendered output must NOT contain raw debug strings, internal
 *     enum values, statistical Greek notation, or schema field names.
 *   - operator mode (NEXT_PUBLIC_OPERATOR_MODE / BEACON_OPERATOR_MODE)
 *     restores the operator surface for diagnostics + recommendations
 *     drawer; tests run as if operator mode were on (NODE_ENV=test).
 *
 * Companion to `tests/architecture/customer-readiness-round-1.test.ts` +
 * `customer-readiness-round-2.test.ts` — same shape, different bundle.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const LIFECYCLE_CLASSIFICATION = readFileSync(
  resolve(REPO_ROOT, "src/domains/attribution/lifecycle-classification.ts"),
  "utf8",
);
const LIFECYCLE_PILL = readFileSync(
  resolve(REPO_ROOT, "src/components/display/lifecycle-status-pill.tsx"),
  "utf8",
);
const CHANGES_PAGE = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/changes/page.tsx"),
  "utf8",
);
// Surface collapse (2026-06-15): scorecard-client.tsx +
// recommendations-client.tsx were deleted. The describe blocks that pinned
// their copy (Fix 2 drawer cleanup, Fix 5 verdict humanization) are skipped
// below; the V2 surfaces have their own contract tests. Empty placeholders
// keep those skipped blocks compiling.
const SCORECARD_CLIENT = "";
const RECS_CLIENT = "";
const DIAGNOSTICS_PAGE = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/diagnostics/page.tsx"),
  "utf8",
);
const SPIKES_PAGE = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/diagnostics/spikes/page.tsx"),
  "utf8",
);
const TRUTH_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/changes/truth/truth-client.tsx"),
  "utf8",
);

/**
 * Strip TS line comments + block comments before grepping for "rendered"
 * substrings. Same comment-strip helper pattern as the canonical-store
 * tenant-isolation invariant (line comments first, then block comments,
 * to avoid `//` lines containing `/*` from being interpreted as block
 * starts).
 */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ── Fix 1 — "Imported legacy" → "Pre-launch history" ─────────────────

describe("Demo-path fix 1 (2026-05-06) — Pre-launch history rename", () => {
  it("LIFECYCLE_TAB_LABEL renders 'Pre-launch history' for imported_legacy", () => {
    expect(LIFECYCLE_CLASSIFICATION).toMatch(
      /imported_legacy:\s*"Pre-launch history"/,
    );
    expect(LIFECYCLE_CLASSIFICATION).not.toMatch(
      /imported_legacy:\s*"Imported legacy"/,
    );
  });

  it("LIFECYCLE_TAB_LABEL renders 'Detected by scan' for scan_confirmed", () => {
    expect(LIFECYCLE_CLASSIFICATION).toMatch(
      /scan_confirmed:\s*"Detected by scan"/,
    );
    expect(LIFECYCLE_CLASSIFICATION).not.toMatch(
      /scan_confirmed:\s*"Scan-confirmed"/,
    );
  });

  it("LifecycleStatusPill renders 'Pre-launch' label/compactLabel for imported_legacy", () => {
    expect(LIFECYCLE_PILL).toMatch(/label:\s*"Pre-launch"/);
    expect(LIFECYCLE_PILL).toMatch(/compactLabel:\s*"Pre-launch"/);
    expect(LIFECYCLE_PILL).not.toMatch(/label:\s*"Imported legacy"/);
    expect(LIFECYCLE_PILL).not.toMatch(/compactLabel:\s*"Legacy"/);
  });

  // Surface collapse (2026-06-15): the /changes at-a-glance lifecycle row
  // (with "pre-launch" / "detected by scan" copy) lived in the legacy page
  // layout, deleted with the V2-only collapse. The lifecycle labels
  // themselves are still pinned via the LifecycleStatusPill it above.
  it.skip("/changes at-a-glance row uses 'pre-launch' / 'detected by scan' (legacy page layout removed)", () => {
    const stripped = stripComments(CHANGES_PAGE);
    expect(stripped).toMatch(/pre-launch/);
    expect(stripped).toMatch(/detected by scan/);
    expect(stripped).not.toMatch(/}\s+imported legacy/);
    expect(stripped).not.toMatch(/}\s+scan-confirmed/);
  });

  // Surface collapse (2026-06-15): the scorecard 'all' tab empty-state copy
  // lived in the deleted scorecard-client; the V2 timeline's empty state has
  // its own coverage (changes-v2-client.test.tsx).
  it.skip("scorecard 'all' tab empty copy points to /recommendations (legacy scorecard-client removed)", () => {
    expect(SCORECARD_CLIENT).toMatch(/Accept your first recommendation/);
    expect(SCORECARD_CLIENT).not.toMatch(/No rows\. The changelog is empty\./);
  });
});

// ── Fix 2 — /recommendations drawer Debug-block gate + UUID strip ────
// Surface collapse (2026-06-15): the legacy recommendations-client drawer
// was deleted; the V2 card's operator-debug gating is covered separately.

describe.skip("Demo-path fix 2 (2026-05-06) — /recommendations drawer cleanup (legacy recommendations-client removed)", () => {
  it("declares OPERATOR_MODE_DEBUG gate sourced from isOperatorModeClient() helper", () => {
    // Post-2026-05-09 unification (C1): the gate goes through the
    // shared helper. The helper itself wraps NEXT_PUBLIC_OPERATOR_MODE
    // OR NODE_ENV === "test" (verified separately in
    // operator-mode-helpers.test.ts).
    expect(RECS_CLIENT).toMatch(
      /const OPERATOR_MODE_DEBUG[\s\S]{0,80}isOperatorModeClient\(\)/,
    );
    expect(RECS_CLIENT).not.toMatch(
      /const OPERATOR_MODE_DEBUG[\s\S]{0,80}process\.env\.NEXT_PUBLIC_OPERATOR_MODE/,
    );
  });

  it("Debug-details <details> block is gated behind OPERATOR_MODE_DEBUG", () => {
    expect(RECS_CLIENT).toMatch(
      /\{OPERATOR_MODE_DEBUG\s*&&\s*\([\s\S]{0,400}data-rec-debug-block/,
    );
  });

  it("data-rec-source-rec-id / data-rec-source-edit-id are conditionally included via OPERATOR_MODE_DEBUG", () => {
    // Spread shape must use the operator-debug gate so customer mode
    // doesn't ship UUIDs in `data-rec-source-rec-id` attrs.
    expect(RECS_CLIENT).toMatch(
      /OPERATOR_MODE_DEBUG[\s\S]{0,200}"data-rec-source-rec-id"/,
    );
    expect(RECS_CLIENT).toMatch(
      /OPERATOR_MODE_DEBUG[\s\S]{0,200}"data-rec-source-edit-id"/,
    );
  });
});

// ── Fix 3 — /diagnostics operator guard ───────────────────────────────

describe("Demo-path fix 3 (2026-05-06) — diagnostics operator guard", () => {
  it("/diagnostics/page.tsx imports notFound + gates via isOperatorModeServer() with NODE_ENV-test extension", () => {
    expect(DIAGNOSTICS_PAGE).toMatch(/from "next\/navigation"/);
    expect(DIAGNOSTICS_PAGE).toMatch(/notFound\(\)/);
    // Helper-based gate; test-env extension preserved.
    expect(DIAGNOSTICS_PAGE).toMatch(
      /isOperatorModeServer\(\)[\s\S]{0,80}NODE_ENV/,
    );
    expect(DIAGNOSTICS_PAGE).not.toMatch(/process\.env\.BEACON_OPERATOR_MODE/);
  });

  it("/diagnostics/spikes/page.tsx imports notFound + gates via isOperatorModeServer() with NODE_ENV-test extension", () => {
    expect(SPIKES_PAGE).toMatch(/from "next\/navigation"/);
    expect(SPIKES_PAGE).toMatch(/notFound\(\)/);
    expect(SPIKES_PAGE).toMatch(
      /isOperatorModeServer\(\)[\s\S]{0,80}NODE_ENV/,
    );
    expect(SPIKES_PAGE).not.toMatch(/process\.env\.BEACON_OPERATOR_MODE/);
  });

  it("/settings/health re-exports /diagnostics/page (so it inherits the guard automatically)", () => {
    const settingsHealth = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/health/page.tsx"),
      "utf8",
    );
    expect(settingsHealth).toMatch(/from "\.\.\/\.\.\/diagnostics\/page"/);
  });
});


// ── Fix 5 — /changes/truth verdict labels + math humanization ─────────

describe("Demo-path fix 5 (2026-05-06) — /changes/truth verdict + math humanization", () => {
  it("VERDICT_LABEL map covers known verdict values", () => {
    // T5.2 (2026-05-06) — `weak_signal` was added to the map; widened
    // the search window to accommodate the new entry.
    expect(TRUTH_CLIENT).toMatch(/VERDICT_LABEL[\s\S]{0,800}verified_live_too_early:\s*"Too early to tell"/);
    expect(TRUTH_CLIENT).toMatch(/verdict_off:\s*"Verdict revised"/);
    expect(TRUTH_CLIENT).toMatch(/not_found_after_7d:\s*"Not yet live \(after 7 days\)"/);
    // T5.2 — pin the new entry too.
    // UX.4 (2026-05-07) tightened "Early signs of lift" → "Early signal".
    expect(TRUTH_CLIENT).toMatch(/weak_signal:\s*"Early signal"/);
  });

  it("VerdictPill renders via humanizeVerdict, NOT raw replace(/_/g, ' ')", () => {
    expect(TRUTH_CLIENT).toMatch(
      /<span[\s\S]{0,400}humanizeVerdict\(verdict\)/,
    );
    // Negative invariant: VerdictPill body must NOT contain the
    // verdict.replace(/_/g, " ") shape (the old direct render).
    expect(TRUTH_CLIENT).not.toMatch(
      /VerdictPill[\s\S]{0,500}\{verdict\.replace\(\/_\/g, " "\)\}/,
    );
  });

  it("ConfidenceSourcePill uses CONFIDENCE_SOURCE_LABEL map ('Default estimate', not 'seed prior')", () => {
    const strippedTruth = stripComments(TRUTH_CLIENT);
    expect(strippedTruth).toMatch(
      /CONFIDENCE_SOURCE_LABEL[\s\S]{0,200}seed_prior:\s*"Default estimate"/,
    );
    // Tooltip is humanized — no "v1 static edit-type heuristic" in the
    // rendered tooltip body (comments may still reference it as context).
    expect(strippedTruth).not.toMatch(/v1 static edit-type heuristic/);
    expect(strippedTruth).toMatch(
      /CONFIDENCE_SOURCE_TOOLTIP[\s\S]{0,400}seed_prior:[\s\S]{0,200}Default estimate/,
    );
  });

  // Surface collapse (2026-06-15): the math drawer lived in the deleted
  // scorecard-client; the V2 timeline's drilldown has its own coverage.
  it.skip("Math drawer rows use plain-English labels (legacy scorecard-client removed)", () => {
    expect(SCORECARD_CLIENT).toMatch(/label="Before change \(per day\)"/);
    expect(SCORECARD_CLIENT).toMatch(/label="Normal range"/);
    expect(SCORECARD_CLIENT).toMatch(/label="After change \(per day\)"/);
    expect(SCORECARD_CLIENT).toMatch(/label="Change strength"/);
    expect(SCORECARD_CLIENT).toMatch(/Strong signal/);
    // T5.2 (2026-05-06) — the legacy binary "Weak signal" / "Strong
    // signal" pairing was replaced with a three-tier label aligned
    // with the new verdict tiers (helping / weak_signal / nothing_yet).
    // The "Early signal" label is the new middle tier; "Below
    // directional bar" is the floor.
    expect(SCORECARD_CLIENT).toMatch(/Early signal/);
    expect(SCORECARD_CLIENT).toMatch(/Below directional bar/);

    // Negative invariants: the old Greek/stats labels must be gone.
    expect(SCORECARD_CLIENT).not.toMatch(/label="μ_pre/);
    expect(SCORECARD_CLIENT).not.toMatch(/label="σ_pre/);
    expect(SCORECARD_CLIENT).not.toMatch(/label="μ_post/);
    expect(SCORECARD_CLIENT).not.toMatch(/label="z-score"/);
    expect(SCORECARD_CLIENT).not.toMatch(/≥ ±2 significance/);
    expect(SCORECARD_CLIENT).not.toMatch(/below ±2 bar/);
  });
});

// ── Phase C extras (2026-05-06) — settings/import + prompts polish + poll-health copy ──

describe("Demo-path Phase C fix 6 (2026-05-06) — /settings/import customer leak", () => {
  it("Source default is empty string, NOT 'profound'", () => {
    const importPage = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/import/import-page.tsx"),
      "utf8",
    );
    const stripped = stripComments(importPage);
    expect(stripped).toMatch(/useState\(""\)/);
    expect(stripped).not.toMatch(/useState\("profound"\)/);
  });

  it("Source input placeholder is 'e.g. csv', NOT 'e.g. profound'", () => {
    const importPage = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/import/import-page.tsx"),
      "utf8",
    );
    const stripped = stripComments(importPage);
    expect(stripped).toMatch(/placeholder="e\.g\. csv"/);
    expect(stripped).not.toMatch(/placeholder="e\.g\. profound"/);
  });

  it("/settings landing redirects to /settings/connectors (not /settings/import)", () => {
    // 2026-06-15 goal pivot: Settings opens on Connectors (the primary
    // customer setup surface), not the prompts editor or the import leak.
    const settingsPage = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/page.tsx"),
      "utf8",
    );
    expect(settingsPage).toMatch(/redirect\("\/settings\/connectors"\)/);
    expect(settingsPage).not.toMatch(/redirect\("\/settings\/import"\)/);
  });
});

describe("Demo-path Phase C fix 7 (2026-05-06) — /prompts polish", () => {
  it("/prompts list page imports prettifySlug + uses it on cluster pill labels", () => {
    const promptsList = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/prompts/page.tsx"),
      "utf8",
    );
    expect(promptsList).toMatch(/import \{ prettifySlug \} from "\.\/\[id\]\/page"/);
    expect(promptsList).toMatch(/prettifySlug\(rawLabel\)\s*\?\?\s*rawLabel/);
  });

  it("/prompts/[id] page applies prettifySlug to cluster pill labels", () => {
    const promptsDetail = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/prompts/[id]/page.tsx"),
      "utf8",
    );
    expect(promptsDetail).toMatch(
      /clusterTags\.map[\s\S]{0,400}prettifySlug\(rawLabel\)\s*\?\?\s*rawLabel/,
    );
  });

  it("/prompts list 'ranked list miss' renamed to a plain-English tag", () => {
    // 2026-06-14 — relabeled from the cryptic "Not on the list" to the
    // self-explanatory "Not in AI's recommended list" (rendered with an
    // HTML apostrophe entity in JSX).
    const promptsList = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/prompts/page.tsx"),
      "utf8",
    );
    const stripped = stripComments(promptsList);
    expect(stripped).toMatch(/Not in AI&apos;s recommended list/);
    expect(stripped).not.toMatch(/ranked list miss/);
  });

  it("/prompts 'next poll' copy is plain English (Bundle 3 copy cleanup)", () => {
    // Bundle 3 (2026-05-10): customer-facing copy on /prompts no
    // longer leaks the cron schedule (07:00 / 08:30 / 10:00 UTC).
    // The redundant-schedule reliability posture is preserved in
    // .github/workflows/daily-native-poll.yml; the customer-facing
    // copy now reads "Beacon checks AI visibility every morning."
    // Operator-only /diagnostics still surfaces the exact schedule.
    const promptsList = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/prompts/page.tsx"),
      "utf8",
    );
    const stripped = stripComments(promptsList);
    // Customer-facing copy must NOT include cron-time leaks.
    expect(stripped).not.toMatch(/07:00/);
    expect(stripped).not.toMatch(/08:30/);
    expect(stripped).not.toMatch(/10:00 UTC/);
    expect(stripped).not.toMatch(/scheduled poll/);
    // Honest on-demand replacement must be present.
    expect(stripped).toMatch(
      /Beacon updates your AI visibility each time you refresh your connected data/,
    );
  });
});

describe("Demo-path Phase C fix 8 (2026-05-06) — /today poll-health customer copy", () => {
  it("PollHealthBlock failure subline does NOT reference 'API keys' / 'persistence' / 'scheduled-job logs'", () => {
    const pollHealth = readFileSync(
      resolve(REPO_ROOT, "src/components/today/poll-health-block.tsx"),
      "utf8",
    );
    const stripped = stripComments(pollHealth);
    // Customer-facing sublines must NOT contain on-call runbook copy.
    // (Comments retain context for future editors; only rendered
    // strings are pinned.)
    expect(stripped).not.toMatch(/Check persistence and daily-poll logs/);
    expect(stripped).not.toMatch(/Check API keys, persistence, and scheduled-job logs/);
    expect(stripped).not.toMatch(/at least one was a persistence failure/);
  });

  it("PollHealthBlock pending-day copy is honest on-demand (on-demand copy sweep)", () => {
    // On-demand copy sweep: customer-facing PollHealthBlock copy no
    // longer implies a scheduled cron. Beacon has no schedule — the
    // customer is told to refresh their connected data to update it.
    const pollHealth = readFileSync(
      resolve(REPO_ROOT, "src/components/today/poll-health-block.tsx"),
      "utf8",
    );
    const stripped = stripComments(pollHealth);
    // Cron-time + phantom-schedule leaks must NOT appear in customer copy.
    expect(stripped).not.toMatch(/07:00/);
    expect(stripped).not.toMatch(/08:30/);
    expect(stripped).not.toMatch(/10:00 UTC/);
    expect(stripped).not.toMatch(/scheduled poll/);
    expect(stripped).not.toMatch(/scheduled attempts/);
    // Honest on-demand replacement must be present.
    expect(stripped).toMatch(/Refresh your connected data to update it/);
  });

  it("PollHealthBlock partial-day copy reassures 'Beacon is still using the valid responses'", () => {
    const pollHealth = readFileSync(
      resolve(REPO_ROOT, "src/components/today/poll-health-block.tsx"),
      "utf8",
    );
    expect(pollHealth).toMatch(/still using the valid responses/);
  });
});

// ── Cross-cutting: no raw enum stringy renders survived ───────────────

describe("Demo-path bundle 2026-05-06 — cross-cutting negative invariants", () => {
  it("rendered customer-mode HTML strings: NO 'Imported legacy' / 'Scan-confirmed' / 'imported legacy' label literals", () => {
    // CHANGES_PAGE + LIFECYCLE_PILL + LIFECYCLE_CLASSIFICATION + SCORECARD_CLIENT
    // are the four call-site files. Strip comments first.
    for (const [name, src] of [
      ["lifecycle-classification.ts", LIFECYCLE_CLASSIFICATION],
      ["lifecycle-status-pill.tsx", LIFECYCLE_PILL],
      ["changes/page.tsx", CHANGES_PAGE],
      ["changes/scorecard-client.tsx", SCORECARD_CLIENT],
    ] as const) {
      const stripped = stripComments(src);
      expect(stripped, `${name} contains rendered "Imported legacy" literal`).not.toMatch(
        /"Imported legacy"/,
      );
      expect(stripped, `${name} contains rendered "Scan-confirmed" literal`).not.toMatch(
        /"Scan-confirmed"/,
      );
    }
  });


  // Pivot (GSC-led, 2026-06-14): /changes must show its empty state based on
  // REAL activity (changelog rows OR recommended edits), never on file
  // import-runs alone. Pre-pivot it gated on `hasActiveExperiment()`
  // (import_runs > 0), so a GSC-led tenant that shipped changes / accepted
  // recommendations but never imported a file was wrongly told "Import your
  // data" while its real Changes were hidden (live for Iranopedia: 0 changelog
  // + 0 imports + 70 recommended_edits). This ratchet stops a regression to
  // the import-only gate.
  it("pivot: /changes gates its empty state on real activity, not hasActiveExperiment", () => {
    const stripped = stripComments(CHANGES_PAGE);
    expect(
      stripped,
      "changes/page.tsx must NOT gate the empty state on hasActiveExperiment (import-runs only)",
    ).not.toMatch(/hasActiveExperiment/);
    expect(
      stripped,
      "changes/page.tsx empty state must gate on liveEntries + recommendedEdits being empty",
    ).toMatch(/liveEntries\.length === 0\s*&&\s*recommendedEdits\.length === 0/);
  });
});
