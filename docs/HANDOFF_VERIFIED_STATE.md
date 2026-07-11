# Beacon Verified State

> 🟢 **Current verified state (2026-07-11, tip = this docs commit; its exact SHA is in the push
> receipt in the 2026-07-11 "Proof-model wave landed" entry of VERIFICATION_LOG.md, and is what
> /api/version reports once the deploy lands).** Main now carries the proof-model wave. Lane P2's
> predeclaration contract is code: the judged metric is frozen at ship, the 28 day window is the
> single primary decision window, the 56 day window is a demote-only helper, 7, 14, and 84 days
> are context-only reads, and the append-only confirmation_reads store ships alongside (both
> migrations applied to prod and verified by read-back: 9 predeclaration columns plus
> confirmation_reads with deny_anon and is_tenant_member RLS). Lane P3's C4 classifier and
> frozen-artifact validation harness are also code, and the full runbook ran on pv-2026-07-11-a.
> The release gate FAILED honestly: no cell clears the false-positive bar because the evaluation
> set is too small, and it is now spent. So the verdict quarantine from the prior wave stays
> exactly as deployed, every stored won or lost verdict still reads as uncalibrated through
> src/domains/proof-gsc/verdict-calibration.ts, CALIBRATED_VERDICT_VERSIONS is still empty, and no
> verdict was persisted. The full hermetic gate is GREEN at this tip; the exact numbers are in that
> VERIFICATION_LOG.md entry.

## Current limitations

- **The verdict quarantine remains in force by design.** The release gate failed honestly, so no
  calibrated verdict may show. The decided board holds 0 trustworthy wins under honest floors.
- **Re-certification is blocked on units, not on method.** A new evaluation set needs roughly 3
  months of fresh calendar as history ages forward, or a pooled-verdict certification design.
- **Ritz Google reconnect is pending.** Its data stops 2026-06-26, so the second-tenant proof
  stays cold until the operator reconnects it.
- **The June GSC Search Console UI comparison is pending.** The stored June total of 3,460 clicks
  needs an operator check against the Search Console UI.
- **The sync-connectors 2026-07-11 gap is under watch.** It left no app-side trace for its
  2026-07-11 run, with escalation if it stays silent past 2026-07-12 09:39 UTC.
- **Hosted speed budgets are unproven.** I judge performance on production only, and I have not
  measured it for this tip.

## Next 3 actions

1. **Pooled-verdict certification design** with independent statistical review: the certification
   path now that single-page changes on this tenant are individually unprovable at honest floors.
2. **Blind holdout benchmark** of 5 preregistered unseen cases, run through the deployed product
   path now that this wave freezes the code.
3. **Operator items:** the 90 second Vercel cron check, the Search Console June comparison against
   3,460 clicks, and the Ritz Google reconnect.

## History

The old stacked "HEAD WILL BE" and "SHIPPED / COMPLETE" chronological banners that used to fill
this file are retired to keep it current and quickly readable. History: see VERIFICATION_LOG.md
for the full dated chronology, and NEXT_PHASE_EXECUTION_PLAN.md for the live priority order.
