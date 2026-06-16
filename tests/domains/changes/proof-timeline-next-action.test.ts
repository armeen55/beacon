/**
 * /changes/[id] proof-brief — Act 5 next-action resolver truth table.
 *
 * Pins which CTAs Act 5 surfaces for every (pillKind × sourceRecId ×
 * replicateRecCount) combination, including:
 *   • Exactly one primary CTA per call.
 *   • "Back to changes" always present as the last secondary.
 *   • Legacy-detail escape appended only when the caller asks.
 *   • Helping rows promote Replicate when replicate candidates exist.
 *   • Hurting / Needs review rows promote Investigate.
 *   • Calm states (too_early / watching / no_signal_yet / live) fall
 *     back to "Back to changes" as primary when no rec exists.
 */
import { describe, expect, it } from "vitest";

import {
  resolveNextActions,
  type NextActionCta,
} from "@/domains/changes/proof-timeline/next-action";
import type { ProofPillKind } from "@/domains/changes/proof-timeline/result-pill";

function kinds(ctas: ReadonlyArray<NextActionCta>): string[] {
  return ctas.map((c) => c.kind);
}

function primary(ctas: ReadonlyArray<NextActionCta>): string | null {
  const ps = ctas.filter((c) => c.emphasis === "primary");
  return ps[0]?.kind ?? null;
}

describe("resolveNextActions", () => {
  it("always returns at least one CTA and ends with back_to_changes", () => {
    const cases: ProofPillKind[] = [
      "helping",
      "hurting",
      "too_early",
      "no_signal_yet",
      "needs_review",
      "live",
      "watching",
    ];
    for (const pillKind of cases) {
      const ctas = resolveNextActions({
        pillKind,
        sourceRecId: null,
        replicateRecCount: 0,
      });
      expect(ctas.length, `kind=${pillKind}`).toBeGreaterThan(0);
      expect(ctas[ctas.length - 1].kind).toBe("back_to_changes");
    }
  });

  it("never returns more than one primary CTA", () => {
    const cases: Array<{
      pillKind: ProofPillKind;
      sourceRecId: string | null;
      replicateRecCount: number;
    }> = [
      { pillKind: "helping", sourceRecId: "rec-1", replicateRecCount: 3 },
      { pillKind: "hurting", sourceRecId: "rec-1", replicateRecCount: 0 },
      { pillKind: "needs_review", sourceRecId: null, replicateRecCount: 0 },
      { pillKind: "too_early", sourceRecId: "rec-1", replicateRecCount: 0 },
      { pillKind: "watching", sourceRecId: null, replicateRecCount: 0 },
    ];
    for (const c of cases) {
      const ctas = resolveNextActions(c);
      const primaries = ctas.filter((x) => x.emphasis === "primary");
      expect(primaries.length).toBe(1);
    }
  });

  it("helping + replicate candidates → Replicate is primary, Open recommendation secondary", () => {
    const ctas = resolveNextActions({
      pillKind: "helping",
      sourceRecId: "rec-1",
      replicateRecCount: 3,
    });
    expect(primary(ctas)).toBe("replicate_pattern");
    expect(kinds(ctas)).toContain("open_recommendation");
  });

  it("helping (no replicate) + rec linkage → Open recommendation is primary", () => {
    const ctas = resolveNextActions({
      pillKind: "helping",
      sourceRecId: "rec-1",
      replicateRecCount: 0,
    });
    expect(primary(ctas)).toBe("open_recommendation");
  });

  it("hurting → Investigate is primary (label says revert)", () => {
    const ctas = resolveNextActions({
      pillKind: "hurting",
      sourceRecId: "rec-1",
      replicateRecCount: 0,
    });
    const investigate = ctas.find((c) => c.kind === "investigate");
    expect(investigate).toBeDefined();
    expect(investigate?.emphasis).toBe("primary");
    expect(investigate?.label.toLowerCase()).toContain("revert");
  });

  it("needs_review → Investigate is primary (label says review live page)", () => {
    const ctas = resolveNextActions({
      pillKind: "needs_review",
      sourceRecId: null,
      replicateRecCount: 0,
    });
    const investigate = ctas.find((c) => c.kind === "investigate");
    expect(investigate).toBeDefined();
    expect(investigate?.emphasis).toBe("primary");
    expect(investigate?.label.toLowerCase()).toContain("live page");
  });

  it("calm states (too_early/watching/no_signal_yet/live) with no rec fall to back_to_changes primary", () => {
    for (const pillKind of [
      "too_early",
      "watching",
      "no_signal_yet",
      "live",
    ] as const) {
      const ctas = resolveNextActions({
        pillKind,
        sourceRecId: null,
        replicateRecCount: 0,
      });
      expect(primary(ctas), `kind=${pillKind}`).toBe("back_to_changes");
    }
  });

  it("calm states with a rec linkage surface Open recommendation as primary", () => {
    for (const pillKind of [
      "too_early",
      "watching",
      "no_signal_yet",
      "live",
    ] as const) {
      const ctas = resolveNextActions({
        pillKind,
        sourceRecId: "rec-1",
        replicateRecCount: 0,
      });
      expect(primary(ctas), `kind=${pillKind}`).toBe("open_recommendation");
    }
  });

  it("Open recommendation routes to the queue (never deep-links by source_rec_id)", () => {
    // QA polish (2026-05-11): the per-rec deep link
    // `/recommendations/<source_rec_id>` was structurally wrong
    // (route id is the composite action-row id, not the raw
    // `source_rec_id`) AND could 404 mid-flow when the rec had
    // rotated out of the live queue. The fix routes ALL "Open
    // recommendation" CTAs from change briefs to the queue page,
    // labeled "See related recommendations".
    const ctas = resolveNextActions({
      pillKind: "helping",
      sourceRecId:
        "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:abc",
      replicateRecCount: 0,
    });
    const openRec = ctas.find((c) => c.kind === "open_recommendation");
    expect(openRec).toBeDefined();
    // Routes to the queue page, never to /recommendations/<id>.
    expect(openRec?.href).toBe("/recommendations?v2=1");
    // The adversarial id is NOT smuggled into the href.
    expect(openRec?.href).not.toContain("create_cluster_page");
    expect(openRec?.href).not.toContain("Los%20Altos");
    expect(openRec?.href).not.toContain("%3A");
    // The label promises a browse, not a per-rec brief.
    expect(openRec?.label).toBe("See related recommendations");
  });

  it("never returns an 'Open recommendation' CTA labeled as 'Open recommendation' (label was renamed)", () => {
    // Regression guard: prior shape labeled the CTA "Open
    // recommendation" + deep-linked to a per-rec brief that could
    // 404. After QA polish, the label and the href are both
    // queue-shaped.
    for (const pillKind of [
      "helping",
      "hurting",
      "needs_review",
      "too_early",
      "watching",
      "no_signal_yet",
      "live",
    ] as ProofPillKind[]) {
      const ctas = resolveNextActions({
        pillKind,
        sourceRecId: "rec-1",
        replicateRecCount: 0,
      });
      for (const cta of ctas) {
        if (cta.kind === "open_recommendation") {
          expect(cta.label).not.toBe("Open recommendation");
          expect(cta.href).not.toMatch(/^\/recommendations\/[^?]+/);
        }
      }
    }
  });

  it("never returns a label that leaks internal vocabulary", () => {
    const banned = [
      "z-score",
      "evidence tier",
      "decision queue",
      "decision matrix",
      "pattern brain",
      "lifecycle",
      "resolver tier",
    ];
    for (const pillKind of [
      "helping",
      "hurting",
      "too_early",
      "no_signal_yet",
      "needs_review",
      "live",
      "watching",
    ] as ProofPillKind[]) {
      for (const sourceRecId of [null, "rec-1"]) {
        for (const replicateRecCount of [0, 1, 3]) {
          const ctas = resolveNextActions({
            pillKind,
            sourceRecId,
            replicateRecCount,
          });
          for (const cta of ctas) {
            const lower = cta.label.toLowerCase();
            for (const term of banned) {
              expect(lower, `${pillKind}/${sourceRecId}/${replicateRecCount}`).not.toContain(term);
            }
          }
        }
      }
    }
  });
});
