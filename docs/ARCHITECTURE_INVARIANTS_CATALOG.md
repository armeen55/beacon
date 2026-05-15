# Architecture invariants catalog

> **Purpose.** Canonical map from every test file under
> `tests/architecture/*.test.ts` to the architecture invariant it
> pins, the plan section that introduced it, its purpose in one
> sentence, and (when known) the retirement condition that closes
> its lifetime. Built per Section 12.1 / Decision Lock N1 of
> `~/.claude/plans/enter-maximum-depth-planning-mode-twinkly-balloon.md`.
>
> **Contract.**
> 1. Every architecture test file MUST be referenced exactly once in
>    the table below.
> 2. Every entry below MUST resolve to an existing test file.
> 3. Mismatches trip `tests/architecture/catalog-sync.test.ts`.
> 4. The sync test enforces structural coverage (file existence +
>    uniqueness) only. It does NOT check the prose in the *purpose*
>    or *retirement-condition* columns — those stay human-reviewed.
>
> **How to add a new entry.**
> When a new `tests/architecture/<name>.test.ts` lands, append a row
> to the matching section (or create a new section heading if the
> plan introduced one). Use today's date as `last-verified`. When you
> retire a test, set `status: retired` rather than deleting the row —
> the historical trail is the audit value.
>
> **How to retire an invariant.**
> When the conditions in `retirement-condition` are met, the operator
> approves a focused PR that either (a) deletes the test file and the
> catalog row in one commit, or (b) edits the test file to a new
> invariant and updates the row's `status` / `retirement-condition`
> / `last-verified` accordingly. The sync test catches half-finished
> retirements (e.g., test file deleted but catalog row left).
>
> **Status values.**
> - `active` — the invariant currently fails the build if violated.
> - `retired` — the test file is gone; the row is kept for history.
>   No `retired` rows in the seed; the field exists so future
>   retirement edits have a clean target.
>
> **Date semantics.**
> `last-verified` = the most recent date this entry was reviewed end-
> to-end by a human (test file read, contract still applicable). Not
> the date the test was first written; not the date of the last test
> run. Update only on intentional review, never automatically.

---

## Phase A.1 — Section 2 (Time-to-Citation Read Model)

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| thresholds-provenance | `tests/architecture/thresholds-provenance.test.ts` | Section 2.8 / D8 / A.2 Step 3c (2026-05-14) | Pins the BORROWED Profound 6/18/37 defaults in `src/domains/citation-lifecycle/thresholds.ts` as the fallback consulted when `computeTenantThresholds` returns `profound_default`. Per-tenant decisions override at runtime via the loader's `thresholdDecision`; the constants themselves remain the locked Profound shim. | active | Evolves when Phase A.2 (Section 3) further refines the decision tree or when a future phase deprecates the Profound shim entirely. | 2026-05-14 |
| citation-lifecycle-stuck-bridge-phrase | `tests/architecture/citation-lifecycle-stuck-bridge-phrase.test.ts` | Section 2.16 / Section 4.8 / Phase A.3 §4 (2026-05-14) | Pins the stuck-stage render contract AFTER the A.3.4 customer-visible flip: (1) the literal "next bundle will add automated sitemap + robots checks" bridge phrase remains in `render-copy.ts` as the FALLBACK path (for `target_url === null`, `needs_new_page` sentinel, and indexability-loader-throw cases); (2) attached to `STUCK_BRIDGE_PHRASE` constant; (3) source comment documents the A.3.4 fallback role; (4) `LifecycleCopy` declares `diagnostic: string | null` AND `renderLifecycleCopy` calls `renderStuckDiagnostic` to populate it; (5) Changes detail v2 client renders the diagnostic sub-line PREFERRED OVER the bridge sub-line (mutually exclusive at the visible-sub-line level — `data-change-detail-act3-lifecycle-diagnostic="true"` precedes `data-change-detail-act3-lifecycle-bridge="true"` in the LifecycleLine ternary). | active | Retire fully when production telemetry confirms zero stuck rows hit the bridge fallback path for ≥ 30 sustained days, OR when a future step removes the `needs_new_page` sentinel + the loader-throw fallback path entirely (at which point `STUCK_BRIDGE_PHRASE` + `bridgeLine` can be deleted alongside this invariant). | 2026-05-14 |
| citation-lifecycle-tenant-isolation | `tests/architecture/citation-lifecycle-tenant-isolation.test.ts` | Section 2.18 (+ Path A cold-store branch, 2026-05-14) | Pins tenant-scoped repo gate in `src/domains/citation-lifecycle/`, the cold-store allowlist, and the regime-gate cross-reference. | active | Expand `ALLOWED_CROSS_TENANT_FILES` when Section 3 brain producer lands; update `ALLOWED_COLD_STORE_FILES` if Section 4 GSC adds another consumer. | 2026-05-14 |

## Cross-cutting — Tenant isolation

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| canonical-store-tenant-isolation | `tests/architecture/canonical-store-tenant-isolation.test.ts` | Pre-plan (customer-2 onboarding audit, 2026-05-06) | `loadFreshCanonicalData()` must use tenant-scoped `getTrackedPrompts()` / `getTrackedEntities()` not the unscoped base methods. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |
| factory-functions-require-tenant | `tests/architecture/factory-functions-require-tenant.test.ts` | Pre-plan (Stage D2) | Every Stage D2 factory function (or its CLI wrapper) accepts a `tenant_id` argument. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |
| no-tenant-id-empty-string-literals | `tests/architecture/no-tenant-id-empty-string-literals.test.ts` | Pre-plan | Forbid `tenant_id: ""` empty-string literals in `src/`. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |
| no-unscoped-tier-a-reads | `tests/architecture/no-unscoped-tier-a-reads.test.ts` | Sprint 7 Phase 7.5b Commit 5 / 7.5d/3 | Tier-A tenant-scoped tables can only be read through `.forTenant()`; extended to scripts/** and adapters/poll. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |
| profound-runtime-isolation | `tests/architecture/profound-runtime-isolation.test.ts` | Pre-plan (2026-05-10) | The Profound import pipeline cannot reach native polling state at runtime. | active | Permanent — keeps two regimes isolated at runtime. | 2026-05-14 |
| script-cli-tenant-required | `tests/architecture/script-cli-tenant-required.test.ts` | Pre-plan | Every CLI script writing tenant-scoped data requires an explicit tenant argument. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |
| sync-wrappers-stamp-tenant-id | `tests/architecture/sync-wrappers-stamp-tenant-id.test.ts` | Pre-plan | Every Supabase `sync*` writer stamps `tenant_id` before the upsert. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |
| list-active-tenants-contract | `tests/architecture/list-active-tenants-contract.test.ts` | Gap A (2026-05-07) | Pins the fail-loud `ops/active-tenants.json` lister used by the daily-poll matrix. | active | Permanent — cron-scaffold safety. | 2026-05-14 |
| reset-test-tenant-contract | `tests/architecture/reset-test-tenant-contract.test.ts` | Gap F.1 QA reset-test-tenant safety | Pins the test-tenant reset script's safety gates. | active | Permanent — test-tenant data hygiene. | 2026-05-14 |
| multi-tenant-cron-scaffold | `tests/architecture/multi-tenant-cron-scaffold.test.ts` | Pre-plan (2026-05-06) | Pins the matrix-from-JSON daily-poll cron scaffold (no hardcoded tenant IDs). | active | Permanent — cron-scaffold safety. | 2026-05-14 |

## Cross-cutting — LLM safety + cost controls

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| cost-controls | `tests/architecture/cost-controls.test.ts` | Sprint 6A.3e (2026-04-26) | Pins the native-polling budget gate, kill switch, and cost-ledger write isolation. | active | Section 12.2 (budget-ledger routing helper) refines but does NOT delete this invariant. | 2026-05-14 |
| llm-budget-test-isolation | `tests/architecture/llm-budget-test-isolation.test.ts` | Pre-plan | Tests writing to global persistence stores cannot leak into the LLM budget ledger. | active | Permanent — test infra safety. | 2026-05-14 |
| llm-dryrun-harness-no-persistence | `tests/architecture/llm-dryrun-harness-no-persistence.test.ts` | Pre-plan | The LLM specific-edit dry-run harness MUST NOT persist outputs. | active | Permanent — dry-run safety. | 2026-05-14 |
| llm-live-regen-allowlist | `tests/architecture/llm-live-regen-allowlist.test.ts` | Pre-plan | LLM live-regeneration harness call sites are allowlisted. | active | Refines with Section 10 (Phase B Regenerate) but does not delete. | 2026-05-14 |
| llm-safety-invariants | `tests/architecture/llm-safety-invariants.test.ts` | Sprint 6A.2d (2026-04-26) | LLM safety architectural invariants (no paid calls on page load, budget gates, etc.). | active | Permanent — LLM safety floor. | 2026-05-14 |
| abstention-contract-trust | `tests/architecture/abstention-contract-trust.test.ts` | Trust Sprint Mini-Phase T4.1 (2026-05-06) | Pins the abstention-contract validator wiring + the 4 reject reasons at the source-text level. | active | Permanent — LLM safety floor. | 2026-05-14 |
| openai-system-prompt-dryrun2 | `tests/architecture/openai-system-prompt-dryrun2.test.ts` | LLM-DryRun-2 (2026-05-05) | Pins SYSTEM_PROMPT rules added after DryRun-1 found UUID leaks + fabricated numbers + failure-to-abstain. | active | Refines when Phase B Regenerate / Section 10 ships; do not delete without an explicit replacement contract. | 2026-05-14 |
| openai-system-prompt-dryrun3 | `tests/architecture/openai-system-prompt-dryrun3.test.ts` | LLM-DryRun-3 (2026-05-05) | Pins strict-abstention SYSTEM_PROMPT invariants (Rule 16.A triggers). | active | Same as dryrun2. | 2026-05-14 |
| openai-system-prompt-dryrun3.5 | `tests/architecture/openai-system-prompt-dryrun3.5.test.ts` | LLM-DryRun-3.5 (2026-05-05) | Refines Rule 16.A trigger 1 scope. | active | Same as dryrun2. | 2026-05-14 |
| packet-carries-resolver-confidence | `tests/architecture/packet-carries-resolver-confidence.test.ts` | LLM-DryRun-3 (2026-05-05) | The recommendation evidence packet surfaces the resolver's confidence to the LLM (used by Rule 16.A trigger 2). | active | Permanent — packet contract. | 2026-05-14 |
| specific-edit-target-constraint | `tests/architecture/specific-edit-target-constraint.test.ts` | Sprint 6A.2g.A (2026-04-26) | Pins the strict target-URL alignment for `buildSpecificEditEvidencePacket`. | active | Permanent — LLM packet safety. | 2026-05-14 |
| recommendations-step-3.7-brand-grounding | `tests/architecture/recommendations-step-3.7-brand-grounding.test.ts` | W3 Step 3.7 (2026-05-03) | Brand-claim grounding architecture invariants. | active | Permanent — LLM packet safety. | 2026-05-14 |

## Cross-cutting — Cron + poll integrity

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| cron-cli-architecture | `tests/architecture/cron-cli-architecture.test.ts` | Bundle 2 (2026-05-07) | Pins the GitHub-runner CLI cron architecture (not 4-chunk curl-to-Vercel). | active | Refines if cron infra changes; do not delete without operator approval. | 2026-05-14 |
| cron-redundant-schedules | `tests/architecture/cron-redundant-schedules.test.ts` | Bundle (2026-05-10) | Pins the multiple-times-per-UTC-day workflow schedule shape for reliability. | active | Permanent — cron reliability ratchet. | 2026-05-14 |
| cron-utc-day-guard-contract | `tests/architecture/cron-utc-day-guard-contract.test.ts` | Bundle (2026-05-08 incident fix) | Pins the UTC-day-anchored budget guard in `defaultHasRecentRun`. | active | Permanent — cron-skip-bug regression guard. | 2026-05-14 |
| poll-health-copy | `tests/architecture/poll-health-copy.test.ts` | Pre-plan | The poll-health-block subline copy contract. | active | Permanent — customer-vocabulary contract. | 2026-05-14 |
| poll-health-direct-cli-classifier-contract | `tests/architecture/poll-health-direct-cli-classifier-contract.test.ts` | Bundle (2026-05-08 2nd patch) | Pins the poll-health partitioner regex for the direct-CLI scope shape. | active | Permanent — poll-health regression guard. | 2026-05-14 |
| poll-integrity-contract | `tests/architecture/poll-integrity-contract.test.ts` | Post May 2-4 incident | Poll integrity hardening invariants. | active | Permanent — poll-pipeline safety. | 2026-05-14 |
| scheduled-scan-cron | `tests/architecture/scheduled-scan-cron.test.ts` | Pre-plan | Architecture invariants for the scheduled-scan + cron infrastructure. | active | Permanent — cron infra safety. | 2026-05-14 |
| sampling-guard-observability-log | `tests/architecture/sampling-guard-observability-log.test.ts` | D4 (operator audit, 2026-05-05) | Sampling-status guard observability log shape invariant. | active | Permanent — observability safety. | 2026-05-14 |

## Cross-cutting — Persistence routing

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| dual-write-loud-fail | `tests/architecture/dual-write-loud-fail.test.ts` | Pre-plan | Dual-write must throw on persistent Supabase failure (not silent fall-back to file). | active | Permanent — persistence safety. | 2026-05-14 |
| dual-write-onconflict | `tests/architecture/dual-write-onconflict.test.ts` | Pre-plan | Dual-write onConflict targets must match the unique constraint of the underlying table. | active | Permanent — persistence safety. | 2026-05-14 |
| json-store-routing-invariants | `tests/architecture/json-store-routing-invariants.test.ts` | Sprint 7 Phase 7.8b-2-e (2026-04-26) | Pins the JSON-store routing dispatch for `readStore`/`writeStore`. | active | Permanent — persistence safety. | 2026-05-14 |
| last-scan-result-routing | `tests/architecture/last-scan-result-routing.test.ts` | Phase 5 hosted-cron fix (2026-04-28) | Pins `last_scan_result` writes route through the canonical persistence layer (not direct file). | active | Permanent — persistence safety. | 2026-05-14 |
| no-page-store-allpages | `tests/architecture/no-page-store-allpages.test.ts` | Sprint 7 Phase 7.5c/3 (2026-04-25) | Forbid unscoped `allPages` reads of the page store. | active | Permanent — multi-tenant safety floor. | 2026-05-14 |

## Cross-cutting — Egress + perf

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| egress-bounded-reads-p0 | `tests/architecture/egress-bounded-reads-p0.test.ts` | EGRESS-P0 (2026-05-07) | Pins the bounded-read contracts that drop steady-state Supabase egress. | active | Permanent — egress safety. | 2026-05-14 |
| supabase-egress-windowing | `tests/architecture/supabase-egress-windowing.test.ts` | E1-E5 (operator audit, 2026-05-05) | Pins the windowed read contract for `loadFreshCanonicalData`-shaped paths. | active | Permanent — egress safety. | 2026-05-14 |
| deploy-settings-prompts-dynamic | `tests/architecture/deploy-settings-prompts-dynamic.test.ts` | Deploy hardening (2026-05-12) | Source-level pin for `/settings/prompts` dynamic rendering (prevents prerender timeout). | active | Permanent — deploy safety. | 2026-05-14 |
| perf-load-queue-trace | `tests/architecture/perf-load-queue-trace.test.ts` | Emergency P0 (2026-05-12) | Pins granular trace labels inside `loadLiveRecommendationQueue`. | active | Permanent — perf-trace coverage. | 2026-05-14 |
| perf-projected-page-reads | `tests/architecture/perf-projected-page-reads.test.ts` | Perf+egress bundle 2 (2026-05-12) | Pins the additive `getPageSummaries` column projection. | active | Permanent — egress safety. | 2026-05-14 |
| perf-prompts-scoped-reads | `tests/architecture/perf-prompts-scoped-reads.test.ts` | Emergency P0 (2026-05-12) | Source-level pin for `/prompts` + `/prompts/[id]` scoped repo reads. | active | Permanent — egress safety. | 2026-05-14 |
| perf-recs-detail-fast-not-found | `tests/architecture/perf-recs-detail-fast-not-found.test.ts` | Emergency P0 v2 (2026-05-12) | Source-level pin for the `/recommendations/[id]` fast path. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-recs-persisted-fast-loader | `tests/architecture/perf-recs-persisted-fast-loader.test.ts` | Emergency P0 v5 (2026-05-12) | Source-level pin for the persisted-row fast loader on `/recommendations`. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-recs-queue-cached | `tests/architecture/perf-recs-queue-cached.test.ts` | Emergency P0 v4 (2026-05-12) | Source-level pin for the cached `loadLiveRecommendationQueueForPage` wrapper + tag invalidation. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-shell-layout-parallel-awaits | `tests/architecture/perf-shell-layout-parallel-awaits.test.ts` | Perf bundle 6 (2026-05-12) | Pins shell layout parallelization (no sequential awaits). | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-shell-nav-prefetch-disabled | `tests/architecture/perf-shell-nav-prefetch-disabled.test.ts` | Emergency P0 v3 (2026-05-12) | Source-level pin for `prefetch={false}` on every shell-nav Link. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-streaming-bundle | `tests/architecture/perf-streaming-bundle.test.ts` | Streaming bundle (2026-05-12) | Source-level pins for the perceived-speed refactor of `/today` and `/recommendations`. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-today-discrepancy-gated | `tests/architecture/perf-today-discrepancy-gated.test.ts` | Perf bundle 5 (2026-05-12) | Source-level pin for the discrepancy-detection gate on `/today`. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-today-rollup-wired | `tests/architecture/perf-today-rollup-wired.test.ts` | Perf bundle 3 (2026-05-12) | Pins the today rollup fan-out wiring. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-today-section-streaming | `tests/architecture/perf-today-section-streaming.test.ts` | Today section-streaming bundle (2026-05-12) | Source-level pin for the per-section streaming refactor of `/page.tsx`. | active | Permanent — perf regression guard. | 2026-05-14 |
| perf-trace-wired | `tests/architecture/perf-trace-wired.test.ts` | Perf bundle 7 (2026-05-12) | Source-level pin for the production perf trace wiring (gated by `BEACON_PERF_TRACE`). | active | Permanent — observability coverage. | 2026-05-14 |
| perf-windowed-seed-and-cache | `tests/architecture/perf-windowed-seed-and-cache.test.ts` | Perf+egress bundle (2026-05-12) | Source-level pins for the windowed seed + cache fixes across v2 routes. | active | Permanent — egress + perf regression guard. | 2026-05-14 |

## Cross-cutting — Customer vocabulary + safety

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| forbidden-customer-vocabulary-contract | `tests/architecture/forbidden-customer-vocabulary-contract.test.ts` | Bundle 3 (2026-05-10, maximum-depth UI audit) | Strips operator/internal vocabulary from customer-facing routes. | active | Expands with Section 12.4 forbidden-vocab additions (Mode A/B leakage + revenue/causal); does not delete. | 2026-05-14 |
| no-operator-jargon | `tests/architecture/no-operator-jargon.test.ts` | Step 1.2 (master plan) | Guards against operator-facing jargon sneaking back into `src/app` and `src/components`. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| no-placeholder-in-active-recs | `tests/architecture/no-placeholder-in-active-recs.test.ts` | Pre-plan | No placeholder phrase can reach an active recommendation surface. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| no-placeholder-recommended-edits | `tests/architecture/no-placeholder-recommended-edits.test.ts` | W3 Step 3.1 (2026-05-01) | Placeholder + structural-quality regression guard for `recommended_edits`. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| no-uuid-in-active-recs | `tests/architecture/no-uuid-in-active-recs.test.ts` | Pre-plan | No raw prompt UUID may reach an operator-visible / customer-visible surface in active recs. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| score-provenance-trust-labels | `tests/architecture/score-provenance-trust-labels.test.ts` | Trust Sprint Mini-Phase T3.1 (2026-05-06) | Pins the customer-facing score-provenance trust label set. | active | Permanent — trust label contract. | 2026-05-14 |
| verdict-provenance-trust-labels | `tests/architecture/verdict-provenance-trust-labels.test.ts` | Trust Sprint Mini-Phase T3.2 (2026-05-06) | Pins the customer-facing verdict-provenance trust label set. | active | Permanent — trust label contract. | 2026-05-14 |
| ux4-customer-safe-labels-contract | `tests/architecture/ux4-customer-safe-labels-contract.test.ts` | UX.4 (2026-05-07) | Customer-safe labels contract. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| ux5b-premium-hierarchy-contract | `tests/architecture/ux5b-premium-hierarchy-contract.test.ts` | UX.5B (2026-05-07) | Premium hierarchy contract for /today. | active | Permanent — UX contract. | 2026-05-14 |
| ux6-1-trust-restoration-contract | `tests/architecture/ux6-1-trust-restoration-contract.test.ts` | UX.6.1 (2026-05-07) | Trust restoration on /today (3 fixes). | active | Permanent — UX contract. | 2026-05-14 |
| ux6-2-vocabulary-hierarchy-contract | `tests/architecture/ux6-2-vocabulary-hierarchy-contract.test.ts` | UX.6.2 (2026-05-07) | Vocabulary + hierarchy cleanup on /today (5 fixes). | active | Permanent — UX contract. | 2026-05-14 |
| ux6-3-ai-visibility-hero-contract | `tests/architecture/ux6-3-ai-visibility-hero-contract.test.ts` | UX.6.3 (2026-05-08) | AI Visibility hero promotion on /today. | active | Permanent — UX contract. | 2026-05-14 |

## Cross-cutting — v2 customer routes + surfaces

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| changes-stale-pending-affordance | `tests/architecture/changes-stale-pending-affordance.test.ts` | D5 (operator audit, 2026-05-05) | `/changes` stale-pending tooltip + button affordance. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| competitor-page-blueprints-contract | `tests/architecture/competitor-page-blueprints-contract.test.ts` | T-CompPageBlueprints (2026-05-08) | `competitorPageBlueprints` populated-fields contract. | active | Permanent — packet contract. | 2026-05-14 |
| customer-nav-exposure | `tests/architecture/customer-nav-exposure.test.ts` | T-CustomerNav (2026-05-08) | Customer nav exposure contract: sidebar + command palette + settings tabs expose only the customer-safe set. | active | Permanent — customer-nav floor. | 2026-05-14 |
| customer-readiness-round-1 | `tests/architecture/customer-readiness-round-1.test.ts` | Round 1 (2026-05-05) | 6 customer-readiness paper-cut fixes. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| customer-readiness-round-2 | `tests/architecture/customer-readiness-round-2.test.ts` | Round 2 (2026-05-06) | Round 2 customer-readiness paper-cuts. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| demo-path-fixes-2026-05-06 | `tests/architecture/demo-path-fixes-2026-05-06.test.ts` | War-room bundle (2026-05-06) | 5 customer-facing copy/UX fixes. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| demo-path-fixes-2026-05-06-bis | `tests/architecture/demo-path-fixes-2026-05-06-bis.test.ts` | War-room bundle 2-bis (2026-05-06) | 8 customer-facing copy/UX fixes. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| exec-confidence-default-surfaces | `tests/architecture/exec-confidence-default-surfaces.test.ts` | Trust Sprint T6.4 (2026-05-06) | Executive confidence default surfaces contract. | active | Permanent — trust contract. | 2026-05-14 |
| mark-shipped-accepted-only | `tests/architecture/mark-shipped-accepted-only.test.ts` | M4 (operator audit, 2026-05-05) | Mark Shipped button restricted to `accepted` rows only. | active | Permanent — lifecycle correctness. | 2026-05-14 |
| recommendations-executive-strip-contract | `tests/architecture/recommendations-executive-strip-contract.test.ts` | UX.3 | ExecutiveStrip + needs_review reframe contract. | active | Permanent — UX contract. | 2026-05-14 |
| recommendations-step-3.15-faq-grouping | `tests/architecture/recommendations-step-3.15-faq-grouping.test.ts` | W3 Step 3.15 (2026-05-04) | FAQ Q+A grouping + title polish source-scan invariants. | active | Permanent — recommendations surface contract. | 2026-05-14 |
| recommendations-step-3.5e-action-table | `tests/architecture/recommendations-step-3.5e-action-table.test.ts` | W3 Step 3.5e (2026-05-03) | Recommendations action-table invariants. | active | Permanent — recommendations surface contract. | 2026-05-14 |
| recommendations-step-3.5f-row-polish | `tests/architecture/recommendations-step-3.5f-row-polish.test.ts` | W3 Step 3.5f (2026-05-03) | Ranked-action-table row polish invariants. | active | Permanent — recommendations surface contract. | 2026-05-14 |
| recommendations-step-3.5g-polish | `tests/architecture/recommendations-step-3.5g-polish.test.ts` | W3 Step 3.5g (2026-05-03) | Ranked-action-table polish invariants. | active | Permanent — recommendations surface contract. | 2026-05-14 |
| recommendations-ui-cleanup | `tests/architecture/recommendations-ui-cleanup.test.ts` | Post-Step 3.5e (2026-05-03) | Source-scan contracts that survive across UI redesigns. | active | Permanent — recommendations surface contract. | 2026-05-14 |
| recs-resolver-debug-panel | `tests/architecture/recs-resolver-debug-panel.test.ts` | P0 (2026-05-13) | Inline debug panel at `/recommendations?debugResolver=1` is render-only. | active | Permanent — debug-panel safety. | 2026-05-14 |
| settings-import-customer-safe-default | `tests/architecture/settings-import-customer-safe-default.test.ts` | D2 (operator audit, 2026-05-05) | `/settings/import` default surface is customer-safe. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| suggested-copy-architecture | `tests/architecture/suggested-copy-architecture.test.ts` | Recommendation Execution Layer v1 Phase A (2026-05-13) | Architecture invariants for the Suggested Copy act (no paid call on load, display-safety guard, etc.). | active | Refines when Phase B Regenerate / Section 10 ships. | 2026-05-14 |
| today-action-card-copy | `tests/architecture/today-action-card-copy.test.ts` | T2 + T3 (operator audit, 2026-05-05) | `/today` action-card + win-card copy hygiene. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| today-command-center-contract | `tests/architecture/today-command-center-contract.test.ts` | UX.2 Command Center (2026-05-07) | Command Center contract on /today. | active | Permanent — UX contract. | 2026-05-14 |
| today-empty-state-copy | `tests/architecture/today-empty-state-copy.test.ts` | D3 (operator audit, 2026-05-05) | KPI empty-state guidance copy. | active | Permanent — customer-vocabulary floor. | 2026-05-14 |
| today-first-reading-short-circuit | `tests/architecture/today-first-reading-short-circuit.test.ts` | Today perf cleanup (2026-05-12) | `resolveFirstReadingState` short-circuit + silent fail-soft. | active | Permanent — first-reading correctness. | 2026-05-14 |
| today-headline-sampling | `tests/architecture/today-headline-sampling.test.ts` | Pre-plan | `/today` headline KPI tile honors `samplingStatus`. | active | Permanent — sampling correctness. | 2026-05-14 |
| today-v2-chart-hierarchy | `tests/architecture/today-v2-chart-hierarchy.test.ts` | Today v2 (2026-05-12, two passes) | Visibility chart hierarchy + rank copy + legacy-cleanup guardrails. | active | Permanent — UX contract. | 2026-05-14 |
| v2-qa-polish-bundle | `tests/architecture/v2-qa-polish-bundle.test.ts` | v2 QA polish bundle (2026-05-11) | Source-level pins for fixes without a natural render-test home. | active | Permanent — v2 regression guard. | 2026-05-14 |
| v2-recommendations-no-customer-legacy-hops | `tests/architecture/v2-recommendations-no-customer-legacy-hops.test.ts` | UX follow-up (2026-05-13) | `/recommendations` v2 surface must NOT push customers into legacy. | active | Retire only when legacy routes are removed entirely. | 2026-05-14 |

## Cross-cutting — Onboarding

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| onboard-business-step-contract | `tests/architecture/onboard-business-step-contract.test.ts` | Gap C.1 (2026-05-07) | Business step contract. | active | Permanent — onboarding surface contract. | 2026-05-14 |
| onboard-competitors-step-contract | `tests/architecture/onboard-competitors-step-contract.test.ts` | Gap C.3 (2026-05-07) | Competitors step contract. | active | Permanent — onboarding surface contract. | 2026-05-14 |
| onboard-first-reading-contract | `tests/architecture/onboard-first-reading-contract.test.ts` | Gap F.1 (2026-05-07) | First-reading step contract. | active | Permanent — onboarding surface contract. | 2026-05-14 |
| onboard-launch-step-contract | `tests/architecture/onboard-launch-step-contract.test.ts` | Gap C.4 (2026-05-07) | Launch step contract. | active | Permanent — onboarding surface contract. | 2026-05-14 |
| onboard-prompt-generator-contract | `tests/architecture/onboard-prompt-generator-contract.test.ts` | Gap E.1 (2026-05-07) | Prompt generator contract (services × cities × intent templates). | active | Permanent — onboarding surface contract. | 2026-05-14 |
| onboard-scope-step-contract | `tests/architecture/onboard-scope-step-contract.test.ts` | Gap C.2 (2026-05-07) | Scope step contract. | active | Permanent — onboarding surface contract. | 2026-05-14 |
| signup-onboarding-routes-contract | `tests/architecture/signup-onboarding-routes-contract.test.ts` | Gap B (2026-05-07) | Public signup route + auth-callback → onboarding routing. | active | Permanent — auth flow safety. | 2026-05-14 |

## Cross-cutting — Brain / operator / measurement

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| brain-health-watchdog-contract | `tests/architecture/brain-health-watchdog-contract.test.ts` | Trust Sprint T7.3 (2026-05-07) | Brain-health watchdog runs the 3 verify scripts + parses grade + checks freshness. | active | Refines when Section 3 cross-tenant brain lands. | 2026-05-14 |
| operator-brain-route-contract | `tests/architecture/operator-brain-route-contract.test.ts` | Trust Sprint T7.6 (2026-05-07) | Operator brain route (`/diagnostics/brain`) contract — tenant-local Brain Readiness Grade. | active | Distinct from Section 3's `/diagnostics/cross-tenant-brain`; retains contract when Section 3 ships. | 2026-05-14 |
| operator-mode-helpers | `tests/architecture/operator-mode-helpers.test.ts` | C1 (2026-05-09) | Pins the contract for `src/lib/operator-mode.ts` helpers. | active | Permanent — operator-mode safety. | 2026-05-14 |
| main-product-final-confidence-sweep | `tests/architecture/main-product-final-confidence-sweep.test.ts` | Trust Sprint T7.7 (2026-05-07) | Final confidence sweep across main product surfaces. | active | Permanent — trust contract. | 2026-05-14 |
| derived-confidence-pipeline-reachable | `tests/architecture/derived-confidence-pipeline-reachable.test.ts` | Trust Sprint T6.5 (2026-05-06) | The T4.4 derived-confidence pipeline is reachable from `.data/tenants/<slug>/recommended-edits.json` consumers. | active | Permanent — trust contract. | 2026-05-14 |
| learning-score-v0-causal | `tests/architecture/learning-score-v0-causal.test.ts` | Trust Sprint T7.5 (2026-05-07) | Learning-score v0 causal join contract. | active | Refines with Section 6 (Primary Recommendation as first-class metric). | 2026-05-14 |
| local-aeo-intelligence-v2 | `tests/architecture/local-aeo-intelligence-v2.test.ts` | Trust Sprint T7.4 (2026-05-07) | Local AEO intelligence v2 pipeline contract. | active | Refines with Section 7 (Off-Site Authority). | 2026-05-14 |

## Cross-cutting — Causal / attribution

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| causal-analyzer-source-rec-id | `tests/architecture/causal-analyzer-source-rec-id.test.ts` | Trust Sprint T7.1 (2026-05-07) | rec → changelog → outcome causal chain in the analyzer script. | active | Refines with Section 6 (Primary Recommendation) — the scope-discipline rules carry over. | 2026-05-14 |

## Cross-cutting — Pure compute + pipeline integrity

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| match-engine-purity | `tests/architecture/match-engine-purity.test.ts` | Phase 3 wiring (pre-plan) | Match engine is pure (no I/O); wired into the scan dual-write block separately. | active | Permanent — match-engine purity floor. | 2026-05-14 |
| measurement-quality-boundary-pin | `tests/architecture/measurement-quality-boundary-pin.test.ts` | S1 (operator audit, 2026-05-05) | Pins `NATIVE_REGIME_START = "2026-04-22"` as the single source of truth for the regime boundary. | active | Permanent — regime-boundary single source of truth. | 2026-05-14 |
| url-normalize-canonical-location | `tests/architecture/url-normalize-canonical-location.test.ts` | Trust Sprint T6.6 (2026-05-06) | URL normalize canonical location (single source of truth for URL canonicalization). | active | Permanent — URL canonicalization safety. | 2026-05-14 |
| diagnostics-no-module-level-state | `tests/architecture/diagnostics-no-module-level-state.test.ts` | Sprint 7 Phase 7.5c/4 (2026-04-25) | Diagnostics pages have no module-level state (per-render fresh reads). | active | Permanent — diagnostics correctness. | 2026-05-14 |

---

## Phase A.2 — Section 3 (Cross-Tenant Brain Activation)

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| brain-config-and-thresholds-provenance | `tests/architecture/brain-config-and-thresholds-provenance.test.ts` | Section 3.1 / 3.3 / 3.5 (2026-05-14) | Pins canonical paths + exact env-var names + locked numeric/literal-string values + module purity + read-at-call-time contract for the cross-tenant brain's config + thresholds modules. | active | Refines when threshold values are revisited post-validation. No scheduled retirement; gates stay, numbers tunable per operator decision. | 2026-05-14 |
| brain-compute-tenant-thresholds-provenance | `tests/architecture/brain-compute-tenant-thresholds-provenance.test.ts` | Section 3.7 / E7 (2026-05-14) | Pins the per-tenant benchmark compute: canonical path, public entry point, single-source gate constant + locked percentiles (0.5/0.75/0.9), Profound fallback sourced only from `T2C_THRESHOLDS`, module purity, inclusion-rule rationale, locked exclusion of `live_not_yet_cited` + `stuck`. | active | Refines when per-action-type compute lands post-MVP or when the percentile choice is revisited. | 2026-05-14 |
| threshold-decision-loader-wiring | `tests/architecture/threshold-decision-loader-wiring.test.ts` | Section 3.7 / Step 3c (2026-05-14) | Pins the loader's threshold-decision wiring AFTER the A.2.3c atomic customer-visible flip: cross-tenant-brain imports, `buildTileStrings` import from `./render-copy`, `resolveTenantThresholdsCached` export + cache-key prefix, `threshold_decision: ThresholdDecision` field on `LifecycleForEdit`, BOTH `threshold_decision: ThresholdDecision` AND `tile_strings: LifecycleTileStrings` fields on `LifecycleSummary`, every `deriveLifecycleStage` call in the loader passes a 2nd thresholds argument referencing `thresholdDecision`, every `renderLifecycleCopy` call passes a `threshold_decision` field, AND the `edit-lifecycle-tile.tsx` import-boundary contract that the component does NOT import `T2C_THRESHOLDS` or `BORROWED_BENCHMARK_TOOLTIP`. | active | Refines when Phase A.3 (indexability) replaces the lifecycle-stage scaffold or a future phase unifies the tile read model. | 2026-05-14 |
| indexability-loader-tenant-isolation | `tests/architecture/indexability-loader-tenant-isolation.test.ts` | Section 4 / Step 3b + post-A.3.5 second-stage (2026-05-15) | Pins the read-only indexability loader's tenant-isolation contract: imports + calls `currentTenantId`, references `opts.tenantId`, throws fail-loud on context mismatch with the literal phrase "tenant context mismatch", filters `reconciliation.canonical_pages` by `tenantDomain` before the URL-membership check, and validates `state.siteDomain` against `tenantDomain` before consuming robots data via `normalizeHost(state.siteDomain) !== tenantDomain`. At least 4 `nullRobotsFlags()` exits cover the robots-defense ladder. After the post-A.3.5 second-stage Supabase mirrors landed, the per-tenant Supabase PKs (`public.robots_state.tenant_id`, `public.sitemap_reconciliation.tenant_id`) became the PRIMARY storage-layer boundary; the loader's two filters are retained as DEFENSE-IN-DEPTH. | active | Permanent at the architectural-pattern level. The defenses become redundant only when ALL upstream writers carry tenant_id correctness guarantees and no global-fallback paths remain. | 2026-05-15 |
| indexability-no-fresh-fetch | `tests/architecture/indexability-no-fresh-fetch.test.ts` | Section 4 / Step 3b (2026-05-14) | Pins the read-only indexability loader's no-fetch contract: source contains none of `fetch(`, `fetchAndParseRobots`, `refreshRobotsState`, `axios`, `superagent`, `node-fetch`, `got(`; loader does NOT import LLM / cost-ledger / cross-tenant-brain / GSC / `-client` / raw-dotdata-json modules. The loader is read-only over stored signals only. | active | Refines (does NOT retire) when A.3.b1 lands the GSC connector — the GSC client path moves from forbidden to allowed; the fetch-token list stays. | 2026-05-14 |
| indexability-loader-import-allowlist | `tests/architecture/indexability-loader-import-allowlist.test.ts` | Section 4 / Step 3b + post-A.3.5 second-stage (2026-05-15) | Pins the read-only indexability loader's import surface to an explicit allowlist (`server-only`, `next/cache`, `./types`, `./compute-indexability`, `@/domains/pages/types`, `@/domains/pages/robots-parser`, `@/domains/citation-lifecycle/canonicalize-url`, `@/lib/business-config`, `@/lib/tenant-context`, `@/lib/persistence/repositories`). Page-snapshots, sitemap-reconciliation, AND robots-state all flow through the tenant-scoped repository now (post-A.3.5 second-stage). The standalone `@/domains/pages/sitemap-reconciliation-store` import was RETIRED — sitemap is read via `repo.getSitemapReconciliation()` against the new `public.sitemap_reconciliation` Supabase mirror after the classification flip from GLOBAL → TENANT_SCOPED. New imports must be added here AND in the loader together. | active | Refines when A.3.b1 lands the GSC connector (the allowlist gains the GSC client path). Permanent otherwise — the indexability domain's read-only loader contract is structural. | 2026-05-15 |
| robots-state-supabase-mirror | `tests/architecture/robots-state-supabase-mirror.test.ts` | Section 4 / post-A.3.5 second-stage (2026-05-15) | Pins the Phase A.3 robots-state Supabase persistence layer: `readRobotsState` and `writeRobotsState` in `src/domains/pages/robots-parser.ts` are async + take `{ tenantId }`; route through `getRepository().forTenant(...).getRobotsState()` / `.setRobotsState()`; `TenantRepository` declares both methods; supabase-backend's read soft-fails on PostgreSQL `42P01` (undefined_table) for sequencing model A; supabase-backend's write UPSERTs on `tenant_id` (fail-loud); `refreshRobotsState` signature retired the single-string param for `{ siteDomain, tenantId }`; the pre-A.3 flat-path `readFileSync(statePath(), ...)` is gone from the readRobotsState body. | active | Refines when a future schema_version > 1 lands; permanent otherwise. | 2026-05-15 |
| sitemap-reconciliation-supabase-mirror | `tests/architecture/sitemap-reconciliation-supabase-mirror.test.ts` | Section 4 / post-A.3.5 second-stage (2026-05-15) | Pins the Phase A.3 sitemap-reconciliation Supabase persistence layer: `store-classification.ts` lists `sitemap-reconciliation` in `TENANT_SCOPED_STORES` (NOT in `GLOBAL_STORES`); `TenantRepository` declares both `getSitemapReconciliation` + `setSitemapReconciliation`; indexability loader + operator diagnostics page read via `repo.getSitemapReconciliation()` (NOT the standalone `@/domains/pages/sitemap-reconciliation-store` import); `scripts/scan-owned-pages.ts` `saveReconciliation` is async + writes via `repo.setSitemapReconciliation()`; supabase-backend tenant-scoped read soft-fails on `42P01`; UPSERT on `tenant_id`. | active | Refines when a future schema_version > 1 lands; permanent otherwise. | 2026-05-15 |
| indexability-diagnostics-operator-only | `tests/architecture/indexability-diagnostics-operator-only.test.ts` | Section 4 / Step 5 (2026-05-14) | Pins the `/diagnostics/indexability` operator-gate contract: page exists at the canonical diagnostics path; imports `isOperatorModeServer` from `@/lib/operator-mode` and `notFound` from `next/navigation`; calls `notFound()` when `!isOperatorMode()`; allows `NODE_ENV === "test"` bypass for render coverage; Command Center operator-link carries `data-command-center-operator-link="true"` AND `data-command-center-operator-link-target="indexability"` AND lives inside the `isOperator ?` ternary; NO customer-facing nav/layout/component file (outside `command-center.tsx` and the page itself) references `/diagnostics/indexability`. | active | Permanent — operator-only diagnostic surfaces stay operator-only. | 2026-05-14 |
| indexability-diagnostics-no-fresh-fetch | `tests/architecture/indexability-diagnostics-no-fresh-fetch.test.ts` | Section 4 / Step 5 (2026-05-14) | Pins the `/diagnostics/indexability` page as read-only over stored signals: source contains none of `fetch(`, `fetchAndParseRobots`, `refreshRobotsState`, `axios`, `superagent`, `node-fetch`, `got(`; NO imports from `@/lib/llm/`, `@/lib/cost/`, `@/domains/recommendations/cross-tenant-brain/`, any path containing `gsc`, any `*-client` HTTP-client convention, raw `@/lib/persistence/dotdata-json`, or `@/domains/scanning/` orchestrator. Every import path matches an explicit 12-entry allowlist. | active | Refines (does NOT retire) when A.3.b1 lands the GSC connector — the GSC client path moves from forbidden to allowed; the fetch-token list stays. | 2026-05-14 |

## Section 6 — Primary Recommendation as First-Class Metric

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| snapshot-builder-topic-null-primary-rec | `tests/architecture/snapshot-builder-topic-null-primary-rec.test.ts` | Section 6 C2 / H8 lock (2026-05-15) | Pins that BOTH daily-metric-snapshot builders (native polling `src/domains/daily-metric-snapshots/build-from-observations.ts` AND legacy Profound import `src/derivations/snapshot-builder.ts`) route topic-scope rows to `primary_recommendation_count: null` via an EXPLICIT source-text literal: the native builder's topic emit block contains the literal `primary_recommendation_count: null` pair (no computed value, no accumulator read, no ternary); the Profound builder's emit block carries a ternary `acc.scope_type === "topic" ? null : …` so topic rows force null regardless of accumulator state. Topic-scope primary share has no v1 consumer; locked NULL until a future phase introduces one. Companion runtime tests `tests/domains/daily-metric-snapshots/build-from-observations-primary-rec.test.ts` + `tests/derivations/snapshot-builder-primary-rec.test.ts` cover the runtime behavior. | active | Refines if Section 6 introduces topic-scope primary share OR retires the legacy Profound builder. | 2026-05-15 |
| section6-c3-no-account-emission | `tests/architecture/section6-c3-no-account-emission.test.ts` | Section 6 C3 / C1.1 contract (2026-05-15) | Pins that `scripts/backfill-section6-primary-recommendation.ts` never emits, inserts, updates, or upserts a `daily_metric_snapshots` row with `scope_type = "account"`: exports the `C3AccountEmissionError` runtime kill-switch class, invokes it when `row.scope_type === "account"`, has no `scope_type: "account"` row-literal anywhere, restricts the `ExistingRowUpdate` type to `"entity" \| "topic" \| "platform"`, and routes all writes through exactly one `.upsert(` call site inside the prompt-scope helper (zero `.insert(` call sites). Enforces the C1.1 column-comment correction at the backfill layer; combined with `snapshot-builder-topic-null-primary-rec`, the entire Section 6 emission set is locked. | active | Refines if a future post-cron account aggregator phase introduces an explicit account-emission code path. | 2026-05-15 |
| section6-c3-dry-run-default | `tests/architecture/section6-c3-dry-run-default.test.ts` | Section 6 C3 / operator-safety convention (2026-05-15) | Pins that `scripts/backfill-section6-primary-recommendation.ts` defaults to dry-run mode: `parseArgs` initializes `commit: false`, the only path that flips commit-true is the literal `--commit` flag, every `deps.applyExistingUpdate` / `deps.applyPromptUpserts` call site appears AFTER the `if (!args.commit)` early-return guard (no unconditional writes), the mode label includes both `"DRY-RUN"` and `"COMMIT"` literals, and `--tenant=<id>` is REQUIRED at parse time (no silent BEACON_TENANT_ID fallback for cross-tenant safety). Lifts the Phase 2A operator-script convention (`scripts/backfill-snapshot-extensions.ts`) to an architecture invariant; protects future drive-by edits from flipping default-write semantics. | active | Permanent — operator-script dry-run default is a floor. | 2026-05-15 |
| today-primary-share-source | `tests/architecture/today-primary-share-source.test.ts` | Section 6 C4b / customer-visible source-swap (2026-05-15) | Pins the Today v2 hero's primary-recommendation pct source contract: `src/app/(shell)/today-v2-data.ts` imports `computeTodayPrimaryShare` from the C4a helper module + invokes it exactly once; the active production client `src/app/(shell)/today-v2-visibility-group-client.tsx` does NOT contain the legacy `platformPrimaryPct` closure body, does NOT read `sparkline.points[i].primaryRate` for hero pct values, and consumes `primaryShare.chatgptPrimaryPct` + `primaryShare.perplexityPrimaryPct` as props. Separately confirms `sampleStatus` reads remain (separate per-platform signal not coupled to the swap). Legacy `today-client.tsx` + `today-v2-client.tsx` intentionally NOT pinned per J2 (not on production hot path). Companion runtime test `tests/components/today/today-v2-visibility-group-client-primary-share-source.test.tsx` proves the rendered HTML reflects the prop, not the sparkline. | active | Refines when legacy today-client.tsx + today-v2-client.tsx are retired and the swap is extended to those paths. | 2026-05-15 |
| today-primary-share-tenant-isolation | `tests/architecture/today-primary-share-tenant-isolation.test.ts` | Section 6 C4b / tenant scope discipline (2026-05-15) | Pins two source-text contracts: (1) every `computeTodayPrimaryShare(` invocation in `src/app/(shell)/today-v2-data.ts` is preceded within the same function body by a `getRepository().forTenant(` call supplying the `repo` argument; (2) the helper module `src/domains/daily-metric-snapshots/today-primary-share.ts` does NOT import `getRepository` from `@/lib/persistence/repositories` and does NOT reference the identifier in its active (comment-stripped) source. Enforces the C4a caller-bound tenant-scope design — the helper consumes a pre-bound `TodayPrimaryShareRepo` and never constructs its own repository instance. | active | Permanent — caller-bound tenant scope is a structural contract; refines only if the helper ever needs to construct its own repo (which would itself require an operator-locked decision). | 2026-05-15 |

## Operator surface safety

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| diagnostics-pages-force-dynamic | `tests/architecture/diagnostics-page-dynamic.test.ts` | Operator surface prerender safety (2026-05-15) | Pins that the operator-only `/diagnostics` index AND every sibling diagnostics/* page (`brain`, `spikes`, `indexability`) declares `export const dynamic = "force-dynamic"` so Vercel does NOT attempt static prerender of operator-mode pages. Operator pages execute tenant-scoped Supabase reads (e.g., `repo.getPageSnapshots()` at `diagnostics/page.tsx:261`) that exceed the build-time statement_timeout on slow builds, producing nondeterministic deployment failures (e.g., commit 730a6de's Vercel build on 2026-05-15). The directive opts each page into dynamic per-request rendering so the Supabase calls only run when an operator actually visits. Defense-in-depth: also pins that the index page's `isOperatorMode()` + `notFound()` gate remains intact so a future drive-by edit can't drop both directive AND gate simultaneously. | active | Permanent — operator surfaces should never prerender. | 2026-05-15 |

## Pending entries (Section 12.1 self-reference)

| name | source test file | section | purpose (one sentence) | status | retirement-condition | last-verified |
|---|---|---|---|---|---|---|
| catalog-sync | `tests/architecture/catalog-sync.test.ts` | Section 12.1 (2026-05-14) | Catalog row count equals architecture-test file count; bidirectional referential integrity. | active | Permanent — catalog discipline floor. | 2026-05-14 |
