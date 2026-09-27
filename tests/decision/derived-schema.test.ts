import { describe, expect, it } from "vitest"; import { componentIdOf, deserializeChangeProposal, serializeChangeProposal, type BundleComponent, type ChangeProposal } from "@/domains/decision/contracts";
import withDerivedFaqSchema from "@/domains/decision/derived-schema"; import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context"; import proposalIdentity from "@/domains/decision/proposal-identity"; import { COPY_RULES } from "@/domains/decision/copy-sanitize";
const URL = "https://fixture.example/heriz", ANSWER = "Heriz rugs are woven in East Azerbaijan.";
const copy = (answer = ANSWER): string => `## Where are Heriz rugs made?\n\n${answer}`;
const fact = { key: "page-copy-1", fact: "Heriz rugs are woven in East Azerbaijan.", observedAt: null, kind: "page_extract" as const };
const component = (answer = ANSWER): BundleComponent => ({ kind: "section", label: "Where are Heriz rugs made?", before: "Heriz rugs are made in Iran.", after: copy(answer),
  units: [{ kind: "heading", level: 2, text: "Where are Heriz rugs made?" }, { kind: "paragraph", text: answer }], target: { mode: "replace", anchorKind: "heading", anchor: "Where are Heriz rugs made?" }, where: 'Replace the recorded original copy inside the section headed "Where are Heriz rugs made?"; preserve the rest of that section.', evidenceKeys: [fact.key], risk: "review" });
const proposal = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: "t::/heriz::existing_edit::section", tenantId: "t", kind: "existing_edit", pagePath: "/heriz", pageUrl: URL, pageLabel: "Heriz", primaryQuery: "where are heriz rugs made", opportunityType: "Answer the question", changeFamily: "section", status: "ready", researchOnly: false,
  recommendedChange: { kind: "existing_edit", field: "section", before: "Heriz rugs are made in Iran.", after: component().after, units: component().units, target: component().target, where: component().where }, whyItMatters: "The answer should be complete.", estimatedEffortMinutes: 5, riskLevel: "low", confidence: "high", limitations: [], evidence: { query: "where are heriz rugs made", hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, modeledOn: "the stored results page", claims: [{ text: ANSWER, supportedBy: [fact.key] }], supportFacts: [{ id: fact.key, fact: fact.fact }], publish: "manual", createdAt: "2026-09-19T00:00:00.000Z",
  bundle: { objective: "Answer the question completely.", metric: "qualified clicks", scope: { queries: ["where are heriz rugs made"], prompts: [] }, components: [component()], receipt: { items: [fact], missing: [], freshestObservedAt: null }, alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "Measure after implementation." }, ...over });
const body = (jsonLd: string[] = []): OwnedPageBody => ({ tenantId: "t", url: URL, finalUrl: URL, pageId: "heriz", captureId: "heriz-v1", latestCaptureId: "heriz-v1", captureVersion: 1, title: "Heriz rugs", h1: "Heriz rugs", metaDescription: null, headings: ["Where are Heriz rugs made?"], passages: ["Heriz rugs are made in Iran."], openingSample: null, vocabulary: "Heriz rugs are made in Iran.", cardTexts: [], faqs: [{ question: "Where are Heriz rugs made?", answer: "Heriz rugs are made in Iran.", source: "html_section", answerComplete: true }], entityNames: [], internalLinks: [],
  sourceCapture: { version: 1, sourceRevision: "body-v1", mainHtml: "<main><h2>Where are Heriz rugs made?</h2><p>Heriz rugs are made in Iran.</p></main>", jsonLd, complete: true }, fetchedAt: "2026-09-19T00:00:00.000Z", completeness: "complete", contentHash: "body-v1", heldNote: "", version: "current" });
describe("visible copy and its derived FAQ schema", () => {
  it("keeps exact FAQ copy, sources and schema dependency revisions when unrelated work splits away", () => {
    const held = body(), section = component(), title: BundleComponent = { kind: "title", label: "Accurate title", before: held.title, after: "Heriz rugs from East Azerbaijan", evidenceKeys: [fact.key], risk: "safe" };
    const original = proposal({ reviewedCaptures: COPY_RULES.captureProof(held, Date.parse(held.fetchedAt!)), claims: [{ text: ANSWER, supportedBy: [fact.key], of: componentIdOf(section, 1) }], bundle: { ...proposal().bundle!, components: [title, section] } });
    const made = withDerivedFaqSchema(original, held), schema = made.bundle!.components[2]!, parent = serializeChangeProposal(made), rows = proposalIdentity.atomicRows(made), decoded = rows.map(row => deserializeChangeProposal(serializeChangeProposal(row))), linked = decoded[1]!;
    expect([made.id, schema.derivation?.operation, rows.map(row => row.bundle!.components.map(part => part.kind)), decoded.every(Boolean)]).toEqual(["t::/heriz::existing_edit::section::faq-sync-v1", "add", [["title"], ["section", "schema"]], true]);
    expect(JSON.parse(schema.after).mainEntity[0].acceptedAnswer.text).toBe(ANSWER); expect(deserializeChangeProposal(parent)?.bundle?.components[2]?.derivation).toEqual(schema.derivation);
    expect(linked.bundle!.components[1]!.derivation).toEqual({ ...schema.derivation, dependsOn: schema.derivation!.dependsOn.map(d => ({ ...d, componentId: componentIdOf(section, 0) })) });
    expect([linked.claims, linked.supportFacts, linked.reviewedCaptures]).toEqual([[{ ...made.claims![0], of: componentIdOf(section, 0) }], made.supportFacts, made.reviewedCaptures]); expect(linked.reviewedCaptures).toHaveLength(1);
    expect(serializeChangeProposal(made)).toBe(parent); expect(original.bundle!.components).toEqual([title, section]); expect(withDerivedFaqSchema(made, held)).toBe(made);
  });

  it("replaces an existing FAQ block from the finished copy and removes it only with its visible question", () => {
    const old = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Where are Heriz rugs made?", acceptedAnswer: { "@type": "Answer", text: "Heriz rugs are made in Iran." } }] });
    const changed = withDerivedFaqSchema(proposal(), body([old])).bundle!.components[1]!;
    expect([changed.derivation?.operation, JSON.parse(changed.after).mainEntity[0].acceptedAnswer.text]).toEqual(["replace", ANSWER]);
    const removal = component("Remove this question from the visible page."); removal.kind = "section_remove"; removal.units = undefined;
    const removed = withDerivedFaqSchema(proposal({ bundle: { ...proposal().bundle!, components: [removal] } }), body([old]));
    expect([removed.bundle!.components[1]!.derivation?.operation, removed.bundle!.components[1]!.after, deserializeChangeProposal(serializeChangeProposal(removed)) != null]).toEqual(["remove", "", true]);
  });

  it("does nothing for new pages, incomplete captures, ambiguous schema ownership, or body edits that do not change a visible FAQ", () => {
    const fresh = proposal(), newPage = { ...fresh, kind: "new_page" as const, recommendedChange: { kind: "new_page" as const, proposedTitle: "Heriz rugs", metaDescription: "A complete guide to Heriz rugs and their weaving tradition.", openingAnswer: "Heriz rugs come from East Azerbaijan in Iran.", outline: ["History"], faqQuestions: [], schemaTypes: [] } };
    const block = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] });
    expect(withDerivedFaqSchema(newPage, body())).toBe(newPage);
    expect(withDerivedFaqSchema(fresh, { ...body(), completeness: "partial" })).toBe(fresh);
    expect(withDerivedFaqSchema(fresh, body([block, block]))).toBe(fresh);
    const unrelated = component("A new paragraph about rug dyes."); unrelated.units = [{ kind: "paragraph", text: unrelated.after }]; unrelated.target = { mode: "after_section", anchorKind: "heading", anchor: "Natural dyes" };
    expect(withDerivedFaqSchema(proposal({ bundle: { ...fresh.bundle!, components: [unrelated] } }), body()).bundle!.components).toHaveLength(1);
  });
});
