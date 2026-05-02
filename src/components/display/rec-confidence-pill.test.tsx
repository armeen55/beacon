/**
 * W3 Step 3.5 (2026-05-02) — RecConfidencePill component tests.
 *
 * Pure-presentation tests over the operator-facing label contract.
 * No data dependencies, no server actions; just the component + a
 * verdict input.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RecConfidencePill,
  REC_CONFIDENCE_LABEL,
} from "./rec-confidence-pill";

describe("RecConfidencePill — operator-facing labels", () => {
  it("renders 'Strong' for HIGH; visible label never says 'auto'", () => {
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{
          confidence: "high",
          reasons: ["multi_prompt_signal", "all_edits_high_confidence"],
        }}
      />,
    );
    expect(html).toContain("Strong");
    // The tooltip CAN say "never auto-apply" — that's the trust
    // copy the operator wants visible on hover. The contract is
    // about the VISIBLE LABEL between the tags, not the tooltip
    // attribute. Strip the title attribute before checking.
    const visibleLabel = html.replace(/title="[^"]*"/g, "");
    expect(visibleLabel).not.toMatch(/\bauto\b/i);
    expect(visibleLabel).not.toMatch(/auto.?apply/i);
  });

  it("renders 'Review' for MEDIUM", () => {
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{
          confidence: "medium",
          reasons: ["single_prompt_signal"],
        }}
      />,
    );
    expect(html).toContain("Review");
    expect(html).not.toContain("Strong");
    expect(html).not.toContain("Weak signal");
  });

  it("renders 'Weak signal' for LOW", () => {
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{
          confidence: "low",
          reasons: ["no_edits"],
        }}
      />,
    );
    expect(html).toContain("Weak signal");
    expect(html).not.toContain("Strong");
  });

  it("visible label never implies auto-apply across all three confidence levels", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      const html = renderToStaticMarkup(
        <RecConfidencePill
          verdict={{ confidence, reasons: ["multi_prompt_signal"] }}
        />,
      );
      // Strip the tooltip (title attribute) — the tooltip
      // intentionally documents "never auto-apply" / "Manual
      // ship only" so operators see the trust contract on hover.
      // The contract this test enforces is on the VISIBLE LABEL.
      const visibleLabel = html.replace(/title="[^"]*"/g, "");
      expect(visibleLabel).not.toMatch(/\bauto[\s-]?apply\b/i);
      expect(visibleLabel).not.toMatch(/\bautomatic\b/i);
      expect(visibleLabel).not.toMatch(/\binstantly\b/i);
      expect(visibleLabel).not.toMatch(/\bone[\s-]?click\b/i);
    }
  });

  it("internal enum values do NOT leak into rendered HTML as visible labels", () => {
    // The data-attribute carries the internal enum; the visible
    // text uses the operator label. Asserting the rendered text
    // doesn't carry the bare token "high" / "medium" / "low" as a
    // word boundary keeps the diagnostic / human surfaces split.
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{ confidence: "high", reasons: [] }}
      />,
    );
    // data-rec-confidence is an attribute (allowed); the body text
    // should contain "Strong" not "high".
    expect(html).toContain('data-rec-confidence="high"');
    // Body text — the HTML body (between the `>` and the closing
    // tag) should NOT contain the bare word "high" as a label.
    const bodyText = html
      .replace(/data-rec-confidence="[^"]*"/g, "")
      .replace(/<[^>]+>/g, " ");
    expect(bodyText).toContain("Strong");
    expect(bodyText.trim()).not.toBe("high");
  });

  it("tooltip surfaces operator-facing trust copy + reason codes", () => {
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{
          confidence: "high",
          reasons: ["multi_prompt_signal", "grounded_in_search_signal"],
        }}
      />,
    );
    expect(html).toContain("likely safe to ship after a brief review");
    expect(html).toContain("Manual ship only");
    expect(html).toContain("never auto-apply");
    expect(html).toContain("multi_prompt_signal");
    expect(html).toContain("grounded_in_search_signal");
  });

  it("tooltip omits reasons section when reasons array is empty", () => {
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{ confidence: "medium", reasons: [] }}
      />,
    );
    expect(html).not.toContain("(reasons:");
  });

  it("showTooltip=false omits the title attribute entirely", () => {
    const html = renderToStaticMarkup(
      <RecConfidencePill
        verdict={{
          confidence: "high",
          reasons: ["multi_prompt_signal"],
        }}
        showTooltip={false}
      />,
    );
    expect(html).not.toContain("title=");
  });
});

describe("REC_CONFIDENCE_LABEL — exported map", () => {
  it("covers every confidence value", () => {
    expect(REC_CONFIDENCE_LABEL.high).toBe("Strong");
    expect(REC_CONFIDENCE_LABEL.medium).toBe("Review");
    expect(REC_CONFIDENCE_LABEL.low).toBe("Weak signal");
  });

  it("no label uses 'auto' phrasing (operator-locked W3 §1.5)", () => {
    for (const label of Object.values(REC_CONFIDENCE_LABEL)) {
      expect(label.toLowerCase()).not.toMatch(/\bauto/);
      expect(label.toLowerCase()).not.toMatch(/instant/);
      expect(label.toLowerCase()).not.toMatch(/one[\s-]?click/);
    }
  });
});
