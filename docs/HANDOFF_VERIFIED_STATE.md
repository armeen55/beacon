# Beacon Verified State

> 🟢 **Current verified state (2026-07-12, tip = this docs commit; the exact pushed SHA is what
> /api/version must report before this wave is called deployed).** Production is SHA-verified through
> the tenant-explicit website scan at `199acb0e` (Vercel
> `dpl_5jxepUZ4v4uCPpwSV3VAJdiZrKKJ`). The scan boundary is tenant-explicit: crawl target, child-process domain,
> robots lookup, homepage identity, and finding generation share the current tenant's validated
> business domain and cannot inherit another request's process-wide site identity. This tip also
> makes post-import milestone ownership tenant-explicit and parallelizes its independent evidence
> reads, so an import cannot rank one tenant's competitors against another tenant's owned domain.
> This tip makes live recommendation
> targets tenant-explicit: relative strengthen/investigate URLs resolve only from the current
> tenant origin and otherwise withhold the absolute target instead of borrowing process-global
> identity. This tip also fixes Proposed Briefs for non-local
> tenants: a city-bearing opportunity becomes local coverage expansion only when the current tenant
> is explicitly `local_service`. Content publishers, SaaS, and unknown types receive a neutral
> new-page brief; its schema guidance no longer treats LocalBusiness as a generic default. This tip also removed the attribution candidate registry's
> process-global last-warmed-tenant pointer. Registry and citation-topic evidence are selected by
> explicit tenant ID; active Diagnostics, Review, and History callers thread it; missing context
> yields empty evidence rather than another tenant's pages. The pointer allowlist is now empty.
> This tip also removed process-global site identity from attribution
> URL matching and candidate citation support. Relative URLs use an explicit tenant domain or fail
> closed as unknown; architecture and A→B→A tests pin that B cannot inherit A. This tip also removed process-global site identity from
> evidence-tier classification: relative changelog URLs require an explicit tenant domain and fail
> closed when it is absent, rather than borrowing whichever domain first populated the process.
> This tip continues the explicit site-identity P0
> migration: owned-URL canonicalization and citation-index construction now require the tenant's
> domain explicitly, and legacy domains rewrite only when that tenant supplies the alias. The
> process-global `rfritz.com` → current-domain rewrite and Palo Alto path rewrite are gone, with an
> A→B→A same-process regression proving Iranopedia cannot inherit founder ownership. This tip also removed the global builder ontology from
> the live edit-vs-new page matcher: domain-specific rewrites such as construction→builder,
> renovation→remodel, and architectural→architect no longer affect every tenant. Only universal
> morphology remains by default; curated synonyms must be passed explicitly. This tip also removed another avoidable Today
> first-paint waterfall: import/activity state, connected-source state, and request tenant now
> resolve concurrently inside the compulsory demo/first-reading gate. This tip also closes a reachable legacy-import
> cross-tenant defect: the Settings server action now resolves the authenticated request tenant,
> the importer accepts that tenant explicitly, owned identity comes from that tenant's business
> config, and founder-specific competitor/brand defaults are gone. Because the legacy CSV path uses
> process-local cold files, it now fails closed on Vercel and whenever the request tenant differs
> from the explicitly configured local tenant. This tip also removes Today's post-snapshot sequential
> waterfall: eleven independent command-context reads now run in one bounded parallel batch, with
> unchanged values, fallbacks, tenant scope, ranking, and copy. GA4 reconciliation uses the property's
> reporting calendar end to end: the direct-report window and current/partial month come from the
> stored GA4 timezone, and missing, invalid, conflicting, or changed timezones fail closed. Only the
> Results ledger is awaited before its shell renders; connection health, action packs, finalized
> GSC date, calibration, and operator context share one promise behind streamed boundaries.
> Healthy, degraded, broken, missing fleet/source inventory, and ephemeral-receipt
> fallback no longer collapse into `200 {ok:true}`. Beacon's
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
> verdict was persisted. The full gate is GREEN at this tip: strict typecheck, 1,503 test files
> with 23,128 passed / 62 skipped / 0 failed, and the production build.

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
- **The GA4 property-timezone fix is not yet hosted-data proof.** Its boundary fixtures and source
  path are green; the actual Today totals still require authenticated read-back against GA4.
- **The production receipt history could not be read from this environment.** Direct Supabase DNS
  resolution failed and Vercel returned no historical request logs. The next deployed invocation
  will expose a truthful HTTP class, but that is not evidence the July 12 schedule actually fired.
- **Hosted speed budgets are unproven.** I judge performance on production only, and I have not
  measured authenticated p50/p95 for this tip. Results' initial barrier and Today's additive
  context waterfall are removed at source;
  that is not yet a hosted latency claim.

## Next 3 actions

1. **Continue explicit site identity through remaining active customer paths**, then measure
   authenticated Today and Results first useful paint when a hosted session is available.
2. **Run 5 fresh preregistered blind cases** through the authenticated deployed UI. A case that causes a code
   change is spent and must be replaced with another unseen case.
3. **Only after the blind gate passes, choose the highest-impact operator move** and take it from
   evidence to approval, publish, hosted verification, and later measurement.

## History

The old stacked "HEAD WILL BE" and "SHIPPED / COMPLETE" chronological banners that used to fill
this file are retired to keep it current and quickly readable. History: see VERIFICATION_LOG.md
for the full dated chronology, and NEXT_PHASE_EXECUTION_PLAN.md for the live priority order.
