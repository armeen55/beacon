import { describe, expect, it } from "vitest";

import { decideVerdict, prioritizeWorkbench } from "./workbench-priority";
import type { WorkbenchLeverRow, LeverKey } from "./workbench-matrix";

function row(over: Partial<WorkbenchLeverRow> & { lever: LeverKey }): WorkbenchLeverRow {
  return {
    label: over.lever,
    needed: true,
    whyNeeded: "because",
    status: "attention",
    current: null,
    proposed: null,
    proposedSource: "needs_endpoint",
    benefit: null,
    risk: "low",
    pushMethod: "manual_cms_edit",
    pushReason: "",
    canAutoApply: false,
    rollbackReady: false,
    ...over,
  };
}

describe("decideVerdict — precedence", () => {
  it("healthy lever (ok, not needed) ⇒ Do not touch", () => {
    expect(decideVerdict(row({ lever: "title", needed: false, status: "ok" }))).toBe("Do not touch");
  });
  it("no-data lever (unknown, not needed) ⇒ Hold this", () => {
    expect(decideVerdict(row({ lever: "new_page", needed: false, status: "unknown" }))).toBe("Hold this");
  });
  it("SERP guard wins over everything when needed", () => {
    const v = decideVerdict(
      row({
        lever: "title",
        needed: true,
        benefit: { estClicksAtStake: 690, window: "90d", confidence: "high", serpGuardLabel: "Needs SERP check before title rewrite" },
        pushMethod: "blocked_no_mapping",
      }),
    );
    expect(v).toBe("Needs SERP check");
  });
  it("blocked_no_mapping ⇒ Needs Wix mapping (no SERP guard)", () => {
    expect(decideVerdict(row({ lever: "title", pushMethod: "blocked_no_mapping" }))).toBe("Needs Wix mapping");
  });
  it("body change (no_write_path) ⇒ Manual only", () => {
    expect(decideVerdict(row({ lever: "answer_block", pushMethod: "no_write_path" }))).toBe("Manual only");
  });
  it("mapped field but no draft yet ⇒ Hold this", () => {
    expect(
      decideVerdict(row({ lever: "title", pushMethod: "wix_cms_field", proposedSource: "needs_endpoint" })),
    ).toBe("Hold this");
  });
  it("mapped + drafted + within-limit + rollback + low risk ⇒ Ship this now", () => {
    expect(
      decideVerdict(
        row({
          lever: "title",
          pushMethod: "wix_cms_field",
          proposedSource: "llm_brief",
          proposed: "New Title",
          canAutoApply: true,
          rollbackReady: true,
          risk: "low",
        }),
      ),
    ).toBe("Ship this now");
  });
});

describe("prioritizeWorkbench", () => {
  it("a healthy page (no needed levers) yields no picks", () => {
    const rows = [
      row({ lever: "title", needed: false, status: "ok" }),
      row({ lever: "meta", needed: false, status: "ok" }),
    ];
    const picks = prioritizeWorkbench(rows);
    expect(picks.bestSingle).toBeNull();
    expect(picks.bestBigger).toBeNull();
    expect(picks.highestUpside).toBeNull();
  });

  it("picks the highest-benefit CTR lever as bestSingle + fastestMeasurable, and a body lever as bestBigger", () => {
    const rows = [
      row({
        lever: "meta",
        benefit: { estClicksAtStake: 690, window: "90d", confidence: "high", serpGuardLabel: null },
        pushMethod: "blocked_no_mapping",
      }),
      row({ lever: "answer_block", pushMethod: "no_write_path" }),
      row({ lever: "h2_sections", pushMethod: "no_write_path" }),
    ];
    const picks = prioritizeWorkbench(rows);
    expect(picks.bestSingle!.lever).toBe("meta");
    expect(picks.fastestMeasurable!.lever).toBe("meta");
    expect(["answer_block", "h2_sections"]).toContain(picks.bestBigger!.lever);
  });

  it("never picks cannibalization as the single one-click move", () => {
    const rows = [
      row({ lever: "cannibalization", needed: true, status: "attention", benefit: null }),
      row({
        lever: "title",
        benefit: { estClicksAtStake: 200, window: "90d", confidence: "medium", serpGuardLabel: null },
        pushMethod: "blocked_no_mapping",
      }),
    ];
    const picks = prioritizeWorkbench(rows);
    expect(picks.bestSingle!.lever).not.toBe("cannibalization");
    expect(picks.bestSingle!.lever).toBe("title");
    expect(picks.fastestMeasurable?.lever).not.toBe("cannibalization");
  });
});
