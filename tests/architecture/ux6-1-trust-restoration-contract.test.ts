/**
 * Architecture invariants — UX.6.1 Trust Restoration on /today (2026-05-07).
 *
 * Pins the contract for the three trust-breaking-issue fixes that
 * landed in UX.6.1:
 *
 *   FIX 1 — Brain readiness card lying in production.
 *     - command-center-data.ts exports a pure derive helper
 *       `deriveBrainSummaryFromCounts` so /today can render a
 *       grade-based brain summary even when the disk JSON is
 *       unreachable (production: `.data/_reports/` is gitignored).
 *     - today-data.ts wires it into resolveCommandCenterFailSoft
 *       and feeds it already-loaded /today inputs (no Supabase
 *       round-trip).
 *
 *   FIX 2 — Poll health false alarm before scheduled poll.
 *     - poll-health-calm-banner.tsx exists with `isPreCronPending`
 *       helper and renders a calm "Next reading scheduled" UI.
 *     - today-client.tsx gates between PollHealthBlock (warning)
 *       and PollHealthCalmBanner (calm) using isPreCronPending.
 *
 *   FIX 3 — Wins copy too caveated by default.
 *     - The default-rendered rationale text on win cards leads with
 *       "gained citations" (positive) / "lost citations" (negative)
 *       rather than the "URL-level signal — not proof of causation"
 *       methodology caveat.
 *     - The methodology caveat still lives in lineageBullets so the
 *       drill-down ("Why this verdict?" / detail layer) keeps the
 *       honest disclosure.
 *
 * Negative invariants:
 *   - Fix 1 derive must not introduce paid-API calls or unbounded
 *     reads — pure compute over already-loaded inputs.
 *   - Fix 2 calm banner must be pure presentation (no client
 *     interactivity, no fetch, no mutations).
 *   - Fix 3 must NOT remove the causation caveat from the drawer
 *     (lineageBullets); it only repositions the default copy.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const COMMAND_CENTER_DATA = join(
  REPO_ROOT,
  "src/domains/today/command-center-data.ts",
);
const TODAY_DATA = join(REPO_ROOT, "src/app/(shell)/today-data.ts");
const POLL_HEALTH_CALM_BANNER = join(
  REPO_ROOT,
  "src/components/today/poll-health-calm-banner.tsx",
);

const COMMAND_CENTER_DATA_SRC = readFileSync(COMMAND_CENTER_DATA, "utf-8");
const TODAY_DATA_SRC = readFileSync(TODAY_DATA, "utf-8");
const POLL_HEALTH_CALM_BANNER_SRC = readFileSync(
  POLL_HEALTH_CALM_BANNER,
  "utf-8",
);

// ---------------------------------------------------------------------------
// FIX 1 — Brain Readiness derive helper + wiring
// ---------------------------------------------------------------------------

describe("UX.6.1 Fix 1 — Brain readiness derive helper", () => {
  it("command-center-data.ts exports the derive helper + input type", () => {
    expect(COMMAND_CENTER_DATA_SRC).toMatch(
      /export\s+function\s+deriveBrainSummaryFromCounts\s*\(/,
    );
    expect(COMMAND_CENTER_DATA_SRC).toMatch(
      /export\s+type\s+DeriveBrainSummaryInput\s*=/,
    );
  });

  it("derive helper is pure compute — no I/O / no fetch / no mutations", () => {
    const fnMatch = COMMAND_CENTER_DATA_SRC.match(
      /export\s+function\s+deriveBrainSummaryFromCounts[\s\S]*?\n\}/,
    );
    expect(fnMatch).toBeTruthy();
    if (!fnMatch) return;
    const body = fnMatch[0];
    expect(body).not.toMatch(/\bfetch\(/);
    expect(body).not.toMatch(/readFileSync/);
    expect(body).not.toMatch(/writeFileSync/);
    expect(body).not.toMatch(/\.upsert\(/);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
    // Helper is computed on the fly — generatedAt stamp must be empty
    // so consumers can distinguish "live-derived" from "disk JSON".
    expect(body).toMatch(/generatedAt:\s*""/);
  });

  it("derive helper returns null only when totalObservationCount <= 0", () => {
    const fnMatch = COMMAND_CENTER_DATA_SRC.match(
      /export\s+function\s+deriveBrainSummaryFromCounts[\s\S]*?\n\}/,
    );
    expect(fnMatch).toBeTruthy();
    if (!fnMatch) return;
    const body = fnMatch[0];
    expect(body).toMatch(/totalObservationCount\s*<=\s*0/);
    expect(body).toMatch(/return\s+null/);
  });

  it("derive helper grades 4 sections in canonical order", () => {
    const fnMatch = COMMAND_CENTER_DATA_SRC.match(
      /export\s+function\s+deriveBrainSummaryFromCounts[\s\S]*?\n\}/,
    );
    expect(fnMatch).toBeTruthy();
    if (!fnMatch) return;
    const body = fnMatch[0];
    const dataIdx = body.indexOf('"Data health"');
    const scoreIdx = body.indexOf('"Score health"');
    const recIdx = body.indexOf('"Recommendation health"');
    const attrIdx = body.indexOf('"Attribution health"');
    expect(dataIdx).toBeGreaterThan(-1);
    expect(scoreIdx).toBeGreaterThan(dataIdx);
    expect(recIdx).toBeGreaterThan(scoreIdx);
    expect(attrIdx).toBeGreaterThan(recIdx);
  });
});

describe("UX.6.1 Fix 1 — today-data.ts wires the derive fallback", () => {
  it("imports deriveBrainSummaryFromCounts from command-center-data", () => {
    expect(TODAY_DATA_SRC).toMatch(
      /import\s+\{[\s\S]*?deriveBrainSummaryFromCounts[\s\S]*?\}\s+from\s+["']@\/domains\/today\/command-center-data["']/,
    );
  });

  it("resolveCommandCenterFailSoft accepts already-loaded counts as args", () => {
    // Pin the new arg-shape so a future refactor doesn't silently
    // revert to a no-arg call (which would re-introduce the bug).
    expect(TODAY_DATA_SRC).toMatch(
      /function resolveCommandCenterFailSoft\(args:\s*\{[\s\S]{0,400}observations:[\s\S]{0,200}snapshots:[\s\S]{0,200}citationEvidenceIndex:[\s\S]{0,200}recommendationQueueSize:/,
    );
  });

  it("resolveCommandCenterFailSoft applies derived fallback when brain is null", () => {
    const fnMatch = TODAY_DATA_SRC.match(
      /function resolveCommandCenterFailSoft\([\s\S]*?\nfunction\s/,
    );
    expect(fnMatch).toBeTruthy();
    if (!fnMatch) return;
    const body = fnMatch[0];
    // The fallback must reference the derive helper.
    expect(body).toMatch(/deriveBrainFromTodayInputs\(args\)/);
    // The fallback must only fire when brain is null.
    expect(body).toMatch(/!resolved\.brain/);
    // When the derive succeeds, hasAnyData flips to true.
    expect(body).toMatch(/hasAnyData:\s*true/);
  });

  it("call site passes observations / snapshots / citationEvidenceIndex / recommendationQueueSize", () => {
    // Pin the four required args at the call site so an offshore-dev
    // refactor can't accidentally drop one.
    expect(TODAY_DATA_SRC).toMatch(
      /resolveCommandCenterFailSoft\(\{[\s\S]{0,800}observations:[\s\S]{0,400}snapshots:[\s\S]{0,400}citationEvidenceIndex[\s\S]{0,400}recommendationQueueSize:/,
    );
  });

  it("derive helper does NOT introduce unbounded Supabase reads or paid APIs", () => {
    const fnMatch = TODAY_DATA_SRC.match(
      /function deriveBrainFromTodayInputs[\s\S]*?\n\}/,
    );
    expect(fnMatch).toBeTruthy();
    if (!fnMatch) return;
    const body = fnMatch[0];
    expect(body).not.toMatch(/\bfetch\(/);
    expect(body).not.toMatch(/select\(['"]\*['"]\)/);
    expect(body).not.toMatch(/from\s+["']@\/adapters\//);
    expect(body).not.toContain("runNativePoll");
    expect(body).not.toContain("runWebsiteScan");
    expect(body).not.toMatch(/\.upsert\(/);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.delete\(/);
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — Poll Health Calm Banner + pre-cron gating
// ---------------------------------------------------------------------------

describe("UX.6.1 Fix 2 — Poll health calm banner exists and is pure", () => {
  it("poll-health-calm-banner.tsx file exists", () => {
    expect(existsSync(POLL_HEALTH_CALM_BANNER)).toBe(true);
  });

  it("exports PollHealthCalmBanner component + isPreCronPending helper", () => {
    expect(POLL_HEALTH_CALM_BANNER_SRC).toMatch(
      /export\s+function\s+PollHealthCalmBanner/,
    );
    expect(POLL_HEALTH_CALM_BANNER_SRC).toMatch(
      /export\s+function\s+isPreCronPending/,
    );
  });

  it("calm banner is pure presentation — no client interactivity", () => {
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/useState/);
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/useEffect/);
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/useTransition/);
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/\bfetch\(/);
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/onClick=/);
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/onSubmit=/);
    // No "use client" directive — calm banner is a server component
    // (it's pure markup).
    expect(POLL_HEALTH_CALM_BANNER_SRC).not.toMatch(/^"use client"/m);
  });

  it("calm banner copy uses customer-safe on-demand language", () => {
    // On-demand pivot: the calm banner no longer claims a scheduled
    // "Next reading" at 07:00 UTC (there is no cron / schedule). It now
    // shows the latest complete reading and points the operator at the
    // refresh action — data only updates when they refresh their
    // connected sources. These are the operator-locked phrases.
    expect(POLL_HEALTH_CALM_BANNER_SRC).toContain("Showing your latest reading");
    expect(POLL_HEALTH_CALM_BANNER_SRC).toMatch(
      /Refresh\s+your connected data/,
    );
    // Forbidden alarming words — the calm path must not look warning-
    // shaped. Strip block + line comments so JSDoc that QUOTES the old
    // warning text (e.g. "AI tracking has not run yet today") doesn't
    // false-positive against the assertion.
    const code = POLL_HEALTH_CALM_BANNER_SRC.replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    ).replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/has not run yet/i);
    expect(code).not.toMatch(/\bmissing\b/i);
    expect(code).not.toMatch(/\bfailed\b/i);
  });

  it("isPreCronPending requires ALL platforms pending AND time < 08:00 UTC", () => {
    // The whole point of the gate. Any other state must render the
    // existing PollHealthBlock (warning), not the calm banner.
    expect(POLL_HEALTH_CALM_BANNER_SRC).toMatch(
      /every\s*\(\s*\(\s*p\s*\)\s*=>\s*p\.status\s*===\s*["']pending["']/,
    );
    // 08:00 UTC cutoff = 07:00 UTC scheduled cron + 1h grace.
    expect(POLL_HEALTH_CALM_BANNER_SRC).toMatch(/8\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it("isPreCronPending returns false on empty platforms array", () => {
    // Empty platforms is the not-yet-loaded case; render whatever the
    // existing path renders (which is nothing — pollHealth-null skips
    // the gate entirely in today-client.tsx).
    expect(POLL_HEALTH_CALM_BANNER_SRC).toMatch(/platforms\.length\s*===\s*0/);
  });
});


// ---------------------------------------------------------------------------
// FIX 3 — Wins copy: confident default, caveat in drawer
// ---------------------------------------------------------------------------

describe("UX.6.1 Fix 3 — Wins rationale leads with confident copy", () => {
  it("wins rationale uses 'gained / lost citations' default copy", () => {
    expect(TODAY_DATA_SRC).toContain(
      "This page gained citations after the change",
    );
    expect(TODAY_DATA_SRC).toContain(
      "This page lost citations after the change",
    );
  });

  it("wins rationale references repeating-the-pattern framing", () => {
    expect(TODAY_DATA_SRC).toMatch(
      /Beacon is tracking the pattern so you can repeat what worked/,
    );
  });

  it("default rationale does NOT lead with the causation caveat", () => {
    // Search for the OLD copy that the audit flagged as too caveated.
    // The rationale field must NOT start with this phrase. The caveat
    // is allowed to appear ELSEWHERE in the source (in lineageBullets
    // text below) but not in the default-rendered rationale string.
    const rationaleMatch = TODAY_DATA_SRC.match(
      /const\s+rationale\s*=[\s\S]{0,400}?;/,
    );
    expect(rationaleMatch).toBeTruthy();
    if (!rationaleMatch) return;
    const rationaleBody = rationaleMatch[0];
    expect(rationaleBody).not.toMatch(/not proof of causation/i);
    expect(rationaleBody).not.toMatch(/URL-level signal/i);
  });

  it("methodology caveat is preserved in lineageBullets (drawer copy)", () => {
    // The honest disclosure still lives in the drill-down — we only
    // moved it out of the default-rendered rationale.
    expect(TODAY_DATA_SRC).toContain("not proof of causation");
    expect(TODAY_DATA_SRC).toContain("URL-level correlation");
  });
});
