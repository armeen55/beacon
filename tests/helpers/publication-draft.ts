/** Scripted publication response; legacy flat fixtures remain usable as saved-copy inputs, never as gateway responses. */
export function publicationDraft<T extends Record<string, unknown>>(draft: T) {
  const { before: _before, after, ...metadata } = draft;
  return { preservation: [], ...metadata, units: [{ kind: "paragraph" as const, text: after }] };
}

import type { ChangeProposal } from "@/domains/decision/contracts";
import { PAGE_SUPPORT } from "@/domains/decision/completeness";
import { copyKey } from "@/domains/decision/proof";
/** Explicit source-qualified page fixture; component omission remains visible to the canonical gate. */
export function sourceBoundPage(p: ChangeProposal): ChangeProposal {
  const c = p.recommendedChange; if (c.kind !== "new_page") throw Error("A page fixture needs new-page copy.");
  const material = "fixture-material", diagnosis = "fixture-diagnosis", context = "fixture-reader-task", keys = ["fact-1"];
  const index = [{ id: keys[0]!, fact: p.supportFacts?.[0]?.fact ?? c.openingAnswer, finding: { tenantId: p.tenantId, page: `topic:${p.id.split("::")[1]}`, statementKey: "fixture-finding" }, sources: [{ url: "https://reference.example/checked-page", kind: "encyclopedia" }] }];
  const plan = { proposedTitle: c.proposedTitle, pageHeading: p.bundle?.components.find(x => x.kind === "h1")?.after ?? c.proposedTitle, metaDescription: c.metaDescription, openingAnswer: c.openingAnswer, headKeys: keys,
    whyExistingPagesLose: "The owned pages answer different reader tasks; this complete page answers the uncovered question.", sections: c.outline.map(heading => ({ heading, covers: `Explain ${heading} with the source's complete factual answer.`, evidenceKeys: keys })), sourceRequirements: [], factRequirements: [], internalLinks: [], faqQuestions: [] };
  const brief = { ...plan, kind: "new_page", material, diagnosisFingerprint: diagnosis, supportContext: context, patternFingerprint: "fixture-pattern", sourceIndex: index, identity: JSON.stringify([p.tenantId, p.id, p.basis, material, plan.sections]) };
  const support = { of: PAGE_SUPPORT.key(plan, material, index, diagnosis, context), rulings: PAGE_SUPPORT.tasks(plan, p.primaryQuery ?? "").map((_, task) => ({ task, supported: true, by: keys, missing: null })) };
  const pieces = p.newPageDraft?.pieces ?? [{ slot: 0, heading: null, after: c.openingAnswer }, ...(p.bundle?.components ?? []).filter(x => x.kind === "section").map(x => ({ slot: c.outline.indexOf(x.label) + 1, heading: x.label, after: x.after.startsWith(`${x.label}\n\n`) ? x.after.slice(x.label.length + 2) : x.after }))];
  const row: ChangeProposal = { ...p, supportFacts: index, newPageDraft: { brief: { ...brief, support }, pieces: pieces.map(x => ({ claims: [], supportFacts: [], review: [], ...x })) } };
  return p.semanticReview ? { ...row, semanticReview: { ...p.semanticReview, of: copyKey(row) } } : row;
}
