/**
 * Section 5 durable denominator (2026-05-16) — Supabase-backend
 * `observation_runs` → `ProfoundImportRun` mapper unit tests.
 *
 * Pins the row-translation contract that lets the existing
 * `observation_runs` table (which has been collecting native-poll
 * run records since 2026-04-22 via `syncObservationRuns()`) serve
 * as Section 5's durable denominator without a new table or
 * migration.
 *
 * Locked rules:
 *   • Source → platform: "perplexity-native-poll" → "perplexity",
 *     "openai-native-poll" → "chatgpt", anything else → source
 *     verbatim (forward-compat for future native platforms).
 *   • Status: completed → completed; failed → failed;
 *     partial → failed; anything else → failed (defensive).
 *   • source_type is always "beacon_native" (every
 *     citation_sample_import row is native by construction).
 *   • completed_at is truncated to YYYY-MM-DD (UTC).
 *   • metadata carries `{ source }` for forward-compat.
 *   • Defensive null-skip on missing string fields (run_id,
 *     tenant_id, source, completed_at).
 *   • Multi-row mapping preserves order after filtering invalid rows.
 */

import { describe, it, expect } from "vitest";

import { mapObservationRunRowToProfoundImportRun } from "@/lib/persistence/repositories/supabase-backend";

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: "run-1",
    run_type: "citation_sample_import",
    source: "perplexity-native-poll",
    status: "completed",
    started_at: "2026-05-15T07:00:00.000Z",
    completed_at: "2026-05-15T07:10:00.000Z",
    tenant_id: "tenant-ritz-founder",
    ...over,
  };
}

describe("mapObservationRunRowToProfoundImportRun — source → platform", () => {
  it("perplexity-native-poll → platform perplexity", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ source: "perplexity-native-poll" }) as never,
    );
    expect(out).not.toBeNull();
    expect(out!.platform).toBe("perplexity");
  });

  it("openai-native-poll → platform chatgpt", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ source: "openai-native-poll" }) as never,
    );
    expect(out).not.toBeNull();
    expect(out!.platform).toBe("chatgpt");
  });

  it("unknown source passes through verbatim as platform (forward-compat)", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ source: "futuremodel-native-poll" }) as never,
    );
    expect(out).not.toBeNull();
    expect(out!.platform).toBe("futuremodel-native-poll");
  });
});

describe("mapObservationRunRowToProfoundImportRun — completed_at truncation", () => {
  it("truncates ISO timestamp to YYYY-MM-DD as run_date", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ completed_at: "2026-04-30T23:45:00.123Z" }) as never,
    );
    expect(out).not.toBeNull();
    expect(out!.run_date).toBe("2026-04-30");
  });

  it("preserves UTC date irrespective of zone-suffix", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ completed_at: "2026-05-15T07:10:00.000Z" }) as never,
    );
    expect(out!.run_date).toBe("2026-05-15");
  });
});

describe("mapObservationRunRowToProfoundImportRun — status mapping", () => {
  it("completed → completed", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ status: "completed" }) as never,
    );
    expect(out!.status).toBe("completed");
  });

  it("failed → failed", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ status: "failed" }) as never,
    );
    expect(out!.status).toBe("failed");
  });

  it("partial → failed (Section 5 only counts completed)", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ status: "partial" }) as never,
    );
    expect(out!.status).toBe("failed");
  });

  it("unknown status → failed (defensive)", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ status: "pending" }) as never,
    );
    expect(out!.status).toBe("failed");
  });

  it("null status → failed (defensive)", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ status: null }) as never,
    );
    expect(out!.status).toBe("failed");
  });
});

describe("mapObservationRunRowToProfoundImportRun — source_type and metadata", () => {
  it("source_type is always 'beacon_native'", () => {
    const out = mapObservationRunRowToProfoundImportRun(row() as never);
    expect(out!.source_type).toBe("beacon_native");
  });

  it("metadata includes the source literal", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ source: "perplexity-native-poll" }) as never,
    );
    expect(out!.metadata).toEqual({ source: "perplexity-native-poll" });
  });

  it("preserved fields: id, account_id, created_at", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({
        run_id: "ritz-run-42",
        tenant_id: "tenant-ritz-founder",
        started_at: "2026-05-15T07:00:00.000Z",
      }) as never,
    );
    expect(out!.id).toBe("ritz-run-42");
    expect(out!.account_id).toBe("tenant-ritz-founder");
    expect(out!.created_at).toBe("2026-05-15T07:00:00.000Z");
    expect(out!.import_run_id).toBeNull();
    expect(out!.model).toBeNull();
    expect(out!.geo).toBeNull();
    expect(out!.locale).toBeNull();
    expect(out!.prompt_count).toBe(0);
  });

  it("non-string started_at falls back to completed_at", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({
        started_at: null,
        completed_at: "2026-05-15T07:10:00.000Z",
      }) as never,
    );
    expect(out!.created_at).toBe("2026-05-15T07:10:00.000Z");
  });
});

describe("mapObservationRunRowToProfoundImportRun — defensive null skipping", () => {
  it("returns null when run_id is missing", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ run_id: null }) as never,
    );
    expect(out).toBeNull();
  });

  it("returns null when tenant_id is missing", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ tenant_id: null }) as never,
    );
    expect(out).toBeNull();
  });

  it("returns null when source is missing", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ source: null }) as never,
    );
    expect(out).toBeNull();
  });

  it("returns null when completed_at is missing", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ completed_at: null }) as never,
    );
    expect(out).toBeNull();
  });

  it("returns null when run_id is a non-string", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ run_id: 42 }) as never,
    );
    expect(out).toBeNull();
  });

  it("returns null when source is a non-string", () => {
    const out = mapObservationRunRowToProfoundImportRun(
      row({ source: ["array"] }) as never,
    );
    expect(out).toBeNull();
  });
});

describe("mapObservationRunRowToProfoundImportRun — multi-row scenarios", () => {
  it("filters nulls but preserves order across mixed valid/invalid rows", () => {
    const rows = [
      row({ run_id: "r-1", source: "perplexity-native-poll" }),
      row({ run_id: null }), // invalid
      row({ run_id: "r-2", source: "openai-native-poll" }),
      row({ completed_at: null }), // invalid
      row({ run_id: "r-3", source: "future-platform-native-poll" }),
    ];
    const mapped = rows
      .map((r) => mapObservationRunRowToProfoundImportRun(r as never))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    expect(mapped.map((m) => m.id)).toEqual(["r-1", "r-2", "r-3"]);
    expect(mapped.map((m) => m.platform)).toEqual([
      "perplexity",
      "chatgpt",
      "future-platform-native-poll",
    ]);
  });
});
