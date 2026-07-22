# Architecture invariants catalog (the constitution)

> **Purpose.** Canonical index for the constitutional architecture suite
> under `tests/architecture/*.test.ts`. On 2026-07-20 the 176-file /
> ~29,877-line architecture-test empire was amputated and rebuilt into a
> constitution of 27 files organized under 13 clauses. Each file pins one
> clause (or one facet of a clause) as behavioral or boundary checks where
> the invariant can be expressed as behavior, and source-scan only where it
> cannot.
>
> **Contract.**
> 1. Every architecture test file MUST be referenced exactly once in the
>    table below (the source-file column).
> 2. Every entry below MUST resolve to an existing test file.
> 3. Mismatches trip `tests/architecture/25-catalog-sync.test.ts`.
> 4. The sync test enforces structural coverage (file existence, uniqueness,
>    count) only. It does NOT check the prose in the purpose column, which
>    stays human-reviewed.
>
> **How to add an invariant.** Prefer extending an existing constitutional
> file for the matching clause. Only add a new file when a genuinely new
> clause appears. When a new `tests/architecture/<name>.test.ts` lands,
> append a row to the matching section and use today's date as
> `last-verified`.
>
> **How to retire.** Delete the test file AND its catalog row in one commit,
> or edit the file to a new invariant and update its row. The sync test
> catches half-finished retirements.
>
> **Status values.** `active` = fails the build if violated. `retired` = row
> kept for history only.

---

## Clause 1 — Tenant isolation

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| tenant-isolation-canonical-store | `tests/architecture/01-tenant-isolation-canonical-store.test.ts` | 1 | The canonical fresh-load path reads tracked prompts/entities only through `tenantRepo.forTenant(tenantId)`, never the unscoped base repo, with both backends implementing the scoped read. | active | 2026-07-20 |
| tenant-isolation-citation-lifecycle | `tests/architecture/02-tenant-isolation-citation-lifecycle.test.ts` | 1 | Citation-lifecycle pure modules never import persistence; every getRepository importer pairs `.forTenant`; loaders and cold-store reads are allowlisted and regime-gated. | active | 2026-07-20 |
| tenant-isolation-business-config | `tests/architecture/03-tenant-isolation-business-config.test.ts` | 1 | The founder global business-config file never serves a non-founder tenant; customers resolve to a neutral placeholder, and only the founder id re-homes the global file. | active | 2026-07-20 |
| tenant-isolation-factory-functions | `tests/architecture/04-tenant-isolation-factory-functions.test.ts` | 1 | Every D2 factory declares a required `tenantId`, fails loud on missing, and never emits a `tenant_id: ""` literal. | active | 2026-07-20 |
| tenant-isolation-connector-scoping | `tests/architecture/05-tenant-isolation-connector-scoping.test.ts` | 1 | connector-store reads/writes are tenant-filtered and disk-free (Supabase only). (GSC-signal adapter half retired 2026-07-21 with the trigger pipeline.) | active | 2026-07-21 |
| tenant-isolation-scoped-reads | `tests/architecture/06-tenant-isolation-scoped-reads.test.ts` | 1 | No shell or script file performs an unscoped `getRepository().getX()` tenant read outside the allowlist. | active | 2026-07-20 |
| tenant-isolation-cache-keys | `tests/architecture/07-tenant-isolation-cache-keys.test.ts` | 1 | No tenant-blind module-global store cache or process-global tenant pointer; every cache is keyed per tenant and the allowlist has no stale entries. | active | 2026-07-20 |
| tenant-isolation-sync-writers | `tests/architecture/08-tenant-isolation-sync-writers.test.ts` | 1 | Every `sync*` writer either requires a tenantId, stamps `tenant_id` on the row, or targets a table in GLOBAL_TABLES. | active | 2026-07-20 |

## Clause 2 — Authentication and secret boundaries

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| auth-secret-boundaries | `tests/architecture/09-auth-secret-boundaries.test.ts` | 2 | OAuth uses a per-kind scope split with a signed-state roundtrip (GSC vs GBP never conflated), and operator-mode is the sole gate: no production file reads the operator env vars directly and unset resolves to the customer default. | active | 2026-07-20 |
| customer-surface-import-boundary | `tests/architecture/10-customer-surface-import-boundary.test.ts` | 2 | Customer-facing surfaces never import operator-substrate modules (GSC, GA4, repeat-citation, lifecycle-eligibility, off-site), and operator-only modules never import a customer surface. | active | 2026-07-20 |

## Clause 3 — No paid provider calls during render

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| no-paid-llm-on-render | `tests/architecture/11-no-paid-llm-on-render.test.ts` | 3 | No shell page imports an LLM provider or the persist orchestrator; only the allowlisted gateway plus embeddings reach api.openai.com; the provider carries build-time guards; and the cost/llm-budget ledgers have single-writer isolation. | active | 2026-07-20 |
| no-ga4-api-on-render | `tests/architecture/12-no-ga4-api-on-render.test.ts` | 3 | No Today loader or Changes detail page triggers a live GA4 Data API call on render, and Mode A stays a pure, network-free compute with locked sample-size thresholds. | active | 2026-07-20 |
| egress-boundary | `tests/architecture/13-egress-boundary.test.ts` | 3 | Route loaders read observations bounded (never bare loadFreshCanonicalData); page_snapshots is capped and column-projected; the windowed-read API and the large-read alarm are wired end to end. | active | 2026-07-20 |

## Clause 4 — Publishing authority

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| publishing-authority | `tests/architecture/14-publishing-authority.test.ts` | 4 | Manual verified-live overrides check `canPublishForCurrentTenant()` before any tenant work; Mark Shipped refuses `recommended` rows and stamps `verified_live` only, never a verdict. | active | 2026-07-20 |

## Clause 5 — Ready exactness

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| ready-no-uuid-in-recs | `tests/architecture/15-ready-no-uuid-in-recs.test.ts` | 5 | Active recs carry zero raw UUIDs in ship-as-is fields, and the LLM-source UUID-in-why count never rises above its cutover ceiling. | active | 2026-07-20 |
| ready-no-placeholder | `tests/architecture/16-ready-no-placeholder.test.ts` | 5 | Active recommended_edits carry no placeholder phrases, active FAQ rows pass the structural-quality gate, and quarantined placeholder rows are dismissed. | active | 2026-07-20 |

## Clause 6 — Destructive-action safety

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| destructive-indexability-hold | `tests/architecture/18-destructive-indexability-hold.test.ts` | 6 | Every live one-tap accept surface references the isIndexingDirectiveActionType guard, so a crawl/index directive is never one tap from applying with a wrong value. (Loader half retired 2026-07-21 with the trigger pipeline.) | active | 2026-07-21 |

## Clause 7 — Connector and database honesty

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| connector-db-honesty | `tests/architecture/19-connector-db-honesty.test.ts` | 7 | dual-write throws loud on persistent Supabase error regardless of DATA_SOURCE, onConflict targets match the real unique indexes, and robots-state is a per-tenant Supabase mirror with an honest 42P01 soft-fail. | active | 2026-07-20 |

## Clause 8 — Compound-action attribution

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| compound-attribution | `tests/architecture/20-compound-attribution.test.ts` | 8 | The causal chain joins on changelog.source_rec_id, never URL-level coincidence, and the learning score refuses to move ranking on insufficient samples; the analyzer never mutates rows. | active | 2026-07-20 |

## Clause 9 — Immutable measurement

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| immutable-measurement | `tests/architecture/21-immutable-measurement.test.ts` | 9 | NATIVE_REGIME_START is the single canonical measurement boundary (value locked, declared once, no drift), pure-split cross-regime windows abstain, and sampling-guard demotions are logged loud with typed, reused metadata. | active | 2026-07-20 |

## Clause 11 — Fixture isolation

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| fixture-isolation | `tests/architecture/23-fixture-isolation.test.ts` | 11 | reset-test-tenant can never touch the founder tenant and deletes only 3 allowlisted tables (dry-run default), and any test writing a global store must be hermetically isolated so it cannot clobber the operator's real `.data/`. | active | 2026-07-20 |

## Clause 12 — Customer-copy floor

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| customer-copy-floor | `tests/architecture/24-customer-copy-floor.test.ts` | 12 | The one consolidated, parameterized copy-honesty guard: no cron/lab vocabulary, no vendor names, no operator jargon or causal overclaim, no em/en dashes on primary surfaces, and no rendered tenant-name leak in recommendation copy. | active | 2026-07-20 |

## Clause 13 — Catalog-sync mechanism

| name | source test file | clause | purpose (one sentence) | status | last-verified |
|---|---|---|---|---|---|
| catalog-sync | `tests/architecture/25-catalog-sync.test.ts` | 13 | Bidirectional referential integrity between this catalog and the architecture-test directory: every file is cataloged exactly once, every row resolves to a file, counts match, and this sync test has its own row. | active | 2026-07-20 |
