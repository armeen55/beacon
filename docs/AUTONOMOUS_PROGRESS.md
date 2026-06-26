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
