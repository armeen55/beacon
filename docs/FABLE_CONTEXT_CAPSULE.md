# Beacon — Fable Context Capsule (compressed handoff)

**Generated 2026-05-26** from session at HEAD `e16695a`, branch `claude/objective-davinci-c81e70`.
**Purpose:** Let a fresh/cheaper model (Fable) continue without re-reading the giant transcript.
Read this + `CLAUDE.md`. Big roadmap (mostly already built): `/Users/armeen/.claude/plans/enter-maximum-depth-planning-mode-twinkly-balloon.md`.

---

## 0. TL;DR (read this first)

**The product is essentially feature-complete locally.** The 13-section "maximum-depth lifecycle plan" was largely IMPLEMENTED in prior sessions. Do **NOT** rebuild shipped sections — verify, polish, and land instead.

**The path to "MVP done" is now operator-gated, not code-gated:**
1. **Operator must disable 2 GitHub workflows in the UI** (stop Actions-minute burn) — see §3.
2. **Operator must approve a push** at the Actions-reset window → land the 9-commit stack → merge → verify Vercel by SHA → hosted smoke → dogfood.
3. Two tiny **local** cleanups remain (types.ts doc-comment; MT-5 overload removal) — both deferred/approval-gated.

**You (Fable) cannot push, deploy, run GitHub Actions, run migrations, hit external/connector/LLM APIs, or change env.** All work is LOCAL: edit → typecheck → test → (build if routes) → **local commit only**. Never push.

---

## 1. Hard constraints (NON-NEGOTIABLE — currently in force)

- **NO push. NO GitHub Actions. NO Vercel. NO `gh` workflow/run/pr. No remote CI** until operator explicitly approves.
- **GitHub Actions minutes EXHAUSTED.** This is why everything stops at local commit.
- **NO** production mutations · **NO** new migrations · **NO** schema changes · **NO** external/connector/API/scrape/**LLM** calls · **NO** env changes.
- Local gates: `npm run typecheck` && `npm run test`. Add build for route/page changes:
  `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-founder npm run build`
- Pages stay thin; domain logic in `src/domains`. Reuse patterns. Don't touch unrelated files. No placeholder comments ("rest of logic here").
- **Docs sync mandatory** after any behavior/plan change: `docs/HANDOFF_VERIFIED_STATE.md` (state + next 3), `docs/NEXT_PHASE_EXECUTION_PLAN.md` (mark steps), `docs/VERIFICATION_LOG.md` (dated entry). If you add a `tests/architecture/*` test, add its row to `docs/ARCHITECTURE_INVARIANTS_CATALOG.md` (catalog-sync test enforces this).
- Don't weaken tests to reduce line count. Pause before destructive ops.
- End each task: "Task completed", 1–5 bullets, exactly one next recommendation, and `Recommended capability for next step: [Fast/Balanced/Max]`.

---

## 2. Git state

- Branch: `claude/objective-davinci-c81e70` · HEAD `e16695a` · **clean tree**.
- **9 commits ahead of `origin/main`, NOT pushed.** Local gate green at HEAD: typecheck ✅ · test **683 files / 13671 passed** ✅ · build exit 0 ✅.
- The 9 (oldest→newest): C7d (`3a35b67` today off-site tile) · C7e (`54b529d` recs off-site section) · MT-3A (`bbeeb31` operator surfaces by tenant) · MT-3B (`2e01669` deep helpers) · MT-3C (`b87f456` pure helpers require config) · MT-3C.2 (`f09b408` page-extractor helpers) · MT-4 (`239eb9f` doc truth-up) · footer-copy (`dd4c52f`) · ops-safety (`e16695a`).
- Remote is **`armeen55/beacon`**. ⚠️ Any prompt about "Finglish / MatchingGame / commit `4c53771`" was for a **DIFFERENT repo** — `4c53771` does not exist here. Ignore it.

---

## 3. BLOCKED ON OPERATOR (Armeen) — these unblock "MVP done"

1. **Stop the burn NOW (no push needed):** GitHub Actions UI → disable `daily-native-poll` + `poll-canary`. Instant, reversible. The committed cron-thinning (`e16695a`) only takes effect once merged to the default branch, so the UI toggle is the only pre-push burn-stop.
2. **At the Actions-reset window, approve a push.** Then the landing runbook (documented in `NEXT_PHASE_EXECUTION_PLAN.md` top entry):
   push `claude/objective-davinci-c81e70` → PR → merge to `main` → **watch the maiden CI `Build` step** (new in `e16695a`; first real run — if it needs env beyond `BEACON_TENANT_ID`/`BEACON_TENANT_SLUG`, add the secret or mark the one static route `/rank` dynamic) → verify Vercel serves the merged SHA + build passed → hosted smoke `/`, `/recommendations`, `/changes`, `/prompts`, `/diagnostics/off-site-authority` → re-enable thinned schedules → start dogfood after one clean scheduled cycle.

---

## 4. What's BUILT (do not rebuild — the plan is mostly done)

| Plan section | Status | Evidence in repo |
|---|---|---|
| §2 Time-to-Citation (A.1) | ✅ BUILT | `src/domains/citation-lifecycle/{thresholds,eligibility,canonicalize-url,compute-time-to-citation,lifecycle-stage,load-lifecycle,render-copy}.ts` + `/diagnostics/lifecycle-eligibility` |
| §3 Cross-Tenant Brain (A.2) | 🟡 VERIFIED — per-tenant DONE, cross-tenant stub-by-design | AUDITED 2026-05-26 (CORRECTED): env gates ✅, LLM-packet wiring ✅, sample thresholds ✅, `compute-tenant-thresholds.ts` ✅. **Per-tenant threshold replacement = FULLY WIRED + GREEN (S1 DONE):** `load-lifecycle.ts` resolves per-tenant thresholds via `computeTenantThresholds`, threads them into `deriveLifecycleStage` (which takes the optional 2nd arg), and `render-copy.ts` emits per-source customer copy — borrowed tooltip vs `buildPerTenantBenchmarkTooltip` ("Computed from {N} cited shipped edits on this site"). Consumed by `edit-lifecycle-tile` / `lifecycle-strip` / Changes `[id]`. Pinned by `threshold-decision-loader-wiring.test.ts`; 442 lifecycle tests green. (NOTE: the wiring lives in load-lifecycle/render-copy, NOT `thresholds.ts` which correctly stays the borrowed-constants source — my earlier "not wired" finding traced only thresholds.ts.) **Cross-tenant PRODUCER = intentional stub** (`getCrossTenantPatterns` → `[]`; correct at n=1; needs ≥2 tenants + LLM → S4). "Beacon learned" tile + scrubber = S4. |
| §4 Indexability + GSC (A.3) | ✅ BUILT | `src/domains/indexability/*` + `src/lib/connectors/gsc/*` + migrations (sitemap/robots mirror, `gsc_url_inspections`) + `/diagnostics/indexability` |
| §4.5 Recommendation Intelligence | ✅ VERIFIED COMPLETE | AUDITED 2026-05-26: all 9 safety props ENFORCED — no-LLM-decides-existence (16 deterministic triggers fire before any draft), evidence/confidence/dedupe/cooldown gates, customer-copy vocab scan (15 templates), index-outranks-content (priority score), off-site detection-only (3 defense layers), 13-step promotion safety ladder, tenant isolation. **Customer-queue flip LIVE** (`promote-to-queue`/`promotion-writer`, `dryRun` default-true, operator-only live-write guard + 8 source pins). `generatorActive` = **15**. 20 dedicated arch tests. **No loopholes.** |
| §5 Repeat-Citation | ✅ BUILT | `citation-lifecycle/{compute,load}-repeat-citation.ts` + Today counters (`2c2a551`) + `/diagnostics/repeat-citation` |
| §6 Primary Recommendation | ✅ BUILT | `citation-lifecycle/change-primary-mode-{a,b}.ts` + migration `2026-05-15_section6_primary_recommendation_column.sql` |
| §7 Off-Site Authority | ✅ BUILT | `src/domains/off-site-authority/*` (C7a–C7e); C7d/C7e + footer shipped THIS session |
| §8 GSC depth | ✅ VERIFIED COMPLETE | AUDITED 2026-05-26: J2 expiry-handler (7-day soft-fail) ✅, J3 quota-stagger (4h hash-bucket + backoff) ✅, J4 rich fields (last_crawl_time + mobile_usability) ✅, J5 soft-disconnect ✅, invariants (property-mapping + no-call-on-load + tenant-isolation) ✅. J1 multi-property correctly deferred. **No gaps.** |
| §9 Outcome Attribution | ✅ VERIFIED COMPLETE | AUDITED 2026-05-26: GA4 (K1) end-to-end ✅, Mode A sample-guard (K4: ≥7d AND ≥5 sessions/≥1 call) ✅, customer copy + forbidden-vocab (K5) ✅, Today tile + Changes Act-3 + operator diagnostic ✅, tenant-isolation + no-revenue-claim invariants ✅. CallRail (K2) + GBP-insights (K3) correctly absent w/ forward-compat slots. **No gaps.** |
| §10 Phase B Regenerate | 🟡 VERIFIED — infra shipped + safe, persist deferred | AUDITED 2026-05-26: `llm-draft-gateway` ENFORCES no-page-load, no-auto, budget gate (daily+monthly), validator+display-guard, 19-rule provider reuse, cost→adjudicator-budget, tenant-iso. Operator-only + env-gated-OFF (`BEACON_LLM_DRAFT_GATEWAY_ENABLED`) + **read-only/non-persisting by design** (no caller in prod). **Deferred to S6** (Phase B persist phase): brandAssertions ≥3 gate, 5-min per-rec cooldown, original-`proposed_text` preservation + revert UI, show-original-on-fail UI. Not bugs — unbuilt persist layer. |
| §11 Pricing | n/a | operator-side, no code |
| §12 Invariants/Safety/Budget | 🟡 VERIFIED — N1/N4 done, N2/N3 open | AUDITED 2026-05-26: N1 catalog + catalog-sync (232 test files ↔ catalog rows) ✅. N4 forbidden-vocab (8 dedicated tests: Mode A/B/C, causal/revenue, off-site labels) ✅. **N2 mostly-wired**: two ledgers isolated; `cost-controls` now pins BOTH the polling side AND the LLM `llm-budget`-store side (added 2026-05-26); STILL OPEN = `cap_kind` + unified `recordSpend({ledger})` router. **N3 evaluated → NOT RECOMMENDED as specified**: 995 exported fns in domains+connectors, only 31 tenant-bearing → a comprehensive scan needs ~960 allowlist entries (brittle, low-value). Isolation already guaranteed by repo `forTenant` + RLS + 13+ targeted invariants. See §5 S3. |
| §13 CMS Publishing | ⚫ PARKED | intentionally not built |

---

## 5. Remaining slices (verified 2026-05-26)

**DONE this session (committed locally):** ✅ 4-subsystem verification sweep (§3/§8/§9/§12) · ✅ `off-site-authority/types.ts` doc truth-up · ✅ caught + fixed a `dd4c52f` straggler (stale `process-global` mock fixture in `off-site-authority-page.test.tsx`) + a stale discipline-test comment. Repo-wide sweep for old `process-global`/`C7g` footer strings = **fully clean**.

**Remaining — genuine deliberate slices (do NOT rush; each needs its own preflight). In value order:**

**S1 — §3 per-tenant threshold wiring (Phase A.2 Step 3). ✅ DONE + VERIFIED GREEN (2026-05-26 correction).** Already shipped: `load-lifecycle.ts` resolves per-tenant thresholds via `computeTenantThresholds`, threads them into `deriveLifecycleStage`'s optional 2nd arg, folds `source` into the cache key; `render-copy.ts` emits per-source customer copy (borrowed tooltip vs per-tenant "Computed from {N} cited shipped edits on this site" + "for this site" suffix). Consumed by Today tile/strip + Changes `[id]`. Pinned by `threshold-decision-loader-wiring.test.ts`; 442 lifecycle/threshold/component tests green. `thresholds.ts` correctly stays the borrowed-constants source. **No further work — earlier "pending" was an audit error (traced only thresholds.ts, missed load-lifecycle/render-copy).**

**S2 — §12 N2 budget-ledger routing + isolation pin + `cap_kind`.** ✅ **isolation-pin half DONE 2026-05-26** (`cost-controls.test.ts` pins "only adjudicator-budget writes the `llm-budget` store"). **PREFLIGHTED (execute-ready, NOT implemented — deliberate, greenlight-gated):** the unified `recordSpend({ledger})` router would reconcile TWO same-named functions — `budget.ts:265 recordSpend(tenantId, amount, label)` (sync, cost-ledger, native polling) + `adjudicator-budget.ts:86 recordSpend(costUsd, {now})` (async, llm-budget) — across **4 call sites**: `perplexity/poll.ts:614` (→cost-ledger) + `llm-draft-gateway.ts:114`/`recommended-edits-persistence.ts:768`/`adjudicate.ts:354` (→llm-budget). Design: a `recordSpend({ledger:"native_polling"|"llm_adjudicator_and_regenerate", ...})` dispatcher wrapping both; migrate the 4 sites; keep `budget.test.ts`+`cost-controls.test.ts` green. **NOT rushed because:** (1) the safety-critical isolation is already pinned, so the router adds dispatch-tidiness not safety; (2) `cap_kind` has nothing to annotate until S6's per-tenant daily cap exists; (3) a dispatch bug mis-accounts spend (the failure `llm-budget-test-isolation` guards). Plan ref: §12.2 / N2.

**S3 — §12 N3 tenant-isolation. ✅ CLOSED 2026-05-26 via LEAK AUDIT (0 leaks found).** Beyond the sizing below, I audited the 39 highest-risk data-access functions (no-arg persisters/writers + queue/outcome/pattern loaders) by reading each body: **all 39 are properly tenant-scoped** (repository `forTenant` / explicit `tenantId` / internal `currentTenantId()` / `opts.tenantId` / global-store-by-design). **Zero genuine cross-tenant leaks.** No comprehensive test shipped — the 5 valid scoping mechanisms can't be captured by a single-signature assertion (brittle), and the audit + RLS + repository pattern + 13+ targeted invariants already guarantee isolation. The audit (in VERIFICATION_LOG) is the deliverable.
> _Original sizing (why the comprehensive scan is brittle):_ Empirical sizing: **995 exported functions** in `src/domains`+`src/lib/connectors`; only **31 are tenant-bearing**. The other ~960 are pure helpers (`missingTitleCopy`, `dedupeKey`, `priorityScore`, `confidenceMultiplier`, copy/format/parse/normalize…) that correctly take no tenant. The plan assumed a "small whitelist (<20)"; reality is the inverse → N3-as-specified needs ~960 allowlist entries or `@no-tenant-required` markers = a brittle, oversized, low-value test. Real isolation risk is in data-access fns, already guaranteed by `getRepository().forTenant(tenantId)` + RLS deny-all + 13+ targeted invariants. **Recommendation: do NOT build the comprehensive scan; if ever needed, scope to data-access name-patterns only — but existing coverage already suffices.** Plan ref: §12.3 / N3.

**S4 — §3 brain producer + "Beacon learned" tile + privacy scrubber.** ✅ **PRIVACY SCRUBBER DONE 2026-05-26** (`cross-tenant-brain/privacy.ts`: `scrubPatternDescription`/`containsBlocklistedTerm`/`normalizeBlocklist`, E4-locked, pure, 23 tests green). **PRODUCER + tile + diagnostics surface still gated:** the real `getCrossTenantPatterns` needs an intentional all-tenants read (repo is `forTenant`-scoped → no clean cross-tenant read API exists; building one is the sensitive part) + is the highest-privacy-risk component + returns `[]` at n=1 + gated behind `BEACON_CROSS_TENANT_BRAIN`(off). Careful dedicated slice; scrubber dep now ready+proven. Plan ref: §3.2/§3.4/§3.6.

**S5 — MT-5: remove deprecated no-arg `getBusinessConfig()` overload. APPROVAL-GATED.** Runtime clean (0 callers/fallbacks) but needs ~23-call test migration in `business-config.test.ts` + 3 files + 5 invariant existence-pin flips + global-ban conversion of `business-config-deep-runtime-tenant-aware`. Dedicated slice — do NOT start without operator go.

**S6 — §10 Phase B regenerate completion (persist + gates + UI).** The LLM-draft gateway infra is shipped + safe (operator-only, env-gated-OFF, budget/validator/provider-reuse/tenant-iso enforced) but does NOT persist. To complete Phase B per Section 10 L1–L5 + the 11 invariants: (a) brandAssertions ≥3 gate in the regenerate action; (b) 5-min per-rec cooldown; (c) persist regenerated draft to `recommended_edits.metadata.regenerated_draft` while NEVER overwriting original `proposed_text` (+ revert UI); (d) show-original-on-validation-fail UI. **Touches a live LLM-cost path — deliberate slice, operator-aware. Local-feasible for (a)/(b)/(c-persistence-shape) but NO LLM execution in current no-LLM mode.** Plan ref: §10 + Decision Lock L1–L5.

**Do NOT attempt (constraint-blocked):** anything needing push/migration/connector/external/LLM call — new connector live-paths, new migrations, LLM regenerate runs. Build/verify code only; never execute paid/remote.

---

## 6. Architecture facts to respect (will break tests if violated)

- **Multi-tenant business-config:** `getBusinessConfig(tenantId)` (sync, tenant-keyed `Map` cache) · `getBusinessConfigForCurrentTenant()` (async = `getBusinessConfig(await currentTenantId())`) · DEPRECATED no-arg `getBusinessConfig()` (kept until MT-5). `currentTenantId()` = header `x-beacon-tenant` → env `BEACON_TENANT_ID` (throws if neither). `saveBusinessConfig(tenantId, patch)`.
- **All 5 pure helpers REQUIRE injected config** (0 fallbacks): `getLocationRegex`, `getServiceRegex`, `getSectionAnalyzerConfig`, `getFaqTemplates`, `isDirectoryDomain`.
- **`off-site-authority/compute-snapshot.ts` is a PURE module** — must NOT reference identifiers `getBusinessConfig`/`isPlaceholderConfig`/`readLocalReviews`/`getConnectorToken*`/`getRepository` **even inside string copy** (pinned by `off-site-authority-pure-module-purity`). Off-site rows are permanently `diagnostic_only` (never queue-promoted). The 7 off-site action types are **detection-only** (Section 7 I-block lock) — no generators.
- **Architecture invariants** = comment-stripped source scans + behavioral assertions. Catalog-sync requires every `tests/architecture/*.test.ts` to have a row in `docs/ARCHITECTURE_INVARIANTS_CATALOG.md`.
- **Forbidden customer-facing vocab:** missing · we checked · automatically · improve rankings · drove · caused · generated · revenue · dollars · `$` (except `/settings/pricing`) · guaranteed · Mode A/B/C · process-global · raw internal tokens (aiSearchSignal, rec_id, evidence_tier, snake_case/camelCase IDs). Use the `extractCustomerVisibleText` helper for scans.
- **Async server components rendered via `renderToStaticMarkup`** must be wrapped in `<Suspense fallback={null}>`.
- **Scope discipline (Sections 6 + 9):** no global→change attribution; customer copy uses "received" not "drove/caused"; absolute counts not percentages where locked. Mode A/B/silent rules.
- **Budget ledgers isolated:** native polling = `.data/cost-ledger.json`; LLM (adjudicator + regenerate) = `.data/llm-budget.json`. Never cross-charge.
- **vitest:** `fileParallelism: false`; `test.env` sets `BEACON_TENANT_ID=tenant-ritz-founder`, `BEACON_TENANT_SLUG=ritz-builders`.

---

## 7. Per-slice cadence (follow every time)

PREFLIGHT (read the REAL code first — never assume) → IMPLEMENT only if bounded + safe → `typecheck` → targeted tests → full suite (if call-graph/signature changed) → tenant-env `build` (if routes/pages changed) → **LOCAL COMMIT ONLY** (never push) → docs sync → report. If a task is more entangled than expected: **STOP, write it to §9 notepad, move to the next item** — keep going, don't block on one thing.

---

## 8. Product north star (don't drift from this)

Single-user internal premium app. Core UX = progress chart + 3 actions, plain English, speak money/customers not SEO jargon. Lifecycle loop: **cited? (A.1) → retrievable/indexed? (A.3/GSC) → did it stick? (§5 repeat) → became primary rec? (§6) → drove visits/calls? (§9)**. Beacon's wedge = a *learning* AEO instrument for local-service marketers ($249 today / $499 after A.1+A.2+A.3+§6 ship / $999 Pro+ later). No auth/billing/teams unless asked.

---

## 9. NOTEPAD — blockers & what's needed from operator (append as you go)

**Need from operator (Armeen):**
- [ ] Disable `daily-native-poll` + `poll-canary` in GitHub Actions UI (stop burn).
- [ ] At Actions-reset: approve push → land 9-commit stack → merge → verify Vercel by SHA → hosted smoke → dogfood (runbook in NEXT_PHASE top entry).
- [ ] Approve MT-5 as a dedicated slice if/when you want the deprecated overload gone.

**Findings (2026-05-26 audit sweep, 4 subsystems):**
- §8 GSC + §9 Outcome-Attribution: **VERIFIED COMPLETE**, no gaps, fully tested.
- §3 Brain: env gates + LLM-packet wiring + per-tenant threshold compute built; **per-tenant threshold replacement FULLY WIRED + green (S1 DONE)** in `load-lifecycle.ts`+`render-copy.ts` (corrected — the wiring is there, not in `thresholds.ts`; my initial trace was incomplete); **cross-tenant producer intentionally stubbed** (n=1 → S4); tile/scrubber multi-tenant work (→ S4).
- §12: N1 catalog-sync ✅ + N4 forbidden-vocab ✅; **N2 LLM-ledger isolation pin added** (cap_kind/router still open → S2); **N3 evaluated → not-recommended-as-specified** (995 exports / 31 tenant-bearing; isolation already strong → S3 reclassified).
- **Bug caught + fixed:** `dd4c52f` footer-copy-refresh left a stale `process-global` mock fixture in `off-site-authority-page.test.tsx` (test stayed green via self-consistent mock, but asserted impossible copy) + a stale discipline-test comment. Both truth-upped; repo-wide sweep now clean.
- §4.5 Recommendation Intelligence: **VERIFIED COMPLETE** — 9 safety props enforced, customer-queue flip live behind operator guard, 15 generatorActive, 20 arch tests, no loopholes.
- §10 Phase B Regenerate: gateway infra **verified safe** (operator-only, env-gated-OFF, budget/validator/provider-reuse/tenant-iso); persist + brandAssertions-gate + cooldown + original-preservation deferred-by-design → slice S6 (not bugs).
- §12 N2: ✅ LLM-ledger write-isolation pin added (`cost-controls.test.ts`); `cap_kind` + router still open.
- **Audit coverage: §2/§4/§5/§6/§7 confirmed-built (listings/manifest/git-log); §3/§8/§9/§10/§12/§4.5 deep-verified by agents. All green at 13671 tests.**
- **Verdict: product is feature-complete + green for n=1 dogfood.** Remaining items (S1–S6) are deliberate slices or operator/constraint-gated — none block a one-tenant dogfood MVP. The real gate to "done" is the operator-gated push/deploy.
