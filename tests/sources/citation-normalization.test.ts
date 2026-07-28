import { describe, it, expect, vi } from "vitest";
import { resolveCitationTargets } from "@/domains/evidence/competitor-intel/polite-fetch";
import { rankWinningPages } from "@/domains/evidence/funnel/normalize";
import { buildPresenceMatrix, type NativeObservationInput } from "@/domains/evidence/readers/native-intel";
import type { ResearchWinningAppearance } from "@/domains/evidence/funnel/research-evidence";
const WRAP = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC";
const HOP = "https://redirect.example.com/x"; const REAL = "https://iranicaonline.org/articles/saffron";
const app = (url: string, over: Partial<ResearchWinningAppearance> = {}): ResearchWinningAppearance => ({ kind: "ai_answer", query: null, promptId: "p1", promptText: "best saffron",
  engine: "gemini", rank: null, citedUrl: url, observedAt: "2026-07-25T00:00:00Z", modelServed: null, observationMode: "standardized_response", ...over });
const obs = (over: Partial<NativeObservationInput>): NativeObservationInput => ({ promptId: "p1", promptText: "best saffron", engine: "chatgpt", topic: null, observedAt: "2026-07-25T01:00:00Z",
  answerText: "Beacon Saffron is the top pick.", citationDomains: [], citationUrls: [], trackedBrandMentioned: true, trackedBrandCited: false, ...over });
/** Redirect stub: header-only responses, never a body. */
function stubFetch(chain: Record<string, { status: number; location?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    const hop = chain[String(url)] ?? { status: 200 };
    const headers = { get: (h: string) => (h.toLowerCase() === "location" ? hop.location ?? null : null) };
    return { status: hop.status, headers, body: null } as unknown as Response; });
  return { impl: impl as unknown as typeof fetch, calls };
}
describe("citation normalization (Slice 6I)", () => {
  it("resolves a wrapper through wrapper-only hops, keeps order/mode, never requests the final host or non-wrappers", async () => {
    const WRAP2 = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/DeF";
    const { impl, calls } = stubFetch({ [WRAP]: { status: 302, location: WRAP2 }, [WRAP2]: { status: 301, location: REAL } });
    const out = await resolveCitationTargets([app("https://plain.com/a"), app(WRAP, { observationMode: "consumer_search" })], impl);
    expect(out.map((a) => a.citedUrl)).toEqual(["https://plain.com/a", REAL]);
    expect(out[1]!.viaUrl).toBe(WRAP); expect(out[1]!.observationMode).toBe("consumer_search"); expect(out[0]!.viaUrl).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([WRAP, WRAP2]); // requests go ONLY to the wrapper host: the first off-wrapper Location IS the source, and the non-wrapper appearance cost zero fetches
    for (const c of calls) expect(c.init.redirect).toBe("manual"); // header only, no body ever read
  });
  it("keeps the raw wrapper on failure, and ranking never makes it a winning page", async () => {
    const { impl, calls } = stubFetch({ [WRAP]: { status: 500 } });
    const out = await resolveCitationTargets([app(WRAP)], impl);
    expect(out[0]!.citedUrl).toBe(WRAP); expect(out[0]!.viaUrl).toBeUndefined(); expect(calls).toHaveLength(1);
    expect(rankWinningPages([...out, app(REAL)], "mysite.com", 10).map((c) => c.url)).toEqual([REAL]); });
  it("dedupes per URL, stops at the per-call resolution budget, and stops resolving past the deadline", async () => {
    const one = stubFetch({ [WRAP]: { status: 302, location: REAL } });
    await resolveCitationTargets([app(WRAP), app(WRAP)], one.impl);
    expect(one.calls.map((c) => c.url)).toEqual([WRAP]); // one chain for both appearances; the final host is never requested
    const budget = stubFetch({});
    await resolveCitationTargets(Array.from({ length: 12 }, (_, i) => app(`${WRAP}/${i}`)), budget.impl);
    expect(new Set(budget.calls.map((c) => c.url)).size).toBe(10);
    const late = stubFetch({});
    await resolveCitationTargets([app(WRAP)], late.impl, Date.now() - 1);
    expect(late.calls).toHaveLength(0); // a spent unit deadline resolves nothing, raw evidence kept
  });
  it("counts a same-day chatgpt consumer + standardized pair ONCE, from the consumer row", () => {
    const matrix = buildPresenceMatrix([obs({ observationMode: "consumer_search", trackedBrandMentioned: true }),
      obs({ observationMode: "standardized_response", observedAt: "2026-07-25T02:00:00Z", trackedBrandMentioned: false })]);
    expect(matrix.rows[0]!.byEngine).toHaveLength(1); expect(matrix.rows[0]!.byEngine[0]!.mentioned).toBe(true);
    expect(matrix.totals).toEqual({ promptsChecked: 1, present: 1, absent: 0 });
    // A lone auxiliary row never invents coverage: missing consumer stays missing.
    expect(buildPresenceMatrix([obs({ observationMode: "standardized_response" })]).totals.promptsChecked).toBe(0); });
});
