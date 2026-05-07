# Beacon Execution Plan

> 🟢 **GAP C.2 LANDED → GAP C.3 NEXT (2026-05-07).** Self-serve onboarding pipeline progress: Gap A (DB-driven cron) ✅ → Gap B (signup + provisioning) ✅ → Gap C.1 (business profile step) ✅ → **Gap C.2 (scope step — cities + services) ✅** → **Gap C.3 (competitors step) NEXT**. Today: customers sign up at /signup → magic-link → auth-callback provisions pending tenant → /onboard/business collects business name + website (Gap C.1) → /onboard/scope collects cities + project_mix (Gap C.2, NEW) → /onboard/competitors placeholder (awaiting Gap C.3). **Gap C.3 scope**: replace /onboard/competitors placeholder with a real form for `discovered_competitors` (free-text builder names with optional domain hint, min 1, ≤5). Same access-guard + status-gated UPDATE pattern; same architecture invariants (no paid APIs, no activation, no prompts, no second active tenant). On save, redirect to /onboard/review (placeholder). **Gap C.4 scope (later)**: replace /onboard/review placeholder with the Launch step — show a summary, accept TOS, and on confirm flip `tenants.status` from `pending_onboarding` → `active`. That's the only step that activates a tenant. Auto-prompt generation, first-poll trigger, and operator alerts (Gaps D/E/F/G) follow. Full Gap C.2 detail: [`docs/HANDOFF_VERIFIED_STATE.md`](HANDOFF_VERIFIED_STATE.md) + [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-07--self-serve-onboarding-gap-c2-scope-step-cities--services).

> 🟢 **GAP C.1 LANDED → GAP C.2 NEXT (2026-05-07).** Self-serve onboarding pipeline progress: Gap A (DB-driven cron) ✅ → Gap B (signup + auth-callback provisioning) ✅ → **Gap C.1 (business profile step) ✅** → **Gap C.2 (scope step — cities + services) NEXT**. Today: customers sign up at /signup → magic-link → auth-callback provisions pending tenant → /onboard/business collects business name + website (Gap C.1, NEW) → /onboard/scope placeholder. **Gap C.2 scope**: replace /onboard/scope placeholder with a real form for cities served (free-text chips, min 1) + services / project mix (multi-select against `ProjectMixTag` enum, min 1). Same access-guard + status-gated UPDATE pattern; same architecture invariants (no paid APIs, no activation, no prompts, no second active tenant). On save, redirect to /onboard/competitors (placeholder). **Out of scope until Gap C.4**: status flip pending_onboarding → active, prompt creation, first poll trigger, billing. Full Gap C.1 detail: [`docs/HANDOFF_VERIFIED_STATE.md`](HANDOFF_VERIFIED_STATE.md) + [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-07--self-serve-onboarding-gap-c1-business-profile-step-name--website).

> 🟢 **GAP B LANDED → GAP C NEXT (2026-05-07).** Self-serve onboarding pipeline progress: Gap A (DB-driven cron) ✅ → Gap B (public /signup + auth-callback provisioning) ✅ → **Gap C (onboarding wizard) NEXT**. Today: customers can sign themselves up at /signup, get a `pending_onboarding` tenant + `tenant_members` row provisioned automatically, and land on a placeholder /onboard/business welcome page. Cron pipeline ignores them (Gap A's lister filters `status='active'`); operator must explicitly flip `tenants.status` to `active` to start daily polling. **Gap C scope**: replace the /onboard/business placeholder with a 4-step wizard (business name + website → cities/services → competitors → prompt review); persist drafts on the `tenants` row or in a new `tenant_drafts` table; on Launch, flip status `pending_onboarding` → `active` so the next 07:00 UTC cron picks the new tenant up. **Out of scope for Gap C**: auto-detect from homepage crawl (Gap D), auto-prompt generation (Gap E), waiting state (Gap F), operator alerts (Gap G). Full Gap B detail: [`docs/HANDOFF_VERIFIED_STATE.md`](HANDOFF_VERIFIED_STATE.md) + [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-07--self-serve-onboarding-gap-b-public-signup--auth-callback-tenant-provisioning).

> 🟡 **MULTI-TENANT CRON SCAFFOLD LANDED — AWAITING 2026-05-07 07:00 UTC PROOF-RUN (2026-05-06).** `daily-native-poll.yml` + `daily-scan.yml` + `poll-canary.yml` now read tenant identity from **NEW `ops/active-tenants.json`** (single Ritz row, `enabled: true`) via a `compute-matrix` job that **fails loud if Ritz is missing or disabled** — no silent-skip path possible. Poll + scan are matrix-driven; rebuild-citation-evidence-index + verify-persistence + canary are singletons by design (endpoints / scripts are tenant-agnostic today; per-tenant flag is a future bundle when a 2nd tenant is enabled). **Adding a 2nd tenant is a one-line JSON edit** in `ops/active-tenants.json` — no workflow YAML change required. NEW invariant `multi-tenant-cron-scaffold.test.ts` (21/21) pins the new shape; 2 pre-existing invariants updated to match. Profound runtime isolation 114/114 still PASS. Full suite 4731/4731 (was 4710; +21 new); typecheck clean; build green; ledger byte-identical (SHA `d36eed8c…`). Total architecture invariants: **267** (246 prior + 21 new). **GATING VERIFICATION:** tomorrow (2026-05-07) after 07:00 UTC, confirm matrix cron runs Ritz cleanly (4/4 Perplexity + 4/4 ChatGPT) or reports honestly. Customer-2 infrastructure work pauses until this proof-run lands. Commit `f9bd483`. Full audit: [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-06--multi-tenant-cron-scaffold-architecturally-complete-awaiting-2026-05-07-0700-utc-proof-run).
>
> 🟢 **RLS DENY-ALL APPLIED + LEAKED-PASSWORD PROTECTION DEFERRED (2026-05-06).** Customer-2-onboarding's top DB-side blocker is closed. Migration `rls_deny_all_with_tenant_members_self_read` enabled RLS on 36 `public` tables and added 72 explicit policies (36 `deny_anon` + 35 `deny_authenticated` + 1 `members_self_read` carve-out for the auth middleware's `tenant_members` query). `service_role` bypasses RLS — every Beacon `getSupabaseAdmin()` data path keeps working unchanged. Anon REST reads return `[]`; anon REST writes return HTTP 401 + Postgres `42501` ("new row violates row-level security policy"). Hosted sign-in works without `/login?error=no_tenant` loop. Security Advisor: 0 ERRORs (was 36); 1 WARN remains (`auth_leaked_password_protection`) — **acknowledged and intentionally deferred** because Beacon currently uses magic-link / OTP auth only (`signInWithOtp` is the sole auth call; no `signInWithPassword`, no `signUp`, no `updateUser({password})`). The toggle also requires Supabase **Pro Plan** (Beacon org's plan: `free`). Full audit + verification in [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-06--rls-deny-all-migration--leaked-password-protection-decision). **Customer-2 onboarding precondition added** in §7.9 below.
>
> 🟢 **PROFOUND MAY 10 READINESS GUARDRAILS LANDED (2026-05-06).** 7-block architecture invariant `tests/architecture/profound-runtime-isolation.test.ts` (114/114 PASS) pins: no daily-cron workflow references Profound; no `/api/*` route imports from `src/adapters/profound`; no daily-routine script imports it; no shell route outside `/settings/import` references it; `/settings/import/import-page.tsx` is the ONLY caller of `importProfoundData()`; zero `PROFOUND_*` env vars in workflows / package scripts / env examples; `daily-native-poll.yml` invokes only native endpoints. Operator-readable readiness checklist at [`docs/PROFOUND_MAY_10_READINESS.md`](PROFOUND_MAY_10_READINESS.md) — includes May 10 + May 11 morning verification + 13-item post-cutoff cleanup queue + explicit "DO NOT delete before 2026-05-11" rule. Total architecture invariants: **246** (132 prior + 114 new).
>
> 🟢 **MORNING VERIFICATION GREEN + ROUND 2 PAPER-CUTS LANDED (2026-05-06).** Daily-poll post-mode GREEN (199 obs, /today FRESH). Round 2 shipped 3 fixes: `prettifySlug()` for /prompts/[id] (UUIDs render nothing, slugs become "Cupertino, CA"), /recommendations empty-state copy ("raw decision signals" → "today's prompt-by-prompt observations"), /recommendations status pill differentiation (needs_fresh_edit now dashed border + status-info blue, distinct from needs_review warning-amber). 12 new architecture invariants. Ledger byte-identical (SHA `d36eed8c…`) after another full `npm run test`. **Total architecture invariants: 132.**
>
> **Top of stack — when ready, in any order:**
> 1. **Customer-Readiness Round 2 (queued, optional).** From the audit: prompt drilldown friendly slugs (issue #8), Tier 1A comment sweep (issue #9), status pill color differentiation (issue #10), `/recommendations` empty-state copy ("raw decision signals"), `enrichment-v2.tsx` empty-state copy parity. All copy/small-render. Defer until operator wants to round 2.
> 2. **Wait for queue regrowth before LR-3.** Current queue exhausted by LR-1 + LR-2. New medium-conf observation-tier candidates emerge organically as the daily 07:00 UTC cron runs and entity registry / search signals refresh. The 120 architecture invariants will block any drift when LR-3 is built.
> 3. **Other operator priorities.** Engine + UX safety nets verified. Move to: Profound May 10 expiry, customer-2 onboarding scaffold, `/today` findings polish, etc.
> 4. Independent of decisions: all 120 architecture invariants run on every PR. UUID leaks, removed abstention rule wording, removed packet `resolution` block, harness drift to persistence API, regression of cutover ceiling at 9, regression of single-prompt-only-as-hard-trigger rule, test writes to real `.data/global/llm-budget.json`, future LR-N harness drift away from any of the 13 safety properties, OR re-introduction of any Round 1 forbidden phrase (`live_at = now`, `Pre-pivot CSV / PDF rebuild`, `Supabase schema`, `GitHub Actions logs`, `proof run`, etc.) — all fail the build before reaching production.

> ✅ **Phase v4 Commits 1–7 LANDED (2026-04-30).** "Replace Profound in 2 weeks
> while compounding the moat" is complete. Profound's 2026-05-10 expiry is now
> a non-event for daily operation.
>
> - **Source plan:** `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md` (Commits 1–4) + `/Users/armeen/.claude/plans/you-are-working-on-purring-shell.md` (finishing pass for Commits 5–7).
> - **Latest verification:** `docs/VERIFICATION_LOG.md` 2026-04-30 entry — KPI flip + schema v2 verified live; citation_evidence_index rebuilt from native (Supabase + on-disk both at `built_at=2026-04-30T21:13:52.951Z`); mixed-source partial-overlap math replacing the Commit 2 abstain in `url-verdict.ts`; copy audit on 6 surfaces.
> - **Remaining cutover work:** none. Profound import code (`src/adapters/profound/bridge.ts` + `src/app/(shell)/settings/import/import-page.tsx`) deletion deferred until ≥2026-05-10 in case operator pulls one final historical CSV.
>
> **What's next (per `HANDOFF_VERIFIED_STATE.md`):**
>
> 1. Watch tomorrow's 07:00 UTC `daily-native-poll.yml` run — verify new `rebuild-citation-evidence-index` GH Actions job fires post-poll and `built_at` updates < 60 min later.
> 2. Vercel preview spot-check on /pages, /competitors, /topics — top-3 should reflect native rankings, not last week's Profound-era frozen data.
> 3. After H2's 7-day bake window (earliest 2026-05-05), decide on flipping `BEACON_LIFECYCLE_VERDICT_ENABLED=1`.
> 4. After 2026-05-10: delete Profound adapter + import UI. Sprint 7.9 multi-tenant onboarding waits on a confirmed second tenant. Phase 6B one-click triage UX waits on a real ambiguous match in production.

> **PURPOSE:** The only active execution plan. What to do, in what order, with what acceptance criteria.
> This file answers: "What do I work on next?"
>
> **NOT FOR:** System architecture (→ `architecture.md`), historical phase details (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated (legacy content below, superseded 2026-04-24):** 2026-04-16

---

## Sprint 6A.3 — COMPLETE 2026-04-26

Phase 6A.3 added cost observability + runaway protection to the native polling pipeline across 5 sub-commits. **Zero quality reduction:** no model change, no output cap change, no prompt change, no cadence change, no batching/grouping/caching, full coverage preserved.

**6A.3a (`d57d3ca`)** — pricing helper + provider usage capture. New `src/lib/cost/pricing.ts` with per-(provider,model) rate tables (verified 2026-04-26). OpenAI client counts `output[].type==="web_search_call"` items + reads `usage.{input_tokens,output_tokens}`. Perplexity client reads `usage.{prompt_tokens,completion_tokens}`. Conservative unknown-model fallback uses the most-expensive-in-family rates so a future model rename never silently bills $0.

**6A.3b (`fb48e7f`)** — daily/monthly/per-run budget helpers. `src/lib/cost/budget.ts` daily cap default bumped $5 → $10. New `src/lib/cost/monthly.ts` with `checkMonthlyBudget({ tenantId?, now? })` — global default; per-tenant via opts. New `checkPerRunBudget(accumulatedUsd)` for mid-chunk runaway cap. `percent` field on every check for richer cron logging. Path resolution lifted to call-time so tmpdir-cwd tests are hermetic.

**6A.3c (`ae17d52`)** — poll-loop wiring. `pollPerplexityForTenant` (the shared loop for both Perplexity and ChatGPT-via-OpenAI native polls) gained:
- Pre-flight `checkTenantBudget` + `checkMonthlyBudget` BEFORE any provider call
- Mid-run `checkPerRunBudget(runningCostUsd)` BEFORE each `client.sample()`
- Post-call `estimatePromptCost` + `recordSpend` (wrapped in try/catch for read-only Vercel FS)
- Result extended with `cost: { totalUsd, inputTokens, outputTokens, webSearchCalls, promptsCompleted, promptsSkippedBudget }`, `skipReason: "budget_blocked" | "per_run_blocked" | null`, `budgetReason: string | null`
- `ObservationRun.status` enum unchanged (`"completed" | "partial" | "failed"`); `skipReason` distinguishes "partial because errors" from "partial because budget"

**6A.3d (`4e8b578`)** — kill switch + dedupe + route response pin.
- `BEACON_POLL_DISABLED` env (truthy: `1`/`true`/`yes`/`on`) → route returns 200 + `{ status: "disabled", reason }` without invoking `runNativePoll`. **Auth still enforced** — kill switch placed AFTER the bearer check.
- Identical-text dedupe in the poll loop. Normalization: `text.trim().toLowerCase()` (exact, NOT fuzzy, NOT cross-day). First occurrence pays; subsequent matches skip the provider call, log `DEDUP_SKIPPED`, increment `promptsDeduped`.
- Route response shape pinned by tests: `cost`, `skipReason`, `budgetReason`, and `cost.promptsDeduped` are all visible in the JSON payload.

**6A.3e** — architecture invariants + docs sync.
- New `tests/architecture/cost-controls.test.ts` (21 tests) pins:
  - Poll adapter imports + calls `estimatePromptCost`, `checkTenantBudget`, `checkPerRunBudget`, `recordSpend`, `checkMonthlyBudget`
  - Adapter contains `BUDGET_BLOCKED` / `PER_RUN_BLOCKED` / `DEDUP_SKIPPED` log markers + the dedupe normalization (`.trim().toLowerCase()`)
  - Route checks `BEACON_POLL_DISABLED` BEFORE `runNativePoll`; auth check appears BEFORE the kill switch
  - Only `src/lib/cost/budget.ts` writes `cost-ledger.json`; `monthly.ts` reads but doesn't write; no other source file mutates it
  - Existing 6A.2d / 7.8e safety pins (openai provider Vitest+Vercel guards; `BEACON_TENANT_SLUG` fallback) remain in source

### Operator-locked env vars (Sprint 6A.3 plan)

| Env | Default | Purpose |
|---|---|---|
| `BEACON_DAILY_BUDGET_USD_PER_TENANT` | $10 | Daily per-tenant cap (`src/lib/cost/budget.ts`) |
| `BEACON_DAILY_BUDGET_GLOBAL_USD` | $20 | Daily global cap (`src/lib/cost/budget.ts`, unchanged from prior) |
| `BEACON_MONTHLY_BUDGET_USD` | $200 | Monthly cap (`src/lib/cost/monthly.ts`) |
| `BEACON_PER_RUN_BUDGET_USD` | $5 | Per-chunk runaway cap (`src/lib/cost/budget.ts`) |
| `BEACON_POLL_DISABLED` | unset | Kill switch (truthy: `1`/`true`/`yes`/`on` case-insensitive) |

### What this phase explicitly did NOT do

- ❌ No model change (gpt-4o + sonar unchanged)
- ❌ No `max_output_tokens` reduction (Perplexity stays 2048; OpenAI uncapped as today)
- ❌ No prompt-text change in either client
- ❌ No system prompt added/modified
- ❌ No cadence reduction (daily polls preserved)
- ❌ No prompt tiering / batching / grouping / cross-day caching
- ❌ No silent skips — every skip emits a structured warn line + counter

### Vercel caveat

`recordSpend` writes to `.data/cost-ledger.json` via `writeFileSync`. Vercel's serverless lambda has read-only FS — the write throws on hosted, caught by the try/catch wrapper, logs a non-fatal warn line.

- **Local CLI runs:** ledger persists; pre-flight gates see accumulated spend across runs and gate correctly.
- **Hosted Vercel runs:** ledger is non-persistent across requests; pre-flight gates always see "$0 spent" and never block. **Hosted budget enforcement is not durable yet.** OpenAI account-level quota remains the runaway-protection floor on Vercel.

**Future phase candidate:** move polling cost ledger to Supabase (`cost_ledger_entries` table) for durable hosted state. Architecture is ready — `cost/budget.ts` only needs to swap its disk read/write for a Supabase upsert. Out of 6A.3 scope.

### Verification

- `npm run typecheck` — clean
- `npx vitest run` — **2572 / 2572** (was 2456 entering 6A.3; +116 net new across pricing + budget + monthly + poll-cost + dedupe + route + architecture)
- `npm run build` — green with `.data` present
- Vercel-equivalent build (`mv .data /tmp; BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build`) — green
- Production `.data/cost-ledger.json` confirmed empty after full vitest run

### Recommended next phase (operator decision)

Three candidates:

1. **Sprint 6A.2f — first live `--write` of LLM-generated edits.** Requires (a) restoring OpenAI quota / swapping to a funded key, (b) one successful `--limit=1 --provider=openai` dry-run that produces useful edits, (c) operator review. Highest-signal path if dogfeed quality holds.

2. **Sprint 6A.4 — Supabase polling cost ledger.** Moves `cost_ledger_entries` to a durable backing store so hosted Vercel pre-flight gates actually enforce. Mostly mechanical: extend `cost/budget.ts` with a Supabase write path behind a `DATA_SOURCE=supabase` branch. Recommended only if hosted runaway is a concrete risk; OpenAI quota currently provides the floor.

3. **Sprint 7.9 — multi-tenant onboarding flow.** Waits on a confirmed second tenant. Architecture is ready (Phase 7.8e-4 invariants + env-fallback); this is product surface, not infrastructure.

**Recommended capability for the next step:** Max for 6A.2f (first-money-call pre-flight + verification log). Balanced for 6A.4 / 7.9 (mechanical from established patterns).

---

## Sprint 7 Phase 7.8e — COMPLETE 2026-04-26

Phase 7.8e shipped in seven sub-commits this session: **7.8e-1 → 7.8e-2 → 7.8e-3 → 7.8e-4a → 7.8e-4b → 7.8e-4c → 7.8e-4d**. Plus two deploy-fix commits along the way that surfaced as the cascade hit production prerender + Vercel runtime: store-classification gap (`answer-snapshots` + `frontier-opportunities`) and the `currentTenantSlug` env-fallback for environments where the gitignored `.data/global/tenants.json` isn't on disk.

**7.8e-1 (`627f9e9` — seed-data.server.ts):** lifted module-level top-level await reads to `cache(async () => ...)` getters. Pattern A established. Mocks retargeted across the wider test surface.

**7.8e-2 (`cc0ba05` — canonical-store):** same conversion for `src/storage/canonical-store.ts`'s array exports (`promptAnswerObservations`, `dailyMetricSnapshots`, `trackedEntities`, `trackedPrompts`, etc.). DB-merge logic preserved verbatim inside the lazy `ensureLoaded` block.

**7.8e-3 (`441cee8` — Group 2/3 mutable-array stores):** 16 stores converted (attribution/store + url-change-outcome, changelog/change-contract, pages/issues + wave-planner + asset-response + outcome-watch + frontier-planner + frontier-compiler + competitor-evidence, brief-generation/store, actions/store, observations/visibility-observation-explicit-store, product/outcome-store + recommendation-response-store, answer-snapshots/store). Mutators promoted to async; ~30 production callers cascaded via `Promise.all` batches; new architecture invariant pins legacy value-imports out.

**7.8e-4a (`fa169fa` — citation-evidence-store):** singleton store. Sentinel `undefined`/`null` distinction added (`undefined` = not loaded; `null` = loaded but no index on disk). 13 production callers retargeted. 4 unit tests pin the contract.

**7.8e-4b (`ea39a35` — answer-intelligence/store):** same pattern as 4a. 3 production callers; 4 unit tests.

**7.8e-4c (`899d516` — prompt-library):** global store. `addPrompt`/`initFromTrackedPrompts` mutators promoted to async — preserve push semantics on the cached array reference (verified by test). 5 callers. 8 unit tests + architecture invariant extended to forbid value-imports of all three 7.8e-4 store names.

**7.8e-4d (`<this commit>` — final invariant + docs sync):** new architecture invariant in `tests/architecture/json-store-routing-invariants.test.ts` walks `src/` and fails-loud on any module-level top-level await read of `readStore`/`readDotDataJson`/`repo`/`repository` outside the documented allowlist (repo backends, tenant-data plumbing, competitors/universe-read private cache). Five additional invariants pin the empty-state of `seed-data.server.ts`, `canonical-store.ts`, `citation-evidence-store.ts`, `answer-intelligence/store.ts`, and `prompt-library.ts` against future regression. Docs synced (this entry + `HANDOFF_VERIFIED_STATE.md` banner + `VERIFICATION_LOG.md`).

**Two deploy fixes during the cascade:**
- **`52891e8` — store classification gap:** Vercel's static-prerender of `/settings/health` (re-exports `/diagnostics`) hit `getAnswerSnapshots()` → `readStore("answer-snapshots")` → `classifyStore` returned `"unknown"` → throw (Phase 7.8d-1's fail-loud contract). `frontier-opportunities` had the same gap. Both classified as per-tenant; Vercel build green.
- **`f67ce8f` — `BEACON_TENANT_SLUG` env fallback:** `currentTenantSlug` resolved slugs by reading `.data/global/tenants.json`, but that file is gitignored and not bundled into the Vercel lambda. Added env fallback consistent with the existing `BEACON_TENANT_ID` pattern: when registry is empty AND env id matches, return env slug. Multi-tenant safety preserved by the id-match guard.

**Verification:**
- `npm run typecheck` — **clean**.
- `npx vitest run` — **2356 / 2356 pass** (was 2330/2330 entering 7.8e; gained 5 architecture invariants, 4 citation-evidence tests, 4 answer-intelligence tests, 8 prompt-library tests, 5 currentTenantSlug-fallback tests).
- `npm run build` — green with `.data/` present.
- **Vercel-equivalent build** (`mv .data /tmp; BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build`) — green; all 26 pages generated; no prerender errors.
- **Production deploy:** Vercel commit `0dd90e2`, status Ready, live at `beacon-bice.vercel.app`.

**Phase 7.8 complete.** No further sub-phases planned. Sprint 7 multi-tenant hardening (7.0 → 7.8e) is feature-complete: tenant resolution, repository scoping, dual-write tenantization, json-store routing, request-scope getters, architecture invariants. Operator instructions don't require 7.9 (multi-tenant onboarding flow) until a second tenant is imminent — single-operator Ritz today is fully supported.

**Recommended next phase (operator decision):**
- **Sprint 6A.2** — LLM activation in `runProviderAndPersist`. Highest signal once a real packet round-trips through openai/anthropic providers.
- **Phase 7.9** — only when a second tenant is imminent. Adds onboarding CLI, registry UI, header-driven tenant resolution at request layer. Architecture is ready; this is product surface, not infrastructure.

  **Security preconditions before customer-2 onboarding (added 2026-05-06):**
  1. **DB-side RLS:** ✅ done. Deny-all on 36 `public` tables + `tenant_members` self-read carve-out applied 2026-05-06 via migration `rls_deny_all_with_tenant_members_self_read`. When Phase 7.9 actually exposes per-tenant UI to non-operator users, layer per-tenant SELECT policies on top of the deny-all defaults (e.g., `WHERE tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())`). Deliberately not applied today — those policies become required only on the day a second user belongs to a different tenant.
  2. **Magic-link / OTP only sign-up:** ✅ unblocked today. Beacon's existing `signInWithOtp` flow is unaffected by the RLS migration and unaffected by the leaked-password WARN. No additional work required if customer-2 signs up via magic link.
  3. **Password-based sign-up / sign-in (only if offered):** **GATED** until all three of the following land in the same change:
     1. Upgrade Supabase organization plan to **Pro** (Beacon org's current plan: `free`; leaked-password protection is Pro-only).
     2. Enable **Leaked Password Protection** in the Supabase dashboard → Authentication → Sign In/Up → toggle "Prevent the use of leaked passwords" → ON (verifies submitted passwords against HaveIBeenPwned; rejects breach-corpus matches).
     3. Verify password flows under the toggle: a known-leaked password must fail with `WeakPasswordError`; a known-clean password must succeed; existing magic-link sessions must remain valid (they will — protection runs at password-set/use time, not session-refresh).
     Documented in [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-06--rls-deny-all-migration--leaked-password-protection-decision) (2026-05-06 entry, "Leaked-password protection — DEFERRED, not enabled" subsection).

  **Cron preconditions before customer-2 onboarding (added 2026-05-06):**
  1. **Multi-tenant cron scaffold:** ✅ landed in commit `f9bd483`. `ops/active-tenants.json` is the source of truth (today: Ritz only, `enabled: true`); `daily-native-poll.yml` + `daily-scan.yml` are matrix-driven; fail-loud Ritz guard in all 3 workflow `compute-matrix` jobs. Adding a 2nd tenant = one-line JSON edit. Full audit: [`docs/VERIFICATION_LOG.md`](VERIFICATION_LOG.md#2026-05-06--multi-tenant-cron-scaffold-architecturally-complete-awaiting-2026-05-07-0700-utc-proof-run).
  2. **Cron matrix proof-run:** **GATED — pending 2026-05-07 morning.** After tomorrow's 07:00 UTC scheduled cron, confirm via `npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts 2026-05-07` that the matrix-driven cron landed Ritz cleanly (4/4 Perplexity + 4/4 ChatGPT chunks; ~100 + ~100 prompts persisted) OR reports honestly via partial/failed canary. Until this proof-run lands, **customer-2 infrastructure work pauses** — no second tenant should be added to `ops/active-tenants.json`, no onboarding UI work, no per-tenant cron splits.
  3. **Per-tenant canary + rebuild (deferred):** When a 2nd tenant is enabled, the following must land in the same change:
     1. Add `--tenant=<id>` flag to `scripts/check-yesterday-poll.ts` so the canary can split alerts per tenant; otherwise a single failing tenant conflates with healthy ones in the same canary report.
     2. Convert `poll-canary.yml`'s canary job to a matrix mirroring the poll, OR keep the canary tenant-agnostic but document the trade-off.
     3. Decide whether `rebuild-citation-evidence-index` should become per-tenant (currently global; `id='current'` singleton row). If yes, refactor the route + matrix the rebuild job. If no, document the rationale.
     None of these are required while only Ritz is enabled.

---

## Sprint 7 Phase 7.8d — COMPLETE 2026-04-26

Phase 7.8d shipped in three sub-commits this session.

**7.8c (`--commit` migration):** 70 flat `.data/*.json` files copied into `.data/tenants/ritz-builders/` (per-tenant + singleton) and `.data/global/` (cross-tenant aggregates). Row-count spot checks all match (`daily-metric-snapshots` 31,384 / `prompt-answer-observations` 14,096 / `pages` 6,471 / `page-element-inventory` 4,315 / `imported-results` 1,719). Mixed-tenant warnings: zero. Test pollution previously cleaned in 7.8c.1 (`brand-new-store`, routed `import-runs.json` with `tenant-test`); fresh routed `co-mention-matrix.json` (Apr 26 / 13,946 answers) preserved by removing the stale Apr-14 flat copy after backing it up to `.data/_pre-migration-hygiene/`.

**7.8d-1 (runtime fallback removal):** [src/lib/persistence/json-store.ts](src/lib/persistence/json-store.ts) and [src/lib/persistence/dotdata-json.ts](src/lib/persistence/dotdata-json.ts) no longer read flat `.data/<name>.json` when the routed file is missing for a known store — they return `[]` / `null` instead. Reads and writes for **unknown** stores throw with a message naming `src/lib/persistence/store-classification.ts`. The fail-loud invariant exposed 7 production stores never classified: `outcome-events`, `rollout-waves`, `candidate-causes`, `outcome-observations`, `visibility-observation-runs` (per-tenant arrays), `local-operator-surface` (singleton), `global-patterns` (cross-tenant). All classified; none had flat files on disk so classification is purely additive. New invariants in [tests/architecture/json-store-routing-invariants.test.ts](tests/architecture/json-store-routing-invariants.test.ts) pin: no flat-fallback warn log, throw on unknown, no `resolved.flatPath` references in either helper, and the prior contract (cache key, import-runs guard).

**7.8d-2 (file move):** `mkdir -p .data/_legacy && find .data -maxdepth 1 -type f -name '*.json' -exec mv {} .data/_legacy/ \;`. **72 flat `.data/*.json` files moved to `.data/_legacy/`** (the 70 migrated stores + 2 unknown historical files: `experiments.removed-phase4.json`, `imported-changes.backup.2026-04-16T17-13-41-166Z.json`). `.data/` root now has zero direct `.json` files. Routed dirs untouched. Co-mention fresh routed file preserved (verified at 352,765 bytes / Apr 26).

**Verification:**
- `npm run typecheck` — **clean**.
- `npx vitest run` — **2330 / 2330 pass** (zero failures, was 2323/2323; gained the 7.8d-1 invariants and unknown-throws tests).
- Manual smoke limitation: unauthenticated dev server redirects to `/login` (Supabase auth middleware), so direct route GETs were not exercised in the browser. Equivalent coverage from RSC route-render tests in vitest ([tests/routes/today-smoke](tests/routes/today-smoke.test.ts), [changes-smoke](tests/routes/changes-smoke.test.ts), [recommendations-smoke](tests/routes/recommendations-smoke.test.ts), [pages-smoke](tests/routes/pages-smoke.test.ts), [market-smoke](tests/routes/market-smoke.test.ts), [canonical-store-fresh](tests/routes/canonical-store-fresh.test.ts) — all RSC-render the actual page modules under the routed-only contract). Dev server boot logs were clean: zero errors, zero `flat-fallback` strings, zero `unknown store` strings.

**Local state (gitignored — `.data/` not tracked):**
- `.data/*.json` root: 0 files.
- `.data/_legacy/`: 72 files (rollback target).
- `.data/tenants/ritz-builders/`: 55 files.
- `.data/global/`: 20 files.
- `.data/_pre-migration-hygiene/co-mention-matrix.flat.apr14.json`: 273,429 bytes (operator-created backup; not in either layout).

**Rollback (7.8d-2 file move):**
```bash
mv .data/_legacy/*.json .data/ && rmdir .data/_legacy
```
This re-exposes the flat originals. Combined with `git revert` of the 7.8d-1 commit, restores the pre-7.8d behavior end-to-end.

**Phase 7.8e — APPROVED + SAFE TO START** when operator approves. Scope: lift the module-level top-level await in [src/lib/seed-data.server.ts](src/lib/seed-data.server.ts) to a request-scope helper. Phase 7.8b-2-c documented this caveat ("Phase 7.8e lifts to request-scope") in canonical-store / recommendation-response-store / outcome-store / similar.

---

## Sprint 7 Phase 7.8b-2-e — COMPLETE 2026-04-26

**Done:** Cleanup + invariants + docs for the json-store async/routing contract, plus the long-standing baseline test fix.

- **5 architectural invariants** added in [tests/architecture/json-store-routing-invariants.test.ts](tests/architecture/json-store-routing-invariants.test.ts):
  1. No un-awaited `readStore(...)` calls anywhere in `src/` or `scripts/` (with documented allowlist for `json-store.ts`, `repositories/file-backend.ts` + `supabase-backend.ts` async-arrow auto-flatten, `types.ts`, `index.ts`, `seed-data.server.ts`).
  2. `json-store.ts` imports `resolveDataPath` from the shared resolver.
  3. `json-store.ts` emits the `[json-store] flat-fallback read` warn log.
  4. `json-store.ts` cache + writeLocks ops all key by `resolved.cacheKey` (sanity-checked against >3 ops to avoid false-pass on a stripped file).
  5. `json-store.ts` retains the import-runs anti-race guard (`existsSync(...)` + non-empty + `[]` refusal).

- **Shell-page audit** ([src/app/(shell)/](src/app/(shell)/)): all `readStore` / `readDotDataJson` / `writeStore` call sites correctly awaited inside async server components / actions. Audit found **one real bug** in [src/domains/competitors/co-mention.ts:147](src/domains/competitors/co-mention.ts:147) — `getCachedCoMentionMatrix` was calling un-awaited `readStore<CoMentionMatrix>(STORE_NAME)` and checking `Array.isArray(stored)` (always false on a Promise), so the disk cache silently returned `null` on every cold-start. Fixed: helper is now async + awaits + the one caller in `competitors/page.tsx` awaits.

- **Docs:** [architecture.md](docs/architecture.md) Persistence section rewritten — describes the per-tenant / singleton / global / unknown layout, the `currentTenantSlug` resolution chain, the read-only flat-fallback contract, the resolved-cacheKey isolation, and the migration phasing (7.8b → 7.8c → 7.8d → 7.8e).

- **Baseline test fix:** [src/app/(shell)/finding-actions.test.ts:213](src/app/(shell)/finding-actions.test.ts:213) expected `entry.timestamp = mockedNow()`, but [finding-actions.ts:210](src/app/(shell)/finding-actions.ts:210) (Phase 3.5I-trust, 2026-04-22) intentionally uses `finding.detectedAt ?? now()` for date-accurate /changes attribution. Test was drift, not a product bug. Updated test to expect `finding.detectedAt`. Production behavior unchanged.

**Verification:** `npm run typecheck` clean. `npx vitest run tests/architecture/` 83/83. Full vitest **2323 / 2323** (was 2316/2317 — gained the 6 new invariants and recovered the previously-failing `finding-actions.test.ts:213`).

**Phase 7.8c — APPROVED + SAFE TO START** when operator approves. Scope: dry-run `--commit` migration to physically move existing flat files into `.data/tenants/<slug>/` and `.data/global/`, then commit pass once verified. Routing layer is now contract-locked via invariants, so the migration can't silently break it.

---

## Sprint 7 Phase 7.8b-2-d — COMPLETE 2026-04-26

**Done:** Final cascade of the json-store async/tenant-aware migration. Twelve deferred sync→async helper conversions landed in one batch (couldn't be split safely — `readStore` became async in 7.8b-2-b and these were the last sync callers blocking typecheck).

Helpers converted to async:
- Recommendations adjudicator: [adjudicator-cache](src/domains/recommendations/adjudicator-cache.ts), [adjudicator-history](src/domains/recommendations/adjudicator-history.ts), [adjudicator-budget](src/domains/recommendations/adjudicator-budget.ts) (`readState`).
- Entity helpers: [discrepancy-detect.detectDiscrepancies](src/domains/entity/discrepancy-detect.ts), [founder-authority.assessFounderAuthority](src/domains/entity/founder-authority.ts), [entity-extract.extractEntities](src/domains/entity/entity-extract.ts).
- Other: [milestones/sync.readState](src/domains/milestones/sync.ts) (+ `getMilestoneState`), [answer-snapshots/store](src/domains/answer-snapshots/store.ts) (top-level await), [competitors/co-mention.computeCoMentionMatrix](src/domains/competitors/co-mention.ts), [competitors/source-trust.computeSourceTrustIndex](src/domains/competitors/source-trust.ts), [global-patterns/store](src/domains/global-patterns/store.ts) (5 helpers), [prompts/prompt-library](src/domains/prompts/prompt-library.ts) (top-level await).

Caller cascade: [global-patterns/aggregate.ts](src/domains/global-patterns/aggregate.ts), [global-patterns/query.ts](src/domains/global-patterns/query.ts), [guided-execution/assemble-moves.ts](src/domains/guided-execution/assemble-moves.ts), [guided-execution/priority-scorer.ts](src/domains/guided-execution/priority-scorer.ts), shell pages [today-data.ts](src/app/(shell)/today-data.ts) + [competitors/page.tsx](src/app/(shell)/competitors/page.tsx) + [diagnostics/page.tsx](src/app/(shell)/diagnostics/page.tsx) (4 sections converted to async server components). [profound-adapter.ts](src/lib/data-adapters/profound-adapter.ts) — phased-out path stubbed (no production callers; threading async through the sync DI surface for dead code is wasted churn).

Tests: [gaps-and-moves.test.ts](tests/guided-execution/gaps-and-moves.test.ts), [json-store-vercel.test.ts](tests/lib/persistence/json-store-vercel.test.ts) (seeded `tenants.json` + narrowed assertions to per-tenant subdir contract), [google-reviews-sync.test.ts](tests/lib/connectors/google-reviews-sync.test.ts) + [yelp-reviews-sync.test.ts](tests/lib/connectors/yelp-reviews-sync.test.ts) (`forceClearImportRunsFile` now also clears the tenant-routed path), [canonical-store-fresh.test.ts](tests/routes/canonical-store-fresh.test.ts), [recommended-edits-persistence.test.ts](src/domains/recommendations/recommended-edits-persistence.test.ts) (added `currentTenantSlug` to mocks).

**Verification:** `npm run typecheck` clean. Full vitest **2316 / 2317** — single remaining failure is the pre-existing `finding-actions.test.ts:213` timestamp fixture, verified unchanged by `git stash` re-run on prior `main`. Architecture invariants + tenant isolation + json-store routing all green.

**Phase 7.8b-2-e — APPROVED + SAFE TO START** when operator approves. Scope: architectural invariant tests for the routing layer, any remaining shell-page cascade hygiene, doc cleanup. Then 7.8c (`--commit` migration run), 7.8d (move flat → `_legacy/`, fail-loud on unknowns), 7.8e (lift seed-data.server top-level await to request-scope).

---

## Sprint 7 Phase 7.7b — COMPLETE 2026-04-25 (Phase 7.7b ALL 6 COMMITS COMPLETE)

**Done:** Lenient-stamping write-path tenant binding across 6 commits. New `tenantizeRows<T>(rows, tenantId, context)` helper added in Commit 1; the 15 converted Tier A `sync*` helpers (14 from `TIER_A_METHODS` + `syncChangeOutcomes`) all gain a required `tenantId: string` parameter and route their input through `tenantizeRows` before delegating to `dualWriteUpsert`. Lenient-stamping pattern coerces the legacy `tenant_id: ""` row-creation sites silently and still throws loud on cross-tenant non-empty mismatches — the actual leak vector. Caller threading complete across server actions, CLI scripts, the orchestrator, the DI poll harness, and the canonical-store wrappers. Per-helper sanity invariants in [tests/persistence/dual-write-tenant.test.ts](tests/persistence/dual-write-tenant.test.ts) prevent silent regressions. **2228 passed / 1 failed** — baseline preserved exactly (sole remaining failure is the pre-existing `finding-actions.test.ts:213` timestamp fixture mismatch, unrelated to multi-tenant). Architecture + tenant-isolation + dual-write-tenant invariants 95/95 green.

**Strict adoption deferred:** `dualWriteUpsertScoped` (built in 7.7a) stays in place as the long-term contract. The shift from lenient `tenantizeRows` to strict `dualWriteUpsertScoped` requires cleaning ~40 row-creation sites that still emit `tenant_id: ""` literals; that's a separate Phase 7.7b.1 / 7.8 sweep.

**Deferred per operator scope:**
- `syncRecommendedEdits` — Phase 7.7d alongside `runProviderAndPersist` tenant assertion (its row source is already tenant-stamped via `mapSpecificEditToRow`).
- `deleteRecommendationResponseByRecId` — Phase 7.7c (cross-tenant rec_id collision protection).
- `runWebsiteScan` child-process env injection — Phase 7.7e (today's implicit env inheritance still works).

**Phase 7.7c — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Phase 7.7a — COMPLETE 2026-04-25

**Done:** Tenant validation infrastructure added to [src/lib/persistence/dual-write.ts](src/lib/persistence/dual-write.ts):
- `GLOBAL_TABLES: ReadonlySet<string>` — the 10 cross-tenant tables (registry + singletons + operator-shared config + global learning).
- `assertRowsScopedToTenant(rows, tenantId, context)` — pure validator; throws on empty tenantId or non-empty cross-tenant mismatch.
- `dualWriteUpsertScoped(table, rows, primaryKey, tenantId)` — strict variant of `dualWriteUpsert` that refuses GLOBAL_TABLES and validates rows. Reserved for the long-term contract.

22 new tests in [tests/persistence/dual-write-tenant.test.ts](tests/persistence/dual-write-tenant.test.ts). No callers wired yet; that's 7.7b. **2174 passed / 4 failed** — improved from 2152/4 baseline (+22 from new file).

**Phase 7.7b — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Mini-phase — COMPLETE 2026-04-25 (discoverCandidates warming cascade)

**Done:** 3 RSC entry points (`/topics`, `/review`, `/settings/history/[id]`) now `await warmPageRegistry()` once at the top before any sync helper that calls `discoverCandidates`. `review/page.tsx` converted from sync to async. Attribution helpers (`scorecard.ts`, `result-drivers.ts`, `action-clusters/compute.ts`) untouched and remain sync — they see the warm registry transitively. Closes the documented evidence-tier degradation that fell out of Phase 7.5c/3. **2152 passed / 4 failed** — baseline preserved exactly; no new tests required (existing coverage suffices).

**Phase 7.7a — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Phase 7.5d/3 — COMPLETE 2026-04-25 (Phase 7.5d ALL COMPLETE; Phase 7.5 ALL COMPLETE)

**Done:** Architectural invariant extended to `scripts/**` + 2 CLI library files. 16 new assertions (one per Tier A method); future drift fails CI. Zero broad file-level allowlists — Tier C-only readers pass naturally because they don't call any Tier A method. **2152 passed / 4 failed** — baseline preserved (+16 from new invariants).

**Phase 7.5 is COMPLETE** (4 sub-phases × multiple commits each). Every render path AND every CLI is now tenant-scoped, with static drift detection.

**Remaining documented gaps (deferred):** `seed-data.server.ts` (Phase 7.8), `profound-adapter.ts` (legacy / phased out), 5 transitive `discoverCandidates` callers (bounded evidence-tier degradation).

**Phase 7.6 — APPROVED + SAFE TO PLAN** when operator approves.

---

## Sprint 7 Phase 7.5d/2 — COMPLETE 2026-04-25

**Done:** 5 CLI scripts converted from silent `?? "tenant-ritz-founder"` env fallback to fail-loud `currentTenantId()` resolver: [poll-openai.ts](scripts/poll-openai.ts), [poll-perplexity.ts](scripts/poll-perplexity.ts), [generate-specific-edits.ts](scripts/generate-specific-edits.ts), [scan-owned-pages.ts](scripts/scan-owned-pages.ts), [run-orchestrated-scan.ts](scripts/run-orchestrated-scan.ts). Two listed scripts (poll.ts adapter + run-poll.ts) had no fallback to convert — both receive tenantId from callers. Wiring invariant test updated for the new pattern. Two CLI smokes byte-identical to pre-flight. **2136 passed / 4 failed** — baseline preserved exactly.

**Phase 7.5d/3 (architectural invariant extension to `scripts/**`) — APPROVED + SAFE TO START** when operator approves. Test-only commit; no production code changes.

---

## Sprint 7 Phase 7.5d/1 — COMPLETE 2026-04-25

**Done:** [scripts/build-edits-for-queue.ts](scripts/build-edits-for-queue.ts) Tier A `getPageElementInventory` read converted to `forTenant(tenantId)`. Fail-loud tenant resolution via `currentTenantId()` replaces the silent `?? "tenant-ritz-founder"` env fallback. Pre/post CLI smoke (`--list`) shows byte-identical output (queue=19). **2136 passed / 4 failed** — baseline preserved exactly.

**Phase 7.5d/2 (env tightening across 7 remaining scripts) — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Phase 7.5c/4 — COMPLETE 2026-04-25 (Phase 7.5c ALL COMPLETE)

**Done:** Diagnostics finishing touch. All module-level repo state in `src/app/(shell)/diagnostics/page.tsx` lifted into `DiagnosticsPage()`'s request scope. New `DiagnosticsContext` type + `ctx` prop threaded through 7 helper React components (11 internal references converted). 5 source-scan invariants in [tests/architecture/diagnostics-no-module-level-state.test.ts](tests/architecture/diagnostics-no-module-level-state.test.ts) prevent drift. **Phase 7.5c is COMPLETE: 4 sub-commits total. 2136 passed / 4 failed** — baseline preserved (+5 from new invariants).

**Phase 7.5d (CLI script conversions) — APPROVED + SAFE TO START** when operator approves. 5 files: `scripts/poll-openai.ts`, `poll-perplexity.ts`, `build-edits-for-queue.ts`, `src/adapters/perplexity/poll.ts`, `src/domains/observations/run-poll.ts`.

---

## Sprint 7 Phase 7.5c/3 — COMPLETE 2026-04-25

**Done:** Largest cascade of Sprint 7. `page-store.ts` lifted from module-level `await repo.getPages()` to lazy `getOwnedPages()` (tenant-scoped). All 7 listed consumers converted. `candidates.ts` page registry refactored to lazy-promise pattern with new `warmPageRegistry()` warm-up call. Diagnostics + today-data warm the registry transitively. `profound-adapter.ts` is a documented partial fix (legacy import pipeline; cascading async would explode scope). 5 transitive `discoverCandidates` callers see degraded evidence tier until follow-up. **2131 passed / 4 failed** — baseline preserved, +3 from new page-store invariants.

**Phase 7.5c/4 (diagnostics finishing touch) — APPROVED + SAFE TO START** when operator approves. Lift module-level `pageSnapshots` (from 7.5b/5) AND `allPages` (from 7.5c/3) into `DiagnosticsPage()` body; thread props through 3+8 nested helper components.

---

## Sprint 7 Phase 7.5c/2 — COMPLETE 2026-04-25

**Done:** [canonical-store.ts](src/storage/canonical-store.ts) Tier A reads converted in both async functions. Mixed Promise.all blocks resolve `tenantId` once; Tier A reads (`getPromptAnswerObservations` + `getDailyMetricSnapshots`) go through `tenantRepo` (= `repo.forTenant(tenantId)`); Tier C reads (`getTrackedEntities` + `getTrackedPrompts`) stay on plain `repo`. Test mocks updated for self-referential `forTenant`. New 3-test invariant block in canonical-store-fresh.test.ts asserts the tier split. **2128 passed / 4 failed** — baseline preserved exactly; +3 from new invariants.

**Phase 7.5c/3 (`page-store.ts` module-level lift) — APPROVED + SAFE TO START** when operator approves. `allPages: PageEntity[]` → `getOwnedPages(): Promise<PageEntity[]>`; 7 consumer files cascade.

---

## Sprint 7 Phase 7.5c/1 — COMPLETE 2026-04-25

**Done:** 3 function-local Tier A reads converted in `src/domains/**` stores: [recommendation-response-store.ts:69](src/domains/product/recommendation-response-store.ts:69) (`getRecommendationResponses`), [findings-store.ts:162](src/domains/scanning/findings-store.ts:162) (`getScanFindings`), [url-change-outcome.ts:110](src/domains/attribution/url-change-outcome.ts:110) (`getUrlChangeOutcomes`). Each adds `currentTenantId` import + resolves `tenantId` at the call site. 1 test file updated (mock pattern: self-referential `forTenant` + `currentTenantId` stub). **2125 passed / 4 failed** — baseline preserved exactly.

**Phase 7.5c/2 (canonical-store.ts function-local lifts) — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Phase 7.5b Commit 5 — COMPLETE 2026-04-25 (Phase 7.5b ALL COMPLETE)

**Done:** Remaining shell read-path conversions: `/changes` family, `/pages` family, `/topics`, `/diagnostics`, `finding-actions.ts`. ~14 call sites across 8 files. Plus new architectural invariant test in [tests/architecture/no-unscoped-tier-a-reads.test.ts](tests/architecture/no-unscoped-tier-a-reads.test.ts) — walks all `src/app/(shell)/**` files and asserts NO unscoped `getRepository().<TierA>(` call remains for any of the 15 Tier A methods. Diagnostics page received a partial fix (module-level forTenant with env-tenant); proper lift deferred to 7.5c. **Phase 7.5b is COMPLETE: 5 commits (1A, 1B, 1C, 2, 3, 4, 5) total. 2125 passed / 4 failed** (baseline preserved; +16 from architectural invariant test).

**Phase 7.5c (module-level domain-store lifts) — APPROVED + SAFE TO START** when operator approves. Scope: ~14 files in `src/domains/**` with `const repo = getRepository();` at module level + the diagnostics finishing touch + 5 direct-call files in `src/domains/**`.

---

## Sprint 7 Phase 7.5b Commit 4 — COMPLETE 2026-04-25

**Done:** /today data builder converted. [today-data.ts](src/app/(shell)/today-data.ts) resolves `tenantId` once via `await currentTenantId()` after the seed `Promise.all`, threads it into 5 Tier A getter call sites (`getRecommendationResponses` + 4 others on the inventory and main `repo` blocks). `change-outcomes` direct `readStore` replaced with `getOutcomesForTenant(tenantId)` adapter. `change-patterns` stays direct (global per architecture). Source-scan invariant added across 4 Tier A method names. **2109 passed / 4 failed** (baseline preserved; +1 from new invariant).

**Phase 7.5b Commit 5 (`/changes` + `/pages` + `/topics` + `/diagnostics` conversion) — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Phase 7.5b Commit 3 — COMPLETE 2026-04-25

**Done:** `loadLiveRecommendationQueue` orchestration uses `getRepository().forTenant(tenantId)` for `getPages` + `getPageSnapshots` at [load-queue.ts:193,200](src/domains/recommendations/load-queue.ts:193). `tenantId` already required in `LoadLiveRecommendationQueueOptions` (Phase 7.3). Source-scan invariant added to load-queue.test.ts. **2108 passed / 4 failed** (baseline preserved; +1 from the new invariant).

**Phase 7.5b Commit 4 (`/today` data builder conversion) — APPROVED + SAFE TO START** when operator approves.

---

## Sprint 7 Phase 7.5b Commit 2 — COMPLETE 2026-04-25

**Done:** /recommendations tenant-bound read conversion. Page render at [page.tsx:77,91](src/app/(shell)/recommendations/page.tsx:77) and Accept fan-out at [actions.ts:398](src/app/(shell)/recommendations/actions.ts:398) now use `getRepository().forTenant(tenantId).getX()` — the Supabase pushdown filters (Commit 1C) fire end-to-end on the most-trafficked Sprint 6A.1 surface. 4 test files updated to match: 1 relaxed regex + 1 new unscoped-form invariant on the fresh-read test, 5 source-scan regexes updated across 2 wiring tests, mock contracts updated in accept-fanout. **2107 passed / 4 failed** (baseline preserved; +1 from new invariant).

**Phase 7.5b Commit 3 (loadLiveRecommendationQueue orchestration) — APPROVED + SAFE TO START** when operator approves. Function already takes `tenantId`; thread to 2 getter calls.

---

## Sprint 7 Phase 7.5b Commit 1C — COMPLETE 2026-04-25

**Done:** Supabase backend's `forTenant(tenantId)` rewrites every Tier A method (15 total) to push `.eq("tenant_id", tenantId)` down to Postgres via `selectScoped<T>(table, tenantId)` and `queryAllPagedScoped<T>(table, tenantId)` helpers. Inline patterns where ordering/dedupe/mapping is needed (`page_snapshots`, `scan_findings`, `recommendation_responses`). Static source-scan invariant test asserts every `.select(` inside `forTenant` is paired with tenant scoping. Cross-tenant rec_id collision test proves Phase 7.5a's widened unique index + Commit 1C's pushdown work end-to-end. **2106 passed / 4 failed** (baseline preserved; +18 from new tests).

**Phase 7.5b Commit 2 (`/recommendations` conversion) — APPROVED + SAFE TO START** when operator approves. Pushdown infra is in place; Commit 2 is purely call-site: 3 lines on the page + 1 line in actions.

---

## Sprint 7 Phase 7.5b Commit 1B — COMPLETE 2026-04-25

**Done:** Widened `recommendation_responses` PK from `(rec_id)` to `(tenant_id, rec_id)`. Cross-tenant `rec_id` collision now allowed at the schema level (necessary before beta tester onboards). Pre-flight: 0 FK dependencies, 0 `(tenant_id, rec_id)` duplicates. Migration is reversible (rollback SQL in commit and `docs/VERIFICATION_LOG.md`). No app code changes. **Baseline preserved: 2088 passed / 4 failed.**

**Phase 7.5b Commit 1C (Supabase backend push-down filters) — APPROVED + SAFE TO START** when operator approves. Replaces `buildTenantRepo`'s in-memory filter with per-method `.eq("tenant_id", tenantId)` queries; adds `selectScoped` / `queryAllPagedScoped` helpers; new pushdown tests.

---

## Sprint 7 Phase 7.5b Commit 1A — COMPLETE 2026-04-25

**Done:** Backfilled `.data/imported-results.json` (1719 rows empty-string → ritz). Tenant-isolation suite (`tests/tenants/isolation.test.ts`) is now **fully green (18/18)**. New baseline: **2088 passed / 4 failed** (3 local-presence date fixtures + 1 finding-actions timestamp; all pre-existing, all unrelated to multi-tenant). One file-only change to [scripts/stamp-data-files-sprint7-phase5a.ts](scripts/stamp-data-files-sprint7-phase5a.ts).

**Phase 7.5b Commit 1B (recommendation_responses PK widen) — APPROVED + SAFE TO START** when operator approves. Pre-flight: FK dep query.

---

## Sprint 7 Phase 7.5a — COMPLETE 2026-04-25

**Done:** Repository audit + interface skeleton + 2 index migrations + `.data/*.json` stamping. Tier A/C/D method classification documented; new `TenantRepository` interface defined; `getRepository().forTenant(tenantId)` available on both backends (in-memory filter for 7.5a; Supabase push-down filter coming in 7.5b). 2 unique indexes widened to include `tenant_id` (`ux_re_tenant_rec_action_element`, `ux_pei_tenant_snapshot_element_key`). 3 `.data` files stamped (6,909 rows). **Baseline improved from 8 failing → 5 failing** — 3 file-backed isolation tests flipped green. No app-code call sites converted yet. Schema invariant tests updated to match widened constraint shape.

**Phase 7.5b (high-traffic read-path conversions) — APPROVED + SAFE TO START.** Interface is additive, migrations reversible. Pre-flight: widen `recommendation_responses` PK to include tenant_id (after FK-dependency check). Then convert /recommendations → /today → /changes → /pages and switch Supabase backend to push-down filters.

---

## Sprint 7 Phase 7.4 — COMPLETE 2026-04-25

**Done:** Middleware tenant injection. After Supabase auth succeeds, [src/lib/auth/supabase-middleware.ts](src/lib/auth/supabase-middleware.ts) strips inbound `x-beacon-tenant`, looks up `tenant_members` for the user, and injects the header into the forwarded request. Branches: 1 row → inject; 0 rows → redirect `/login?error=no_tenant`; 2+ rows → redirect `/login?error=multiple_tenants`; transient errors → fall through (resolver uses env fallback). `Set-Cookie` headers preserved via raw `getSetCookie()` copy when rebuilding response. 9 new tests cover all branches plus `BEACON_AUTH_DISABLED` bypass and `/api/poll/run` allowlist. 2084 passed / 8 failed (baseline preserved).

**Phase 7.5 (tenant-bound repository) — APPROVED + SAFE TO START.** Resolver-to-middleware contract is now end-to-end; Phase 7.5 is purely the consumer side.

---

## Sprint 7 Phase 7.3 — COMPLETE 2026-04-25

**Done:** Tenant resolver unified. `currentTenantId()` is now `async` + `React.cache`-d, reads `x-beacon-tenant` header → falls back to `BEACON_TENANT_ID` env → throws if neither. Silent default to ritz removed. Renamed `customerId` → `tenantId` through adjudicator + evidence-packet path. Two server-action call sites converted to `await`. `loadLiveRecommendationQueue` requires `tenantId`. New tests: 4 (header / env / throw / cache smoke). 2075 passed / 8 failed (baseline preserved).

**Phase 7.4 (middleware tenant injection) — APPROVED + SAFE TO START.** The resolver reads the header today; middleware just needs to set it after `getUser()` succeeds.

---

## Sprint 7 Phase 7.2 — COMPLETE 2026-04-25

**Done:** Backfilled 2,227 legacy empty-string `tenant_id` rows to `tenant-ritz-founder` across 5 tables (`results` 1719, `import_runs` 4, `changelog_entries` 331, `scan_findings` 169, `recommendation_responses` 4) and added 5 CHECK constraints preventing future empty/null writes. **Zero deletes** — pre-flight surfaced that all 4 candidates for deletion were recent product activity (this week), and Los Altos in particular has 5 referencing `changelog_entries` from Phase 13b. Operator approved backfill-all approach (`Option A` in pre-flight question). Baseline preserved at 2071 passing / 8 failing.

**Phase 7.3 (resolver unification) is approved-as-safe** — schema work is finished; only TS code changes from here. Awaiting operator GO.

---

## Sprint 7 Phase 7.1a — COMPLETE 2026-04-25

**Done:** Fixed 5 pre-existing typecheck errors in [tests/domains/product/recommendation-response-undo.test.ts](tests/domains/product/recommendation-response-undo.test.ts) (mock-typing only; no production code change). Deleted dead `eqMock` definition; switched `upsertMock`/`deleteMock` to rest-arg signature. `npm run typecheck` clean. 7/7 tests in the affected file still pass; full suite still 2071/8.

---

## Sprint 7 Phase 7.0 + 7.1 — COMPLETE 2026-04-25

**Done:**
- Phase 7.0 — Baseline failure triage (read-only). Confirmed 8 pre-existing failures (3 local-presence + 4 tenant-isolation + 1 finding-actions date). 4 tenant-isolation tests are diagnostic — they prove the exact schema gaps Sprint 7 closes. Discovered `change_outcomes` was also missing `tenant_id` (audit missed; added to Phase 7.1 scope).
- Phase 7.1 — Schema gap fix on production Supabase. Created `tenants` + `tenant_members` tables (1 Ritz row + 1 operator member row). Added `tenant_id` (NOT NULL + indexed + backfilled to ritz) on `pages` (5929 rows), `guardrail_alerts` (5), `observation_runs` (65), `change_outcomes` (20). 8 indexes shipped. 6 migrations clean. 2071 tests passing (baseline preserved, no regression).

**Active plan:** `/Users/armeen/.claude/plans/13-commits-ahead-of-elegant-llama.md`. Updated with Phase 7.0 discoveries and a "dangerous-until-7.11-gate" posture at the top.

**Phase 7.2 (legacy empty-string backfill) is approved-as-safe** — schema work is clean. Awaiting operator GO.

---

## Sprint 6A.1.16 (pre-Sprint-7 cleanup) COMPLETE 2026-04-25

**Done:** Two isolated fixes shipped before Sprint 7. Part A — `recommendation_responses` Undo deletion path (new `deleteRecommendationResponseByRecId` dual-write helper + `deleteResponseByRecId` store helper, wired into `undoRecommendationResponse`; 7 new tests pass). Part B — production `page_snapshots` schema drift closed via additive migration `sprint6a116_page_snapshots_drift_columns` (8 columns added: `tenant_id`, `body_paragraph_sample`, `h3_list`, `card_texts`, `schema_entity_names`, `schema_validation_warnings`, `table_count`, `internal_links`). Snapshot dual-write now succeeds end-to-end. 2071 tests passing.

**Sprint 7 (multi-tenant hardening) — APPROVED + SAFE TO START.**

The two issues that would have surfaced hostilely during Sprint 7 are closed:
- Multi-tenant rebuild needs per-tenant delete (no stale rows from deleted tenants). ✓ Undo path corrected.
- Multi-tenant scan would have hit the snapshot schema-drift error on every tenant's first scan. ✓ Schema aligned.

Begin Sprint 7 when ready. Sprint 6A.2 (LLM activation) remains queued behind Sprint 7.

---

## Sprint 6A.1 — Phase 13 (REAL hosted UI verification) COMPLETE 2026-04-25 — Sprint closed end-to-end

**Done:** Picked `create_cluster_page:geo:Los Altos` from the live queue, dry-ran (20 valid edits, 0 rejected), wrote 5 unique rows to production `recommended_edits`, verified hosted UI shows **Specific edits (5)** + **Accept — track 5 edits** button copy. Stopped before Accept per operator instruction. Three small infra fixes shipped (CLI env loading, paged inventory read, defensive dedup at persistence boundary). 19 existing persistence tests still pass.

**Sprint 6A.1: CLOSED.** 12 architecture phases (P1–P12) + 3 verification phases (P13 / P14 / P15). 14 commits. 2061 tests passing.

**Operator's next decision points (in order of leverage):**

1. **Accept verification (5 minutes).** Click Accept on the Los Altos rec on `https://beacon-bice.vercel.app/recommendations`. P12's fan-out should create exactly 5 changelog entries with `action_type` + `target_element_key` + `source_rec_id` populated. SQL verify: `SELECT id, action_type, target_element_key, source_rec_id FROM changelog_entries WHERE source_rec_id = 'create_cluster_page:geo:Los Altos'`.

2. **Sprint 6A.2 — LLM activation (~2 weeks).** Replace `not_implemented` openai/anthropic stubs with real implementations. Add evidence-hash cache, per-tenant LLM budget gate, llm_rejections persistence, optional per-edit Accept UX. Capability **Max** — high blast radius if budget controls mis-wire. Real win: LLM-quality rewrites instead of deterministic seed text.

3. **Sprint 7 — Multi-tenant hardening (~1 week).** Tenant-scope every store + path + cron + adjudicator. Add the central tenant resolver. Pick deployment topology. Onboard the two beta testers waiting. Capability **Max** — touches every subsystem.

**Recommendation:** **Direction 1 first (5 min)**, then **Direction 3 (Sprint 7)** because the beta testers will stress-test Sprint 6A.1's stores in ways solo dogfood never will, and 6A.2 (LLM) benefits from running across three real tenants.

**Known follow-up tracked but not blocking:**
- `page_snapshots.body_paragraph_sample` column missing on production (one-line ALTER TABLE)
- 30s SSR on `/recommendations` (orchestration could move to a cached layer; matters for beta testers, not solo)
- Architecture choice for multi-candidate edit emission: widen DB unique index to include `target_url`, or restrict generators to `resolution.targetUrl` only
- Phase 9 `add_faq` emits seed text "Draft answer (operator: rewrite). Anchor on: ..."; LLM in 6A.2 produces real answers

---

## Sprint 6A.1 — Phase 15 (page_element_inventory populated) COMPLETE 2026-04-25

**Done:** New `scripts/run-orchestrated-scan.ts` wrapper, scanned 35 owned URLs, wrote **4312 page_element_inventory rows** to production Supabase. Zero unintended writes to `recommended_edits` or `changelog_entries` (verified). All 13 active extractors fired and persisted clean rows. Took ~42s scan + ~5s dual-write.

**Phase 6A.1.13 (hosted UI verification) is finally unblocked.** Steps:
1. `npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --list` — pick a stableKey from today's queue.
2. `npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --rec-id=<stableKey>` — DRY-RUN, confirm `target_element_count > 0`.
3. `DUAL_WRITE=true npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --rec-id=<stableKey> --write` — persist.
4. Visit `https://beacon-bice.vercel.app/recommendations`, find that rec, confirm **Specific edits (N)** renders.

After Phase 6A.1.13 passes, **Sprint 6A.1 is done end-to-end on hosted.**

Capability for Phase 6A.1.13: **Fast** — three CLI commands + visual confirmation.

---

## Sprint 6A.1 — Phase 14 (orchestration extract + CLI) COMPLETE 2026-04-24

**Why this exists:** Phase 6A.1.13 (hosted UI verification) blocked because no script bridged `/recommendations` queue → EvidencePacket → Phase 11 CLI. Phase 14 closes that bridge.

**Done:** `src/domains/recommendations/load-queue.ts` exports `loadLiveRecommendationQueue` + `buildPacketForRec`. `/recommendations/page.tsx` now calls it (render unchanged). New `scripts/build-edits-for-queue.ts` CLI: `--list / --rec-id=<...> / --all / --write`, default DRY-RUN, honest empty-inventory reporting. New `getPageElementInventory()` repository method. 18 new tests, 2061 passing total.

**Next Sprint 6A.1 step (P15):** Populate `page_element_inventory` on hosted. Two viable paths:

**Path A — Run a scan locally with dual-write enabled (~10 min):**
```
DATA_SOURCE=supabase DUAL_WRITE=true npm run data:scan
```
This invokes `scripts/scan-owned-pages.ts` which already wired Phase 6's inventory persistence. The CLI fetches the live site, extracts inventory rows for each page, writes `.data/page-element-inventory.json`, and after the CLI exits `orchestrate-scan.ts` would call `syncPageElementInventory` — but `npm run data:scan` runs the standalone CLI, not the orchestrate-scan flow. **Path A actually has a gap**: the CLI writes `.data/page-element-inventory.json` but doesn't dual-write to Supabase itself. Need to verify whether the `data:scan` script invokes the orchestrator or runs raw.

**Path B — Trigger hosted scan via the UI (operator action, ~5 min on Vercel):**
Visit `/today` (or wherever the scan trigger lives) and hit the "Scan now" button. The hosted scan runs `orchestrate-scan.ts` which DOES dual-write inventory rows.

**Recommended:** Path B if available — it exercises the production path the cron uses. Otherwise verify Path A's dual-write behavior and use it.

After Phase 6A.1.15: rerun Phase 6A.1.13 against a real live-queue stableKey:
1. `npx tsx --require ./scripts/mock-server-only.cjs scripts/build-edits-for-queue.ts --list` — pick a stableKey.
2. Same with `--rec-id=<stableKey>` to dry-run.
3. Same with `--rec-id=<stableKey> --write` to persist.
4. Refresh `https://beacon-bice.vercel.app/recommendations` — confirm the **Specific edits (N)** section appears.

Capability: **Fast** for Phase 6A.1.15 (one scan invocation + verification) — once that's done, Sprint 6A.1 is truly closed.

---

## Sprint 6A.1 — Original 12-phase scope COMPLETE 2026-04-24

**Phases shipped end-to-end:**

| Phase | Deliverable | Commit |
|-------|-------------|--------|
| P1 | Migrations (page_element_inventory + recommended_edits + llm_rejections + changelog ext) | f947a6f |
| P2 | ActionType registry (22 types, 3 active) | 7b0c7b3 |
| P3 | ElementType registry (31 types, 13 active) | 1e421cf |
| P4 | element_key helpers + element-type domain wire-up | c917a71 |
| P5 | 13 active extractors + dispatcher | b2f8623 |
| P6 | page_element_inventory persistence wired into scan + verify | 2da6639 |
| P7 | EvidencePacket builder (pure) + revision flatten cluster | e183704 / 39cf277 |
| P8 | SpecificEditProvider interface + 3 implementations (1 shell, 2 stubs) | bd9354a |
| P9 | Deterministic generators (edit_title / add_h2_section / add_faq) | c36d5dd |
| P10 | Output validation layer | 794b51b |
| P11 | recommended_edits persistence + generate-specific-edits CLI | 1523cbc |
| P12 | /recommendations UI surfacing + per-edit Accept fan-out | (current) |

**End-to-end loop is closed.** From a snapshot crawl → page_element_inventory → cluster-aware EvidencePacket → deterministic provider → validator → recommended_edits row → /recommendations renders a `Specific edits (N)` panel → Accept stamps N changelog entries with `action_type` + `target_element_key` + `source_rec_id`.

**Operator: pick the next sprint.** Two viable directions:

**Direction A — Sprint 6A.2 (LLM activation).** Replace the `not_implemented` openai/anthropic stubs with real implementations behind the existing `SpecificEditProvider` interface. Add evidence-hash cache (Supabase-backed), per-tenant LLM budget gate, llm_rejections persistence, optional per-edit Accept UX. Capability: **Max** — touches budget control, structured-output schemas, cost accounting; high blast radius if mis-wired.

**Direction B — Sprint 7 (multi-tenant hardening).** Tenant-scope every store + path + cron + adjudicator. Add the central tenant resolver. Pick deployment topology (one Vercel project per tenant vs. host-based). Onboard the two beta testers waiting. Capability: **Max** — touches every subsystem.

**Recommendation:** Direction B first. Beta testers are blocked on multi-tenant; their usage will stress-test stores that today only Ritz touches. Sprint 6A.2 is high-value but the LLM behavior depends on cluster + competitor data that beta tester usage will surface — running 6A.2 against three real tenants gives much better signal than running it solo.

Either way, the Sprint 6A.1 data layer is locked + tested + production-ready.

---

## Next best step — Phase 2 of /changes rebuild (2026-04-16)

**Phase 1 shipped today (see `VERIFICATION_LOG.md` 2026-04-16):**
- `/changes` is now one list, newest first — every confirm lands at the top
- `/changes/dedupe` review flow (38 pairs identified)
- Auto-stamped hypothesis on scan confirmation + editable on detail page

**Phase 2 (next):** Replace the hardcoded `"Check after 7 days"` experiment watch window with pattern-learned progressive checkpoints (1d / 3d / 7d / 14d / 30d). First checkpoint with statistically meaningful movement = `landedAtDays: N`, stored back into the change pattern's `median_days_to_impact`. Dynamic "Expected outcome" strings pulled from the rec engine's pattern data (`computeTrackRecord` + `minePatterns`). Smarter per-day status phrases on each `/changes` row.

Touches `src/domains/product/experiment-store.ts` (add `checkpoints` array), `src/domains/product/experiment-citation-sync.ts` (checkpoint scheduler), `src/domains/learning/change-patterns.ts` (feedback into median_days_to_impact), `src/app/(shell)/changes/scorecard-client.tsx` (smarter status cell). Ship behind existing experiment infra — no new routes.

**Out of scope for Phase 2:** backfilling checkpoints for experiments that are already watching (leave as-is, new experiments get the new schedule).

**Capability:** Max — the feedback loop from actual observed `landedAtDays` into future predictions is a wedge feature and touches three domains.

---

**Prior last-updated:** 2026-04-12
**Current status:** **Launch Phases 0–5 COMPLETE. Tier 1.1 + 1.1i + 1.1j COMPLETE** (1.1i: `coverage-state.ts` aging/critical; **1.1j 2026-04-13:** proof-layer copy + `/settings/methodology` completeness + cross-surface phrasing + FAQ). **Track 1.2 Phases 1–3 COMPLETE** (+ Today **one decision** card + truth-first precedence + aligned findings/digest/primary; **2026-04-12** hard **stale visibility** demotion + import path when prior import exists). **Track 1.3 Phases 1–2 COMPLETE. Track 1.4** Phases 1–4 + 1.4e + 1.4f–g + per-source `/local` last sync + listing completeness **+ 1.4l Local layer Sign-off (`local_layer` in exit gates) COMPLETE (2026-04-13).** Track 1.4d SPEC COMPLETE (written spec + **1.4e** copy aligned with shipped connectors). Sign-offs: **`daily_ritual`**, **`replication`**, **`local_layer`**. **`lastSync`** + **`listingCompleteness`** on `LocalPresenceSnapshot`; methodology `#review-source-timestamps`, `#listing-completeness`, `#exit-gates`. **319 tests.** **Sign-offs (2026-04-13):** **`daily_ritual`**, **`replication`**, **`local_layer`** all **`passed`**. **Dogfood / vault Tier 1:** `docs/TIER_1_DOGFOOD_WEEK_LOG.md` — protocol + **2026-04-13 static validation** entry; **operator must log 5–7 consecutive usage days** + paste **Final Tier 1 note** there before vault “Tier 1 closed” (and thus Track **2.1** dependency) is literally satisfied. **2026-04-14:** Closure verification attempted — **failed** (log incomplete); Tier 1 **still active** for vault purposes. **Next:** complete dogfood log → re-verify → **Tier 2**; optional vault **1.4h–1.4k** research. Full nano-phase breakdown: `master_execution_plan.md` §"Tiered product stack — research-led nano-phases (1.1a–2.3h)".
**Overall score:** 53/100. Launch readiness: 38/100 → 72/100 after Phases 0–3 safety + settings coherence.

---

## What's Done (summary only — details in `master_execution_plan.md`)

- **Phase 0 (this plan):** Foundation Safety — error boundaries, `loading.tsx` (shell + Pages + Changes), dead-route/asset cleanup, full `typecheck`/`test`/`build` gate (`VERIFICATION_LOG.md` 2026-04-11)
- **Phases 0–3E:** Supabase foundation, repository wiring, dual-write, parity (15/15 stores)
- **Phases 5–23:** Attribution engine, impact, recommendations, priority, replication, experiments, premiumization
- **Phases 24–31C:** Intelligence expansion (entity, geo, competitive, journey, score, extractability, viz layer)
- **Phase 32/32B:** Daily detection + approval loop, finding triage + workflow
- **Phases 33–37:** Product truth, Today simplification, verdicts, business config, tenant + setup
- **Scan refactor:** Render-safe orchestrator, fresh disk reads, structured results (see `SCAN_TRUTH_REFACTOR_PLAN.md`)

---

## Launch Plan — 6 Phases to Production

### Phase 0: Foundation Safety (1-2 days) — LAUNCH BLOCKER — **COMPLETE**

**Goal:** Prevent crashes and clean dead weight.

**Progress:** **Phase 0 closed** (hygiene gate logged `VERIFICATION_LOG.md` → **2026-04-11** Phase 0C-5). 0A (error boundaries + verify), 0B (`loading.tsx` shell + Pages + Changes), 0C-1..0C-4 (dead weight + legacy redirects removed), **0C-5** — `npm run typecheck` + `npm run test` (77/77) + `npm run build` all pass.

| Step | Task | Est | Acceptance |
|------|------|-----|------------|
| ~~0A-1~~ | ~~Create `src/app/(shell)/error.tsx` — shell error boundary~~ | 30m | Route errors show recovery UI, not white screen |
| ~~0A-2~~ | ~~Create `src/app/(shell)/settings/error.tsx`~~ | 15m | Settings errors caught |
| ~~0A-3~~ | ~~Test error boundary (throw in Today, verify catch)~~ | 15m | No white screen |
| ~~0B-1~~ | ~~Create `src/app/(shell)/loading.tsx` — shell loading skeleton~~ | 30m | Heavy routes show skeleton during load |
| ~~0B-2~~ | ~~Create `src/app/(shell)/pages/loading.tsx`~~ | 15m | Pages shows list skeleton |
| ~~0B-3~~ | ~~Create `src/app/(shell)/changes/loading.tsx`~~ | 15m | Changes shows table skeleton |
| ~~0C-1~~ | ~~Delete `changelogpdf/` directory (39 unused PDFs)~~ | 5m | Gone, build passes |
| ~~0C-2~~ | ~~Delete `src/adapters/legacy/` (README-only stub)~~ | 5m | Gone, build passes |
| ~~0C-3~~ | ~~Delete `/actions` redirect route~~ | 5m | Gone, build passes |
| ~~0C-4~~ | ~~Delete `/opportunities` redirect route~~ | 5m | Gone, build passes |
| ~~0C-5~~ | ~~Run `npm run typecheck && npm test && npm run build`~~ | 5m | All pass |

### Phase 1: Morning Experience (2-3 days) — LAUNCH BLOCKER — **COMPLETE**

**Goal:** Today loads fast, scan runs in background, morning page is focused.

#### Track 1A: Non-blocking scan

| Step | Task | Files | Acceptance |
|------|------|-------|------------|
| ~~1A-1~~ | ~~Create scan status server action~~ | `src/app/(shell)/scan-status-action.ts` | ~~Returns current scan state~~ — `getScanStatus()` → `readScanState()` |
| ~~1A-2~~ | ~~Create trigger-scan server action~~ | `src/app/(shell)/trigger-scan-action.ts` | ~~Triggers scan, returns immediately~~ — `triggerScan()` → `runWebsiteScan({ trigger: "today" })` + `revalidatePath` when `scanRoutesShouldRevalidate` |
| ~~1A-3~~ | ~~Remove `await runWebsiteScan()` from Today `page.tsx` render~~ | `src/app/(shell)/page.tsx` | ~~Today renders immediately even when overdue~~ — no scan in RSC; `shouldTriggerScan` → client for 1A-5 |
| ~~1A-4~~ | ~~Create `ScanStatusBanner` client component~~ | `src/components/today/scan-status-banner.tsx` | ~~Shows "Scanning..." + polls + refreshes on complete~~ — banner with triggering/running/complete/failed states, 5s poll, `router.refresh()` |
| ~~1A-5~~ | ~~Wire banner into `today-client.tsx`~~ | `src/app/(shell)/today-client.tsx` | ~~Scan triggers on load if overdue~~ — banner at top of Today, `shouldTriggerScan` wired; dead `scanRanThisLoad`/`scanResult` code removed |
| ~~1A-6~~ | ~~Test full morning flow~~ | — | ~~Page loads fast → banner → scan → refresh~~ — verified: SSR returns `shouldTriggerScan:true` instantly, banner renders "Starting scan…", client fires `triggerScan()` once, scan resolves (failed in dev — no target site), banner shows terminal state. No temporary forcing needed; no fixes required |

#### Track 1B: Today simplification

**Target Today:** 5 sections max: scan status → primary action + next moves → findings queue → visibility KPIs → milestone teaser.

| Step | Task | Acceptance |
|------|------|------------|
| ~~1B-1~~ | ~~Map current Today sections, classify KEEP / MOVE / COLLAPSE~~ | ~~Decision doc~~ — 14 sections mapped; KEEP 8, REMOVE 3 (secondary recs, replication cards, morning order text), COLLAPSE 2 (accepted findings, performance), MOVE 1 (HowWeKnowPanel). See `VERIFICATION_LOG.md` |
| ~~1B-2~~ | ~~Remove inline attribution review queue → compact link to `/changes?tab=attribution`~~ | ~~Queue gone~~ — **NO-OP 2026-04-12:** no inline attribution review list on Today; only System-line link to `/changes?tab=attribution` when `reviewHeuristicLine` yields a pending count (see `VERIFICATION_LOG.md`) |
| ~~1B-3~~ | ~~Remove secondary recommendation cards (keep primary only)~~ | ~~One action card~~ — `SecondaryOpportunities` + `secondaryRecommendations` / `topRecs` wiring removed |
| ~~1B-4~~ | ~~Remove replication cards → compact note with link~~ | ~~Cards gone~~ — `ReplicationCardsClient` removed; one-line link to `/changes?tab=replicate` when at least one unique beneficiary page; `serializeReplicationCards` dropped from Today path |
| ~~1B-5~~ | ~~Remove performance trend (lives on Changes)~~ | ~~Section gone~~ — `TodayPerformance` + `performanceData` removed from Today; `buildPerformanceTimeseries` dropped from `page.tsx` (`buildCompetitorRank` kept for milestones) |
| ~~1B-6~~ | ~~Remove entity discrepancies~~ | ~~Section gone~~ — **NO-OP:** no dedicated entity-discrepancy UI on Today; `page.tsx` only adds a `nextCandidates` item (generic `summary.nextMove` if selected); `FindingRow` “Mismatch” is changelog/crawl for findings, not entity domain |
| ~~1B-7~~ | ~~Collapse accepted findings to count only~~ | ~~Compact~~ — full accepted list removed; `acceptedAwaitingPromotionCount` + one-line link to `/pages`; `serializedAcceptedFindings` removed from Today path |
| ~~1B-8~~ | ~~Collapse experiments to summary line~~ | ~~Compact~~ — **NO-OP:** no standalone experiments list on Today; `serializedExperiments` is computed in `page.tsx` but not passed to `TodayClient`; `WatchlistExperimentCard` exists in `today-client.tsx` but is never rendered (experiments = primary “Accept & test” only) |
| ~~1B-9~~ | ~~Remove verified fixes (past-tense, not morning-facing)~~ | ~~Section gone~~ — **NO-OP:** `verifiedFixes` is passed into `buildTodaySummary` but `TodayClient` never renders `summary.verifiedFixes`; no standalone verified-fixes block on Today |
| ~~1B-10~~ | ~~Remove unused server computation from `page.tsx`~~ | ~~`page.tsx` < 600 lines~~ — removed dead `serializedExperiments`, `trackRecordSummary`/`outcomeSummary`, unused imports (`computeOutcomeSummary`, `outcomeRecords`, `updateExperimentAction`); experiment citation sync unchanged |
| ~~1B-11~~ | ~~Verify simplified Today renders correctly~~ | ~~5 focused sections~~ — **verified 2026-04-12** (+ same-day follow-up re-run with full `typecheck`/`test`/`build` + `GET /` — see `VERIFICATION_LOG.md` Phase 1B-11 entries): `GET /` HTTP 200, no error boundary; SSR shows Since last scan, primary action, coverage/safety strip (when stale), System line; `ScanStatusBanner` mounted (hidden when `shouldTriggerScan:false` per design); milestone teaser conditional (null in sample); removals confirmed absent in HTML + `today-client.tsx` audit. |

#### Track 1C: Render-time side effects

| Step | Task | Acceptance |
|------|------|------------|
| ~~1C-1~~ | ~~Move outcome backfill from Today render to post-import~~ | ~~Zero mutations during render~~ — **done 2026-04-12:** `backfillFromExistingData` + `persistOutcomes` removed from `page.tsx`; `runOutcomeBackfill()` created in `src/domains/product/outcome-backfill.ts`; wired into `executeImport` + `importWorkbook` in `src/lib/import/actions.ts` |
| ~~1C-2~~ | ~~Move experiment citation update to post-scan/import~~ | ~~Zero mutations during render~~ — **done 2026-04-12:** `updateExperimentCitations` + `persistExperiments` removed from `page.tsx`; `runExperimentCitationSync()` created in `src/domains/product/experiment-citation-sync.ts`; wired into `executeImport` + `importWorkbook` in `src/lib/import/actions.ts` |
| ~~1C-3~~ | ~~Audit `page.tsx` for remaining write ops in render~~ | ~~Zero persist/write/update calls~~ — **done 2026-04-12:** found + removed `syncMilestonesFromWorkspace()` (disk write via `writeStore`); created `src/domains/milestones/post-import-sync.ts`; wired `runMilestoneSync()` into `executeImport` + `importWorkbook`; `getMilestoneState()` (read-only) replaces sync in render; removed dead `perfCompetitorRank` + imports (`buildCompetitorRank`, `classifyCompetitorType`). Full audit confirmed zero remaining writes in `page.tsx` render path. |

### Phase 2: Trust & Onboarding (2-3 days) — LAUNCH BLOCKER — **COMPLETE**

**Goal:** New users understand what they're seeing. Data freshness is visible.

| Step | Task | Acceptance |
|------|------|------------|
| ~~2A-1~~ | ~~Create `DemoBanner` component (sticky, dismissable, links to import)~~ | ~~Component renders~~ — **done 2026-04-12:** created `src/components/shell/demo-banner.tsx`; client component with `useState` dismiss; sticky `top-0 z-40`; warning-toned strip; "Sample data" label + link to `/settings/import`; not mounted yet (2A-2/2A-3 handle flag + conditional render) |
| ~~2A-2~~ | ~~Pass `isDemoMode` flag from shell layout~~ | ~~Flag computed correctly~~ — **done 2026-04-12:** `src/app/(shell)/layout.tsx` sets `isDemoMode = !hasActiveExperiment()` (same signal as seed hydration: empty `import-runs` ⇒ bundled sample data). Passed to `ShellProvider` as `isDemoMode`; exposed on `ShellContext` for `useShell()`. `DemoBanner` not rendered this step (2A-3). |
| ~~2A-3~~ | ~~Render `DemoBanner` conditionally~~ | ~~Shows when no imports, hidden after import~~ — **done 2026-04-12:** `DemoBannerGate` in `demo-banner.tsx` (`if (!isDemoMode) return null`); single mount in `src/app/(shell)/layout.tsx` as first child inside `<main>` (scroll container) so `sticky top-0` applies; `p-6 lg:p-8` moved to inner `max-w-[1120px]` wrapper. No new demo logic. |
| ~~2B-1~~ | ~~Add Today empty state ("Import your data to see briefing")~~ | ~~Guidance when empty~~ — **done 2026-04-12:** `isDemoMode = !hasActiveExperiment()` in `page.tsx` (same signal as 2A); passed to `TodayClient`. When true: `ScanStatusBanner` + compact import section (`/settings/import` CTA); briefing blocks (`HowWeKnowPanel` through System line) hidden. When false: unchanged full Today. |
| ~~2B-2~~ | ~~Add Pages empty state~~ | ~~Guidance when empty~~ — **done 2026-04-12:** `src/app/(shell)/pages/page.tsx` — `!hasActiveExperiment()` early return (same signal as Today 2B-1 / shell demo). Renders existing route header + compact `<section>` (“Import your data to see your real page list”, `/settings/import` CTA). Skips `PagesClient` and all row prep when demo. Normal `/pages` unchanged after import. |
| ~~2B-3~~ | ~~Add Changes empty state~~ | ~~Guidance when empty~~ — **done 2026-04-12:** `src/app/(shell)/changes/page.tsx` — `!hasActiveExperiment()` early return before scorecard/replication/attribution work. Same `PageHeader` as normal route + compact `<section>` (“Import your data to see your real Changes workspace”, `/settings/import` CTA). Skips `syncMilestonesFromWorkspace` and full tab shell when demo. Normal `/changes` unchanged after import. |
| ~~2B-4~~ | ~~Verify Market empty state (already exists)~~ | ~~Works and links to import~~ — **done 2026-04-12:** **Verified** existing `benchmark === null` branch (“No citation evidence yet” + `/settings/import`) — **not** the same as `!hasActiveExperiment()` (demo seed can still have citation index). **ADDED** `!hasActiveExperiment()` early return in `src/app/(shell)/competitors/page.tsx`: same `PageHeader` + compact section (“Import your data to see your real Market view”, `/settings/import`). Post-import missing-citation path unchanged below. |
| ~~2B-5~~ | ~~Refine "All Clear" — don't show when no data exists~~ | ~~Only when data exists AND nothing needs attention~~ — **done 2026-04-12:** `shouldShowTodayAllClear` in `src/lib/today-ritual.ts` accepts optional `isDemoMode`; returns **false** immediately when true (same signal as Today prop: `!hasActiveExperiment()` from `page.tsx`). `TodayClient` passes `isDemoMode`. Real-data rules unchanged when `isDemoMode` is false/omitted. Vitest: new case in `tests/lib/today-ritual.test.ts`. |
| ~~2C-1~~ | ~~Create `DataFreshnessStrip` component~~ | ~~Shows import + scan timestamps~~ — **done 2026-04-12:** `src/components/shell/data-freshness-strip.tsx` — presentational `DataFreshnessStrip` + `DataFreshnessStripProps`: `lastImportAt`, `lastScanCompletedAt` (ISO strings | null), optional `className`. Aligns with `getDataCoverage().lastImportAt` and `latestWebsiteCrawlRun()?.completed_at`. Compact shell-style row; **not mounted** (2C-2). |
| ~~2C-2~~ | ~~Wire into shell layout~~ | ~~Visible on all routes~~ — **done 2026-04-12:** `src/app/(shell)/layout.tsx` — single mount **immediately after `<AppHeader />`**, before `<main>` (fixed strip while main scrolls). Props: `lastImportAt` = newest `importRuns[].started_at` via same sort as `getDataCoverage()` (no new logic); `lastScanCompletedAt` = `latestWebsiteCrawlRun()?.completed_at`. `className="shrink-0 px-6"` aligns horizontal padding with header. |

### Phase 3: Settings Coherence (1-2 days) — PRE-LAUNCH — **COMPLETE**

**Goal:** Settings tabs make sense to operators.

| Step | Task | Acceptance |
|------|------|------------|
| ~~3-1~~ | ~~Create real Config page (editable business settings, not setup wizard)~~ | ~~Config page shows current settings~~ — **done 2026-04-12:** `src/app/(shell)/settings/config/page.tsx` (RSC, `dynamic = "force-dynamic"`) loads `getBusinessConfig()`; `config-form.tsx` client form for **name, domain, industry, locations, services, primaryCompetitors** (comma lists → arrays). **Save:** `saveSetup` in **`settings/config/actions.ts`** (moved from removed **`setup/`** in Phase 3-6) → `saveBusinessConfig()` + `revalidatePath("/", "layout")`. **Persistence:** `.data/business-config.json` via `src/lib/business-config.ts`. |
| ~~3-2~~ | ~~Hide Health tab from settings~~ | ~~Not visible~~ — **done 2026-04-12:** removed `{ href: "/settings/health", label: "System Health" }` from **`TABS`** in `src/app/(shell)/settings/layout.tsx` only. **`src/app/(shell)/settings/health/page.tsx`** unchanged; **`/settings/health`** still resolves (manual / bookmark access). |
| ~~3-3~~ | ~~Rename History tab → "Data"~~ | ~~Tab says "Data"~~ — **done 2026-04-12:** in `src/app/(shell)/settings/layout.tsx` **`TABS`**, changed label from **"Measurement History"** to **"Data"** for `{ href: "/settings/history", ... }`. **Route unchanged:** still **`/settings/history`**; no file moves; no `aria-*` on these links beyond default `Link` behavior. |
| ~~3-4~~ | ~~Add framing text to Data tab~~ | ~~Contextual header~~ — **done 2026-04-12:** `src/app/(shell)/settings/history/page.tsx` wraps default **`ResultsPage`** import: a **`role="note"`** block **above** the existing results tree only on this route. Copy: imported row-level visibility + citation evidence, raw material for other routes, use for **audit / linkage / freshness**, not attribution or recommendations. **No** changes to results data path; framing only on **`/settings/history`** (see 3-7: `results-page.tsx` under settings). |
| ~~3-5~~ | ~~Remove standalone `/import` route (keep only `/settings/import`)~~ | ~~One path only~~ — **done 2026-04-12:** deleted **`src/app/(shell)/import/page.tsx`** (and empty `(shell)/import/`). UI moved to **`src/app/(shell)/settings/import/import-page.tsx`**; **`settings/import/page.tsx`** re-exports `export { default } from "./import-page"`. **Link fix:** `src/app/(shell)/diagnostics/page.tsx` **`/import` → `/settings/import`**. **`/settings/import`** unchanged functionally. |
| ~~3-6~~ | ~~Remove standalone `/setup` route~~ | ~~One path only~~ — **done 2026-04-12:** removed **`src/app/(shell)/setup/`** (`page.tsx` two-step wizard + **`actions.ts`**). **`saveSetup`** / **`loadSetup`** moved to **`src/app/(shell)/settings/config/actions.ts`** (same implementations). **`config-form.tsx`** imports **`./actions`**. No **`href="/setup"`** in `src/` (nothing to retarget). **`/settings/config`** remains the sole setup/config **route**; wizard UI removed as superseded by Config (3-1). |
| ~~3-7~~ | ~~Remove standalone `/results` route~~ | ~~One path only~~ — **done 2026-04-12:** removed **`src/app/(shell)/results/`** (`page.tsx`, `results-client.tsx`, **`[id]/page.tsx`**). Files live under **`src/app/(shell)/settings/history/`**; **`page.tsx`** imports **`./results-page`**. In-app **`href`s** **`/results`** / **`/results/:id`** → **`/settings/history`** / **`/settings/history/:id`** (import page, diagnostics, briefs, changes detail, pages client, review queue, topics, attribution/brief/outcome components, history clients). |
| ~~3-8~~ | ~~Verify all settings tabs work~~ | ~~All functional~~ — **verified 2026-04-12:** Code review: **`settings/layout.tsx`** `TABS` = Import, Config, Data only (no Health). **`rg`** on `src/` — no `href`/`router` targets to **`/import`**, **`/setup`**, or bare **`/results`**. **`curl`** (dev `127.0.0.1:3000`): **`/settings/import`**, **`/config`**, **`/history`**, **`/health`** → **200**; **`/import`**, **`/setup`**, **`/results`** → **404**. Data HTML contains **“Imported measurements”** (3-4 framing). **`npm run typecheck` / `test` / `build`** — pass. **No code changes.** |

### Phase 4: Component Quality (3-4 days) — **COMPLETE**

**Goal:** Break mega-components, reduce maintenance risk.

| Step | Task | Acceptance |
|------|------|------------|
| ~~4-1~~ | ~~Extract `TodayScanStrip` from `today-client.tsx`~~ | ~~Renders independently~~ — **done 2026-04-12:** added **`src/components/today/today-scan-strip.tsx`** — **`TodayScanStrip`** with prop **`shouldTriggerScan`**; renders same comment + **`ScanStatusBanner`** (no logic changes). **`today-client.tsx`** imports **`TodayScanStrip`**, replaces inline banner. **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-2~~ | ~~Extract `TodayPrimaryAction`~~ | ~~Handles display + actions~~ — **done 2026-04-12:** **`src/components/today/today-primary-action.tsx`** — primary recommendation card (bucket styles, Basis, accept/defer/dismiss, **Accept & test** + `onStartExperiment`) and **`summary.nextMove`** fallback card; **`BUCKET_STYLE`** moved here. Props: **`primaryAction`**, **`nextMove`**, callbacks, **`pending`**, **`startTransition`**, **`actionMsg`**, **`setActionMsg`** (same shared transition/feedback as watchlist). **`today-client.tsx`** replaces inline block with **`<TodayPrimaryAction ... />`**. |
| ~~4-3~~ | ~~Extract `TodayFindings`~~ | ~~Handles display + resolve~~ — **done 2026-04-12:** **`src/components/today/today-findings.tsx`** — **`TodayFindings`** + **`FindingRow`** + **`PRIORITY_STYLE`**; “Since last scan” all-clear, grouped pending findings (same priority buckets / header copy), accepted-awaiting-promotion line + **`/pages`** link. Props: **`pendingFindings`**, **`resolvedFindingsCount`**, **`scanCompletedAt`** (was **`run?.completed_at`**), **`crawlAgeDays`**, **`onResolveFinding`**, **`onPromoteFinding`**, **`acceptedAwaitingPromotionCount`**. **`SerializedFinding`** type-only import from **`today-client`** (same pattern as 4-2). **`today-client.tsx`** replaces inline block with **`<TodayFindings ... />`**; upstream finding computation unchanged. |
| ~~4-4~~ | ~~Extract `TodayVisibilitySnapshot`~~ | ~~Proof + coverage + system shell~~ — **done 2026-04-12:** **`src/components/today/today-visibility-snapshot.tsx`** — **`HowWeKnowPanel`** + morning-order line; merged **coverage / freshness** strip (same **`crawlStale` / `visStale` / `coverageTone`** rules); **“Done for today”** all-clear block; **System** line (scan age, visibility fresh/stale/no data, attribution pending link, Health). **`children`** slot preserves DOM order for milestone teaser + **`TodayFindings`** + **`TodayPrimaryAction`** + replication one-liner (unchanged markup; parent still computes **`deriveCoverageTone`**, **`shouldShowTodayAllClear`**, **`reviewPending`**). Props explicit scalars + **`proofContext`**. **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-5~~ | ~~Compose Today from extracted components~~ | ~~`today-client.tsx` < 300 lines~~ — **done 2026-04-12:** removed dead code: **`WatchlistExperimentCard`**, **`GROUP_CONFIG`**, **`WATCHLIST_STATUS_PRESENTATION`**, **`MANUAL_STATUS_OPTIONS`**, **`REC_ACCENT`**, **`formatExperimentStarted`**, **`recTypeDisplayLabel`**, **`formatScanTime`**; dead types **`TodayImpactItem`**, **`TodayExperiment`**, **`TodayTrackRecord`**, **`VisibilitySummary`**; dead imports **`cn`**, **`ReactNode`**, **`ChangeVerdict`**, **`ImpactConfidence`**, **`ImpactDirection`**. File is now **299 lines** — clean orchestration: types + component composition only. |
| ~~4-6~~ | ~~Extract `PageRowCard` from `pages-client.tsx`~~ | ~~Renders one row~~ — **done 2026-04-12:** **`src/components/pages/page-row-card.tsx`** — **`PageRowCard`** (left-queue row button: label, status/open-items line, mentions / pending / scan / Q&A / schema / canonical / next-move chips). **`STATUS_CONFIG`** + **`NEXT_MOVE`** moved here and **re-exported**; **`pages-client.tsx`** imports them for the detail panel (single source of truth). **`import type { PageRow }`** from **`pages-client`** (type-only). **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-7~~ | ~~Compose Pages from extracted components~~ | ~~`pages-client.tsx` < 400 lines~~ — **done 2026-04-12:** **`src/components/pages/pages-selected-detail.tsx`** (~739 lines) — selected-page right pane (header, scan verdict, crawl snapshot, diff, actions, wave, fix/playbook briefs, changes/events) + **`CrawlRow` / `CrawlChip` / `DiffChip`** + **`STATUS_BADGE`** (moved from **`pages-client`**). **`src/components/pages/pages-workbench-top.tsx`** (~157 lines) — crawl warning, KPI strip + donut, scan button + last-scan + view tabs. **`pages-client.tsx`** now **340 lines** (was **1114**): types + **`PagesClient`** orchestration only. Removed dead **`PAGE_TYPE_LABELS`** (unused). Dropped unused **`Link`**, **`cn`**, **`ChangeVerdictBadge`**, **`KpiCard`**, **`DonutRing`** imports from **`pages-client`**. **`npm run typecheck` / `test` / `build`** — pass. |
| ~~4-8~~ | ~~Extract Today server computation to separate modules~~ | ~~`page.tsx` < 400 lines~~ — **done 2026-04-12:** **`src/app/(shell)/today-data.ts`** — **`loadTodayPageData()`** returns **`TodayPageData`** (same props as **`TodayClient`** minus the four server-action callbacks). All former RSC prep (demo mode, scan overdue, stores/summary, recommendations, replication line, local operator strip, **`proofContext`**, serialized findings, milestone teaser read path, **`formatTimeAgo`**) moved verbatim; **`page.tsx`** = **`await loadTodayPageData()`** + **`<TodayClient {...data} onRespondToRec={…} … />`**. **~21 lines.** No render-time writes (read-only prep; Track 1C unchanged). |
| ~~4-9~~ | ~~Run `npm run typecheck && npm test && npm run build`~~ | ~~All pass~~ — **done 2026-04-12:** same gate run as **4-8** verification — **`npm run typecheck`**, **`npm run test`** (78/78), **`npm run build`** — all pass. |

### Phase 5: Testing & Observability (2-3 days) — **COMPLETE**

**Goal:** Structured logging, route smoke tests, scan crash recovery.

| Step | Task | Acceptance |
|------|------|------------|
| ~~5-1~~ | ~~Create `src/lib/logger.ts` (JSON, levels, context)~~ | ~~Logger works~~ — **done 2026-04-12:** **`src/lib/logger.ts`** — `log.debug/info/warn/error(msg, context?)`. Single JSON line per call: `{ level, ts, msg, context? }`. Uses `console.log` / `.warn` / `.error` by level. Handles circular refs safely. 47 lines. No external deps. |
| ~~5-2~~ | ~~Add logging to scan orchestrator~~ | ~~Scan ops logged~~ — **done 2026-04-12:** **`src/domains/scanning/orchestrate-scan.ts`** — `import { log } from "@/lib/logger"`. **`runWebsiteScan`:** `log.info("Scan started", { runId, trigger })` where `runId = scan-${Date.now()}`, `trigger` = **`auto`** iff `ScanTrigger === "import"` else **`manual`**; **`log.error("Scan failed", { runId, durationMs, error })`** on CLI `exec` rejection or missing/invalid `last-scan-result`; **`log.info("Scan completed", { runId, durationMs, resultCount })`** when terminal `ok` (success or partial with `pagesScanned > 0`); else **`log.error("Scan failed", …)`** with `error` from `cliError` / `aborted` / exit. No orchestration or revalidate changes. |
| ~~5-3~~ | ~~Add logging to import engine~~ | ~~Import ops logged~~ — **done 2026-04-12:** **`src/lib/import/actions.ts`** only — **`executeImport`**: `log.info("Import started", { runId: batchId, source: "upload" })` after id mint; parse catch → `log.error("Import failed", { runId, durationMs, error })`; terminal **`imported > 0`** → `log.info("Import completed", { runId, durationMs, rowCount: imported })`; else **`log.error("Import failed", …)`** with first row error or “No data rows” / “No rows imported”. **`importWorkbook`**: missing file → `log.error("Import failed", { runId: "", error: "No file provided" })` (no **`Import started`**); else same start pattern; parse catch → **`Import failed`**; success path → **`Import completed`** with **`rowCount: run.imported_count`** (existing run aggregate). **`source`** is **`upload`** for both entry points (settings UI); no **`api`** path yet. **`postImportSetup`** unchanged. |
| ~~5-4~~ | ~~Add logging to server actions~~ | ~~Actions logged~~ — **done 2026-04-12:** Outer-boundary **`log.info("Action started", { action, params })`** / **`log.info("Action completed", { action, durationMs })`** / **`log.error("Action failed", { action, durationMs, error })`** on all targeted **`"use server"`** exports below. **Params** are IDs, enums, lengths, counts, or patch key lists only — no raw CSV/HTML/body text. **Not instrumented:** **`getScanStatus`** (client poll noise), **`loadSetup`** (read-only), **`executeImport`** / **`importWorkbook`** (already **`Import *`** in **5-3**), inline **`use server`** blocks in **`page.tsx`**. **Files:** **`trigger-scan-action.ts`**, **`pages/scan-action.ts`**, **`recommendation-actions.ts`**, **`experiment-actions.ts`**, **`finding-actions.ts`**, **`settings/config/actions.ts`** (`saveSetup`), **`pages/wave-actions.ts`**, **`pages/issue-actions.ts`**, **`pages/verify-action.ts`**, **`topics/package-actions.ts`**, **`competitors/competitors-actions.ts`**, **`changes/contract-actions.ts`**, **`lib/import/actions.ts`** (`previewImport`, **`clearEntityData`**, **`clearImportedData`**, **`resetExperiment`**, **`postImportSetup`**), **`domains/actions/actions.ts`**, **`domains/attribution/candidate-actions.ts`**, **`domains/changelog/actions.ts`**, **`domains/results/actions.ts`**, **`domains/briefs/actions.ts`**, **`domains/opportunities/actions.ts`**, **`domains/opportunity-candidates/actions.ts`**, **`domains/brief-generation/actions.ts`**, **`adapters/profound/actions.ts`**. |
| ~~5-5~~ | ~~Create route smoke test: Today renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/today-smoke.test.ts`** — dynamic import **`TodayPage`** from **`@/app/(shell)/page`**, **`await TodayPage()`**, **`renderToStaticMarkup`**. **`TodayClient`** mocked to a hook-free stub emitting **`Since last scan`** (matches real **`today-findings`** heading; avoids **`useState`** under Vitest). Asserts **`max-w-3xl`** (real **`page.tsx`** wrapper) + stub string. **`next/cache`** mocked. **`npm run typecheck` / `test`** (79/79) / **`build`** — pass. |
| ~~5-6~~ | ~~Create route smoke test: Pages renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/pages-smoke.test.ts`** — **`await import("@/app/(shell)/pages/page")`**, sync **`PagesPage()`**, **`renderToStaticMarkup`**. **`PagesClient`** stubbed (empty div; client hooks). Asserts **`max-w-5xl`** + subtitle **`Health, citations, and the next step for each URL.`** from RSC (**`page.tsx`**, demo + full). **`next/cache`** mocked. **`npm run typecheck` / `test`** (80/80) / **`build`** — pass. |
| ~~5-7~~ | ~~Create route smoke test: Changes renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/changes-smoke.test.ts`** — **`await import("@/app/(shell)/changes/page")`**, async **`ChangeScorecardPage()`**, **`renderToStaticMarkup`**. **`ChangesTabShell`** stubbed (**`useState` / `useSearchParams`**). Asserts **`PageHeader`** description **`What worked. What to scale. Why visibility moved.`** and layout class string **`flex items-start justify-between gap-4 mb-8`** (no root **`max-w-*`** on Changes — **`PageHeader`** structure instead). **`next/cache`** mocked. **`npm run typecheck` / `test`** (81/81) / **`build`** — pass. |
| ~~5-8~~ | ~~Create route smoke test: Market renders~~ | ~~Test passes~~ — **done 2026-04-12:** **`tests/routes/market-smoke.test.ts`** — **`await import("@/app/(shell)/competitors/page")`**, async **`CompetitorsPage()`**, **`renderToStaticMarkup`**. **`next/cache`** mocked. Five **`"use client"`** sections stubbed (**`CompetitorsManageClient`**, **`CoMentionSection`**, **`SourceTrustSection`**, **`LocalPressureSection`**, **`BattlecardSection`**) so Vitest never executes hooks when import + citation data mounts the full Market tree. Asserts **`max-w-4xl`** + **`PageHeader`** description **`Who beats you, where they beat you, and exactly what to do about it.`** (demo + full **`competitors/page.tsx`**). **`npm run typecheck` / `test`** (82/82) / **`build`** — pass. |
| ~~5-9~~ | ~~Add scan crash recovery (stale-running detection)~~ | ~~Stuck scans auto-recover~~ — **done 2026-04-12:** Three files changed. **`src/domains/scanning/scan-state.ts`:** added **`STALE_SCAN_THRESHOLD_MS`** (5 min = 300 000 ms; CLI timeout 120 s), **`runningScanAgeMs(state)`** (age of running scan from `updatedAt`), **`isScanRunningAndFresh(state)`** (true only when running AND under threshold). **`src/domains/scanning/orchestrate-scan.ts`:** at top of **`runWebsiteScan`**: (1) if `phase === "running"` **and fresh** → return early with `phase: "running"` + `error` (duplicate guard, no concurrent scans); (2) if `phase === "running"` **and stale** → `log.warn("Scan marked stale", { runId, ageMs, thresholdMs })`, write failed payload via `writeIdleScanStateFromLastResult`, `log.info("Recovered stale scan state", { runId })`, then proceed to start new scan. **`src/app/(shell)/scan-status-action.ts`:** `getScanStatus()` normalizes stale `running` → `phase: "failed"` + message `"Previous scan appears to have crashed — ready to retry"` so the UI never shows "scanning" indefinitely. Normal active-scan behavior unchanged. **`npm run typecheck` / `test`** (82/82) / **`build`** — pass. |
| ~~5-10~~ | ~~Full test suite passes~~ | ~~All green~~ — **done 2026-04-12 (verification-only):** Full gate **`npm run typecheck`** ✓ · **`npm run test`** ✓ **82**/82 (20 test files) · **`npm run build`** ✓ (17 static ○ + 4 dynamic ƒ). **Phase 5 checklist:** **`src/lib/logger.ts`** present; scan (**`orchestrate-scan.ts`**) + import (**`lib/import/actions.ts`**) + shared server-action logging unchanged from **5-2**–**5-4**; route smokes **`tests/routes/today-smoke.test.ts`**, **`pages-smoke.test.ts`**, **`changes-smoke.test.ts`**, **`market-smoke.test.ts`** all in suite; stale-running recovery (**`scan-state.ts`**, **`orchestrate-scan.ts`**, **`scan-status-action.ts`**) unchanged. **No app code changes** for this step. **Phase 5 closed.** |

---

## Top 25 Highest-Leverage Fixes

Full details: `docs/archive/audits/TOP_25_HIGHEST_LEVERAGE_FIXES.md`

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Error boundaries | 2 hrs | Prevents route crashes |
| 2 | Loading states | 1 hr | Prevents blank pages |
| 3 | Move scan out of render | 4-6 hrs | Fixes morning experience |
| 4 | Demo mode indicator | 2 hrs | Fixes new user trust |
| 5 | Empty states | 3-4 hrs | Fixes new user experience |
| 6 | Today simplification (15→5 sections) | 4-6 hrs | Reduces cognitive load |
| 7 | Split mega-components (1000+ lines) | 6-8 hrs | Maintainability |
| 8 | Remove render-time side effects | 2-3 hrs | Correctness |
| 9 | Clean dead weight (PDFs, legacy adapter) | 1 hr | Repo hygiene |
| 10 | Structured logging | 3-4 hrs | Production debugging |
| 11 | Settings restructure | 4-6 hrs | UX coherence |
| 12 | Route smoke tests | 4-6 hrs | Regression safety |
| 13 | Scan crash recovery | 2 hrs | Reliability |
| 14 | Module-cache invalidation strategy | 4-6 hrs | Production data freshness |
| 15 | Supabase scan output sync | 4-6 hrs | Data layer parity |
| 16 | "Business consequence" copy honesty | 2 hrs | Trust |
| 17 | Today server computation extraction | 3-4 hrs | Maintainability |
| 18 | Pages pagination | 3-4 hrs | Scale |
| 19 | Terminology cleanup (Beacon Intel, contracts) | 2 hrs | UX |
| 20 | Dark mode | 4-6 hrs | Premium feel |
| 21 | Onboarding flow (setup → import → first scan) | 6-8 hrs | First-run experience |
| 22 | Health check endpoint | 1 hr | Deployment safety |
| 23 | Rate limiting for scan target site | 2 hrs | Good citizenship |
| 24 | Scan retry on transient failure | 2-3 hrs | Reliability |
| 25 | E2E tests (Playwright) | 8-12 hrs | Confidence |

---

## Future Roadmap: Tiered Product Stack (post-launch)

These are **research-led nano-phases** — each is a mini-prompt slice, not a monolithic phase. Execute sequentially within each track. Tracks can run in parallel where dependencies allow.

### Tier 1 — Core product completion

| Track | Focus | Key deliverables | Exit gate |
|-------|-------|-------------------|-----------|
| 1.1 | Proof layer | Methodology shell, confidence lexicon, lineage fields, adversarial FAQ | **1.1j signed off (2026-04-13)** |
| 1.2 | Daily ritual | Inbox-zero definition, digest channel, assignment model, keyboard path | 1.2h signed off |
| 1.3 | Replication engine | Winner definition v2, pattern gap analysis, queue IA, experiment linkage | 1.3h signed off |
| 1.4 | Local listings/reviews | GBP read-path, health score, review monitoring, NAP checks | 1.4l signed off |
| 1.5 | Milestones/ATH | ATH metrics, rolling windows, celebration UX, history store | 1.5g signed off |

**Tier 1 closed when:** 1.1j, 1.2h, 1.3h, 1.4l, 1.5g all signed off + one internal dogfood week without P0 trust regressions. **Evidence:** append dated rows + final note in `docs/TIER_1_DOGFOOD_WEEK_LOG.md` (see file for template).

### Tier 2 — Growth + differentiation

| Track | Focus | Key deliverables | Exit gate |
|-------|-------|-------------------|-----------|
| 2.1 | Revenue bridge | Signal inventory, identity graph feasibility, metric definitions, v1 bridge | 2.1g signed off |
| 2.2 | Weekly export | Audience variants, data inclusion rules, PDF/deck layout, generation pipeline | 2.2f signed off |
| 2.3 | Stronger competitor attack | Countermove taxonomy, one-click strategy, evidence packs, competitive narrative QA | 2.3h signed off |

**Tier 2 closed when:** 2.1g, 2.2f, 2.3h signed off + one agency pilot runs a week without manual spreadsheet side-channel.

**Full nano-phase breakdown:** Each track has 7-12 lettered research steps (e.g., 1.1a through 1.1j). Authoritative copy: `master_execution_plan.md` — heading **“Tiered product stack — research-led nano-phases (1.1a–2.3h)”** (section appears before **AUDIT SUMMARY** in that file).

### Native ingestion (Profound → API → Supabase) — prep only

- **Audit + gaps:** `docs/NATIVE_INGESTION_READINESS_AUDIT.md` (filename-prefix trap, merge vs full-replace semantics, field utilization, idempotency target).
- **Shipped in prep pass:** Workbook import **removed**; `writeLegacyBridge` **dual-writes** results / changelog / import-runs when `DUAL_WRITE=true`. **2026-04-13:** Profound batch uses **header-based CSV discovery** + **merge-safe** ingest (multi-file, stable keys); filename prefixes no longer required.
- **Not shipped:** Staging tables, worker, API transport, repository-only reads — design in audit; implement when Tier 1 dogfood + operator answers to §7 unblock.

---

## Cursor Prompts (ready to paste)

Full prompt library: `docs/archive/audits/CURSOR_PROMPTS_BY_PHASE.md`

### Phase 0A — Error Boundaries (COMPOSER)

> Create error.tsx files for Beacon's Next.js App Router shell. Create `src/app/(shell)/error.tsx` and `src/app/(shell)/settings/error.tsx`. Each must: (1) be a client component with "use client", (2) accept `{ error, reset }` props, (3) render a centered card with Geist font, app colors, "Something went wrong" heading, error.message in muted text, and a "Try again" button that calls reset(). Style to match the existing app (see any page for tokens). Do NOT touch any other files. Verify: `npm run build` passes.

### Phase 0B — Loading States (COMPOSER)

> Create loading.tsx files: `src/app/(shell)/loading.tsx`, `src/app/(shell)/pages/loading.tsx`, `src/app/(shell)/changes/loading.tsx`. Each should render a skeleton layout matching its route: shell loading shows sidebar + content area skeleton, pages shows a list skeleton, changes shows a table skeleton. Use subtle pulse animation. Match existing app styling. Do NOT modify any existing files. Verify: `npm run build` passes.

### Phase 1A — Non-Blocking Scan (COMPOSER)

> Refactor Today's auto-scan to be non-blocking. Currently `src/app/(shell)/page.tsx` lines 120-132 await `runWebsiteScan()` during render, blocking for up to 120s. Fix: (1) Create `src/app/(shell)/trigger-scan-action.ts` server action that calls `runWebsiteScan()` and returns immediately. (2) Create `src/app/(shell)/scan-status-action.ts` server action that reads scan state. (3) In page.tsx, instead of awaiting scan, just check `isScanOverdue()` and pass `shouldTriggerScan` boolean to client. (4) Create `src/components/today/scan-status-banner.tsx` client component: on mount if shouldTriggerScan, call trigger action; poll status every 5s; show "Scanning your site..." banner; on complete, call router.refresh(). Do NOT change scan logic, findings, or any other route. Verify: `npm run typecheck && npm test && npm run build`.

---

## Keep / Hide / Fix / Kill (summary)

Full matrix: `docs/archive/audits/KEEP_HIDE_FIX_KILL_MATRIX.md`

| Surface | Label | Key issue |
|---------|-------|-----------|
| Today | FIX | Scan blocks render, 15 sections, render-time side effects |
| Pages | KEEP | Strongest route. Minor: split components, add pagination |
| Market | KEEP | Real competitive intelligence. Minor: first-run guidance |
| Changes | KEEP | Core value. Minor: terminology cleanup |
| Settings | FIX | Import solid; Config/Health/History mismatched |
| Settings > Health | HIDE | Internal diagnostics, wrong audience |
| /diagnostics | HIDE | Correctly hidden from nav already |
| /expansion | HIDE | Correctly quarantined |
| /actions | REMOVED | Deleted 2026-04-12 (Phase 0C-3); `briefs/proposed` “View Action” → `/` |
| /opportunities | REMOVED | Deleted 2026-04-12 (Phase 0C-4); list was → `/competitors`, detail was → `/topics/opportunity/[id]` — use those URLs directly |
| changelogpdf/ | REMOVED | Deleted 2026-04-12 (Phase 0C-1) |
| src/adapters/legacy/ | REMOVED | Deleted 2026-04-12 (Phase 0C-2); was README-only, no imports |
