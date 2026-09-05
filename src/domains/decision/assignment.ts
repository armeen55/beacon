import "server-only";
/** decision/assignment - THE ONE OBJECT A BODY EDIT IS WRITTEN, JUDGED, PROMOTED AND RE-READ FROM, lifted whole out of the
 *  editor file (campaign, 2026-09-05) so the envelope every door reads has one home and the editor keeps its ceiling. Nothing
 *  here calls a model, reads a store or knows a tenant: an assignment is derived from the packet the pass already built.
 *
 *  THE EIGHT THINGS IT CARRIES, and it carries nothing else: the reader's task (the intent group's own phrasings), the
 *  diagnosed gap as propositions, the treatment, the owned passage and the placement it lands at, the competitor
 *  observations with their quotes and publisher classes, the checked facts a claim may cite, the owned material that stays,
 *  and the improvement to deliver in one sentence. */
import { FURNITURE_LABEL, topicTokens } from "@/domains/evidence/relevance-gate";
import { EDITOR_SHARED, type EditorField, type SourcePacket } from "./drafted-copy";
import { editorialStandard } from "./proof";
import type { ChangeProposal } from "./contracts";
/** THE DIAGNOSIS IS THE WHOLE ASSIGNMENT AND THE PAGE IS ITS BOUNDARY (operator, 2026-09-01). Handed one line of diagnosis and twelve lines of the page's own words, told to "refine the target the team agreed" (its own previous failed draft) and given a shape derived from the QUERY ("phrases" reads as examples: list them), the writer did the only thing that packet asked for and listed the page's phrases four times running. Nothing was wrong with the writer. One typed envelope now says what must be added, what may only be looked at, and what a reader must know afterwards, and the reviewer reads the same envelope. Universal: a habitat gap, a history, a usage rule or a missing answer all fill the same nine fields. */
/** THE ENVELOPE IS THE CONTRACT'S OWN FIELD, so the writer, the evaluator, the promotion door and the banked re-read cannot drift into three shapes of the same idea: one type, stored on the row, re-read rather than re-derived. */ export type Assignment = NonNullable<ChangeProposal["assignment"]>;
/** WHAT A SUMMARY FIELD OWES, AS THE ENGINE ACTUALLY RENDERS IT. Google truncates a title link at roughly 600 pixels and a description at roughly 920 on a desktop result and 680 on a phone, and it prefers whatever description best answers the search, rewriting a title it judges poor: so the budget is stated as the WIDTH that gets read, with the character shape that width buys at ordinary letter widths, rather than as a count nobody measured. Live on this account, 116 of 224 descriptions run past that shape and 51 sit under 120 characters, and the rival median for these searches is 159. */ export const WIDTH: Readonly<Record<string, { px: number; chars: number }>> = { title: { px: 600, chars: 60 }, meta: { px: 920, chars: 155 }, h1: { px: 920, chars: 70 } };
/** A PAGE'S OWN SCRIPT IS NOT A LANGUAGE LESSON (campaign review, 2026-09-05). This fired on one Unicode block and told the writer to "write every Persian word in Persian script", which named a language the page never declared, called Arabic, Urdu and Pashto text Persian, and reached a model prompt as a fact about the account. What is actually true of any page, in any language, is the RULE: a page that writes some of its words in a script other than the Latin alphabet keeps writing them that way, and a page that also romanizes them has already chosen a spelling. No language is named, and none is inferred. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
/** ONE NORMALIZED ASSIGNMENT PER ROW (operator, 2026-09-02): the page, the treatment, the typed gap and its propositions, the intent cluster, the evidence a claim may name, the propositions no fact supports and which therefore may not be stated at all, what stays untouched, the rival pages, the briefing lines no claim may ever cite, the output shape, the opening the treatment owes, and whatever the row still owes from its last attempt. Built once where the copy is written and stored on the row, so the writer, the reviewer, the promotion door and the replay read one object instead of four reconstructions of it. */
export const assignmentOf = (packet: SourcePacket, rewrite: { replaces: string; heading?: string | null } | null, field: EditorField, owed: string | null = null): Assignment | null => {
  const props = packet.gap?.propositions ?? [];
  const gap = props.length > 0 ? props.join("; ") : (packet.diagnosedProblem?.trim() ?? "");
  // a link sentence keeps its own anchor contract, which names the destination and the exact spot
  if (!gap || field === "internal_link") return null;
  const ids = Object.keys(packet.evidence);
  const facts = ids.filter((id) => id.startsWith("fact-"));
  const ctx = ids.filter((id) => EDITOR_SHARED.OWN_PAGE_ID.test(id) || id.startsWith("owned-page"));
  const rivals = ids.filter((id) => id.startsWith("rival-"));
  const briefing = ids.filter((id) => id.startsWith("serp-"));
  const kind = packet.gap?.kind ?? "no_substantive_gap";
  /* A PROPOSITION NOTHING CHECKED CARRIES MAY NOT BE STATED AT ALL: naming it in the gap is what sends the runtime to research it, and saying it anyway is the one way a diagnosed gap turns into an invented fact. ONLY A CHECKED, AUTHORIZED STATEMENT BACKS ONE (reviewer, 2026-09-02): another page of this same account counted as support, so a proposition with zero checked facts behind it lost its NAMED BUT UNSUPPORTED line while the same envelope said nothing checked was on file. A sibling page is context and material to preserve, and a claim may still cite it; it is not a source. */
  const backed = (t: string): boolean => {
    const w = topicTokens(t);
    return w.length === 0 || facts.some((id) => {
      const said = new Set(topicTokens(packet.evidence[id] ?? ""));
      return w.filter((x) => said.has(x)).length * 2 >= w.length;
    });
  };
  /* WHAT COUNTS AS SUPPORT DEPENDS ON THE STANDARD, AND ONLY THE STANDARD (operator, 2026-09-05). One rule refused any proposition no CHECKED fact carried, so a summary was forbidden from saying what its own page says and a restructuring was forbidden from stating the very answer it exists to surface: both were told to go and buy an outside source for material already on the page, which is asking them to be a different kind of edit. For a summary and a restructuring the page's own stored words are the support; for a missing answer and a correction they are not, and nothing changes. */
  /* A PAGE THAT PROMISES WHAT IT NEVER DELIVERS OWES THE PROMISE KEPT, NOT AN INVENTED ENTRY (reviewer D1-c, 2026-09-05): a false promise fell to the missing-answer standard, which orders the copy to state information the page does not carry, which on a directory-style promise with no entries is an order to invent them. Its own standard says what the operator rule says: reposition the page for what it does today. */
  const standard: ReturnType<typeof editorialStandard> = WIDTH[field] ? "summary"
    : kind === "false_page_promise" ? "repositioning"
    : packet.treatment === "structural_synthesis" || kind === "scattered_answer" || kind === "weak_extractability" ? "restructuring"
    : kind === "stale_fact" ? "correction"
    : "missing_answer";
  const ownWords = new Set(topicTokens([packet.bodyText, packet.headings.join(" "), packet.title ?? "", packet.h1 ?? ""].join(" ")));
  const supported = (t: string): boolean => {
    if (backed(t)) return true;
    if (standard !== "summary" && standard !== "restructuring") return false;
    const w = topicTokens(t);
    return w.length > 0 && w.filter((x) => ownWords.has(x)).length * 2 >= w.length;
  };
  const base = { page: packet.targetUrl, standard, gapKind: kind,
    ...(packet.reading?.missing?.trim() ? { pageMissing: packet.reading.missing.trim() } : {}),
    ...((packet.reading?.sells ?? []).length > 0 ? { sells: [...packet.reading!.sells] } : {}),
    propositions: props, diagnosedGap: gap,
    /* THE READER'S TASK IS THE GROUP, NOT ONE STRING (campaign, 2026-09-05): the diagnosis groups every way a reader asks one thing and the comparison reads the winners of all of them, so the writer is aimed at the group rather than at whichever phrasing the card happened to be minted under. */
    intent: [...new Set([...(packet.comparison?.queries ?? []), packet.trackedQuestion ?? "", ...(packet.demand.unanswered ?? [])])].filter((x): x is string => !!x).slice(0, 6),
    /* THE ID AND THE SENTENCE BEHIND IT TOGETHER, replacing the id list that told a writer what it could cite and never what those ids say. */
    facts: facts.map((id, i) => ({ id, says: (packet.checkedSentences ?? [])[i] ?? "" })),
    observations: (packet.comparison?.winners ?? []).flatMap((w) => w.observations.map((o) => ({ publisher: w.publisher, publisherClass: w.publisherClass, kind: o.kind, text: o.text, quote: o.quote }))).slice(0, 12),
    keep: (packet.comparison?.keep ?? []).slice(0, 4),
    ...(rewrite?.replaces?.trim() ? { replaces: rewrite.replaces.trim() } : {}),
    pageContext: ctx,
    forbidden: props.filter((t) => !supported(t)),
    rivals, briefing, ...(owed ? { owed } : {}),
  };
  const w = WIDTH[field];
  const seen = packet.serpLead ? `, leading with "${packet.serpLead}" where that reads naturally, because the titles a searcher already sees for this search name the subject that way: it is vocabulary and intent, never a template your sentence must copy, and an entity-first opening that answers the search is welcome` : "";
  // A SUMMARY IS NOT A SECTION (Google's snippet guidance; operator, 2026-09-02). The body envelope was attached to every kind, so a description was told to place new copy after an existing heading and the reviewer marked it against a placement it can never have.
  if (w) return {
    ...base,
    treatment: "field" as const,
    opening: `name the subject as this page names it${seen}, then the one thing the page answers`,
    format: `one natural line a person would publish, inside the ${w.px} pixel budget the engine renders before it truncates, which is about ${w.chars} characters at ordinary letter widths`,
    mustLeadWith: `the subject this page is about, named as the page names it${seen}, then the one thing the page answers`,
    mayReuse: "the page's own subject, headings and stored copy: summarising them IS the job of this field",
    mustPreserve: `every word of the current line that this page still earns clicks on, and the ${w.px} pixel budget the engine renders before it truncates, which is about ${w.chars} characters at ordinary letter widths`,
    mustNotRepeat: "the page's own markup: never describe the title, the heading or the sections, and never say the subject is on this site, which tells a searcher nothing",
    placement: "field" as const,
    completionTest: `a searcher reading this line alone knows what this page answers and why to open it rather than the ${packet.demand.preserve.length > 0 ? "pages already ranking above it" : "next result"}`,
  };
  /* EVERY BODY ROW CARRIES ITS ASSIGNMENT (reviewer, 2026-09-02): returning null where the packet held no checked fact left the card with no opening, no completion test and no forbidden list, so the evaluator marked it against nothing and the stored research row said nothing about what it was for. With no fact on file every proposition is unsupported by construction, which `backed` above already reports, and the envelope says so out loud. */
  const lead = (packet.checkedSentences ?? []).map((t) => t.trim()).filter(Boolean);
  /* THE SENTENCE COMES FROM THE PACKET, NOT OUT OF ITS OWN PROSE (measured, 2026-09-05): this read `evidence[id].split(" \u2014 ")[0]`, and the em dash that separator names left the evidence string on 2026-09-04, so the split returned the WHOLE entry and every body row drafted since was ordered to lead with source addresses, quotations and a confidence rating. The packet now carries the readings' own sentences under the same fact ordering. */
  const script = NON_LATIN_LETTER.test(packet.bodyText) ? " Some words on this page are written in a script other than the Latin alphabet: write those words in the script the page writes them in, and where a word is also romanized, spell the romanization the way this page already spells it rather than in a scholar's notation." : "";
  /* THE SMALLEST COMPLETE TREATMENT, DERIVED FROM THE PAGE AND THE GAP (operator, 2026-09-02): a page with no prose at all cannot take an inline sentence, a page whose own passage already carries every backed proposition takes NOTHING, and one missing fact inside a real passage takes one sentence rather than a headed block. Never a universal word count, never the query shape alone, never a special case for a page. */
  const passages = ids.filter((id) => /^page-copy-/.test(id)).map((id) => packet.evidence[id] ?? "");
  const qStems = new Set(topicTokens(packet.trackedQuestion ?? ""));
  const backedProps = props.filter(backed);
  const sentences = passages.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim())).filter(Boolean);
  /* ONE SENTENCE HAS TO SAY IT, NEVER ONE CHUNK (reviewer, 2026-09-03): the crawler stores a page as one whitespace-normalized run cut into thousand-character passages, so containment inside a passage is not the page asserting anything. "Owners often ask whether the digits changed after 2004. The archive does not say." carries every word of the proposition and answers none of it. */
  const carriedByOne = (t: string): boolean => {
    const d = topicTokens(t).filter((w) => !qStems.has(w));
    return d.length > 0 && sentences.some((x) => {
      const said = new Set(topicTokens(x));
      return !EDITOR_SHARED.ASKS_OR_DENIES.test(x) && d.every((w) => said.has(w));
    });
  };
  const wanted = new Set([...qStems, ...props.flatMap((t) => topicTokens(t))]);
  const heads = packet.headings.map((h) => h.replace(/\s+/g, " ").trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const railLed = (x: string): boolean => EDITOR_SHARED.FURNITURE_RUN.test(x) || x.split(/\s+/).slice(0, 12).some((_, i, w) => FURNITURE_LABEL.test(w.slice(0, i + 1).join(" ")));
  const unhead = (x: string): string => { const h = heads.find((y) => x.toLowerCase().startsWith(y.toLowerCase())); return h ? x.slice(h.length).trim() : x; };
  /* THE SENTENCE WITH THE MOST OVERLAP IS THE ANCHOR, and it has to be PROSE a person can find (reviewer, 2026-09-03). The crawler stores one flat run, so a heading runs straight into the prose after it and five headings arrive as one fragment: an exact heading match caught neither. A fragment now has to END like a sentence and sit inside the anchor cap, a stored heading on its front is STRIPPED rather than taking the only real sentence on the page down with it, and a content rail anywhere in it or a single furniture word on its front disqualifies it, and so does any breadcrumb separator. A page left with none takes the direct answer under its own h1, whatever the run's length. */
  const relevant = sentences.map(unhead)
    .filter((x) => x.length >= 20 && /[.!?]$/.test(x) && EDITOR_SHARED.placeable(x) && !EDITOR_SHARED.BREADCRUMB.test(x) && !railLed(x))
    .map((x) => ({ x, n: topicTokens(x).filter((w) => wanted.has(w)).length }))
    .filter((y) => y.n > 0).sort((a, b) => b.n - a.n)[0] ?? null;
  const heading = [packet.h1, packet.title, ...packet.headings].find(EDITOR_SHARED.placeable) ?? null;
  const shape = rewrite ? "exact_replacement" as const
    : backedProps.length > 0 && (kind === "missing_answer" || kind === "incomplete_answer") && backedProps.every(carriedByOne) ? "no_change" as const
    : kind === "scattered_answer" || kind === "weak_extractability" ? "direct_answer" as const
    : backedProps.length === 0 || backedProps.length >= 3 ? "section" as const
    : relevant ? "inline_addition" as const
    : "direct_answer" as const;
  const cap = shape === "inline_addition" ? 2
    : shape === "direct_answer" ? 3
    : shape === "exact_replacement" ? (rewrite?.replaces ?? "").split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0).length + 1
    : 0;
  const anchor = shape === "no_change" ? null
    : shape === "inline_addition" ? relevant?.x ?? heading
    : shape === "exact_replacement" ? rewrite?.heading ?? heading
    : heading;
  /* THE OPENING THE TREATMENT OWES, AND ONLY THE TREATMENT (research, 2026-09-02; scoped by the reviewer, 2026-09-02): entity-first openings are backed for DEFINITIONAL work and for nothing else, and the default branch was pointing every ordinary missing answer at the page's own heading, which is container narration the self-pointer gate then refuses. So a comparison opens on the distinction, a procedure on the action, scattered material on the one liftable sentence, a correction on the corrected statement, a definition on the thing being defined, and everything else on the answer itself. The entity is the PROPOSITION's own subject, never the page's title, and a plural category takes a different copula from a single entity. */
  const defining = /^(?:what|who)\s+(?:is|are|was|were)\b|\b(?:meanings?|definitions?)\b/i.test(props[0] ?? "");
  const entity = (props[0] ?? "").replace(/^(?:what|who)\s+(?:is|are|was|were)\s+(?:an?|the)?\s*/i, "").replace(/\s*\b(?:meanings?|definitions?)\b\s*$/i, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\?+$/, "").trim();
  const plural = /s$/i.test(entity.split(/\s+/).at(-1) ?? "");
  const opening = kind === "missing_comparison" ?"open on the distinction itself: say in the first sentence what separates the things being compared, then take them one at a time"
    : kind === "missing_procedure" ? "open on the action: the first sentence says what a reader does first, then the steps in the order they are done"
    : kind === "stale_fact" ? "open on the corrected statement, worded so it can stand exactly where the wrong one stands today"
    : kind === "scattered_answer" || kind === "weak_extractability" ? "open with the whole answer in one self-contained sentence a reader could lift on its own, then give it the structure the page lacks"
    : kind === "missing_evidence" ? "open on the fact and name the source it stands on in the same breath"
    : defining && entity ? `open by defining what is being asked about: "${entity}" ${plural ? "are, or include" : "is, was or refers to"}, then what the reader came to know`
    : `open with the direct answer in one self-contained sentence: say the thing itself, not that this page covers it, and never name the page or its headings`;
  return {
    ...base,
    shape,
    anchor,
    ...(cap > 0 ? { maxSentences: cap } : {}),
    opening: shape === "inline_addition" || shape === "direct_answer" ? `${opening}. Never open with a bare "Yes" or "No": that is a reply to a question, and this copy is a sentence standing on the page.` : opening,
    treatment: shape === "section" ? "section" as const
      : shape === "exact_replacement" ? (kind === "scattered_answer" ? "restructure" as const : "replacement" as const) : "answer_block" as const,
    format: shape === "no_change" ? EDITOR_SHARED.NO_CHANGE_SAYS
      : shape === "exact_replacement" ? `at most ${cap} sentences standing exactly where the replaced words stand: keep what the passage says that is true, add the improvement the completion test below names, cite a supporting fact for any statement the page does not already carry, and write no heading`
      : shape === "section" ? "a descriptive heading, then the smallest complete treatment this gap takes, and no introduction, conclusion or summary of the page"
      : shape === "inline_addition" ? "one or two sentences that land inside the page's existing prose with NO heading of their own: lead with the missing information, repeat no background to add length, and stop once the gap is answered"
      : "one to three sentences a reader could lift whole, with NO heading of their own: lead with the missing information, never summarise the page, and stop once the gap is answered",
    mustLeadWith: (lead.length > 0 ? `${lead.join("; ")} (in plain words, naming the subject the way this page names it and never the way the search phrases it, then say with whom or when only if a cited fact says so).`
      : "the one thing a reader gains here, in plain words. Nothing checked is on file behind this gap, so state only what the page's own words carry and say what is still owed in your limitations.") + `${script} No line may restate another line.`,
    mayReuse: "one or two of the page's own entries that contain the form you explain, named exactly as the page writes them, as examples of the rule",
    mustPreserve: `every existing heading, entry, meaning, link, product, image and call to action, and every passage carrying a search this page earns clicks on: nothing on the page is deleted or rewritten${(packet.reading?.sells ?? []).length > 0 ? `. This page sells, and these are the things it sells and the actions it asks for, every one of which must still be there afterwards: ${packet.reading!.sells.join("; ")}` : ""}`,
    mustNotRepeat: "the page's own entries, meanings, headings and examples: a reader is already looking at them, and copy that restates them is refused however well it reads",
    placement: shape === "exact_replacement" ? "replacement" as const : "additive" as const,
    completionTest: `after reading it, a reader knows this and could not have learned it from the page before: ${props.join("; ") || gap}`,
  };
};
export const assignmentLines = (a: Assignment): string[] => [
  `THE ASSIGNMENT. Every id below is context for it${a.standard === "missing_answer" || a.standard === "correction" ? ", and the page's own words are never the subject of the new copy" : ", and the page's own words are the material this edit works from"}.`,
  `THE PAGE: ${a.page}`,
  `THE TREATMENT: ${a.treatment}`,
  `THE STANDARD THIS WORK IS JUDGED BY, and the only editorial rule that applies to it: ${STANDARDS[a.standard ?? "missing_answer"]}`,
  `DIAGNOSED GAP (${a.gapKind}), which is the whole assignment: ${a.diagnosedGap}`,
  `WHAT A READER MUST KNOW AFTERWARDS: ${a.propositions.join("; ") || a.diagnosedGap}`,
  `THE SEARCHES THIS COPY IS AIMED AT, as targeting and never as evidence: ${a.intent.join("; ") || "none on file"}`,
  `OPEN LIKE THIS: ${a.opening}`,
  `OUTPUT FORMAT: ${a.format}`,
  `MUST LEAD WITH, in your first sentence, in plain public English: ${a.mustLeadWith}`,
  `SUPPORTING FACTS you may state and must cite: ${(a.facts ?? (a.supportingFacts ?? []).map((id) => ({ id, says: "" }))).map((f) => (f.says ? `${f.id} says ${f.says}` : f.id)).join("; ") || "none"}`,
  `PAGE CONTEXT, for tone, placement, what to preserve and what not to repeat, never material for the new copy: ${a.pageContext.join(", ") || "none"}`,
  ...(a.pageMissing ? [`WHAT A READING OF THIS PAGE SAYS A READER STILL CANNOT GET HERE, which is the shortfall your copy has to close rather than the search string: ${a.pageMissing}`] : []),
  ...((a.sells ?? []).length > 0 ? [`WHAT THIS PAGE SELLS AND ASKS FOR, which your copy must leave standing and may lead a reader towards but never replaces: ${a.sells!.join("; ")}`] : []),
  ...(a.forbidden.length > 0 ? [`NAMED BUT UNSUPPORTED, so it may not be stated at all: ${a.forbidden.join("; ")}`] : []),
  ...(a.rivals.length > 0 ? [`THE PAGES THAT ALREADY WIN THIS SEARCH (${a.rivals.join(", ")}), read for what they carry and this page does not, as shape and subject choice only: ${[...new Set((a.observations ?? []).map((o) => `${o.publisher}, ${LABELLED_CLASS[o.publisherClass] ?? o.publisherClass}`))].join("; ") || "read but naming nothing this page lacks"}`] : []),
  ...(a.briefing.length > 0 ? [`WHAT THE RESULTS PAGE ITSELF ANSWERS TODAY (${a.briefing.join(", ")}), which no claim may ever cite`] : []),
  ...((a.keep ?? []).length > 0 ? [`WHAT THIS PAGE ALREADY ANSWERS AND MUST KEEP, in its own words: ${a.keep!.map((k) => `"${k}"`).join(" ")}`] : []),
  ...(a.replaces ? [`THE EXACT PASSAGE THIS COPY REPLACES, verbatim: "${a.replaces}"`] : []),
  `MAY REUSE: ${a.mayReuse}`,
  `MUST PRESERVE: ${a.mustPreserve}`,
  `MUST NOT REPEAT: ${a.mustNotRepeat}`,
  `PLACEMENT: ${a.placement === "field" ? "it REPLACES this page's own line and lands nowhere else: it is not a section, it has no heading, and it names no place on the page" : a.placement === "replacement" ? "it replaces the passage named above and nothing else" : a.shape === "inline_addition" || a.shape === "direct_answer" ? `your sentences land directly after "${a.anchor ?? ""}", inside the copy that is already there. Return that exact wording as placementAnchor and return naturalHeading as null: this shape has no heading of its own` : "a new section after an existing heading; it replaces nothing"}`,
  ...(a.owed ? [`WHAT THIS ROW STILL OWES FROM ITS LAST ATTEMPT: ${a.owed}`] : []),
  `COMPLETION TEST: ${a.completionTest}`,
];
/** THE SIX EDITORIAL STANDARDS, ONE PER KIND OF WORK, IN THE SYSTEM MESSAGE WHERE THE UNIVERSAL RULES USED TO STAND (operator, 2026-09-05). A universal clause above ordered every edit to add information the page lacks and refused any verbless list, while a treatment table below excused a summary from both: an exception in a lower-priority message does not cancel a rule above it, and live descriptions were refused for adding nothing beyond paraphrase, which is the job of a description. The universal editorial rules and their compensating exceptions are deleted. What remains is the mechanical half, which every edit owes, and EXACTLY ONE standard, chosen by the PERSISTED assignment (proof `editorialStandard`) and never re-inferred from whichever evidence ids happen to be in the packet. Structured data reaches no evaluator: its truth is the canon's visible-content proof, which validate-proposal owns. */
export const STANDARDS: Readonly<Record<ReturnType<typeof editorialStandard>, string>> = {
  summary: 'THIS EDIT IS A SUMMARY LINE (a title, a heading or a description) AND SUMMARISING THE PAGE IS THE WHOLE JOB, which decides "improvesPage" and "wouldHandToCustomer" TOGETHER. Judge it as a searcher reading a result: does it communicate what this page actually answers, in the words someone would search, better than the line it replaces? IT OWES NO NEW INFORMATION: a faithful description of the page IS correct, and it is never marked down for adding nothing the page lacks. Form is free where it serves the reader: a noun phrase with no verb, a definition, a line carrying a colon, a question a reader really asks, and a restrained invitation that follows a real statement are all fine, and none is required. TWO THINGS STILL HOLD. It must BEAT the line it replaces, and it must be about THIS page: if the same sentence would be true of a sibling page with only the place, product, organism, person or period swapped in, improvesPage is FALSE however fluent it reads, and a line whose only content is praise, atmosphere, popularity, growth or a superlative distinguishes nothing.',
  missing_answer: 'THIS EDIT SUPPLIES THE DIAGNOSED MISSING ANSWER, so "improvesPage" asks whether it states the specific fact, number, date, comparison, definition, named entity or answer the page does not already carry IN ANY FORM, and your notes must then name that addition in plain words. A new factual assertion needs support from the evidence shown to you; smoother prose over the same ground is FALSE, and so is restating the page own opening, list or headings however well written. THE ANSWER IS WRITTEN FOR A READER AND NOT FOR A SEARCH BOX: never open with the search phrase standing as a label or a headword in front of a colon, name the subject the way a reader names it, and let the sentence itself carry the answer.',
  restructuring: 'THIS EDIT MAKES INFORMATION THE PAGE ALREADY CARRIES MATERIALLY EASIER TO FIND OR UNDERSTAND, so it owes NO outside fact and "improvesPage" is decided on FORM. TRUE when the page own words scatter this answer across separate passages, sections or an FAQ and this copy assembles it in one place a reader or an assistant can lift, and your notes must then NAME what can now be lifted whole. THERE IS NO REQUIRED LENGTH: one sentence that finally states the answer outright is a complete treatment, and a line count is not a standard. FALSE when the page already presents the same answer in one place. Asking this edit for an outside source is asking it to be a different kind of edit.',
  repositioning: 'THIS EDIT REPOSITIONS A PAGE WHOSE TITLE PROMISES SOMETHING ITS OWN PASSAGES DO NOT DELIVER, so "improvesPage" asks ONE thing: does this copy say what the page really gives a reader today, in the words someone searching would use? IT OWES NO OUTSIDE FACT AND IT MAY NOT INVENT AN ENTRY: naming a subject, an item or a section the page does not carry is the exact failure this edit exists to end, and adding information the page lacks is a different kind of edit. Its subject is what the page delivers, so a sentence describing what is here is CORRECT and is never marked down as talking about the page. TRUE when a reader who wanted the promise now knows what they will actually get and can decide; FALSE when it repeats the promise, hedges it, or claims coverage the material shown does not carry.',
  correction: 'THIS EDIT IS THE SMALLEST JUSTIFIED REPAIR OF ONE WRONG STATEMENT, so "improvesPage" asks whether the exact wrong assertion is replaced by the smallest supported wording that can stand where it stands. TRUE when the corrected statement is carried by the evidence shown and everything true around it survives; FALSE when it rewrites more than the mistake, drops a passage the page earns its readers on, or rests on nothing shown to you.',
  internal_link: 'THIS EDIT IS ONE INTERNAL LINK, WHICH IS NAVIGATION AND NOT A NEW ANSWER: decide "improvesPage" on the ROUTE it creates, never on new facts. TRUE when this page gains a relevant route to a different page of the same site that it does not already link to, the sentence sits naturally where it lands, the anchor honestly names what the destination covers, and a reader at that spot plausibly wants to go there next. Your notes must then name the navigational utility in the reader own terms. FALSE for a link the page already has, a link to itself, an unrelated destination, a spot the sentence does not fit, or an invitation that names no destination. Requiring a new fact of a link is the one thing that would make every honest link impossible.',
  structured_data: 'THIS EDIT IS STRUCTURED DATA AND ITS TRUTH IS WHETHER IT REPRESENTS CONTENT A READER CAN ACTUALLY SEE ON THIS PAGE, which its own structural validator decides. No word of it is judged as prose, and no editorial preference applies to it at all.' };
/** The publisher classes in the words a reader uses, so a brief never prints a raw slug at the writer. */
const LABELLED_CLASS: Readonly<Record<string, string>> = {
  commercial_competitor: "a business selling what this account sells",
  citation_authority: "a source assistants quote",
  publisher: "a publisher covering these topics",
  marketplace_directory: "a marketplace or directory",
  government_educational: "a government or school source",
  social_community: "a social platform",
  owned: "this account's own site",
  irrelevant_unknown: "a site whose part here is not settled",
};
