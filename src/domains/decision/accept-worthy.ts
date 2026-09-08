import { z } from "zod";
import type { ChangeProposal } from "./contracts";
const enabled = () => process.env.NEXT_PUBLIC_BEACON_AEO_PACKET !== "0";
const groupingTopic = "grouping criteria and selection boundary";
const hasGrouping = (subjects: readonly string[], facts: readonly string[] = []) => subjects.some((s) => s.toLowerCase().endsWith(groupingTopic)) || facts.some((s) => /\band\b/i.test(s) && (s.match(/\b(?:such as|identified by|characterized by|defined by)\b/gi) ?? []).length >= 2);
// The target leaf owns collection identity; ancestor slugs and inherited titles never classify a species.
const signal = (row: { pageUrl?: string | null; pagePath?: string | null; targetUrl?: string; primaryQuery?: string; trackedQuestion?: string | null }): string => { const path = (row.pageUrl ?? row.pagePath ?? row.targetUrl ?? "").split(/[?#]/)[0]!.replace(/\/+$/, ""); return path ? path.slice(path.lastIndexOf("/") + 1) : row.primaryQuery ?? row.trackedQuestion ?? ""; };
const applies = (field: string, standard?: string, unpublished = false, shape?: string, row: Parameters<typeof signal>[0] = {}) => enabled() && !unpublished && /^(answer_block|section)$/.test(field)
  && (AEO_BAR.collection(signal(row)) || ["section", "direct_answer", "restructure"].includes(shape ?? ""))
  && !["correction", "internal_link", "repositioning"].includes(standard ?? "");
const holds = {"lead": "The opening needs a complete answer paragraph that explains more than the names.", "groups": "Group the answer under one to three headings that explain how the examples were selected.", "criteria": "Each heading needs a selection criterion and explanatory prose, not one heading per entity or a list of names.", "entities": "A table or labeled list can make entity distinctions easier to scan, but it is optional when supported prose or bullets already carry those distinctions.", "accuracy": "The accuracy questions need to be resolved before this copy is ready.", "unreviewed": "These exact words still need a review of their structure, accuracy and relevance.", "sixChecks": "The answer still needs to pass the required readiness checks for lead quality, grouped sections, factual support and query fit."};
const writerLimitations = (limitations: readonly string[]) => limitations.filter((l) => !Object.values(holds).includes(l.trim()));
const criteria = ["leadAnswer", "groupedH2s", "defendedClaims", "entityBlock", "boundedScope", "h1QueryAlignment"] as const;
const required = ["leadAnswer", "groupedH2s", "defendedClaims", "h1QueryAlignment"] as const;
const schema = z.object({ leadAnswer: z.boolean(), groupedH2s: z.boolean(), defendedClaims: z.boolean(), entityBlock: z.boolean(), boundedScope: z.boolean(), h1QueryAlignment: z.boolean() });
const passed = (r: unknown): boolean => { const parsed = schema.safeParse(r); return parsed.success && required.every((k) => parsed.data[k] === true); };
const policy = "WRITE THE PACKET IN THIS ORDER: choose supported entities and their distinguishing facts; write a liftable lead paragraph; add one to three Markdown ## grouped sections with qualifying prose; finish with concise supporting details. These are publishable words, never instructions or an outline. ANSWER-READY AEO PACKET (required checks): (1) Start finalCopy with a self-contained opening answer paragraph that explains a useful distinction, never an introduction to a names dump. (2) Follow with one to three Markdown ## H2 groups supported by evidence, with prose that explains what qualifies in each group. (3) Attribute only the exact claim a cited passage defends, never the whole packet. Mere presence or a heading does not establish native, endemic, current or official status. Omit unsupported optional claims; if core accuracy or membership is unclear, refuse. (4) Keep the answer aligned with query intent and the page H1; if either is missing or mismatched, fail closed. Guidance, not ready blockers when required checks pass: table-style entity blocks, broader scope narration and strict format caps. SHOULD: add useful FAQ question-answer pairs and relevant internal links to known owned destinations when evidence supports them; omission alone is not a failure. Meta is a separate companion when the page needs body and description together. Preserve existing material outside the exact placement.";
const failures = (field: string, copy: string, limitations: readonly string[] = [], standard?: string, unpublished = false, shape?: string, row: Parameters<typeof signal>[0] = {}): string[] => {
  if (!applies(field, standard, unpublished, shape, row)) return [];
  const out: string[] = [], lines = copy.trim().split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const first = lines.find((s) => !/^#{1,6}\s/.test(s)) ?? "";
  const plain = first.replace(/\*\*/g, "");
  if (/^#{1,6}\s/.test(lines[0] ?? "") || /^(?:[-*•]|\d+[.)])\s/.test(first) || !/[.!?](?:["”’])?$/.test(plain)
    || (plain.split(/[,;•]/).length >= 5 && !/[.!?]\s+/.test(plain)))
    out.push(holds.lead);
  const grouped = lines.filter((s) => /^##\s+\S/.test(s));
  if (grouped.length < 1 || grouped.length > 3)
    out.push(holds.groups);
  const groups = copy.split(/^##\s+(.+)$/m).slice(1), tableRows = [...copy.matchAll(/^\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*\r?\n((?:\|[^\n]+\|[ \t]*(?:\r?\n|$))+)/gm)].map((m) => m[1]).join("\n");
  const entities = [...copy.matchAll(/^[-*•]\s+([^:\n]+):/gm), ...tableRows.matchAll(/^\|\s*([^|]+)\|/gm)].map((m) => (m[1] ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim());
  for (let i = 0; i < groups.length; i += 2) {
    const heading = groups[i]!.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim(), prose = (groups[i + 1] ?? "").split("\n").filter((l) => !/^\s*(?:[-*•|#]|\d+[.)])/.test(l)).join(" ").trim();
    if (entities.some((entity) => entity && ` ${heading} `.includes(` ${entity} `)) || !/[.!?]/.test(prose)) {
      out.push(holds.criteria); break;
    }
  }
  const uncertainty = [copy, ...writerLimitations(limitations)].join(" ");
  if (/(?:owed|missing|needs?|still|requires?).{0,60}(?:grouped|inclusion criteria|headings|accuracy)|(?:grouped|inclusion criteria|headings).{0,60}(?:owed|missing|required)|check every word|may be incomplete|overreads? (?:native|endemic) status|accuracy (?:is |remains )?(?:unclear|uncertain)|verify (?:every|all) (?:claim|entry|word)|cannot confirm/i.test(uncertainty)
    || (copy.match(/\b(?:may|might|possibly|perhaps|unclear|uncertain)\b/gi) ?? []).length >= 3)
    out.push(holds.accuracy);
  return out;
};
const bodyParts = (p: ChangeProposal) => {
  if (p.kind !== "existing_edit") return [];
  const c = p.recommendedChange, standard = p.changeFamily === "factual_correction" ? "correction" : p.assignment?.standard,
    shape = p.assignment?.treatment === "restructure" ? "restructure" : p.assignment?.shape;
  return [...(c.kind === "existing_edit" && !c.linkTo && applies(c.field, standard, false, shape, p) ? [c.after] : []),
    ...(p.bundle?.components ?? []).filter((x) => /^(opening_answer|section|section_add|section_rewrite|restructure)$/.test(x.kind) && applies("section", standard, false, shape, p)).map((x) => x.after)];
};
const emptyMeta = (copy: string, heading: string): string[] => {
  const tokens = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const known = new Set(tokens(`${heading} a an the is are about and of for with description details information`));
  return !copy.trim() || /\b(?:no (?:added |useful |additional )?description|description (?:not available|unavailable|missing)|nothing to describe)\b/i.test(copy)
    || (known.size > 0 && tokens(copy).every((w) => known.has(w))) ? ["The description is empty or repeats the heading without describing the subject."] : [];
};
export const AEO_BAR = { enabled, collection: (query: string) => !/\bhow many\b/i.test(query) && /\b(?:animals|wildlife|people|figures|species)\b/i.test(query.replace(/[-_/]/g, " ")), groupingTopic, hasGrouping, emptyMeta, applies, policy, failures, schema, passed, holds, writerLimitations,
  rowFailures: (p: ChangeProposal): string[] => bodyParts(p).flatMap((copy) => failures("section", copy, p.limitations, undefined, false, "section")),
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
