/**
 * Server-only data layer.
 * Imports seed data + merges persisted imported entities from `.data/`.
 *
 * Only Server Components and Server Actions should import this module.
 * Client Components receive data as props from server parents.
 */

import "server-only";

import {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitors,
  competitorSnapshots,
  coverageItems,
  weeklySummaries,
} from "./seed-data";

import { readStore } from "./persistence/json-store";

function mergeImported<T extends { id: string }>(
  target: T[],
  storeName: string
) {
  const stored = readStore<T>(storeName);
  const existing = new Set(target.map((e) => e.id));
  for (const item of stored) {
    if (!existing.has(item.id)) {
      target.push(item);
    }
  }
}

mergeImported(results, "imported-results");
mergeImported(changelogEntries, "imported-changes");
mergeImported(opportunities, "imported-opportunities");
mergeImported(competitors, "imported-competitors");

export {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitors,
  competitorSnapshots,
  coverageItems,
  weeklySummaries,
};
