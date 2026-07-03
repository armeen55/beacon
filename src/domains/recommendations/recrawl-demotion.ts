/**
 * N13 recrawl demotion (2026-07-03): retire a recommendation whose precondition
 * a fresh crawl shows is already met.
 *
 * The nightly autopilot refills the queue, but a rec created last week may have
 * been fixed since: the title now reads the way Beacon suggested, the schema is
 * now on the page, the H2 the rec wanted already exists. Left alone, that rec
 * lingers as a confident move the operator can't act on ("I already did this").
 * This pure core compares a rec's precondition against the LATEST page snapshot
 * and, when the precondition is satisfied, retires the rec with an honest note:
 *
 *   "You already fixed this. I retired it. Your title now reads
 *    'Persian Koobideh Kabob Recipe'."
 *
 * DELIBERATELY CONSERVATIVE:
 *   . Only rows still awaiting action (`recommended`) are candidates; an
 *     accepted / pushed / verified row keeps its lifecycle.
 *   . Only the deterministic, high-signal preconditions are checked (title /
 *     meta / h1 copy, schema presence, a named H2 section). Everything else is
 *     left untouched: a demotion we can't PROVE from the snapshot is not made.
 *   . A retired rec reuses the existing terminal `expired` status (machine
 *     hygiene, 30-day cooldown), so if the page later regresses the same trigger
 *     re-promotes the move. No new lifecycle status, no migration.
 *
 * BYTE-IDENTICAL WHEN THE PRECONDITION STILL HOLDS: `selectRecrawlDemotions`
 * returns [] when no row's precondition is satisfied, so a queue with nothing to
 * retire flows through unchanged.
 *
 * Mirrors `queue-sweeper.ts` exactly: a pure `select*` core (tested in
 * isolation) plus a thin `*ForTenant` runner that persists + dual-writes.
 * PURE selection / deterministic / no I/O.
 */

import type { RecommendedEditRow } from "./recommended-edits-persistence";
import type { PageSnapshot } from "@/domains/pages/types";

/** Only rows still awaiting action are the machine's to retire. */
function isPending(row: RecommendedEditRow): boolean {
  return (row.implementation_status ?? "recommended") === "recommended";
}

/** Normalize a URL or path down to its pathname (host-agnostic, no query/hash). */
export function snapshotPathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

/** Case/space-insensitive containment of `needle` within `haystack`. */
function looseContains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  const h = haystack.replace(/\s+/g, " ").trim().toLowerCase();
  const n = needle.replace(/\s+/g, " ").trim().toLowerCase();
  if (n.length === 0) return false;
  return h.includes(n);
}

/** Case/space-insensitive equality. */
function looseEquals(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

export type PreconditionResult = {
  /** The fresh crawl shows this rec's precondition is already met. */
  satisfied: boolean;
  /** An honest, first-person note for the retired card. Null when not satisfied. */
  note: string | null;
  /** The observed satisfying value (the live title / h1 / schema type). Null when not satisfied. */
  observedText: string | null;
};

const NOT_SATISFIED: PreconditionResult = { satisfied: false, note: null, observedText: null };

/**
 * Evaluate ONE rec's precondition against a fresh page snapshot. Returns
 * `satisfied: false` for every action type we cannot prove from the snapshot;
 * demotion is opt-in per proven case, never a default.
 */
export function evaluateRecPrecondition(
  row: RecommendedEditRow,
  snapshot: PageSnapshot,
): PreconditionResult {
  const proposed = row.proposed_text?.trim() ?? "";

  switch (row.action_type) {
    case "edit_title": {
      if (proposed.length === 0) return NOT_SATISFIED;
      if (looseEquals(snapshot.title, proposed) || looseContains(snapshot.title, proposed)) {
        return {
          satisfied: true,
          note: `You already fixed this. I retired it. Your title now reads "${snapshot.title}".`,
          observedText: snapshot.title,
        };
      }
      return NOT_SATISFIED;
    }
    case "edit_meta":
    case "improve_meta": {
      if (proposed.length === 0) return NOT_SATISFIED;
      if (
        looseEquals(snapshot.meta_description, proposed) ||
        looseContains(snapshot.meta_description, proposed)
      ) {
        return {
          satisfied: true,
          note: `You already fixed this. I retired it. Your page description now reads "${snapshot.meta_description}".`,
          observedText: snapshot.meta_description,
        };
      }
      return NOT_SATISFIED;
    }
    case "change_h1": {
      if (proposed.length === 0) return NOT_SATISFIED;
      if (looseEquals(snapshot.h1, proposed) || looseContains(snapshot.h1, proposed)) {
        return {
          satisfied: true,
          note: `You already fixed this. I retired it. Your headline now reads "${snapshot.h1}".`,
          observedText: snapshot.h1,
        };
      }
      return NOT_SATISFIED;
    }
    case "add_schema":
    case "fix_schema": {
      // The proposed_text of a schema rec (when present) names the schema type
      // (e.g. "FAQPage"). Satisfied when that type is now on the page; if the
      // rec named no specific type, any schema on a previously-bare page counts.
      const types = snapshot.schema_types ?? [];
      if (types.length === 0) return NOT_SATISFIED;
      const named = proposed.length > 0 ? proposed : null;
      const present =
        named == null
          ? types.length > 0
          : types.some((t) => looseEquals(t, named) || looseContains(t, named));
      if (present) {
        const shown = named ?? types[0]!;
        return {
          satisfied: true,
          note: `You already fixed this. I retired it. Your page now has ${shown} structured data.`,
          observedText: shown,
        };
      }
      return NOT_SATISFIED;
    }
    case "add_h2_section":
    case "add_answer_block":
    case "add_proof_section":
    case "add_comparison_section":
    case "add_cost_section":
    case "add_timeline_section": {
      // These rows carry the exact new section heading in proposed_text (or, for
      // some generators, the display_label). Satisfied when a heading matching
      // it now exists in the page's H2 list.
      const heading = proposed.length > 0 ? proposed : row.display_label?.trim() ?? "";
      if (heading.length === 0) return NOT_SATISFIED;
      const h2s = snapshot.h2_list ?? [];
      if (h2s.some((h) => looseEquals(h, heading) || looseContains(h, heading))) {
        return {
          satisfied: true,
          note: `You already fixed this. I retired it. Your page now has a "${heading}" section.`,
          observedText: heading,
        };
      }
      return NOT_SATISFIED;
    }
    default:
      // Every other action type: not provable from the snapshot alone. Never
      // demote what we can't prove.
      return NOT_SATISFIED;
  }
}

export type RecrawlDemotion = {
  row: RecommendedEditRow;
  note: string;
  observedText: string | null;
};

/**
 * Pure selection: which PENDING rows a fresh crawl proves are already resolved,
 * with the honest retirement note for each. Returns [] when nothing is resolved
 * (byte-identical passthrough for the caller).
 *
 * @param rows          the tenant's recommended-edit rows
 * @param snapshotByPath the LATEST page snapshot per pathname (caller builds this
 *                       from the freshest crawl per URL)
 */
export function selectRecrawlDemotions(
  rows: readonly RecommendedEditRow[],
  snapshotByPath: ReadonlyMap<string, PageSnapshot>,
): RecrawlDemotion[] {
  const out: RecrawlDemotion[] = [];
  for (const row of rows) {
    if (!isPending(row)) continue;
    const snapshot = snapshotByPath.get(snapshotPathOf(row.target_url));
    if (!snapshot) continue;
    const result = evaluateRecPrecondition(row, snapshot);
    if (result.satisfied && result.note) {
      out.push({ row, note: result.note, observedText: result.observedText });
    }
  }
  return out;
}

/**
 * Build the latest-per-path snapshot map from a flat snapshot list (newest
 * `fetched_at` wins). Exported so the tenant runner and tests share one rule.
 */
export function latestSnapshotByPath(
  snapshots: readonly PageSnapshot[],
): Map<string, PageSnapshot> {
  const byPath = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const path = snapshotPathOf(s.url);
    const existing = byPath.get(path);
    if (!existing || s.fetched_at > existing.fetched_at) {
      byPath.set(path, s);
    }
  }
  return byPath;
}
