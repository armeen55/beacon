import "server-only";
import { createHash } from "node:crypto";
import { readActiveTrackedPrompts } from "@/domains/account/tracked-questions";
import { ALL_ENGINES } from "@/domains/evidence/readers/engine-types";
import { dualWriteUpsertScoped } from "@/lib/persistence/dual-write";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { CanonicalPairObservation, ObservationMode, ResearchEngine } from "@/domains/evidence/funnel/research-evidence";
import type { AnswerUsage, ObservedCitation, ParsedAiAnswer } from "@/domains/evidence/dataforseo/funnel-boundary";

/**
 * ai-observations - THE canonical record of one AI answer, kept WHOLE. An answer used to be collapsed at capture: the text hashed and thrown away, the
 * retrieved pages never stored, and a re-read meant buying it again. One row here holds the full text, the whole journey (fan-outs, retrieved pages,
 * cited sources, brands, the reported web-search state), the money receipt and the cache identity of the raw envelope, so later analysis re-reads what
 * was paid for once. IDENTITY is (tenant, prompt, prompt version, engine, reporting day, sample slot): a retry of the same intent reuses that identity
 * and upserts the SAME row, while a deliberate second sample of the same pair on the same day is a different SLOT and therefore a different row, and
 * nothing else may mint an id here. prompt_answer_observations is a DECLARED PROJECTION of this record, derived by the same writer at the same moment.
 */

/** THE frozen seam with Runtime's planner: exactly the pairs that are due, nothing implied. `day` is the
 *  REPORTING DAY the planner filtered on, carried so the row is stored on the day the plan meant. It used to
 *  be re-derived from the wall clock at write time, so a run resumed past midnight landed rows on a day the
 *  planner and the analysis pass never looked at, and nothing on a resumed run was ever analyzed. */
export type DueObservation = {
  promptId: string; version: number; text: string; day: string;
  engine: "chatgpt" | "claude" | "gemini" | "perplexity"; slot: 0 | 1 | 2;
};

/** observed = a real answer in hand. unavailable = the engine had nothing to give. unsupported = I cannot
 *  ask this engine at all, so no money moved. failed = the provider refused or broke, with the reason.
 *  pending = the request is accepted and in flight; the free collect finishes it on the same identity. */
export type AiObservationStatus = "observed" | "unavailable" | "unsupported" | "failed" | "pending";

export type AiObservationRecord = {
  id: string; tenant_id: string; site: string; prompt_id: string; prompt_version: number;
  prompt_text: string; engine: ResearchEngine;
  model_requested: string | null; model_served: string | null; observation_mode: ObservationMode;
  /** The reporting day (Pacific) this observation belongs to; part of the identity. */
  reporting_day: string;
  sample_slot: number; language: string; location: number;
  requested_at: string; completed_at: string | null; capability_version: string;
  /** The evidence_cache identity of the RAW envelope this row was read from. */
  cache_key: string | null;
  cost_usd: number; status: AiObservationStatus; failure_reason: string | null;
  answer_text: string | null; answer_hash: string | null;
  /** The retrieval journey behind this answer. Every list keeps the tri-state: null = the provider does
   *  not report it on this path, [] = it reported none, nonempty = what it actually reported. Retrieved
   *  pages are kept strictly apart from cited ones: "it read this" and "it credited this" differ. */
  journey: {
    fan_outs: string[] | null; brand_mentions: string[] | null; web_search_reported: boolean | null;
    retrieved_results: ObservedCitation[] | null; cited_sources: ObservedCitation[] | null;
    /** What the PROVIDER said this ask cost it. It rides the journey jsonb rather than a column of its own, so nothing here needs a migration and every
     *  row written before it existed still reads clean. Kept strictly apart from cost_usd above, which is the money that moved through the ledger. */
    usage?: AnswerUsage | null;
    /** THE RESEARCH RUN THAT BOUGHT THIS READING, on the same jsonb and for the same reason: no migration, and
     *  a row written before it reads clean. The derived history row has always carried the run id, so without
     *  it here the canonical record could not name its own buyer. Absent = written before it was stamped. */
    run_id?: string | null;
  };
  /** Null until a later strict-schema pass analyzes the stored text. No provider call. */
  analysis: Record<string, unknown> | null;
  analysis_hash: string | null;
};

/** ONE US/English observation frame, the same one the registry sends on every LLM ask. */
const OBSERVATION_LANGUAGE = "en";
const OBSERVATION_LOCATION = 2840;
const AI_OBSERVATIONS_TABLE = "ai_observations";

export type AiObservationDraft = {
  tenantId: string; site: string; promptId: string; promptVersion: number; promptText: string;
  engine: ResearchEngine; mode: ObservationMode; slot: number;
  /** THE reporting day this reading belongs to, taken from the PLAN and never from a clock: one run, one
   *  day, whatever hour the request actually left. */
  day: string;
  /** Full ISO instant the request was made. It records WHEN, never WHICH DAY THIS COUNTS FOR. */
  requestedAt: string;
  completedAt?: string | null; capability: string; cacheKey?: string | null; costUsd?: number;
  /** The research run this reading was taken on; it lands on the row's own journey. Absent = not supplied. */
  runId?: string | null;
  modelRequested?: string | null; status: AiObservationStatus; failureReason?: string | null;
  parsed?: ParsedAiAnswer | null;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The deterministic identity. Same intent, same id, forever: a retry can only ever overwrite itself. */
export function aiObservationId(i: { tenantId: string; promptId: string; promptVersion: number; engine: string; day: string; slot: number }): string {
  return `obs_${sha(`${i.tenantId}|${i.promptId}|${i.promptVersion}|${i.engine}|${i.day}|${i.slot}`).slice(0, 40)}`;
}

/** Pure: one draft -> the canonical row. Nothing is invented; what the provider did not report stays null. */
export function buildAiObservation(d: AiObservationDraft): AiObservationRecord {
  const day = d.day;
  const p = d.parsed ?? null;
  const text = p?.answerText ?? null;
  return {
    id: aiObservationId({ tenantId: d.tenantId, promptId: d.promptId, promptVersion: d.promptVersion, engine: d.engine, day, slot: d.slot }),
    tenant_id: d.tenantId, site: d.site, prompt_id: d.promptId, prompt_version: d.promptVersion, prompt_text: d.promptText,
    engine: d.engine, model_requested: d.modelRequested ?? null, model_served: p?.modelServed ?? null,
    observation_mode: d.mode, reporting_day: day, sample_slot: d.slot,
    language: OBSERVATION_LANGUAGE, location: OBSERVATION_LOCATION,
    requested_at: d.requestedAt, completed_at: d.completedAt ?? null,
    capability_version: d.capability, cache_key: d.cacheKey ?? null, cost_usd: d.costUsd ?? 0,
    status: d.status, failure_reason: d.failureReason ?? null,
    answer_text: text, answer_hash: text ? sha(text).slice(0, 16) : null,
    journey: {
      fan_outs: p?.fanOutQueries ?? null, retrieved_results: p?.retrievedResults ?? null,
      cited_sources: p?.citations ?? null, brand_mentions: p?.brandMentions ?? null,
      web_search_reported: p?.webSearchReported ?? null, usage: p?.usage ?? null, run_id: d.runId ?? null,
    },
    analysis: null, analysis_hash: null,
  };
}


/** THE one production write of a canonical observation: tenant-checked, fail-closed, upserted on identity. */
export async function recordAiObservation(rec: AiObservationRecord, tenantId: string): Promise<void> {
  await dualWriteUpsertScoped(AI_OBSERVATIONS_TABLE, [rec], "id", tenantId);
}

/** ONE page of a paginated read, and the ceiling on a whole read. Bounded so no single visit pulls an unbounded table into memory; a range past the ceiling is a fault said out loud, never a quiet cut. */
const PAGE_ROWS = 1000, MAX_ROWS = 40_000;

/** THE TWO JSONB BODIES, NARROWED TO THE KEYS A COUNT ACTUALLY READS. Measured on the live table, one account's 28 days of first readings is 17 MB whole: 6.1 MB of answer text, 4.9 MB of stored verdicts, 4.5 MB of retrieval journeys. A trend needs six keys off the verdict and two off the journey, so both are asked for BY KEY and put back together below, and the tab that read all 17 MB against a 12 second deadline now reads about a third of it. PostgREST names a json path by its last key, hence the aliases. */
const ANALYSIS_KEYS = "mention:analysis->ownedBrandMention,rivals:analysis->competitors,rejected:analysis->rejected,outcome:analysis->outcome,readOutcome:analysis->readOutcome,verdictRules:analysis->verdictRules";
/** THE LEAN OUTCOME PROJECTION: the only columns an outcome read actually reads. prompt_text rides it so scope joins can fire on the WORDING route; the answer text and the journey stay off it entirely. The keyset cursor rides on requested_at + id, so both stay in. */
const OUTCOME_COLUMNS = `id,tenant_id,prompt_id,prompt_version,engine,reporting_day,sample_slot,status,analysis_hash,answer_hash,requested_at,prompt_text,${ANALYSIS_KEYS}`;
/** THE OVERVIEW PROJECTION: the outcome columns, the instrument each answer was served on, and the two journey lists a citation count is derived from. Never the answer text, never the whole verdict, never the whole journey; a full-row read of this window is what left the AI tab blank. */
const OVERVIEW_COLUMNS = `${OUTCOME_COLUMNS},site,model_served,observation_mode,cited:journey->cited_sources,retrieved:journey->retrieved_results`;
/** THE SCOPED PROJECTION: the overview columns plus the fan-outs, for the one read that has to answer "did
 *  this answer run the search this change was aimed at". Without the journey a shipment could only join on a
 *  wording that had since become a tracked question, which is a claim the read could not keep. NEVER folded
 *  into OVERVIEW: the daily trend reads that one under a 12 second deadline and never reads a fan-out. */
const SCOPED_COLUMNS = `${OVERVIEW_COLUMNS},fans:journey->fan_outs`;
/** A narrow projection arrives FLAT. The two bodies are rebuilt here holding ONLY the keys that were asked for, and a body whose every asked key came back null is null: the row's own claim that nothing was reported, never an empty object standing in for one. The journey is rebuilt only when it was asked for, so an outcome read keeps saying "this path reports no journey" exactly as it did before. */
function narrowRow(r: Record<string, unknown>, wantJourney: boolean): AiObservationRecord {
  const { mention, rivals, rejected, outcome, readOutcome, verdictRules, cited, retrieved, fans, ...rest } = r;
  const analysis = { ownedBrandMention: mention ?? null, competitors: rivals ?? null, rejected, outcome, readOutcome, verdictRules };
  // `fan_outs` is present ONLY where the projection asked for it. The overview read never does, so it keeps
  // saying "this path reports no fan-out" exactly as before rather than claiming the answer ran none.
  return { ...rest, analysis: Object.values(analysis).every((v) => v == null) ? null : analysis,
    ...(wantJourney ? { journey: { cited_sources: cited ?? null, retrieved_results: retrieved ?? null, fan_outs: fans ?? null, brand_mentions: null, web_search_reported: null } } : {}) } as unknown as AiObservationRecord;
}
/** THE LIST PROJECTION for a surface paging a day's readings: everything EXCEPT the one genuinely heavy column. A screen of whole AI answers is the shape that has timed a statement out here before, so `answer_text` is read only by the drill-down below, which asks for one row by id. */
const LIST_COLUMNS = "id,tenant_id,site,prompt_id,prompt_version,prompt_text,engine,model_requested,model_served,observation_mode,reporting_day,sample_slot,requested_at,completed_at,cache_key,cost_usd,status,failure_reason,answer_hash,journey,analysis,analysis_hash";

/** THE FAN-OUT PROJECTION: the identity plus ONLY the three journey lists the fan-out evidence reads. Never
 *  the answer text, never the analysis, so a 28-day window is a fraction of the full rows and one read powers
 *  the whole Query fan-outs view (see ai-visibility/fanout-evidence). */
const FANOUT_COLUMNS = "id,tenant_id,site,prompt_id,prompt_version,prompt_text,engine,model_served,observation_mode,reporting_day,sample_slot,status,requested_at,fans:journey->fan_outs,cited:journey->cited_sources,retrieved:journey->retrieved_results";

/** THE LEANEST PROJECTION, for asking WHETHER the readings have moved rather than what they say: the identity, the day, whether an answer is in hand, and the two settlement stamps. Never the answer text, never the journey, never the analysis body, so fingerprinting a whole account costs a few bytes a row. */
const STAMP_COLUMNS = "id,prompt_id,prompt_version,engine,reporting_day,requested_at,status,answer_hash,analysis_hash";

/**
 * Read stored observations back for RE-ANALYSIS. Everything a later pass needs is already on the row, so re-reading an answer costs nothing and no provider is called. A failed read throws (an empty list would read as "this account has no answers", which is a different and false claim).
 * EVERY FILTER IS IN THE QUERY, and a NAMED DAY is then PAGED until it is exhausted: asking for a day, or a range of them, means asking for all of it. One `.limit(2000)` over the newest rows cut a 140 answer a day account's "28 day" history around day 14, and the planner's read of one 600 row day held 500 of them.
 * PAGES ADVANCE BY CURSOR, never by offset. Rows arrive newest first with the id breaking every tie, and each page starts strictly
 * after the last row before it; an offset window re-numbers itself whenever a row is inserted mid-read, which is what the collect
 * step does, so one row was read twice and another never. ASK FOR WHAT YOU READ: `projection: "outcome"` narrows the SELECT to the
 * identity, day, slot, status and the six verdict keys a count reads, `"overview"` adds the served instrument and the two journey
 * lists a citation count needs, `"list"` drops only the whole answer text, and a caller that passes none of them gets the whole row.
 * ONE BOUNDED PAGE, ON DEMAND: a surface showing a day's readings passes `after` (the cursor off the last row it
 * holds) with a `limit` and gets exactly that page, the same keyset the loop below walks, so a screen can page a 140 answer day
 * without any single request reading all of it. `id` asks for one stored reading by its own identity, which is how a drill-down
 * loads the answer text: THE ONLY PATH THAT EVER LOADS IT.
 */
export async function readAiObservations(
  tenantId: string,
  opts: { day?: string; fromDay?: string; toDay?: string; promptId?: string; id?: string; limit?: number;
    slot?: number; after?: { at: string; id: string } | null; projection?: "full" | "outcome" | "overview" | "list" | "stamp" | "fanout" | "scoped";
    /** ONLY rows whose reading is still owed (analysis null, status observed), riding the partial index, so an existence probe or an oldest-debt pick is ONE indexed row instead of paging a window. Narrower than isAnalysisSettled by design: a part-read row does not pin the probe, and the day-level read still applies the full rule. */
    unreadOnly?: boolean;
    /** Oldest reporting day first (for picking the oldest owed debt). Incompatible with `after` paging; callers pass limit 1. */
    oldestFirst?: boolean } = {},
): Promise<AiObservationRecord[]> {
  const whole = opts.day !== undefined || opts.fromDay !== undefined || opts.toDay !== undefined;
  const want = Math.min(Math.max(1, Math.floor(opts.limit ?? (whole ? MAX_ROWS : 500))), MAX_ROWS);
  const rows: AiObservationRecord[] = [];
  let exhausted = false;
  let after: { at: string; id: string } | null = opts.after ?? null;
  while (!exhausted && rows.length < want) {
    const size = Math.min(PAGE_ROWS, want - rows.length);
    let q = getSupabaseAdmin().from(AI_OBSERVATIONS_TABLE)
      .select(opts.projection === "overview" ? OVERVIEW_COLUMNS : opts.projection === "outcome" ? OUTCOME_COLUMNS : opts.projection === "list" ? LIST_COLUMNS : opts.projection === "stamp" ? STAMP_COLUMNS : opts.projection === "fanout" ? FANOUT_COLUMNS : opts.projection === "scoped" ? SCOPED_COLUMNS : "*")
      .eq("tenant_id", tenantId);
    if (opts.id) q = q.eq("id", opts.id);
    if (opts.day) q = q.eq("reporting_day", opts.day);
    if (opts.fromDay) q = q.gte("reporting_day", opts.fromDay);
    if (opts.toDay) q = q.lte("reporting_day", opts.toDay);
    if (opts.unreadOnly) q = q.is("analysis", null).eq("status", "observed"); // the ix_ai_observations_unanalyzed partial index carries exactly this shape
    if (opts.promptId) q = q.eq("prompt_id", opts.promptId);
    // The slot is asked for HERE: filtering it afterwards spends every page on samples the caller drops.
    if (opts.slot !== undefined) q = q.eq("sample_slot", opts.slot);
    // Strictly past the last row already read, in the same order rows come back. The cursor came over the
    // wire: only an ISO instant and this table's own id shape may enter the or() filter string.
    if (after) {
      if (!/^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?$/.test(after.at) || !/^obs_[a-f0-9]{1,64}$/.test(after.id)) {
        throw new Error("[ai_observations] the cursor did not parse, so I am not guessing where the page was");
      }
      q = q.or(`requested_at.lt."${after.at}",and(requested_at.eq."${after.at}",id.lt."${after.id}")`);
    }
    // Newest first, id breaking every tie: without a unique tiebreaker two rows stamped the same instant
    // can land on both sides of a page edge, so one is read twice and another never at all. `oldestFirst` flips the whole order (reporting day leading) for the one-row oldest-debt pick, which never pages.
    if (opts.oldestFirst) q = q.order("reporting_day", { ascending: true });
    const { data, error } = await q.order("requested_at", { ascending: opts.oldestFirst === true }).order("id", { ascending: opts.oldestFirst === true }).limit(size);
    if (error) throw new Error(`[ai_observations] read failed: ${error.message}`);
    // On the lean projections the row genuinely has no answer_text and no whole journey; every caller that asks
    // for one reads only the columns it named, which is why it asked for them.
    const narrow = opts.projection === "overview" || opts.projection === "outcome" || opts.projection === "scoped";
    const page = (narrow ? ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => narrowRow(r, opts.projection === "overview" || opts.projection === "scoped"))
      : opts.projection === "fanout" ? ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const { fans, cited, retrieved, ...rest } = r; // the three aliased journey lists, rebuilt in place
        return { ...rest, journey: { fan_outs: fans ?? null, cited_sources: cited ?? null, retrieved_results: retrieved ?? null, brand_mentions: null, web_search_reported: null }, analysis: null, analysis_hash: null };
      })
      : (data ?? [])) as unknown as AiObservationRecord[];
    rows.push(...page);
    const last = page[page.length - 1];
    if (last) after = { at: String(last.requested_at ?? ""), id: String(last.id) };
    exhausted = page.length < size || !last; // a short page is the end of the range; a full one means keep walking
  }
  if (!exhausted && rows.length >= MAX_ROWS) throw new Error(`[ai_observations] read hit the ${MAX_ROWS} row ceiling; ask for a narrower day range`);
  return rows;
}

export type { CanonicalPairObservation };

/** THE CEILING ON THE SNAPSHOT'S OWN READ, newest first: 1,000 rows a page, at most 8 pages. One page was under
 *  three days of history at 140 readings a day, so a pair that missed a couple of days had its newest useful row
 *  sitting just past the edge and vanished from every decision without a word. 8,000 rows is about 57 days at 140
 *  readings a day and about 20 days at 400 pairs, and the walk STOPS the moment every active pair is resolved, so
 *  the healthy account still pays for exactly one page. Whatever the ceiling cannot reach is SAID OUT LOUD below. */
const CANONICAL_PAGE = 1000, CANONICAL_MAX_PAGES = 8;

/** A READ THAT DID NOT HAPPEN, said out loud. An empty list here would claim the account has no AI answers, and on a
 *  418 answer account a Supabase blip did exactly that. Every caller either handles this or lets it travel. */
class CanonicalReadFailure extends Error {}

/**
 * THE ACCOUNT'S AI EVIDENCE: the latest useful stored answer for every ACTIVE tracked question on every engine, read
 * back off the canonical record. Zero provider calls, zero writes. A failed read THROWS `CanonicalReadFailure`; only
 * an account that genuinely has no tracked questions and no stored answer comes back empty.
 *
 * SCOPE, all of it decided here so nothing downstream has to guess: this account, sample slot 0, an answer actually in
 * hand (`observed` with a hash), and the question's CURRENT version only. A retired question and a superseded wording
 * are both somebody else's history, so neither speaks for today. `prompts` is injectable; by default the ONE owner of
 * the tracked set is asked, so what the operator approved and what this reads can never disagree.
 */
export async function readCanonicalPairObservations(
  tenantId: string, opts: { prompts?: readonly { id: string; version: number }[] } = {},
): Promise<CanonicalPairObservation[]> {
  return (await walkCanonicalPairs(tenantId, opts, "list")).map(canonicalPairOf);
}

/**
 * THE SAME SET, WEIGHED INSTEAD OF READ: one id and one reading stamp per active pair, for a caller asking only
 * whether the readings have MOVED. It runs the walk above, so the scope, the latest-per-pair rule, the page
 * size, the page cap and the early stop are not merely matched, they are the same code and cannot drift apart.
 * A separate hand-rolled read of ONE page next to a loader that walks eight produced two windows that could
 * never agree, so a debt computed from the difference was owed on every single call, forever, and each one
 * opened a PAID research phase. The shape is exactly what `analysisWatermark` folds, so no caller re-maps it.
 * Zero provider calls, zero writes, and never the answer text, the journey or the analysis body.
 */
export async function readCanonicalAnalysisStamps(
  tenantId: string, opts: { prompts?: readonly { id: string; version: number }[] } = {},
): Promise<{ id: string; hash: string | null }[]> {
  return (await walkCanonicalPairs(tenantId, opts, "stamp")).map((r) => ({ id: r.id, hash: r.analysis_hash ?? null }));
}

/** THE ONE WALK both readers above run: newest first, one page at a time, stopped the moment every active pair
 *  has its newest useful row. Everything that decides WHICH rows are the account's evidence lives here and
 *  nowhere else, so no second implementation can ever read a different window of the same account. */
async function walkCanonicalPairs(
  tenantId: string, opts: { prompts?: readonly { id: string; version: number }[] }, projection: "list" | "stamp",
): Promise<AiObservationRecord[]> {
  try {
    // Account owns the tracked set and Account is a lower kernel, so this is a plain static import in the legal
    // direction; it used to be a lazy dynamic import of Runtime to dodge a cycle. `opts.prompts` is the override.
    const active = opts.prompts ?? (await readActiveTrackedPrompts(tenantId));
    // null = the question set itself could not be read, which is NOT an account with no questions.
    if (active == null) throw new CanonicalReadFailure("[ai_observations] I could not read which questions are tracked");
    if (active.length === 0) return [];
    const current = new Map(active.map((p) => [p.id, p.version]));
    // ONE ROW PER PAIR: the newest reporting day, ties broken by the newest ask. A day is fixed width, so the two
    // stamps compare as one string without inventing a clock here. Every active question is asked on every engine,
    // so that product is how many pairs a complete read owes and therefore when the walk may stop.
    const wanted = active.length * ALL_ENGINES.length;
    const latest = new Map<string, AiObservationRecord>();
    let after: { at: string; id: string } | null = null, pages = 0, exhausted = false;
    while (pages < CANONICAL_MAX_PAGES && latest.size < wanted && !exhausted) {
      const rows = await readAiObservations(tenantId, { slot: 0, limit: CANONICAL_PAGE, projection, after });
      pages += 1;
      for (const r of rows) {
        if (r.status !== "observed" || !r.answer_hash || current.get(r.prompt_id) !== r.prompt_version) continue;
        const key = `${r.prompt_id}|${r.engine}`, held = latest.get(key);
        if (!held || `${r.reporting_day}|${r.requested_at}` > `${held.reporting_day}|${held.requested_at}`) latest.set(key, r);
      }
      // THE NEWEST ROW THIS PAGE CAN ACTUALLY BE RESUMED FROM. A row with no ask stamp fails the reader's own
      // cursor guard, and taking it would have thrown the WHOLE walk away over one malformed row; rows are
      // read newest first, so resuming a little earlier can only ever re-read, never skip.
      const last = [...rows].reverse().find((r) => /^\d{4}/.test(String(r.requested_at ?? "")));
      exhausted = rows.length < CANONICAL_PAGE || !last; // a short page is the end of this account's history, not a ceiling I hit
      if (last) after = { at: String(last.requested_at), id: String(last.id) };
    }
    // NEVER A SILENT CUT. Running out of history is honest; running out of PAGES is a gap I name.
    if (!exhausted && latest.size < wanted) console.warn(`[ai_observations] I read ${pages * CANONICAL_PAGE} stored answers and still could not find a current one for ${wanted - latest.size} of your ${wanted} question and engine pairs, so I am deciding without them; ask me to check those questions again to bring them back.`);
    return [...latest.values()].sort((a, b) => a.prompt_id.localeCompare(b.prompt_id) || a.engine.localeCompare(b.engine));
  } catch (e) {
    throw e instanceof CanonicalReadFailure ? e : new CanonicalReadFailure(`[ai_observations] canonical read failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}

/** Pure: one stored row -> the snapshot's shape. A reading that is unsettled, taken against a different answer, or
 *  shaped like a refusal carries NO analysis here, so a verdict nobody actually reached can never leak onto a surface. */
export function canonicalPairOf(r: AiObservationRecord): CanonicalPairObservation {
  // A READING IS AN OBJECT. A stored jsonb string or array with a matching hash used to be cast straight onto the
  // snapshot, so `analysis` arrived as text nothing could read a question or an entity out of.
  const verdict = typeof r.analysis === "object" && r.analysis !== null && !Array.isArray(r.analysis)
    ? (r.analysis as { rejected?: unknown; outcome?: unknown }) : null;
  const real = verdict != null && verdict.rejected !== true && verdict.outcome !== "refused"
    && isAnalysisSettled({ analysis: r.analysis, analysisHash: r.analysis_hash, answerHash: r.answer_hash });
  const cited = r.journey?.cited_sources ?? null;
  return {
    observationId: r.id, promptId: r.prompt_id, promptVersion: r.prompt_version, promptText: r.prompt_text,
    // THE RECEIPT TRAVELS WITH THE ANSWER: the cache identity of the envelope this reading was read from is
    // what makes a claim about what was bought checkable, and every reader downstream had to say "unknown".
    cacheKey: r.cache_key ?? null,
    engine: r.engine, modelRequested: r.model_requested, modelServed: r.model_served,
    observationMode: r.observation_mode, reportingDay: r.reporting_day, observedAt: r.completed_at,
    answerHash: r.answer_hash ?? "", webSearchReported: r.journey?.web_search_reported ?? null,
    citationsObserved: cited !== null, citations: cited, fanOutQueries: r.journey?.fan_outs ?? null,
    retrievedResults: r.journey?.retrieved_results ?? null, brandMentions: r.journey?.brand_mentions ?? null,
    analysis: real ? (r.analysis as Record<string, unknown>) : null, analysisHash: r.analysis_hash ?? null,
  };
}

/** The READER's view of a stored observation: the identity, where it stands, and the text an analysis pass
 *  works on. Planners and analyzers consume this; only the writer handles the stored column shape, so no
 *  caller has to cast a database row into the shape it wanted. */
export type AiObservationView = {
  id: string;
  promptId: string;
  version: number;
  engine: string;
  slot: number;
  day: string;
  status: AiObservationStatus;
  observedAt: string | null;
  /** WHEN THE ASK BEHIND THIS ROW WAS ACTUALLY MADE. It moves every time the provider is asked again on
   *  this identity, so it is the row's own proof that an ask happened, which is what a per-day retry
   *  budget has to be counted against. */
  requestedAt: string;
  /** WHY the provider gave me nothing, in the provider's own terms. The planner reads it so a pair
   *  it stops asking about today can say what actually happened instead of going quiet. */
  failureReason: string | null;
  promptText: string;
  answerText: string | null;
  answerHash: string | null;
  /** The addresses this answer CREDITED, in the order it credited them. null keeps the
   *  row's own tri-state: this path does not report citations at all, which is a
   *  different claim from "it credited nothing". */
  citationUrls: string[] | null;
  analysis: Record<string, unknown> | null;
  analysisHash: string | null;
};

/** Pure: stored row -> reader's view. */
function viewAiObservation(r: AiObservationRecord): AiObservationView {
  return {
    id: r.id, promptId: r.prompt_id, version: r.prompt_version, engine: r.engine, slot: r.sample_slot,
    day: r.reporting_day, status: r.status, observedAt: r.completed_at, promptText: r.prompt_text,
    requestedAt: String(r.requested_at ?? ""), failureReason: r.failure_reason ?? null,
    answerText: r.answer_text, answerHash: r.answer_hash, analysis: r.analysis, analysisHash: r.analysis_hash,
    citationUrls: r.journey?.cited_sources?.map((c) => c.url || c.domain) ?? null,
  };
}

/** THE re-analysis read: everything a later pass needs, already bought, in the reader's own shape. */
export async function readAiObservationViews(
  tenantId: string, opts: { day?: string; fromDay?: string; toDay?: string; promptId?: string; limit?: number; slot?: number } = {},
): Promise<AiObservationView[]> {
  return (await readAiObservations(tenantId, opts)).map(viewAiObservation);
}

/**
 * SETTLE a reading that is never going to land: the row stops saying `failed` (which reads as "I will try
 * again") and says what is true (`unavailable` = the engine had nothing readable to give today). The
 * provider's own reason stays where it is. Only a `failed` row moves, and only forward, so an answer that
 * landed while the planner was deciding can never be demoted. No row matched is a no-op, never an error.
 */
export async function settleFailedObservation(
  tenantId: string, observationId: string, status: Extract<AiObservationStatus, "unavailable" | "unsupported">,
): Promise<void> {
  const { error } = await getSupabaseAdmin().from(AI_OBSERVATIONS_TABLE).update({ status })
    .eq("tenant_id", tenantId).eq("id", observationId).eq("status", "failed");
  if (error) throw new Error(`[ai_observations] settle failed: ${error.message}`);
}

/**
 * SETTLED FOR ANALYSIS. A reading is done ONLY when it was taken against the answer on file AND covers all of it. A pass that read some of a long
 * answer persists what it merged with a DIFFERENT hash on purpose, so the row stays due and the next pass resumes at the first piece nobody has read;
 * anything counting completed checks must ask this, never `analysis != null`. A settled reading that still has a named gap carries `answerReadInPart`.
 * AND A REJECTION IS FINISHED ONLY WHEN IT NAMES A PERMANENT REASON: on 3 and 4 August every one of 278 answers was rejected on a rate limit and
 * stamped with its own answer hash, so the hash alone said "read, forever" about answers nothing had read at all. A rejection naming no `outcome` of
 * `refused` was the provider's failure, not the answer's, so it is due again, and the whole 278 come back through this test with no migration at all.
 * AND THE SAME READING BRINGS THE 3 AUGUST 50 BACK. Until the transport named its own failures by TYPE, a reader had to recognise a throttle by matching
 * `llm_openai_429` exactly, so the very same throttle carrying the code OpenAI actually sends fell through to `schema_invalid` and settled 50 answers nothing
 * had read, for calls that returned nothing and cost nothing. A `schema_invalid` refusal decided under those rules (no `verdictRules`) is owed again here; a
 * refusal settled under the typed rules stands, so a genuine unusable shape is never re-bought. No row is rewritten and no migration is run for either.
 */
export const TYPED_FAILURE_RULES = 2;
export function isAnalysisSettled(r: { analysis: unknown; analysisHash: string | null; answerHash: string | null }): boolean {
  const a = r.analysis as { rejected?: unknown; outcome?: unknown; readOutcome?: unknown; verdictRules?: unknown } | null;
  if (a == null || r.analysisHash == null || r.analysisHash !== r.answerHash) return false;
  if (a.rejected !== true) return true;
  if (a.outcome !== "refused") return false;
  if (a.readOutcome === "client_timeout") return false; // a call abandoned at my own deadline returned no body and no usage receipt, so it can never be the reason an answer is finished
  return a.readOutcome !== "schema_invalid" || a.verdictRules === TYPED_FAILURE_RULES;
}

/**
 * Persist the analysis of an answer ALREADY in hand. Zero provider calls, zero repurchase: the text was
 * bought once and the verdict lands beside it. A write that matched no row throws, so a lost analysis can
 * never read as a saved one.
 */
export async function persistAnswerAnalysis(
  tenantId: string, observationId: string, analysis: Record<string, unknown>, analysisHash: string,
): Promise<void> {
  const { data, error } = await getSupabaseAdmin().from(AI_OBSERVATIONS_TABLE)
    .update({ analysis, analysis_hash: analysisHash })
    .eq("tenant_id", tenantId).eq("id", observationId).select("id");
  if (error) throw new Error(`[ai_observations] analysis write failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) throw new Error(`[ai_observations] analysis write matched no row for ${observationId}`);
}
