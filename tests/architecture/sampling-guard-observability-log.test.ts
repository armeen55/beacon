/**
 * D4 (operator audit, 2026-05-05) — sampling-status guard observability
 * log shape invariant.
 *
 * The materializer (`materializeUrlOutcomes`) MUST emit a structured
 * `log.warn` whenever `computeChangeVerdict` returns a verdict with
 * `sampling_guard_demoted` set. The log payload must include all the
 * fields the operator asked for: tenantId, changeId, url, window,
 * originalVerdict, demotedVerdict, reason.
 *
 * This is a source-level invariant rather than an integration test —
 * `materializeUrlOutcomes` is async + depends on `currentTenantId()` +
 * Supabase + canonical observation store, so a runtime test would need
 * a heavy fixture stack. Source-shape pinning catches the same
 * regression: if a future commit removes the log call, deletes a
 * required field, or moves the call out of the demotion branch, this
 * test fails.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const MATERIALIZER_PATH = join(
  REPO_ROOT,
  "src/domains/attribution/url-change-outcome.ts",
);
const SRC = readFileSync(MATERIALIZER_PATH, "utf-8");

describe("D4 — materializer emits structured log.warn on sampling-guard demotion", () => {
  it("log.warn call exists with the operator-locked message string", () => {
    expect(
      SRC.includes(
        '[verdict-engine] sampling-status guard demoted verdict',
      ),
      "url-change-outcome.ts must emit a log.warn with the message '[verdict-engine] sampling-status guard demoted verdict' (D4)",
    ).toBe(true);
  });

  it("log payload includes all 7 operator-required fields", () => {
    // The brief: tenantId, date/window, url/changeId, samplingStatus,
    // originalVerdict, demotedVerdict, reason.
    // Our shape: tenantId, changeId, url, windowAsOf, originalVerdict,
    // demotedVerdict, reason (samplingStatus is implicit in the reason
    // value: "proof_day_in_post_window" / "no_full_days_in_post_window").
    const required = [
      "tenantId,",
      "changeId:",
      "url:",
      "windowAsOf:",
      "originalVerdict:",
      "demotedVerdict:",
      "reason:",
    ];
    const missing = required.filter((f) => !SRC.includes(f));
    expect(
      missing,
      `log.warn payload missing required field(s): ${missing.join(", ")} (D4)`,
    ).toEqual([]);
  });

  it("log.warn fires inside the `sampling_guard_demoted` branch (only on demotion)", () => {
    const demotionGuardIdx = SRC.indexOf(
      "computed.verdict.sampling_guard_demoted",
    );
    const logCallIdx = SRC.indexOf(
      '[verdict-engine] sampling-status guard demoted verdict',
    );
    expect(demotionGuardIdx).toBeGreaterThan(0);
    expect(logCallIdx).toBeGreaterThan(0);
    expect(
      logCallIdx,
      "log.warn call must appear AFTER the `if (computed.verdict.sampling_guard_demoted)` guard (D4)",
    ).toBeGreaterThan(demotionGuardIdx);
    // The log must be inside the same conditional block — no `}` between
    // the guard and the log call.
    const between = SRC.slice(demotionGuardIdx, logCallIdx);
    // There should be no `}` that closes the guard before the log call
    // — because the log is inside the guard. Allow `})` (object closer)
    // and `}\)` patterns.
    const closingBraces = between.match(/^\s*\}\s*$/gm) ?? [];
    expect(
      closingBraces.length,
      "log.warn must be inside the sampling_guard_demoted conditional block (D4)",
    ).toBe(0);
  });

  it("log level is `warn` (operationally interesting, surfaces in default dashboards)", () => {
    // Brief: "Add a structured log when sampling-status guard demotes
    // or blocks a verdict." Operator dashboards typically default to
    // showing warn+ — a demotion IS operationally interesting (a
    // measured-win was suppressed). info would be too quiet.
    const idx = SRC.indexOf(
      '[verdict-engine] sampling-status guard demoted verdict',
    );
    expect(idx).toBeGreaterThan(0);
    // Look back ~80 chars to find the `log.warn(` opening.
    const before = SRC.slice(Math.max(0, idx - 80), idx);
    expect(
      before.includes("log.warn"),
      "Sampling-guard demotion log must be at warn level (D4)",
    ).toBe(true);
  });
});

describe("D4 — UrlVerdict type exposes sampling_guard_demoted metadata", () => {
  it("UrlVerdict type declares the sampling_guard_demoted field", () => {
    const verdictTypePath = join(
      REPO_ROOT,
      "src/domains/attribution/url-verdict.ts",
    );
    const verdictSrc = readFileSync(verdictTypePath, "utf-8");
    expect(
      verdictSrc.match(
        /sampling_guard_demoted\?\s*:\s*SamplingGuardDemotion/,
      ),
      "UrlVerdict must declare optional sampling_guard_demoted field (D4)",
    ).not.toBeNull();
    // SamplingGuardDemotion type itself must be defined and have the
    // three required fields.
    expect(verdictSrc.includes("export type SamplingGuardDemotion")).toBe(
      true,
    );
    expect(verdictSrc.includes('"proof_day_in_post_window"')).toBe(true);
    expect(verdictSrc.includes('"no_full_days_in_post_window"')).toBe(true);
  });
});
