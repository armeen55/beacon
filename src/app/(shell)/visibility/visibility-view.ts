/**
 * visibility-view - THE ANALYTICAL MODEL behind the one Visibility surface: pure functions over readings the kernels ALREADY took and stored, in and headline numbers, chart geometry and ranked tables out. Nothing here fetches, pays or triggers research.
 * THE RULES THAT DO NOT BEND: every rate names its numerator, its denominator and the days it was counted over; a denominator nobody has checked reports as unchecked and never as a zero; a missing day stays missing; Google and AI never add up into one score; no rank is ever invented; and nothing a machine wrote for itself (a timestamp, a mode key, a cache key, a model id) reaches a customer in that form.
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import type { AiOutcomeReport } from "@/domains/measurement";
import type { FanoutEvidence, OwnedPageAiRow } from "@/domains/evidence/ai-visibility/fanout-evidence";
import type { AnswerIntel, ClassifiedDomain, CompetitorKind, GscDecaySignal, GscPageSignal } from "@/domains/evidence";
// ── shared shapes (structural: the table and chart components infer them, so nothing extra is public) ─
/** ONE cell. `sort` is the number the column sorts on when the text is formatted, `tone` colours a change or marks a page of yours, `sub` is the second line that keeps a wide table from lying. */
type Cell = { text: string; sub?: string; tone?: "up" | "down" | "flat" | "own"; sort?: number; href?: string };
type Table = { columns: Array<{ key: string; label: string; numeric?: boolean; wide?: boolean }>;
  rows: Array<{ id: string; href?: string; cells: Cell[] }>; note: string | null; empty: string };
/** ONE headline number with the count it was computed over, and the change against the window before it. */
type Tile = { label: string; value: string; basis: string; delta: string | null; tone: "up" | "down" | "flat" };

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const pct = (n: number): string => `${n > 0 && n < 0.1 ? (n * 100).toFixed(1) : Math.round(n * 100)}%`;
/** A change in a RATE is stated in points, never as a percent of a percent: "down 1%" on a click rate that fell from 1.4 to 1.3 is a sentence nobody can act on. Null with no window before this one. */
const points = (now: number | null, prior: number | null): Pick<Tile, "delta" | "tone"> =>
  now == null || prior == null ? { delta: null, tone: "flat" }
    : Math.abs(now - prior) * 100 < 0.05 ? { delta: "even", tone: "flat" }
      : { delta: `${now > prior ? "+" : ""}${((now - prior) * 100).toFixed(1)} points`, tone: now > prior * 1.02 ? "up" : now < prior * 0.98 ? "down" : "flat" };
const rate = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);
const shortUrl = (raw: string): string => (raw ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
/** A CHANGE IS A CHANGE, and "no window before this one" is not a flat one. */
const delta = (now: number, prior: number): Pick<Tile, "delta" | "tone"> => prior <= 0 ? { delta: null, tone: "flat" }
  : { delta: `${now > prior ? "+" : ""}${Math.round(((now - prior) / prior) * 100)}%`,
    tone: now > prior * 1.02 ? "up" : now < prior * 0.98 ? "down" : "flat" };
const change = (now: number, prior: number): Cell => ({ sort: now - prior, tone: now > prior ? "up" : now < prior ? "down" : "flat",
  text: prior === 0 && now === 0 ? "even" : `${now - prior > 0 ? "+" : ""}${num(now - prior)}` });
const table = (over: Partial<Table> & Pick<Table, "columns" | "empty">): Table => ({ rows: [], note: null, ...over });
/** A READ THAT DID NOT LAND IS NOT AN EMPTY ACCOUNT. A bare empty list told an account with seven hundred stored answers that not one had ever been read, the worst lie this surface could tell. It claims nothing about collection either: every stored answer stays exactly where it is whether the daily round is on or off. */
const UNREAD = "That could not be read back in time just now. Nothing is lost: the stored answers are safe and this fills in on the next visit.";

const ENGINE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude" };
const engineName = (raw: string): string => ENGINE_LABEL[(raw || "").toLowerCase()] ?? "An AI assistant";
/** HOW an answer was asked for, in words. The mode key is what a provider is called with, never what a customer reads. */
const MODE_LABEL: Record<string, string> = { api: "asked directly", consumer_search: "asked the way a person searching would be" };
/** AN INSTANT A STRANGER CAN READ: "Aug 2 at 4:02 PM UTC". A stored timestamp is never printed as it was written. */
const instant = (iso: string | null): string | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? `${new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).replace(", ", " at ")} UTC` : null;
};
/** THE TAIL OF A STORED RECEIPT KEY, and never an empty string: a key that ends in its separator has no tail, so the whole key stands in rather than printing "Stored answer receipt ." at a customer. */
const receiptTail = (key: string): string => {
  const tail = key.split(":").pop() ?? "";
  return (tail.trim() ? tail : key).slice(0, 8);
};
/** Plain English for the eight groups a recurring domain lands in. */
const KIND_LABEL: Record<CompetitorKind, string> = { commercial_competitor: "A competitor", citation_authority: "A source",
  publisher: "A publisher", marketplace_directory: "A marketplace", social_community: "A social platform",
  government_educational: "A government or school site", owned: "Your own site", irrelevant_unknown: "Not settled yet" };
// ── Google ───────────────────────────────────────────────────────────────────────────────────────

type GoogleInput = {
  /** Reported days, oldest first, straight off Search Console's own totals. */
  days: Array<{ date: string; clicks: number; impressions: number }>;
  rangeDays: number; metric: "clicks" | "impressions" | "ctr"; decay: GscDecaySignal[]; pages: ReadonlyMap<string, GscPageSignal> };

const METRIC_LABEL: Record<GoogleInput["metric"], string> = { clicks: "Clicks", impressions: "Appearances", ctr: "Click rate" };
/** WHERE GOOGLE HAS YOU, as numbers a stranger can act on. `limitation` is set only when Search Console never reported a day: the view then says what it cannot show and where to fix it. */
export function googleView(input: GoogleInput) {
  if (input.days.length === 0) {
    return { limitation: "No Search Console numbers are on file for this account, so clicks, appearances, and rankings cannot be shown here. Connect Google Search Console on Connections and this fills in on the next daily round.", tiles: [] as Tile[], chart: null, pages: null, queries: null, watermark: "", coverage: "" };
  }
  const span = Math.min(input.rangeDays, input.days.length);
  const now = input.days.slice(-span), prior = input.days.slice(Math.max(0, input.days.length - span * 2), input.days.length - span);
  const sum = (rows: typeof now, k: "clicks" | "impressions") => rows.reduce((a, d) => a + d[k], 0);
  const [c, i, pc, pi] = [sum(now, "clicks"), sum(now, "impressions"), sum(prior, "clicks"), sum(prior, "impressions")];
  // A SITE WITH CLICKS HAS PAGES: coming back with none of them means the read did not land, and "Google has not reported a page yet" about an account with two thousand clicks is a plain untruth.
  const noPages = input.decay.length === 0 && c > 0, noQueries = input.pages.size === 0 && c > 0;
  const through = monthDayLabel(input.days[input.days.length - 1]?.date ?? null);
  const before = prior.length === span ? `against ${num(pc)} over the ${num(span)} days before` : "no full window before this one to compare against";
  // AVERAGE POSITION IS THE ONE NUMBER GOOGLE'S DAILY TOTALS DO NOT CARRY, so it is weighted by appearances off the per page windows and SAYS SO: quoting it under the range picker would claim a window it was never measured on.
  const seen = input.decay.filter((r) => r.impressionsNow > 0), seenPrior = input.decay.filter((r) => r.impressionsPrior > 0);
  const weigh = (rows: GscDecaySignal[], p: "positionNow" | "positionPrior", im: "impressionsNow" | "impressionsPrior"): number | null => rows.reduce((a, r) => a + r[im], 0) > 0 ? rows.reduce((a, r) => a + r[p] * r[im], 0) / rows.reduce((a, r) => a + r[im], 0) : null;
  const posNow = weigh(seen, "positionNow", "impressionsNow"), posPrior = weigh(seenPrior, "positionPrior", "impressionsPrior");
  const windowEnd = monthDayLabel(input.decay[0]?.windowNowEnd ?? null);
  const tiles: Tile[] = [
    { label: "Clicks", value: num(c), basis: `over the last ${num(span)} reported days, ${before}`, ...delta(c, pc) },
    { label: "Appearances", value: num(i), basis: `times a page of yours was shown, ${prior.length === span ? `against ${num(pi)} the ${num(span)} days before` : "no full window before this one"}`, ...delta(i, pi) },
    { label: "Click rate", value: i > 0 ? pct(c / i) : "not yet", basis: i > 0 ? `${num(c)} clicks out of ${num(i)} appearances` : "no appearances reported in this window", ...points(i > 0 ? c / i : null, pi > 0 ? pc / pi : null) },
    { label: "Average position", value: posNow == null ? "not yet" : posNow.toFixed(1),
      basis: posNow == null ? (noPages ? UNREAD : "no page of yours was shown in the last 28 days") : `weighted by appearances across ${num(seen.length)} pages over the 28 days${windowEnd ? ` ending ${windowEnd}` : ""}, which is the only window Google reports per page`,
      delta: posNow != null && posPrior != null ? `${posNow < posPrior ? "" : "+"}${(posNow - posPrior).toFixed(1)}` : null,
      tone: posNow != null && posPrior != null ? (posNow < posPrior - 0.1 ? "up" : posNow > posPrior + 0.1 ? "down" : "flat") : "flat" },
  ];
  const value = (d: { clicks: number; impressions: number }): number => input.metric === "clicks" ? d.clicks : input.metric === "impressions" ? d.impressions : d.impressions > 0 ? d.clicks / d.impressions : 0;
  const chart = { label: METRIC_LABEL[input.metric], percent: input.metric === "ctr", points: now.map((d) => ({ day: d.date, label: monthDayLabel(d.date) ?? d.date, value: value(d) })),
    prior: prior.length === span ? prior.map((d) => value(d)) : null, priorLabel: prior.length === span ? `the ${num(span)} days before` : null };
  // EVERY PAGE THAT MOVED, not a top five. A page losing ground is the whole point of this table, so the list is complete and scrolls; slicing it is how a decline hides.
  const moved = input.decay.filter((r) => r.page && (r.clicksNow > 0 || r.clicksPrior > 0 || r.impressionsNow > 0));
  const losing = moved.filter((r) => r.clicksNow < r.clicksPrior).length;
  const pages = table({
    columns: [{ key: "page", label: "Page", wide: true }, { key: "clicks", label: "Clicks", numeric: true }, { key: "clicksChange", label: "Change", numeric: true },
      { key: "impressions", label: "Appearances", numeric: true }, { key: "impressionsChange", label: "Change", numeric: true },
      { key: "ctr", label: "Click rate", numeric: true }, { key: "position", label: "Position", numeric: true }, { key: "query", label: "Strongest search, 90 days", wide: true }],
    empty: noPages ? UNREAD : "Google has not reported a page for this account yet. The next daily round picks them up.",
    note: moved.length === 0 ? null : `Each page compares the 28 days${windowEnd ? ` ending ${windowEnd}` : ""} with the 28 days before them. ${losing > 0 ? `${num(losing)} ${losing === 1 ? "page is" : "pages are"} losing clicks, marked in the change column. The fix for one of them lives in Changes.` : "Not one page is losing clicks in this window."}`,
    rows: [...moved].sort((a, b) => b.clicksNow - a.clicksNow).map((r) => {
      const sig = input.pages.get(r.page), top = sig?.topQueries[0] ?? null;
      const ctr = rate(r.clicksNow, r.impressionsNow);
      return { id: r.page, cells: [
        { text: shortUrl(r.page), sub: r.clicksNow < r.clicksPrior ? "losing ground" : undefined, tone: r.clicksNow < r.clicksPrior ? "down" as const : undefined },
        { text: num(r.clicksNow), sort: r.clicksNow }, change(r.clicksNow, r.clicksPrior),
        { text: num(r.impressionsNow), sort: r.impressionsNow }, change(r.impressionsNow, r.impressionsPrior),
        { text: ctr == null ? "not yet" : pct(ctr), sort: ctr ?? -1 },
        { text: r.positionNow > 0 ? r.positionNow.toFixed(1) : "not ranked", sub: r.positionNow > 0 && r.positionPrior > 0 ? `was ${r.positionPrior.toFixed(1)}` : undefined, sort: r.positionNow > 0 ? r.positionNow : 999 },
        { text: top ? top.query : "no search named yet", sub: top ? `${num(top.clicks)} ${top.clicks === 1 ? "click" : "clicks"} at ${top.position.toFixed(1)}` : undefined },
      ] };
    }),
  });
  // THE SEARCHES THEMSELVES, off the same 90 reported days the page rows carry. One row is one search on one page: that is the grain Google reports, and merging them would invent a position nobody measured.
  const seenQueries = [...input.pages.entries()].flatMap(([page, sig]) => sig.topQueries.map((q) => ({ page, ...q })));
  const QUERY_CAP = 150;
  const queries = table({
    columns: [{ key: "query", label: "Search", wide: true }, { key: "page", label: "Page it lands on", wide: true }, { key: "clicks", label: "Clicks", numeric: true }, { key: "impressions", label: "Appearances", numeric: true }, { key: "ctr", label: "Click rate", numeric: true }, { key: "position", label: "Position", numeric: true }],
    empty: noQueries ? UNREAD : "Google has not named a single search for this account yet. It hides the rarest ones, and the next daily round picks up the rest.",
    note: seenQueries.length === 0 ? null : `These are the searches Google named over the last 90 reported days, strongest first${seenQueries.length > QUERY_CAP ? `. Showing the top ${num(QUERY_CAP)} of ${num(seenQueries.length)}` : ""}. Google hides its rarest searches, so this is what it reports and not every search you ever won.`,
    rows: [...seenQueries].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, QUERY_CAP).map((q, n) => ({
      id: `${q.page}|${q.query}|${n}`, cells: [
        { text: q.query }, { text: shortUrl(q.page) }, { text: num(q.clicks), sort: q.clicks }, { text: num(q.impressions), sort: q.impressions },
        { text: q.impressions > 0 ? pct(q.clicks / q.impressions) : "not yet", sort: q.impressions > 0 ? q.clicks / q.impressions : -1 },
        { text: q.position > 0 ? q.position.toFixed(1) : "not ranked", sort: q.position > 0 ? q.position : 999 },
      ] })),
  });

  return { limitation: null, tiles, chart, pages, queries,
    coverage: `${num(input.days.length)} reported days on file, showing the last ${num(span)}.`,
    watermark: `Search Console, through ${through ?? "a day it has not named"}. Google reports a few days behind, so the newest days are still settling.` };
}
// ── AI answers ───────────────────────────────────────────────────────────────────────────────────
/** ONE stored answer flattened by the page. The tri-state survives end to end: a reading nobody has taken reports null, not false, and an engine that never said which pages it used reports null, not "nobody". */
export type AnswerRow = {
  id: string; day: string; promptId: string; promptText: string; engine: string; slot: number; answered: boolean;
  mentioned: boolean | null; position: number | null; cited: boolean | null; fanOuts: string[] | null;
  citations: Array<{ url: string; domain: string; owned: boolean; passage?: string }> | null;
  retrievedNotCited: string[] | null; competitors: string[];
  answerText: string | null;
  modelRequested: string | null; modelServed: string | null; mode: string | null; askedAt: string | null;
  answeredAt: string | null; receipt: string | null; costUsd: number | null; failureReason: string | null;
  /** Whether the assistant said it searched the web before answering. Null = it never said either way. */
  webSearched: boolean | null;
  /** read = every word read closely. part = some of it. checked = only the deterministic look for this account's own name settled it, a check and not a reading. unread = nobody has looked. */
  reading: "read" | "part" | "checked" | "unread";
};
type AiInput = {
  /** Null = the daily read did not land, which is a different claim from an account with no answers. */
  segments: AiOutcomeReport["segments"] | null;
  rangeDays: number; engine: string | null; sub: "prompts" | "citations" | "searches" | "pages";
  checks: { done?: number; total?: number; answered?: number; unavailable?: number; unsupported?: number }; // today's planned round
  /** IS THE RESEARCH ALIVE, in the run's own words: what the last pass produced and when, or how long it has been and what to press. Null only when that could not be read, and then nothing is claimed either way. */
  liveness?: string | null;
  /** THE OPERATOR'S OWN OFF SWITCH, read at load. A page that says checks are planned for today over an account whose collection is switched off is a plain untruth, and "unreadable" is a third state that claims neither. */
  collecting?: "paused" | "running" | "unreadable" | null;
  /** The newest day that holds readings and every reading on it: the searches the assistants ran and the pages they credited live only on this shape, so both subviews name that one day out loud. */
  day: string | null; dayRows: AnswerRow[] | null;
  /** Every canonical reading over the window, lean (no answer text, no journey): what the question table counts, and what the window before it is compared against. */
  window: AnswerRow[] | null;
  landscape: ClassifiedDomain[] | null; intel: AnswerIntel | null;
  /** THE one derived fan-out projection over the WHOLE range, built by the same pure function Decision reads,
   *  so the counts here and the counts behind a Change can never disagree. Null = the window read fell over. */
  fanouts: FanoutEvidence | null;
  /** The canonical keys of every tracked question in the window, so a recurring fan-out no question covers can be named as one worth tracking. */
  trackedKeys: readonly string[] | null;
  /** The owned pages' AI standing over the same window, from the same rows. */
  ownedPageRollup: OwnedPageAiRow[] | null;
  /** The one question opened, with every reading of it I hold. */
  focus: { promptId: string; rows: AnswerRow[] } | null;
};
/** A FAN-OUT IS WHAT THE ASSISTANT WENT AND SEARCHED FOR, NEVER WHAT IT WAS ASKED: a tracked question sitting in that list reads as the assistant's own idea, so every reader of one goes through here. */
const fanOutsExcluding = (fanOuts: readonly string[], asked: readonly string[]): string[] => {
  const same = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const mine = new Set(asked.map(same));
  return [...new Set(fanOuts.map((q) => q.trim()).filter(Boolean))].filter((q) => !mine.has(same(q)));
};
/** WHERE AI ANSWERS HAVE YOU. `empty` is set when nothing has been read at all, so the view says so rather than showing a wall of honest looking zeros. */
export function aiView(input: AiInput) {
  const days = (input.segments ?? []).flatMap((s) => s.days);
  const dayRows = input.dayRows ?? [], windowRows = input.window ?? [];
  // ONE SUBSECTION THAT DID NOT LAND IS NOT AN EMPTY ACCOUNT: the trend, the last day read and the window are three separate reads on three separate deadlines, so losing one narrows this tab to the other two, and the whole page collapses only when all three came back with nothing at all.
  if (days.length === 0 && dayRows.length === 0 && windowRows.length === 0) {
    return { empty: input.segments == null || input.dayRows == null || input.window == null ? UNREAD : "Not one AI answer is stored for this account yet. This fills in from the first answer that lands.",
      tiles: [] as Tile[], chart: null, coverage: "", watermark: "", prompts: null, citations: null, searches: null, ownedPages: null, promptIdeas: null, intel: null, retrieval: null, byEngine: null,
      detail: null, engines: [] as Array<{ id: string; label: string }>, boundaries: [] as string[] };
  }
  // WITHOUT THE TREND THERE IS NO RATE AND NO LINE. Every headline number divides by days that read did not bring back, so the tiles, the chart and the per assistant table go away rather than printing honest looking zeros over them; the question, citation and search tables are read off their own rows and stay.
  const trend = days.length > 0;
  const span = Math.min(input.rangeDays, days.length || input.rangeDays);
  const now = days.slice(-span), prior = days.slice(Math.max(0, days.length - span * 2), days.length - span);
  const pool = (rows: typeof now, k: "observed" | "analyzed" | "mentioning" | "citationSample" | "ownedCiting" | "ownedRetrieved" | "retrievedNotCited") => rows.reduce((a, d) => a + d[k], 0);
  const [observed, analyzed, mentioning, citeSample, ownedCiting, opened, passedOver] = (["observed", "analyzed", "mentioning", "citationSample", "ownedCiting", "ownedRetrieved", "retrievedNotCited"] as const).map((k) => pool(now, k));
  const mentionRate = rate(mentioning, analyzed), priorMention = rate(pool(prior, "mentioning"), pool(prior, "analyzed")),
    citeRate = rate(ownedCiting, citeSample), priorCite = rate(pool(prior, "ownedCiting"), pool(prior, "citationSample"));
  // CITATION SHARE, ONE VOTE PER ANSWER: an answer that credits the same domain five times is still one answer saying that domain's name, so counting links would sell a chatty citation style as authority.
  const votes = new Map<string, { answers: number; prompts: Set<string>; engines: Set<string>; owned: boolean; pages: Map<string, number> }>();
  for (const r of dayRows) for (const d of new Set((r.citations ?? []).map((c) => c.domain))) {
    const held = votes.get(d) ?? { answers: 0, prompts: new Set<string>(), engines: new Set<string>(), owned: (r.citations ?? []).some((c) => c.domain === d && c.owned), pages: new Map<string, number>() };
    held.answers += 1; held.prompts.add(r.promptText); held.engines.add(r.engine); votes.set(d, held);
    for (const c of (r.citations ?? []).filter((c) => c.domain === d)) held.pages.set(c.url, (held.pages.get(c.url) ?? 0) + 1);
  }
  const allVotes = [...votes.values()].reduce((a, v) => a + v.answers, 0);
  const myVotes = [...votes.entries()].filter(([, v]) => v.owned).reduce((a, [, v]) => a + v.answers, 0);
  const cut = now[0]?.day ?? "", dayLabel = monthDayLabel(input.day);
  const placed = windowRows.filter((r) => r.day >= cut && r.position != null).map((r) => r.position!);
  const tiles: Tile[] = !trend ? [] : [
    { label: "Answers that name you", value: mentionRate == null ? "not checked yet" : pct(mentionRate),
      basis: mentionRate == null ? `${num(observed)} answers are on file and none of them are checked yet` : `${num(mentioning)} of the ${num(analyzed)} answers finished checking over ${num(span)} days`, ...points(mentionRate, priorMention) },
    { label: "Answers crediting a page of yours", value: citeRate == null ? "not reported" : pct(citeRate),
      basis: citeRate == null ? "not one answer in this window reported which pages it used" : `${num(ownedCiting)} of the ${num(citeSample)} answers that reported what they used`, ...points(citeRate, priorCite) },
    { label: "Your share of everything credited", value: allVotes > 0 ? pct(myVotes / allVotes) : "not reported", delta: null, tone: "flat",
      basis: allVotes > 0 ? `${num(myVotes)} of the ${num(allVotes)} times an answer credited any site${dayLabel ? ` on ${dayLabel}` : ""}, counting one vote per answer` : "no answer named the pages it used on the last day read" },
    { label: "Where you land in the answer", value: placed.length > 0 ? `${(placed.reduce((a, p) => a + p, 0) / placed.length).toFixed(1)}` : "not reported", delta: null, tone: "flat",
      basis: placed.length > 0 ? `average place across the ${num(placed.length)} answers over ${num(span)} days that reported where you sat, best was ${num(Math.min(...placed))}` : `no answer in the last ${num(span)} days reported where in it you sat` },
    { label: "Answers checked", value: observed > 0 ? pct(analyzed / observed) : "nothing yet",
      basis: observed > 0 ? `${num(analyzed)} of the ${num(observed)} answers collected over ${num(span)} days. Every rate above divides by what was checked, never by what was collected` : "nothing came back in this window",
      delta: null, tone: analyzed >= observed && observed > 0 ? "up" : "flat" },
  ];
  // READ AND PASSED OVER: the assistant opened a page of yours and credited somebody else for the answer. The claim needs BOTH halves reported, so the denominator is the answers that opened your page, never every answer.
  const missRate = rate(passedOver, opened);
  const retrieval = opened === 0 || missRate == null ? null : { value: pct(missRate),
    basis: `${num(passedOver)} of the ${num(opened)} answers that opened a page of yours over the last ${num(span)} days credited somebody else instead, or nobody at all`,
    next: "Those pages were worth reading and not worth quoting. Rewrite one so an answer can lift a line straight out of it." };
  // THE TREND, per day, over the assistants asked for. A day nobody checked is a HOLE in the line, never a zero.
  const enginesSeen = [...new Set(trend ? days.flatMap((d) => d.byEngine.map((e) => e.engine)) : [...windowRows, ...dayRows].map((r) => r.engine))].sort();
  const forEngine = (d: typeof now[number]): { top: number; bottom: number } => input.engine == null
    ? { top: d.mentioning, bottom: d.analyzed }
    : d.byEngine.filter((e) => e.engine === input.engine).reduce((a, e) => ({ top: a.top + e.mentioning, bottom: a.bottom + e.analyzed }), { top: 0, bottom: 0 });
  const chart = !trend ? null : { label: input.engine ? `Answers from ${engineName(input.engine)} that name you` : "Answers that name you", percent: true,
    points: now.map((d) => { const { top, bottom } = forEngine(d); return { day: d.day, label: monthDayLabel(d.day) ?? d.day, value: bottom > 0 ? top / bottom : null }; }),
    prior: prior.length === span ? prior.map((d) => { const { top, bottom } = forEngine(d); return bottom > 0 ? top / bottom : null; }) : null,
    priorLabel: prior.length === span ? `the ${num(span)} days before` : null };
  // EVERY ASSISTANT SIDE BY SIDE, so four filters do not have to be clicked one at a time and held in your head.
  const byEngine = !trend ? null : table({
    columns: [{ key: "engine", label: "Assistant", wide: true }, { key: "named", label: "Named you", numeric: true }, { key: "credited", label: "Credited a page of yours", numeric: true }, { key: "checked", label: "Answers checked", numeric: true }],
    empty: "No assistant has answered for this account yet.",
    note: `Counted over the last ${num(span)} days. Each assistant divides by its own checked answers, so a slower one never drags another one down.`,
    // An assistant asked nothing in the window renders nothing: a row of zeros is the bare-zero lie.
    rows: enginesSeen.filter((e) => now.some((d) => d.byEngine.some((x) => x.engine === e && x.asked > 0))).map((e) => {
      const seen = now.flatMap((d) => d.byEngine.filter((x) => x.engine === e));
      const add = (k: "asked" | "analyzed" | "mentioning" | "citedOwned") => seen.reduce((a, x) => a + x[k], 0);
      const [asked, checked, named, credited] = [add("asked"), add("analyzed"), add("mentioning"), add("citedOwned")], r0 = rate(named, checked);
      return { id: e, cells: [{ text: engineName(e) },
        { text: r0 == null ? "not checked yet" : pct(r0), sub: r0 == null ? undefined : `${num(named)} of ${num(checked)} checked`, sort: r0 ?? -1, tone: r0 != null && r0 > 0 ? "own" as const : undefined },
        { text: num(credited), sub: `${credited === 1 ? "answer" : "answers"} crediting a page of yours`, sort: credited },
        // asked counts distinct prompts PER DAY, so a sum across days is asks, never questions.
        { text: num(checked), sub: `asked ${num(asked)} times over ${num(span)} days`, sort: checked }] };
    }),
  });
  const boundaries = (input.segments ?? []).flatMap((s) => s.boundary ?? []).map((b) =>
    `${engineName(b.engine)} ${b.fromMode !== b.toMode ? "started answering a different way" : "changed the version behind its answers"} on ${monthDayLabel(b.day) ?? b.day}, so the line before and after it was read on different instruments.`);
  // ── the question table: one row per tracked question, counted over ITS OWN readings ──
  const byPrompt = new Map<string, { text: string; engines: Set<string>; answered: number; analyzed: number; mentioning: number;
    positions: number[]; competitors: Map<string, number>; last: string; priorAnalyzed: number; priorMentioning: number }>();
  for (const r of windowRows) {
    const held = byPrompt.get(r.promptId) ?? { text: r.promptText, engines: new Set<string>(), answered: 0, analyzed: 0, mentioning: 0,
      positions: [], competitors: new Map<string, number>(), last: "", priorAnalyzed: 0, priorMentioning: 0 };
    const inWindow = r.day >= cut;
    if (r.answered) held.engines.add(r.engine);
    if (inWindow) {
      if (r.answered) held.answered += 1;
      if (r.mentioned != null) { held.analyzed += 1; if (r.mentioned) held.mentioning += 1; }
      if (r.position != null) held.positions.push(r.position);
      for (const c of r.competitors) held.competitors.set(c, (held.competitors.get(c) ?? 0) + 1);
      if (r.day > held.last) held.last = r.day;
    } else if (r.mentioned != null) { held.priorAnalyzed += 1; if (r.mentioned) held.priorMentioning += 1; }
    byPrompt.set(r.promptId, held);
  }
  const searchesOf = (promptId: string): number => new Set(dayRows.filter((r) => r.promptId === promptId).flatMap((r) => fanOutsExcluding(r.fanOuts ?? [], [r.promptText]))).size;
  const citedOf = (promptId: string): { owned: number; reported: number; top: string | null } => {
    const rows = dayRows.filter((x) => x.promptId === promptId), tally = new Map<string, number>();
    for (const r of rows) for (const d of new Set((r.citations ?? []).map((c) => c.domain))) tally.set(d, (tally.get(d) ?? 0) + 1);
    return { owned: rows.filter((r) => r.cited === true).length, reported: rows.filter((r) => r.cited != null).length, top: [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
  };
  const prompts = table({
    columns: [{ key: "question", label: "Question asked for you", wide: true }, { key: "engines", label: "Assistants", numeric: true },
      { key: "named", label: "Named you", numeric: true }, { key: "changed", label: "Change", numeric: true },
      { key: "credited", label: `Credited a page of yours, ${dayLabel ?? "the last day read"}`, numeric: true }, { key: "place", label: "Place in answer", numeric: true },
      { key: "rival", label: "Strongest rival named", wide: true }, { key: "searches", label: `Searches it ran, ${dayLabel ?? "the last day read"}`, numeric: true },
      { key: "last", label: "Last read", numeric: true }],
    empty: input.window == null ? UNREAD : "No reading for a tracked question is stored in this window yet.",
    note: byPrompt.size === 0 ? null : `One row is one question put to every assistant, counted over the last ${num(span)} days, except the two columns that name ${dayLabel ?? "the last day read"}: what an assistant credited and what it searched for are read off that one day. Open a row for every reading behind it, and a question not finished checking says so rather than reporting a zero.`,
    rows: [...byPrompt.entries()].sort((a, b) => (rate(b[1].mentioning, b[1].analyzed) ?? -1) - (rate(a[1].mentioning, a[1].analyzed) ?? -1)).map(([id, p]) => {
      const r0 = rate(p.mentioning, p.analyzed), rPrior = rate(p.priorMentioning, p.priorAnalyzed);
      const rival = [...p.competitors.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
      const cite = citedOf(id), searches = searchesOf(id);
      return { id, href: `?view=ai&prompt=${encodeURIComponent(id)}`, cells: [
        { text: p.text, sub: `${num(p.answered)} ${p.answered === 1 ? "answer" : "answers"} in hand` },
        { text: p.engines.size > 0 ? num(p.engines.size) : "none answered", sort: p.engines.size },
        { text: r0 == null ? "not checked" : pct(r0), sub: r0 == null ? `${num(p.answered)} on file` : `${num(p.mentioning)} of ${num(p.analyzed)} checked`, sort: r0 ?? -1 },
        { text: r0 == null || rPrior == null ? "no window before" : `${r0 > rPrior ? "+" : ""}${Math.round((r0 - rPrior) * 100)} points`, sort: r0 != null && rPrior != null ? r0 - rPrior : -99,
          tone: r0 == null || rPrior == null ? "flat" : r0 > rPrior + 0.02 ? "up" : r0 < rPrior - 0.02 ? "down" : "flat" },
        { text: cite.reported === 0 ? "never reported" : `${num(cite.owned)} of ${num(cite.reported)}`, sort: cite.reported > 0 ? cite.owned / cite.reported : -1,
          sub: cite.top ? `${cite.top} is credited most` : undefined, tone: cite.owned > 0 ? "own" : undefined },
        { text: p.positions.length > 0 ? (p.positions.reduce((a, x) => a + x, 0) / p.positions.length).toFixed(1) : "not reported", sort: p.positions.length > 0 ? p.positions.reduce((a, x) => a + x, 0) / p.positions.length : 999 },
        { text: rival ? rival[0] : "none named", sub: rival ? `named in ${num(rival[1])} ${rival[1] === 1 ? "answer" : "answers"}` : undefined, sort: rival ? rival[1] : 0 },
        { text: num(searches), sort: searches },
        { text: p.last ? monthDayLabel(p.last) ?? p.last : "never", sort: p.last ? Number(p.last.replace(/-/g, "")) : 0 },
      ] };
    }),
  });
  // ── every page and domain the answers credited, on the day I read last ──
  const citations = table({
    columns: [{ key: "domain", label: "Site the answers credited", wide: true }, { key: "kind", label: "What it is", wide: true },
      { key: "answers", label: "Answers crediting it", numeric: true }, { key: "questions", label: "Questions", numeric: true },
      { key: "share", label: "Share of everything credited", numeric: true }, { key: "engines", label: "Assistants", numeric: true },
      { key: "page", label: "Page it credited most", wide: true }],
    empty: input.dayRows == null ? UNREAD : "Not one answer on the last day read reported which pages it used, so there is no claim that it credited nobody.",
    note: votes.size === 0 ? null : `Every site the assistants credited${dayLabel ? ` on ${dayLabel}` : ""}, counting one vote per answer so a chatty answer cannot outvote the rest. ${num(allVotes)} votes across ${num(votes.size)} sites.`,
    rows: [...votes.entries()].sort((a, b) => b[1].answers - a[1].answers).map(([domain, v]) => {
      const kind = input.landscape?.find((l) => l.domain === domain)?.kind ?? null;
      const page = [...v.pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { id: domain, cells: [
        { text: domain, tone: v.owned ? "own" as const : undefined },
        { text: v.owned ? "Your own site" : kind ? KIND_LABEL[kind] : "Not settled yet" },
        { text: num(v.answers), sort: v.answers },
        { text: num(v.prompts.size), sort: v.prompts.size, sub: [...v.prompts].slice(0, 2).join(" / ") },
        { text: allVotes > 0 ? pct(v.answers / allVotes) : "not yet", sort: v.answers },
        { text: [...v.engines].map(engineName).join(", "), sort: v.engines.size },
        { text: page ? shortUrl(page) : "no page named" },
      ] };
    }),
  });
  // ── QUERY FAN-OUTS: the searches the assistants ran, over the WHOLE window. The latest day is a sample,
  // never a trend: recurrence is DISTINCT days, assistants and parent questions, counted by the same pure
  // function Decision reads, so this table and the queue can never disagree (operator, 2026-08-19).
  const FANOUT_ROWS_SHOWN = 100;
  const fe = input.fanouts;
  const ownLabel = (r: { ownState: string; ownCitedAnswers: number; retrievedNotCitedAnswers: number; reportingAnswers: number }): string =>
    r.ownState === "cited" ? `credited in ${num(r.ownCitedAnswers)} of ${num(r.reportingAnswers)}`
      : r.ownState === "retrieved_not_cited" ? `read and passed over, ${num(r.retrievedNotCitedAnswers)}x`
        : r.ownState === "not_retrieved" ? "never you" : "sources unreported";
  const searches = table({
    columns: [{ key: "query", label: "What the assistant searched for", wide: true },
      { key: "days", label: "Days it recurred", numeric: true }, { key: "times", label: "Answers that ran it", numeric: true },
      { key: "engines", label: "Assistants", numeric: true }, { key: "own", label: "Where you stood", wide: true },
      { key: "rival", label: "Top rival credited", wide: true }, { key: "prompts", label: "Tracked questions behind it", wide: true }],
    empty: fe == null ? UNREAD : "None of the assistants reported what they searched for over this window, so whether they searched at all is unknown.",
    note: fe == null || fe.rows.length === 0 ? null
      : `The searches an AI assistant ran while answering your tracked questions, over the last ${num(span)} days (${num(fe.reportingAnswers)} of ${num(fe.answers)} readings reported them). ${fe.rows.length > FANOUT_ROWS_SHOWN ? `Showing the ${num(FANOUT_ROWS_SHOWN)} most recurring of ${num(fe.rows.length)} distinct searches; the rest are on file, not gone. ` : `All ${num(fe.rows.length)} distinct searches are shown. `}A tracked question is never listed here as a search the assistant thought of.`,
    rows: (fe?.rows ?? []).slice(0, FANOUT_ROWS_SHOWN).map((r) => ({ id: r.key, cells: [
      { text: r.query, sub: r.material ? undefined : "seen once; watched, not yet work" },
      { text: num(r.days), sort: r.days }, { text: num(r.executions), sort: r.executions },
      { text: r.engines.map(engineName).join(", "), sort: r.engines.length },
      { text: ownLabel(r), tone: r.ownState === "cited" ? "own" : undefined, sort: r.ownCitedAnswers },
      { text: r.rivalPages[0] ? shortUrl(r.rivalPages[0].url) : "none reported", sub: r.rivalPages[0] ? `in ${num(r.rivalPages[0].answers)} answers` : undefined, sort: r.rivalPages[0]?.answers ?? 0 },
      { text: r.parents.slice(0, 2).map((p) => p.promptText).join(" / "), sub: r.parents.length > 2 ? `and ${num(r.parents.length - 2)} more` : undefined, sort: r.parents.length },
    ] })),
  });
  // ── QUESTIONS WORTH TRACKING: the searches assistants keep running that NO tracked question covers. The
  // portfolio panel stays stable; these are recommendations read straight off the same recurrence rows, and
  // recurrence, a rival taking the credit, or this site being read for it is what earns a line here. ──
  const tracked = new Set(input.trackedKeys ?? []);
  const promptIdeas = fe == null || input.trackedKeys == null ? null
    : fe.rows.filter((r) => r.material && !tracked.has(r.key) && r.ownState !== "cited").slice(0, 5)
      .map((r) => ({ text: r.query,
        basis: `ran on ${num(r.days)} ${r.days === 1 ? "day" : "days"} across ${num(r.engines.length)} ${r.engines.length === 1 ? "assistant" : "assistants"}; no tracked question covers it${r.ownState === "retrieved_not_cited" ? ", and your page was read for it" : r.rivalPages[0] ? `, and ${shortUrl(r.rivalPages[0].url)} takes the credit` : ""}` }));
  // ── PAGES: each owned page's AI standing over the same window, from the same rows. ──
  const ownedPages = table({
    columns: [{ key: "page", label: "Your page", wide: true }, { key: "cited", label: "Credited", numeric: true }, { key: "retrieved", label: "Read", numeric: true }, { key: "rnc", label: "Read, passed over", numeric: true }, { key: "engines", label: "Assistants", numeric: true }, { key: "prompts", label: "Questions", numeric: true }, { key: "days", label: "Days", numeric: true }],
    empty: input.ownedPageRollup == null ? UNREAD : "No answer in this window reported reading or crediting a page of yours.",
    note: (input.ownedPageRollup ?? []).length === 0 ? null : `Every page of yours an assistant reported reading or crediting over the last ${num(span)} days. "Read, passed over" is the page that was good enough to open and not good enough to quote: the clearest change to make.`,
    rows: (input.ownedPageRollup ?? []).map((r) => ({ id: r.url, cells: [ { text: shortUrl(r.url), tone: "own" as const }, { text: num(r.cited), sort: r.cited }, { text: num(r.retrieved), sort: r.retrieved }, { text: num(r.retrievedNotCited), sort: r.retrievedNotCited }, { text: num(r.engines.length), sort: r.engines.length }, { text: num(r.prompts), sort: r.prompts }, { text: num(r.days), sort: r.days }, ] })),
  });
  const parts = [...(typeof input.checks.answered === "number" ? [`${num(input.checks.answered)} came back with an answer`] : []), ...(input.checks.unavailable ? [`${num(input.checks.unavailable)} came back with nothing`] : []), ...(input.checks.unsupported ? [`${num(input.checks.unsupported)} cannot be asked at all today`] : [])];
  const read = days.filter((d) => d.observed > 0);
  const gaps = days.filter((d) => d.observed === 0 && read[0] && d.day >= read[0].day).map((d) => monthDayLabel(d.day) ?? d.day);
  // THE PERIOD, WHAT COVERED IT, AND EVERY HOLE IN IT, dated and counted: the stretch, how many questions and assistants stand behind it, the days that came back with nothing, the newest day when it holds less than the one before it, the answers nobody has read closely, and the answers that never named their pages. A rate with no window and no missingness beside it is the oldest lie in this business.
  const last = monthDayLabel(days[days.length - 1]?.day ?? null), newest = read[read.length - 1], older = read[read.length - 2];
  const missing = !trend ? ["The daily trend could not be read back in time, so no rate, no chart and no period is claimed here. What follows is read off the last day stored and the window beside it."] : [
    `Reporting period ${monthDayLabel(days[0]?.day ?? null) ?? "an unnamed day"} to ${last ?? "an unnamed day"}, the ${num(days.length)} days holding answers, and answers came back on ${num(read.length)} of them.`,
    `The last ${num(span)} days cover ${num(byPrompt.size)} tracked ${byPrompt.size === 1 ? "question" : "questions"} on ${num(enginesSeen.length)} ${enginesSeen.length === 1 ? "assistant" : "assistants"}: ${enginesSeen.map(engineName).join(", ")}.`,
    ...(gaps.length > 0 ? [`${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` and ${num(gaps.length - 3)} more` : ""} came back with nothing, and a missed day is never filled in.`] : []),
    ...(newest && older && newest.observed < older.observed ? [`${monthDayLabel(newest.day) ?? newest.day} holds ${num(newest.observed)} answers against ${num(older.observed)} the day before, so it is counted as the part day it is.`] : []),
    ...(observed - analyzed > 0 ? [`${num(observed - analyzed)} of the ${num(observed)} answers collected in those ${num(span)} days have not been read closely yet, so they sit in none of the rates above.`] : []),
    ...(observed - citeSample > 0 ? [`${num(observed - citeSample)} of those ${num(observed)} never said which pages they used, so they sit in no citation count.`] : []),
  ];
  // NOTHING HERE CLAIMS TO BE RUNNING WHILE IT IS NOT. The off switch is read at load: paused gets the fact and the switch to flip, unreadable claims neither state, and only a switch read as on may quote today's plan.
  const activity = input.collecting === "paused"
    ? `Collection is paused, so no day after ${last ?? "the last one read"} is added. Turn it back on in Settings to keep this moving.`
    : input.collecting === "unreadable" ? "Whether collection is on could not be read just now, so nothing is claimed either way. The switch is in Settings."
      : `${typeof input.checks.done === "number" && typeof input.checks.total === "number" && input.checks.total > 0
        ? `${num(input.checks.done)} of the ${num(input.checks.total)} answer checks planned for today are settled${parts.length > 0 ? `: ${parts.join(", ")}. ` : ". "}` : ""}${input.liveness ? `${input.liveness} ` : ""}Open Changes for the move these answers point at.`;
  return {
    empty: null, tiles, chart, boundaries, prompts, citations, searches, ownedPages, promptIdeas, retrieval, byEngine, detail: detailOf(input),
    engines: enginesSeen.map((e) => ({ id: e, label: engineName(e) })),
    intel: input.intel && input.intel.answers > 0 ? {
      answers: input.intel.answers,
      competitors: input.intel.competitors.map((s) => ({ text: s.text, basis: `${num(s.prompts)} of the tracked questions` })),
      formats: input.intel.contentTypes.map((s) => ({ text: s.text, basis: `${num(s.prompts)} of the tracked questions` })),
      omissions: input.intel.omissions.map((s) => ({ text: s.text, basis: `${num(s.prompts)} of the tracked questions` })),
    } : null,
    coverage: [...missing, activity].join(" "), // A COUNT OF DAYS IS NOT A PULSE: it says what was collected, never whether anything is running, so the off switch is read and stands beside it.
    watermark: `Stored AI answers, through ${dayLabel ?? "a day not yet read"}. Nothing on this page asks an assistant anything: every number is read back off answers already bought.`,
  };
}
/** ONE QUESTION OPENED: every reading on file, per assistant and per day, with the rivals it named, the searches it ran and the pages it credited. The whole of any single run is one click further in. */
function detailOf(input: AiInput) {
  if (!input.focus) return null;
  const rows = input.focus.rows;
  const first = rows[0] ?? null;
  const analyzed = rows.filter((r) => r.mentioned != null), named = analyzed.filter((r) => r.mentioned);
  const byEngine = new Map<string, AnswerRow[]>();
  for (const r of rows) byEngine.set(r.engine, [...(byEngine.get(r.engine) ?? []), r]);
  const rivals = new Map<string, number>(), sites = new Map<string, number>(), ran = new Map<string, number>();
  for (const r of rows) { for (const c of new Set(r.competitors)) rivals.set(c, (rivals.get(c) ?? 0) + 1);
    for (const d of new Set((r.citations ?? []).map((c) => c.url))) sites.set(d, (sites.get(d) ?? 0) + 1);
    for (const q of new Set(fanOutsExcluding(r.fanOuts ?? [], [r.promptText]))) ran.set(q, (ran.get(q) ?? 0) + 1); }
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([text, count]) => ({ text, count }));
  const platforms = table({
    columns: [{ key: "engine", label: "Assistant", wide: true }, { key: "answers", label: "Answers", numeric: true }, { key: "named", label: "Named you", numeric: true }, { key: "credited", label: "Credited a page of yours", numeric: true }, { key: "place", label: "Place in answer", numeric: true }, { key: "last", label: "Last read", numeric: true }],
    empty: "No reading of this question is on file yet.",
    rows: [...byEngine.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([engine, list]) => {
      const checked = list.filter((r) => r.mentioned != null), hit = checked.filter((r) => r.mentioned);
      const places = list.filter((r) => r.position != null).map((r) => r.position!);
      const cited = list.filter((r) => r.cited === true).length, reportedCites = list.filter((r) => r.cited != null).length;
      const last = list.map((r) => r.day).sort().at(-1) ?? "";
      return { id: engine, cells: [
        { text: engineName(engine) }, { text: num(list.filter((r) => r.answered).length), sort: list.length },
        { text: checked.length === 0 ? "not checked" : `${num(hit.length)} of ${num(checked.length)}`, sort: checked.length > 0 ? hit.length / checked.length : -1 },
        { text: reportedCites === 0 ? "never reported" : `${num(cited)} of ${num(reportedCites)}`, sort: cited },
        { text: places.length > 0 ? (places.reduce((a, x) => a + x, 0) / places.length).toFixed(1) : "not reported", sort: places.length > 0 ? places[0]! : 999 },
        { text: monthDayLabel(last) ?? "never", sort: Number(last.replace(/-/g, "")) || 0 },
      ] };
    }),
  });
  return {
    promptId: input.focus.promptId, question: first?.promptText ?? "This question",
    headline: analyzed.length === 0
      ? `${num(rows.filter((r) => r.answered).length)} answers to this question are on file and none of them are checked yet, so no mention rate is reported for it.`
      : `You are named in ${num(named.length)} of the ${num(analyzed.length)} answers finished checking on this question, across ${num(byEngine.size)} ${byEngine.size === 1 ? "assistant" : "assistants"}.`,
    platforms, rivals: top(rivals, 6), sites: top(sites, 8).map((s) => ({ text: shortUrl(s.text), count: s.count })), searches: top(ran, 8),
    // EVERY RUN, one row each, with the whole of any one of them one click further in. No wall of a hundred and forty identical sentences: a status to scan, and the evidence on demand.
    executions: table({
      columns: [{ key: "day", label: "Day", numeric: true }, { key: "engine", label: "Assistant", wide: true }, { key: "status", label: "What happened", wide: true }, { key: "named", label: "Named you" }, { key: "credited", label: "Credited a page of yours" }, { key: "searches", label: "Searches it ran", numeric: true }, { key: "cites", label: "Pages it credited", numeric: true }],
      empty: "No reading of this question is on file yet.",
      note: `Every run on file for this question, newest first. Open one for the whole answer, every search behind it and every page it credited.${rows.some((r) => r.slot > 0) ? " A run marked as a repeat is the same question asked again the same day, which is how much these answers move on their own gets measured." : ""}`,
      rows: [...rows].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.engine.localeCompare(b.engine))).map((r) => {
        const searched = fanOutsExcluding(r.fanOuts ?? [], [r.promptText]).length;
        return { id: r.id, href: `?view=ai&prompt=${encodeURIComponent(r.promptId)}&reading=${encodeURIComponent(r.id)}`, cells: [
          { text: monthDayLabel(r.day) ?? r.day, sub: r.slot > 0 ? "a repeat ask" : undefined, sort: Number(r.day.replace(/-/g, "")) || 0 },
          { text: engineName(r.engine), sub: r.modelServed ?? undefined },
          { text: !r.answered ? "nothing came back" : r.reading === "unread" ? "answer on file, not checked yet" : r.reading === "part" ? "partly checked" : r.reading === "checked" ? "checked for your name and address" : "read closely",
            tone: !r.answered ? "down" : r.reading === "read" ? "up" : "flat" },
          { text: r.mentioned == null ? "not checked" : r.mentioned ? "yes" : "no", sort: r.mentioned == null ? -1 : r.mentioned ? 1 : 0, tone: r.mentioned === true ? "up" : r.mentioned === false ? "down" : "flat" },
          { text: r.cited == null ? "never reported" : r.cited ? "yes" : "no", sort: r.cited == null ? -1 : r.cited ? 1 : 0, tone: r.cited === true ? "up" : r.cited === false ? "down" : "flat" },
          { text: r.fanOuts == null ? "never reported" : num(searched), sort: searched,
            sub: r.webSearched === true ? "searched the web before answering" : r.webSearched === false ? "answered from memory" : undefined },
          { text: r.citations == null ? "never reported" : num(r.citations.length), sort: r.citations?.length ?? -1 },
        ] };
      }),
    }),
  };
}
/** ONE STORED READING, WHOLE and cut nowhere: the complete answer, every search it ran, every page it credited with the part it quoted, every page it read without crediting, both model names, how it was asked, the day, the
 *  instants, the cost and how far it has been read. WHAT THE PROVIDER NEVER REPORTED SAYS SO: "it credited nobody" and "it never said what it used" are different claims. */
export function answerDetail(
  r: AnswerRow, kindOf: ReadonlyMap<string, CompetitorKind> = new Map(), costUsd: number | null = r.costUsd,
): string[] {
  const engine = engineName(r.engine), mine = (r.citations ?? []).filter((c) => c.owned).length;
  const own = fanOutsExcluding(r.fanOuts ?? [], [r.promptText]);
  const asked = instant(r.askedAt), answered = instant(r.answeredAt);
  const cited = (c: NonNullable<AnswerRow["citations"]>[number]): string =>
    `${c.url} (${c.owned ? "your page" : `${c.domain}, ${(KIND_LABEL[kindOf.get(c.domain) ?? "irrelevant_unknown"]).toLowerCase()}`})` + (c.passage?.trim() ? ` It quoted this part: "${c.passage.trim()}"` : "");
  return [
    `${engine} was asked, word for word: "${r.promptText}"`,
    !r.answered ? `${engine} gave nothing back on this one.${r.failureReason ? ` It said: ${r.failureReason}` : ""}`
      : r.mentioned == null ? "The answer is on file, but nobody has read it closely enough yet to say whether you were named."
        : `${r.mentioned ? "You were named" : "You were not named"}${r.position != null ? `, in place ${num(r.position)} of the answer` : ""}. ${r.cited === true ? "A page of yours was credited." : r.cited === false ? "No page of yours was credited." : "This answer did not say which pages it used."}`,
    ...(r.competitors.length > 0 ? [`It named these instead of or beside you: ${r.competitors.join(", ")}.`] : []),
    ...(r.answerText?.trim() ? [`What it answered, all of it: ${r.answerText.trim()}`] : ["No answer text is on file for this one, so there is nothing to quote."]),
    ...(r.fanOuts == null ? [r.webSearched === false ? `${engine} answered this one from memory, without searching the web first.` : `${engine} does not report the searches it ran on this path, so whether it ran any is unknown.`]
      : own.length === 0 ? ["It ran no searches of its own before answering."]
        : [`Before answering it searched for: ${own.map((q) => `"${q}"`).join(", ")}.`]),
    ...(r.citations == null ? [`${engine} does not report which pages it used on this path, so there is no claim that it credited nobody.`]
      : r.citations.length === 0 ? ["It credited no pages at all."]
        : [`It credited ${num(r.citations.length)} ${r.citations.length === 1 ? "page" : "pages"}, ${mine > 0 ? `${num(mine)} of them yours` : "none of them yours"}:`, ...r.citations.map(cited)]),
    ...(r.retrievedNotCited == null ? [`${engine} does not report the pages it read but did not credit on this path.`]
      : r.retrievedNotCited.length === 0 ? ["Every page it read, it credited."]
        : [`It also read these and credited none of them: ${r.retrievedNotCited.join(", ")}.`]),
    `${engine} answered with ${r.modelServed ? `its ${r.modelServed} model` : "a model it did not name"}${r.modelRequested ? (r.modelRequested === r.modelServed ? ", the one asked for" : `, though ${r.modelRequested} was asked for`) : ""}.${r.mode && MODE_LABEL[r.mode] ? ` It was ${MODE_LABEL[r.mode]}.` : ""}`,
    `This reading counts for ${monthDayLabel(r.day) ?? r.day}.` + (asked ? ` Asked ${asked}${answered ? `, answered ${answered}` : ", and it never came back"}.` : ""),
    r.reading === "read" ? "Every word of this answer has been read closely."
      : r.reading === "part" ? "Part of this answer has been read closely and the rest is still waiting its turn."
        : r.reading === "checked" ? "This answer was checked for your name and your website address, and nobody has read the rest of it closely."
          : "Nobody has read this answer closely yet, so no claim is made here about who it named.",
    // A ROW WHOSE RECEIPT WAS NEVER PRESERVED IS UNKNOWN, NEVER FREE, and a real charge smaller than a cent says its own size.
    ...(r.receipt ? [`Stored answer receipt ${receiptTail(r.receipt)}. ${costUsd != null && costUsd > 0
      ? `It cost ${costUsd < 0.01 ? "under a cent" : `$${costUsd.toFixed(2)}`} to buy once.`
      : "What it cost was never preserved, so no number is put on it."}`]
      : ["No receipt was kept for the stored answer behind this one."]),
  ];
}
