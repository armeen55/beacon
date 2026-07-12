# Beacon Verified State

> 🟢 **Current verified state (2026-07-11, tip = this docs commit; the exact pushed SHA is what
> /api/version must report before this wave is called deployed).** Production is verified through
> the prior correction release at eacd0049. This tip adds the evaluation-claim boundary: Beacon's
> source-visible eight-case suite now identifies itself as `known_case_regression`, never blind
> validation, and the fresh-holdout contract fails closed unless five unseen archetypes prove
> preregistration, prediction before expert-label reveal, no code changes in response, and a pass.
> The blind holdout's three
> product defects now have reviewed release fixes: uncertified pooled verdicts self-hide behind
> their own calibration registry, zero-click Google demand cannot promote an unsupported edit,
> and a proposed new page demotes when an owned page already covers its core topic. Legitimate
> AEO work remains actionable only when separately observed AI-citation evidence supports it. Lane P2's
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
> verdict was persisted. The full gate is GREEN at this tip: strict typecheck, 1,489 test files
> with 23,083 passed / 62 skipped / 0 failed, and the production build.

## Current limitations

- **The verdict quarantine remains in force by design.** The release gate failed honestly, so no
  calibrated verdict may show. The decided board holds 0 trustworthy wins under honest floors.
- **The holdout fixes are not a holdout pass.** Their deterministic regressions are green, but the
  corrected product must face fresh unseen cases. Spent cases cannot certify their own fixes.
- **No fresh blind receipt exists yet.** Diagnostics now says this directly. The contract is built,
  but eligibility stays false until the authenticated hosted run produces valid evidence.
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

1. **Deploy and verify this exact evaluation-boundary SHA** through `/api/version`.
2. **Run 5 fresh preregistered blind cases** through the authenticated deployed UI. A case that causes a code
   change is spent and must be replaced with another unseen case.
3. **Only after the blind gate passes, choose the highest-impact operator move** and take it from
   evidence to approval, publish, hosted verification, and later measurement.

## History

The old stacked "HEAD WILL BE" and "SHIPPED / COMPLETE" chronological banners that used to fill
this file are retired to keep it current and quickly readable. History: see VERIFICATION_LOG.md
for the full dated chronology, and NEXT_PHASE_EXECUTION_PLAN.md for the live priority order.
