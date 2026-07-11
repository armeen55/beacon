# Beacon Verified State

> 🟢 **Current verified state (2026-07-11, tip = this docs commit; its exact SHA is in the push
> receipt in VERIFICATION_LOG.md and is what /api/version reports once the deploy lands).** Main
> now carries the
> verdict quarantine: every stored won or lost verdict reads as uncalibrated through the single
> choke point src/domains/proof-gsc/verdict-calibration.ts (f298bd52 plus the review batch
> b71cd1af; the adversarial review found 16 findings, confirmed all 16, refuted 0, and fixed all
> 12 distinct defects), with the circuit-breaker and revert brakes deliberately left on the raw
> verdicts so safety never depends on the quarantined read. Alongside it on main: cron invocation
> receipts with a started-row deadman and honest Ritz initial-silence (b7b8a523), the /api/version
> deployment-identity endpoint (3543e0d9), a one-line dash-guard test fixup, a precompute
> test-contract fix, and this docs commit. The full hermetic gate is GREEN at this tip; the exact
> numbers are in the 2026-07-11 entry of VERIFICATION_LOG.md.

## Current limitations

- **The deployed SHA is unconfirmed.** This tip is pushed, but its arrival on Vercel production
  stays unconfirmed until /api/version answers on production with this SHA.
- **Every stored proof verdict is quarantined as uncalibrated** pending the corrected classifier.
  The decided board will shrink when the verdicts are reclassified under honest floors.
- **Ritz Google reconnect is pending.** Its data stops 2026-06-26, so the second-tenant proof
  stays cold until the operator reconnects it.
- **Two scheduled refreshes missed their 2026-07-11 slots.** sync-connectors and measure-due left
  no app-side trace for their 2026-07-11 runs; they are under watch, with escalation if they stay
  silent past 2026-07-12 09:39 UTC.
- **Hosted speed budgets are unproven.** I judge performance on production only, and I have not
  measured it for this tip.

## Next 3 actions

1. **Confirm the deployed SHA.** Read /api/version on production, match it to this tip, and pair
   it with the operator's 90-second Vercel cron check.
2. **Proof-model implementation lanes P2 and P3** per the independent validation protocol: the
   predeclaration contract plus the frozen-artifact holdout harness.
3. **Blind holdout benchmark** of 5 preregistered unseen cases, run after code freeze.

## History

The old stacked "HEAD WILL BE" and "SHIPPED / COMPLETE" chronological banners that used to fill
this file are retired to keep it current and quickly readable. History: see VERIFICATION_LOG.md
for the full dated chronology, and NEXT_PHASE_EXECUTION_PLAN.md for the live priority order.
