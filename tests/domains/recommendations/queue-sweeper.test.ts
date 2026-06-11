/**
 * 2026-06-11 (night shift, #114/#49) — queue staleness sweeper.
 * Pins: ONLY auto-promoted rows sweep; TTL expiry; cap overflow expires
 * the OLDEST beyond MAX_PENDING; operator/factory/accepted rows are
 * untouchable; idempotent persist with sync-warning surfacing.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  selectQueueExpiries,
  sweepQueueForTenant,
  QUEUE_TTL_DAYS,
  MAX_PENDING_PER_TENANT,
} from "@/domains/recommendations/queue-sweeper";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const NOW = new Date("2026-06-11T05:30:00Z");

function row(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: `id-${over.rec_id ?? "x"}-${over.created_at ?? ""}`,
    tenant_id: "tenant-x",
    rec_id: over.rec_id ?? "rec-x",
    action_type: "edit_title",
    target_url: "https://x.com/p",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-10T05:30:00Z",
    updated_at: "2026-06-10T05:30:00Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as RecommendedEditRow;
}

const OLD = `2026-04-01T00:00:00Z`; // far beyond the TTL window

describe("selectQueueExpiries", () => {
  it("expires recommended auto-promoted rows older than the TTL", () => {
    const sel = selectQueueExpiries(
      [row({ created_at: OLD, rec_id: "old" }), row({ rec_id: "fresh" })],
      NOW,
    );
    expect(sel.expiries).toHaveLength(1);
    expect(sel.expiries[0]!.row.rec_id).toBe("old");
    expect(sel.expiries[0]!.reason).toBe("ttl");
    expect(sel.pendingAfter).toBe(1);
  });

  it("NEVER touches operator/factory/non-promoted rows, regardless of age", () => {
    const sel = selectQueueExpiries(
      [
        row({ created_at: OLD, source: "deterministic" as RecommendedEditRow["source"] }),
        row({ created_at: OLD, source: "openai" as RecommendedEditRow["source"], rec_id: "factory" }),
        row({ created_at: OLD, implementation_status: "accepted", rec_id: "accepted" }),
        row({ created_at: OLD, implementation_status: "pushed", rec_id: "pushed" }),
      ],
      NOW,
    );
    expect(sel.expiries).toHaveLength(0);
  });

  it("cap overflow expires the OLDEST beyond MAX_PENDING_PER_TENANT", () => {
    const rows = Array.from({ length: MAX_PENDING_PER_TENANT + 3 }, (_, i) =>
      row({
        rec_id: `r${i}`,
        created_at: `2026-06-${String((i % 9) + 1).padStart(2, "0")}T0${i % 10}:00:00Z`,
      }),
    );
    const sel = selectQueueExpiries(rows, NOW);
    const overflow = sel.expiries.filter((e) => e.reason === "overflow");
    expect(overflow).toHaveLength(3);
    // The expired ones must be the 3 OLDEST surviving rows.
    const expiredDates = overflow.map((e) => e.row.created_at).sort();
    const allDates = rows.map((r) => r.created_at).sort();
    expect(expiredDates).toEqual(allDates.slice(0, 3));
    expect(sel.pendingAfter).toBe(MAX_PENDING_PER_TENANT);
  });

  it("respects custom ttlDays", () => {
    const sel = selectQueueExpiries(
      [row({ created_at: "2026-06-09T00:00:00Z" })],
      NOW,
      { ttlDays: 1 },
    );
    expect(sel.expiries).toHaveLength(1);
  });

  it("QUEUE_TTL_DAYS default is 30 (the 'short queue' contract)", () => {
    expect(QUEUE_TTL_DAYS).toBe(30);
  });
});

describe("sweepQueueForTenant", () => {
  it("persists expired rows with status 'expired' + fresh updated_at", async () => {
    const persisted: RecommendedEditRow[][] = [];
    const synced: Array<{ rows: RecommendedEditRow[]; tenantId: string }> = [];
    const r = await sweepQueueForTenant("tenant-x", {
      loadRows: async () => [row({ created_at: OLD, rec_id: "old" }), row({ rec_id: "fresh" })],
      persistLocal: async (rows) => {
        persisted.push(rows);
      },
      syncRows: async (rows, tenantId) => {
        synced.push({ rows, tenantId });
      },
      now: NOW,
    });
    expect(r.expiredTtl).toBe(1);
    expect(r.expiredOverflow).toBe(0);
    expect(persisted[0]![0]!.implementation_status).toBe("expired");
    expect(persisted[0]![0]!.updated_at).toBe(NOW.toISOString());
    expect(synced[0]!.tenantId).toBe("tenant-x");
  });

  it("no expiries → no writes at all", async () => {
    let writes = 0;
    const r = await sweepQueueForTenant("tenant-x", {
      loadRows: async () => [row()],
      persistLocal: async () => {
        writes++;
      },
      syncRows: async () => {
        writes++;
      },
      now: NOW,
    });
    expect(r.expiredTtl + r.expiredOverflow).toBe(0);
    expect(writes).toBe(0);
  });

  it("surfaces a sync warning without throwing (local write landed)", async () => {
    const r = await sweepQueueForTenant("tenant-x", {
      loadRows: async () => [row({ created_at: OLD })],
      persistLocal: async () => {},
      syncRows: async () => {
        throw new Error("supabase down");
      },
      now: NOW,
    });
    expect(r.expiredTtl).toBe(1);
    expect(r.sync_warning).toContain("supabase down");
  });
});
