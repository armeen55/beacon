import "server-only";

/** decision/producers/factual-defects - THE PAGE SAYS SOMETHING UNTRUE, minted from banked research and from nothing else. Written after 165 sourced corrections were injected straight into a stored proposal payload by hand,
 *  overwritten by the next producer pass, and reapplied by hand again (operator, 2026-08-17: the store is persistence, not an authoring interface). Everything here is DETERMINISTIC from evidence/pages/fact-checks: the same banked
 *  checks mint the same bundle on every pass, a check that moves moves the bundle, and a page whose checks all pass mints nothing, which is how the card retires itself once the operator has corrected the page and the next check run
 *  says so. ONLY CONFIRMED CORRECTIONS BECOME WORK. `likely` and `disputed` are real findings and stay in the research lane where they argue for themselves; `unsupported` names its missing source and proposes nothing. A correction
 *  with no scholarly, dictionary or encyclopedia source behind it never reaches a component, because a baby-name page is not authority to overwrite published words. IT IS NOT A RANKING STORY. This cause is `factual_error` and carries
 *  no click figure: whether the wrong meanings also cost the page positions is a separate finding with separate evidence, and merging them would let a correction inherit a loss nothing ties it to. */

import { log } from "@/lib/logger";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { copyKey } from "@/domains/decision/proof";
import { authorizedCorrections, correctionSeverity, readFactChecks, unauthorizedReason, VERIFICATION_RULES_VERSION, type FactCheck } from "@/domains/evidence/pages/fact-checks";
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

/** THE SPAN THE CORRECTION ACTUALLY REWRITES. The extractor quotes exactly, and its exact quote sometimes opens
 *  with the name heading itself ("Alborz\nMeaning:..."): a replacement targeted at that whole quote would delete
 *  the name from the page. The heading is not what is wrong, so when the first line is the subject and nothing
 *  else, the replaced span is everything after it. Shape only: no other narrowing is ever guessed. */
function replacedSpanOf(c: FactCheck): string {
  const lines = c.current.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 && lines[0]!.toLowerCase() === c.subject.trim().toLowerCase()
    ? lines.slice(1).join("\n") : c.current.trim();
}

/** A SOURCED GLOSS SHAPED INTO THE LINE IT REPLACES. The verified meaning arrives as the source's own fragment
 *  ("light", "Night; dark"), and pasted verbatim over "Meaning:Bright, radiant, or glowing." it deletes the
 *  page's label and leaves a lowercase stub mid-line: every live correction card was held on exactly that.
 *  SHAPE ONLY, NO VOCABULARY: the label prefix is the page's own, capitalization and the closing stop mirror the
 *  words being replaced, and a semicolon list becomes the ", or " prose the page's sibling entries already use.
 *  Not one word is added that the passage did not carry. */
function composedReplacement(before: string, proposed: string): string {
  const prefix = /^([\p{L}][\p{L} ]{1,23}:\s*)/u.exec(before)?.[1] ?? "";
  const gloss = proposed.trim().replace(/\s*;\s*/g, ", or ").replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
  const stop = /[.!?]["')\]]?\s*$/.test(before) && !/[.!?]["')\]]?$/.test(gloss) ? "." : "";
  return `${prefix}${gloss}${stop}`;
}

type FactualDefectRun = { cards: ChangeProposal[]; complete: boolean };

/** BEACON PERFORMS THE SENSE REVIEW, NEVER THE OPERATOR (operator, 2026-08-22). The bundle sat at needs_review because "nothing has read this for sense yet", which delegated Beacon's own quality control. Batches of ten go to the one
 *  gateway with the exact current statement, replacement, source quote and locator; each component is ruled on ITS OWN INDEX, so one defective replacement holds only itself. A batch that cannot be read (unaffordable, refused, no key)
 *  reviews nothing and the card stays honestly at needs_review with the reason. Cached by content through the gateway, so a repeat pass reviews at $0. */
const REVIEW_SYSTEM = "You are Beacon's own final sense reviewer of sourced factual corrections about to be offered to a paying customer. For EACH numbered component judge only: does the replacement read as grammatical natural English a person would publish in place of the current statement; is it consistent with the quoted source; does it contradict any OTHER component in this batch. Return ONLY {\"rulings\":[{\"index\",\"publish\",\"reason\"}]} with one ruling per component, reason one short sentence. When in doubt on a component, publish=false.";
async function reviewComponents(tenantId: string, components: readonly BundleComponent[], now: Date,
  wiring: { attempts?: { left: number; record?: (r: unknown) => void }; complete?: unknown; bypassCache?: boolean }): Promise<Map<number, string> | null> {
  const { callStructuredLLM } = await import("../llm/structured-drafter");
  const held = new Map<number, string>();
  for (let b = 0; b < components.length; b += BATCH) {
    const batch = components.slice(b, b + BATCH);
    if (wiring.attempts && (wiring.attempts.left -= 1) < 0) return null; // an unpaid batch reviews nothing
    const user = batch.map((c, i) => `#${i}: on the page now: "${c.before ?? ""}"\nreplacement: "${c.after}"\nsource: ${(c.sourcePack?.sourceRequirements ?? []).join("; ")}\nwhere: ${c.where ?? ""}`).join("\n\n")
      + `\n\nReturn one ruling per component, indexes 0 to ${batch.length - 1}.`;
    const r = await callStructuredLLM({ kind: "factual_review", tenantId, system: REVIEW_SYSTEM, user, grounded: user,
      projectedCostUsd: 0.01, maxTokens: 2500, timeoutMs: 95_000, now,
      ...(wiring.complete ? { complete: wiring.complete as never } : {}), ...(wiring.bypassCache ? { bypassCache: true } : {}) }).catch(() => null);
    wiring.attempts?.record?.(r); // BEFORE the status branch: a paid failure is still paid, and the receipt says so
    if (r?.status !== "drafted") return null;
    const rulings = (r.value as { rulings: { index: number; publish: boolean; reason: string }[] }).rulings;
    // A COMPONENT THE REVIEW DID NOT RULE ON IS NOT PUBLISHED: silence is never a pass.
    const ruled = new Map(rulings.map((x) => [x.index, x]));
    for (let i = 0; i < batch.length; i += 1) {
      const v = ruled.get(i);
      if (!v) held.set(b + i, "the review returned no ruling for it");
      else if (v.publish !== true) held.set(b + i, v.reason);
    }
    if (wiring.attempts && (r as { cached?: true }).cached) wiring.attempts.left += 1; // a cache hit cost nothing
  }
  return held;
}

/** BEACON REVIEWS ITS OWN CORRECTIONS, AS ONE RANKED PAID CANDIDATE. The minted card carries every authorized correction and waits at needs_review; this reads them in batches of ten against their own sources and returns the card the
 *  operator should see. Survivors stay and the card is promoted; a failed component is held WITH its reason on the receipt and never erases the valid ones; a review that holds EVERYTHING keeps every piece and promotes nothing (an
 *  empty bundle is a card the contract cannot read back); a review that could not run at all returns the card untouched, so the pass reports no promotion it did not earn. */
/** BEACON REVIEWS ITS OWN CORRECTIONS, ONE PAGE AT A TIME, and hands the verdict back to cards that stay atomic.
 *  The cards are separate so nothing can retire them together; the REVIEW is batched so forty of them cost one
 *  page's worth of calls and not forty. A card whose correction the reviewer holds keeps its words and its
 *  reason and simply is not offered; a card the reviewer clears becomes ready. Unreadable or unaffordable
 *  promotes nothing and loses nothing. */
/** The name a correction card is about, as it was minted: the row's own subject, not a re-parse of the copy. */
const subjectOf = (c: ChangeProposal): string => /^The "(.+?)" entry/.exec(c.recommendedChange.kind === "existing_edit" ? (c.recommendedChange.where ?? "") : "")?.[1] ?? "";

/** WHY THIS REPLACEMENT CANNOT STAND WHERE THE WORDS IT REPLACES STAND, or null when it can. A sourced meaning
 *  is not yet publishable copy: the source says darya derives from "possess or maintain; well, good", which is
 *  a true etymology and a dictionary fragment, and dropping it into "Meaning:_" leaves the page reading
 *  "Meaning:possess or maintain; well, good". Shape only, no vocabulary and no word list, so it says nothing
 *  about which language or subject a page is allowed to be about. Checked here, before anybody is paid to read
 *  it, because a deterministic gate does not have moods and does not cost anything to run. */
function unfitToStandIn(before: string | null, after: string, subject: string): string | null {
  const a = after.trim(), b = (before ?? "").trim(), bare = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  // The name check reads the words INSIDE the page's own label: composed copy carries the "Meaning:" prefix the
  // page carries, and "Meaning:Jasmine." offering Jasmine as Jasmine's meaning is exactly the empty answer this
  // gate exists for, prefix or no prefix.
  const label = /^([\p{L}][\p{L} ]{1,23}:\s*)/u.exec(b)?.[1] ?? "";
  const core = label && a.startsWith(label) ? a.slice(label.length) : a;
  if (bare(core) === bare(subject)) return "it offers the name itself as the name's meaning, which tells a reader nothing";
  if (b === "") return null; // nothing is being replaced, so there is no shape to match
  if (/[.!?]["')\]]?$/.test(b) && !/[.!?]["')\]]?$/.test(a)) return "the words it replaces finish a sentence and these do not, so the page would be left mid-sentence";
  if (a.includes(";") && !b.includes(";")) return "it lists alternative glosses where the page carries prose, which reads as a dictionary entry rather than as the page";
  return null;
}

async function reviewFactualCards(cards: readonly ChangeProposal[], wiring: { tenantId: string; now: Date;
  attempts?: { left: number; record?: (r: unknown) => void }; complete?: unknown; bypassCache?: boolean }): Promise<ChangeProposal[]> {
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
  const held = await reviewComponents(wiring.tenantId, parts.filter((_, i) => !unfit.has(i)), wiring.now, wiring).catch(() => null);
  if (held == null && unfit.size === 0) return [...cards]; // unaffordable, refused or unreadable: nothing promoted and nothing lost
  // The reviewer only ever saw the fit ones, so its indexes are remapped onto the cards they came from.
  const offered = parts.map((_, i) => i).filter((i) => !unfit.has(i));
  for (const [j, why] of held ?? []) unfit.set(offered[j]!, why);
  if (held == null) for (const [i] of parts.entries()) if (!unfit.has(i)) unfit.set(i, "Beacon's own sense review has not read this correction yet");
  return cards.map((c, i) => unfit.has(i)
    ? { ...c, limitations: [`Held by Beacon's own review: ${unfit.get(i)}`, ...(c.limitations ?? []).filter((l) => !l.startsWith("Beacon's own sense review has not"))] }
    : { ...c, status: "ready" as const,
      limitations: [...(c.limitations ?? []).filter((l) => !l.startsWith("Beacon's own sense review has not")),
        "Beacon's own reviewer read this correction for grammar, source fit and contradictions before it was offered."] });
}

/** Every page whose banked checks contradict it, as one card each, at $0. Guarded like every producer: a read that fails narrows the pass and sweeps nothing. Beacon's own sense review is a separate ranked candidate. */
async function factualDefectCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date }): Promise<FactualDefectRun> {
  const { tenantId, snapshot, now } = input;
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
      const bodies = await loadOwnedPageBodies(tenantId, candidateUrls).catch(() => null);
      for (const url of candidateUrls) {
        const b = bodies?.get?.(url);
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
      const corrections = authorizedCorrections(rows, { pageContentHash: pageHashes.get(key) ?? null }).filter((c) => c.current.trim() !== "")
        .sort((a, b) => correctionSeverity(b) - correctionSeverity(a) || a.subject.localeCompare(b.subject));
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
        const also = c.alsoAt.filter(Boolean);
        const where = also.length > 0
          ? `The "${c.subject}" entry, and the same statement at: ${also.slice(0, 3).join("; ")}`
          : `The "${c.subject}" entry`;
        const before = replacedSpanOf(c), after = composedReplacement(before, c.proposed!);
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
          opportunityType: `Correct what ${path} says ${c.subject} means`,
          changeFamily: "factual_correction", status: "needs_review",
          recommendedChange: { kind: "existing_edit", field: "section", before, after, where },
          authorizedFor: copyKey({ tenantId, pagePath: path, changeFamily: "factual_correction", supportFacts: support,
            recommendedChange: { kind: "existing_edit", field: "section", before, after, where } } as never),
          preservation: [{ text: before, disposition: "corrected" as const, by: support.map((s) => s.id), why: `the source of record says ${c.subject} means ${c.proposed}` }], // THE LINE THIS REPLACES IS CORRECTED, NOT DROPPED, said in the one typed ledger every replacement answers to: a correction used to leave the preservation boundary entirely, which made "factual correction" a licence to delete whatever else stood in the line (Codex, 2026-08-28)
          claims: [{ text: `${c.subject} means ${c.proposed}, not "${before}".`, supportedBy: support.map((s) => s.id) }],
          supportFacts: support,
          whyItMatters: `${path} tells readers ${c.subject} means "${before}". Its own sources of record say otherwise, and a page that states a wrong meaning is harder to trust than one that says less.`,
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
            explanation: `${path} states a meaning for ${c.subject} that an independent source of record contradicts, and a supported replacement is on file.`,
            competingExplanations: [{ cause: "no_problem", reason: `${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(rows.length)} checked statements on this page are correct, so the page is not wholesale wrong.` }],
            notConsidered: [{ cause: "ranking_loss", missing: "whether this wrong meaning costs the page positions is a separate question with separate evidence, and nothing here ties the two together." }],
            falsifier: `If the next check run finds ${path} already carries the corrected wording, this retires itself.` },
          diagnosisCause: "factual_error",
          evidence: { query: `${path} factual accuracy`, hints: support.map((s) => s.fact), evidenceRefCount: support.length },
          impactScore: null, upsidePerMonth: null, demandImpressions90d: page.search?.impressions90d ?? null,
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
    const why = new Map<string, string>();
    for (const [key, rows] of byPage) { const pg = owned.get(key); if (!pg) continue;
      for (const r of rows) { if (r.state !== "checked" || r.rulesVersion !== VERIFICATION_RULES_VERSION) continue;
        const reason = unauthorizedReason(r); if (reason) why.set(`${pathOf(pg.url).toLowerCase()}::fact-${slugOf(r.subject) || ""}`, reason); } }
    const { loadChangeProposals, withdrawChangeProposal } = await import("@/domains/decision/proposal-store");
    for (const p of (await loadChangeProposals(tenantId).catch(() => null))?.values() ?? []) {
      const id = p.id.split("::");
      // A PAGE WHOSE BODY DID NOT LOAD IS NOT A PAGE WHOSE CORRECTIONS DIED. `authorizedCorrections` compares a
      // page hash, so without one every correction on the site reads as unauthorized at once.
      if (!id[3]?.startsWith("fact-") || emitted.has(p.id) || !judged.has(id[1] ?? "")) continue;
      const said = why.get(`${id[1] ?? ""}::${id[3] ?? ""}`);
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
