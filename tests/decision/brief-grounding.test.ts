/** A BRIEF MAY NOT GROUND A CLAIM, AT EVERY DOOR THAT MINTS ONE (campaign review, 2026-09-05).
 *
 *  The campaign closed this at the writer's door (decision/drafted-copy, `groundingOf`), at the promotion door
 *  (decision/proposal-store) and at the release sweep (decision/produce-proposals). A FOURTH call site minted `ready`
 *  rows and still handed the producer's own diagnosis lines to the canon as grounding: `proposeExistingPageChange`
 *  (decision/propose), which the walk calls and whose answer it persists. The hints it grounded on are built by
 *  `hintsFor` (decision/opportunities), which prints a bare count ("AI answers cite this page N times") beside the
 *  diagnosis sentence, so exactly the class of figure the other three doors refuse was grounding there. The hints are
 *  out of that array now: what grounds a claim is the page's own outline and the line being replaced.
 *
 *  ARM 1 is the release sweep and carries its own falsifier. ARM 2 is the fourth door.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "t", domain: "alpha.example", growth_goal: null }), basisTag: () => "basis_test" }));
import { validateProposal } from "@/domains/decision/validate-proposal";
import { canonTextOf } from "@/domains/decision/drafted-copy";
import { proposeExistingPageChange } from "@/domains/decision/propose";
import type { ChangeProposal, EvidenceInput } from "@/domains/decision/contracts";

const NOW = new Date("2026-09-05T00:00:00.000Z");
/** TWO SYNTHETIC ACCOUNTS with unrelated subjects. The figure 3157 exists nowhere but in the brief. */
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/tide-pools", path: "/tide-pools", label: "Tide Pools", q: "tide pool safety",
    title: "Tide Pools", heads: ["When to visit", "Tide pool safety"],
    passage: "The rocks stay slick for hours after the tide turns, which is when nearly every fall happens.",
    body: "Tide pools open up at low tide. The rocks stay slick for hours after the tide turns.",
    hint: "This page is shown 3157 times in 90 days for tide pool safety.",
    after: "Tide pool safety, asked 3157 times a year" },
  { t: "tenant-two", url: "https://beta.example/bordado", path: "/bordado", label: "Bordado", q: "puntadas de bordado",
    title: "Bordado a mano", heads: ["Materiales", "Puntadas de bordado"],
    passage: "El hilo de algodon se separa en seis hebras de grosor parejo antes de empezar.",
    body: "El bordado a mano se trabaja sobre tela tensada. El hilo de algodon se separa en seis hebras.",
    hint: "Esta pagina aparece 3157 veces en 90 dias para puntadas de bordado.",
    after: "Puntadas de Bordado: las 3157 consultas mas frecuentes" },
];
type Site = (typeof SITES)[number];

// ── ARM 1: the release sweep, reproduced exactly as produce-proposals.ts:409 composes it ──
const swept = (s: Site): ChangeProposal => ({
  id: `${s.t}::sweep`, tenantId: s.t, kind: "existing_edit", pagePath: s.path, pageUrl: s.url, pageLabel: s.label,
  primaryQuery: s.q, opportunityType: "Capture clicks", changeFamily: "title", status: "ready", researchOnly: false,
  recommendedChange: { kind: "existing_edit", field: "title", before: s.title, after: s.after },
  whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query: s.q, hints: [s.hint], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null,
  publish: "manual", createdAt: NOW.toISOString(),
} as ChangeProposal);
const pageOf = (s: Site) => ({ content: { title: s.title, h1: s.title, outline: s.heads } });
const bodyOf = (s: Site) => ({ headings: s.heads, passages: [s.passage], vocabulary: "" });

// ── ARM 2: the third door ──
const DIAGNOSIS: EvidenceInput["evidence"]["diagnosis"] = { status: "diagnosed", cause: "snippet_intent_mismatch", action: "title",
  evidenceKeys: ["demand-exact", "copy-current", "serp1"], explanation: "The results page was read for this search.",
  alternativesRuledOut: [{ alternative: "thin_content", reason: "the page carries a full section on this", evidenceKeys: ["copy-current"] }] };
const inputOf = (s: Site): EvidenceInput => ({
  tenantId: s.t, page: { path: s.path, url: s.url, label: s.label }, sizing: { impactScore: 60, upsidePerMonth: 20 },
  opportunity: { query: s.q, kind: "existing_edit", field: "title", opportunityType: "Capture clicks", currentValue: s.title, intent: "what" },
  evidence: { hints: [s.hint], pageBodyText: s.body, outline: s.heads, diagnosis: DIAGNOSIS },
});
const draftOf = (s: Site) => ({ value: { field: "title", before: s.title, after: s.after, confidence: "high",
  rationale: "The current title does not say what this page answers.", risks: [],
  evidenceRefs: [{ source: "gsc", detail: "demand for this search" }], operatorSteps: ["Replace the page title field with the new value"],
  proofPlan: { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" } } });

describe("a figure that stands only in the brief grounds nothing, at every door that mints copy", () => {
  it.each(SITES)("$t: the release sweep refuses it, and would take it if its own hints were grounding again", (s) => {
    const refused = validateProposal(swept(s), { ...canonTextOf(pageOf(s), bodyOf(s), []), now: NOW });
    expect(refused.verdict).toBe("rejected");
    expect(refused.factViolations.join(" ")).toContain("3157");
    // THE FALSIFIER: put the row's own hints back into the grounding array and the same copy is taken.
    const taken = validateProposal(swept(s), { ...canonTextOf(pageOf(s), bodyOf(s), [s.hint]), now: NOW });
    expect(taken.factViolations.join(" ")).not.toContain("3157");
  });

  it.each(SITES)("$t: a title drafted through the walk's field door is not minted ready on a figure only its brief carries", async (s) => {
    const out = await proposeExistingPageChange(inputOf(s), { complete: async () => draftOf(s), now: NOW });
    expect(out.status).not.toBe("no_draft");
    if (out.status === "no_draft") return;
    expect(`${out.status}: ${out.validation.factViolations.join(" ")}`).toContain("3157");
    expect(out.proposal.status).not.toBe("ready");
  });
});
