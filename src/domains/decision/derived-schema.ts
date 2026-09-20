import "server-only";
import { createHash } from "node:crypto";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { SCHEMA } from "@/domains/evidence/pages/schema-validator";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { componentIdOf, type BundleComponent, type ChangeProposal } from "./contracts";
import { COPY_RULES } from "./copy-sanitize";

type Pair = { question: string; answer: string };
const normalize = (text: string): string => text.normalize("NFC").replace(/\s+/g, " ").trim();
const stable = (value: unknown): string => JSON.stringify(value, (_key, held) => held && typeof held === "object" && !Array.isArray(held)
  ? Object.fromEntries(Object.keys(held as Record<string, unknown>).sort().map((key) => [key, (held as Record<string, unknown>)[key]])) : held);
const sha = (value: unknown): string => createHash("sha256").update(stable(value)).digest("hex");
const visibleFaqHash = (pairs: readonly Pair[]): string => sha(pairs.map((pair) => [normalize(pair.question), normalize(pair.answer)]));
const componentRevisionOf = (part: BundleComponent): string => sha([part.kind, part.page ?? null, part.before, part.after, part.units ?? null, part.target ?? null, part.where ?? null]);

const same = (a: string, b: string): boolean => normalize(a).toLocaleLowerCase() === normalize(b).toLocaleLowerCase();
const samePairs = (a: readonly Pair[], b: readonly Pair[]): boolean => a.length === b.length && a.every((pair, i) => same(pair.question, b[i]!.question) && same(pair.answer, b[i]!.answer));
const unitText = (part: BundleComponent): string => normalize((part.units ?? []).filter((u) => u.kind !== "heading")
  .flatMap((u) => u.kind === "paragraph" ? [u.text] : "items" in u ? u.items : []).join(" "));

/** The same visible heading-question shape the crawler recognizes, over exact publication units. */
function pairsFromUnits(part: BundleComponent): Pair[] | null {
  const out: Pair[] = []; let question: { text: string; level: number; answer: string[] } | null = null;
  const finish = (): void => { if (!question) return; const answer = normalize(question.answer.join(" ")); if (answer) out.push({ question: question.text, answer }); question = null; };
  for (const unit of part.units ?? []) {
    if (unit.kind === "heading") {
      if (question && unit.level <= question.level) finish();
      if (unit.text.trim().endsWith("?")) { if (question) finish(); question = { text: normalize(unit.text), level: unit.level, answer: [] }; }
      else if (question) question.answer.push(unit.text);
    } else if (question) question.answer.push(unit.kind === "paragraph" ? unit.text : unit.kind === "table" ? unit.rows.flat().join(" ") : unit.items.join(" "));
  }
  finish();
  const asks = (part.units ?? []).some((unit) => unit.kind === "heading" && unit.text.trim().endsWith("?"));
  return asks && out.length === 0 ? null : out;
}

function projectedPairs(base: readonly Pair[], parts: readonly BundleComponent[]): { pairs: Pair[]; dependsOn: number[] } | null {
  let pairs = base.map((pair) => ({ ...pair })); const dependsOn: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.kind === "schema") continue;
    const body = COPY_RULES.bodyKinds.has(part.kind), target = part.target;
    if (!body && part.kind !== "section_remove") continue;
    const fromUnits = pairsFromUnits(part); if (fromUnits == null) return null;
    let next = pairs;
    if (part.kind === "full_rewrite" || target?.mode === "whole_body") next = fromUnits!;
    else if (part.kind === "section_remove") {
      const anchor = target?.anchor ?? part.label, found = pairs.filter((pair) => same(pair.question, anchor)); if (found.length !== 1) return null;
      next = pairs.filter((pair) => pair !== found[0]);
    } else if (target && ["replace", "under_heading"].includes(target.mode) && target.anchorKind === "heading") {
      const at = pairs.findIndex((pair) => same(pair.question, target.anchor));
      if (at >= 0) {
        if (pairs.filter((pair) => same(pair.question, target.anchor)).length !== 1) return null;
        if (fromUnits!.length > 0) next = [...pairs.slice(0, at), ...fromUnits!, ...pairs.slice(at + 1)];
        else { const answer = unitText(part); if (!answer) return null; next = pairs.map((pair, i) => i === at ? { ...pair, answer: target.mode === "under_heading" ? `${answer} ${pair.answer}` : answer } : pair); }
      } else if (fromUnits!.length > 0) next = [...pairs, ...fromUnits!];
    } else if (fromUnits!.length > 0) {
      if (fromUnits!.some((added) => pairs.some((pair) => same(pair.question, added.question)))) return null;
      next = [...pairs, ...fromUnits!];
    }
    if (!samePairs(pairs, next)) { pairs = next; dependsOn.push(index); }
  }
  return { pairs, dependsOn };
}

const faqNode = (pairs: readonly Pair[], id?: string): Record<string, unknown> => ({ "@context": "https://schema.org", "@type": "FAQPage", ...(id ? { "@id": id } : {}),
  mainEntity: pairs.map((pair) => ({ "@type": "Question", name: pair.question, acceptedAnswer: { "@type": "Answer", text: pair.answer } })) });
function directFaq(raw: string): Record<string, unknown> | null { try { const value = JSON.parse(raw) as unknown; if (!value || Array.isArray(value) || typeof value !== "object" || "@graph" in value) return null;
    const node = value as Record<string, unknown>, types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]; return types.includes("FAQPage") ? node : null; } catch { return null; } }

function asBundle(proposal: ChangeProposal): ChangeProposal | null {
  if (proposal.bundle) return proposal;
  const change = proposal.recommendedChange; if (change.kind !== "existing_edit" || !["section", "answer_block"].includes(change.field) || !change.units?.length || !change.target) return null;
  const evidenceKeys = [...new Set((proposal.claims ?? []).flatMap((claim) => claim.supportedBy))], facts = new Map((proposal.supportFacts ?? []).map((fact) => [fact.id, fact]));
  if (!evidenceKeys.length || evidenceKeys.some((key) => !facts.has(key))) return null;
  const component: BundleComponent = { kind: change.target.mode === "opening" ? "opening_answer" : "section", label: change.target.mode === "opening" ? "Opening answer" : "Answer on the page",
    before: change.before, after: change.after, units: change.units, target: change.target, where: change.where ?? COPY_RULES.where(change.target), evidenceKeys, risk: "review" };
  const id = componentIdOf(component, 0), receipt = evidenceKeys.map((key) => { const fact = facts.get(key)!; return { key, fact: fact.fact, observedAt: null, kind: fact.sources?.length ? "independent_source" as const : "page_extract" as const }; });
  return { ...proposal, claims: (proposal.claims ?? []).map((claim) => ({ ...claim, of: id })), preservation: proposal.preservation?.map((row) => row.of ? row : { ...row, of: id }),
    bundle: { objective: proposal.whyItMatters, metric: "The result this change was prepared to improve.", scope: { queries: [proposal.primaryQuery], prompts: [] }, components: [component],
      receipt: { items: receipt, missing: [], freshestObservedAt: null }, alternatives: [], risks: [...proposal.limitations], confidenceReasons: [], measurementPlan: "Read the page after manual implementation, then measure the recorded change at 7, 14 and 28 days." } };
}

/** Attach FAQPage markup only when exact finished visible copy changes exact complete visible FAQ pairs. New pages are deliberately excluded during the edits-only proof. */
function withDerivedFaqSchema(proposal: ChangeProposal, body: OwnedPageBody | null | undefined): ChangeProposal {
  if (proposal.kind === "new_page" || proposal.recommendedChange.kind === "new_page" || !body || proposal.bundle?.components.some((part) => part.kind === "schema")) return proposal;
  if (body.version !== "current" || body.completeness !== "complete" || !body.contentHash || body.sourceCapture?.complete !== true || !proposal.pageUrl || canonicalUrlKey(body.url) !== canonicalUrlKey(proposal.pageUrl)) return proposal;
  const current = body.faqs.filter((pair) => pair.answerComplete === true).map(({ question, answer }) => ({ question: normalize(question), answer: normalize(answer) }));
  const bundled = asBundle(proposal); if (!bundled?.bundle) return proposal;
  const projected = projectedPairs(current, bundled.bundle.components); if (!projected || projected.dependsOn.length === 0) return proposal;
  const blocks = body.sourceCapture.jsonLd.map((raw) => ({ raw, graph: SCHEMA.read(raw) })).filter(({ graph }) => graph.nodes.some((node) => SCHEMA.types(node).includes("FAQPage")));
  if (blocks.length > 1) return proposal;
  const existing = blocks[0], held = existing ? SCHEMA.pairs(existing.graph) : [];
  if (samePairs(held, projected.pairs)) return proposal;
  let operation: "add" | "replace" | "remove", after: string;
  if (!existing) { if (!projected.pairs.length) return proposal; operation = "add"; after = JSON.stringify(faqNode(projected.pairs), null, 2); }
  else if (!projected.pairs.length) { if (!directFaq(existing.raw)) return proposal; operation = "remove"; after = ""; }
  else { const rewritten = SCHEMA.rewriteFaq(existing.raw, projected.pairs), direct = directFaq(existing.raw); if (!rewritten && !direct) return proposal; operation = "replace";
    after = rewritten ?? JSON.stringify({ ...direct!, mainEntity: faqNode(projected.pairs).mainEntity }, null, 2); }
  const dependencies = projected.dependsOn.map((index) => ({ componentId: componentIdOf(bundled.bundle!.components[index]!, index), revision: componentRevisionOf(bundled.bundle!.components[index]!) }));
  const pageKey = canonicalUrlKey(proposal.pageUrl), schemaHash = sha([...body.sourceCapture.jsonLd].sort()), baseFaqHash = visibleFaqHash(current), projectedHash = visibleFaqHash(projected.pairs);
  const evidenceKeys = [...new Set(projected.dependsOn.flatMap((index) => bundled.bundle!.components[index]!.evidenceKeys))]; if (!evidenceKeys.length) return proposal;
  const schema: BundleComponent = { kind: "schema", label: operation === "remove" ? "Remove the outdated FAQ structured data" : "FAQ structured data", before: existing?.raw ?? null, after, evidenceKeys, risk: "safe",
    where: "In this page's own JSON-LD in the page head.", objective: "Keep the page's FAQ structured data identical to its visible questions and answers.", mechanism: "The block is derived from the exact visible FAQ copy in this same change.", measurementPlan: "Read the live visible FAQ pairs and JSON-LD together after publication.",
    derivation: { rule: "visible_faq_pairs_v1", operation, source: { pageKey, contentHash: body.contentHash, schemaHash, visibleFaqHash: baseFaqHash, captureRevision: sha([pageKey, body.contentHash, schemaHash, baseFaqHash]) }, dependsOn: dependencies, projectedVisibleFaqHash: projectedHash } };
  return { ...bundled, id: bundled.id.endsWith("::faq-sync-v1") ? bundled.id : `${bundled.id}::faq-sync-v1`, bundle: { ...bundled.bundle, components: [...bundled.bundle.components, schema] } };
}
export default withDerivedFaqSchema;
