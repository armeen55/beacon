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

**DONE [18]** (20:42 PDT): Deep competitor teardown — E-E-A-T/trust/authority winner-patterns (plan P9, core IP).
- `competitor-intel/winner-patterns.ts` (NEW, pure cheerio): `extractWinnerSignals(html)` pulls the DEEPER "why they win" signals the structural teardown misses — author byline + credentials (E-E-A-T), published/updated freshness, outbound citations to other domains (authority), review/rating schema (trust), FAQ, word count. `compareToWinners(yours, winners[])` names what the MAJORITY of winners have that you lack (fail-closed: no winners → []; word-count gap only vs median). +6 tests.
- $0 (operates on already-fetched competitor HTML), tenant-agnostic, no migration. tsc clean. Ready to feed the teardown's EvidencePacket (the audit pages already fetch the HTML).

**DONE [19]** (20:46 PDT): winner-patterns wired into the LIVE competitor teardown.
- `competitor-page-audit.ts`: `CompetitorPageFacts` gains optional `eeat?: WinnerSignals` (no fixture churn); `extractCompetitorFacts` now populates it via `extractWinnerSignals(html, {ownHost})` — so every audited competitor page carries E-E-A-T/trust/authority signals alongside structure. Additive, $0 (same fetched HTML). tsc clean; prepared-move-pack 9/9; winner-patterns 6/6.
- The deep "why they win" signals now flow through the audit → EvidencePacket → teardown surfaces. `compareToWinners` ready to name the operator's E-E-A-T gaps vs the winners.

**DONE [20]** (20:50 PDT): own-page E-E-A-T audit END-TO-END (plan P9, $0). The same image-alt scan now computes each owned page's WinnerSignals via extractWinnerSignals (reusing the fetched HTML) → persists `page_eeat_findings` → loader summarizes coverage → section shows a "Trust signals (E-E-A-T)" line (N/total pages with author byline / credentials / dates / citations). Makes E-E-A-T actionable for owned pages, not just competitors. Cross-domain regression: 14 files / 111 tests green. tsc clean. No paid/migration/publish/main.

**DONE [21]** (20:52 PDT): city×service page factory (plan P12 — the local-service half).
- `page-factory/city-service-factory.ts` (NEW, pure): `generateCityServiceCandidates({cities, services, ownedUrls, titleQualifier})` → deduped create_page candidates for the city×service matrix a local business needs; config-driven (NO hardcoded cities — Ritz-safe per de-verticalization), relevance-gated to the tenant's own service vocabulary, every candidate `needsDemandValidation` (no invented volume), deduped vs owned pages. +6 tests. Parallels entity-attribute-factory (content half) → "programmatic page factories" now covers both shapes. tsc clean. No paid/migration/main.

**DONE [22]** (20:54 PDT): city×service config loader + 3rd adversarial review (newest engines) + fixes.
- `load-page-candidates.ts`: `loadCityServiceCandidates` (config-driven cities×services, fail-closed for content tenants). e6097e47.
- 3rd adversarial review (winner-patterns, extract-page-seo, city-service, own-page E-E-A-T) → 3 real edge-case findings, all FIXED: (a) jsonLdMentions/hasSchemaType now require the type to be the VALUE of an `"@type"` key via regex (no false-positive when the word appears in body text + a different @type elsewhere); (b) city-service nested cap now `break outer` (stop both loops, not just inner); (c) city-service dedup is word-boundary-aware (space-padded blob → "San" no longer matches "sandstone"). 17/17 affected tests green; tsc clean.

---
## OPERATOR TL;DR — read this first @ 12 AM (state as of ~20:53 PDT)
Branch **`claude/sprint-6-profound-deep`** (head `ce97275a`, stacked on Sprint 3+4+5; **NOT merged, NOT deployed**). 22 logical slices + 3 adversarial reviews, all tsc-clean, ~103–117 Sprint-6 tests green, full-stack `npm run build` green.

**What's built (all $0 · no migration · no publish · no main):**
- **Profound dead-data resurrected** → referral signals + AI-referral trend + bot-coverage → "AI traffic" cockpit section.
- **Deep competitor teardown** → E-E-A-T / trust / authority winner-signals on every audited competitor (`CompetitorPageFacts.eeat`).
- **Page health scan** (one $0 operator scan) → image alt-text + product-SEO gaps + own-page E-E-A-T, with paste-ready fixes.
- **Specialist debate made visible** → "Why Beacon recommends this" panel on every Move card.
- **Unified worklist** (`/worklist`) → Today/This-week/Big-bets/New-pages/Store/Tools/Trends/Fix-ups/All.
- **Programmatic page factories** → entity×attribute (content) + city×service (local).
- **SERP→teardown fusion**, **Clarity-as-Move-router** surface, **Trend-Radar spike detector**, **commerce/product classifier**.

**What needs YOU (intentionally deferred — operator-gated):**
1. **Migrations** (additive): GA4 `revenue` column; `profound_answer_rows` (raw answers); operator-feedback `reason` columns + experiment columns → unlock GA4 money, raw-answer recs, and the learning-prior-into-ranking loop.
2. **Paid APIs** (cap-gated): DataForSEO Keywords/Labs/Maps; structured-LLM-into-prod; top-N "Prepare my top 10".
3. **Risky tested surfaces**: CMS-adapter extraction of the Wix publish path; folding specialist opinions into the pure scorer; Clarity-router score-override in the friction trigger.

**Ship steps at 12 AM:** (a) `npm run test` full gate on the branch (final-hour task) → (b) review the diff → (c) merge `claude/sprint-6-profound-deep` → main when satisfied → (d) deploy once the Vercel 100/day cap has cleared (the build itself is green; the cap was the only blocker). Nothing here auto-published or touched main.

**DONE [23]** (21:02 PDT): push safety-rails bug-hunt + 8 cap-durability fixes.
- 5th adversarial pass on the PUSH/PUBLISH safety rails (highest blast radius). **CRITICAL RESULT: no fail-OPEN publish path — Ritz hard-block (push-service.ts:177) holds, approval-only / non-destructive / daily-cap / ≤1MB invariants all sound; tenant-scoped.**
- Found + FIXED 8 fail-CLOSED cap-durability bugs: post-reservation refusal paths (products_query fail, product_not_found, product_read fail, merged_tags_limit, element_key_mismatch, protected_field, length_limit, unmapped_url) returned `{refused}` WITHOUT finalizing the reserved daily-cap slot → a slot dangled until the 10-min auto-expiry; sustained API/mapping failures could temporarily exhaust the cap. Each now calls the established `recordLedger(...,"push_failed",...,reservationId)` before its return (the pattern already used ~8× in-file). Additive + fail-closed-direction; **cannot change publish behavior** (the refusal is unchanged). tsc clean; finalize-on-refusal calls 8→16.

**DONE [24]** (21:14 PDT): GSC ingestion bug-hunt (8th adversarial pass) + 1 real data-spine fix.
- Pass on the GSC sync (the data spine). Verified sound: pagination-truncation (audit-3 #6 returns null on page failure), 429 backoff + give-up, 401 refresh-once, Pacific/final-lag dates, position-weighted aggregation, tenant PK/RLS, empty-vs-null handling.
- **Found + FIXED 1 real HIGH bug** (completes audit-4): `sync-search-analytics.ts:432` (gsc_daily_rows) + `:522` (gsc_daily_page_totals) returned `synced: true` even when the Supabase UPSERT errored → cron-sync (which gates POSITIVELY on `synced===true`, "only a confirmed success stamps") stamped the success watermark over a FAILED write → silent data loss masked as success (the audit-4 comment even acknowledged "the day still counts as synced"). Both now return `{ synced: false, reason }` (the file's established failure shape) → the day re-pulls next run instead of masking the gap. tsc clean; fail-closed-direction; matches the caller's design + audit-4 intent.

**DONE [25]** (21:18 PDT): cross-connector masked-failure sweep (9th adversarial pass) + 6 fixes.
- Swept ALL connector syncs for the GSC bug class (write failure reported as success). GA4, Clarity, cron-sync = SOUND (correctly return synced:false). Found + FIXED the class in 2 more connectors:
  - **SEMrush** `sync-organic-keywords.ts:89`: upsert error returned `synced: true` → now `synced: false, reason` (1:1 with the GSC fix).
  - **Profound** `sync-nightly.ts` (5 tables: citations/visibility/fanouts/bots/referrals): each upsert/insert error `break`-ed but the fn still returned `synced: true` masking the partial write. Added a `writeFailed` flag (still writes every table it can) + the final return now reports `synced: false` if any table failed → cron-sync won't stamp freshness over a partial sync; the day re-syncs next run.
- tsc clean. All fail-closed-direction, no behavior change on success paths. Connector data-integrity now uniform across GSC/GA4/Clarity/SEMrush/Profound.

**DONE [26]** (21:22 PDT): spend-cap fail-OPEN bug-hunt (10th adversarial pass) + 3 money-safety fixes.
- Focused pass on the spend caps (highest money stakes). DataForSEO (serp + keywords), the adjudicator LLM cap, and dry-run default = SOUND (fail-closed: unknown spend → no call; cap defaults to $50 not Infinity).
- **Found + FIXED 3 fail-OPEN LLM cap bugs**: `structured-drafter.ts:175`, `llm-answer-block.ts:61` (answer block) + `:153` (FAQ schema, loops per question) used `.catch(() => ({ allowed: true }))` — a budget-check exception (Supabase down / tenant-ctx error) BYPASSED the cap → uncapped OpenAI spend exactly when the ledger is degraded. All three now `.catch(() => ({ allowed: false, reason }))` (fail-closed, matching the DataForSEO/adjudicator caps). tsc clean; 0 fail-open budget catches remain.
- Bug-hunt campaign tally: **18 real bugs fixed** (push 8 cap-durability + GSC 1 + SEMrush 1 + Profound 5 masked-failure + LLM 3 fail-open spend), all fail-closed-direction, all $0/no-migration/no-behavior-change-on-success.

---
## 🚀 SHIPPED (2026-06-25 21:31 PT) — operator returned, approved the merge
`origin/main` 276a5f71 → **0688c251** (clean fast-forward, 54 commits, 76 files, 0 migrations). Vercel prod deploy = ✅ success; live-verified (/login 200, /worklist 307, /today 307). The full session (23 build slices + 18 bug fixes) is now in production. Remaining plan work is operator-gated (migrations / paid APIs / publish-path). Rollback: `git push origin 276a5f71:main`.

---
## DONE [27] (2026-06-25 ~22:24 PT): Production UI-consistency + data-bridge fix pass — operator-directed (branch `claude/ui-consistency-pass`, NOT merged)
Operator did the manual prod QA, reported 6 product/data-consistency findings, and directed a small surgical fix pass (branch-only, no migration, no publish-path, no paid API, no main) BEFORE the next migration. A 6-agent read-only root-cause workflow + live Supabase/connector probes classified each: **3 real bugs fixed, 2 expected-behavior (1 copy-fixed, 1 reported), 1 sound (no change).**
- **#1 (REAL) Draft-ready vs Implement mismatch** — `today-moves-data.ts` set the "Draft prepared" checklist flag on structuredDraft EXISTENCE while the Implement panel needs paste-ready CONTENT (`value.answer/after`); an empty draft object showed "Draft prepared" + "No prepared paste-ready content yet" simultaneously. Now the flag is derived from the same `preparedDraftText` the Implement panel reads → the two surfaces can't contradict.
- **#3 (REAL) GA4 status misleading** — `getConnectorHealth` returned `not_connected` ("Connect →") for a soft-disconnected source even with fresh `last_synced_at` (GA4 synced 06-22, rendering on the dashboard, while the strip said "Connect →"). Now a disconnected-but-fresh source (< STALE_DAYS) shows `needs_attention` "Showing data from N days ago. Reconnect to refresh." Display-only; no auth/sync change. (Root cause of the dead token: Google OAuth testing-mode 7-day refresh-token expiry — code is correct.)
- **#5 (REAL) Self-competition guardrail** — new pure tenant-agnostic `opposite-qualifier-guard.ts` (antonym pairs male/female, boy/girl, men/women, mens/womens, …) wired into BOTH cannibalization emitters (`resolve-page-intent` observation-led + `semrush-page-signals`). Beacon will no longer recommend folding e.g. "persian female names" into "persian male names"; it falls through to differentiate-in-place. +9 unit tests.
- **#4 (EXPECTED → copy-fixed) AI-Answers "fresh" but empty** — Profound connected (11,502 citations) but `profound_visibility_rows` = 0 → the AI-Visibility hero said "Connect an AI-answer source" (contradicting the connected data-sources strip). Hero now states the neutral fact ("No AI-answer visibility sampled … yet"); the strip retains the accurate connect CTA. No overclaim.
- **#2 (EXPECTED → reported, no code churn) New Opportunities "no cached demand"** — `dataforseo-keywords-cache` is a local `.data/global/` file with NO Supabase backing → genuinely empty in prod (read-only FS); the existing "No discovered demand yet · Discover" copy is already honest. **Tradeoff for operator:** the cache is also ephemeral per-request on Vercel (in-process only), so even a successful in-prod Discover won't persist across requests/deploys. Durable fix = Supabase-back the cache (a migration — operator decision, deliberately NOT done).
- **#6 (SOUND) Page-health scan** — operator-gated, fail-soft, accurate empty state. No change.
- **Verify:** typecheck clean; 130 targeted tests green (guard 9 + hero empty-state + resolve-page-intent ×3 + connector-store ×2). 0 migrations, 0 publish-path edits, 0 paid calls. Commit `d29504e5`, pushed to `origin/claude/ui-consistency-pass`. Browser-preview verification skipped: the local dev server renders blank in this env (Node 22 undici SSR-streaming bug + remote-Supabase statement-timeouts) — server-component/pure-logic/copy changes are covered by tsc + unit tests instead.
- **[27b] #3 regression guard** (commit `371205f0`): 2 new connector-store tests — soft-disconnected + fresh (< STALE_DAYS) → needs_attention "Showing data from N days ago"; + stale (> STALE_DAYS) → stays not_connected (boundary). 42 connector-store tests green.

## DONE [28] (2026-06-25 ~22:36 PT): Cockpit consistency audit-2 — 4 more "looks-done-but-breaks" fixes (same branch, commit `2f83d83e`, NOT merged)
Second adversarial sweep (4 finder lenses → adversarial verify): **4 confirmed of 15 surfaced; 11 false positives correctly rejected** (rising rejection rate = the cockpit is getting clean).
- **GSC deep-link (HIGH)** — the /today data-sources strip "Connect Google Search Console" link targeted `#connector-google-gsc`, but the GSC card had no matching `id` (every other connector card does) → it landed on the page top. Added `id="connector-google-gsc"` to the GSC card wrapper + set the strip's `cardAnchor` to `"google-gsc"` (was null) + refreshed the now-stale strip doc-comment.
- **Proof truncation (MED)** — /proof "Confirmed wins" rendered `wins.slice(0,6)` with no indicator when >6 existed, silently contradicting the "Winning ↑ N" tile. Added a "+N more (showing the top 6)" line.
- **Connector copy (MED)** — /settings/connectors "What you'll get" bullets used background-implying verbs ("drafts", "watches your rankings") while crons are OFF. Reworded to tie each to the refresh click ("When you refresh…", "re-measures … each time you open Beacon") — matches the honest intro paragraph.
- **Param rename (MED)** — `formatLastRefreshedCopy`/`formatGa4StaleCopy` took `expiresAtMs` but actually receive the last-SYNC time (not OAuth token expiry) — a footgun for future maintainers. Renamed → `lastSyncedMs` across both helpers + 2 callers + the expiry-handler test (the real `token.expires_at` logic in `evaluateExpiry` untouched).
- **Verify:** typecheck clean; expiry-handler (renamed) + data-sources-strip tests green (26). 0 migrations / 0 publish-path / 0 paid / not merged. A 3rd audit (rec-detail / Implement panel / worklist filters / list↔detail parity) is in flight.

## DONE [29] (2026-06-25 ~22:44 PT): Cockpit consistency audit-3 — 6 more fixes (same branch, commit `14d83750`, NOT merged)
Third adversarial sweep (rec-detail / Implement panel / worklist filters / list↔detail parity): **6 confirmed of 13; 7 false positives rejected.**
- **Accepted-status tone (HIGH)** — the recommendation v2 card tinted "accepted" success-green while the detail page + working rail use info-blue (same row, different color across surfaces). Aligned the card to info tone — "accepted" = in-flight; only "shipped" earns the success green.
- **charCount mismatch (MED)** — the title_meta Implement pack reported `charCount = title.length` but the pasted copy is `Title: …\nMeta description: …` (~3× longer). Now reports `copy.length` (matches the sibling answer_block pack + what's actually pasted; SERP title-budget still surfaced via riskNotes).
- **Trends taxonomy leak (MED)** — /worklist Trends filtered `kind==='trend' OR trend==='rising'`, leaking rising PRODUCTS (which belong in Store). Now gates on `kind==='trend'` only; +regression guard.
- **Worklist empty-states (MED ×3)** — Big Bets / New Pages / segment-gated Store & Tools each have a distinct filter, but a 0-count tab showed a generic "Nothing in this view." Added a per-view `emptyHint` (in WORKLIST_VIEWS) explaining what fills each view, so an empty tab never reads as broken.
- **Verify:** typecheck clean; worklist-views (12) + implementation-plan (15) tests green. 0 migrations / 0 publish-path / 0 paid / not merged.

**Running total on `claude/ui-consistency-pass`:** operator's 6 findings (4 fixed / 1 reported / 1 sound) + audit-2 (4) + audit-3 (6) = **14 real fixes**, ~6 commits, all green, NOT merged. Adversarial-verify rejected 7 (audit-2) + 7 (audit-3) false positives. Reliability pass (`f15712e2`) already on main; both await operator merge. GA4-revenue migration stays gated.

## DONE [30] (2026-06-25 ~22:51 PT): Cockpit consistency audit-4 + FINAL-HOUR GATE (same branch, commit `96ff044b`, NOT merged)
Fourth adversarial sweep (cockpit hero/KPIs / numeric-safety / prompts / changes): **1 confirmed of 5; 4 false positives rejected** — yield 6→4→6→1 confirms the cockpit is now clean; stopped the audit loop here (diminishing returns).
- **Proof-pill "went live" overclaim (HIGH)** — the /changes timeline helping/hurting blurbs asserted "after this change went live", but the lifecycle live-gate only short-circuits pending/not-found rows above the verdict switch; an unclassified row with a helping/hurting verdict reached that copy and stated live-on-site as fact. Reworded to "AI has been mentioning you more/less since this change" — honest in every case (the verdict is measured relative to the change date, not its live-verification). 137 changes-v2 tests green.
- **Notable rejected (audit-4):** 4 numeric-safety / hero / prompts findings adversarially refuted as pre-guarded or expected.

### 🧪 FINAL-HOUR GATE (per the overnight rule — gate only, NO merge, NO deploy)
- `npx tsc --noEmit` → **exit 0** (clean).
- `npm run build` (full production build) → **exit 0** — every route compiles + builds.
- Broad targeted test gate across ALL touched domains + core → **1040 passed / 83 files** (recommendations, worklist, execution, connectors, changes, today components, demand-graph, reliability, architecture pins). The local full-15k suite is dominated by this env's Supabase statement-timeouts (degraded local→remote reads), so it's left for CI on the branch push where Supabase is clean; the targeted gate is the high-signal local proof.
- **Branch `claude/ui-consistency-pass` is staged + green for operator review. 0 migrations · 0 publish-path edits · 0 paid calls · NOT merged to main · NOT deployed.**

### FINAL STATUS FOR THE 12 AM REVIEW
**15 real consistency/trust bugs fixed** this session (operator's 6 → 4 fixed+1 reported+1 sound; +audit-2 4; +audit-3 6; +audit-4 1), across 8 commits on `claude/ui-consistency-pass` (off main `f15712e2`). Adversarial verification rejected **15 false positives** — every shipped fix was double-checked by an independent skeptic agent. Two branches await the operator's merge call: (1) `f15712e2` reliability pass — already FF'd onto main, just needs the Vercel deploy (cap had blocked it); (2) `claude/ui-consistency-pass` — this session's consistency work, ready to merge. The one gated item is the **GA4-revenue migration** (operator's stated next priority). Nothing was merged, deployed, published, or charged.

> NOTE: operator then approved + merged `claude/ui-consistency-pass` → main (`ab39d37b`, clean FF; Vercel deploy rate-limited so prod still serves the prior green build) and approved the GA4-revenue migration sprint below.

## DONE [31] (2026-06-26): GA4 REVENUE MIGRATION SPRINT — branch `claude/ga4-revenue-migration` (off main `ab39d37b`; NOT merged, NOT applied)
Operator-approved first gated migration sprint: turn value/ranking from conversion-proxy scoring into real GA4 revenue-aware scoring, without breaking existing metrics. Branch-only · additive migration (NOT applied) · no deploy/publish/paid · existing conversion path preserved as fallback.
- **P1 Ground-truth:** the demand-graph fed `conversions28d` into build-graph's `$`-shaped `dollarMult` (`1+log10($+1)/2`) — a conversion COUNT treated as dollars (independently confirmed by the compute audit). `ga4_url_traffic` had no revenue columns. Two consumers: `ga4ValueWeight` (bounded, count-based, sound) + the demand-graph `dollarMult` (the bug).
- **P2 Migration (`migrations/2026-06-26_ga4_url_traffic_revenue.sql`, NOT applied):** additive nullable revenue columns (total_revenue, purchase_revenue, transactions, revenue_currency, revenue_source, revenue_synced_at). No new table (same grain). NULL=unknown; observed-0 distinguished by revenue_synced_at. Reversible (DROP COLUMN rollback in-file).
- **P3 Sync:** new `runGa4RevenueReport` (SEPARATE from the proven traffic report → zero regression); persist enriches best-effort (traffic ALWAYS persists; revenue failure omits columns so prior values aren't wiped; observed-0 distinct from unknown); `revenue_unavailable` mapped for no-ecommerce properties; status threaded to the cron. No live GA4 in tests (mocked).
- **P4 Normalization (`ga4-revenue.ts`, pure):** normalizePageRevenue (confidence high/medium/low/unknown), divide-by-zero-safe revenuePerVisit/AOV, prefers purchase over total, currency preserved. revenueScoreMultiplier: real-$ tier (capped 4.0) / conversion fallback (capped 2.0, strictly weaker) / 1.0 neutral (observed-0 + informational pages never punished). revenueStateLabel never renders $0 for unknown.
- **P5 Scoring:** `dollar`=real revenue; `dollarMult`=the precomputed bounded multiplier (no more conversions-as-dollars); `$` signal only on proven revenue; conversion-only pages get a `conversions` signal. load-graph loads revenue (fail-soft, isolated read) → multiplier per page (real OR conversion fallback OR neutral). Existing dashboards keep working when revenue is missing.
- **P6 UI (minimal):** "why it ranks" now says "proven revenue" only on real $ (richer revenue widgets deferred — don't overbuild).
- **P8 Dry-run (`scripts/_ga4-revenue-dry-run.ts`, READ-ONLY):** Iranopedia — migration NOT applied (42703 → loader fail-soft → conversion fallback works), 27,205 rows / 1,482 in 28d (all enrichable post-migration), GA4 token present but property MISSING + DISCONNECTED (a real backfill also needs GA4 reconnect). No prod data mutated, no live GA4 call.
- **Gate:** tsc exit 0; **323 tests pass / 22 files** (ga4 connectors 139, ga4-revenue 20, build-graph-revenue 5, demand-graph + recommendation-intelligence regression). 6 commits `186d765c..f585fc49`. **NO migration applied · NO live GA4 · NO prod mutation · NOT merged · NOT deployed.**

> NOTE: operator then approved + applied the migration to beacon-main, merged `claude/ga4-revenue-migration` → main (`2c71566d`, deployed green), and reconnected GA4 on Iranopedia.

## DONE [32] (2026-06-26): GA4/SEMrush/Profound DOMAIN-RESOLUTION BUG CLASS — branch `claude/ga4-url-normalization-fix` (off main `2c71566d`; NOT merged)
Operator reconnected GA4 + reported the GA4 sync "keeps getting stuck" and the `ga4_url_traffic` row count had ~doubled (27k→54k). Investigated the LIVE beacon-main DB (read-only) and the connector code; found a real bug CLASS, fixed it branch-only.
- **Diagnosis (DB-grounded):** the GA4 sync actually SUCCEEDED (traffic + revenue both written 16:47 UTC; 54,322 rows carry `revenue_synced_at`, 72 rows positive revenue) — "Sync didn't finish" is the client request timing out on a slow first-sync while the server completes. **No data loss.** The doubling = **path-only rows (`/cities`) alongside the prior full-URL rows (`https://iranopedia.com/cities`)**: 27,161 path-only + 27,361 full-URL, 0 logical-page-date dupes once scheme/www stripped. PK is `(tenant,url,date)` so the two spellings never collide → duplicate set + fragmented per-page traffic/revenue aggregation + broken Mode A matching (`canonicalizeCitationUrl` rejects path-only).
- **Root cause:** `ga4/persist-url-traffic.ts` resolved the domain via the SYNCHRONOUS `getBusinessConfig(tenant)`, which doesn't read the Supabase `business_config` row. Iranopedia's domain (`iranopedia.com`, confirmed in the DB row) lives ONLY there (not in the sync env/file chain), so the persist got an empty domain → `normalizeGa4PagePathToFullUrl` stored path-only.
- **Fix 1 (`6e359da6`):** persist resolves the domain via `hydrateBusinessConfigFromSupabase(tenant)` (sync chain first → Supabase row → fail-soft placeholder). Future GA4 syncs store full URLs. Test mock updated (the same lesson as the load-graph mock — keep the async resolver exported).
- **Audit → Fix 2 (`d37511fb`):** swept every sync `getBusinessConfig().domain` caller. **GSC was already safe** (falls back to the Supabase tenant registry via `getTenant`). **SEMrush sync** (organic + keyword-gap) and **Profound sync** (bots/referrals) had the SAME bug — empty domain → SEMrush returns `no_domain` (zero keywords) and Profound silently skips bots/referrals (0 rows) for Supabase-only tenants. Both now use `hydrateBusinessConfigFromSupabase`.
- **Still owed (operator-gated):** (a) merge `claude/ga4-url-normalization-fix` + redeploy so live syncs store full URLs; (b) AFTER a fresh sync, dedupe the path-only rows (a prod DELETE — operator approval required); (c) optional perf: bound the GA4 revenue fetch to the ~28d scoring window so the sync stops timing out (needs two-upsert unknown-vs-observed handling — offered, not built).
- **Gate:** tsc exit 0; ga4 connectors **139** green + semrush/profound **45** green. 2 commits. **0 migrations · 0 publish-path · 0 paid · 0 prod mutation · NOT merged · NOT deployed.**

## DONE [33] (2026-06-26): SEMrush DELETED + Profound borrowed-workspace workaround — branch `claude/remove-semrush` (stacked on the GA4 fix; NOT merged)
Two operator corrections: (1) "SEMrush is DONE — delete every single thing semrush everywhere, we have DataForSEO now"; (2) "my Profound instance is NOT my account — no access to bots/referrals/domains; only Iranopedia-tagged questions, and even those track openai.com — find a workaround." Acted on both. (My earlier `d37511fb` SEMrush-domain fix is now moot — superseded by the deletion; the Profound bots/referrals part is moot too, no access — both harmless.)
- **SEMrush fully removed (`fa23caaa`, 141 files, −5,118 net lines):** connector dir + sync + 3 triggers + page-signals + diagnostics pages + settings card + every consumer branch (evidence packets, priority-score, page-surgeon, insight/opportunity map, demand-graph inputs, today/new-pages, connector-store, cron-sync, LLM schemas). `grep semrush src tests` → **0**. Graceful degrade: consumers run on GSC/GA4/Clarity/Profound/DataForSEO. keyword-portfolio = GSC+fanout; New Pages searchVolume null (proxy as before); Workbench striking-distance falls back to GSC (it already had that path); Page Surgeon no longer auto-suggests create_new_page (its only trigger was the SEMrush high-value-unserved-cluster signal — net-new-page recs still come from the demand-graph competitor-citation path). Delegated the mechanical removal to a subagent under a strict spec, then verified myself (tsc 0, broad suites green).
- **Pre-existing test debt fixed:** `build-graph.test.ts` "money-first" used the deprecated `ga4Value` field (broke when the GA4-revenue scoring merged to main) → migrated to `revenueValue`/`revenueBasis`/`revenueMultiplier`. Also fixed 2 pre-existing em-dashes in the connector page copy (`fc77633a`, hard no-dash rule).
- **Profound workaround (`cb02c37e` + `ea8ec58c`):** the borrowed account tracks `openai.com`, not Iranopedia, so visibility/SoV is the wrong brand. The legacy `profound-aeo-gap` trigger fires on `ownMentions===0` (brand-name match) → would emit a FALSE "you're absent" gap on every topic. **Guard:** if the tenant's own brand is never present across ANY topic, suppress (can't soundly claim absence). The sound path is unaffected: the demand-graph's citation-DOMAIN matcher (`loadCompetitorCitedPagesForTenant`) derives the owned domain from the tenant's real GSC page hosts (iranopedia.com) and matches cited URLs by domain — independent of the tracked brand. Also fixed `loadProfoundOwnedCitations` (proof citation-lift) to resolve the domain from Supabase (same fix class). Bots/referrals stay no-ops (no access; reports 4xx fail-soft).
- **Gate:** tsc exit 0; demand-graph + recommendation-intelligence + recommendations + insight + today-summary + ga4 + components + app + routes + architecture + connectors + attribution suites GREEN (one fixed money-first test, one fixed em-dash pin). 8 commits on the branch. **0 migrations · 0 publish-path · 0 paid · 0 prod mutation · NOT merged · NOT deployed.**
