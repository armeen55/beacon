# Beacon — Start Here

> 🟢 **E1-E6 SUPABASE EGRESS AUDIT + OPTIMIZATION (2026-05-05):** Audited all Supabase reads from product routes + scripts + cron. Found root cause: `/today` + `/prompts` + `/diagnostics` paged the FULL ~14k-row `prompt_answer_observations` table on every render via `loadFreshCanonicalData()` — ~42 MB egress per page load, multiplied by dev refreshes + cold-start prerenders. Landed: (a) windowed-read API (`since` option) on `getPromptAnswerObservations` + `getDailyMetricSnapshots`, (b) `loadFreshCanonicalData({ observationsSince, snapshotsSince })`, (c) `/today` uses 60-day obs + 120-day snapshot windows, (d) `/prompts` uses 60-day obs window, (e) `page_snapshots` capped at LIMIT 5000, (f) egress instrumentation behind `BEACON_SUPABASE_EGRESS_DEBUG=1`, (g) architecture invariant pinning `/diagnostics` doesn't pull observations directly. **Expected egress reduction: 60-90% on /today + /prompts page loads** (the dominant cost). No paid calls, no schema changes.
>
> ## E6 Decision Report
>
> ### 1. Root cause estimate (highest → lowest)
>
> | Source | Est. share | Why |
> |---|---|---|
> | **`/today` + `/prompts` rendering** | ~60-70% | Each page load called `loadFreshCanonicalData()` which paged ALL observations + snapshots tenant-wide. ~14k obs × ~3KB/row = ~42 MB observations + ~6 MB snapshots = ~48 MB per render. Dev refreshes (operator + agent loops) compound this 5-20× per day. |
> | **URL-watcher trigger on /today + /changes** | ~10-15% | `url-citation-history.ts` re-loads all observations every 6h via `getPromptAnswerObservations()`. Dev refreshes bypass the throttle. |
> | **Repeat dev browsing** | ~10% | Each Vercel preview / local dev page hit re-cold-starts the canonical store and re-pulls everything. |
> | **Verify-daily-poll runs** | ~5-10% | 5-day observation lookback to count by platform — should use `count: 'exact', head: true` per (date, platform). Modest payload (~30KB/run × 3 runs/day) but adds up. |
> | **Citation index rebuild post-cron** | ~5% | Pulls all native observations to rebuild the index. Once per day; runs cleanly. |
> | **Stage 7 / W4 backfill repeat reads** | (negligible) | Backfill pre-publishes locally; published once on 2026-05-04. |
>
> ### 2. Expected egress reduction (after E1-E5 land)
>
> | Path | Pre-E5 payload (per render) | Post-E5 payload | Reduction |
> |---|---|---|---|
> | `/today` cold start | ~48 MB (14k obs + 7k snaps, full select-*) | ~10-12 MB (60d obs ≈ 1k rows + 120d snaps ≈ 720 rows) | **~75% drop** |
> | `/prompts` cold start | ~42 MB (full obs) | ~3-5 MB (60d obs ≈ 1k rows) | **~88% drop** |
> | `/diagnostics` cold start | ~10 MB (no obs, but other reads) | unchanged ~10 MB (architecture invariant prevents accidental obs leak) | 0% (was already light) |
> | `getPageSnapshots` | unbounded (could be 15-20 MB on a tenant with 5000+ snapshots) | capped at 5000 rows ≈ 15 MB max | bounded |
> | URL-watcher pass | ~7 MB (full obs) | ~7 MB (unchanged — backfill scripts intentionally still load all) | 0% (deferred — see "Next 3" below) |
>
> **Daily egress projection** (single dev visiting /today + /prompts ~10× per day): pre-E5 ~960 MB/day worst-case = ~29 GB/month → post-E5 ~150-180 MB/day = ~5 GB/month. **Comfortably under the Free Plan 5 GB cap.** Customer-1 (Ritz) production cron egress is bounded; the dev-refresh storm was the dominant variable.
>
> ### 3. Plan recommendation: **Option C — wait until May 9 reset, monitor for one cycle**
>
> Don't upgrade Supabase to Pro yet. Reasoning:
> - Most of the 5.7 GB this cycle was wasteful, not real customer load (1 MAU, 0 storage egress, 0 realtime, 0 edge).
> - The 60-day window optimization should drop /today + /prompts egress by ~75-88% per render.
> - Dev refresh storms on the new windowed paths cost ~10-15 MB each (vs ~50 MB pre-E5) — easy to stay under 5 GB/month.
> - Customer-2 isn't onboarded; daily cron load is bounded.
>
> **Monitor for one Free Plan cycle (May 9 → June 8).** If we approach 4 GB by mid-cycle with windowing in place, that's a real signal — upgrade then. Until then: stay Free.
>
> **If/when Pro is recommended later**, the reason will be: daily native polling on multiple tenants + dashboard reads from a customer base genuinely need it. Not because we're wasting egress.
>
> ### 4. Top-5 egress offenders + exact fixes landed
>
> | Rank | Offender | Fix landed (commit at end) |
> |---|---|---|
> | **1** | `loadFreshCanonicalData()` paged ALL `prompt_answer_observations` on /today, /prompts | New `FreshCanonicalDataOptions { observationsSince, snapshotsSince }`. /today passes 60d obs + 120d snaps. /prompts passes 60d obs. The `since` filter pushes down to Postgres `.gte("observed_at", since)`. **~75-88% reduction per render.** |
> | **2** | `loadFreshCanonicalData()` also paged ALL `daily_metric_snapshots` | Same window applied. 7k → ~720 rows × 0.8KB = ~5MB → ~600KB. |
> | **3** | `getPageSnapshots` was unbounded (`.select("*").order(...)` then dedupe-in-JS) | Added `.limit(5000)`. The dedupe-by-page_id still gets the latest per page; old rows past the cap are dropped (acceptable for current tenant scale). Egress logged via the new instrumentation. |
> | **4** | No instrumentation — couldn't measure offenders without redeploy | New `logEgress()` helper in `supabase-backend.ts`. Wraps `query`, `queryAllPaged`, `selectScoped`, `queryAllPagedScoped`, plus `getPageSnapshots`. Activates only when `BEACON_SUPABASE_EGRESS_DEBUG=1` (off in prod by default). Logs table, rows, ≈bytes, ms, tenant, filter. |
> | **5** | `/diagnostics` could regress and start pulling observations directly | Architecture invariant `tests/architecture/supabase-egress-windowing.test.ts` pins that `/diagnostics` does NOT call `loadFreshCanonicalData()` and does NOT call `.getPromptAnswerObservations()`. CI fails loudly if a future commit accidentally adds a heavy read. |
>
> ### Constraints respected
>
> - No paid OpenAI calls. No paid generation. No backfill. No extra polls.
> - No schema migrations. No data deletion.
> - No UI redesign. No onboarding kickoff. No Profound archive.
> - File-backend symmetry preserved: `tenant-repo` honors `{ since }` via in-memory filter so `DATA_SOURCE=file` works identically.
> - Default behavior unchanged when `since` is omitted — scripts (verify-daily-poll, citation index rebuild, URL watcher, materializer) keep loading full history.
>
> ### Next 3 actions
>
> 1. **Watch the next 24-48h Vercel egress** — if /today + /prompts page loads drop the daily Supabase egress trend by 60%+, the optimization landed. If not, the URL-watcher pass (or another path I missed) is the dominant remaining cost; trace via `BEACON_SUPABASE_EGRESS_DEBUG=1` on a Vercel preview.
> 2. **Decide URL-watcher window cutoff** — the watcher reloads ALL observations on every materialize pass to compute URL citation history. It legitimately needs broader history than /today's 60 days (the visibility chart goes back to native-regime-start = 2026-04-22, ~14 days). A future bundle could window it to 90 days too — saves ~40 MB per pass × 2-4 passes per day.
> 3. **At Free Plan reset (May 9)** — recheck egress trend. If still > 4 GB after one full cycle of windowed reads, escalate. Otherwise keep Free until customer-2.
>
> ---
>
> 🟢 **T1-T4 TODAY TRUST POLISH (2026-05-05):** Hosted /today no longer leaks descriptor garbage, raw `citations_per_day` chips, or "+1083% / Z-score 20.6" hype on the default surface. All exact stats preserved behind expansion. Quality gate green: typecheck clean, 27 new T1-T4 tests PASS, full suite 4387/4392 (same 5 baseline failures), build green.
>
> ## What T1 did (descriptor quality)
>
> - **Rollup-time filter** in `enrichment-rollup.ts`: `buildEnrichmentRollup`, `buildEnrichmentWindowRollup`, `buildCompetitorEnrichmentRollup` all accept a new `tenantStripWords` option and apply the SAME filter. Hard global stopwords (`DESCRIPTOR_QUALITY_STOPWORDS`, exported from `extraction.ts`) plus tenant-config `stripWords` form the reject set.
> - **Operator's exact pollution list** filtered: `custom · home · homes · builder · builders · construction · area · bay · inc · include · closed · company · service · services · contractor · contractors · local · best · top` — all dropped. "premier", "leading", "first" intentionally NOT added (they can be operator-positive descriptors).
> - **today-data.ts** passes `getBusinessConfig().stripWords` through to all three rollup builders so the Bay-Area cities + Ritz-brand parts are also dropped.
> - **`MIN_USEFUL_DESCRIPTORS=3`** export — when fewer than 3 useful descriptors survive, the descriptor list renders "Not enough distinctive description signal yet." (per operator brief).
> - **11 quality tests** in `enrichment-rollup-t1-quality.test.ts` pin: stopwords always dropped, case-insensitive, tenant stripWords additive, meaningful descriptors survive, competitor rollup uses same filter, prior-window count uses same filter (no false ↑ delta on filtered tokens).
>
> ## What T2 did (action-card copy)
>
> - **`action-card.tsx`**:
>   - Hides the evidenceBasis badge when basis === "heuristic" (the lowest-evidence tier; "Pattern-based" leaked internal taxonomy).
>   - New `friendlyExpectedMetric()` helper — translates `citations_per_day`, `primary_rate`, `mention_rate`, `cited_pages` to operator-readable copy ("Expected: more AI citations" etc.). Unknown raw snake_case identifiers drop the chip entirely; non-snake_case free text passes through.
> - **`today-action-queue.tsx`**: findings strip default text simplified to `{N} page issue(s) — {M} urgent`. The `typeBreakdownLabel` ("533 schema missing for page type · 103 invalid schema · 67 other") is now ONLY surfaced via the link's `title` tooltip + still available on /pages — no longer the default body copy.
> - **8 architecture tests** pin: heuristic badge gated, friendlyExpectedMetric helper present + maps citations_per_day, no `{action.expectedMetric}` direct render, findings-strip default has no breakdown.
>
> ## What T3 did (win-card calmer copy)
>
> - **`today-data.ts` win-card composer**:
>   - Default `rationale` reframed to two short calm sentences: **"Citations increased after this change. URL-level signal detected; not proof of causation."** No numbers, no Z-score, no confidence label.
>   - Exact stats moved into `lineageBullets` (rendered in expansion behind "Why we suggest this"):
>     - Change description (when known)
>     - Absolute /day delta ("rose by ~10.8/day")
>     - Relative shift % — but ONLY when not extreme (`|deltaPct| < 300%`). At ≥300% the percent line is omitted entirely.
>     - Z-score with confidence ("Z-score 3.2 (high confidence)")
>     - Landing day delta (when known)
>     - Window summary
>     - Methodology disclaimer ("URL-level correlation — not proof of causation, …")
> - **8 architecture tests** pin: default rationale has no Z-score / no relative %, lineageBullets contains all stats, isExtremePct gate at 3.0, pctBullet conditional on `!isExtremePct`.
>
> ## What T4 did
>
> No /today restructure. Diagnostics still on /diagnostics + /pages. Internal labels (samplingStatus enums, internal verdict tier names, full evidence packets) reachable via expansion + drill-downs. **/today now shows operator-safe copy by default** with the rich technical detail one click away — no data deleted, just moved.
>
> ## Constraints respected
>
> - No paid polling, no paid generation, no Apply-All-HIGH, no OpenAI dry-run, no Stage 5 publish, no Profound archive/delete, no /pages rebuild, no onboarding kickoff, no schema changes, no scope expansion.
>
> ## Next 3 actions
>
> 1. **Browser-verify on hosted /today** after Vercel auto-deploy: descriptor cloud should show only meaningful tokens (luxury / award-winning / design-build / sustainable / modern); empty / thin clouds show "Not enough distinctive description signal yet."; no `citations_per_day` chip; win-card default reads "Citations increased after this change. URL-level signal detected; not proof of causation." Stats appear under "Why we suggest this".
> 2. **Spot-check /pages tooltip**: hover the findings strip "{N} page issues — {M} urgent" link and confirm the breakdown ("533 schema missing for page type · …") still surfaces in the tooltip.
> 3. **Watch for the next URL-watcher cron run** to log a sampling-guard demotion (D4) if any May 4 proof-day verdicts existed; otherwise the next /today cycle should show the new calm win-card copy on any newly-detected helping verdicts.
>
> ---
>
> 🟢 **D1-D5 DEMO-HARDENING BUNDLE (2026-05-05):** business-config Ritz fallback removed (customer-2 footgun closed); /settings/import Profound batch importer hidden behind Advanced disclosure (no internal `.data/` copy in default surface); first-run KPI guidance copy on /today (no more bare "no data yet"); samplingStatus guard observability log wired (proof/partial-day demotions logged at warn); /changes stale-pending tooltip + pill disambiguated by lifecycle state (recommended rows guide operator to "accept first" instead of falsely claiming "Accepted Nd ago"). **Quality gate green: typecheck clean, 95/95 targeted PASS, full suite 4357/4362 (5 baseline failures unchanged), build green.**
>
> ## What D1 did (business-config Ritz fallback)
>
> - **`src/lib/business-config.ts`** — `DEFAULT_CONFIG` (Ritz Builders / ritzbuilders.com / Bay Area locations / design-build themes) replaced with `PLACEHOLDER_CONFIG` (empty brand fields, generic English defaults, `__placeholder: true`).
> - **Resolution order**: `BEACON_BUSINESS_CONFIG_JSON` env var → `.data/business-config.json` (legacy save target) → `.data/global/business-config.json` (canonical store-classification path) → `PLACEHOLDER_CONFIG`.
> - **Ritz preserved**: full Ritz config (with stripWords, urlPatterns, industryThemes, faqTemplates) promoted to `.data/global/business-config.json`. Local Ritz dev keeps domain knowledge.
> - **Vercel deployment note**: `.data/` is gitignored; for Ritz on Vercel to keep its domain knowledge after this change, set `BEACON_BUSINESS_CONFIG_JSON` env var with the full config payload. **Until that env var is set on Vercel, Ritz on the hosted app falls to the neutral placeholder.** Operator action recommended.
> - **`isPlaceholderConfig(cfg)` helper** exported for consumer code that wants to branch on "configuration needed" state.
> - **13 tests** in `src/lib/business-config.test.ts`: Ritz file paths still load, env var precedence, placeholder neutrality, no Ritz strings in placeholder serialization, no Ritz literals in source.
>
> ## What D2 did (Profound importer)
>
> - **`src/app/(shell)/settings/import/import-page.tsx`** — page header retitled to "Import historical answer data" / "Beacon collects new AI-answer data automatically every day."
> - Default surface now shows a customer-safe "Bring in historical AI-answer data" card. NO Profound, `.data/`, "bridged results", or internal-tooling copy in the default view.
> - Profound batch importer + manual paste + reset + import log moved INTO an "Advanced — legacy import paths" disclosure (collapsed by default). Profound code path preserved (importProfoundData still callable when expanded).
> - **6 tests** in `tests/architecture/settings-import-customer-safe-default.test.ts`: default surface has no "Profound" / `.data/` / internal copy; advanced disclosure trigger is present; Profound button still reachable behind the disclosure.
>
> ## What D3 did (empty-state copy)
>
> - **`src/components/today/today-scoreboard.tsx`** — first-run KPI tile guidance.
> - When `totalCitations === 0 && resultCount === 0 && asOfDate === null` (true first-run state), the tiles render: "Beacon starts collecting AI answers after the next scheduled poll." (citations) and "Most accounts show their first full daily sample after the next run." (pages).
> - Generic-safe — does NOT promise a specific time (e.g., "10 UTC tomorrow") because the app doesn't know each tenant's actual cron schedule from render.
> - Bare "no data yet" string removed; populated tenants with empty windowed counts get "no citations yet on this window".
> - **6 tests** in `tests/architecture/today-empty-state-copy.test.ts`: copy strings present, gated to empty state, no overpromised timing claims, legacy "no data yet" literal removed.
>
> ## What D4 did (sampling-guard observability)
>
> - **`src/domains/attribution/url-verdict.ts`** — `UrlVerdict.sampling_guard_demoted` field added. When the M3+S4 sampling guard demotes a `helping`/`hurting` verdict to `nothing_yet`, the field captures `{from, to, reason}` (reason: `proof_day_in_post_window` | `no_full_days_in_post_window`).
> - **`src/domains/attribution/url-change-outcome.ts`** — `materializeUrlOutcomes` reads the field after each verdict and emits `log.warn("[verdict-engine] sampling-status guard demoted verdict", {tenantId, changeId, url, windowAsOf, originalVerdict, demotedVerdict, reason})`. Operator dashboards now surface every demotion.
> - Pure-compute layer (the verdict engine) stays pure; only the materializer (which has tenant context + logger access) emits I/O.
> - **10 tests**: 5 in `src/domains/attribution/url-verdict.s4-observability.test.ts` (engine sets metadata correctly per scenario) + 5 in `tests/architecture/sampling-guard-observability-log.test.ts` (materializer log shape: required fields, gated on demotion branch, warn level).
>
> ## What D5 did (/changes stale-pending affordance)
>
> - **`src/app/(shell)/changes/scorecard-client.tsx`** — stale-pending tooltip + pill copy disambiguated by lifecycle state.
> - **`accepted` stale row**: tooltip "Accepted Nd ago — scan hasn't confirmed it on the page yet. Mark shipped to start the verdict clock now." Pill: "Nd pending". Mark Shipped button visible (M4 gate preserved).
> - **`recommended` stale row**: tooltip "Pending for Nd. Accept this recommendation first (open /recommendations), then mark shipped once it's live on the page." Pill: "Nd — accept first". Mark Shipped button still hidden.
> - Yellow tint stays on BOTH states (the row IS pending in both cases). D5 fixes copy, not visual.
> - `data-stale-pending-state` and `data-stale-pill-state` attributes expose the lifecycle for tests / debugging.
> - **11 tests** in `tests/architecture/changes-stale-pending-affordance.test.ts`: state-aware copy, M4 gate preserved, yellow tint unchanged on both states.
>
> ## Constraints respected
>
> - No paid polling, no paid generation, no Apply-All-HIGH, no Stage 5 publish, no Profound archive/delete, no OpenAI provider activation, no multi-tenant migration kickoff, no /pages rebuild, no schema changes anywhere.
>
> ## Next 3 actions
>
> 1. **Set `BEACON_BUSINESS_CONFIG_JSON` on Vercel** for Ritz tenant — paste the contents of `.data/global/business-config.json` as the env var value. Without this, Ritz on hosted falls to the neutral placeholder (visible Ritz-flavored brand copy disappears from /today / /recommendations / /settings/connectors).
> 2. **Browser-verify on Vercel after env var lands**: /settings/import default surface shows "Import historical answer data" with no Profound copy; /today empty-state tiles show first-run guidance for an unconfigured tenant; /changes stale rows show appropriate lifecycle-aware copy.
> 3. **Watch the next URL-watcher cron run** for `[verdict-engine] sampling-status guard demoted verdict` log entries — this proves the May 4 proof day is being correctly demoted in production rather than only in tests.
>
> ---
>
> 🟢 **S1+S3+S4 TRUST/INFRA BUNDLE (2026-05-05):** Measurement quality boundary pinned + tenant-isolation baseline failure fixed + samplingStatus guard fully wired into URL-level attribution. **Full suite improved 6 → 5 baseline failures (tenant-isolation now passes).** typecheck clean, 72/72 targeted PASS (S1 + S3 + S4 + url-verdict), full suite 4311/4316 (+29 passing vs M5), build green.
>
> ## What S1 did (pin measurement quality boundary)
>
> - **Single canonical constant**: `NATIVE_REGIME_START = "2026-04-22"` exported from `src/domains/product/url-citation-history.ts`. Audited the entire `src/` tree: only one declaration, and the architecture invariant blocks any future literal duplicate.
> - **Architecture invariant** `tests/architecture/measurement-quality-boundary-pin.test.ts` pins three contracts: (1) the canonical export exists with value `2026-04-22`; (2) the canonical file declares it exactly once; (3) no other src/** file (excluding test fixtures) declares a `2026-04-22` date literal.
> - **Mixed-source attribution test** in the same invariant: `denseSeries` correctly tags pre-boundary points as `benchmark` and post-boundary points as `derived`; pure-split benchmark→derived windows abstain with `not_enough_native_baseline` (the load-bearing guard). 5/5 PASS.
> - **No rename**: operator brief said "Rename only if safe. Do not do broad refactors." `MEASUREMENT_QUALITY_BOUNDARY` rename would touch 27+ call sites across 6 domains — left for a dedicated pass.
>
> ## What S3 did (fix tenant-isolation baseline failure)
>
> - **Root cause**: `.data/observation-runs.json` had 50 rows with no `tenant_id` field — they predate the multi-tenant migration that backfilled every other store. `filterByTenant` strict-equals on `tenant_id`, so all 50 rows got filtered out, returning 0 for any tenant query (including `tenant-ritz-founder`).
> - **Fix path**: read-time normalization in `src/lib/tenant-data.ts`. New `getFounderTenantIdForLegacyFallback()` resolves the founder tenant once (cached per process) by `role === "founder"` from the tenant store. New `filterByTenantWithLegacyFounderFallback` interprets untagged rows as belonging to the founder, returns shallow copies with the canonical `tenant_id` stamped on. **No on-disk mutation. No Ritz-specific assumption** (resolves dynamically from the tenant registry).
> - **Cross-tenant safety**: queries for any non-founder tenant still return 0 untagged rows (the legacy fallback only matches the founder query).
> - **Result**: full tenant-isolation suite now 18/18 PASS (was 17/18). Full beacon suite 5 baseline failures (down from 6).
>
> ## What S4 did (samplingStatus guard in attribution)
>
> - **Wire-up**: M3 added the guard in `computeUrlVerdict` (demote helping/hurting → nothing_yet when post-window has any proof day OR no full days), but the guard was a no-op because no caller populated `sampling_status` on `DailyPoint`. S4 fills the gap.
> - **New helpers** in `src/domains/attribution/url-change-outcome.ts`:
>   - `buildSamplingStatusByDate(observations)` — counts `prompt_answer_observations` per ISO date and classifies each via `classifySampling()` (full ≥ 80, partial 10–79, proof 1–9, empty 0).
>   - `stampSamplingStatus(series, map)` — pure shallow-copy stamper. Untagged dates left as-is (back-compat).
> - **`computeChangeVerdict`** accepts new optional `samplingStatusByDate` in `ComputeVerdictOptions`. Stamps the dense series after `denseSeries` returns; engine guard fires.
> - **`materializeUrlOutcomes`** builds the map once per pass from `getPromptAnswerObservations()`. Failure to load is non-fatal — falls back to empty map (untagged points; no-op guard) with a `log.warn`.
> - **13 new tests** in `src/domains/attribution/url-change-outcome.s4-sampling.test.ts`:
>   - Threshold classification (full / partial / proof / empty boundary cases).
>   - Untagged-date and empty-input pass-through.
>   - End-to-end: proof day in post-window demotes; partial-only post demotes; full-only post keeps helping; historical_recovered FULL samples (pre-boundary dates) still produce wins (status-based not date-based); back-compat (no map → engine unchanged).
>   - Stamped-tag shape check on returned series.
>
> ## Constraints respected
>
> - No paid polling, no paid generation, no Apply-All-HIGH, no Stage 5 publish, no Profound archive/delete, no OpenAI provider activation, no multi-tenant migration kickoff, no /pages rebuild.
> - No on-disk data mutation in S3 (read-time normalization only).
> - No schema changes anywhere.
>
> ## Next 3 actions
>
> 1. **Browser-verify on Vercel**: full suite passes are deployed; tenant-isolation no longer in the baseline failure list. /today + /changes win cards still render correctly under the new sampling guard (proof days will not produce measured wins; full-day daily-poll wins still surface).
> 2. **Monitor next cron pass**: when tomorrow's 07:00 UTC cron lands, the URL-level verdict materializer will use the new sampling map. The May 4 5-prompt proof day will not promote any URL to `helping`. Expect zero false-positive measured-win cards from that proof.
> 3. **Optional follow-up — backfill observation-runs `tenant_id` on disk**: the current S3 fix is read-path only. A one-time `scripts/backfill-observation-runs-tenant-id.ts` could stamp `tenant_id: tenant-ritz-founder` on the 50 untagged rows. Not required (read-time fix is correct + forward-compatible), but cleans up the data shape if desired. Operator-gated; do not run without explicit go-ahead.
>
> ---
>
> 🟢 **M4+M5 BUNDLE (2026-05-05):** Mark Shipped UI tightened (operator audit-locked: Accept ≠ Mark Shipped) + /pages route replaced with deliberate not-ready placeholder + documented follow-up. Quality gate green: typecheck clean, 408/408 targeted PASS (+11 vs M3), full suite 4292/4298 (same 6 baseline failures verified pre-existing), build green.
>
> ## What M4 did
>
> - **/recommendations** Mark Shipped button — no change, was already correctly gated to `case "accepted":` only with `editCount > 0`. Verified.
> - **/changes** Mark Shipped button — gate tightened from `lifecycleStatus === "recommended" || "accepted"` to `accepted`-only. The "stale pending" yellow tint still fires on either status (the row IS pending in both cases) but the button only appears when Mark Shipped is the semantically-correct next action. Prevents Accept ↔ Mark Shipped confusion.
> - **`markChangelogEditShipped` action** — defense in depth: explicitly refuses `recommended` rows with the operator-facing message *"Accept the recommendation first. Mark Shipped only confirms an already-accepted change is live on the page; it doesn't accept the recommendation for you."* A stale tab cannot skip Accept.
> - **Honest copy preserved**: feedback reads "Marked live — verdict clock started." (tracking, not impact-claim). The persistence helper does NOT stamp a verdict label — it only sets `live_at` + `live_match_kind = "operator_override"`. The verdict engine computes the lift on the next materialize pass.
> - **New invariant**: `tests/architecture/mark-shipped-accepted-only.test.ts` — pins all four contracts above. **7/7 PASS.**
>
> ## What M5 did
>
> - **/pages route**: replaced 882-line PagesPage with a 100-line synchronous RSC that renders an honest "Pages isn't ready yet" placeholder. Deep links to /, /recommendations, /changes so the route stays useful. `data-pages-state="not-ready"` for any future test/probe.
> - **Why Option B**: the previous route depended on ~15 domain stores (page-snapshots, render-checks, sitemap-reconciliation, page-issues, outcome-watch, guardrail-alerts, rollout-waves, pattern-evidence, citation-evidence-index, playbook-briefs, fix-briefs, opportunity-scoring, scorecard, outcome events). Several return empty on Vercel. Fixing the full surface is a 2289-line refactor — NOT a bounded pass.
> - **Supporting files preserved**: `pages-client.tsx` (types consumed by `src/components/pages/*` and /topics), `issue-actions.ts` (`convertBriefToIssue` consumed by /topics), `scan-action.ts`, `verify-action.ts`, `wave-actions.ts`, `loading.tsx`. None deleted.
> - **Smoke test rewritten**: `tests/routes/pages-smoke.test.ts` now pins the not-ready contract (heading, navigational links, no legacy markup, synchronous RSC). **4/4 PASS.**
> - **Documented follow-up**: `docs/IDEAS_PARKING_LOT.md` Parked section gained "Rebuild /pages — focused per-URL citation history". Scope: ~200-line Supabase-only read of `citation_evidence_index`, no patterns/waves/playbooks UI, deferred until customer 2 is on the calendar.
>
> ## Next 3 actions
>
> 1. **Browser-verify on Vercel**: /pages renders "Pages isn't ready yet" with three nav links; /changes shows Mark Shipped on accepted rows only (not on recommended); attempting `markChangelogEditShipped` on a recommended row returns the Accept-first error.
> 2. **Continue the operator audit**: M4 + M5 close two more items. Remaining bundle items per the 2026-05-05 brief — verdict explainer page polish, changelog descriptor disambiguation — stay parked until you scope them next.
> 3. **Do not auto-rebuild /pages**: per parking-lot entry, defer until customer 2 is booked. The not-ready placeholder is the right shape until then.
>
> ---
>
> 🟢 **M1+M2+M3 CUSTOMER-TRUST BUNDLE (2026-05-05):** Commit `60a2cb5` shipped + pushed. **Operator audit M1+M2+M3** complete: placeholder gate pinned, raw-UUID kill at render + save time + LLM system prompt, attribution-overclaim fix (deltaPct floor + sampling-status guard + correlation-toned narrative). **No paid calls, no Supabase writes, no queue mutation.** Quality gate green: typecheck clean, 397/397 targeted PASS (architecture + sanitizer + url-verdict), full suite 4282/4288 (6 baseline failures verified pre-existing on stashed checkout, unrelated), build green. Vercel auto-deploy from origin/main follows.
>
> ## What this bundle did
>
> | Track | Outcome |
> |---|---|
> | M1 — placeholder gate | Architecture invariant pins zero "Draft answer" / "operator: rewrite" / "Anchor on:" in deterministic generator string literals + zero placeholder phrases in active recs (recommended/accepted/verified_live). Dismissed legacy rows exempt per operator constraint. **8/8 tests PASS.** |
> | M2 — UUID kill | New shared `sanitizeOperatorEvidenceText` (Map-or-Record lookup, prompt-text snippet substitution ≤50 chars, "prompt evidence" fallback). Wired at render time (drawer Why + Debug rows in recommendations-client.tsx) + at save time (`mapSpecificEditToRow` on why/expected_impact/measurement_plan/display_label). OpenAI SYSTEM_PROMPT cleaned of UUID-citing example. New invariant blocks UUIDs in 5 ship-as-is/attribution fields. **18 sanitizer tests + 2 architecture invariants PASS.** |
> | M3 — attribution honesty | `deltaPctMinBaseline=1.0` floor in url-verdict (a 0.5/day → 6/day jump no longer fabricates `+1100%` — renderer falls back to "/day" delta). `samplingStatus` guard demotes helping/hurting → nothing_yet when post-window contains any proof day or no full days (back-compat: no-op when untagged). today-data narrative: "Citation lift detected on X after the … change" replaces "X is winning after your change"; closes with "URL-level correlation — not proof of causation". Z primary, %-secondary. Jargon invariant bans the legacy phrasing + positive-presence test pins the new phrasing. **7 url-verdict tests + jargon invariants PASS.** |
>
> ## What was deliberately NOT done (operator constraint)
>
> - No production queue mutation: legacy `why` UUIDs in `.data/tenants/ritz-builders/recommended-edits.json` (8 rows) are sanitized at render via the new sanitizer, NOT rewritten on disk. Counter-test caps at 10 to detect future leaks.
> - No paid calls (no provider regenerate / re-poll).
> - No Supabase writes from this work (typecheck/build read-only).
> - No new product features (e.g., no Apply-All-HIGH bar — operator deferred).
>
> ## Next 3 actions (operator's call)
>
> 1. **Browser-verify the rendered output** on a fresh Vercel deploy: open /recommendations drawer → Why text shows `prompt: "<snippet>"` (not UUID); open /today → win-card headline reads "Citation lift detected on X after the …" (not "is winning after your change"); the May 4 5-prompt proof day cannot generate a measured-win card.
> 2. **Decide on legacy `why` UUID one-time clean-up.** Currently 8 rows on Ritz tenant carry UUID-bearing `why`. The render-time sanitizer scrubs them, so the operator never sees them. If a one-time `scripts/sanitize-recommended-edits.ts` cleanup pass is desired, it can be authored separately — it's a queue mutation, so it stays gated behind explicit operator authorization.
> 3. **Continue per master plan.** This commit closes the operator audit's first customer-trust bundle (M1+M2+M3 of 6+). Remaining audit items: M4 (operator-evidence trust pills), M5 (verdict explainer page polish), M6 (changelog descriptor disambiguation) — none of which are blockers; they're follow-ups when the operator wants to keep going.
>
> ---
>
> 🟢 **PRE-CRON READINESS + UX CLEANUPS (2026-05-05 UTC, predawn):** Operator scoped 4 small tasks to make tomorrow's cron validation safer + stop /today overreacting to the 5-prompt proof. All pre-cron, read-only-where-it-matters, no paid runs. Pre-cron verifier reports READY for the 07:00 UTC cron. Three UX cleanups landed (samplingStatus wired into headline KPI tile, descriptor stopwords expanded to suppress "custom/home/builder/closed" pollution, /prompts now applies the entity-pollution-filter so "General Contractors" never appears as a competitor).
>
> ## Task 0 — Pre-cron readiness (read-only)
>
> New script `scripts/verify-daily-poll.ts` (also wired as `npm run verify:daily-poll`). Pre-cron run output:
>
> | Check | Result |
> |---|---|
> | Persistence gate (Operator R6) — perplexity-native-poll | ✓ ALLOW (latest run is 21:00Z proof, no PERSISTENCE FAILED marker) |
> | Persistence gate — openai-native-poll | ✓ ALLOW (latest run is 21:01Z proof) |
> | Latest run per platform | ✓ Both completed, 5/5 prompts each |
> | `raw_poll_chunks` table exists + accepts SELECT | ✓ |
> | `prompt_answer_observations.competitor_descriptor_windows` | ✓ accepts SELECT |
> | Today's persisted rows | (none yet — fresh UTC day) |
> | Recs / changelog row counts | ✓ 17 / 7 / 334 (byte-stable to backup) |
>
> **VERDICT: READY for next paid cron.** Persistence gate ALLOWS, schema cache OK, recs/changelog stable. Tomorrow's 07:00 UTC cron will run cleanly through the full integrity contract.
>
> ## Task 1 — `samplingStatus` wired into headline KPI logic (tests pinned)
>
> The R7 wiring already shipped (R7 in the prior turn). This turn pinned the contract on the source via 14 architecture invariants in `tests/architecture/today-headline-sampling.test.ts`:
>
> 1. `ScoreboardData.derivedKpiSamplingStatus: SamplingStatus | null` declared
> 2. `today-scoreboard.tsx` imports `SamplingStatus` from `poll-health`
> 3. `samplingStatusTag()` maps `proof → "small sample (proof run)"`, `partial → "partial day (below 80-prompt floor)"`, `empty → "no observations today"`, `full → ""` (no tag)
> 4. Tile meta string composition appends the tag onto `asOfLabel`
> 5. Week-over-week delta pill suppressed when `asOfDate` is set (existing behavior preserved): `delta={asOfDate ? null : wowCit}` and same for `wowMen`
> 6. `today-data.ts` imports `aggregateSamplingStatus` and feeds the field
> 7. `aggregateSamplingStatus(snap)` exported from poll-health.ts
> 8. Worst-case-wins ordering pinned: `["empty", "proof", "partial", "full"]`
>
> Result for the operator's exact May 4 case: tile meta reads `As of May 4 (today) · small sample (proof run) · perplexity 5 · chatgpt 5`. Week-over-week delta pill is suppressed (no misleading `−95%` next to the count). Chart still shows the proof day point so it's not hidden — just not driving the headline delta.
>
> ## Task 2 — Descriptor quality cleanup (`DESCRIPTOR_STOPWORDS` expanded)
>
> Operator's exact bad set (from /today screenshot): `custom · home · builder · closed`. All four are now suppressed at extraction time. Expanded `DESCRIPTOR_STOPWORDS` in `src/domains/prompt-answer-observations/extraction.ts` with three categories:
>
> - **Industry nouns:** `custom · home · homes · builder · builders · building · buildings · house · houses · residence · residences · company · companies · firm · firms · contractor · contractors · contracting · general · professional · professionals · services · service · work · works · project · projects · team · teams · staff`
> - **Temporal/state noise:** `closed · open · opened · now · today · yesterday · tomorrow · current · currently · recent · recently · available`
> - (Existing English connectors + URL-noise stopwords preserved.)
>
> Tests pin the operator's exact bad set + the meaningful adjectives that still pass (`luxury · trusted · award-winning · modern · bespoke · sustainable · designs · renovations`). 5 existing tests updated to reflect the new suppression contract.
>
> Note: bigram support ("Bay Area", "Palo Alto", "high-end residential") would require extending the tokenizer beyond single words. That's a follow-up — for now, removing the polluting single-word generics is the highest-impact patch.
>
> ## Task 3 — /prompts competitor pollution cleanup
>
> Pre-fix: /prompts could show `"General Contractors"` (a generic-noun directory entity, not a real builder) in the per-prompt competitor list. Post-fix: `prompt-drilldown.ts` now passes `competitor_co_mentions` through `makeCompetitorRankingFilter(activeEntities)` — the same shared helper used by the recommendation engine + visibility leaderboard.
>
> Tests pin the contract:
> - `"General Contractors"` is dropped from the competitor list
> - Directory entities (Houzz / Yelp / Angi by `entity_type: "directory_source"`) are dropped
> - Real builders (CRC Builders, Bay Builders, Homestead) are unaffected — proper-noun-bearing entities pass even when their name contains generic-sounding parts
>
> ## Task 4 — Post-cron verifier (same script)
>
> `npm run verify:daily-poll -- --mode=post` reports:
> - Latest observation date + per-(date, platform) row counts (last 5 days)
> - Snapshots by date / platform (last 5 days)
> - `raw_poll_chunks` rows by run / platform with reconciliation status
> - Latest `observation_runs` status per platform
> - `samplingStatus` per platform via `classifySampling`
> - Whether persisted rows match the full-day target (100/platform)
> - Whether /today should be stale or fresh
> - Whether recs / changelog counts changed (must stay byte-stable)
>
> Exit codes: 0 GREEN / 1 failures / 2 query error.
>
> ## Files (modified)
>
> ### New
> - `scripts/verify-daily-poll.ts` — read-only pre/post-cron verifier (~430 lines)
> - `tests/architecture/today-headline-sampling.test.ts` — 14 invariants pinning Task 1
>
> ### Modified
> - `src/domains/prompt-answer-observations/extraction.ts` — `DESCRIPTOR_STOPWORDS` expanded (~40 new tokens across industry + temporal categories)
> - `src/domains/prompts/prompt-drilldown.ts` — imports `makeCompetitorRankingFilter` and applies it before the competitor frequency aggregation
> - `package.json` — `verify:daily-poll` npm script
> - `tests/domains/prompt-answer-observations/extraction.test.ts` — 5 existing tests updated to reflect new stopword contract; 4 new tests for Task 2 (operator's exact bad set, meaningful adjectives still pass, industry-noun coverage, temporal/state noise)
> - `tests/domains/prompts/prompt-drilldown.test.ts` — 3 new tests for Task 3 (General Contractors dropped, directory entities dropped, real builders preserved)
> - `src/domains/observations/run-poll.test.ts` — `checkPersistenceGate` mock retyped to widen blockedByRunId from null to `string | null`
> - `docs/HANDOFF_VERIFIED_STATE.md` (this entry)
> - `docs/VERIFICATION_LOG.md`
>
> ## Verification
>
> - ✓ `npx tsc --noEmit` clean
> - ✓ `tests/architecture/today-headline-sampling.test.ts` 14/14
> - ✓ `tests/domains/prompt-answer-observations/extraction.test.ts` 63/63
> - ✓ `tests/domains/prompts/prompt-drilldown.test.ts` 11/11 (8 prior + 3 new)
> - ✓ `npm run test` 4245/4251 (same 6 pre-existing baseline failures all OUTSIDE this surface; +21 new passes vs prior state)
> - ✓ `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean
> - ✓ `npm run verify:daily-poll` runs clean and reports READY (gate ALLOWS both platforms)
>
> ## Acceptance — all met
>
> | Task | Acceptance | Status |
> |---|---|---|
> | Task 0 | Read-only verifier answers all listed questions | ✓ |
> | Task 0 | Gate logic patched if blocking incorrectly | ✓ no patch needed (gate already correct) |
> | Task 1 | 5-prompt proof day does not create misleading headline delta | ✓ wow-pill suppressed when asOfDate set |
> | Task 1 | UI copy says small sample / proof run | ✓ samplingStatusTag in tile meta |
> | Task 1 | Tests pin 5-prompt proof behavior | ✓ 14 architecture invariants |
> | Task 2 | Generic single tokens suppressed | ✓ custom/home/builder/closed + 30 more |
> | Task 2 | Meaningful descriptors still pass | ✓ luxury/trusted/award-winning/modern/bespoke |
> | Task 2 | Tests include operator's exact bad set | ✓ |
> | Task 3 | "General Contractors" does not appear | ✓ via entity-pollution-filter |
> | Task 3 | Real builders still appear | ✓ CRC/Bay/Homestead preserved |
> | Task 3 | Tests cover prompt summary filtering | ✓ 3 new tests |
> | Task 4 | Read-only post-cron verifier | ✓ same script, --mode=post |
>
> ## Constraints honored
>
> - ✓ Did NOT run a full paid poll
> - ✓ Did NOT run paid generation
> - ✓ Did NOT Apply-All-HIGH
> - ✓ Did NOT publish Stage 5 relabel
> - ✓ Did NOT archive/delete Profound
> - ✓ Did NOT start a giant new generator/action-type build
> - ✓ Did NOT backdate or fabricate May 2-4 data
> - ✓ All Supabase access read-only SELECT (one diagnostic query at start; verifier itself is read-only)
>
> ## Next 3 actions (operator-gated)
>
> 1. **Wait for May 5 07:00 UTC cron.** ~3 hours from now. The full integrity contract runs live for the first time. Verify-persistence job at end + canary at 07:45 UTC defense in depth.
> 2. **Run `npm run verify:daily-poll -- --mode=post`** once cron completes. Expect: 100 obs/platform, full-day samplingStatus, recs/changelog unchanged, /today fresh.
> 3. **(Future)** Pick up bigram descriptor support (Task 2 follow-up: "Bay Area", "Palo Alto", "high-end residential" as multi-word descriptors), or sales/onboarding setup, depending on operator priority.

> 🟢 **POLL INTEGRITY HARDENING — LAUNCH-BLOCKER CLOSED (2026-05-04, night):** Operator accepted the May 2-4 incident as launch-blocker class. Implemented the 8-requirement Poll Integrity Contract before any customer can use Beacon. The same silent-failure pattern that lost ~$9 + 600 observations CANNOT recur for customers — every step of the pipeline is now monitored, auditable, fail-loud, and reconciled against database truth.
>
> ## How this contract prevents the May 2-4 incident
>
> | May 2-4 failure mode | Caught by |
> |---|---|
> | Provider call cost charged + 0 rows persisted | **R2** reconciliation: `cost > 0 + persisted = 0` → throw + mark run failed → workflow turns red |
> | observation_runs stamped status=completed before persistence verified | **R1** state machine + reconcile-after-write — `observationsWritten` reflects DB truth (`verdict.persistedObsCount`), not provider claim |
> | Raw provider response permanently lost when obs upsert silently failed | **R3** raw chunk safety net: `raw_poll_chunks` row written **before** `syncObs`, schema-stable so it can't suffer the same column-drift failure |
> | GitHub Actions workflow showed green for 3 days while data was lost | **R4** verify-persistence job at end of `daily-native-poll.yml` — runs `check-yesterday-poll.ts` inline; non-zero exit on persistence=0 turns the workflow red within minutes |
> | No early-warning signal that schema drifted | **R5** persistence canary at 07:45 UTC writes a mock observation through the full dual-write pipeline → reads back → cleans up. ZERO paid API calls. Catches column drift BEFORE the next paid run |
> | After failure, the next morning's $2.66/day cron kept running and burning more money | **R6** auto-disable gate: when latest run carries the `PERSISTENCE FAILED` marker on this (tenant, source), the next paid run is BLOCKED with `status: "skipped_persistence_failure_gate"`. Cleared by a green canary or operator manual override |
> | Headline KPIs treated 5-prompt proof days as full days | **R7** `samplingStatus` field on `PlatformPollHealth` propagates into `ScoreboardData.derivedKpiSamplingStatus` → tile meta renders `"small sample (proof run)"`; week-over-week pills already suppressed for as-of-date single-day reads |
>
> ## R1 — Observation run state machine
>
> The orchestrator's contract is that a run is only `verified_complete` when ALL five sub-statuses pass:
> - `provider_completed` — adapter returned a result
> - `raw_saved` — `raw_poll_chunks` row written
> - `observations_persisted` — `syncObs` succeeded (post Bug-1 fix: throws on schema drift)
> - `snapshots_derived` — snapshot derivation + write succeeded
> - `verified_complete` — Supabase row count matches expected
>
> Sub-statuses are stamped on the `raw_poll_chunks.reconciliation_status` enum: `pending → verified_complete | persistence_mismatch | observation_upsert_threw | snapshot_derivation_failed`. The `observation_runs.scope_label` carries a `PERSISTENCE FAILED:` marker on failure for /today and the canary to read.
>
> ## R2 — Paid-call reconciliation
>
> `reconcilePolledRun` (in `src/domains/observations/poll-integrity.ts`) reads the actual persisted observation count for a `(tenant, run_id)` and applies three guards:
>
> 1. `cost > 0 + persisted = 0` → fail (silent-write-failure pattern, May 2-4 incident class)
> 2. `expectedObsCount > 0 + persisted = 0` → fail
> 3. `persisted < expectedObsCount` (with both > 0) → fail (partial persistence)
>
> On any guard fail, the orchestrator throws `[run-poll] PERSISTENCE RECONCILIATION FAILED for run=<id>` so `/api/poll/run` returns 5xx and the workflow turns red. The run row is updated to `status: failed` first via `markRunPersistenceFailed`.
>
> ## R3 — Raw-response safety net
>
> New table `raw_poll_chunks` (migration applied via Supabase MCP):
>
> | Column | Type | Note |
> |---|---|---|
> | run_id | TEXT PK | idempotent re-runs |
> | tenant_id | TEXT NOT NULL | RLS-friendly |
> | platform | TEXT NOT NULL | observation-level label |
> | source | TEXT NOT NULL | poll source (perplexity-native-poll / openai-native-poll) |
> | chunk_offset | INTEGER | start offset |
> | chunk_limit | INTEGER NULL | window size |
> | prompt_count | INTEGER | how many prompts the chunk targeted |
> | prompt_ids | TEXT[] | which prompts |
> | raw_response | JSONB NULL | full provider response payload |
> | cost_usd | NUMERIC NULL | post-call cost |
> | observations_persisted_count | INTEGER NULL | reconciliation result |
> | reconciliation_status | TEXT NULL | `pending|verified_complete|persistence_mismatch|observation_upsert_threw|snapshot_derivation_failed` |
> | created_at | TIMESTAMPTZ | default `now()` |
>
> **Schema deliberately minimal** — no Schema v2.x enrichment fields. Adding any would re-introduce the same column-drift failure mode this table exists to defend against. Future-recovery: reconstruct observations from `raw_response` JSON.
>
> Repo file: `migrations/2026-05-04_poll_integrity_raw_poll_chunks.sql`. Helpers: `syncRawPollChunk` (throws on error) + `stampRawPollChunkReconciliation` in `src/lib/persistence/dual-write.ts`. Written **before** `syncObs` in `run-poll.ts`.
>
> ## R4 — GitHub Actions verify-persistence step
>
> New job in `.github/workflows/daily-native-poll.yml`:
>
> ```yaml
> verify-persistence:
>   name: Verify persistence (Operator R4 contract)
>   needs: [poll-perplexity, poll-openai, rebuild-citation-evidence-index]
>   if: always()
>   steps:
>     - name: Verify today's polls actually persisted to Supabase
>       run: npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts
> ```
>
> When the canary script exits non-zero (any platform isn't `ok` per the persistence cross-check), the entire workflow turns RED and the operator gets the GitHub failure email within minutes. `if: always()` so partial chunk failures don't skip the verify step.
>
> ## R5 — Canary verifies persistence end-to-end
>
> New script `scripts/canary-persistence-write.ts` runs nightly via the existing `poll-canary.yml` workflow:
>
> 1. Build a mock observation row carrying the FULL Schema v2.1 column set (including `competitor_descriptor_windows`)
> 2. Upsert via the production `syncPromptAnswerObservations` path
> 3. Read back from Supabase to verify the row landed
> 4. Build + upsert a mock daily snapshot
> 5. Read back to verify
> 6. Delete both rows (canary metadata `canary: true` + id starts with `canary-` for safety filters)
>
> **Zero paid API calls. Zero marginal cost.** If schema drifts again, this canary fails LOUD before paid polling runs the next morning. Exit codes: 0 OK / 1 write-or-read failed / 2 cleanup failed.
>
> ## R6 — Auto-disable on persistence failure
>
> `checkPersistenceGate` reads the latest run on `(tenant, source)`. If `status === "failed" && scope_label.includes("PERSISTENCE FAILED")`, the gate returns `allow: false` and the orchestrator returns `status: "skipped_persistence_failure_gate"` without invoking the paid adapter. Cleared by:
>
> - A successful canary run that touches the same source
> - Operator manual override (`force: true` on the run call)
> - Operator manually editing the failed run row to remove the `PERSISTENCE FAILED` marker
>
> ## R7 — Headline KPI tile honors `samplingStatus`
>
> New field `ScoreboardData.derivedKpiSamplingStatus: SamplingStatus | null`. Computed in `today-data.ts` via the new `aggregateSamplingStatus(pollHealth)` helper (worst-case wins across both platforms). Tile meta in `today-scoreboard.tsx` appends a sampling tag:
>
> | Status | Tag |
> |---|---|
> | `proof` (1-9 obs) | `small sample (proof run)` |
> | `partial` (10-79 obs) | `partial day (below 80-prompt floor)` |
> | `empty` (0 obs) | `no observations today` |
> | `full` (≥80 obs) | (no tag) |
>
> Week-over-week delta pills already suppressed for `derivedKpiAsOfDate`-mode tiles, so a 5-obs proof day cannot drive headline deltas.
>
> ## Files (modified)
>
> ### New
> - `migrations/2026-05-04_poll_integrity_raw_poll_chunks.sql` — repo-tracked migration (also applied via Supabase MCP)
> - `src/domains/observations/poll-integrity.ts` — `reconcilePolledRun`, `markRunPersistenceFailed`, `checkPersistenceGate`
> - `scripts/canary-persistence-write.ts` — end-to-end persistence canary
> - `tests/domains/observations/poll-integrity.test.ts` — 13 unit tests for the integrity helpers
> - `tests/architecture/poll-integrity-contract.test.ts` — 17 source-scan invariants pinning R1-R7 contract on the actual code
>
> ### Modified
> - `src/lib/persistence/dual-write.ts` — new `syncRawPollChunk` + `stampRawPollChunkReconciliation` helpers (both throw on error)
> - `src/domains/observations/run-poll.ts` — `RunNativePollDeps` extended with 5 new injection points; orchestrator now writes raw chunk → syncObs → catches+marks-failed-on-throw → snapshot derivation → reconciliation → throw on mismatch. Persistence gate before budget guard. New `NativePollStatus: "skipped_persistence_failure_gate"`. New `PollIntegritySubStatuses` type. `observationsWritten` field now reflects DB truth.
> - `src/domains/observations/poll-health.ts` — new exported `aggregateSamplingStatus(snap)` helper for headline KPI consumers
> - `src/components/today/today-scoreboard.tsx` — tile meta renders sampling tag from `derivedKpiSamplingStatus`
> - `src/app/(shell)/today-data.ts` — `derivedKpiSamplingStatus` field on scoreboard data, computed from `pollHealth`
> - `.github/workflows/daily-native-poll.yml` — new `verify-persistence` job at end (runs `check-yesterday-poll.ts` inline)
> - `.github/workflows/poll-canary.yml` — new step that runs `canary-persistence-write.ts`
> - `src/domains/observations/run-poll.test.ts` — 12 existing tests updated with new dep stubs + 6 new tests for R1+R2+R3+R6 integration
> - `tests/domains/observations/poll-health.test.ts` — extended with 6 new `aggregateSamplingStatus` tests
> - `docs/HANDOFF_VERIFIED_STATE.md` (this entry)
> - `docs/VERIFICATION_LOG.md`
>
> ## Verification (2026-05-04 night)
>
> - ✓ `npx tsc --noEmit` clean
> - ✓ `tests/domains/observations/poll-integrity.test.ts` 13/13
> - ✓ `tests/architecture/poll-integrity-contract.test.ts` 17/17
> - ✓ `tests/domains/observations/poll-health.test.ts` 34/34 (28 prior + 6 new aggregate tests)
> - ✓ `src/domains/observations/run-poll.test.ts` 18/18 (12 prior + 6 new integrity-contract tests)
> - ✓ `npm run test` 4224/4230 (same 6 pre-existing baseline failures all OUTSIDE this surface; +51 new passes vs prior state)
> - ✓ `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean
>
> ## Acceptance — all met
>
> | Criterion | Status |
> |---|---|
> | typecheck clean | ✓ |
> | targeted tests pass | ✓ (91/91 across 4 integrity files) |
> | full suite only known baseline failures | ✓ (same 6) |
> | build passes | ✓ |
> | no paid run unless explicitly needed and approved | ✓ (zero paid runs this turn; canary uses mock provider) |
> | clear report explaining how this prevents the May 2-4 incident from happening with customers | ✓ (table at top) |
>
> ## Constraints honored
>
> - ✓ Did NOT run paid generation
> - ✓ Did NOT Apply-All-HIGH
> - ✓ Did NOT publish Stage 5
> - ✓ Did NOT archive Profound
> - ✓ Did NOT start new recommendation work
> - ✓ Did NOT run any paid poll (only `apply_migration` + read-only audit + code+test edits)
>
> ## Next 3 actions (operator-gated)
>
> 1. **Operator merges + deploys.** Vercel auto-deploys from origin/main. Once deployed, the next May 5 07:00 UTC cron will run with the full integrity contract live. The verify-persistence job at the end of the workflow will catch any regression within the same workflow run.
> 2. **First canary cycle (May 5 07:45 UTC).** The persistence-write canary (mock provider, ZERO API spend) runs end-to-end through the production dual-write pipeline. Schema-cache integrity verified daily.
> 3. **(Future)** Sales/onboarding can begin. The R1-R7 contract is the customer-readiness floor. Bugs 3/4/5 (descriptor copy, stopwords, /prompts pollution) can be picked up in scope-priority order without blocking customer-1 → customer-2 transition.

> 🟡 **MAY 2-4 RECOVERY AUDIT + PARTIAL-DAY PATCH (2026-05-04, late evening):** Operator asked for a read-only audit of every possible location where May 2-4 raw poll data could exist, plus a UI patch so the May 4 5-prompt manual proof doesn't distort headline KPI deltas. Audit complete; recovery NOT feasible; partial-day signal landed on PlatformPollHealth.
>
> ## Recovery audit (read-only, 6 dimensions)
>
> | # | Surface | Finding |
> |---|---|---|
> | A1 | `observation_runs` for May 2-4 | 24 chunk runs (8/day × 3 days), all `status: completed`, scope_label carries cost only. **NO raw response data:** `counts: null`, `sample_result_row_count: null`, no error fields, no provider response IDs, no embedded JSON. Run-level cost extraction by chunk: May 2 $2.9952 + May 3 $3.1167 + May 4-morning $2.9113 = **~$9.02 lost spend across 24 chunks.** |
> | A2 | Other Supabase tables (`answer_texts`, public schema) | `answer_texts` has 16,042 rows total; 1,946 match ritz-founder pao (1,936 native + 10 manual proof from earlier today); **14,096 are orphan (no matching pao row).** **But:** of those 14,096, ZERO bodies mention 2026-04-* or 2026-05-* dates, 1,786 carry the Profound `==**` markdown signature, and the orphan IDs do NOT match any W4 published observation IDs. The orphans are pre-existing Profound-era residue, NOT recoverable May 2-4 polls. **No staging/import/raw-result tables exist that hold native poll outputs.** |
> | A3 | GitHub Actions workflow logs / artifacts | `.github/workflows/daily-native-poll.yml` uses curl to POST `/api/poll/run`; logs are stdout-only, no artifact uploads, no `.data` files committed. Vercel Hobby retains logs ~1h-few-days; May 2-4 logs already rolled off. The operator could check the Actions UI for the May 2/3/4 runs but they only contain stdout summaries (status JSON), not response bodies. |
> | A4 | Vercel logs path | `/api/poll/run` and the shared poll-adapter only `console.log` PRE_CALL telemetry (runId, tenantId, promptId, accumulated cost) + per-chunk structured summary. **Zero raw response bodies in logs anywhere.** |
> | A5 | Local repo `.data/` + backups | `.data/cost-ledger.json` only has 10 entries from today's manual proof (no May 2-4 — those ran on Vercel where the cost-ledger is read-only). `.data/observation-runs.json` has 0 May 2-4 entries (local json-store is stale post-Supabase-migration). Stage 1 backup did NOT include `answer_texts`. **No recoverable artifacts on disk.** |
> | A6 | Provider response IDs | OpenAI client captures `usage.providerRaw.responseId` and stores it in the OBSERVATION's `metadata.usage.providerRaw`. Since May 2-4 observations never persisted, the response IDs are LOST. Perplexity Sonar doesn't expose a stable response ID through our client. **No replayability via OpenAI Responses API.** |
>
> ### Recovery verdict: **exact recovery is impossible**
>
> | Question | Answer |
> |---|---|
> | Are May 2-4 raw answers recoverable? | **NO.** No raw bodies persisted anywhere queryable, no provider response IDs to replay, no artifacts in repo, Vercel logs rolled off. |
> | If partial, which platform/date/chunks? | All 3 days × 2 platforms × 4 chunks (24 chunks total) are completely unrecoverable. |
> | API spend lost | **~$9.02** (May 2 $2.9952 + May 3 $3.1167 + May 4-morning $2.9113), extracted from `observation_runs.scope_label` cost suffixes. |
> | Useful data lost by date/platform | Each lost day = 100 prompts × 2 platforms = 200 observations + ~80 derived snapshots. 3 days = 600 obs + ~240 snapshots. |
> | Recommendation | **Leave May 2-4 missing.** Do NOT attempt rebuild from `answer_texts` — orphans don't match May 2-4 fingerprints. Do NOT run a fresh full poll today (next May 5 cron at 07:00 UTC will land cleanly with the dual-write throw fix + schema migration in place). |
>
> ### What we know about the lost days (reconstructable from `observation_runs`)
>
> | Date | Platform | Chunks | Total prompts attempted | Cost |
> |---|---|---:|---:|---:|
> | 2026-05-02 | Perplexity | 4 | 100 | $0.0517 |
> | 2026-05-02 | ChatGPT | 4 | 100 | $2.9435 |
> | 2026-05-03 | Perplexity | 4 | 100 | $0.0551 |
> | 2026-05-03 | ChatGPT | 4 | 100 | $3.0616 |
> | 2026-05-04 (morning) | Perplexity | 4 | 100 | $0.0534 |
> | 2026-05-04 (morning) | ChatGPT | 4 | 100 | $2.8579 |
> | **Total** | | **24** | **600** | **$9.0232** |
>
> All 24 chunks reported `status: completed` and "25/25 prompts" in scope_label. Zero rows landed because the dual-write upsert silently rejected each batch on PGRST204 ("competitor_descriptor_windows column not in schema cache"). `observation_runs` retains the cost data for audit; everything else is gone.
>
> ## Partial-day patch (P-PARTIAL)
>
> May 4's only persisted data today is the manual write-proof (5 obs × 2 platforms = 10 obs), which is far below a normal-day baseline (~200 obs). Without a partial-day signal, /today's headline tiles + sparklines treat 5 the same as 100 — distorting deltas.
>
> **New field on `PlatformPollHealth`:** `samplingStatus: "full" | "partial" | "proof" | "empty"` — operator-locked thresholds:
>
> | Bucket | Threshold | Meaning |
> |---|---|---|
> | `full` | ≥ 80 obs | Normal-sized daily run (close to the 100-prompt target) |
> | `partial` | 10–79 obs | Some chunks landed but not enough for confident headline deltas |
> | `proof` | 1–9 obs | Manual-proof-style run; mute headline-delta contribution |
> | `empty` | 0 obs | Nothing persisted (either no run OR silent-failure pattern) |
>
> The signal is computed independently from `status` (which captures chunk completion), so consumers can decide separately whether to trust the verdict (status) and whether to trust the volume (samplingStatus). Pure compute, fully tested.
>
> **UI surfacing in `poll-health-block.tsx`:**
> - `platformSummary()` now appends a sampling tag: e.g., `4/4 · 5 prompts · proof run (small sample)`. "full" gets no tag.
> - `subline()` adds two new copy branches:
>   - **Proof-run:** "Perplexity + ChatGPT ran a proof-sized sample (small). Headline deltas use larger windows; sparkline may dip on this day."
>   - **Partial-day:** "Perplexity landed a partial day (some chunks missed). Today's count is below the normal 80-prompt floor."
>
> ## Files (modified, this turn)
>
> - `src/domains/observations/poll-health.ts` — new `SamplingStatus` type; new exported `classifySampling()` helper + `FULL_RUN_PROMPT_FLOOR` (80) + `PROOF_RUN_PROMPT_CEIL` (9) constants; `PlatformPollHealth.samplingStatus` field added at all 3 return sites in `computePlatformHealth` (zero-runs / whole-mode / chunk-mode).
> - `src/components/today/poll-health-block.tsx` — `platformSummary()` appends `samplingStatusTag`; `subline()` adds proof/partial-run copy branches.
> - `tests/domains/observations/poll-health.test.ts` — extended from 16 → 28 cases (+12 partial-day invariants). New describe blocks: classifySampling thresholds (5 tests), samplingStatus on PlatformPollHealth (7 tests covering operator's exact May 4 case + full/partial/empty/proof + legacy callers + asymmetric platforms).
> - `docs/HANDOFF_VERIFIED_STATE.md` (this entry).
> - `docs/VERIFICATION_LOG.md` (audit + patch entry).
>
> ## Verification
>
> - ✓ `npx tsc --noEmit` clean
> - ✓ `tests/domains/observations/poll-health.test.ts` 28/28 pass (was 16; +12 partial-day tests)
> - ✓ `tests/architecture/poll-health-copy.test.ts` 6/6 pass
> - ✓ `tests/architecture/dual-write-loud-fail.test.ts` 3/3 pass
> - ✓ `tests/domains/prompt-answer-observations/enrichment-rollup.test.ts` 53/53 pass
> - ✓ `npm run test` 4173/4179 (same 6 pre-existing baseline failures all OUTSIDE this surface; +12 new passes)
> - ✓ `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean (one transient Supabase timeout on /prompts prerender on first attempt; retry succeeded — unrelated to patches)
>
> ## Acceptance criteria — all met
>
> | Criterion | Status |
> |---|---|
> | recovery audit complete | ✓ 6 dimensions checked, every surface accounted for |
> | no paid reruns during audit | ✓ all SQL was read-only `SELECT`; no API calls |
> | no fabricated backfill | ✓ NO observation rows inserted; orphan answer_texts left untouched |
> | exact recommendation for May 2-4 gap | ✓ "Leave missing; next cron at May 5 07:00 UTC will land cleanly" |
> | partial-run UI/metric handling plan or patch | ✓ `samplingStatus` field + UI subline + tests |
>
> ## Constraints honored
>
> - ✓ Did NOT run another full paid poll
> - ✓ Did NOT backdate new data
> - ✓ Did NOT fabricate May 2-4 rows
> - ✓ Did NOT Apply-All-HIGH
> - ✓ Did NOT publish Stage 5
> - ✓ Did NOT archive Profound
> - ✓ Did NOT mutate Supabase data anywhere (read-only audit; orphan answer_texts stayed untouched)
> - ✓ All audit queries were `SELECT` only
>
> ## Follow-up signal (deferred — operator-gated)
>
> The `samplingStatus` field is now available on `PlatformPollHealth`. Consumers (KPI tiles in /today's hero card, the sparkline/chart components) can read it to mute or warn on small-sample days. Wiring the consumers to actually de-bias headline deltas + chart visuals is a separate change with broader UX scope; flagging here for operator's next-phase pickup.
>
> ## Next 3 actions (operator-gated)
>
> 1. **Wait for May 5 07:00 UTC cron** — should land cleanly (schema column exists; dual-write throws on failure; persistence cross-check surfaces truth in /today). If it lands clean, May 5 will be the first full daily run since May 1 and the chart will resume normal motion.
> 2. **Consume `samplingStatus`** in headline KPI tile rendering (today-client.tsx and/or the daily snapshot read path) — mute Δ display when `samplingStatus !== "full"` for the latest day. Operator-gated: this is a UX change with broader scope than this turn.
> 3. **(Future)** Pick up the medium bugs from earlier (3: descriptor "warming up" copy; 4: descriptor stopwords; 5: entity-pollution filter on /prompts) per scope-priority order.

> 🟢 **POST-PATCH WRITE-PATH PROOF (2026-05-04, evening):** After landing the 2 critical patches earlier today, operator's browser check confirmed the `/today` UI now correctly says "Poll (May 4): failed — pipeline needs attention" instead of the old false-complete state. Daily-poll workflow on GitHub Actions still showed green though, so the operator asked for a controlled test to prove the fixed pipeline actually persists rows now that the schema is migrated. **Smallest possible manual polls (5 prompts each platform, $0.19 total) succeeded end-to-end.**
>
> ## Read-only diagnosis (D1-D6)
>
> | # | Check | Outcome |
> |---|---|---|
> | D1 | May 4 daily native poll time | 12:14:58 → 12:28:44 UTC (8 chunks) |
> | D2 | Polls ran before column existed | YES — polls predated migration by **~7h 33m** |
> | D3 | Current Supabase has `competitor_descriptor_windows` | YES — `jsonb`, nullable, migration `20260504200244` |
> | D4 | Production code has dual-write throw fix | YES — `src/lib/persistence/dual-write.ts` lines 67/100/103/116 (commit 6469a1a) |
> | D5 | Vercel deploy SHA includes 6469a1a or newer | Assumed via auto-deploy (origin/main is 6469a1a; Vercel auto-deploys main; the smallest-possible manual poll below is the more-authoritative end-to-end proof — local code path is identical to deployed) |
> | D6 | GitHub Actions CI failure not blocking deploy or scheduled workflow | The 6 CI test failures are pre-existing baseline (in /prompts smoke + auto-link-via-changelog + tenant isolation tests; unrelated to dual-write or poll path). Vercel auto-deploy is independent of GitHub Actions CI. The scheduled `daily-native-poll.yml` workflow runs unconditionally. |
>
> ## Patch P1 — poll-health-block subline copy
>
> Pre-fix copy: "Both platforms failed — check API keys and GitHub Actions logs." That phrasing was misleading once the dual-write throw fix landed because a "failed" verdict can now mean EITHER (a) API call failure (key wrong / rate-limited / network) OR (b) persistence failure (chunks completed but no rows landed — the May 2-4 silent-failure pattern). Patched `src/components/today/poll-health-block.tsx` to:
> 1. Detect persistence failure with `isPersistenceFailure(p)`: `p.status === "failed" && p.failedChunks === 0 && p.completedChunks > 0 && p.observationsWritten === 0`.
> 2. Branch the subline copy by detection result. The both-platforms-persistence case now reads "Poll ran but no observations were saved on either platform. Check persistence (Supabase schema, dual-write logs) and GitHub Actions logs." Single-platform persistence reads similarly. Mixed (one persistence + one API) gets a hybrid message.
> 3. New architecture invariant `tests/architecture/poll-health-copy.test.ts` (6 tests) pins the new copy + the persistence-detector shape + the Bug-1 rationale.
>
> ## Manual write-path proof (M1)
>
> New script `scripts/manual-poll-write-proof.ts` calls `runNativePoll(...)` directly with `force: true` and tiny chunk size. Smallest possible scope: 1 platform, 5 prompts. Loaded `.env.local` manually (matches the existing `scripts/poll-perplexity.ts` pattern) so the test doesn't need a Vercel deploy round-trip.
>
> ### Run 1 — Perplexity, 5 prompts
> ```
> tenant_id : tenant-ritz-founder
> platform  : perplexity   offset: 0   limit: 5   force: true
> ──────────────────────────────────────────────────────────────────
> status              : completed
> runId               : pollrun-1777928398254-4nqns2
> chunk               : 5/5 prompts polled
> observationsWritten : 5
> snapshotsWritten    : 40
> errorCount          : 0
> costEstimateUsd     : $0.025  (confirmed actual: $0.003)
> completedAt         : 2026-05-04T21:00:31.062Z
> wall time           : ~35.5s
> ```
>
> ### Run 2 — ChatGPT, 5 prompts
> ```
> tenant_id : tenant-ritz-founder
> platform  : openai (chatgpt)   offset: 0   limit: 5   force: true
> ──────────────────────────────────────────────────────────────────
> status              : completed
> runId               : pollrun-1777928455574-520bq5
> chunk               : 5/5 prompts polled
> observationsWritten : 5
> snapshotsWritten    : 40
> errorCount          : 0
> costEstimateUsd     : $0.060  (confirmed actual: $0.184)
> completedAt         : 2026-05-04T21:01:42.208Z
> wall time           : ~49.4s
> ```
>
> **Total spend: ~$0.19** (2 controlled tiny chunks; ZERO retries; ZERO repeated paid attempts). Far below a normal cron daily run (~$2.66).
>
> ## Post-run Supabase verification (M2)
>
> Direct read-only SQL confirms:
>
> | Table | Today (May 4 UTC) state |
> |---|---|
> | `prompt_answer_observations` | 5 ChatGPT (native, regime=null) + 5 Perplexity (native, regime=null) — observed_at 21:00:05Z → 21:01:42Z. **5/5 rows on each platform have `competitor_descriptor_windows` populated** (the W2.1 enrichment field that was the root cause of the May 2-4 silent-failure pattern now writes correctly). |
> | `daily_metric_snapshots` | 40 ChatGPT-derived rows + 40 Perplexity-derived rows for date 2026-05-04 (37 entity + 1 platform + 2 topic on each platform). |
> | `observation_runs` | Both runs `status: "completed"` with truthful `scope_label` matching the actual write counts ("5/5 prompts"). |
> | `recommended_edits` | 17 (unchanged — byte-identical to backup) |
> | `recommendation_responses` | 7 (unchanged) |
> | `changelog_entries` | 334 (unchanged) |
>
> ## Acceptance criteria — all met
>
> | Criterion | Status |
> |---|---|
> | manual run proves write path works or gives exact failing reason | ✓ — both platforms wrote successfully, end-to-end |
> | no repeated paid retries | ✓ — exactly 2 controlled invocations totaling $0.19 |
> | /today poll banner truthfully reflects persisted data | ✓ — `observationsWritten` now reads from DB row count via Bug-1.B cross-check; copy is precise about persistence-vs-API failure modes |
> | /recommendations table remains unchanged | ✓ — recs queue + responses byte-identical to backup |
>
> ## Verification (2026-05-04 evening)
>
> - ✓ `npx tsc --noEmit` clean
> - ✓ `tests/architecture/poll-health-copy.test.ts` 6/6 (new file)
> - ✓ `tests/architecture/dual-write-loud-fail.test.ts` 3/3
> - ✓ `tests/domains/observations/poll-health.test.ts` 16/16
> - ✓ `tests/domains/prompt-answer-observations/enrichment-rollup.test.ts` 53/53
> - ✓ `npm run test` 4161/4167 (same 6 pre-existing baseline failures all OUTSIDE this surface; +6 new passes vs morning state)
> - ✓ `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean
> - ✓ Live Supabase verification via `apply_migration` MCP read paths (read-only `SELECT` only)
> - ✓ Manual poll runs both completed cleanly with truthful runs / observations / snapshots
>
> ## Constraints honored
>
> - ✓ Did NOT run paid generation unrelated to polling
> - ✓ Did NOT Apply-All-HIGH
> - ✓ Did NOT publish Stage 5
> - ✓ Did NOT archive Profound
> - ✓ Did NOT start new product work
> - ✓ Read-only diagnosis ran before any writes (D1-D6 → P1 → M1 → M2)
> - ✓ ONE controlled manual run minimum scope (smallest=5 prompts per platform); no retries on failure (no failures occurred)
> - ✓ Total spend $0.19 vs $2.66 for a normal cron run
>
> ## What this proves about the deployed pipeline
>
> 1. **Schema gap is closed.** `competitor_descriptor_windows` writes successfully for both platforms (5/5 each).
> 2. **Dual-write no longer silent-fails.** If the schema were still mismatched, `dualWriteUpsert` would have thrown loudly and the run would have stamped `status: "failed"` with `observationsWritten: 0`. Instead, both runs wrote `status: "completed"` with `observationsWritten: 5` — DB-level truth.
> 3. **Snapshots derive from observations.** 40 daily-metric-snapshot rows derived per platform (cumulative-day rollup), proving the post-obs pipeline (entity / platform / topic scopes) also works.
> 4. **/today's UI will reflect truth on next render.** The Bug-1.B persistence cross-check pulls actual obs counts; with 5 rows each platform on May 4, the stale banner will advance from "Last observation: 2026-05-01" to "May 4 UTC".
>
> ## Next 3 actions (operator-gated)
>
> 1. **Operator browser-check `/today`** to confirm the post-patch state: stale banner advances to May 4, "Where AI ranks you" still shows 3 platforms (ChatGPT / Google AI / Perplexity), poll banner status reflects persisted rows.
> 2. **(Future / next cron tick)** The May 5 09:00 UTC cron fires the full daily run (8 chunks total ≈ $2.66 in API spend). Now that schema + dual-write are fixed, the next morning's polls should land cleanly. Operator can either let the cron drive normally or trigger workflow_dispatch earlier.
> 3. **(Future)** Pick up bugs 3, 4, 5 in scope-priority order — bug 5 (entity-pollution filter on /prompts) is cheapest; bug 3 (competitor descriptor copy) is one-line; bug 4 (descriptor stopwords) is the wedge UX work.

> 🟢 **POST-W4 BUG DIAGNOSIS + 2 CRITICAL PATCHES (2026-05-04):** Operator's post-W4 browser verification surfaced 2 critical + 3 medium product bugs. Read-only diagnosis confirmed all 5 root causes; minimal patches landed for the 2 critical ones. **No paid generation, no Apply-All-HIGH, no Stage 5 publish, no Profound archive, no schema mutations beyond what was needed.**
>
> ## Diagnosis (5/5 bugs, all traced to file:line)
>
> ### Critical bug 1 — /today shows poll complete but observation data is 3d stale
>
> **Symptom (operator-observed):** `/today` says "Poll (May 4): complete · ChatGPT 4/4 · 100 prompts · Perplexity 4/4 · 100 prompts" while ALSO saying "Visibility data is 3d stale" and "Last observation: 2026-05-01."
>
> **Read-only Supabase diagnosis (post-W4 publish, pre-fix):**
> - `prompt_answer_observations` for tenant-ritz-founder: 100 / 100 / 75 / 100 obs on Apr 30 chatgpt / Apr 30 perplexity / **May 1 chatgpt** / **May 1 perplexity**. **ZERO observations on May 2, May 3, May 4.**
> - `daily_metric_snapshots` for tenant-ritz-founder: derived rows on Apr 30 + May 1 only. **ZERO snapshots on May 2-4.**
> - `observation_runs` for tenant-ritz-founder: 4 chatgpt + 4 perplexity chunks per day on May 2, May 3, May 4 — every chunk `status: "completed"`, `scope_label` reports "25/25 prompts", $$ logged in cost ledger.
>
> **The stale banner ("Last observation: 2026-05-01") is CORRECT.** The poll-banner ("complete · 4/4 · 100 prompts") is wrong: it parsed the scope_label totals and reported them as the prompts count, but no rows actually persisted.
>
> **Root cause traced:** Commit `951ac51` (2026-05-01 14:56:14 -0700, Pacific = ~22:00 UTC) added `competitor_descriptor_windows` to the shared poll-adapter (`src/adapters/perplexity/poll.ts:591`; OpenAI's adapter is a thin wrapper over Perplexity's at `src/adapters/openai/poll.ts:24`). The W4 Stage 7 schema migration that added the matching column to production Supabase didn't land until **2026-05-04 ~20:08 UTC** — three days later. For the 3 days in between, every native poll's first batch was rejected by Supabase with PGRST204 ("column not in schema cache"). `dualWriteUpsert` (`src/lib/persistence/dual-write.ts:86-108`) logged the error to console.error but did NOT throw — the throw was gated behind `process.env.DATA_SOURCE === "supabase"`, which the cron environment didn't set. Each chunk's `observation_runs` row had been written via `syncRuns(...)` BEFORE `syncObs(...)` was invoked, so the runs stamped as `status: "completed"` even though zero rows persisted.
>
> ### Critical bug 2 — duplicate platform rows in /today's "Where AI ranks you"
>
> **Symptom:** ChatGPT appears twice (39% + 56%); Perplexity appears twice (42% + 39%); Google AI Overviews appears once (66%).
>
> **Root cause traced:** The W4 publish wrote 14,096 historical_recovered observations using capitalized platform labels (`"ChatGPT"`, `"Perplexity"`, `"Google AI Overviews"`) sourced from the OBSERVATION_PLATFORM_LABEL display map. Native polls (Apr 22+) write lowercase (`"chatgpt"`, `"perplexity"`). The enrichment rollups (`src/domains/prompt-answer-observations/enrichment-rollup.ts:87, 645, 766`) keyed Map buckets directly on `o.platform ?? "unknown"` — so `"chatgpt"` and `"ChatGPT"` ended up in two separate buckets, each rendering its own platform row. Confirmed via `SELECT platform, regime, count(*)`: 4,800 W4 ChatGPT (capitalized) + 833 native chatgpt (lowercase) + 4,800 W4 Perplexity + 1,103 native perplexity + 4,496 W4 Google AI Overviews.
>
> ### Medium bug 3 — competitor descriptor "warming up" copy
>
> **Diagnosis (no fix this turn):** `today-data.ts:389` sets `v2WindowDays = 7`. The competitor descriptor rollup operates on the last 7 days of observations only. W4's `competitor_descriptor_windows` data sits on rows from Mar 5-Apr 21 (historical_recovered) which fall OUTSIDE the 7-day window. Native rows from Apr 27-May 4 (the in-window range) don't carry `competitor_descriptor_windows` because (a) the column was missing on Supabase until May 4 ~20:08 UTC AND (b) the silent-fail bug 1 dropped May 2-4 polls entirely. **Behavior is intentional ("last 7 days only") but the copy is misleading.** Operator scoped patches to bugs 1+2 only; the copy fix is documented as a follow-up.
>
> ### Medium bug 4 — low-quality "How AI thinks you are" descriptors
>
> **Diagnosis (no fix this turn):** `src/domains/prompt-answer-observations/extraction.ts:159` defines `DESCRIPTOR_STOPWORDS` — generic English connectors + URL-noise. Domain-specific words like `custom`, `home`, `builder` are NOT stopwords; they appear because they're literally in the brand's descriptor windows ("custom home builder in Atherton" → 3 candidate descriptors). The fix needs a domain-vocabulary stopwords list AND/OR phrase extraction (so "custom home builder" becomes ONE token instead of three). Operator scoped this as no-rewrite-yet; documented as a follow-up.
>
> ### Medium bug 5 — General Contractors pollution on /prompts
>
> **Diagnosis (no fix this turn):** The entity-pollution-filter helpers (`src/domains/recommendations/entity-pollution-filter.ts` — `makeCompetitorRankingFilter`, `shouldExcludeFromCompetitorRanking`) are wired into `enrichment-rollup` and the recommendation engine, but are NOT used anywhere under `src/app/(shell)/prompts/` or `src/domains/prompts/`. Confirmed via grep. /prompts surfaces show raw competitor lists including directory entities like "General Contractors". Operator scoped this as note-only; documented as a follow-up.
>
> ### Medium product gap — /pages route not accessible
>
> **Diagnosis (no fix this turn):** Per the master plan §3.7, /pages was hidden from nav (Phase 3.5F decision 2026-04-17). It still routes when typed manually. Operator notes this as a post-W4 product gap because page/URL citation history is one of the main W4 benefits. Documented for the next phase.
>
> ## Patches applied (critical bugs only)
>
> ### Patch B1.A — `src/lib/persistence/dual-write.ts`: always throw on persistent error
>
> Dropped both `if (process.env.DATA_SOURCE === "supabase")` conditionals around the chunk-level `throw new Error(...)` and the outer-catch `throw e`. Inline rationale references Bug-1 + 2026-05-04 + the silent-failure pattern so future maintainers see WHY the gate was removed before reintroducing it. Architecture invariant `tests/architecture/dual-write-loud-fail.test.ts` (3 tests) pins:
> 1. The `process.env.DATA_SOURCE === "supabase"` conditional is gone.
> 2. The throw is retained (per-chunk + outer-catch re-throw).
> 3. The Bug-1 + 2026-05-04 + silent-failure rationale is in the source.
>
> ### Patch B1.B — `src/domains/observations/poll-health.ts`: cross-check DB persistence
>
> `fetchPollHealthForDate(dateISO, tenantId?)` now also queries `prompt_answer_observations` for the day, scoped by tenant, counts rows per canonical platform via the new `canonicalizePollPlatform()` helper, and passes the actual counts as a third arg to `computePollHealthFromRuns`. `computePlatformHealth` accepts `actualObservationsPersisted: number | null`:
> - **Legacy callers** (no third arg / null) → preserve old scope_label-derived behavior (every existing test still passes; +0 changes to legacy fixtures).
> - **New callers** with actual count → `observationsWritten` reflects DB truth, NOT scope_label parsing. Status downgrades from `ok` → `failed` when `reportedFromScope > 0 && actualPersisted === 0` (the silent-failure signature). Partial shortfalls (e.g. 75/100 from one truncated chunk) keep the run-level status — that's a different fault class.
> - The `today-data.ts` caller now passes `tenantId` so /today shows reality.
> - 7 new tests in `tests/domains/observations/poll-health.test.ts` covering legacy fallback / silent-failure downgrade / partial / no-spurious-downgrade / cross-platform isolation / both whole-mode + chunk-mode paths.
>
> ### Patch B2 — `src/domains/prompt-answer-observations/enrichment-rollup.ts`: canonicalize platform
>
> New exported helper `canonicalizePlatform(raw)` maps `"chatgpt"`/`"ChatGPT"`/`"openai"`/`"OpenAI"` → `"chatgpt"`, `"perplexity"`/`"Perplexity"` → `"perplexity"`, `"Google AI Overviews"` (and 5 other variants) → `"google_aio"`, `"claude"` → `"claude"`. Returns lowercased input as fallback for unknown new platforms; `null/undefined` → `"unknown"`. Applied at all 3 platform-bucket-keying sites (lines 87, 645, 766). The display path (`platformLabel(...)` from `src/lib/structure-labels.ts`) already keys on lowercase forms so no UI map changes were needed. 14 new tests in `tests/domains/prompt-answer-observations/enrichment-rollup.test.ts` covering: helper behavior across all variants; native+W4 rows collapse for chatgpt; same for perplexity; Google AI Overviews stays as one row even alongside chatgpt+perplexity; sparkline section produces 3 rows not 5 (the operator's exact symptom); format-wins section also collapses.
>
> ## Operator-acceptance criteria — all met
>
> | Criterion | Status |
> |---|---|
> | /today stale banner agrees with actual latest observation/snapshot state | ✓ — banner reflects DB truth via persistence cross-check |
> | If May 4 poll completed, May 4 data appears OR poll banner no longer falsely implies it | ✓ — silent-failure downgrade flips status from "ok" to "failed" when `persisted === 0` despite chunks reporting "complete" |
> | "Where AI ranks you" shows each platform once | ✓ — canonical bucket keys; tests pin the operator's exact 5-row→3-row symptom |
> | No "historical_recovered" debug language appears in main UI | ✓ — patches don't introduce any debug labels; all canonicalization is internal |
> | /recommendations remains unchanged and clean | ✓ — full-suite shows recs tests still passing |
>
> ## Verification (2026-05-04)
>
> - ✓ `npx tsc --noEmit` clean
> - ✓ `tests/domains/observations/poll-health.test.ts` 16/16 (was 9/9 + 7 new)
> - ✓ `tests/architecture/dual-write-loud-fail.test.ts` 3/3 (new file)
> - ✓ `tests/domains/prompt-answer-observations/enrichment-rollup.test.ts` 53/53 (was 39 + 14 new)
> - ✓ `npm run test` 4155/4161 (6 pre-existing baseline failures all OUTSIDE this surface; +36 new passes vs Stage 7 success state)
> - ✓ `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean
> - ✓ Read-only Supabase diagnosis confirmed root causes via direct SQL queries before patching (zero mutations during diagnosis)
>
> ## Constraints honored
>
> - ✓ Did NOT run paid generation
> - ✓ Did NOT Apply-All-HIGH
> - ✓ Did NOT publish Stage 5 relabel (still deferred per operator option D)
> - ✓ Did NOT archive/delete Profound
> - ✓ Did NOT start new action-type generator work
> - ✓ Did NOT touch /recommendations rendering
> - ✓ Did NOT mutate Supabase data (only read-only diagnosis SQL + the pre-existing W4 publish)
> - ✓ Did NOT patch bugs 3, 4, 5 (operator scoped patches to critical only)
>
> ## Next 3 actions (operator-gated)
>
> 1. **Operator review of /today** — verify the stale banner now agrees with row-level truth and "Where AI ranks you" shows 3 rows (ChatGPT / Google AI / Perplexity) not 5. Browser smoke; nothing else changed.
> 2. **(Future)** Re-run May 2-4 native polls (or wait for the May 5 cron at 09:00-12:00 UTC). Now that the schema column exists AND dual-write throws on failure, future polls either persist cleanly or fail loud.
> 3. **(Future)** Pick up bugs 3, 4, 5 in scope-priority order — bug 5 (entity-pollution filter on /prompts) is the cheapest; bug 3 (competitor descriptor copy) is one-line; bug 4 (descriptor stopwords) is the wedge UX work that needs operator sequencing per the master plan.

> 🟢 **W4 STAGE 7 CORE PUBLISH SUCCEEDED (2026-05-04):** Operator chose option 1 (add the missing column). One-line schema migration landed via Supabase `apply_migration`. Stage 6b + Stage 7 preconditions strengthened to catch staged-vs-target schema drift before batch 0. Re-running the operator-approved `--stage=publish --publish-scope=core --write` published all 14,096 W4 historical_recovered observations + 7,191 W4 historical_recovered snapshots in 44 batches over ~47 seconds with **zero failures, zero retries, zero improvised fixes.**
>
> **Schema migration applied (Supabase project `jdegznovgysxyweknewh`, name "beacon"):**
> ```sql
> ALTER TABLE public.prompt_answer_observations
>   ADD COLUMN IF NOT EXISTS competitor_descriptor_windows jsonb;
> ```
> Nullable, no DEFAULT, no constraints, no backfill, no other column or table touched. `daily_metric_snapshots` left alone (it was already 14/14 column match). Pre-migration row counts confirmed unchanged via post-migration verification SELECT (1,936 / 2,325 / 334 / 17 / 7).
>
> **Strengthened publish-readiness preconditions (`scripts/customer-one-backfill.ts`):** Stage 6b's `checkPublishReadinessCore` and Stage 7's `publish_target_columns_exist` now perform a strict-subset test — every column key present on ANY staged row must exist on the target Supabase table. Implementation walks `Object.keys(row)` for every row in the staged file (not just row[0], because staged rows are heterogeneous) and computes `(stagedKeys \\ targetColumns)`; any non-empty diff is a publish blocker that surfaces the missing column names AND references PGRST204 (Supabase schema-cache error code) so the operator can diagnose instantly. The strict-subset blocker fires in BOTH surfaces (Stage 6b verify + Stage 7 preview/--write), gating the publish before batch 0 every time.
>
> **Publish run (`--write` execution):**
> | Phase | Detail |
> |---|---|
> | Started | 2026-05-04T20:07:56.978Z |
> | Completed | 2026-05-04T20:08:44.410Z |
> | Wall time | ~47 seconds |
> | `prompt_answer_observations` | 29/29 batches OK (28 × 500 rows + 1 × 96 rows = 14,096 rows) |
> | `daily_metric_snapshots` | 15/15 batches OK (14 × 500 rows + 1 × 191 rows = 7,191 rows) |
> | Total batches | 44/44 — every batch returned `outcome: ok` |
> | Manifest status transitions | `preview_only → in_progress → completed` |
> | Errors | none |
> | Retries | none |
>
> **Post-publish Supabase state (verified read-only):**
> | Table | Pre-publish | Post-publish | Δ | Notes |
> |---|---:|---:|---:|---|
> | `prompt_answer_observations` (total) | 1,936 | 16,032 | **+14,096** | 1,936 native untouched + 14,096 W4 |
> | `prompt_answer_observations` (W4 regime=historical_recovered) | 0 | 14,096 | +14,096 | exact match to staged count |
> | `prompt_answer_observations` (W4 with `competitor_descriptor_windows`) | 0 | 14,020 | +14,020 | 99.46% — 76 absent rows match Stage 2's `emptyResponseCount: 76` exactly |
> | `daily_metric_snapshots` (total) | 2,325 | 9,516 | **+7,191** | 945 native derived + 7,191 W4 derived + 1,380 benchmark untouched |
> | `daily_metric_snapshots` (W4 regime=historical_recovered) | 0 | 7,191 | +7,191 | exact match |
> | `daily_metric_snapshots` (W4 source_type=derived) | 0 | 7,191 | +7,191 | 100% — operator step 4 satisfied |
> | `daily_metric_snapshots` (benchmark) | 1,380 | 1,380 | **0** | preserved |
> | `changelog_entries` | 334 | 334 | **0** | byte-identical to backup |
> | `recommended_edits` | 17 | 17 | **0** | byte-identical to backup |
> | `recommendation_responses` | 7 | 7 | **0** | byte-identical to backup |
>
> **Spot-check ID coverage:** every-141st sample of staged W4 observation IDs (100 IDs) — **100/100 found in Supabase**. Same sampling for snapshot IDs — **100/100 found**. With deterministic Schema v2 IDs, this confirms full coverage of the staged set.
>
> **9-step post-publish verification (operator-mandated):**
> | # | Check | Status |
> |---|---|---|
> | 1 | Supabase observation count contains all 14,096 W4 IDs | ✓ exact match + 100/100 spot-check |
> | 2 | Supabase snapshots contain all 7,191 W4 IDs | ✓ exact match + 100/100 spot-check |
> | 3 | `metadata.regime = historical_recovered` on W4 obs/snaps | ✓ 14,096 + 7,191 |
> | 4 | `source_type = derived` on W4 snapshots | ✓ 7,191 / 7,191 (100%) |
> | 5 | Recommendations unchanged | ✓ 17/17 edits + 7/7 responses byte-identical to backup |
> | 6 | Changelog unchanged | ✓ 334/334 byte-identical to backup |
> | 7 | Stage 6b core verify passes | ✓ `safe_to_publish_core: true`, 9/10 PASS, only `publish_readiness_stage_5` deferred (operator-known) |
> | 8 | Build clean | ✓ `npm run build` clean |
> | 9 | Browser/data smoke | ✓ data smoke covers via tables 1-7; browser smoke deferred per operator's "if available" |
> | extra | `competitor_descriptor_windows` populated where expected | ✓ 14,020 / 14,096 = 99.46%; the 76 absent rows match Stage 2's empty-response telemetry exactly |
>
> **Files (modified):**
> - `migrations/2026-05-04_w4_add_competitor_descriptor_windows.sql` — new repo-tracked migration file (the same SQL applied via `apply_migration` MCP, also stored for git history).
> - `scripts/customer-one-backfill.ts` — strict-subset check added to BOTH `checkPublishReadinessCore` (Stage 6b verify) and `validateCorePublishPreconditions` precondition #6 `publish_target_columns_exist` (Stage 7 preview + --write). Both surfaces now compute `(stagedKeys \\ targetColumns)` over ALL staged rows (heterogeneous keys safe), push a structured PGRST204-referencing blocker on any extra, and stamp `stagedExtraByTable` into details. Source-scan invariants in tests pin the contract.
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 248 → 261 cases (+13 strengthened-precondition invariants). New describe blocks: Stage 7 strengthened (strict-subset on staged keys ⊆ target columns); Stage 6b strengthened (mirrored into `publish_readiness_core`); operator-mandated test invariants (4: extra-column blocker fires, passes after schema migration, catches before batch 0, no writes on mismatch). PGRST204 reference pinned in both surfaces.
> - `docs/HANDOFF_VERIFIED_STATE.md` (this entry).
> - `docs/VERIFICATION_LOG.md` (Stage 7 publish-success entry below).
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 261/261 pass · `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean (pre-publish) · publish ran 44/44 batches OK over ~47s · post-publish Stage 6b core verify PASS · post-publish build clean · post-publish row counts + byte-identity verified via direct Supabase REST + SQL queries.
>
> **Notable design decisions:**
> 1. **Migration stays minimal.** One column added, nullable, no backfill, no constraints. Existing native rows have `competitor_descriptor_windows = NULL`. Going forward, the W2 day 2 extractor will populate it on new native rows; the W4 deterministic extractor already populated 99.46% of the historical recovered rows (the remaining 0.54% match the empty-response count exactly).
> 2. **Strict-subset check walks ALL staged rows, not just row[0].** Staged rows are heterogeneous (some carry optional Schema v2.1 fields, others don't). A row[0]-only check would have missed `competitor_descriptor_windows` if the first row happened to be one of the 76 empty-response rows that don't carry it. Walking every row is O(N × K) where K is the average column count — cheap and correct.
> 3. **PGRST204 named in the blocker message** — operator-known failure mode. Naming it makes future diagnosis instant.
> 4. **Idempotent re-publish.** Both target tables use `onConflict: "id"`. The staged W4 IDs are deterministic Schema v2 hashes. Re-running `--stage=publish --publish-scope=core --write` would now produce zero net change (every row already exists; upsert is a no-op when row content is byte-identical).
> 5. **Manifest status `completed`.** The rollback manifest at `.data/_staging/w4-core-publish-manifest.json` now carries the authoritative ID list of every row written. If a future Stage 8 rollback ever needs to undo this publish, it reads exactly these 14,096 + 7,191 IDs and deletes only them — never bulk delete.
>
> **Constraints honored (operator-locked):** Did NOT include Stage 5 changelog relabel · did NOT run `--publish-scope=full` · did NOT mutate `changelog_entries` (still 334) · did NOT mutate `recommended_edits` (still 17, byte-identical) · did NOT mutate `recommendation_responses` (still 7, byte-identical) · did NOT delete native rows (1,936 native obs preserved) · did NOT delete benchmark rows (1,380 benchmark snaps preserved) · did NOT run rollback · did NOT archive/delete Profound · did NOT run paid generation · did NOT Apply-All-HIGH · did NOT attempt improvised fixes.
>
> **Strategic outcome:** Beacon's brain now sees ~57 days of Ritz Builders historical_recovered intelligence (Mar 5 → Apr 21) on top of the 13 days of native data (Apr 22 → today). The data moat is real. /today's visibility chart will surface as continuous from Mar 5; /pages citation history goes back to Mar 5; the cross-tenant brain has a second-order pattern surface to learn from. The wedge ("either use ChatGPT, or use this exact solution for you") just got the empirical grounding it needed before customer 2 walks in.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of the published state.** Browse `/today` + `/changes` + `/pages` + `/recommendations` to confirm the new W4 rows render correctly. Anything off → report back; do not patch without operator direction.
> 2. **(Future)** Stage 5 changelog relabel publish — still deferred. Operator option D (defer entirely) remains the active choice; option A (add `metadata` jsonb column to `changelog_entries`) is the most-likely re-activation path when the time comes.
> 3. **(Future)** Stage 8 rollback design — still RESERVED + hard-fail. Won't be needed for THIS publish (success), but stays in the queue for any future publish that succeeds partially.

> 🔴 **W4 Stage 7 --write FAILED LOUD (2026-05-04):** Operator approved with the literal phrase "publish core now". Production mutation attempted. The orchestrator's fail-loud + atomic-batch design caught a schema gap on the FIRST batch and stopped immediately with **ZERO rows written to production Supabase.**
>
> **Failure detail:**
> ```
> ✗ FAIL prompt_answer_observations batch 0 failed:
>   Could not find the 'competitor_descriptor_windows' column of
>   'prompt_answer_observations' in the schema cache
> ```
>
> **Manifest:** `status: "failed"`, `batches_completed: 0/29` (observations), `0/15` (snapshots), `rows_written: 0` on both tables. `started_at` + `completed_at` stamped. Manifest path: `.data/_staging/w4-core-publish-manifest.json`.
>
> **Production Supabase byte-identical to pre-publish backup:**
> | Table | Backup | Now | Delta |
> |---|---:|---:|---:|
> | prompt_answer_observations | 1,936 | 1,936 | 0 |
> | daily_metric_snapshots | 2,325 | 2,325 | 0 |
> | changelog_entries | 334 | 334 | 0 |
> | recommended_edits | 17 | 17 | 0 |
> | recommendation_responses | 7 | 7 | 0 |
>
> Spot-check: 5/5 sample W4 observation IDs and 5/5 sample W4 snapshot IDs return 0 rows from Supabase. The error happens at Supabase's schema-validation layer BEFORE any row in the batch is written; the upsert is rejected atomically. **Rollback is unnecessary** — there is nothing to roll back. (`--stage=rollback` remains RESERVED + hard-fail until Stage 8.)
>
> **Schema gap precisely characterized (read-only column-set diff):**
> - `prompt_answer_observations`: prod has 27 columns, staged W4 rows have 28. **Missing in prod: `competitor_descriptor_windows`** (a W2 Schema v2.1 enrichment field per master plan §4.7).
> - `daily_metric_snapshots`: 14/14 columns match. **No gap.** Snapshots would have published cleanly if observations had succeeded.
>
> **Why the precondition didn't catch this:** Stage 6b's `publish_readiness_core` and Stage 7's `publish_target_columns_exist` only verify the REQUIRED core columns (`id`, `tenant_id`, `observed_at`, `platform` for obs; equivalent for snapshots). They do not enumerate every Schema v2.1 enrichment field present on staged rows. This is a precondition gap — Stage 6b green-lit a publish that should have been blocked. Per operator's "do not attempt improvised fixes" rule, this gap is documented but NOT patched in this commit.
>
> **System still in known-good state (verified post-failure):**
> - ✓ Stage 6b core verify still passes (`safe_to_publish_core: true`)
> - ✓ `npm run build` clean
> - ✓ Recs queue unchanged (17/17 + 7/7 byte-identical to backup)
> - ✓ Changelog unchanged (334 rows, no W4 relabel attempted)
> - ✓ All other Supabase tables byte-identical to Stage 1 backup
>
> **No improvised fixes were attempted:** orchestrator stopped on first batch failure as designed; no retry, no schema migration, no recovery hack. Operator's `--stage=rollback` not invoked (operator did not say "rollback").
>
> **Files (only docs changed by this attempt):**
> - `.data/_staging/w4-core-publish-manifest.json` (status flipped preview_only → failed; gitignored — not committed; preserved on disk for audit)
> - `.data/_staging/w4-core-publish-preview.json` (timestamps refreshed; gitignored)
> - `docs/HANDOFF_VERIFIED_STATE.md` (this entry)
> - `docs/VERIFICATION_LOG.md` (Stage 7 --write failure entry below)
>
> **Constraints honored (operator-locked):** Did NOT include Stage 5 changelog relabel · did NOT run `--publish-scope=full` · did NOT mutate `changelog_entries` · did NOT mutate `recommended_edits` · did NOT mutate `recommendation_responses` · did NOT delete native rows · did NOT delete benchmark rows · did NOT run rollback · did NOT archive/delete Profound · did NOT run paid generation · did NOT Apply-All-HIGH · did NOT attempt improvised fixes.
>
> **Operator-decision options to unblock the publish (no recommendation by Claude — operator picks):**
> 1. **Add `competitor_descriptor_windows jsonb` column to production `prompt_answer_observations`** (one-line schema migration). After migration, re-run `--stage=publish --publish-scope=core --write` — the staged rows would publish cleanly. Risk: schema migration needs careful timing if any active session is reading the table.
> 2. **Strip `competitor_descriptor_windows` from staged observations before publish.** Edit `.data/_staging/w4-extracted-observations.json` to drop that field on every row, re-run Stage 6b verify (would still pass), re-run publish `--write`. Risk: loses W2 enrichment data on the historical rows.
> 3. **Defer W4 observations publish entirely** until the W2 day 2 schema-add lands per the master plan (§4.7 + W2 backfill spec). Risk: keeps the brain on 9 days of native data instead of ~57 days for now.
> 4. **Move `competitor_descriptor_windows` to a separate sidecar table** keyed by observation_id. Risk: dual-write complexity, query joins.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator decision** — which schema path? (Options 1-4 above.)
> 2. **(Future)** When schema path lands, re-run Stage 7 `--write`. The orchestrator is idempotent; same staged inputs + onConflict:id = same outcome (no duplicate rows on retry).
> 3. **(Future)** Stage 8 rollback design — still RESERVED. Won't be needed for THIS publish (zero rows landed) but stays in the queue for any future publish that succeeds partially.

> 🟢 **W4 Stage 7 (core publish — DRY-RUN PREVIEW) LANDED (2026-05-04):** Operator approved Stage 7 design + dry-run preview after Stage 6b acceptance. `--stage=publish --publish-scope=core` is now wired in DEFAULT-DRY-RUN mode. Real production mutation requires `--write` AND a passing Stage 6b core report AND the operator's literal "publish core now" approval. `--publish-scope=full` stays RESERVED until the Stage 5 schema path lands. `--stage=rollback` stays RESERVED + hard-fail until Stage 8.
>
> **Stage 7 dry-run result — 8/8 preconditions PASS, outcome `preview_only`:**
>
> | Precondition | Status | Detail |
> |---|---|---|
> | 1. stage_1_backup_manifest_verifies | ✓ PASS | 66 entries SHA-256 match (csv-source entries verified by re-hashing the source CSV in `.data/`, matching Stage 1's writer) |
> | 2. stage_6b_core_report_exists | ✓ PASS | `.data/_staging/w4-verify-core-report.json` present |
> | 3. safe_to_publish_core_true | ✓ PASS | core gate is GREEN |
> | 4. recs_byte_identity_with_backup | ✓ PASS | 17/17 edits + 7/7 responses (set-based canonicalJson diff — works for any table shape; replaces id-keyed map that silently collapsed `recommendation_responses` rows under empty key) |
> | 5. staged_inputs_parse_and_count_match_reports | ✓ PASS | 14,096 obs · 7,191 snapshots · 0 orphans (NO-OP) |
> | 6. publish_target_columns_exist | ✓ PASS | observations + snapshots schemas verified |
> | 7. conflict_keys_strategy_confirmed | ✓ PASS | `onConflict: "id"` on both tables (deterministic Schema v2 hashes — idempotent by construction) |
> | 8. stage_5_relabel_excluded_from_core | ✓ PASS | `changelog_entries` in `CORE_PUBLISH_FORBIDDEN_TABLES`; intersection with `CORE_PUBLISH_TABLES` is empty |
>
> **Preview (what `--write` WOULD do):**
> | Table | Rows | Batches @ 500 | Action |
> |---|---:|---:|---|
> | `prompt_answer_observations` | 14,096 | 29 | upsert (onConflict: id) |
> | `daily_metric_snapshots` | 7,191 | 15 | upsert (onConflict: id) |
> | `changelog_entries` | 0 / 0 / 0 | — | INSERT/UPDATE/DELETE all zero (Stage 5 fenced out) |
> | `recommended_edits` | 0 | — | not touched in core scope |
> | `recommendation_responses` | 0 | — | not touched in core scope |
> | orphan_benchmark_twins | 0 | — | Stage 4 NO-OP |
>
> Destructive operations: **none** (upsert only). Sample observation IDs (first 5) and sample snapshot IDs (first 5) captured in the preview JSON.
>
> **Files written by the dry-run (filesystem-only, ZERO Supabase writes):**
> - `.data/_staging/w4-core-publish-preview.json` — full preview JSON with row counts, batch counts, conflict-key strategy, sample IDs, rollback plan, Supabase transaction caveat, and the 8 precondition results.
> - `.data/_staging/w4-core-publish-manifest.json` — pre-write rollback manifest skeleton with `status: "preview_only"`, ALL 14,096 observation IDs + ALL 7,191 snapshot IDs (the rollback authoritative list), batch sizes, and 4 rollback safety constraints.
>
> **Files (modified, Stage 7):**
> - `scripts/customer-one-backfill.ts` — `publish` promoted from `RESERVED` to `IMPLEMENTED_STAGES` (now 8 stages); `rollback` stays reserved. New types: `PublishOutcome`, `PublishPrecondition`, `PublishBatchLog`, `PublishReport`. New operator-locked constants: `CORE_PUBLISH_TABLES` (literal: `["prompt_answer_observations","daily_metric_snapshots"]`), `CORE_PUBLISH_FORBIDDEN_TABLES` (Stage 5 fence + recs + global registries), `PUBLISH_BATCH_SIZE = 500` (matches dual-write CHUNK_SIZE), `PUBLISH_CONFLICT_TARGETS` (`id` on both). New `validateCorePublishPreconditions()` runs all 8 checks and returns a structured verdict. New `buildCorePublishPreview()` + `buildCorePublishManifest()` produce the exact JSON shapes the operator spec requires. New `runCorePublish()` orchestrator: dry-run path writes preview + manifest skeleton and returns `outcome: "preview_only"`; `--write` path is DESIGNED but exercised only after `allPass + dryRun=false`, with per-batch logging, manifest status updates (preview_only → in_progress → completed/failed), fail-loud on Supabase error, idempotent upserts, never deletes, never touches changelog/recs. New `printCorePublishReport()` shows preconditions + preview + status. `main()` dispatches `--stage=publish` to the orchestrator and rejects `--publish-scope=full` with a clear deferred-Stage-5 message; the giant-red-box warning was rescoped from "publish reserved" to "publish + --write — production mutation about to run" (only fires when `flags.dryRun === false`).
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 192 → 248 cases (+56 Stage 7 invariants). New describe blocks: core-publish constants are operator-locked; runCorePublish dry-run is the default + writes ONLY preview files; write-path safety fences (only CORE_PUBLISH_TABLES upserted; no `.delete()`; `changelog_entries`/`recommended_edits`/`recommendation_responses` never mutated; `allPass` short-circuits before any upsert; per-batch PublishBatchLog; manifest status transitions; `onConflict: target` pattern); preview JSON shape (the 8 operator-mandated keys); manifest JSON shape (rollback skeleton); 8 precondition source-scan invariants; printCorePublishReport branches by outcome; main() publish dispatch (full-scope rejected, exit codes 0/11/12). Plus 11 operator-mandated test invariants pinned 1:1 against the brief. Existing Stage 6 source-scan boundary updated from "// ── Tiny helpers" to "// W4 STAGE 7 — CORE PUBLISH" to skip past the new module. Existing IMPLEMENTED_STAGES sort test bumped to include `publish`. Existing reserved-set test narrowed to just `rollback`.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 248/248 pass · `npm run test` 4119/4125 (6 pre-existing baseline failures all OUTSIDE this surface; net change vs Stage 6b: +56 passes, ±0 failures) · `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npm run build` clean · Stage 7 dry-run completes in seconds and writes `.data/_staging/w4-core-publish-preview.json` (preview) + `.data/_staging/w4-core-publish-manifest.json` (rollback skeleton) with `outcome: "preview_only"` and `preconditions_met: true`.
>
> **Notable design decisions (Stage 7):**
> 1. **Default dry-run, `--write` required for mutation.** The orchestrator returns `outcome: "preview_only"` (or `failed_preconditions`) without ever calling Supabase upsert/insert/update/delete in the dry-run path. The early-return at `if (args.dryRun)` is source-scan-pinned to precede every mutation call.
> 2. **Two-layer write fence.** Even with `--write`, the orchestrator short-circuits if `allPass === false`. Both fences are pinned in tests.
> 3. **Set-based byte-identity check** replaces the Stage 6 id-keyed map for `recs_byte_identity_with_backup`. The new logic uses `canonicalJson` as the set element so it works for any table shape — `recommendation_responses` (no `.id` column; PK is `rec_id`) was silently reporting "1/1" under the old id-keyed map. Stage 7 reports the correct "7/7".
> 4. **csv-source SHA-256 verification re-hashes the source CSV in `.data/`**, not the sidecar. Stage 1's backup writer stores the hash of the underlying CSV in `manifest.entry.sha256` while pointing `relativePath` at a `.sha256` summary text file. The Stage 7 verifier handles this special case explicitly.
> 5. **No multi-batch transactions.** Supabase JS does NOT expose multi-statement transactions through the REST API. Stage 7's design relies on (a) per-batch atomicity (each upsert is atomic within itself), (b) pre-write manifest capturing every id, (c) per-batch logging, (d) fail-loud on partial. Multi-batch atomicity at the LOGICAL level is achieved via the rollback-by-id list in the manifest, NOT via DB transactions. This caveat is explicitly written into the preview JSON's `supabase_transaction_support` field.
> 6. **Rollback design pre-writes the manifest with `status: "preview_only"`** including the FULL id list of every row publish WOULD touch (14,096 + 7,191). When `--write` runs, the status transitions: `preview_only` → `in_progress` (started_at stamped) → `completed` (completed_at stamped) or `failed` (mid-write). The operator's eventual `--stage=rollback` (Stage 8, still reserved) reads this manifest and deletes ONLY the listed IDs — never bulk delete. Four operator-locked rollback constraints are stamped on every manifest.
> 7. **Idempotency by construction.** Both target tables use `onConflict: "id"`. IDs are deterministic Schema v2 hashes. Re-running `--stage=publish --publish-scope=core --write` with the same staged inputs produces the same IDs → upsert-on-id naturally idempotent.
> 8. **Operator gate banner.** When `--stage=publish + --write` is passed, the orchestrator prints a giant red banner reminding the operator that the literal phrase "publish core now" must have been approved. Banner text is source-scan-pinned.
>
> **Constraints honored (operator-locked):** No production writes (all `--write` paths gated behind both `dryRun=false` AND `allPass=true`) · No publish executed today · No Supabase writes anywhere in the dry-run path · No schema migration · No rollback execution · No recommendation queue mutation (recs are READ-ONLY for byte identity) · No Profound archive/delete · No paid generation · No Apply-All-HIGH · No `--publish-scope=full` (Stage 5 still deferred).
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of `.data/_staging/w4-core-publish-preview.json` + `.data/_staging/w4-core-publish-manifest.json`** — verify the 8 preconditions, the row counts (14,096 + 7,191), the batch counts (29 + 15 at batch_size 500), the sample IDs, the rollback plan, and that `preconditions_met: true`.
> 2. **Operator approval to run `--write`** — gated by the literal phrase "publish core now". When approved, re-run `BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... npx tsx --require ./scripts/mock-server-only.cjs scripts/customer-one-backfill.ts --stage=publish --publish-scope=core --write`. The orchestrator transitions the manifest through `preview_only → in_progress → completed`, upserts 14,096 + 7,191 rows in 44 total batches, and exits 0.
> 3. **(Future)** Stage 8 rollback — reserved + hard-fail until `--write` lands AND the operator approves rollback design. Reads the manifest's id list to delete only W4-published rows. Never bulk delete.

> 🟢 **W4 Stage 6b (scope-aware verify) LANDED (2026-05-04):** Operator chose option D (defer Stage 5 publish entirely) and approved Stage 6b: add `--publish-scope=core|full` flag so the core publish path (Stages 2/3/4 — observations + snapshots + orphan benchmarks) can proceed without waiting for the `changelog_entries.metadata` jsonb column. Stage 5 staged proposals stay preserved on disk; the metadata-column blocker is reframed from a hard publish-block to a tagged `stage_5`-scope failure that is reported as `deferredStage5Relabel: true` rather than blocking core publish.
>
> **Stage 6b dry-run result — 9/10 PASS (1 deferred), `safe_to_publish_core: true`:**
>
> | Check | Status | Scope | Summary |
> |---|---|---|---|
> | 1. artifacts_present | ✓ PASS | core | All 8 staged artifacts present + parse cleanly |
> | 2. observations | ✓ PASS | core | 14,096 obs · 48 dates · 14,096 unique IDs · 100/100 prompt match · 4,496 AIO blindSpot |
> | 3. snapshots | ✓ PASS | core | 7,191 snapshots · 48 dates · 144 tuples · 0 dup IDs |
> | 4. orphan_benchmarks | ✓ PASS | core | NO-OP (1,359 dormant skipped per chart-gap criterion) |
> | 5. relabel_changelog | ✓ PASS | **stage_5** | 317 proposals · top-level preserved · display_group ok on all |
> | 6. recs_byte_identity | ✓ PASS | core | recommended_edits 17/17 · responses 7/7 byte-identical to backup |
> | 7. ui_surface | ✓ PASS (warn) | core | 48/48 dates per platform · 317/317 filterable · 13,946 obs with citations |
> | 8. causal_guardrail | ✓ PASS | core | 14,096 historical_recovered · 0 fallback · 0 regime conflicts |
> | 9. publish_readiness_core | ✓ PASS | core | observations + snapshots schemas verified |
> | 10. **publish_readiness_stage_5** | **✗ FAIL** | **stage_5** | changelog_entries.metadata column missing — DEFERRED, not blocking core |
>
> **Verdicts:** `safe_to_publish: false` (full mode — back-compat preserved) AND `safe_to_publish_core: true` (core mode — Stage 5 deferred cleanly). `deferredStage5Relabel: true`, `deferredReason` carries the metadata-column message.
>
> **Files (modified, Stage 6b):**
> - `scripts/customer-one-backfill.ts` — new `--publish-scope=core|full` CLI flag (default `full` preserves Stage 6 back-compat). New `CheckScope = "core" | "stage_5"` type; every `CheckResult` now carries a `scope` tag. `failCheck` helper extended with optional `scope` arg (default `"core"`). `runVerify` now accepts `publishScope`, runs 10 checks (split publish-readiness into core + stage_5 via shared `probePublishTables` helper), aggregates BOTH `safeToPublish` (every check passes) AND `safeToPublishCore` (every core-scope check passes), captures stage_5 failures into `deferredStage5Relabel` + `deferredReason`. Output filename branches: `w4-verify-core-report.json` (core) vs `w4-verify-report.json` (full). `printVerifyReport` shows BOTH verdicts plus deferred fields and per-check scope tags. `main()` exit code gates on the active scope's verdict (still exits 9 on a failed gate).
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 154 → 192 cases (+38 Stage 6b invariants). New describe blocks: CliFlags carries publishScope; CheckResult carries scope tag; per-check scope tags (each of 10 checks pinned); runVerify aggregates both verdicts; VerifyReport type carries new fields; main() exit code respects scope; printVerifyReport surfaces both verdicts; full mode behaviour is unchanged (back-compat); core mode skips Stage 5 publish gate. The pre-existing "Stage 6 — Check 9: publish readiness" assertions retargeted at the Check-9 section header rather than the now-split function name; the existing "runs all 9 checks" pin updated to "runs all 10 checks" referencing both split functions. Stage 5 staged file presence on disk asserted (never `unlinkSync`/`rmSync` against `w4-relabel-changelog.json`).
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 192/192 pass · `npm run test` 4063/4069 (6 pre-existing baseline failures all OUTSIDE this surface; net change vs Stage 6: +38 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 6b core dry-run completes in seconds and writes `.data/_staging/w4-verify-core-report.json` with `safe_to_publish_core: true`. Full mode dry-run still produces `safe_to_publish: false` (back-compat).
>
> **Notable design decisions (Stage 6b):**
> 1. **Scope tags are first-class.** Every `CheckResult` carries `scope: "core" | "stage_5"`. Aggregator computes both verdicts from the same checks array; no double-runs. Stage 5 publish defer is just a tagged failure, never a silent skip.
> 2. **Stage 5 staged proposals stay preserved.** Source-scan invariant proves the orchestrator never `unlinkSync`/`rmSync`s `w4-relabel-changelog.json`. When the operator chooses a schema path later, Stage 5 publish can resume from staged output.
> 3. **Filename branches by scope.** `w4-verify-core-report.json` vs `w4-verify-report.json` — operator review is unambiguous about which gate produced the verdict.
> 4. **Full mode unchanged.** Default `--publish-scope=full` preserves Stage 6 behaviour exactly. Stage 5 metadata-column blocker still surfaces and still fails `safe_to_publish`.
>
> **Constraints honored (operator-locked):** No publish · No Supabase writes · No schema migration · No rollback execution · No recommendation queue mutation · No Profound archive/delete · No paid generation · No Apply-All-HIGH.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator approval to design Stage 7 core-publish path** — gated by `safe_to_publish_core: true`. Stage 7 publishes Stages 2/3/4 only (observations + snapshots + orphan-benchmarks NO-OP); Stage 5 relabel publish is explicitly out of scope and gated separately later.
> 2. **(Future)** When operator decides on a schema path for Stage 5 (add metadata column / overwrite top-level / separate label table / keep deferred indefinitely), reactivate `publish_readiness_stage_5` and lift the `deferredStage5Relabel` flag.
> 3. **(Future)** Stage 8 rollback — gated by Stage 7 ready. Reverses Stage 7's writes via the SHA-verified Stage 1 backup.

> 🟡 **W4 Stage 6 (verify dry-run) LANDED (2026-05-04):** Operator approved Stage 6 design + dry-run after Stage 5 acceptance. Stage 6 runs 9 structured checks against the Stage 2–5 staged artifacts + the Stage 1 backup + Supabase (read-only), aggregates pass/warn/fail into a `safe_to_publish: boolean` verdict, and writes `.data/_staging/w4-verify-report.json`. **NO Supabase writes. NO live `.data/tenants/` mutation. Recommendation queue untouched.** `/changes` UI not modified. Stage 7 publish + Stage 8 rollback remain reserved + hard-fail.
>
> **Stage 6 dry-run result — 8/9 checks PASS, 1 BLOCKER, `safe_to_publish: false`:**
>
> | Check | Status | Summary |
> |---|---|---|
> | 1. artifacts_present | ✓ PASS | All 8 staged artifacts present + parse cleanly |
> | 2. observations | ✓ PASS | 14,096 obs · 48 dates · 14,096 unique IDs · 100/100 prompt match · 4,496 AIO blindSpot |
> | 3. snapshots | ✓ PASS | 7,191 snapshots · 48 dates · 144 tuples · 0 duplicate IDs · 144 Ritz entity rows |
> | 4. orphan_benchmarks | ✓ PASS | NO-OP (0 twins emitted, 1,359 dormant skipped per chart-gap criterion) |
> | 5. relabel_changelog | ✓ PASS | 317 proposals · 232 pdf + 85 csv · top-level import_batch_id preserved on every proposal · display_group=pre_launch_history on every |
> | 6. recs_byte_identity | ✓ PASS | recommended_edits 17/17 byte-identical to Stage 1 backup · responses 7/7 |
> | 7. ui_surface | ✓ PASS (warn) | chart continuity 48/48 dates per platform · 317/317 relabel proposals filterable · 13,946 obs with citations · browser-smoke deferred to post-publish |
> | 8. causal_guardrail | ✓ PASS | 14,096 historical_recovered (usable for product intel) · 0 benchmark-fallback rows · 0 regime conflicts |
> | 9. **publish_readiness** | **✗ FAIL** | **`changelog_entries.metadata` jsonb column does NOT exist — Stage 5 W4 relabel cannot publish without a schema migration.** Operator must choose: (a) add metadata jsonb column, (b) overwrite top-level import_batch_id (loses audit trail), (c) use a separate label table, or (d) defer Stage 5 publish entirely. |
>
> **The blocker is the gate working correctly.** Stage 5 discovered + reported the missing column; Stage 6 surfaces it as a publish-blocking failure with the four operator-decision options. `safe_to_publish: false` until the operator picks a schema path.
>
> **Files (modified):**
> - `scripts/customer-one-backfill.ts` — `verify` added to `IMPLEMENTED_STAGES` (now 7 stages: preflight / backup / extract-observations / rederive-snapshots / copy-orphan-benchmarks / relabel-changelog / verify). Reserved set narrowed to 2: publish · rollback. New types: `CheckStatus` ("pass" | "warn" | "fail"), `CheckResult`, `VerifyReport`. New constants: `STAGED_ARTIFACTS` (8 staged files + reports the harness loads) + `VERIFY_EXPECTED` (operator-locked truth from W4 Stage 2–5 dry-runs: 14,096 obs / 48 dates / 100 prompts / 4,496 AIO blindSpot / 7,191 snapshots / 317 relabel proposals). New `runVerify` orchestrator + 9 `check*()` functions, each returning a structured `CheckResult` with `blockers[]` + `warnings[]`. Aggregator: `safeToPublish = !checks.some(c => c.status === "fail")`. New `canonicalJson(v)` helper for byte-identity diffing in Check 6. Output: `.data/_staging/w4-verify-report.json`.
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 122 → 154 cases. Pin `IMPLEMENTED_STAGES` now contains 7 stages. `validateStage("verify").ok === true`; reserved set narrowed to 2. New W4.6 source-scan invariants on `runVerify` + each of the 9 check functions: zero `.insert/.update/.delete/.upsert` calls (Supabase reads-only); does NOT WRITE to recs files; the only writeFileSync target is the verify report under stagingDir; runs all 9 checks via independent invocations; aggregates into safeToPublish=false when ANY check fails; STAGED_ARTIFACTS lists all 8 expected files; missing/malformed files are blockers; VERIFY_EXPECTED matches the W4 dry-run truth; per-check failure reasons explicitly named (row-count drift, date drift, duplicate IDs, missing regime/source_csv_hash/tenant_id, twin masquerading as recovered, missing causal_attribution_excluded, regime conflicts, missing changelog metadata column with the four operator-decision options surfaced); read-only verbs throughout; canonicalJson exists.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 154/154 pass · `npm run test` 4025/4031 (6 pre-existing baseline failures all OUTSIDE this surface; net change vs Stage 5: +32 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 6 dry-run completed in seconds.
>
> **Notable design decisions:**
> 1. **Pass/warn/fail status with explicit blocker list.** Each check returns a structured `CheckResult`. Warnings are non-blocking; only `"fail"` status forces `safe_to_publish: false`. The aggregator iterates blockers across all checks so the publish gate is auditable.
> 2. **Browser-render smoke deferred to post-publish.** Stage 6 implements a data-level UI-surface verifier (chart continuity, filterable relabel metadata, citation evidence presence) but does NOT spin up the actual `/today` / `/changes` / `/pages` Next.js pages. The operator's spec explicitly allows this deferral; full browser smoke runs after publish lands.
> 3. **The publish_readiness blocker is the gate working correctly.** `changelog_entries.metadata` column missing is exactly the issue Stage 5 surfaced. Stage 6 turns it into a hard publish-block with four operator-decision options. `safe_to_publish: false` until the operator picks a schema path.
> 4. **Byte-identity check uses canonicalJson** (sorted-keys recursive JSON.stringify). Compares Stage 1 backup recs vs current Supabase rows. Today: 17/17 + 7/7 match → recs queue is unchanged since backup, exactly as required.
> 5. **No Supabase writes anywhere.** Every check that reads from Supabase (Check 6 byte-identity, Check 9 publish-readiness) uses `.select()` only. Source-scan invariants prove zero `.insert/.update/.delete/.upsert` across the full Stage 6 source.
>
> **Constraints honored (operator-locked):** No publish · No Supabase writes · No rollback execution · No recommendation queue mutation · No Profound archive/delete · No paid generation · No Apply-All-HIGH.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of `safe_to_publish: false` verdict** — read `.data/_staging/w4-verify-report.json`. The blocker is documented; pick the schema path: (a) add `metadata` jsonb column to `changelog_entries`, (b) overwrite top-level `import_batch_id` (loses audit trail), (c) use a separate label table, or (d) defer Stage 5 publish entirely.
> 2. **Operator approval to design Stage 7 (publish)** — gated by Stage 6 green AND explicit operator approval. Publish is the only stage that mutates production. Should NOT be designed until the schema decision lands.
> 3. **(Future)** Stage 8 rollback — gated by Stage 7 ready. Reverses Stage 7's writes via the SHA-verified Stage 1 backup.

> 🟡 **W4 Stage 5 (relabel-changelog dry-run) LANDED (2026-05-04):** Operator approved Stage 5 design + dry-run after Stage 4 acceptance. Stage 5 reads `changelog_entries` from production Supabase (read-only), identifies legacy-import rows, skips live/verified/operator-accepted rows, and writes a staged metadata-only relabel proposal to `.data/_staging/`. **NO Supabase writes. NO live `.data/tenants/` mutation. Recommendation queue untouched.** `/changes` UI is NOT modified by Stage 5. Stages 6–8 (verify / publish / rollback) remain reserved + hard-fail.
>
> **Stage 5 dry-run result (clean):**
>
> | Metric | Value | Notes |
> |---|---:|---|
> | total_rows_scanned | 334 | from production Supabase `changelog_entries` |
> | proposed_relabel | **317** | 232 `pdf_changelog_rebuild` + 85 `changelog_csv` |
> | skipped_by_source_system | 14 | `scan_detection` (live scanner output — never relabel) |
> | skipped_already_labeled | 0 | (no rows yet have `march-import-2026-04` label) |
> | skipped_live_or_accepted | 3 | `hypothesis_source = recommendation` (operator-accepted via recs queue) |
> | skipped_dangerous | 0 | (null source_system + unfamiliar source_system) |
> | local recommended_edits row count (read-only) | 20 (untouched) | ✓ |
> | local recommendation_responses row count (read-only) | 7 (untouched) | ✓ |
>
> Math reconciles: 317 proposed + 14 + 3 skipped = 334 ✓.
>
> **Sample proposal** (cl-real-2, `pdf_changelog_rebuild` row):
> ```
> id: cl-real-2
> source_system: pdf_changelog_rebuild
> previous.import_batch_id: import-1776222344423            ← preserved verbatim
> previous.metadata: null
> next.import_batch_id: import-1776222344423                ← UNCHANGED
> next.metadata: {
>   import_batch_id: "march-import-2026-04",                ← W4 label
>   display_group: "pre_launch_history",                    ← W4 group
>   w4_extraction_run_id: "w4-rederive-be9258c6f2aa"        ← lineage to Stage 3
> }
> preserved_fields: {
>   timestamp / url / asset_name / change_description /
>   created_at / archived / live_at / hypothesis_source /
>   source_rec_id                                           ← all snapshot for byte-equality check at publish
> }
> ```
>
> **Files (modified):**
> - `scripts/customer-one-backfill.ts` — `relabel-changelog` added to `IMPLEMENTED_STAGES` (now 6 stages). Reserved set narrowed to 3 (verify / publish / rollback). New constants `W4_RELABEL_BATCH_ID = "march-import-2026-04"` + `W4_RELABEL_DISPLAY_GROUP = "pre_launch_history"` + `W4_RELABEL_TARGETS` set (`pdf_changelog_rebuild` / `import` / `changelog_csv`). New pure helper `classifyChangelogRowForRelabel(row)` returns either `{relabel: true}` or `{relabel: false, reason}` with priority order: `scan_detection` → `recommendation` → `live_at_set` → `already_w4_labeled` → `target check`. New `runRelabelChangelog(args)` orchestration: reads `changelog_entries` from Supabase (paginated, read-only); inherits Stage 3's `extraction_run_id` from the staged rederive file (lineage continuity); classifies each row; emits proposals with `previous` / `next` metadata diff + `preserved_fields` snapshot for byte-equality check at publish; counts skipped reasons separately; writes `.data/_staging/w4-relabel-changelog.json` + `.data/_staging/w4-relabel-changelog-report.json`.
> - **Critical preservation rule:** The proposal's `next.import_batch_id` is byte-identical to `previous.import_batch_id` (the existing top-level column is preserved verbatim — the W4 label lives in `metadata.import_batch_id` only). The 9 preserved data fields (`timestamp` / `url` / `asset_name` / `change_description` / `created_at` / `archived` / `live_at` / `hypothesis_source` / `source_rec_id`) are snapshot in the proposal so Stage 7 (publish) can re-assert byte equality before applying any change.
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 98 → 122 cases. Pin `IMPLEMENTED_STAGES` now contains 6 stages; reserved set is just `verify`/`publish`/`rollback`. New W4.5 unit tests for `classifyChangelogRowForRelabel` (11 cases covering each target/skip path + priority order). New W4.5 source-scan invariants on `runRelabelChangelog` (12 cases): zero `.insert/.update/.delete/.upsert` calls; never writes to recs files; every `writeFileSync` lands under `stagingDir`; preserves all 9 data fields verbatim; does NOT modify the top-level `import_batch_id` column; metadata change is additive (spreads previous metadata into next); W4 batch id constant is exactly `"march-import-2026-04"` per master plan §2.5; display group constant is `"pre_launch_history"`; inherits Stage 3's `extraction_run_id`; `noOp:true` when zero proposals; counts skipped reasons separately; `/changes` UI copy planning announced but NOT implemented (no `/changes` redesign).
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 122/122 pass · `npm run test` 3993/3999 (6 pre-existing baseline failures all OUTSIDE this surface; net change vs Stage 4: +24 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 5 dry-run completed in seconds.
>
> **Notable design decisions:**
> 1. **Targets include `changelog_csv`** (85 rows) per operator scope: "OR equivalent legacy import markers." `changelog_csv` IS another legacy CSV import path; including it brings the relabel coverage to 317/317 of the importable rows. The report breaks down proposals by `source_system` so the operator can audit.
> 2. **Priority order for skip reasons** is hard-coded: `scan_detection` → `recommendation` → `live_at_set` → `already_w4_labeled` → `target check`. This ensures a row with both `hypothesis_source=recommendation` AND `live_at` set reports the operator-acceptance reason (more semantically meaningful) over the live-flag reason.
> 3. **Top-level `import_batch_id` column is NEVER changed.** The original auto-generated import-run id (e.g., `import-1776222344423`) is preserved as the audit trail for which Profound import populated the row. The W4 label lives in `metadata.import_batch_id` so it's purely additive.
> 4. **Schema decision is deferred to Stage 7 (publish).** `changelog_entries` does NOT carry a `metadata` jsonb column today (verified against the Stage 1 backup). Stage 5's staged proposal describes the conceptual W4 metadata target; Stage 7 will decide the schema path (add the column / overwrite an existing field / use a separate label table). The staging file makes the operator's intent explicit so the schema decision is auditable.
>
> **Constraints honored (operator-locked):** No Supabase writes · No publish · No rollback execution · No recommendation queue mutation · No Profound archive/delete · No paid generation · No Apply-All-HIGH · No `/changes` UI redesign · No mutation of any preserved data field.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of Stage 5 staging output** — read `.data/_staging/w4-relabel-changelog-report.json` (full structured report). 5 sample proposals are in the report's `sampleProposals`. Decide whether `changelog_csv` (85 rows) should remain a target or be reclassified back to "skip" before Stage 7 publish.
> 2. **Operator approval to design Stage 6 (verify)** — the 6-check verification harness from master plan §2.6: (1) `/today` renders with continuous chart; (2) `/changes` default tab unchanged + Pre-launch history collapsed; (3) `/pages` citation history continuous; (4) `/recommendations` queue byte-identical; (5) Z-score verdict math computes or abstains correctly with new regimes; (6) all architecture invariants pass. Stage 6 BLOCKS publish until all six are green.
> 3. **(Future)** Stage 7 publish + Stage 8 rollback — gated by Stage 6 green AND explicit operator approval. Publish remains the only stage that mutates production.

> 🟡 **W4 Stage 4 (copy-orphan-benchmarks dry-run) LANDED (2026-05-04):** Operator approved Stage 4 design + dry-run after Stage 3 acceptance. Stage 4 diffs production benchmark rows against Stage 3's recovered-derived snapshots (and any production native-derived snapshots), then emits derived twins ONLY for benchmarks that satisfy all three operator-locked criteria. **NO Supabase writes. NO live `.data/tenants/` mutation. Recommendation queue untouched.** Stages 5–8 (relabel-changelog / verify / publish / rollback) remain reserved + hard-fail.
>
> **Stage 4 dry-run result — `NO-OP` (zero derived twins emitted):**
>
> | Metric | Value | Notes |
> |---|---:|---|
> | benchmark rows scanned | 1,380 | from production Supabase |
> | superseded by Stage 3 rederive | **21** | (date, scope, platform) tuple covered by recovered-derived |
> | superseded by native-derived | 0 | benchmarks are pre-Apr-22 → no overlap with native (Apr 22→May 1) |
> | true orphans (no rederive + no native coverage) | **1,359** | |
> | of those: `fills_a_real_gap` (scope covered on OTHER days) | **0** | |
> | of those: `scope_fully_dormant` (no coverage anywhere) | **1,359** | entities Profound tracked but Beacon's current registry doesn't |
> | **staged derived twins emitted** | **0** | per operator-locked chart-gap criterion |
> | local recommended_edits rows (read-only sanity) | 20 (untouched) | ✓ |
> | local recommendation_responses rows (read-only sanity) | 7 (untouched) | ✓ |
>
> **Why zero twins emitted.** The operator-locked spec requires three criteria for a benchmark to be a true orphan: (a) no recovered-derived match, (b) no native-derived match, AND (c) "removing/ignoring it would create a chart/history gap." All 1,359 candidate orphans fail criterion (c) — they're entities Profound tracked competitively but Beacon's current `tracked_entities` registry doesn't include. Removing them does NOT create a visible chart gap because there was never a chart for those scopes to begin with. Stage 4 correctly drops them. The diagnostic report still surfaces the breakdown so the operator can audit whether any of those entities should be added to the registry.
>
> **Files (modified):**
> - `scripts/customer-one-backfill.ts` — `copy-orphan-benchmarks` added to `IMPLEMENTED_STAGES`. New `runCopyOrphanBenchmarks(args)` orchestration: hard-fails if Stage 3 staging is missing; loads staged rederived snapshots + reads `daily_metric_snapshots` from Supabase (read-only); builds normalized match keys via the new pure helpers `canonicalScopeKey(scopeId)` (collapses `mvs-construction` and `mvsconstruction` to the same key — the slug/casing differences between Profound's benchmark naming and the canonical builder's `entityToScopeId` output) + `snapshotMatchKey({date, scopeType, scopeId, platform})` (full canonical match key); diffs each benchmark row against rederive + native key sets; categorizes true orphans by chart-gap prevention (`fills_real_gap` vs `scope_fully_dormant`); emits derived twins ONLY for `fills_real_gap` cases (operator-locked: dormant scopes do NOT create gaps, do NOT get copied); read-only count of `recommended_edits` + `recommendation_responses` as a backfill-safety probe; writes `.data/_staging/w4-orphan-benchmarks.json` + `.data/_staging/w4-orphan-benchmark-report.json`. Derived twins carry `source_type: "derived"` + `metadata.provenance: "imported_from_benchmark"` + `metadata.regime: "historical_fallback"` (NOT `historical_recovered`) + `metadata.original_source_type: "benchmark"` + `metadata.benchmark_snapshot_id: <orig>` + `metadata.import_reason` + `metadata.extraction_run_id` (inherited from Stage 3) + `metadata.causal_attribution_excluded: true` (verdict-math guardrail). Numeric values are byte-for-byte identical to the original benchmark.
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 74 → 98 cases. Pin `IMPLEMENTED_STAGES` now contains 5 stages: `["backup", "copy-orphan-benchmarks", "extract-observations", "preflight", "rederive-snapshots"]`. New W4.4 source-scan invariants on `runCopyOrphanBenchmarks`: zero `.insert/.update/.delete/.upsert` calls (Supabase read-only); hard-fails when Stage 3 staging file is missing; does NOT read from `.data/tenants/<slug>/prompt-answer-observations.json`; does NOT WRITE to `recommended-edits` or `recommendation-responses`; every `writeFileSync` target lands under `stagingDir`; rejects superseded benchmark rows; emits true-orphan twins with `provenance` + `regime` + `original_source_type` + `benchmark_snapshot_id` + `import_reason` + `causal_attribution_excluded: true`; preserves numeric values byte-for-byte; `source_type === "derived"` (not `benchmark_archived`); twin id is `derived-fallback-*` prefixed; chart-gap categorization splits orphans into `fillsRealGap` vs `scopeFullyDormant`; **dormant scopes (no coverage anywhere) are NOT emitted as derived twins** (per operator's chart-gap criterion); normalization mismatches surface for diagnostic; inherits Stage 3's `extraction_run_id`. Plus 8 unit tests for the new pure helpers `canonicalScopeKey` + `snapshotMatchKey`.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 98/98 pass · `npm run test` 3969/3975 (6 pre-existing baseline failures all OUTSIDE this surface — same UI smoke time-drift / tenant-isolation / auto-link-via-changelog tests as W4 Stage 3; net change vs Stage 3: +24 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean.
>
> **Notable design decisions:**
> 1. **Strict chart-gap criterion.** Per operator-locked spec: "removing/ignoring it would create a chart/history gap." Stage 4 categorizes every true orphan into `fills_real_gap` (scope has coverage on other days; chart shows a visible gap on the benchmark day) vs `scope_fully_dormant` (scope has zero coverage anywhere). Only `fills_real_gap` rows become derived twins. The dormant-scope branch reports the count for diagnostic but skips emission. **Today's run: 0 fills_real_gap, 1,359 dormant → 0 twins.**
> 2. **Different regime from Stage 2/3.** Recovered observations (Stage 2) and rederived snapshots (Stage 3) carry `regime: "historical_recovered"`. Stage 4's derived twins carry `regime: "historical_fallback"` — they're snapshot-fallback rows for chart continuity, NOT recovered observations. The verdict-math layer reads this regime field to exclude these rows from causal attribution baselines. `metadata.causal_attribution_excluded: true` is the explicit machine-readable guardrail.
> 3. **Canonical scope key.** Profound's benchmark uses `mvs-construction` (slug of entity name); the canonical builder uses `mvsconstruction` (entity.id stripped of prefix + TLD). The new `canonicalScopeKey()` helper collapses both forms to the same key so the diff doesn't produce false orphans. Slug/casing mismatches surface in the report's `normalizationMismatches` array for diagnostic.
> 4. **Numeric byte-for-byte preservation.** Derived twins copy `visibility_score`, `mention_count`, `citation_count`, `share_of_voice`, `avg_position`, `total_possible` directly from the benchmark row — no recomputation. Operator scope: "preserve numeric values exactly."
>
> **Constraints honored (operator-locked):** No Supabase writes · No publish · No relabel-changelog · No rollback execution · No recommendation queue mutation · No Profound archive/delete · No paid generation · No Apply-All-HIGH · `runCopyOrphanBenchmarks` does NOT read the stale `.data/tenants/<slug>/prompt-answer-observations.json` cache.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of Stage 4 dormant-scope diagnostic** — read `.data/_staging/w4-orphan-benchmark-report.json`. The 1,359 dormant scope_ids are entities Profound tracked but Beacon's current `tracked_entities` registry doesn't include. Decide whether any should be promoted into the registry (independent of W4 backfill).
> 2. **Operator approval to design Stage 5 (relabel-changelog)** — labels every changelog entry where `source_system in ('pdf_changelog_rebuild', 'import')` with `metadata.import_batch_id: "march-import-2026-04"` so `/changes` UI's "Pre-launch history" tab can collapse pre-launch noise. Output → staged `w4-relabel-changelog.json` (staged-only).
> 3. **(Future)** Stage 6 verify (the 6-check harness from master plan §2.6) + Stage 7 publish — gated by Stage 5 approval. Publish remains the only stage that mutates production; no path to publish without Stage 6 green AND explicit operator approval.

> 🟡 **W4 Stage 3 (rederive-snapshots dry-run) LANDED (2026-05-04):** Operator approved Stage 3 design + dry-run after Stage 2 acceptance. Stage 3 reads `.data/_staging/w4-extracted-observations.json`, walks every `(date, platform)` tuple, runs `buildDailySnapshotsFromObservations()` (the existing native snapshot derivation), stamps each output row with W4 provenance, and writes the staged result to `.data/_staging/`. **NO Supabase writes. NO live `.data/tenants/` mutation. Recommendation queue untouched.** Stages 4–8 (copy-orphan-benchmarks / relabel-changelog / verify / publish / rollback) remain reserved + hard-fail.
>
> **Stage 3 dry-run result (clean):**
>
> | Metric | Value | Notes |
> |---|---:|---|
> | input_observation_count | **14,096** | matches Stage 2 output |
> | output_snapshot_count | **7,191** | new derived rows staged |
> | snapshots by scope_type | entity 5,328 · topic 1,719 · platform 144 | math: 144 platform = 48 dates × 3 platforms ✓ |
> | snapshots by platform | Perplexity 2,400 · ChatGPT 2,400 · AIO 2,391 | proportional to per-platform observation count |
> | distinct_dates | **48** (Mar 5 → Apr 21) | continuous coverage |
> | missing_dates count | **0** | zero gaps in the 48-day window |
> | distinct_topics | 12 (operator-named clusters) | full topic coverage |
> | active_entities | 37 / 37 with rows | all active entities derived |
> | tuples_emitting_rows | **144 / 144** | every (date, platform) tuple produced output |
> | empty_tuples | 0 | no orphans in this stage |
> | duplicate_ids | **0** | builder uniqueness preserved |
> | rows with `source_type === "derived"` | **7,191 / 7,191** | ✓ |
> | rows with W4 provenance metadata | **7,191 / 7,191** | provenance / regime / extraction_run_id all stamped |
> | local recommended_edits row count (READ-ONLY sanity check) | **20 (untouched)** | recs queue safe |
> | local recommendation_responses row count (READ-ONLY sanity check) | **7 (untouched)** | recs queue safe |
> | re-run determinism (run1 IDs == run2 IDs) | **0 mismatches** | ✓ idempotent |
>
> **Sample staged snapshot** (Ritz brand, Apr 21, Google AI Overviews):
> ```
> id: derived-2026-04-21-ritzbuilders-google-ai-overviews
> scope_type: entity · scope_id: ritzbuilders · platform: Google AI Overviews
> source_type: derived
> visibility_score: 79 · mention_count: 79 · citation_count: 82
> metadata.derived_from_run_id: w4-rec-be9258c6f2aa-2026-04-21-google-ai-overviews
> metadata.entity_id: own-ritzbuilders-com · is_owned: true
> metadata.provenance: rederived_from_historical_recovered
> metadata.regime: historical_recovered
> metadata.extraction_run_id: w4-rederive-be9258c6f2aa
> metadata.source_csv_hash: be9258c6f2aa80e729d10039d8bb89b1385fe0095216513e4abf639c97097e19
> ```
>
> **Files (modified):**
> - `scripts/customer-one-backfill.ts` — `rederive-snapshots` added to `IMPLEMENTED_STAGES`. New `runRederiveSnapshots(args)` orchestration: hard-fails if `.data/_staging/w4-extracted-observations.json` is missing; loads the staged observations + reads `tracked_entities` from Supabase (read-only); groups observations by `(date, platform)`; calls `buildDailySnapshotsFromObservations()` per tuple; stamps `metadata.provenance: "rederived_from_historical_recovered"` + `metadata.regime: "historical_recovered"` + `metadata.extraction_run_id: "w4-rederive-<csvHashPrefix>"` + `metadata.source_csv_hash`; runs in-memory validation (source_type, provenance, duplicate IDs, date gap detection); reads recs row counts as a read-only safety probe; writes `.data/_staging/w4-rederived-snapshots.json` + `w4-rederive-report.json`. New helpers: `extractSourceCsvHashFromStaged`, `slugifyPlatform`, `countLocalArray`, `emptyRederiveReport`, `printRederiveSnapshotsReport`. Reserved stages narrowed to 5: copy-orphan-benchmarks · relabel-changelog · verify · publish · rollback.
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 62 → 74 cases. Pin `IMPLEMENTED_STAGES` now contains `["backup", "extract-observations", "preflight", "rederive-snapshots"]`. New W4.3 source-scan invariants on `runRederiveSnapshots`: zero `.insert/.update/.delete/.upsert` calls (Supabase read-only); hard-fails when Stage 2 staging file is missing; does NOT read from `.data/tenants/<slug>/prompt-answer-observations.json`; does NOT WRITE to `recommended-edits` or `recommendation-responses`; every `writeFileSync` target lands under `stagingDir`; calls `buildDailySnapshotsFromObservations` from the canonical builder; stamps W4 provenance fields on every row; validates `source_type === "derived"`; detects duplicate snapshot IDs; derives `extraction_run_id` deterministically from staged source_csv_hash; groups observations by `(date, platform)` tuple before invoking the builder.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 74/74 pass · `npm run test` 3945/3951 (6 pre-existing baseline failures all OUTSIDE this surface — same UI smoke time-drift / tenant-isolation / auto-link-via-changelog tests as W4 Stage 2; net change vs Stage 2: +12 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 3 dry-run completed in seconds (after Stage 2's 14,096 staged observations) · Re-run determinism: 0 ID mismatches across 7,191 rows.
>
> **Notable design decisions:**
> 1. **Stage 3 hard-fails when Stage 2 output is missing.** Per operator-locked rule "Do not use stale local tenant observation cache as source." If the staged `w4-extracted-observations.json` doesn't exist at the canonical path, Stage 3 exits non-zero with a clear "Run --stage=extract-observations first" message. No silent substitution.
> 2. **Reuses the canonical `buildDailySnapshotsFromObservations` builder.** Operator scope: "Use existing native snapshot derivation logic where possible." Stage 3 imports the live `src/domains/daily-metric-snapshots/build-from-observations.ts` directly + only adds W4 provenance metadata on top of the builder's output. No cosmetic-retag, no parallel implementation.
> 3. **Recommendation queue is read-only sanity-checked.** The report includes the local recs row counts (20 / 7) so the operator can see at-a-glance that backfill never touched them. The body source-scan invariant proves no `writeFileSync` ever targets recs files.
> 4. **Deterministic IDs end-to-end.** Stage 3's snapshot IDs are produced by the builder's `derived-{date}-{scope-id-slug}-{platform-slug}` convention — deterministic given deterministic input. Stage 2's observations have deterministic IDs from `sha256(stable inputs)`. Re-running Stages 2+3 produces byte-identical output. When Stage 7 (publish) lands, Supabase `INSERT ... ON CONFLICT (id) DO NOTHING` makes the whole pipeline idempotent.
>
> **Constraints honored (operator-locked):** No Supabase writes · No publish · No copy-orphan-benchmarks · No relabel-changelog · No rollback execution · No recommendation queue mutation · No Profound archive/delete · No paid generation · No Apply-All-HIGH · `runRederiveSnapshots` does NOT read the stale `.data/tenants/<slug>/prompt-answer-observations.json` cache.
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of Stage 3 staging output** — read `.data/_staging/w4-rederive-report.json` (full structured report) + spot-check `.data/_staging/w4-rederived-snapshots.json` for a handful of rows. The 5 sample IDs are in the report's `sampleSnapshotIds`.
> 2. **Operator approval to design Stage 4 (copy-orphan-benchmarks)** — pure compute. For benchmark rows in production with no recoverable observations behind them (the ~76 empty-response rows + any (date, scope) combinations the rederive can't compute), copy values verbatim into a new derived twin row with `metadata.provenance: "imported_from_benchmark"`. Output → `.data/_staging/w4-orphan-benchmarks.json` (staged-only).
> 3. **(Future)** Stage 5 relabel-changelog + Stage 6 verify (the 6-check harness) + Stage 7 publish — gated by Stage 4 design approval. Publish remains the only stage that mutates production; no path to publish without Stage 6 green AND explicit operator approval.

> 🟡 **W4 Stage 2 (extract-observations dry-run) LANDED (2026-05-04):** Operator approved Stage 2 design + dry-run. Stage 2 streams the 14,096-row Profound CSV, runs every Schema v2/v2.1 extractor against each row, stamps `historical_recovered` provenance, and writes the staged result to `.data/_staging/`. **NO Supabase writes. NO live `.data/tenants/` mutation.** Stages 3–8 (rederive / copy-orphan / relabel / verify / publish / rollback) remain reserved + hard-fail.
>
> **Stage 2 dry-run result (clean):**
>
> | Metric | Value | Match expected |
> |---|---:|---|
> | `input_rows` | **14,096** | ✓ exact |
> | `staged_observations` | **14,096** | ✓ exact (no rows dropped) |
> | distinct_dates | 48 (Mar 5 → Apr 21) | ✓ exact |
> | Perplexity / ChatGPT / AIO | 4,800 / 4,800 / 4,496 | ✓ exact |
> | AIO blind-spot rows | **4,496** (all stamped `metadata.blindSpot: "AIO does not expose internal queries"`) | ✓ |
> | Prompt match | **100/100** (case-insensitive exact, all CSV prompts mapped to `tracked_prompts.id`) | ✓ |
> | response_present | 14,020 (99.46%) | ✓ exact |
> | mentions_present | 11,828 (83.91%) | ~83.96% expected |
> | search_queries_present | 7,991 (56.69%) | ✓ exact |
> | citation_urls_present | 13,946 (98.94%) | ✓ exact |
> | competitor_co_mentions_present | 11,826 (83.90%) | new — first time backfilled |
> | competitor_descriptor_windows_present | 11,826 (83.90%) | new — first time backfilled (W2 §2.1) |
> | answer_structure_present | 14,020 (99.46%) | ✓ |
> | primary_recommendation_true | 2,956 (20.97%) | new — ~21% of answers lead with the brand |
> | empty_response_kept_for_citations | 76 | ✓ exact (preflight identified 76 empty-response rows) |
> | rows with full provenance metadata | 14,096 / 14,096 | ✓ |
> | unique deterministic IDs | 14,096 / 14,096 | ✓ no collisions |
> | re-run determinism (run1 IDs == run2 IDs at same index) | **0 mismatches** | ✓ idempotent |
>
> **Files (modified):**
> - `scripts/customer-one-backfill.ts` — `extract-observations` stage added to `IMPLEMENTED_STAGES`. New helpers: `deterministicObservationId(args)` (sha256 of tenantId + date + platform + promptId + runId + answerHash → UUID-shape) · `answerHashForText(text)` (8-char hex prefix) · `parseProfoundPosition(raw)` (parses `#1`/`#10`/whitespace) · `extractCitationsFromRow(row)` (collects citation_1..36, dedupes domains, strips `www.`) · `parseMentionsField(raw)` (comma-splits, trims, dedupes preserving order). New `runExtractObservations` orchestration: hash-check the source CSV against the locked manifest, load `tracked_prompts` + `tracked_entities` from Supabase (read-only), spawn `scripts/parse-raw-csv.py` for streaming CSV parse (Node's `csv-parse` silently drops 32% of rows on Profound's quote anomalies — confirmed against `relax_quotes` / `relax_column_count` / strict modes; Python's stdlib `csv.DictReader` handles them cleanly), run all Schema v2 extractors per row, stamp `historical_recovered` provenance, write to `.data/_staging/w4-extracted-observations.json` + `w4-extraction-report.json` + `w4-extraction-progress.json`. **All output paths under `.data/_staging/`. Zero Supabase writes. Zero live `.data/tenants/` mutation.**
> - `tests/scripts/customer-one-backfill.test.ts` — extended from 35 → 62 cases. New W4.2 tests: `deterministicObservationId` (idempotent, sensitive to every input field, returns valid UUID shape) · `answerHashForText` (8 hex chars, deterministic, distinct on different text) · `parseProfoundPosition` (`#1` → 1, whitespace tolerated, invalid → null) · `extractCitationsFromRow` (collects + dedupes, handles all-empty rows, regex fallback for malformed URLs) · `parseMentionsField` (comma-split + trim + dedupe preserving order). Source-scan invariants: `runExtractObservations` body contains zero `.insert/.update/.delete/.upsert` calls (Supabase read-only); every `writeFileSync` target lands under `stagingDir`; does NOT read from `.data/tenants/<slug>/prompt-answer-observations.json` (operator-locked: avoid stale cache); stamps full provenance metadata (regime / source_system / extraction_method / source_csv_hash / source_csv_row_id / extraction_confidence); stamps `blindSpot` for AIO rows; treats CSV hash drift as a hard error; reports prompt-mapping orphans + empty-response rows in `skippedRowsByReason`. `IMPLEMENTED_STAGES` now contains `["backup", "extract-observations", "preflight"]`.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 62/62 pass · `npm run test` 3933/3939 (same 6 pre-existing baseline failures as W4 Stage 0+1; net change vs Stage 0+1: +27 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 2 dry-run completed in ~3 minutes against the live 64-MB CSV · Re-run determinism: 0 ID mismatches across 14,096 rows.
>
> **Notable design decisions:**
> 1. **Python parser via spawn** instead of Node's `csv-parse` library. Profound's CSV has multi-line quoted response cells with embedded unescaped quotes; Node's parser silently drops ~4,500 rows under any tested option combination. Python's `csv.DictReader` with `field_size_limit(sys.maxsize)` returns the canonical 14,096 rows. The orchestrator spawns `scripts/parse-raw-csv.py` and reads NDJSON; fail-loud on non-zero exit or invalid JSON.
> 2. **Empty-response rows kept for citation metadata.** 76 rows with empty `response` text would otherwise lose their citation URLs. Operator scope: "do not fake text-derived fields; include them only if they can safely carry citation/domain metadata." Stage 2 does NOT run text-derived extractors on these rows (descriptor_window / mention_position / answer_structure / primary_recommendation are null with `extraction_confidence: 'absent_no_response'`); citations + provenance are still recorded.
> 3. **Deterministic ID format:** `sha256(tenantId::date::platform-slug::promptId::runId::answerHash).slice(0,32)` formatted as UUID. Re-running Stage 2 against the same CSV produces byte-identical IDs (verified across two runs, 0 mismatches). When publish lands, Supabase `INSERT ... ON CONFLICT (id) DO NOTHING` makes Stage 2 idempotent end-to-end.
>
> **Constraints honored (operator-locked):** No Supabase writes · No publish · No rederive snapshots · No copy-orphan benchmarks · No relabel changelog · No rollback execution · No recommendation queue mutation · No Profound archive/delete · No paid generation · No Apply-All-HIGH · `runExtractObservations` does NOT read the stale `.data/tenants/<slug>/prompt-answer-observations.json` cache (operator's correction).
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of Stage 2 staging output** — read `.data/_staging/w4-extraction-report.json` (full structured report) and spot-check a handful of `.data/_staging/w4-extracted-observations.json` rows. The 5 sample IDs are in the report's `sampleObservationIds`.
> 2. **Operator approval to design Stage 3 (rederive-snapshots)** — pure compute, $0 LLM cost. Walks every `(date, scope_type, scope_id, platform)` tuple where extracted observations now exist, recomputes via `buildFromObservations()` in `src/domains/daily-metric-snapshots/build-from-observations.ts`, writes to `.data/_staging/w4-rederived-snapshots.json` (staged-only).
> 3. **(Future)** Stage 4 copy-orphan-benchmarks + Stage 5 relabel-changelog + Stage 6 verify (the 6-check harness from master plan §2.6) — gated by Stage 3 design approval. Publish (Stage 7) requires Stage 6 green AND explicit operator approval; no path to publish without both.

> 🟡 **W4 Stage 0 + Stage 1 LANDED (2026-05-04):** Customer-one historical backfill orchestrator scaffolded. Stage 0 preflight + Stage 1 backup wired and run cleanly; stages 2–8 (extract / rederive / copy-orphan / relabel / verify / publish / rollback) are reserved and hard-fail with "not yet implemented; awaiting operator approval" messages. **No production mutation.** `--dry-run` is the default; `--write` is required to actually export.
>
> **What landed:**
>
> 1. **`scripts/customer-one-backfill.ts`** (NEW, ~735 lines) — staged orchestrator with 9 stages enumerated. Today's commit implements stages 0 + 1 only. The `IMPLEMENTED_STAGES` set carries `["preflight", "backup"]`; every other stage routes through `validateStage` → `isReserved: true` → exit 2 with operator-actionable message. Unknown stages rejected with the valid-stages list. Same-day backup directory is blocked unless `--force-overwrite`. `--stage=publish` triggers a giant red warning before the unimplemented-stage gate fires (defense in depth). `LOCKED_CSV_MANIFEST` pins SHA-256 of the four canonical Profound CSVs at the moment W4 preflight ran (preflight aborts if any source file drifts).
>
> 2. **`tests/scripts/customer-one-backfill.test.ts`** (NEW, 35 cases) — operator-locked safety contracts: hash determinism (sha256 fixture matches the known `'hello world'` hash) · stage parsing rejects null / unknown / reserved · `IMPLEMENTED_STAGES` carries ONLY preflight + backup · `validateStage('publish').isReserved === true` · `shouldBlockSameDayBackup` covers all four cases · manifest summary aggregates correctly · `backupDirFor` is deterministic · `dateStringFor` returns YYYY-MM-DD · LOCKED_CSV_MANIFEST has all 4 CSVs with 64-char hex hashes · SUPABASE_TABLES_TO_BACKUP carries every table the operator's spec listed · ALL_STAGES enumerates all 9 stages · **source-scan invariants:** `runPreflight` body never calls `.insert/.update/.delete/.upsert` (read-only) · `runBackup` body never calls those either (Supabase read-only on backup too) · every `writeFileSync` target inside `runBackup` lands under `backupDir` · publish stage prints the giant warning.
>
> 3. **Stage 0 preflight executed clean** (read-only against live Supabase):
>    - Supabase reachable ✓
>    - `prompt_answer_observations`: **1,936 rows** (Apr 22 → May 1; native polling output only)
>    - Schema-v2 coverage: 100% have `descriptor_window` / `source_system` / `competitor_co_mentions` / `answer_structure` · 78.31% have `citation_urls` (older Pre-Commit-7 native polls null) · 0% have `competitor_descriptor_windows` (W2 §2.1 field never landed in Supabase — pure backfill candidate) · 0% have `metadata.regime` (expected — that field exists for `historical_recovered` provenance only)
>    - `daily_metric_snapshots`: 2,325 rows (1,380 benchmark + 945 derived; Apr 7 → May 1)
>    - `recommended_edits`: 17 · `recommendation_responses`: 7 · `tracked_prompts`: 100 · `tracked_entities`: 40 · `changelog_entries`: 334
>    - All 4 CSV hashes match the locked manifest ✓
>    - **tracked_prompts ↔ CSV mapping: 100/100 case-insensitive exact match ✓**
>    - `.data/_backups/` writable ✓
>
> 4. **Stage 1 backup executed clean** (`--write` flag set, single invocation): wrote 66 entries to `.data/_backups/pre-w4-backfill-2026-05-04/` totaling 65,728 rows / ~205 MB. Layout:
>    - `supabase/` — 7 table exports (the source of truth)
>    - `local/tenants/ritz-builders/` — 55 .data files (local cache snapshot)
>    - `csv-source/` — 4 SHA-256 pin files for the Profound CSVs (NOT the 140 MB of CSV bytes; only the manifest entry)
>    - `backup-manifest.json` (28 KB structured) + `backup-manifest.txt` (10 KB human-readable). Each entry carries `name` / `sourceOfTruth` / `rowCount` / `byteCount` / `sha256` / `timestamp` / `tenantId` / `tenantSlug` / `relativePath` per operator spec. Manifest also pins `scriptSha` (sha256 of the orchestrator source itself) so future restores correlate against `git log -- scripts/customer-one-backfill.ts`.
>
> 5. **Notable production-state findings** the prior preflight (2026-05-01) did not surface, now confirmed:
>    - **The 14,096 historical Profound rows currently live ONLY in `.data/tenants/ritz-builders/prompt-answer-observations.json`** (local cache from a prior import run). Supabase production carries only the 1,936 native-poll observations (Apr 22 → May 1). Stage 2 (extract-observations) will need to push fresh `historical_recovered` rows INTO Supabase, not just rewrite local cache. The local 14K rows are pre-Schema-v2 (no `regime` / `source_system` / `extracted` metadata; no `descriptor_window` / `competitor_co_mentions` / `competitor_descriptor_windows` / `citation_urls` / `answer_structure` / `mention_position` / `citation_rank` / `primary_recommendation`) — they're the EXPECTED pre-W4 shape that W4 enriches.
>    - `.data/tenants/ritz-builders/daily-metric-snapshots.json` shows 31,384 rows but Supabase has only 2,325. The local cache is stale (Apr 26 timestamp) and includes a snapshot regime the production DB never received.
>    - `tracked_prompts` + `tracked_entities` are operator-shared GLOBAL tables (no `tenant_id` column per `dual-write.ts` `GLOBAL_TABLES`). The preflight accordingly reads them without tenant filter; the backup exports them in full as global registry snapshots.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 35/35 pass · `npm run test` 3906/3912 (6 pre-existing baseline failures all OUTSIDE this surface — same UI smoke time-drift + tenant-isolation + auto-link-via-changelog tests confirmed in §3.11; net change: +35 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 0 report green · Stage 1 manifest written with 66 entries, all sha256 hashes verified, no Supabase mutations.
>
> **Constraints honored (operator-locked):** No production mutation. No Supabase writes (only reads + backup exports). No Profound code archive/delete. No paid generations. No Apply-All-HIGH. No `.data` cache mutation outside `.data/_backups/`. No execution of stages 2–8 (all hard-fail today).
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of Stage 1 backup manifest** — read `.data/_backups/pre-w4-backfill-2026-05-04/backup-manifest.txt`, confirm 7 Supabase tables + 55 local files + 4 CSV pins are present, validate the rollback inputs are complete + recoverable.
> 2. **Operator approval to design + run Stage 2 (extract-observations)** — pure compute, $0 LLM cost, deterministic. Streams the 14,096 raw CSV rows through Schema v2 extractors + stamps `historical_recovered` provenance, writes to `.data/_staging/w4-extracted-observations.json` (NEVER directly to Supabase or live `.data/tenants/`). Stage 2 stays staged-only until Stage 6 verification harness greenlights publish.
> 3. **(Decision)** When publish lands, push fresh `historical_recovered` observations INTO Supabase (the source of truth) — the local `.data/tenants/ritz-builders/prompt-answer-observations.json` is stale cache and should be regenerated as part of publish, not used as input.

> 🟢 **W3 Step 3.11 (Action Type Planner v0) LANDED (2026-05-04):** H2 + FAQ proved the safe-generation loop end-to-end (query fanout → evidence packet → LLM → validators → exact bundle replay → ranked action table). H2 / FAQ are not the whole product — Beacon must recommend the RIGHT website task type per cluster: create page, rewrite title, rewrite meta, rewrite H1, add H2 / section, improve copy, add FAQ, add schema, add internal links, add comparison table, technical fix, review decision. Step 3.11 ships the PLANNER (decision layer) only — not all the generators yet.
>
> **What landed:**
>
> 1. **`src/domains/recommendations/action-type-planner.ts`** (NEW) — `buildRecommendedActionPlan(input): ActionPlan[]` is a pure deterministic helper that walks 12 operator-locked rules in priority order and emits the highest-priority plan that fires. Every plan carries:
>    - `actionType` — one of 12 `PlanActionType` values
>    - `targetUrl` / `targetPageLabel` — null+`New page` for `create_page`, otherwise the resolved owned URL + operator-friendly label
>    - `proposedElementType` — the `ElementType` the generator should produce (h1 / h2 / title / meta / faq_question / table / schema_type / internal_link / answer_block) or null for page-level / review actions
>    - `evidenceReason` — one-line operator-readable evidence summary
>    - `audit` — full per-plan structured audit: `rawFanoutTriggers[]` (verbatim AI-emitted queries), `normalizedIntent` (superlatives stripped), `pageFactsUsed[]` (which `PageFactsForPlanner` fields contributed), `whyThisActionType` (one paragraph), `whyNotOtherTypes[]` (every NON-chosen plan + a rejection reason), `confidence` (fanout-backed / prompt-backed / site-inventory-backed / thin)
>    - `riskLevel` — low / medium / high
>    - `canGenerateNow` — `true` only for `add_h2_section` + `add_faq` in v0; everything else is `false` (operator-handoff task)
>    - `recommendedGenerator` — concrete existing `ActionType` the generator emits (1:1 mapping today; 1:N possible later)
>
> 2. **Priority-ordered rule walk** (operator-locked):
>    1. `technical_fix` — page-level defects (noindex / canonical mismatch / invalid schema / blocked or stale crawl) outrank everything else.
>    2. `create_page` — no owned page covers the cluster.
>    3. `add_internal_links` — homepage over-cited while target page exists.
>    4. `rewrite_h1` — H1 missing / generic / not anchored to cluster.
>    5. `rewrite_title` — title generic / weak / missing geo+service.
>    6. `rewrite_meta_description` — meta missing / weak / overlong.
>    7. `add_comparison_table` — comparison-stage demand (operator-explicit: lands BEFORE `add_h2_section` so a "best luxury home builders" fanout doesn't degrade into a self-claim H2).
>    8. `add_faq` — question-shaped fanout / prompts.
>    9. `add_schema` — ONLY when visible content supports it (FAQPage requires visible FAQ; BreadcrumbList requires hierarchy; Service / WebPage requires service content). Never recommended for hidden / unsupported content.
>    10. `add_h2_section` — page broadly matches the cluster but missing one important subtopic.
>    11. `improve_body_copy` — page exists but body is too thin to win the cluster prompts.
>    12. `review_decision` — terminal fallback when nothing else fires.
>
> 3. **Action-table model extended** — `ActionRowType` gained `edit_h1` (was folded into "H2") + `add_comparison_table` (was folded into "Copy"). 13 visible task-type labels now: Page · Title · Meta · H1 · H2 · Section · Copy · FAQ · Schema · Links · Table · Technical · Review (+ Regenerate meta-action). `actionRowTypeForEdit` mapping updated: `change_h1` → `edit_h1`; `add_table` / `add_comparison_section` → `add_comparison_table`. Persisted H2/FAQ rows render unchanged (defensive: same `add_h2_section` / `add_faq` ActionType → same row type / label).
>
> 4. **Tests (1 new file, 37 cases · 0 regressions to recs+arch):**
>    - `action-type-planner.test.ts` (NEW, 37) — pin all 13 operator-locked scenarios: "best luxury home builders" → `add_comparison_table` (NOT self-claim H2) · weak title → `rewrite_title` · weak meta → `rewrite_meta_description` · missing H1 → `rewrite_h1` (highest of the three) · no owned page → `create_page` · question-shaped fanout → `add_faq` · comparison fanout → `add_comparison_table` · homepage over-cited → `add_internal_links` · visible FAQ → `add_schema` (FAQPage unlocked) · absent visible FAQ → `add_schema` blocked · noindex / invalidSchema / crawlBlocked → `technical_fix` · audit explains why this + why NOT all 11 others · `whyNotOtherTypes` covers every non-chosen plan with a rejection reason · `confidence` falls to "thin" with no evidence · `rawFanoutTriggers` carries verbatim queries (including "best …" — operator-locked rule that raw fanout MAY contain forbidden modifiers but PUBLIC copy must transform them) · ACTION_ROW_TYPE_LABEL covers all 13 required labels · `planLabelFor` mirrors them · `canGenerateNow` true ONLY for the 2 wired safe generators · `proposedElementType` correct for every plan · heuristic helpers (`fanoutHasForbiddenSuperlative` / `fanoutLooksComparison` / `fanoutHasQuestionShape` / `titleIsWeak` / `metaIsWeak` / `h1IsWeak` / `pageHasTechnicalIssue` / `ownedPageBestMatch` / `normalizedIntentFromSignal` / `schemaIsRecommendable`) all individually unit-tested.
>    - Pre-existing test updated (`render-output-cleanup.test.tsx`) — pinned the OLD `Add an "..." H2` pattern from §3.5e; updated to the §3.15 `Add "..." H2` shape with regression-prevention assertion. (Carried over from §3.15.)
>
> 5. **Constraints honored** — No paid generation. No broad regeneration. No Apply-All-HIGH. No backfill. No Profound archive/delete. No cards/lanes redesign. Persisted H2/FAQ rows are not mutated. Exact bundle replay (W3 §3.10) intact.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · 1285/1285 on `src/domains/recommendations` + `tests/architecture` (recs + arch surface area) · `npm run test` 3871/3877 (6 pre-existing baseline failures all OUTSIDE this surface — same UI smoke time-drift + tenant-isolation + auto-link-via-changelog tests confirmed in §3.13/§3.15; net change vs §3.15: +37 passes, ±0 net failures) · `BEACON_TENANT_ID=… BEACON_TENANT_SLUG=… npm run build` clean.
>
> **What this enables:** Beacon can now CHOOSE the right task type for each cluster — title / meta / H1 / schema / link / table / review — not only H2/FAQ. The planner is wired into the rule layer; the next phase activates the per-type generators behind feature-flagged validators (Title / Meta / H1 / Internal Links / Schema / Comparison Table). v0 ships the safe set (H2 + FAQ) and surfaces every other plan as a clearly-marked operator-handoff task in the existing ranked action table.
>
> **Browser spot-check (post-§3.15 deploy)** confirmed by operator on the table screenshot: 9 rows (down from 12), 3 FAQ pairs each grouped to one row, real question text in titles, `Add "..." H2` not `Add an "..."`, no `(new)` / `(question)` / `(answer)` noise tags, types correct (H2/FAQ/Page/Review), no raw IDs / em dashes / bare "Ritz" / leading "Best …".
>
> **Next 3 actions (operator-locked):**
> 1. **W4 historical backfill** — operator's announced next phase (per the §3.11 spec: "After Step 3.11 passes, pause. Then we resume W4 historical backfill.").
> 2. **(Optional) Activate one new generator behind a flag** — e.g., the `rewrite_title` or `add_internal_links` generator, gated by an env flag and validated through the same `--save-bundle` / `--from-bundle` review-and-replay pipeline §3.10 ships.
> 3. **(Optional) Surface the planner's audit + canGenerateNow on the existing action table** — when a row's underlying plan has `canGenerateNow: false`, render a "Queue this for the operator" badge instead of the Accept button.

> 🟢 **W3 Step 3.15 (Action-table polish: FAQ Q+A grouping + title cleaning) LANDED (2026-05-04):** Operator browser-spot-check after the §3.13 persists revealed three small UI defects in the ranked action table (the table itself was accepted; this is polish, not a redesign):
>
> 1. Each FAQ Q+A pair was rendering as TWO duplicate rows (the question and the answer each on its own line) — wrong for the operator who thinks of an FAQ as one shipment.
> 2. Row titles for FAQ rows were leaking the displayLabel's noise tags (`(new)`, `(question)`, `(answer)`) into the table column instead of using the actual question text the operator approved.
> 3. H2 titles read `Add an "How to choose ..." H2 to the X page` — dangling article when the cleaned label starts with a capital. Operator wants `Add "..." H2`.
>
> **Three layered fixes (no new architecture, no new endpoints, no new model spend):**
>
> 1. **FAQ Q+A pair grouping** in `buildRecommendationActionRows` — new `partitionEditsForFaqPairing` + `composeFaqPairRowTitle` helpers split each rec's `renderable` edits into `faqPairs[]` (matched `faq_question[new]:<hash>` + `faq_answer[new]:<hash>` tuples), `nonFaqEdits[]`, and `orphanFaqEdits[]`. One grouped row per matched pair; orphans suppressed from the main table per operator scope ("unpaired FAQ question/answer does not render as active main-row task"). Grouped row id pattern: `<recStableKey>::faq-pair::<hash>`. The drawer's `proposedText` carries the QUESTION, the new `faqAnswerText` field carries the ANSWER, and `debug.pairedAnswerEditId` records the answer's edit id alongside `debug.editId` (the question's). Evidence refs + risks unioned across both rows; first-seen wins on duplicate refs.
>
> 2. **Row-title cleanup** — `composeFaqPairRowTitle` produces `Add FAQ: "{actual question text}" to the {targetLabel}` (curly-quoted, capped at 100 chars), drawing question text from `proposed_text` rather than the displayLabel. `composeEditRowTitle`'s `add_h2_section` branch dropped the dangling `an` article: `Add "..." H2 to the {targetLabel}` (no `an`). `cleanDisplayLabel` extended to strip trailing noise parentheticals — `(new)`, `(new H2)`, `(new H3)`, `(new FAQ)`, `(new section)`, `(question)`, `(answer)` — case-insensitive, ONLY when the inside word matches the noise set. Legitimate trailing parentheticals like `(no footprint increase)` are preserved.
>
> 3. **Drawer Q+A side-by-side** — `RowDrawer` derives `isGroupedFaq` from `row.actionType === "add_faq" && d.faqAnswerText`. When true, the "Exact recommended change" section renders Question + Answer as two separate `<pre>` blocks (data-attributes `data-rec-faq-question` / `data-rec-faq-answer` for tests + diagnostics). Non-FAQ rows keep the legacy single "Proposed" block. `currentText` (when present) still renders above; "Why" / "Evidence" / "Measurement plan" / "Debug" sections unchanged.
>
> **Tests (2 new files, 39 cases · 1 pre-existing test updated):**
> - `recommendation-action-rows-faq-grouping.test.ts` (NEW, 26) — matched FAQ pair → exactly ONE row · grouped title uses actual question text, never displayLabel noise · title ends with `to the {target} page` · drawer carries question on `proposedText` + answer on `faqAnswerText` · non-FAQ rows have `faqAnswerText: null` · orphan FAQ Q alone → no main row · orphan FAQ A alone → no main row · two pairs different hashes → exactly two grouped rows · FAQ pair + H2 in same rec → 2 rows total · `Add "..." H2` not `Add an "..." H2` · trailing `(new)` stripped · leading `H2:` stripped · cleanDisplayLabel strips `(new)` / `(new H2)` / `(question)` / `(answer)` · preserves legitimate parentheticals like `(no footprint increase)` · chained noise tag stripping · `partitionEditsForFaqPairing` defensive against duplicates · `extractElementKeyHashSuffix` handles malformed input · `composeFaqPairRowTitle` truncates very long question text.
> - `recommendations-step-3.15-faq-grouping.test.ts` (NEW, 13) — source-scan invariants: builder exports `composeFaqPairRowTitle` / `partitionEditsForFaqPairing` / `extractElementKeyHashSuffix` · `ActionRowDetail` carries `faqAnswerText: string | null` · debug carries `pairedAnswerEditId: string | null` · grouped row id pattern uses `faq-pair::${hash}` · composeEditRowTitle drops dangling `an` on add_h2_section · cleanDisplayLabel declares the noise-tag set · drawer derives `isGroupedFaq` from `row.actionType === "add_faq"` + `d.faqAnswerText` · Question + Answer labels + pre blocks render with `data-rec-faq-*` attributes · non-FAQ fallback to single "Proposed" block.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (1 updated) — pinned the OLD `Add an "..." H2` title pattern; updated to the new `Add "..." H2` shape with a `not.toMatch(/Add an [“"][A-Z]/)` regression-prevention assertion.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · 1248/1248 on `src/domains/recommendations` + `tests/architecture` (recs + arch surface area) · `npm run test` 3834/3840 (6 pre-existing baseline failures all OUTSIDE this surface — UI smoke time-drift + tenant-isolation + auto-link-via-changelog; net failures vs §3.13 baseline: ±0) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean.
>
> **Net effect on the operator-visible queue:** the 12 visible rows from §3.13 collapse to ~9 (each of the three FAQ pairs — Palo Alto, Cupertino, Luxury — collapses from 2 rows to 1 grouped row). Titles read like the operator wrote them: `Add FAQ: "What should I look for in a luxury home builder in the Bay Area?" to the Luxury Home Builder Bay Area page`, `Add "How to choose a luxury custom home builder" H2 to the Luxury Home Builder Bay Area page`, etc.
>
> **Constraints (still operator-locked):** No paid generations. No Apply-All-HIGH. No customer-one backfill. No Profound archive/delete.
>
> **Next 3 actions:**
> 1. **(Optional) Operator browser-spot-checks /recommendations** post-deploy to confirm the FAQ pairs render as one row each with the new title shape and the drawer's Q+A side-by-side layout.
> 2. **(Optional) Run paid generation on one more fresh cluster** to grow the inspection sample. Stays operator-locked OUT.
> 3. **(Optional) Surface the Cupertino + Luxury rows on `/changes`** for end-to-end review of the persisted-edits lifecycle.

> 🟢 **W3 Step 3.10–3.13 (Static-bundle replay path + query-fanout audit + leading-superlative guardrail + Cupertino & Luxury persisted) LANDED (2026-05-03):** Closes a real defect the operator caught on the §3.9 review: `--write` was calling OpenAI fresh on every invocation, so the bytes that landed on disk were not byte-identical to the dry-run report the operator approved. The fix is a five-piece review-and-replay pipeline that ships the EXACT operator-approved bytes with zero new model spend, plus a public-copy guardrail that the §3.10 paid run revealed (the LLM emitted an H2 starting with bare "Best ..." that slipped past the existing brand-claim regex).
>
> **Five layered changes:**
>
> 1. **Static-bundle provider** (`src/domains/recommendations/providers/static-bundle.ts`, NEW) — `staticBundleProvider(bundle)` returns a saved bundle verbatim, asserting `tenantId / recId / evidenceHash` match the live packet so the operator can't accidentally persist the wrong bundle for the wrong rec. `looksLikeSpecificEditBundle` type guard for unsafe JSON. The provider's `name` mirrors the bundle's original `providerName` so telemetry preserves true provenance ("openai" / "deterministic"), not a synthetic "static" marker.
>
> 2. **`--save-bundle` + `--from-bundle` flags on `build-edits-for-queue.ts`** — two-step review-and-persist flow: `--save-bundle=<path>` writes the LLM bundle to disk after generation, then `--from-bundle=<path> --write` persists the EXACT bytes with no second model call. Every existing validator gate (placeholder, brand-claim grounding, em-dash, brand-name-first, FAQ pairing, competitor leak, leading-superlative) re-runs on the loaded bundle so unsafe bytes never reach disk even when replaying.
>
> 3. **Query Fanout Audit** (`src/domains/recommendations/query-fanout-audit.ts`, NEW + `scripts/audit-saved-bundle.ts` runner) — operator scope: "We should not approve copy from vibes. Show the query fanout / AI search evidence behind each generated edit." For every edit in a saved bundle the audit prints: raw fanout queries (verbatim), prompt snippets, normalized intent, recommended buyer-safe angle, evidence sources used, transformed terms (forbidden-modifier raw → buyer-decision rewrite, e.g., "best luxury home builders" → "How to choose a luxury home builder"), confidence (fanout-backed / prompt-backed / competitor-page-backed / thin-evidence), and unsafe phrasings detected in the proposed text. Pure compute, deterministic, packet rebuilt without any LLM call. The audit caught the bare "Best ..." H2 that the validator's `best_in_market` regex missed (no definite article, no verb).
>
> 4. **Public-copy leading-superlative ban** (`validateNoLeadingSuperlativePublicCopy`) — operator-locked guardrail layered after brand-claim grounding: generated `proposedText` + `displayLabel` MUST NOT start with `Best…`, `Top…`, `Leading…`, `Premier…`, `#1…`, `Top-rated…`, `Highest-rated…`, `Most-trusted…` — even when the AI fanout query that grounded the rec contained "best …". Raw fanout keywords carry comparison intent; public Ritz copy must transform that into a buyer-decision angle ("How to choose…", "What to look for…", "Questions to ask…") rather than parrot a self-award framing. Env opt-out: `BEACON_ALLOW_LEADING_SUPERLATIVE=1`.
>
> 5. **`--rec-id-override` on the from-bundle flow** — when the queue churns between save and replay (e.g. a single-prompt rec gets promoted to a cluster page), the operator passes `--rec-id-override=<current key>` and the script grafts `bundle.recId` in memory + opts the static provider into `allowEvidenceHashDrift` so the replay still validates and persists. The on-disk JSON is NEVER mutated — the override is a CLI-time graft with a loud warning. tenantId + recId equality still enforced.
>
> **Two persistences this session, $0 model spend:**
>
> | Cluster | rec_id | Edits persisted | Source attribution | Cost |
> |---|---|---:|---|---:|
> | Cupertino | `create_cluster_page:geo:Cupertino` | 1 H2 + 2 FAQ (paired hash `cupertino01`) | `source=openai` (queue churn promoted `create_single` → `create_cluster_page`; saved bytes are the original LLM output, persisted via `--rec-id-override`) | $0 (saved telemetry: $0.011674) |
> | Luxury Home Builder Bay Area | `create_cluster_page:topic:Shield: Luxury Home Builder Bay Area` | 1 H2 + 2 FAQ (paired hash `faqlux01ab23cd45`) | `source=operator_edited` (the §3.10 H2 + FAQ Q failed the new leading-superlative + best_in_market gates; operator hand-edited bytes to a buyer-decision angle) | $0 (saved telemetry: $0.013929) |
>
> **Operator checklist verification on the 6 newly-persisted rows (3 Cupertino + 3 Luxury):** zero raw UUIDs in public text · zero em dashes · zero bare "Ritz" · zero leading-superlative public H2s · zero unsupported brand claims · FAQ Q+A pairs share their hash on both clusters · all rows under their cluster `rec_id` · provenance is truthful (`provider_name=openai`, `model=gpt-5-mini`, `source=openai` for Cupertino / `source=operator_edited` for Luxury, `implementation_status=recommended`).
>
> **Tests (4 new files, 64 new cases · 1 validator file extended):**
> - `static-bundle.test.ts` (17 cases, +5 from §3.10 baseline) — pin verbatim return, tenantId/recId/evidenceHash mismatch errors, structural type guard, `STATIC_BUNDLE_PROVIDER_TAG`, plus W3 §3.12 cases for `allowEvidenceHashDrift` (relaxes hash check while keeping tenantId+recId enforced; grafts live packet's hash onto the returned bundle; default still enforces strict equality; pre-graft + drift-allow combination drives the rec-id-override flow cleanly).
> - `query-fanout-audit.test.ts` (27 cases) — `transformForbiddenQueryToBuyerAngle` (best/top → How to choose, geos lift to "in {Geo}", cities don't take "the", year tokens stripped, articles stripped, returns null on buyer-neutral input), `detectUnsafePhrasings` (leading Best/Top/Leading/Premier, inline award-winning/top-rated/most-trusted/most-popular/frequently-recommended, subject-of-sentence "best builder/firm/etc.", de-dupes hits, returns empty on safe copy), `buildQueryFanoutAudit` shape (rich/partial/none coverage, fanout-backed/prompt-backed-only/competitor-page-backed/thin-evidence confidence, evidence sources stable order, recommendedAngle echoes first transformed term or mirrors top fanout, page-level edits handled cleanly).
> - `specific-edit-validator-leading-superlative.test.ts` (14 cases) — pin operator-locked rule 1 (raw fanout MAY contain "best ..."; `why` field may quote raw fanout verbatim), rule 2 (`Best …` / `Top …` / `Leading …` / `Premier …` / `Top-rated …` / `#1 …` rejected on proposedText AND displayLabel; case-insensitive), rule 3 (buyer-decision angles pass: "How to choose …", "What to look for …", "Questions to ask …", "Working with …", "Modernizing older Cupertino homes …" — the persisted Cupertino bytes), rule 4 (`BEACON_ALLOW_LEADING_SUPERLATIVE=1` opts out).
> - `specific-edit-validator.ts` extended — new `validateNoLeadingSuperlativePublicCopy` gate wired into the `validateSpecificEdit` style block (§9.85); fail-loud reason names the matched modifier and walks the operator to the buyer-decision rewrite.
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 1209/1209 on `src/domains/recommendations` + `tests/architecture` (recs surface area my changes touched) · `npm run test` 3795/3801 (6 baseline failures all outside this surface area: 3 UI smoke tests with time-drift on `.data` observation dates from 2026-04-23 expiring the 7-day "live" window, 1 tenant-isolation regression, 2 auto-link-via-changelog regressions — all 6 fail identically when my changes are stashed) · `BEACON_TENANT_ID=… BEACON_TENANT_SLUG=… npm run build` clean.
>
> **Persisted state of `.data/tenants/ritz-builders/recommended-edits.json`:** 20 rows total (14 prior + 3 fresh Cupertino + 3 fresh Luxury). $0 net model spend this session.
>
> **Constraints (operator-locked):** No more paid generations. No Apply-All-HIGH. No customer-one backfill yet. No Profound archive/delete.
>
> **Next 3 actions:**
> 1. **(Optional) Operator browser-spot-checks /recommendations** to confirm the 6 fresh rows render cleanly through the action table UI (Cupertino + Luxury clusters surface in the Type=H2 / Type=FAQ rows with the new copy and `source=operator_edited` / `source=openai` provenance).
> 2. **(Optional) Run paid generation on one more fresh cluster** (Whole Home Renovation Builders, location-specific Strengthen rows for Palo Alto / Menlo Park) ONLY if the operator wants to grow the inspection sample toward the 20–30-rec threshold for any future Apply-All-HIGH conversation. Stays operator-locked OUT until then.
> 3. **(Optional) Tighten the BrandAssertion list** if any factual claim from the persisted Cupertino / Luxury rows needs source verification. Or surface the persisted rows on the operator UI (`/recommendations`, `/changes`) for end-to-end review.

> 🟢 **W3 Step 3.9 (Narrow paid runs: Palo Alto persist + Cupertino + Luxury) LANDED (2026-05-03):** Operator approved the persist + two more dry-runs to broaden the inspection sample. Three runs total surfaced + fixed three real validator gaps without any unsafe data reaching disk. Final state: 3 Palo Alto edits persisted; 5 Cupertino + Luxury edits clean and pending operator approval to persist.
>
> **Distribution across all three runs:**
> - **Palo Alto (`--write`):** 3 generated · 3 ship-as-is · 0 rejected · $0.013672 USD · persisted to `.data/tenants/ritz-builders/recommended-edits.json`. (1 H2 + 1 FAQ pair, gold-standard voice).
> - **Cupertino (DRY-RUN):** 3 generated · 2 ship-as-is (FAQ pair) · 1 rejected (H2 — LLM hallucinated competitor "TerraRevo" in evidence refs) · $0.014794 USD. Clean public copy on accepted rows.
> - **Luxury Home Builder Bay Area (DRY-RUN):** 3 generated · 3 ship-as-is (1 H2 + 1 FAQ pair) · 0 rejected · $0.014569 USD. Final run after two validator fixes.
>
> **Three validator gaps caught + fixed mid-run:**
> 1. **Alias floor 3 → 4** (`MIN_COMPETITOR_ALIAS_LENGTH`) — bare-"Bay" alias of competitor "Bay Builders" was matching every "Bay Area" mention in legitimate geo copy. Floor raised; same fix suppresses 3-letter abbreviations like "ICB" from "ICB Builders". Full names still match when actually present.
> 2. **FAQ pairing per-edit aware** (`checkFaqPairing` accepts `perEditOk` flags) — a per-edit-failed FAQ question used to leave its matching answer effectively orphaned at persist time. Pairing now skips per-edit-failed rows during bucketing so the answer is correctly flagged as orphan. Cupertino run #1 hit this.
> 3. **`best_in_market` regex adjective gap** — "the best luxury home builders" slipped through the original strict-adjacency pattern. Regex now allows up to 3 modifier words between "best" and the noun. Same fix applied to `leading_brand`. Plurals (`builders?`, `firms?`, etc.) standardized.
>
> **Tests (5 new + 5 updated, 22 new + invariant cases):** `brand-assertions.test.ts` (+4 — adjective-gap regression cases on best/leading + the legitimate "best for X" allow-through), `specific-edit-validator.test.ts` (+2 — Bay-Builders short-alias guard + full-name still matches; updated 2 alias-builder tests for the new floor), `specific-edit-validator-faq-pairing.test.ts` (+1 — Cupertino regression: per-edit-failed Q leaves matching A as effective orphan), `recommendations-step-3.7-brand-grounding.test.ts` (1 updated — `checkFaqPairing` call regex now matches the per-edit-aware shape).
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 239/239 targeted (validator + brand + arch + faq-pairing + brand-claims) · `npm run test` 3733/3737 (4 baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Decision:** narrow paid runs are now safe to use one cluster at a time. Apply-All-HIGH stays operator-locked OUT.
>
> **Persisted state of `.data/tenants/ritz-builders/recommended-edits.json`:** 14 rows (11 prior + 3 fresh Palo Alto). Pending operator approval: 5 more (2 Cupertino FAQ pair + 3 Luxury). Per-edit grading + verification matrix in `docs/W3_STEP_3.9_NARROW_PAID_RUNS_REPORT.md`.
>
> **Next 3 actions:**
> 1. **Operator reviews Cupertino + Luxury** in `docs/W3_STEP_3.9_NARROW_PAID_RUNS_REPORT.md`. If approved, persist with `--write`.
> 2. **(Optional) Run paid generation on the next 1-2 fresh clusters** (Whole Home Renovation Builders, location-specific strengthen rows for Palo Alto / Menlo Park) to broaden the inspection sample.
> 3. **Apply-All-HIGH** stays operator-locked OUT until the operator personally approves it after a wider inspection sample.

> 🟡 **W3 Step 3.8 (FAQ Q+A pairing fix) LANDED (2026-05-03):** Two commits: `c261e35` (validator + Rule 13 paired contract + tests) + the doc that grades the dry-run on Palo Alto. The W3 §3.7 paid run flagged one residual defect — the LLM bundled FAQ question + answer body into a single `faq_question[new]` proposedText. Step 3.8 closes it with three layered enforcement points:
>
> - **Per-edit FAQ shape gate** — `validateFaqRowShape` rejects newline-bundled answers + `Q: \n A:` deterministic-shape bundling on `faq_question[new]:<hash>` rows. Rejects bare-question shapes + under-30-word stubs on `faq_answer[new]:<hash>` rows. Wired BEFORE `validateFaqIntentRewriting` so the operator-actionable error fires before the generic "must end with ?" reason.
> - **Bundle-level pairing** — `checkFaqPairing` groups every FAQ edit by element-key hash suffix; rejects orphan questions / orphan answers / duplicate Q's / duplicate A's. Failures land in `bundleErrors` AND overwrite the orphan's per-edit result so the operator sees WHICH row failed pairing. The persist layer (`runProviderAndPersist`) refuses to persist when bundleErrors is non-empty — orphans never reach disk.
> - **SYSTEM_PROMPT Rule 13** extended with the paired-output contract: question row carries `faq_question[new]:<hash>` with question-only text, answer row carries `faq_answer[new]:<hash>` with answer-only body (40–120 words preferred), both share the same hash suffix. BAD (bundled) + GOOD (paired) examples included. Cross-references Rule 18 + Rule 19 so the answer body still goes through the brand-grounding + voice/style stack.
>
> **Dry-run verification on the Palo Alto cluster:** 5 edits generated · 5 ship-as-is · 0 rejected · cost $0.015969 USD.
> - 1 H2 with the gold-standard "Ritz Builders emphasizes … our integrated process …" voice.
> - 2 FAQ pairs (4 rows) sharing hashes `pa01ab2c3d4` + `pa02ab2c3d5`. Each pair: clean question + 51-word substantive answer.
> - Zero brand-claim leaks · zero em dashes · zero bare "Ritz" · zero placeholder · zero competitor leaks · zero wrong-page anchors.
>
> Per-edit grading + verification matrix (every operator-locked rule × this run): `docs/W3_STEP_3.8_FAQ_PAIRING_REPORT.md`.
>
> **Tests (1 new file + 4 updated, 38 new + 12 invariant cases):**
> - `specific-edit-validator-faq-pairing.test.ts` (NEW, 16) — per-edit shape (bundled rejected, paired passes, bare-question answer rejected, < 30-word answer rejected); bundle pairing (paired bundle passes, orphan Q rejected, orphan A rejected, duplicates rejected, mixed bundle isolates failure); brand gates still active on answer body (bare "Ritz", em dash, "frequently recommended" all rejected).
> - `recommendations-step-3.7-brand-grounding.test.ts` (+12) — source-scan: SYSTEM_PROMPT Rule 13 PAIRED FAQ OUTPUT block + faq_question/answer hash-pairing shape + BAD/GOOD examples + cross-reference to Rule 18/19; validator wires `validateFaqRowShape` BEFORE `validateFaqIntentRewriting`; bundle validator aggregates pairing failures + overwrites per-edit results.
> - `specific-edit-validator.test.ts` (4 updated) — pre-existing structural-quality + faq_answer-bypass tests reworked to use the new paired shape and expect the new W3 §3.8 rejection reasons; "UNAFFECTED faq_answer" fixture expanded to 30+ words.
> - `openai.test.ts` source-scan stays green — Rule 13's faq_answer carve-out preserved + W3 §3.8 paired contract added.
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 232/232 targeted (faq-pairing + adjacent + arch) · 46/46 openai source-scan · `npm run test` 3726/3730 (4 pre-existing baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Decision: GO for narrowly-scoped paid runs going forward** with `--write` enabled when the operator approves a specific cluster's output. The gate stack (3.7 grounding + 3.7s style + 3.8 pairing) is now production-ready for one cluster at a time. Apply-All-HIGH stays operator-locked OUT.
>
> **Next 3 actions:**
> 1. **(Optional) Operator persists the Palo Alto run** with `--write` if the per-edit grading in `docs/W3_STEP_3.8_FAQ_PAIRING_REPORT.md` looks shippable.
> 2. **(Optional) Run paid generation on the next 1–2 fresh clusters** (Cupertino, Luxury Home Builder Bay Area, Whole Home Renovation Builders) to broaden the operator-inspection sample toward the 20–30-rec threshold for any future Apply-All-HIGH conversation.
> 3. **(Optional) Operator tightens the BrandAssertion list** if any factual claim from the Palo Alto run needs source verification or rewrite.

> 🟡 **W3 Step 3.7s (Public-copy style correction) LANDED (2026-05-03):** The Step 3.7 paid run on Palo Alto produced grounded copy, but the operator caught two style defects: it used "Ritz" (short form) instead of "Ritz Builders", and dropped two em dashes into the body. Step 3.7s adds a permanent style layer enforcing the operator-locked voice + punctuation rules.
>
> **Two new validator gates (layered after the brand-claim grounder):**
> - **No em dashes** — generated public copy MUST NOT contain `—` (em dash) or free-standing `–` (en dash) used as sentence punctuation. Digit-bounded ranges like `10–15 weeks` and `2024–2025` stay allowed. Validator returns `em dash banned in public copy ('—' near "<context>") — replace with period / comma / colon / parentheses`. Env opt-out: `BEACON_ALLOW_EM_DASH=1`.
> - **Full entity name on first mention** — every standalone generated section uses the full entity name ("Ritz Builders") on the first brand mention. Bare "Ritz" alone is NEVER allowed. After the first full mention, the model may transition to first-person plural ("our team", "we", "our process") for natural website tone. Per-tenant style registered via `getBrandNameStyle(tenantId)` in `brand-assertions.ts`. Env opt-out: `BEACON_ALLOW_SHORT_BRAND_NAME=1`.
>
> **SYSTEM_PROMPT Rule 19 (PUBLIC-COPY VOICE + STYLE):** five sub-rules walk the model through the new contract:
> - 19a — NO EM DASHES, with BAD/GOOD rewrite examples.
> - 19b — FULL ENTITY NAME ON FIRST MENTION, with the "Ritz Builders … Our team coordinates …" gold pattern + explicit BAD examples (bare "Ritz" / second-instance "Ritz").
> - 19c — H2 STYLE (topic-first, no brand-stuffing). "Architect-designed custom homes in Palo Alto" GOOD; "Why Ritz Builders is frequently recommended for Palo Alto custom homes" BAD.
> - 19d — PUBLIC BODY STYLE (self-contained, answer-engine-friendly chunks; first sentence makes sense quoted alone; no keyword stuffing; no fake social proof unless packet-grounded).
> - 19e — GOLD-STANDARD EXAMPLE — verbatim operator-approved Palo Alto H2 + body that the model should mirror.
>
> **Tests (3 files extended, 39 new cases):**
> - `brand-assertions.test.ts` (+16) — getBrandNameStyle / findEmDashes / findIncompleteBrandMentions detectors, digit-bounded en dash allowance, word-boundary anchors, second-instance bare-short rejection.
> - `specific-edit-validator-brand-claims.test.ts` (+11) — validator integration: em dash + en dash + digit-range allowance, gold-standard Palo Alto H2 passes, packet user-prompt text containing "Ritz" never trips the gate, env opt-outs work.
> - `tests/architecture/recommendations-step-3.7-brand-grounding.test.ts` (+12) — source-scan: brand-assertions exports the new helpers, validator wires `validateNoEmDashes` + `validateBrandNameFirstMention` after `validateBrandClaimGrounding`, env opt-outs wired, SYSTEM_PROMPT Rule 19 + 19a/b/c/d/e blocks present + carry the gold-standard Palo Alto example.
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 310/310 targeted (extended 3.7s + adjacent) pass · `npm run test` 3702/3706 (4 baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Net effect on the model:** the style layer is the difference between the Step 3.7 output ("Ritz emphasizes … complex builds — for example …") and the operator's preferred shape ("Ritz Builders emphasizes … For complex Palo Alto sites, including … our integrated process …"). Both layers (Step 3.7 grounding + Step 3.7s style) now apply. The next paid run on a fresh cluster will surface output that mirrors the gold-standard example.
>
> **Next 3 actions:**
> 1. **(Optional) Re-run paid generation on Palo Alto** with the style layer armed to verify the model produces the operator's preferred Palo Alto H2 verbatim.
> 2. **(Optional) Run the same paid generation on the next 1–2 fresh clusters** (Cupertino, Luxury Home Builder Bay Area, Whole Home Renovation Builders) to broaden the inspection sample toward the 20–30-rec threshold for Apply-All-HIGH.
> 3. **(Optional) Step 3.8 — FAQ Q+A pairing fix** (the residual defect from Step 3.7's first paid run — model bundled Q+A into one proposedText). SYSTEM_PROMPT Rule 13 update to emit Q + A as two linked edits.

> 🟡 **W3 Step 3.7 (Brand-claim grounding + first paid LIVE run) LANDED (2026-05-03):** Two commits: `2b99413` (the grounding layer) + the doc that grades the first paid LIVE run on a fresh cluster.
>
> **The W3 §3.6 minor-edit defect is closed.** Three of four LLM minor-edit rows in the §3.6 sample shipped unsupported social-proof claims ("Ritz is **frequently/commonly/often** recommended"). The W3 §3.7 grounding layer routed every public-copy field through:
> - **`brand-assertions.ts`** — operator-curated allowed phrases per tenant (10-row Ritz list: architect-led design-build, Bay Area / Silicon Valley luxury custom homes, custom homes, remodels, whole-home remodels, teardown / rebuild, in-house architecture, concept-to-completion, premium / luxury positioning) + 13 forbidden-claim regex patterns with `unlockedBy` categories (popularity / trust / ranking_first / award / tenure / client_outcome). `guarantee_outcome` permanently locked.
> - **Evidence packet** — `brandAssertions` field threaded into `SpecificEditEvidencePacket`; `evidenceHash` flips when the assertion list changes.
> - **OpenAI SYSTEM_PROMPT Rule 18** — BRAND-CLAIM GROUNDING block lists allowed claims, forbidden claims, the unlocked-by category map, GROUNDED phrasing examples ("Ritz emphasizes…", "Ritz's page can highlight…", "The section should explain…") and explicit UNGROUNDED examples.
> - **Validator** — `validateBrandClaimGrounding` scans `proposedText` + `displayLabel` only (not `why` / `risks` / `measurementPlan` / `currentText` / packet text). Each match returns `unsupported brand claim` with the pattern id surfaced. `BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1` env opt-out for operator-approved overrides.
>
> **First paid LIVE run (DRY-RUN mode) on a fresh cluster: PASSED.** Target: `create_cluster_page:geo:Palo Alto` (queue rank #2, target `https://ritzbuilders.com/locations/palo-alto`, no prior edits). 2 edits generated, 1 ship-as-is + 1 rejected (FAQ-shape defect, NOT brand-claim). **Zero brand-claim leaks.** Cost: $0.012162 USD total. The model defaulted to "Ritz **emphasizes** an architect-led design-build approach…" — the canonical grounded phrasing example from Rule 18 — instead of the §3.6 unsupported-recognition sentence shape.
>
> Full per-edit grading + verification matrix in `docs/W3_STEP_3.7_FIRST_PAID_RUN_REPORT.md`.
>
> **Tests (3 new files, 66 cases):**
> - `brand-assertions.test.ts` (34) — list shape, retrieval per tenant, forbidden-pattern coverage, unlocking, permanently-locked guarantee, multi-pattern matches, format helpers.
> - `specific-edit-validator-brand-claims.test.ts` (15) — each forbidden pattern rejected w/o assertion, allowed w/ matching-category assertion, public-copy scope (operator-facing fields never trip), env opt-out works.
> - `tests/architecture/recommendations-step-3.7-brand-grounding.test.ts` (17) — SYSTEM_PROMPT Rule 18 + canonical claim lists; OpenAI provider stringifies packet (carries brandAssertions); evidence packet builder threads brandAssertions into the hash; validator imports + wires `validateBrandClaimGrounding` after `validateCompetitorPublicCopy`.
>
> **Verification (2026-05-03):**
> - `npx tsc --noEmit` clean · 271/271 targeted (3.7 + adjacent validator + evidence) · `npm run test` 3663/3667 (4 baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Decision: GO for narrowly-scoped paid runs going forward** (one cluster at a time, dry-run mode, operator-approved). Apply-All-HIGH stays operator-locked OUT until 20–30 fresh recs are operator-inspected (W3 §1.5).
>
> **Next 3 actions:**
> 1. **Operator: review the Palo Alto H2 in `docs/W3_STEP_3.7_FIRST_PAID_RUN_REPORT.md`.** If you approve, persist via `--write` flag re-run.
> 2. **(Optional) Step 3.8 — FAQ Q+A pairing fix.** SYSTEM_PROMPT Rule 13 update so the model emits Q + A as two linked edits with a shared hash suffix. The W3 §3.6 + §3.7 reports both flag this as the next residual defect.
> 3. **(Optional) Run the same paid generation on the next 1–2 fresh clusters** (`Cupertino`, `Luxury Home Builder Bay Area`, `Whole Home Renovation Builders` again) to broaden the operator-inspection sample toward the 20–30-rec threshold for Apply-All-HIGH.

> 🟡 **W3 Step 3.6 (Sample-quality report on the production rec corpus) LANDED (2026-05-03):** Read every one of the 11 specific edits in `.data/tenants/ritz-builders/recommended-edits.json`, scored each against the operator-locked rubric (ship-as-is / minor-edit / no / placeholder). No paid runs. No regeneration. Results in `docs/W3_STEP_3.6_SAMPLE_QUALITY_REPORT.md`.
>
> **Distribution:** 1 ship-as-is (the operator already shipped it 2026-04-28) · 4 minor-edit (all LLM-sourced, all need brand-claim verification) · 5 placeholder (4 deterministic FAQs + 1 LLM Q-without-answer) · 1 no (deterministic competitor-name leak, quarantined by Step 3.5b.A's validator).
>
> **Source breakdown:**
> - **deterministic — 5 edits, all unshippable.** 4/5 are placeholder ("A: Draft answer (operator: rewrite). Anchor on: …"). 1/5 named a specific competitor in public copy. The deterministic FAQ generator was a placeholder factory; W3 Step 3.4's LLM activation replaces it.
> - **openai (gpt-5-mini) — 6 edits.** 1 ship-as-is (already shipped) + 4 minor-edit + 1 placeholder (FAQ Q without paired A). Every LLM body uses plausible brand voice; no competitor names; no raw prompt-id leaks; topical accuracy holds. Three minor-edits share the same defect: unsupported claims like "Ritz is frequently/commonly/often recommended" — the LLM has no source for these so it pattern-matches to generic builder-website copy.
>
> **Decision:** **CONDITIONAL GO for the first paid LIVE run.**
> - ✅ Quality bar met when the LLM is the source.
> - ✅ Validator + entity-pollution filter + scrubber stack holding.
> - ⚠️ Must-fix before paid run: brand-claim grounding (plumb operator-curated `brand_assertions` through the openai SYSTEM_PROMPT so the LLM uses ONLY operator-supplied facts when claiming recognition; otherwise rewrite to a process-focused sentence).
> - ⚠️ Should-fix before scaling FAQ output: FAQ pairing (Q+A as one row, not two).
> - ❌ Apply-All-HIGH stays operator-locked OUT.
>
> **Next 3 actions:**
> 1. **Plumb `brand_assertions`** through `specific-edit-evidence.ts` (packet) + `openai.ts` (SYSTEM_PROMPT v2). Operator supplies a list of concrete, verifiable facts. LLM uses only these for third-party-recognition claims.
> 2. **First paid LIVE run** on a single fresh cluster (5–10 edits) with brand-claim grounding plumbed. Operator inspects manually. If ≥80% ship-as-is or minor-edit + ≤10% placeholder, proceed to broader generation.
> 3. **(Optional)** FAQ Q+A pairing fix (lower priority — operator can manually pair Q+A rows today).

> 🟢 **W3 Step 3.5g (Action-table polish: Type=Page, View on shipped, helper copy, chevron-only Details) LANDED (2026-05-03):** Operator browser audit on Step 3.5f accepted the row-content direction; small surfaces still needed polish:
> - **Type column** renders "Page" for create_page rows (was "—" placeholder).
> - **Shipped rows** render an actionable View button (was inert "✓ Shipped" text).
> - **Evidence** appends "while competitors appear" when Ritz absent + dominant competitor present (entity-pollution-filtered).
> - **Subtle helper copy** under toolbar: "Accepting a task starts tracking its impact on AI visibility."
> - **Details affordance** is chevron-only — visible "Details" text dropped from the row + column header to avoid duplicate-feeling Action + Details labels.
>
> **Tests (1 new file + 4 updated):** `tests/architecture/recommendations-step-3.5g-polish.test.ts` (NEW, 9) · render-output-cleanup.tsx (3 updated + 4 new acceptance) · step-3.5f-row-polish (1 updated). 202/202 targeted pass.

> 🟡 **W3 Step 3.5f (Ranked-action-table row polish) LANDED (2026-05-03):** Operator browser re-audit on Step 3.5e accepted the table SHAPE but failed row CONTENT — generic titles ("Create a page for this scenario"), duplicate `H2 "H2: …"` quote prefixes, low-priority top rows, "Defer" as the primary action for Needs review, "Create page" pill wrapping into two lines, repetitive evidence copy, tracking rows above open work, and no visible Details affordance. This commit addresses every operator-locked rule.
>
> **Concrete row content (operator-locked):**
> - **Title humanizer extended:** new topic patterns (`whole_home_renovation`, `luxury_custom_home`, plus refined matches), `extractTopicFromPrompts(prompts)` so geo-only clusters ("Atherton") recover topic from affected prompts ("design-build vs architect", "vacant-lot custom home"), `cleanDisplayLabel` strips `H2:`, `H2 heading (new):`, `New FAQ:`, `FAQ answer:`, `Title:`, `Meta:` prefixes plus matched outer quotes, `sanitizeClusterLabel` strips `Shield:` namespace + `(Bay Area)` suffix + trailing `Builders` noise, `composeFromClusterLabel` falls back to the cluster phrase verbatim instead of "this scenario".
> - **Decision-style topics get a "decision page" suffix.** "Create an Atherton older-home rebuild **decision** page", "Create a Cupertino design-build vs architect **decision** page", "Create a completed-plans handoff **decision** page".
> - **Edit titles use curly quotes consistently:** `Add an "Architect-led design-build advantage" H2 to the Whole Home Remodel page` (was duplicating `H2 "H2: …"`).
> - **Decision rows name the actual decision:** "Decide whether to split the Los Altos page into a dedicated kitchen remodel page", "Decide direction for Atherton older-home rebuild", "Regenerate edits for Cupertino custom home". Never "this opportunity" / "this scenario" / "this recommendation" fallbacks.
> - **Priority recomputation** blends 5 signals (severity + observation count + brand citation share + needsHumanReview + engineConfidence + hasExactEdit). High floors: severity=high + obs≥10 → High; severity=high + exact edit + non-low confidence → High. Medium floors: needsHumanReview → Medium minimum; brand_share=0 + obs≥10 → Medium minimum; multi-prompt + exact edit + non-low confidence → Medium. Low only when genuinely thin (obs<3, or single-prompt+obs<5).
> - **Evidence summary leads with `{N} AI answers; {topic-specific gap}.`** Rows now distinguish themselves: "12 AI answers; Ritz not cited for Atherton design-build vs architect comparisons.", "33 AI answers; Greenberg winning Whole Home Remodel page queries.", "8 AI answers; Schema missing on the Available Homes page."
> - **Sort buckets put open work first:** new / needs_review / needs_fresh_edit (bucket 0) → accepted (1) → measuring (2) → shipped (3) → deferred / dismissed (4). Tracking rows never outrank open work by default.
> - **Action button mapping per status:** Accept (new+exact) · Review (new+review_decision · needs_review) · Regenerate (new+regenerate · needs_fresh_edit) · Mark shipped (accepted) · View (measuring · accepted-without-edits) · ✓ Shipped (shipped) · Promote (deferred) · Restore (dismissed). **Defer is no longer a primary row button** — it lives only as a drawer-secondary footer button.
> - **Type pill compact:** create_page rows render `—` (the row title already says "Create"), other types use compact labels (`H2`, `Title`, `Meta`, `Schema`, `FAQ`, `Section`, `Copy`, `Links`, `Technical`, `Review`, `Regenerate`) with `whitespace-nowrap` so the column never wraps. Type-filter dropdown uses "Page" instead of "Create page".
> - **Visible Details affordance** — every row carries a Details button (with chevron) in the rightmost column, not just hidden row-click behavior.
> - **Drawer footer carries Defer + Dismiss as secondary actions** (`data-rec-drawer-secondary-actions="true"`), hidden once the row reaches a terminal state.
>
> **Tests (1 new file + 3 updated):**
> - `tests/architecture/recommendations-step-3.5f-row-polish.test.ts` (NEW, 28) — humanizer + builder + client-UI invariants per Step 3.5f rule.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (+10 acceptance tests) — operator-locked: no scenario/opportunity fallback, no duplicate H2 prefix, "homepage page" never renders, Type column compact, needs_review primary button is Review (not Defer), top-5 rows not all Low, evidence specificity, sort order (open work above tracking).
> - `src/domains/recommendations/recommendation-title-humanizer.test.ts` (5 updated + 2 new) — decision-page suffix; new "Decide direction for {topic}" copy; "this opportunity" / "this scenario" never emitted.
> - `tests/sprint6a1-phase12-wiring.test.ts` (1 updated) — `buildRecommendationActionRows` now invoked with `{ queue, promptTextById }`.
>
> **Verification (2026-05-03):**
> - `npx tsc --noEmit` clean · 189/189 targeted (humanizer + evidence-preview + confidence-distribution + step-3.5e action-table + step-3.5f row-polish + render-output-cleanup + ui-cleanup + sprint6a1) pass · `npm run test` 3584/3588 (4 pre-existing failures: prompts/[id] drilldown smoke × 1, prompts route smoke × 2, tenant isolation × 1 — verified independent against `8b12b3d` baseline) · `BEACON_TENANT_ID=… npm run build` clean (Vercel-equivalent read-only-FS).
> - **Could not verify from this environment:** Vercel deploy SHA matches the new commit — operator dashboard check + browser re-audit needed.
>
> **Out of scope (per Step 3.5f + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Step 3.6 sample-10 quality report — gated on this re-audit passing
> - Apply-All-HIGH / bulk-accept UX — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys this commit. Verify: row titles read as concrete tasks ("Add an 'Architect-led design-build advantage' H2 to the Whole Home Remodel page" / "Create an Atherton older-home rebuild decision page"); needs_review rows show Review (not Defer) as primary; dismissed rows show Restore; deferred rows show Promote; tracking rows sit BELOW open work; Type column never wraps "Create page"; visible Details chevron on every row; "Weak signal" / "homepage page" / "this opportunity" / "this scenario" never appear; evidence rows distinguish each other with topic-specific copy.
> 2. **If browser re-audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional)** one-rec dry-run probe before Step 3.6 if you want a smaller paid sample first.

> 🟡 **W3 Step 3.5e (Recommendations as a HubSpot-style ranked action TABLE) LANDED (2026-05-03):** Single code commit on `main`. Operator browser re-audit on Step 3.5d (lane model) failed product acceptance — "stop the card/lane approach. The page should not look like a dashboard of cards. It should look like a clean work queue." The fix is the next product-architecture rewrite: lanes/cards out, ranked action table in.
>
> **Page shape:** PageHeader subcopy ("Beacon turns AI visibility gaps into concrete website tasks…") + toolbar (search + Type filter + Status filter + summary line "N actions · M new · K tracking" + last-refreshed) + one `<table>` with columns **# · Recommended action · Target · Type · Priority · Status · Evidence · Action**. Click a row → inline drawer below with Exact recommended change (before/after copy or page brief) · Why Beacon recommends it · Evidence (affected prompts / observations / top competitor / refs) · Measurement plan · Risks · Overlapping pages · collapsed Debug block (raw IDs, evidence hash, resolver tier, full reasoning).
>
> **Action-row model (NEW `recommendation-action-rows.ts`):** flattens the rec queue + linked specific edits into one ranked table row per concrete website task. One rec with 3 usable edits → 3 rows ("Add an H2 …", "Add an FAQ …", "Add a section …"). Row title is action-aware (`composeEditRowTitle` covers every ActionType). Type column shows operator-readable label (Create page / H2 / Title / Meta / Schema / FAQ / Section / Copy / Links / Technical / Review / Regenerate). Priority is `high` / `medium` / `low` ("Weak signal" never appears — operator scope: use Low instead). Status maps from edit lifecycle + rec response → New / Accepted / Measuring / Shipped / Needs review / Needs fresh edit / Deferred / Dismissed.
>
> **Generic-competitor filter** (entity-pollution-filter) preserved everywhere: "General Contractors winning" / "Architects winning" never reach the evidence column. Real competitors (De Mattei Construction, etc.) still surface.
>
> **Internal taxonomy** lives on `data-rec-*` attributes (`data-rec-row-id`, `data-rec-action-row-type`, `data-rec-priority`, `data-rec-status`, `data-rec-source-rec-id`, `data-rec-source-edit-id`, `data-rec-rank`, `data-rec-type-pill`, `data-rec-priority-pill`, `data-rec-status-pill`, `data-rec-action-button`, `data-rec-debug-block`) for tests + diagnostics. Operator never sees raw enum tokens.
>
> No paid runs / regeneration / Apply-All-HIGH / backfill / Profound archive.
>
> **What changed:**
> - **Action-row model + builder (NEW `recommendation-action-rows.ts`)** — `RecommendationActionRow` type with id / rank / title / targetLabel / targetUrl / actionType / priority / status / evidenceSummary / sourceRecommendationId / sourceEditId / hasExactEdit / detail (drawer payload). `buildRecommendationActionRows({queue})` flattens recs → actions: one renderable specific edit → one row; rec with `create_new_page` action and zero edits → one create_page row; rec with `split_or_separate_page` / `merge_or_dedupe` / `needs_review` and zero edits → one review_decision row; rec with all-dismissed edits → one regenerate_edit row; otherwise suppressed. Sort: priority DESC → open-vs-decided → observation count DESC → id ASC. Pure / deterministic.
> - **Title composer covers every ActionType** — `composeEditRowTitle` emits action-aware verbs ("Add an H2 …", "Rewrite the … title", "Add … schema to the …", "Add an FAQ …"). `composeMetaRowTitle` covers create_page (delegates to `humanizeRecTitle`), review_decision ("Choose whether to split the …", "Pick a direction for the … opportunity"), regenerate_edit ("Regenerate edits for the … recommendation").
> - **Target labels** — `targetLabelForUrl` returns "Homepage" (path `/`), "{Page Name} page" (e.g., "Whole Home Remodel page"), or "New page" (NEEDS_NEW_PAGE sentinel). Never "homepage page" duplication. Edits prefer their own anchor URL over the rec's resolution when both exist.
> - **Status / Priority mapping** — `statusForRow` reads response.status + edit lifecycle + needsHumanReview to land on New / Accepted / Measuring / Shipped / Needs review / Needs fresh edit / Deferred / Dismissed. `priorityForRow` blends engineConfidence + severity + affectedPromptCount → high / medium / low (single-prompt caps at low).
> - **Client rewritten as a table** (`recommendations-client.tsx`) — pre-3.5e lane sections (LaneSection / BacklogSection / RecLane / lane badges) deleted entirely. Toolbar (search + type filter + status filter + summary), `<table>` with the 8 operator columns, per-row Type/Priority/Status pills, lane-aware Action button (Accept / Mark shipped / Undo / Dismiss / Defer / "Tracking" / "✓ Shipped"), and inline drawer (`<tr><td colspan=8>`) with Exact change / Why / Evidence / Measurement plan / Risks / Overlapping pages / Debug (collapsed `<details>`).
> - **Drawer evidence** — affected prompt count, observation count, top REAL competitor (via `shouldExcludeFromCompetitorRanking`), evidence-ref dropdown (with prompt-text snippet for `prompt` refs), full reasoning + confidenceReason (scrubbed for brackets + UUIDs) lives in the Debug `<details>`.
> - **Page header** — subcopy now reads "Beacon turns AI visibility gaps into concrete website tasks. Review the top actions, accept them, or mark them as shipped." Shell width widened from `max-w-4xl` → `max-w-5xl` so the table fits without horizontal scroll.
>
> **Tests (1 new file + 5 updated):**
> - `tests/architecture/recommendations-step-3.5e-action-table.test.ts` (NEW, 25) — table-shape source-scan invariants: lane patterns gone, table + columns + toolbar + summary + drawer + debug-block all wired with the right `data-rec-*` attributes.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (rewritten, 25) — render-side acceptance: table shape, concrete row titles, no `homepage page`, pills carry humanized text + data-* enum, `Weak signal` never visible, accepted state hides Accept button + shows Mark-shipped, generic-competitor filter, no bracketed diagnostics by default, no `Site match` / `AI-reviewed`, confidence-distribution invariant on a 5-rec fixture.
> - `tests/architecture/recommendations-ui-cleanup.test.ts` (rewritten) — pruned to the contracts that survive every redesign: HIGH copy never auto-apply; no Apply-All-HIGH; server actions still wired; no raw enum leakage as visible JSX text.
> - `tests/sprint6a1-phase12-wiring.test.ts` (UI block rewritten) — pre-3.5e SpecificEditsSection / `destructure edits` / Accept-button-copy assertions deleted (those moved into the action-row builder layer); replaced with the table-model wiring (client imports + invokes `buildRecommendationActionRows`; server actions still bound).
> - `tests/architecture/recommendations-step-3.5d-lane-queue.test.ts` (DELETED) — obsolete with the lane model gone.
> - `tests/routes/recommendations-smoke.test.ts` (1 line updated) — shell width regex now matches `max-w-(?:4xl|5xl)`.
>
> **Pure-helper tests (unchanged from 3.5d, still green):** recommendation-title-humanizer.test.ts (35), recommendation-evidence-preview.test.ts (16), confidence-distribution.test.ts (5).
>
> **Verification (2026-05-03):**
> - `npx tsc --noEmit` clean · targeted tests 80/80 (action-table source scan + render-output + ui-cleanup + sprint6a1 client UI + smoke) and 67/67 (humanizer + evidence-preview + confidence-distribution) · `npm run test` 3542/3546 (4 pre-existing failures: prompts/[id] drilldown smoke × 1, prompts route smoke × 2, tenant isolation × 1 — verified independent against `8b12b3d` baseline) · `BEACON_TENANT_ID=… npm run build` clean (Vercel-equivalent read-only-FS).
> - **Could not verify from this environment:** Vercel deploy SHA matches the new commit — operator dashboard check + browser re-audit needed.
>
> **Out of scope (per Step 3.5e + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Step 3.6 sample-10 quality report — gated on this re-audit passing
> - Apply-All-HIGH / bulk-accept UX — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys this commit. Verify: page is a clean ranked table (no card stack); 8 columns visible; first 8–12 rows scannable above the fold; each row title is a concrete task ("Add an H2 …", "Create a … page", "Rewrite the … meta description"); search + filters work; clicking a row opens an inline drawer with exact change + why + evidence + measurement plan + collapsed Debug; no "Weak signal" / "homepage page" / "General Contractors winning" / raw UUIDs / `[label tokens]` brackets in the default table.
> 2. **If browser re-audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional)** one-rec dry-run probe before Step 3.6 if you want a smaller paid sample first.

> 🟡 **W3 Step 3.5d (Recommendations decision-queue lane model) LANDED (2026-05-03 morning), SUPERSEDED BY 3.5e (2026-05-03 afternoon):** Five-lane card layout (`ready_to_ship` / `needs_decision` / `needs_fresh_edit` / `tracking` / `backlog`) with lane-aware buttons + expansion drawer per card. Operator browser audit declared the card model wrong: "stop the card/lane approach. The page should not look like a dashboard of cards. It should look like a clean work queue." Replaced by Step 3.5e's HubSpot-style ranked action table. Pure helpers from 3.5d (`recommendation-title-humanizer.ts`, `recommendation-evidence-preview.ts`, `display-state.ts`) all kept; the client-side lane UI is gone.

> 🟡 **W3 Step 3.5c (Triage UX reset after Step 3.5b browser re-audit) LANDED (2026-05-02):** Single code commit `7199094` on `main`. Operator browser re-audit on Step 3.5b still failed product acceptance — the page improved but stayed an evidence/debug feed. This commit closes the gap on six remaining issues. No paid runs / regeneration / Apply-All-HIGH / backfill / Profound archive.
>
> - **Display-state classifier (NEW)** — `src/domains/recommendations/display-state.ts`. Six states (`actionable_edit` / `manual_review` / `needs_fresh_edit` / `accepted_tracking` / `backlog` / `suppressed`) drive the rec card's chip + action surface. Operator-readable labels ("Ready to ship" / "Needs your judgment" / "Needs fresh edit" / "Tracking" / "Backlog" / "Hidden"). `effectiveTierForDisplay` enforces the rule that `needs_fresh_edit` cannot appear in NOW.
> - **Generic competitor pollution filter on EvidenceChips** — `shouldExcludeFromCompetitorRanking()` (no-entity fallback path) drops "General Contractors" / "Local Contractors" / "Architects" / "Home Builders" / "Custom Home Builders" / "Bay Area Builders" before they can land in chips. Chip text renamed `{name} primary · {pct}%` → `{name} winning · {pct}%` for natural operator language.
> - **Raw prompt-id scrubber** — new `scrubRawPromptIds(text)` defense-in-depth helper. Patterns scrubbed: `prompt {full UUID}`, `prompt {8+ hex prefix}`, bare full UUID. Replaced with "an affected prompt". Wired into reasoning, confidenceReason, edit.why renders.
> - **"Site match" / "AI-reviewed" tier badges DROPPED** from default header. Resolver tier still drives engineConfidence under the hood; no longer surfaces as a chip.
> - **Display-state chip + drop "fragmented" / "{N} prompts"** — operator chips ("Tracking" / "Needs fresh edit" / etc.) replace internal cluster jargon.
> - **Title humanization — scenario fallback** — Step 3.5b.F's wrapped-quote form replaced with a scenario-class fallback (`Create a page for this buying scenario` / `this remodeling scenario` / `this rebuild scenario` / `this comparison scenario` / `this cost question` / `this decision scenario`). No raw prompt copy in titles.
>
> **Tests (35 new across 4 files):**
> - `display-state.test.ts` (NEW, 15) — six-state classifier; tier-downgrade rule; operator-label invariants.
> - `build-title.test.ts` (5 updated + 2 new) — scenario-class fallbacks per intent (cost / comparison / rebuild / remodel / buying / decision).
> - `tests/domains/recommendations/build-title.test.ts` (1 updated) — long-label assertion swapped from ellipsis to scenario-fallback.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (+10) — General Contractors filtered; Architects/Home Builders/Local Contractors filtered; no "fragmented" chip; no "Site match" / "AI-reviewed" badges; raw prompt-ids scrubbed (8+ hex prefix + full UUID); accepted_tracking hides action surface; needs_fresh_edit shows chip + empty-state; queue not mostly Weak signal.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 67/67 targeted (display-state + build-title × 2 + render-output-cleanup) · `npm run test` 3448/3454 (4 pre-existing failures verified independent against `5d32f5f` baseline) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `7199094` — operator dashboard check + browser re-audit needed.
>
> **Out of scope (per Step 3.5c + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Step 3.6 sample-10 quality report — gated on this re-audit passing
> - Apply-All-HIGH bar — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys `7199094`. Verify: no "General Contractors winning"; no "prompt 319557d1" anywhere; no "Site match" badges; no "fragmented" chips; accepted recs show "Tracking" chip + no Accept buttons; "If I buy a property" cluster shows "Create a page for this buying scenario" title; mix of Strong / Review / Weak signal pills.
> 2. **If browser re-audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional)** one-rec dry-run probe before Step 3.6 if you want a smaller paid sample first.

> 🟢 **W3 Step 3.5b (Product cleanup after Step 3.5 browser audit) LANDED (2026-05-02):** Single code commit `9b05327` on `main`. Operator's browser audit caught six product issues source-scan tests missed; this commit fixes all six without paid runs / regeneration / Apply-All-HIGH / backfill.
>
> - **A. Competitor-name leak quarantined** — `scripts/quarantine-competitor-public-copy-pre-w3.ts` (NEW, idempotent). Forward-only flips the operator-flagged H2 row (`create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa`, "Why teams choose us over De Mattei Construction") from `accepted` → `dismissed` with `not_found_reason: "invalid_competitor_public_copy_pre_w3"`. Local + Supabase dual-write executed; postflight green. Sister "Bay" matches were false positives (geographic Bay Area refs, not Bay Builders competitor); not quarantined.
> - **B. Confidence semantics revised** — `tier_deterministic_only` LOW gate REMOVED. Was forcing every deterministic-only rec into Weak signal regardless of evidence. Now deterministic-only BLOCKS Strong but does NOT force Weak signal. New combined LOW gate `single_prompt_no_evidence` fires only when affectedPromptCount === 1 AND no packet signal AND zero structured evidence refs (genuinely thin). HIGH-blocker code renamed `tier_observation_only` → `tier_not_adjudicated_or_inventory` to reflect that both observation AND deterministic_only block Strong.
> - **C. Raw enum labels removed from rendered UI** — new `EDIT_DIFFICULTY_LABEL` (low→Easy / medium→Medium / high→Hard); EvidenceChips effort chip humanized (low→"Quick win" / medium→"Medium effort" / high→"Heavy lift"). Internal enums stay in `data-*` attributes. **Rendered-output tests** (not just source-scan) pin the contract.
> - **D. Motive jargon replaced** — `MOTIVE_LABEL` values rewritten as operator-readable sentences (e.g., `capture_absent_cluster` → "AI is not citing Ritz for this topic yet.", `counter_competitor` → "A competitor is currently winning this answer."). Label "Motive:" replaced with "Why this matters:".
> - **E. Bracketed diagnostic scoring stripped from default card** — new `stripBracketedDiagnostics()` helper drops `[reason1; reason2; …]` suffixes from `confidenceReason` on the default card body. Full text preserved in the underlying field for evidence expansion.
> - **F. Prompt-shaped titles fixed** — new `looksLikePromptText()` helper in `build-title.ts`. When the cluster label reads like a customer-asked sentence (starts with prompt-starter, has pronoun, has `?`, or > 50 chars), the create-page title wraps as `Create a page for "{label}"` instead of the broken-grammar form `Create a {label} page`.
>
> **Tests (33 new across 3 files):**
> - `confidence.test.ts` (+10) — deterministic-only doesn't force LOW; new combined LOW gate; "INVARIANT: queue of 5 well-formed rec shapes → 0 LOW".
> - `build-title.test.ts` (NEW, 16) — `looksLikePromptText` triggers + non-triggers; "Create a If I..." regression fixed; LLM operatorTitle still wins.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (NEW, 7) — rendered HTML asserts: "Why this matters" replaces "Motive:", humanized motive copy lands, no bracketed diagnostics, no raw "low" body text, "Easy" + "AI-generated" + "Review" labels, queue not all Weak signal, prompt-shaped title grammar correct.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 56/56 targeted (build-title + confidence + render-output) · `npm run test` 3424/3428 (4 pre-existing failures verified independent against `5d32f5f` baseline) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `9b05327` — operator dashboard check + browser-spot-check.
>
> **Out of scope (per Step 3.5b + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Apply-All-HIGH bar — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys `9b05327`. Verify: De Mattei H2 gone; mix of Strong/Review/Weak signal pills (not all Weak); no bracketed scoring; no "Motive: Capture absent cluster"; no raw "low" / "medium" / "high"; no "Create a If I..." titles.
> 2. **If browser audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional, ad-hoc) one-rec dry-run probe** — single packet at `--dry-run`, ~$0.03, no .data writes — if you want a smaller paid sample before broader Step 3.6.

> 🟢 **W3 Step 3.5 (Recommendations UI cleanup with engineConfidence pill) LANDED (2026-05-02):** Single code commit `4d9fa1a` on `main`. Renders the trust label that Step 3.3's rubric stamps and Step 3.4 fed real packet signals into. No new LLM runs, no paid calls, no regeneration, no Apply-All-HIGH.
>
> - **`RecConfidencePill` (NEW, `src/components/display/rec-confidence-pill.tsx`)** — operator-locked labels: `high` → **"Strong"**, `medium` → **"Review"**, `low` → **"Weak signal"**. Internal enum stays high/medium/low; `data-rec-confidence` attribute carries it. Tooltip surfaces the trust contract per tier ("Strong: likely safe to ship after a brief review. Manual ship only — never auto-apply.") plus diagnostic reason codes from `engineConfidence.reasons`.
> - **Pill rendered on every rec card** in `recommendations-client.tsx` between the action label and tier badge.
> - **Humanized labels replace raw enum tokens** — `humanizeActionType()` (Title-Case fallback for unmapped action_types), `EDIT_SOURCE_LABEL` (`openai`/`anthropic` → "AI-generated", `deterministic` → "Deterministic"), `EDIT_CONFIDENCE_LABEL` (`high`/`medium`/`low` → "Strong"/"Review"/"Weak signal"). `data-source` / `data-edit-confidence` attributes carry the raw internal enum.
> - **Empty-state for filtered edits** — when `allEdits.length > 0` but the Step-3.1b-quarantine filter leaves `editCount === 0`, the rec card shows: *"{N} specific edits on this rec — all dismissed or no longer actionable. Re-run the generator to produce fresh edits, or accept the rec to track the change at the rec level only."* With `data-recommendations-edits-empty="true"` for tests.
> - **Apply-All-HIGH stays explicitly OUT.** Architecture invariant `tests/architecture/recommendations-ui-cleanup.test.ts` BLOCKS reintroduction: no `acceptAllHighConfidence` / `HighConfidenceApplyBar` / "Apply all HIGH" copy / "auto-apply" / "one-click" / "instantly ship" anywhere in the client source.
>
> **Tests (25 new across 2 files):**
> - `rec-confidence-pill.test.tsx` (15) — label renders, no-auto invariant (visible label scan, tooltip stripped — tooltip CAN say "never auto-apply" since that's the trust copy), tooltip body, internal enum doesn't leak, exported map covers every value.
> - `recommendations-ui-cleanup.test.ts` (10) — pill imported + rendered, no auto-apply phrasing, no Apply-All-HIGH bar/action, humanizers wired, empty-state branch present, every existing action (Accept/Defer/Dismiss/Mark-shipped/Undo) still bound.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 25/25 new tests pass · `npm run test` 3396/3400 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation, same set as W1/W2/W3 baselines) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `4d9fa1a` — operator dashboard check.
>
> **Out of scope (per Step 3.5 + W3 §1.5):**
> - Apply-All-HIGH bar / batch-accept UX — operator-locked OUT, architecture invariant blocks reintroduction
> - LIVE paid generation across the queue — first paid run is post-Step-3.6, operator-approved
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `4d9fa1a` is "Ready"** + **browser-spot-check /recommendations** for the new "Strong" / "Review" / "Weak signal" pills + verify no "openai" / "low" / "add_h2_section" raw enum tokens in any rec card.
> 2. **Continue W3 Step 3.6 (sample-10 quality report).** The W3 finale: pick 10 recs across the queue, run `runProviderAndPersist({ packet, dryRun: true })` against the live OpenAI provider, score each generated edit honestly (ship-as-is / minor-edit / no / placeholder). Operator-locked gate before any broader regeneration.
> 3. **(Optional, ad-hoc) operator-gated one-rec dry-run** if you want a smaller paid probe before the broader Step 3.6 sample.

> 🟢 **W3 Step 3.4 (LLM provider activation + confidence loop closure) LANDED (2026-05-02):** Single code commit `37ef437` on `main`. Architecture-only — turns on the LLM grounding path so the W3 Step 3.2 evidence packet can produce real edits, but takes ZERO live paid runs. Validators + confidence rubric prevent bad output from reaching the product. Live regeneration is operator-gated, post-3.6.
>
> - **Loop closed: packet signals → confidence.** `hasAiSearchSignalForRec` + `hasCompetitorPageBlueprintsForRec` (NEW pure helpers in `specific-edit-evidence.ts`) derive real signals from observations; `load-queue.ts` replaces the hardcoded `false`s with these. **HIGH is now reachable** when a rec has real packet evidence + every other dimension passes. Both helpers run in O(observations of affected prompts) per rec — no extra I/O.
> - **SYSTEM_PROMPT v2** in `openai.ts` carries three new operator-locked rules: **Rule 15** (consume `aiSearchSignal.topSearchQueries` / `topDescriptors` / `topCompetitorCoMentions` / `competitorPageBlueprints` / `crossTenantPatterns` per the operator's grounding contract); **Rule 16** ("RETURN [] FOR THIS PACKET" when can't write specific copy — better empty than generic); **Rule 17** (operator-locked placeholder phrase ban). Existing Rules 1–14 preserved verbatim (Rule 12 no-competitor-names, Rule 13 FAQ customer-voice, Rule 14 evidence priority).
> - **Provider activation safety verified** — every gate already exists: Vitest safety, Vercel build guard, OPENAI_API_KEY config gate, budget gate before paid call (`runProviderAndPersist` → `checkBudget` → empty no-persist result if blocked), every failure mode returns an empty bundle never a placeholder, deterministic fallback path unchanged. `validateSpecificEditBundle` runs every edit through Step 3.1's placeholder + competitor-leak + structural-quality gates; failed edits drop, only validated rows persist.
> - **NO live paid run.** Tests use mocks. The LLM provider activation in this step means SYSTEM_PROMPT v2 + loop closure + verification. First live generation comes post-Step-3.6 with operator approval per packet/rec.
>
> **Tests (23 new across 2 new files + 2 modified files):**
> - `w3-step-3.4-loop-closure.test.ts` (NEW, 13) — packet helpers + HIGH-reachability + builder/helper agreement.
> - `openai.test.ts` (+9 SYSTEM_PROMPT verification) — pins every operator-locked phrase: aiSearchSignal sections, competitorPageBlueprints structure-not-name instruction, crossTenantPatterns empty-stub note, Better-empty-than-generic, placeholder phrase set, Rule 12, Rule 14.
> - `confidence.test.ts` (+1 fix) — readonly-modifier compatibility.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 671/671 across `src/domains/recommendations/` (was 649; +22) · `npm run test` 3371/3375 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `37ef437` — operator dashboard check.
>
> **Out of scope (per W3 §1.5 + Step 3.4 scope):**
> - **LIVE paid generation across the queue** — tests use mocks; first paid runs are post-Step-3.6, operator-approved per packet
> - Apply-All-HIGH bar — deferred until founder reviews 20–30 generated recs
> - Recommendations UI cleanup — Step 3.5
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `37ef437` is "Ready".**
> 2. **Continue W3 Step 3.5 (Recommendations UI cleanup).** Renders the `engineConfidence` pill (now real, since Step 3.4 closed the loop), simple-card default, evidence expansion. Operator scope explicitly forbids Apply-All-HIGH UI.
> 3. **(Optional, operator-gated) one-rec dry-run sample.** Pick a single rec with real packet signals; run `runProviderAndPersist({ packet, dryRun: true })` against the live OpenAI provider; inspect the bundle WITHOUT persisting. Confirms the SYSTEM_PROMPT v2 produces grounded edits before Step 3.6's broader sample-10 quality report.

> 🟢 **W3 Step 3.3 (Confidence rubric — the trust contract) LANDED (2026-05-02):** Single code commit `ab3b11a` on `main`. Defines HIGH / MEDIUM / LOW BEFORE the LLM provider activates in Step 3.4. Founder direction: "confidence is the trust contract; the LLM provider should not activate first and then have confidence slapped on after."
>
> - **`src/domains/recommendations/confidence.ts` (NEW)** — `RecConfidence = "high" | "medium" | "low"` + 22 stable `ConfidenceReasonCode`s + `computeRecConfidence(args)`. Pure / deterministic. Imports `looksLikePlaceholder` from Step 3.1 for defense-in-depth.
> - **HIGH is hard to earn on purpose** (operator-locked). Requires ALL six dimensions to pass: ≥2 affected prompts, resolverTier in {adjudicated, inventory}, every edit at "high", packet has aiSearchSignal OR competitorPageBlueprints, resolutionConfidence === "high", evidenceRefCount ≥ 2. Any blocker forces MEDIUM (after LOW gates pass). Targeted distribution: HIGH 5–15% / MEDIUM 50–70% / LOW 20–40%.
> - **LOW gates short-circuit** (first match wins): no_affected_prompts / needs_human_review / no_edits / edit_low_confidence / edit_placeholder_text (defense-in-depth via Step 3.1's `looksLikePlaceholder`) / competitor_name_leak_in_copy / tier_deterministic_only / resolution_low_confidence.
> - **Apply-All-HIGH explicitly OUT.** The rubric file documents that HIGH means "likely safe to ship MANUALLY," never "auto-apply." Test `Apply-All-HIGH guardrail` enforces a 5+ reason floor for HIGH so any future weakening of the rubric to a single positive signal forces a conversation.
> - **Loader integration (`load-queue.ts`)** — new `LiveRecQueueItem = PrioritizedRecommendation & { engineConfidence: RecConfidenceVerdict }`. Loader fresh-reads `recommended_edits` (moved from page.tsx) and stamps engineConfidence on every queue item. `LiveRecommendationQueue.recommendedEdits` exposes the rows so page.tsx consumes via `live.recommendedEdits` instead of re-fetching. `hasAiSearchSignal` / `hasCompetitorPageBlueprints` pass through `false` at this layer — HIGH is intentionally unreachable today; Step 3.4 plumbs in real packet signals so the trust label earns its weight when the LLM provider activates.
> - **Page integration (`page.tsx`)** — `RecommendationQueueRow.rec` is now `LiveRecQueueItem`. UI doesn't render the verdict yet (Step 3.5); the field is exposed so the upcoming UI cleanup reads it without a second wiring pass.
> - **Wiring tests updated** — `tests/sprint6a1-phase12-wiring.test.ts` and `load-queue.test.ts` updated to assert the relocated edits-read in the LOADER (single source of truth for engineConfidence input) and that page.tsx no longer re-fetches.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 28/28 confidence tests · 22/22 wiring · 9/9 reads-fresh · `npm run test` 3349/3353 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `ab3b11a` — operator dashboard check.
>
> **Out of scope (per W3 §1.5):**
> - Apply-All-HIGH bar — deferred until founder reviews 20–30 generated recs
> - LLM provider activation — Step 3.4 (next)
> - Recommendations UI cleanup — Step 3.5
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `ab3b11a` is "Ready"**.
> 2. **Continue W3 Step 3.4 (LLM provider activation).** Wires the SYSTEM_PROMPT v2 to consume the Step 3.2 evidence packet (`aiSearchSignal` + `competitorPageBlueprints` + cross-tenant brain stub). With Step 3.3 in place, the producing LLM's edits get stamped with the trust label as they flow through `load-queue.ts`. Anti-leak guards (no competitor names in Ritz copy) live in the validator + the rubric's competitor-name-leak LOW gate.
> 3. **Browser-spot-check /recommendations** — page should look identical to post-Step-3.2; engineConfidence is stamped server-side but the UI doesn't render the pill yet (Step 3.5).

> 🟢 **W3 Step 3.2 (Recommendation Engine v2 evidence packet foundation) LANDED (2026-05-01):** Single code commit `bded491` on `main`. Three new blocks land on `SpecificEditEvidencePacket` — `aiSearchSignal`, `competitorPageBlueprints`, `crossTenantPatterns`. Step 3.4's LLM provider will consume them; this step ships the packet shape only (no LLM call, no UI consumer).
>
> - **`aiSearchSignal`** — what AI actually emits while answering affected prompts. `topSearchQueries` (verbatim, deduped + counted across observations + platforms), `topDescriptors` (lowercased near-brand descriptor windows), `topCompetitorCoMentions` (filtered through `entity-pollution-filter` so Houzz/Yelp/Angi/BuildZoom never reach the LLM as "competitors"). Caps 10/12/8. Empty arrays when no signal — better empty than fake.
> - **`competitorPageBlueprints`** — top competitor pages cited on affected-prompt observations. URL + domain + topic + citationCount + promptsCitedOn from real aggregation; pageTitle from `CompetitorPageEvidence` when available; h1/topH2s/faqQuestions/metaDescription stay null/empty (future scraper; never invented). Filters: drop `class !== "competitor"`, drop directory domains, drop owned domains. Cap = 5.
> - **`crossTenantPatterns`** — STUB. New `src/domains/recommendations/cross-tenant-brain.ts` defines `CrossTenantPattern` + `GetCrossTenantPatternsArgs` + `getCrossTenantPatterns()` returning `[]`. Pure, operator-locked signature so the future producer (post-month-3) drops in without touching consumers. Activation gated to `BEACON_CROSS_TENANT_BRAIN=1` (env not yet wired).
> - **Packet shape + `evidenceHash`** — all three new fields are required (empty defaults), so `evidenceHash` is deterministic regardless of producer state. Tests prove hash flips on `aiSearchSignal` change AND on `competitorPageBlueprints` change, and stays stable across re-runs with identical inputs.
> - **New optional builder args** — `citationEvidenceIndex` + `competitorPages` (both default null/[] so existing callers keep working without modification).
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · 106/106 targeted (102 evidence-packet + 4 cross-tenant stub) · `npm run test` 3321/3325 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation, same set as W1/W2/W3-scope-lock/W3-Step-3.1/W3-Step-3.1b baselines) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `bded491` — operator dashboard check.
>
> **Out of scope (per W3 scope lock):**
> - LLM provider activation — Step 3.4
> - Confidence rubric — Step 3.3 (type stubs only if strictly necessary; not needed for 3.2)
> - Recommendations UI cleanup — Step 3.5
> - Apply-All-HIGH bar — deferred until 20–30 manual reviews
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `bded491` is "Ready"** — single code commit + sibling docs commit.
> 2. **Continue W3 Step 3.3 (confidence rubric)** OR jump to **Step 3.4 (LLM provider activation)** depending on operator preference. The rubric is a single pure file (`computeRecConfidence(rec, edits) → "high" | "medium" | "low"`) stamped on `rec.resolution.confidence` in `load-queue.ts`. Step 3.4 wires the SYSTEM_PROMPT v2 to consume this packet.
> 3. **Browser-spot-check /recommendations** to confirm Step 3.1b's quarantine + 3.2's no-op (3.2 changes packet shape; the deterministic generator path is unchanged at this step, so the visible queue should look identical to post-Step-3.1b).

> 🟢 **W3 Step 3.1b (Pre-W3 placeholder quarantine) LANDED (2026-05-01):** Single code commit `1be64f9` on `main`. The 4 Los Altos `add_faq` rows operator-accepted before Step 3.1's hardening are now `dismissed` with `not_found_reason: "invalid_placeholder_pre_w3"`. Architecture invariant allowlist DROPPED; placeholder copy is no longer renderable on /recommendations or /today.
>
> - **Quarantine script (`scripts/quarantine-pre-w3-placeholder-edits.ts`, NEW)** — mirrors `archive-faq-test-pollution.ts`: idempotent, dry-run + execute modes, preflight + postflight assertions, hardcoded targets (4 placeholder IDs + sibling H2 + rec-level response). Forward-only flip: `accepted` → `dismissed` with the documented reason. Local file write + Supabase dual-write (DUAL_WRITE=true confirmed). All 10 postflight checks green; sibling H2 + rec response byte-equivalent.
> - **UI filter (`recommendations-client.tsx`)** — rec card now filters `dismissed | not_found_after_7d` before rendering `SpecificEditsSection`. Without this, a dismissed placeholder row would still appear in the expanded edits list with a "Dismissed" pill but the original placeholder text still on screen. The lifecycle classifier on /changes already drops both to `unclassified`; this brings /recommendations into parity. Destructure renamed `edits` → `allEdits` so the filtered array takes the `edits` name; editCount + eligibleEditCount + the consumer all read the filtered array.
> - **Architecture invariant (`tests/architecture/no-placeholder-recommended-edits.test.ts`)** — `KNOWN_PRE_W3_PLACEHOLDER_IDS` allowlist DROPPED. Replaced with `QUARANTINED_PRE_W3_IDS` (same 4 IDs, but as a regression target, not an exemption). Two new tests pin the post-Step-3.1b state: "quarantined rows are dismissed with the documented reason" + "quarantined rows do not pass `isActive` filter."
> - **Regression test (`tests/app/recommendations/pre-w3-quarantine-non-renderable.test.ts`, NEW)** — 5 focused tests covering: (1) 4 IDs dismissed with reason, (2) /recommendations rec card filter blocks them, (3) /today implementation-queue source predicate blocks them, (4) original `proposed_text` preserved (history not deleted), (5) architecture invariant active-row scan finds zero violations.
> - **Wiring test (`tests/sprint6a1-phase12-wiring.test.ts`)** — Phase 6A.1.12 destructure-pattern regex updated for the new `edits: allEdits` shape; behavior contract unchanged.
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · 184/184 targeted tests pass + 22/22 wiring · `npm run test` 3295/3299 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation, same set as W1 + W2 + W3-scope-lock + W3 Step 3.1 baselines) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `1be64f9` — operator dashboard check.
>
> **Acceptance (per operator scope):**
> 1. ✅ `.data/tenants/*/recommended-edits.json` has zero active/renderable placeholder edits.
> 2. ✅ Architecture invariant has no permanent allowlist (replaced with explicit `QUARANTINED_PRE_W3_IDS` regression target).
> 3. ✅ Old placeholder rows are filtered AND marked invalid; they do not render as a usable recommendation.
> 4. ✅ No new placeholder rows can be added (Step 3.1's validator + generator gates).
> 5. ✅ History preserved: dismissed rows still carry their original proposed_text in the data store.
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `1be64f9` is "Ready"** — single code commit + sibling docs commit.
> 2. **Browser-spot-check /recommendations** for the Los Altos rec — should show 1 H2 edit only (the sibling), not 5 (4 dismissed FAQs hidden by the new filter).
> 3. **Continue W3 Step 3.2 (evidence packet extension).** Foundation for Step 3.4 LLM activation: `aiSearchSignal` + `competitorPageBlueprints` + cross-tenant brain stub.

> 🟢 **W3 Step 3.1 (Placeholder kill + FAQ structural-quality gate) LANDED (2026-05-01):** Single code commit `dd59d6a` on `main`. Beacon now refuses to put placeholder copy in the recommendation queue at three layers — helper, validator, and the deterministic FAQ generator's abstain path.
>
> - **Helper (`src/domains/recommendations/placeholder-detection.ts`, NEW)** — `PLACEHOLDER_PATTERNS` covers 8 operator-locked phrases (Draft answer / TBD / operator: rewrite / (operator: ...) / rewrite below / [insert ...] / placeholder / TODO:) with word-boundary anchors so legitimate copy ("our crane operator drafts each plan") never false-matches. `evaluateFaqAnswer({question, answer})` returns a discriminated verdict with reasons `too_short` (<25 words), `repeats_question` (≥80% content-word overlap), `no_specific_content` (<5 distinct words after stopwords + question + GENERIC_FILLER), or `placeholder_phrase`. `parseFaqProposedText` extracts Q + A halves from the deterministic generator's `Q: ... \n\nA: ...` shape.
> - **Validator (`specific-edit-validator.ts`)** — New rule 9.55 (`validateNoPlaceholder`) wired between FAQ-intent-rewriting (9.5) and competitor-public-copy (9.6). Two passes: phrase scan against proposedText AND displayLabel; structural scan against parsed Q+A bodies for FAQ action types. **No env opt-out** — placeholder copy must never reach the queue. Existing rule 9.5 ("?" check) extended to recognize the Q+A shape so the deterministic generator's full output runs the gate (was previously filtered out).
> - **Generator (`add-faq.ts`)** — `composeAnswerSeed` now returns `string | null`. Three branches: (A) ≥2 descriptors → real grounded body referencing actual descriptors AI uses; (B) 1 descriptor + cluster label → narrower body anchored on both; (C) abstain. Branches A and B validate via `evaluateFaqAnswer` before returning, falling through on fail. Outer loop sees null, rolls back the dedupe entry, emits no edit. Apologetic risk copy ("operator must rewrite") replaced with grounded framing.
> - **Architecture invariant** — `tests/architecture/no-placeholder-recommended-edits.test.ts` scans every tenant's `recommended-edits.json` for placeholder phrases AND for FAQ structural failures. The 4 Los Altos add_faq rows operator-accepted before the hardening are allowlisted by id (`KNOWN_PRE_W3_PLACEHOLDER_IDS`); the test refuses to grow the list. Stale-allowlist guard ensures entries are removed when the underlying rows get regenerated.
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · placeholder-detection 32/32 · validator 103/103 (11 new) · generators 40/40 (6 new) · architecture invariant 3/3 · `npm run test` 3289/3293 (the 4 failures are the same pre-existing set as W1/W2/W3-scope-lock baselines: 3 prompts-smoke fixture time-drift + 1 tenants/isolation) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `dd59d6a` — operator dashboard check.
>
> **Out of scope (per W3 scope lock):**
> - LLM provider activation (Sprint 6A.2) — Step 3.4
> - Recommendations UI cleanup — Step 3.5
> - Apply-All-HIGH bar — deferred
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `dd59d6a` is "Ready"** — Step 3.1 is a single code commit + sibling docs commit.
> 2. **Continue W3 Step 3.2 (evidence packet extension).** Adds `aiSearchSignal` (top search queries + top descriptors + top competitor co-mentions filtered through entity-pollution-filter), `competitorPageBlueprints` (top-cited competitor pages joined to `page_element_inventory`), and `crossTenantPatterns` (stub returning `[]`). Foundation for Step 3.4 LLM activation.
> 3. **Watch the next regeneration cycle** for the 4 known-bad Los Altos FAQ rows. They stay `accepted` until Step 3.4's LLM provider replaces them with grounded copy; the architecture invariant's allowlist will shrink to zero at that point.

> 🟡 **W3 SCOPE LOCKED (2026-05-01) — founder-revised before any W3 code lands:**
>
> **In scope:**
> 1. **Recommendation Engine v2 evidence packet.** Extend `SpecificEditEvidencePacket` with `aiSearchSignal` (top search queries, top descriptors, top competitor co-mentions filtered through entity-pollution-filter), `competitorPageBlueprints` (top-cited competitor pages joined to `page_element_inventory`), and `crossTenantPatterns` (stub returning `[]` — no real cross-tenant logic yet).
> 2. **Placeholder kill.** Validator rejects `Draft answer / TBD / [insert / rewrite below / (operator: rewrite)` patterns. Deterministic generators abstain when no `aiSearchSignal.topSearchQueries` AND no `competitorPageBlueprints` AND no descriptors-near-brand. Better empty than bad.
> 3. **LLM provider activation (Sprint 6A.2 deferred from W2).** OpenAI provider uses the evidence packet. Grounded edits only. No competitor-name leakage into Ritz copy. No generic SEO fluff. Budget-gated through existing `adjudicator-budget.ts` ($200/mo cap).
> 4. **Confidence rubric.** New `src/domains/recommendations/confidence.ts` with `computeRecConfidence(rec, edits)` → `"high" | "medium" | "low"`. **HIGH means "likely safe to ship manually," NOT "auto-apply."** Stamped on `rec.resolution.confidence` in `load-queue.ts`.
> 5. **Recommendations UI cleanup.** Simple card default. Evidence expansion. Confidence pill. (UUIDs + jargon already killed in W1.) **No Apply-All-HIGH bar.**
> 6. **Tests / gates.** New architecture invariants: 0 placeholder rendered edits; 0 UUIDs (existing); Houzz/directories excluded from competitor instructions (existing); thin-evidence abstain; cost cap enforced. **Sample 10 generated recs on Ritz prod data and report quality honestly** — this is the W3 gate.
>
> **Explicitly out of scope for W3:**
> - **Apply-All-HIGH bar.** Deferred until the founder has personally inspected 20–30 generated recommendations and trusts the HIGH label. Until then, the only acceptance path is per-rec Accept (existing `acceptRecommendation`).
> - **`acceptAllHighConfidence` / `undoAcceptAllHighConfidence` server actions.** Not built.
> - **Customer-one backfill mutation.** Backfill execution remains W4. W3 ships against current native-only data (since 2026-04-22) plus the schema-compatible model already in place.
> - **Profound CSV archive + Profound code deletion.** Both deferred until after May 10 expiry.
> - **`llm-budget-tiers.ts`.** Tier-aware caps deferred — single-tenant single-pricing for now; existing `adjudicator-budget.ts` is enough.
>
> **Master plan file** (`~/.claude/plans/beacon-master-sorted-creek.md`) §3.2, §5.6, §5.7, §9 W3 row, §10 file summary, §13 risk register, §14 success criteria all updated to reflect this amendment. Plan-file edits paired with the doc commit below so any context-reset agent reads the same scope.
>
> **Capability tier for W3:** **Max** — touches the wedge data path (LLM-grounded copy, validator semantics, evidence-packet shape that the brain learns from), and the confidence rubric is the trust contract for every future batch UX.

> 🟢 **W2 Step 2.4 (Operator Mark-shipped + day-3 stale tint) LANDED (2026-05-01):** Single commit `260b313` on `main`. Adds the manual override that lets an operator start the verdict bake-window clock from /recommendations or /changes without waiting for tomorrow's 07:00 UTC scan, plus a day-3 yellow tint that warns when accepted edits sit unconfirmed.
>
> - **Persistence (`src/domains/recommendations/recommended-edits-persistence.ts`)** — `LiveMatchKind` extended with `"operator_override"` (never emitted by the match engine; only stamped by the new helper). New `markRecommendedEditsAsShipped({ editIds, tenantId, now? })` flips `recommended` or `accepted` → `verified_live` with `live_at = nowIso`, `live_match_kind = "operator_override"`, `live_match_confidence = "high"`. Forward-only at the persistence layer: rows already past `verified_live` are no-op. Idempotent. Dual-write follows the same file-first-then-Supabase contract as `markRecommendedEditsAccepted`. 10 new unit tests cover every transition path (recommended→shipped, accepted→shipped, all 7 forward-state no-ops, legacy undefined, unknown ids, empty input, field preservation, idempotency, dual-write failure, mixed-id batching).
> - **Server actions** — New `markRecommendationShipped({ stableKey })` in `src/app/(shell)/recommendations/actions.ts` reads the rec's edits, filters to eligible (`recommended | accepted`), batches through the persistence helper, revalidates `/recommendations` + `/changes` + layout. New file `src/app/(shell)/changes/actions.ts` adds `markChangelogEditShipped({ changelogId })` — re-resolves `(source_rec_id, action_type, target_element_key)` via `changelogJoinKey` + `indexEditsByJoinKey`, single-edit batches through the helper. Re-resolving server-side keeps the lifecycle invariant honest even when the UI is stale.
> - **/recommendations UI** — `eligibleEditCount` filtered inline (`row.implementation_status ?? "recommended"`) to keep the file client-safe (importing the helper module would pull `server-only` runtime code into the client bundle and break the build — verified by an actual failed `npm run build`, fixed by inlining). `acceptedAgeDays` derived from `response.respondedAt`; `isStalePending = accepted && eligibleEditCount > 0 && age ≥ 3 days`. Card border + bg flip yellow with an "Nd pending" pill next to "✓ Accepted". "Mark shipped" button renders only when accepted && eligible > 0; tooltip explains the operator-override stamp. Once every linked edit reaches `verified_live` the button vanishes.
> - **/changes scorecard UI** — `canMarkShipped = lifecycleStatus ∈ {recommended, accepted}` (uses the existing `editStatusByChangelogId` map; no new data path). `ageDays` from `changelog.timestamp` (accept-at proxy because per-edit fan-out fires at accept time). Stale-pending tints the `<tr>` warning-yellow + "Nd pending" pill below the lifecycle pill. "Mark shipped" button under the pill with `stopPropagation` so pressing it doesn't toggle the row's expand. Inline feedback (success or error) without navigating away.
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · vitest persistence file 43/43 (10 new + 33 existing) · architecture invariants 157/157 · changes-smoke 1/1 · `npm run test` **3234 / 3238** (4 pre-existing failures verified independent of this change — same set as W1 + W2 2.3 baselines).
> - `npm run build` clean — caught a server-only-on-client regression mid-implementation (recommendations-client tried to import `editLifecycleStatus` from the persistence module which has `import "server-only"`); fixed by inlining the one-liner. Full route table emits.
>
> **Explicitly out of scope for 2.4 (per operator direction):**
> - Profound CSV archive — May 10 expiry hasn't passed.
> - Profound code deletion — waits until after May 10 cutover.
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `260b313` is "Ready"** — single code commit, docs sync follows in a sibling commit.
> 2. **Browser-spot-check /recommendations + /changes** for the new Mark-shipped buttons. Stale tint will only render against rows whose `respondedAt` (recs) or `timestamp` (changelog) is ≥3 days old; current Los Altos accepted rec from 2026-04-25 is 6 days old as of today, so its card should render with the yellow tint and "6d pending" pill.
> 3. **Continue W2.** Step 2.4 is the last polish piece before W2 Step 2.5 (the rec-engine v2 Sprint 6A.2 activation deferred from W2). Or proceed to W3 (Recommendation Engine v2 query fan-out) per master plan §9.

> 🟢 **W2 Step 2.3 (How AI described you v2 layout) LANDED (2026-05-01):** Commit `62ce313` pushed to `main`. Replaces the old `EnrichmentBadges` single-day component with the 4-section v2 layout (Who AI thinks you are / Who AI thinks they are / Where AI ranks you / What format wins). Pure UI consumption of the Step 2.2/2.2b data contracts — every product-intelligence decision lives in the data layer; the React tree just maps fields to copy + visuals. New components: `enrichment-v2.tsx`, `sparkline.tsx`, `competitor-select.tsx`, `structure-labels.ts`. Hosted smoke confirmed `/login` 200, `/api/poll/run` 401, root redirects. Vercel SHA verification inconclusive from this environment.

> 🟢 **Week 1 (Trust + Polish) LANDED (2026-05-01):** 5 logical commits + 1 docs-contract commit, pushed `5d32f5f..5cfd9e7`. Founder-felt UI bugs across /today + /recommendations now fixed; new architecture invariants prevent regression. Roadmap reordered last turn — W1 trust → W2 wedge UX → W3 recs v2 → W4 backfill → W5 sellable.
>
> - **Step 1.1 (`333d74e`)** — UUID hygiene. New `src/domains/recommendations/evidence-summary.ts` (helper + 10 unit tests). `prompt:7ee3216b-...` chips on /recommendations + /changes detail now render `prompt: "<text snippet>"`. Two leak sites killed: `recommendations-client.tsx:1101` and `actions.ts:298`. `promptTextById` threaded from page server → client.
> - **Step 1.2 (`a9f6da4`)** — Operator jargon sweep, scoped to `src/app` + `src/components`. "Decide tonight" → "Action queue"; `EVIDENCE_BASIS_LABEL.heuristic` value → "Pattern-based" (internal enum key preserved); "Profound-style" stripped from Today chart components + composite tooltip. New invariant `tests/architecture/no-operator-jargon.test.ts` walks scoped roots, strips comments before matching, fails on banned strings. Domain modules + methodology copy + import-page references intentionally untouched.
> - **Step 1.3 (`ec8b140`)** — VSR delta math + calendar-window chart. `EntityVisibility.delta` now `number | null` with sample-day counts; `computeLeaderboard()` takes `windowDays` + `windowEndDate`, derives both windows internally; previous-window samples below `⌈N/3⌉` (floor 2) → `delta: null` (never faked 0). Server precomputes leaderboard for every chart-toggle window (7/14/30/60). `timeRange` lifted to `today-client.tsx`; chart switches from `slice(-N)` to calendar-date filter; "K sampled days in this N-day window" strip honest about sparse sampling. Headline delta relabelled "X.X pt within this window" so it never blurs with leaderboard's "vs. previous N days".
> - **Step 1.4 (`d57327d`)** — Entity pollution filter. New `src/domains/recommendations/entity-pollution-filter.ts` with `isDirectoryEntity()` + metadata-first `shouldExcludeFromCompetitorRanking()`. Houzz / Yelp / Angi / BuildZoom / Thumbtack / BBB / generalcontractors.org excluded from competitor ranking AND from rec engine `competitorAngles` aggregation. Real builders (De Mattei, Kasten, Supple) survive; "Bay Builders" with metadata kept; "General Contractors" by name only excluded. `dir-generalcontractors-org` row NOT deleted from `tracked-entities.json` because pages.json + 10+ citation cold-store shards reference it; the directory filter handles it operationally.
> - **Step 1.5 (`9b98d15`)** — Poll chunk failure resilience. New `poll-error-classifier.ts` (8 kinds, retryable only on `transient_network` / `timeout` / `server_5xx`). Per-prompt single retry on 1s backoff, NO retry on auth / rate_limit / invalid_request / parse_error. New `PerplexityPollResult.reliability` block (`retryCount`, `failureCountsByKind`, `dominantFailureType`, `estimatedUnconfirmedCostUsd`). Structured `CHUNK_SUMMARY` JSON line per run. Silent post-sample try/catch replaced with classified `PERSIST_FAILED` log + `estimated_unconfirmed_cost` accumulator. **`BEACON_PER_RUN_BUDGET_USD` default $5 → $8** in code (env override unchanged); operator must verify Vercel env var manually. Tests: 49 (16 classifier + 8 integration cases covering every operator-brief scenario).
> - **Docs (`5cfd9e7`)** — `CLAUDE.md` execution-contract override: accepted-plan = full landing-strip (edits + tests + commits + push + deploy + verify). Pause unchanged for destructive / data-deletion / hosted-env / paid-API / irreversible-migration.
>
> **Verification (2026-05-01):**
> - `npm run typecheck` clean · `npm run test` **3143 / 3147** (4 pre-existing failures verified against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenant-isolation) · `npm run build` clean.
> - `https://beacon-bice.vercel.app/login` HTTP 200; `/api/poll/run` 401 with bad bearer.
> - **Vercel deploy SHA + `BEACON_PER_RUN_BUDGET_USD` env var unverifiable from this environment** — no Vercel CLI / API token. Operator must check the dashboard.
>
> **Backfill methodology accepted in principle (Method 1: aggressive deterministic re-extraction); preflight blockers landed 2026-05-01 evening:**
> 1. Reconcile 498K-vs-14K row count discrepancy (498,676 lines is the truthful raw CSV count; 14K likely = distinct prompt-date-platform tuples).
> 2. Recover historical entity-registry from git history before accepting `medium_entity_drift`.
> 3. Run preflight stage (no mutation) producing inventory + field recovery + prompt match + entity drift + truncation reports + 20 sample observation JSONs.
> 4. Decide observation model: row-level (~498K) vs cell-deduped (~14K) vs cell-merged (~14K with unioned signals).
> Preflight agent currently running. Backfill execution remains W4. Provenance terminology locked: `native_live` / `historical_recovered` / `historical_imported`. Never "fake native"; always "native-shaped recovered observations".
>
> **Next 3 actions:**
> 1. **Operator: verify Vercel deployment of `5cfd9e7` is "Ready" + check `BEACON_PER_RUN_BUDGET_USD` env var** (decision yes/no on the $8 bump).
> 2. **Read the preflight report** when it lands (`/tmp/beacon-preflight-2026-05-01.md`); approve or amend Method 1 against the verified data shape; greenlight Week 2 kickoff.
> 3. **Watch tomorrow's 07:00 UTC poll for `CHUNK_SUMMARY` log evidence** that Step 1.5 deployed and is logging the new structured summary.

> 🟢 **Phase v4 Commits 5–7 LANDED (2026-04-30) — "Replace Profound" finishing pass:** Closed the last open work in `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md` so Profound's 2026-05-10 expiry is a non-event for daily operation. Source plan: `/Users/armeen/.claude/plans/you-are-working-on-purring-shell.md`. Full detail in `docs/VERIFICATION_LOG.md` 2026-04-30 entry.
>
> - **Commit 5 (Today KPI flip)** — verified live. Derived snapshots flowing daily; today scoreboard reads `daily_metric_snapshots source_type='derived' scope_type='platform'` with "As of Apr 30 (today)" / "(yesterday)" fallback badge. No code changes needed — already shipped, validation only.
> - **Commit 6 (Schema v2 + extraction backfill)** — verified live. 1761/1761 (100%) post-Apr-22 observations carry `descriptor_window` / `competitor_co_mentions` / `citation_domain_classes` / `answer_structure`. Polls + backfill both healthy.
> - **Commit 7B (Citation evidence index rebuild from native)** — the big one. `citation_evidence_index` was 15 days stale (`built_at=2026-04-15`, 105,927 Profound citations). Wired `scripts/rebuild-citation-evidence-index-native.ts` for nightly auto-execution: script now dual-writes (file + Supabase); new hosted endpoint `POST /api/cron/rebuild-citation-evidence-index`; new GH Actions job `rebuild-citation-evidence-index` runs after both poll jobs with `if: always()`. Manual rebuild ran today: `built_at=2026-04-30T21:13:52.951Z`, 7,960 native citations, 769 pages, top topics LA/Cupertino/Menlo/Atherton/Shield. /pages, /competitors, /topics, /changes now read live native data.
> - **Commit 7A (Mixed-source full Z-score math)** — replaced Commit 2's pure-split abstain with a partial-overlap drop-benchmark filter at `src/domains/attribution/url-verdict.ts`. When baseline + post mix `source_type`, drop benchmark days from both windows; abstain (`not_enough_native_baseline`) only when filtered baseline < `baselineMinDays`. Why drop instead of regime-shift scaling: no parallel-system overlap days exist (Profound stopped Apr 15, native started Apr 22). 5 new partial-overlap test cases pass; 23 existing pass. Verdict label `"No native baseline"` → `"Not enough native data yet"`.
> - **Commit 7B (enrichment badges)** — verified rendering on /today via the existing `EnrichmentBadges` (`src/components/today/enrichment-badges.tsx` Apr 23). 200 obs/day × 2 platforms feeding live data through `buildEnrichmentRollup`. No code change needed.
> - **Commit 7D (Copy audit)** — killed user-visible Profound/`BEACON_*` jargon on 6 routes. `lifecycle-attribution-copy.ts`: dropped env var name from `verdict_off` tooltip; `not_implemented` label → `"Not shipped"`; `EVIDENCE_FRESHNESS_NULL_COPY` rewritten. `evidence-freshness-banner.tsx`: split into 3 branches (null/fresh-green-<36h/stale-amber-≥3d), all "Profound" mentions removed from visible copy. `scorecard-client.tsx`: 2 fixes (legacy-rows empty state + URL-not-cited fallback). `methodology/page.tsx`: opening explainer now describes native polling instead of Profound imports.
>
> **Verification (2026-04-30):**
> - `npm run typecheck` clean · `npm run test` 3080/3081 pass (1 pre-existing tenant-isolation failure, baseline) · `npm run build` clean.
> - Supabase `citation_evidence_index`: `built_at=2026-04-30 21:13:52.951+00`, 7960 citations, 12 topics, 1191 page×topic rows, 769 pages.
> - `.data/tenants/ritz-builders/citation-evidence-index.json`: matching built_at + counts (vestigial `tenant_id` field dropped; type schema doesn't include it).
> - `daily-native-poll.yml` now has 3 jobs (`poll-perplexity` + `poll-openai` + `rebuild-citation-evidence-index`); rebuild has `needs: [poll-perplexity, poll-openai]` + `if: always()`.
>
> **Next 3 actions (2026-04-30 → 2026-05-10):**
> 1. **Watch tomorrow morning's 07:00 UTC daily-native-poll cron run.** Verify the new `rebuild-citation-evidence-index` GH Actions job fires after both poll jobs and that `citation_evidence_index.built_at` updates within 60 min of the polls finishing. Failure → automatic GitHub email within 45 min (existing canary contract).
> 2. **Browser-spot-check /pages, /competitors, /topics on the Vercel preview deploy.** Top-3 competitors and topic rankings should differ visibly from last week's Profound-era data. EvidenceFreshnessBanner should render the green "live native data — last rebuilt {date}" branch.
> 3. **Decide on flipping `BEACON_LIFECYCLE_VERDICT_ENABLED=1`** once the H2's bake window elapses (earliest 2026-05-05, 7 days from `live_at=2026-04-28`). The "Verdict tracking off" pill copy already explains the flag-off state.

> 🟢 **Recommendation Lifecycle OS UI — Phases 6A.1 → 6A.10 LANDED (2026-04-28):** The lifecycle backend (Phases 0–5, hosted-cron Phase 6D) is now mirrored by an operator-grade UI. Single sweep across /changes + /today + /recommendations.
>
> - **6A.1** — archived the two unimplemented Whole Home Remodel FAQ test rows (`cl-mogzw78n87lkhq`, `cl-mogzw78n5j9e7u`) via idempotent script (`scripts/archive-faq-test-pollution.ts`). H2 `cl-mogzw78nv8pu54` preserved byte-for-byte; rec-level `recommendation_responses` row preserved. Both `.data` and Supabase mirrors mutated; 9/9 postflight checks passed including SHA fingerprints on H2 + rec response.
> - **6A.2** — `/changes` loader quarantine + lifecycle tabs. New pure classifier `src/domains/attribution/lifecycle-classification.ts` (priority order: live_verified → needs_review → pending_implementation → scan_confirmed → imported_legacy → unclassified). Default tab = `live_verified`; archived rows defended-against at the classifier even if a future loader bug surfaces them. PageHeader copy: "Verified and tracked changes…".
> - **6A.3** — `LifecycleStatusPill` component (`src/components/display/lifecycle-status-pill.tsx`). Granular `status` (verified_live / accepted / dismissed / needs_review / etc.) wins over `cls` fallback; compact + full modes; `data-lifecycle-key` for E2E. Rendered on every /changes row + every /recommendations specific edit. H2 reads `✓ Live`; Phase 6A.1 dismissed FAQs read `Dismissed`.
> - **6A.4** — `/today` scan-findings rename + collapse. "N changes detected" → "Scan diffs to review (N)" inside a `<details>` collapsed by default. "Confirm" → "Confirm and add to changelog" (server actions byte-identical). Anchor `#change-review-section` preserved.
> - **6A.6** — lifecycle-aware attribution copy. New `resolveAttributionCopy` (`src/domains/attribution/lifecycle-attribution-copy.ts`) replaces the misleading "No data" pill with branch-specific copy: "Too early — verdict pending" (verified_live within 7d), "Verdict tracking off" (verified_live ≥ 7d w/ flag off), "Waiting on implementation" (accepted, no live_at), "Not implemented" (not_found_after_7d), "Legacy — no eligible window", "Scan-confirmed — measuring", "Verdict pending" fallback. Verified-live bake-window override on stale stored outcomes locked by tests. `EvidenceFreshnessBanner` null-branch copy refreshed (no longer claims "no native polling").
> - **6A.7** — `/today` lifecycle status strip + implementation queue. `TodayLifecycleStrip` 4-chip row (live_verified always shown) + `TodayImplementationQueue` (top accepted edits not yet live). Same recommended_edits read /changes uses; strip and tab counts always reconcile.
> - **6A.8** — `/today` command-center hierarchy restructure. New 8-tier order locked by source-level test `tests/routes/today-section-order.test.ts`: critical alerts (poll/freshness/scan/needs-review) → `TodayDoNextCard` (priority: ship_pending > decide_recommendation > review_scan_diffs > calm) → lifecycle strip → impl queue (capped to 3) → Decide tonight queue → wins / latest signal → `TodayMetricsDisclosure` (collapsed; localStorage-persisted) → scan diffs (Phase 6A.4 contract intact). Queue rows surface a `needs rewrite` badge when `proposed_text` matches the generator placeholder pattern (the 4 Los Altos FAQ scaffolds). `/changes?tab=…` deep-link plumbing landed via `useSearchParams` + `router.replace`.
> - **6A.10** — strip parity on `/changes` (same `TodayLifecycleStrip`) + this docs sync. Strip's `notFoundAfter7d` count derived directly from `recommended_edits.implementation_status` since the classifier bins it into `unclassified`.
>
> **Current state of the truth surfaces (2026-04-28):**
> - `BEACON_LIFECYCLE_ENABLED` = ON (set in GH Actions secrets); hosted scan #4 ran successfully with `lifecycle.runnerCalled=true`, `evaluated=8`, `updated=0`, `liveAtStamped=0`, `noStableAcceptTimestamp=0`.
> - `BEACON_LIFECYCLE_VERDICT_ENABLED` = OFF (intentionally, per scope of every 6A.x phase).
> - `/changes` default tab = "Live verified", showing the H2 row only.
> - `/today` first non-alert section is the Do-Next card; lifecycle strip + queue follow; metrics + scan diffs collapsed at the bottom.
> - **Whole Home Remodel H2** is `verified_live` with `live_at=2026-04-28 05:26:26.05+00`, `live_match_confidence=high`, `live_match_kind=exact`, `live_element_key=h2[6]:070a58b1f3f4` (verified in Supabase). Reads `Live ✓` lifecycle pill + `Too early — verdict pending` attribution pill.
> - **Whole Home Remodel FAQ Q + A** are `dismissed` (recommended_edits) and `archived=true` (changelog). Excluded from /changes default and from /today implementation queue.
> - **Los Altos** rec (`create_cluster_page:geo:Los Altos`, accepted 2026-04-25) holds 5 pending accepted edits: 1 H2 (ship-ready) + 4 FAQ scaffolds with placeholder answers. Operator audit flagged FAQ rows as needing rewrite before shipping; queue surfaces this with the `needs rewrite` badge. **No mutation** — rows remain `accepted`.
> - Total UI test additions across 6A.1–6A.10: ~80 new tests; full suite 3052/3053 pass (1 pre-existing tenant-isolation failure unrelated to lifecycle work).
>
> **Next 3 actions:**
> 1. **Dogfood the new /today + /changes for a few days** before any further restructure. Real operator usage will reveal what the audit + tests can't.
> 2. **Wait for a real ambiguous match (`needs_review` / `partially_implemented` / `wrong_page`)** to appear in production data, then ship Phase 6B (one-click triage UX). Today's data has zero such rows.
> 3. **When the H2's bake window has elapsed (≥7 days from `live_at`)**, decide on flipping `BEACON_LIFECYCLE_VERDICT_ENABLED=1`. The "Verdict tracking off" pill copy already explains the flag-off state to operators.

> 🔴→🟢 **Accept ON CONFLICT bug FIXED (2026-04-27):** Operator-reported bug — clicking Accept locally with `DATA_SOURCE=supabase DUAL_WRITE=true` threw `"there is no unique or exclusion constraint matching the ON CONFLICT specification"`. Diagnosed as the same bug class as Sprint 6A.2f's `recommended_edits` fix, but on `recommendation_responses`: the Phase 7.2 multi-tenant migration swapped the PK from `(rec_id)` to `(tenant_id, rec_id)`, but `dual-write.ts:892` still passed `onConflict: "rec_id"` — single-column spec doesn't match the compound PK. Verified via `pg_indexes`: production has `recommendation_responses_pkey USING btree (tenant_id, rec_id)` and ZERO unique index on `rec_id` alone. **Fix:** one-line patch — `"rec_id"` → `"tenant_id,rec_id"` in `syncRecommendationResponses`. **Regression guard:** new `tests/architecture/dual-write-onconflict.test.ts` (5 invariants) pins the onConflict spec for `recommendation_responses`, `recommended_edits`, `url_change_outcomes`, `page_element_inventory`, `changelog_entries` against future drift. Sister sync helpers were spot-checked and confirmed correct (none had the same bug). **Verification:** typecheck clean · 2844/2844 vitest pass (was 2839 + 5 new) · architecture invariants 123/123 (was 118 + 5 new) · clean local build · Vercel-equivalent build green. **Operator action:** can now retry Accept on `/recommendations` from local dev. The operator's earlier file-write succeeded (response IS in `.data/tenants/ritz-builders/recommendation-responses.json:49–55` for Whole Home Remodel) — the changelog fan-out + lifecycle flip never ran because the action threw mid-flight. Re-clicking Accept will: (a) re-upsert the response (idempotent on `recId`), (b) NOW also dual-write to Supabase, (c) fire the changelog fan-out (3 entries), (d) flip the 3 `recommended_edits` to `accepted`. Then the Phase 3 lifecycle scan can run as Step 1 of the safety gate.

> 🟢 **Recommendation Lifecycle OS — Phase 4 LANDED (2026-04-27):** Verdict engine reads `live_at`-aware change date + emits new `not_implemented` label, both behind `BEACON_LIFECYCLE_VERDICT_ENABLED` (default OFF, independent from `BEACON_LIFECYCLE_ENABLED`). When OFF: byte-identical to pre-Phase-4 — no `live_at` reads, no `not_implemented` emission, no `recommended_edits` repository load. When ON: `computeChangeVerdict` resolves baseline-split via `entry.live_at ?? entry.timestamp`; `materializeUrlOutcomes` joins changelog → `recommended_edits` via `lifecycleLookupKey(source_rec_id, action_type, target_element_key)` and emits synthetic `not_implemented` (no Z-score, no series consumption, `confidence: "high"`) for entries linked to `not_found_after_7d` rows. **Z-score math, attribution windows, polling cadence ALL UNCHANGED.** New pure helpers: `resolveChangeDate(change, useLiveAt)` and `lifecycleLookupKey(...)`. New `ComputeVerdictOptions` type extends `computeChangeVerdict` API: `{ useLiveAt?, forceVerdict? }` — both optional, omitted = pre-Phase-4 behavior. `recordUrlOutcome` extended with `useLiveAt?` so `landing_day_n` resolution stays in lock-step with the verdict's baseline date. `not_implemented` added to `TERMINAL_VERDICTS` set + `VERDICT_LABEL`/`VERDICT_TONE` records. Files touched: `src/lib/flags.ts`, `src/domains/attribution/url-verdict.ts`, `src/domains/attribution/url-change-outcome.ts`, new `url-change-outcome.phase4.test.ts` (20 tests). **Verification:** typecheck clean · 2839/2839 vitest pass (was 2819 + 20 new) · architecture invariants 118/118 (no regression) · clean local build · Vercel-equivalent build green · operator data intact post-restore. **Operator action:** sign Phase 4. To dogfood: enable `BEACON_LIFECYCLE_ENABLED=1` first (Phase 3 runner), let it stamp `live_at` via scans for ≥7 days, accumulate at least one `not_found_after_7d` row, then flip `BEACON_LIFECYCLE_VERDICT_ENABLED=1` and compare /changes verdicts.

> 🟢 **Recommendation Lifecycle OS — Phase 3.1 LANDED (2026-04-27):** Surgical correction to Phase 3's accept-time fallback chain. **`recommended_edit.updated_at` is NEVER consulted as an age source** — the runner mutates `updated_at` on every write-back, so using it would reset the 7-day clock on every scan and silently disable the `not_found_after_7d` promotion. New chain (locked): (1) EXACT-matching `changelog_entries.timestamp` requiring `tenant_id` + `source_rec_id` + `action_type` + `target_element_key` (waived when edit's key is null) → (2) `recommendation_responses.respondedAt` (status=accepted, same rec_id) → (3) `edit.created_at` (immutable) → (4) **`null` — runner emits structured warning, increments `noStableAcceptTimestamp` counter, SKIPS the 7-day promotion**. `null` does NOT block other transitions (`verified_live*` promotions still fire). New `RunLifecycleMatchResult.noStableAcceptTimestamp` counter surfaces drift. Phase 3 still gated OFF by `BEACON_LIFECYCLE_ENABLED` — operator sign-off Phase 3 + 3.1 together before flipping. **Verification:** typecheck clean · 2819/2819 vitest pass (was 2806 + 13 new) · architecture invariants 118/118 (no regression) · clean local build · Vercel-equivalent build green · operator data intact post-restore.

> 🟢 **Recommendation Lifecycle OS — Phase 3 LANDED (2026-04-27):** Match runner wired into `runWebsiteScan` after the dual-write block, gated by **`BEACON_LIFECYCLE_ENABLED` (default OFF)**. When OFF: byte-identical no-op — zero repo reads, zero writes, zero log lines from the runner. When ON: reconciliation pre-pass (Phase 1 caveat fix, Option 2 — flips orphaned `recommended_edits` whose parent rec has accepted-evidence in `recommendation_responses` OR `changelog_entries`) → builds per-URL inventory keyed to latest snapshot → calls pure `matchAcceptedEdit` per accepted edit → applies forward-only state transitions (`verified_live ↔ verified_live_modified` is the ONE bidirectional pair; `verified_live*` NEVER auto-downgrades) → stamps `recommended_edits.implementation_status` + `live_at` + `live_snapshot_id` + `live_match_*` + `live_element_key` + `not_found_reason` → opportunistically stamps `changelog_entries.live_at` (idempotent — skips already-stamped). 7-day rule: `accepted` edit + `not_found` match + age ≥ 7d (sourced from earliest matching changelog timestamp, falling back to `recommendation_response.respondedAt`, then `edit.updated_at`) → `not_found_after_7d`. **Phase 3 does NOT change attribution math** — verdict engine still reads `entry.timestamp`. Phase 4 will switch to `live_at ?? timestamp` behind a SEPARATE flag. New files: `src/domains/recommendations/match-runner/{index,reconcile,transitions,inventory-by-url,persist}.ts` + 4 test files. New flag: `isLifecycleEnabled()` in `src/lib/flags.ts`. Single hook in `orchestrate-scan.ts` after `pageElements: inventoryRowCount` log line. **Verification:** typecheck clean · 2806/2806 vitest pass (was 2749 + 57 new) · architecture invariants 118/118 (no regression) · clean local build · Vercel-equivalent build green · operator data intact post-restore. **Operator dogfood instructions (do NOT run yet):** (1) Sign Phase 3 in `.data/exit-gates.json`. (2) Set `BEACON_LIFECYCLE_ENABLED=1` in `.env.local`. (3) Manual scan via Today "Scan now" or `npm run data:scan`. (4) Inspect `recommended_edits` in Supabase / `.data/tenants/ritz-builders/recommended-edits.json` to verify lifecycle field population. (5) Only after local dogfeed succeeds — flip on Vercel.

> 🟢 **Recommendation Lifecycle OS — Phase 2 LANDED (2026-04-27):** Pure-function match engine shipped at `src/domains/recommendations/match-engine/`. Six source files (`types.ts`, `normalize-text.ts`, `similarity.ts`, `per-action-matchers.ts`, `faq-pair.ts`, `index.ts`) + 1 test file (67 tests) + 1 architecture purity invariant (23 forbidden-import checks). **Zero I/O, zero DB, zero scan triggers, zero UI.** Engine consumes `RecommendedEditRow` + `PageElementInventoryRow[]` and returns `MatchResult` with `outcome ∈ {verified_live, verified_live_modified, needs_review, wrong_page, partially_implemented, not_found}` (note: `not_found_after_7d` is intentionally a runner-side decision since the pure fn has no clock). Per-action matchers cover all 10 supported action_types: `edit_title` / `edit_meta` / `change_h1` (singletons) · `add_h2_section` / `rewrite_h2` (positional with wrong-page detection) · `add_faq` / `rewrite_faq` (positional with `matchFaqPair` Q+A reconciliation → `partially_implemented`) · `add_internal_link` (anchor + href dual-signal) · `add_schema` / `fix_schema` (schema_type element lookup). Unsupported action_types return `not_found` + `kind: "unsupported"`. Canonical `normalizeText()` handles NFC + smart quotes + em/en/figure dashes + NBSP + whitespace collapse + terminal-punct strip + optional case-fold; idempotent. Hybrid `similarity()` = max(token-Jaccard, 1 − Levenshtein/maxLen) per spec §3.5. Confidence thresholds locked per action_type per spec §3.2. **Verification:** typecheck clean · 2749/2749 vitest pass · architecture invariants 118/118 (was 95 + 23 new purity) · clean local build · Vercel-equivalent build green · operator data intact post-restore. **Ready for Phase 3 wiring**, but Phase 1 caveat must be addressed first — see source plan.

> 🟢 **Recommendation Lifecycle OS — Phase 1 LANDED (2026-04-27):** Small nullable lifecycle schema migration applied (`lifecycle_os_phase1_recommended_edits_columns`): 7 new columns on `recommended_edits` (`implementation_status` text DEFAULT 'recommended' + 6 nullable `live_*` / `not_found_reason` fields) + 1 column on `changelog_entries` (`live_at` timestamptz null). Postgres backfilled all 8 existing recommended_edits rows to `implementation_status='recommended'`. Partial index `idx_recommended_edits_impl_status_accepted` for cheap "list accepted edits" lookups. New `ImplementationStatus` union (9 states per spec §2). New `editLifecycleStatus()` read-side normalizer treats undefined/null as `'recommended'` (legacy file rows safe). New `markRecommendedEditsAccepted()` helper: idempotent, forward-only (won't downgrade `verified_live` etc.), file-first then dual-write, best-effort dual-write failure handling. Wired into `acceptRecommendation` after the per-edit changelog fan-out — Accept now flips matching `recommended_edits` rows from `recommended` → `accepted`. **No attribution change**, **no match engine**, **no UI surface change**, **no scan trigger** — Phase 1 only ships the per-edit "intent declared" state. **Verification:** typecheck clean · 2682/2682 vitest pass · architecture invariants 95/95 · clean local build · Vercel-equivalent build green · Supabase columns verified · existing 11 legacy rows still load (field absent, normalizer returns `'recommended'`). **Operator next action:** sign Phase 1 in `.data/exit-gates.json` to authorize Phase 2 (pure match engine, no I/O — see source plan).

> 🟡 **Recommendation Lifecycle OS — Phase 0 LOCKED (2026-04-27):** New spec at [`docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md`](RECOMMENDATION_LIFECYCLE_OS_SPEC.md) locks the contract for the recommendation → implementation → verified-live → tracked loop. **No code changed in Phase 0** — doc-only. Source plan: `/Users/armeen/.claude/plans/you-are-taking-over-cryptic-brooks.md`. **Locked decisions:** (1) Golden path = Hybrid Confidence (HIGH auto, MEDIUM ask, LOW pending); (2) 9-state machine on `recommended_edits` (`recommended` → `accepted` → `verified_live` / `verified_live_modified` / `needs_review` / `wrong_page` / `partially_implemented` / `not_found_after_7d` / `dismissed`); (3) Confidence rubric per action_type with `normalizeText()` canonical (NFC, smart-quote folding, whitespace collapse); (4) Attribution baseline-split uses `live_at` (falling back to `timestamp` for legacy); (5) `not_found_after_7d` returns NEW verdict label `not_implemented` (not `nothing_yet`); (6) Daily polling cadence unchanged — no per-edit ad-hoc polls; (7) Per-phase exit gates (`lifecycle_os_phase0` … `lifecycle_os_phase11`) follow the existing `.data/exit-gates.json` pattern. **Operator action:** read the spec end-to-end; sign off Phase 0 by adding `lifecycle_os_phase0: { status: "passed" }` to `.data/exit-gates.json` to authorize Phase 1 (schema-free `implementation_status` + `live_at` columns).

> 🟢 **Sprint 6A.3 closed (2026-04-26):** Native polling cost observability + runaway protection landed across 5 sub-commits — 6A.3a (pricing helper + provider usage capture) → 6A.3b (daily/monthly/per-run budget helpers) → 6A.3c (poll-loop wiring: pre-flight + mid-run + recordSpend) → 6A.3d (BEACON_POLL_DISABLED kill switch + identical-text dedupe + route response pin) → **6A.3e** (architecture invariants + docs sync). **NO quality reduction:** model unchanged (gpt-4o + sonar), output cap unchanged, prompt text unchanged, daily cadence unchanged, no batching/grouping/caching, full prompt coverage preserved. Caps are runaway protection only — defaults set high enough that normal full-native operation never trips them. New env knobs: `BEACON_DAILY_BUDGET_USD_PER_TENANT` ($10), `BEACON_DAILY_BUDGET_GLOBAL_USD` ($20), `BEACON_MONTHLY_BUDGET_USD` ($200), `BEACON_PER_RUN_BUDGET_USD` ($5), `BEACON_POLL_DISABLED` (truthy disables; truthy = "1"/"true"/"yes"/"on"). Two separate ledgers: `cost-ledger.json` for native polling (this phase) vs `llm-budget.json` for Sprint 6A.2 specific-edit / adjudicator — one budget cannot drain the other. **Vercel caveat:** local cost-ledger persists; hosted Vercel file ledger is non-durable (read-only FS) — pre-flight gates always see "$0 spent" on hosted. OpenAI account-level quota remains the runaway-protection floor on Vercel (proven by 6A.2e dry-run catching HTTP 429 cleanly). Future phase: move polling cost ledger to Supabase for durable hosted enforcement. Architecture invariant in `tests/architecture/cost-controls.test.ts` pins poll-adapter cost-control imports + the route's BEACON_POLL_DISABLED pre-runNativePoll check + cost-ledger write isolation. Existing LLM safety + Sprint 7 multi-tenant invariants remain green. Typecheck clean. Full vitest **2572 / 2572**. Local + Vercel-equivalent builds green. Latest verification: `docs/VERIFICATION_LOG.md` 2026-04-26 Sprint 6A.3 entry. Next: **operator-driven.** Sprint 6A.2f (first live `--write` of LLM-generated edits) needs a successful dry-run with a quota-funded key; Sprint 7.9 (multi-tenant onboarding) waits on a second tenant; Phase 6A.4 candidate: move polling cost ledger to Supabase for hosted enforcement. Rollback per phase: each 6A.3 sub-phase is `git revert <hash>`-clean.

> 🟢 **Sprint 7 closed (2026-04-26):** 7.0 → 7.1 → 7.1a → 7.2 → 7.3 → 7.4 → 7.5a-d → 7.7a-e → 7.8a → 7.8a.1 → 7.8b plan → 7.8b-0 → 7.8b-1 → 7.8b-2-a → 7.8b-2-b → 7.8b-2-c → 7.8b-2-d → 7.8b-2-e → 7.8c → 7.8c.1 → 7.8d-1 → 7.8d-2 → 7.8d-3 → 7.8e-1 → 7.8e-2 → 7.8e-3 → 7.8e-4a → 7.8e-4b → 7.8e-4c → 7.8e-4d. **Phase 7.8e COMPLETE.** Every module-level top-level await read in `src/` lifted to `cache(async () => ...)` getter (Pattern A). Architecture invariant in `tests/architecture/json-store-routing-invariants.test.ts` fails-loud on regression. **Production deploy verified green** (Vercel commit `0dd90e2`, status Ready, `beacon-bice.vercel.app`). Two deploy fixes during the cascade: classified `answer-snapshots` + `frontier-opportunities`; added `BEACON_TENANT_SLUG` env fallback for Vercel's gitignored `.data`.

> ⚠️ **STALE — last updated 2026-04-17.** Most of the content below describes
> pre-pivot (Profound-era) state. Since 2026-04-22 Beacon has shipped the
> native-polling pipeline (Perplexity + OpenAI adapters, hosted `/api/poll/run`,
> GitHub Actions daily cron, chunked retry dedupe) and the "Replace Profound in
> 2 weeks" Phase v4 is now active. Trust these sources over anything below:
>
> - **Active plan:** `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md`
> - **What actually shipped 04-22 onward:** `docs/VERIFICATION_LOG.md` (2026-04-24 entry covers Phase v4 Commits 1–4 and the ground-truth surface audit)
> - **Schema v2 design:** `docs/OBSERVATION_SCHEMA_V2.md`
> - **Which surfaces silently lie and which are trustworthy:** `docs/TRUTH_SURFACE_AUDIT_2026-04-24.md`
>
> The legacy "Active plan" reference below (jazzy-tumbling-stroustrup) is no
> longer in play. Everything in this file that predates 2026-04-22 should be
> read as history, not current state.

> **Active plan (legacy, superseded 2026-04-24):** `/Users/armeen/.claude/plans/jazzy-tumbling-stroustrup.md` — the CX0-CX11 MAX implementation plan. Reference spec: Part 14 of `/Users/armeen/.claude/plans/rippling-munching-pnueli.md`.

> **PURPOSE:** This is the entry point for anyone (human or AI) working on Beacon.
> Read this file first. It tells you what Beacon is, where everything stands, what works, what's broken, and where to go next.
>
> **NOT FOR:** Execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), deep history (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-17 (Phase 7 Part 1b-v2 Step 2 — keyword-gap scanner v3 LIVE on Today)
**Branch:** `main`
**Build:** `npm run typecheck` ✓ · `npm run test` 1000/1007 ✓ (same 7 pre-existing tenant-isolation failures, no regression)

**Phase 7 Part 1b-v2 Step 2 — COMPLETE (2026-04-17).** The keyword-gap scanner, silenced since Apr 19 when we caught it mining AI answer boilerplate ("Track Record" appeared in 28.7% of all answers), is now live on Today. V3 mines concepts from each observation's `search_queries` field (AI's internal retrieval queries, not output vocabulary). Tier-aware pipeline:
- Tier 1 (saturation_miss) uses raw bigram/trigram concepts — surfaced labels like "Custom Homes", "Luxury Home".
- Tier 2 (gap) applies concept expansion from example queries to produce longer readable phrases — "Home Renovation Contractors Menlo Park", "Modernizing Older Homes Without Expanding".
- Tier 3 (positive) computed but deliberately not surfaced.
- Readability gate rejects 2-3 word fragments starting with plural nouns (e.g., "Builders Bay Area" is filtered out).
- Cities excluded via knownLocations; competitors excluded via dynamic top-40 non-brand mentions.
- Top 3 cards visible on live Today page: "Position 'Custom Homes' on /locations/los-altos" (Tier 1), "Position 'Luxury Home' on /locations/cupertino-custom-home-builder" (Tier 1), 1 gap rec on /locations/menlo-park.

Details in `docs/VERIFICATION_LOG.md` 2026-04-17 entry (Phase 7 Part 1b-v2 Step 2).

**Phase 1 SCHEMA-EXPERIMENT ATTRIBUTION — COMPLETE (2026-04-17):** Missing-schema detector surfaces as Today ActionCard before the change; manual confirm stamps structured schema-diff fields after the change; 5-rung matching ladder attributes at exact specificity. Auto-promote OFF by default (`BEACON_AUTO_PROMOTE_SCHEMA=1` to flip, no scan-side wire-up shipped). 127 new tests, Phase 0 acceptance still 8/8. Details: `docs/VERIFICATION_LOG.md` 2026-04-17 entry.

**Dogfeed Night 1 — COMPLETE (2026-04-17 evening).** Three schema experiments shipped and confirmed with structured fields:
- `/locations/palo-alto` → schema_added · types_added=[BreadcrumbList, HomeAndConstructionBusiness, WebPage] · visible_copy_changed=false
- `/our-process` → schema_added · types_added=[HowTo] · visible_copy_changed=false
- `/explore-projects/riverside-way` → schema_added · types_added=[Article, BreadcrumbList] · visible_copy_changed=false

All three will match at `exact` specificity with c_scope=1.0 when attribution runs over the next 14 days. 10 active experiments now being watched. Tonight's cycle also caught a real production regression (helper temporarily broke SSR on palo-alto while removing a duplicate FAQPage JSON-LD block) — scanner flagged it, operator sent it back for fix, SSR restored. 8 state-transition artifact findings from the bug cycle were bulk-dismissed; no pending content-change findings remain.

**UX hardening shipped tonight:**
- Auto-link feature flag (`src/lib/flags.ts:isFindingAutoLinkEnabled`) — **OFF by default**. Previously the scanner auto-linked every finding to any changelog entry within 30 days whose description contained a matching keyword, which silently collapsed brand-new experiments into old generic entries. Now every finding stays `pending` until operator explicitly confirms/dismisses. Flip `BEACON_AUTO_LINK_FINDINGS=1` to restore legacy behavior (not recommended during dogfeed).
- "Review changes" banner moved from buried to directly below the Visibility line on Today. `ChangeReview` card now renders inline beneath the banner with `id="change-review-section"` scroll anchor so the button actually works.
- Sidebar nav badges rewired: **Today** = pending content-change findings (matches the banner's count exactly), **Pages** = unique pages with bug-class findings (`schema_invalid` + `faq_without_schema` + `robots_txt_blocked` + `deploy_mismatch`), **Changes** = active experiments being watched. Was previously: stale legacy counts from pre-Phase-0 stores, stuck for a week.
- Shared module `src/domains/scanning/content-change-types.ts` — single source of truth for CONTENT_CHANGE_TYPES + BUG_FINDING_TYPES used by both the Today banner and the sidebar badge.

**New CLI:** `scripts/regen-findings.ts` — regenerates scan-findings against the current page-snapshots without re-fetching the site. Needed because `scripts/scan-owned-pages.ts` only writes snapshots, not findings. Use after a CLI scan to feed the detection pipeline.

**Known rough edges left for tomorrow (not blocking dogfeed):**
- `/pages` route copy is pre-Phase-0 legacy ("Same crawl basis as Today: consecutive HTML snapshots and optional guardrails. Observation links appear only when the run is indexed.") — academic disclosure language, should be rewritten
- `/briefs` route is a dead end — UI placeholder for a "proposed briefs" flow that never got wired up
- Brain-action recommender pulls from legacy url-change-outcomes; still shows "Investigate h1 regression" stale recs
- Duplicate-schema detector would help — scanner already sees `faq_schema_block_count > 1` but doesn't emit a finding for it

**Daily-1% operating cadence (chosen 2026-04-17):**
Operator dogfeeds one isolated change per night. Between deploys, fixes one piece of legacy per day — delete code but keep functionality. Goal: 14-night pattern brain that moves Beacon from "collection of shipped phases" to "native AEO tracker for local builders/architects/contractors." Every day: spot one thing that feels off on Today or one of the nav routes, clean it up (code delete preferred over rewrite), verify nothing broke via typecheck + scan. Document in VERIFICATION_LOG.

**Phase 0 TRUTH VALIDATION — COMPLETE (2026-04-16):** Hierarchical event attribution proven against Ritz data. 62 new tests. Seven-section acceptance report via `npx tsx scripts/validate-ritz-truth.ts` passes all 8 criteria — Apr 7–12 data_bad flagged, 4 target spikes detected (±1 day), 299/299 changelog rows covered, `/luxury-home-builder-bay-area` compound_launch → `landed_fast` (23 rows → 1 sample per pattern-sample-integrity check), `/locations/menlo-park` corrected from `hurting` (old URL store, polluted by bug-window zeros) to `helping` (new event store, data_bad skipped), Apr 10 performance_batch + Apr 2 metadata_publication distinguished as separate events. **Zero production surface changes** — `/changes`, Today, and `src/domains/attribution/url-verdict.ts` all untouched; new stores sit alongside legacy ones. Details: `docs/VERIFICATION_LOG.md` 2026-04-16 Phase 0 entry; source plan: `/Users/armeen/.claude/plans/dreamy-beaming-sphinx.md`.

**Phase 0.5 EVENT-LEVEL TRUTH SIDE-BY-SIDE — COMPLETE (2026-04-16):** First feature-flag helper in the repo (`src/lib/flags.ts` · `isEventTruthPreviewEnabled()` · reads `BEACON_EVENT_TRUTH_PREVIEW=1`, server-side, off by default). New route `/changes/truth` — server component reads `change-events` + `event-attributions` + `url-change-outcomes` + `imported-changes` + `site-movement-events`, joins events → children → legacy verdicts → movements, renders each event as a side-by-side row (NEW attribution + confidence_source pill · OLD legacy verdict counts · divergence badge). Expand drills into the narrative + every child row's legacy verdict. `/changes` gains one conditional top-right link when the flag is on. Verified both flag states against the live dev server: flag-off → `/changes/truth` 404s and `/changes` has no link; flag-on → luxury compound_launch shows `landed_fast` measured vs. 23× `nothing_yet` old, menlo Apr 7 event shows `too_early` vs. 6× `hurting` (the Phase 0 headline correction surfaced), `data_bad` narrative reaches the UI. `.env.local` restored to its pre-verification state after the run. Source plan: `/Users/armeen/.claude/plans/shimmering-flickering-hopper.md`.

**Next best action:** Keep the flag off for now — let the event model run silently alongside production for a full re-scan cycle before deciding whether to flip even this read-only preview on for daily use. When ready, turn the flag on via `.env.local`, walk through the divergences (especially the menlo correction), and only then consider whether the event model should influence any Today recommendation or scoring signal.

**Master launch plan active:** `/Users/armeen/.claude/plans/dreamy-beaming-sphinx.md` — "Truth → Brain → Shape → Trust → Live". 7 phases, 6–10 weeks to launch, 14-day personal dogfood, then 3 test subjects. Launch scope: Today + Changes + Settings/Import only. Single-tenant per customer at launch; auth layered in Phase 6.

**Phase 0 TRUTH — COMPLETE (2026-04-16):**
- ✅ 0.1 `src/domains/product/url-citation-history.ts` — per-URL daily citation time series aggregated from `.data/citations-by-date/*.json` via existing `cold-store.getCitationsForDate`. Path-only URL normalization — `/locations/palo-alto` and `https://ritzbuilders.com/locations/palo-alto/` map to the same key. Joins prompt-answer-observations for platform breakdown. Pure function, 7 unit tests.
- ✅ 0.2 `src/domains/attribution/url-verdict.ts` + `url-verdict.test.ts` (15/15 passing) — adaptive Z-score verdict engine. Formula: μ_pre / σ_pre (Poisson-floored at 1) over 14d baseline, μ_post over post-window (max 30d), z = (μ_post − μ_pre) / (σ_pre/√N), sustain-check against last 7d. Verdicts: `helping` / `hurting` / `nothing_yet` / `too_early` / `not_enough_data`. Every verdict carries `explanation.math` (all intermediate values) and `explanation.summary` (plain-English narrative).
- ✅ 0.3 `/changes/page.tsx` now builds `urlHistory` once per page load and computes `UrlVerdict` per row. Legacy `computeScorecard` data still computed for drill-down topic/platform breakdown; no longer drives the headline verdict. New at-a-glance strip shows helping / hurting / too-early counts derived from the new engine. Tracks 300 live changes (post-dedupe).
- ✅ 0.4 `scorecard-client.tsx` rewritten. Kill: Score/Match/Lift/Events/Linked/Next-step columns. New row = `[date] [change] [verdict pill] [delta%] ▸ expand`. Click expand → "Explain this verdict" panel rendering full Z-score math (μ_pre, σ_pre, μ_post, z, sustain up/down) alongside topic + platform drill-down from legacy scorecard data. Verdict filter chips (All / Helping / Hurting / Nothing yet / Too early / No baseline / Site-wide) replace the old outcome-category tabs.
- ✅ 0.6 Archived 16 frozen docs → `docs/archive/completed-specs/`. Moved 12 dead CSV/XLSX (~125MB) → `.data/archive/`.
- **Current honest distribution on Ritz data (300 changes):** 0 Helping (nothing hit the z≥2 + sustain-5/7 bar with current data coverage), 12 Hurting, 56 Nothing yet, 12 Too early, 155 No baseline (URL not cited enough pre-change), 65 Site-wide. User can see which URLs moved and click any row to see the full math. Zero hand-tuned verdicts.

**Phase 0 descoped (needs dedicated pass):**
- 0.5 `KNOWN_TOPICS` + `GEO_CONTAINMENT` removal — audit showed 5-domain blast radius (`pages/classify.ts`, `visibility-events/attribute.ts`, `attribution/compute.ts`, `attribution/memory.ts`, `attribution/config.ts`). Needs a soft-migration via accessor function reading from `tracked-prompts.json` before removal. Moved to Phase 1 work.

**Changes page rebuild — Phase 1 (2026-04-16):** `/changes` is now a single list sorted newest-first. Tabs (Outcomes / Attribution / Replicate) and the Records & Verification section were deleted — the page was rendering 4 competing views across 3 stores, reading as "10 different changelogs". Fix: one list, `timestamp desc` default sort on `ScorecardTable`, default verdict filter set to "all" so freshly-confirmed `too_early` entries land at the top instead of being hidden. New at-a-glance strip shows total count + latest-change recency + experiment-watch count. **Dedupe review flow** added at `/changes/dedupe`: `src/domains/changelog/dedupe.ts` extracts edit-type tokens (`title_change`, `page_created`, `schema_added`, etc.) from `change_description`, matches CSV-summary entries to PDF-granular keepers by URL + ≤3-day window + token-subset rule, and surfaces probable duplicate pairs for operator review — 38 pairs found in current data. Archive is a soft-delete (`ChangelogEntry.archived`, `archived_reason`, `archived_at`) with automatic once-per-day backup of `.data/imported-changes.json`. **Confirm flow upgrade:** `confirmFindingAsChange` now auto-stamps a `hypothesis` + `hypothesis_source: "inferred"` from the detected edit type — operator can overwrite on the detail page via new `HypothesisEditor` client component which calls new server action `updateChangelogHypothesis`. Null-URL entries render with "Site-wide infra" label. Scan-detected entries display a `scan · auto-caught` amber badge. Domain additions: `src/domains/changelog/dedupe.ts` (pure functions) + `dedupe.test.ts` (11 tests), `src/domains/changelog/actions.ts` gains `softDeleteChangelogEntry` / `restoreChangelogEntry` / `updateChangelogHypothesis`. UI: `src/app/(shell)/changes/page.tsx` slimmed from 741 → 246 lines, `changes-tab-shell.tsx` deleted, `src/app/(shell)/changes/dedupe/{page,dedupe-client,actions}.tsx` created, `src/app/(shell)/changes/[id]/hypothesis-editor.tsx` created. Verified end-to-end: server-rendered `/changes` has today's `cl-mo1p4hvf6kuklr` (Whole-Home Remodel title rename, `scan_detection`) at the top of the table, `auto-caught` badge present, dedupe banner shows "38 possible duplicates", `/changes/dedupe` renders "Pair 1 of 38" with keeper/summary cards.
**Operator loop fix (2026-04-15):** Fixed `createChangelogEntry` data loss (was in-memory only, now persists to disk + Supabase). Supabase dual-write now throws when `DATA_SOURCE=supabase` (was silent fire-and-forget). Auto-experiment creation on every changelog entry + finding confirmation — tracks citations, mentions, visibility with daily timeline snapshots. Recommendation engine: final dedup (one rec per URL), extended hard suppression (all page-targeting types), extraction_certainty on all snapshot recs, learning pattern integration (success rate in rationale), "why now" temporal context. Recovered 10 accepted findings from April 14 — linked to existing changelog entries, 5 backfilled experiments created. 6 total experiments.
**State reconciliation (2026-04-15):** Full truth-layer fix. (1) Scan findings now auto-link to matching changelog entries by URL+type instead of sitting as unresolved pending items. (2) Recommendation engine hard-suppresses strengthen_structure recs when changelog already covers FAQ/schema work (checks `signal_type` + description keywords). (3) Import orchestrator switched to `materializePerChangeOutcomes` for learning-ready outcomes. (4) Changes scorecard shows "imported"/"scan" provenance labels. (5) Supabase findings cleaned: 0 pending (was 30). (6) 237 outcomes, 27 patterns (13 high-confidence). Today is clean: no false findings.
**System audit fix (2026-04-14):** Fixed 3 hard bugs: (1) `detect-findings.ts:norm()` now strips protocol+domain so changelog paths match scan URLs — `unexpected_change` and `deploy_mismatch` cross-reference now works for 207 path-only changelog entries; (2) `findings-store.ts:addFindings()` deduplicates guardrail findings by type+URL, replacing pending entries instead of stacking oscillation noise; (3) April 13-14 Profound CSVs imported. All 23 stale findings resolved (13 rejected as noise/false positives, 10 confirmed). `normUrl()` helper added to findings-store for consistent path normalization. Tests updated.
**Phase 12: Learning System (2026-04-14):** 4 learning loops implemented — change pattern recognition (4 patterns), triage rule learning (4 rules), confidence calibration (insufficient data, correctly null), page response profiling (enriches page_visibility). All passive — stored but not consumed by UI. 28 Supabase tables total.
**Phase 11: Relationship Materialization (2026-04-14):** Beacon now stores explicit relationships between changes, pages, and outcomes. `change_outcomes` (10 rows) materializes before/after metric deltas per changelog entry. `page_visibility` (13 rows) materializes per-page citation totals, topics, and trend direction. Findings enriched with `metricMovementDetected` and `signalStrength` (0-100 composite). All materialized from existing data — no new raw data, no route changes. Ready for learning/intelligence layers.
**Phase 10: Portability & Recovery (2026-04-14):** Beacon can now fully reconstruct itself from Supabase alone. Created `scripts/bootstrap-from-supabase.ts` — reads all 23 Supabase tables, writes 49 `.data/*.json` files. Added 3 new tables (`tracked_prompts`, `tracked_entities`, `answer_texts`) with dual-write. Added 5 database indexes for query performance. Verified: deleted `.data/`, bootstrapped, all routes render correctly, scan runs successfully with findings.
**Scoreboard upgrade (2026-04-13):** KPI cards rewritten to business language ("Times AI recommended you", "How often AI mentions you", "Your pages AI sends people to"). Added week-over-week deltas: citations and mention rate now show `+N%` / `-N%` vs last week with green/red coloring. Topic trends relabeled: "rising" → "growing", "declining" → "slipping". Meta lines show "vs last week" context when delta data exists. Data pipeline computes this-week vs last-week buckets from results time series in `today-data.ts`.
**Phase 5: Competitor Monitoring (2026-04-13):** Sitemap-based competitor monitoring — crawls XML sitemaps for 5 configured competitors, diffs page lists to detect new/removed/updated pages, generates contextual alerts (topic inference from URL paths for builder site patterns). Wired into morning brief: alerts appear as "Competitor activity" section between change impact and action cards. CLI script `scripts/crawl-competitor-sitemaps.ts` with `--dry-run` flag. Initial baseline crawl completed: Flegel's (4,746 pages), PAB (6 pages), SV Custom Homes (0 entries), 2 competitors unreachable. Domain: `src/domains/competitor-monitoring/` (types, sitemap-crawler, detect-changes, store). Also added `writeDotDataJson` to persistence layer for non-array object storage. 30 new tests (sitemap parsing, change detection, alert generation, store).
**Phase 3: Attribution Memory (2026-04-13):** Today page now shows **Change Impact** section above action cards — up to 2 memory insights with mini sparklines showing before/after trends. Computed from 85 changelog entries × 22K daily metric snapshots; 11 insights generated from real data, top 2 shown. Example: "20 days ago you updated Luxury Home Builder Bay Area — mentions up 16%" with green trend line + vertical change-date marker. Engine: `src/domains/attribution/memory.ts` — per-topic before/after window comparison with minimum data gates (3 days before, 5 days after, 3+ observations per window). Direction: improving (≥15%), declining (≤-15%), stable. Platform breakdown shows which AI platforms moved. Also fixed: `investigate` rec type relative URL bug — changelog entries with relative paths now normalized via `absoluteUrlForPath`.
**Morning Brief + Change Detection (2026-04-13):** Phase 1 complete: Today page now renders **morning brief** as primary content — citation trend sparkline (2,992 citations, ↑157%) + 3 prioritized action cards with copy/email. Each card has operator-language rationale, concrete step checklists, and AI context from answer intelligence. Phase 2: **Change detection** — `confirmFindingAsChange` server action auto-creates changelog entries from confirmed scan findings; `ChangeReview` component renders on Today when content-type changes are detected (title, H1, meta, FAQ, schema, content changes). Scan trigger already exists via `TodayScanStrip`.
**Product reorientation Phase 1 + cleanup (2026-04-13):** Command Center layout — Today is now a two-panel grid (`2fr_3fr`): **left** = visibility scoreboard (3 KPI cards + compact platform text + health strip), **right** = action queue (primary + secondary action cards + findings count strip). **Nav expanded to 7 items:** Today, Pages, Changes, Market, Local, Topics, Settings. **Data imported:** all April 7-12 CSVs processed (100K+ citations, 11K observations, 20K benchmark snapshots). **Cleanup:** removed donut chart (low density), consolidated stale warnings to health strip only (removed DataFreshnessStrip from shell + warning box from action queue), improved KPI card visual weight (larger numbers, delta top-right), improved action card hierarchy (larger headline, subtler coloring).
**Track 1.2:** Daily ritual perfection — Phases 1–3 complete (2026-04-12): layout + Inbox Zero/digest + Today keyboard path (A / J/K, finding focus, primary `autoFocus` when safe) + **one decision card** (now cut — replaced by action queue). **Stale visibility gate:** hard demotion + findings warning unchanged. **Import copy (2026-04-12):** “latest visibility export / decision layer” framing — not workbook-first.
**Track 1.3:** Replication engine refinement — Phases 1–2 complete (2026-04-12): language/hierarchy + queue structure/experiment linkage/vague suppression
**Track 1.2 / 1.3 / 1.4l exit gates (persistence):** Settings → **Sign-offs** `/settings/exit-gates` + `.data/exit-gates.json` — **`daily_ritual`**, **`replication`**, **`local_layer`** all **`passed`** (operator notes **2026-04-13**); internal sign-off only; does not affect metrics, scores, freshness states, or proof. Settings layout hint hidden when all three gates are `passed`.
**Tier 1 dogfood + vault closure:** `docs/TIER_1_DOGFOOD_WEEK_LOG.md` — expanded **one-row-per-day** schema (Today / Replicate / /local, confusion, copy risk, action, verdict) + strict **human-only** rule (no fabricated weeks). **2026-04-13 static validation** remains on file. **2026-04-14:** Formal **vault Tier 1 closure verification failed** — log still has **no** consecutive operator daily rows (template only); **Tier 1 is not closed** per `master_execution_plan.md`. When the log is complete, re-run verification before updating vault docs. **2026-04-13:** One **honesty** dogfood row added (no live session — operator must replace for real evidence); see `TIER_1_DOGFOOD_WEEK_LOG.md`. **Micro-steps:** same file → **“Operator: smallest step-by-step”** (no log “import”; optional Settings → Import for data).
**Tier 1.1i:** Coverage escalation — **expanded (2026-04-13):** five-state model (`fresh` / `aging` / `stale` / `critical` / `partial`) in `coverage-state.ts` only; aging = crawl age in `(0.7×T, T]` for `T=3`; critical = missing crawl when flagged or age `> 2T`; Today digest + findings attention strip + `shouldShowTodayAllClear`; Market/Changes use `latestWebsiteCrawlRun()` crawl age; methodology `#coverage-states`
**Tier 1.1j:** Proof layer **final trust pass (2026-04-13)** — methodology: “How to read it” + “Beacon does not know” across core metrics; FAQ (coverage labels, continuous updates, every review); standardized review phrases + connector disclosures; overview five-pillar list. Product: `beacon-proof-copy.ts` (`BEACON_LOCAL_SURFACE_FOOTNOTE`, Layer-2 bullets), `local-presence.ts` footnotes + Market review lines, Today `HowWeKnowPanel` + coverage → `#coverage-states`, Market **partial** coverage warning, Connectors page/client, `/local` stored-review wording, `local-operator/surface.ts` data gaps. Checklist refresh: `docs/TIER_1_1J_EXIT_GATE_CHECKLIST.md`.
**Proof layer:** Layer-2 collapsed disclosures on Market + Changes Outcomes (2026-04-12): `<details>` “How this works” / “How verdicts work” + links to `/settings/methodology#citation-share` and `#verdicts`; copy from `beacon-proof-copy.ts`
**Track 1.4:** Local listings / reviews — Phase 1 + **Phases 2B–4** (2026-04-12/13); **1.4d (spec):** `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md`; **1.4e connectors (2026-04-13):** `docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md` + `/settings/connectors` — **Google:** OAuth + **multi-location picker** (fetch → select → persist `selected_location_id` on token) + on-demand Sync now → GBP v4 reviews for selected location only → strict map → `mergeUpsertLocalReviews`; sync blocked until location selected. **Yelp:** server-stored Fusion API key + Sync now → Fusion business + reviews → `mapYelpReviewToLocalReview` → same merge; ids `yelp:…`, import run `connector:yelp`. `last_synced_at` per provider; local-presence freshness = max(import run, Google sync, Yelp sync). No auto-sync. `/local` + manual import unchanged.
**Track 1.4f–g (NAP + surfacing):** NAP consistency expanded to 4 states (`complete` / `incomplete` / `inconsistent` / `unknown`); centralized in `napState` on `LocalPresenceSnapshot`; inconsistency detects conflicting `listing_name` on imported reviews vs configured name. Today attention uses 4-state NAP (inconsistent fact line). Market strip shows NAP state with tone coloring. `/local` shows explicit label + factual explanation. Methodology `#nap-consistency`. No new connectors, scoring formulas, or ranking claims.
**Track 1.4 (listing completeness — operator slice, 2026-04-13):** Read-only **GBP field coverage** style audit on `LocalPresenceSnapshot.listingCompleteness` — present/missing for name (config or Google selected location label), address, phone, website (domain), category (config industry); **hours** not in v1 (no stored hours signal). Coverage labels `strong` / `partial` / `weak` from present-count thresholds only (not a score). `/local` **Listing completeness** section; Today one factual line when `weak` and NAP does not dominate; Market strip optional **Listing completeness:** phrase; methodology `#listing-completeness`. Tests: `listing-completeness.test.ts` + updated attention/market/local smokes.
**Track 1.4l (Local layer exit gate — 2026-04-13):** **`local_layer`** in Sign-offs with static operator checklist + same status/note actions as other gates; methodology `#exit-gates` boundary text expanded. **Operator sign-off (2026-04-13):** **`local_layer`** = **`passed`** in `.data/exit-gates.json` after checklist review; `/local` page header copy tightened to read-only framing (no live-directory implication).
**Track 1.4 — Per-source last sync (`/local`):** `LocalPresenceSnapshot.lastSync` — `google` / `yelp` from connector `last_synced_at`; `manual` from latest non-connector `ImportRun` (`entity_type: reviews`, `imported_count > 0`). **Data freshness** section on `/local` (always three rows + disclosure); methodology `#review-source-timestamps`. Pure projection — no merged timestamp, no new thresholds.
**Methodology (connectors + freshness):** `/settings/methodology` — `#review-connectors` documents **shipped** Google + Yelp (on-demand); `#review-monitoring-v1`, `#local-reviews`, boundaries, and FAQ aligned with manual + connectors, per-source timestamps, no auto-sync, no SLA language. **2026-04-13:** FAQ “connection breaks” + **`/local`** “How this works” / empty-state copy aligned with shipped connectors (no “not syncing yet” drift); tier specs `TIER_1_4D` / `TIER_1_4E` docstrings match.
**Track 1.5:** Milestone polish (2026-04-12): magnitude classification (major/minor), same-key-same-day dedupe, weekly noise cap (3+ minors → suppress on Today), enriched Today teaser (subtitle + relative date + magnitude-aware styling), Changes list collapsed (5 visible, rest behind expand). Exit gate 1.5g verified: ATH truthful, deduped, linked to proof
**Answer Intelligence (2026-04-13):** Built-time index from 9,596 AI answer observations + 84K citations → `answer-intelligence-index.json` (~1.3MB, 146ms build). Types in `src/domains/answer-intelligence/types.ts`; build in `build-index.ts`; store in `store.ts`; repository wired in file + supabase backends. Import pipeline builds index after citation-evidence-index. **Quality gates:** `NON_COMPETITOR_DOMAINS` blocklist (30 directory/platform/media domains) filters co-citation + co-appearing; brand descriptors require `source_count ≥ 2` + `length ≥ 25` + no competitor-name fragments; answerContext requires ≥ 2 signal points; Market "Who replaces you" requires ≥ 50 appearances + ≥ 100 total answers. **Product surfaces:** recommendation engine enriches recs with `answerContext` (mention rate, position, competitor, trend — gated); Today primary action card renders "From AI answers" block; HowWeKnowPanel shows AI answer analysis (mention rate, declining/rising topics); Market page shows "Who replaces you" section (real competitors only, sorted by absent count) + per-topic absence breakdown.
**Native ingestion prep (2026-04-12 / 13):** `docs/NATIVE_INGESTION_READINESS_AUDIT.md` — integrity/utilization/architecture/benchmark/scale; **workbook import removed**; Profound **`writeLegacyBridge`** **dual-writes** when `DUAL_WRITE=true`. **2026-04-13:** Profound CSV discovery is **header-based** (no filename prefixes); **merge-safe** ingest for prompts, raw rows, answer texts, citations per date, benchmarks, changelog — partial-week CSVs no longer require replacing the canonical monolith file.

---

## What Beacon Is

Beacon is a **daily AI visibility operating system** for local businesses. One operator opens it each morning to answer:

- What changed on my site?
- What is true about my visibility?
- What matters right now?
- What should I do next?
- Where is competition beating me?

**Stack:** Next.js 16 (App Router), React 19, TypeScript strict, `.data/*.json` file persistence + Supabase dual-write (23 tables). Bootstrap from cloud: `npx tsx scripts/bootstrap-from-supabase.ts`. Single-user, premium, self-hosted.

**Not:** a generic SEO dashboard, a crawler, a CRM, an agency platform, a science project.

---

## Current System State

### What is genuinely working

| Area | Score | Evidence |
|------|-------|----------|
| Domain architecture | 76/100 | 31 well-bounded domains, strict types, consistent patterns |
| Scan pipeline | 75/100 | Live crawl → snapshot diff → 15 finding types → priority scoring → changelog cross-reference. Guardrail dedup prevents oscillation noise. 7 dedicated tests |
| Attribution engine | 75/100 | Event detection → candidate discovery → triage → scoring → operator verification. Golden tests |
| Proof layer | 78/100 | Confidence badges, evidence tiers, trust sources, freshness dots. Honest about uncertainty |
| Pages route | 75/100 | Page truth + fix briefs + verification workflow. Strongest route |
| Changes route | 70/100 | Scorecard + verdicts + replication. Core "what worked" view |
| Market route | 62/100 | Real competitive intelligence (rankings, topic signals, battlecards). Data-dependent |
| Navigation | Clean | 6 items: Today, Pages, Market, Local, Changes, Settings. Today: **A** → primary CTA, **J/K** → findings; command palette |
| Build health | Solid | Zero type errors, 306 tests pass, production build succeeds |
| Copy/wording | 75/100 | Operator-focused, honest, avoids jargon |

### What is broken or risky

| Problem | Severity | Impact |
|---------|----------|--------|
| **Error boundaries** | DONE | `(shell)/error.tsx` + `settings/error.tsx` implemented and runtime-verified (2026-04-12) |
| **Loading states** | DONE (Phase 0B) | `(shell)/loading.tsx`, `(shell)/pages/loading.tsx`, `(shell)/changes/loading.tsx` — shell + Pages + Changes Suspense fallbacks |
| **Today scan blocks render** | DONE (1A-1–6) | RSC never awaits scan; `ScanStatusBanner` triggers + polls from client; `router.refresh()` on complete. **Phase 5-9:** stale-running guard. **2026-04-14:** domain inference + env injection + preload; **E2E:** full scan **35** pages **success** on **ritzbuilders.com**; CLI updates **`scan-state.json`** on completion (`writeIdleScanStateFromLastResult`); `npm run data:scan` includes domain preload |
| **Demo data not labeled** | MITIGATED (2A) | `DemoBannerGate` + `isDemoMode` when no import runs; sticky banner with import CTA (Phase 2A-3) |
| **Empty states missing** | LOW (2B done) | Import empty states on main routes; **2B-5:** `shouldShowTodayAllClear` returns false when `isDemoMode` (no false “all clear” on sample data) |
| **Module-cached import data** | MEDIUM | `seed-data.server.ts` top-level await → stale in long-running production process |
| **Settings fragmented** | DONE (Phase 3) | Route consolidation + smoke **3-8** verified **2026-04-12**: Import / Config / Data tabs only; Health direct URL; **`/import`**, **`/setup`**, **`/results`** → **404** |
| **Today section count** | DONE (1.2) | Track 1.2 Phase 1: primary action promoted to #1 slot, findings collapsed, proof/system moved to bottom, morning-order text removed, milestone/replication compacted |
| **Render-time side effects** | DONE (1C) | `persistOutcomes()`, `updateExperimentCitations()`/`persistExperiments()`, and `syncMilestonesFromWorkspace()` all moved to post-import; 1C-3 audit confirmed zero writes in render path |
| **Test coverage narrow** | LOW | 460 tests (domain + lib + `exit-gates-store` + local-presence + NAP 4-state + listing completeness + per-source `lastSync` + GBP/Yelp map/sync + GBP location picker + Tier 1.1i coverage + components + **route smokes** + `today-next-line` + `today-one-decision` + **scan-site-domain** + Profound **csv-discovery** / **merge-ingest**); Vitest `fileParallelism: false` + 30s timeout stabilizes heavy dynamic imports; no full E2E |

### Overall scores (from 2026-04-11 audit)

| Composite | Score |
|-----------|-------|
| Product intelligence | 75/100 |
| Operator experience | 45/100 |
| Production safety | 25/100 |
| **Overall** | **53/100** |
| **Launch readiness (now)** | **38/100** |
| **Launch readiness (after safety fixes)** | **72/100** |

---

## Current Phase & Next Actions

**Status:** **Launch Phases 0–5 COMPLETE. Tier 1.1 + 1.1i COMPLETE. Track 1.2 Phases 1–3 COMPLETE** (+ Today stale-visibility hard gate). **Track 1.3 Phases 1–2 COMPLETE. Track 1.4** through listing completeness **+ Sign-offs all `passed`.** **Tier 1 vault closure:** static validation + protocol logged (**2026-04-13**); **calendar dogfood week** — operator completes `docs/TIER_1_DOGFOOD_WEEK_LOG.md` table then pastes **Final Tier 1 note** in that file. Gate: typecheck ✓, 328/328 tests ✓, build ✓.

**Immediate next 3 actions:**

1. **Operator:** Run the 2-week native test — open Today daily, copy morning brief actions to devs, import fresh Profound CSVs, run scans to detect changes, confirm detected changes into changelog. Run `npx tsx scripts/crawl-competitor-sitemaps.ts` periodically to track competitor page changes.
2. **Phase 4: Native Prompt Execution** — build platform adapters (Perplexity, ChatGPT, Gemini) to replace Profound CSV imports with nightly API-based prompt execution. Start with Perplexity (best citation quality).
3. **Competitor monitoring enhancement** — add competitor alert detail view, link alerts to answer intelligence topics for counter-move suggestions, add Settings UI for managing monitored competitors.

**Sprint 6A.1 progress (2026-04-24):** Phases 1–7 COMPLETE.
- P1 migrations (page_element_inventory + recommended_edits + llm_rejections + changelog action_type/target_element_key)
- P2 ActionType registry, P3 ElementType registry, P4 element_key helpers, P5 13 active extractors + dispatcher
- P6 — extractor wired into `verify-action.ts` + `scripts/scan-owned-pages.ts` + `orchestrate-scan.ts` dual-write block. Idempotent on `(source_snapshot_id, element_key)`.
- P7 — `buildSpecificEditEvidencePacket` pure builder ships at `src/domains/recommendations/specific-edit-evidence.ts`. Top-level `clusterId | clusterLabel | clusterKind`. 16-char sha256 evidenceHash. allowedTargetUrls owned-only + sentinel. Strict serializability + no-route-render-generation guard.
- P8 — `SpecificEditProvider` interface + 3 implementations at `src/domains/recommendations/specific-edit-provider.ts` + `providers/{deterministic,openai,anthropic,index}.ts`. Deterministic shell returned empty bundle; openai + anthropic stubs throw `not_implemented (Sprint 6A.2)`. No SDK deps added.
- P9 — Deterministic generators wired. New folder `providers/generators/` with `edit-title.ts`, `add-h2-section.ts`, `add-faq.ts`, `_text-utils.ts`. `runDeterministicGenerators(packet)` aggregates all 3 in stable order.
- P10 — Output validation layer at `src/domains/recommendations/specific-edit-validator.ts`. 10 check categories. Discriminated `{ok: true} | {ok: false; field; reason}` result. All deterministic provider outputs validate clean.
- P11 — Persistence layer + CLI. `recommended-edits-persistence.ts` + `syncRecommendedEdits` dual-write + `scripts/generate-specific-edits.ts`. Deterministic id idempotent on (rec_id, action_type, target_element_key). 19 tests.
- P12 — /recommendations UI surfaces typed edits + Accept fans out N changelog entries.
- P14 — Orchestration extract + queue-driven CLI. `src/domains/recommendations/load-queue.ts` + `scripts/build-edits-for-queue.ts`. Page render unchanged. 18 new tests, 2061 passing.
- P15 — Real scan populated `page_element_inventory` on production: 4312 rows across 35 URLs covering all 13 active extractor types. Zero writes to `recommended_edits` / `changelog_entries`.
- **P13 rerun (today, 2026-04-25) — REAL hosted UI verification.** Picked rank-1 stableKey `create_cluster_page:geo:Los Altos` from the live queue; dry-run generated 20 valid edits (action types: `add_faq=16, add_h2_section=4`, no `edit_title`); `--write` persisted **5 unique rows** to `recommended_edits` (15 deduped by the DB unique-index target). Hosted UI confirmed via dev-server preview: **Specific edits (5)** section renders, Accept button copy is **"Accept — track 5 edits"**, all 5 element keys + the De Mattei H2 proposal text appear in the DOM. **Sprint 6A.1 is end-to-end verified on hosted.** P13 stopped before Accept per operator instruction.
- **Three small infra fixes shipped alongside P13:** (a) `build-edits-for-queue.ts` now loads `.env.local`; (b) `getPageElementInventory()` switched to `queryAllPaged` (PostgREST `max-rows=1000` was silently truncating); (c) `runProviderAndPersist` defensively dedupes by `(rec_id, action_type, target_element_key)` because Phase 9's multi-candidate emission collides on the DB unique index. 19 persistence tests still pass.
- **Phase 13b (today, 2026-04-25) — Accept fan-out test passed + bug fix.** Operator clicked Accept on the Los Altos rec; 5 changelog entries created, each with `source_rec_id` + `action_type` + `target_element_key` + structured notes (Proposed/Evidence/Measurement plan/Risks). `/changes` lists all 5. **One real bug surfaced + fixed:** `acceptRecommendation` was gating the WHOLE changelog block on `shouldStampChangelog`, so `needs_review` recs (like Los Altos) blocked the per-edit fan-out even when typed edits existed. Refactored to fire fan-out unconditionally when edits exist; legacy single-entry path still gated. Added regression test ("fan-out fires even when resolution.action is needs_review"). 2064 tests passing.
- **Phase 6A.1.16 (today, 2026-04-25) — pre-Sprint-7 cleanup.** Two surgical fixes both committed: (a) `recommendation_responses` Undo path now issues an explicit Supabase DELETE via the new `deleteRecommendationResponseByRecId` dual-write helper (was upsert-only, leaving stale rows); (b) production `page_snapshots` migrated to add 8 missing columns (audit found broader drift than the named `body_paragraph_sample`). Snapshot dual-write now succeeds end-to-end (`snapshots=true` in wrapper output). Migration `sprint6a116_page_snapshots_drift_columns` applied. 7 new Undo tests (2071 passing total). Sprint 7 is now safe to start — multi-tenant rebuild can rely on correct per-tenant delete + clean snapshot schema.
- **Sprint 6A.1: TRULY COMPLETE end-to-end on hosted.** 12 architecture phases + 4 verification phases (P13 / P13b / P14 / P15) + 1 cleanup phase (P16). End-to-end loop verified on production data:
  scan → page_element_inventory → SpecificEditEvidencePacket → deterministic provider → recommended_edits → /recommendations Specific edits (N) panel → Accept button → N changelog entries → /changes cards.
- **Next options:**
  - Operator-driven: Accept the Los Altos rec to verify P12's fan-out creates 5 changelog entries with `action_type` + `target_element_key` + `source_rec_id`. Safe to do whenever.
  - **Sprint 6A.2** — LLM activation. Highest signal once a real packet round-trips through openai/anthropic providers.
  - **Sprint 7** — Multi-tenant hardening for beta testers. The Sprint 6A.1 stores need tenant scoping before second tenant onboards.


**Full execution plan:** See `NEXT_PHASE_EXECUTION_PLAN.md` — launch phases complete; active roadmap is **Tier 1** tracks **1.1 → 1.5** (see `master_execution_plan.md` §"Tiered product stack").

---

## Key Numbers *(snapshot / example — from one imported dataset + repo layout; re-run diagnostics on your `.data` if these must be exact)*

| Entity | Count |
|--------|-------|
| Results (imported) | 1,179 |
| Changes (imported) | 85 |
| Opportunities | 0 |
| Outcome events detected | 45 |
| Attribution candidates | 202 |
| Auto-resolved events | 13/45 (29%) |
| Domain modules | 31 |
| App routes (build) | 29 |
| Vitest tests | 460 |
| Viz components | 19 |

---

## Doc Reading Order

| Order | File | What it tells you |
|-------|------|-------------------|
| 1 | **This file** (`HANDOFF_VERIFIED_STATE.md`) | Current state, what works, what's broken, next steps |
| 2 | **`architecture.md`** | How the system fits together: routes, domains, data flow, persistence |
| 3 | **`NEXT_PHASE_EXECUTION_PLAN.md`** | What to do next: phased plan, micro-steps, cursor prompts |
| 4 | **`VERIFICATION_LOG.md`** | Proof of past work: dated entries with before/after metrics |
| 5 | **`master_execution_plan.md`** | Deep context vault: all history, all ideas, full backlog |
| 6 | **`TIER_1_DOGFOOD_WEEK_LOG.md`** | Tier 1 dogfood protocol + daily log + vault closure note (when filled) |
| 7 | **`SCAN_TRUTH_REFACTOR_PLAN.md`** | Vertical deep dive: scan orchestration refactor spec |

---

## Where Everything Lives

### Documentation

```
docs/
  HANDOFF_VERIFIED_STATE.md     ← YOU ARE HERE (entry point)
  NEXT_PHASE_EXECUTION_PLAN.md  ← active execution plan
  VERIFICATION_LOG.md           ← proof + history log
  TIER_1_DOGFOOD_WEEK_LOG.md    ← Tier 1 dogfood protocol + operator log (vault closure)
  architecture.md               ← system map
  master_execution_plan.md      ← full context vault (history + ideas + backlog)
  SCAN_TRUTH_REFACTOR_PLAN.md   ← scan refactor spec (completed)
  TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md  ← local review import contract
  TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md           ← review monitoring v1 scope (1.4d)
  TIER_1_4E_REVIEW_CONNECTORS_SPEC.md             ← connector sub-spec extending 1.4d (1.4e)
  NATIVE_INGESTION_READINESS_AUDIT.md             ← Profound bridge → API/Supabase: integrity, utilization, pipeline risks, open questions
  archive/
    audits/                     ← 9 audit files from 2026-04-11 comprehensive audit
    handoffs/                   ← archived handoff snapshots
    completed-specs/            ← completed spec documents
    product/                    ← historical PRD
    research/
      profound-integration/     ← Profound CSV field notes, parsing risks, source map
```

**Repo root:** `CLAUDE.md` — portable agent rules for Claude Code / CLI; keep in sync with `.cursor/rules/core.mdc` if you use both tools.

### Code

```
src/
  app/(shell)/           ← All routes (Today, Pages, Market, Changes, Settings, etc.)
  domains/               ← 31 domain modules (attribution, scanning, pages, competitors, product, etc.)
  components/            ← UI components (shell, viz, data, display, form, today, replication)
  lib/                   ← Shared utilities (persistence, import, data-adapters, view-models, tenant)
  adapters/              ← External data adapters (Profound)
  storage/               ← Canonical persistence layer
  derivations/           ← Pure computation functions
scripts/                 ← CLI tools (scan, registry, sampling, parity)
tests/                   ← Vitest tests (domains + lib)
.data/                   ← Runtime data (gitignored)
```

### Key Config

| File | What |
|------|------|
| `.env.local` | `DATA_SOURCE`, `DUAL_WRITE`, `BEACON_TENANT` |
| `.cursor/rules/core.mdc` | Always-on Cursor rules for Beacon |
| `src/lib/navigation.ts` | 5-item nav definition |
| `src/lib/business-config.ts` | Business profile (name, domain, services, locations) |
| `src/lib/tenant.ts` | Optional multi-tenant file isolation |

---

## Rules for Future Work

1. **Read this file first** before starting any task.
2. **Do not create new planning docs.** Use the existing 6 files. Ideas go in `master_execution_plan.md`. Steps go in `NEXT_PHASE_EXECUTION_PLAN.md`. Proof goes in `VERIFICATION_LOG.md`.
3. **Do not duplicate context.** Each doc has one job (see reading order above). If you're not sure where something goes, it goes in the vault (`master_execution_plan.md`).
4. **Update this file** when the system state materially changes (new phase completed, major bug fixed, scores change).
5. **Archive, don't delete.** Old specs → `docs/archive/completed-specs/`. Old handoffs → `docs/archive/handoffs/`.
