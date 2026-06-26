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

**DONE [10]** (20:05 PDT): P13 Clarity-as-Move-router — read-only surface (consumes engine [3b]).
- `friction-fixes-section.tsx` (NEW): loads the cached Clarity loader → routeClarityFriction per page → the SPECIFIC fix (errors / dead-click / rage / intent-mismatch / buried-answer) with plain-language label + evidence, ranked by severity. Self-hides when nothing clears the floor. Mounted in cockpit ("sec-friction-fixes") + jump-nav.
- $0, read-only, reuses loadClarityPageSignalsForTenant (cached, reliable). tsc clean; router 8/8.
- Deferred (risk): the score-OVERRIDE half (router decides the move type inside the friction trigger) — touches the tested trigger surface.

**DONE [11]** (20:12 PDT): specialist DEBATE made visible (plan P1/P15 trust). `demand-graph/debate-summary.ts` (pure) `summarizeSpecialistDebate` → render-ready voices (operator-labeled, ranked) + objections (veto-first) + headline + consensus%; +4 tests. Attached `debate` to each hero Move ($0 — opinions were ALREADY computed on the hero path) + collapsible "Why Beacon recommends this" panel on the Move card. tsc-verified (exit 0) before the Bash outage.

**DONE [12]** (20:20 PDT): commerce/product URL classifier (plan P8 net-new). `page-factory/commerce-classifier.ts` (pure, tenant-agnostic, configurable) — product/collection/content from URL shape + Wix store membership; +6 tests.

**DONE [13]** (20:24 PDT): product-SEO gap detector (plan P8). `page-factory/product-seo-gaps.ts` (pure) — consumes commerce-classifier → flags product/collection pages missing schema (high) / meta / weak title / image-alt; ranked; +7 tests. Composes with image-alt + schema engines.

> ⚠️ INFRA NOTE (~20:14–20:28 PDT): the Bash safety classifier went into a prolonged outage ("auto mode cannot determine the safety of Bash"). [11] was tsc-verified (exit 0) before it; [12]+[13] are pure modules written during the outage and are PENDING the batch verify (tsc + their tests) + commit the moment Bash recovers. No main/deploy/publish/paid touched. Edit/Write/Read kept working, so building continued.

**DONE [14]** (20:24 PDT): commerce-classifier consumed by the worklist (completes [12] engine→surface).
- `worklist-views.ts` `parentOf` now takes the targetUrl → a product/collection URL tags the item `commerce` even under a generic content action, so the Store view catches store-page edits (not just create_product). +2 tests (11/11). tsc clean.
- BATCH COMMIT after the Bash-classifier outage recovered: [11]+[12]+[13] landed at 796ed104 (tsc=0, 17/17 tests). My line-by-line self-review during the outage held — zero fixups needed.

**DONE [15]** (20:28 PDT): worklist "Fix-ups" view — surfaces the technical items (crawlability gaps + page-experience/friction fixes) that previously only appeared under "All". `sliceWorklist` case "fixups" (parent==="technical") + WORKLIST_VIEWS entry (auto-renders as a tab). +1 test (12/12). tsc clean.
**DONE [16]** (20:25 PDT): image-alt scan tags each page by commerce kind (Product/Store badge) via the commerce classifier — store-page image gaps stand out. Pushed 157b9a60.
**DOCS** (20:27): HANDOFF B82+ updated to the full 15-slice scope + ready-primitives ledger (fdc69241). Consolidated Sprint-6 regression: 11 files / 76 tests green.

**DONE [17]** (20:35 PDT): product-SEO gaps END-TO-END (plan P8) + adversarial self-review fix.
- Adversarial subagent review of all 14 Sprint-6 files → 13 clean, 1 real (image-alt `as never` cast) → FIXED (added `image_alt_findings` to MoveDraftKind; column is free-text, no migration). 96f39ed0.
- `page-factory/extract-page-seo.ts` (NEW, pure cheerio): `extractPageSeoSignals(html)` → title / meta (og fallback) / hasProductSchema / hasArticleSchema (walks @graph + array @type, tolerant of malformed JSON-LD). +5 tests.
- `image-alt-actions.ts`: the scan now ALSO runs detectProductSeoGaps using the SAME fetched HTML (no extra request, $0) → persists `product_seo_findings` (new free-text kind). loadImageAltReports returns productGaps + productSummary.
- `image-alt-section.tsx`: "Store pages to fix" sub-block (severity + missing schema/meta/title/alt). Engine [13] now consumed end-to-end. tsc clean; 30 page-factory tests green.

**VERIFY** (20:36 PDT): 2nd adversarial review — integration seams into existing files (today-moves-data debate attach, today-moves-card panel, worklist crawlGaps wiring, image-alt-actions product-SEO wiring, page.tsx section mounts). Verdict: **no runtime bugs** — `debate` is always populated on the single hero construction path (card guards anyway), all loaders fail-soft with correct empty shapes, both saveMoveDraft calls catch, new sections are Suspense-wrapped + self-hide. Consolidated Sprint-6 regression: 12 files / 82 tests green.

### STATE @ 20:36 PDT (honest)
17 logical slices landed on `claude/sprint-6-profound-deep` (head 61fcf6b0), each tsc-clean + tested; full-stack `npm run build` green; 2 adversarial reviews clean (1 fix). Every Sprint-6 engine is consumed by a real surface. The safe **$0 / no-migration / no-publish / no-risky-surface** envelope is now comprehensively built. Remaining master-plan levers all require an operator gate: **migrations** (GA4 revenue, Profound raw-answers, operator-feedback `reason` columns + experiment columns), **paid APIs** (DataForSEO Keywords/Labs/Maps, structured-LLM-into-prod, top-N auto-prepare), or **risky tested surfaces** (CMS-publish-path adapter extraction, fold opinions into the pure scorer, Clarity-router score-override in the friction trigger). Per the hard rules these are NOT done autonomously. FINAL HOUR (after 23:00 PT): full `npm run test` gate on the stack, fix any breakage, stage for review — no merge, no deploy.
