import { describe, it, expect } from "vitest";
import {
  buildChangelogIdByRecId,
  changeLinkHrefForRow,
} from "./changelog-link";

describe("buildChangelogIdByRecId", () => {
  it("maps source_rec_id → changelog id", () => {
    const map = buildChangelogIdByRecId([
      { id: "cl-1", source_rec_id: "rec-A" },
      { id: "cl-2", source_rec_id: "rec-B" },
    ]);
    expect(map).toEqual({ "rec-A": "cl-1", "rec-B": "cl-2" });
  });

  it("first-wins when multiple changelog entries share source_rec_id", () => {
    const map = buildChangelogIdByRecId([
      { id: "cl-faq-q", source_rec_id: "rec-faq" },
      { id: "cl-faq-a", source_rec_id: "rec-faq" },
    ]);
    expect(map["rec-faq"]).toBe("cl-faq-q");
  });

  it("ignores entries with null/empty/missing source_rec_id", () => {
    const map = buildChangelogIdByRecId([
      { id: "cl-1", source_rec_id: null },
      { id: "cl-2", source_rec_id: "" },
      { id: "cl-3" },
      { id: "cl-4", source_rec_id: "rec-A" },
    ]);
    expect(map).toEqual({ "rec-A": "cl-4" });
  });

  it("ignores entries with empty/non-string id", () => {
    const map = buildChangelogIdByRecId([
      { id: "", source_rec_id: "rec-A" },
      { id: 42 as any, source_rec_id: "rec-B" },
      { id: "cl-3", source_rec_id: "rec-C" },
    ]);
    expect(map).toEqual({ "rec-C": "cl-3" });
  });

  it("returns empty map for empty input", () => {
    expect(buildChangelogIdByRecId([])).toEqual({});
  });
});

describe("changeLinkHrefForRow", () => {
  const map = { "rec-A": "cl-1" };

  it("returns /changes/<id> for accepted row with mapped changelog", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: "accepted", status: "shipped" },
        map,
      ),
    ).toBe("/changes/cl-1");
  });

  it("returns null when responseStatus is null (pending/new row)", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: null, status: "new" },
        map,
      ),
    ).toBeNull();
  });

  it("returns null when responseStatus is dismissed", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: "dismissed", status: "dismissed" },
        map,
      ),
    ).toBeNull();
  });

  it("returns null when responseStatus is deferred", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: "deferred", status: "deferred" },
        map,
      ),
    ).toBeNull();
  });

  it("returns null when no changelog entry maps to the rec", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-NOTHING", responseStatus: "accepted", status: "accepted" },
        map,
      ),
    ).toBeNull();
  });

  it("returns null when changelogIdByRecId is empty", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: "accepted", status: "shipped" },
        {},
      ),
    ).toBeNull();
  });

  it("works for accepted-with-status='measuring' (post-Mark-shipped, pre-verdict)", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: "accepted", status: "measuring" },
        map,
      ),
    ).toBe("/changes/cl-1");
  });

  it("works for accepted-with-status='shipped'", () => {
    expect(
      changeLinkHrefForRow(
        { sourceRecommendationId: "rec-A", responseStatus: "accepted", status: "shipped" },
        map,
      ),
    ).toBe("/changes/cl-1");
  });
});
