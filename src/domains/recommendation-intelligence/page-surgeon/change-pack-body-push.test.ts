/**
 * BEACON_500 item 2 (2026-07-01): body-section pushability surfacing.
 * When a page's collection has an operator-mapped body field, ADDITIVE
 * section drafts (answer block / FAQ / new section) classify as one-click
 * applicable with honest restore copy. Everything else keeps today's
 * behavior: no mapping means manual, removals and reorders stay manual
 * always (Beacon never deletes live content).
 */

import { describe, it, expect } from "vitest";

import {
  classifyArtifactPushability,
  BODY_PUSH_READY_REASON,
} from "./change-pack";
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import type { ChangeArtifact } from "./artifact-bundle";
import type { EvidencePacket } from "./contract";

function packet(over: Partial<EvidencePacket["current"]> = {}): EvidencePacket {
  return {
    current: {
      tenantId: "t",
      pageUrl: "https://x.com/p",
      changeType: "title",
      elementKey: null,
      sectionLabel: null,
      currentText: "Old",
      cmsFieldMapped: over.cmsFieldMapped ?? true,
      publishChannel: over.publishChannel ?? "wix_cms",
    },
    sourcesPresent: ["gsc", "crawl"],
    sourcesConnectedButEmpty: ["ga4", "clarity", "profound"],
  } as EvidencePacket;
}

function art(action: ChangeArtifact["action"]): ChangeArtifact {
  return {
    action,
    label: action,
    dependencyOrder: 1,
    publishability: "staged",
    before: null,
    after: "new section text",
    rollback: "revert",
    measurement: "m",
    evidence: "e",
    hypothesis: "h",
    risk: "",
  } as ChangeArtifact;
}

describe("change-pack - body-section pushability (BEACON_500 item 2)", () => {
  it("an answer block on a body-mapped page is one-click applicable with honest restore copy", () => {
    const p = classifyArtifactPushability(art("intro_answer_block"), packet(), {
      mappingExists: true,
      bodyFieldMapped: true,
    });
    expect(p.method).toBe("wix_cms_field");
    expect(p.canAutoApply).toBe(true);
    expect(p.fieldTargetKnown).toBe(true);
    expect(p.rollbackReady).toBe(true);
    expect(p.reason).toBe(BODY_PUSH_READY_REASON);
    expect(p.reason).toContain("I can apply this section for you in Wix");
    expect(p.reason).toContain("restore it in one click");
    expect(hasBannedDash(p.reason)).toBe(false);
  });

  it("faq and section_add are also body-pushable when mapped", () => {
    for (const action of ["faq", "section_add"] as const) {
      const p = classifyArtifactPushability(art(action), packet(), {
        mappingExists: true,
        bodyFieldMapped: true,
      });
      expect(p.canAutoApply).toBe(true);
      expect(p.method).toBe("wix_cms_field");
    }
  });

  it("section_remove and section_reorder stay manual even when body-mapped (no deletes ever)", () => {
    for (const action of ["section_remove", "section_reorder"] as const) {
      const p = classifyArtifactPushability(art(action), packet(), {
        mappingExists: true,
        bodyFieldMapped: true,
      });
      expect(p.method).toBe("no_write_path");
      expect(p.canAutoApply).toBe(false);
    }
  });

  it("no bodyField mapping (undefined or false) keeps today's manual behavior", () => {
    const noFlag = classifyArtifactPushability(art("intro_answer_block"), packet(), {
      mappingExists: true,
    });
    expect(noFlag.method).toBe("no_write_path");
    expect(noFlag.canAutoApply).toBe(false);

    const explicitFalse = classifyArtifactPushability(art("faq"), packet(), {
      mappingExists: true,
      bodyFieldMapped: false,
    });
    expect(explicitFalse.method).toBe("no_write_path");
  });

  it("a body mapping cannot override a missing page mapping or a non-Wix channel", () => {
    const noUrlMap = classifyArtifactPushability(art("intro_answer_block"), packet(), {
      mappingExists: false,
      bodyFieldMapped: true,
    });
    expect(noUrlMap.canAutoApply).toBe(false);

    const notWix = classifyArtifactPushability(
      art("intro_answer_block"),
      packet({ cmsFieldMapped: false, publishChannel: "dev_note" }),
      { bodyFieldMapped: true },
    );
    expect(notWix.canAutoApply).toBe(false);
    expect(notWix.method).toBe("no_write_path");
  });
});
