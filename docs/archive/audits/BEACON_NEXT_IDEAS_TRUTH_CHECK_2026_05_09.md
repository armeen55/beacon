# Beacon — Remaining-Ideas Truth Check (2026-05-09)

> Purpose: stop future agents from re-litigating the original brutal audit's
> stale claims. This file is the single index of "what was wrong / what is
> done / what is real next." Do **not** treat older sprint-report markdowns
> as truth without verifying against current code, schema, and git log.
>
> Originals this supersedes (read sceptically, not as truth):
> `docs/BEACON_BRUTAL_FRESH_EYES_AUDIT_2026_05_08.md` and the 50+ sprint
> reports in `docs/`.

---

## A. Original audit claims now **proven false**

| Original claim | Verified-false because | Where to confirm |
|---|---|---|
| "Lifecycle loop is OFF — `BEACON_LIFECYCLE_ENABLED=0`, no `live_at` ever auto-stamps." | The audit's grep used a regex without whitespace tolerance and silently returned 0 matches. Re-grep with whitespace-aware regex finds populated `live_at` rows; lifecycle is **underfed** (small N), not off. | `recommended_edits.live_at`, `recommendation_responses.responded_at` — query directly in Supabase rather than trusting the audit. |
| "Every rec has `engineConfidence: 'medium'` — queue is sorted by `created_at DESC` and dressed up as ranked." | Audit conflated the operator-side `edit_confidence` enum with the engine-side `engineConfidence`. The Phase A `prioritize.ts` score is computed; the visible queue uses it. The "Why ranked here?" disclosure ([07ec048](https://github.com/armeen55/beacon/commit/07ec048)) was added to surface this. | `src/domains/recommendations/prioritize.ts`, `src/domains/recommendations/recommendation-action-rows.ts` — read end-to-end before re-claiming. |
| "Zero RLS policies — `migrations/` has no `CREATE POLICY` statements." | Baseline schema dump committed at [11101a2](https://github.com/armeen55/beacon/commit/11101a2) showed 72 policies (36 deny_anon + 35 deny_authenticated + 1 members_self_read). Phase 1 then **refined** them: as of 2026-05-09, 17 of 18 Cat-A tables run under `tenant_authenticated_rw` + `is_tenant_member(tenant_id)` (E0, E0.1, E1.A, E1.B applied). | `migrations/2026-05-08_baseline_schema.sql`, `migrations/2026-05-1*_phase1_*.sql`, `pg_policies` live. |
| "44 domains, 41 routes — looks like internal tooling." | Customer-nav exposure was audited and locked; surface-area cleanup landed at [9b66658](https://github.com/armeen55/beacon/commit/9b66658). The "44 domains" raw count is real but most are internal modules; what the customer sees is 4–5 routes by design. | `src/app/(shell)/layout.tsx` + the customer-surface contract test. |
| "4 production files have `tenant_id: ''` placeholders." | Re-sweep on 2026-05-08 found **36+ sites across 25+ files**, not 4. Stage D1/D2/D3 cleared them across 22 distinct production sites plus 5 scripts. Architecture tests now ratchet against the literal. | `tests/architecture/no-tenant-id-empty-string-literals.test.ts`, commits [b8f238f](https://github.com/armeen55/beacon/commit/b8f238f), [6393845](https://github.com/armeen55/beacon/commit/6393845), [b46c66d](https://github.com/armeen55/beacon/commit/b46c66d). |

---

## B. Original audit ideas **already completed** (or in flight and verifiably progressing)

| Idea | Status | Commit / file |
|---|---|---|
| Kill the `add_h2_section` competitor-name template | ✅ done | [b531a97](https://github.com/armeen55/beacon/commit/b531a97) — replaced with buyer-perspective H2 |
| Populate `competitorPageBlueprints[]` (h1/topH2s/faqQuestions) | ✅ plumbing + guarded scanner shipped | [9919594](https://github.com/armeen55/beacon/commit/9919594), contract test [2e377f9](https://github.com/armeen55/beacon/commit/2e377f9) |
| Cut customer-nav clutter / hide diagnostics behind operator mode | ✅ done | [9b66658](https://github.com/armeen55/beacon/commit/9b66658) + customer-surface contract test |
| Lifecycle visibility on /today (live-changes detail block) | ✅ done | [1c4bb3b](https://github.com/armeen55/beacon/commit/1c4bb3b) |
| "Why ranked here?" customer-facing disclosure | ✅ done | [07ec048](https://github.com/armeen55/beacon/commit/07ec048) |
| Stage B/C — additive `tenant_id` + nonempty CHECK on 19 tables | ✅ applied to prod | [00c9550](https://github.com/armeen55/beacon/commit/00c9550), [9334848](https://github.com/armeen55/beacon/commit/9334848) |
| Stage D — drop `tenant_id: ""` placeholders at 22 sites + factory tenantId requirement + 4 ratchet tests | ✅ done | [b8f238f](https://github.com/armeen55/beacon/commit/b8f238f), [6393845](https://github.com/armeen55/beacon/commit/6393845), [b46c66d](https://github.com/armeen55/beacon/commit/b46c66d) |
| Stage E0 — `is_tenant_member(text)` helper (SECURITY DEFINER, pinned search_path) | ✅ applied | [c1936ed](https://github.com/armeen55/beacon/commit/c1936ed) |
| Stage E0.1 — REVOKE anon EXECUTE on helper | ✅ applied | [1158b9f](https://github.com/armeen55/beacon/commit/1158b9f) |
| Stage E1.A — `tenant_authenticated_rw` on 5 Cat-A1 tables | ✅ applied + verified post-scan | [d236688](https://github.com/armeen55/beacon/commit/d236688) |
| Stage E1.B — `tenant_authenticated_rw` on 12 Cat-A2 tables | ✅ applied | [0d8e84f](https://github.com/armeen55/beacon/commit/0d8e84f) |
| Stage E1.C — Cat-B 7 tables | drafted, NOT applied | [78e21eb](https://github.com/armeen55/beacon/commit/78e21eb) |
| Stage E1.D — dual-key 3 tables | drafted, NOT applied | this commit |

**Net result vs. the original audit:** five of the audit's "top 10 highest-leverage changes" have been substantively executed, partially executed, or proven mis-specified. The audit is no longer a reliable plan; this file is.

---

## C. Original audit ideas **still likely worth doing**

These survive scrutiny. They are real, undone, and should be sequenced explicitly rather than absorbed into another stream.

### C1. Unified operator-mode flag
Today there are two flags (`BEACON_OPERATOR_MODE` server-side, `NEXT_PUBLIC_OPERATOR_MODE` client-side) doing similar-but-not-identical things. Single source of truth + grep cleanup. ½–1 day.

### C2. LLM budget ledger in Supabase
`.data/global/llm-budget.json` lives on local FS (Vercel ephemeral). One bad deploy = lost ledger. Move to a Supabase table with dual-write or single-write. Add per-tenant `daily_budget_usd` enforcement at the polling entry point (today the env-var default of $5 is honored on trust). 1 day.

### C3. Per-tenant cron / poll strategy
`daily-native-poll.yml` and `daily-scan.yml` already iterate `ops/active-tenants.json` (good). What's missing is the second-customer story: budget isolation, per-tenant rate limiting, recoverable mid-run failures so one tenant's outage doesn't poison the others. Becomes load-bearing at customer #2.

### C4. D3 singleton-per-tenant redesign
`business_config`, `citation_evidence_index`, `answer_intelligence_index` are deployment-singletons keyed `id='current'`. Customer #2 onboarding needs (a) `tenant_id` added, (b) PK change to `(tenant_id, id)`, (c) every reader updated from `WHERE id='current'` to `WHERE tenant_id=? AND id='current'`. **Schema + reader work, NOT a policy clone.** 1–2 days. Block for customer #2.

### C5. `answer_texts` join policy (Stage F-ish)
FK-chained to `prompt_answer_observations.tenant_id`. Today it stays `deny_authenticated` and reads via service-role, which is fine. Only revisit when an authenticated read path needs it. Not blocking.

### C6. Docs rationalization
51 sprint-report markdowns at `docs/` root. New contributors (and future-you) cannot find truth fast. Move to `docs/archive/`, leave a single `HANDOFF_VERIFIED_STATE.md` + this truth-check + the active plan. ½ day.

### C7. Decompose the two monsters
`src/app/(shell)/today-data.ts` (≈2,800 lines) and `src/app/(shell)/recommendations/recommendations-client.tsx` (≈1,700 lines). High-touch surfaces; future regressions land here. Snapshot tests first, then carve. 3–4 days behind a UX-frozen sprint. Not urgent.

### C8. 90-second product demo path
Open /today → click top rec → accept → see /changes verdict. The wedge made tangible, recorded, replayable. Not code work; product-demo work. Single afternoon. Tightens the sales pitch.

### C9. Vercel/observability surface for the operator
GitHub Actions failures (poll/canary) only surface in email today. Surface them in `/diagnostics` as a green/red pill so the operator sees them at-a-glance without checking GH. ½ day.

---

## D. Top 5 verified next-leverage bundles (ranked)

After E1.B has held under one post-apply scheduled scan, these are the highest-leverage moves, ranked by leverage / risk / unlock-value. Apply in order; do not bundle unless explicitly noted.

| # | Bundle | Leverage | Risk | Unlocks |
|---|---|---|---|---|
| 1 | **Stage E1.C — Cat-B 7 tables** (drafted) | High — closes the deny_authenticated → tenant_authenticated_rw migration on the 7 most operator-trafficked tables (competitors, opportunities, page_issues, attribution_decisions, etc.). | Low — structural clone of E1.B which has held cleanly. | Sets up a clean, mostly-deny-authenticated-free Cat-A/Cat-B surface for customer #2. |
| 2 | **Stage E1.D — dual-key 3 tables** (drafted) | High — closes the last clone-able policy bundle. After this, every column-tenant-scoped table is on the selective policy. | Low — same shape as E1.C; isolated bundle so account_id divergence has its own observation window. | Customer #2 multi-tenant gating story is end-to-end. |
| 3 | **C2: LLM budget ledger in Supabase + per-tenant enforcement** | High — turns a "trust me" cost guard into a real one before customer #2 can blow it up. | Low — additive table + a single enforced check at the polling entry point. | Cost honesty / pricing defensibility / safe scale to 2–5 tenants. |
| 4 | **C1: Unified operator-mode flag** | Medium-high — single biggest source of "did I prep customer #2 env correctly?" footguns. | Very low — refactor to one helper, grep cleanup, no DB or product change. | Onboarding hygiene; reduces operator error during customer #2 provisioning. |
| 5 | **C4: D3 singleton-per-tenant redesign — `business_config` first** | High — `business_config` is read on most pages (`getBusinessConfig`); customer #2 onboarding requires per-tenant rows. | Medium — load-bearing read path; needs reader rewrite + careful migration. | Hard prerequisite for customer #2. Do `business_config` first; `citation_evidence_index` and `answer_intelligence_index` can follow with similar shape. |

**Out of the next-5 on purpose** but still on the radar:
- E1.E — `tenant_members` policy refresh. Needs a careful look at whether `members_self_read` already covers the authenticated read path or whether it needs a write-side companion. Solo bundle when there's appetite.
- C8 (90-second demo). Worth doing soon for sales-readiness, but not blocking customer #2.
- C7 (file decomposition). Important for long-term maintainability, not unlock-blocking.

---

## E. Rules for future agents reading this

1. **Do not trust old sprint docs as truth.** If a `docs/BEACON_*_2026-04-*.md` file claims something, verify against (a) live schema via `supabase db query --linked`, (b) current code in `src/`, (c) `git log` since the document's date.
2. **Re-run greps with whitespace-tolerant regexes.** The original audit's `'"live_at":"[^n]'` (no space) silently swallowed positive matches. Always assume `\s*` between JSON keys/values.
3. **Don't conflate `edit_confidence` and `engineConfidence`.** Two separate columns; the original audit confused them.
4. **Don't claim "no RLS" without listing `pg_policies`.** Use `scripts/observe-rls-phase1-state.sh` (read-only) for the live picture.
5. **Don't widen scope mid-bundle.** RLS policy bundles ship as separate, isolated migrations precisely so each one's blast radius stays small.
6. **Service-role bypass is the architectural backstop.** Today, every app code path uses service-role keys; RLS policy changes have zero runtime effect on app traffic. Stop describing RLS work as "tenant isolation" — it's defense-in-depth, not the primary isolation mechanism. Application code's `currentTenantId()` resolution is the primary isolation mechanism.
7. **Static migration drafts are safe to commit and push** even before apply. Push-pause-bake-apply is the rhythm; do not re-litigate it.

---

*This document supersedes the brutal audit as the source of truth for "what's left to do." It does not supersede the live `pg_policies` table or the live code — both remain authoritative.*
