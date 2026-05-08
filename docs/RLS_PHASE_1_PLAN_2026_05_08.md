# RLS Phase 1 Plan — 2026-05-08

> **Supersedes** the original "add RLS" framing in `BEACON_BRUTAL_FRESH_EYES_AUDIT_2026_05_08.md` §B / §H.
> Baseline file: [`migrations/2026-05-08_baseline_schema.sql`](../migrations/2026-05-08_baseline_schema.sql) (commit `11101a2`).

---

## Why this revision exists

The original audit claimed "no RLS policies exist on any of 35+ Supabase tables" and listed the work as "add RLS." That claim was wrong. The Phase 0.5 schema dump (2026-05-08) shows production already has comprehensive RLS:

- **36** public tables, **all** with `ENABLE ROW LEVEL SECURITY`
- **72** policies total: 36 × `deny_anon` + 35 × `deny_authenticated` + 1 × `members_self_read` (on `tenant_members`)
- App reads/writes use the service-role key, which bypasses RLS entirely

The work isn't "add RLS." The work is **"refine the existing deny-authenticated posture into selective tenant-aware authenticated policies, after fixing schema gaps that prevent doing so safely."**

This plan corrects the framing and re-sequences the rollout.

---

## What RLS does and does not protect today

**Protects:**
- Accidental anon-key reads from a browser. If a JWT-less client.from(...) ever reaches Supabase REST, it returns nothing (deny_anon).
- Accidental authenticated reads from a browser. If a logged-in user makes a client-side query without service-role, it returns nothing (deny_authenticated) — except `tenant_members.SELECT WHERE user_id = auth.uid()` on the user's own membership row.

**Does NOT protect:**
- **Tenant isolation in app code paths.** All app reads/writes use `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. Isolation is enforced application-side by the `.eq("tenant_id", x)` discipline layered on top of `currentTenantId()`. A bug there leaks across tenants — the deny policies cannot help.
- **Cross-tenant writes from unscoped writer paths.** Several writer call sites still emit `tenant_id: ""` literals (see Stage D below), and dual-write's `tenantizeRows` helper coerces those to the resolved tenantId. Coercion is not isolation; if `tenantizeRows` is bypassed (writer doesn't go through `dualWriteUpsertScoped`), the empty string can flow into a query that won't error.
- **Tenants without a `tenant_id` column at all.** 18 tables don't have the column. No RLS policy can scope rows by a column that doesn't exist.

**Honest summary:** the deny-everywhere posture is defense-in-depth against client-side mistakes, not the load-bearing tenant-isolation layer. Until app reads move off service-role, RLS is a backstop. That's fine for single-tenant dogfeed; it is **not sufficient for customer #2** without the changes below.

---

## Table categorization (all 36 tables)

The dump + code review classifies every public table into A / B / C / D. The categorization here matches `GLOBAL_TABLES` in [src/lib/persistence/dual-write.ts:147-158](../src/lib/persistence/dual-write.ts) where applicable, with one addition (`change_contracts` uses `account_id` and is not yet in `GLOBAL_TABLES` — flagged in Category C).

### Category A — `tenant_id` present and populated (18 tables)

These tables already carry `tenant_id` and the dual-write pipeline stamps it via `tenantizeRows`. Phase 1 work for these is **policy refinement**: replace `deny_authenticated` with a selective policy that joins through `tenant_members`.

**A1 — with `tenant_id_nonempty_chk` CHECK constraint (5):**
- `changelog_entries`
- `import_runs`
- `recommendation_responses`
- `results`
- `scan_findings`

**A2 — without `tenant_id_nonempty_chk` CHECK constraint (13):**
- `change_outcomes` (also has Sprint 7 Phase 1 backfill comment)
- `daily_metric_snapshots`
- `guardrail_alerts` (Sprint 7 Phase 1 backfill)
- `llm_rejections`
- `observation_runs` (Sprint 7 Phase 1 backfill)
- `page_element_inventory`
- `page_snapshots`
- `pages` (Sprint 7 Phase 1 backfill)
- `prompt_answer_observations`
- `raw_poll_chunks`
- `recommended_edits`
- `tenant_members` (special-cased: `tenant_id` is its scoping column AND the resolution table)
- `url_change_outcomes`

**Phase 1 plan for A1 + A2:**
1. Stage C (below) extends `tenant_id_nonempty_chk` to all 13 A2 tables.
2. Stage E creates a `tenant_member(uid uuid, tid text)` SQL helper.
3. Stage E replaces `deny_authenticated` with `tenant_authenticated_rw`:
   ```sql
   CREATE POLICY "tenant_authenticated_rw" ON public.<table>
     TO authenticated
     USING  (tenant_id IN (SELECT tid FROM public.tenant_member(auth.uid())))
     WITH CHECK (tenant_id IN (SELECT tid FROM public.tenant_member(auth.uid())));
   DROP POLICY "deny_authenticated" ON public.<table>;
   ```
   Service-role still bypasses RLS, so cron paths are unaffected. The new policy only matters once Stage F lights up authenticated client reads.

### Category B — Missing `tenant_id`, tenant-scoped by intent (7 tables)

These tables represent per-tenant data but lack the column. Stage B work: add column, backfill from the founder tenant, add nonempty CHECK, then Stage E policy.

| Table | Why tenant-scoped | Backfill source |
|---|---|---|
| `attribution_decisions` | Per-event/result decision rows; the result already lives in a tenant | Lookup via `result_id → results.tenant_id` |
| `candidate_links` | Per-result candidate causes; same scoping as parent result | Lookup via `result_id → results.tenant_id` |
| `competitor_config` | id="current" singleton currently; one config per tenant once multi-tenant | Backfill all rows to `tenant-ritz-founder` |
| `competitors` | Per-tenant competitor list (Ritz tracks builders; another tenant tracks dentists) | Backfill all rows to `tenant-ritz-founder` |
| `opportunities` | Per-tenant opportunity queue | Backfill all rows to `tenant-ritz-founder` |
| `page_issues` | Per-tenant scan findings on owned pages | Backfill all rows via `page_id → pages.tenant_id`, fall back to founder if join misses |
| `page_visibility` | Per-tenant per-page visibility summary | Backfill via same join chain |

**Phase 1 Stage B plan per Category-B table:**
```sql
-- Repeat per table:
ALTER TABLE public.<tbl> ADD COLUMN tenant_id text DEFAULT '' NOT NULL;
UPDATE public.<tbl> SET tenant_id = '<resolved-tenant>' WHERE tenant_id = '';
ALTER TABLE public.<tbl>
  ADD CONSTRAINT <tbl>_tenant_id_nonempty_chk
    CHECK (tenant_id IS NOT NULL AND tenant_id <> '');
CREATE INDEX <tbl>_tenant_id_idx ON public.<tbl> (tenant_id);
```
Then Stage E policy refinement applies as for Category A.

**Code-side:** every writer path for these 7 tables must be updated to stamp `tenant_id` (currently they don't, since the column doesn't exist). The `tenant_id: ""` placeholder audit (see Stage D below) covers most of these — the placeholders are exactly the rows missing the column; Stage B's column addition + backfill turns the placeholders from "harmless because the column doesn't exist" into "load-bearing once the column lands."

### Category C — Uses `account_id` not `tenant_id` (3 tables)

These tables use a column called `account_id` instead of `tenant_id`. The naming predates the multi-tenant rename; semantically these are tenant-scoped.

| Table | Current column | Code path |
|---|---|---|
| `change_contracts` | `account_id NOT NULL` | `src/domains/changelog/change-contract.ts:101` (TS field `accountId`); `dual-write.ts:406` |
| `tracked_prompts` | `account_id NOT NULL` | `src/domains/tracked-prompts/types.ts:11` |
| `tracked_entities` | `account_id NOT NULL` | `src/domains/tracked-entities/types.ts` |

**Two viable strategies — pick one before Phase 1 starts:**

**Strategy C1 (recommended): rename `account_id` → `tenant_id` everywhere**
- Pros: One naming convention across the codebase. Stage E policy template applies as-is. Future contributors don't trip on synonym confusion.
- Cons: Higher-effort migration. Touches `change-contract.ts` types, `dual-write.ts` mapper, `tracked-prompts/types.ts`, `tracked-entities/types.ts`, and every reader. Estimate: 1 day of mechanical refactor + tests.
- Risk: low. Pure rename behind a column-add + dual-read shim during the migration window.

**Strategy C2: keep `account_id`, write parallel policies**
- Pros: Smaller blast radius. No file edits.
- Cons: Stage E policies need a per-category branch. Future readers get two ways to spell the same concept. Locks in technical debt that the audit already named.
- Risk: low.

**Recommendation: C1.** The Phase 1 cost is small; the long-term confusion cost of two synonyms in the same schema is high. Decision should be locked before Stage B begins so we don't migrate tenant_id and rename account_id in the same window.

### Category D — Legitimately global / shared today (8 tables)

These tables either have no tenant scope (registry / FK-inherited scope) or are deliberately shared across tenants today. The taxonomy here matches `GLOBAL_TABLES` in `dual-write.ts` exactly (10 entries minus 2 that are recategorized: `tracked_prompts` and `tracked_entities` belong in Category C).

**D1 — true global, no scoping ever needed (1):**
- `tenants` — the tenant registry itself. RLS posture: keep `deny_authenticated`, add `members_self_read_tenant` policy so a logged-in user can read their own tenant row(s) via the `tenant_members` join. Only the operator (service-role) ever inserts a new tenant.

**D2 — scope inherited via FK chain (1):**
- `answer_texts` — keyed by `observation_id`. The parent `prompt_answer_observations` is tenant-scoped (Category A2). RLS for `answer_texts` can either: (a) stay `deny_authenticated` and read via service-role only; or (b) refine with a join policy:
  ```sql
  USING (observation_id IN (
    SELECT observation_id FROM public.prompt_answer_observations
    WHERE tenant_id IN (SELECT tid FROM public.tenant_member(auth.uid()))
  ))
  ```
  **Recommendation:** stay deny_authenticated for Phase 1; revisit only when authenticated reads need this table (which is rare — answer text is operator-internal, not surfaced to customers). This also avoids a join-policy performance question on a large-row-count table.

**D3 — currently deployment-singleton, needs Category-B-style migration for multi-tenant (3):**
- `business_config` (id="current", one row total today)
- `citation_evidence_index` (id="current")
- `answer_intelligence_index` (id="current")

These are SINGLETON-PER-DEPLOYMENT today (Beacon dogfeeds Ritz; one `business_config` exists). For customer #2, each of these becomes SINGLETON-PER-TENANT — same shape as Category B.

**Phase 1 plan for D3:** treat as Category B starting at customer-#2 onboarding prep. Add `tenant_id`, change PK from `id="current"` to `(tenant_id, id="current")` or just `tenant_id`, backfill the existing row to `tenant-ritz-founder`. Update every reader from `WHERE id = 'current'` to `WHERE tenant_id = ? AND id = 'current'`.

This is non-trivial — 3 tables × ~5-10 reader sites each. Estimate: 1-2 days. **Sequencing recommendation:** ship Stage B (Category B) first, then D3 as a separate bundle, since D3 changes a load-bearing read path (`getBusinessConfig()` is called everywhere).

**D4 — global learning, may stay shared long-term (3):**
- `change_patterns` — patterns mined across all tenants for which content changes correlate with mention/citation lift
- `triage_rules` — heuristic rules for finding triage
- `confidence_calibration` — calibration of recommendation confidence vs. observed outcome

**Decision required before Phase 1:** Are these per-tenant or shared?

The product story says "shared brain" (per memory `project_shared_brain_privacy`): cross-tenant anonymous patterns are 90% of the brain; per-tenant copy is the other 10%. By that doctrine, `change_patterns`, `triage_rules`, `confidence_calibration` STAY shared — they're the cross-tenant anonymous layer.

**Recommendation:** keep these three as Category D long-term. Do not add `tenant_id`. Their RLS policy stays `deny_authenticated` (reads happen via service-role on the cron pipeline; nothing in the customer-facing UI reads them directly today). If Stage F ever needs an authenticated read path, write a `learning_authenticated_read_only` policy (no WITH CHECK — read-only) that allows any authenticated user to SELECT, since the contents are anonymous patterns.

---

## CHECK constraint gap (Stage C)

5 tables have `tenant_id_nonempty_chk`; 13 do not. The 13 missing it (Category A2) are exposed to the empty-string regression that Sprint 7 Phase 7.2 specifically defended against on the original 5.

**Plan:** before Stage E policies land, extend the CHECK to all Category A2 tables. Do this AFTER Stage B (so the 7 newly-tenant_id-stamped tables also get the CHECK in the same pass), AFTER Stage D's tenant_id-placeholder repair (so the CHECK doesn't trip on existing bad rows).

Sequencing: B → D → C → E.

```sql
-- For each Category A2 table that should never accept empty tenant_id:
ALTER TABLE public.<tbl>
  ADD CONSTRAINT <tbl>_tenant_id_nonempty_chk
    CHECK (tenant_id IS NOT NULL AND tenant_id <> '');
```

`tenant_members` is the one A2 table where this CHECK is redundant (the column is already `text NOT NULL` with FK to `tenants.id`). Skip there.

---

## `tenant_id: ""` placeholder repair (Stage D)

The original audit mentioned "4 production files" with `tenant_id: ""` placeholders. The actual count is **36+ sites across 25+ files** (sweep on 2026-05-08). The pattern:

```ts
// Common shape:
const row = {
  ...,
  tenant_id: "", // CX1: filled by caller
};
```

**Why this is "safe today":** every writer goes through `dualWriteUpsert` (for global tables) or `dualWriteUpsertScoped` (for tenant-scoped tables). The scoped path runs `tenantizeRows`, which throws on a NON-empty mismatch but silently coerces empty/null/undefined to the resolved tenantId. So an empty placeholder gets stamped correctly at write time.

**Why this is unsafe long-term:**
1. **Coercion ≠ isolation.** If a future writer skips `dualWriteUpsertScoped` and goes straight to `getSupabaseAdmin().from(...).insert(...)`, the empty string flows directly into the row. The CHECK constraint catches it on the 5 A1 tables; nothing catches it on the other 13 A2 tables (until Stage C lands).
2. **Cron path.** A few cron entry points (`run-orchestrated-scan.ts`, `scan-owned-pages.ts`, `daily-native-poll.yml`) set the tenant from environment variables. If `BEACON_TENANT_ID` is unset and the writer is one of the unscoped paths, empty strings persist.
3. **Adapter path.** `src/adapters/profound/*` paths emit `tenant_id: ""` and rely on caller stamping. If a future caller forgets, rows leak.

**Plan for Stage D (the placeholder repair):**

Each call site falls into one of three buckets. Audit and convert:

**D-a (drop the empty string, let `tenantizeRows` coerce):**
```ts
// Before
const row = { ...payload, tenant_id: "" };
// After (tenantizeRows resolves)
const row = { ...payload };
```
Safe everywhere — `tenantizeRows` coerces missing/null/empty to the resolved tenantId.

**D-b (require caller to pass tenantId, stamp inline):**
```ts
// Before
function buildRow(payload) {
  return { ...payload, tenant_id: "" };
}
// After
function buildRow(payload, tenantId) {
  if (!tenantId) throw new Error('buildRow: tenantId required');
  return { ...payload, tenant_id: tenantId };
}
```
Required for the row builders that don't go through a sync wrapper.

**D-c (resolve `currentTenantId()` at the top of the action):**
```ts
// Server action / API route entry point
const tenantId = await currentTenantId();
if (!tenantId) throw new Error('no tenant context');
const row = { ...payload, tenant_id: tenantId };
```
Required for entry-point boundaries (server actions, API handlers, cron entries).

**Site-by-site conversion table** — to be filled in during Stage D execution. Estimate: 36 sites × 5 minutes each = 3 hours of grind work plus tests. The mechanical conversion is low-risk; the risk is in the cron-entry-point sites where the tenantId source must be re-verified.

Critical sites to audit first (cross-tenant blast radius):
1. `src/lib/persistence/dual-write.ts` — already correct, but verify `GLOBAL_TABLES` excludes Category B tables once they get tenant_id
2. `scripts/scan-owned-pages.ts:679,767` — cron entry; verify `BEACON_TENANT_ID` flows through
3. `src/lib/import/engine.ts:106,180,258,293` — import pipeline; verify `tenantId` parameter is required, not optional
4. `src/adapters/profound/bridge.ts:97,227,310` — adapter path; same
5. `src/domains/visibility-events/engine.ts:219` — comment says "CX1: filled by caller" — find the caller and verify

---

## Customer #2 onboarding blocker checklist

The minimum-viable change set before a second customer can be safely provisioned:

| Blocker | Stage | Severity | Notes |
|---|---|---|---|
| `tenant_id` columns added to all Category B tables | B | **HARD BLOCKER** | Without this, queries can't filter by tenant; cross-tenant reads are inevitable |
| Category B backfilled to `tenant-ritz-founder` | B | **HARD BLOCKER** | Otherwise customer #2's queries see Ritz's existing rows |
| Category C decision (rename or dual-policy) | C-prep | **HARD BLOCKER** | Need to know shape before B begins to avoid double-migration |
| `tenant_id_nonempty_chk` on all Category A2 tables | C | medium | CHECK is defense-in-depth; not blocking but extends Sprint 7 Phase 7.2 to its logical end |
| `tenant_id: ""` placeholders converted to D-a/D-b/D-c | D | **HARD BLOCKER** | Most critical: cron entry points + import pipeline + adapter paths |
| `currentTenantId()` resolution audited end-to-end | D | **HARD BLOCKER** | Single bug here = total tenant-isolation failure |
| `daily-native-poll.yml` and other crons resolve tenant per-job | D | **HARD BLOCKER** | Currently sequential single-tenant; for N tenants, must iterate or fan out |
| `BEACON_LIFECYCLE_ENABLED` cron path verifies `tenant_id` filtering on every read | D | **HARD BLOCKER** | Match runner reads → if it forgets `.eq("tenant_id", x)`, rec from tenant-A could match a verification on tenant-B's URL |
| Stage E policy helper + Stage E policies on Category A | E | optional | Defense-in-depth; not blocking if all reads stay on service-role |
| Stage F authenticated-user read path | F | not needed for #2 | Can defer |
| D3 singleton-per-tenant migration | D3 | medium-blocker | Customer #2 will need their own `business_config` row |

**Net minimum path to customer #2:** **B → D → C → E for Category A defense-in-depth → smoke test with two seeded tenants.**

Stage F (authenticated reads) is **not** required for customer #2. Stage F unlocks the customer-facing UI moving off service-role; that's a separate quality-of-life improvement, not a tenant-isolation requirement.

---

## Phase sequencing (revised stages)

| Stage | Description | Status | Estimated effort |
|---|---|---|---|
| **A** | Schema baseline committed | ✅ done in commit `11101a2` | — |
| **B** | Add `tenant_id` to 7 Category-B tables, backfill, index | pending | 1-1.5 days (column adds + backfill scripts + tests) |
| **C** | `tenant_id_nonempty_chk` extended to all 13 A2 tables + 7 newly-B tables | pending | ½ day |
| **D** | `tenant_id: ""` placeholder repair across 36+ sites + cron tenant-resolution audit | pending | 2 days |
| **E** | Stage-E policy helper (`tenant_member` SQL func) + tenant-scoped policies for Categories A and B | pending | 1 day |
| **F** | Optional — move browser-side reads off service-role onto authenticated JWT | deferred | 3-5 days; not required for customer #2 |
| **G** | Customer #2 onboarding (only after A-E) | deferred | depends on customer self-serve maturity |

**Important detour: Category C decision.** Lock C1 vs C2 BEFORE Stage B begins (1-hour decision discussion). If C1 (rename account_id → tenant_id), schedule that migration ALONGSIDE Stage B so Categories B and C move in one bundle.

**Important detour: Category D3 multi-tenant migration.** Schedule between Stage E and Stage G as a separate bundle. The 3 deployment-singleton tables (`business_config`, `citation_evidence_index`, `answer_intelligence_index`) need column additions + reader updates. Don't bundle into Stage B because they touch different code paths.

---

## Recommended first implementation bundle

**Bundle name:** "Phase 1 Stage B — Category B tenant_id column additions"

**Scope:**
1. Single migration file: `migrations/2026-05-09_phase1_stage_b_category_b_tenant_id.sql`
2. Adds `tenant_id text DEFAULT '' NOT NULL` to: `attribution_decisions`, `candidate_links`, `competitor_config`, `competitors`, `opportunities`, `page_issues`, `page_visibility`
3. Backfills all rows to `tenant-ritz-founder` (single-tenant safe)
4. Adds `tenant_id_nonempty_chk` to each
5. Adds `(tenant_id)` index to each
6. Drops the old `deny_authenticated` policies on these 7 (preparing for Stage E)
7. Re-creates `deny_authenticated` UNCHANGED on these 7 (placeholder; Stage E replaces it)

**Out of scope for this bundle:**
- Category C rename (separate decision, separate bundle)
- Stage D placeholder repair (Stage B's writers can keep stamping `""`; `tenantizeRows` still coerces correctly because the column now exists with a default — the CHECK fires on unstamped writes)
- Stage E policy refinement (Stage B is structural prep only)
- D3 deployment-singleton migration (separate bundle)

**Why start here:**
1. **Smallest blast radius.** 7 tables, none of which are in the cron hot path the way `prompt_answer_observations` and `recommendation_responses` are.
2. **No reader changes required immediately.** The new column has a default; existing readers that don't filter by `tenant_id` still see all rows. (The Stage D placeholder repair is what locks down the writers.)
3. **Unblocks Stage C.** Without the column, the CHECK constraint can't be added.
4. **Fits a single PR.** ~150 lines of SQL + 1 backfill verification script + tests.

**Verification gate:**
1. `npm run typecheck && npm run test` — must pass
2. New migration test: every Category-B table has `tenant_id` column + CHECK + index
3. Manual: run a SELECT against each Category-B table, confirm `tenant_id` populated on all rows
4. No code changes that would touch reader behavior — strictly schema-side bundle

**Recommended capability for this bundle:** **Balanced (Sonnet)** — Stage B is mechanical SQL + tests. Save **Max (Opus)** for Stage D (the placeholder repair across 36 sites needs judgment on which sites are D-a vs D-b vs D-c) and Stage E (policy design).

---

## What this plan deliberately does NOT do yet

- Does not write any migration files (Stage A is the only one committed; Stages B-F are planned but not coded)
- Does not modify Supabase production
- Does not enable or change any RLS policies
- Does not change app code
- Does not push any commits to the remote

The plan is the deliverable. The next bundle is the implementation. Operator approves a bundle scope before any of the above happens.

---

## Open decisions (operator input needed)

1. **Category C strategy:** rename `account_id` → `tenant_id` (C1, recommended) or keep dual naming + parallel policies (C2)?
2. **Category D4 verdict:** keep `change_patterns`, `triage_rules`, `confidence_calibration` as cross-tenant shared (recommended, matches "shared brain" doctrine) or scope per-tenant?
3. **Stage F sequencing:** defer until after customer #2 (recommended) or run in parallel with Stage E?
4. **First bundle approval:** proceed with the recommended Stage B Category-B bundle, or pick a different starting point?

---

*End of plan. Awaiting operator decision on the four open questions before any implementation work begins.*
