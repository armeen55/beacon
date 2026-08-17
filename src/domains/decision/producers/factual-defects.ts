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
import { authorizedCorrections, readFactChecks, type FactCheck } from "@/domains/evidence/pages/fact-checks";
import type { BundleComponent, ChangeProposal } from "@/domains/decision/contracts";

/** How many corrections ride one card, and how many the operator is asked to do in one sitting. A hundred
 *  and seventy two prose steps is not a deliverable; batches of this size are. */
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

export type FactualDefectRun = { cards: ChangeProposal[]; complete: boolean };

/** Every page whose banked checks contradict it, as one card each. Guarded like every producer: a read that
 *  fails narrows the pass and sweeps nothing. */
export async function factualDefectCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date }): Promise<FactualDefectRun> {
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
    const cards: ChangeProposal[] = [];
    for (const [key, rows] of byPage) {
      const page = owned.get(key);
      if (!page) continue; // a check for a page this account no longer owns is history, not work
      const path = pathOf(page.url);
      const corrections = authorizedCorrections(rows).sort((a, b) => a.subject.localeCompare(b.subject));
      const held = rows.filter((r) => !corrections.includes(r) && r.verdict !== "page_correct");
      const disputed = held.filter((r) => r.confidence === "disputed" || r.confidence === "likely");
      const unsupported = held.filter((r) => r.confidence === "unsupported");
      if (corrections.length === 0) continue; // nothing authorized: the findings live in the checks, not in a card
      const shown = corrections.slice(0, MAX_COMPONENTS);
      const components = shown.map(componentOf);
      const batches = Math.ceil(shown.length / BATCH);
      const checked = rows.length;
      const receipt = shown.map((c, i) => ({ key: `fact-${i + 1}`, kind: "page_extract" as const,
        fact: `The page says ${c.subject} means "${c.current}". ${c.sources[0]?.kind ?? "The source"} ${sourceLine(c)} gives ${c.proposed}.`,
        observedAt: c.checkedAt || null }));
      const objective = `${n(shown.length)} statements on ${path} stop contradicting their own sources.`;
      cards.push({
        id: `${tenantId}::${path.toLowerCase()}::existing_edit::factual_correction`, tenantId, kind: "existing_edit",
        pagePath: path, pageUrl: page.url, pageLabel: path, primaryQuery: `${path} factual accuracy`,
        opportunityType: `Correct ${n(shown.length)} statements on ${path} that independent sources contradict`,
        changeFamily: "factual_correction", status: "needs_review",
        recommendedChange: { kind: "existing_edit", field: "section", before: null,
          after: `Replace the ${n(shown.length)} statements listed below with their corrected wording. Each one carries the source that establishes it.` },
        bundle: {
          objective, metric: "Accuracy of the page's own statements, re-checked against the same sources on the next run.",
          scope: { queries: [], prompts: [] },
          components,
          plan: { entries: components.map((c) => ({ kind: c.kind, label: c.label, disposition: "change" as const })),
            keeps: [`Every statement on ${path} that the check run found correct (${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(checked)})`], removes: [] },
          receipt: { items: receipt, missing: unsupported.map((u) => `No credible source settles ${u.subject}, so nothing is proposed for it.`),
            freshestObservedAt: rows.map((r) => r.checkedAt).filter(Boolean).sort().at(-1) ?? null },
          alternatives: [{ option: "Leave the wording and add a note", reason: "A page that states a wrong meaning and a right one beside it is harder to trust, not easier." },
            ...(disputed.length > 0 ? [{ option: `Correct the ${n(disputed.length)} disputed entries too`, reason: "Their sources genuinely disagree or the page records a defensible modern usage, so replacing them would be a guess with a citation stapled on." }] : [])],
          risks: [`Each replacement changes published words, so check the corrected wording reads the way you want before pasting it.`,
            ...(disputed.length > 0 ? [`${n(disputed.length)} more entries are contested and deliberately not included here.`] : [])],
          confidenceReasons: [`Every correction here carries at least one scholarly, dictionary or encyclopedia source, and ${n(shown.filter((c) => c.agreement === "multiple_agree").length)} of ${n(shown.length)} have two or more independent sources agreeing.`],
          measurementPlan: "The next check run reads the same statements against the same sources; a corrected entry drops off this card by itself.",
        },
        whyItMatters: `${n(checked)} statements on ${path} were checked against independent sources. ${n(corrections.length)} are contradicted by a source of record and carry a supported replacement; ${n(disputed.length)} are contested and stay out of this list; ${n(unsupported.length)} have no credible source either way. Wrong meanings on a reference page are a trust problem on their own, whatever they do to rankings.`,
        operatorSteps: [`Open the site editor on ${path}`,
          `Work through the ${n(shown.length)} corrections below in ${n(batches)} ${batches === 1 ? "batch" : "batches"} of about ${BATCH}`,
          "Each one shows the exact current wording, the exact replacement and the source behind it",
          "Mark it done here and the next check run re-reads the page"],
        estimatedEffortMinutes: Math.max(10, shown.length * 2), riskLevel: "medium", confidence: "high",
        limitations: [`Only corrections with a scholarly, dictionary or encyclopedia source behind them are listed; ${n(disputed.length + unsupported.length)} findings are held back deliberately.`,
          "The page's own words were treated as evidence of what it says, never as proof they are true."],
        causeFinding: { cause: "factual_error", action: "section", evidenceKeys: receipt.map((r) => r.key).slice(0, 8),
          explanation: `${n(corrections.length)} statements on ${path} are contradicted by independent sources of record, each with a supported replacement on file. This is an accuracy defect in the page's own words; it is not measured as a ranking cause and claims no clicks.`,
          competingExplanations: [{ cause: "no_problem", reason: `${n(rows.filter((r) => r.verdict === "page_correct").length)} of ${n(checked)} checked statements are correct, so the page is not wholesale unreliable and only the named entries are being changed` }],
          notConsidered: [{ cause: "ranking_loss", missing: "whether these wrong meanings cost this page positions is a separate question with separate evidence, and no reading here ties the two together" }],
          falsifier: "If the next check run finds the page already carries the corrected wording, this card retires itself." },
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
