import { describe, it, expect } from "vitest";
import { mainOf, pageExtractFrom, pageExtractFromRecord } from "@/domains/evidence/funnel/research-evidence";
const MAIN_TEXT_CEILING = mainOf("word ".repeat(20_000)).heldChars!;
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import { parseCapability } from "@/domains/evidence/dataforseo/capabilities";
import { COMPETITIVE_PATTERN } from "@/domains/evidence/competitive-pattern"; import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import { emptyResearchEvidence, type FunnelResearchEvidence } from "@/domains/evidence/funnel/research-evidence"; import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/harbour-seals", nav: "Home Shop Newsletter", h2: "Where they haul out",
    h3: "Best months to look", body: "Harbour seals haul out on the sand bars below the point at low tide, and the colony is largest between June and August.",
    foot: "Copyright the harbour trust", rail: "Newsletter", schema: "Article" },
  { t: "tenant-two", url: "https://beta.example/telares", nav: "Inicio Tienda Boletin", h2: "Como se monta la urdimbre",
    h3: "Cuantos hilos por centimetro", body: "La urdimbre se monta con doce hilos por centimetro y se tensa antes de pasar la primera trama del telar.",
    foot: "Derechos reservados del taller", rail: "Boletin", schema: "HowTo" },
];
const htmlOf = (s: (typeof SITES)[number], body = s.body): string => `<html><head><title>${s.h2}</title>
  <script type="application/ld+json">{"@type":"${s.schema}","name":"${s.h2}"}</script></head><body>
  <nav>${s.nav}</nav><header>${s.nav}</header>
  <main><h1>${s.h2}</h1><h2>${s.h2}</h2><p>${body}</p><h3>${s.h3}</h3><p>${body}</p></main>
  <aside>${s.nav}</aside><footer><h2>${s.rail}</h2>${s.foot}</footer></body></html>`;
describe("what one read of a winning page carries", () => {
  it("admits the complete Farsi sources while landmarks owe exact partial winners, including replay, short and empty captures", () => {
    const at = "2026-09-25T12:00:00.000Z", now = Date.parse(at), labels = ["famous landmarks in iran", "difference between farsi and persian"], hosts = [["holidayfromwhere", "twofortheworld", "globetrottingdetective", "nomadicchica", "jackandjill"], ["iranica", "britannica", "linguistics"]];
    const page = (q: string, h: string, rank: number, complete: boolean) => { const url = `https://${h}.example/${q.replaceAll(" ", "-")}`, mainText = `${q} has documented usage and context. `.repeat(30); return { url, domain: `${h}.example`, engines: [], examplePrompts: [], appearances: [{ kind: "serp_organic" as const, query: q, promptId: null, promptText: null, engine: null, rank, citedUrl: url, observedAt: at, modelServed: null }], extract: { title: q, h1: q, wordCount: 180, headings: [q], mainText: complete ? mainText.slice(0, 12_000) : mainText.slice(0, 80), totalChars: mainText.length, heldChars: complete ? mainText.length : 80, truncated: !complete, sourceComplete: complete, fetchedAt: at } }; };
    const research: FunnelResearchEvidence = { ...emptyResearchEvidence(), retainedKeywords: labels.map((query, i) => ({ query, searchVolume: i ? 150 : 900, competition: null, competitionLevel: null, difficulty: null, intent: "informational", discoveredVia: "gsc", seed: null })), serpEvidence: labels.map((query, i) => ({ query, observedAt: at, aiOverview: [], aiMode: [], paa: [], related: [], organic: hosts[i]!.map((h, j) => ({ rank: j + 1, domain: `${h}.example`, url: `https://${h}.example/${query.replaceAll(" ", "-")}`, title: i ? `Difference Between Farsi and Persian Explained` : `Top 10 Famous Landmarks in Iran` })) })), winningPages: hosts.flatMap((hs, i) => hs.map((h, j) => page(labels[i]!, h, j + 1, i === 1 || j < 2))) };
    const snapshot = { scope: { tenantId: "fixture-tenant", site: "fixture.example", builtAt: at }, sources: [], ownedPages: [], competitors: [], keywordDemand: labels.map((query, i) => ({ query, searchVolume: i ? 150 : 900, source: "dataforseo", competition: null, competitionLevel: null, gscImpressions: null })), questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, research, evidenceHash: "fixture" } as EvidenceSnapshot;
    const topics = buildTopicInvestigations(snapshot), landmarks = topics.find((t) => t.label === labels[0])!, farsi = topics.find((t) => t.label === labels[1])!; expect([landmarks.currentReadableWinners, landmarks.nextAcquisition?.kind, farsi.currentReadableWinners, farsi.nextAcquisition]).toEqual([2, "read_winner", 3, null]);
    const full = research.winningPages[0]!, partial = research.winningPages[2]!; expect([COMPETITIVE_PATTERN.readDue(full, now), COMPETITIVE_PATTERN.readDue(partial, now), COMPETITIVE_PATTERN.readDue(JSON.parse(JSON.stringify(full)), now), COMPETITIVE_PATTERN.sourceComplete({ ...full.extract!, sourceComplete: false })]).toEqual([false, true, false, false]);
    const short = { ...full, extract: { ...full.extract!, wordCount: 30 } }, empty = { ...full, extract: { ...full.extract!, mainText: null, truncated: false, sourceComplete: undefined }, readOutcome: { state: "temporarily_unavailable" as const, attemptedAt: at, retryAfter: "2026-09-26T12:00:00.000Z" } }; expect([COMPETITIVE_PATTERN.readDue(short, now), COMPETITIVE_PATTERN.readDue(empty, now)]).toEqual([false, false]); research.winningPages[0] = short; expect(buildTopicInvestigations(snapshot).find((t) => t.label === labels[0])?.nextAcquisition?.subject).toBe(partial.url); research.winningPages[0] = empty; expect(buildTopicInvestigations(snapshot).find((t) => t.label === labels[0])?.missingEvidence.join(" ")).not.toContain("next attempt"); });
  for (const s of SITES) {
    it(`${s.t}: fresh and stored bodies retain content, scope and honest legacy absence`, () => {
      const fresh = pageExtractFrom(extractPageSnapshot(htmlOf(s), s.url, "p1", s.t));
      expect([fresh.mainText?.includes(s.body), fresh.mainText?.includes(s.nav), fresh.mainText?.includes(s.foot), fresh.mainText?.includes(s.rail), fresh.h3s, fresh.schemaTypes, fresh.truncated]).toEqual([true, false, false, false, [s.h3], [s.schema], false]);
      const back = pageExtractFromRecord(JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>);
      expect([back.mainText, back.h3s, back.schemaTypes, back.truncated, back.heldChars, back.totalChars],
        "every field the read banked is the field the next pass reads").toEqual([fresh.mainText, fresh.h3s, fresh.schemaTypes, fresh.truncated, fresh.heldChars, fresh.totalChars]);
      const legacy = pageExtractFromRecord({ title: s.h2, h1: s.h2, wordCount: 900, headings: [s.h2], faqCount: 0, openingSample: s.body });
      expect([legacy.mainText, legacy.truncated, legacy.heldChars, legacy.totalChars, legacy.openingSample === s.body, legacy.entityNames],
        "a row from before the reading says nothing was captured, which is not the claim that the page carries nothing, and a row that banked no entity list hands back no list rather than an empty one").toEqual([null, null, null, null, true, undefined]);
      const long = `${s.body} `.repeat(400), x = pageExtractFrom(extractPageSnapshot(htmlOf(s, long), s.url, "p1", s.t)), row = mainOf(x.mainText, x.totalChars ?? 0);
      expect([x.truncated, x.heldChars === x.totalChars, (x.totalChars ?? 0) > MAIN_TEXT_CEILING, x.sections?.map((c) => c.heading), x.sections?.every((c) => c.text.includes(s.body))],
        "the free crawl is read WHOLE with a section under every heading, so a deep section in a long page can reach the comparison").toEqual([false, true, true, [s.h2, s.h3], true]);
      expect([row.truncated, row.heldChars, row.totalChars], "re-holding it at the row's ceiling records the cut with both counts and never understates the page").toEqual([true, MAIN_TEXT_CEILING, x.totalChars]);
      expect(pageExtractFrom(extractPageSnapshot(htmlOf(s), s.url, "p1", s.t)).sections, "sections carry the words under each heading, the heading itself never inside them").toEqual([{ heading: s.h2, text: "" }, { heading: s.h2, text: s.body }, { heading: s.h3, text: s.body }].filter((c) => c.text));
    });
    it(`${s.t}: cached provider sections retain their words and move exact-query job identity, never inventing unreported fields`, () => {
      const envelope = { tasks: [{ result: [{ items: [{ page_content: { main_topic: [{ main_title: s.h2, h_title: s.h2, primary_content: [{ text: s.body }], table_content: [{ table_content: [["one", "two"]] }] }],
        secondary_topic: [{ h_title: s.h3, primary_content: [{ text: s.body }] }] } }] }] }] };
      const got = parseCapability("onpage_content_parsing", envelope as never)!;
      expect([got?.mainText?.includes(s.body), got?.headings, (got?.wordCount ?? 0) > 0], "the provider's main and secondary topics are the reading, and its headings ride with it").toEqual([true, [s.h2, s.h3], true]);
      const back = pageExtractFromRecord(JSON.parse(JSON.stringify(got))); expect([back.sections, back.h3s, back.schemaTypes]).toEqual([got.sections, undefined, undefined]);
      expect([got.hasTable, got.faqCount, got.metaDescription, got.entityNames, got.hasList, got.internalLinkCount, got.externalLinkCount]).toEqual([true, undefined, undefined, undefined, undefined, undefined, undefined]);
      const empty = parseCapability("onpage_content_parsing", { tasks: [{ result: [{ items: [{ page_content: {} }] }] }] } as never);
      expect([empty?.mainText, empty?.wordCount, empty?.truncated], "a read that came back with no words carries none, so nothing downstream can mistake it for a page that answers").toEqual([null, 0, false]);
    });
  }
});
