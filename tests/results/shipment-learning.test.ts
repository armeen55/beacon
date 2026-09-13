import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ ledger: new Map<string, unknown[]>(), memory: [] as unknown[], load: vi.fn(), write: vi.fn(), fail: false }));
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({ loadShippedChangesForTenant: async (t: string) => { io.load(t); return io.ledger.get(t) ?? []; } }));
vi.mock("@/lib/persistence/json-store", () => ({ readStore: async () => { if (io.fail) throw Error("Unreadable memory"); return io.memory; }, writeStore: async (_s: string, rows: unknown[]) => { io.write(); io.memory = rows; } }));
import { SHIPMENT_PROOF } from "@/domains/measurement/proof-gsc/shipment-proof";
import { learningVerdictOf, readLedger, readRecordsForLearning } from "@/domains/measurement/proof-gsc/kernel";
import { treatmentLearning } from "@/domains/measurement/treatment-learning";
import { buildResultsBrain } from "@/app/(shell)/results/results-brain";
import { harvestWinners, buildWinnerFewShots } from "@/domains/decision/llm/winner-memory";
import { shipmentsAwaitingVerification, verifyDueShipments, verifyShipment } from "@/domains/measurement/verify-shipment";
import type { ShippedChangeRecord, ShipmentVerification } from "@/domains/measurement/proof-gsc/shipped-change-store";

const T = "tenant-learning", AT = "2026-05-01T12:00:00Z", NOW = Date.parse("2026-07-15T12:00:00Z");
const COPY = "The operator's complete published section explains the subject, its scope and its distinguishing features in original words, with the supported qualifications needed to understand it.";
const HTML = `<html><head><title>Example guide</title></head><body><main><h1>Example guide</h1><p>${COPY}</p></main></body></html>`;
const deps = { now: () => NOW, loadProfile: async () => null, writeOwnedPage: async () => {}, fetchPage: async () => ({ ok: true as const, html: HTML, status: 200 }), readSerp: async () => null };
async function delivered(over: Partial<ShippedChangeRecord> = {}): Promise<ShippedChangeRecord> {
  const r = { id: "first", page: "https://example.test/guide", path: "/guide", actionType: "section_add", before: null, after: "The proposal included unapplied NUMBER and YEAR blanks.", shippedAt: AT, implementedAt: AT,
    baseline: { impressions: 5000, clicks: 400, ctr: 0.08, position: 8, windowDays: 28 }, controlsReceipt: [{ path: "/a" }, { path: "/b" }, { path: "/c" }],
    windows: [{ day: 28, ran: true, adjustedLift: 160, controlsUsed: 3, treatedPostImpressions: 5000 }], measurementState: "measuring", operatorVerdictOverride: null, pinnedRead: null,
    componentsApplied: [{ id: "section", kind: "section_add", label: "Section", after: "The prepared wording.", appliedAfter: COPY }], verification: null, ...over } as ShippedChangeRecord;
  r.verification = await verifyShipment(T, { id: r.id, url: r.page, implementedAt: r.implementedAt, claim: r, components: SHIPMENT_PROOF.components(r) }, deps);
  return r;
}
const lesson = (r: ShippedChangeRecord) => learningVerdictOf(readRecordsForLearning([r])[0]!);
beforeEach(() => { io.ledger.clear(); io.memory = []; io.fail = false; io.load.mockClear(); io.write.mockClear(); });
describe("only the evidenced applied unit may teach", () => {
  it("a fully verified applied subset teaches once and the writer receives the operator's actual copy", async () => {
    const r = await delivered(); expect([r.verification?.status, lesson(r), treatmentLearning([r])[0]!.sampleSize]).toEqual(["verified", "won", 1]);
    expect(r.verification?.proof?.inspectedHash).toMatch(/^[a-f0-9]{64}$/); io.ledger.set(T, [r]);
    expect(await harvestWinners(T)).toEqual({ harvested: 1, families: 1 });
    expect(await harvestWinners(T)).toEqual({ harvested: 0, families: 1 });
    expect(io.write).toHaveBeenCalledTimes(1);
    const prompt = await buildWinnerFewShots(T, "content"); expect(prompt).toContain(COPY); expect(prompt).not.toContain(r.after!); expect(io.load.mock.calls.every(([t]) => t === T)).toBe(true);
  });
  it("blocked, partial, old, mismatched and pre-implementation receipts preserve observations but teach nothing", async () => {
    const r = await delivered(), v = r.verification!;
    const bad = [ { ...v, status: "blocked" }, { ...v, status: "partially_verified", components: [...v.components, { kind: "title", state: "not_verified", note: null }] },
      { ...v, checkerContract: undefined }, { ...v, checkedAt: "2026-04-01T00:00:00Z" }, { ...v, components: [] } ] as ShipmentVerification[];
    const rows = [...bad.map((verification) => ({ ...r, verification })), { ...r, componentsApplied: [{ ...r.componentsApplied![0]!, appliedAfter: "Unverified changed copy" }] }];
    for (const row of rows) { const read = readLedger([row], new Date(NOW), "2026-07-15")[0]!; expect([lesson(row), treatmentLearning([row])[0]!.sampleSize]).toEqual(["measuring", 0]); expect(read.lift).toBe(160);
      expect(buildResultsBrain([{ read, implementedAt: row.implementedAt, verification: row.verification, baseline: null, learning: row }], new Date(NOW)).thoughts[0]!.verifiedSample).toBe(0); }
  });
  it("comparison provenance and pins cannot manufacture permission; valid measured zeros remain samples", async () => {
    const r = await delivered(); expect(lesson({ ...r, controlsReceipt: null })).toBe("measuring");
    const pin = { verdict: "directional_improvement", metric: "clicks", lift: 1600, impressionsLift: 0, basisDay: 28, confidence: "high", controlsUsed: 4, pinnedAt: AT, finalizedThrough: "2026-06-01" } as const;
    expect(lesson({ ...r, pinnedRead: pin })).toBe("measuring"); expect(lesson({ ...r, verification: { ...r.verification!, status: "blocked" }, pinnedRead: pin })).toBe("measuring");
    const zero = { ...r, windows: r.windows.map((w) => ({ ...w, adjustedLift: 0 })) }; expect([treatmentLearning([zero])[0]!.sampleSize, treatmentLearning([zero])[0]!.netEffect]).toEqual([1, 0]);
  });
  it("cached wins are requalified against the whole ledger, including later overlapping shipments", async () => {
    const r = await delivered(); io.ledger.set(T, [r]); await harvestWinners(T); expect(await buildWinnerFewShots(T, "content")).toContain(COPY);
    const later = await delivered({ id: "later", implementedAt: "2026-05-10T12:00:00Z", shippedAt: "2026-05-10T12:00:00Z" }); io.ledger.set(T, [r, later]);
    expect(await buildWinnerFewShots(T, "content")).toBe(""); expect(await harvestWinners(T)).toEqual({ harvested: 0, families: 0 }); expect(treatmentLearning([r, later])[0]!.sampleSize).toBe(0);
    const clean = { ...r, windows: [{ ...r.windows[0]!, day: 14 as const }] }, afterClean = await delivered({ id: "after-clean", implementedAt: "2026-05-20T12:00:00Z" });
    expect(treatmentLearning([clean, afterClean])[0]!.sampleSize).toBe(1);
  });
  it("old cached examples and another tenant never teach; an unreadable cache is not overwritten", async () => {
    const r = await delivered(); io.ledger.set(T, [r]); await harvestWinners(T); const banked = io.memory;
    expect(await buildWinnerFewShots("other-tenant", "content")).toBe(""); io.memory = banked.map((w) => ({ ...(w as object), shipmentId: undefined })); expect(await buildWinnerFewShots(T, "content")).toBe("");
    io.memory = banked; io.fail = true; io.write.mockClear(); expect(await buildWinnerFewShots(T, "content")).toBe(""); await harvestWinners(T); expect(io.write).not.toHaveBeenCalled(); expect(io.memory).toBe(banked);
  });
  it("historical delivery requalification uses the existing read bound, banks the new receipt and buys no SERP", async () => {
    const r = await delivered(), old = { ...r, verification: { ...r.verification!, checkerContract: undefined, proof: null, checks: 1 } };
    const rows: ShippedChangeRecord[] = [old], readSerp = vi.fn(async () => []), loadShipments = async () => rows;
    const record = async (_t: string, _id: string, verification: ShipmentVerification) => { rows[0] = { ...r, verification }; return true; };
    expect(await verifyDueShipments(T, { ...deps, loadShipments, record, readSerp })).toBe(1); expect(readSerp).not.toHaveBeenCalled(); expect(lesson(rows[0]!)).toBe("won");
    expect(await shipmentsAwaitingVerification(T, 15, { ...deps, loadShipments })).toEqual([]);
    rows[0] = { ...old, verification: { ...old.verification, checks: 3 } }; expect(await shipmentsAwaitingVerification(T, 15, { ...deps, loadShipments })).toEqual([]);
  });
});
