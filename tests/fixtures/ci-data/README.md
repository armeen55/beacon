# tests/fixtures/ci-data

Minimal synthetic `.data/` fixture used **only** by CI when no
operator-curated `.data/` is present on disk.

## When this fixture is loaded

Loaded by [tests/setup/global-fixture-hydrate.ts](../../setup/global-fixture-hydrate.ts)
(wired into `vitest.config.ts` as a `globalSetup`). The hook checks for
`.data/global/tenants.json` at the repository root:

- **Present** (local dev with the operator's real Ritz `.data/`): hook
  is a no-op. The operator's working copy is never touched.
- **Absent** (CI / fresh checkout): hook copies this fixture tree into
  `.data/`, runs the test suite, then removes `.data/` after teardown.

The same guard ensures running `npm run test` locally with a real
`.data/` never overwrites the operator's data.

## What's in here

- `global/tenants.json` — single founder tenant matching the
  test-suite `BEACON_TENANT_ID = "tenant-ritz-founder"` /
  `BEACON_TENANT_SLUG = "ritz-builders"` env defaults.
- `global/business-config.json` — Ritz operator-curated business
  config (locations, services, FAQ templates). The same values are
  asserted in `src/lib/business-config.test.ts`. Not sensitive — it
  is the public-knowledge brand profile.
- `tenants/ritz-builders/recommended-edits.json` — 5 synthetic
  recommendation rows engineered to exercise the derived-confidence
  rubric (1× needs_review, 2× moderate_evidence, 2× strong_evidence).
  No real operator copy; no UUIDs in operator-visible fields; no
  placeholder phrases.
- `tenants/ritz-builders/imported-results.json` — 1 synthetic Ritz
  row with `tenant_id` set, for the tenant-isolation test.
- `tenants/ritz-builders/imported-changes.json` — 1 row.
- `tenants/ritz-builders/daily-metric-snapshots.json` — 1 row.
- `tenants/ritz-builders/scan-findings.json` — 1 row.
- `tenants/ritz-builders/pages.json` — 1 row.
- `tenants/ritz-builders/change-outcomes.json` — 1 row.
- `tenants/ritz-builders/observation-runs.json` — 1 row.

## What this fixture does NOT contain

- No real operator email, phone, or addresses.
- No real customer or competitor PII.
- No API keys, tokens, or service-role secrets.
- No real recommendation copy (all `proposed_text` / `display_label`
  / `why` strings are short, neutral, and clearly synthetic).
- No real prompt UUIDs or evidence hashes.

## When updating this fixture

Tests that read `.data/` should keep their fixture-mode pass rate at
100% in CI. If a test starts depending on a new file, add a minimal
synthetic row here. Keep rows small — this fixture is not a
mini-database, it is just enough to make tests register and pass.
