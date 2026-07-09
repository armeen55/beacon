# P0 Stabilization Audit - 2026-07-09 (verified findings)

> 35-agent adversarial audit (find -> verify) of Beacon trust/correctness, triggered by the
> operator's live walkthrough + external audit. Every item below is CONFIRMED or PLAUSIBLE
> against the real code with file:line. Fix top-down; each fix tenant-agnostic, no new
> hardcoding/fixtures; full-suite green + prod smoke before calling any batch done.

## 1. [CRITICAL/CONFIRMED] Abstention gate (Law 2) completely unwired in load-queue.ts
- **Where:** `src/domains/recommendations/load-queue.ts:530` (charter: abstention)
- **Issue:** The abstention gate (BEACON_500 N49 / Law 2) defined in abstention.ts assesses whether a candidate has sufficient evidence and should be 'ready' vs 'watching' based on three signal classes (demand, competitor teardown, behavior/GSC). This gate is never invoked in the pipeline. Recommendations with affectedPromptCount=1, no packet signals (hasAiSearchSignal=false, hasCompetitorPageBlueprints=false), and zero evidence refs pass through generate → resolve → adjudicate → prioritize → decoratedQueue without any abstention assessment. They are marked as confidence='low' with reason='single_prompt_no_evidence' (confidence.ts:273) but still included in the queue with engineConfidence='low' instead of being partitioned to 'watching' state with the honest message "I do not have enough evidence to recommend this yet..." Operator sees "Lower confidence — optional" on a pure guess with zero corroborating signals.
- **Fix:** After the prioritizeRecommendations call (line 446-457) and before the decoration loop (line 531), add abstention partitioning:

```typescript
import { partitionByEvidence, type AbstentionEvidence } from "./abstention";

// After line 457:
const { ready: evidencedQueue, held: heldCandidates } = partitionByEvidence(
  prioritized.queue,
  (rec) => {
    const signals: AbstentionEvidence = {
      hasDemandSignal: false, // TODO: check GSC impressions, demand graph, keyword library
      hasCompetitorTeardown: hasCompetitorPageBlueprintsForRec({
        affectedPromptIds: rec.affectedPromptIds ?? [],
        observations: promptAnswerObservations,
        ownedPageInventory: pageInventory,
      }),
      hasBehaviorOrGscSignal: false, // TODO: check first-party GSC striking-distance, Clarity friction
    };
    return signals;
  }
);

// Update line 531 to use evidencedQueue:
const decoratedQueue: LiveRecQueueItem[] = evidencedQueue.map((rec) => { ... });

// Line 612-614: update return to include held candidates in watchlist:
return {
  queue: decoratedQueue,
  watchlist: [
    ...prioritized.watchlist,
    ...heldCandidates.map(({ item, verdict }) => item), // Add held candidates
  ],
  // ... rest unchanged
};
```

This ensures candidates with zero real evidence signals are held in 'watching' state instead of emitted as low-confidence queue items.
- **Status:** [ ] not started

## 2. [CRITICAL/CONFIRMED] GSC sync returns synced:true on primary data upsert failure (false success)
- **Where:** `src/lib/connectors/gsc/sync-search-analytics.ts:337` (charter: release-discipline)
- **Issue:** When gsc_daily_rows upsert fails (Supabase constraint/write error), the function logs a warning but returns { synced: true }, misreporting the failure as success. This causes the caller to stamp last_synced_at and display a green "Synced" status to the operator, while stale GSC data silently persists hidden behind a false success indicator. Contradicts the file's own fail-soft contract (line 29-31) which requires { synced: false, reason } on all failures.
- **Fix:** Replace line 337's return statement from `return { synced: true, property, days, rows_upserted: rowsUpserted };` to `return { synced: false, reason: "gsc_daily_rows_upsert_failed" };` to explicitly report the upsert failure and allow callers to classify and surface the error correctly.
- **Status:** [ ] not started

## 3. [CRITICAL/CONFIRMED] SEMrush sync returns synced:true on upsert failure (false success)
- **Where:** `src/lib/connectors/semrush/sync-organic-keywords.ts:89` (charter: release-discipline)
- **Issue:** When semrush_organic_keywords upsert fails (line 84), the function logs a warning but returns { synced: true, domain, rows_upserted: upserted, purged: false } on line 89. This reports the failure as success to callers, causing them to treat the operation as complete and stamping last_synced_at, while partial keyword data loss silently goes unnoticed. The same file's syncSemrushKeywordGapForTenant() function (line 190) correctly handles this by returning { synced: false, reason: "upsert_failed" } with an audit note explaining the importance of this behavior.
- **Fix:** Change line 89 from:
  return { synced: true, domain, rows_upserted: upserted, purged: false };
to:
  return { synced: false, reason: "upsert_failed" };

This aligns the organic-keywords sync with the correct error-handling pattern already implemented in the keyword-gap sync function and prevents false success reporting.
- **Status:** [ ] not started

## 4. [HIGH/CONFIRMED] Forecast range exceeds query's physical maximum when extreme CTR improvements are combined with correction factors
- **Where:** `src/domains/forecast/opportunity-math.ts:345` (charter: ranking-math)
- **Issue:** The forecast range (lowPerMonth/highPerMonth) returned by computeOpportunityFromGap can exceed the physical maximum clicks a query can deliver (monthly impressions × 100% CTR). With 14 monthly impressions, current CTR 0.001, expected CTR 0.95, correction factor 1.3, and capture band 0.95, the formula produces a forecast high of 16 clicks/month, but the query can deliver at most 14 clicks (14 impressions × 100% CTR max). The basis sentence claims the forecast range is "usually adds X to Y clicks a month," but this claim contradicts the physical impossibility when Y > monthly impressions.
- **Fix:** In computeOpportunityFromGap (lines 303-355), after obtaining the range from forecastRange, cap both low and high against the monthly impressions limit. Add: const monthlyImpressions = (input.impressions90d ?? 0) / 3; const maxMonthlyClicks = monthlyImpressions; return { lowPerMonth: Math.min(range.low, maxMonthlyClicks), highPerMonth: Math.min(range.high, maxMonthlyClicks), ... }. Alternatively, pass monthlyImpressions to forecastRange to enforce the cap within the range calculation itself.
- **Status:** [ ] not started

## 5. [HIGH/CONFIRMED] Display of upside contradicts basis: upside labeled as impressions but computed from forecast clicks
- **Where:** `src/app/(shell)/changes-list-client.tsx:416` (charter: ranking-math)
- **Issue:** The comment at lines 413-415 incorrectly states "c.upside is GSC impressions" and the display label at line 416 shows "{fmt(c.upside)} shown on Google/mo at stake" — both implying impressions. However, `upside` is actually computed as Math.round((opportunity.lowPerMonth + opportunity.highPerMonth) / 2) in build-canonical-changes.ts:232-234, where lowPerMonth and highPerMonth are forecast clicks from the CTR-curve range, not GSC impressions. The adjacent expectedOutcome basis sentence correctly identifies these as clicks ("usually adds X to Y clicks a month"), creating a semantic contradiction where the numeric upside is labeled as impressions but its basis describes clicks.
- **Fix:** Change the comment and label to correctly identify upside as forecast clicks: (1) Update comment lines 413-415 from "c.upside is GSC impressions (times shown on Google), never true market search volume" to "c.upside is the midpoint of the forecast click range from opportunity-math.ts, never raw impressions or demand scores"; (2) Update line 416 label from "shown on Google/mo at stake" to "expected extra clicks a month, at stake" or similar phrasing that aligns with the forecast clicks semantics and matches the expectedOutcome basis sentence.
- **Status:** [ ] not started

## 6. [HIGH/CONFIRMED] Engine confidence 'low' label with 'single_prompt_no_evidence' reason does not prevent recommendation from queuing
- **Where:** `src/domains/recommendations/load-queue.ts:550` (charter: abstention)
- **Issue:** The computeRecConfidence() function correctly identifies and labels recommendations as confidence='low' with reason='single_prompt_no_evidence' when a single-prompt rec has no AISearchSignal, no CompetitorPageBlueprints, and no evidence refs (zero grounded evidence). However, after computing this verdict at line 550 and decorating the rec with engineConfidence at line 576, the decorated queue is returned to the caller without any filtering. Line 613 returns decoratedQueue directly without removing or gating LOW confidence recs. This means recs that are pure guesses (one prompt, zero evidence backing) still appear in the operator's action queue marked 'Lower confidence — optional', inviting action on unvalidated hunches. The label is decorative and not enforceable; no code path prevents the operator from seeing or accepting these suspect recommendations.
- **Fix:** Add a filtering step after the decoration loop (after line 577) to move LOW confidence recs with the 'single_prompt_no_evidence' reason from decoratedQueue to the watchlist. For example: 

```typescript
const { thinSignalRecs, strengthRecs } = decoratedQueue.reduce(
  (acc, rec) => {
    if (
      rec.engineConfidence.confidence === "low" &&
      rec.engineConfidence.reasons.includes("single_prompt_no_evidence")
    ) {
      acc.thinSignalRecs.push(rec);
    } else {
      acc.strengthRecs.push(rec);
    }
    return acc;
  },
  { thinSignalRecs: [] as typeof decoratedQueue, strengthRecs: [] as typeof decoratedQueue }
);

const finalQueue = strengthRecs;
const finalWatchlist = [...prioritized.watchlist, ...thinSignalRecs];
```

Then return finalQueue and finalWatchlist at line 613-614 instead of decoratedQueue and prioritized.watchlist. This gates the thin-signal recs from the main queue, moving them to watchlist where the operator can optionally surface them separately. The low confidence is now enforceable policy, not decorative.
- **Status:** [ ] not started

## 7. [HIGH/CONFIRMED] Missing Intent Clustering: Near-Duplicate Keywords Generate Separate Recommendations
- **Where:** `src/domains/recommendations/generate.ts:163` (charter: new-page-cannibalization)
- **Issue:** Cluster-level recommendations are generated without deduplicating near-duplicate intents (singular/plural variants, common modifiers). When operators assign similar keywords like "Iranian director" and "Iranian directors" to different topic_ids, the system generates separate cluster recommendations with identical or nearly-identical evidence profiles, causing recommendation cannibalization and forcing operators to manually identify and merge duplicates.

Root cause: The dedupeOverlappingClusterRecs function (lines 367-392) only dedupes cluster recs when affectedPromptIds sets are exactly identical. It does not detect or merge clusters with semantically similar labels (singular/plural variants, minor modifiers) that should represent the same intent.

The failure scenario manifests when:
1. Operator tracks prompts "Iranian director" and "Iranian directors" as separate tracked_prompts
2. Both are classified as absent/outranked (weakness categories)
3. Operator assigns them to topics "Iranian director" and "Iranian directors" (or similar near-duplicates)
4. Clustering detects ≥3 prompts in each topic → creates separate ClusterWeakness records
5. generateRecommendations emits two distinct create_cluster_page recs:
   - "Create a Iranian director page" with N prompts + evidence
   - "Create a Iranian directors page" with M prompts + evidence (M ≈ N)
6. Operator views recommendation queue and must manually recognize these are duplicates, or risks shipping two competing pages for the same search intent.
- **Fix:** Add semantic deduplication of cluster labels before cluster recommendation generation. The fix has three layers:

1. **Normalize cluster labels during decision-matrix clustering** (src/domains/prompts/decision-matrix.ts):
   - Import tokenizeForMatch from src/domains/recommendations/page-inventory.ts or src/lib/text-normalize.ts
   - When grouping prompts by topic_id (lines 129-154), normalize the topic_id label to a canonical form before using it as a map key
   - Use foldToken logic to collapse singular/plural variants (director/directors → director, homes/home → home)
   
2. **Deduplicate overlapping cluster recs by normalized label similarity** (src/domains/recommendations/generate.ts):
   - Enhance dedupeOverlappingClusterRecs function (lines 367-392) to also check for near-duplicate labels
   - For clusters with overlapping but non-identical prompt sets, detect if their normalized labels are semantically equivalent
   - When two clusters have similar normalized labels and >50% prompt overlap, merge them:
     * Combine affectedPromptIds sets
     * Keep the geo cluster if available (prefer concrete location)
     * Keep the label from the cluster with more prompts (more evidence)
     * Merge evidence aggregates (primary competitors, dominant competitors)

3. **Example implementation**:
```typescript
// In dedupeOverlappingClusterRecs, after the identical-set dedup pass:
const clustersByNormalizedLabel = new Map<string, RecommendationCandidate[]>();
for (const c of [...clusterByPromptSet.values()]) {
  if (c.type !== "create_cluster_page") continue;
  const normalized = tokenizeForMatch(c.clusterLabel).join("-");
  const list = clustersByNormalizedLabel.get(normalized) ?? [];
  list.push(c);
  clustersByNormalizedLabel.set(normalized, list);
}

// For each normalized label group with multiple clusters, merge by prompt overlap
for (const [, group] of clustersByNormalizedLabel.entries()) {
  if (group.length <= 1) continue;
  // If clusters share >50% prompt overlap and have normalized-equivalent labels,
  // merge into single rec with combined prompt set
  // Prefer geo over topic, larger prompt count as tiebreaker
}
```

This preserves the operator's intent while preventing recommendation cannibalization from near-duplicate keywords.
- **Status:** [ ] not started

## 8. [HIGH/PLAUSIBLE] Sort Tie-Breaker Uses Alphabetical ID Instead of Opportunity Rank (Search Volume)
- **Where:** `src/domains/recommendations/recommendation-action-rows.ts:2138` (charter: new-page-cannibalization)
- **Issue:** The sort function at line 2122-2139 uses alphabetical ID comparison (localeCompare) as the final tiebreaker when all other sort criteria are equal. The operator-facing recommendation queue should rank by search demand/opportunity size, not alphabetically. This causes low-volume queries (like "4 in Farsi") to outrank high-volume opportunities (like "capital of Iran") in the operator-facing queue when they tie on all other dimensions (status=new, tier=now, priority=medium, evidenceDepth=2, observationCount=5).
- **Fix:** The fix requires two steps: (1) Store the maximum search volume from rec.semrushSignal and/or rec.gscSignal.impressions90d into the ActionRowDetail structure during row building (lines 1676-1746, 1830-1892, 1990-2073), (2) Add a search-demand DESC tiebreaker before the ID comparison in the sort function (before line 2138). This requires deriving a numeric searchVolume metric that aggregates SEMrush keyword volume and GSC impressions into a single comparable value.
- **Status:** [ ] not started

## 9. [HIGH/CONFIRMED] Ask page counts immature verdicts as decided, disagrees with Results bands
- **Where:** `src/domains/ask/fact-assembly.ts:447` (charter: outcome-consistency)
- **Issue:** The code filters for verdict="won" or verdict="lost" without verifying measurement maturity. A record can have these stored verdicts from early (7-day) or interim (14-day) checkpoints, which are not final verdicts. Only 28-day windows with sufficient controls (>=2), baseline impressions (>=200), and no attribution overlaps should count as "mature_result" and thus be included in "decided" counts. This causes the Ask answer to report decided verdicts that Results bands correctly classify as "measuring" or "in flight".
- **Fix:** Replace line 447 with a maturity check. The record must achieve "mature_result" status via deriveMeasurementMaturity() to be counted as "decided":

const decided = sorted.filter((r) => {
  const maturity = deriveMeasurementMaturity({
    shippedAt: r.shippedAt,
    now: new Date(),
    latestGscDate: null,
    windows: r.windows ?? [],
    verdict: r.verdict,
    controlsUsed: r.windows?.find((w) => w.day === basisDayOf(r.windows ?? []))?.controlsUsed ?? r.controlPages.length,
    baselineImpressions: r.baseline?.impressions ?? 0,
  });
  return maturity === "mature_result";
});
- **Status:** [ ] not started

## 10. [HIGH/CONFIRMED] Ask measurement facts never exclude revert bookkeeping rows
- **Where:** `src/domains/ask/fact-assembly.ts:447` (charter: outcome-consistency)
- **Issue:** Line 447 filters the ledger for decided changes (verdict='won' or 'lost') WITHOUT calling excludeRevertBookkeeping(). Revert rows carry actionType starting with 'revert_' and are bookkeeping only (Bug #14), but Ask never filters them. This causes reverted losses to be double-counted: Results drops them and shows 1 decided change, Ask shows 2. The canonical lifecycle-counts.ts module filters reverts at the splitLedgerLifecycle choke point; Ask must do the same.
- **Fix:** Import excludeRevertBookkeeping from '@/domains/changes/lifecycle-counts' and apply it to sorted before filtering: const real = excludeRevertBookkeeping(sorted); then const decided = real.filter((r) => r.verdict === "won" || r.verdict === "lost");. Apply the same fix to recentShips and the sorted.slice(0,5) loop below line 456 to ensure consistent filtering throughout the function.
- **Status:** [ ] not started

## 11. [HIGH/CONFIRMED] Ask re-derives decided/won counts, violating the ONE-COUNT RULE
- **Where:** `src/domains/ask/fact-assembly.ts:447` (charter: outcome-consistency)
- **Issue:** Lines 447-448 filter the ledger by verdict field alone (verdict === "won" || verdict === "lost"), re-deriving decided/won without maturity checks, overlap detection, or revert filtering. This violates the ONE-COUNT RULE documented in lifecycle-counts.ts line 40 and creates a three-way disagreement: Results uses splitLedgerLifecycle (mature + no overlap + no reverts), Changes uses countLedgerLifecycle (same rule), but Ask independently counts immature rows and revert bookkeeping. When a ledger has revert rows or immature rows with stored verdicts, Ask displays a different "decided" count than Results and Changes show for the same data.
- **Fix:** Import and use the canonical lifecycle rule:

```typescript
import { splitLedgerLifecycle, countLedgerLifecycle } from "@/domains/changes/lifecycle-counts";

// Replace lines 447-450 in assembleMeasurementFacts:
const split = splitLedgerLifecycle(sorted);
const decided = split.won.concat(split.learned);
const won = split.won.length;
if (decided.length > 0) {
  facts.push(fact(`Of ${decided.length} decided changes, ${won} won and ${decided.length - won} did not help (${Math.round((won / decided.length) * 100)}% win rate).`, "proof", "/results"));
}
```

This ensures Ask counts decided/won exactly as Results and Changes do: revert rows are filtered first (excludeRevertBookkeeping), overlap detection eliminates attribution-limited rows, and only mature outcomes count as decided.
- **Status:** [ ] not started

## 12. [HIGH/CONFIRMED] Citation/recommendation label conflation in headline KPI card
- **Where:** `src/domains/today-summary/build-source-stat-cards.ts:314` (charter: ai-overclaim)
- **Issue:** Line 314 displays the label "AI recommended you" with the value `aeo.totalCitations`. The underlying metric (`totalCitations` from `today-kpis.ts`) sums `citation_count` fields from derived platform-scope snapshot rows. These `citation_count` values represent counts of citation link occurrences (hyperlinks to your domain within AI answers), not primary recommendations (instances where your domain is suggested as the best answer). The data structure in `daily_metric_snapshots` already tracks both: `citation_count` (owned citations) and `primary_recommendation_count` (primary answer suggestions), but the code conflates the two metrics in the UI label. An operator viewing "AI recommended you: 247" will interpret this as "suggested us as the best answer 247 times" when the actual signal is "cited our links 247 times in answer slots." This creates a false understanding of the metric's meaning and importance.
- **Fix:** Change line 314 from:
  { label: "AI recommended you", value: fmtInt(aeo.totalCitations) },
to:
  { label: "AI cited you", value: fmtInt(aeo.totalCitations) },

Alternatively, if `primary_recommendation_count` should be displayed instead, modify `TodayDerivedKpis` type in `today-kpis.ts` to include `totalPrimaryRecommendations`, aggregate it alongside `totalCitations`, and update the label + metric accordingly. The first fix is lower-risk as it corrects the label to match the actual metric being displayed. The second option (using true recommendation counts) would require schema changes to persist `primary_recommendation_count` at platform scope and changes to the aggregation logic.
- **Status:** [ ] not started

## 13. [HIGH/CONFIRMED] Stale Profound account data never filtered from active metrics
- **Where:** `src/domains/attribution/profound-proof-observations.ts:48` (charter: profound-quarantine)
- **Issue:** loadProfoundOwnedCitations reads ALL rows from profound_citation_rows without checking if the Profound account is currently connected. A disconnected account (with disconnected_at set in the connector token) will have all its historical citation data flow into the proof engine's measurement windows, contaminating baseline metrics and causing incorrect causal attribution verdicts. The proof engine only sees the raw citation counts; it has no way to distinguish stale data from an active account. This is confirmed by comparing against the Profound client (src/lib/connectors/profound/client.ts:44) which correctly returns null when disconnected_at is set, preventing fresh API calls. However, loadProfoundOwnedCitations bypasses this check by reading directly from the database table.
- **Fix:** Add a disconnected_at check before returning the citation rows. The function should retrieve the connector token status and return an empty array if the account is disconnected:

```typescript
export async function loadProfoundOwnedCitations(
  tenantId: string,
): Promise<ProfoundOwnedCitation[]> {
  const domain = getBusinessConfig(tenantId).domain?.trim();
  if (!domain) return [];
  const ownHost = hostOf(domain);
  if (!ownHost) return [];

  // GATE: verify the Profound account is still connected
  // (matches the Profound client's disconnected_at check)
  const token = await getConnectorToken("profound", tenantId);
  if (token == null || token.provider !== "profound" || token.disconnected_at) {
    return [];
  }

  type Row = {
    date: string;
    model: string;
    root_domain: string;
    url: string;
    citation_count: number;
  };
  let rows: Row[] | null = null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("profound_citation_rows")
      .select("date, model, root_domain, url, citation_count")
      .eq("tenant_id", tenantId)
      .limit(20000);
    if (error) {
      log.warn("[profound-proof] read failed", { tenantId, error: error.message });
      return [];
    }
    rows = (data ?? []) as unknown as Row[];
  } catch {
    return [];
  }
  if (rows == null || rows.length === 0) return [];

  const out: ProfoundOwnedCitation[] = [];
  for (const r of rows) {
    if (!r.url || !r.date) continue;
    const rowHost = hostOf(r.root_domain || r.url);
    if (rowHost !== ownHost) continue;
    const count = r.citation_count ?? 0;
    if (count <= 0) continue;
    out.push({
      url: r.url,
      date: r.date.slice(0, 10),
      platform: r.model || "unknown",
      count,
    });
  }
  return out;
}
```

The fix adds lines 2-4 (after domain validation) to check if the token exists, is a Profound token, and has no disconnected_at set. This mirrors the pattern used in src/lib/connectors/profound/client.ts:42-45 (defaultGetApiKey). You will need to import getConnectorToken from @/lib/connector-store at the top of the file.
- **Status:** [ ] not started

## 14. [HIGH/CONFIRMED] profoundTopicSignalsLoader never validates account status before aggregating visibility data
- **Where:** `src/domains/recommendation-intelligence/profound-topic-signals.ts:?` (charter: profound-quarantine)
- **Issue:** loadProfoundTopicSignalsForTenant reads profound_visibility_rows for the tenant without checking whether the Profound account is active (disconnected_at in connector_tokens). This allows stale visibility data from a borrowed or abandoned account to flow unchanged into the profound_aeo_gap trigger, producing recommendations anchored on historical competitor observations that are no longer current.
- **Fix:** Add a connector token status check before reading visibility data. Fetch the Profound connector token, check if disconnected_at is set, and filter the visibility rows to only include those pulled_at after the account was last connected and active. If the account is disconnected and has no recent data, return an empty Map so the trigger never fires.

Example implementation:
```typescript
export async function loadProfoundTopicSignalsForTenant(
  tenantId: string,
  ownAliases: ReadonlySet<string>,
): Promise<Map<string, ProfoundTopicSignal>> {
  const out = new Map<string, ProfoundTopicSignal>();
  
  // NEW: Check connector status before reading visibility data
  const token = await getProfoundConnectorToken(tenantId);
  if (token == null || (token.disconnected_at != null && token.disconnected_at !== "")) {
    // Account is not connected or has been disconnected - no valid data to aggregate
    return out;
  }

  const rows: Row[] = [];
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_visibility_rows")
        .select("category_id, model, asset_name, share_of_voice, mentions_count, executions")
        .eq("tenant_id", tenantId)
        .order("category_id")
        .range(offset, offset + PAGE_SIZE - 1);
      // ... rest of the function
```

Additionally, import `getProfoundConnectorToken` from `@/lib/connector-store` at the top of the file.
- **Status:** [ ] not started

## 15. [HIGH/CONFIRMED] Profound gap-fill never validates account freshness, leaking stale borrowed-account data into proof baseline
- **Where:** `src/domains/attribution/profound-proof-observations.ts:48` (charter: profound-quarantine)
- **Issue:** The loadProfoundOwnedCitations function reads all rows from profound_citation_rows WITHOUT filtering by pulled_at timestamp. When a borrowed Profound account's sync stops (key revoked), the rows remain indefinitely with stale pulled_at values. buildUrlCitationHistory accepts these without freshness validation, allowing stale rows to backfill baseline periods for diff-in-diff analysis, poisoning the proof engine's control period with dead-account data.
- **Fix:** Add account-freshness validation: filter rows to only those pulled within the last N days (e.g., 7-14 days). Check max(pulled_at) and return empty if stale, logging a warning so operator can reconnect the key. This prevents stale borrowed-account data from contaminating the proof baseline.
- **Status:** [ ] not started

## 16. [HIGH/CONFIRMED] Nightly sync path never updates last_synced_at even on success
- **Where:** `src/app/(shell)/diagnostics/connectors/actions.ts:122` (charter: connector-state)
- **Issue:** refreshAllDataSources() calls sync engines and classifies outcomes but never stamps last_synced_at, unlike /settings/connectors on-demand Sync now which does via writeLastSyncedAt(). getConnectorHealth() reports health=connected based on stale last_synced_at from 10 days ago, even though nightly cron is broken.
- **Fix:** Import updateConnectorToken from @/lib/connector-store. After each sync succeeds (outcome refreshed), call updateConnectorToken to stamp last_synced_at. Follow pattern in /settings/connectors/actions.ts lines 852-884 (writeLastSyncedAt) and 901-903. Wrap in try/catch so freshness-write failures never flip successful syncs to reported failures. Map each provider to its connector-store key: profound->profound, gsc->google_gsc, clarity->clarity, semrush->semrush, ga4->google_ga4.
- **Status:** [ ] not started

## 17. [HIGH/CONFIRMED] Health check ignores null last_synced_at for non-cached sources, hiding broken ingestion
- **Where:** `src/lib/connector-store.ts:549` (charter: connector-state)
- **Issue:** getConnectorHealth deliberately skips alarming on null/empty last_synced_at (line 555 guard), justified by a comment that it is unreliable for GSC which has cached data. However, for API-key sources like Profound, Clarity, Semrush (all REAL_DATA_SOURCE_PROVIDERS), null last_synced_at genuinely means zero data ever synced—no cache exists. An operator connecting Profound on day 1 whose nightly sync fails (API error, bad key) will see health='connected' green checkmark on /today despite never ingesting any data, deceiving them into believing data is flowing.
- **Fix:** Add a pre-flight check after the Wix exemption (after line 547) to alarm on never-synced non-cache sources: if provider is not google_ssc, google_gbp, or wix, and last_synced_at is null, return needs_attention with reason "Connected — pull your first reading to start flowing data."
- **Status:** [ ] not started

## 18. [HIGH/CONFIRMED] On-demand 'Sync now' stamps last_synced_at even on zero-row success, masking empty data
- **Where:** `src/app/(shell)/settings/connectors/actions.ts:?` (charter: connector-state)
- **Issue:** In runConnectorSyncNow (lines 901-902), the code stamps last_synced_at whenever summary.ok=true, including when the sync returned zero rows (e.g., Profound synced:true but citation_rows=0 and visibility_rows=0). The summarizeConnectorSync function treats a zero-row sync as success (line 804 returns ok:true, detail: "Synced — nothing new found yet."). Later, the health check (connector-store.ts lines 555-568) reads this fresh last_synced_at and returns health='connected', misleading operators into thinking real AI-mention data is flowing when the ingestion tables are actually empty. This masks data connectivity issues and prevents honest alerting on empty workspaces.
- **Fix:** Modify runConnectorSyncNow to stamp last_synced_at only when the sync produced actual data rows, not just when it completed successfully. Add a data-presence check before line 902:

```typescript
// Check if the sync actually ingested rows, not just ran successfully
const hadData = 
  (result as any)?.citation_rows > 0 ||
  (result as any)?.visibility_rows > 0 ||
  (result as any)?.rows_upserted > 0 ||
  (result as any)?.imported > 0 ||
  (result as any)?.days > 0;  // For GSC/GA4

if (summary.ok && hadData && freshnessProvider != null) {
  await writeLastSyncedAt(freshnessProvider, tenantId);
}
```

This ensures the freshness timestamp reflects genuine data arrival, not just a successful (but empty) sync run. The health check will then correctly show "needs_attention" for connected sources with no actual data yet.
- **Status:** [ ] not started

## 19. [HIGH/CONFIRMED] Answer-block directive lacks explicit source/fact-check requirement in operator-facing instructions
- **Where:** `src/domains/recommendation-intelligence/draft-enrichment.ts:1023` (charter: draft-safety)
- **Issue:** The composeAnswerBlockDirective function (lines 1013-1031) returns proposed_text that instructs operators to "Add a 2–3 sentence direct answer" with formatting requirements (first sentence names subject, stands alone if quoted, ~40-60 words, visible body text). However, the directive text does NOT explicitly require sources, verification, or fact-checking before the answer is accepted. The code docstring (line 1000-1004) states "factual correctness + voice are the owner's, and fabricating cultural/historical facts is a hard rail," but this is a code comment, not part of the visible operator directive. The downstream validation gate (validateDeterministicDraftSafety in specific-edit-validator.ts) checks for placeholders, superlatives, brand claims, em dashes, and brand name style—but does NOT validate that sources exist or that fact-checking was performed. An operator could paste an unsourced historical/cultural claim (e.g., for Iranopedia's "What is Chaharshanbe Suri?" page) and the directive provides no gate preventing acceptance.
- **Fix:** Update the proposed_text in composeAnswerBlockDirective to explicitly require sources and fact-checking. Example revision (lines 1023-1026):

```typescript
proposed_text:
  "This page targets the question “" +
  question +
  "” but doesn't answer it up front. Add a 2–3 sentence direct answer (about 40–60 words) as the FIRST content block, right under the headline — before any intro. The first sentence must NAME the subject explicitly (no “it” / “this”) and state the answer so it stands alone if quoted out of context. IMPORTANT: Your answer must be sourced and fact-checked. Cite reliable sources for factual claims, especially for cultural/historical topics. Do not add unsourced claims. If a heading covers this topic, phrase it as the actual question and put the answer directly beneath it. Keep it as visible body text — don't rely on FAQ markup (Google retired FAQ rich results in 2026).",
```

Additionally, add a validation gate to check that proposed_text for add_answer_block action types contains evidence of sourcing (e.g., citation patterns, reference markers) before allowing acceptance, or require an explicit source-citation field on the edit row.
- **Status:** [ ] not started

## 20. [HIGH/CONFIRMED] buildTodayLiveChanges sorts by recency alone, ignoring verdict maturity
- **Where:** `src/domains/today/live-changes-data.ts:?` (charter: today-job)
- **Issue:** The function ranks all verified_live changes by liveAt timestamp descending without filtering or de-ranking mature verdicts (helping/hurting) that are 7+ days old. This causes the Working card to surface closed/resolved cases ahead of active, undetermined changes, obscuring actionable items with stale verdict batches.
- **Fix:** Add verdict-maturity filtering in the sort and slice. De-rank or exclude changes with mature verdicts (helping/hurting/not_implemented) older than 7 days, OR use a secondary sort by (daysSinceLive, verdict-type) to rank undetermined/early-signal changes ahead of closed verdicts. Example fix (lines 257-263): 

```typescript
// Prioritize: undetermined < early-signal < old-closed-verdicts
out.sort((a, b) => {
  // Verdicts less than 3 days: fresh, always prioritize
  if (a.daysSinceLive < 3 && b.daysSinceLive >= 3) return -1;
  if (a.daysSinceLive >= 3 && b.daysSinceLive < 3) return 1;
  
  // Secondary: de-rank mature closed verdicts (7+ days old with helping/hurting)
  const aIsMatureVerdict = a.daysSinceLive >= 7 && (a.currentVerdict === "helping" || a.currentVerdict === "hurting");
  const bIsMatureVerdict = b.daysSinceLive >= 7 && (b.currentVerdict === "helping" || b.currentVerdict === "hurting");
  if (aIsMatureVerdict && !bIsMatureVerdict) return 1;
  if (!aIsMatureVerdict && bIsMatureVerdict) return -1;
  
  // Tertiary: by recency (most recent first)
  if (a.liveAt !== b.liveAt) return b.liveAt.localeCompare(a.liveAt);
  return a.recEditId.localeCompare(b.recEditId);
});

return out.slice(0, max);
```

Add a test covering the scenario: 5 changes from day 0 with verdicts by day 2, sorted at day 7+, should not appear ahead of a fresh day-7 change with no verdict yet.
- **Status:** [ ] not started

## 21. [MEDIUM/CONFIRMED] Stale 'nightly proof run' comment references offline cron system
- **Where:** `src/app/(shell)/diagnostics/page.tsx:409` (charter: automation-contract)
- **Issue:** Comment at line 409 says "The fastest way to confirm the nightly proof run is producing real `computed` outcomes" — terminology that implies scheduled cron automation. However, per NEXT_PHASE_EXECUTION_PLAN.md (2026-06-15): "CRONS OFF, ON-DEMAND" and vercel.json has empty "crons": []. The proof outcomes are now operator-triggered on-demand, not produced by automated nightly crons. The phrase "nightly proof run" creates false impression of scheduled automation when all crons have been disabled.
- **Fix:** Update the comment to remove "nightly proof run" terminology and clarify that proof outcomes are displayed from persisted data, now populated on-demand: Replace "The fastest way to confirm the nightly proof run is producing real `computed` outcomes." with "The fastest way to confirm the Proof Engine is computing real outcomes (on-demand, operator-triggered)." or similar language that removes the "nightly" implication of automated scheduling.
- **Status:** [ ] not started

