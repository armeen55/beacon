import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LifecycleStatusPill,
  resolveLifecyclePillKey,
} from "./lifecycle-status-pill";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleTabClass } from "@/domains/attribution/lifecycle-classification";

const ALL_EDIT_STATUSES: ImplementationStatus[] = [
  "recommended",
  "accepted",
  "verified_live",
  "verified_live_modified",
  "needs_review",
  "partially_implemented",
  "wrong_page",
  "not_found_after_7d",
  "dismissed",
];

describe("resolveLifecyclePillKey", () => {
  it("status wins over class when both supplied", () => {
    // class says live_verified but status says needs_review — granular wins.
    expect(
      resolveLifecyclePillKey({ status: "needs_review", cls: "live_verified" }),
    ).toBe("needs_review");
  });

  it("returns null when neither supplied", () => {
    expect(resolveLifecyclePillKey({})).toBeNull();
    expect(resolveLifecyclePillKey({ status: null, cls: null })).toBeNull();
  });

  it("class fall-back: live_verified → verified_live", () => {
    expect(resolveLifecyclePillKey({ cls: "live_verified" })).toBe("verified_live");
  });
  it("class fall-back: pending_implementation → accepted", () => {
    expect(resolveLifecyclePillKey({ cls: "pending_implementation" })).toBe("accepted");
  });
  it("class fall-back: imported_legacy → imported_legacy", () => {
    expect(resolveLifecyclePillKey({ cls: "imported_legacy" })).toBe("imported_legacy");
  });
  it("class fall-back: scan_confirmed → scan_confirmed", () => {
    expect(resolveLifecyclePillKey({ cls: "scan_confirmed" })).toBe("scan_confirmed");
  });
  it("class fall-back: unclassified → unclassified", () => {
    expect(resolveLifecyclePillKey({ cls: "unclassified" })).toBe("unclassified");
  });
  it("class fall-back: needs_review → needs_review", () => {
    expect(resolveLifecyclePillKey({ cls: "needs_review" })).toBe("needs_review");
  });
});

describe("LifecycleStatusPill rendering", () => {
  it("renders nothing when no status/cls", () => {
    expect(renderToStaticMarkup(<LifecycleStatusPill />)).toBe("");
    expect(renderToStaticMarkup(<LifecycleStatusPill status={null} cls={null} />)).toBe("");
  });

  it("verified_live shows Live + checkmark", () => {
    const html = renderToStaticMarkup(<LifecycleStatusPill status="verified_live" />);
    expect(html).toContain(">Live<");
    expect(html).toContain("✓");
    expect(html).toContain('data-lifecycle-key="verified_live"');
  });

  it("verified_live_modified shows the modified label + checkmark in full mode", () => {
    const html = renderToStaticMarkup(
      <LifecycleStatusPill status="verified_live_modified" />,
    );
    expect(html).toContain("Live (modified)");
    expect(html).toContain("✓");
  });

  it("verified_live_modified compact shortens to 'Live·mod'", () => {
    const html = renderToStaticMarkup(
      <LifecycleStatusPill status="verified_live_modified" compact />,
    );
    // Visible text uses the short form. The full label persists in the
    // `title` attribute for hover/screen-reader context — that's
    // intentional, so this test only asserts the short form is rendered.
    expect(html).toContain(">Live·mod<");
  });

  it("accepted full label = 'Pending implementation'", () => {
    const html = renderToStaticMarkup(<LifecycleStatusPill status="accepted" />);
    expect(html).toContain("Pending implementation");
  });

  it("accepted compact label = 'Pending'", () => {
    const html = renderToStaticMarkup(<LifecycleStatusPill status="accepted" compact />);
    // Visible text is the short form; full "Pending implementation" lives
    // in the `title` attribute for hover context (not asserted away).
    expect(html).toContain(">Pending<");
  });

  it("dismissed shows hollow dot, no checkmark", () => {
    const html = renderToStaticMarkup(<LifecycleStatusPill status="dismissed" />);
    expect(html).toContain("Dismissed");
    expect(html).not.toContain("✓");
  });

  it("imported_legacy via class fallback shows full label", () => {
    // 2026-05-06 demo-path fix: rendered label is "Pre-launch" (was
    // "Imported legacy"). The schema-internal key remains
    // imported_legacy on the data attribute for backwards-compat.
    const html = renderToStaticMarkup(<LifecycleStatusPill cls="imported_legacy" />);
    expect(html).toContain("Pre-launch");
    expect(html).not.toContain("Imported legacy");
    expect(html).toContain('data-lifecycle-key="imported_legacy"');
  });

  it("imported_legacy via class fallback compact shows 'Pre-launch'", () => {
    // 2026-05-06: full and compact labels both rendered as "Pre-launch"
    // (compact label is identical to full label here; was "Legacy").
    const html = renderToStaticMarkup(
      <LifecycleStatusPill cls="imported_legacy" compact />,
    );
    expect(html).toContain(">Pre-launch<");
    expect(html).not.toContain(">Legacy<");
  });

  it("scan_confirmed via class fallback uses amber palette", () => {
    // 2026-05-06: rendered label is "Detected by scan" (was "Scan-confirmed").
    const html = renderToStaticMarkup(<LifecycleStatusPill cls="scan_confirmed" />);
    expect(html).toContain("Detected by scan");
    expect(html).not.toContain("Scan-confirmed");
    expect(html).toContain("amber");
  });

  it("unclassified via class shows 'Other'", () => {
    const html = renderToStaticMarkup(<LifecycleStatusPill cls="unclassified" />);
    expect(html).toContain(">Other<");
  });

  it.each(ALL_EDIT_STATUSES)("renders without throwing for status=%s", (s) => {
    const html = renderToStaticMarkup(<LifecycleStatusPill status={s} />);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(`data-lifecycle-key="${s}"`);
  });

  it.each<LifecycleTabClass>([
    "live_verified",
    "pending_implementation",
    "needs_review",
    "imported_legacy",
    "scan_confirmed",
    "unclassified",
  ])("renders without throwing for cls=%s", (c) => {
    const html = renderToStaticMarkup(<LifecycleStatusPill cls={c} />);
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("Production fixtures", () => {
  it("Whole Home Remodel H2 (status=verified_live, cls=live_verified) → Live ✓", () => {
    const html = renderToStaticMarkup(
      <LifecycleStatusPill status="verified_live" cls="live_verified" />,
    );
    expect(html).toContain(">Live<");
    expect(html).toContain("✓");
  });

  it("Phase 6A.1 dismissed FAQ (status=dismissed) → Dismissed (no check)", () => {
    const html = renderToStaticMarkup(<LifecycleStatusPill status="dismissed" />);
    expect(html).toContain("Dismissed");
    expect(html).not.toContain("✓");
  });
});

// ── data-lifecycle-key leak gate (2026-05-10 customer-mode audit) ──
//
// Pre-fix, the pill rendered `data-lifecycle-key="<raw enum>"` on every
// instance — visible text was friendly ("Live", "Pending implementation"),
// but the data attribute leaked operator vocabulary like
// "verified_live_modified" / "not_found_after_7d" via DevTools / View
// Source. Same shape as the scorecard `data-attribution-branch` gate.

describe("data-lifecycle-key leak gate", () => {
  it("renders data-lifecycle-key under test mode (NODE_ENV='test') for snapshot/dev-tools", () => {
    const html = renderToStaticMarkup(
      <LifecycleStatusPill status="verified_live_modified" />,
    );
    expect(html).toContain('data-lifecycle-key="verified_live_modified"');
    // Visible label stays clean.
    expect(html).toContain(">Live (modified)<");
  });

  it("strips data-lifecycle-key under customer mode (NODE_ENV !== 'test' AND no operator flag)", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevNode = env.NODE_ENV;
    const prevPublic = env.NEXT_PUBLIC_OPERATOR_MODE;
    try {
      env.NODE_ENV = "production";
      delete env.NEXT_PUBLIC_OPERATOR_MODE;
      vi.resetModules();
      const mod = await import("./lifecycle-status-pill");
      const html = renderToStaticMarkup(
        <mod.LifecycleStatusPill status="verified_live_modified" />,
      );
      // Raw enum key must NOT leak into the customer-mode HTML.
      expect(html).not.toContain('data-lifecycle-key=');
      expect(html).not.toContain("verified_live_modified");
      expect(html).not.toContain("not_found_after_7d");
      // Visible label still renders correctly.
      expect(html).toContain(">Live (modified)<");
    } finally {
      if (prevNode === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevNode;
      if (prevPublic === undefined) delete env.NEXT_PUBLIC_OPERATOR_MODE;
      else env.NEXT_PUBLIC_OPERATOR_MODE = prevPublic;
      vi.resetModules();
    }
  });
});
