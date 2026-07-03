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
  it("calls the same three server actions the granular buttons already call", () => {
    const idx = ACTIONS_SRC.indexOf("export async function prepareTonightsPlanAction");
    const block = ACTIONS_SRC.slice(idx, idx + 1600);
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

describe("/changes page - wires the one-command button + overflow, not the old cluster", () => {
  it("imports PrepareTonightButton and PrepareOverflowMenu, not the three individual buttons directly", () => {
    expect(PAGE_SRC).toContain('import { PrepareTonightButton, PrepareOverflowMenu } from "../today-moves-prepare";');
  });

  it("renders both in the changes section header", () => {
    expect(PAGE_SRC).toContain("<PrepareOverflowMenu readyCount={view.summary.ready} total={view.changes.length} />");
    expect(PAGE_SRC).toContain("<PrepareTonightButton readyCount={view.summary.ready} total={view.changes.length} />");
  });
});
