import { describe, it, expect } from "vitest";
import { buildAlternativesPanel } from "./alternatives-panel";
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import type { Objection, Specialist, SpecialistOpinion } from "./specialist-opinions";
import type { MoveRouterDecision } from "./move-router";

const STALE = "2026-06-26T00:00:00.000Z";

function objection(over: Partial<Objection> & Pick<Objection, "kind" | "against" | "severity">): Objection {
  return { detail: "", evidenceRefs: [], ...over };
}

function opinion(over: Partial<SpecialistOpinion> & { specialist: Specialist }): SpecialistOpinion {
  return {
    claim: "",
    evidenceRefs: [],
    confidence: 0.7,
    suggestedMoveTypes: [],
    objections: [],
    scoreContribution: {},
    staleAt: STALE,
    ...over,
  };
}

/** Narrow fixture - only the 3 fields buildAlternativesPanel actually reads. */
type DecisionFixture = Pick<MoveRouterDecision, "action" | "appliedObjections" | "dissenting">;

function decision(over: Partial<DecisionFixture> = {}): DecisionFixture {
  return { action: "add_answer_block", appliedObjections: [], dissenting: [], ...over };
}

describe("buildAlternativesPanel", () => {
  it("renders one rejected alternative per applied VETO, action in plain words, reason in Beacon voice", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "edit_existing_page",
        appliedObjections: [
          objection({
            kind: "already_ranks",
            against: ["create_page"],
            severity: "veto",
            detail: "You already rank in the top 10 - this is an EDIT, not a new page.",
          }),
        ],
      }),
    );

    expect(out).not.toBeNull();
    expect(out!.alternatives).toEqual([
      "A new page instead: rejected. You already rank - improve the page, don't make a new one.",
    ]);
    expect(out!.dissentLine).toBeNull();
  });

  it("never names the raw action key - every alternative is routed through the plain-language map", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "wait",
        appliedObjections: [
          objection({ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto" }),
        ],
      }),
    );
    expect(out!.alternatives[0]).not.toMatch(/create_page/);
    expect(out!.alternatives[0]).toContain("A new page");
  });

  it("a DOWNGRADE is never rendered as a rejected alternative (only a veto actually rules one out)", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "add_answer_block",
        appliedObjections: [
          objection({
            kind: "fix_ux_first",
            against: ["add_answer_block", "edit_existing_page", "change_title_meta"],
            severity: "downgrade",
            detail: "High on-page friction - fixing the experience first protects any traffic a content move would win.",
          }),
        ],
      }),
    );
    expect(out).toBeNull();
  });

  it("caps at 3 alternatives even with more vetoes available", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "wait",
        appliedObjections: [
          objection({ kind: "already_ranks", against: ["create_page"], severity: "veto" }),
          objection({ kind: "wrong_lever_for_intent", against: ["add_answer_block"], severity: "veto" }),
          objection({ kind: "wrong_lever_for_intent", against: ["change_title_meta"], severity: "veto" }),
          objection({ kind: "cant_outrank_serp", against: ["build_tool"], severity: "veto" }),
        ],
      }),
    );
    expect(out!.alternatives.length).toBe(3);
  });

  it("dedupes the same alternative action across multiple vetoes", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "wait",
        appliedObjections: [
          objection({ kind: "already_ranks", against: ["create_page"], severity: "veto" }),
          objection({ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto" }),
        ],
      }),
    );
    expect(out!.alternatives.length).toBe(1);
  });

  it("never lists the winning action itself as a rejected alternative", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "create_page",
        appliedObjections: [
          objection({ kind: "already_ranks", against: ["create_page"], severity: "veto" }),
        ],
      }),
    );
    expect(out).toBeNull();
  });

  it("renders a dissent line naming the teammate and their own plain claim", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "add_answer_block",
        dissenting: [
          opinion({
            specialist: "profound",
            claim: "AI cites 3 competitor pages for this topic, never you.",
            suggestedMoveTypes: ["create_page"],
          }),
        ],
      }),
    );
    expect(out!.dissentLine).toBe("The AI citations disagreed: AI cites 3 competitor pages for this topic, never you.");
    expect(out!.alternatives).toEqual([]);
  });

  it("prefers a dissenting voice with a real objection over one that only suggested a different action", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "add_answer_block",
        dissenting: [
          opinion({ specialist: "profound", claim: "AI cites a rival, never you.", suggestedMoveTypes: ["create_page"] }),
          opinion({
            specialist: "clarity",
            claim: "Visitors hit friction before they read anything.",
            objections: [
              objection({
                kind: "fix_ux_first",
                against: ["add_answer_block"],
                severity: "downgrade",
                detail: "High friction.",
              }),
            ],
          }),
        ],
      }),
    );
    expect(out!.dissentLine).toBe("The Visitor behavior disagreed: Visitors hit friction before they read anything.");
  });

  it("caps the dissent line at ONE voice even with several dissenters", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "add_answer_block",
        dissenting: [
          opinion({ specialist: "profound", claim: "First dissenter." }),
          opinion({ specialist: "gsc", claim: "Second dissenter." }),
        ],
      }),
    );
    expect(out!.dissentLine).toContain("First dissenter.");
    expect(out!.dissentLine).not.toContain("Second dissenter.");
  });

  it("honest absence: no vetoed alternative and no dissenting voice renders no panel at all", () => {
    expect(buildAlternativesPanel(decision())).toBeNull();
  });

  it("never emits a banned em/en dash", () => {
    const out = buildAlternativesPanel(
      decision({
        action: "wait",
        appliedObjections: [
          objection({ kind: "already_ranks", against: ["create_page"], severity: "veto" }),
        ],
        dissenting: [opinion({ specialist: "profound", claim: "AI cites a rival, never you." })],
      }),
    );
    for (const line of out!.alternatives) expect(hasBannedDash(line)).toBe(false);
    expect(hasBannedDash(out!.dissentLine)).toBe(false);
  });

  it("two tenants' decisions never leak into each other's panel (pure function, no shared state)", () => {
    const a = buildAlternativesPanel(
      decision({ action: "wait", appliedObjections: [objection({ kind: "already_ranks", against: ["create_page"], severity: "veto" })] }),
    );
    const b = buildAlternativesPanel(decision({ action: "wait", appliedObjections: [] }));
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});
