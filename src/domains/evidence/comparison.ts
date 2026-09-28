/** Query-backed source observations are research candidates, not proof that a whole owned page lacks their subject. */
import { createHash } from "node:crypto";
import { classifyDomain, type CompetitorKind } from "./competitors/classify";
import { canonicalQueryKey, FURNITURE_LABEL, topicTokens } from "./relevance-gate";
import { publisherHost } from "./serp-shape";
import { jobWinners, canonicalUrlKey } from "./snapshot";
import { sectionsFrom, type FunnelResearchEvidence } from "./funnel/research-evidence";

type Research = Pick<FunnelResearchEvidence, "serpEvidence" | "winningPages">;

type ComparisonObservation = { kind: "answers" | "covers" | "names" | "shape"; text: string; quote: string; /** Full answer sentence or section heading; the display quote may be cut. */ topic?: string };
type ComparedWinner = {
  url: string; publisher: string; publisherClass: CompetitorKind;
  querySupport?: { rank: number | null; citationObservations: number };
  /** THE SHAPE OF ITS ANSWER, each part null where the read that banked it does not report that part: a provider parse of a rival's page carries its words and its tables and reports neither lists nor question entries, and "no lists" is a different claim from "nobody looked". AND WHETHER WHAT THIS WINNER NAMES IS ON FILE AT ALL: a provider read reports no entity list and a row banked before the field existed carries none, so an empty list would say "it names nothing this page lacks" off a reading that never looked, and unknown here can never earn the "nothing" verdict below. */ shape: { words: number; lists: boolean | null; tables: boolean | null; questions: number | null }; namesRead: boolean;
  /** WHETHER THE WINNER'S OWN WORDS ARE ON FILE AT ALL. An extract banked before the content reading existed carries a title, a word count and the crawl's own heading list and NO main text, and every observation below is read off the main text, so a winner with no reading carries no candidate and may never earn "names". */ read: boolean; truncated: boolean; captureComplete?: boolean; held: string;
  /** Does `held` carry the winner's WHOLE main text? A selection cannot prove an absence, so a winner shown only in part never earns the "nothing" verdict and the brief says which passages were read. */ heldWhole: boolean;
  bodyKey: string; materialWhole: boolean;
  observations: ComparisonObservation[];
};
export type JobComparison = { queries: string[]; focus?: string[]; basis: "seo_rank" | "aeo_recurrence"; owned?: { url: string; held: string; heldWhole: boolean; captureComplete?: boolean; bodyKey: string }; winners: ComparedWinner[]; keep: string[]; verdict: "names" | "nothing" | "unread" };

const COVERAGE = 2 / 3, SAME_LEMMA = 6;
/** THE READING'S ROOM (Stage 2, 2026-09-14): winners share 12,000 characters, each capped at 4,000 and FLOORED at 2,000 before the owned page takes its 4,800, and the owned share shrinks to keep the whole under 16,800 (the writer holds the owned page whole as page.body regardless). Five winners: 2,400 each and 4,800 owned; eight: 2,000 each and 800 owned. */
const READING_CHARS = 4_000, WINNER_FLOOR = 2_000, WINNERS_SHARE = 12_000, OWNED_SHARE = 4_800;
const heldFor = (body: string, ask: ReadonlySet<string>, limit: number, focus: ReadonlySet<string>, sections: readonly { heading: string | null; text: string }[] = []): { held: string; whole: boolean } => {
  if (body.length <= limit) return { held: body, whole: true };
  const score = (t: string, bag: ReadonlySet<string>): number => [...new Set(topicTokens(t))].filter((w) => bag.has(w)).length;
  const blocks = sections.length ? sections : body.split(/\n\s*\n/).map((text) => ({ heading: null, text })), chosen: { t: string; i: number }[] = []; let room = limit;
  for (const x of blocks.map((s, i) => ({ t: [s.heading, s.text].filter(Boolean).join("\n").trim(), i, n: score(s.heading ?? "", focus) * 3 + score(s.text, focus) + score(s.heading ?? "", ask) + score(s.text, ask) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i)) {
    if (!x.t || x.t.length + (chosen.length ? 2 : 0) > room || chosen.some((p) => tidy(p.t).includes(tidy(x.t)))) continue;
    chosen.push(x); room -= x.t.length + (chosen.length > 1 ? 2 : 0);
  }
  // A block never fits cut short: when the fitting blocks leave room, the best sentences and their neighbours fill it, each whole.
  const parts = body.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean), keep = new Set<number>();
  for (const x of parts.map((t, i) => ({ t, i, n: score(t, focus) * 2 + score(t, ask) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i)) {
    for (const i of [x.i, x.i - 1, x.i + 1]) { const t = parts[i];
      if (!t || keep.has(i) || chosen.some((p) => tidy(p.t).includes(tidy(t))) || room < t.length + 1 || t.split(/\s+/).slice(0, 12).some((_, n, words) => FURNITURE_LABEL.test(words.slice(0, n + 1).join(" ")))) continue;
      keep.add(i); room -= t.length + 1;
    }
  }
  return { held: [...chosen.sort((a, b) => a.i - b.i).map((x) => x.t), parts.filter((_, i) => keep.has(i)).join(" ")].filter(Boolean).join("\n\n"), whole: false }; };
const MAX_WINNERS = 5, MAX_OBSERVATIONS = 6, QUOTE_CHARS = 160, MAX_KEEP = 4, KEEP_CHARS = 240, MIN_SECTION_WORDS = 20, MIN_READ_WORDS = 60;
const said = (text: string): Set<string> => new Set(topicTokens(text));
const carries = (bag: Set<string>, w: string): boolean => bag.has(w) || (w.length >= SAME_LEMMA && [...bag].some((t) => t.length >= SAME_LEMMA && t.slice(0, SAME_LEMMA) === w.slice(0, SAME_LEMMA)));
const covers = (bag: Set<string>, label: string): boolean => { const ask = topicTokens(label); return ask.length === 0 || ask.filter((w) => carries(bag, w)).length >= Math.max(1, Math.ceil(ask.length * COVERAGE)); };
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();
const subjectAtoms = (q: string): string[] => topicTokens(q.replace(/^how (?:cold|hot|warm) (?:is|are) (?:the|a|an)?\s*/i, "").replace(/^cu[aá]nt[oa]s?\s+\S+\s+\S+\s+(?:un|una|el|la)\s+/iu, "").replace(/^what does\s+/i, "").replace(/^(?:where|how|what|which|when|why)\s+/i, "").replace(/\bmean(?:s|ing)?\s*$/i, ""));
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 3).trimEnd()}...`);
const keyOf = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
const sectionsOf = (body: string, heads: readonly string[], capture?: { version: number; mainHtml: string; complete: boolean }): { heading: string | null; text: string }[] =>
  sectionsFrom(body, { h2: heads }, capture).filter((x) => x.text).map(({ heading, text }) => ({ heading, text }));

const classOf = (research: Research, host: string, ownedHost: string): CompetitorKind => {
  const serps = (research.serpEvidence ?? []); let serpAppearances = 0; const queries = new Set<string>(); let aiCitations = 0;
  for (const s of serps) { for (const o of s.organic ?? []) if (publisherHost(o.url) === host) { serpAppearances += 1; queries.add(canonicalQueryKey(s.query)); }
    for (const c of [...(s.aiOverview ?? []), ...(s.aiMode ?? [])]) if (publisherHost(c.url) === host) aiCitations += 1; }
  for (const w of research.winningPages ?? []) if (publisherHost(w.url) === host) aiCitations += (w.appearances ?? []).filter((a) => a.kind === "ai_answer").length;
  return classifyDomain(host, { serpAppearances, aiCitations, competingQueries: queries.size, isOwned: host === ownedHost }).kind;
};

export function jobComparison(research: Research, queries: readonly string[], owned: { url: string; text: string; headings: readonly string[]; passages?: readonly string[]; complete?: boolean; sourceCapture?: { version: number; mainHtml: string; complete: boolean } }, max = MAX_WINNERS, channel: "seo" | "aeo" = "seo", focus: readonly string[] = []): JobComparison {
  const asked = [...new Set(queries.flatMap(subjectAtoms))], askBag = new Set(asked);
  const focusBag = new Set((focus.length ? focus : queries).flatMap((t) => topicTokens(t))), ownSections = sectionsOf(owned.text, owned.headings, owned.sourceCapture);
  const ownBag = said(`${owned.text} ${owned.headings.join(" ")}`), ownedHost = publisherHost(owned.url);
  const passages = (owned.passages ?? []).map(tidy).filter(Boolean);
  // Keep passages answering an individual phrasing; additional phrasings never raise its proof burden.
  const answers = (p: string): boolean => { const bag = said(p); return queries.some((q) => { const ask = subjectAtoms(q); return ask.length > 0 && ask.filter((w) => carries(bag, w)).length >= Math.min(ask.length, Math.max(2, Math.ceil(ask.length * COVERAGE))); }); };
  const keep = passages.filter(answers).slice(0, MAX_KEEP).map((p) => cut(p, KEEP_CHARS));
  const bank = { ...research, winningPages: [...(research.winningPages ?? []), ...(research.serpEvidence ?? []).filter((s) => queries.some((q) => canonicalQueryKey(q) === canonicalQueryKey(s.query))).flatMap((s) => s.organic.filter((o) => canonicalUrlKey(o.url) !== canonicalUrlKey(owned.url)).map((o) => ({ url: o.url, domain: o.domain, engines: [], examplePrompts: [], appearances: [], extract: null })))] };
  const winners: ComparedWinner[] = [], read = jobWinners(bank, queries, channel).filter((w) => canonicalUrlKey(w.url) !== canonicalUrlKey(owned.url)).slice(0, max), seen = new Set<string>(),
    winnerRoom = Math.max(WINNER_FLOOR, Math.min(READING_CHARS, Math.floor(WINNERS_SHARE / Math.max(1, read.length)))), shownOwned = heldFor(owned.text, askBag, Math.max(0, Math.min(OWNED_SHARE, WINNERS_SHARE + OWNED_SHARE - read.length * winnerRoom)), focusBag, ownSections.length ? ownSections : (owned.passages ?? []).map((text) => ({ heading: null, text }))), note = (into: ComparisonObservation[], publisher: string, o: ComparisonObservation): void => { const k = `${publisher}\n${o.quote.trim().toLowerCase()}`; if (seen.has(k)) return; seen.add(k); into.push(o); };
  for (const w of read) {
    if (!w.extract) { winners.push({ url: w.url, publisher: publisherHost(w.url), publisherClass: classOf(research, publisherHost(w.url), ownedHost), querySupport: w.querySupport, shape: { words: 0, lists: null, tables: null, questions: null }, namesRead: false, read: false, truncated: false, captureComplete: false, held: "", heldWhole: false, bodyKey: keyOf(""), materialWhole: false, observations: [] }); continue; }
    const e = w.extract!, host = publisherHost(w.url), reading = typeof e.mainText === "string", body = reading ? e.mainText!.trim() : "", heads = reading ? [...(e.headings ?? []), ...(e.h3s ?? [])].map(tidy) : [], obs: ComparisonObservation[] = [], thin = e.truncated !== true && (e.wordCount ?? 0) < MIN_READ_WORDS;
    const sections = (e.sections?.length ? e.sections : sectionsOf(body, heads)).filter((c) => c.heading && !FURNITURE_LABEL.test(c.heading)).map((c) => ({ ...c, text: c.text.replace(/\[edit\]/gi, " ").trim() })), material = [e.openingSample, ...sections.map((c) => c.text)].map((s) => tidy(s ?? "")).filter(Boolean), deep = e.truncated === true ? sections.map((c) => tidy(c.text)).filter((t) => t && !body.includes(t)) : [];
    const asserted = (s: string): boolean => queries.some((q) => {
      const spanish = /^como se (\S+) la (\S+)/i.exec(q), degree = /^how (?:cold|hot|warm) (?:is|are) (?:the|a|an)?\s*(.+)$/i.exec(q), amount = /^cu[aá]nt[oa]s?\s+(\p{L}+)\s+(\p{L}+)\s+(?:un|una|el|la)\s+(.+)$/iu.exec(q), question = /^(?:where|how|what|which|when|why)\b/i.test(q), definition = /\bmean(?:s|ing)?\s*$/i.test(q), atoms = subjectAtoms(q);
      const core = spanish ? topicTokens(spanish[2]) : degree ? topicTokens(degree[1]) : amount ? topicTokens(amount[3]) : question && /^(?:where|how)\b/i.test(q) ? atoms.slice(0, /\b(?:out|off|up|down)\s*$/i.test(q) ? -2 : -1) : atoms, action = spanish ? topicTokens(spanish[1]) : question ? atoms.slice(core.length) : [];
      if (degree || amount) {
        const words = s.replace(/^(?:the|a|an|un|una|el|la)\s+/i, "").split(/\s+/), first = topicTokens(words[0] ?? "")[0]; let n = 0, end = -1; for (let i = 0; i < Math.min(9, words.length); i++) { const part = topicTokens(words[i]!); if (part.length === 1 && n < core.length && carries(new Set(part), core[n]!)) n++; if (n === core.length) { end = i; break; } } if (!core.length || !first || !carries(new Set([first]), core[0]!) || end < 0) return false;
        const tail = words.slice(end + 1).join(" "), quantity = /^(?:lleva|requiere|necesita|usa)\s+(?:(?:alrededor|aproximadamente|unos?|unas?|de)\s+){0,3}(?:\d+|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:metros?|cent[ií]metros?|hebras?|madejas?|gramos?|rollos?)\s+de\s+(\p{L}+)\b/iu.exec(tail); return degree ? /^(?:is|are|was|were|drops?|falls?|reaches?|ranges?|hovers?|stays?|warms?|cools?|averages?|can (?:reach|drop|fall|rise))\s+(?:(?:to|at|around|about|near|below|above)\s+){0,2}(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:degrees?|celsius|fahrenheit|°[CF])\b/i.test(tail) : !!quantity && carries(new Set(topicTokens(quantity[1]!)), topicTokens(amount![1])[0] ?? ""); }
      const words = s.replace(/^(?:the|a|an|la)\s+/i, "").split(/\s+/); if (!core.length) return false;
      return words.slice(0, 5).some((_, i) => { const subject = topicTokens(words.slice(0, i + 1).join(" ")); if (subject.length !== core.length || subject.some((t, n) => !carries(new Set([t]), core[n]!))) return false;
        const tail = words.slice(i + 1).join(" ").replace(/^\([^)]{1,100}\)\s*/, "").replace(/^se\s+/i, ""), first = tail.split(/\s+/)[0] ?? "";
        const complement = tail.replace(/^is an?\s+/i, "").split(/\b(?:for|to|that|which|where|who|used|made|worked|found|located)\b|[,.!?;:]/i)[0] ?? "", siteTaxonomy = /^is an?\b/i.test(tail) && /\b(?:categor(?:y|ies)|tags?|collections?|pages?|posts?|articles?|sections?|labels?|indexes?|archives?|hubs?|resources?)\b/i.test(complement);
        return definition ? /^(?:means?|refers to|denotes|is defined as|is an?\b)/i.test(tail) && !siteTaxonomy : /^(?:is|are|was|were|has|have|had|can|could|may|might|will|would|does|do|did|live|lives|inhabit|inhabits|appear|appears|occur|occurs|contain|contains|include|includes|extend|extends|breed|breeds|feed|feeds|migrate|migrates|grow|grows|reach|reaches|hold|holds|form|forms|require|requires|provide|provides)\b/i.test(tail) || action.some((t) => topicTokens(first).includes(t)); });
    });
    let claimRead = false; for (const s of [...new Set([body, ...deep, ...material].flatMap((m) => m.split(/(?<=[.!?])\s+/)).map(tidy))]) {
      if (obs.length >= 2 || s.length < 40 || s.length > 600 || !material.some((m) => m.includes(s)) || !(tidy(body).includes(s) || deep.some((m) => m.includes(s))) || !asserted(s)) continue;
      claimRead = true;
      const t = topicTokens(s); if (t.filter((x) => askBag.has(x)).length < Math.min(2, askBag.size)) continue;
      const novel = [...new Set(t.filter((x) => !askBag.has(x) && !carries(ownBag, x)))]; if (novel.length < 2) continue;
      note(obs, host, { kind: "answers", topic: s, text: `${host} supplies a candidate explanation for this search; ${novel.slice(0, 3).join(", ")} were not matched in the supplied owned text.`, quote: cut(s, QUOTE_CHARS) });
    }
    for (const h of heads) {
      if (obs.length >= 4 || h.length < 3 || h.length > 120 || topicTokens(h).length === 0 || FURNITURE_LABEL.test(h) || covers(ownBag, h)) continue;
      const brand = host.replace(/^www\./i, "").replace(/\.[a-z.]+$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase(); if (brand.length >= 4 && h.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand)) continue; /* a short host stem like a.example would match every heading containing its letter, so only a real brand word is asked */
      const under = sections.find((s) => tidy(s.heading ?? "").toLowerCase() === h.toLowerCase())?.text.trim(); if (!under || under.split(/\s+/).length < MIN_SECTION_WORDS || !tidy(body.replace(/\[edit\]/gi, " ")).includes(tidy(under)) && e.truncated !== true) continue;
      note(obs, host, { kind: "covers", topic: h, text: `${host} gives "${h}" a section of its own. Compare its explanation with the owned page before treating the heading as a gap.`, quote: cut(under, QUOTE_CHARS) });
    }
    const claims = obs.filter((o) => o.kind === "answers").map((o) => o.topic!.toLowerCase()), names = reading && !thin ? [...new Set((e.entityNames ?? []).map(tidy).filter((n) => n.length > 2 && topicTokens(n).length > 0 && !FURNITURE_LABEL.test(n) && !covers(ownBag, n) && claims.some((s) => s.includes(n.toLowerCase()))))].slice(0, 6) : [];
    if (names.length > 0 && obs.length < MAX_OBSERVATIONS) note(obs, host, { kind: "names", text: `${host} names ${names.length} candidate subjects not matched in the supplied owned text: ${names.join(", ")}.`, quote: cut(names.join(", "), QUOTE_CHARS) });
    const asks = heads.filter((h) => h.trim().endsWith("?"));
    if ((e.faqCount ?? 0) > 0 && asks.length > 0 && !owned.headings.some((h) => h.trim().endsWith("?")) && obs.length < MAX_OBSERVATIONS) {
      note(obs, host, { kind: "shape", text: `${host} was captured with ${e.faqCount} question entries; no question heading was identified in the supplied owned heading list.`, quote: cut(tidy(asks[0]!), QUOTE_CHARS) });
    }
    const shown = heldFor(body, askBag, winnerRoom, new Set(focus.flatMap((t) => topicTokens(t))), sections.length ? sections : sectionsOf(body, heads));
    winners.push({ url: w.url, publisher: host, publisherClass: classOf(research, host, ownedHost), querySupport: w.querySupport,
      shape: { words: e.wordCount, lists: e.hasList ?? null, tables: e.hasTable ?? null, questions: e.faqCount ?? null }, namesRead: e.entityNames != null,
      read: reading, truncated: e.truncated === true, captureComplete: reading && e.truncated === false, held: shown.held, heldWhole: shown.whole, bodyKey: keyOf(tidy(body)), materialWhole: material.some((m) => m.includes(tidy(body))) && (claimRead || !queries.some((q) => material.some((m) => subjectAtoms(q).every((t) => carries(said(m), t))))), observations: obs.slice(0, MAX_OBSERVATIONS) });
  }
  const captured = { url: owned.url, held: shownOwned.held, heldWhole: shownOwned.whole && owned.complete === true, captureComplete: owned.complete === true, bodyKey: keyOf(JSON.stringify([owned.text, owned.headings, owned.complete ?? null, owned.sourceCapture ?? null])) };
  return { queries: [...queries], ...(focus.length ? { focus: [...focus] } : {}), basis: channel === "aeo" ? "aeo_recurrence" : "seo_rank", owned: captured, winners, keep, verdict: verdictOf(winners, captured) };
}
const verdictOf = (winners: readonly ComparedWinner[], owned: JobComparison["owned"]): JobComparison["verdict"] =>
  winners.some((w) => w.observations.length > 0) ? "names" : !owned?.heldWhole || owned.captureComplete === false || winners.length === 0 || winners.some((w) => !w.read || w.truncated || !w.namesRead || !w.heldWhole || !w.materialWhole || w.captureComplete === false) ? "unread" : "nothing";

export const comparisonLines = (c: JobComparison): string[] => c.winners.map((w) =>
  [`${w.publisher} is ${LABEL[w.publisherClass]} and answers this search in ${w.shape.words} words${(w.shape.questions ?? 0) > 0 ? ` across ${w.shape.questions} question entries` : ""} at ${w.url}.${w.querySupport ? c.basis === "aeo_recurrence" ? ` AEO recurrence evidence: ${w.querySupport.citationObservations} distinct citation observations; organic rank ${w.querySupport.rank ?? "unreported"} is recorded separately and is not part of that recurrence.` : ` SEO rank evidence: best organic rank ${w.querySupport.rank ?? "unreported"}; ${w.querySupport.citationObservations} distinct citation observations are recorded separately and are not ranking votes.` : ""}`,
    !w.read ? "None of its own words are on file, so what it carries is unknown rather than absent." : w.truncated ? "Only the opening of it was captured, so what it carries past that is unknown rather than absent." : !w.namesRead ? "The read of it lists nothing it names, so the things it names are unknown rather than absent." : !w.heldWhole ? "Only its passages about this search were read, so what it carries elsewhere is unknown rather than absent." : !w.materialWhole ? "Its sourced passages do not cover the whole read, so other material remains unknown rather than absent." : "",
    ...w.observations.map((o) => `Research candidate about the supplied passages, not whole-page absence or factual authority: ${o.text} Its own words: "${o.quote}"`)].filter(Boolean).join(" "));
const LABEL: Readonly<Record<CompetitorKind, string>> = { commercial_competitor: "a business selling what this account sells", citation_authority: "a source assistants quote", publisher: "a publisher covering these topics", marketplace_directory: "a marketplace or directory", government_educational: "a government or school source", social_community: "a social platform", owned: "this account's own site", irrelevant_unknown: "a site whose part here is not settled" };
export const comparisonObservations = (c: JobComparison): ComparisonObservation[] => c.winners.flatMap((w) => w.observations);
export const comparisonTopics = (c: JobComparison): { topic: string; url: string }[] => c.winners.flatMap((w) =>
  w.observations.filter((o) => o.kind === "answers" && o.topic).map((o) => ({ topic: tidy(o.topic!), url: w.url }))).filter((t) => t.topic.length > 2);
export const withObservations = (c: JobComparison, by: ReadonlyMap<string, ComparisonObservation[]>): JobComparison => {
  const winners = c.winners.map((w) => ({ ...w, observations: (by.get(w.url) ?? []).slice(0, MAX_OBSERVATIONS) }));
  return { ...c, winners, verdict: verdictOf(winners, c.owned) };
};
