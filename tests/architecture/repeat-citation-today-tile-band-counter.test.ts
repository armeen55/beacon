/**
 * Architecture invariant — Section 5.B Slice 2 (2026-05-21): Today
 * edit-lifecycle tile repeat-citation band counter contract.
 *
 * Pins three things on `src/components/today/edit-lifecycle-tile.tsx`:
 *   1. Locked customer-label map verbatim — stable→"consistent",
 *      intermittent→"recurring", one_off→"early signal",
 *      not_repeated→"not repeated", still_learning→"still learning".
 *      Lower-case sentence-case forms (vs the 5.B.1 Changes detail
 *      title-case badge forms) chosen for inline counter rendering.
 *   2. Forbidden customer-copy vocab — no raw band names as visible
 *      JSX text (`>name<`), no percentages, no Section-6 vocab
 *      (`Mode A/B/C`, `primary recommendation`), no causal/revenue
 *      /leads language. Data-attribute carriers are allowed.
 *   3. Implementation contract — type-only import of
 *      `RepeatCitationBand`; no value imports of compute logic; no
 *      LLM / fetch / Supabase / persistence / half-life math.
 *
 * Defense-in-depth alongside `repeat-citation-customer-copy-vocab`
 * (5.B.1 Changes detail) and `repeat-citation-no-customer-surface`
 * (allowlist gate).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TILE_FILE = resolve(
  REPO_ROOT,
  "src",
  "components",
  "today",
  "edit-lifecycle-tile.tsx",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("repeat-citation-today-tile / file presence", () => {
  it("tile file exists at the expected path", () => {
    expect(
      existsSync(TILE_FILE),
      `Expected tile at ${TILE_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });
});

describe("repeat-citation-today-tile / locked customer-label contract", () => {
  const active = stripComments(read(TILE_FILE));

  it("source declares REPEAT_CITATION_BAND_LABELS constant", () => {
    expect(active).toMatch(
      /const\s+REPEAT_CITATION_BAND_LABELS\s*:\s*Record<RepeatCitationBand,\s*string>/,
    );
  });

  // Locked 5.B.2 label table — drift trips the per-pair test below.
  const LOCKED_LABEL_PAIRS = [
    ["stable", "consistent"],
    ["intermittent", "recurring"],
    ["one_off", "early signal"],
    ["not_repeated", "not repeated"],
    ["still_learning", "still learning"],
  ] as const;

  it.each(LOCKED_LABEL_PAIRS)(
    "locked label: %s → %s",
    (bandKey, customerLabel) => {
      expect(active).toMatch(
        new RegExp(`${bandKey}\\s*:\\s*"${customerLabel}"`),
      );
    },
  );

  it("source declares REPEAT_CITATION_BAND_ORDER constant (drives render order)", () => {
    expect(active).toMatch(
      /const\s+REPEAT_CITATION_BAND_ORDER\s*:\s*ReadonlyArray<RepeatCitationBand>/,
    );
  });
});

describe("repeat-citation-today-tile / module-purity + import contract", () => {
  const active = stripComments(read(TILE_FILE));

  it("imports the RepeatCitationBand TYPE from compute-repeat-citation", () => {
    // Must be a type-only import — pins that the tile does NOT
    // pull value-side compute logic into the customer bundle.
    expect(active).toMatch(
      /import\s+type\s+\{\s*RepeatCitationBand\s*\}\s+from\s+"@\/domains\/citation-lifecycle\/compute-repeat-citation"/,
    );
  });

  it("does NOT call fetch(", () => {
    expect(active).not.toMatch(/\bfetch\s*\(/);
  });

  it("does NOT import Supabase / persistence", () => {
    expect(active).not.toContain("@/lib/persistence/supabase");
    expect(active).not.toContain("@supabase/supabase-js");
    expect(active).not.toContain("@/lib/persistence/repositories");
  });

  it("does NOT import the OpenAI / LLM provider", () => {
    expect(active).not.toContain(
      "@/domains/recommendations/providers/openai",
    );
    expect(active).not.toContain("openaiProvider");
  });

  it("does NOT import the load-repeat-citation loader directly (tile reads pre-aggregated data via props)", () => {
    expect(active).not.toContain(
      "@/domains/citation-lifecycle/load-repeat-citation",
    );
    expect(active).not.toContain("loadRepeatCitationForEdit");
  });

  it("does NOT call the compute function directly (tile reads pre-aggregated band counts only)", () => {
    expect(active).not.toContain("computeRepeatCitation");
  });

  it("does NOT contain a Supabase `recommended_edits` write shape", () => {
    const writeShape = new RegExp(
      "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
        "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
      "u",
    );
    expect(writeShape.test(active)).toBe(false);
  });

  it("does NOT contain half-life math (G4 lock — no half-life in v1)", () => {
    expect(active.toLowerCase()).not.toContain("half-life");
    expect(active.toLowerCase()).not.toContain("halflife");
    expect(active).not.toMatch(/\bdecay\s*\(/);
  });
});

describe("repeat-citation-today-tile / customer-copy forbidden vocab", () => {
  const active = stripComments(read(TILE_FILE));

  // Raw internal band names as visible JSX text content (matched as
  // `>name<`). The data-attribute carriers are allowed (operator
  // tooling); the visible `<span>name</span>` form is not.
  const RAW_BANDS = [
    "stable",
    "intermittent",
    "one_off",
    "not_repeated",
    "still_learning",
  ] as const;
  it.each(RAW_BANDS)(
    "does NOT render raw '%s' as visible JSX text",
    (rawBand) => {
      expect(active).not.toMatch(new RegExp(`>${rawBand}<`));
    },
  );

  it("does NOT contain percentage rendering (%, percent, '%')", () => {
    // Customer-visible percentage strings — exclude any JSX-text
    // forms like `>50%<` or `>50 percent<`. The `%` operator
    // (modulo) and CSS `%` units are not present in JSX-text
    // contexts in this tile, so a flat substring scan is safe.
    expect(active).not.toMatch(/>[^<]*\d+\s*%/);
    expect(active).not.toMatch(/>[^<]*\bpercent\b/i);
  });

  it("does NOT contain Section 6 mode labels (Mode A / Mode B / Mode C)", () => {
    expect(active).not.toMatch(/\bMode\s+[ABC]\b/);
  });

  it("does NOT mention 'primary recommendation' as customer-visible copy", () => {
    expect(active.toLowerCase()).not.toContain("primary recommendation");
  });

  it("does NOT mention 'aiSearchSignal' / 'actualSearchQueries' internal taxonomy", () => {
    for (const tok of ["aiSearchSignal", "actualSearchQueries"]) {
      expect(active).not.toContain(tok);
    }
  });

  it("does NOT contain causal / revenue / leads language", () => {
    // Scan visible JSX-text positions only to avoid false-matches
    // on prop names / attribute keys.
    for (const tok of ["drove", "caused", "generated", "revenue", "leads"]) {
      expect(active).not.toMatch(new RegExp(`>[^<]*\\b${tok}\\b`, "i"));
    }
    expect(active).not.toContain("$");
  });
});

describe("repeat-citation-today-tile / render surface contract", () => {
  const active = stripComments(read(TILE_FILE));

  it("uses the locked 'Citation stability' heading text", () => {
    expect(active).toContain("Citation stability");
  });

  it("uses the locked 'past 30 days' subtitle text", () => {
    expect(active).toContain("past 30 days");
  });

  it("renders the citation-stability section with stable data-attr selectors", () => {
    expect(active).toContain('data-today-tile-section="citation-stability"');
    expect(active).toContain(
      "data-today-tile-citation-stability-line",
    );
  });

  it("operator data-attr exposes the internal band keys (intended; data-attrs not customer-visible)", () => {
    // Operator tooling can grep these; they are NOT customer text
    // (the customer-text invariants above pin the visible side).
    expect(active).toContain("data-today-tile-citation-stability-band");
  });

  it("does NOT introduce a new top-level route or page entry (tile is composed into existing today-v2-sections)", () => {
    // The tile is a component (.tsx) — it must not contain a
    // route directive or a `notFound()` gate (which would imply a
    // page entry). Quick heuristic source-text scan.
    expect(active).not.toContain('export const dynamic');
    expect(active).not.toContain("notFound(");
  });
});
