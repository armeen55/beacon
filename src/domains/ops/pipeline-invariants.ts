/**
 * pipeline-invariants (2026-07-02, master plan item 10) - the PURE checker for
 * nightly pipeline volume invariants. The known failure class is silent-empty:
 * /today once rendered blank for weeks off a statement timeout, because nothing
 * asserted that each stage of the pipe actually produced rows. After every
 * nightly sync we assert stage invariants and file a visible Ops card naming
 * the exact broken stage instead of letting downstream surfaces quietly show
 * nothing.
 *
 * Pure module: plain input type (PipelineReadings), no I/O, trivially testable.
 * The collector that fills the readings lives in ./pipeline-readings.ts.
 *
 * Invariant classes:
 *  - volume:    a connected source whose last sync window wrote 0 rows
 *  - freshness: a connected source whose last good sync is older than 48 hours
 *               (or that never completed a sync at all)
 *  - planning:  demand rows exist but last night's plan has 0 candidates
 *  - graph:     the demand graph has nodes but produced 0 moves
 *
 * Skip-over-scream rule: a FAILED reading (null) never fires a violation. We
 * only alarm on a confirmed empty stage, never on our own read error.
 */

export const FRESHNESS_LIMIT_HOURS = 48;
export const RECENT_WINDOW_HOURS = 36;

export type PipelineSourceKey = "gsc" | "ga4" | "profound";

export type PipelineTableKey =
  | "gsc_daily_rows"
  | "ga4_url_traffic"
  | "ga4_ai_referral_daily"
  | "profound_citation_rows"
  | "prompt_answer_observations";

export type PipelineConnectorReading = {
  /** Connector status; null = the status read itself failed (cannot assert). */
  connected: boolean | null;
  /** The connector's last-successful-sync stamp (ISO), or null when never stamped. */
  lastSyncedAt: string | null;
};

export type PipelineTableReading = {
  /** Rows written within the recent window (RECENT_WINDOW_HOURS); null = read failed. */
  recentRows: number | null;
  /** Newest write watermark (ISO); null = table empty for this tenant OR read failed. */
  latestRowAt: string | null;
};

export type PipelineReadings = {
  tenantId: string;
  /** ISO time the readings were taken (the "now" every age is measured against). */
  checkedAt: string;
  recentWindowHours: number;
  connectors: Record<PipelineSourceKey, PipelineConnectorReading>;
  tables: Record<PipelineTableKey, PipelineTableReading>;
  /** Latest persisted daily plan; null = read failed or plans are unreadable. */
  dailyPlan: {
    hasPlan: boolean;
    /** selected + backups on the latest plan. */
    candidateCount: number;
    planCreatedAt: string | null;
  } | null;
  /** The SWR demand-graph snapshot counts; null = no snapshot available (skip). */
  demandGraph: { nodes: number; moves: number } | null;
};

export type PipelineStage =
  | "gsc_sync"
  | "gsc_freshness"
  | "ga4_sync"
  | "ga4_freshness"
  | "profound_sync"
  | "profound_freshness"
  | "daily_candidates"
  | "demand_graph_moves";

export type PipelineViolation = {
  stage: PipelineStage;
  expected: string;
  actual: string;
  /** First-person operator sentence naming the broken stage + the next step. */
  sentence: string;
  /** Alert taxonomy (operator spec 2026-07-09, I-60):
   *  - "alarm" (default) = a genuinely BROKEN pipe worthy of the red "needs attention"
   *    banner (GSC auth/never-synced, a demand-spine sync writing 0 rows, no plan
   *    candidates, no moves).
   *  - "warn" = STALENESS: a connected source whose last good sync is too old, or an
   *    optional source that has never synced. Real, but not red - it renders in a
   *    SEPARATE amber "Some data is getting stale" box, never the red banner.
   *  - "info" = a working-but-quiet observation (e.g. a connected source that synced
   *    fine but returned 0 rows) - honest, but never rendered on Today. */
  severity?: "alarm" | "warn" | "info";
};

/** Which table proves each connected source actually landed rows. */
const SOURCE_TABLE: Record<PipelineSourceKey, PipelineTableKey> = {
  gsc: "gsc_daily_rows",
  ga4: "ga4_url_traffic",
  profound: "profound_citation_rows",
};

const SOURCE_LABEL: Record<PipelineSourceKey, string> = {
  gsc: "Search Console",
  ga4: "Google Analytics",
  profound: "the AI answer feed (Profound)",
};

/** Short stage name for "broken at the X stage" (no leading article). */
const SOURCE_STAGE_NAME: Record<PipelineSourceKey, string> = {
  gsc: "Search Console",
  ga4: "Google Analytics",
  profound: "AI answer feed",
};

/** Is a working-but-empty sync (fresh sync, 0 rows) an ALARM or just INFO for this source?
 *  Only the demand SPINE (Search Console) is volume-critical: 0 fresh rows there means the
 *  whole product has no data, a real broken pipe. Optional sources (analytics, the AI answer
 *  feed) legitimately go quiet - a dead/borrowed feed writing 0 rows is expected, not broken -
 *  so those are info-level and never drive the "needs attention" banner. Role-based, not
 *  tenant-based: no source is hardcoded to a specific customer. (2026-07-08) */
const SOURCE_VOLUME_CRITICAL: Record<PipelineSourceKey, boolean> = {
  gsc: true,
  ga4: false,
  profound: false,
};

const CONNECTIONS_NEXT_STEP = "Start with a reconnect check on the Connections page.";

function hoursBetween(earlierIso: string, laterIso: string): number | null {
  const a = Date.parse(earlierIso);
  const b = Date.parse(laterIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 3_600_000;
}

/** "about 3 hours" / "about 2 days" - plain age words for the sentences. */
export function describeAgeHours(hours: number): string {
  if (hours < 48) return `about ${Math.max(1, Math.round(hours))} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `about ${days} day${days === 1 ? "" : "s"}`;
}

/** The newest of the connector stamp and the table watermark - a row landing
 *  proves a sync even when the freshness stamp write failed. */
function lastGoodSyncIso(connector: PipelineConnectorReading, table: PipelineTableReading): string | null {
  const candidates = [connector.lastSyncedAt, table.latestRowAt].filter(
    (v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
}

function checkSource(
  key: PipelineSourceKey,
  readings: PipelineReadings,
): PipelineViolation | null {
  const connector = readings.connectors[key];
  const table = readings.tables[SOURCE_TABLE[key]];
  const label = SOURCE_LABEL[key];
  if (connector.connected !== true) return null; // disconnected or unknown status: nothing to assert

  // Freshness first: it subsumes volume (a stale pipe also wrote 0 rows tonight,
  // but "stale since X" is the more exact broken-stage message).
  const lastGood = lastGoodSyncIso(connector, table);
  if (lastGood === null) {
    // Connected but no stamp AND no row has ever landed. If we could not read the
    // table at all (recentRows null AND latestRowAt null could mean read failure),
    // only alarm when the stamp is also absent - which is this branch. This is a
    // confirmed never-synced source, not a read error on our side.
    //
    // I-60 taxonomy: a never-synced demand SPINE (Search Console) is an auth/setup
    // failure worth the red banner (it stays "alarm"). A never-synced OPTIONAL
    // source is not red - it drops to "warn" (the amber staleness tier).
    return {
      stage: `${key}_freshness` as PipelineStage,
      severity: SOURCE_VOLUME_CRITICAL[key] ? "alarm" : "warn",
      expected: "at least one completed sync",
      actual: "no completed sync ever",
      sentence:
        `${cap(label)} is connected but I have never seen a completed sync land a single row. ` +
        `Downstream numbers are empty because nothing arrived yet, not because nothing happened. ` +
        CONNECTIONS_NEXT_STEP,
    };
  }
  const ageHours = hoursBetween(lastGood, readings.checkedAt);
  if (ageHours !== null && ageHours > FRESHNESS_LIMIT_HOURS) {
    // I-60 taxonomy: STALENESS (last good sync too old) is AMBER, never red - for
    // EVERY source, the demand spine included. A stale pipe is honest to surface but
    // it is not a "needs attention" break, so it renders in the amber staleness box.
    return {
      stage: `${key}_freshness` as PipelineStage,
      severity: "warn",
      expected: `a good sync within ${FRESHNESS_LIMIT_HOURS} hours`,
      actual: `last good sync ${describeAgeHours(ageHours)} ago`,
      sentence:
        `${cap(label)} is connected but the last good sync finished ${describeAgeHours(ageHours)} ago, ` +
        `past my ${FRESHNESS_LIMIT_HOURS} hour limit. Downstream numbers are stale, not zero. ` +
        CONNECTIONS_NEXT_STEP,
    };
  }

  // Volume: the sync RAN recently (we passed the freshness gate above, so lastGood is
  // fresh) yet the recent window wrote 0 rows. recentRows === null means OUR read failed -
  // skip, never false-alarm.
  if (table.recentRows === 0) {
    if (SOURCE_VOLUME_CRITICAL[key]) {
      // The demand SPINE wrote 0 rows on a working sync: the whole product has no data -
      // a genuine broken-pipe alarm.
      return {
        stage: `${key}_sync` as PipelineStage,
        expected: `more than 0 rows written in the last ${readings.recentWindowHours} hours`,
        actual: "0 rows",
        sentence:
          `${cap(label)} is connected but the latest sync wrote 0 rows. ` +
          `The data pipe is broken at the ${SOURCE_STAGE_NAME[key]} stage; downstream numbers are stale, not zero. ` +
          CONNECTIONS_NEXT_STEP,
      };
    }
    // An OPTIONAL source that synced fine but returned 0 rows is simply quiet/dormant (a
    // dead or borrowed AI feed, an analytics property with no fresh hits) - NOT a broken
    // pipe. Honest + info-level so it never lights up the "needs attention" banner. This is
    // the false-alarm the operator hit on Profound. (2026-07-08)
    return {
      stage: `${key}_sync` as PipelineStage,
      severity: "info",
      expected: `fresh rows if ${label} has new data`,
      actual: "synced fine, 0 new rows",
      sentence:
        `${cap(label)} is connected and synced recently, but returned no new data in the last ` +
        `${readings.recentWindowHours} hours. That usually just means this source is quiet right now, ` +
        `not that anything is broken. If you expect data here, run a reconnect check; otherwise nothing ` +
        `is wrong and downstream numbers simply do not lean on it. ` +
        CONNECTIONS_NEXT_STEP,
    };
  }
  return null;
}

function checkDailyCandidates(readings: PipelineReadings): PipelineViolation | null {
  const plan = readings.dailyPlan;
  if (!plan || !plan.hasPlan) return null; // no plan yet is a normal state, not a broken pipe
  const demandWatermark = readings.tables.gsc_daily_rows.latestRowAt;
  if (demandWatermark === null) return null; // no demand rows (or unreadable): nothing to assert
  if (plan.candidateCount > 0) return null;
  return {
    stage: "daily_candidates",
    expected: "more than 0 plan candidates when demand rows exist",
    actual: "0 candidates",
    sentence:
      `Search data exists (the newest row is from ${demandWatermark.slice(0, 10)}) but the latest ` +
      `daily plan came out with 0 candidates. The data pipe is broken at the daily planning stage; ` +
      `Today shows no picks even though the demand data is there. I would rebuild the plan from the worklist.`,
  };
}

function checkDemandGraphMoves(readings: PipelineReadings): PipelineViolation | null {
  const graph = readings.demandGraph;
  if (!graph) return null; // no snapshot: skip, never rebuild the graph to find out
  if (graph.nodes === 0 || graph.moves > 0) return null;
  return {
    stage: "demand_graph_moves",
    expected: "more than 0 moves when the demand graph has nodes",
    actual: `${graph.nodes} demand topics, 0 moves`,
    sentence:
      `I track ${graph.nodes} demand topics but the last build produced 0 suggested changes from them. ` +
      `The data pipe is broken at the move building stage; the worklist looks empty even though the ` +
      `demand data is not. I would refresh the worklist to force a rebuild.`,
  };
}

/** THE checker: readings in, violations out. Deterministic, $0, pure. */
export function checkPipelineInvariants(readings: PipelineReadings): PipelineViolation[] {
  const violations: PipelineViolation[] = [];
  for (const key of ["gsc", "ga4", "profound"] as const) {
    const v = checkSource(key, readings);
    if (v) violations.push(v);
  }
  const candidates = checkDailyCandidates(readings);
  if (candidates) violations.push(candidates);
  const moves = checkDemandGraphMoves(readings);
  if (moves) violations.push(moves);
  return violations;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
