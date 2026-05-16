/**
 * Architecture invariant — Section 5.B Slice 1 / no Section-6 bridge
 * in the customer-facing repeat-citation render path (2026-05-16).
 *
 * The new sub-line lives inside Changes detail Act 3 right after
 * Section 6's primary-recommendation evidence block. The two
 * metrics describe different things; combining them risks
 * cross-scope claims that violate Section 6 H8 (Mode A/B/C silence).
 *
 * Pins on `src/components/changes/repeat-citation-act3.tsx`:
 *   1. NO imports from Section 6 modules
 *      (`change-primary-mode-a`, `change-primary-mode-b`,
 *      `change-primary-evidence-copy`, `load-change-primary-evidence`).
 *   2. NO visible Section 6 vocabulary
 *      ("primary recommendation", "primary_recommendation",
 *      "Mode A", "Mode B", "Mode C") in active source.
 *   3. NO bridge phrases ("because", "which means", "as a result",
 *      "therefore") in visible text — the two render blocks must
 *      sit independently in Act 3 with no causal link between them.
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

function extractVisibleText(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let buf = "";
      while (j < src.length) {
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        buf += src[j];
        j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      let buf = "";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          continue;
        }
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        buf += src[j];
        j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("\n");
}

const ACTIVE = stripComments(read(TARGET));
const VISIBLE = extractVisibleText(ACTIVE);

const FORBIDDEN_IMPORTS = [
  "change-primary-mode-a",
  "change-primary-mode-b",
  "change-primary-evidence-copy",
  "load-change-primary-evidence",
] as const;

const FORBIDDEN_VISIBLE = [
  "primary recommendation",
  "primary_recommendation",
  "Mode A",
  "Mode B",
  "Mode C",
] as const;

const FORBIDDEN_BRIDGES = [
  "because",
  "which means",
  "as a result",
  "therefore",
] as const;

describe("Architecture — repeat-citation customer surface has no Section 6 bridge", () => {
  for (const seg of FORBIDDEN_IMPORTS) {
    it(`does NOT import from '${seg}'`, () => {
      const re = new RegExp(
        `from\\s+["'][^"']*${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"']*["']`,
      );
      expect(ACTIVE).not.toMatch(re);
    });
  }

  for (const phrase of FORBIDDEN_VISIBLE) {
    it(`visible text does NOT contain '${phrase}'`, () => {
      expect(VISIBLE).not.toContain(phrase);
    });
  }

  for (const bridge of FORBIDDEN_BRIDGES) {
    it(`visible text does NOT contain bridge phrase '${bridge}'`, () => {
      // Use word-bounded regex so we don't false-positive on
      // substrings (e.g., "because" inside another word — none
      // expected, but defensive).
      const re = new RegExp(
        `\\b${bridge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      );
      if (re.test(VISIBLE)) {
        const m = re.exec(VISIBLE)!;
        const start = Math.max(0, m.index - 40);
        const end = Math.min(VISIBLE.length, m.index + bridge.length + 40);
        throw new Error(
          `${TARGET}: bridge phrase '${bridge}' present in visible text (offset ${m.index}).\n` +
            `The repeat-citation sub-line must render independently from Section 6 evidence — no causal link.\n` +
            `Excerpt: ...${VISIBLE.slice(start, end)}...`,
        );
      }
      expect(re.test(VISIBLE)).toBe(false);
    });
  }
});
