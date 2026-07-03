/**
 * design-system-guard (FP6a) - keeps the single token-based design system
 * from re-fragmenting.
 *
 * The 2026-07 design audit found TWO complete color systems running at once:
 * the token system in globals.css (bg-card, text-muted-foreground,
 * status-*) used by the shell, and thousands of raw tailwind palette
 * classes (bg-red-50, text-emerald-600, border-gray-200) on flagship
 * surfaces. It also found 294 distinct card-container class combos and 24
 * font sizes.
 *
 * This test enforces two things:
 *   (a) the ui primitives (card, pill, section-header, empty-state,
 *       page-shell, button) use token classes and the five-size type scale
 *       ONLY, and contain no em/en dashes; and
 *   (b) the total number of raw palette classes under src/app/(shell) can
 *       only go DOWN. When a migration wave lowers the count, lower the
 *       baseline constant to match so it ratchets.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const UI_DIR = join(ROOT, "src/components/ui");
const SHELL_DIR = join(ROOT, "src/app/(shell)");

/**
 * Raw tailwind palette classes: a utility prefix + a named palette color +
 * a numeric shade. Token classes (bg-card, text-status-danger,
 * border-border-subtle) never match because tokens carry no numeric shade.
 */
const RAW_PALETTE =
  /(?:bg|text|border|ring|fill|stroke|divide|outline|decoration|from|via|to|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}/g;

/** Same charset as no-banned-dash-display-surfaces: figure, en, em, horizontal bar. */
const BANNED_DASH = /[‒–—―]/;

/** Arbitrary font sizes (text-[11px], text-[0.8rem]) are off-scale by definition. */
const ARBITRARY_TEXT_SIZE = /text-\[[0-9.]+(?:px|rem|em)\]/;

/**
 * Tailwind's stock size ladder is banned inside primitives; the five-size
 * scale (text-meta / text-body / text-sub / text-section / text-page,
 * defined in globals.css) is the only one allowed.
 */
const STOCK_TEXT_SIZE = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/;

/**
 * FP6a primitives plus the pre-existing Button they build on. sheet.tsx /
 * table.tsx / scroll-area.tsx are vendored shadcn-style helpers and are
 * intentionally not pinned to the five-size scale yet.
 */
const PRIMITIVES = [
  "card.tsx",
  "pill.tsx",
  "section-header.tsx",
  "empty-state.tsx",
  "page-shell.tsx",
  "button.tsx",
];

/** Only the new FP6a primitives are pinned to the five-size type scale. */
const TYPE_SCALE_PINNED = new Set([
  "card.tsx",
  "pill.tsx",
  "section-header.tsx",
  "empty-state.tsx",
  "page-shell.tsx",
]);

/**
 * BASELINE (2026-07-02, FP6a): 2860 raw palette class occurrences across the
 * 254 non-test .ts/.tsx files under src/app/(shell), counted with RAW_PALETTE
 * above. This number may ONLY go down as pages migrate to the primitives.
 * When your migration lowers the live count, lower this constant to the new
 * count in the same commit so the ratchet holds.
 */
// 2026-07-02: 2860 was counted mid-wave while FP1/FP2 were concurrently adding UI
// (top-3 picks card, Ready-0 explanation, honest-delay states); wave 1 closed at 2884.
// FP6b (2026-07-02) migrated the three worst files onto tokens + Card/Pill/SectionHeader
// (today-moves-card 597->69, changes-list-client 340->34, daily-experiments-section
// 280->0; the remaining counts in today-moves-card/changes-list-client are the deliberate
// per-category identity colors called out in their source comments). Measured live total
// under src/app/(shell) after the migration: 1773. war-room-sections.tsx and
// today-newpages-card.tsx remain for a later wave.
// FP6b-2 (2026-07-02) migrated today-newpages-card.tsx (131->22; the remaining 22 are the
// deliberate violet/indigo "AI generated this" identity colors, same precedent as
// today-moves-card) and the New Pages board shell in today-newpages-section.tsx (13->0,
// the light-only gradient card was replaced with Card/SectionHeader tokens so dark mode
// renders correctly). Measured live total under src/app/(shell) after this migration: 1651.
// war-room-sections.tsx (187) is now the largest holdout and the last big wave-2 target.
// FP6b-3 (2026-07-02) migrated war-room-sections.tsx (187->19; the remaining 19 are the
// deliberate per-teammate identity colors on the Demand band rows - amber (this-week search
// spike), sky (seasonal window), rose (fading page), emerald (heating-up trend), and violet
// (new-page-to-build link + language gap), each commented at its use site, same precedent as
// today-moves-card's TONE map). Every container is now the shared CARD token string (mirrors
// Card's own default-variant classes on the <section> elements this file needs for aria-label/
// id anchors), every severity/verdict chip rides a Pill intent, and every dark: variant was
// dropped to match the fully-migrated siblings (today-moves-card.tsx and today-newpages-card.tsx
// carry zero dark: classes). Measured live total under src/app/(shell) after this migration: 1481.
// FP8 (2026-07-02) collapsed the /results ledger cards onto Card/Pill for the summary line
// (deleting the TONE_STYLE/OUTCOME_STYLE palette maps; the maturity-tone rule now rides Pill
// intents) and shipped the token-only cumulative outcome strip shared by Today and Results.
// Measured live total under src/app/(shell) after FP8: 1342.
// P14 (Today dashboard pack, 2026-07-03) replaced the old single-signal LeadStoryCard in
// page.tsx with the composite lead headline whose presentation lives token-only in
// src/components/today/** (outside this ratchet). Deleting LeadStoryCard's raw-palette tone maps
// dropped the (shell) total by 44 to 1298.
// This number may ONLY go down from here.
const RAW_PALETTE_BASELINE = 1298;

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walkSourceFiles(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("design-system-guard: primitives are token-only", () => {
  for (const file of PRIMITIVES) {
    const path = join(UI_DIR, file);
    const src = readFileSync(path, "utf8");

    it(`${file} contains no raw tailwind palette classes`, () => {
      const hits = src.match(RAW_PALETTE) ?? [];
      expect(hits, `raw palette classes in ${file}: ${hits.join(", ")}`).toEqual([]);
    });

    it(`${file} contains no em/en dashes`, () => {
      expect(BANNED_DASH.test(src)).toBe(false);
    });

    if (TYPE_SCALE_PINNED.has(file)) {
      it(`${file} uses only the five-size type scale (no arbitrary or stock text sizes)`, () => {
        expect(
          ARBITRARY_TEXT_SIZE.test(src),
          `arbitrary text size in ${file}`
        ).toBe(false);
        expect(
          STOCK_TEXT_SIZE.test(src),
          `stock tailwind text size in ${file}; use text-meta/text-body/text-sub/text-section/text-page`
        ).toBe(false);
      });
    }
  }

  it("globals.css defines all five type-scale tokens", () => {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    for (const token of [
      "--text-meta:",
      "--text-body:",
      "--text-sub:",
      "--text-section:",
      "--text-page:",
    ]) {
      expect(css, `missing ${token} in globals.css`).toContain(token);
    }
  });
});

describe("design-system-guard: raw palette ratchet under src/app/(shell)", () => {
  it(`raw palette class count is <= ${RAW_PALETTE_BASELINE} and only ever goes down`, () => {
    const files = walkSourceFiles(SHELL_DIR);
    let total = 0;
    const perFile: Array<{ file: string; count: number }> = [];
    for (const f of files) {
      const count = (readFileSync(f, "utf8").match(RAW_PALETTE) ?? []).length;
      if (count > 0) perFile.push({ file: f, count });
      total += count;
    }
    const worst = perFile
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((e) => `${e.file.slice(ROOT.length + 1)} (${e.count})`)
      .join(", ");
    expect(
      total,
      `raw palette classes under src/app/(shell) grew past the baseline. ` +
        `Use the tokens + primitives in src/components/ui instead. Worst files: ${worst}`
    ).toBeLessThanOrEqual(RAW_PALETTE_BASELINE);
  });
});
