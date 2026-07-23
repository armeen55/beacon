# Beacon migrations

SQL migrations are date-prefixed (`YYYY-MM-DD_name.sql`) and applied in lexical order.
Treat the files as historical database truth: do not rewrite an applied migration.

For a new Supabase project, apply the baseline first and then the remaining files in order:

```sh
SUPABASE_ACCESS_TOKEN=… node scripts/apply-migrations-mgmt-api.mjs <project-ref>
```

Use the configured Supabase management connection for individual migrations and verification.
Never print credentials, drop production data, or run an irreversible migration without explicit approval.
