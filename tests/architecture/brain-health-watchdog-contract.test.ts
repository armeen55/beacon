/**
 * Architecture invariant — Trust Sprint T7.3 (2026-05-07).
 *
 * Pins the brain-health watchdog's contract:
 *
 *   - It runs the 3 verify scripts (tenant-data-integrity,
 *     observation-dedup-integrity, verdict-rematerialization-integrity).
 *   - It runs build-brain-health-report and parses the grade.
 *   - It checks the AEO intelligence manifest exists + has the 7
 *     expected derivation files.
 *   - It checks poll freshness against POLL_FRESHNESS_HOURS.
 *   - It checks live_at freshness against LIVE_AT_STUCK_DAYS.
 *   - It checks source_rec_id stamping on RECENT (≤7d) rec-derived
 *     changelog rows; it does NOT fail on legacy CSV/PDF/scanner rows
 *     (those correctly lack source_rec_id by design).
 *   - It exits non-zero on HARD FAIL; YELLOW on WARN-only; GREEN on
 *     all-PASS.
 *   - npm run verify:brain-health is wired in package.json.
 *
 * Negative invariants:
 *   - The watchdog must NOT fail on idle queue (no recent rec-derived
 *     changelog rows = WARN, not FAIL).
 *   - The watchdog must NOT fail on legacy import rows.
 *   - The watchdog must NOT trigger paid APIs / OpenAI / scans.
 *   - The watchdog must NOT mutate persisted rows.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const WATCHDOG_PATH = join(REPO_ROOT, "scripts/verify-brain-health-watchdog.ts");
const PKG_PATH = join(REPO_ROOT, "package.json");
const SRC = readFileSync(WATCHDOG_PATH, "utf-8");
const PKG = JSON.parse(readFileSync(PKG_PATH, "utf-8")) as { scripts?: Record<string, string> };

describe("T7.3 — brain-health watchdog contract", () => {
  it("watchdog file exists and is callable", () => {
    expect(SRC.length).toBeGreaterThan(0);
    expect(SRC).toContain("verify-brain-health-watchdog");
  });

  it("npm run verify:brain-health is wired", () => {
    expect(PKG.scripts?.["verify:brain-health"]).toContain("verify-brain-health-watchdog.ts");
  });

  it("invokes all 3 child verify scripts", () => {
    expect(SRC).toContain("scripts/verify-tenant-data-integrity.ts");
    expect(SRC).toContain("scripts/verify-observation-dedup-integrity.ts");
    expect(SRC).toContain("scripts/verify-verdict-rematerialization-integrity.ts");
  });

  it("runs build-brain-health-report and parses the grade", () => {
    expect(SRC).toContain("build-brain-health-report.ts");
    expect(SRC).toContain("Brain Readiness Grade");
  });

  it("checks AEO intelligence manifest with all 7 expected derivation files", () => {
    const expectedFiles = [
      "daily-platform-summary.json",
      "weekly-platform-summary.json",
      "monthly-platform-summary.json",
      "competitor-trajectory.json",
      "prompt-trajectory.json",
      "citation-source-trajectory.json",
      "geo-service-trajectory.json",
    ];
    for (const f of expectedFiles) {
      expect(SRC).toContain(f);
    }
  });

  it("declares POLL_FRESHNESS_HOURS threshold", () => {
    expect(/POLL_FRESHNESS_HOURS\s*=\s*\d+/.test(SRC)).toBe(true);
  });

  it("declares LIVE_AT_STUCK_DAYS threshold", () => {
    expect(/LIVE_AT_STUCK_DAYS\s*=\s*\d+/.test(SRC)).toBe(true);
  });

  it("excludes legacy import + scanner rows from source_rec_id check (correct by design)", () => {
    expect(SRC).toContain("pdf_changelog_rebuild");
    expect(SRC).toContain("changelog_csv");
    expect(SRC).toContain("scan_detection");
  });

  it("D-grade brain health forces FAIL", () => {
    expect(/grade === "D"[\s\S]*?status: "FAIL"/.test(SRC)).toBe(true);
  });

  it("derived confidence collapse to all-medium forces FAIL", () => {
    expect(/derived confidence collapsed to 100% moderate/.test(SRC)).toBe(true);
  });

  it("idle queue (no recent rec-derived rows) is WARN, not FAIL", () => {
    expect(/no recent accept-derived changelog rows[\s\S]*status: "WARN"/.test(SRC)).toBe(true);
  });

  it("exit code is 0 on PASS, 0 on YELLOW (warn-only), 1 on FAIL", () => {
    expect(SRC).toContain("WATCHDOG: GREEN");
    expect(SRC).toContain("WATCHDOG: YELLOW");
    expect(SRC).toContain("WATCHDOG: RED");
    expect(/if \(fails > 0\)[\s\S]*process\.exit\(1\)/.test(SRC)).toBe(true);
  });

  it("does NOT trigger paid APIs / OpenAI / scans / mutations", () => {
    // Negative invariants — these symbols must NOT appear in the watchdog.
    expect(SRC).not.toContain("openai");
    expect(SRC).not.toContain("OpenAI");
    expect(SRC).not.toContain("perplexity");
    expect(SRC).not.toContain("poll-openai");
    expect(SRC).not.toContain("poll-perplexity");
    expect(SRC).not.toContain("runWebsiteScan");
    expect(SRC).not.toContain("syncRecommendedEdits");
    expect(SRC).not.toContain("syncUrlChangeOutcomes");
    expect(SRC).not.toContain("writeStore(");
    expect(SRC).not.toContain("persistRecommendedEditsLocal");
  });
});
