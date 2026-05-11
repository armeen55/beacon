/**
 * /changes v2 — title-projection truth table.
 *
 * Polish bundle (2026-05-11) — pins the projection rules that
 * scrub raw `change_description` strings into customer-safe
 * short titles + cleaned full descriptions:
 *
 *   • Prompt IDs (`prompt 319557d1`) → "a tracked AI prompt".
 *   • "packet's cited source pages" / "packet's cited pages" /
 *     "the packet shows" / "the packet's" → plain English.
 *   • "(examples: a.com, b.com)" / "(e.g., x.com)" → dropped.
 *   • Em-dash splits the headline from the full description.
 *   • Whitespace + stray punctuation normalized.
 *   • Output never echoes the raw enum names back.
 */
import { describe, expect, it } from "vitest";

import {
  projectChangeTitle,
  clampShortTitle,
  DEFAULT_SHORT_TITLE_MAX,
} from "@/domains/changes/proof-timeline/title-projection";

describe("projectChangeTitle", () => {
  it("returns 'Untitled change' for null/empty input", () => {
    for (const input of [null, undefined, "", "   "] as const) {
      const out = projectChangeTitle(input);
      expect(out.shortTitle).toBe("Untitled change");
      expect(out.fullDescription).toBeNull();
    }
  });

  it("splits on em-dash into headline + full description", () => {
    const raw =
      "H2: Architect-led design-build advantage — Adds a clear benefit statement.";
    const out = projectChangeTitle(raw);
    expect(out.shortTitle).toBe("H2: Architect-led design-build advantage");
    expect(out.fullDescription).toBe("Adds a clear benefit statement.");
  });

  it("falls back to double-hyphen separator for legacy imports", () => {
    const raw = "FAQ question: Who should I hire? -- explanation goes here";
    const out = projectChangeTitle(raw);
    expect(out.shortTitle).toBe("FAQ question: Who should I hire?");
    expect(out.fullDescription).toBe("explanation goes here");
  });

  it("returns null fullDescription when there's no separator (no duplicate render)", () => {
    const out = projectChangeTitle("Updated FAQ schema on /faq");
    expect(out.shortTitle).toBe("Updated FAQ schema on /faq");
    expect(out.fullDescription).toBeNull();
  });

  it("returns null fullDescription when head === tail (no duplicate render)", () => {
    const raw = "Same text — Same text";
    const out = projectChangeTitle(raw);
    expect(out.shortTitle).toBe("Same text");
    expect(out.fullDescription).toBeNull();
  });

  it("strips prompt IDs from the headline", () => {
    const raw =
      "H2: Architect-led design-build advantage — Adds a clear benefit statement drawn from prompt 319557d1.";
    const out = projectChangeTitle(raw);
    expect(out.shortTitle).not.toMatch(/prompt\s+[0-9a-f]{6,}/);
    expect(out.fullDescription).not.toMatch(/prompt\s+[0-9a-f]{6,}/);
    expect(out.fullDescription).toContain("a tracked AI prompt");
  });

  it("replaces 'the packet's cited source pages' with plain English", () => {
    const raw =
      "FAQ answer: Architect-led firm benefits — Provides a concise answer tied to prompt 7ee3216b and the packet's cited pages.";
    const out = projectChangeTitle(raw);
    const text = `${out.shortTitle} ${out.fullDescription ?? ""}`.toLowerCase();
    expect(text).not.toContain("packet");
    expect(text).toContain("examples beacon tracked");
  });

  it("replaces 'the packet shows' with plain English", () => {
    const raw =
      "FAQ question: Who to hire? — the packet shows competitors dominate these queries.";
    const out = projectChangeTitle(raw);
    expect(out.fullDescription).not.toMatch(/\bpacket\b/i);
    expect(out.fullDescription?.toLowerCase()).toContain(
      "beacon's prompt data shows",
    );
  });

  it("drops long inline 'examples:' parentheticals", () => {
    const raw =
      "FAQ answer: Architect-led firm benefits — Provides a concise answer tied to prompt 7ee3216b and the packet's cited pages (examples: hdrremodeling.com, baysidebuildersgroup.com) which emphasize integrated teams.";
    const out = projectChangeTitle(raw);
    expect(out.fullDescription ?? "").not.toContain("hdrremodeling.com");
    expect(out.fullDescription ?? "").not.toContain("baysidebuildersgroup.com");
  });

  it("drops 'e.g.,' parentheticals too", () => {
    const raw =
      "FAQ answer: x — Provides answer (e.g., site.com, other.com) about hiring.";
    const out = projectChangeTitle(raw);
    expect(out.fullDescription ?? "").not.toContain("site.com");
    expect(out.fullDescription ?? "").not.toContain("other.com");
  });

  it("normalizes whitespace after substitutions", () => {
    const raw =
      "FAQ answer — concise   answer   tied to  prompt 7ee3216b   .  ";
    const out = projectChangeTitle(raw);
    expect(out.fullDescription).not.toContain("  ");
    expect(out.fullDescription).not.toMatch(/\s+\./);
  });

  it("never leaks the regex source of a prompt ID into output", () => {
    const ids = [
      "prompt 319557d1",
      "PROMPT abcdef12",
      "prompt 7ee3216b",
      "prompt deadbeefcafe",
    ];
    for (const id of ids) {
      const out = projectChangeTitle(`Edit — Drawn from ${id} and more.`);
      const all = `${out.shortTitle} ${out.fullDescription ?? ""}`;
      expect(all.toLowerCase()).not.toContain(id.toLowerCase());
    }
  });
});

describe("clampShortTitle", () => {
  it("returns the input unchanged when it fits", () => {
    expect(clampShortTitle("Short title")).toBe("Short title");
  });

  it("truncates with ellipsis when longer than the cap", () => {
    const long = "a".repeat(DEFAULT_SHORT_TITLE_MAX + 50);
    const out = clampShortTitle(long);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_SHORT_TITLE_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("cuts on a word boundary when one is available", () => {
    const long =
      "Updated the FAQ schema on /faq for whole-home renovation builders in the Bay Area, adding architect-led design-build benefits.";
    const out = clampShortTitle(long, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
    // Word-boundary proof: the input's character at position
    // `out.length - 1` (where the ellipsis sits) must be a space
    // — meaning the cut landed exactly between two words.
    const cutPosition = out.length - 1;
    expect(long[cutPosition]).toBe(" ");
  });
});
