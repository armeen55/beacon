/**
 * Co-mention Graph — reveals AI-era competitive adjacency from citation co-occurrence.
 *
 * Stage 1: Computed from existing Profound citation cold store (85K rows).
 * Stage 2: Enriched with native sampling data.
 * Stage 3: Temporal co-mention tracking + cross-model comparison.
 *
 * For each answer (prompt_answer_id), we collect all cited domains.
 * If the owned domain appears alongside another domain in the same answer,
 * that's a co-mention. Frequency = competitive adjacency signal.
 */

import "server-only";

import {
  getAllCitationDates,
  getCitationsForDate,
} from "@/lib/persistence/cold-store";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { CoMentionEntry, CoMentionMatrix } from "./co-mention-types";

const STORE_NAME = "co-mention-matrix";
const MIN_CO_OCCURRENCES = 2;

/**
 * Compute the co-mention matrix from citation cold store data.
 * Groups citations by prompt_answer_id, finds domain co-occurrences
 * with the owned domain.
 */
export async function computeCoMentionMatrix(
  ownedDomain: string,
  universedomains: Set<string>,
): Promise<CoMentionMatrix> {
  const dates = getAllCitationDates();
  const ownedNorm = ownedDomain.replace(/^www\./, "").toLowerCase();

  const answerDomains = new Map<string, Set<string>>();
  const answerPlatforms = new Map<string, string>();
  const answerTopics = new Map<string, string>();

  for (const date of dates) {
    const citations = getCitationsForDate(date);
    for (const c of citations) {
      const domain = c.domain?.replace(/^www\./, "").toLowerCase();
      if (!domain) continue;

      let domainSet = answerDomains.get(c.prompt_answer_id);
      if (!domainSet) {
        domainSet = new Set<string>();
        answerDomains.set(c.prompt_answer_id, domainSet);
      }
      domainSet.add(domain);
    }
  }

  const paoStore = await readStore<{
    id: string;
    platform: string;
    topic: string;
  }>("prompt-answer-observations");

  for (const pao of paoStore) {
    answerPlatforms.set(pao.id, pao.platform);
    answerTopics.set(pao.id, pao.topic);
  }

  const coOccurrences = new Map<
    string,
    { count: number; total: number; topics: Set<string>; platforms: Set<string> }
  >();

  const domainTotals = new Map<string, number>();

  for (const [answerId, domains] of answerDomains) {
    for (const d of domains) {
      domainTotals.set(d, (domainTotals.get(d) ?? 0) + 1);
    }

    if (!domains.has(ownedNorm)) continue;

    const platform = answerPlatforms.get(answerId) ?? "unknown";
    const topic = answerTopics.get(answerId) ?? "unknown";

    for (const d of domains) {
      if (d === ownedNorm) continue;

      let entry = coOccurrences.get(d);
      if (!entry) {
        entry = { count: 0, total: 0, topics: new Set(), platforms: new Set() };
        coOccurrences.set(d, entry);
      }
      entry.count++;
      entry.topics.add(topic);
      entry.platforms.add(platform);
    }
  }

  for (const [domain, entry] of coOccurrences) {
    entry.total = domainTotals.get(domain) ?? entry.count;
  }

  const entries: CoMentionEntry[] = [];
  for (const [domain, data] of coOccurrences) {
    if (data.count < MIN_CO_OCCURRENCES) continue;

    entries.push({
      domain,
      co_occurrence_count: data.count,
      total_appearances: data.total,
      co_mention_strength:
        data.total > 0 ? Math.round((data.count / data.total) * 100) / 100 : 0,
      topics: [...data.topics].sort(),
      platforms: [...data.platforms].sort(),
      is_in_universe: universedomains.has(domain.toLowerCase()),
    });
  }

  entries.sort((a, b) => b.co_occurrence_count - a.co_occurrence_count);

  return {
    owned_domain: ownedNorm,
    computed_at: new Date().toISOString(),
    total_answers_analyzed: answerDomains.size,
    entries,
  };
}

export function getAICompetitors(
  matrix: CoMentionMatrix,
  limit = 15,
): CoMentionEntry[] {
  return matrix.entries
    .filter((e) => !e.is_in_universe)
    .slice(0, limit);
}

export function getTopCoMentions(
  matrix: CoMentionMatrix,
  limit = 20,
): CoMentionEntry[] {
  return matrix.entries.slice(0, limit);
}

let _cachedMatrix: CoMentionMatrix | null = null;

export function getCachedCoMentionMatrix(): CoMentionMatrix | null {
  if (_cachedMatrix) return _cachedMatrix;
  const stored = readStore<CoMentionMatrix>(STORE_NAME);
  if (Array.isArray(stored) && stored.length > 0) {
    _cachedMatrix = stored[0] as unknown as CoMentionMatrix;
    return _cachedMatrix;
  }
  return null;
}

export async function persistCoMentionMatrix(
  matrix: CoMentionMatrix,
): Promise<void> {
  _cachedMatrix = matrix;
  await writeStore(STORE_NAME, [matrix] as unknown as never[]);
}
