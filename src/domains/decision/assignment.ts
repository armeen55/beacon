import { AEO_BAR } from "./accept-worthy";
import "server-only";
import { FURNITURE_LABEL, topicTokens } from "@/domains/evidence/relevance-gate";
import { EDITOR_SHARED, type EditorField, type SourcePacket } from "./drafted-copy";
import { editorialStandard } from "./proof";
import type { ChangeProposal } from "./contracts";
type Assignment = NonNullable<ChangeProposal["assignment"]>;
const WIDTH: Readonly<Record<string, { px: number; chars: number }>> = { title: { px: 600, chars: 60 }, meta: { px: 920, chars: 155 }, h1: { px: 920, chars: 70 } };
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
  const backed = (t: string): boolean => {
    const w = topicTokens(t);
    return w.length === 0 || facts.some((id) => {
      const said = new Set(topicTokens(packet.evidence[id] ?? ""));
      return w.filter((x) => said.has(x)).length * 2 >= w.length;
    });
  };
  const standard: ReturnType<typeof editorialStandard> = WIDTH[field] ? "summary"
    : kind === "false_page_promise" ? "repositioning"
    : packet.treatment === "structural_synthesis" || kind === "scattered_answer" || kind === "weak_extractability" ? "restructuring"
    : kind === "stale_fact" ? "correction"
    : "missing_answer";
  const ownWords = new Set(topicTokens([packet.bodyText, packet.headings.join(" "), packet.title ?? "", packet.h1 ?? ""].join(" ")));
  const supported = (t: string): boolean => {
    if (backed(t)) return true;
    if (standard !== "summary" && standard !== "restructuring" && standard !== "repositioning") return false;
    const w = topicTokens(t);
    return w.length > 0 && w.filter((x) => ownWords.has(x)).length * 2 >= w.length;
  };
  const base = { page: packet.targetUrl, standard, gapKind: kind,
    ...(packet.reading?.missing?.trim() ? { pageMissing: packet.reading.missing.trim() } : {}),
    ...((packet.reading?.sells ?? []).length > 0 ? { sells: [...packet.reading!.sells] } : {}),
    propositions: props, diagnosedGap: gap,
    intent: [...new Set([...(packet.comparison?.queries ?? []), packet.trackedQuestion ?? "", ...(packet.demand.unanswered ?? [])])].filter((x): x is string => !!x).slice(0, 6),
    facts: facts.map((id, i) => ({ id, says: (packet.checkedSentences ?? [])[i] ?? "" })),
    observations: (packet.comparison?.winners ?? []).flatMap((w) => w.observations.map((o) => ({ publisher: w.publisher, publisherClass: w.publisherClass, kind: o.kind, text: o.text, quote: o.quote }))).slice(0, 12),
    keep: (packet.comparison?.keep ?? []).slice(0, 4),
    ...(rewrite?.replaces?.trim() ? { replaces: rewrite.replaces.trim() } : {}),
    pageContext: ctx,
    forbidden: props.filter((t) => !supported(t)),
    rivals, briefing, ...(owed ? { owed } : {}),
  };
  const deliver = props.filter(supported);
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
  const lead = (packet.checkedSentences ?? []).map((t) => t.trim()).filter(Boolean);
  const passages = ids.filter((id) => /^page-copy-/.test(id)).map((id) => packet.evidence[id] ?? "");
  const qStems = new Set(topicTokens(packet.trackedQuestion ?? ""));
  const backedProps = props.filter(backed);
  const sentences = passages.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim())).filter(Boolean);
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
  const relevant = sentences.map(unhead)
    .filter((x) => x.length >= 20 && /[.!?]$/.test(x) && EDITOR_SHARED.placeable(x) && !EDITOR_SHARED.BREADCRUMB.test(x) && !railLed(x))
    .map((x) => ({ x, n: topicTokens(x).filter((w) => wanted.has(w)).length }))
    .filter((y) => y.n > 0).sort((a, b) => b.n - a.n)[0] ?? null;
  const heading = [packet.h1, packet.title, ...packet.headings].find(EDITOR_SHARED.placeable) ?? null;
  const shape = rewrite ? "exact_replacement" as const
    : backedProps.length > 0 && (kind === "missing_answer" || kind === "incomplete_answer") && backedProps.every(carriedByOne) ? "no_change" as const
    : kind === "scattered_answer" || kind === "weak_extractability" ? "direct_answer" as const
    : backedProps.length === 0 || backedProps.length >= 3 ? "section" as const
    : relevant || (backedProps.length > 0 && heading) ? "inline_addition" as const
    : "direct_answer" as const;
  const packetShape = AEO_BAR.applies(field, standard, packet.unpublished, rewrite && kind === "scattered_answer" ? "restructure" : shape, packet.trackedQuestion ?? "");
  const cap = packetShape ? 0 : shape === "inline_addition" ? 2
    : shape === "direct_answer" ? 3
    : shape === "exact_replacement" ? (rewrite?.replaces ?? "").split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0).length + 1
    : 0;
  const anchor = shape === "no_change" ? null
    : shape === "inline_addition" ? relevant?.x ?? heading
    : shape === "exact_replacement" ? rewrite?.heading ?? heading
    : heading;
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
    format: packetShape ? `${AEO_BAR.policy} Keep what is true, add the improvement the completion test below names, and cite a supporting fact for each new claim.` : shape === "no_change" ? EDITOR_SHARED.NO_CHANGE_SAYS
      : shape === "exact_replacement" ? `at most ${cap} sentences standing exactly where the replaced words stand: keep what the passage says that is true, add the improvement the completion test below names, cite a supporting fact for any statement the page does not already carry, and write no heading`
      : shape === "section" ? "a descriptive heading, then the smallest complete treatment this gap takes, and no introduction, conclusion or summary of the page"
      : shape === "inline_addition" ? "one or two sentences that land inside the page's existing prose with NO heading of their own: lead with the missing information, repeat no background to add length, and stop once the gap is answered"
      : "one to three sentences a reader could lift whole, with NO heading of their own: lead with the missing information, never summarise the page, and stop once the gap is answered",
    mustLeadWith: (lead.length > 0 ? `${lead.join("; ")} (in plain words, naming the subject the way this page names it and never the way the search phrases it, then say with whom or when only if a cited fact says so).`
      : "the answer itself, in sentences of your own. Nothing checked is on file behind this gap, so the only ground you have is what this page's own passages already establish about the subject: draw the answer out of them rather than restating any one of them, state no figure or claim past them, and say what is still owed in your limitations.") + " No line may restate another line.",
    mayReuse: standard === "restructuring" || standard === "repositioning" ? "every passage, entry and figure this page already publishes: assembling what they say into one place a reader can lift IS the job of this edit, in the page's own words"
      : "one or two of the page's own entries or figures, named exactly as the page writes them, as the example the new statement stands on",
    mustPreserve: `every existing heading, entry, meaning, link, product, image and call to action${rewrite ? " OUTSIDE the passage named above, which this copy rewrites where it stands" : ""}, and every passage carrying a search this page earns clicks on: nothing else on the page is deleted or rewritten${(packet.reading?.sells ?? []).length > 0 ? `. This page sells, and these are the things it sells and the actions it asks for, every one of which must still be there afterwards: ${packet.reading!.sells.join("; ")}` : ""}`,
    mustNotRepeat: rewrite ? "the page's own entries, meanings, headings and examples that STAY on the page: the passage named above is the one thing this copy carries over, and only the part of it that is true"
      : standard === "restructuring" || standard === "repositioning" ? "how this page arranges its material: name the things a reader asked for, never the headings, sections, lists or categories they sit in"
      : "the page's own entries, meanings, headings and examples: a reader is already looking at them, and copy that restates them is refused however well it reads",
    placement: shape === "exact_replacement" ? "replacement" as const : "additive" as const,
    completionTest: `a reader who came for "${base.intent[0] ?? gap}" can finish that task on this copy alone and could not have on the page before: ${deliver.join("; ") || "the smallest complete answer this page's own passages and the checked facts on file can give it"}. How this page is arranged is never that answer.`,
  };
};
const worksFromThePage = (a: Assignment): boolean => a.standard !== "missing_answer" && a.standard !== "correction";
const assignmentLines = (a: Assignment): string[] => [
  `THE ASSIGNMENT. Every id below is context for it${worksFromThePage(a) ? ", and the page's own words are the material this edit works from" : ", and the page's own words are never the subject of the new copy"}.`,
  `THE PAGE: ${a.page}`,
  `THE TREATMENT: ${a.treatment}`,
  `THE STANDARD THIS WORK IS JUDGED BY, and the only editorial rule that applies to it: ${STANDARDS[a.standard ?? "missing_answer"]}`,
  `DIAGNOSED GAP (${a.gapKind}), which is the whole assignment: ${a.diagnosedGap}${/[.!?]$/.test(a.diagnosedGap.trim()) ? "" : "."}${a.gapKind === "incomplete_answer" ? " That gap is a READING OF THE PAGES ALREADY WINNING THIS SEARCH, so it is a hypothesis about what this page could carry (a section, an arrangement, an answer a reader can lift) and never a fact of its own: state a new fact only where a supporting fact below carries it, otherwise cover the subject from what is on file and say in your limitations what a source still owes." : ""}`,
  `WHAT A READER MUST KNOW AFTERWARDS: ${a.propositions.filter((t) => !a.forbidden.includes(t)).join("; ") || (a.intent[0] ? `the answer to "${a.intent[0]}"` : a.diagnosedGap)}`,
  `THE SEARCHES THIS COPY IS AIMED AT, as targeting and never as evidence: ${a.intent.join("; ") || "none on file"}`,
  `OPEN LIKE THIS: ${a.opening}`,
  `OUTPUT FORMAT: ${a.format}`,
  `MUST LEAD WITH, in your first sentence, in plain public English: ${a.mustLeadWith}`,
  `SUPPORTING FACTS you may state and must cite: ${(a.facts ?? (a.supportingFacts ?? []).map((id) => ({ id, says: "" }))).map((f) => (f.says ? `${f.id} says ${f.says}` : f.id)).join("; ") || "none"}`,
  `PAGE CONTEXT, for tone, placement, what to preserve and what not to repeat${worksFromThePage(a) ? ", and it is the material this edit works from" : ", never material for the new copy"}: ${a.pageContext.join(", ") || "none"}`,
  ...(a.pageMissing ? [`WHAT A READING OF THIS PAGE SAYS A READER STILL CANNOT GET HERE, which is the shortfall your copy has to close rather than the search string: ${a.pageMissing}`] : []),
  ...((a.sells ?? []).length > 0 ? [`WHAT THIS PAGE SELLS AND ASKS FOR, which your copy must leave standing and may lead a reader towards but never replaces: ${a.sells!.join("; ")}`] : []),
  ...(a.forbidden.length > 0 ? [`NAMED BY THE DIAGNOSIS AND CARRIED BY NOTHING CHECKED, so it is a subject to cover from what IS on file and never a statement of your own: ${a.forbidden.join("; ")}`] : []),
  ...(a.rivals.length > 0 ? [`THE PAGES THAT ALREADY WIN THIS SEARCH (${a.rivals.join(", ")}), read for the subjects they carry and this page does not, which choose the shape and the subjects of this copy and are never a fact you may state: ${[...new Set((a.observations ?? []).map((o) => `"${o.quote}" (${o.publisher}, ${LABELLED_CLASS[o.publisherClass] ?? o.publisherClass})`))].join("; ") || "read but naming nothing this page lacks"}`] : []),
  ...(a.briefing.length > 0 ? [`WHAT THE RESULTS PAGE ITSELF ANSWERS TODAY (${a.briefing.join(", ")}), which no claim may ever cite`] : []),
  ...((a.keep ?? []).length > 0 ? [`WHAT THIS PAGE ALREADY ANSWERS AND MUST KEEP, in its own words: ${a.keep!.map((k) => `"${k}"`).join(" ")}`] : []),
  ...(a.replaces ? [`THE EXACT PASSAGE THIS COPY REPLACES, verbatim: "${a.replaces}"`] : []),
  `MAY REUSE: ${a.mayReuse}`,
  `MUST PRESERVE: ${a.mustPreserve}`,
  `MUST NOT REPEAT: ${a.mustNotRepeat}`,
  `PLACEMENT: ${a.placement === "field" ? "it REPLACES this page's own line and lands nowhere else: it is not a section, it has no heading, and it names no place on the page" : a.placement === "replacement" ? "it replaces the passage named above and nothing else" : a.shape === "inline_addition" || a.shape === "direct_answer" ? `your sentences land directly after "${a.anchor ?? ""}", inside the copy that is already there. Return that exact wording as placementAnchor and return naturalHeading as null: this shape has no outer heading; follow OUTPUT FORMAT for headings inside finalCopy` : "a new section after an existing heading; it replaces nothing"}`,
  ...(a.owed ? [`WHAT THIS ROW STILL OWES FROM ITS LAST ATTEMPT: ${a.owed}`] : []),
  `COMPLETION TEST: ${a.completionTest}`,
];
const STANDARDS: Readonly<Record<ReturnType<typeof editorialStandard>, string>> = {
  summary: 'THIS EDIT IS A SUMMARY LINE (a title, a heading or a description) AND SUMMARISING THE PAGE IS THE WHOLE JOB, which decides "improvesPage" and "wouldHandToCustomer" TOGETHER. Judge it as a searcher reading a result: does it communicate what this page actually answers, in the words someone would search, better than the line it replaces? IT OWES NO NEW INFORMATION: a faithful description of the page IS correct, and it is never marked down for adding nothing the page lacks. Form is free where it serves the reader: a noun phrase with no verb, a definition, a line carrying a colon, a question a reader really asks, and a restrained invitation that follows a real statement are all fine, and none is required. TWO THINGS STILL HOLD. It must BEAT the line it replaces, and it must be about THIS page: if the same sentence would be true of a sibling page with only the place, product, organism, person or period swapped in, improvesPage is FALSE however fluent it reads, and a line whose only content is praise, atmosphere, popularity, growth or a superlative distinguishes nothing.',
  missing_answer: 'THIS EDIT SUPPLIES THE DIAGNOSED MISSING ANSWER, so "improvesPage" asks whether it states the specific fact, number, date, comparison, definition, named entity or answer the page does not already carry IN ANY FORM, and your notes must then name that addition in plain words. A new factual assertion needs support from the evidence shown to you; smoother prose over the same ground is FALSE, and so is restating the page own opening, list or headings however well written. THE ANSWER IS WRITTEN FOR A READER AND NOT FOR A SEARCH BOX: never open with the search phrase standing as a label or a headword in front of a colon, name the subject the way a reader names it, and let the sentence itself carry the answer.',
  restructuring: 'THIS EDIT MAKES INFORMATION THE PAGE ALREADY CARRIES MATERIALLY EASIER TO FIND OR UNDERSTAND, so it owes NO outside fact and "improvesPage" is decided on FORM. TRUE when the page own words scatter this answer across separate passages, sections or an FAQ and this copy assembles it in one place a reader or an assistant can lift, and your notes must then NAME what can now be lifted whole. THERE IS NO REQUIRED LENGTH: one sentence that finally states the answer outright is a complete treatment, and a line count is not a standard. FALSE when the page already presents the same answer in one place. Asking this edit for an outside source is asking it to be a different kind of edit. THE COPY NAMES THE THINGS THE READER ASKED FOR AND NEVER HOW THIS PAGE ARRANGES THEM: a sentence whose main clause groups, lists, divides, sorts or presents its subject describes the container, and a reader who asked what those things are learns nothing from it.',
  repositioning: 'THIS EDIT REPOSITIONS A PAGE WHOSE TITLE PROMISES SOMETHING ITS OWN PASSAGES DO NOT DELIVER, so "improvesPage" asks ONE thing: does this copy say what the page really gives a reader today, in the words someone searching would use? IT OWES NO OUTSIDE FACT AND IT MAY NOT INVENT AN ENTRY: naming a subject, an item or a section the page does not carry is the exact failure this edit exists to end, and adding information the page lacks is a different kind of edit. Its subject is what the page delivers, so a sentence describing what is here is CORRECT and is never marked down as talking about the page. TRUE when a reader who wanted the promise now knows what they will actually get and can decide; FALSE when it repeats the promise, hedges it, or claims coverage the material shown does not carry.',
  correction: 'THIS EDIT IS THE SMALLEST JUSTIFIED REPAIR OF ONE WRONG STATEMENT, so "improvesPage" asks whether the exact wrong assertion is replaced by the smallest supported wording that can stand where it stands. TRUE when the corrected statement is carried by the evidence shown and everything true around it survives; FALSE when it rewrites more than the mistake, drops a passage the page earns its readers on, or rests on nothing shown to you.',
  internal_link: 'THIS EDIT IS ONE INTERNAL LINK, WHICH IS NAVIGATION AND NOT A NEW ANSWER: decide "improvesPage" on the ROUTE it creates, never on new facts. TRUE when this page gains a relevant route to a different page of the same site that it does not already link to, the sentence sits naturally where it lands, the anchor honestly names what the destination covers, and a reader at that spot plausibly wants to go there next. Your notes must then name the navigational utility in the reader own terms. FALSE for a link the page already has, a link to itself, an unrelated destination, a spot the sentence does not fit, or an invitation that names no destination. Requiring a new fact of a link is the one thing that would make every honest link impossible.',
  structured_data: 'THIS EDIT IS STRUCTURED DATA AND ITS TRUTH IS WHETHER IT REPRESENTS CONTENT A READER CAN ACTUALLY SEE ON THIS PAGE, which its own structural validator decides. No word of it is judged as prose, and no editorial preference applies to it at all.' };
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

export const ASSIGNMENT_EDITOR = { width: WIDTH, standards: STANDARDS, lines: assignmentLines };
