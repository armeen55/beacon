import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import { normalizeUrl } from "@/lib/url/normalize";
import type { ShippedChangeRecord } from "./shipped-change-store";

/**
 * Link a raw changelog row to the canonical proof ledger. The proof ledger is
 * keyed by page and ship date, so simultaneous edits intentionally resolve to
 * the same page-level (and, where applicable, compound-package) result.
 */
export function findProofForChange(
  change: Pick<ChangelogEntry, "id" | "url" | "timestamp">,
  ledger: readonly ShippedChangeRecord[],
): ShippedChangeRecord | null {
  const direct = ledger.find((record) => record.id === change.id);
  if (direct) return direct;

  const path = normalizeUrl(change.url);
  const shipDate = dateOnly(change.timestamp);
  if (!path || !shipDate) return null;

  return ledger.find(
    (record) =>
      normalizeUrl(record.path || record.page) === path &&
      dateOnly(record.shippedAt) === shipDate,
  ) ?? null;
}

export function proofResultHref(record: Pick<ShippedChangeRecord, "id">): string {
  return `/results#proof-${encodeURIComponent(record.id)}`;
}

function dateOnly(value: string): string | null {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
  return match?.[0] ?? null;
}
