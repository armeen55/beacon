import { describe, expect, it } from "vitest";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { ShippedChangeRecord } from "./shipped-change-store";
import { findProofForChange, proofResultHref } from "./change-proof-link";

const change = (over: Partial<ChangelogEntry> = {}) => ({
  id: "change-1",
  url: "https://iranopedia.com/famous-iranians/",
  timestamp: "2026-07-17T18:00:00.000Z",
  ...over,
}) as ChangelogEntry;

const proof = (over: Partial<ShippedChangeRecord> = {}) => ({
  id: "famous-iranians::2026-07-17",
  page: "https://iranopedia.com/famous-iranians",
  path: "/famous-iranians",
  shippedAt: "2026-07-17T00:00:00.000Z",
  ...over,
}) as ShippedChangeRecord;

describe("change to canonical proof linking", () => {
  it("links by normalized page and ship date", () => {
    expect(findProofForChange(change(), [proof()])?.id).toBe("famous-iranians::2026-07-17");
  });

  it("lets simultaneous same-page changes share one canonical package result", () => {
    const ledger = [proof()];
    expect(findProofForChange(change({ id: "title" }), ledger)).toBe(ledger[0]);
    expect(findProofForChange(change({ id: "answer" }), ledger)).toBe(ledger[0]);
  });

  it("does not attach a different date or page", () => {
    expect(findProofForChange(change({ timestamp: "2026-07-18T00:00:00Z" }), [proof()])).toBeNull();
    expect(findProofForChange(change({ url: "https://iranopedia.com/tehran" }), [proof()])).toBeNull();
  });

  it("builds the exact Results card anchor", () => {
    expect(proofResultHref(proof())).toBe("/results#proof-famous-iranians%3A%3A2026-07-17");
  });
});
