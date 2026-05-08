# Current Beacon Truth — 2026-05-08

> **For future agents:** the `docs/` directory has 50+ sprint reports and audits. Many contain stale or wrong claims. **Do not trust any of them as current truth without verifying against code/schema first.** This file marks the current verified ground state. Re-verify before relying on anything below.

---

## 1. Verified truths (as of 2026-05-08, checked against code + production schema)

- **Lifecycle loop is ALIVE but underfed and mostly invisible.** `BEACON_LIFECYCLE_ENABLED` is on; match runner stamps `live_at`; verdict states (`helping`, `weak_signal`, `nothing_yet`, `too_early`, `hurting`) all flow. The original audit was wrong about this — caused by a buggy regex that missed JSON whitespace. The visibility problem is real: too few rows reach `verified_live`, and the UI buries what does.
- **Recommendation ranking is REAL and recommendation `engineConfidence` is a real signal.** The rubric in [src/domains/recommendations/confidence.ts](src/domains/recommendations/confidence.ts) computes HIGH / MEDIUM / LOW from observation count, affected prompts, and signal strength. The audit conflated this with a legacy edit-confidence column (which IS hardcoded `"medium"`); two different fields, same name. The customer-facing ranking is honest.
- **RLS exists on all 36 public tables.** Production posture is `deny_anon` + `deny_authenticated` everywhere, plus `members_self_read` on `tenant_members`. Source of truth: [migrations/2026-05-08_baseline_schema.sql](../migrations/2026-05-08_baseline_schema.sql). All app reads/writes use `SUPABASE_SERVICE_ROLE_KEY` and bypass RLS — so RLS today is **defense-in-depth against anon-key leaks, not the load-bearing tenant-isolation layer**. Tenant isolation is enforced application-side by `.eq("tenant_id", x)` on top of `currentTenantId()`.
- **competitorPageBlueprints plumbing exists and 5 snapshots are captured locally.** Module: [src/domains/pages/competitor-page-snapshots.ts](../src/domains/pages/competitor-page-snapshots.ts). Scanner: [scripts/scan-competitor-pages.ts](../scripts/scan-competitor-pages.ts) (defaults to `--dry-run`, requires `--write`). 5 snapshots in `.data/competitor-page-snapshots.json` (Whole Home Remodel + 4 location pages). Architecture contract test pins the 6 invariants at [tests/architecture/competitor-page-blueprints-contract.test.ts](../tests/architecture/competitor-page-blueprints-contract.test.ts).
- **Customer nav is already cleaned.** Sidebar exposes 5 customer routes (`/`, `/recommendations`, `/prompts`, `/changes`, `/settings`). Command palette: only `g+t`/`g+c`/`g+s` shortcuts; no Market group. Settings tabs: 4 customer tabs (no health / sign-offs / methodology / connectors). ExitGatesSettingsHint is operator-gated by `BEACON_OPERATOR_MODE`. Locked by [tests/architecture/customer-nav-exposure.test.ts](../tests/architecture/customer-nav-exposure.test.ts).
- **H2 generator no longer emits competitor names in public copy.** Removed in commit `b531a97`. Replaced `Why teams choose us over ${Competitor}` with `What to look for in ${cluster}` + brand-claim grounder defensive guard. Validator gate at `specific-edit-validator.ts:1402` is no longer fighting the generator.

## 2. False / stale audit claims to ignore

These appear in earlier docs (especially `BEACON_BRUTAL_FRESH_EYES_AUDIT_2026_05_08.md` original version) and are wrong:

- **"Lifecycle loop is off / dead code / `BEACON_LIFECYCLE_ENABLED` is OFF."** Wrong. Loop is alive. Caused by a regex bug in the audit grep.
- **"Ranking is fake — sorted by `created_at DESC`."** Wrong for the customer-facing path. The audit sampled the legacy edit-confidence column, not `engineConfidence`. The queue does rank.
- **"`engineConfidence: "medium"` is a hardcoded literal on all 31 production rec rows."** Wrong field. Two columns, same name. The customer-facing one is computed.
- **"No RLS policies exist on any of 35+ Supabase tables. Migrations dir contains zero `CREATE POLICY` statements."** Wrong. The migrations dir was incomplete (RLS was provisioned via Supabase dashboard); production has 72 policies. The 2026-05-08 baseline dump fixes the source-control gap.
- **"Customer nav exposes /audit, /rank, /moves, /review, /expansion, /diagnostics, /changes/truth as default."** Wrong. Sidebar surfaces only 5 customer routes; the dead routes are not linked. Verified against [src/lib/navigation.ts](../src/lib/navigation.ts) + customer-nav-exposure test.
- **"Tenant_id placeholders exist in 4 production files."** The count is wrong (actual: 36+ sites across 25+ files), but the underlying concern is real — `tenantizeRows` coerces the empty placeholders, and a future writer that bypasses the helper would leak. Flagged as Stage D in the RLS plan.

The audit's general direction was right; specific claims about lifecycle, ranking, and RLS were not.

## 3. Current highest-priority remaining work

In order:

1. **RLS Phase 1 Stage B** — add `tenant_id` column to the 7 Category-B tables (`attribution_decisions`, `candidate_links`, `competitor_config`, `competitors`, `opportunities`, `page_issues`, `page_visibility`). Backfill, CHECK, index. See [docs/RLS_PHASE_1_PLAN_2026_05_08.md](RLS_PHASE_1_PLAN_2026_05_08.md). **This is the recommended next implementation bundle.**
2. **RLS Phase 1 Stage C** — extend `tenant_id_nonempty_chk` to all 13 A2 tables + the 7 newly-B tables (only 5 tables have it today).
3. **RLS Phase 1 Stage D** — repair the 36+ `tenant_id: ""` placeholder sites; audit cron entry-point tenant resolution.
4. **RLS Phase 1 Stage E** — `tenant_member(uid, tid)` SQL helper + selective tenant-scoped policies replacing `deny_authenticated` on Categories A and B.
5. **Category C decision** — rename `account_id` → `tenant_id` on `change_contracts`, `tracked_prompts`, `tracked_entities` (recommended), or write parallel policies. Lock before Stage B if rename is chosen so both move in one bundle.
6. **D3 deployment-singletons** — `business_config`, `citation_evidence_index`, `answer_intelligence_index` need column additions for multi-tenant (separate bundle from B).
7. **Lifecycle visibility on /today** — surface `verified_live` outcomes more prominently. The data exists; the UI buries it.
8. **Decompose monster files** — `today-data.ts` (~2.8k lines) and `recommendations-client.tsx` (~1.7k lines). Defer until after RLS Phase 1; high-touch files; do behind a feature freeze.

## 4. Sources of truth (in priority order)

When verifying any claim, consult these in order. The first source that resolves the question wins.

1. **Production schema dump** — [migrations/2026-05-08_baseline_schema.sql](../migrations/2026-05-08_baseline_schema.sql). Authoritative for table existence, columns, RLS policies, CHECK constraints, indexes.
2. **Current code in `src/`** — authoritative for runtime behavior. If schema and code disagree, the schema represents what's deployed; code represents what's intended in the next deploy.
3. **Tests in `tests/`** — authoritative for invariants the team has chosen to lock. Architecture contract tests (`tests/architecture/*`) pin product-shape decisions; treat them as durable.
4. **Current data files in `.data/*.json`** — authoritative for *current state*, not architecture. Useful for "is the loop running?" but not "how is it supposed to work?"
5. **Recently-written docs verified against the above** — including this doc, the RLS plan, and the corrected audit boxes. Verify before relying.
6. **Old sprint reports / preflight docs / handoffs** — historical context only. **Do not treat as current truth.** Many contain claims that were true at the time and aren't anymore. The directory has 50+ such files; the date in the filename does not mean the contents are current.

## 5. Open unknowns

These are not blockers for Stage B but should be resolved before customer #2:

- **Exact customer #2 onboarding path.** `scripts/onboard-tenant.ts` exists; honest end-to-end runtime is unmeasured. We don't know how many manual operator steps it takes.
- **Which global tables stay global long-term.** Category D4 (`change_patterns`, `triage_rules`, `confidence_calibration`) is shared by current architecture (matches "shared brain" doctrine). Need explicit operator decision before Stage E.
- **Whether authenticated client reads are needed soon.** Stage F (move browser-side reads off service-role onto authenticated JWT) is deferred until after customer #2. If customer #2 reveals a UX requirement that needs it earlier, the schedule changes.
- **Whether `today-data.ts` / `recommendations-client.tsx` need decomposition before next feature work.** Both are monster files (~2.8k / ~1.7k lines). They've absorbed every recent feature without obvious breakage; the question is whether the next bundle's blast radius is small enough to keep deferring, or whether decomposition has to happen first. No data yet to decide.

---

*This is a snapshot, not a plan. The plan lives in [docs/RLS_PHASE_1_PLAN_2026_05_08.md](RLS_PHASE_1_PLAN_2026_05_08.md). When facts change, update this file rather than starting a new one.*
