/**
 * Narrow tests for `buildTodayLiveChanges` — the /today live-changes
 * data builder. Audit Correction #1 follow-up (2026-05-08).
 *
 * Test contract:
 *   1. Lifecycle block renders when a verified_live/live_at change exists
 *      → the helper returns at least one TodayLiveChange.
 *   2. No fake "proven/winning/confirmed" copy appears in any state line.
 *   3. Empty state is calm when no lifecycle example exists
 *      → helper returns []; UI renders null.
 *   4. Dismissed / accepted / recommended rec_edits are filtered out.
 *   5. Pre-verdict pre-3-days vs pre-verdict ≥3-days vs verdict-emitted
 *      pick distinct dynamic-state copy.
 *   6. Recent-most live_at sorts first; maxRows cap respected.
 */

import { describe, expect, it } from "vitest";

import {
  buildTodayLiveChanges,
  type BuildLiveChangesArgs,
} from "./live-changes-data";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";

const NOW = new Date("2026-05-08T12:00:00Z");

function buildEdit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-ritz-founder",
    rec_id: "rec-whole-home-h2",
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    target_element_key: "h2[new]:abc",
    display_label: "H2: Architect-led design-build advantage",
    current_text: null,
    proposed_text: "...",
    why: null,
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "openai",
    provider_name: "openai",
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-04-27T09:28:53.927Z",
    updated_at: "2026-04-28T05:45:40.758Z",
    implementation_status: "verified_live",
    live_at: "2026-04-28T05:26:26.05+00:00",
    live_snapshot_id: "snap-1",
    live_match_confidence: "high",
    live_match_kind: "exact",
    live_element_key: "h2[6]:070a58",
    not_found_reason: null,
    ...over,
  } as RecommendedEditRow;
}

function buildChangelog(
  over: Partial<ChangelogEntry> = {},
): ChangelogEntry {
  return {
    id: "cl-1",
    tenant_id: "tenant-ritz-founder",
    timestamp: "2026-04-27T09:28:53.927Z",
    signal_type: "content",
    asset_type: "hub_page",
    url: "https://ritzbuilders.com/services/whole-home-remodel",
    asset_name: "WHR strengthening",
    change_description: "H2 added",
    topic_targeted: "Whole Home Renovation Builders (Bay Area)",
    city_targeted: null,
    hypothesis: null,
    hypothesis_source: "recommendation",
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-27T09:28:53.927Z",
    source_rec_id: "rec-whole-home-h2",
    action_type: "add_h2_section",
    target_element_key: "h2[new]:abc",
    live_at: "2026-04-28T05:26:26.05+00:00",
    ...over,
  } as ChangelogEntry;
}

function buildOutcome(over: Partial<UrlChangeOutcome> = {}): UrlChangeOutcome {
  return {
    change_id: "cl-1",
    url: "/services/whole-home-remodel",
    edit_type_tokens: [],
    asset_type: "service_page",
    verdict: "weak_signal",
    landing_day_n: 7,
    landing_z: 1.5,
    delta_pct: 0.2,
    delta_abs: 0.3,
    baseline_days_used: 14,
    post_days_used: 9,
    sustain_up: 5,
    sustain_down: 1,
    confidence: "medium",
    recorded_at: "2026-05-05T07:00:00Z",
    updated_at: "2026-05-08T07:00:00Z",
    transitions: 1,
    tenant_id: "tenant-ritz-founder",
    ...over,
  } as UrlChangeOutcome;
}

function buildArgs(over: Partial<BuildLiveChangesArgs> = {}): BuildLiveChangesArgs {
  return {
    recommendedEdits: [buildEdit()],
    changelogEntries: [buildChangelog()],
    urlChangeOutcomes: [],
    now: NOW,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test 1 — block renders when verified_live + live_at exist
// ─────────────────────────────────────────────────────────────────────────
describe("buildTodayLiveChanges — verified_live row surfaces", () => {
  it("returns one live change for a single verified_live edit", () => {
    const out = buildTodayLiveChanges(buildArgs());
    expect(out).toHaveLength(1);
    expect(out[0].displayLabel).toBe(
      "H2: Architect-led design-build advantage",
    );
    expect(out[0].liveAt).toBe("2026-04-28T05:26:26.05+00:00");
    expect(out[0].daysSinceLive).toBe(10);
  });

  it("includes verified_live_modified rows too", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        recommendedEdits: [
          buildEdit({ implementation_status: "verified_live_modified" }),
        ],
      }),
    );
    expect(out).toHaveLength(1);
  });

  it("joins the changelog row when keys match (rec_id + action_type + element_key)", () => {
    const out = buildTodayLiveChanges(buildArgs());
    expect(out[0].changelogId).toBe("cl-1");
    expect(out[0].topicTargeted).toBe(
      "Whole Home Renovation Builders (Bay Area)",
    );
  });

  it("does NOT join a changelog row whose source_rec_id differs", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        changelogEntries: [
          buildChangelog({ source_rec_id: "different-rec" }),
        ],
      }),
    );
    expect(out[0].changelogId).toBeNull();
    expect(out[0].topicTargeted).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 2 — empty state is calm when no lifecycle example exists
// ─────────────────────────────────────────────────────────────────────────
describe("buildTodayLiveChanges — empty state", () => {
  it("returns [] when no verified_live edits exist", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        recommendedEdits: [
          buildEdit({
            implementation_status: "accepted",
            live_at: null,
          }),
          buildEdit({
            id: "edit-2",
            implementation_status: "dismissed",
            live_at: null,
          }),
          buildEdit({
            id: "edit-3",
            implementation_status: "recommended",
            live_at: null,
          }),
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("returns [] when verified_live edit has null live_at (defensive)", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        recommendedEdits: [
          buildEdit({
            implementation_status: "verified_live",
            live_at: null,
          }),
        ],
      }),
    );
    expect(out).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 3 — dynamic state copy by verdict
// ─────────────────────────────────────────────────────────────────────────
describe("buildTodayLiveChanges — dynamic state copy", () => {
  it("uses 'too recent' copy when daysSinceLive < 3 and no outcome row", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        recommendedEdits: [
          buildEdit({ live_at: "2026-05-07T05:26:26.05+00:00" }),
        ],
      }),
    );
    expect(out[0].daysSinceLive).toBe(1);
    expect(out[0].stateLine).toContain("too recent");
    // on-demand copy (crons-off): the next step is to run a reading, not wait
    expect(out[0].nextEvidenceLine).toContain("Run a reading");
  });

  it("uses 'not enough post-change readings' copy when ≥3 days but no outcome", () => {
    const out = buildTodayLiveChanges(buildArgs());
    expect(out[0].daysSinceLive).toBe(10);
    expect(out[0].stateLine).toContain("Live change detected");
    expect(out[0].stateLine).toContain("not enough post-change readings");
    expect(out[0].nextEvidenceLine).toContain("Run a reading");
  });

  it("uses helping copy when an outcome row says helping", () => {
    const out = buildTodayLiveChanges(
      buildArgs({ urlChangeOutcomes: [buildOutcome({ verdict: "helping" })] }),
    );
    expect(out[0].currentVerdict).toBe("helping");
    expect(out[0].stateLine).toContain("Sustained lift detected");
  });

  it("uses weak_signal copy when an outcome row says weak_signal", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        urlChangeOutcomes: [buildOutcome({ verdict: "weak_signal" })],
      }),
    );
    expect(out[0].currentVerdict).toBe("weak_signal");
    expect(out[0].stateLine).toContain("Early signs of lift");
    expect(out[0].nextEvidenceLine).toContain("readings accumulate");
  });

  it("uses hurting copy when an outcome row says hurting", () => {
    const out = buildTodayLiveChanges(
      buildArgs({ urlChangeOutcomes: [buildOutcome({ verdict: "hurting" })] }),
    );
    expect(out[0].stateLine).toContain("Sustained decline detected");
  });

  it("uses nothing_yet copy when an outcome row says nothing_yet", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        urlChangeOutcomes: [buildOutcome({ verdict: "nothing_yet" })],
      }),
    );
    expect(out[0].stateLine).toContain("No movement detected");
  });

  it("uses not_implemented copy when an outcome row says not_implemented", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        urlChangeOutcomes: [buildOutcome({ verdict: "not_implemented" })],
      }),
    );
    expect(out[0].stateLine).toContain("never detected this change live");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 4 — honesty contract: no fake proven/winning/confirmed copy
// ─────────────────────────────────────────────────────────────────────────
describe("buildTodayLiveChanges — honesty contract", () => {
  function harvestAllStateAndNextLines(): string[] {
    const verdicts: Array<UrlChangeOutcome["verdict"] | null> = [
      null,
      "helping",
      "hurting",
      "weak_signal",
      "nothing_yet",
      "not_implemented",
    ];
    const lines: string[] = [];
    for (const v of verdicts) {
      const out = buildTodayLiveChanges(
        buildArgs({
          urlChangeOutcomes: v ? [buildOutcome({ verdict: v })] : [],
        }),
      );
      for (const r of out) {
        lines.push(r.stateLine);
        lines.push(r.nextEvidenceLine);
      }
    }
    // Plus a recent-row run.
    const recent = buildTodayLiveChanges(
      buildArgs({
        recommendedEdits: [
          buildEdit({ live_at: "2026-05-07T05:26:26.05+00:00" }),
        ],
      }),
    );
    for (const r of recent) {
      lines.push(r.stateLine);
      lines.push(r.nextEvidenceLine);
    }
    return lines;
  }

  it("never claims the change is validated/proven/confirmed/winning/won", () => {
    const lines = harvestAllStateAndNextLines();
    for (const line of lines) {
      const lower = line.toLowerCase();
      expect(lower, `bad line: "${line}"`).not.toContain("validated");
      expect(lower, `bad line: "${line}"`).not.toContain("proven");
      expect(lower, `bad line: "${line}"`).not.toContain("confirmed");
      // Word-boundary checks (avoid false positives inside "winding"
      // or "showing"). The contract is: no claim of victory.
      expect(lower, `bad line: "${line}"`).not.toMatch(/\bwin\b/);
      expect(lower, `bad line: "${line}"`).not.toMatch(/\bwon\b/);
      expect(lower, `bad line: "${line}"`).not.toMatch(/\bwinning\b/);
      expect(lower, `bad line: "${line}"`).not.toMatch(/\bguaranteed\b/);
    }
  });

  it("never frames state as a static 'verdict expected on date X' countdown", () => {
    const lines = harvestAllStateAndNextLines();
    for (const line of lines) {
      const lower = line.toLowerCase();
      expect(lower, `bad line: "${line}"`).not.toContain("verdict expected");
      expect(lower, `bad line: "${line}"`).not.toContain("wait until");
      // No raw ISO dates in copy (defensive: trend should be relative
      // language not "by 2026-05-18").
      expect(line, `bad line: "${line}"`).not.toMatch(
        /\d{4}-\d{2}-\d{2}/,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 5 — sort + cap
// ─────────────────────────────────────────────────────────────────────────
describe("buildTodayLiveChanges — sort + cap", () => {
  it("sorts most-recent live_at first", () => {
    const out = buildTodayLiveChanges(
      buildArgs({
        recommendedEdits: [
          buildEdit({
            id: "older",
            target_element_key: "h2[new]:older",
            live_at: "2026-04-15T12:00:00Z",
          }),
          buildEdit({
            id: "newer",
            target_element_key: "h2[new]:newer",
            live_at: "2026-05-01T12:00:00Z",
          }),
        ],
        // No matching changelog rows; fine, both still surface.
        changelogEntries: [],
      }),
    );
    expect(out.map((r) => r.recEditId)).toEqual(["newer", "older"]);
  });

  it("respects maxRows cap (default 3, override accepted)", () => {
    const edits: RecommendedEditRow[] = [];
    for (let i = 0; i < 5; i++) {
      edits.push(
        buildEdit({
          id: `edit-${i}`,
          target_element_key: `h2[new]:${i}`,
          live_at: `2026-05-0${i + 1}T12:00:00Z`,
        }),
      );
    }
    expect(buildTodayLiveChanges(buildArgs({ recommendedEdits: edits }))).toHaveLength(3);
    expect(
      buildTodayLiveChanges(buildArgs({ recommendedEdits: edits, maxRows: 1 })),
    ).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Test 6 — purity / determinism
// ─────────────────────────────────────────────────────────────────────────
describe("buildTodayLiveChanges — purity", () => {
  it("returns identical output for identical input", () => {
    const a = buildTodayLiveChanges(buildArgs());
    const b = buildTodayLiveChanges(buildArgs());
    expect(a).toEqual(b);
  });
});
