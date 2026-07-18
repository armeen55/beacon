/**
 * OpsPipelineSection contract pins (2026-07-02, master plan item 10).
 *
 * Source-level pins (the sibling pattern for server sections): the Ops card
 * must read the PERSISTED invariant check (never recompute on render), cap at
 * 2 red items, self-hide when clean, fail soft to null, carry dark-mode +
 * small-screen classes, and never contain an em or en dash.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "ops-pipeline-section.tsx"), "utf8");

describe("OpsPipelineSection contract", () => {
  it("reads the persisted pipeline health store (no recompute on render)", () => {
    expect(SRC).toContain('from "@/domains/ops/pipeline-health-store"');
    expect(SRC).toContain("readPipelineHealth(tenantId)");
    expect(SRC).not.toContain("gatherPipelineReadings");
    expect(SRC).not.toContain("checkPipelineInvariants");
  });

  it("self-hides when nothing is broken, stale, stalled, or spiking (one shared home)", () => {
    expect(SRC).toContain("if (!pipelineFires && !warnFires && !deadmanFires && !spikeFires) return null");
  });

  it("I-60: staleness is a SEPARATE amber tier, never the red banner", () => {
    // P2-a (2026-07-10) - warn/alarm split + redFires now come from the SHARED
    // deriveDefectSignal (domains/ops/defect-signal.ts), the same pure read page.tsx's Today
    // command uses, so the two can never disagree about what counts as a red defect again.
    expect(SRC).toContain('from "@/domains/ops/defect-signal"');
    expect(SRC).toContain("deriveDefectSignal({");
    expect(SRC).toContain("alarmViolations, warnViolations, redFires");
    // ...render in their own amber box with the amber heading, on their own if needed.
    expect(SRC).toContain('data-staleness-warn="true"');
    expect(SRC).toContain("Some data is getting stale");
    expect(SRC).toContain("<WarnRow");
    // amber staleness uses the status-warning token (no new raw palette classes),
    // never the red banner's palette.
    expect(SRC).toContain("border-status-warning/40");
  });

  it("I-60: the shared defect-signal module itself does the alarm/warn split and the redFires OR", () => {
    const signalSrc = readFileSync(resolve(__dirname, "../../domains/ops/defect-signal.ts"), "utf8");
    expect(signalSrc).toContain('v.severity !== "info" && v.severity !== "warn"');
    expect(signalSrc).toContain('v.severity === "warn"');
    expect(signalSrc).toContain("pipelineFires || deadmanFires || spikeFires");
  });

  it("N39: the error-spike line joins this block (never a second widget) and is deadline-bound", () => {
    expect(SRC).toContain('from "@/domains/ops/error-spike"');
    expect(SRC).toContain("loadErrorSpikeLine(tenantId)");
    expect(SRC).toContain('data-error-spike="true"');
    expect(SRC).toContain('href="/diagnostics/errors"');
  });

  it("T0c: the deadman verdict joins this block (never a second widget) and is deadline-bound", () => {
    expect(SRC).toContain('from "@/domains/ops/deadman-view"');
    expect(SRC).toContain("loadDeadmanVerdict(tenantId)");
    expect(SRC).toContain("valueWithDeadline");
    expect(SRC).toContain('data-deadman-line="true"');
    // Only one <section> in this file - the deadman renders rows inside it.
    expect(SRC.match(/<section/g) ?? []).toHaveLength(1);
  });

  it("caps at 2 items and admits the rest in one line", () => {
    expect(SRC).toContain("MAX_SHOWN = 2");
    expect(SRC).toContain("alarmViolations.slice(0, MAX_SHOWN)");
    expect(SRC).toContain("more stage");
  });

  it("fails soft to null (never a crashed Today)", () => {
    expect(SRC).toMatch(/catch\s*\{\s*return null;\s*\}/);
  });

  it("renders red attention styling with dark-mode + 375px safety", () => {
    expect(SRC).toContain("border-red-200");
    expect(SRC).toContain("dark:border-red-900/60");
    expect(SRC).toContain("break-words");
    expect(SRC).toContain("flex-wrap");
    expect(SRC).toContain("tabular-nums");
  });

  it("speaks first person with the checked time and a next step", () => {
    expect(SRC).toContain("Your data pipe needs attention");
    expect(SRC).toContain("I checked");
    expect(SRC).toContain("I recheck this automatically while you use Beacon");
    expect(SRC).toContain('href="/settings/connectors"');
  });

  it("contains no em or en dashes anywhere", () => {
    expect(SRC).not.toMatch(/[–—]/);
  });

  it("is mounted on the Today page above the hero (A1: never buried below a lying stat)", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    // P2-a (2026-07-10) - page.tsx also imports this file's exported DEADMAN_DEADLINE_MS
    // constant, so its own deadman/error-spike reads for the Today command's defect signal
    // stay deadline-bound the same as this banner's.
    expect(page).toContain('import { OpsPipelineSection, DEADMAN_DEADLINE_MS } from "./ops-pipeline-section"');
    expect(page).toContain("<OpsPipelineSection tenantId={tenantId} />");
    const opsIdx = page.indexOf("<OpsPipelineSection tenantId={tenantId} />");
    // UX4 item 6 moved the header's "Update data" button into <PageHeader>'s children, so the
    // hero is no longer self-closing; match its opening tag instead.
    const heroIdx = page.indexOf("<PageHeader title={greeting} description={brief}>");
    expect(opsIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeGreaterThan(-1);
    expect(opsIdx).toBeLessThan(heroIdx);
  });

  it("the cron wires the invariant check as an isolated final step", () => {
    const cron = readFileSync(
      resolve(__dirname, "../../lib/connectors/cron-sync.ts"),
      "utf8",
    );
    expect(cron).toContain("gatherPipelineReadings(t.id)");
    expect(cron).toContain("checkPipelineInvariants(readings)");
    expect(cron).toContain("writePipelineHealth(buildPipelineHealthRow(readings, violations))");
    expect(cron).toContain("pipeline invariant check failed");
  });
});
