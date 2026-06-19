# Beacon migrations

Plain `.sql` files, **date-prefixed** (`YYYY-MM-DD_name.sql`) so they apply in
lexical = chronological order. Every table uses `create table if not exists` and
indexes use `if not exists`, so the set is **idempotent on a fresh DB** and safe
to re-run (non-idempotent one-off statements may error on an already-populated DB
— that's expected; they're written for a fresh project).

## Applying to a fresh project

One command provisions a fresh Supabase project (reads files at runtime, never
through an agent's context, full per-file logging):

```sh
SUPABASE_ACCESS_TOKEN=sbp_… node scripts/apply-migrations-mgmt-api.mjs <project-ref>
```

Order: `2026-05-08_baseline_schema.sql` first, then every post-baseline file in
filename order. Files beginning with `_` are skipped. (The Supabase MCP
`apply_migration` is the per-file alternative when iterating on one table.)

## Page Surgeon tables (operator-substrate — RLS enabled, NO policies → the
service-role client is the only reader/writer)

| Table | Migration | Purpose |
|-------|-----------|---------|
| `page_surgeon_briefs` | `2026-06-18_page_surgeon_briefs.sql` | One current brief per (tenant, page), keyed by evidence_hash (the cache). |
| `page_surgeon_brief_history` | `2026-06-18_page_surgeon_brief_history.sql` | Append-only: one row per distinct evidence state (how a page's plan evolved). |
| `page_surgeon_review_decisions` | `2026-06-18_page_surgeon_review_decisions.sql` | Append-only Approve/Needs-edit/Reject log, tied to the reviewed evidence_hash. NEVER publishes. |
| `semrush_keyword_expansions` | `2026-06-18_semrush_diagnostic_enrichment.sql` | phrase_related / phrase_questions rows per diagnostic page. |
| `semrush_pull_receipts` | `2026-06-18_semrush_diagnostic_enrichment.sql` | Auditable record of each capped SEMrush pull (units before/after, spend). |
| `semrush_organic_keywords` | `2026-06-12_semrush_organic_keywords.sql` (+ PK widen to include `url` in `2026-06-18_semrush_diagnostic_enrichment.sql`) | Domain organic keyword→URL rows. |

All Page Surgeon code paths are **fail-soft**: a missing table logs a warning and
degrades (the cache/history/review write is skipped) rather than throwing into a
surface, so the app runs before these migrations are applied — but the
corresponding feature stays inert until they are.
