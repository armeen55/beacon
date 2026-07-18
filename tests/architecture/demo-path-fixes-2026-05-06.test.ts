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
 * Companion to `customer-readiness-round-2.test.ts` — same shape,
 * different bundle.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const LIFECYCLE_CLASSIFICATION = readFileSync(
  resolve(REPO_ROOT, "src/domains/attribution/lifecycle-classification.ts"),
  "utf8",
);
// IA consolidation (2026-06-23): the /changes index empty-state gate moved into
// the embedded ResultsTimeline (changes/page.tsx is now a thin redirect).
const CHANGES_PAGE = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/changes/results-timeline.tsx"),
  "utf8",
);
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

});

// ── Fix 2 — /recommendations drawer Debug-block gate + UUID strip ────
// Surface collapse (2026-06-15): the legacy recommendations-client drawer
// was deleted; the V2 card's operator-debug gating is covered separately.

// ── Fix 3 — /diagnostics operator guard ───────────────────────────────

describe("Demo-path fix 3 (2026-05-06) — diagnostics operator guard", () => {
  it("/diagnostics/page.tsx immediately returns customers to Today without loading diagnostic engines", () => {
    expect(DIAGNOSTICS_PAGE).toMatch(/from "next\/navigation"/);
    expect(DIAGNOSTICS_PAGE).toMatch(/redirect\("\/"\)/);
    expect(DIAGNOSTICS_PAGE).not.toMatch(/getRepository|currentTenantId|isOperatorModeServer/);
  });

  it("/diagnostics/spikes/page.tsx imports notFound + gates via isOperatorModeServer() with NODE_ENV-test extension", () => {
    expect(SPIKES_PAGE).toMatch(/from "next\/navigation"/);
    expect(SPIKES_PAGE).toMatch(/notFound\(\)/);
    expect(SPIKES_PAGE).toMatch(
      /isOperatorModeServer\(\)[\s\S]{0,80}NODE_ENV/,
    );
    expect(SPIKES_PAGE).not.toMatch(/process\.env\.BEACON_OPERATOR_MODE/);
  });

  it("/settings/health re-exports /diagnostics/page (so retired links return to Today)", () => {
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

  it("/settings landing links to /settings/connectors (not /settings/import as the default)", () => {
    // 2026-06-15 goal pivot: Connections is the primary customer setup
    // surface. D7 (2026-07-02): a bare redirect left /settings/config,
    // /settings/history, /settings/spend, and /settings/methodology
    // reachable only by typing the URL. FP4 (2026-07-03): the index page now
    // derives its links from the ONE settings registry
    // (settings-sections.ts), so this pin checks the registry (Connections
    // lives there) and that the page renders that registry without
    // defaulting to Import.
    const settingsPage = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/page.tsx"),
      "utf8",
    );
    const sections = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/settings-sections.ts"),
      "utf8",
    );
    expect(settingsPage).toContain('from "./settings-sections"');
    expect(sections).toMatch(/\/settings\/connectors/);
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

// Demo-path Phase C fix 8 (2026-05-06) — /today poll-health customer copy:
// removed (2026-06-16). poll-health-block.tsx was orphaned when the legacy
// today-client was deleted; the V2 dashboard's poll-health surface has its
// own contract tests.

// ── Cross-cutting: no raw enum stringy renders survived ───────────────

describe("Demo-path bundle 2026-05-06 — cross-cutting negative invariants", () => {
  it("rendered customer-mode HTML strings: NO 'Imported legacy' / 'Scan-confirmed' / 'imported legacy' label literals", () => {
    // Scan the three current call-site files after stripping comments.
    for (const [name, src] of [
      ["lifecycle-classification.ts", LIFECYCLE_CLASSIFICATION],
      ["changes/page.tsx", CHANGES_PAGE],
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
