/**
 * InvestigationAlertLine contract pins (2026-07-21, Phase 4D fold of master-plan
 * item 53).
 *
 * The standalone InvestigationSection drawer card is gone; its ONE headline
 * conclusion is folded into a single compact alert line beside the circuit
 * breaker. The PRODUCER (runInvestigationForTenant, wired into the on-use
 * enrichment cycle) is unchanged - these pins guard both the new display and the
 * surviving producer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "investigation-alert.tsx"), "utf8");

describe("InvestigationAlertLine contract", () => {
  it("reads the persisted investigation store (no investigation on render)", () => {
    expect(SRC).toContain('from "@/domains/investigation/investigation-store"');
    expect(SRC).toContain("loadLatestInvestigations(tenantId");
    // never RUNS an investigation on render (a comment may name the producer)
    expect(SRC).not.toContain("runInvestigationForTenant(");
    expect(SRC).not.toContain("collectIndexabilityEvidence");
    expect(SRC).not.toContain("detectFamilyCollapses");
  });

  it("self-hides when no fresh investigation exists", () => {
    expect(SRC).toContain("if (!row) return null");
  });

  it("folds the top cause and its one implied action into the conclusion", () => {
    expect(SRC).toContain("d.causes[0]");
    expect(SRC).toContain("topCause.sentence");
    expect(SRC).toContain("topCause.actionSentence");
  });

  it("states an honest no-cause conclusion instead of inventing one", () => {
    expect(SRC).toContain("found no clear cause");
  });

  it("gives one next step (a link to Changes)", () => {
    expect(SRC).toContain('href="/changes"');
    expect(SRC).toContain("Review in Changes");
  });

  it("fails soft to null (never a crashed Today)", () => {
    expect(SRC).toMatch(/catch\s*\{\s*return null;\s*\}/);
  });

  it("speaks first person, one compact line", () => {
    expect(SRC).toContain("I looked into the clicks drop on");
  });

  it("carries 375px safety classes", () => {
    expect(SRC).toContain("break-words");
    expect(SRC).toContain("tabular-nums");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(SRC).not.toMatch(/[–—]/);
  });

  it("is mounted on the Today page in the alert lane", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(page).toContain('import { InvestigationAlertLine } from "./investigation-alert"');
    expect(page).toContain("<InvestigationAlertLine tenantId={tenantId} />");
  });

  it("the standalone drawer section is fully removed", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(page).not.toContain("InvestigationSection");
  });
});

describe("investigation producer survives the fold", () => {
  it("the on-use enrichment cycle still wires the investigation runner as an isolated step", () => {
    // Beacon has no scheduler: the nightly cron was deleted and its $0 producers
    // were re-homed onto the on-use cycle (runOwnedCycle -> runOnVisitEnrichment).
    const enrichment = readFileSync(resolve(__dirname, "../../domains/ops/on-visit-enrichment.ts"), "utf8");
    expect(enrichment).toContain("runInvestigationForTenant(tenantId, now)");
    expect(enrichment).toContain('"forensic-investigation"');
    const cycle = readFileSync(resolve(__dirname, "../../domains/ops/on-visit-refresh.ts"), "utf8");
    expect(cycle).toContain("runOnVisitEnrichment(tenantId");
  });

  it("the store is registered as global + Supabase-mirrored", () => {
    const classification = readFileSync(resolve(__dirname, "../../lib/persistence/store-classification.ts"), "utf8");
    const jsonStore = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    expect(classification).toContain('"forensic-investigations"');
    expect(jsonStore).toContain('"forensic-investigations"');
  });
});

describe("investigation domain - no-dash hard rule", () => {
  it.each([
    "rank-causes.ts",
    "collect-evidence.ts",
    "family-collapse.ts",
    "load-family-rows.ts",
    "run-investigation.ts",
    "investigation-store.ts",
  ])("src/domains/investigation/%s contains no em or en dashes", (file) => {
    const content = readFileSync(resolve(__dirname, "../../domains/investigation", file), "utf8");
    expect(content).not.toMatch(/[–—]/);
  });
});
