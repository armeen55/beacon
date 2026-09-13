import type { ChangeProposal } from "./contracts";
import type { SourcePacket } from "./drafted-copy";
import { sanitizeNullableEvidence } from "./llm/injection-sanitizer";

/** RFC 4122 shape, 8-4-4-4-12 hex, with or without a truncation tail a model sometimes emits. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.\.\.)?\b/i;

/** True when the text carries at least one id-shaped token. The one validator treats that as a hard safety trip: an operator is never handed a raw id as if it were copy. */
export function containsUuid(text: string | null | undefined): boolean {
  return !!text && UUID.test(text);
}

/** A written web address, told from ordinary prose by its public suffix: the generic suffixes in real use plus ANY two-letter country code. Narrowed by CODE_SUFFIX, because "Node.js" and "README.md" are file names, not websites, and throwing away a whole draft over one would read as nonsense. Broad on purpose: an address I never showed the model is a fabricated source, and a suffix list is the only thing standing between that and copy. */
export const HOST_RE = /\b[a-z0-9][a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2}|com|org|net|edu|gov|mil|int|info|biz|name|pro|dev|app|xyz|online|site|store|shop|tech|blog|cloud|agency|studio|media|news|live|world|club|space|design|digital|wiki|guru|travel|press|recipes|expert|center|life|today|guide|tips|reviews|directory|academy|institute|foundation|community|network|systems|solutions|services|company|group|team|works|example)\b/gi;
const CODE_SUFFIX = /\.(?:js|ts|py|rb|go|rs|kt|cs|sh|md)$/i;
/** Nothing Beacon drafts goes live by itself, and no draft may say it does. Every phrasing here was reachable by a real model: "I will put this page live for you" walked past the first version of this net, which only knew the verb "publish". */
export const AUTOPUBLISH_RE = /\b(auto-?publish|automatically (?:publish|post|upload|push|goes? live)|(?:publish|post|upload|push)ed automatically|i will (?:publish|post|upload|push|handle publishing|put this .{0,20}live)|i(?:'ll| will) (?:take care of|handle) (?:the )?publish|goes? live (?:by itself|on its own|automatically)|puts? (?:it|this|the page) live for you|publishes? (?:it|this) for you)\b/i;
/** A proportion written out in words. Both figure nets tokenize digits, so "nine in ten households" was a fabricated statistic that walked straight into pasteable copy. */
const SPELLED_PROPORTION_RE = /\b(?:per ?cent|percent)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|half|most|nearly all|almost all)\s+(?:in|out of)\s+(?:two|three|four|five|ten|100|10)\b/i;
export const COPY_RULES = { codeSuffix: CODE_SUFFIX, proportion: SPELLED_PROPORTION_RE,
  pageEvidence: (passages: readonly string[], selected: string, budget: number): { evidence: Record<string, string>; truncated: boolean } => {
    const evidence: Record<string, string> = {}, normalize = (t: string): string => t.replace(/\s+/g, " ").trim(); let room = budget, n = 0, truncated = false;
    const held = passages.join(" ").length > budget ? selected : "";
    if (held) { evidence[`page-copy-${++n}`] = held; room -= held.length; truncated = true; }
    for (const t of passages) { if (held && normalize(held).includes(normalize(t))) continue; if (room < t.length) { truncated = true; continue; } evidence[`page-copy-${++n}`] = t; room -= t.length; }
    return { evidence, truncated };
  },
  packet: (p: SourcePacket): string => JSON.stringify({ assignment: p.assignment ?? p.diagnosedProblem, targeting: p.demand, comparison: p.comparison ? { queries: p.comparison.queries, focus: p.comparison.focus, verdict: p.comparison.verdict, owned: p.comparison.owned ? { url: p.comparison.owned.url, bodyKey: p.comparison.owned.bodyKey, heldWhole: p.comparison.owned.heldWhole && sanitizeNullableEvidence(p.comparison.owned.held) === p.comparison.owned.held } : undefined, winners: p.comparison.winners.map((w, i) => { const held = sanitizeNullableEvidence(w.held) ?? ""; return { ...w, held, heldWhole: w.heldWhole && held === w.held, id: `rival-${i + 1}`, role: "research_not_claim_support" }; }) } : undefined, page: { url: p.targetUrl, title: p.title, h1: p.h1, meta: p.metaDescription, headings: p.headings, body: p.bodyText.slice(0, 24000), partial: !!p.truncated || p.bodyText.length > 24000, unpublished: !!p.unpublished }, evidence: Object.entries(p.evidence).map(([id, text]) => ({ id, text, role: /^(?:rival|serp|case)-/.test(id) ? "research_not_claim_support" : /^draft-so-far/.test(id) || p.unpublished && /^page-/.test(id) ? "draft_not_claim_support" : /^(?:fact-|page-|owned-page)/.test(id) ? "claim_support" : "context_not_claim_support", sources: p.evidenceSources?.[id] ?? (/^fact-(\d+)$/.test(id) ? p.checkedSources?.[Number(id.slice(5)) - 1] ?? [] : []) })) }),
  grounding: (p: SourcePacket): string => Object.entries(p.evidence).filter(([id]) => /^(?:fact-|page-|owned-page)/.test(id) && !(p.unpublished && /^page-/.test(id))).map(([, text]) => text).join("\n"),
  pieceKey: (p: Pick<NonNullable<ChangeProposal["newPageDraft"]>["pieces"][number], "heading" | "after" | "claims" | "supportFacts">): string => JSON.stringify([p.heading, p.after, p.claims, p.supportFacts]),
  accepted: (e: NonNullable<ChangeProposal["semanticReview"]>["editor"]): boolean => !!e && e.contested !== true && [e.pageFit, e.placementCorrect, e.resolvesDiagnosis, e.implementableNow, e.improvesPage, e.wouldHandToCustomer].every((x) => x === true),
  workflow: /\b(?:a clear answer should|this (?:draft|copy)|the copy below|(?:this|the) (?:page|section|answer) (?:should|will|needs to)|update the section|sharpen it for|stored copy|source packet|supportedBy|claim ids|grounding packet|in the evidence|(?:the )?(?:FAQ|page|list|section) (?:also )?(?:pairs|lists|mentions|includes|explains|covers|highlights|says))\b|\b(?:as an AI|(?:I|we)(?:'ll| will| need to| should| can) (?:draft|write|rewrite|revise|update|generate|provide|return)|return (?:the )?JSON|(?:add|insert|replace|rewrite|update|draft|write) (?:this|the|an?|a new) (?:section|paragraph|heading|answer block|meta description|copy))\b/im };
