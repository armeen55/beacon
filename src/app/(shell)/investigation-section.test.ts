/**
 * InvestigationSection contract pins (2026-07-02, master plan item 53).
 *
 * Source-level pins (the OpsPipelineSection sibling pattern): the card must
 * read the PERSISTED diagnosis store (never run an investigation on render),
 * cap the cards and causes shown, self-hide when nothing fired, fail soft to
 * null, carry dark-mode + small-screen classes, never contain an em or en
 * dash, be mounted on Today beside the Ops card, and have the cron wire the
 * runner as an isolated phase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "investigation-section.tsx"), "utf8");

describe("InvestigationSection contract", () => {
  it("reads the persisted investigation store (no investigation on render)", () => {
    expect(SRC).toContain('from "@/domains/investigation/investigation-store"');
    expect(SRC).toContain("loadLatestInvestigations(tenantId");
    expect(SRC).not.toContain("runInvestigationForTenant");
    expect(SRC).not.toContain("collectIndexabilityEvidence");
    expect(SRC).not.toContain("detectFamilyCollapses");
  });

  it("self-hides when no fresh investigation exists", () => {
    expect(SRC).toContain("if (rows.length === 0) return null");
  });

  it("caps the cards and the causes shown", () => {
    expect(SRC).toContain("MAX_CARDS = 2");
    expect(SRC).toContain("MAX_CAUSES_SHOWN = 2");
    expect(SRC).toContain("causes.slice(0, MAX_CAUSES_SHOWN)");
  });

  it("shows the one action the diagnosis implies", () => {
    expect(SRC).toContain("actionSentence");
    expect(SRC).toContain("Next step:");
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

  it("speaks first person", () => {
    expect(SRC).toContain("I investigated a clicks drop overnight");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(SRC).not.toMatch(/[–—]/);
  });

  it("is mounted on the Today page beside the Ops card", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(page).toContain('import { InvestigationSection } from "./investigation-section"');
    expect(page).toContain("<InvestigationSection tenantId={tenantId} />");
  });

  it("the cron wires the investigation runner as an isolated phase", () => {
    const cron = readFileSync(resolve(__dirname, "../../lib/connectors/cron-sync.ts"), "utf8");
    expect(cron).toContain("runInvestigationForTenant(t.id)");
    expect(cron).toContain("forensic investigation failed");
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
