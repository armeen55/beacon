/** Task-scoped comparison of query-backed winners; partial readings never prove absence. */
import { createHash } from "node:crypto";
import { classifyDomain, type CompetitorKind } from "./competitors/classify";
import { canonicalQueryKey, FURNITURE_LABEL, topicTokens } from "./relevance-gate";
import { publisherHost } from "./serp-shape";
import { jobWinners, canonicalUrlKey } from "./snapshot";
import type { FunnelResearchEvidence } from "./funnel/research-evidence";

type Research = Pick<FunnelResearchEvidence, "serpEvidence" | "winningPages">;

type ComparisonObservation = { kind: "answers" | "covers" | "names" | "shape"; text: string; quote: string; /** THE HEADING A `covers` OBSERVATION IS ABOUT, apart from the words under it (delivery loop, 2026-09-07): the quote used to be the label itself, so the writer was briefed with a name and no material, and the fact pass searched a label. The topic is what the acquisition researches; the quote is what the winner says under it. */ topic?: string };
type ComparedWinner = {
  url: string; publisher: string; publisherClass: CompetitorKind;
  querySupport?: { rank: number | null; citationObservations: number };
  /** THE SHAPE OF ITS ANSWER, each part null where the read that banked it does not report that part: a provider parse of a rival's page carries its words and its tables and reports neither lists nor question entries, and "no lists" is a different claim from "nobody looked". AND WHETHER WHAT THIS WINNER NAMES IS ON FILE AT ALL: a provider read reports no entity list and a row banked before the field existed carries none, so an empty list would say "it names nothing this page lacks" off a reading that never looked, and unknown here can never earn the "nothing" verdict below. */ shape: { words: number; lists: boolean | null; tables: boolean | null; questions: number | null }; namesRead: boolean;
  /** WHETHER THE WINNER'S OWN WORDS ARE ON FILE AT ALL. An extract banked before the content reading existed carries a title, a word count and the crawl's own heading list and NO main text, and every observation below is read off the main text, so a winner with no reading carries no candidate and may never earn "names". */ read: boolean; truncated: boolean; held: string;
  /** Does `held` carry the winner's WHOLE main text? A selection cannot prove an absence, so a winner shown only in part never earns the "nothing" verdict and the brief says which passages were read. */ heldWhole: boolean;
  bodyKey: string;
  observations: ComparisonObservation[];
};
export type JobComparison = { queries: string[]; focus?: string[]; winners: ComparedWinner[]; keep: string[]; verdict: "names" | "nothing" | "unread" };

const COVERAGE = 2 / 3, SAME_LEMMA = 6;
const READING_CHARS = 4_000;
const heldFor = (body: string, ask: ReadonlySet<string>, limit: number, focus: ReadonlySet<string>, sections: readonly { heading: string | null; text: string }[] = []): { held: string; whole: boolean } => {
  if (body.length <= limit) return { held: body, whole: true };
  const score = (t: string, bag: ReadonlySet<string>): number => [...new Set(topicTokens(t))].filter((w) => bag.has(w)).length;
  const chosen: string[] = []; let room = limit;
  // A task's captured section travels with its explanation and qualifications before generic query prose.
  for (const x of sections.map((s, i) => ({ t: [s.heading, s.text].filter(Boolean).join("\n"), i, n: score(s.heading ?? "", focus) * 3 + score(s.text, focus) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i)) {
    if (room < 1 || chosen.some((t) => t.includes(x.t))) continue;
    const t = x.t.length <= room ? x.t : chosen.length === 0 ? x.t.slice(0, room) : "";
    if (t) { chosen.push(t); room -= t.length + 2; }
  }
  const parts = body.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean), keep = new Set<number>();
  for (const x of parts.map((t, i) => ({ t, i, n: score(t, focus) * 2 + score(t, ask) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i)) {
    for (const i of [x.i, x.i - 1, x.i + 1]) { const t = parts[i];
      if (!t || keep.has(i) || chosen.some((p) => tidy(p).includes(tidy(t))) || room < t.length + 1 || t.split(/\s+/).slice(0, 12).some((_, n, words) => FURNITURE_LABEL.test(words.slice(0, n + 1).join(" ")))) continue;
      keep.add(i); room -= t.length + 1;
    }
  }
  const held = [...chosen, parts.filter((_, i) => keep.has(i)).join(" ")].filter(Boolean).join("\n\n");
  return { held: held || body.slice(0, limit), whole: false }; };
const MAX_WINNERS = 5, MAX_OBSERVATIONS = 6, QUOTE_CHARS = 160, MAX_KEEP = 4, KEEP_CHARS = 240, MIN_SECTION_WORDS = 20, MIN_READ_WORDS = 60;
const sectionUnder = (body: string, heading: string, heads: readonly string[], sections?: readonly { heading: string | null; text: string }[]): string | null => {
  const parsed = sections?.find((s) => (s.heading ?? "").trim().toLowerCase() === heading.trim().toLowerCase())?.text.trim(); if (parsed) return parsed.split(/\s+/).filter(Boolean).length >= MIN_SECTION_WORDS ? parsed.slice(0, 1_200) : null; // the provider's own section, where the capture carries one
  const hay = body.toLowerCase(), at = hay.indexOf(heading.toLowerCase()); if (at < 0) return null;
  const from = at + heading.length, ends = heads.filter((h) => h !== heading && h.length >= 3).map((h) => hay.indexOf(h.toLowerCase(), from + 1)).filter((i) => i > from);
  const clean = (t: string): string => t.replace(/\[edit\]/gi, " ").replace(/^[\s:.\-]+/, "").replace(/\s+/g, " ").trim(), words = (t: string): number => t.split(/\s+/).filter(Boolean).length;
  // A SUB-HEADING IS NOT THE END OF A SECTION (journey review, 2026-09-07): under an encyclopedia h2 the window closed at the first h3 forty-eight characters on, under the section minimum, so three of four observations handed the writer the bare label instead of the words. When what stops at the next heading is too thin to be a section, the window runs on through the sub-headings the section contains; and the crawl's own "[edit]" affordance never rides in as the quote.
  const text = clean(body.slice(from, Math.min(from + 1_200, ...ends))), wide = words(text) >= MIN_SECTION_WORDS ? text : clean(body.slice(from, from + 1_200));
  return words(wide) >= MIN_SECTION_WORDS ? wide : null; };
const said = (text: string): Set<string> => new Set(topicTokens(text));
const carries = (bag: Set<string>, w: string): boolean => bag.has(w) || (w.length >= SAME_LEMMA && [...bag].some((t) => t.length >= SAME_LEMMA && t.slice(0, SAME_LEMMA) === w.slice(0, SAME_LEMMA)));
const covers = (bag: Set<string>, label: string): boolean => { const ask = topicTokens(label); return ask.length === 0 || ask.filter((w) => carries(bag, w)).length >= Math.max(1, Math.ceil(ask.length * COVERAGE)); };
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 3).trimEnd()}...`);
const keyOf = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

const classOf = (research: Research, host: string, ownedHost: string): CompetitorKind => {
  const serps = (research.serpEvidence ?? []); let serpAppearances = 0; const queries = new Set<string>(); let aiCitations = 0;
  for (const s of serps) { for (const o of s.organic ?? []) if (publisherHost(o.url) === host) { serpAppearances += 1; queries.add(canonicalQueryKey(s.query)); }
    for (const c of [...(s.aiOverview ?? []), ...(s.aiMode ?? [])]) if (publisherHost(c.url) === host) aiCitations += 1; }
  for (const w of research.winningPages ?? []) if (publisherHost(w.url) === host) aiCitations += (w.appearances ?? []).filter((a) => a.kind === "ai_answer").length;
  return classifyDomain(host, { serpAppearances, aiCitations, competingQueries: queries.size, isOwned: host === ownedHost }).kind;
};

export function jobComparison(research: Research, queries: readonly string[], owned: { url: string; text: string; headings: readonly string[]; passages?: readonly string[] }, max = MAX_WINNERS, channel: "seo" | "aeo" = "seo", focus: readonly string[] = []): JobComparison {
  const asked = [...new Set(queries.flatMap((q) => topicTokens(q)))], askBag = new Set(asked);
  const ownBag = said(`${owned.text} ${owned.headings.join(" ")}`), ownedHost = publisherHost(owned.url);
  const passages = (owned.passages ?? []).map(tidy).filter(Boolean);
  // MATERIAL TO KEEP IS ASKED OF ONE PHRASING AT A TIME, never of the union: every extra way the group is asked would
  // otherwise raise the bar a passage has to clear, so a page that answers the question outright would keep nothing.
  const answers = (p: string): boolean => { const bag = said(p); return queries.some((q) => { const ask = topicTokens(q); return ask.length > 0 && ask.filter((w) => carries(bag, w)).length >= Math.max(2, Math.ceil(ask.length * COVERAGE)); }); };
  const keep = passages.filter(answers).slice(0, MAX_KEEP).map((p) => cut(p, KEEP_CHARS));
  const bank = { ...research, winningPages: [...(research.winningPages ?? []), ...(research.serpEvidence ?? []).filter((s) => queries.some((q) => canonicalQueryKey(q) === canonicalQueryKey(s.query))).flatMap((s) => s.organic.filter((o) => canonicalUrlKey(o.url) !== canonicalUrlKey(owned.url)).map((o) => ({ url: o.url, domain: o.domain, engines: [], examplePrompts: [], appearances: [], extract: null })))] };
  const winners: ComparedWinner[] = [], read = jobWinners(bank, queries, channel).filter((w) => canonicalUrlKey(w.url) !== canonicalUrlKey(owned.url)).slice(0, max), seen = new Set<string>(), note = (into: ComparisonObservation[], publisher: string, o: ComparisonObservation): void => { const k = `${publisher}\n${o.quote.trim().toLowerCase()}`; if (seen.has(k)) return; seen.add(k); into.push(o); };
  for (const w of read) {
    if (!w.extract) { winners.push({ url: w.url, publisher: publisherHost(w.url), publisherClass: classOf(research, publisherHost(w.url), ownedHost), querySupport: w.querySupport, shape: { words: 0, lists: null, tables: null, questions: null }, namesRead: false, read: false, truncated: false, held: "", heldWhole: false, bodyKey: keyOf(""), observations: [] }); continue; }
    const e = w.extract!, host = publisherHost(w.url), reading = typeof e.mainText === "string", body = reading ? e.mainText!.trim() : "", heads = reading ? [...(e.headings ?? []), ...(e.h3s ?? [])].map(tidy) : [], obs: ComparisonObservation[] = [], thin = e.truncated !== true && (e.wordCount ?? 0) < MIN_READ_WORDS;
    // WHAT ITS OWN PROSE ANSWERS. A sentence counts when it speaks to the group AND carries content words the owned
    // passages never carry: overlap alone would hand the writer the page's own subject said back to it.
    for (const s of body.split(/(?<=[.!?])\s+/).map(tidy)) {
      if (obs.length >= 2 || s.length < 40 || s.length > 600) continue;
      const t = topicTokens(s); if (t.filter((x) => askBag.has(x)).length < 2) continue;
      const novel = [...new Set(t.filter((x) => !askBag.has(x) && !carries(ownBag, x)))]; if (novel.length < 2) continue;
      note(obs, host, { kind: "answers", text: `${host} answers this search in its own prose and this page carries none of ${novel.slice(0, 3).join(", ")}.`, quote: cut(s, QUOTE_CHARS) });
    }
    // WHAT IT GIVES A SECTION TO. A heading this page covers in its own words is not a gap, which is the whole of the
    // rule the label match got wrong; the words are compared, not the labels.
    // A WINNER'S OWN CHROME IS NOT A GAP IN ANOTHER PAGE (campaign review, 2026-09-05). The crawler builds `h2_list`
    // and `h3_list` off the WHOLE document while only the main text is de-chromed, so "Newsletter", "Related
    // articles" and "Categories" arrived here as subjects: one of them moved the verdict to "names", which is the
    // only answer the ranking-loss door reads before it authorizes paid body work, handed the writer a briefing line
    // about a signup box, and became a paid factual_source need through `comparisonTopics`. The one navigation-label
    // definition the account already keeps decides it, at this door as at the other three.
    for (const h of heads) {
      if (obs.length >= 4 || h.length < 3 || h.length > 120 || topicTokens(h).length === 0 || FURNITURE_LABEL.test(h) || covers(ownBag, h)) continue;
      const brand = host.replace(/^www\./i, "").replace(/\.[a-z.]+$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase(); if (brand.length >= 4 && h.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand)) continue; /* a short host stem like a.example would match every heading containing its letter, so only a real brand word is asked */
      // THE WORDS UNDER THE HEADING ARE THE OBSERVATION, THE HEADING IS ITS TOPIC (delivery loop, 2026-09-07). A label on a capture held whole that is too thin to carry a section is the page's chrome (a 303-character capture of a names blog minted "Contact Darsoon" as a missing subject and bought three fact checks for it); a label absent from a substantive capture, or from one cut at the ceiling, may still head a section the text renders differently or past the cut, so it stays a candidate with the label as its only words.
      const under = sectionUnder(body, h, heads, e.sections); if (!under && thin) continue;
      note(obs, host, { kind: "covers", topic: h, text: `${host} gives "${h}" a section of its own and nothing on this page covers it.`, quote: cut(under ?? h, QUOTE_CHARS) });
    }
    const names = reading && !thin ? [...new Set((e.entityNames ?? []).map(tidy).filter((n) => n.length > 2 && topicTokens(n).length > 0 && !FURNITURE_LABEL.test(n) && !covers(ownBag, n)))].slice(0, 6) : [];
    if (names.length > 0 && obs.length < MAX_OBSERVATIONS) note(obs, host, { kind: "names", text: `${host} names ${names.length} things this page does not name: ${names.join(", ")}.`, quote: cut(names.join(", "), QUOTE_CHARS) });
    const asks = heads.filter((h) => h.trim().endsWith("?"));
    if ((e.faqCount ?? 0) > 0 && asks.length > 0 && !owned.headings.some((h) => h.trim().endsWith("?")) && obs.length < MAX_OBSERVATIONS) {
      note(obs, host, { kind: "shape", text: `${host} answers as ${e.faqCount} question entries and this page carries none.`, quote: cut(tidy(asks[0]!), QUOTE_CHARS) });
    }
    let offset = 0; const labels = new Set(heads.map((h) => h.toLowerCase()));
    const locations = body.split("\n").flatMap((line) => { const at = offset; offset += line.length + 1; return labels.has(tidy(line).toLowerCase()) ? [{ heading: line.trim(), at, from: at + line.length }] : []; }).filter((h, i, all) => !all.slice(i + 1).some((n) => n.heading.toLowerCase() === h.heading.toLowerCase()));
    const sections = e.sections?.length ? e.sections : locations.map((h, i) => ({ heading: h.heading, text: body.slice(h.from, locations[i + 1]?.at ?? body.length).trim() }));
    const shown = heldFor(body, askBag, Math.min(READING_CHARS, Math.floor(12_000 / Math.max(1, read.length))), new Set(focus.flatMap((t) => topicTokens(t))), sections);
    winners.push({ url: w.url, publisher: host, publisherClass: classOf(research, host, ownedHost), querySupport: w.querySupport,
      shape: { words: e.wordCount, lists: e.hasList ?? null, tables: e.hasTable ?? null, questions: e.faqCount ?? null }, namesRead: e.entityNames != null,
      read: reading, truncated: e.truncated === true, held: shown.held, heldWhole: shown.whole, bodyKey: keyOf(tidy(body)), observations: obs.slice(0, MAX_OBSERVATIONS) });
  }
  return { queries: [...queries], ...(focus.length ? { focus: [...focus] } : {}), winners, keep, verdict: verdictOf(winners) };
}
const verdictOf = (winners: readonly ComparedWinner[]): JobComparison["verdict"] =>
  winners.some((w) => w.observations.length > 0) ? "names" : winners.length === 0 || winners.some((w) => !w.read || w.truncated || !w.namesRead || !w.heldWhole) ? "unread" : "nothing";

export const comparisonLines = (c: JobComparison): string[] => c.winners.map((w) =>
  [`${w.publisher} is ${LABEL[w.publisherClass]} and answers this search in ${w.shape.words} words${(w.shape.questions ?? 0) > 0 ? ` across ${w.shape.questions} question entries` : ""} at ${w.url}.${w.querySupport ? ` Query-matched evidence: best organic rank ${w.querySupport.rank ?? "unreported"}; ${w.querySupport.citationObservations} distinct citation observations (not proof of causation).` : ""}`,
    !w.read ? "None of its own words are on file, so what it carries is unknown rather than absent." : w.truncated ? "Only the opening of it was captured, so what it carries past that is unknown rather than absent." : !w.namesRead ? "The read of it lists nothing it names, so the things it names are unknown rather than absent." : !w.heldWhole ? "Only its passages about this search were read, so what it carries elsewhere is unknown rather than absent." : "",
    ...w.observations.map((o) => `${o.text} Its own words: "${o.quote}"`)].filter(Boolean).join(" "));
const LABEL: Readonly<Record<CompetitorKind, string>> = { commercial_competitor: "a business selling what this account sells", citation_authority: "a source assistants quote", publisher: "a publisher covering these topics", marketplace_directory: "a marketplace or directory", government_educational: "a government or school source", social_community: "a social platform", owned: "this account's own site", irrelevant_unknown: "a site whose part here is not settled" };
export const comparisonObservations = (c: JobComparison): ComparisonObservation[] => c.winners.flatMap((w) => w.observations);
export const comparisonTopics = (c: JobComparison): { topic: string; url: string }[] => c.winners.flatMap((w) =>
  w.observations.filter((o) => o.kind === "covers" || o.kind === "names").flatMap((o) => (o.kind === "covers" ? [o.topic ?? o.quote] : o.quote.split(", ")).map((t) => ({ topic: tidy(t), url: w.url }))))
  .filter((t) => t.topic.length > 2);
export const withObservations = (c: JobComparison, by: ReadonlyMap<string, ComparisonObservation[]>): JobComparison => {
  const winners = c.winners.map((w) => ({ ...w, observations: (by.get(w.url) ?? []).slice(0, MAX_OBSERVATIONS) }));
  return { ...c, winners, verdict: verdictOf(winners) };
};
