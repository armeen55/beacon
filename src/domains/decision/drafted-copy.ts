import "server-only";

/**
 * decision/drafted-copy: THE WORDS, ON THE CARD. The $0 producers can prove a page has no description and can
 * prove a page is a stub, and until this file existed both handed the operator an instruction instead of work:
 * "write a description of about 150 characters", "add 800 to 1,200 words". That is the job, restated.
 *
 * It runs AFTER the $0 producers and never inside one, so a budget block, a refusal or a cold cache changes
 * exactly nothing about which cards exist or which families were swept. Two halves, deliberately unlike:
 *
 *   1. A MISSING OR TEMPLATED DESCRIPTION gets a paste-ready line, and a page AI answers never credit gets a
 *      paste-ready ANSWER OPENING, both through the EXISTING structured drafter, grounded on that page's own
 *      STORED BODY (headings and passages off the snapshot store, one bounded read for the whole pass) plus the card's own
 *      evidence, budgeted and cached by the one gateway, read back by the ONE validator, at most MAX_DRAFTS a pass shared
 *      between them. A blocked, refused or rejected draft leaves the card as the producer wrote it, with an honest note.
 *   2. A THIN PAGE gets an OUTLINE, deterministically, out of headings at least two read winners share, named
 *      as theirs. No model, no invention; no winners on file leaves the card as the producer wrote it. */

import { log } from "@/lib/logger";
import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { draftAtomicEditStructured, type CompleteFn } from "./llm/structured-drafter";
import type { AtomicEditDraft } from "./llm/schemas";
import { validateProposal } from "./validate-proposal";
import type { ChangeProposal } from "./contracts";

/** How many drafted blocks one pass buys, descriptions and answers together; past it, the honest note. */
const MAX_DRAFTS = 5;
const META_MIN = 110, META_MAX = 165; // what Google shows of a description before it cuts, and the floor under a line worth pasting
const ANSWER_MIN = 40, ANSWER_MAX = 90; // the drafter's own brief in words; a block outside it ignored the brief and is refused, never trimmed
/** Headings this many read winners share before they are worth naming, and how many are named. */
const AGREEING_WINNERS = 2, MAX_HEADINGS = 5;
const MAX_HEADING_WORDS = 8; // a heading past this is a wrapped paragraph, and site furniture is not a subject
const FURNITURE = /^(home|menu|search|contact|about|share|follow|newsletter|comments?|related|categories|tags|advertisement|subscribe|navigation|footer|privacy|terms)\b/i;
const UNSAFE = /[–—]|\[|\]|\{|\}/; // nothing an operator can paste: a dash Beacon never writes, a bracket somebody forgot to fill in

/** Words OF DESCRIBING, never of claiming: connective, deictic and coverage vocabulary a line about a page may use without
 *  the page spelling it out. A word about the WORLD (a name, a price, an unshown subject) is never here, so an unseen claim still refuses. */
const GENERIC_DRAFT_WORDS: ReadonlySet<string> = new Set(["overview", "browse", "explore", "find", "discover", "learn", "guide",
  "read", "see", "meet", "click", "page", "pages", "site", "more", "related", "official", "complete", "detailed", "including",
  "features", "covering", "reason", "covers", "covered", "cover", "describes", "described", "explains", "explained", "explain",
  "lists", "listed", "names", "named", "mentions", "mentioned", "shows", "shown", "show", "found", "drawn", "each", "here",
  "these", "those", "entry", "entries", "alongside", "within", "example", "examples", "everyday", "short", "include", "includes"]);
/** EVERY FIGURE IN A DRAFT, as bare digits, checked on its own: topic tokens drop short runs, so "costs 45
 *  dollars" once shipped a price nobody has. Every digit run must already appear in the grounding words. */
const digitsIn = (s: string): string[] => s.match(/\d+/g) ?? [];
/** The marker the ranking reads to hold a card behind finished work; "is still owed, and this card is what is owed" is the stable phrase and may not change wording. */
const owedNote = (what: string): string => `The exact ${what} lands on the next pass; it is still owed, and this card is what is owed. No action needed from you until it does.`;

const pathOf = (url: string): string => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

type DraftedCopyOptions = { tenantId: string; snapshot: EvidenceSnapshot; now: Date; complete?: CompleteFn; bypassCache?: boolean };

const slugOf = (p: ChangeProposal): string => p.id.split("::").at(-1) ?? ""; // the producer's own slug, off the id it minted

/** The page this card lands on, by either key. */
function pageFor(snapshot: EvidenceSnapshot, card: ChangeProposal): OwnedPageEvidence | null {
  const url = (card.pageUrl ?? "").trim();
  const path = (card.pagePath ?? "").trim().toLowerCase();
  return snapshot.ownedPages.find((p) => (url && canonicalUrlKey(p.url) === canonicalUrlKey(url)) || pathOf(p.url).toLowerCase() === path) ?? null;
}

/** ONE paste-ready block for one page, or null: the description under its title, or the opening answer a
 *  page owes. Grounded on the page's OWN stored words and the card's own evidence; budgeted and cached by
 *  the gateway; read back by the one validator before a single character reaches the operator. */
async function draftBlock(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null,
  opts: DraftedCopyOptions, kind: "description" | "answer"): Promise<string | null> {
  const content = page.content;
  const outline = (content?.outline ?? []).slice(0, 8);
  const hints = [...card.evidence.hints, ...(content?.title ? [`The page's own title is "${content.title}"`] : []),
    ...(content?.h1 ? [`Its heading reads "${content.h1}"`] : []),
    ...(body?.passages ?? []).slice(0, 4).map((p) => `The page's own stored copy says: "${p.slice(0, 400)}"`),
    ...(body ? ["Write only what the stored copy above shows this page already contains: name its actual subjects in its own words, and introduce no subject, claim or figure it does not carry."] : [])];
  const field = kind === "description" ? "meta" : "answer_block";
  const drafted = await draftAtomicEditStructured({
    query: card.primaryQuery, pageLabel: card.pageLabel, field,
    currentValue: card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.before : null,
    outline, evidenceHints: hints, tenantId: opts.tenantId,
  }, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache }).catch(() => null);
  if (!drafted || drafted.status !== "drafted") {
    log.info(`[drafted-copy] no ${kind} this pass`, { tenantId: opts.tenantId, path: card.pagePath, status: drafted?.status ?? "threw" });
    return null;
  }
  const after = (drafted.value as AtomicEditDraft).after.replace(/\s+/g, " ").trim();
  const fits = kind === "description" ? after.length >= META_MIN && after.length <= META_MAX
    : words(after) >= ANSWER_MIN && words(after) <= ANSWER_MAX;
  if (!fits || UNSAFE.test(after)) return null;
  // COPY DESCRIBES THE PAGE ON FILE, never an imagined better one. Every concrete word in the draft must be
  // visible in the stored capture or the card's own evidence; past a small allowance, an unseen claim
  // rejects the block, so "filter by material" can never ship for a page with no filters on record and an
  // answer opening can never state a fact the page and the stored answers behind the card never showed.
  // THE STORED BODY IS PART OF "THE PAGE ON FILE": grounded on a title and eight headings alone, the gate read ordinary prose as invention and refused every honest draft.
  const grounding = [content?.title, content?.h1, ...outline, card.pagePath?.replace(/[-/]/g, " "),
    card.primaryQuery, card.whyItMatters, ...hints, ...(body?.headings ?? []), body?.vocabulary].filter(Boolean).join(" ");
  const seen = new Set(topicTokens(grounding));
  const invented = topicTokens(after).filter((w) => !seen.has(w) && !GENERIC_DRAFT_WORDS.has(w));
  // A FIGURE GETS NO ALLOWANCE AT ALL. Words are forgiven twice over because a page's own subject can be said
  // in more than one word; a price, a count or a year cannot. One unseen number rejects the block outright.
  const figures = new Set(digitsIn(grounding));
  const madeUp = digitsIn(after).filter((n) => !figures.has(n));
  // AN ANSWER THAT POINTS BACK AT ITS OWN PAGE IS NOT AN ANSWER: "the answer is elsewhere on this page" is navigation prose, refused like any unfinished block.
  if (kind === "answer" && /\b(?:covered|described|explained|shown|listed)\s+(?:in|on|here)\b|\bthis (?:guide|page)\b|\bsee the\b|\bsections? (?:below|above)\b/i.test(after)) {
    log.info("[drafted-copy] the answer points at its own page instead of answering", { tenantId: opts.tenantId, path: card.pagePath });
    return null;
  }
  if (invented.length > 2 || madeUp.length > 0) {
    log.info(`[drafted-copy] the ${kind} names things the stored page does not show`, {
      tenantId: opts.tenantId, path: card.pagePath, invented: invented.slice(0, 5), figures: madeUp.slice(0, 5) });
    return null;
  }
  // THE ONE VALIDATOR, over the same words the drafter was grounded on. A block it refuses never reaches a card.
  const verdict = validateProposal({ ...card, recommendedChange: { kind: "existing_edit", field: kind === "description" ? "meta" : "section",
    before: card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.before : null, after } },
  { evidenceText: [...outline, ...hints, content?.title ?? ""].filter(Boolean).join(" "), now: opts.now });
  if (verdict.verdict === "rejected") {
    log.info(`[drafted-copy] the ${kind} did not pass its own checks`, { tenantId: opts.tenantId, path: card.pagePath, reasons: verdict.reasons.slice(0, 2) });
    return null;
  }
  return after;
}

/** WHAT THE PAGES THAT WIN THIS PAGE'S OWN HEAD SEARCH COVER, off headings at least two READ winners share.
 *  Deterministic and quotes nobody: a heading is named only when several of them agree on it. */
function winnersCover(snapshot: EvidenceSnapshot, page: OwnedPageEvidence): string[] {
  const head = [...(page.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
  const row = head ? (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === canonicalQueryKey(head)) : null;
  if (!row) return [];
  const ranked = new Set(row.organic.map((o) => canonicalUrlKey(o.url)));
  const mine = canonicalUrlKey(page.url);
  const seen = new Map<string, { label: string; on: Set<string> }>();
  for (const w of snapshot.research?.winningPages ?? []) {
    const key = canonicalUrlKey(w.url);
    if (key === mine || !ranked.has(key) || !w.extract) continue;
    for (const h of w.extract.headings) {
      const label = h.replace(/\s+/g, " ").trim();
      if (!label || label.length > 60 || words(label) > MAX_HEADING_WORDS || FURNITURE.test(label) || UNSAFE.test(label)) continue;
      const at = label.toLowerCase();
      const cur = seen.get(at) ?? { label, on: new Set<string>() };
      cur.on.add(w.domain);
      seen.set(at, cur);
    }
  }
  return [...seen.values()].filter((h) => h.on.size >= AGREEING_WINNERS)
    .sort((a, b) => b.on.size - a.on.size || a.label.localeCompare(b.label)).slice(0, MAX_HEADINGS).map((h) => h.label);
}

/** The same cards, with words wherever this pass could honestly put them. Never adds, drops or reorders a
 *  card. Fail-soft: anything that does not land leaves the producer's own card intact. */
export async function applyDraftedCopy(cards: readonly ChangeProposal[], opts: DraftedCopyOptions): Promise<ChangeProposal[]> {
  const out: ChangeProposal[] = [];
  let bought = 0;
  // ONE bounded body read for the pass: the stored copy of exactly the pages about to be drafted, never the site.
  const drafting = cards.filter((c) => ["missing_description", "ai_answer_gap"].includes(slugOf(c)))
    .map((c) => pageFor(opts.snapshot, c)?.url).filter((u): u is string => !!u).slice(0, MAX_DRAFTS);
  const bodies = drafting.length > 0 ? await loadOwnedPageBodies(opts.tenantId, drafting).catch(() => new Map<string, OwnedPageBody>()) : new Map<string, OwnedPageBody>();
  for (const card of cards) {
    const slug = slugOf(card);
    const wants = slug === "missing_description" ? "description" : slug === "ai_answer_gap" ? "answer" : null;
    const page = wants || slug === "thin_page" ? pageFor(opts.snapshot, card) : null;
    if (!page) { out.push(card); continue; }
    if (wants) {
      const meta = wants === "description";
      const drafted = bought < MAX_DRAFTS ? await draftBlock(card, page, bodies.get(canonicalUrlKey(page.url)) ?? null, opts, meta ? "description" : "answer") : null;
      if (drafted) bought += 1;
      out.push(drafted
        ? { ...card, recommendedChange: { kind: "existing_edit", field: meta ? "meta" : "section",
            before: card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.before : null, after: drafted,
            where: meta ? null : `A new section headed "${card.primaryQuery}", placed above the page's first existing section` },
          operatorSteps: meta
            ? [`Open the site editor on ${card.pagePath}`, "Paste the description above, exactly as written",
              "Mark it done here and the click rate gets read again"]
            : [`Open the site editor on ${card.pagePath}`, `Start a new section above the page's first existing section, with the heading "${card.primaryQuery}"`,
              "Paste the answer above as that section's opening, exactly as written", "Mark it done here and the next answers get checked against it"],
          limitations: [...card.limitations, meta
            ? "This line is written off the page's own title, headings and stored copy as last read, so check it still describes the page before you publish it."
            : "This answer is written off the page's own title, headings and stored copy as last read and the stored answers this card cites, so check every word of it is true of the page before you publish it."] }
        : { ...card, limitations: [...card.limitations, owedNote(wants)] });
      continue;
    }
    const covers = winnersCover(opts.snapshot, page);
    out.push(covers.length === 0 ? card : { ...card,
      recommendedChange: { kind: "existing_edit", field: "section",
        before: card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.before : null,
        after: `${card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.after : ""} The pages that win this cover: ${covers.join(", ")}.` },
      operatorSteps: [...(card.operatorSteps ?? []).slice(0, -1), `Give each of these its own section: ${covers.join(", ")}`,
        ...(card.operatorSteps ?? []).slice(-1)],
      limitations: [...card.limitations, `Those subjects are the headings ${AGREEING_WINNERS} or more of the pages Google ranks for this search share, read off the copies on file, and they are what those pages cover rather than a plan written for this one.`] });
  }
  if (bought > 0) log.info("[drafted-copy] blocks written this pass", { tenantId: opts.tenantId, bought });
  return out;
}
