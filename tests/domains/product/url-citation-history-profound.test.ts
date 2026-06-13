/**
 * Profound → proof bridge (2026-06-13): buildUrlCitationHistory's
 * profoundOwnedCitations gap-fill pass. Fuses the operator's paid
 * Profound AI-citation data as a third measurement source. GAP-FILL:
 * benchmark > native > profound (never double-counts); empty → native-
 * only (byte-identical).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildUrlCitationHistory } from "@/domains/product/url-citation-history";

const URL_A = "https://iranopedia.com/chaharshanbe-suri";

describe("buildUrlCitationHistory — profoundOwnedCitations gap-fill", () => {
  it("with no native observations, Profound rows become the owned series (per-platform counts summed)", async () => {
    const hist = await buildUrlCitationHistory({
      ownedOnly: true,
      observations: [],
      profoundOwnedCitations: [
        { url: URL_A, date: "2026-06-10", platform: "ChatGPT", count: 4 },
        { url: URL_A, date: "2026-06-10", platform: "Perplexity", count: 2 },
        { url: URL_A, date: "2026-06-11", platform: "ChatGPT", count: 3 },
      ],
    });
    const s = hist.series.find((x) => x.url.includes("chaharshanbe-suri"));
    expect(s).toBeDefined();
    expect(s!.is_owned).toBe(true);
    const d10 = s!.daily.find((d) => d.date === "2026-06-10");
    expect(d10!.count).toBe(6); // 4 + 2
    expect(d10!.by_platform["chatgpt"]).toBe(4);
    expect(d10!.by_platform["perplexity"]).toBe(2);
    const d11 = s!.daily.find((d) => d.date === "2026-06-11");
    expect(d11!.count).toBe(3);
  });

  it("empty/absent Profound rows → identical to native-only (no series added)", async () => {
    const base = await buildUrlCitationHistory({ ownedOnly: true, observations: [] });
    const withEmpty = await buildUrlCitationHistory({
      ownedOnly: true,
      observations: [],
      profoundOwnedCitations: [],
    });
    expect(withEmpty.series.length).toBe(base.series.length);
  });

  it("drops zero/negative counts and rows without a usable url/date", async () => {
    const hist = await buildUrlCitationHistory({
      ownedOnly: true,
      observations: [],
      profoundOwnedCitations: [
        { url: URL_A, date: "2026-06-10", platform: "ChatGPT", count: 0 },
        { url: "", date: "2026-06-10", platform: "ChatGPT", count: 5 },
        { url: URL_A, date: "", platform: "ChatGPT", count: 5 },
      ],
    });
    expect(hist.series.find((x) => x.url.includes("chaharshanbe-suri"))).toBeUndefined();
  });

  it("honors sinceDate (older Profound rows excluded)", async () => {
    const hist = await buildUrlCitationHistory({
      ownedOnly: true,
      observations: [],
      sinceDate: "2026-06-11",
      profoundOwnedCitations: [
        { url: URL_A, date: "2026-06-09", platform: "ChatGPT", count: 9 },
        { url: URL_A, date: "2026-06-12", platform: "ChatGPT", count: 3 },
      ],
    });
    const s = hist.series.find((x) => x.url.includes("chaharshanbe-suri"));
    expect(s!.daily.every((d) => d.date >= "2026-06-11")).toBe(true);
    expect(s!.daily.find((d) => d.date === "2026-06-09")).toBeUndefined();
  });
});
