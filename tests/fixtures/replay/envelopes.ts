/** DETERMINISTIC REPLAY - provider ENVELOPES, shaped exactly as the frozen DataForSEO registry parsers in src/domains/evidence/dataforseo/capabilities.ts read them (resultBlock -> tasks[0].result[0] + items). Every field a parser touches is named here. A few fields NO parser touches (search_results, brand_mentions) are present on purpose, so a test can prove a retrieved result never becomes a citation. All data is invented: a fictional site on reserved example domains, never a customer's private metrics. Builders, never blobs: each takes overridable fields so one shape serves many cases. */
import type { ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
export const SITE = "atlaspedia.example";
export const GAP_QUERY = "kite festival traditions";
export const GAP_URL = `${SITE}/kite-festival-guide`;
export const WINNER_QUERY = "paper lantern guide";
export const RIVAL_A = "https://rival-a.example/kite-festival-traditions";
export const RIVAL_B = "https://rival-b.example/blog/spring-kites";
export const OBSERVED_AT = "2026-07-20T09:00:00.000Z";
/** The bounded envelope the money core caches: status + ONE task carrying a result array. */
const envelope = (result: unknown[], id = "fx-task"): ProviderEnvelope =>
  ({ status_code: 20000, status_message: "Ok.", cost: 0, tasks: [{ id, status_code: 20000, status_message: "Ok.", cost: 0, result }] });
// ── the ChatGPT consumer look (llm_scraper task_get/advanced) ────────────────
/** Field names anchored to docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced on 2026-07-31: the result carries `sources` (CITED), `search_results` (RETRIEVED, type "chatgpt_search_result"), `brand_entities` (type "chat_gpt_brand_entity"), `fan_out_queries`, `markdown`, `model`, `check_url` and `se_results_count`. There is NO web_search field on this endpoint. */
export type ScraperOver = {
  keyword?: string; model?: string; markdown?: string; fanOut?: string[];
  /** CITED sources: the only thing parseScraper may turn into citations. */
  sources?: { url: string; domain: string; title: string | null }[] | null;
  /** RETRIEVED but not cited. A retrieved page may NEVER reach the citation list. */
  searchResults?: { url: string; domain: string; title: string }[] | null;
  /** The brands the engine itself named, verbatim from brand_entities. */
  brandEntities?: { title: string; category: string }[] | null;
};
export const CITED_SOURCES = [
  { url: RIVAL_A, domain: "rival-a.example", title: "Kite Festival Traditions Explained" },
  { url: `https://${GAP_URL}`, domain: SITE, title: "Kite Festival" },
];
export const RETRIEVED_ONLY = [
  { url: "https://retrieved-only.example/kites", domain: "retrieved-only.example", title: "Kites of the world" },
  { url: "https://second-retrieval.example/festivals", domain: "second-retrieval.example", title: "Festival calendar" },
];
export const BRAND_ENTITIES = [{ title: "Atlaspedia", category: "Reference" }, { title: "Rival A", category: "Travel" }];
export function scraperAnswer(over: ScraperOver = {}): ProviderEnvelope {
  const list = <T>(v: T[] | null | undefined, fallback: T[]) => (v === null ? undefined : (v ?? fallback));
  return envelope([{
    keyword: over.keyword ?? GAP_QUERY, type: "llm_scraper", se_domain: "chatgpt.com",
    location_code: 2840, language_code: "en", datetime: "2026-07-20 09:00:00 +00:00",
    model: over.model ?? "gpt-4o-search", check_url: "https://chatgpt.com/?q=kite%20festival%20traditions",
    fan_out_queries: over.fanOut ?? ["what happens at a kite festival", "kite festival food traditions"],
    markdown: over.markdown ?? "## Kite festival traditions\n\nFamilies fly kites at dawn, share flatbread, and set paper lanterns loose after dark.\n\n- Dawn flying\n- Shared meal\n- Lanterns at night",
    sources: list(over.sources, CITED_SOURCES)?.map((s) => ({ type: "chat_gpt_source", ...s, snippet: s.title, source_name: s.domain, publication_date: null })),
    search_results: list(over.searchResults, RETRIEVED_ONLY)?.map((s) => ({ type: "chatgpt_search_result", ...s, description: s.title, breadcrumb: s.domain })),
    brand_entities: list(over.brandEntities, BRAND_ENTITIES)?.map((b) => ({ type: "chat_gpt_brand_entity", ...b, markdown: `**${b.title}**`, urls: null })),
    se_results_count: (over.searchResults ?? RETRIEVED_ONLY)?.length ?? 0,
  }]);
}
// ── the standardized ask (llm_responses task_get / live) ─────────────────────
export type LlmOver = { model?: string; webSearch?: boolean | null; text?: string; fanOut?: string[] | null; annotations?: { title: string; url: string }[] };
/** ONE shape for chatgpt, claude, gemini and perplexity: they differ in the REQUEST, never the response. Anchored to docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live on 2026-07-31: result[0] carries model_name, input_tokens, output_tokens, reasoning_tokens, web_search, money_spent, datetime, items and fan_out_queries; an item is type "message" OR type "reasoning", and a section is type "text" or "summary_text". This endpoint documents NO retrieval list and NO brand list. */
export function llmAnswer(over: LlmOver = {}): ProviderEnvelope {
  const result: Record<string, unknown> = {
    model_name: over.model ?? "gpt-4o-2024-08-06", input_tokens: 14, output_tokens: 96, reasoning_tokens: 32, money_spent: 0.03,
    datetime: "2026-07-20 09:05:00 +00:00",
    items: [
      // A reasoning item carries no answer and no citation: the parser must walk past it, never read it as text.
      { type: "reasoning", sections: [{ type: "summary_text", text: "Checking what happens at a kite festival.", annotations: null }] },
      { type: "message", sections: [{
        type: "text", text: over.text ?? "Kite festivals usually open at dawn and close with paper lanterns.",
        annotations: (over.annotations ?? [{ title: "Kite Festival Traditions Explained", url: RIVAL_A }]).map((a, i) => ({ ...a, start_index: i, end_index: i + 4, text: a.title })),
      }] }],
  };
  if (over.webSearch !== null) result.web_search = over.webSearch ?? true;
  if (over.fanOut !== null) result.fan_out_queries = over.fanOut ?? ["kite festival opening times"];
  return envelope([result]);
}
// ── the organic results page (serp/google/organic task_get/advanced) ─────────
export type SerpOver = { keyword?: string; ownedTitle?: string; ownedUrl?: string; organic?: Record<string, unknown>[]; aiOverview?: boolean };
const organicRow = (rank: number, url: string, title: string) =>
  ({ type: "organic", rank_group: rank, rank_absolute: rank + 1, domain: new URL(url).hostname, url, title, description: title });
/** Deliberately VARIED page types: guide, guide-by-host, forum, list, product, plus two rows that classify as nothing at all (a null vote must vote for nothing, never pad the majority). */
export function serpOrganic(over: SerpOver = {}): ProviderEnvelope {
  const owned = organicRow(6, `https://${over.ownedUrl ?? GAP_URL}`, over.ownedTitle ?? "Kite Festival");
  const items: Record<string, unknown>[] = over.organic ?? [
    organicRow(1, RIVAL_A, "Kite Festival Traditions Explained"),
    organicRow(2, RIVAL_B, "Spring Kite Festival Traditions and Food"),
    organicRow(3, "https://wikipedia.example/wiki/Kite_festival", "Kite festival"),
    organicRow(4, "https://kite-talk.example/forum/thread-12", "Anyone been to the spring festival"),
    organicRow(5, "https://listicles.example/kite-festivals", "21 Kite Festivals Around the World"),
    owned,
    organicRow(7, "https://kite-shop.example/product/festival-kit", "Festival kite kit"),
  ];
  const blocks: Record<string, unknown>[] = [...items,
    { type: "people_also_ask", rank_group: 8, items: [
      { type: "people_also_ask_element", title: "What do people eat at a kite festival" },
      { type: "people_also_ask_element", title: "When did kite festivals start" }] },
    { type: "related_searches", rank_group: 9, items: ["kite festival food", "kite festival dates", "paper lantern guide"] }];
  if (over.aiOverview !== false) blocks.push({ type: "ai_overview", rank_group: 10, items: [{
    type: "ai_overview_element", title: "Kite festival traditions",
    text: "Kite festivals open at dawn and end with lanterns.", markdown: "Kite festivals **open at dawn**.",
    references: [
      { type: "ai_overview_reference", source: "Rival A", domain: "rival-a.example", url: RIVAL_A, title: "Kite Festival Traditions Explained" },
      { type: "ai_overview_reference", source: "Wikipedia", domain: "wikipedia.example", url: "https://wikipedia.example/wiki/Kite_festival", title: "Kite festival" }] }] });
  return envelope([{ keyword: over.keyword ?? GAP_QUERY, type: "organic", se_domain: "google.com", location_code: 2840, language_code: "en", items_count: blocks.length, items: blocks }]);
}
// ── keyword batches (dataforseo_labs ranked_keywords / keyword_overview) ─────
export type KeywordOver = { keyword?: string; volume?: number | null; difficulty?: number | null; intent?: string | null; trend?: { year: number; month: number; volume: number | null }[] | null; rankedUrl?: string | null; rankedRank?: number | null };
/** A TWELVE-month trend, with one unknown month left null: "unknown" is not "zero searches". */
export const SEASONAL_TREND = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: 12 - i, volume: i === 3 ? null : 200 + (i < 6 ? 900 : 0) }));
export function keywordBatch(rows: KeywordOver[] = []): ProviderEnvelope {
  const items = (rows.length ? rows : [{}]).map((r) => ({
    se_type: "google",
    keyword_data: {
      keyword: r.keyword ?? GAP_QUERY, location_code: 2840, language_code: "en",
      keyword_info: { se_type: "google", search_volume: r.volume === undefined ? 2400 : r.volume, cpc: 0.82, competition: 0.24, competition_level: "LOW",
        monthly_searches: r.trend === undefined ? SEASONAL_TREND.map((m) => ({ year: m.year, month: m.month, search_volume: m.volume })) : r.trend?.map((m) => ({ year: m.year, month: m.month, search_volume: m.volume })) ?? null },
      keyword_properties: { se_type: "google", keyword_difficulty: r.difficulty === undefined ? 31 : r.difficulty },
      search_intent_info: { se_type: "google", main_intent: r.intent === undefined ? "informational" : r.intent },
    },
    ...(r.rankedUrl === null ? {} : { ranked_serp_element: { serp_item: { type: "organic", rank_group: r.rankedRank ?? 6, rank_absolute: (r.rankedRank ?? 6) + 2, url: r.rankedUrl ?? `https://${GAP_URL}`, domain: SITE, title: "Kite Festival" } } }),
  }));
  return envelope([{ se_type: "google", target: SITE, location_code: 2840, language_code: "en", total_count: items.length, items_count: items.length, offset: 0, items }]);
}
// ── the page-by-page comparison (dataforseo_labs page_intersection) ──────────
export type IntersectionRow = { keyword: string; volume?: number | null; intent?: string | null; slots: Record<number, { url: string; rank: number }> };
export function pageIntersection(rows: IntersectionRow[]): ProviderEnvelope {
  return envelope([{ se_type: "google", location_code: 2840, language_code: "en", total_count: rows.length, items_count: rows.length, items: rows.map((r) => ({
    se_type: "google",
    keyword_data: { keyword: r.keyword, keyword_info: { search_volume: r.volume === undefined ? 500 : r.volume, competition: 0.2, competition_level: "LOW" },
      keyword_properties: { keyword_difficulty: 24 }, search_intent_info: { main_intent: r.intent === undefined ? "informational" : r.intent } },
    intersection_result: Object.fromEntries(Object.entries(r.slots).map(([slot, v]) => [slot, { type: "organic", rank_group: v.rank, rank_absolute: v.rank + 1, url: v.url, title: null }])),
  })) }]);
}
// ── a competitor page body (on_page/content_parsing/live) ────────────────────
export type PageBodyOver = { title?: string; h1?: string; paragraphs?: string[]; headings?: string[]; hasTable?: boolean };
export function competitorPageBody(over: PageBodyOver = {}): ProviderEnvelope {
  const paragraphs = over.paragraphs ?? [
    "A kite festival is a spring gathering where families fly hand made kites from dawn until dusk.",
    "Most festivals share three fixed moments: the dawn launch, a shared midday meal, and paper lanterns released after dark.",
    "Regional variations decide the kite shapes, the food on the table, and whether lanterns are floated or flown.",
  ];
  return envelope([{ crawl_progress: "finished", items_count: 1, items: [{ page_content: {
    main_topic: [{ h_title: over.h1 ?? "Kite festival traditions", main_title: over.title ?? "Kite Festival Traditions Explained", level: 1,
      primary_content: paragraphs.map((text) => ({ text, primary_content: true })),
      table_content: over.hasTable === false ? [] : [{ table_content: [["Region", "Kite"]] }] }],
    secondary_topic: (over.headings ?? ["What families bring", "When the lanterns go up"]).map((h) => ({ h_title: h, level: 2, primary_content: [{ text: `${h} is covered in a short section.` }], table_content: [] })),
  } }] }]);
}
/** A page NOTHING can be read from: the provider answered, the body did not. */
export const unreadablePageBody = (): ProviderEnvelope => envelope([{ crawl_progress: "finished", items_count: 1, items: [{ page_content: {} }] }]);
