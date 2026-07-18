/**
 * results-ledger-card render pins (trust-audit 2026-07-18): a ledger row shaped
 * like the real production Iranopedia rows (latched verifiedLive, canonical
 * null, latest crawl not_found at low similarity, no predeclared plan) must SHOW
 * the live-contradiction line and the legacy-measurement caveat on the card, not
 * hide the honesty behind a green badge.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The card renders client action buttons (RecrawlButton et al) that call
// useRouter; stub next/navigation so a static SSR render never needs a mounted
// app router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/results",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { LedgerRowGroup } from "./results-ledger-card";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { ProofLink } from "@/domains/action-pack/proof-linker";
import type { MeasurementPresentation } from "@/domains/proof-gsc/measurement-maturity";
import type { CompoundActionGroup } from "@/domains/proof-gsc/compound-actions";
import type { RevertDecision } from "@/domains/autopilot/revert-policy";
import type { SparkPoint } from "@/components/data/sparkline";

function makeRecord(over: Partial<ShippedChangeRecord>): ShippedChangeRecord {
  return {
    id: "/persian-cats::2026-06-20",
    page: "https://example.com/persian-cats",
    path: "/persian-cats",
    actionType: "edit_meta",
    before: "old",
    after: "new",
    shippedAt: "2026-06-20T00:00:00.000Z",
    baseline: { clicks: 100, impressions: 5000, ctr: 0.02, position: 6, windowDays: 28 },
    targetQueries: ["persian cats"],
    controlPages: [],
    windows: [],
    verdict: "inconclusive",
    confidence: "low",
    measuredAt: "2026-07-19T00:00:00.000Z",
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    calibrationVersion: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...over,
  };
}

function renderRow(rec: ShippedChangeRecord): string {
  return renderToStaticMarkup(
    <LedgerRowGroup
      rows={[rec]}
      band="learning"
      linkByRowId={new Map<string, ProofLink>()}
      presById={new Map<string, MeasurementPresentation>()}
      compoundById={new Map<string, CompoundActionGroup>()}
      sparkByPath={new Map<string, SparkPoint[]>()}
      revertById={new Map<string, RevertDecision>()}
      restoredIds={new Set<string>()}
    />,
  );
}

describe("LedgerRowGroup card (trust-audit contradiction + legacy caveat)", () => {
  // Exactly the production shape: verified_live latched, but the freshest crawl
  // could not find the edit (not_found, similarity 0.27), and no predeclared plan.
  const productionShaped = makeRecord({
    verifiedLive: true,
    predeclaredAt: null,
    verifyState: {
      canonical: null,
      canonicalAt: null,
      lastAttempt: { state: "not_found", at: "2026-07-15T00:00:00.000Z", similarity: 0.27 },
      attempts: 3,
      nextRetryAt: null,
      exhausted: false,
    },
  });

  it("renders the live-contradiction line for a stale verified_live row", () => {
    const html = renderRow(productionShaped);
    expect(html).toContain(
      "I confirmed this edit earlier, but my latest check of the live page could not find it. Open the page and confirm the edit is still there.",
    );
  });

  it("renders the legacy-measurement caveat when there is no predeclared plan", () => {
    const html = renderRow(productionShaped);
    expect(html).toContain(
      "I measured this with my earlier method, before I locked in measurement plans up front. Treat it as a directional read.",
    );
  });

  it("emits no em or en dash anywhere on the card", () => {
    expect(renderRow(productionShaped)).not.toMatch(/[‒–—―]/);
  });

  it("stays silent on both lines for a re-confirmed, predeclared row", () => {
    const clean = makeRecord({
      verifiedLive: true,
      predeclaredAt: "2026-07-18T00:00:00.000Z",
      verifyState: {
        canonical: { outcome: "verified_live", kind: "exact" },
        canonicalAt: "2026-07-16T00:00:00.000Z",
        lastAttempt: { state: "not_found", at: "2026-07-15T00:00:00.000Z", similarity: 0.27 },
        attempts: 0,
        nextRetryAt: null,
        exhausted: false,
      },
    });
    const html = renderRow(clean);
    expect(html).not.toContain("my latest check of the live page could not find it");
    expect(html).not.toContain("I measured this with my earlier method");
  });
});
