/** N40 contract test - GSC searchanalytics.query + sites.list: a checked-in REAL response shape through the ACTUAL client path (injected fetchImpl), so a silent upstream change fails a named test instead of a quietly-empty sync. NO live calls. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  gscSearchAnalyticsQuery,
  gscListSites,
  pickGscPropertyForDomain,
  GSC_SA_ROW_LIMIT,
} from "@/lib/connectors/gsc/search-analytics";
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf-8"));}
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },});}
describe("GSC searchanalytics.query contract", () => {
  it("parses the documented row shape: keys[] in dimension order + 4 numeric metrics", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(fixture("gsc-searchanalytics.json"));
    }) as unknown as typeof fetch;
    const rows = await gscSearchAnalyticsQuery(
      {
        accessToken: "test-token",
        siteUrl: "sc-domain:fixture-content.example",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        dimensions: ["page", "query"],},
      { fetchImpl },);
    expect(rows).not.toBeNull(); expect(rows).toHaveLength(3);
    for (const row of rows!) {
      expect(Array.isArray(row.keys)).toBe(true); expect(row.keys).toHaveLength(2); // keys arrive in REQUEST dimension order: [page, query].
      expect(row.keys[0]).toMatch(/^https:\/\//); expect(typeof row.keys[1]).toBe("string");
      expect(typeof row.clicks).toBe("number"); expect(typeof row.impressions).toBe("number");
      expect(row.ctr).toBeGreaterThanOrEqual(0); expect(row.ctr).toBeLessThanOrEqual(1); // ctr is a 0..1 FRACTION (not a percentage) per Google's contract.
      expect(row.position).toBeGreaterThanOrEqual(1);} // position is a 1-based average.
    const sent = JSON.parse(String(calls[0]!.init?.body)); // Our REQUEST contract: the body carries the fields Google documents.
    expect(sent).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      dimensions: ["page", "query"],
      type: "web",
      rowLimit: GSC_SA_ROW_LIMIT,
      startRow: 0,
      dataState: "final",});});
  it("a body with NO rows key (quiet day) parses to [] rather than null/throw", async () => {
    const fetchImpl = (async () => jsonResponse({ responseAggregationType: "byPage" })) as typeof fetch;
    const rows = await gscSearchAnalyticsQuery(
      {
        accessToken: "t",
        siteUrl: "sc-domain:fixture-content.example",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        dimensions: ["page"],},
      { fetchImpl },);
    expect(rows).toEqual([]);});});
describe("GSC sites.list contract", () => {
  it("parses siteEntry[] and property selection prefers the sc-domain property, skipping unverified", async () => {
    const fetchImpl = (async () => jsonResponse(fixture("gsc-sites-list.json"))) as typeof fetch; const sites = await gscListSites("test-token", { fetchImpl });
    expect(sites).toHaveLength(3); // The malformed entry (no siteUrl) is dropped; the rest keep their shape.
    for (const s of sites) {
      expect(typeof s.siteUrl).toBe("string"); expect(typeof s.permissionLevel).toBe("string");}
    expect(pickGscPropertyForDomain(sites, "fixture-content.example")).toBe("sc-domain:fixture-content.example");
    expect(pickGscPropertyForDomain(sites, "unverified.example.com")).toBeNull();});}); // Unverified-only domains resolve to null (we cannot read their analytics).
