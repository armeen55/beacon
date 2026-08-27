import "server-only";

/** decision/producers/factual-defects - THE PAGE SAYS SOMETHING UNTRUE, minted from banked research and from nothing else. Written after 165 sourced corrections were injected straight into a stored proposal payload by hand,
 *  overwritten by the next producer pass, and reapplied by hand again (operator, 2026-08-17: the store is persistence, not an authoring interface). Everything here is DETERMINISTIC from evidence/pages/fact-checks: the same banked
 *  checks mint the same bundle on every pass, a check that moves moves the bundle, and a page whose checks all pass mints nothing, which is how the card retires itself once the operator has corrected the page and the next check run
 *  says so. ONLY CONFIRMED CORRECTIONS BECOME WORK. `likely` and `disputed` are real findings and stay in the research lane where they argue for themselves; `unsupported` names its missing source and proposes nothing. A correction
 *  with no scholarly, dictionary or encyclopedia source behind it never reaches a component, because a baby-name page is not authority to overwrite published words. IT IS NOT A RANKING STORY. This cause is `factual_error` and carries
 *  no click figure: whether the wrong meanings also cost the page positions is a separate finding with separate evidence, and merging them would let a correction inherit a loss nothing ties it to. */

import { log } from "@/lib/logger";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { authorizedCorrections, correctionSeverity, readFactChecks, type FactCheck } from "@/domains/evidence/pages/fact-checks";
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
const sourceLine = (c: FactCheck): string => c.sources.slice(0, 2).map((s) => s.url).join(", ");

/** One banked check as one copy-ready component: the exact words on the page, the exact replacement, where else the same statement appears, and the source that authorizes it. */
function componentOf(c: FactCheck, index: number): BundleComponent {
  const also = c.alsoAt.filter(Boolean);
  return {
    kind: "factual_correction",
    label: c.subject,
    before: c.current,
    after: c.proposed!,
    evidenceKeys: [`fact-${index + 1}`],
    risk: "review",
    where: also.length > 0
      ? `The "${c.subject}" entry, and the same statement at: ${also.slice(0, 3).join("; ")}`
      : `The "${c.subject}" entry`,
    objective: `${c.subject} stops stating a meaning its own sources contradict.`,
    mechanism: `${c.agreement === "multiple_agree" ? "Multiple independent sources agree" : "The source of record says"} ${c.proposed}${c.literal && c.literal !== c.proposed ? ` (literally ${c.literal})` : ""}.`,
    sourcePack: { sourceRequirements: c.sources.slice(0, 3).map((s) => `${s.kind}: ${s.url}`),
      factRequirements: [`${c.subject} means ${c.proposed}`, ...(c.usage ? [`In modern use: ${c.usage}`] : [])] },
  };
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
async function reviewFactualCards(cards: readonly ChangeProposal[], wiring: { tenantId: string; now: Date;
  attempts?: { left: number; record?: (r: unknown) => void }; complete?: unknown; bypassCache?: boolean }): Promise<ChangeProposal[]> {
  const parts = cards.map((c): BundleComponent => ({ kind: "factual_correction", label: c.recommendedChange.kind === "existing_edit" ? (c.recommendedChange.where ?? c.pagePath ?? "") : "",
    before: c.recommendedChange.kind === "existing_edit" ? c.recommendedChange.before : null,
    after: c.recommendedChange.kind === "existing_edit" ? c.recommendedChange.after : "",
    evidenceKeys: ["fact-1"], risk: "review",
    ...(c.recommendedChange.kind === "existing_edit" && c.recommendedChange.where ? { where: c.recommendedChange.where } : {}) }));
  if (parts.length === 0) return [...cards];
  const held = await reviewComponents(wiring.tenantId, parts, wiring.now, wiring).catch(() => null);
  if (held == null) return [...cards]; // unaffordable, refused or unreadable: nothing is promoted and nothing is lost
  return cards.map((c, i) => held.has(i)
    ? { ...c, limitations: [`Held by Beacon's own review: ${held.get(i)}`, ...(c.limitations ?? []).filter((l) => !l.startsWith("Beacon's own sense review has not"))] }
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
    const candidateUrls = [...byPage].filter(([k, rows]) => owned.has(k) && authorizedCorrections(rows).length > 0)
      .map(([k]) => owned.get(k)!.url);
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
        const source = `The page says ${c.subject} means "${c.current}". ${c.sources[0]?.kind ?? "The source"} ${sourceLine(c)} gives ${c.proposed}.`;
        cards.push({
          id: `${tenantId}::${path.toLowerCase()}::existing_edit::fact-${slugOf(c.subject) || i + 1}`, tenantId, kind: "existing_edit",
          pagePath: path, pageUrl: page.url, pageLabel: path, primaryQuery: `${path} factual accuracy`,
          opportunityType: `Correct what ${path} says ${c.subject} means`,
          changeFamily: "factual_correction", status: "needs_review",
          recommendedChange: { kind: "existing_edit", field: "section", before: c.current, after: c.proposed!, where },
          claims: [{ text: `${c.subject} means ${c.proposed}, not "${c.current}".`, supportedBy: ["fact-1"] }],
          supportFacts: [{ id: "fact-1", fact: source }],
          whyItMatters: `${path} tells readers ${c.subject} means "${c.current}". Its own sources of record say otherwise, and a page that states a wrong meaning is harder to trust than one that says less.`,
          operatorSteps: [`Open the site editor on ${path}`, `Find ${where.replace(/^The /, "the ")}`,
            `Replace "${c.current}" with "${c.proposed}"`, "Mark it done here"],
          estimatedEffortMinutes: 2, riskLevel: "medium", confidence: "high",
          limitations: ["Beacon's own sense review has not read this correction yet, so it waits for that reading rather than for the operator to do Beacon's checking.",
            "The page's own words were treated as evidence of what it says, never as proof they are true."],
          causeFinding: { cause: "factual_error", action: "section", evidenceKeys: ["fact-1"],
            explanation: `${path} states a meaning for ${c.subject} that an independent source of record contradicts, and a supported replacement is on file.`,
            competingExplanations: [{ cause: "no_problem", reason: `${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(rows.length)} checked statements on this page are correct, so the page is not wholesale wrong.` }],
            notConsidered: [{ cause: "ranking_loss", missing: "whether this wrong meaning costs the page positions is a separate question with separate evidence, and nothing here ties the two together." }],
            falsifier: `If the next check run finds ${path} already carries the corrected wording, this retires itself.` },
          diagnosisCause: "factual_error",
          evidence: { query: `${path} factual accuracy`, hints: [source], evidenceRefCount: 1 },
          impactScore: null, upsidePerMonth: null, demandImpressions90d: page.search?.impressions90d ?? null,
          publish: "manual", createdAt: now.toISOString(),
        });
      }
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
