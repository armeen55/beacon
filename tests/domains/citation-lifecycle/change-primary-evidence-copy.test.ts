/**
 * Section 6 C6a — pure copy renderer tests.
 *
 * Covers:
 *   • lifecycleStage === "stuck" → null regardless of mode statuses.
 *   • Each combination of Mode A {pass, still_learning, silent} × Mode B
 *     {both pass, one pass / one silent, both still_learning,
 *     mixed still_learning/silent, both silent}.
 *   • Mode A pass + Mode B still_learning → still_learning suppressed.
 *   • Mode A pass + Mode B pass → both render.
 *   • At most ONE collapsed Mode B still_learning line across platforms.
 *   • brandName placeholder substitution (never hard-coded).
 *   • Platform labels "ChatGPT" / "Perplexity" exact spelling.
 *   • All-silent → null.
 */

import { describe, it, expect } from "vitest";
import { renderChangePrimaryCopy } from "@/domains/citation-lifecycle/change-primary-evidence-copy";
import type { ChangePrimaryModeAResult } from "@/domains/citation-lifecycle/change-primary-mode-a";
import type { ChangePrimaryModeBPerPlatformResult, ChangePrimaryModeBResult } from "@/domains/citation-lifecycle/change-primary-mode-b";

const BRAND = "Ritz Builders";

function modeA(
  over: Partial<ChangePrimaryModeAResult> = {},
): ChangePrimaryModeAResult {
  return {
    status: "silent",
    cited_here_count: 0,
    primary_count: 0,
    primary_share_pct: null,
    ...over,
  };
}

function pp(
  over: Partial<ChangePrimaryModeBPerPlatformResult> = {},
): ChangePrimaryModeBPerPlatformResult {
  return {
    status: "silent",
    pre_count: 0,
    pre_total: 0,
    pre_share_pct: null,
    post_count: 0,
    post_total: 0,
    post_share_pct: null,
    delta_pp: null,
    ...over,
  };
}

function modeB(
  chatgpt: Partial<ChangePrimaryModeBPerPlatformResult> = {},
  perplexity: Partial<ChangePrimaryModeBPerPlatformResult> = {},
): ChangePrimaryModeBResult {
  return {
    per_platform: { chatgpt: pp(chatgpt), perplexity: pp(perplexity) },
  };
}

const PASSING_PP: Partial<ChangePrimaryModeBPerPlatformResult> = {
  status: "pass",
  pre_count: 10,
  pre_total: 20,
  pre_share_pct: 50,
  post_count: 14,
  post_total: 20,
  post_share_pct: 70,
  delta_pp: 20,
};

describe("Section 6 C6a — copy renderer", () => {
  it("lifecycleStage === 'stuck' → null regardless of mode statuses", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA({ status: "pass", cited_here_count: 10, primary_count: 7 }),
      modeB: modeB(PASSING_PP, PASSING_PP),
      brandName: BRAND,
      lifecycleStage: "stuck",
    });
    expect(r).toBeNull();
  });

  it("Mode A pass + both Mode B silent → 1 line (Mode A pass; brandName substituted)", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA({
        status: "pass",
        cited_here_count: 10,
        primary_count: 7,
        primary_share_pct: 70,
      }),
      modeB: modeB(),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines[0]).toBe(
      "In 7 of 10 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.",
    );
  });

  it("Mode A still_learning + both Mode B silent → 1 line (Mode A still_learning)", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA({
        status: "still_learning",
        cited_here_count: 3,
        primary_count: 1,
        primary_share_pct: 33,
      }),
      modeB: modeB(),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines[0]).toBe(
      "This page has been cited a few times since it went live — not enough answers yet to read primary-recommendation evidence.",
    );
  });

  it("Mode A silent + 1 Mode B pass → 1 line (Mode B pass for that platform)", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA(),
      modeB: modeB(PASSING_PP, {}),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines[0]).toBe(
      "On ChatGPT, primary-recommendation share on the prompts this change targeted was up 20 points in the first 14 days after going live versus the prior 14 (50% → 70%).",
    );
  });

  it("Mode A silent + both Mode B pass → 2 lines (ChatGPT first, then Perplexity)", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA(),
      modeB: modeB(PASSING_PP, PASSING_PP),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(2);
    expect(r!.lines[0]).toContain("On ChatGPT");
    expect(r!.lines[1]).toContain("On Perplexity");
  });

  it("Mode A pass + 1 Mode B still_learning → 1 line (Mode A only; suppression)", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA({
        status: "pass",
        cited_here_count: 10,
        primary_count: 7,
        primary_share_pct: 70,
      }),
      modeB: modeB({ status: "still_learning" }, {}),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines[0]).toContain("In 7 of 10 answers");
    // still_learning line MUST NOT appear when Mode A passed.
    expect(r!.lines.join("\n")).not.toContain("still gathering");
  });

  it("Mode A pass + Mode B pass → 2 lines (suppression doesn't apply when B passes)", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA({
        status: "pass",
        cited_here_count: 10,
        primary_count: 7,
        primary_share_pct: 70,
      }),
      modeB: modeB(PASSING_PP, {}),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(2);
    expect(r!.lines[0]).toContain("In 7 of 10 answers");
    expect(r!.lines[1]).toContain("On ChatGPT");
  });

  it("Mode A silent + both Mode B still_learning → 1 collapsed still_learning line", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA(),
      modeB: modeB({ status: "still_learning" }, { status: "still_learning" }),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines[0]).toBe(
      "Beacon is still gathering 14 days of post-launch evidence on the prompts this change targeted.",
    );
  });

  it("Mode A silent + one Mode B still_learning + one Mode B silent → 1 collapsed line", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA(),
      modeB: modeB({ status: "still_learning" }, { status: "silent" }),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines).toHaveLength(1);
    expect(r!.lines[0]).toContain("still gathering");
  });

  it("all silent → null", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA(),
      modeB: modeB(),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).toBeNull();
  });

  it("brandName placeholder substitutes the caller-supplied value", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA({
        status: "pass",
        cited_here_count: 8,
        primary_count: 5,
        primary_share_pct: 63,
      }),
      modeB: modeB(),
      brandName: "Acme Builders",
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines[0]).toContain("Acme Builders");
    expect(r!.lines[0]).not.toContain("Ritz Builders");
  });

  it("renders 'ChatGPT' / 'Perplexity' with exact spelling", () => {
    const r = renderChangePrimaryCopy({
      modeA: modeA(),
      modeB: modeB(PASSING_PP, PASSING_PP),
      brandName: BRAND,
      lifecycleStage: null,
    });
    expect(r).not.toBeNull();
    expect(r!.lines[0]).toContain("ChatGPT");
    expect(r!.lines[1]).toContain("Perplexity");
  });
});
