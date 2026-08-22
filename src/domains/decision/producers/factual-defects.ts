import "server-only";

/** decision/producers/factual-defects - THE PAGE SAYS SOMETHING UNTRUE, minted from banked research and from
 *  nothing else. Written after 165 sourced corrections were injected straight into a stored proposal payload
 *  by hand, overwritten by the next producer pass, and reapplied by hand again (operator, 2026-08-17: the
 *  store is persistence, not an authoring interface). Everything here is DETERMINISTIC from
 *  evidence/pages/fact-checks: the same banked checks mint the same bundle on every pass, a check that moves
 *  moves the bundle, and a page whose checks all pass mints nothing, which is how the card retires itself
 *  once the operator has corrected the page and the next check run says so.
 *
 *  ONLY CONFIRMED CORRECTIONS BECOME WORK. `likely` and `disputed` are real findings and stay in the research
 *  lane where they argue for themselves; `unsupported` names its missing source and proposes nothing. A
 *  correction with no scholarly, dictionary or encyclopedia source behind it never reaches a component,
 *  because a baby-name page is not authority to overwrite published words.
 *
 *  IT IS NOT A RANKING STORY. This cause is `factual_error` and carries no click figure: whether the wrong
 *  meanings also cost the page positions is a separate finding with separate evidence, and merging them would
 *  let a correction inherit a loss nothing ties it to. */

import { log } from "@/lib/logger";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { authorizedCorrections, correctionSeverity, readFactChecks, type FactCheck } from "@/domains/evidence/pages/fact-checks";
import type { BundleComponent, ChangeProposal } from "@/domains/decision/contracts";

/** How many corrections ride one card, and how many the operator is asked to do in one sitting. A hundred
 *  and seventy two prose steps is not a deliverable; batches of this size are. NOTHING DISAPPEARS BEHIND THE
 *  CAP (Codex, 2026-08-18: 62 confirmed corrections vanished behind an alphabetical top 40): the card says
 *  which batch it is, how many corrections remain, and orders by severity so the worst are never the ones cut. */
const MAX_COMPONENTS = 40, BATCH = 10;

const pathOf = (url: string): string => {
  if (url.startsWith("/")) return url.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const n = (x: number): string => x.toLocaleString("en-US");
const sourceLine = (c: FactCheck): string => c.sources.slice(0, 2).map((s) => s.url).join(", ");

/** One banked check as one copy-ready component: the exact words on the page, the exact replacement, where
 *  else the same statement appears, and the source that authorizes it. */
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

/** BEACON PERFORMS THE SENSE REVIEW, NEVER THE OPERATOR (operator, 2026-08-22). The bundle sat at
 *  needs_review because "nothing has read this for sense yet", which delegated Beacon's own quality control.
 *  Batches of ten go to the one gateway with the exact current statement, replacement, source quote and
 *  locator; each component is ruled on ITS OWN INDEX, so one defective replacement holds only itself. A batch
 *  that cannot be read (unaffordable, refused, no key) reviews nothing and the card stays honestly at
 *  needs_review with the reason. Cached by content through the gateway, so a repeat pass reviews at $0. */
const REVIEW_SYSTEM = "You are Beacon's own final sense reviewer of sourced factual corrections about to be offered to a paying customer. For EACH numbered component judge only: does the replacement read as grammatical natural English a person would publish in place of the current statement; is it consistent with the quoted source; does it contradict any OTHER component in this batch. Return ONLY {\"rulings\":[{\"index\",\"publish\",\"reason\"}]} with one ruling per component, reason one short sentence. When in doubt on a component, publish=false.";
async function reviewComponents(tenantId: string, components: readonly BundleComponent[], now: Date,
  wiring: { attempts?: { left: number }; complete?: unknown; bypassCache?: boolean }): Promise<Map<number, string> | null> {
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

/** Every page whose banked checks contradict it, as one card each. Guarded like every producer: a read that
 *  fails narrows the pass and sweeps nothing. `review` wires Beacon's own sense review: with it, a bundle
 *  whose survivors all pass is promoted to ready; without it (or unaffordable) the card stays needs_review. */
export async function factualDefectCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  review?: { attempts?: { left: number }; complete?: unknown; bypassCache?: boolean } }): Promise<FactualDefectRun> {
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
    // THE PAGE VERSION DECISION CAN ACTUALLY SEE: a correction is work only while the page still says what it
    // objected to, so the hash is recomputed from the same stored words. Bounded to pages holding one.
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
      // SEVERITY FIRST, never the alphabet: a wholly wrong statement with two agreeing sources and repeats
      // elsewhere on the page is the one to fix, and it must never be the one the cap drops.
      // ONLY FACTS CURRENT FOR THIS PAGE VERSION MAY BECOME WORK (Codex, 2026-08-18): an older version, or a
      // source nobody recorded reading, is a finding and never a live instruction.
      const corrections = authorizedCorrections(rows, { pageContentHash: pageHashes.get(key) ?? null })
        .sort((a, b) => correctionSeverity(b) - correctionSeverity(a) || a.subject.localeCompare(b.subject));
      const held = rows.filter((r) => !corrections.includes(r) && r.verdict !== "page_correct");
      const disputed = held.filter((r) => r.confidence === "disputed" || r.confidence === "likely");
      const unsupported = held.filter((r) => r.confidence === "unsupported");
      if (corrections.length === 0) continue; // nothing authorized: the findings live in the checks, not in a card
      const shown = corrections.slice(0, MAX_COMPONENTS);
      const remaining = corrections.length - shown.length;
      let components = shown.map(componentOf);
      // BEACON'S OWN SENSE REVIEW, per component: survivors stay in the bundle, a failed component is held
      // WITH its reason where the operator can read it, and a review that could not run promotes nothing.
      // A REVIEW THAT HOLDS EVERYTHING HOLDS THE BUNDLE WHOLE (review, 2026-08-22): filtering to zero pieces
      // minted a card the contract schema refuses to read back, which is a vanished card over an unreadable
      // row. Survivors are what may be filtered TO; zero survivors keeps every piece and stays unpromoted.
      const heldByReview = input.review ? await reviewComponents(tenantId, components, now, input.review).catch(() => null) : null;
      const survivors = heldByReview ? components.filter((_, i) => !heldByReview.has(i)) : components;
      const reviewedOut = heldByReview && survivors.length > 0 ? [...heldByReview.entries()].map(([i, why]) => ({ c: components[i]!, why })) : [];
      if (heldByReview && survivors.length > 0) components = survivors;
      const reviewed = heldByReview != null && survivors.length > 0;
      const allHeld = heldByReview != null && survivors.length === 0 && components.length > 0;
      // EVERY COUNT THE OPERATOR READS SPEAKS FOR THE SURVIVORS (review, 2026-08-22): a ready card announcing
      // twelve corrections over nine rendered pieces is a contradiction on the primary surface.
      const shownCount = components.length;
      const batches = Math.ceil(shownCount / BATCH);
      const totalBatches = Math.ceil(corrections.length / MAX_COMPONENTS);
      const checked = rows.length;
      const receipt = shown.map((c, i) => ({ key: `fact-${i + 1}`, kind: "independent_source" as const,
        fact: `The page says ${c.subject} means "${c.current}". ${c.sources[0]?.kind ?? "The source"} ${sourceLine(c)} gives ${c.proposed}.`,
        observedAt: c.checkedAt || null }));
      const objective = `${n(shownCount)} statements on ${path} stop contradicting their own sources.`;
      cards.push({
        id: `${tenantId}::${path.toLowerCase()}::existing_edit::factual_correction`, tenantId, kind: "existing_edit",
        pagePath: path, pageUrl: page.url, pageLabel: path, primaryQuery: `${path} factual accuracy`,
        // THE COLLAPSED CARD NAMES THE DELIVERABLE, and the umbrella `after` is a description of the bundle,
        // NEVER the thing to paste: the card renders the pieces, and only each piece's own wording is copyable
        // (Codex, 2026-08-21: an umbrella Copy button copied "Replace the 40 statements listed below").
        opportunityType: remaining > 0
          ? `${n(shownCount)} sourced corrections on ${path} (batch 1 of ${n(totalBatches)}, ${n(remaining)} more confirmed after this)`
          : `${n(shownCount)} sourced corrections on ${path}`,
        changeFamily: "factual_correction", status: reviewed ? "ready" : "needs_review",
        recommendedChange: { kind: "existing_edit", field: "section", before: null,
          after: `${n(shownCount)} corrected statements, each with its exact current wording, its replacement and the source that establishes it. Work through them piece by piece below.` },
        bundle: {
          objective, metric: "Accuracy of the page's own statements, re-checked against the same sources on the next run.",
          scope: { queries: [], prompts: [] },
          components,
          plan: { entries: components.map((c) => ({ kind: c.kind, label: c.label, disposition: "change" as const })),
            keeps: [`Every statement on ${path} that the check run found correct (${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(checked)})`], removes: [] },
          receipt: { items: receipt, missing: [
            ...reviewedOut.map((h) => `Held by Beacon's own review, ${h.c.label}: ${h.why}`),
            ...(allHeld && heldByReview ? [...heldByReview.entries()].map(([i, why]) => `Held by Beacon's own review, ${shown[i]?.subject ?? `entry ${i + 1}`}: ${why}`) : []),
            ...unsupported.map((u) => `No credible source settles ${u.subject}, so nothing is proposed for it.`)],
            freshestObservedAt: rows.map((r) => r.checkedAt).filter(Boolean).sort().at(-1) ?? null },
          alternatives: [{ option: "Leave the wording and add a note", reason: "A page that states a wrong meaning and a right one beside it is harder to trust, not easier." },
            ...(disputed.length > 0 ? [{ option: `Correct the ${n(disputed.length)} disputed entries too`, reason: "Their sources genuinely disagree or the page records a defensible modern usage, so replacing them would be a guess with a citation stapled on." }] : [])],
          risks: [`Each replacement changes published words, so check the corrected wording reads the way you want before pasting it.`,
            ...(disputed.length > 0 ? [`${n(disputed.length)} more entries are contested and deliberately not included here.`] : [])],
          confidenceReasons: [`Every correction here carries at least one scholarly, dictionary or encyclopedia source, and ${n(shown.filter((c) => c.agreement === "multiple_agree").length)} of ${n(shown.length)} authorized entries have two or more independent sources agreeing.`],
          measurementPlan: "The next check run reads the page again and compares each statement with the wording this card objected to; whatever now reads correctly retires itself and the next batch moves up.",
        },
        whyItMatters: `${n(checked)} statements on ${path} were checked against independent sources. ${n(corrections.length)} are contradicted by a source of record and carry a supported replacement; ${n(disputed.length)} are contested and stay out of this list; ${n(unsupported.length)} have no credible source either way. Wrong meanings on a reference page are a trust problem on their own, whatever they do to rankings.`,
        operatorSteps: [`Open the site editor on ${path}`,
          `Work through the ${n(shownCount)} corrections below in ${n(batches)} ${batches === 1 ? "batch" : "batches"} of about ${BATCH}`,
          "Each one shows the exact current wording, the exact replacement and the source behind it",
          ...(remaining > 0 ? [`${n(remaining)} more confirmed corrections are waiting behind this batch; they arrive here once these are marked done`] : []),
          "Mark it done here and the next check run re-reads the page and drops whatever you fixed"],
        estimatedEffortMinutes: Math.max(10, shownCount * 2), riskLevel: "medium", confidence: "high",
        limitations: [
          reviewed ? `Each correction was read by Beacon's own reviewer for grammar, source fit and contradictions before this was offered${reviewedOut.length > 0 ? `; ${n(reviewedOut.length)} ${reviewedOut.length === 1 ? "component is" : "components are"} held with the reason on the receipt` : ""}.`
            : allHeld ? "Beacon's own reviewer read every correction and held all of them, so nothing here is offered until the next check run rewrites them; each reason is on the receipt."
              : "Beacon's own sense review has not run on this bundle yet, so it waits for that reading, never for the operator to do Beacon's checking.",
          `Only corrections with a scholarly, dictionary or encyclopedia source behind them are listed; ${n(disputed.length + unsupported.length)} findings are held back deliberately.`,
          ...(remaining > 0 ? [`${n(corrections.length)} corrections are authorized in total and ${n(shown.length)} are shown here, worst first; the other ${n(remaining)} are not lost and are not silently dropped.`] : []),
          "The page's own words were treated as evidence of what it says, never as proof they are true."],
        causeFinding: { cause: "factual_error", action: "section", evidenceKeys: receipt.map((r) => r.key).slice(0, 8),
          explanation: `${n(corrections.length)} statements on ${path} are contradicted by independent sources of record, each with a supported replacement on file. This is an accuracy defect in the page's own words; it is not measured as a ranking cause and claims no clicks.`,
          competingExplanations: [{ cause: "no_problem", reason: `${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(checked)} checked statements are correct, so the page is not wholesale unreliable and only the named entries are being changed` }],
          notConsidered: [{ cause: "ranking_loss", missing: "whether these wrong meanings cost this page positions is a separate question with separate evidence, and no reading here ties the two together" }],
          falsifier: "If the next check run finds the page already carries the corrected wording, that statement retires itself and this card shrinks to what is genuinely left." },
        diagnosisCause: "factual_error",
        evidence: { query: `${path} factual accuracy`, hints: receipt.slice(0, 6).map((r) => r.fact), evidenceRefCount: Math.min(receipt.length, 8) },
        impactScore: null, upsidePerMonth: null, demandImpressions90d: page.search?.impressions90d ?? null,
        publish: "manual", createdAt: now.toISOString(),
      });
    }
    log.info("[factual-defects] banked checks turned into work", { tenantId, cards: cards.length, checks: checks.length });
    return { cards, complete: true };
  } catch (e) {
    log.warn("[factual-defects] the fact checks could not be read; nothing minted and nothing swept", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return { cards: [], complete: false };
  }
}
