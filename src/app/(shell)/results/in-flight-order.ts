import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const DAY_MS = 86_400_000;

/** Put the changes that will produce useful information soonest first. The full
 * ledger remains available; this only controls the default reading order. */
export function sortInFlightByNextRead(rows: readonly ShippedChangeRecord[]): ShippedChangeRecord[] {
  const nextDue = (row: ShippedChangeRecord) => {
    const next = (row.windows ?? []).filter((window) => !window.ran).sort((a, b) => a.day - b.day)[0];
    if (!next) return Number.POSITIVE_INFINITY;
    const shippedAt = Date.parse(row.shippedAt);
    return Number.isFinite(shippedAt) ? shippedAt + next.day * DAY_MS : Number.POSITIVE_INFINITY;
  };
  return [...rows].sort((a, b) => nextDue(a) - nextDue(b));
}
