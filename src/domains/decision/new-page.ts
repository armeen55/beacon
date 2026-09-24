import "server-only";
import { createHash } from "node:crypto";
import { authorizedCorrections, type FactCheck } from "@/domains/evidence/pages/fact-checks";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { earnedNewPage } from "./coverage-adjudication";
import type { DecidedTopic } from "./coverage-pass";
import { componentIdOf, type BundleComponent, type ChangeProposal } from "./contracts";
import { COPY_RULES } from "./copy-sanitize";
import { draftFieldForPage, reviewFinishedCopy, topicSourceFacts } from "./drafted-copy";
import { callStructuredLLM, type CompleteFn } from "./llm/structured-drafter";
import type { NewPageBrief } from "./llm/schemas";
import { DRAFT_BUDGET } from "./draft-budget";
import { deliverableGaps } from "./completeness";
import { REVIEW_CONTRACT, copyKey } from "./proof";
import { validateProposal } from "./validate-proposal";

type Allowance = { left: number; record?: (value: unknown) => void };
type Input = { tenantId: string; snapshot: EvidenceSnapshot; coverage: DecidedTopic; basis: string; checked: readonly FactCheck[]; prior?: ChangeProposal | null;
  now: Date; attempts: Allowance; complete?: CompleteFn; bypassCache?: boolean; bannedTerms?: readonly string[]; stopBy?: number; workKey: string;
  save: (row: ChangeProposal) => Promise<boolean> };
type Result = { row: ChangeProposal | null; need?: string; detail: string };
const digest = (value: unknown): string => createHash("sha256").update(COPY_RULES.recordKey(value)).digest("hex");
const caseId = (topic: string): string => topic.replaceAll("::", "~");
const sourceKey = (id: string): string => `topic:${id}`;
const truth = (checks: readonly FactCheck[], tenantId: string, page: string, basis: string): FactCheck[] => authorizedCorrections(checks.filter(c => c.page === page && c.current.trim() === "" && c.pageContentHash === null && c.evidenceBasis === basis), undefined, tenantId)
  .sort((a, b) => a.statementKey.localeCompare(b.statementKey));
const fakeBody = (site: string, id: string, title: string, h1: string, pieces: readonly NonNullable<ChangeProposal["newPageDraft"]>["pieces"][number][], now: Date): OwnedPageBody => ({
  url: new URL(`/beacon-draft/${encodeURIComponent(id)}`, /^https?:\/\//.test(site) ? site : `https://${site}`).toString(), title, h1, metaDescription: null,
  headings: pieces.map(p => p.heading).filter((h): h is string => !!h), passages: pieces.map(p => p.after), openingSample: pieces.find(p => p.slot === 0)?.after ?? null,
  vocabulary: "", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt: now.toISOString(), completeness: "complete", contentHash: null, heldNote: "Unpublished draft", version: "current" });

/** A coverage verdict may buy one brief and then the canonical editor writes each owed piece. Only a complete, source-qualified bank can enter whole-page review. */
export async function produceNewPage(input: Input): Promise<Result> {
  const { tenantId, snapshot, coverage, basis, now, attempts } = input, decision = coverage.decision, topic = coverage.investigation;
  if (!earnedNewPage(decision) || !decision.pattern || !topic.label.trim() || !snapshot.scope.site) return { row: null, detail: "The new-page decision, winning-page reading or account site is incomplete." };
  const idPart = caseId(topic.key), id = `${tenantId}::${idPart}::new_page`, owner = sourceKey(idPart), prior = input.prior?.id === id ? input.prior : null, bank = prior?.newPageDraft, stored = bank && COPY_RULES.newPageSourceBound(bank) ? bank.brief : null;
  const holdSource = async (detail: string, source = true): Promise<Result> => { if (!prior) return { row: null, ...(source ? { need: topic.label } : {}), detail }; const held: ChangeProposal = { ...prior, status: "needs_review", researchOnly: true, ...(source ? { semanticReview: undefined } : {}), obligation: source ? { kind: "evidence", need: { kind: "factual_source", topic: { key: owner, label: topic.label }, query: topic.label, missingTopic: topic.label, reasonCode: "new_page_source_owed" } } : { kind: "terminal", reason: detail, holdCode: "bank_reconciliation" } }; return await input.save(held) ? { row: held, ...(source ? { need: topic.label } : {}), detail } : { row: null, ...(source ? { need: topic.label } : {}), detail: `${detail} The safety hold could not be persisted.` }; };
  if (input.prior && !prior) return { row: null, detail: "A different historical new-page identity is on file; no banked copy was reused." };
  if (bank && (!stored || !COPY_RULES.newPagePieces(bank))) return holdSource("The saved page has no source-bound plan; its copy is preserved for reconciliation.", false);
  const oldIndex = Array.isArray(stored?.sourceIndex) ? stored.sourceIndex as NonNullable<ChangeProposal["supportFacts"]> : null, checked = truth(input.checked, tenantId, owner, basis), oldFacts = oldIndex?.flatMap(f => checked.find(c => c.statementKey === f.finding?.statementKey) ?? []) ?? [], fresh = checked.filter(c => !oldIndex?.some(f => f.finding?.statementKey === c.statementKey));
  const cited = new Set([...(prior?.claims ?? []).flatMap(c => c.supportedBy), ...((stored?.headKeys as string[] | undefined) ?? []), ...((stored?.sections as NewPageBrief["sections"] | undefined) ?? []).flatMap(s => s.evidenceKeys)]), swapAt = bank?.repair?.resolution === "acquire_factual_source" && oldIndex && oldFacts.length === oldIndex.length && fresh.length && oldIndex.length === topicSourceFacts(checked, tenantId).length ? oldIndex.findIndex((_, i) => !cited.has(`fact-${i + 1}`)) : -1;
  if (swapAt >= 0) oldFacts[swapAt] = fresh[0]!;
  const oldRepair = prior && bank?.repair?.of === copyKey(prior) ? bank.repair : null;
  const ordered = oldIndex ? oldRepair?.resolution === "acquire_factual_source" ? [...oldFacts, ...fresh.filter((_, i) => i !== 0 || swapAt < 0)] : oldFacts : checked;
  const sourceFacts = topicSourceFacts(ordered, tenantId), facts = ordered.slice(0, sourceFacts.length);
  if (!facts.length) return holdSource("The topic has no qualified source finding; its first factual reading is owed before a page brief is bought.");
  const sourceHost = (url: string): string | null => { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.hostname : null; } catch { return null; } };
  if (facts.some(f => f.sources.some(s => !sourceHost(s.url)))) return holdSource("A checked topic finding has an unusable source address; its banked copy awaits reconciliation.", false);
  const factIndex = facts.map((f, i) => ({ id: `fact-${i + 1}`, fact: `${f.subject}: ${f.proposed}`, finding: f.statementKey, sources: f.sources.filter(s => s.says.trim()).map(s => ({ url: s.url, kind: s.kind })) }));
  const material = digest([tenantId, idPart, basis, decision.pattern.fingerprint, facts.map(f => [f.statementKey, f.proposed, f.sources])]);
  const sameSource = (f: typeof sourceFacts[number], at: number) => COPY_RULES.recordKey([f.fact, f.sources, f.finding]) === COPY_RULES.recordKey([sourceFacts[at]?.fact, sourceFacts[at]?.sources, sourceFacts[at]?.finding]);
  if (oldIndex?.some((f, i) => cited.has(f.id) && !sameSource(f, i))) return holdSource("A cited source finding changed; the prior page is held until its claim support is reconciled.", false);
  const addedSource = oldIndex && sourceFacts.length > oldIndex.length && oldIndex.every(sameSource), swappedSource = swapAt >= 0 && oldIndex?.every((f, i) => i === swapAt || sameSource(f, i));
  const rebound = !!(oldRepair?.resolution === "acquire_factual_source" && (addedSource || swappedSource) && stored?.patternFingerprint === decision.pattern.fingerprint && stored?.diagnosisFingerprint === digest(decision.evidence) && prior?.basis === basis);
  if (bank && (!stored || stored.material !== material && !rebound || prior?.basis !== basis || !Array.isArray(stored.sections))) return holdSource("The saved page belongs to different evidence or an ambiguous plan; its copy is preserved for reconciliation.", false);
  let brief: NewPageBrief;
  if (stored) brief = stored as unknown as NewPageBrief;
  else {
    if (input.stopBy != null && Date.now() >= input.stopBy || attempts.left < 1) return { row: null, detail: "The funded turn ended before the page brief could start." };
    const context = { question: topic.label, queries: topic.queries, pageType: topic.pageType, verdict: decision.explanation, ruledOut: decision.alternativesRuledOut,
      pattern: decision.pattern.brief ?? decision.pattern, facts: factIndex.map(({ id: key, fact, sources }) => ({ key, fact, sources })), owned: snapshot.ownedPages.map(p => ({ url: p.url, title: p.content?.title ?? null })).slice(0, 20) };
    const ask = await callStructuredLLM({ kind: "new_page_brief", tenantId, proposalWorkKey: input.workKey, system: "Write one complete new-page plan for the earned reader task, including a publication title and explicit H1 page heading. Use only supplied facts for factual claims. Cite exact fact-N keys for the title, heading, description, opening and every section. The supplied comparison justifies the page, but rival text does not support publication claims. Do not invent experience, claims, sources, or sections to fill a quota. Return no unwritten FAQ or link promises. Publication remains manual.", user: JSON.stringify(context), grounded: facts.map(f => f.proposed ?? "").join("\n"), complete: input.complete, bypassCache: input.bypassCache, now, attempts, stopBy: input.stopBy });
    attempts.record?.(ask); DRAFT_BUDGET.refundIfNoCallMade(attempts, ask);
    if (ask.status !== "drafted") return { row: null, detail: `The page brief was not accepted (${ask.status}); no partial page was published.` };
    brief = ask.value;
    const allowed = new Set(factIndex.map(f => f.id)), keys = [...brief.headKeys, ...brief.sections.flatMap(s => s.evidenceKeys)];
    if (keys.some(k => !allowed.has(k)) || new Set(brief.sections.map(s => COPY_RULES.flat(s.heading))).size !== brief.sections.length || brief.sections.some(s => !s.evidenceKeys.length)) return { row: null, detail: "The brief cites absent source findings or repeats a section; no page bank was created." };
  }
  const identity = JSON.stringify([tenantId, idPart, basis, material, brief.sections]), old = bank ? COPY_RULES.newPagePieces(bank) : new Map<number, NonNullable<ChangeProposal["newPageDraft"]>["pieces"][number]>();
  if (!old || bank && (bank.brief.identity !== identity && !rebound || [...old.values()].some(p => !p.assignment || !COPY_RULES.accepted(p.editor) || p.reviewOf !== COPY_RULES.pieceKey(p) || !p.claims.length || p.claims.some(c => !c.supportedBy.some(id => oldIndex?.some(f => f.id === id)))))) return holdSource("The banked sections no longer match their source-bound brief or cite only an unpublished draft; preserved without another purchase.", false);
  const pieces = new Map(old), repair = oldRepair, correcting = new Map<number, string>();
  if (repair) {
    if (repair.resolution === "acquire_factual_source" && !rebound) return fresh.length && oldIndex?.length === sourceFacts.length && swapAt < 0 ? { row: prior, detail: "Every source slot is cited; the new finding cannot replace one without losing another claim's support." } : { row: prior, need: repair.targets[0]?.instruction ?? topic.label, detail: "The whole-page reviewer named a factual claim whose source is still owed." };
    if (!/^(structural_synthesis|use_stored_verified_evidence)$/.test(repair.resolution) && !rebound || !repair.targets.length) return { row: prior, detail: "The saved whole-page refusal remains on its exact copy; no identical review was bought." };
    if (repair.targets.some(t => t.component < 0 || t.component > brief.sections.length + 3)) return { row: prior, detail: "The saved repair targets no component of this page." };
    if (repair.targets.some(t => t.component < 3)) {
      if (attempts.left < 1 || input.stopBy != null && Date.now() >= input.stopBy) return { row: prior, detail: "The title or description repair waits for its funded turn." };
      const asked = await callStructuredLLM({ kind: "new_page_brief", tenantId, proposalWorkKey: input.workKey, system: "Correct only the named title, description or H1 in this existing page brief. Keep every section, opening, FAQ and link field unchanged. Cite only exact supplied fact-N keys. Do not replace approved body copy or invent a claim.", user: JSON.stringify({ brief, repairs: repair.targets.filter(t => t.component < 3), facts: factIndex }), grounded: facts.map(f => f.proposed).join("\n"), complete: input.complete, bypassCache: input.bypassCache, now, attempts, stopBy: input.stopBy });
      attempts.record?.(asked); DRAFT_BUDGET.refundIfNoCallMade(attempts, asked);
      if (asked.status !== "drafted" || ["sections", "openingAnswer", "whyExistingPagesLose", "sourceRequirements", "factRequirements", "internalLinks", "faqQuestions"].some(k => JSON.stringify(asked.value[k as keyof NewPageBrief]) !== JSON.stringify(brief[k as keyof NewPageBrief])) || asked.value.headKeys.some(k => !factIndex.some(f => f.id === k)) || !repair.targets.some(t => t.component === 0) && asked.value.proposedTitle !== brief.proposedTitle || !repair.targets.some(t => t.component === 1) && asked.value.metaDescription !== brief.metaDescription || !repair.targets.some(t => t.component === 2) && asked.value.pageHeading !== brief.pageHeading) return { row: prior, detail: "The targeted head repair did not preserve the approved page plan." };
      brief = asked.value;
    }
    for (const target of repair.targets) if (target.component >= 3) { const slot = target.component - 3; correcting.set(slot, target.instruction); pieces.delete(slot); }
  }
  const receipt = [{ key: "verdict", kind: "diagnosis" as const, fact: decision.explanation, observedAt: null },
    ...factIndex.map(f => ({ key: f.id, kind: "independent_source" as const, fact: f.fact, observedAt: null, sources: f.sources.map(s => ({ ...s, publisher: sourceHost(s.url)!, channel: "seo" as const })) }))];
  const bundle = (components: BundleComponent[]) => ({ objective: `Answer ${topic.label} on one justified new page.`, metric: `Search clicks for ${topic.label}`, scope: { queries: [...topic.queries], prompts: [] }, components,
    receipt: { items: receipt, missing: [], freshestObservedAt: null }, alternatives: decision.alternativesRuledOut.map(a => ({ option: a.alternative, reason: a.reason })),
    risks: ["You publish this new page manually after checking its copy and sources."], confidenceReasons: [decision.explanation], measurementPlan: `After you publish it, compare ${topic.label} at 7, 14 and 28 days.` });
  const row = (complete: boolean): ChangeProposal => {
    const head = (kind: "title" | "meta" | "h1", after: string): BundleComponent => ({ kind, label: kind === "title" ? "Page title" : kind === "h1" ? "Page heading (H1)" : "Meta description", before: null, after, where: kind === "h1" ? "One H1 at the top of the new page" : undefined, evidenceKeys: ["verdict", ...brief.headKeys], risk: "review" });
    const components: BundleComponent[] = [head("title", brief.proposedTitle), head("meta", brief.metaDescription), head("h1", brief.pageHeading)], placed: number[] = [];
    for (const slot of [0, ...brief.sections.map((_, i) => i + 1)]) { const piece = pieces.get(slot); if (!piece) continue; const heading = slot === 0 ? null : brief.sections[slot - 1]!.heading, pub = COPY_RULES.publication(piece, heading);
      placed.push(slot); components.push({ kind: slot === 0 ? "opening_answer" : "section", label: heading ?? "Opening answer", before: null, after: pub.after, units: pub.units, target: pub.target, where: slot === 0 ? "At the top of the new page" : `After ${slot === 1 ? "the opening" : brief.sections[slot - 2]!.heading}`, evidenceKeys: [...new Set(["verdict", ...(slot === 0 ? brief.headKeys : brief.sections[slot - 1]!.evidenceKeys), ...piece.claims.flatMap(c => c.supportedBy)])], risk: "review" }); }
    const claims = components.flatMap((part, i) => i < 3 ? [{ text: part.after, supportedBy: [...brief.headKeys], of: componentIdOf(part, i) }] : (pieces.get(placed[i - 3]!)?.claims ?? []).map(c => ({ ...c, of: componentIdOf(part, i) })));
    const used = new Set(claims.flatMap(c => c.supportedBy)), supportFacts = [...new Map([...sourceFacts, ...[...pieces.values()].flatMap(p => p.supportFacts)].filter(f => used.has(f.id)).map(f => [f.id, f] as const)).values()];
    const base: ChangeProposal = { id, tenantId, kind: "new_page", pagePath: null, pageUrl: null, pageLabel: brief.proposedTitle, primaryQuery: topic.label, opportunityType: "Uncovered reader task", changeFamily: "new_page", treatment: "new_page", status: "needs_review", researchOnly: !complete,
      recommendedChange: { kind: "new_page", proposedTitle: brief.proposedTitle, metaDescription: brief.metaDescription, openingAnswer: pieces.get(0)?.after ?? brief.openingAnswer, outline: brief.sections.map(s => s.heading), faqQuestions: brief.faqQuestions, schemaTypes: [] },
      whyItMatters: `${decision.explanation} You publish this complete page manually.`, estimatedEffortMinutes: 60, riskLevel: "medium", confidence: "medium", limitations: [], evidence: { query: topic.label, hints: decision.evidence?.map(e => e.fact) ?? [], evidenceRefCount: receipt.length }, impactScore: null, upsidePerMonth: null,
      bundle: bundle(components), newPageDraft: { brief: { ...brief, kind: "new_page", identity, material, sourceIndex: sourceFacts, patternFingerprint: decision.pattern!.fingerprint, diagnosisFingerprint: digest(decision.evidence) }, pieces: [...pieces.values()].sort((a, b) => a.slot! - b.slot!) }, claims, supportFacts,
      ...(complete ? { informationGain: { adds: `A complete answer to ${topic.label} with ${brief.sections.map(s => s.heading).join(", ")}.`, by: [...used], pageWhole: true } } : {}),
      publish: "manual", createdAt: prior?.createdAt ?? now.toISOString(), basis, workKey: input.workKey };
    return repair && correcting.size ? { ...base, newPageDraft: { ...base.newPageDraft!, repair: { ...repair, of: copyKey(base), targets: repair.targets.filter(t => correcting.has(t.component - 3)) } } } : base;
  };
  if (!bank && !await input.save(row(false))) return { row: null, detail: "The brief could not be saved, so no section was bought." };
  for (const slot of [0, ...brief.sections.map((_, i) => i + 1)]) {
    if (pieces.has(slot)) continue;
    if (input.stopBy != null && Date.now() >= input.stopBy || attempts.left < 1) break;
    const heading = slot === 0 ? null : brief.sections[slot - 1]!.heading, task = heading ?? topic.label, previous = [...pieces.values()].sort((a, b) => a.slot! - b.slot!), keys = [...new Set([...(slot === 0 ? brief.headKeys : brief.sections[slot - 1]!.evidenceKeys), ...(correcting.has(slot) ? factIndex.slice(oldIndex?.length ?? 0).map(f => f.id) : [])])], assigned = factIndex.filter(f => keys.includes(f.id));
    const assignment = { page: owner, basis: identity, standard: "missing_answer" as const, gapKind: "new_page_piece", propositions: [task, ...(slot ? [brief.sections[slot - 1]!.covers] : [])], intent: [topic.label], facts: assigned.map(f => ({ id: f.id, says: f.fact })),
      informationNeed: { question: task, requiredAtomKeys: assigned.map(f => f.finding), polarity: "supports" as const, voice: "publisher" as const, deliveryMode: slot === 0 ? "inline" as const : "headed" as const },
      deliveryMode: slot === 0 ? "inline" as const : "headed" as const, diagnosedGap: correcting.get(slot) ?? (slot === 0 ? `Answer ${topic.label} directly.` : brief.sections[slot - 1]!.covers),
      treatment: slot === 0 ? "answer_block" as const : "section" as const, shape: slot === 0 ? "direct_answer" as const : "section" as const, anchor: heading ?? brief.proposedTitle,
      mustLeadWith: `The supported answer about ${task}.`, opening: "Teach the subject in the publisher's voice.", format: slot === 0 ? "A direct opening answer without a heading." : "A complete section under this heading.",
      pageContext: [], forbidden: [], rivals: [], briefing: [], mayReuse: "Use only the supplied claim-support facts, never the unpublished draft as support.", mustPreserve: "Nothing is published yet.",
      mustNotRepeat: `Do not repeat this saved copy: ${previous.map(p => p.after).join(" ").slice(0, 1400)}.${correcting.has(slot) ? ` The refused copy was: ${old.get(slot)?.after ?? ""}` : ""}`, placement: "additive" as const,
      completionTest: `Answer ${task}${slot ? `, specifically ${brief.sections[slot - 1]!.covers}` : ""}, with distinct information supported by the assigned facts; no later section is assumed written.` };
    const piece = await draftFieldForPage({ field: "answer_block", body: fakeBody(snapshot.scope.site!, idPart, brief.proposedTitle, brief.pageHeading, previous, now), query: topic.label, topic: owner,
      unpublished: true, checked: facts, allowedFactIds: keys, basis, brief: assignment.diagnosedGap, evidenceHints: [], ownedPaths: snapshot.ownedPages.map(p => p.url), minutes: 15,
      assignment, delivery: slot === 0 ? "opening" : undefined }, { tenantId, now, attempts, stopBy: input.stopBy, complete: input.complete, bypassCache: input.bypassCache, bannedTerms: input.bannedTerms });
    if (!piece || !COPY_RULES.accepted(piece.editor) || !piece.claims.length || piece.claims.some(c => !c.supportedBy.some(id => keys.includes(id))) || slot === 0 && (piece.heading != null || piece.units?.some(u => u.kind === "heading")) || slot > 0 && COPY_RULES.flat(piece.heading ?? "") !== COPY_RULES.flat(heading ?? "") || previous.some(p => COPY_RULES.flat(p.after) === COPY_RULES.flat(piece.after)) || correcting.has(slot) && COPY_RULES.flat(piece.after) === COPY_RULES.flat(old.get(slot)?.after ?? "")) break;
    pieces.set(slot, { ...piece, slot, heading }); correcting.delete(slot);
    if (!await input.save(row(false))) return { row: prior, detail: "A written piece could not be saved; later pieces were not bought." };
  }
  const complete = pieces.size === brief.sections.length + 1, rebuilt = row(complete), same = prior && copyKey(prior) === copyKey(rebuilt), assembled: ChangeProposal = same ? { ...rebuilt, status: prior.status, semanticReview: prior.semanticReview, faults: prior.faults, limitations: prior.limitations, newPageDraft: { ...rebuilt.newPageDraft!, repair: prior.newPageDraft?.repair } } : rebuilt;
  if (!complete) return { row: assembled, detail: `${brief.sections.length + 1 - pieces.size} planned page pieces still owe source-bound copy.` };
  if (deliverableGaps(assembled).length) return { row: assembled, detail: "The assembled page does not match its private piece bank." };
  const reviewed = await reviewFinishedCopy(assembled, { tenantId, now, attempts, stopBy: input.stopBy, complete: input.complete, bypassCache: input.bypassCache, bannedTerms: input.bannedTerms, checked: input.checked, basis, proposalWorkKey: input.workKey });
  const accepted = reviewed.row?.semanticReview?.version === REVIEW_CONTRACT && reviewed.row.semanticReview.of === copyKey(reviewed.row) && COPY_RULES.accepted(reviewed.row.semanticReview.editor);
  const final = reviewed.row ? { ...reviewed.row, status: accepted && validateProposal(reviewed.row).verdict === "ready" && deliverableGaps(reviewed.row).length === 0 ? "ready" as const : "needs_review" as const } : assembled;
  if (!await input.save(final)) return { row: assembled, detail: "The whole-page review could not be saved; the complete bank remains private." };
  return { row: final, detail: final.status === "ready" ? "A complete source-bound new page and its whole-page review are saved." : reviewed.detail };
}
