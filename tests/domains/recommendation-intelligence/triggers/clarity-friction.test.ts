/**
 * Clarity friction trigger tests (2026-06-13). script_errors (HIGH,
 * ≥0.05/session) + rage_clicks (MEDIUM, ≥0.07/session), ≥50-session
 * floor; dead/quickback/scroll deliberately don't fire. Directive-only
 * fix_page_experience card; abstains without a Clarity signal.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import {
  clarityFriction,
  frictionReason,
  MIN_CLARITY_SESSIONS,
} from "@/domains/recommendation-intelligence/triggers/clarity-friction";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "s", page_id: "p", url: "https://iranopedia.com/persian-rugs/qom",
    canonical_url: null, fetched_at: "2026-06-13T04:00:00Z", http_status: 200,
    title: "Qom Rug", meta_description: null, h1: "Qom Rug", h2_list: [], h3_count: 0,
    faqs: [], schema_types: [], location_terms: [], service_terms: [],
    internal_link_count: 3, external_link_count: 2, word_count: 700, robots_meta: null,
    has_canonical_mismatch: false, content_hash: "x", headings_hash: "y", faq_hash: "z",
    schema_hash: "w", tenant_id: "tenant-a", extraction_certainty: "confirmed", ...over,
  } as PageSnapshot;
}

function sig(over: Partial<ClarityPageSignal> = {}): ClarityPageSignal {
  return {
    url: "https://iranopedia.com/persian-rugs/qom",
    sessions: 200, rageClicks: 0, deadClicks: 0, quickbacks: 0,
    excessiveScroll: 0, scriptErrors: 0, rageRate: 0, deadRate: 0, quickbackRate: 0,
    ...over,
  };
}

describe("frictionReason", () => {
  it("script errors ≥5% of sessions → high (outranks rage)", () => {
    const r = frictionReason(sig({ scriptErrors: 20, sessions: 200, rageClicks: 30, rageRate: 0.15 }));
    expect(r).toEqual({ kind: "script_errors", confidence: "high" });
  });
  it("rage ≥7% with no script errors → medium", () => {
    const r = frictionReason(sig({ rageClicks: 20, sessions: 200, rageRate: 0.10 }));
    expect(r).toEqual({ kind: "rage_clicks", confidence: "medium" });
  });
  it("below the session floor → null (tiny denominator can't fire)", () => {
    expect(frictionReason(sig({ sessions: MIN_CLARITY_SESSIONS - 1, scriptErrors: 10, rageRate: 0.5 }))).toBeNull();
  });
  it("dead clicks ≥50% of sessions → medium (2026-06-16; below script + rage)", () => {
    const r = frictionReason(sig({ sessions: 500, deadClicks: 450, deadRate: 0.9 }));
    expect(r).toEqual({ kind: "dead_clicks", confidence: "medium" });
  });
  it("dead clicks BELOW the conservative 50% gate do NOT fire (content-browsing baseline)", () => {
    // e.g. a 26%-dead-click content page near the site baseline — not anomalous.
    expect(frictionReason(sig({ sessions: 500, deadClicks: 130, deadRate: 0.26 }))).toBeNull();
  });
  it("script + rage OUTRANK dead clicks (worst-first)", () => {
    const r = frictionReason(
      sig({ sessions: 500, rageClicks: 50, rageRate: 0.1, deadClicks: 450, deadRate: 0.9 }),
    );
    expect(r).toEqual({ kind: "rage_clicks", confidence: "medium" });
  });
  it("quickbacks / excessive-scroll alone still do NOT fire (no defensible band)", () => {
    expect(frictionReason(sig({ sessions: 500, quickbacks: 300, quickbackRate: 0.6, excessiveScroll: 200 }))).toBeNull();
  });
});

describe("clarityFriction", () => {
  it("emits a fix_page_experience card for script errors", () => {
    const out = clarityFriction({ tenantId: "tenant-a", snapshot: snap(), signal: sig({ scriptErrors: 30, sessions: 200 }) });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("clarity_friction");
    expect(c.action_type).toBe("fix_page_experience");
    expect(c.confidence).toBe("high");
    expect(c.operator_evidence).toContain("reason=script_errors");
    expect(c.customer_copy).toContain("AI assistants");
    expect(c.safety_flags).toEqual([]);
  });
  it("emits a medium card for rage clicks", () => {
    const out = clarityFriction({ tenantId: "tenant-a", snapshot: snap(), signal: sig({ rageClicks: 30, sessions: 200, rageRate: 0.15 }) });
    expect(out[0]!.confidence).toBe("medium");
    expect(out[0]!.operator_evidence).toContain("reason=rage_clicks");
  });
  it("abstains without a Clarity signal (dormant until token) and on non-HTML", () => {
    expect(clarityFriction({ tenantId: "t", snapshot: snap(), signal: undefined })).toEqual([]);
    expect(clarityFriction({ tenantId: "t", snapshot: snap({ url: "https://x.com/a.pdf" }), signal: sig({ scriptErrors: 99, sessions: 200 }) })).toEqual([]);
  });
});
