import { describe, expect, it } from "vitest";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { sortInFlightByNextRead } from "./in-flight-order";

function row(id: string, shippedAt: string, windows: Array<{ day: 7 | 14 | 28; ran: boolean }>) {
  return { id, shippedAt, windows } as ShippedChangeRecord;
}

describe("sortInFlightByNextRead", () => {
  it("puts the nearest unread checkpoint first without mutating the ledger", () => {
    const input = [
      row("later", "2026-07-10T00:00:00.000Z", [{ day: 14, ran: false }]),
      row("soon", "2026-07-15T00:00:00.000Z", [{ day: 7, ran: false }]),
      row("finished", "2026-06-01T00:00:00.000Z", [{ day: 28, ran: true }]),
    ];
    expect(sortInFlightByNextRead(input).map((item) => item.id)).toEqual(["soon", "later", "finished"]);
    expect(input.map((item) => item.id)).toEqual(["later", "soon", "finished"]);
  });
});
