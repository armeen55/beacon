# D3 Singleton-per-tenant — Plan (2026-05-09)

> Phase 0 inspection only. No code changes. No migrations. No mutations.
> Verified by direct schema queries + source greps; not derived from older docs.

## 1. Current truth

Three Supabase tables are deployment singletons keyed by `id='current'`,
with no `tenant_id` column. They are the last hard customer-#2 blocker
in the schema.

| table | rows today | columns | tenant-aware? | RLS today |
|---|---|---|---|---|
| `business_config` | 1 (`id='current'`) | `id, data jsonb, updated_at` | ❌ | `{deny_anon, deny_authenticated}` |
| `citation_evidence_index` | 1 (`id='current'`) | `id, built_at, total_citations_processed, by_page_and_topic jsonb, by_topic jsonb, page_to_topics jsonb` | ❌ | `{deny_anon, deny_authenticated}` |
| `answer_intelligence_index` | 1 (`id='current'`) | `id, built_at, data jsonb` (3 cols) | ❌ | `{deny_anon, deny_authenticated}` |

These are the three remaining `deny_authenticated` rows that the Stage E policy work could not clone (no `tenant_id` column to scope the policy off).

## 2. Table-by-table findings

### 2a. business_config

**Surprise that reframes the problem:** `getBusinessConfig()` in `src/lib/business-config.ts:262` does **NOT read from the Supabase table at all**. It reads, in priority order:

1. `BEACON_BUSINESS_CONFIG_JSON` env var (Vercel-friendly).
2. `.data/business-config.json` (top-level legacy path).
3. `.data/global/business-config.json` (canonical store-classification).
4. `PLACEHOLDER_CONFIG` fallback.

Process-level cache (`_cached`). **No `tenantId` argument.** Every caller gets the same result regardless of which tenant is in scope. The Supabase `business_config` table is dual-written (`src/lib/persistence/dual-write.ts:400`) but **never read** by app code.

This means `business_config` is two problems welded together:
- **The reader is not tenant-aware.** `getBusinessConfig()` needs a `tenantId` argument and per-tenant resolution. This is the load-bearing change.
- **The Supabase table has no `tenant_id`.** Lower-priority — nothing reads it today, so a per-tenant migration here is shadow work until the reader catches up.

Caller count: **36 files** reference `getBusinessConfig` / `business-config`. Customer-#2 path is to thread `tenantId` through every call site OR introduce a per-tenant resolver helper.

### 2b. citation_evidence_index

`getCitationEvidenceIndex()` in `src/lib/persistence/repositories/supabase-backend.ts:280` reads from Supabase:
```ts
.from("citation_evidence_index").select("*").eq("id", "current").maybeSingle()
```

No `tenantId` arg. Hardcoded `id="current"`. Single global row.

Writer: `src/app/api/cron/rebuild-citation-evidence-index/route.ts:111-125` upserts `{ id: "current", ... }`. Triggered by the post-poll workflow's "Rebuild citation_evidence_index (native, global)" job.

Caller count: **25 references** to `getCitationEvidenceIndex`. Surfaces include `today-data.ts`, `/changes`, `/competitors`, `/diagnostics`, `/topics`, plus the freshness banner.

### 2c. answer_intelligence_index

`getAnswerIntelligenceIndex()` in the same backend file (line 304) reads Supabase the same shape: `id='current'`, `maybeSingle`. Returns the `data` jsonb directly.

Writer: `src/lib/persistence/dual-write.ts:917` upserts on import.

Caller count: **9 references** to `getAnswerIntelligenceIndex`. Smaller blast radius than the citation index.

## 3. Reader / writer inventory

### 3a. Highest-risk reader path
**`getBusinessConfig()` in `src/lib/business-config.ts`.** Reasons:
1. Called by 36 files including every server-component on `/today`, `/recommendations`, `/changes`, `/competitors`, `/local`, `/topics`, `/diagnostics`, plus the import orchestrator and the local-presence module.
2. **Process-level cache (`_cached`).** A naive "thread tenantId through" change has to flush the cache per-tenant or the second tenant gets the first tenant's config. This is the single biggest regression risk in the entire D3 effort.
3. **Multiple resolution sources** (env, top-level file, global file, placeholder). Per-tenant resolution must compose with each.
4. **No clean injection seam.** Many callers are deep in pure-domain modules (`extractor.ts`, `section-analyzer.ts`, `recommendation-engine.ts`) that today get the config implicitly. Adding a `tenantId` parameter to all of them ripples wide.

The Supabase table change (add `tenant_id`, PK to `(tenant_id, id)`) is the smallest part of the work; the reader rewrite is the bulk of it.

### 3b. Mid-risk reader path
**`getCitationEvidenceIndex()`.** 25 callers. No process cache (good). Surfaces are mostly UI server-components that already have access to a tenant context. The change is mechanical: add a `tenantId` arg, every caller passes it, the method scopes the SELECT.

### 3c. Lowest-risk reader path
**`getAnswerIntelligenceIndex()`.** 9 callers. Same shape as the citation index but smaller. Good "warm-up" if you want the full rhythm before hitting the larger tables.

## 4. Recommended bundle order — but reverse the brief's instinct

The original brief suggested D3.A `business_config` first because it's "most load-bearing." That's exactly the reason to do it **last**, not first. Recommended order:

| bundle | what | why |
|---|---|---|
| **D3.A — answer_intelligence_index (smallest)** | Add `tenant_id`, change PK, backfill Ritz row, update reader signature, update 9 callers, new selective RLS policy | Smallest blast radius; proves the migration shape end-to-end; if it breaks anything, only 9 callers to bisect. |
| **D3.B — citation_evidence_index (medium)** | Same shape, 25 callers, plus the rebuild cron route | Same shape, larger surface. Proven by D3.A. |
| **D3.C — business_config (largest)** | (1) Refactor `getBusinessConfig` to take `tenantId` + flush per-tenant cache; (2) update 36 callers to thread tenantId; (3) optionally migrate the Supabase table per-tenant (lower priority since nothing reads it today). | Highest regression risk. Done last with the team's full attention; D3.A and D3.B will have hardened the rhythm. |

## 5. Per-table migration strategy

For each Supabase table:

1. **Add `tenant_id text NOT NULL`.** Backfill to `tenant-ritz-founder` for the existing single row.
2. **Add `tenant_id_nonempty_chk` CHECK** (matching Stage C convention).
3. **Change PK from `(id)` to `(tenant_id, id)`.** This requires `DROP CONSTRAINT … _pkey` then `ADD CONSTRAINT … _pkey PRIMARY KEY (tenant_id, id)`. Net effect: `id='current'` is preserved; lookup just gains a tenant scope.
4. **Add index `(tenant_id)`** for tenant-scoped reads.
5. **RLS:** drop `deny_authenticated`, add `tenant_authenticated_rw` using `public.is_tenant_member(tenant_id)`. Same shape as E1.A/B/C/D. `deny_anon` untouched.
6. **No data migration beyond the backfill** — the existing JSON contents are correct for Ritz; we just stamp the tenant.

## 6. Per-table reader changes

### D3.A answer_intelligence_index
- `getAnswerIntelligenceIndex()` → `getAnswerIntelligenceIndex(tenantId: string)`.
- Inside: `.eq("id", "current").eq("tenant_id", tenantId).maybeSingle()`.
- 9 callers — most have tenant context in scope already (server actions / server components on `/today`, `/competitors`).

### D3.B citation_evidence_index
- `getCitationEvidenceIndex()` → `getCitationEvidenceIndex(tenantId: string)`.
- 25 callers — same pattern.
- The rebuild cron route at `src/app/api/cron/rebuild-citation-evidence-index/route.ts:111-125` must iterate `ops/active-tenants.json` and upsert one row per active tenant with `id='current'` AND `tenant_id=<that tenant>`.

### D3.C business_config (separate sub-bundle pattern)
1. Introduce `getBusinessConfig(tenantId: string): BusinessConfig`. Internally:
   - cache keyed `Map<tenantId, BusinessConfig>` instead of single `_cached`.
   - resolution priority: per-tenant override env (`BEACON_BUSINESS_CONFIG_JSON_<TENANT_SLUG>`?) → existing global env → per-tenant Supabase row → existing global file → placeholder.
   - placeholder warning fires once per tenant per process.
2. Thread `tenantId` through 36 callers. Many are server-components and server actions where `currentTenantId()` is already imported nearby.
3. Then (and only then) the Supabase table migration — `tenant_id` column, PK change, RLS — has a meaningful reader.

## 7. Bundle-level risk + rollback

| bundle | risk | rollback |
|---|---|---|
| D3.A | low — 9 callers, no caching subtlety | `DROP CONSTRAINT`, `ADD old PK`, `DROP COLUMN tenant_id`, restore old reader signature. Test fixtures remain valid. |
| D3.B | medium — 25 callers + rebuild cron needs a code change | same DDL rollback + revert the cron route. |
| D3.C | high — 36 callers + cache rewrite | rollback splits into (a) revert reader code (one file) and (b) DROP COLUMN. Each is reversible independently. |

For all three: migration uses the same staged shape as Stage B/C — additive `ADD COLUMN`, backfill, then `ADD CONSTRAINT`/PK swap, then policy refresh. No `DROP` of the existing PK in the same statement that lacks a backfill — the backfill must precede the PK swap.

## 8. Tests required per bundle

- **Migration test** — same 8-invariant template as E1.A/B/C/D + the additional invariant "tenant_id column added + PK shape changed + nonempty CHECK present" against a static SQL read.
- **Repository test** — assert `getXIndex(tenantA)` returns A's row and not B's. Easy to seed-test with two synthetic tenants in a vitest fixture.
- **Architecture test** — ratchet that no new caller uses the old (no-arg) signature. Same shape as the no-`tenant_id:""` ratchet.

## 9. Exact first implementation prompt (D3.A only — when ready)

> Proceed with D3.A `answer_intelligence_index` only. Read-only inspection finished; we know the table has 1 row id='current', is read by 9 callers via `getAnswerIntelligenceIndex()`, has no tenant_id column, and is dual-written by the import path.
>
> Tasks:
> 1. Draft `migrations/2026-05-17_phase3_stage_d3a_answer_intel_per_tenant.sql` (additive only): ADD COLUMN `tenant_id text`, backfill to `tenant-ritz-founder`, ALTER COLUMN `tenant_id` SET NOT NULL, ADD `tenant_id_nonempty_chk`, DROP old `_pkey`, ADD new PK `(tenant_id, id)`, CREATE INDEX `(tenant_id)`. Do NOT change RLS in this bundle.
> 2. Draft companion migration `migrations/2026-05-17_phase3_stage_d3a_answer_intel_rls.sql` for the policy switch (DROP `deny_authenticated`, CREATE `tenant_authenticated_rw`). Apply this only after the schema migration has held under one rebuild.
> 3. Refactor `getAnswerIntelligenceIndex()` to take `tenantId: string`. Update all 9 callers. Update the dual-write writer to stamp tenant_id.
> 4. Add migration test (10 invariants) + repository unit test (two-tenant isolation).
> 5. Run typecheck + full vitest. Do NOT apply migrations. Do NOT change runtime until I approve apply.
>
> Rules: no paid APIs, no live Supabase mutations, no policy changes, no D3.B work, no business_config work.

## 10. What NOT to touch yet

- **D3.B citation_evidence_index** — wait for D3.A to bake.
- **D3.C business_config** — last, after both. Do not start the `getBusinessConfig` cache rewrite until D3.A and D3.B have proven the migration rhythm.
- **The 8 remaining `deny_authenticated` policies overall** — `change_patterns`, `confidence_calibration`, `triage_rules`, `tenants`, `answer_texts` are intentionally NOT D3 work (D2/D4/meta classifications per the truth-check). Do not bundle them in.
- **Budget enforcement** (Stage B.4 / B.5) — separate stream, separate flags.
- **E1.E `tenant_members` policy refresh** — its own bundle, lower priority than customer-#2 unblocking.

## 11. Status: where this fits

- ✅ E0/E0.1/E1.A/E1.B/E1.C/E1.D applied — 27 of 35 tenant-scoped tables under `tenant_authenticated_rw`.
- ✅ Phase 2 Stage A applied (`llm_budget_ledger` table exists, RLS in place).
- ✅ Phase 2 Stage B.2 shadow dual-write live (flag set in GH Actions + Vercel).
- ⏳ Awaiting next paid poll for first real ledger rows + verifier attestation.
- ⏳ D3.A → D3.B → D3.C is the next major stream after budget verification clears.
- D3 implementation should begin **only after the budget verifier confirms the next poll's dual-write is clean** — that closes the open observation gate from Stage B.2 before opening a new gate.
