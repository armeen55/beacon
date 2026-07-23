/**
 * answer-drift-loader (BEACON 500 item 77) - the I/O layer around ./answer-drift.ts.
 * Computes week-over-week answer drift AT READ TIME from the live native-poll
 * observation stream (prompt_answer_observations), rather than only at import time
 * (that gap is what buildAnswerIntelligenceIndex leaves - it only reacts to imported
 * Profound data, never to the nightly native poll's own answer history).
 *
 * DOES NOT touch run-engine-poll.ts (another item owns the poll and it is on the
 * llm-safety allowlist) - this module only READS the rows that poll already writes,
 * paging past the 1000-row default cap the same way second-order-citations.ts and
 * answer-alignment-store.ts already do for the same table family. NO new store is
 * registered - drift is computed fresh on every call from the existing table.
 *
 * COMPARISON POLICY: for each (prompt_id, engine) pair, take the LATEST observation
 * and the observation nearest 7 days before it (within a +/-2 day tolerance band, so
 * a poll that ran a day early/late one night still counts as "last week's answer").
 * Pairs with fewer than 2 dated observations, or whose only two observations are
 * closer together than 4 days (not really "a week apart" yet), contribute nothing -
 * silence, never a fabricated comparison.
 */

import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { getTenant } from "@/domains/tenants/store";
import { rootDomain } from "@/domains/serp/serp-provider";
import { detectAnswerDrift, type DriftEvent } from "./answer-drift";
import { ENGINE_PLAIN_NAME, type EngineId } from "./engine-types";
import { scoreTopicMatch } from "@/domains/evidence/relevance-gate";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 10k rows ceiling - well above one tenant's poll-window volume
/** Only compare snapshots that read as "about a week apart" - close enough to
 *  7 days that a poll running a day early/late still counts. */
const TARGET_GAP_DAYS = 7;
const MIN_GAP_DAYS = 4;
const MAX_GAP_DAYS = 10;
/** How far back a fresh drift alert can look before it is too old to surface. */
const MAX_EVENT_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type ObservationRow = {
  prompt_id: string;
  observed_at: string;
  platform: string;
  topic: string | null;
  metadata: Record<string, unknown> | null;
};

/** Paginated, tenant-scoped read of the columns drift detection needs from
 *  prompt_answer_observations, bounded at MAX_PAGES * PAGE_SIZE rows. Mirrors the
 *  paged-read pattern in answer-alignment-store.ts / second-order-citations.ts -
 *  this is exactly the "page reads past the 1000-row cap" the item calls for.
 *  Fail-soft -> []. */
async function readObservationRows(tenantId: string): Promise<ObservationRow[]> {
  if (!isSupabaseConfigured() || !tenantId) return [];
  const out: ObservationRow[] = [];
  try {
    const sb = getSupabaseAdmin();
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select("prompt_id, observed_at, platform, topic, metadata")
        .eq("tenant_id", tenantId)
        .order("observed_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        log.warn("[answer-drift] prompt_answer_observations read failed", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as ObservationRow[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.warn("[answer-drift] prompt_answer_observations read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

function answerExcerptOf(row: ObservationRow): string {
  const md = row.metadata ?? {};
  const v = md["answer_excerpt"];
  return typeof v === "string" ? v : "";
}

function promptTextOf(row: ObservationRow): string {
  const md = row.metadata ?? {};
  const v = md["prompt_text"];
  return typeof v === "string" ? v : "";
}

/** Native engine ids only - the DataForSEO-backed engines (gemini/claude) and the
 *  native chatgpt/perplexity clients all write `platform` as one of these exact
 *  strings (engine-types.ts ENGINE_PLAIN_NAME keys), so a defensive filter here
 *  keeps out any unrelated platform value that might share this table one day. */
const KNOWN_ENGINES = new Set<string>(Object.keys(ENGINE_PLAIN_NAME));

type PromptEngineHistory = {
  promptId: string;
  promptText: string;
  engine: EngineId;
  topic: string | null;
  /** Sorted newest-first. */
  snapshots: Array<{ observedAt: string; answerText: string }>;
};

function groupByPromptEngine(rows: ObservationRow[]): PromptEngineHistory[] {
  const groups = new Map<string, PromptEngineHistory>();
  for (const row of rows) {
    if (!row.prompt_id || !row.observed_at || !KNOWN_ENGINES.has(row.platform)) continue;
    const excerpt = answerExcerptOf(row);
    if (!excerpt.trim()) continue; // nothing to compare for this snapshot
    const key = `${row.prompt_id}::${row.platform}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        promptId: row.prompt_id,
        promptText: promptTextOf(row) || row.prompt_id,
        engine: row.platform as EngineId,
        topic: row.topic || null,
        snapshots: [],
      };
      groups.set(key, g);
    }
    g.snapshots.push({ observedAt: row.observed_at, answerText: excerpt });
  }
  for (const g of groups.values()) {
    g.snapshots.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  }
  return [...groups.values()];
}

/** From a newest-first snapshot list, pick the pair to compare: the latest, and
 *  the snapshot whose age is closest to TARGET_GAP_DAYS while staying within the
 *  [MIN_GAP_DAYS, MAX_GAP_DAYS] tolerance band. Null when fewer than 2 snapshots
 *  exist, or none of the older snapshots falls in that band (honest silence -
 *  never compares two same-day polls or a same-night double-run as "a week"). */
function pickComparisonPair(
  snapshots: PromptEngineHistory["snapshots"],
): { latest: PromptEngineHistory["snapshots"][number]; priorWeek: PromptEngineHistory["snapshots"][number] } | null {
  if (snapshots.length < 2) return null;
  const latest = snapshots[0];
  const latestMs = Date.parse(latest.observedAt);
  let best: { snap: PromptEngineHistory["snapshots"][number]; diff: number } | null = null;
  for (let i = 1; i < snapshots.length; i++) {
    const candidate = snapshots[i];
    const ageDays = (latestMs - Date.parse(candidate.observedAt)) / DAY_MS;
    if (ageDays < MIN_GAP_DAYS || ageDays > MAX_GAP_DAYS) continue;
    const diff = Math.abs(ageDays - TARGET_GAP_DAYS);
    if (!best || diff < best.diff) best = { snap: candidate, diff };
  }
  return best ? { latest, priorWeek: best.snap } : null;
}

export type TenantDriftCoverage = {
  /** How many distinct (prompt, engine) pairs have at least 2 dated observations
   *  at all (regardless of whether they land in the ~1-week comparison band). */
  pairsWithHistory: number;
  /** Of those, how many have a valid week-over-week comparison pair. */
  pairsComparable: number;
  /** Total dated observations considered (post answer-excerpt/engine filter). */
  observationsConsidered: number;
};

export type DriftEventWithMatch = DriftEvent & {
  /** The page/move label this drift concept-links to, when the prompt's topic
   *  matches an open worklist move (item 4: "link it conceptually... but do not
   *  restructure the worklist"). Null when no match clears the relevance bar. */
  relatedMoveLabel: string | null;
};

export type DriftScanResult = {
  events: DriftEventWithMatch[];
  coverage: TenantDriftCoverage;
};

/** Find the ranked ChangeProposal whose page/topic shares a distinguishing token
 *  with the drifted prompt (same relevance-gate rule the query-spike band uses),
 *  or null when nothing matches. A pure concept link only - never mutates or
 *  reorders anything. (CORE 100K: reads the Decision kernel's proposals, not the
 *  retired worklist surface.) */
async function findRelatedMoveLabel(tenantId: string, promptText: string, topic: string | null): Promise<string | null> {
  try {
    const { loadChangeProposals } = await import("@/domains/decision/proposal-store");
    const byId = await loadChangeProposals(tenantId);
    const needle = topic || promptText;
    for (const p of byId.values()) {
      const label = p.pageLabel;
      if (!label) continue;
      if (scoreTopicMatch(needle, label).relevant || scoreTopicMatch(needle, p.primaryQuery ?? null).relevant) {
        return label;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scan the live native-poll observation stream for one tenant and return every
 * week-over-week drift event found in the last MAX_EVENT_AGE_DAYS, plus honest
 * coverage counts (how many prompt/engine pairs even have 2+ dated answers to
 * compare). Never throws; every failure mode degrades to an empty result with
 * coverage counts intact where possible.
 */
export async function scanAnswerDrift(tenantId: string, now: Date = new Date()): Promise<DriftScanResult> {
  const empty: DriftScanResult = { events: [], coverage: { pairsWithHistory: 0, pairsComparable: 0, observationsConsidered: 0 } };
  if (!tenantId) return empty;
  try {
    const [rows, tenant] = await Promise.all([readObservationRows(tenantId), getTenant(tenantId)]);
    if (rows.length === 0 || !tenant || !tenant.domain) return empty;

    const ownedRoot = rootDomain(tenant.domain);
    const brandVariants = [tenant.business_name, ownedRoot.replace(/\..*$/, "")].filter((v) => v && v.length >= 3);
    if (brandVariants.length === 0) return { ...empty, coverage: { ...empty.coverage, observationsConsidered: rows.length } };

    const groups = groupByPromptEngine(rows);
    const pairsWithHistory = groups.filter((g) => g.snapshots.length >= 2).length;

    const events: DriftEventWithMatch[] = [];
    let pairsComparable = 0;
    const cutoffMs = now.getTime() - MAX_EVENT_AGE_DAYS * DAY_MS;

    for (const g of groups) {
      const pair = pickComparisonPair(g.snapshots);
      if (!pair) continue;
      pairsComparable += 1;
      // Only surface events whose "after" snapshot is itself recent - an old
      // week-over-week pair from months ago is not "this week's" alert.
      if (Date.parse(pair.latest.observedAt) < cutoffMs) continue;

      const detected = detectAnswerDrift({
        promptText: g.promptText,
        engine: ENGINE_PLAIN_NAME[g.engine] ?? g.engine,
        beforeText: pair.priorWeek.answerText,
        afterText: pair.latest.answerText,
        brandVariants,
        whenIso: pair.latest.observedAt,
      });
      if (detected.length === 0) continue;
      const relatedMoveLabel = await findRelatedMoveLabel(tenantId, g.promptText, g.topic);
      for (const d of detected) events.push({ ...d, relatedMoveLabel });
    }

    // Newest first, brand_dropped and brand_added (the headline-worthy kinds)
    // ahead of descriptor_changed when timestamps tie.
    events.sort((a, b) => {
      const t = Date.parse(b.whenIso) - Date.parse(a.whenIso);
      if (t !== 0) return t;
      const rank = (k: DriftEvent["kind"]) => (k === "descriptor_changed" ? 1 : 0);
      return rank(a.kind) - rank(b.kind);
    });

    return {
      events,
      coverage: { pairsWithHistory, pairsComparable, observationsConsidered: rows.length },
    };
  } catch (e) {
    log.warn("[answer-drift] scan failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return empty;
  }
}

/** $0-ish read for the Today standup: the drift events from the last 7 days only,
 *  capped so the standup block never grows unbounded. Fail-soft -> []. */
export async function loadRecentDriftEvents(tenantId: string, limit: number = 3, now: Date = new Date()): Promise<DriftEventWithMatch[]> {
  const result = await scanAnswerDrift(tenantId, now);
  return result.events.slice(0, limit);
}
