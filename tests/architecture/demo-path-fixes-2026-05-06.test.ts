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
const SCORECARD_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/changes/scorecard-client.tsx"),
  "utf8",
);
const RECS_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/recommendations/recommendations-client.tsx"),
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
const TODAY_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/today-client.tsx"),
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

  it("/changes at-a-glance row uses 'pre-launch' / 'detected by scan' (not 'imported legacy' / 'scan-confirmed')", () => {
    const stripped = stripComments(CHANGES_PAGE);
    expect(stripped).toMatch(/pre-launch/);
    expect(stripped).toMatch(/detected by scan/);
    expect(stripped).not.toMatch(/}\s+imported legacy/);
    expect(stripped).not.toMatch(/}\s+scan-confirmed/);
  });

  it("scorecard 'all' tab empty copy points to /recommendations (not 'No rows. The changelog is empty.')", () => {
    expect(SCORECARD_CLIENT).toMatch(/Accept your first recommendation/);
    expect(SCORECARD_CLIENT).not.toMatch(/No rows\. The changelog is empty\./);
  });
});

// ── Fix 2 — /recommendations drawer Debug-block gate + UUID strip ────

describe("Demo-path fix 2 (2026-05-06) — /recommendations drawer cleanup", () => {
  it("declares OPERATOR_MODE_DEBUG gate sourced from NEXT_PUBLIC_OPERATOR_MODE / NODE_ENV=test", () => {
    expect(RECS_CLIENT).toMatch(
      /const OPERATOR_MODE_DEBUG[\s\S]{0,100}NEXT_PUBLIC_OPERATOR_MODE[\s\S]{0,80}NODE_ENV/,
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
  it("/diagnostics/page.tsx imports notFound + checks BEACON_OPERATOR_MODE", () => {
    expect(DIAGNOSTICS_PAGE).toMatch(/from "next\/navigation"/);
    expect(DIAGNOSTICS_PAGE).toMatch(/notFound\(\)/);
    expect(DIAGNOSTICS_PAGE).toMatch(
      /BEACON_OPERATOR_MODE[\s\S]{0,80}NODE_ENV/,
    );
  });

  it("/diagnostics/spikes/page.tsx imports notFound + checks BEACON_OPERATOR_MODE", () => {
    expect(SPIKES_PAGE).toMatch(/from "next\/navigation"/);
    expect(SPIKES_PAGE).toMatch(/notFound\(\)/);
    expect(SPIKES_PAGE).toMatch(
      /BEACON_OPERATOR_MODE[\s\S]{0,80}NODE_ENV/,
    );
  });

  it("/settings/health re-exports /diagnostics/page (so it inherits the guard automatically)", () => {
    const settingsHealth = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/health/page.tsx"),
      "utf8",
    );
    expect(settingsHealth).toMatch(/from "\.\.\/\.\.\/diagnostics\/page"/);
  });
});

// ── Fix 4 — /today first-run + Z-score copy ───────────────────────────

describe("Demo-path fix 4 (2026-05-06) — /today first-run welcome + Z-score kill", () => {
  it("formatUrlVerdictProof says '(measured per page)', NOT '(URL-level Z-score)'", () => {
    const stripped = stripComments(TODAY_CLIENT);
    expect(stripped).toMatch(/\(measured per page\)/);
    expect(stripped).not.toMatch(/\(URL-level Z-score\)/);
  });

  it("first-run welcome card mounts when pollHealth === null && primaryAction === null", () => {
    expect(TODAY_CLIENT).toMatch(/data-today-first-run="true"/);
    expect(TODAY_CLIENT).toMatch(/Welcome to Beacon\./);
    expect(TODAY_CLIENT).toMatch(/07:00 UTC/);
  });

  it("first-run card guidance mentions Settings → Prompts (so user knows how to act)", () => {
    expect(TODAY_CLIENT).toMatch(
      /Settings\s*→\s*Prompts/,
    );
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

  it("Math drawer rows use plain-English labels (not μ_pre / σ_pre / μ_post / z-score / ±2 significance)", () => {
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

  it("/settings landing redirects to /settings/prompts (not /settings/import)", () => {
    const settingsPage = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/page.tsx"),
      "utf8",
    );
    expect(settingsPage).toMatch(/redirect\("\/settings\/prompts"\)/);
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

  it("/prompts list 'ranked list miss' renamed to 'Not on the list'", () => {
    const promptsList = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/prompts/page.tsx"),
      "utf8",
    );
    const stripped = stripComments(promptsList);
    expect(stripped).toMatch(/Not on the list/);
    expect(stripped).not.toMatch(/ranked list miss/);
  });

  it("/prompts 'next poll' copy uses 07:00 UTC, not stale 10:00 UTC", () => {
    const promptsList = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/prompts/page.tsx"),
      "utf8",
    );
    const stripped = stripComments(promptsList);
    expect(stripped).toMatch(/07:00 UTC/);
    expect(stripped).not.toMatch(/10:00 UTC/);
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

  it("PollHealthBlock pending-day copy uses 07:00 UTC (not stale 10:00 UTC)", () => {
    const pollHealth = readFileSync(
      resolve(REPO_ROOT, "src/components/today/poll-health-block.tsx"),
      "utf8",
    );
    const stripped = stripComments(pollHealth);
    expect(stripped).toMatch(/07:00 UTC/);
    expect(stripped).not.toMatch(/10:00 UTC/);
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

  it("rendered today-client.tsx: NO '(URL-level Z-score)' substring (comments stripped)", () => {
    expect(stripComments(TODAY_CLIENT)).not.toMatch(/\(URL-level Z-score\)/);
  });
});
