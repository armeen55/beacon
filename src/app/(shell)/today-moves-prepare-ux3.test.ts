/**
 * today-moves-prepare / today-moves-actions - UX3 "Prepare tonight's plan" one-command button.
 *
 * Source-pinning (this repo's convention for interactive client components with no jsdom/
 * @testing-library/react configured). Confirms the combined action actually composes the three
 * existing pipelines (never a reimplementation) and that the granular buttons still exist,
 * just moved into an overflow menu.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACTIONS_SRC = readFileSync(resolve(__dirname, "today-moves-actions.ts"), "utf8");
const BUTTON_SRC = readFileSync(resolve(__dirname, "today-moves-prepare.tsx"), "utf8");
const PAGE_SRC = readFileSync(resolve(__dirname, "changes/page.tsx"), "utf8");

describe("prepareTonightsPlanAction - composes the existing pipelines, does not reimplement them", () => {
  it("runs competitor teardown before keyword/SERP enrichment and drafting", () => {
    const idx = ACTIONS_SRC.indexOf("export async function prepareTonightsPlanAction");
    const block = ACTIONS_SRC.slice(idx, idx + 2400);
    const teardown = block.indexOf("await sharpenMovesWithTeardownAction({ limit: 12 })");
    const enrich = block.indexOf("await enrichTopResearchPacksAction({ topN: 5 })");
    const prepare = block.indexOf("await prepareTopMovesAction({ maxN: 10 })");
    const improve = block.indexOf("await regenerateTopDraftsFromTeardownAction({ limit: 3, maxUsd: 0.1 })");
    expect(teardown).toBeGreaterThan(-1);
    expect(teardown).toBeLessThan(enrich);
    expect(enrich).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(improve);
    expect(block).toContain("await enrichTopResearchPacksAction({ topN: 5 })");
    expect(block).toContain("await prepareTopMovesAction({ maxN: 10 })");
    expect(block).toContain("await regenerateTopDraftsFromTeardownAction({ limit: 3, maxUsd: 0.1 })");
  });

  it("is operator-gated the same way every other prepare action is", () => {
    const idx = ACTIONS_SRC.indexOf("export async function prepareTonightsPlanAction");
    const block = ACTIONS_SRC.slice(idx, idx + 300);
    expect(block).toContain("if (!(await isOperatorModeServer())) return { ok: false");
  });

  it("a research-enrichment failure never blocks the rest of the pipeline (fail-soft per step)", () => {
    const idx = ACTIONS_SRC.indexOf("export async function prepareTonightsPlanAction");
    const block = ACTIONS_SRC.slice(idx, idx + 1600);
    expect(block).toMatch(/try \{\s*const enrich = await enrichTopResearchPacksAction/);
  });

  it("a competitor teardown failure never blocks cached research and drafting", () => {
    const idx = ACTIONS_SRC.indexOf("export async function prepareTonightsPlanAction");
    const block = ACTIONS_SRC.slice(idx, idx + 1200);
    expect(block).toMatch(/try \{[\s\S]*?await sharpenMovesWithTeardownAction/);
    expect(block).toContain("competitorPagesAnalyzed = teardown.audited");
    expect(block).toContain("competitorPagesRefreshed = Math.max(0, teardown.audited - teardown.cached)");
  });

  it("a real prepare failure is the only thing that short-circuits the combined result", () => {
    const idx = ACTIONS_SRC.indexOf("export async function prepareTonightsPlanAction");
    const block = ACTIONS_SRC.slice(idx, idx + 1600);
    expect(block).toContain("if (!prepare.ok) return { ok: false, reason: prepare.reason };");
  });
});

describe("PrepareTonightButton - the ONE command replacing the button cluster", () => {
  it("keeps the '(takes a minute)' honesty line", () => {
    expect(BUTTON_SRC).toContain("Prepare tonight&apos;s plan (takes a minute)");
  });

  it("calls the combined action, not a single pipeline step", () => {
    const idx = BUTTON_SRC.indexOf("export function PrepareTonightButton");
    const block = BUTTON_SRC.slice(idx, idx + 1200);
    expect(block).toContain("await prepareTonightsPlanAction()");
  });

  it("reports how many winner pages were analyzed without calling cached work fresh", () => {
    const idx = BUTTON_SRC.indexOf("export function PrepareTonightButton");
    const block = BUTTON_SRC.slice(idx, idx + 1800);
    expect(block).toContain("winner page");
    expect(block).toContain("analyzed");
    expect(block).toContain("refreshed");
  });

  it("never renders an em or en dash", () => {
    const idx = BUTTON_SRC.indexOf("export function PrepareTonightButton");
    const end = BUTTON_SRC.indexOf("export function PrepareOverflowMenu");
    const block = BUTTON_SRC.slice(idx, end);
    expect(block).not.toMatch(/[–—]/);
  });
});

describe("PrepareOverflowMenu - the granular buttons stay available, just demoted", () => {
  it("holds all three original single-step buttons", () => {
    const idx = BUTTON_SRC.indexOf("export function PrepareOverflowMenu");
    const end = BUTTON_SRC.indexOf("export function PrepareTopMovesButton");
    const block = BUTTON_SRC.slice(idx, end);
    expect(block).toContain("<PrepareTopMovesButton");
    expect(block).toContain("<EnrichResearchButton");
    expect(block).toContain("<RegenerateFromTeardownButton");
  });

  it("uses a native disclosure element, no new UI dependency", () => {
    const idx = BUTTON_SRC.indexOf("export function PrepareOverflowMenu");
    const block = BUTTON_SRC.slice(idx, idx + 400);
    expect(block).toContain("<details");
  });

  it("never renders an em or en dash", () => {
    const idx = BUTTON_SRC.indexOf("export function PrepareOverflowMenu");
    const end = BUTTON_SRC.indexOf("</details>", idx);
    const block = BUTTON_SRC.slice(idx, end);
    expect(block).not.toMatch(/[–—]/);
  });
});

describe("/changes page - preparation is autonomous", () => {
  it("does not import manual prepare controls", () => {
    expect(PAGE_SRC).not.toContain("PrepareTonightButton");
    expect(PAGE_SRC).not.toContain("PrepareOverflowMenu");
  });

  it("promises the maintained copy-ready queue instead of asking for a click", () => {
    expect(PAGE_SRC).toContain("Beacon keeps the strongest five copy-ready while you work.");
    expect(PAGE_SRC).not.toContain("Prepare tonight");
  });
});
