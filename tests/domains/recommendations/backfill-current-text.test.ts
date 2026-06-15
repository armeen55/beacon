import { describe, expect, it } from "vitest";

import {
  currentTextFieldForAction,
  pickBackfilledCurrentText,
} from "@/domains/recommendations/backfill-current-text";

describe("currentTextFieldForAction", () => {
  it("maps the four field-replacing edit types (except h2)", () => {
    expect(currentTextFieldForAction("edit_title")).toBe("title");
    expect(currentTextFieldForAction("edit_meta")).toBe("meta_description");
    expect(currentTextFieldForAction("edit_h1")).toBe("h1");
    // h2 has no single-valued snapshot field → no before.
    expect(currentTextFieldForAction("edit_h2")).toBeNull();
  });

  it("returns null for additive / non-edit action types", () => {
    for (const a of [
      "add_faq",
      "add_section",
      "add_schema",
      "add_comparison_table",
      "add_internal_links",
      "improve_copy",
      "create_page",
    ] as const) {
      expect(currentTextFieldForAction(a)).toBeNull();
    }
  });
});

describe("pickBackfilledCurrentText", () => {
  it("returns the snapshot title as before for edit_title when none stored", () => {
    expect(
      pickBackfilledCurrentText({
        actionType: "edit_title",
        existingCurrentText: null,
        proposedText: "New SEO title",
        snapshot: { title: "  Old title  ", meta_description: null, h1: null },
      }),
    ).toBe("Old title");
  });

  it("returns the snapshot meta for edit_meta", () => {
    expect(
      pickBackfilledCurrentText({
        actionType: "edit_meta",
        existingCurrentText: "",
        proposedText: "New meta",
        snapshot: { meta_description: "Old meta", title: null, h1: null },
      }),
    ).toBe("Old meta");
  });

  it("does NOT override an already-stored currentText", () => {
    expect(
      pickBackfilledCurrentText({
        actionType: "edit_title",
        existingCurrentText: "Already there",
        proposedText: "New title",
        snapshot: { title: "Snapshot title" },
      }),
    ).toBeNull();
  });

  it("returns null when the snapshot field is empty/absent", () => {
    expect(
      pickBackfilledCurrentText({
        actionType: "edit_title",
        existingCurrentText: null,
        proposedText: "New title",
        snapshot: { title: "   " },
      }),
    ).toBeNull();
    expect(
      pickBackfilledCurrentText({
        actionType: "edit_title",
        existingCurrentText: null,
        proposedText: "New title",
        snapshot: null,
      }),
    ).toBeNull();
  });

  it("returns null when before equals proposed (no real change)", () => {
    expect(
      pickBackfilledCurrentText({
        actionType: "edit_title",
        existingCurrentText: null,
        proposedText: "Same title",
        snapshot: { title: "Same title" },
      }),
    ).toBeNull();
  });

  it("returns null for additive action types even with a snapshot", () => {
    expect(
      pickBackfilledCurrentText({
        actionType: "add_faq",
        existingCurrentText: null,
        proposedText: "Some answer",
        snapshot: { title: "A title", meta_description: "A meta", h1: "An h1" },
      }),
    ).toBeNull();
  });
});
