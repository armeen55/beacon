import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeReview } from "./change-review";
import type { SerializedFinding } from "@/app/(shell)/today-shared-types";

const noop = vi.fn(async () => ({ success: true }));

function findingStub(
  overrides: Partial<SerializedFinding> = {},
): SerializedFinding {
  return {
    id: "f-test",
    type: "title_changed",
    pagePath: "/services/whole-home-remodel",
    summary: "Title changed",
    previousState: "Old title",
    currentState: "New title",
    citationCount: 0,
    detectedAt: "2026-04-27T00:00:00Z",
    detectionRunId: "scan-test",
    priority: "medium",
    priorityScore: 0,
    status: "pending",
    ...overrides,
  } as unknown as SerializedFinding;
}

describe("ChangeReview — Phase 6A.4 / UX.6.2 copy + collapse", () => {
  it("UX.6.2 — renders 'Recent site changes (N)' heading (not the old 'Scan diffs to review')", () => {
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[findingStub({ id: "f1" }), findingStub({ id: "f2" })]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(html).toContain("Recent site changes (2)");
    expect(html).not.toContain("Scan diffs to review");
    expect(html).not.toContain("changes detected");
    expect(html).not.toContain("Confirmed changes are tracked for attribution");
  });

  it("UX.6.2 — subtitle uses customer-safe vocabulary (no 'raw' or 'scanner' wording)", () => {
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[findingStub()]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    // New customer-safe phrasing. JSX escapes "&" → "&amp;" in
    // rendered HTML, so we assert against the encoded form.
    expect(html).toContain("Content &amp; structure changes Beacon spotted on your site");
    expect(html).toContain("Confirm one to add it to your changelog");
    // Old operator-internal phrasing must NOT appear.
    expect(html).not.toContain("raw website differences");
    expect(html).not.toContain("Beacon&#x27;s scanner");
    expect(html).not.toContain("Beacon's scanner");
  });

  it("section is collapsed by default (no `open` attribute on <details>)", () => {
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[findingStub()]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    // <details> without "open" attribute = collapsed by default. Negative
    // assertion on `open=` is the canonical way to lock that contract.
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it("Confirm button label is 'Confirm and add to changelog' (not just 'Confirm')", () => {
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[findingStub()]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(html).toContain("Confirm and add to changelog");
  });

  it("Dismiss button label is unchanged (still 'Dismiss')", () => {
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[findingStub()]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(html).toContain(">Dismiss<");
  });

  it("preserves the change-review-section anchor for the scan banner's deep-link", () => {
    // ScanStatusBanner's "Review changes" button scrolls to
    // #change-review-section. Renaming/restructuring this component must
    // not break that anchor — operators rely on the deep-link.
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[findingStub()]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    expect(html).toContain('id="change-review-section"');
  });

  it("returns null when there are zero content changes", () => {
    const html = renderToStaticMarkup(
      <ChangeReview findings={[]} onConfirm={noop} onDismiss={noop} />,
    );
    expect(html).toBe("");
  });

  it("filters out non-content findings (e.g. guardrails) before counting", () => {
    const html = renderToStaticMarkup(
      <ChangeReview
        findings={[
          findingStub({ id: "content", type: "title_changed" }),
          findingStub({ id: "guardrail", type: "guardrail_alert" as never }),
        ]}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );
    // Only one content change should be counted.
    expect(html).toContain("Recent site changes (1)");
  });
});
