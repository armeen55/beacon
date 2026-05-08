/**
 * Architecture invariants — UX.6.2 Vocabulary + Hierarchy cleanup
 * on /today (2026-05-07).
 *
 * Pins the contract for the four UX.6.2 fixes that landed after the
 * brutal /today touchpoint audit:
 *
 *   FIX 1 — One vocabulary for the scan_findings layer.
 *     - NEW `src/lib/site-findings-labels.ts` exports the unified
 *       primary noun ("site finding") + helpers `compactStripLabel`,
 *       `doNextHeadline`, `doNextSubtitle`, `recentSiteChangesHeading`,
 *       and the `RECENT_SITE_CHANGES_SUBTITLE` string.
 *     - TodayDoNextCard's findings branch routes through
 *       `doNextHeadline` + `doNextSubtitle`.
 *     - TodayActionQueue findings strip routes through
 *       `compactStripLabel`.
 *     - ChangeReview accordion routes through
 *       `recentSiteChangesHeading` + `RECENT_SITE_CHANGES_SUBTITLE`.
 *
 *   FIX 2 — Reduce scan-findings prominence.
 *     - TodayDoNextCard's review_site_findings branch uses calmer
 *       neutral styling when only `important` priority findings exist
 *       (criticalCount === 0). Critical findings keep danger styling.
 *
 *   FIX 3 — Recommendation duplication cleanup.
 *     - TodayDoNextCard's `decide_recommendation` branch was DROPPED
 *       (the Command Center's NextBestActionCard above already covers
 *       that surface; the Action Queue below shows the full body).
 *     - Command Center's NextBestActionCard switched from line-clamp-3
 *       multi-line rationale to a true SUMMARY: extracts the leading
 *       sentence via `summarizeRationale`, renders one line with
 *       line-clamp-1, and adds an explicit "Full evidence in the
 *       action queue below" pointer.
 *
 *   FIX 4 — Empty lifecycle compression.
 *     - TodayImplementationQueue empty branch returns null (drops the
 *       full empty card pre-fix occupied).
 *     - TodayLifecycleStrip appends an inline "· nothing waiting"
 *       muted suffix when all actionable counts are zero, and stamps
 *       `data-lifecycle-empty="true"` for telemetry.
 *
 *   FIX 5 — /today hierarchy preserved.
 *     - Order in today-client.tsx remains:
 *       CommandCenter → VisibilityScoreChart → TodayDoNextCard →
 *       TodayLifecycleStrip → TodayImplementationQueue →
 *       TodayActionQueue → wins → MetricsDisclosure → ChangeReview.
 *
 * Negative invariants:
 *   - "scan diff", "page issue", "raw website differences", and
 *     "decide_recommendation" no longer appear in default-rendered
 *     /today JSX (comments + JSDoc may still reference them as
 *     migration history).
 *   - No paid-API imports; no fetch / runNativePoll / runWebsiteScan
 *     / openai / anthropic from any of the touched files.
 *   - No mutations (.upsert / .insert / .update / .delete) in any
 *     touched component file.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const SITE_FINDINGS_LABELS = join(
  REPO_ROOT,
  "src/lib/site-findings-labels.ts",
);
const DO_NEXT_CARD = join(
  REPO_ROOT,
  "src/components/today/today-do-next-card.tsx",
);
const ACTION_QUEUE = join(
  REPO_ROOT,
  "src/components/today/today-action-queue.tsx",
);
const CHANGE_REVIEW = join(
  REPO_ROOT,
  "src/components/today/change-review.tsx",
);
const COMMAND_CENTER = join(
  REPO_ROOT,
  "src/components/today/command-center.tsx",
);
const IMPLEMENTATION_QUEUE = join(
  REPO_ROOT,
  "src/components/today/implementation-queue.tsx",
);
const LIFECYCLE_STRIP = join(
  REPO_ROOT,
  "src/components/today/lifecycle-strip.tsx",
);
const TODAY_CLIENT = join(REPO_ROOT, "src/app/(shell)/today-client.tsx");

const SITE_FINDINGS_LABELS_SRC = readFileSync(SITE_FINDINGS_LABELS, "utf-8");
const DO_NEXT_CARD_SRC = readFileSync(DO_NEXT_CARD, "utf-8");
const ACTION_QUEUE_SRC = readFileSync(ACTION_QUEUE, "utf-8");
const CHANGE_REVIEW_SRC = readFileSync(CHANGE_REVIEW, "utf-8");
const COMMAND_CENTER_SRC = readFileSync(COMMAND_CENTER, "utf-8");
const IMPLEMENTATION_QUEUE_SRC = readFileSync(IMPLEMENTATION_QUEUE, "utf-8");
const LIFECYCLE_STRIP_SRC = readFileSync(LIFECYCLE_STRIP, "utf-8");
const TODAY_CLIENT_SRC = readFileSync(TODAY_CLIENT, "utf-8");

/**
 * Strip block + line + JSX comments + JSX import lines so the
 * negative-vocabulary assertions don't false-positive against
 * migration history that DESCRIBES the old wording.
 */
function stripCommentsAndImports(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "");
}

// ---------------------------------------------------------------------------
// Fix 1 — site-findings-labels module exists and is wired everywhere
// ---------------------------------------------------------------------------

describe("UX.6.2 Fix 1 — site-findings-labels module", () => {
  it("file exists", () => {
    expect(existsSync(SITE_FINDINGS_LABELS)).toBe(true);
  });

  it("exports the primary noun + helpers", () => {
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+const\s+SITE_FINDING_NOUN\s*=\s*"site finding"/,
    );
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+const\s+SITE_FINDING_NOUN_PLURAL\s*=\s*"site findings"/,
    );
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+function\s+compactStripLabel\s*\(/,
    );
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+function\s+doNextHeadline\s*\(/,
    );
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+function\s+doNextSubtitle\s*\(/,
    );
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+function\s+recentSiteChangesHeading\s*\(/,
    );
    expect(SITE_FINDINGS_LABELS_SRC).toMatch(
      /export\s+const\s+RECENT_SITE_CHANGES_SUBTITLE\s*=/,
    );
  });

  it("module is pure (no I/O / no fetch / no mutations)", () => {
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/\bfetch\(/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/readFileSync/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/writeFileSync/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/\.upsert\(/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/\.insert\(/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/\.update\(/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/\.delete\(/);
    expect(SITE_FINDINGS_LABELS_SRC).not.toMatch(/from\s+["']@\/adapters\//);
  });
});

describe("UX.6.2 Fix 1 — Do Next card uses unified vocabulary", () => {
  it("imports doNextHeadline + doNextSubtitle from site-findings-labels", () => {
    expect(DO_NEXT_CARD_SRC).toMatch(
      /import[\s\S]*?doNextHeadline[\s\S]*?doNextSubtitle[\s\S]*?from\s+["']@\/lib\/site-findings-labels["']/,
    );
  });

  it("renames the findings DoNext outcome to review_site_findings", () => {
    expect(DO_NEXT_CARD_SRC).toMatch(/kind:\s*"review_site_findings"/);
    // Old discriminant gone (in source, not just comments).
    const code = stripCommentsAndImports(DO_NEXT_CARD_SRC);
    expect(code).not.toMatch(/kind:\s*"review_scan_diffs"/);
  });

  it("uses 'Site findings to review' as the visible header", () => {
    expect(DO_NEXT_CARD_SRC).toMatch(/Site findings to review/);
  });

  it("CTA link routes to /pages with new copy", () => {
    expect(DO_NEXT_CARD_SRC).toMatch(/Open site findings/);
  });

  it("no 'scan diff' wording remains in JSX text (comments allowed)", () => {
    const code = stripCommentsAndImports(DO_NEXT_CARD_SRC);
    expect(code).not.toMatch(/scan diff/i);
    expect(code).not.toMatch(/Review scan diffs/);
    expect(code).not.toMatch(/review scan diffs/);
  });
});

describe("UX.6.2 Fix 1 — Action Queue findings strip uses unified vocabulary", () => {
  it("imports compactStripLabel from site-findings-labels", () => {
    expect(ACTION_QUEUE_SRC).toMatch(
      /import\s*\{\s*compactStripLabel\s*\}\s*from\s+["']@\/lib\/site-findings-labels["']/,
    );
  });

  it("strip JSX flows through compactStripLabel — old 'page issue' shape gone", () => {
    expect(ACTION_QUEUE_SRC).toMatch(/compactStripLabel\s*\(\s*\{/);
    const code = stripCommentsAndImports(ACTION_QUEUE_SRC);
    expect(code).not.toMatch(/page issue/);
    expect(code).not.toMatch(/urgent/);
  });

  it("typeBreakdownLabel still surfaces via title tooltip (T2 contract preserved)", () => {
    expect(ACTION_QUEUE_SRC).toMatch(
      /title=\{findings\.typeBreakdownLabel\s*\?\?\s*undefined\}/,
    );
  });
});

describe("UX.6.2 Fix 1 — ChangeReview accordion uses unified vocabulary", () => {
  it("imports recentSiteChangesHeading + RECENT_SITE_CHANGES_SUBTITLE", () => {
    expect(CHANGE_REVIEW_SRC).toMatch(
      /import[\s\S]*?recentSiteChangesHeading[\s\S]*?RECENT_SITE_CHANGES_SUBTITLE[\s\S]*?from\s+["']@\/lib\/site-findings-labels["']/,
    );
  });

  it("heading + subtitle flow through the helpers", () => {
    expect(CHANGE_REVIEW_SRC).toMatch(
      /recentSiteChangesHeading\(contentChanges\.length\)/,
    );
    expect(CHANGE_REVIEW_SRC).toMatch(/RECENT_SITE_CHANGES_SUBTITLE/);
  });

  it("old vocabulary gone from JSX text (comments allowed)", () => {
    const code = stripCommentsAndImports(CHANGE_REVIEW_SRC);
    expect(code).not.toMatch(/Scan diffs to review/);
    expect(code).not.toMatch(/raw website differences/);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — Calmer styling for non-critical site-findings DoNext branch
// ---------------------------------------------------------------------------

describe("UX.6.2 Fix 2 — calmer styling for non-critical site findings", () => {
  it("DoNext review_site_findings branch keys tone off criticalCount", () => {
    // The tone ternary must explicitly check criticalCount > 0 for
    // status-danger; non-critical branch picks neutral styling.
    expect(DO_NEXT_CARD_SRC).toMatch(
      /decision\.criticalCount\s*>\s*0[\s\S]{0,300}status-danger[\s\S]{0,300}border-border/,
    );
  });

  it("non-critical tone uses neutral border/bg, NOT status-warning", () => {
    // Pre-fix used status-warning for the important-only branch.
    // Pin the new neutral palette presence.
    expect(DO_NEXT_CARD_SRC).toMatch(
      /border-border\/60\s+bg-surface-inset\/30\s+text-foreground/,
    );
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — Recommendation duplication cleanup
// ---------------------------------------------------------------------------

describe("UX.6.2 Fix 3 — Do Next no longer triplicates the top-pick rec", () => {
  it("decide_recommendation discriminant DROPPED from DoNextDecision union", () => {
    const code = stripCommentsAndImports(DO_NEXT_CARD_SRC);
    expect(code).not.toMatch(/kind:\s*"decide_recommendation"/);
    // The branch render is gone too.
    expect(code).not.toMatch(
      /data-today-do-next="decide_recommendation"/,
    );
  });

  it("decideDoNext priority list pinned — pending → site_findings → calm", () => {
    // Source-order pin: ship_pending check appears BEFORE the findings
    // check, which appears BEFORE the calm fallthrough.
    const shipIdx = DO_NEXT_CARD_SRC.indexOf('kind: "ship_pending"');
    const findingsIdx = DO_NEXT_CARD_SRC.indexOf(
      'kind: "review_site_findings"',
    );
    expect(shipIdx).toBeGreaterThan(-1);
    expect(findingsIdx).toBeGreaterThan(shipIdx);
  });

  it("topPick prop kept on the type for caller stability (type-only)", () => {
    // Operator-stability: removing the prop would force a today-client
    // refactor. Type stays; the value is just unused now.
    expect(DO_NEXT_CARD_SRC).toMatch(/topPick\?\:\s*TopPickSummary\s*\|\s*null/);
  });
});

describe("UX.6.2 Fix 3 — Command Center NextBestActionCard is a true summary", () => {
  it("declares summarizeRationale helper that extracts a leading sentence", () => {
    expect(COMMAND_CENTER_SRC).toMatch(/function\s+summarizeRationale/);
    // The helper splits on the first sentence break.
    expect(COMMAND_CENTER_SRC).toMatch(/sentenceEnd[\s\S]{0,200}indexOf\("\. "\)/);
  });

  it("NextBestActionCard renders the one-line reason via line-clamp-1", () => {
    // Pre-fix used line-clamp-3 — pin the new contract. The
    // data-attribute and the className may appear in either order
    // around the JSX element, so allow both.
    expect(COMMAND_CENTER_SRC).toMatch(
      /(?:data-next-best-action-reason="one-line"[\s\S]{0,400}line-clamp-1)|(?:line-clamp-1[\s\S]{0,400}data-next-best-action-reason="one-line")/,
    );
    // Negative pin: line-clamp-3 only allowed inside comments.
    const code = stripCommentsAndImports(COMMAND_CENTER_SRC);
    expect(code).not.toMatch(/line-clamp-3/);
  });

  it("renders an explicit 'full evidence below' pointer", () => {
    expect(COMMAND_CENTER_SRC).toMatch(
      /data-next-best-action-pointer="full-body-below"/,
    );
    expect(COMMAND_CENTER_SRC).toMatch(
      /Full evidence in the action queue below/,
    );
  });

  it("CTA still routes to action.href with 'Open recommendation' copy", () => {
    expect(COMMAND_CENTER_SRC).toMatch(
      /data-next-best-action-cta="open-recommendation"/,
    );
    expect(COMMAND_CENTER_SRC).toMatch(/Open recommendation/);
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — Empty-lifecycle compression
// ---------------------------------------------------------------------------

describe("UX.6.2 Fix 4 — empty implementation queue compresses to null", () => {
  it("empty branch returns null instead of a styled card", () => {
    // Match the early-return pattern in the empty branch.
    expect(IMPLEMENTATION_QUEUE_SRC).toMatch(
      /if\s*\(\s*queue\.length\s*===\s*0\s*\)\s*\{[\s\S]{0,800}return\s+null;/,
    );
  });

  it("'Nothing waiting on you' card copy gone from JSX (comments allowed)", () => {
    const code = stripCommentsAndImports(IMPLEMENTATION_QUEUE_SRC);
    expect(code).not.toMatch(/Nothing waiting on you/);
    expect(code).not.toMatch(/data-today-implementation-queue="empty"/);
  });
});

describe("UX.6.2 Fix 4 — lifecycle strip surfaces the empty state inline", () => {
  it("computes allActionableCountsZero from pending/needs-review/not-found", () => {
    expect(LIFECYCLE_STRIP_SRC).toMatch(
      /allActionableCountsZero[\s\S]{0,400}counts\.pendingImplementation\s*===\s*0[\s\S]{0,200}counts\.needsReview\s*===\s*0[\s\S]{0,200}counts\.notFoundAfter7d\s*===\s*0/,
    );
  });

  it("renders a 'nothing waiting' suffix when allActionableCountsZero", () => {
    expect(LIFECYCLE_STRIP_SRC).toMatch(/nothing waiting/);
    expect(LIFECYCLE_STRIP_SRC).toMatch(
      /data-lifecycle-nothing-waiting="true"/,
    );
  });

  it("stamps data-lifecycle-empty for telemetry", () => {
    expect(LIFECYCLE_STRIP_SRC).toMatch(
      /data-lifecycle-empty=\{allActionableCountsZero\s*\?\s*"true"\s*:\s*"false"\}/,
    );
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — /today hierarchy preserved
// ---------------------------------------------------------------------------

describe("UX.6.2 Fix 5 — /today hierarchy is operator-required order", () => {
  it("source order: CC → Visibility → DoNext → LifecycleStrip → ImplQueue → ActionQueue → wins → Metrics → ChangeReview", () => {
    const ccIdx = TODAY_CLIENT_SRC.indexOf("<CommandCenter");
    const visIdx = TODAY_CLIENT_SRC.indexOf("<VisibilityScoreChart");
    const doNextIdx = TODAY_CLIENT_SRC.indexOf("<TodayDoNextCard");
    const stripIdx = TODAY_CLIENT_SRC.indexOf("<TodayLifecycleStrip");
    const implIdx = TODAY_CLIENT_SRC.indexOf("<TodayImplementationQueue");
    const queueIdx = TODAY_CLIENT_SRC.indexOf("<TodayActionQueue");
    const winsIdx = TODAY_CLIENT_SRC.indexOf('data-today-section="wins"');
    const metricsIdx = TODAY_CLIENT_SRC.indexOf("<TodayMetricsDisclosure");
    const changeReviewIdx = TODAY_CLIENT_SRC.indexOf("<ChangeReview");

    expect(ccIdx).toBeGreaterThan(-1);
    expect(visIdx).toBeGreaterThan(ccIdx);
    expect(doNextIdx).toBeGreaterThan(visIdx);
    expect(stripIdx).toBeGreaterThan(doNextIdx);
    expect(implIdx).toBeGreaterThan(stripIdx);
    expect(queueIdx).toBeGreaterThan(implIdx);
    expect(winsIdx).toBeGreaterThan(queueIdx);
    expect(metricsIdx).toBeGreaterThan(winsIdx);
    expect(changeReviewIdx).toBeGreaterThan(metricsIdx);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting — no paid APIs / no mutations / no scary jargon on default
// ---------------------------------------------------------------------------

describe("UX.6.2 — no paid APIs / no mutations introduced by the cleanup", () => {
  const TOUCHED_SRCS: Array<[string, string]> = [
    ["site-findings-labels", SITE_FINDINGS_LABELS_SRC],
    ["today-do-next-card", DO_NEXT_CARD_SRC],
    ["today-action-queue", ACTION_QUEUE_SRC],
    ["change-review", CHANGE_REVIEW_SRC],
    ["command-center", COMMAND_CENTER_SRC],
    ["implementation-queue", IMPLEMENTATION_QUEUE_SRC],
    ["lifecycle-strip", LIFECYCLE_STRIP_SRC],
  ];

  for (const [name, src] of TOUCHED_SRCS) {
    it(`${name} has no paid-API imports / fetch / runners`, () => {
      expect(src).not.toMatch(/from\s+["']openai["']/);
      expect(src).not.toMatch(/from\s+["']@anthropic/);
      expect(src).not.toContain("runNativePoll");
      expect(src).not.toContain("runWebsiteScan");
      // The strip is a server component file that uses Next's Link;
      // it does NOT call window.fetch from the browser.
      expect(src).not.toMatch(/\bfetch\(/);
    });

    it(`${name} has no persisted-store mutations`, () => {
      expect(src).not.toMatch(/\.upsert\(/);
      expect(src).not.toMatch(/\.insert\(/);
      expect(src).not.toMatch(/\.update\(/);
      expect(src).not.toMatch(/\.delete\(/);
    });
  }
});
