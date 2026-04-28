# Scheduled Scan — Failure Alarm Rules

> **Phase 5 (2026-04-28)** — operator runbook for `.github/workflows/daily-scan.yml`
> failures. Sister doc to the implicit poll-canary alarm at
> `.github/workflows/poll-canary.yml`.

## What "failure" means

The daily-scan workflow can fail in three distinct ways. Each has a different
diagnosis path.

### Tier A — workflow `failure` (red X in Actions tab)

`runWebsiteScan` returned `ok: false`, OR `scripts/run-scheduled-scan.ts`
exited with code 1 or 2.

Triggers GitHub email to repo collaborators.

**Diagnose:**

1. Open the failing run in the Actions tab; expand the "Run scheduled scan"
   step.
2. Look for the `[scheduled-scan] FATAL` or `[scheduled-scan] uncaught error`
   line — the message includes the underlying cause.
3. Common causes:
   - `BEACON_TENANT_ID is required` / `BEACON_TENANT_SLUG is required` →
     missing repo secret. Add it under Settings → Secrets.
   - `Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL` →
     missing Supabase secret.
   - CLI subprocess timeout (`Scan failed` log with `step: "cli_exec"`) →
     Ritz site timing out. Re-run after a few minutes; if persistent,
     check Ritz status.
   - Stale-running scan recovery (`Scan marked stale`) → the previous run
     never wrote `last-scan-result.json`. Should auto-recover next run; if
     it loops, manually clear `.data/global/scan-state.json` via Supabase
     console (rarely needed).

### Tier B — workflow `success` but `ok=false` returned by route

The route surfaces a non-fatal scan error in its JSON response. The script
still exits 1 → workflow fails (Tier A).

Same diagnosis as Tier A — the `result.error` field carries the explanation.

### Tier C — workflow `success` with `BEACON_SCAN_DISABLED` set

Operator deliberately paused. Script logs:

```
[scheduled-scan] BEACON_SCAN_DISABLED is set — exiting 0 without invoking runWebsiteScan
```

This is NOT an alarm. To resume: unset the secret in Settings → Secrets.

## Silent-failure detection (most dangerous)

The workflow itself succeeds + the script exits 0, but **the scan didn't actually
do what it should have**. Two known silent failure modes:

### Silent A — Lifecycle runner fired but recommended_edits weren't updated

Symptom: scheduled scan runs daily; operator implements an edit on Ritz; days
pass; `/recommendations` still shows it as `accepted`, not `verified_live`.

Diagnose:
1. Check Supabase `recommended_edits` for the rec — `implementation_status`,
   `live_at`, `live_match_confidence` columns.
2. If `implementation_status='accepted'` + `live_at IS NULL`, either:
   - The lifecycle runner is gated OFF (`BEACON_LIFECYCLE_ENABLED` not `"1"`).
     Check repo secrets.
   - The match engine returned `not_found` — the proposed text doesn't match
     any extracted element on the page. Inspect `page_element_inventory` for
     the target URL and look for similar-but-not-identical elements.
3. Run a manual scan locally (`BEACON_LIFECYCLE_ENABLED=1 BEACON_SITE_DOMAIN=ritzbuilders.com
   npx tsx ... scripts/scan-owned-pages.ts`) — observe the match-runner log.

### Silent B — Inventory dual-write succeeded but lifecycle runner didn't fire

Symptom: Supabase `page_element_inventory` rows are fresh (today's date) but
`recommended_edits` lifecycle fields are stale.

Diagnose:
1. Check workflow logs for `[match-runner]` lines. Their absence means the
   lifecycle runner is gated OFF (the orchestrator's hook silently no-ops
   when `BEACON_LIFECYCLE_ENABLED` is not `"1"`).
2. If gated ON but no log lines, check the orchestrator's try/catch fallback
   warning — `Lifecycle match runner failed`.

## Two-strikes rule

If the workflow fails (Tier A) on **two consecutive days**:

1. Disable the cron temporarily: set `BEACON_SCAN_DISABLED=1` in repo secrets.
2. Investigate the underlying cause locally (run `scripts/run-scheduled-scan.ts`
   with the same env vars).
3. Patch + verify locally before re-enabling.

Two consecutive failures means the scheduled scan can't keep up with daily
content changes — `live_at` stamps drift, the 7-day `not_found_after_7d` clock
keeps ticking on edits that may have actually been implemented, and the
operator can't trust the lifecycle status surface.

## Post-incident verification

After ANY workflow failure that's been patched:

1. Manually fire the workflow (Actions → "Daily scheduled scan" → Run workflow).
2. Wait for completion; verify result is green AND scan output looks sensible
   (e.g., `pagesScanned: 35` not `pagesScanned: 0`).
3. Check Supabase to verify a fresh `page_snapshots` row landed (look at
   `fetched_at` for the most recent entry vs. now).
4. Document the incident in `docs/VERIFICATION_LOG.md` with date + cause + fix.

## Vercel-route variant

The `/api/cron/scan` route (Phase 5) mirrors the GH Actions entry's auth +
kill switch. Use cases for the route:

- Local dev manual trigger via `curl -X POST http://localhost:3000/api/cron/scan
  -H "Authorization: Bearer $CRON_SECRET"`.
- Hosted manual trigger AFTER the FS read-only constraint is resolved
  (currently the route fails on Vercel hosted because the CLI subprocess
  can't write to `.data/`).

If the route returns `{status: "disabled"}`, that's the kill switch — same
remediation as Tier C above (unset the env var to resume).
