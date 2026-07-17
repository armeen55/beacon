import { describe, expect, it } from "vitest";
import { compoundActionGroupsById } from "./compound-actions";

describe("compoundActionGroupsById", () => {
  it("gives same-page same-day levers one stable package identity", () => {
    const groups = compoundActionGroupsById([
      { id: "title", path: "/page/", shippedAt: "2026-07-17T08:00:00Z", actionType: "edit_title" },
      { id: "answer", path: "https://iranopedia.com/page", shippedAt: "2026-07-17T09:00:00Z", actionType: "add_answer_block" },
      { id: "later", path: "/page", shippedAt: "2026-07-18T09:00:00Z", actionType: "edit_meta" },
    ]);
    expect(groups.get("title")).toEqual({
      key: "combo:add_answer_block+edit_title",
      label: "add answer block + edit title",
      actionTypes: ["add_answer_block", "edit_title"],
      changeCount: 2,
    });
    expect(groups.get("answer")).toEqual(groups.get("title"));
    expect(groups.get("later")).toBeUndefined();
  });
});
