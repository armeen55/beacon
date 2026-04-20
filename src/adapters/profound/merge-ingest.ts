/**
 * Merge helpers for Profound CSV batch import — idempotent upsert semantics
 * in memory + cold stores (same natural key → last writer wins within one import).
 */

import "server-only";

import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { EntityCandidate } from "./benchmark-adapter";

export function mergeById<T extends { id: string }>(
  base: T[],
  incoming: T[],
  incomingWins: boolean
): T[] {
  const map = new Map<string, T>();
  for (const row of base) {
    map.set(row.id, row);
  }
  for (const row of incoming) {
    const prev = map.get(row.id);
    if (!prev) {
      map.set(row.id, row);
      continue;
    }
    map.set(row.id, incomingWins ? row : prev);
  }
  return [...map.values()];
}

export function citationDedupeKey(c: CitationObservation): string {
  const url = c.url ?? "";
  return `${c.prompt_answer_id}\t${url}`;
}

/**
 * Merge two citation lists for a single date shard.
 *
 * Derived fields (is_owned, tracked_entity_id) are ALWAYS taken from incoming
 * when incoming is present for a given (prompt_answer_id, url) tuple. This
 * prevents "stale ownership" bugs where an older import wrote is_owned=false
 * (because the ownedSet was empty/wrong) and later imports preserve that wrong
 * flag. 2026-04-19: this exact bug silently corrupted Apr 7-12 owned citation
 * data for weeks before detection.
 *
 * Content fields (title, source_category, domain, url) prefer INCOMING on
 * collision too \u2014 newer exports reflect the current source of truth.
 */
export function mergeCitationLists(
  existing: CitationObservation[],
  incoming: CitationObservation[]
): CitationObservation[] {
  // Index incoming by dedupe key so we can prefer its copy on collisions
  // without double-scanning.
  const incomingByKey = new Map<string, CitationObservation>();
  for (const c of incoming) {
    incomingByKey.set(citationDedupeKey(c), c);
  }

  const seen = new Set<string>();
  const out: CitationObservation[] = [];

  // Pass 1: walk existing. For each row, prefer the incoming row if present.
  // This ensures derived fields (is_owned, tracked_entity_id) reflect the
  // most recent ownedSet / entity lookup, not a stale snapshot from an
  // earlier import run.
  for (const ex of existing) {
    const k = citationDedupeKey(ex);
    if (seen.has(k)) continue;
    seen.add(k);
    const fresh = incomingByKey.get(k);
    out.push(fresh ?? ex);
  }

  // Pass 2: append any incoming rows not seen in existing.
  for (const c of incoming) {
    const k = citationDedupeKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }

  out.sort((a, b) => {
    const byRun = a.prompt_answer_id.localeCompare(b.prompt_answer_id);
    if (byRun !== 0) return byRun;
    return (a.citation_order ?? 0) - (b.citation_order ?? 0);
  });
  return renumberCitationOrderPerRun(out);
}

/** Re-assign citation_order 1..n and ids per prompt_answer_id (one shard = one date). */
function renumberCitationOrderPerRun(rows: CitationObservation[]): CitationObservation[] {
  const byRun = new Map<string, CitationObservation[]>();
  for (const c of rows) {
    if (!byRun.has(c.prompt_answer_id)) byRun.set(c.prompt_answer_id, []);
    byRun.get(c.prompt_answer_id)!.push(c);
  }
  const out: CitationObservation[] = [];
  for (const [, group] of byRun) {
    const sorted = [...group].sort(
      (a, b) => (a.citation_order ?? 0) - (b.citation_order ?? 0)
    );
    sorted.forEach((c, i) => {
      const order = i + 1;
      out.push({
        ...c,
        id: `cit-${c.prompt_answer_id}-${order}`,
        citation_order: order,
      });
    });
  }
  return out.sort((a, b) => {
    const byRun = a.prompt_answer_id.localeCompare(b.prompt_answer_id);
    if (byRun !== 0) return byRun;
    return (a.citation_order ?? 0) - (b.citation_order ?? 0);
  });
}

export function changelogDedupeKey(e: ChangelogEntry): string {
  return `${e.timestamp}|${e.url ?? ""}|${e.change_description}|${e.asset_name}|${e.topic_targeted}`;
}

export function mergeChangelogEntries(
  base: ChangelogEntry[],
  incoming: ChangelogEntry[]
): ChangelogEntry[] {
  const seen = new Set(base.map(changelogDedupeKey));
  const out = [...base];
  for (const e of incoming) {
    const k = changelogDedupeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export function mergeEntityCandidates(lists: EntityCandidate[][]): EntityCandidate[] {
  const map = new Map<string, EntityCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const prev = map.get(c.name);
      if (!prev) {
        map.set(c.name, { ...c });
      } else {
        map.set(c.name, {
          ...prev,
          row_count: prev.row_count + c.row_count,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.row_count - a.row_count);
}

export function rebuildProfoundImportRuns(
  observations: PromptAnswerObservation[],
  accountId: string,
  importRunId: string
): ProfoundImportRun[] {
  const groups = new Map<string, PromptAnswerObservation[]>();
  for (const o of observations) {
    if (!o.run_id) continue;
    if (!groups.has(o.run_id)) groups.set(o.run_id, []);
    groups.get(o.run_id)!.push(o);
  }

  const runs: ProfoundImportRun[] = [];
  for (const [id, obsList] of groups) {
    const first = obsList[0];
    const run_date = first.observed_at.slice(0, 10);
    runs.push({
      id,
      account_id: accountId,
      import_run_id: importRunId,
      run_date,
      platform: first.platform,
      model: null,
      geo: null,
      locale: null,
      source_type: "manual_import",
      status: "completed",
      prompt_count: obsList.length,
      metadata: {},
      created_at: `${run_date}T12:00:00.000Z`,
    });
  }

  return runs.sort((a, b) => {
    const byDate = a.run_date.localeCompare(b.run_date);
    return byDate !== 0 ? byDate : a.platform.localeCompare(b.platform);
  });
}
