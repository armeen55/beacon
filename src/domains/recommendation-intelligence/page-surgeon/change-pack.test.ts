import { describe, it, expect } from "vitest";

import { classifyArtifactPushability, buildAtomicChangePack } from "./change-pack";
import type { ChangeArtifact, ArtifactBundle } from "./artifact-bundle";
import type { EvidencePacket } from "./contract";
import type { PageAtomicDecision } from "./page-decision";
import type { QaVerdict } from "./artifact-qa";

function packet(over: Partial<EvidencePacket["current"]> = {}): EvidencePacket {
  return {
    current: {
      tenantId: "t", pageUrl: "https://x.com/p", changeType: "title", elementKey: null,
      sectionLabel: null, currentText: "Old", cmsFieldMapped: over.cmsFieldMapped ?? true,
      publishChannel: over.publishChannel ?? "wix_cms",
    },
    sourcesPresent: ["gsc", "crawl"], sourcesConnectedButEmpty: ["ga4", "clarity", "semrush", "profound"],
  };
}
function art(over: Partial<ChangeArtifact> & { action: ChangeArtifact["action"] }): ChangeArtifact {
  return {
    action: over.action, label: over.action, dependencyOrder: over.dependencyOrder ?? 1,
    publishability: over.publishability ?? "staged",
    cmsField: over.cmsField, answerBlockText: over.answerBlockText, faq: over.faq,
    before: over.before ?? null, after: over.after ?? "new",
    rollback: over.rollback ?? "revert", measurement: "m", evidence: "e", hypothesis: "h", risk: "",
  };
}

describe("change-pack — pushability classification", () => {
  it("a mapped title with a known prior value is auto-applicable + rollback-ready", () => {
    const a = art({ action: "title", cmsField: { field: "title", value: "New Title", charCount: 9, limit: 60, withinLimit: true, autoTrimmed: false }, before: "Old Title" });
    const p = classifyArtifactPushability(a, packet());
    expect(p.method).toBe("wix_cms_field");
    expect(p.canAutoApply).toBe(true);
    expect(p.rollbackReady).toBe(true);
  });

  it("a mapped title with NO captured prior value is pushable but rollback best-effort", () => {
    const a = art({ action: "title", cmsField: { field: "title", value: "New", charCount: 3, limit: 60, withinLimit: true, autoTrimmed: false }, before: null });
    const p = classifyArtifactPushability(a, packet());
    expect(p.canAutoApply).toBe(true);
    expect(p.rollbackReady).toBe(false);
  });

  it("a CMS field on a non-Wix channel is blocked for no mapping", () => {
    const a = art({ action: "meta", cmsField: { field: "meta", value: "m", charCount: 1, limit: 160, withinLimit: true, autoTrimmed: false }, before: "old" });
    const p = classifyArtifactPushability(a, packet({ cmsFieldMapped: false, publishChannel: "dev_note" }));
    expect(p.method).toBe("blocked_no_mapping");
    expect(p.canAutoApply).toBe(false);
  });

  it("an answer block has no automated writer but IS reversible", () => {
    const a = art({ action: "intro_answer_block", answerBlockText: "Pedar sag means father of a dog." });
    const p = classifyArtifactPushability(a, packet());
    expect(p.method).toBe("no_write_path");
    expect(p.canAutoApply).toBe(false);
    expect(p.rollbackReady).toBe(true);
  });

  it("image_alt is not applicable", () => {
    const p = classifyArtifactPushability(art({ action: "image_alt" }), packet());
    expect(p.method).toBe("not_applicable");
  });
});

describe("change-pack — buildAtomicChangePack", () => {
  const decision: PageAtomicDecision = {
    pageUrl: "https://x.com/p", recommended_atomic_action: "title",
    primary_atomic_change: null, supporting_atomic_changes: [], rejected_changes: [],
    source_coverage: [{ source: "gsc", used: true, detail: "x" }], wording_research: [],
    confidence: "medium", operator_insight: "i", what_normal_seo_misses: "", why_not_just_title: "",
    evidence_gaps: [], decided_by: "llm_judge",
  };
  const qa: QaVerdict = { pass: true, score: 1, checks: [], failures: [], factCheckRequired: false };

  it("surfaces publish blockers when nothing is auto-applicable", () => {
    const bundle: ArtifactBundle = {
      pageUrl: "https://x.com/p", currentTitle: "Old", headlineAction: "intro_answer_block",
      confidence: "medium",
      snippetBefore: { title: "Old", url: "https://x.com/p", meta: "" },
      snippetAfter: { title: "Old", url: "https://x.com/p", meta: "" },
      primary: art({ action: "intro_answer_block", answerBlockText: "x".repeat(60) }),
      supporting: [], deferred: [], rejected: [], sourceCoverage: [], operatorInsight: "i",
      whatNormalSeoMisses: "", whyNotJustTitle: "", evidenceGaps: [], wordingResearch: [], decidedBy: "llm_judge",
    };
    const pack = buildAtomicChangePack({ tenantId: "t", canonUrl: "https://x.com/p", decision, packet: packet(), bundle, qa, evidenceHash: "h" });
    expect(pack.anyAutoApplicable).toBe(false);
    expect(pack.publishBlockers.length).toBeGreaterThan(0);
    expect(pack.pushability).toHaveLength(1);
  });
});
