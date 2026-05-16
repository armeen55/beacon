/**
 * Architecture invariant — Section 5.B Slice 1 / band→customer-label
 * mapping on the Changes detail repeat-citation sub-line (2026-05-16).
 *
 * Pins the exact mapping table at the source so a future drive-by
 * can't relabel a band without tripping the invariant:
 *
 *   stable          → "Consistent"
 *   intermittent    → "Recurring"
 *   one_off         → "Early signal"
 *   not_repeated    → "Not repeated in this window"
 *   still_learning  → "Still learning"
 *
 * Also pins required copy fragments:
 *   "Citation stability:"  (label prefix)
 *   "successful AI readings"  (denominator phrasing)
 *   "First cited"  (date prefix)
 *
 * Also negative-pins: visible "One-off" and "Intermittent" MUST NOT
 * appear in the source (internal band names must map through the
 * customer table; vocab invariant has the same rule scoped to
 * visible text — this invariant is broader, scanning the full
 * active source).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TARGET = "src/components/changes/repeat-citation-act3.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(read(TARGET));

describe("Architecture — repeat-citation Changes detail band mapping", () => {
  it("contains exact customer label 'Consistent' (maps stable)", () => {
    expect(ACTIVE).toContain('"Consistent"');
  });

  it("contains exact customer label 'Recurring' (maps intermittent)", () => {
    expect(ACTIVE).toContain('"Recurring"');
  });

  it("contains exact customer label 'Early signal' (maps one_off)", () => {
    expect(ACTIVE).toContain('"Early signal"');
  });

  it("contains exact customer label 'Not repeated in this window' (maps not_repeated)", () => {
    expect(ACTIVE).toContain('"Not repeated in this window"');
  });

  it("contains exact customer label 'Still learning' (maps still_learning)", () => {
    expect(ACTIVE).toContain('"Still learning"');
  });

  it("contains required copy fragment 'Citation stability:'", () => {
    expect(ACTIVE).toContain("Citation stability:");
  });

  it("contains required copy fragment 'successful AI readings'", () => {
    expect(ACTIVE).toContain("successful AI readings");
  });

  it("contains required copy fragment 'First cited'", () => {
    expect(ACTIVE).toContain("First cited");
  });

  it("active source does NOT contain visible 'One-off'", () => {
    expect(ACTIVE).not.toContain("One-off");
  });

  it("active source does NOT contain visible 'Intermittent'", () => {
    expect(ACTIVE).not.toContain("Intermittent");
  });
});
