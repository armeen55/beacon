/**
 * α₂ approve-to-promote store tests (decision U4, 2026-06-13).
 * Per-tenant approval bookkeeping: approve (idempotent), unapprove,
 * tenant-scoped load. No push / no LLM.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const _stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

import {
  approveCandidate,
  loadOperatorApprovedDedupeKeys,
  unapproveCandidate,
} from "@/domains/recommendation-intelligence/operator-approved-store";

const NOW = new Date("2026-06-13T08:00:00.000Z");

beforeEach(() => _stores.clear());

describe("operator-approved-store", () => {
  it("approve then load returns the key; tenant-scoped", async () => {
    await approveCandidate({ tenantId: "t1", dedupeKey: "k1", now: NOW });
    await approveCandidate({ tenantId: "t2", dedupeKey: "k2", now: NOW });
    const t1 = await loadOperatorApprovedDedupeKeys("t1");
    expect([...t1]).toEqual(["k1"]);
    const t2 = await loadOperatorApprovedDedupeKeys("t2");
    expect([...t2]).toEqual(["k2"]);
  });

  it("approve is idempotent (no duplicate rows)", async () => {
    await approveCandidate({ tenantId: "t1", dedupeKey: "k1", now: NOW });
    await approveCandidate({ tenantId: "t1", dedupeKey: "k1", now: NOW });
    expect((await loadOperatorApprovedDedupeKeys("t1")).size).toBe(1);
  });

  it("unapprove removes the key; idempotent on a missing key", async () => {
    await approveCandidate({ tenantId: "t1", dedupeKey: "k1", now: NOW });
    await unapproveCandidate({ tenantId: "t1", dedupeKey: "k1" });
    expect((await loadOperatorApprovedDedupeKeys("t1")).size).toBe(0);
    await unapproveCandidate({ tenantId: "t1", dedupeKey: "nope" }); // no throw
  });

  it("unapprove is tenant-scoped (does not touch another tenant's key)", async () => {
    await approveCandidate({ tenantId: "t1", dedupeKey: "shared", now: NOW });
    await approveCandidate({ tenantId: "t2", dedupeKey: "shared", now: NOW });
    await unapproveCandidate({ tenantId: "t1", dedupeKey: "shared" });
    expect((await loadOperatorApprovedDedupeKeys("t1")).size).toBe(0);
    expect((await loadOperatorApprovedDedupeKeys("t2")).size).toBe(1);
  });
});
