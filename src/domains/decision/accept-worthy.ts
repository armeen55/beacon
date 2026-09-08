import { z } from "zod";
import type { ChangeProposal } from "./contracts";

// Build-time rollback: NEXT_PUBLIC_BEACON_AEO_PACKET=0 restores the prior editorial bar.
// Public so the browser and server use the same value; this is policy, never a secret.
const enabled = () => process.env.NEXT_PUBLIC_BEACON_AEO_PACKET !== "0";
const applies = (field: string, standard?: string, unpublished = false, shape?: string, query = "") => enabled() && !unpublished && /^(answer_block|section)$/.test(field)
  && (["section", "direct_answer", "restructure"].includes(shape ?? "") || /\b(?:animals|wildlife|species|people|figures)\b/i.test(query))
  && !["correction", "internal_link", "repositioning"].includes(standard ?? "");
const criteria = ["leadAnswer", "groupedH2s", "defendedClaims", "entityBlock", "boundedScope", "h1QueryAlignment"] as const;
const schema = z.object({ leadAnswer: z.boolean(), groupedH2s: z.boolean(), defendedClaims: z.boolean(), entityBlock: z.boolean(), boundedScope: z.boolean(), h1QueryAlignment: z.boolean() });
const passed = (r: unknown): boolean => { const parsed = schema.safeParse(r); return parsed.success && criteria.every((k) => parsed.data[k] === true); };
const policy = "ANSWER-READY AEO PACKET (all six MUST pass): (1) Start finalCopy with a self-contained, liftable opening answer paragraph, explaining a useful distinction, never an introduction to a names dump. (2) Follow with Markdown ## H2s grouped by meaningful, evidence-supported criteria; explain what qualifies in each group, never one heading per species/person or an unclassified list. (3) Attribute only the exact claim a cited passage defends, never the whole packet. Mere presence or a heading does not establish native, endemic, current or official status. Omit unsupported optional claims; if core accuracy or membership is unclear, refuse. Disclaimers cannot repair unsupported copy. (4) Include an extractable entity block: a compact Markdown table or labeled bullet records pairing each named entity with its supported distinguishing attribute and group. (5) State a useful bounded selection and its geographic/time limits where relevant; do not promise exhaustive coverage. (6) The answer and grouped headings must answer the query intent AND fit the existing page H1; if H1 or intent is missing or mismatched, fail closed, never silently retitle the page. SHOULD: add useful FAQ question-answer pairs and relevant internal links to known owned destinations when evidence supports them; omission alone is not a failure. Schema and meta are deferred. This packet replaces the short-body format: no one-to-three-sentence cap, set naturalHeading=null, no outer heading before the lead. Preserve existing material outside the exact placement. HARD LIMITS: finalCopy must fit 2000 characters and 400 whitespace-delimited words, with at most 10 claims, each at most 400 characters. Choose a small supported selection that fits; record each entity assertion separately, plus the lead, grouping and scope claims. Never use one claim to vouch for the whole copy. If the six requirements cannot fit, refuse rather than omit them.";
const failures = (field: string, copy: string, limitations: readonly string[] = [], standard?: string, unpublished = false, shape?: string, query = ""): string[] => {
  if (!applies(field, standard, unpublished, shape, query)) return [];
  const out: string[] = [], lines = copy.trim().split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const first = lines.find((s) => !/^#{1,6}\s/.test(s)) ?? "";
  const plain = first.replace(/\*\*/g, "");
  // Collection answers cannot opt out through missing or short-form assignment metadata. Semantics still require a separate review.
  if (/^#{1,6}\s/.test(lines[0] ?? "") || /^(?:[-*•]|\d+[.)])\s/.test(first) || !/[.!?](?:["”’])?$/.test(plain)
    || (plain.split(/[,;•]/).length >= 5 && !/[.!?]\s+/.test(plain)))
    out.push("The opening needs a complete answer paragraph that explains more than the names.");
  if (!lines.some((s) => /^##\s+\S/.test(s)) || lines.filter((s) => /^##\s+\S/.test(s)).length < 2)
    out.push("Group the answer under headings that explain how the examples were selected.");
  const groups = copy.split(/^##\s+(.+)$/m).slice(1), entities = [...copy.matchAll(/^(?:[-*•]\s+([^:\n]+):|\|\s*([^|]+)\|)/gm)]
    .map((m) => (m[1] ?? m[2] ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim());
  for (let i = 0; i < groups.length; i += 2) {
    const heading = groups[i]!.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim(), prose = (groups[i + 1] ?? "").split("\n").filter((l) => !/^\s*(?:[-*•|#]|\d+[.)])/.test(l)).join(" ").trim();
    if (entities.some((entity) => entity && ` ${heading} `.includes(` ${entity} `)) || !/[.!?]/.test(prose) || !/\b(?:recorded|observed|born|used|said|qualif\w*|select\w*|includ\w*|inhabit\w*|found|live|grow|work|breed|nest|feed|adapt\w*|defined|criteria|members|whose)\b/i.test(prose)) {
      out.push("Each heading needs a selection criterion and explanatory prose, not one heading per entity or a list of names."); break;
    }
  }
  if (!/^(?:\|.+\|)|^(?:[-*•]\s+[^:\n]+:\s*\S)/m.test(copy))
    out.push("Add a table or labeled list pairing each example with its supported distinguishing detail.");
  const uncertainty = [copy, ...limitations].join(" ");
  if (/(?:owed|missing|needs?|still|requires?).{0,60}(?:grouped|inclusion criteria|headings|accuracy)|(?:grouped|inclusion criteria|headings).{0,60}(?:owed|missing|required)|check every word|may be incomplete|overreads? (?:native|endemic) status|accuracy (?:is |remains )?(?:unclear|uncertain)|verify (?:every|all) (?:claim|entry|word)|cannot confirm/i.test(uncertainty)
    || (copy.match(/\b(?:may|might|possibly|perhaps|unclear|uncertain)\b/gi) ?? []).length >= 3)
    out.push("The accuracy questions need to be resolved before this copy is ready.");
  return out;
};
const bodyParts = (p: ChangeProposal) => {
  if (p.kind !== "existing_edit") return [];
  const c = p.recommendedChange, standard = p.changeFamily === "factual_correction" ? "correction" : p.assignment?.standard,
    shape = p.assignment?.treatment === "restructure" ? "restructure" : p.assignment?.shape;
  return [...(c.kind === "existing_edit" && !c.linkTo && applies(c.field, standard, false, shape, p.primaryQuery) ? [c.after] : []),
    ...(p.bundle?.components ?? []).filter((x) => /^(opening_answer|section|section_add|section_rewrite|restructure)$/.test(x.kind) && applies("section", standard, false, shape, p.primaryQuery)).map((x) => x.after)];
};
export const AEO_BAR = { applies, policy, failures, schema, passed,
  rowFailures: (p: ChangeProposal): string[] => bodyParts(p).flatMap((copy) => failures("section", copy, [...p.limitations, ...(p.faults ?? [])], undefined, false, "section")),
  approved: Object.fromEntries(criteria.map((k) => [k, true])) as z.infer<typeof schema>,
  forRow: (p: ChangeProposal): boolean => bodyParts(p).length > 0,
  sameRejectedCopy: (a: ChangeProposal, b: ChangeProposal): boolean => {
    if (a.researchOnly === true || b.researchOnly === true) return false;
    const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const identity = (p: ChangeProposal) => { const c = p.recommendedChange;
      return JSON.stringify([c.kind, c.kind === "existing_edit" ? [c.field.replace(/^(section|answer_block)$/, "body"), key(c.after), c.linkTo ?? ""] : [key(c.openingAnswer), p.newPageDraft],
        (p.bundle?.components ?? []).map((x) => [x.kind, x.page ?? "", key(x.after ?? "")])]); };
    return identity(a) === identity(b);

  },
};
