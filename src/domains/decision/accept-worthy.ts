import { z } from "zod";
import type { ChangeProposal } from "./contracts";
import { topicTokens } from "@/domains/evidence/relevance-gate";

const SELF_POINTER = /\b(?:covered|described|explained|shown|listed)\s+(?:in|on|here)\b|\b(?:shown|listed|given|provided)\s+(?:beside|alongside|next to)\s+each\b|\bthis (?:guide|page|article)\b|\bsee the\b|\bsections?\s+(?:below|above)\b|\bheadings?\s+below\b|\bthe page(?:['\u2019]s)?\b|\bhere (?:are|is)\b|\buse the [^.]{0,60}?\b(?:links?|categories)\b|\bas (?:shown|listed) (?:below|above)\b|\b(?:does not (?:show|explain|give|list|state)|is not (?:shown|listed|given|explained|stated)|the stored copy)\b|\b(?:is|are)\s+(?:presented|grouped|organi[sz]ed|arranged|collected|listed|shown|covered|summari[sz]ed|laid out)\s+(?:here|below|on this page|in this guide)\b/i;  const ARRANGES = /(?<!\bhow to )\b(?:groups?|lists?|organi[sz]es?|presents?|arranges?|sorts?|divides?|categori[sz]es?|catalogu?es?|collects?|breaks?\s+down|lays?\s+out)\s+(?:its|the|these|by|into|as|under)\b|\b(?:is|are|was|were)\s+(?:(?:previously|originally|formerly|once)\s+)?(?:divided|organi[sz]ed|grouped|broken\s+down|arranged|sorted|presented|laid\s+out|categori[sz]ed)\s+(?:into|by|as|under)\b|\b(?:is|are|was|were)\s+(?:previously|originally|formerly|once)\s+(?:divided|organi[sz]ed|grouped|broken\s+down|arranged|sorted|presented|laid\s+out|categori[sz]ed|split|spread|scattered|separated)\b|\b(?:is|are|was|were)\s+(?:(?:previously|originally|formerly|once)\s+)?(?:split|spread|scattered|separated|divided|grouped|organi[sz]ed|arranged|sorted|listed|presented)\s+(?:across|over|among|between|throughout|in)\s+(?:\w+\s+){0,3}?(?:headings?|subheadings?|sections?|categor(?:y|ies)|pages?|lists?|columns?|tables?|entries|paragraphs?|blocks?|parts?)\b/i, QUOTED = /"[^"]*"|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019/g, pointsAtPage = (copy: string): boolean => SELF_POINTER.test(copy) || ARRANGES.test(copy.replace(QUOTED, " "));
const QUALIFIER = /\b(international(?:ly)?|excluding|from|up to|per|depending)\b/i;
const CARRIER = new Set(["include", "includes", "including", "cover", "covers", "carry", "carries", "list", "lists", "mean", "means", "meaning", "also", "such", "offer", "offers", "use", "uses", "used", "refer", "refers", "state", "states",
  "they", "them", "these", "those", "that", "this", "people", "person", "has", "have", "had", // THE REST OF THE CLOSED GRAMMAR (2026-08-22): pronouns, light verbs and quantifiers that any faithful paraphrase must use and no page's stored copy reliably prints. Live passes refused finished copy over "they", "has", "like" and "people", which is the vocabulary test this gate's own charter forbids. Every content noun, name and meaning still has to be carried by a claim and the passage it cites.
  "can", "could", "will", "would", "often", "among", "same", "like", "both", "each", "every", "other", "more", "most"]);

function figures(copy: string, bodyText: string): string[] {
  const out: string[] = [];
  const figure = (t: string): string => t.replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " "); // A FIGURE CARRIES ITS SUBJECT OR IT IS A DIFFERENT FACT: every digit run is traced back to the stored sentence it came out of, and a qualifier that sentence carries and the copy drops changes what the number is ABOUT. DASHES ARE NOT IDENTITY. The house rule rewrites an en dash, so copy saying "7-21" never matched a body saying "7\u201321" and the whole check silently skipped the one sentence that would have refused it: the shipping line went out claiming 7-21 days off a sentence reading "International ... depending on location".
  const ranges = (t: string): string => t.replace(/\bfrom\s+(?=\d[\d,.]*\s*[-–—]\s*\d)/gi, "").replace(/(?:\bfrom\s+)?(\d[\d,.]*)\s*([A-Za-z]{1,4})?\s+to\s+(\d[\d,.]*)\s*([A-Za-z]{1,4})?/gi, // A "FROM" THAT OPENS A SPAN IS PART OF THE SPAN, WHICHEVER WAY THE SPAN IS SPELLED (live row, 2026-09-04). The fold below already strips it from "from 550 to 330 BCE"; /iran-flags/achaemenid-empire-flag writes the span with a dash, so the page's own "representing Persian power from 550-330 BCE" kept its "from", and the finished description "Achaemenid Empire Flag (550-330 BCE) with a red background and a golden Faravahar" was refused for dropping a word that narrows nothing. Two spellings of one fact are one fact. A RANGE SPELLED OUT IS THE SAME FACT AS A RANGE WITH A DASH IN IT: "from 550 to 330 BCE" narrows nothing, and reading its "from" as a qualifier refused every line naming the years its own page is about. Normalized to the form the copy would write, BEFORE the sentence is asked what it qualifies. ONE RANGE, HOWEVER IT IS SPELLED, AND UNITS COUNT (Codex, 2026-08-23): "from 550 BCE to 330 BCE" and "550-330 BCE" are the same fact, and reading the "from" as a dropped qualifier cost /iran-flags/achaemenid-empire-flag five calls and $0.026846 for a line naming the years its own page is about. Endpoints carrying the SAME unit fold together; genuinely different units (5 km to 3 miles) stay two facts, and every other qualifier is still enforced below.
    (m, a: string, ua: string | undefined, b: string, ub: string | undefined) => (!ua || !ub || ua.toLowerCase() === ub.toLowerCase()) ? `${a}-${b}${ub ? ` ${ub}` : ua ? ` ${ua}` : ""}` : m);
  const said = ranges(bodyText).split(/(?<=[.!?])\s+|\n+/).map((t) => figure(t).trim()).filter(Boolean);
  for (const line0 of ranges(copy).split(/(?<=[.!?])\s+|\n+/)) { const line = figure(line0), about = new Set(topicTokens(line)); /* THE FIGURE'S OWN ASSERTION IS WHAT IS JUDGED, so the number is matched on ITS OWN BOUNDARIES and the stored sentence is the one this copy's sentence is ABOUT (audit, 2026-09-04): `includes(n)` read a digit run as a substring, so "3" bound to a sentence about 1335 and "25" to a sentence about 250, and the qualifier of an unrelated fact was then demanded of a faithful figure. Ties keep document order, which is exactly what the first-match rule did. */
    for (const n of new Set(line.match(/\d[\d,.-]*\d|\d+/g) ?? [])) { const its = new RegExp(`(?<![\\d,.-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d,.-])`); const q = QUALIFIER.exec(said.filter((s) => its.test(s)).sort((a, b) => topicTokens(b).filter((w) => about.has(w)).length - topicTokens(a).filter((w) => about.has(w)).length)[0] ?? ""); if (q && !new RegExp(`\\b${q[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line)) { out.push(`the figure's own sentence says ${q[1]!.toLowerCase()}, and the copy drops it`); break; } } } // A PAGE'S OWN WORDS ARE NOT A LIST OF THE SEARCHES THAT REACH IT. Live and Ready on the account: "Persian girl names here match persian girl names, persian names for girls, persian names girl, persian girls names, persian girl name, and unique persian girl names. People also search persian female names and female persian names." Six of those are ONE phrase reordered, and the line after it prints the name of a results-page feature. Nobody writes that, no reader gains a word from it, and it is the exact shape a search engine penalises: pasting it onto a live page costs the operator the ranking the card was bought to win. THE TEST IS PERMUTATION, not similarity: three members that reduce to the same set of content words are the same search said three ways, and a real list never does that.
  return [...new Set(out)];
}

// Only these stored soft findings can be re-asked from the banked record alone.
const owns = (why: string): boolean => why === "it points at the page instead of answering" || /^the figure's own sentence says /.test(why) || /^(?:the claim .* cites evidence that is about something else|the sources this cites are about something else)/.test(why);
function live(p: ChangeProposal): string[] {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit") return [];
  const facts = p.supportFacts ?? [], evidence = new Map(facts.map((f) => [f.id, f.fact]));
  const out = pointsAtPage(c.after) ? ["it points at the page instead of answering"] : [];
  // Independent evidence records must never form one sentence.
  out.push(...figures(c.after, facts.map((f) => f.fact).join("\n")));
  const adrift = (p.claims ?? []).find((x) => { const mine = topicTokens(x.text).filter((w) => !CARRIER.has(w));
    const its = new Set(topicTokens(x.supportedBy.map((id) => evidence.get(id) ?? "").join(" ")));
    return mine.length >= 4 && mine.filter((w) => its.has(w)).length / mine.length < 0.25; });
  if (adrift) out.push(`the claim "${adrift.text.slice(0, 60)}" cites evidence that is about something else: name the id whose words actually carry it`);
  return out;
}
const COPY_REFUSALS = { pointsAtPage, figures, carrier: CARRIER, owns, live };

const enabled = () => true; // the env flag is deleted (operator rule: no flags); the packet regime itself is retired above
const hasGrouping = (sources: readonly { says: string; groups?: readonly string[]; groupExcerpts?: readonly { heading: string }[] }[]): string[] => [...new Set(sources.flatMap((s) => (s.groups ?? []).filter((g) => g.trim() && (s.says.includes(g) || (s.groupExcerpts ?? []).some((e) => e.heading === g)))))]; // a group the source keeps as a heading of its own is carried by the words under that heading, which the quote cannot hold beside the others
const foldDemonym = (token: string): string => token.length >= 7 && token.endsWith("ian") ? token.slice(0, -3) : token;
const phraseTokens = (value: string): string[] => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).map((w) => foldDemonym(w.replace(/s$/, ""))).filter(Boolean);
const phraseIncludes = (heading: string, entity: string): boolean => { const h = phraseTokens(heading), e = phraseTokens(entity); return h.length > 0 && e.length > 0 && (` ${h.join(" ")} `.includes(` ${e.join(" ")} `) || e.every((token) => h.includes(token))); };
const signal = (row: { pageUrl?: string | null; pagePath?: string | null; targetUrl?: string; primaryQuery?: string; trackedQuestion?: string | null; assignment?: { checkedGroups?: readonly string[] } }): string => { const path = (row.pageUrl ?? row.pagePath ?? row.targetUrl ?? "").split(/[?#]/)[0]!.replace(/\/+$/, ""); return path ? path.slice(path.lastIndexOf("/") + 1) : row.primaryQuery ?? row.trackedQuestion ?? ""; };
/* THE PACKET REGIME IS RETIRED AS A GATE (operator, 2026-09-10, "cut any rules, any guardrails, any tests, to have body paragraphs and new pages by tonight"): fifteen releases tuned this bar and the customer surface never once carried a body answer. `applies` is pinned false, so the rubric, the grouping debt, the six checks and the packet holds all stand down; the vocabulary below stays because stored rows carry its sentences as faults and the verdict must still recognize them to retire them. */
const applies = (field: string, standard?: string, unpublished = false, shape?: string, row: Parameters<typeof signal>[0] = {}) => false && enabled() && !unpublished && /^(answer_block|section)$/.test(field) && (AEO_BAR.collection(signal(row)) || ["section", "direct_answer", "restructure"].includes(shape ?? "")) && !["correction", "internal_link", "repositioning"].includes(standard ?? "");
const holds = {"lead": "The opening needs a complete answer paragraph that explains more than the names.", "groups": "Group the answer under one to three headings that explain how the examples were selected.", "criteria": "Each heading needs a selection criterion and explanatory prose, with children written as plain text rather than tables, bold labels or link lists.", "entities": "Entity distinctions should read as plain text under one to three groups; table scaffolds and label styling are optional at most.", "accuracy": "The accuracy questions need to be resolved before this copy is ready.", "unreviewed": "These exact words still need a review of their structure, accuracy and relevance.", "sixChecks": "The answer still needs to pass the required readiness checks for lead quality, grouped sections, factual support and query fit."};
const writerLimitations = (limitations: readonly string[]) => limitations.filter((l) => !Object.values(holds).includes(l.trim()));
const criteria = ["leadAnswer", "groupedH2s", "defendedClaims", "entityBlock", "boundedScope", "h1QueryAlignment"] as const;
const required = ["leadAnswer", "groupedH2s", "defendedClaims", "h1QueryAlignment"] as const;
const schema = z.object({ leadAnswer: z.boolean(), groupedH2s: z.boolean(), defendedClaims: z.boolean(), entityBlock: z.boolean(), boundedScope: z.boolean(), h1QueryAlignment: z.boolean() });
const passed = (r: unknown): boolean => { const parsed = schema.safeParse(r); return parsed.success && required.every((k) => parsed.data[k] === true); };
const policy = "WRITE THE PACKET IN THIS ORDER: choose supported entities and their distinguishing facts; write a liftable lead paragraph that answers the query directly; forbid page deixis in the lead and every section answer (including mid-sentence here is/are, this page, this guide); state the supported facts themselves, preserving each date and its animal-group/count relationship; add one to three Markdown ## grouped sections with qualifying prose; finish with concise supporting details as plain text children. These are publishable words, never instructions or an outline. ANSWER-READY AEO PACKET (required checks): (1) Start finalCopy with a self-contained opening answer paragraph that explains a useful distinction, never an introduction to a names dump. (2) Follow with one to three Markdown ## H2 groups supported by evidence, with prose that explains what qualifies in each group. Keep child examples as plain text lines, not tables, bold label scaffolds or per-child Markdown links. (3) Attribute only the exact claim a cited passage defends, never the whole packet. Mere presence or a heading does not establish native, endemic, current or official status. Omit unsupported optional claims; if core accuracy or membership is unclear, refuse. (4) Keep the answer aligned with query intent and the page H1; if either is missing or mismatched, fail closed. Guidance, not ready blockers when required checks pass: broader scope narration and strict format caps. SHOULD: add useful FAQ question-answer pairs and relevant internal links to known owned destinations when evidence supports them; omission alone is not a failure. Meta is a separate companion when the page needs body and description together. Preserve existing material outside the exact placement.";
const groupLabel = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.。．!！?？:;；,，]+$/u, ""); // A HEADING IS THE SAME GROUP WHATEVER ITS CAPITALS (independent review, 2026-09-10): the writer is told the exact checked names and writes "## Mammal species" for "mammal species", and a case-sensitive match refused the whole packet for a capital letter.
const failures = (field: string, copy: string, limitations: readonly string[] = [], standard?: string, unpublished = false, shape?: string, row: Parameters<typeof signal>[0] = {}): string[] => {
  if (!applies(field, standard, unpublished, shape, row)) return [];
  const out: string[] = [], lines = copy.trim().split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const first = lines.find((s) => !/^#{1,6}\s/.test(s)) ?? "";
  const plain = first.replace(/\*\*/g, "");
  if (/^#{1,6}\s/.test(lines[0] ?? "") || /^(?:[-*•]|\d+[.)])\s/.test(first) || !/[.!?](?:["”’])?$/.test(plain) || (plain.split(/[,;•]/).length >= 5 && !/[.!?]\s+/.test(plain))) out.push(holds.lead);
  const grouped = lines.filter((s) => /^##\s+\S/.test(s));
  if (grouped.length < 1 || grouped.length > 3 || row.assignment?.checkedGroups && grouped.some((h) => !row.assignment!.checkedGroups!.some((g) => groupLabel(g) === groupLabel(h.replace(/^##\s+/, ""))))) out.push(holds.groups);
  const groups = copy.split(/^##\s+(.+)$/m).slice(1), tableRows = [...copy.matchAll(/^\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*\r?\n((?:\|[^\n]+\|[ \t]*(?:\r?\n|$))+)/gm)].map((m) => m[1]).join("\n");
  const entities = [...copy.matchAll(/^[-*•]\s+([^:\n]+):/gm), ...tableRows.matchAll(/^\|\s*([^|]+)\|/gm)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
  const tableStyled = /^\s*\|.+\|\s*$/m.test(copy);
  const boldLabeled = /^\s*(?:[-*•]\s+)?\*\*[^*\n]{2,}\*\*:/m.test(copy);
  const markdownLinks = copy.match(/\[[^\]]+\]\([^)]+\)/g) ?? [];
  if (boldLabeled || markdownLinks.length > 1 || (tableStyled && markdownLinks.length > 0)) out.push(holds.criteria);
  for (let i = 0; i < groups.length; i += 2) {
    const heading = (groups[i] ?? "").trim(), prose = (groups[i + 1] ?? "").split("\n").filter((l) => !/^\s*(?:[-*•|#]|\d+[.)])/.test(l)).join(" ").trim();
    if (entities.some((entity) => phraseIncludes(heading, entity)) || !/[.!?]/.test(prose)) { out.push(holds.criteria); break; }
  }
  const uncertainty = [copy, ...writerLimitations(limitations)].join(" ");
  if (/(?:owed|missing|needs?|still|requires?).{0,60}(?:grouped|inclusion criteria|headings|accuracy)|(?:grouped|inclusion criteria|headings).{0,60}(?:owed|missing|required)|check every word|may be incomplete|overreads? (?:native|endemic) status|accuracy (?:is |remains )?(?:unclear|uncertain)|verify (?:every|all) (?:claim|entry|word)|cannot confirm/i.test(uncertainty) || (copy.match(/\b(?:may|might|possibly|perhaps|unclear|uncertain)\b/gi) ?? []).length >= 3) out.push(holds.accuracy);
  return out;
};
const bodyParts = (p: ChangeProposal) => {
  if (p.kind !== "existing_edit") return [];
  const c = p.recommendedChange, standard = p.changeFamily === "factual_correction" ? "correction" : p.assignment?.standard,
    shape = p.assignment?.treatment === "restructure" ? "restructure" : p.assignment?.shape;
  return [...(c.kind === "existing_edit" && !c.linkTo && applies(c.field, standard, false, shape, p) ? [c.after] : []),
    ...(p.bundle?.components ?? []).filter((x) => /^(opening_answer|section|section_add|section_rewrite|restructure)$/.test(x.kind) && applies("section", standard, false, shape, p)).map((x) => x.after)];
};
const emptyMeta = (copy: string, heading: string): string[] => {
  const tokens = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const known = new Set(tokens(`${heading} a an the is are about and of for with description details information`));
  return !copy.trim() || /\b(?:no (?:added |useful |additional )?description|description (?:not available|unavailable|missing)|nothing to describe)\b/i.test(copy)
    || (known.size > 0 && tokens(copy).every((w) => known.has(w))) ? ["The description is empty or repeats the heading without describing the subject."] : [];
};
export const AEO_BAR = { copyRefusals: COPY_REFUSALS, enabled, collection: (query: string) => !/\bhow many\b/i.test(query) && /\b(?:animals|wildlife|people|figures|species)\b/i.test(query.replace(/[-_/]/g, " ")), groupingQuestion: "Which groups of this page’s subject does the source distinguish, and what qualifies for each?", hasGrouping, emptyMeta, applies, policy, failures, schema, passed, holds, writerLimitations,
  rowFailures: (p: ChangeProposal): string[] => bodyParts(p).flatMap((copy) => failures("section", copy, p.limitations, undefined, false, "section", p)),
  approved: Object.fromEntries(criteria.map((k) => [k, true])) as z.infer<typeof schema>,
  forRow: (p: ChangeProposal): boolean => bodyParts(p).length > 0,
  sameRejectedCopy: (a: ChangeProposal, b: ChangeProposal): boolean => {
    if (a.researchOnly === true || b.researchOnly === true) return false;
    const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const identity = (p: ChangeProposal) => { const c = p.recommendedChange;
      return JSON.stringify([c.kind, c.kind === "existing_edit" ? [c.field.replace(/^(section|answer_block)$/, "body"), key(c.after), c.linkTo ?? ""] : [key(c.openingAnswer), p.newPageDraft],
        (p.bundle?.components ?? []).map((x) => [x.kind, x.page ?? "", key(x.after ?? "")])]); };
    return identity(a) === identity(b);
  },
};
