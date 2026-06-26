# Beacon — Autonomous Build Progress Log

> Operator away 2026-06-25 ~19:18 PDT → review at 12:00 AM PT. Continuous build, no stopping.
> Branches only · no main · no deploy/publish · $0 (cache/synced data) · stay green (tsc + tests).
> Stacking order for the eventual one-shot deploy: Sprint 3 → 4 → 5 → 6 → …
> Final hour (after 23:00 PT): full merge gate only (test+typecheck+build), no merge, no deploy.

Read this top-to-bottom to see the whole journey. Newest entries appended at the bottom.

---

## Window + baseline
- Start: 2026-06-25 19:18 PDT. main = `276a5f71` (Sprint 3 + build fix; NOT deployed — Vercel 100/day cap).
- Branch chain at start: Sprint 4 (`claude/sprint-4-demand-expansion`) → Sprint 5 (`claude/sprint-5-execution-layer` @ f78b020d).
- New work continues on **`claude/sprint-6-profound-deep`** (off Sprint 5).

## Plan order (biggest-first, from the master plan / Connection Audit)
1. **Profound deep-use** — resurrect DEAD `profound_referral_rows` + `profound_bot_rows` + raw answers → proof + recs + UI. ← IN PROGRESS
2. DataForSEO SERP-winners → competitor teardown → drafts.
3. Structured-LLM drafts into the production rec pipeline.
4. GA4 revenue metric.
5. Clarity-as-Move-router (friction → specific move type).
6. Programmatic page factories (entity×attribute / city×service).
7. Unified ranked worklist + filtered views; ruthless legacy-UI cleanup.

---

## [1] Profound deep-use — resurrect the dead tables
**Why biggest:** the audit names Profound the most underused connector (~25–30% extracted); bots + referrals are FULLY DEAD (synced nightly, zero readers). AI-referral visits are the realest money signal (actual AI-sent visitors); bot coverage shows which AI crawlers skip high-value pages. $0 — consumes already-synced rows, no paid calls.
**Schemas:** `profound_referral_rows`(tenant_id,date,path,referral_source,referral_type,visits) · `profound_bot_rows`(tenant_id,date,path,bot_name,bot_type,hit_count,citations).
**Plan:** pure `referral-signals.ts` + `bot-coverage.ts` (+ tests) → fail-soft tenant-scoped loaders → proof-outcome consumer (AI-referral lift) + uncrawled-high-value-page trigger → UI section. Iranopedia rows likely empty (borrowed account tracks OpenAI) → fail-soft to nothing; built + fixture-tested for when real data lands.

**DONE [1]** (19:24 PDT): Profound dead-data resurrected.
- `domains/profound-deep/referral-signals.ts` (pure) — aggregateReferralsByPage + referralOutcomeForPage (before/after AI-referral lift) + summarize. +test (6).
- `domains/profound-deep/bot-coverage.ts` (pure) — aggregateBotCoverageByPage + findCrawlabilityGaps (valuable pages AI doesn't crawl, fail-closed on no bot data) + summarize. +test (4).
- `domains/profound-deep/load-profound-deep.ts` — fail-soft tenant-scoped readers (react.cache) for profound_referral_rows + profound_bot_rows + composed loadProfoundDeepSignals.
- `(shell)/profound-deep-section.tsx` — "AI is sending you traffic" cockpit section (AI-referred visits by page + uncrawled-valuable-page gaps + bot/source summary); mounted in page.tsx + jump-nav ("AI traffic"); self-hides when no data.
- Gates: tsc clean; 10/10 profound-deep tests. No migration, no paid, no main.
- NEXT TARGET: DataForSEO SERP-winners → competitor teardown source + drafts (audit #4, HIGH) — pick the Google winners as teardown targets so drafts learn from who actually ranks, not just AI-cited pages.

## [2] DataForSEO SERP-winners → teardown targets (audit #4, HIGH)
**Why biggest:** teardown only used Profound-cited URLs; the audit's strongest signal is the Google+AI OVERLAP (a page that BOTH ranks on Google AND is AI-cited = reverse-engineer first). $0 — reuses cached serp_verdict drafts.
**DONE [2]** (19:28 PDT):
- `domains/serp/serp-teardown-fusion.ts` (pure) — rootDomainOf + fuseTeardownTargets (overlap → AI-only → Google-only) + pickOverlapTeardownUrl. +9 tests.
- Wired into `competitor-page-audit.ts::auditTopCompetitorsForTenant`: loads each move's cached serp_verdict (topDomains), derives ownDomain, and prefers the overlap competitor URL as the teardown target (behavior-preserving when no verdict). $0.
- Gates: tsc clean; 20/20 (serp + audit regression). No migration, no paid, no main.
- NEXT TARGET: GA4 revenue metric (audit #6) — "money-first" scorer currently has hasRevenue:false (conversions/traffic only). Add the revenue/value metric to the GA4 report + page-values so $Value is real, not a proxy. Pure-first + connector field add.

## [3] GA4 revenue — DEFERRED (migration-gated)
Adding GA4 revenue needs a new `revenue` column on `ga4_url_traffic` → a migration (operator-approval-gated). Skipped per the no-migration rule; pivoted to an equal-size $0/no-migration lever.

## [3b] Clarity-as-Move-router (audit P8/P13) + resurrect unused scroll/engagement columns
**Why biggest no-migration lever:** Clarity friction only produced a generic score; the synced `avg_scroll_depth` + `engagement_time_seconds` columns were DROPPED (never selected). This turns friction PATTERNS into SPECIFIC fixes + reads the unused columns. $0, no migration (columns exist).
**DONE [3b]** (19:32 PDT):
- `clarity-page-signals.ts`: now SELECTs avg_scroll_depth + engagement_time_seconds; session-weighted-averaged into `scrollDepthPct` + `engagementSeconds` (optional fields → no churn on existing constructors).
- `clarity-move-router.ts` (pure): routeClarityFriction → fix_js_errors (high, blocks crawlers) / fix_dead_click / fix_rage_interaction / fix_intent_mismatch / raise_answer (uses scroll-depth). Priority by impact; session floor + fail-closed (no scroll col → never claims raise_answer). +8 tests.
- Gates: tsc clean; 8/8 clarity tests. No migration, no paid, no main.
- NEXT TARGET: wire the Clarity router INTO the clarity-friction trigger so the friction rec carries the SPECIFIC move type + reason (consume the router), then the next plan lever (structured-LLM-into-prod is paid; prefer programmatic entity×attribute page factory or unified worklist views — $0).

## [4] Unified ranked worklist + filtered views (plan P15) — $0/additive
**Why big:** the cockpit is ~30 stacked sections; the plan wants ONE ranked Move list with filtered views (Today / This Week / Big Bets / New Pages / Store / Tools / Trends / Proof). Building it ADDITIVELY (pure view-slicer + a new section) avoids risky deletion of the 30 sections. $0.
Note: Clarity router→trigger wiring left as a careful follow-up (trigger is tested + load-bearing; won't risk it autonomously). The resurrected scroll/engagement columns already flow to every ClarityPageSignal consumer.

**DONE [4]** (19:37 PDT): Unified ranked worklist + filtered views.
- `domains/worklist/worklist-views.ts` (pure) — buildWorklist (normalizes moves+opportunities+trends+products into one ranked WorklistItem list) + sliceWorklist (today/this_week/big_bets/new_pages/store/tools/trends/all) + WORKLIST_VIEWS. +8 tests.
- `(shell)/worklist/page.tsx` (server, force-dynamic) + `worklist-client.tsx` (client view-tabs) — the additive `/worklist` surface; reuses cached loaders ($0). Nav link added (navigation.ts "Worklist" in Find&fix).
- Gates: tsc clean; 8/8 worklist tests. Additive — existing 30 cockpit sections untouched (no risky deletion). No migration/paid/main.
- NEXT TARGET: another $0/no-migration lever — programmatic entity×attribute page-candidate factory (P12) OR wire the Clarity router into the move pipeline carefully. Leaning page factory (additive content engine).

## [5] Programmatic entity×attribute page-candidate factory (plan P12) — $0/additive/pure
**DONE [5]** (19:39 PDT):
- `domains/page-factory/entity-attribute-factory.ts` (pure) — generatePageCandidates: mines recurring entities from the tenant's OWN owned-page tokens + demand-cluster labels (tenant-agnostic, no hardcoded categories) × generic SEO attribute templates (meaning/history/guide/examples/list) → deduped (skips pages already covered), relevance-gated, capped create_page CANDIDATES. Every candidate marked needsDemandValidation=true (NO fabricated demand — must pass the DataForSEO verdict before becoming a Move). +6 tests.
- Gates: tsc clean; broad Sprint-6 regression 66/66. No migration/paid/main.
- NEXT TARGET: continue exhausting the plan — Profound raw-answers consumer (analyzeProfoundAnswers exists, no caller) OR entity/schema breadth OR more legacy-UI cleanup. Pick the biggest $0 lever next.

## [6] Image-alt analyzer (audit: registered-but-inactive add_image_alt_text; "highest-leverage commerce-adjacent win, no Wix write") — $0/pure
**DONE [6]** (19:42 PDT):
- `domains/page-factory/image-alt-analyzer.ts` (pure, cheerio) — analyzeImageAlt(html): extracts <img>, classifies alt as missing/empty/poor/ok, skips decorative (role=presentation/aria-hidden) + tracking pixels, and proposes deterministic alt text from the filename stem (+ page-title fallback for hash-only names; never invented). suggestAltText + summarizeImageAlt. +6 tests.
- Note: PageSnapshots don't store raw HTML → end-to-end wiring would fetch own-page HTML via the existing polite-fetch ($0); the pure analyzer is the reusable core (works on any HTML).
- Gates: tsc clean; 12/12 page-factory. No migration/paid/main.
- NEXT TARGET: keep exhausting the plan with $0/no-migration levers (entity/schema breadth via composeSchema, or wire one of these engines end-to-end). Final-hour gate after 23:00 PT.

**DONE [5b]** (19:45 PDT): wired the page factory end-to-end.
- `domains/page-factory/load-page-candidates.ts` — server loader (demand graph → owned URLs + labels + topics → generatePageCandidates), fail-soft $0.
- `(shell)/today-opportunities-section.tsx` — "💡 Page ideas to validate" subsection (chips, clearly needs-validation). Factory now consumed + visible.
- Gates: tsc clean. No migration/paid/main.
- NEXT: broad regression of all touched domains together, then continue or hold for the final-hour merge gate (after 23:00 PT).

---
## STATE SNAPSHOT @ 19:50 PDT
Branch `claude/sprint-6-profound-deep` (stacked on Sprint 3+4+5), all pushed, tsc clean throughout, 158+ targeted tests green. Slices landed: [1] Profound dead-data (referral + bot signals + "AI traffic" section), [2] SERP→teardown overlap fusion (wired into competitor-page-audit), [3b] Clarity-move-router + resurrected scroll/engagement columns, [4] unified worklist + `/worklist` route + nav, [5] entity×attribute page factory (+ wired "Page ideas" panel + loader), [6] image-alt analyzer, + overallReferralTrend. ALL $0 / no-migration / no-publish / no-Wix / no-main.
DEFERRED (migration-gated, need operator approval): GA4 revenue column; Profound `profound_answer_rows` (raw answers). Deferred (risk/tested-surface): Clarity-router→friction-trigger wiring; fanout→demand boost (touches pure scorer).
FINAL-HOUR PLAN (after 23:00 PT): full `npm run typecheck` + targeted suite + `npm run build` on this branch; fix breakage; stage for review. NO merge, NO deploy (Vercel 100/day cap also still applies until reset). Stack for the eventual one-shot prod deploy: Sprint 3+4+5+6.

**DONE [7]** (19:51 PDT): bot-coverage crawlability gaps → unified worklist.
- `worklist-views.ts` buildWorklist now accepts `crawlGaps` → technical fix_crawlability items (+1 test, 9/9).
- `/worklist` page wires profound-deep crawlability gaps (valuable pages derived from hero moves — no extra load). Engine [1] now feeds engine [4]. tsc clean.

**GATE CHECK @ 19:53 PDT:** local `npm run build` on the FULL stacked branch (Sprint 3+4+5+6) = ✓ Compiled successfully, BUILD_EXIT 0. Whole stack verified mergeable (no deploy). Continuing.

## [8] Image-alt engine end-to-end (operator-triggered $0 scan) — lands audit's "highest-leverage commerce-adjacent win"

**DONE [8]** (20:02 PDT): image-alt engine END-TO-END (plan's "highest-leverage commerce-adjacent win, no Wix write").
- `image-alt-actions.ts` (NEW): operator-gated `scanImageAltAction` — polite-fetch top-6 owned pages ($0, robotsCache, fail-soft per page) → analyzeImageAlt → persist findings (move_drafts kind `image_alt_findings`, no migration); + `loadImageAltReports` fail-soft reader.
- `image-alt-client.tsx` (NEW): "🖼️ Scan image alt-text" operator button (useTransition + router.refresh).
- `image-alt-section.tsx` (NEW): per-page missing/poor alt + deterministic suggestion to paste; self-hides w/o data+operator. Mounted in page.tsx ("sec-image-alt") + jump-nav.
- tsc clean; analyzer 7/7. Engine [6] (image-alt) now consumed by a real UI + $0 fetch path. No paid/publish/main.

**DONE [9]** (19:58 PDT): P7 Trend Radar — spike/anomaly detector (the plan's named NET-NEW piece).
- `trend-radar/spike-detector.ts` (NEW, pure): `detectSpikes` flags sharp WoW jumps (≥+35% spike, ≥+100% high), 0→N `emerging` (no %-guess, fail-closed), optional `collapse`; minRecent noise floor; ranked. `describeSpike` for cards. +9 tests, tsc clean.
- The weekly-trend substrate (buildWeeklyTrend ±8% drift) already exists; this adds the spike threshold the plan calls out as net-new. Ready for a weekly-query loader to surface a Trend Radar view.
NEXT: wire a weekly-series loader (GSC daily→weekly per query) into a Trend Radar surface, OR continue P-sequence.
