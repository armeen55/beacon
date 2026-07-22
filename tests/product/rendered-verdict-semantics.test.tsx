/**
 * Rendered verdict semantics - the ONE snapshot suite for how Results presents
 * verdicts to a paying customer (Core 100K Phase 6 risk-register pin).
 *
 * Absorbs the retired per-widget display files (pooled-verdict-section,
 * proof-badge-calibration, and the proof-* display permutations): every verdict
 * state is rendered through the REAL components and its customer-visible badge
 * copy is snapshotted:
 *
 *   WON (calibrated)        -> "Helped"
 *   LOST (calibrated)       -> "Did not help"
 *   TOO EARLY (day-7 lean)  -> "Leaning good" (never a final claim)
 *   MEASURING               -> "Waiting"
 *   QUARANTINED (uncalibrated won) -> "No clear change" (never an unearned win)
 *
 * Plus the pooled batch line's fail-closed calibration quarantine through the
 * real PooledVerdictSection, and the pure badge gate that backs the card.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/results",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// PooledVerdictSection reads one tenant + one latest pooled row; both mocked so
// the render exercises only the calibration quarantine gate.
let latestPooledRow: PooledVerdictRow | null = null;
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
}));
vi.mock("@/domains/proof-gsc/pooled-verdict-store", () => ({
  loadLatestPooledVerdict: async () => latestPooledRow,
}));

import { LedgerRowGroup } from "@/app/(shell)/results/results-ledger-card";
import { PooledVerdictSection } from "@/app/(shell)/results/pooled-verdict-section";
import {
  isUncalibratedDecidedRecord,
  presentationVerdictFor,
  proofBadgeLabelFromVerdict,
} from "@/app/(shell)/results/proof-badge";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { ProofWindowResult } from "@/domains/proof-gsc/measure";
import type { PooledVerdictRow } from "@/domains/proof-gsc/pooled-verdict-store";
import type { ProofLink } from "@/domains/action-pack/proof-linker";
import type { MeasurementPresentation } from "@/domains/proof-gsc/measurement-maturity";
import type { CompoundActionGroup } from "@/domains/proof-gsc/compound-actions";
import type { SparkPoint } from "@/components/data/sparkline";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

afterEach(() => {
  clearTestCalibratedVersions();
  latestPooledRow = null;
});

function window28(day: 7 | 14 | 28, ran: boolean): ProofWindowResult {
  return {
    day,
    checkOn: "2026-07-18",
    ran,
    treatedDelta: 12,
    controlDelta: 2,
    adjustedLift: 10,
    treatedCtrDelta: 0,
    controlCtrDelta: 0,
    adjustedCtrLift: 0,
    treatedPosDelta: 0,
    controlPosDelta: 0,
    adjustedPosLift: 0,
    controlsUsed: 3,
  };
}

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
    />,
  );
}

/** The customer-visible verdict badge: the first Pill's text content. */
function badgeOf(html: string): string {
  const m = html.match(/data-slot="pill"[^>]*>([\s\S]*?)<\/[a-z]+>/);
  return (m?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("verdict badge semantics through the real ledger card", () => {
  it("snapshots the five verdict presentations a customer can see", () => {
    registerTestCalibratedVersion();
    const states = {
      won_calibrated: badgeOf(
        renderRow(makeRecord({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, windows: [window28(28, true)] })),
      ),
      lost_calibrated: badgeOf(
        renderRow(makeRecord({ verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION, windows: [window28(28, true)] })),
      ),
      too_early_day7_lean: badgeOf(
        renderRow(makeRecord({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, windows: [window28(7, true)] })),
      ),
      measuring: badgeOf(renderRow(makeRecord({ verdict: "measuring", windows: [window28(7, false)] }))),
      quarantined_uncalibrated_won: badgeOf(
        renderRow(makeRecord({ verdict: "won", calibrationVersion: null, windows: [window28(28, true)] })),
      ),
    };
    expect(states).toMatchInlineSnapshot(`
      {
        "lost_calibrated": "Did not help",
        "measuring": "Waiting",
        "quarantined_uncalibrated_won": "No clear change",
        "too_early_day7_lean": "Leaning good",
        "won_calibrated": "Helped",
      }
    `);
  });

  it("an uncalibrated win NEVER renders the word 'Helped' anywhere on the card", () => {
    const html = renderRow(makeRecord({ verdict: "won", calibrationVersion: null, windows: [window28(28, true)] }));
    expect(html).not.toContain("Helped");
  });

  it("a card never emits an em or en dash", () => {
    registerTestCalibratedVersion();
    const html = renderRow(makeRecord({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION, windows: [window28(28, true)] }));
    expect(html).not.toMatch(/[‒–—―]/);
  });
});

describe("trust-audit honesty lines on the real card", () => {
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

  it("a stale verified_live row shows the live-contradiction line and the legacy-measurement caveat", () => {
    const html = renderRow(productionShaped);
    expect(html).toContain(
      "I confirmed this edit earlier, but my latest check of the live page could not find it. Open the page and confirm the edit is still there.",
    );
    expect(html).toContain(
      "I measured this with my earlier method, before I locked in measurement plans up front. Treat it as a directional read.",
    );
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

describe("pooled batch line - fail-closed calibration quarantine", () => {
  function pooledRow(over: Partial<PooledVerdictRow> = {}): PooledVerdictRow {
    return {
      tenant_id: "tenant-a",
      plan_id: "plan1",
      plan_date: "2026-06-30",
      action_family: "meta",
      computed_at: "2026-07-02T00:00:00.000Z",
      n: 6,
      pooled_lift_pct: 9,
      standard_error: 2,
      z_score: 4.5,
      permutation_p: 0.03,
      verdict: "helped",
      calibrationVersion: null,
      sentence: "As a group: this batch of 6 changes is up about 9 percent vs comparison pages.",
      pages: ["/a", "/b", "/c", "/d", "/e", "/f"],
      ...over,
    };
  }

  it("an uncertified win stays quarantined (renders nothing), even when the verdict says helped", async () => {
    latestPooledRow = pooledRow({ verdict: "helped", calibrationVersion: null });
    expect(await PooledVerdictSection()).toBeNull();
    latestPooledRow = pooledRow({ calibrationVersion: "made-up-pooled-v9" });
    expect(await PooledVerdictSection()).toBeNull();
  });

  it("a certified row renders the batch line normally", async () => {
    const { TEST_CALIBRATED_POOLED_VERSION, registerTestCalibratedPooledVersion } = await import(
      "@/domains/proof-gsc/verdict-calibration-test-support"
    );
    registerTestCalibratedPooledVersion();
    latestPooledRow = pooledRow({ calibrationVersion: TEST_CALIBRATED_POOLED_VERSION });
    const el = await PooledVerdictSection();
    expect(el).not.toBeNull();
    const html = renderToStaticMarkup(el as ReactElement);
    expect(html).toContain("up about 9 percent");
    expect(html).toContain("Pooled from 6 pages");
  });
});

describe("the pure badge gate that backs the card", () => {
  it("uncalibrated won/lost are quarantined; calibrated pass through; non-claims untouched", () => {
    expect(isUncalibratedDecidedRecord({ verdict: "won", calibrationVersion: null })).toBe(true);
    expect(presentationVerdictFor({ verdict: "won", calibrationVersion: null })).toBe("inconclusive");
    expect(presentationVerdictFor({ verdict: "measuring", calibrationVersion: null })).toBe("measuring");

    registerTestCalibratedVersion();
    expect(isUncalibratedDecidedRecord({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe(false);
    expect(presentationVerdictFor({ verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe("lost");
  });

  it("legacy fallback: won/lost lean before day 28 and are final at day 28", () => {
    expect(proofBadgeLabelFromVerdict("won", 7)).toBe("Leaning good");
    expect(proofBadgeLabelFromVerdict("won", 28)).toBe("Helped");
    expect(proofBadgeLabelFromVerdict("lost", 28)).toBe("Did not help");
    expect(proofBadgeLabelFromVerdict("measuring", null)).toBe("Waiting");
  });
});
