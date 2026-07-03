import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the Wix client so NO real network call ever fires. Each test sets the
// return value of the getters.
const wixGetDataItemMock = vi.fn();
const wixGetStoreProductMock = vi.fn();
vi.mock("@/lib/connectors/wix/client", () => ({
  wixGetDataItem: (...a: unknown[]) => wixGetDataItemMock(...a),
  wixGetStoreProduct: (...a: unknown[]) => wixGetStoreProductMock(...a),
}));

import {
  compareReadBack,
  readBackWixField,
  readBackWixProductSeoData,
  readBackReceiptLine,
} from "./read-back";

describe("compareReadBack - pure comparator", () => {
  it("exact match -> verified", () => {
    expect(compareReadBack({ sent: "New Title", stored: "New Title", mode: "exact" })).toEqual({
      verdict: "verified",
      detail: "read_back_match",
    });
  });

  it("exact match tolerates whitespace + case", () => {
    expect(
      compareReadBack({ sent: "New   Title", stored: "  new title ", mode: "exact" }),
    ).toEqual({ verdict: "verified", detail: "read_back_match" });
  });

  it("a real mismatch -> UNVERIFIED, never verified (the core safety point)", () => {
    expect(
      compareReadBack({ sent: "What I sent", stored: "What the store actually has", mode: "exact" }),
    ).toEqual({ verdict: "unverified", detail: "read_back_mismatch" });
  });

  it("null stored value (could not read) -> inconclusive, never verified", () => {
    expect(compareReadBack({ sent: "x", stored: null, mode: "exact" })).toEqual({
      verdict: "inconclusive",
      detail: "read_back_no_value",
    });
  });

  it("empty needle -> inconclusive (never claims a match on nothing)", () => {
    expect(compareReadBack({ sent: "   ", stored: "anything", mode: "exact" })).toEqual({
      verdict: "inconclusive",
      detail: "read_back_empty_needle",
    });
  });

  it("contains mode: verified when the sent text is inside a larger merged body", () => {
    expect(
      compareReadBack({
        sent: "Our new answer block.",
        stored: "Intro paragraph. Our new answer block. The rest of the body.",
        mode: "contains",
      }),
    ).toEqual({ verdict: "verified", detail: "read_back_match" });
  });

  it("contains mode: unverified when the sent text is absent from the body", () => {
    expect(
      compareReadBack({ sent: "Our new answer block.", stored: "Only the old body is here.", mode: "contains" }),
    ).toEqual({ verdict: "unverified", detail: "read_back_mismatch" });
  });
});

describe("readBackWixField - reads the CMS field back (mocked Wix)", () => {
  it("VERIFIED: the stored field matches what we sent", async () => {
    wixGetDataItemMock.mockResolvedValueOnce({
      ok: true,
      value: { id: "i1", dataCollectionId: "C", data: { title: "New Title" } },
    });
    const r = await readBackWixField({
      tenantId: "t1", dataCollectionId: "C", dataItemId: "i1",
      field: "title", sent: "New Title", mode: "exact",
    });
    expect(r.verdict).toBe("verified");
  });

  it("UNVERIFIED (not live): the store has a DIFFERENT value than we sent", async () => {
    wixGetDataItemMock.mockResolvedValueOnce({
      ok: true,
      value: { id: "i1", dataCollectionId: "C", data: { title: "Old Title" } },
    });
    const r = await readBackWixField({
      tenantId: "t1", dataCollectionId: "C", dataItemId: "i1",
      field: "title", sent: "New Title", mode: "exact",
    });
    expect(r.verdict).toBe("unverified");
    expect(r.verdict).not.toBe("verified");
  });

  it("INCONCLUSIVE: the read itself failed (fail-safe, never verified)", async () => {
    wixGetDataItemMock.mockResolvedValueOnce({ ok: false, reason: "api_error" });
    const r = await readBackWixField({
      tenantId: "t1", dataCollectionId: "C", dataItemId: "i1",
      field: "title", sent: "New Title", mode: "exact",
    });
    expect(r.verdict).toBe("inconclusive");
  });

  it("INCONCLUSIVE: the read threw (fail-safe)", async () => {
    wixGetDataItemMock.mockRejectedValueOnce(new Error("boom"));
    const r = await readBackWixField({
      tenantId: "t1", dataCollectionId: "C", dataItemId: "i1",
      field: "title", sent: "New Title", mode: "exact",
    });
    expect(r.verdict).toBe("inconclusive");
  });

  it("serializes a structured (object) field so a RICOS body compares", async () => {
    const body = { nodes: [{ type: "PARAGRAPH", text: "Our new answer block." }] };
    wixGetDataItemMock.mockResolvedValueOnce({
      ok: true,
      value: { id: "i1", dataCollectionId: "C", data: { content: body } },
    });
    const r = await readBackWixField({
      tenantId: "t1", dataCollectionId: "C", dataItemId: "i1",
      field: "content", sent: "Our new answer block.", mode: "contains",
    });
    expect(r.verdict).toBe("verified");
  });
});

describe("readBackWixProductSeoData - reads seoData back (mocked Wix)", () => {
  it("VERIFIED: the JSON-LD block we sent is present in the product seoData", async () => {
    wixGetStoreProductMock.mockResolvedValueOnce({
      ok: true,
      value: {
        id: "p1", name: "P", slug: "p",
        seoData: { tags: [{ type: "script", children: '{"@type":"Product","name":"Widget"}' }] },
      },
    });
    const r = await readBackWixProductSeoData({
      tenantId: "t1", productId: "p1", sent: '{"@type":"Product","name":"Widget"}',
    });
    expect(r.verdict).toBe("verified");
  });

  it("UNVERIFIED when the block is not actually in seoData", async () => {
    wixGetStoreProductMock.mockResolvedValueOnce({
      ok: true,
      value: { id: "p1", name: "P", slug: "p", seoData: { tags: [] } },
    });
    const r = await readBackWixProductSeoData({
      tenantId: "t1", productId: "p1", sent: '{"@type":"Product","name":"Widget"}',
    });
    expect(r.verdict).toBe("unverified");
  });
});

describe("readBackReceiptLine - honest, dash-free operator copy", () => {
  it("verified line claims it is in place", () => {
    expect(readBackReceiptLine("verified")).toContain("in place");
  });
  it("unverified + inconclusive both say check the page, never claim live", () => {
    expect(readBackReceiptLine("unverified")).toContain("check the page");
    expect(readBackReceiptLine("inconclusive")).toContain("check the page");
    expect(readBackReceiptLine("unverified")).not.toContain("in place");
  });
  it("no dashes in any line", () => {
    for (const v of ["verified", "unverified", "inconclusive"] as const) {
      expect(readBackReceiptLine(v)).not.toMatch(/[—–]/);
    }
  });
});
