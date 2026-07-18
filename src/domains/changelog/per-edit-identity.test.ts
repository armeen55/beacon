import { describe, expect, it } from "vitest";

import { deterministicEditChangelogId, editChangelogIdentity } from "./per-edit-identity";

describe("per-edit changelog identity", () => {
  it("is stable for the exact same accepted lever", () => {
    const args = {
      tenantId: "tenant-a",
      stableKey: "rec-a",
      actionType: "edit_title",
      targetElementKey: "field:title",
    };
    const identity = editChangelogIdentity(args);
    expect(editChangelogIdentity(args)).toBe(identity);
    expect(deterministicEditChangelogId(identity)).toMatch(/^cl-[0-9a-f]{24}$/);
    expect(deterministicEditChangelogId(identity)).toBe(deterministicEditChangelogId(identity));
  });

  it("separates tenants and genuinely distinct levers while normalizing absent element keys", () => {
    const base = {
      tenantId: "tenant-a",
      stableKey: "rec-a",
      actionType: "edit_title",
      targetElementKey: null,
    };
    const key = editChangelogIdentity(base);
    expect(editChangelogIdentity({ ...base, tenantId: "tenant-b" })).not.toBe(key);
    expect(editChangelogIdentity({ ...base, actionType: "edit_meta" })).not.toBe(key);
    expect(editChangelogIdentity({ ...base, targetElementKey: "field:title" })).not.toBe(key);
  });
});
