import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeStore } from "@/lib/persistence/json-store";
import {
  readExitGates,
  writeExitGates,
  getExitGate,
  updateExitGate,
  normalizeExitGates,
  EXIT_GATE_DEFAULT_UPDATED_AT,
  _resetExitGatesStoreForTests,
} from "@/lib/exit-gates-store";

describe("exit-gates-store", () => {
  beforeEach(async () => {
    await _resetExitGatesStoreForTests();
  });

  afterEach(async () => {
    await _resetExitGatesStoreForTests();
  });

  it("readExitGates returns all gates with not_started when store empty", () => {
    const gates = readExitGates();
    expect(gates).toHaveLength(3);
    expect(gates.map((g) => g.key)).toEqual(["daily_ritual", "replication", "local_layer"]);
    expect(gates.every((g) => g.status === "not_started")).toBe(true);
    expect(gates.every((g) => g.note === "")).toBe(true);
    expect(gates.every((g) => g.updated_at === EXIT_GATE_DEFAULT_UPDATED_AT)).toBe(true);
  });

  it("normalizeExitGates ignores unknown keys and coerces invalid status", () => {
    const n = normalizeExitGates([
      { key: "daily_ritual", status: "passed", note: "ok", updated_at: "2026-04-01T12:00:00.000Z" },
      { key: "bogus", status: "passed", note: "", updated_at: "2026-04-01T12:00:00.000Z" },
      { key: "replication", status: "nope", note: "", updated_at: "2026-04-01T12:00:00.000Z" },
      { key: "local_layer", status: "in_review", note: "x", updated_at: "2026-04-01T13:00:00.000Z" },
    ]);
    expect(n[0]!.status).toBe("passed");
    expect(n[0]!.note).toBe("ok");
    expect(n[1]!.status).toBe("not_started");
    expect(n[2]!.status).toBe("in_review");
    expect(n[2]!.note).toBe("x");
  });

  it("writeExitGates then readExitGates roundtrips", async () => {
    await writeExitGates([
      {
        key: "daily_ritual",
        status: "in_review",
        note: "checking",
        updated_at: "2026-04-10T08:00:00.000Z",
      },
      {
        key: "replication",
        status: "failed",
        note: "",
        updated_at: "2026-04-10T09:00:00.000Z",
      },
      {
        key: "local_layer",
        status: "passed",
        note: "ok",
        updated_at: "2026-04-10T10:00:00.000Z",
      },
    ]);
    const again = readExitGates();
    expect(again[0]!.status).toBe("in_review");
    expect(again[0]!.note).toBe("checking");
    expect(again[1]!.status).toBe("failed");
    expect(again[2]!.status).toBe("passed");
    expect(again[2]!.note).toBe("ok");
  });

  it("getExitGate returns normalized row for key", async () => {
    await writeStore("exit-gates", [
      {
        key: "replication",
        status: "passed",
        note: "x",
        updated_at: "2026-04-11T00:00:00.000Z",
      },
    ]);
    const g = getExitGate("replication");
    expect(g.status).toBe("passed");
    expect(g.note).toBe("x");
    expect(getExitGate("daily_ritual").status).toBe("not_started");
    expect(getExitGate("local_layer").status).toBe("not_started");
  });

  it("updateExitGate advances updated_at on status change", async () => {
    const first = await updateExitGate("daily_ritual", { status: "in_review" });
    expect(first.status).toBe("in_review");
    expect(first.updated_at).not.toBe(EXIT_GATE_DEFAULT_UPDATED_AT);
    const second = await updateExitGate("daily_ritual", { status: "in_review" });
    expect(second.updated_at).toBe(first.updated_at);
  });

  it("updateExitGate advances updated_at when note changes", async () => {
    const a = await updateExitGate("replication", { note: "a" });
    const b = await updateExitGate("replication", { note: "b" });
    expect(b.note).toBe("b");
    expect(new Date(b.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(a.updated_at).getTime());
  });

  it("updateExitGate persists note and status together", async () => {
    await updateExitGate("daily_ritual", { status: "failed", note: "gap in ritual" });
    const disk = readExitGates().find((g) => g.key === "daily_ritual")!;
    expect(disk.status).toBe("failed");
    expect(disk.note).toBe("gap in ritual");
  });

  it("updateExitGate supports local_layer status transitions and note", async () => {
    const a = await updateExitGate("local_layer", { status: "in_review" });
    expect(a.status).toBe("in_review");
    const b = await updateExitGate("local_layer", { status: "passed", note: "methodology aligned" });
    expect(b.status).toBe("passed");
    expect(b.note).toBe("methodology aligned");
    const disk = readExitGates().find((g) => g.key === "local_layer")!;
    expect(disk.status).toBe("passed");
    expect(disk.note).toBe("methodology aligned");
  });
});
