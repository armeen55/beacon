import { createHash } from "node:crypto";

import { componentIdOf, deserializeChangeProposal, serializeChangeProposal, type BundleComponentKind, type ChangeProposal } from "./contracts";
import { footprintKey } from "./mutation-footprint";
import { effortMinutesFor, fieldForComponent } from "./producers/contract";
import { copyKey } from "./proof";

type ActionFamily = "title-family" | "section-family" | "links-family" | "technical-family" | "consolidation" | "accuracy-family" | "new_page";
const RETIRED_FAMILY_POLICIES = [{ family: "legacy_faq_schema", reason: "the old standalone FAQ generator was retired; future schema work must keep its own evidence and provenance", matches: (row: ChangeProposal) => row.id.split("::").at(-1)?.split("@")[0] === "faq_schema" }] as const;
const retiredPolicyOf = (row: ChangeProposal): { family: string; reason: string } | null => RETIRED_FAMILY_POLICIES.find((policy) => policy.matches(row)) ?? null; // A removed producer enters by its exact minted family identity, never by customer copy or a broad field shape.
const FAMILY_BY_KIND: Record<BundleComponentKind, ActionFamily> = { title: "title-family", meta: "title-family", h1: "title-family",
  opening_answer: "section-family", section: "section-family", source_pack: "section-family", paragraph_correction: "section-family",
  section_add: "section-family", section_remove: "section-family", section_rewrite: "section-family", restructure: "section-family", full_rewrite: "section-family",
  factual_correction: "accuracy-family", source_update: "accuracy-family", entity_expansion: "section-family", table_or_list_add: "section-family",
  internal_links: "links-family", internal_link_add: "links-family", internal_link_remove: "links-family", anchor_text: "links-family",
  schema: "technical-family", canonical: "technical-family", redirect: "technical-family", noindex: "technical-family", navigation: "technical-family",
  consolidation: "consolidation", new_page: "new_page",};
const FAMILY_PRECEDENCE: readonly ActionFamily[] = ["new_page", "consolidation", "technical-family", "accuracy-family", "section-family", "links-family", "title-family"];
const actionFamilyOf = (p: Pick<ChangeProposal, "kind" | "bundle" | "recommendedChange">): ActionFamily => {
  if (p.kind === "new_page") return "new_page";
  const families = new Set((p.bundle?.components ?? []).map((c) => FAMILY_BY_KIND[c.kind]));
  for (const family of FAMILY_PRECEDENCE) if (families.has(family)) return family;
  const change = p.recommendedChange;
  if (change.kind === "new_page") return "new_page";
  return change.field === "title" || change.field === "meta" || change.field === "h1" ? "title-family" : "section-family";
};
const anchorOf = (p: ChangeProposal): string => { const parts = p.id.split("::");
  return (parts.length >= 3 ? (parts[1] ?? "") : (p.pagePath ?? p.pageUrl ?? p.pageLabel ?? "")).trim().toLowerCase(); };
const siteOf = (p: ChangeProposal): string => { const url = (p.pageUrl ?? "").trim(); if (!url) return "";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return url.toLowerCase(); } };
const identityOf = (p: ChangeProposal) => { const anchor = anchorOf(p); return { site: siteOf(p), case_id: p.kind === "new_page" ? anchor : "",
  page_key: p.kind === "new_page" ? "" : anchor, action_family: actionFamilyOf(p), mutation_key: footprintKey(p) }; };
const evidenceMaterial = (p: ChangeProposal): unknown[] => (p.bundle?.receipt.items ?? []).map((i) => [i.key, i.kind, i.fact, i.observedAt,
  ...(i.observationIds?.length ? [[...i.observationIds].sort()] : []), ...(i.observationId ? [i.observationId] : []),
  ...(i.sources?.length ? [[...i.sources].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))] : [])]);
const evidenceFingerprint = (p: ChangeProposal): string => { const material = p.bundle ? evidenceMaterial(p) : [p.evidence];
  return createHash("sha256").update(JSON.stringify(material.map((m) => JSON.stringify(m)).sort())).digest("hex").slice(0, 16); };
const terminalText = (text: string): string => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const terminalMaterial = (value: unknown): unknown => typeof value === "string" ? terminalText(value) : Array.isArray(value) ? value.map(terminalMaterial)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, terminalMaterial((value as Record<string, unknown>)[key])])) : value;
const terminalProposalFingerprint = (p: ChangeProposal): string => createHash("sha256").update(JSON.stringify([
  footprintKey(p), terminalText(p.primaryQuery), terminalMaterial(p.recommendedChange), terminalMaterial(p.bundle?.components ?? []),
  terminalMaterial(p.claims ?? []), terminalMaterial(p.supportFacts ?? []), evidenceFingerprint(p),
])).digest("hex");
const proposalFingerprint = (p: ChangeProposal): string => {
  const draft = p.newPageDraft ? deserializeChangeProposal(serializeChangeProposal(p))?.newPageDraft ?? p.newPageDraft : null;
  const material = { id: p.id, status: p.status, confidence: p.confidence, basis: p.basis ?? null,
    ...(p.workKey ? { workKey: p.workKey } : {}), change: p.recommendedChange,
    limitations: p.limitations.filter((l) => !/^The exact .* lands on the next pass/.test(l)), cause: p.causeFinding ?? null,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.page ?? null, c.where ?? null, c.before, c.after, c.evidenceKeys, c.risk,
      c.objective ?? null, c.mechanism ?? null, c.anchorAfter ?? null, c.redirectTo ?? null, ...(c.units ? [c.units] : []),
      ...(c.target ? [c.target] : []), ...(c.preserves ? [c.preserves] : []), ...(c.derivation ? [c.derivation] : [])]),
    dispositions: p.bundle?.dispositions ?? null, ...(draft ? { newPageDraft: draft } : {}),
    ...(p.preservationNotes ? { preservationNotes: p.preservationNotes } : {}), ...(p.preservation?.length ? { preservation: p.preservation } : {}),
    ...(p.copyStamp ? { stamp: p.copyStamp } : {}), ...(p.claims?.length ? { claims: p.claims.map((c) => [c.text, [...c.supportedBy].sort()]) } : {}),
    ...(p.winnersOnFile ? { winnersOnFile: p.winnersOnFile } : {}), ...(p.obligation ? { obligation: p.obligation } : {}),
    copy: [p.opportunityType, p.whyItMatters, ...(p.operatorSteps ?? []), p.bundle?.objective ?? "", ...(p.bundle?.confidenceReasons ?? []), ...(p.research ? [p.research.missing, p.research.next] : [])],
    receipt: evidenceMaterial(p), missing: p.bundle?.receipt.missing ?? [],
    ...(p.rankingReceipt ? { ranked: true } : {}), ...(p.impactScore != null ? { impact: p.impactScore } : {}), };
  return createHash("sha256").update(JSON.stringify(material, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, (value as Record<string, unknown>)[key]])) : value)).digest("hex").slice(0, 16);
};

/** Turn independently applicable bundle pieces into independently ranked and completable proposals. The only
 * pieces that stay together are an explicit derivation dependency (visible FAQ copy plus the schema derived
 * from it today); proximity in one diagnosis is not a dependency. The parent diagnosis, query and disposition
 * ledger stay on every row, which is the existing, checkable relationship between one campaign's atomic work. */
const atomicRows = (p: ChangeProposal): ChangeProposal[] => {
  const components = p.bundle?.components ?? [];
  if (p.kind !== "existing_edit" || components.length < 2) return [p];
  const ids = components.map(componentIdOf), edges = components.map(() => new Set<number>());
  components.forEach((c, i) => c.derivation?.dependsOn.forEach((d) => { const j = ids.indexOf(d.componentId); if (j >= 0) { edges[i]!.add(j); edges[j]!.add(i); } }));
  const groups: number[][] = [], seen = new Set<number>();
  for (let i = 0; i < components.length; i += 1) { if (seen.has(i)) continue; const group: number[] = [], todo = [i]; seen.add(i);
    while (todo.length) { const at = todo.pop()!; group.push(at); for (const next of edges[at]!) if (!seen.has(next)) { seen.add(next); todo.push(next); } }
    groups.push(group.sort((a, b) => a - b)); }
  if (groups.length < 2) return [p];
  const baseUrl = p.pageUrl && /^https?:\/\//i.test(p.pageUrl) ? p.pageUrl : null;
  const pageOf = (raw?: string): { path: string | null; url: string | null } => { const value = (raw ?? p.pagePath ?? p.pageUrl ?? "").trim(); if (!value) return { path: p.pagePath, url: p.pageUrl };
    if (/^https?:\/\//i.test(value)) { try { const u = new URL(value); return { path: u.pathname.replace(/\/+$/, "") || "/", url: u.toString() }; } catch { return { path: value, url: value }; } }
    const path = value.startsWith("/") ? value : `/${value.replace(/^\/+/, "")}`; if (!baseUrl) return { path, url: p.pageUrl };
    try { return { path: path.replace(/\/+$/, "") || "/", url: new URL(path, baseUrl).toString() }; } catch { return { path, url: p.pageUrl }; } };
  return groups.map((indices) => {
    const parts = indices.map((i) => components[i]!), oldIds = new Set(indices.map((i) => ids[i]!)), page = pageOf(parts[0]!.page), bundle = { ...p.bundle!, objective: parts[0]!.objective ?? p.bundle!.objective,
      components: parts, plan: p.bundle!.plan ? { ...p.bundle!.plan, entries: p.bundle!.plan.entries.filter((_, i) => indices.includes(i)) } : undefined,
      receipt: { ...p.bundle!.receipt, items: p.bundle!.receipt.items.filter((item) => parts.some((c) => c.evidenceKeys.includes(item.key))) } };
    const recommendedChange = { kind: "existing_edit" as const, field: fieldForComponent(parts[0]!.kind), before: parts[0]!.before, after: parts[0]!.after,
      ...(parts[0]!.units ? { units: parts[0]!.units } : {}), ...(parts[0]!.target ? { target: parts[0]!.target } : {}), ...(parts[0]!.where ? { where: parts[0]!.where } : {}),
      ...(parts[0]!.redirectTo ? { linkTo: parts[0]!.redirectTo } : {}), ...(parts[0]!.anchorAfter ? { anchorText: parts[0]!.anchorAfter } : {}) };
    const family = actionFamilyOf({ kind: "existing_edit", bundle, recommendedChange }), localId = (of: string): string => { const at = indices.indexOf(ids.indexOf(of)); return at < 0 ? of : componentIdOf(parts[at]!, at); }, claims0 = (p.claims ?? []).map((claim, i) => ({ claim, i })).filter(({ claim }) => !claim.of || oldIds.has(claim.of));
    const claims = claims0.map(({ claim }) => ({ ...claim, ...(claim.of ? { of: localId(claim.of) } : {}) }));
    const used = new Set(claims.flatMap((claim) => claim.supportedBy)), supportFacts = (p.supportFacts ?? []).filter((fact) => used.has(fact.id)), reviewClaims = p.semanticReview?.claims.flatMap((r) => { const i = claims0.findIndex((x) => x.i === r.i); return i < 0 ? [] : [{ ...r, i }]; }) ?? [];
    const discriminator = parts.map((c) => `${c.kind}-${terminalText(c.where ?? c.label).replace(/ /g, "-").slice(0, 36)}`).join("+");
    const row0: ChangeProposal = { ...p, id: `${p.tenantId}::${page.path ?? p.pagePath ?? ""}::existing_edit::${family}@${discriminator}`, pagePath: page.path, pageUrl: page.url,
      pageLabel: parts[0]!.page ?? p.pageLabel, changeFamily: family, bundle, recommendedChange, evidence: { ...p.evidence, evidenceRefCount: bundle.receipt.items.length }, estimatedEffortMinutes: parts.reduce((n, c) => n + effortMinutesFor(c.kind), 0),
      riskLevel: parts.some((c) => c.risk === "dangerous") ? "high" : parts.some((c) => c.risk === "review") ? "medium" : "low",
      operatorSteps: [`Apply ${parts.map((c) => c.label).join(" and ")} on ${page.path ?? p.pageLabel}.`, "Return to Beacon and mark only this change implemented."],
      ...(claims.length ? { claims, supportFacts } : { claims: undefined, supportFacts: undefined }), semanticReview: undefined, informationGain: groups.length === 1 ? p.informationGain : undefined,
      preservation: p.preservation?.filter((x) => !x.of || oldIds.has(x.of)).map((x) => ({ ...x, ...(x.of ? { of: localId(x.of) } : {}) })) };
    return reviewClaims.length && p.semanticReview ? { ...row0, semanticReview: { ...p.semanticReview, of: copyKey(row0), claims: reviewClaims, parts: undefined } } : row0;
  });
};

const proposalIdentity = { actionFamilyOf, identityOf, atomicRows, retiredPolicyOf,
  NO_FIELD_KIND: new Set<string>(["anchor_text", "internal_link_add", "internal_link_remove", "table_or_list_add", "schema", "canonical", "redirect", "noindex", "navigation"]),
  terminalProposalFingerprint, proposalFingerprint };
export default proposalIdentity;
