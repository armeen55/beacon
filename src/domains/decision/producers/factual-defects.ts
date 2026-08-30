import "server-only";

/** decision/producers/factual-defects - THE PAGE SAYS SOMETHING UNTRUE, minted from banked research and from nothing else. Written after 165 sourced corrections were injected straight into a stored proposal payload by hand,  overwritten by the next producer pass, and reapplied by hand again (operator, 2026-08-17: the store is persistence, not an authoring interface). Everything here is DETERMINISTIC from evidence/pages/fact-checks: the same banked  checks mint the same bundle on every pass, a check that moves moves the bundle, and a page whose checks all pass mints nothing, which is how the card retires itself once the operator has corrected the page and the next check run  says so. ONLY CONFIRMED CORRECTIONS BECOME WORK. `likely` and `disputed` are real findings and stay in the research lane where they argue for themselves; `unsupported` names its missing source and proposes nothing. A correction  with no scholarly, dictionary or encyclopedia source behind it never reaches a component, because a baby-name page is not authority to overwrite published words. IT IS NOT A RANKING STORY. This cause is `factual_error` and carries  no click figure: whether the wrong meanings also cost the page positions is a separate finding with separate evidence, and merging them would let a correction inherit a loss nothing ties it to. */

import { log } from "@/lib/logger";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { REVIEW_CONTRACT, copyKey, wordingOnlySuspicion } from "@/domains/decision/proof";
import { labelOf } from "@/domains/decision/completeness";
import { authorizedCorrections, correctionSeverity, readFactChecks, unauthorizedReason, VERIFICATION_RULES_VERSION, type FactCheck } from "@/domains/evidence/pages/fact-checks";
import { supportShortfall } from "@/domains/evidence/pages/claim-support";
import type { BundleComponent, ChangeProposal } from "@/domains/decision/contracts";

/** How many corrections ride one card, and how many the operator is asked to do in one sitting. A hundred and seventy two prose steps is not a deliverable; batches of this size are. NOTHING DISAPPEARS BEHIND THE CAP (Codex,
 *  2026-08-18: 62 confirmed corrections vanished behind an alphabetical top 40): the card says which batch it is, how many corrections remain, and orders by severity so the worst are never the ones cut. */
const BATCH = 10; /** How many corrections Beacon's own paid sense review reads in one call. */
/** A page-safe fragment of a correction's subject, so each one owns a stable id of its own. */
const slugOf = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const pathOf = (url: string): string => {
  if (url.startsWith("/")) return url.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const n = (x: number): string => x.toLocaleString("en-US");

/** THE SPAN THE CORRECTION ACTUALLY REWRITES. The extractor quotes exactly, and its exact quote sometimes opens  with the name heading itself ("Alborz\nMeaning:..."): a replacement targeted at that whole quote would delete  the name from the page. The heading is not what is wrong, so when the first line is the subject and nothing  else, the replaced span is everything after it. Shape only: no other narrowing is ever guessed. */
function replacedSpanOf(c: FactCheck): string {
  const lines = c.current.split("\n").map((l) => l.trim()).filter(Boolean); if (lines.length > 1 && lines[0]!.toLowerCase() === c.subject.trim().toLowerCase()) return lines.slice(1).join("\n");
  // THE CRAWLER GLUES A HEADING TO ITS LINE WITH NO NEWLINE AT ALL (render audit, 2026-08-30): the stored span read "AzadehMeaning:Free, independent, or liberated.", the multi-line strip above never fired, and the label regex swallowed "AzadehMeaning" whole, so the card told a paying customer to paste the name glued to its label. The subject is a heading here exactly as in the newline case, so it is cut the same way: only when the span STARTS with the subject immediately followed by a capitalized label of its own ("Meaning:"), never when the subject is part of the sentence.
  const flat = c.current.trim(), who = c.subject.trim(); return flat.length > who.length && flat.toLowerCase().startsWith(who.toLowerCase()) && /^[A-Z][a-z]+ ?:/.test(flat.slice(who.length)) ? flat.slice(who.length) : flat; }


/** A SOURCED GLOSS SHAPED INTO THE LINE IT REPLACES. THE PAGE IS AUTHORITATIVE FOR ITS VOICE, NEVER FOR ITS TYPOS
 *  (operator, 2026-08-28). The label, its wording and the page's terminology are copied exactly; what is NOT copied
 *  is a mechanical mistake in the page's own punctuation. Live: the crawled span reads "Meaning:Bright, radiant, or
 *  glowing." with no space after the colon, this carried that missing space into the replacement, and Beacon offered
 *  "Meaning:Light." to a paying customer as if reproducing a typo were respecting a house style. A gloss arriving as
 *  the source's own semicolon list is joined the way a person writes a list: two read "A or B", three or more read
 *  "A, B, or C". Every alternative the source gave survives; only the punctuation between them is Beacon's. */
/** WHAT KIND OF CORRECTION THIS IS, from the verdict already stored and the two wordings themselves. Every card
 *  said the same thing: "X means Y, not Z", which calls the page FALSE. Two of the three corrections live in the
 *  operator's queue right now are `page_imprecise`, where the sources narrow the wording rather than deny it, and
 *  telling a paying customer their page is wrong when it is merely loose is an overclaim Beacon has to stop
 *  making. A third kind exists with no verdict of its own: when the supported value survives the composition
 *  unchanged and only its spacing or punctuation moved, nothing about the meaning is being corrected at all. */
type Treatment = "replace" | "narrow" | "repair";
const bareOf = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
function treatmentOf(verdict: string, before: string, after: string): Treatment {
  if (bareOf(before) === bareOf(after)) return "repair"; // the same words, differently punctuated
  return verdict === "page_imprecise" ? "narrow" : "replace";
}

function composedReplacement(before: string, proposed: string): string {
  const lv = labelOf(before);
  const prefix = lv ? `${lv.label}:${lv.latin ? " " : lv.gap}` : "";
  const parts = proposed.trim().split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  // THE JUDGE'S OWN STRUCTURE SURVIVES (operator, 2026-08-30): "free, free-minded; also noble" was or-joined into "free, free-minded or also noble", which no dictionary would print. A part that already opens with a connective keeps its semicolon; only plain alternatives are or-joined.
  const connective = parts.some((x, i) => i > 0 && /^(also|and|or|but)\b/i.test(x));
  const listed = parts.length <= 1 ? (parts[0] ?? "")
    : connective ? parts.join("; ")
      : parts.length === 2 ? `${parts[0]} or ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}`;
  // ONE TERMINAL MARK, NEVER TWO: a source fragment that already ends in a stop plus the one this adds reads as "light..".
  const gloss = listed.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase()).replace(/([.!?])[.!?]+$/, "$1");
  const stop = /[.!?]["')\]]?\s*$/.test(before) && !/[.!?]["')\]]?$/.test(gloss) ? "." : "";
  return `${prefix}${gloss}${stop}`;
}

type FactualDefectRun = { cards: ChangeProposal[]; complete: boolean };

/** BEACON PERFORMS THE SENSE REVIEW, NEVER THE OPERATOR (operator, 2026-08-22). The bundle sat at needs_review because "nothing has read this for sense yet", which delegated Beacon's own quality control. Batches of ten go to the one  gateway with the exact current statement, replacement, source quote and locator; each component is ruled on ITS OWN INDEX, so one defective replacement holds only itself. A batch that cannot be read (unaffordable, refused, no key)  reviews nothing and the card stays honestly at needs_review with the reason. Cached by content through the gateway, so a repeat pass reviews at $0. */
const REVIEW_SYSTEM = "You are Beacon's own final sense reviewer of sourced factual corrections about to be offered to a paying customer. For EACH numbered component: judge whether the replacement reads as grammatical natural English a person would publish in place of the current statement, whether it contradicts any OTHER component in this batch, and then rule on EVERY listed claim of that component separately. A claim is entailed ONLY when the passages you are shown under the fact ids that claim names actually carry it; a passage about something else is not support however true it is. Return {\"rulings\":[{\"index\":<component>,\"publish\":<bool>,\"reason\":\"<one sentence>\",\"claims\":[{\"claim\":<the claim number shown>,\"factIds\":[<exactly the fact ids that claim lists>],\"entailed\":<bool>,\"why\":\"<one sentence>\"}]}]}. Rule on every claim shown for a component, once each, naming that claim's own fact ids and no others. A component marked SUSPECTED WORDING-ONLY CHANGE additionally gets \"materialChange\": true only when the replacement genuinely moves the meaning, precision or coverage of the statement; a reordering or possessive swap that keeps the meaning is materialChange false. When in doubt, entailed=false."
/** WHAT THE REVIEWER IS SHOWN FOR ONE COMPONENT: its exact copy, its canonical claims by index with the exact fact ids each one names, and the exact passage behind every id. The review used to see an anonymous `source:` blob and "claim 0", so it could not name what it had weighed and nothing could check that it had. */
type ReviewItem = { c: BundleComponent; where: string; claims: readonly { claimIndex: number; text: string; by: readonly string[] }[]; facts: readonly { factId: string; exactPassage: string }[] };
async function reviewComponents(tenantId: string, items: readonly ReviewItem[], now: Date,
  wiring: { attempts?: { left: number; record?: (r: unknown) => void }; complete?: unknown; bypassCache?: boolean }): Promise<{ held: Map<number, string>; passed: Map<number, { i: number; by: string[]; entailed: boolean }[]> } | null> {
  const { callStructuredLLM } = await import("../llm/structured-drafter");
  const held = new Map<number, string>(), passed = new Map<number, { i: number; by: string[]; entailed: boolean }[]>();
  for (let b = 0; b < items.length; b += BATCH) {
    const batch = items.slice(b, b + BATCH);
    if (wiring.attempts && (wiring.attempts.left -= 1) < 0) return null; // an unpaid batch reviews nothing
    const user = batch.map((it, i) => [`#${i}: on the page now: "${it.c.before ?? ""}"`, `replacement: "${it.c.after}"`, `where: ${it.where}`,
      ...(wordingOnlySuspicion({ recommendedChange: { kind: "existing_edit", field: "section", before: it.c.before ?? null, after: it.c.after } } as never) ? ["SUSPECTED WORDING-ONLY CHANGE: rule materialChange for this component."] : []),
      "claims to rule on:", ...it.claims.map((x) => `  claim ${x.claimIndex}: "${x.text}" — must be entailed by exactly these fact ids: ${x.by.join(", ")}`),
      "the exact passage behind each fact id:", ...it.facts.map((f) => `  ${f.factId}: "${f.exactPassage}"`)].join("\n")).join("\n\n")
      + `\n\nReturn one ruling per component, indexes 0 to ${batch.length - 1}, each with a ruling for every claim shown for it.`;
    const r = await callStructuredLLM({ kind: "factual_review", tenantId, system: REVIEW_SYSTEM, user, grounded: user,
      projectedCostUsd: 0.01, maxTokens: 2500, timeoutMs: 95_000, now,
      ...(wiring.complete ? { complete: wiring.complete as never } : {}), ...(wiring.bypassCache ? { bypassCache: true } : {}) }).catch(() => null);
    wiring.attempts?.record?.(r); // BEFORE the status branch: a paid failure is still paid, and the receipt says so
    if (r?.status !== "drafted") return null;
    const rulings = (r.value as { rulings: { index: number; publish: boolean; reason: string; materialChange?: boolean; claims: { claim: number; factIds: string[]; entailed: boolean; why: string }[] }[] }).rulings;
    // A COMPONENT THE REVIEW DID NOT RULE ON IS NOT PUBLISHED: silence is never a pass. AND THE RETURNED MAPPING IS CHECKED, NOT TIDIED: a ruling naming a claim that does not exist and a fact nobody banked, marked entailed, cleared every card while the producer wrote a clean-looking authorization from its OWN ids, which is self-authorization wearing a reviewer's name (Codex, 2026-08-28).
    // NOTHING THE REVIEWER RETURNED IS SILENTLY IGNORED. Every expected component was checked, and a ruling for a
    // component nobody asked about was simply dropped, so a response could carry anything alongside the real ones.
    const seen = rulings.map((x) => x.index).sort((a, b) => a - b);
    if (seen.length !== batch.length || seen.some((x, n) => x !== n)) {
      for (let i = 0; i < batch.length; i += 1) held.set(b + i, "the review answered about components this batch never asked about");
      continue;
    }
    const ruled = new Map(rulings.map((x) => [x.index, x] as const));
    for (let i = 0; i < batch.length; i += 1) {
      const v = ruled.get(i), item = batch[i]!, got = v?.claims ?? [];
      const known = new Set(item.facts.map((f) => f.factId)), key = (xs: readonly string[]): string => [...xs].sort().join("|");
      const bad = !v ? "the review returned no ruling for it"
        : rulings.filter((x) => x.index === i).length !== 1 ? "the review ruled on it more than once"
          : got.length !== item.claims.length ? "the review did not rule on every claim of it exactly once"
            : item.claims.map((c) => { const g = got.filter((x) => x.claim === c.claimIndex);
              return g.length !== 1 ? `claim ${c.claimIndex} was ruled ${g.length} times`
                : !g[0]!.factIds.every((f) => known.has(f)) ? `claim ${c.claimIndex} names evidence nobody banked`
                  : key(g[0]!.factIds) !== key(c.by) ? `claim ${c.claimIndex} was ruled against different evidence than it names`
                    : !g[0]!.entailed ? g[0]!.why : null; }).find((x) => x != null) ?? (v!.publish !== true ? v!.reason : v!.materialChange === false ? "the reviewer ruled this rewording keeps the page's meaning" : null);
      if (bad != null) held.set(b + i, bad);
      // THE REVIEWER'S OWN MAPPING IS WHAT IS BANKED, ordering normalized and values never regenerated; its materiality ruling rides along so the serving door can hold a suspected wording-only change on the reviewer's own word.
      else passed.set(b + i, Object.assign(got.map((x) => ({ i: x.claim, by: [...x.factIds].sort(), entailed: x.entailed })), { materialChange: v!.materialChange }));
    }
    if (wiring.attempts && (r as { cached?: true }).cached) wiring.attempts.left += 1; // a cache hit cost nothing
  }
  return { held, passed };
}

/** BEACON REVIEWS ITS OWN CORRECTIONS, AS ONE RANKED PAID CANDIDATE. The minted card carries every authorized correction and waits at needs_review; this reads them in batches of ten against their own sources and returns the card the  operator should see. Survivors stay and the card is promoted; a failed component is held WITH its reason on the receipt and never erases the valid ones; a review that holds EVERYTHING keeps every piece and promotes nothing (an  empty bundle is a card the contract cannot read back); a review that could not run at all returns the card untouched, so the pass reports no promotion it did not earn. */
/** BEACON REVIEWS ITS OWN CORRECTIONS, ONE PAGE AT A TIME, and hands the verdict back to cards that stay atomic.  The cards are separate so nothing can retire them together; the REVIEW is batched so forty of them cost one  page's worth of calls and not forty. A card whose correction the reviewer holds keeps its words and its  reason and simply is not offered; a card the reviewer clears becomes ready. Unreadable or unaffordable  promotes nothing and loses nothing. */
/** The name a correction card is about, as it was minted: the row's own subject, not a re-parse of the copy. */
const subjectOf = (c: ChangeProposal): string => /^The "(.+?)" entry/.exec(c.recommendedChange.kind === "existing_edit" ? (c.recommendedChange.where ?? "") : "")?.[1] ?? "";

/** WHY THIS REPLACEMENT CANNOT STAND WHERE THE WORDS IT REPLACES STAND, or null when it can. A sourced meaning  is not yet publishable copy: the source says darya derives from "possess or maintain; well, good", which is  a true etymology and a dictionary fragment, and dropping it into "Meaning:_" leaves the page reading  "Meaning:possess or maintain; well, good". Shape only, no vocabulary and no word list, so it says nothing  about which language or subject a page is allowed to be about. Checked here, before anybody is paid to read  it, because a deterministic gate does not have moods and does not cost anything to run. */
function unfitToStandIn(before: string | null, after: string, subject: string): string | null {
  const a = after.trim(), b = (before ?? "").trim(), bare = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  // The name check reads the words INSIDE the page's own label: composed copy carries the "Meaning:" prefix the
  // page carries, and "Meaning:Jasmine." offering Jasmine as Jasmine's meaning is exactly the empty answer this
  // gate exists for, prefix or no prefix.
  const label = /^([\p{L}][\p{L} ]{1,23}:\s*)/u.exec(b)?.[1] ?? "";
  const core = label && a.startsWith(label) ? a.slice(label.length) : a;
  // A LABEL GLUED TO ITS VALUE NEVER REACHES READY, whoever composed it. `composedReplacement` puts the one space
  // there, and this is the gate that holds the line if a future producer writes the replacement some other way: the
  // customer is never handed "Meaning:Light." again because one composer was bypassed (operator, 2026-08-28).
  const av = labelOf(a);
  if (av && av.latin && av.gap === "") return "its label runs straight into the words after it, so the line would paste onto the page as one glued phrase";
  if (bare(core) === bare(subject)) return "it offers the name itself as the name's meaning, which tells a reader nothing";
  if (b === "") return null; // nothing is being replaced, so there is no shape to match
  if (/[.!?]["')\]]?$/.test(b) && !/[.!?]["')\]]?$/.test(a)) return "the words it replaces finish a sentence and these do not, so the page would be left mid-sentence";
  if (a.includes(";") && !b.includes(";")) return "it lists alternative glosses where the page carries prose, which reads as a dictionary entry rather than as the page";
  return null;
}

async function reviewFactualCards(cards: readonly ChangeProposal[], wiring: { tenantId: string; now: Date;
  attempts?: { left: number; record?: (r: unknown) => void }; complete?: unknown; bypassCache?: boolean }): Promise<readonly ChangeProposal[]> {
  // THE REVIEWER READS THE QUOTES. Its charge has always included "is it consistent with the quoted source",
  // and the parts it was handed carried no sourcePack, so that question was asked over an empty source line:
  // the one reader between a sourced correction and a paying customer was judging blind. The card's own
  // supportFacts are the exact passages, so they ride along.
  const parts = cards.map((c): BundleComponent => ({ kind: "factual_correction", label: c.recommendedChange.kind === "existing_edit" ? (c.recommendedChange.where ?? c.pagePath ?? "") : "",
    before: c.recommendedChange.kind === "existing_edit" ? c.recommendedChange.before : null,
    after: c.recommendedChange.kind === "existing_edit" ? c.recommendedChange.after : "",
    evidenceKeys: ["fact-1"], risk: "review",
    sourcePack: { sourceRequirements: (c.supportFacts ?? []).map((f) => f.fact), factRequirements: [] },
    ...(c.recommendedChange.kind === "existing_edit" && c.recommendedChange.where ? { where: c.recommendedChange.where } : {}) }));
  if (parts.length === 0) return [...cards];
  const unfit = new Map<number, string>();
  for (const [i, p] of parts.entries()) {
    const why = unfitToStandIn(p.before, p.after, cards[i]?.recommendedChange.kind === "existing_edit" ? subjectOf(cards[i]!) : "");
    if (why) unfit.set(i, why);
  }
  // THE PACKET IS BUILT FROM THE CARD, so the reviewer weighs the same canonical claims and passages the row banks.
  const packet = (i: number): ReviewItem => { const c = cards[i]!, rc = c.recommendedChange;
    return { c: parts[i]!, where: rc.kind === "existing_edit" ? (rc.where ?? "") : "",
      claims: (c.claims ?? []).map((x, n) => ({ claimIndex: n, text: x.text, by: [...x.supportedBy] })),
      facts: (c.supportFacts ?? []).map((f) => ({ factId: f.id, exactPassage: f.fact })) }; };
  const review = await reviewComponents(wiring.tenantId, parts.map((_, i) => i).filter((i) => !unfit.has(i)).map(packet), wiring.now, wiring).catch(() => null);
  const cleared = new Map<number, { i: number; by: string[]; entailed: boolean }[]>();
  const held = review?.held ?? null;
  // UNAFFORDABLE, REFUSED OR UNREADABLE: nothing promoted, nothing lost, and NOTHING REWRITTEN. This returned a
  // fresh copy of the cards, the caller read a new array as "the review moved something" and persisted the
  // unreviewed mint copies, and that write erased the banked paid review of a pass that had already succeeded:
  // the scheduler's failing review clobbered three reviewed Ready corrections minutes after they landed
  // (found live, 2026-08-28). The SAME reference is the contract that nothing moves.
  if (held == null) return cards;
  // The reviewer only ever saw the fit ones, so its indexes are remapped onto the cards they came from.
  const offered = parts.map((_, i) => i).filter((i) => !unfit.has(i));
  for (const [j, why] of held ?? []) unfit.set(offered[j]!, why);
  for (const [j, mapping] of review?.passed ?? []) cleared.set(offered[j]!, mapping);
  return cards.map((c, i) => unfit.has(i)
    ? { ...c, limitations: [`Held by Beacon's own review: ${unfit.get(i)}`, ...(c.limitations ?? []).filter((l) => !l.startsWith("Beacon's own sense review has not"))] }
    : { ...c, status: "ready" as const,
      ...(cleared.has(i) ? { semanticReview: { of: copyKey(c), version: REVIEW_CONTRACT, claims: cleared.get(i)!, ...((cleared.get(i) as { materialChange?: boolean }).materialChange != null ? { materialChange: (cleared.get(i) as { materialChange?: boolean }).materialChange } : {}) } } : {}), // THE REVIEWER'S OWN RULING, never one rebuilt from the producer's `supportedBy`
      limitations: [...(c.limitations ?? []).filter((l) => !l.startsWith("Beacon's own sense review has not")),
        "Beacon's own reviewer read this correction for grammar, source fit and contradictions before it was offered."] });
}

/** Every page whose banked checks contradict it, as one card each, at $0. Guarded like every producer: a read that fails narrows the pass and sweeps nothing. Beacon's own sense review is a separate ranked candidate. */
async function factualDefectCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date }): Promise<FactualDefectRun> {
  const { tenantId, snapshot, now } = input;
  const noOpWhy = new Map<string, string>();
  try {
    const checks = await readFactChecks(tenantId);
    if (checks.length === 0) return { cards: [], complete: true };
    const owned = new Map(snapshot.ownedPages.map((p) => [canonicalUrlKey(p.url), p]));
    const byPage = new Map<string, FactCheck[]>();
    for (const c of checks) {
      const key = canonicalUrlKey(c.page.startsWith("http") ? c.page : `${snapshot.scope.site ?? ""}${c.page}`);
      const list = byPage.get(key) ?? []; list.push(c); byPage.set(key, list);
    }
    // THE PAGE VERSION DECISION CAN ACTUALLY SEE: a correction is work only while the page still says what it objected to, so the hash is recomputed from the same stored words. Bounded to pages holding one.
    // EVERY OWNED PAGE THIS ACCOUNT HAS CHECKED, not only the ones still authorizing work. Scoping this to pages
    // with a live correction meant a page whose corrections ALL lost their evidence was never read, so it was
    // never judged, so its stale cards could never be withdrawn: the one case the withdrawal below exists for.
    const candidateUrls = [...byPage].filter(([k]) => owned.has(k)).map(([k]) => owned.get(k)!.url);
    const pageHashes = new Map<string, string>();
    if (candidateUrls.length > 0) {
      const [{ loadOwnedPageBodies }, { pageHashOf }] = await Promise.all([
        import("@/domains/evidence/pages/owned-context"), import("@/domains/evidence/pages/fact-check-run")]);
      // THE LOADER REFUSES AN OVER-WIDE ASK WHOLESALE (its bound is seven pages), and an account's checks
      // crossed that width live (2026-08-30: asked 8, max 7, empty map, zero hashes, zero cards from 777
      // banked checks). Batches within the bound read every page; a page whose body still fails to load is
      // simply never judged, which is the sweep's own fail-safe.
      const bodies = new Map<string, Awaited<ReturnType<typeof loadOwnedPageBodies>> extends Map<string, infer V> ? V : never>();
      for (let i = 0; i < candidateUrls.length; i += 7) {
        const part = await loadOwnedPageBodies(tenantId, candidateUrls.slice(i, i + 7)).catch(() => null);
        for (const [k, v] of part ?? []) bodies.set(k, v);
      }
      for (const url of candidateUrls) {
        // THE LOADER'S MAP IS CANONICALLY KEYED, and this read spelled the key raw, so it missed every body,
        // every page hash stayed unset, and the currency gate below refused all 777 banked checks at once
        // (live, 2026-08-30: four produce passes, cards 0). The gate was armed later than this read was
        // written, which is why the dead join minted for weeks before it starved the queue.
        const b = bodies?.get?.(canonicalUrlKey(url));
        const body = b ? [b.title, b.h1, ...b.headings, ...b.passages].filter(Boolean).join("\n") : "";
        if (body.trim()) pageHashes.set(canonicalUrlKey(url), pageHashOf(body));
      }
    }
    const cards: ChangeProposal[] = [];
    for (const [key, rows] of byPage) {
      const page = owned.get(key);
      if (!page) continue; // a check for a page this account no longer owns is history, not work
      const path = pathOf(page.url);
      // SEVERITY FIRST, never the alphabet: a wholly wrong statement with two agreeing sources and repeats elsewhere on the page is the one to fix, and it must never be the one the cap drops. ONLY FACTS CURRENT FOR THIS PAGE VERSION MAY BECOME WORK
      // (Codex, 2026-08-18): an older version, or a source nobody recorded reading, is a finding and never a live instruction.
      // A MISSING-INFORMATION ROW IS NOT A CORRECTION: it has no current wording, so "X stops stating a meaning its own sources contradict" would name words the page never carried. Those rows are the WRITER'S fact-* evidence; only rows that correct wording the page holds become correction components.
      // WHAT PEOPLE ACTUALLY SEARCH FOR THIS SUBJECT, measured off the page's own query rows, never assumed (operator, 2026-08-30): one entry's correction is worth the demand for THAT entry, not the whole page it sits on, so severity orders equals and demand orders everything.
      const qd = new Map<string, number>();
      for (const q of page.search?.topQueries ?? []) for (const w of q.query.toLowerCase().split(/\s+/)) if (w.length > 2) qd.set(w, (qd.get(w) ?? 0) + q.impressions);
      const subjectDemand = (t: string): number => Math.max(0, ...t.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => qd.get(w) ?? 0));
      const corrections = authorizedCorrections(rows, { pageContentHash: pageHashes.get(key) ?? null }, tenantId).filter((c) => c.current.trim() !== "")
        .sort((a, b) => subjectDemand(b.subject) - subjectDemand(a.subject) || correctionSeverity(b) - correctionSeverity(a) || a.subject.localeCompare(b.subject));
      const held = rows.filter((r) => !corrections.includes(r) && r.verdict !== "page_correct");
      const disputed = held.filter((r) => r.confidence === "disputed" || r.confidence === "likely");
      const unsupported = held.filter((r) => r.confidence === "unsupported");
      if (corrections.length === 0) continue; // nothing authorized: the findings live in the checks, not in a card
      // ONE CORRECTION IS ONE CHANGE (operator, 2026-08-26). Forty sourced corrections used to be ONE row carrying
      // forty components, capped at MAX_COMPONENTS with the rest held "behind this batch". That row was swept on
      // 2026-08-23 with "the producer that owns this family rewrote it and did not re-emit this card", and all
      // forty of the operator's best work died in one write. A correction is independently applicable, so it is
      // independently ranked, and NO BUNDLE is minted for it: the stale sweep only reaches rows carrying one, so
      // a point edit cannot be taken by a replan of the page it happens to sit on. No cap: the queue is unlimited.
      for (const [i, c] of corrections.entries()) {
        const span0 = replacedSpanOf(c);
        // ONLY THE LITERALLY IDENTICAL SKIPS DETERMINISTICALLY (operator, 2026-08-30): a bag of words is a SUSPICION, not a proof, because "fear of God" and "God's fear" reduce to the same tokens without meaning the same thing. A suspected wording-only change mints and is held until the ONE reviewer rules its materiality; the composed output equalling the span byte for byte is the only thing settled without asking.
        if (composedReplacement(span0, c.proposed!) === span0) {
          log.info("[factual-defects] the composed replacement is identical to the page's own line, so no card is minted", { tenantId, subject: c.subject });
          noOpWhy.set(`${path.toLowerCase()}::fact-${slugOf(c.subject) || ""}`, "the composed replacement is identical to the page's own line, so there is nothing to change");
          continue;
        }
        // A SECOND PLACE, OR NO SECOND PLACE. Live, `also_at` held exactly the row's own locator on every
        // correction, so the operator's Find step read "the Noor entry, and the same statement at: Popular
        // Persian Female First Names and their Meanings", naming the very section it had just named. An exact
        // location that repeats itself is not an exact location, so a repeat of the locator is dropped here.
        const same = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
        const also = c.alsoAt.filter(Boolean).filter((a) => !same(a, c.pageLocator ?? "") && !same(a, `The "${c.subject}" entry`));
        const where = also.length > 0
          ? `The "${c.subject}" entry, and the same statement at: ${also.slice(0, 3).join("; ")}`
          : `The "${c.subject}" entry`;
        const before = replacedSpanOf(c), after = composedReplacement(before, c.proposed!);
        // THE CARD SAYS WHICH OF THE THREE IT IS, read from the stored verdict and never from the copy itself.
        const treat = treatmentOf(c.verdict, before, after);
        // A QUOTED SENTENCE KEEPS ITS OWN STOP AND GETS NO SECOND ONE: the page's line ends in a full stop, so
        // `reads "${before}".` rendered `reads "A warrior or conqueror.".` on every card that quotes a sentence.
        const q = (t: string): string => `"${t}"${/[.!?]["')\]]?\s*$/.test(t) ? "" : "."}`;
        const act = treat === "replace" ? `Correct what ${path} says about ${c.subject}`
          : treat === "narrow" ? `Sharpen what ${path} says about ${c.subject}`
            : `Repair the formatting of what ${path} says about ${c.subject}`;
        // THE CLAIM LEADS WITH WHAT THE SOURCES SUPPORT. Leading with the page's current wording instead pushed the
        // claim's own words away from the evidence it cites, and `staleCopyReasons` reads exactly that overlap: two
        // live corrections fell out of Ready reading "argues from support nobody banked". The disposition still
        // shows, in the words after the comma, where it costs the claim no ground against its own source.
        const claimText = treat === "replace" ? `${c.subject} means ${c.proposed}, not ${q(before)}`
          : treat === "narrow" ? `${c.subject} means ${c.proposed}, stated less precisely as ${q(before)}`
            : `${c.subject} means ${c.proposed}, written with broken formatting as ${q(before)}`;
        const kept = treat === "replace" ? "the sources on file contradict this wording"
          : treat === "narrow" ? "the sources on file put this wording more precisely"
            : "the supported meaning is unchanged and only its formatting is repaired";
        const matters = treat === "repair"
          ? `${path} carries the supported meaning of ${c.subject} with broken formatting, so readers see ${q(before)} The meaning does not change and the line reads correctly once it is repaired.`
          : treat === "narrow"
            ? `${path} tells readers ${q(before)} about ${c.subject}, and its own sources of record put it more precisely. A sharper line is easier to trust than a loose one.`
            : `${path} tells readers ${q(before)} about ${c.subject}, and its own sources of record contradict that. A page that states what its sources deny is harder to trust than one that says less.`;
        // THE EXACT PASSAGES, ONE SUPPORT PER QUOTED SOURCE. The card used to carry one summary sentence naming
        // urls, so the paid reviewer was asked "is it consistent with the quoted source" over no quote at all,
        // and the proof receipt could show a reader nothing a source actually said. A source whose banked quote
        // is empty was never read into evidence here and never counts toward how many sources stand under this.
        const quoted = c.sources.filter((s) => s.says.trim() !== "").slice(0, 3)
          .map((s, j) => ({ id: `fact-${j + 1}`, fact: `${s.kind} ${s.url} says: "${s.says.trim()}"` }));
        const support = quoted.length > 0
          ? quoted : [{ id: "fact-1", fact: `${c.sources[0]?.kind ?? "The source"} ${c.sources[0]?.url ?? ""} was read and gives ${c.proposed}.` }];
        cards.push({
          id: `${tenantId}::${path.toLowerCase()}::existing_edit::fact-${slugOf(c.subject) || i + 1}`, tenantId, kind: "existing_edit",
          pagePath: path, pageUrl: page.url, pageLabel: path, primaryQuery: `${path} factual accuracy`,
          opportunityType: act,
          changeFamily: "factual_correction", status: "needs_review",
          recommendedChange: { kind: "existing_edit", field: "section", before, after, where },
          preservation: [{ text: before, disposition: "corrected" as const, by: support.map((s) => s.id), why: kept }], // THE LINE THIS REPLACES IS CORRECTED, NOT DROPPED, said in the one typed ledger every replacement answers to: a correction used to leave the preservation boundary entirely, which made "factual correction" a licence to delete whatever else stood in the line (Codex, 2026-08-28)
          claims: [{ text: claimText, supportedBy: support.map((s) => s.id) }],
          supportFacts: support,
          whyItMatters: matters,
          operatorSteps: [`Open the site editor on ${path}`, `Find ${where.replace(/^The /, "the ")}`,
            `Replace "${before}" with "${after}"`, "Mark it done here"],
          estimatedEffortMinutes: 2, riskLevel: "medium", confidence: "high",
          // THE FREE GATE RUNS AT MINT, NOT ONLY INSIDE THE PAID REVIEW. `unfitToStandIn` costs nothing and needs
          // nobody's permission, and it was reachable only through the paid reviewer: while the provider is out
          // of credit that review never runs, so five of the seven live corrections sat in the operator's queue
          // with a replacement that cannot stand where it goes and NO reason on the card saying so.
          limitations: [unfitToStandIn(before, after, c.subject)
            ?? "Beacon's own sense review has not read this correction yet, so it waits for that reading rather than for the operator to do Beacon's checking.",
            "The page's own words were treated as evidence of what it says, never as proof they are true."],
          causeFinding: { cause: "factual_error", action: "section", evidenceKeys: ["fact-1"],
            explanation: treat === "replace" ? `${path} states a meaning for ${c.subject} that an independent source of record contradicts, and a supported replacement is on file.`
              : treat === "narrow" ? `${path} states a meaning for ${c.subject} more broadly than its own sources of record support, and the supported wording is on file.`
                : `${path} carries the supported meaning of ${c.subject} with broken formatting, and the repaired wording is on file.`,
            competingExplanations: [{ cause: "no_problem", reason: `${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(rows.length)} checked statements on this page are correct, so the page is not wholesale wrong.` }],
            notConsidered: [{ cause: "ranking_loss", missing: "whether this wrong meaning costs the page positions is a separate question with separate evidence, and nothing here ties the two together." }],
            falsifier: `If the next check run finds ${path} already carries the corrected wording, this retires itself.` },
          diagnosisCause: "factual_error",
          evidence: { query: `${path} factual accuracy`, hints: support.map((s) => s.fact), evidenceRefCount: support.length },
          // The measured demand for THIS entry FUNDS the card (impactScore); the display figure stays the page's own impressions because the card's sentence names the page, and overriding it made the sentence lie (live, 2026-08-30).
          impactScore: subjectDemand(c.subject) > 0 ? subjectDemand(c.subject) / 100 : null, upsidePerMonth: null, demandImpressions90d: page.search?.impressions90d ?? null,
          publish: "manual", createdAt: now.toISOString(),
        });
      }
    }
    // A CORRECTION CARD EXISTS ONLY WHILE ITS CORRECTION IS AUTHORIZED. These cards deliberately carry no bundle,
    // so the stale sweep cannot reach them, and nothing else could either: a card minted on evidence later found
    // to be about the wrong subject stayed Ready for ever, which is a false confirmation preserved purely because
    // a card already existed. This producer owns every `fact-` id, so it retires exactly the ones it did not
    // re-emit. NARROW AND FAIL-CLOSED: only pages whose body actually loaded this pass are judged, because
    // `authorizedCorrections` compares a page hash and a failed body read would otherwise retire every correction
    // on the site at once, which is how three consecutive passes once destroyed the operator's finished work.
    const judged = new Set([...pageHashes.keys()].map((k) => pathOf(owned.get(k)!.url).toLowerCase()));
    const emitted = new Set(cards.map((c) => c.id));
    // THE WITHDRAWAL SAYS THE REAL REASON when the row itself can name one: "evidence no longer current" told
    // the operator nothing about a quote that never carried the published words.
    // ONLY THE CLAIM'S CURRENT ROW MAY SAY WHY IT WAS WITHDRAWN. A subject keeps its superseded history under
    // the same slug, so reading every row let an OLD version's refusal be reported as this one's: the live
    // Jasmine card was withdrawn saying its quote did not carry the wording, when the quote carries it exactly
    // and the real refusal is that the proposal restates the quote. No receipt invents a cause, including a
    // true one belonging to a different reading.
    const why = noOpWhy; // seeded by the mint's own no-op skips, so the sweep withdraws them WITH the named reason instead of the fail-closed keep
    for (const [key, rows] of byPage) { const pg = owned.get(key); if (!pg) continue;
      for (const r of rows) { if (r.state !== "checked" || r.rulesVersion !== VERIFICATION_RULES_VERSION) continue;
        const reason = unauthorizedReason(r) ?? supportShortfall(r, tenantId); if (reason) why.set(`${pathOf(pg.url).toLowerCase()}::fact-${slugOf(r.subject) || ""}`, reason); } }
    const { loadChangeProposals, withdrawChangeProposal } = await import("@/domains/decision/proposal-store");
    // A LIVE CHECKED ROW UNDER CURRENT RULES, per subject slug: the one state in which the generic "evidence no
    // longer current" sentence is provably FALSE. Seven authorized corrections were withdrawn through that exact
    // branch at 03:32Z on 2026-08-30 while their checked rows stood confirmed, by a pass nothing could later
    // reconstruct. A card may now be withdrawn only WITH a named reason, or when its claim genuinely has no
    // current checked row left; an unexplained miss keeps the card and says so out loud, because silently
    // destroying finished work is the one failure this producer has already committed twice.
    const liveChecked = new Set<string>();
    for (const [key, rows] of byPage) { const pg = owned.get(key); if (!pg) continue;
      for (const r of rows) if (r.state === "checked" && r.rulesVersion === VERIFICATION_RULES_VERSION) liveChecked.add(`${pathOf(pg.url).toLowerCase()}::fact-${slugOf(r.subject) || ""}`); }
    for (const p of (await loadChangeProposals(tenantId).catch(() => null))?.values() ?? []) {
      const id = p.id.split("::");
      // A PAGE WHOSE BODY DID NOT LOAD IS NOT A PAGE WHOSE CORRECTIONS DIED. `authorizedCorrections` compares a
      // page hash, so without one every correction on the site reads as unauthorized at once.
      if (!id[3]?.startsWith("fact-") || emitted.has(p.id) || !judged.has(id[1] ?? "")) continue;
      const slug = `${id[1] ?? ""}::${id[3] ?? ""}`, said = why.get(slug);
      if (!said && liveChecked.has(slug)) {
        log.warn("[factual-defects] a correction went unminted with NO named reason while its checked row stands; the card is KEPT and this pass is the anomaly", { tenantId, id: p.id });
        continue;
      }
      await withdrawChangeProposal(p, said
        ? `Withdrawn: ${said}. The claim stays a finding until a source quote genuinely carries it.`
        : "The evidence behind this correction is no longer current, so the correction is withdrawn rather than left standing on it.").catch(() => false);
      log.info("[factual-defects] a correction lost its evidence and was withdrawn", { tenantId, id: p.id });
    }
    log.info("[factual-defects] banked checks turned into work", { tenantId, cards: cards.length, checks: checks.length });
    return { cards, complete: true };
  } catch (e) {
    log.warn("[factual-defects] the fact checks could not be read; nothing minted and nothing swept", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return { cards: [], complete: false };
  }
}

/** THE PRODUCER'S SURFACE, as one export: the $0 mint, and Beacon's own paid sense review of what it minted. */
export const FACTUAL_DEFECTS = { cards: factualDefectCards, review: reviewFactualCards } as const;
