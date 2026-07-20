# Beacon Verification Log

> **PURPOSE:** Pure history and proof. Dated entries of what changed, what was tested, and results.
> This file answers: "What did we verify and when?"
>
> **NOT FOR:** What to do next (→ `NEXT_PHASE_EXECUTION_PLAN.md`), current state (→ `HANDOFF_VERIFIED_STATE.md`).

---

> Older entries (before 2026-07-01) are archived verbatim in `docs/archive/VERIFICATION_LOG_2026H1.md`.
> That archive holds first-half-2026 history; this file holds 2026-07-01 onward.

## 2026-07-20 - Unattended truth-and-convergence phase (ed4d7d78, 1bd4dd5e, cebb210c, 95b8c715, 75e6aab3)

Operator-authorized unattended phase, strictly ordered tasks 1 to 6.

Audits run: a signed-in journey audit on a local operator-bypass server (blocked from live numbers
because the local .env.local still points at the dead pre-cutover Supabase project, an
operator-fix item; the outage exposed five database-unreachable honesty defects, all fixed below);
a production surface-blob truth audit (tenant identity CLEAN, the canonical 25 reconciles across
Today, Changes, and Results, the Ritz pause is holding); and a forensic QA of the Iranopedia queue
top items.

Headline defects found and fixed:

1. **The 0 Ready mystery.** About 24 pages had genuine ready_to_review drafts that never surfaced:
   a packet URL-join miss orphaned them and an all-inputs evidence hash invalidated valid copy on
   every rebuild. Drafts now attach by canonical URL, and staleness keys only on copy-invalidating
   fields (page title, action, source query) plus a 14 day age bound. Ready should light up on the
   next on-use rebuild.
2. **Destructive approved redirects.** Two approved redirects (a Tehran page into a city list; a
   product category into one t-shirt) passed the old same-host-only gate. The new deterministic
   gate requires the source to be thin, a demand subset, or a near-duplicate; hubs never redirect
   to a leaf; unsafe plans demote to an internal-link suggestion. Both live items demote on next
   rebuild.
3. **True demand windows.** Card demand claims now state their true 90 day window (a position 9
   claim was a 90 day average; actual current is 20 to 27).
4. **Database-unreachable honesty.** Five lies fixed: the false "Search Console isn't connected",
   the false "Nothing logged yet, assembled just now", a raw vendor error leak, a forever
   "retrying automatically" that now escalates honestly after 4 attempts, and a meaningless error
   reference reframed for support.
5. **Cross-surface convergence.** The unrendered TodayView counts, measuring list, and attention
   fields are deleted so stale divergent numbers can never persist into the customer surface
   again; the phantom movesReady stat is deleted; freshness stamps use the earliest source
   consulted. Investigation proved the 7/0 blob predated the count-unification deploy by 10 hours
   and self-heals.
6. **Architecture-test diet.** 45 duplicated source-scanning tests folded into 7 parameterized
   guard files; tests/architecture went from 214 files / 33,725 lines to 176 files / 29,881 lines
   with every trust invariant kept at exactly one pin.
7. **Canonical docs compacted.** VERIFICATION_LOG 36,722 to 7,428 lines with the first half of
   2026 moved verbatim to docs/archive/VERIFICATION_LOG_2026H1.md; the execution plan 1,751 to
   949 lines with legacy history archived.

Deliberately deferred: briefs slice 2 retirement, GSC query-window reader consolidation, the
ts-prune long tail, master_execution_plan.md compaction (228 KB, out of scope), and the
operator-only item: fix the local .env.local to point at the current Supabase project.

Verification: strict typecheck clean; full suite 20,497 passed / 23 skipped / 0 failed (the suite
runs in about 64 seconds); lint 0 errors / 63 warnings; npm audit 0 vulnerabilities; `git diff
--check` clean; production build passed. Deployed as `dpl_52jeQ4KG84C8F9F9FphGrsma7zAQ`;
production `/api/version` returned the exact SHA; six routes returned their expected 307 login
continuations.

## 2026-07-18 - Autonomous simplification campaign, two phases (349b63f0, e19db90b, 68f7b075; 99b8c1fc)

Operator-authorized campaign run with 5 audit agents plus 12 fix lanes. Two phases pushed.

**Phase 1** (commits `349b63f0` chore: delete dead code, `e19db90b` refactor: retire the legacy
recommendation engine, `68f7b075` fix: honest counts honest states loud failures): net minus
39,666 lines. The import-reachability audit found 173 files with zero production importers,
including whole retired domains, legacy Today v2 components, superseded cost modules, the executed
one-time customer-one backfill migration and its 2,710 line test, and the 1,787 line morning-brief
engine; all deleted. The legacy 2,041 line recommendation engine is retired to an 82 line
extraction. Today's measuring/decided counts now come from the same ledger classifier as Changes
and Results, resolving the 25 vs 7 contradiction (25 whole-tenant is the honest number). The
header refresh chip is now bounded by pipeline progress, so a pass dead at stage zero says cut
short after 15 minutes instead of showing Refreshing 0/8 forever. The Results staleness banner
reads the finalized data watermark rather than the connector sync stamp, fixing an 18-days-old
claim when the real age was 3 days. 26 silent catch blocks feeding rendered numbers now log, and a
failed shock-window read suppresses the lifetime earnings number instead of overstating it.
Deployed and exact-SHA verified: `68f7b075` as `dpl_HAsgMH9d5zFFPQcKexCGHiyVJ3Le`, all 7 routes
returning their expected 307 continuations.

**Phase 2** (collapse the unreachable change-detail body, retire the briefs surface onto Changes,
split on-use connector refresh out of the nightly module; HEAD `99b8c1fc`): net minus 11,792
lines. changes/[id] collapsed to its
redirect (477 to 116 lines) and the orphaned v2 client/loader chain deleted. /briefs,
/briefs/proposed, and /briefs/[id] now redirect to /changes, matching the worklist precedent, with
six orphaned components deleted. On-use connector refresh extracted to
src/lib/connectors/on-use-refresh.ts so the hot path stops importing the 1,544 line nightly
orchestrator. The auto-measure due loop is unified to one core with two thin entry points,
freshness thresholds are consolidated beside SOURCE_SLA, and stale scheduled-cron docstrings are
corrected.

Deliberately not done, deferred on record: the proof-gsc/validation offline study harness is kept
(blind-validation adjacency); GSC query-window reader consolidation deferred (verdict-affecting
math); briefs slice 2 (brief-generation, actions, action-clusters, opportunity-candidates domains
plus the getActionStates/getBriefStates persistence interface and resetExperiment coupling, about
45 files) deferred with a written cascade map; the ts-prune long tail of 335 dead exports
deferred.

Verification: full suite after both phases 21,810 passed / 23 skipped / 0 failed; the suite shrank
by about 1,300 dead tests and runs about 15 seconds faster. Final full gate: lint 0 errors / 63
warnings (down from 74); npm audit 0 vulnerabilities; `git diff --check` clean; production build
passed. Phase 1 deployed as `dpl_HAsgMH9d5zFFPQcKexCGHiyVJ3Le` with exact-SHA verification. Phase
2 deployed as `dpl_6Hpmgce1XojNqGyEUnpWf4QJHcfJ`; production `/api/version` returned
`99b8c1fce827624d02dd2b2092ba418e500a7827`, and all seven routes (`/`, `/today`, `/changes`,
`/results`, `/briefs`, `/worklist`, `/settings/connectors`) returned their 307 login
continuations, confirming the new briefs redirect behaves exactly like worklist.

## 2026-07-18 - Tenant-fallback incident: silent Ritz takeover of a live Iranopedia session, closed (4cd7169a)

Incident: during the operator's live Iranopedia session, /results flipped to Ritz Builders
mid-session, including one mixed render with the Iranopedia header over Ritz staleness data. Root
cause: the middleware tenant_members lookup timed out under Supabase load and the app silently
fell back to BEACON_TENANT_ID (tenant-ritz-founder). Amplifier: the operator account held two
memberships.

Fixes, all live:

1. **Data, applied directly to production Supabase (no deploy needed).** Deleted the operator's
   tenant-ritz-founder membership row, recorded for future restore (user
   465480f5-6419-4bae-a4bd-42f59305ec40, created 2026-06-19 18:20:38 UTC), and set
   tenants.status='paused' for tenant-ritz-founder. Beacon is now single tenant (Iranopedia).
   Ritz data is fully preserved for a future separate account; nothing was deleted beyond the one
   membership row.
2. **Code (commit 4cd7169a).** Authenticated requests can never reach the env fallback; on lookup
   failure the middleware honors the membership-validated beacon_tenant cookie or redirects to
   /login?error=tenant_unavailable; stale cookies naming a non-member tenant are scrubbed on the
   next successful request; the operator bypass validates the cookie against active tenants via an
   edge-safe REST check; new listActiveTenants() is used by all background fan-outs (8 cron
   routes, cron-sync, nightly-aggregate, stalled-signups, tenant-switcher) so the paused tenant
   consumes zero work; the tenant switch action and route reject non-active targets; the
   resolution layer logs loudly if the env fallback is ever reached inside a request.
3. **Tests.** Old tests that pinned the env-fallback leak were rewritten to pin the safe contract;
   five stale fixture files were updated.

Verification: strict typecheck clean; full suite about 1,546 files / 23,113 passed / 23 skipped /
0 failed; production build passed. Commit `4cd7169a` deployed as
`dpl_47ABTKPKwBG5xkJ8fceUf7dfqcfN`; production `/api/version` returned the exact SHA.

## 2026-07-18 - Trust hardening: results contradiction warnings, real on-use autonomy, tenant isolation closure, demo-data gate, copy honesty (a19ba958)

Five areas landed together as one trust-hardening slice.

1. **Results trust.** A new liveContradictionLine in results/trust-receipts.ts renders on any card
   where verified_live is latched true but the latest crawl attempt was not_found or crawl_failed
   with no newer re-confirmation; in production data this fires on 12 of the 25 shipped changes. A
   new LEGACY_MEASUREMENT_CAVEAT renders a directional-read notice on all 25 pre-protocol rows. A
   call-chain audit confirmed every live ship path funnels through recordShippedChange, which
   stamps predeclaredAt, judgedMetric, expectedDirection, and windowPlan, so every NEW ship is
   measured by the predeclared protocol (controlSetIds remain null by design, Lane P3 pending).
2. **On-use autonomy made real.** Removed every (shell) page-level maxDuration=60 override (/,
   onboard x3, diagnostics x3) so all shell routes inherit the layout's 300s; the landing page had
   been killing the roughly 210-second post-response cycle at 60s and leaving a permanent ghost
   "working in background" state. Status modules now treat a "running" receipt older than 15
   minutes as cut short instead of hanging. New table autonomous_run_claims (migration
   migrations/2026-07-18_autonomous_run_claims.sql, applied to production Supabase) gives atomic
   cross-instance mutual exclusion on (tenant_id, day_key), released in finally, fail-soft when
   unreachable. GSC deep-history backfill now continues one 30-day chunk per owned cycle during
   normal use instead of only through the disabled cron path.
3. **Tenant isolation class closure.** Answer-texts moved from a global store to tenant-scoped
   caches with a temporary legacy-flat read fallback; the prompt-library global singleton is
   deleted outright and its last caller (find-wiki-citations) rerouted to tenant-scoped
   tracked_prompts via forTenant; result-mode's module-level mutable visibility rules are removed,
   so Bay Area patterns are founder-tenant-only; unknown store classification now logs loudly
   instead of silently minting a tenant-blind flat cache key; competitor-page-audit write merge
   confirmed already scoped; 8 of 11 flagged bare repository reads verified already isolated via
   the tenant-scoped path layer.
4. **Demo data gate unified.** New shared predicate shouldServeDemoData in src/lib/demo-mode.ts;
   fixtures serve only when founder tenant AND zero imports AND no real connector; the sample-data
   banner uses the same predicate. Closes the live bug where the founder tenant with GSC connected
   got fabricated fixture numbers with the sample-data banner off.
5. **Copy honesty completed.** Every remaining rendered "tonight / last night / overnight /
   nightly" claim removed across war-room, investigation, ops-pipeline, scoreboard,
   daily-experiments, changes list, ask, connectors, and diagnostics surfaces, each with a guard
   test. The false "Continues automatically each night" deep-backfill copy replaced with truthful
   chunked-continue copy, then made true again by item 2's wiring. The dormant, unmounted Autopilot
   overnight card file is deleted; four other verified-zero-production-mount files are deleted
   outright: today-moves-prepare.tsx, team-standup.tsx, autopilot-actions.ts, and their dead action
   chain in today-moves-actions.ts (413 to 217 lines). TonightSummaryChip is renamed
   TodaySummaryChip (it is mounted on /changes); PrepareTonightButton is renamed then deleted with
   its file.

Verification: targeted vitest green per packet (30, 56, 116, 130, 15, 21, 8 tests across the seven
lanes) during development. Final gate before push: strict typecheck clean; full suite 1,544 files /
23,100 passed / 23 skipped / 0 failed; lint 0 errors / 74 pre-existing warnings; production build
passed. Three architecture test pins that drifted (the gsc-no-hardcoded-site-url fixture, the
perf-shell-layout demo predicate pin, and the autonomous-execution-loop extraction marker) were
fixed for the right reasons and pass. The autonomous_run_claims migration was applied to production
Supabase and verified before push (table exists, 0 rows). Six commits were pushed to `origin/main`:
`183f4317` (Results contradiction and legacy caveats), `7b6f5afd` (on-use autonomy coherent,
locked, complete), `7ffe0e77` (cross-tenant leak class closure), `c8471edd` (demo data banner
predicate), `d559fe6e` (copy honesty and dead surface deletion), `a19ba958` (docs). Release HEAD
`a19ba9589f766c43dec79052c4d3316e9fd68519` deployed as `dpl_4eGz8bcz5dZntAJJQhn9GQMwthtR`;
production `/api/version` returned the exact SHA; unauthenticated `/`, `/today`, `/changes`,
`/results`, `/activity`, and `/settings/connectors` all returned their expected 307 login
continuations. No paid call, customer-data mutation, or publish occurred.

## 2026-07-16 - Autonomous Results maintenance + strict unused cleanup (c6b872d9, b23a4cfc)

Removed an obsolete operator-mode gate from the existing passive Results maintenance path. Every
authenticated Results visit may now schedule due proof measurement and bounded live-page
reverification from already-synced data with paid rank rechecks disabled. Manual proof writes,
restore actions, and diagnostics remain separately operator-gated. The scheduler now records its
ten-minute warm-instance throttle only after `after()` registration succeeds, so a registration
failure cannot suppress a later legitimate request. Today and Keywords read failures use automatic
recovery; stale GSC, connector-cron, page-factory, and timed-out research copy describes Beacon's
on-use recovery without asking the user to refresh or sync manually.

The follow-up strict TypeScript audit (`noUnusedLocals` + `noUnusedParameters`) reported 231 lines
across 113 source-tree files before cleanup. A bounded import/local-only batch removed 30 proven
diagnostics across 21 production modules, leaving 201 lines and 97 affected source-tree files.
Function parameters, exported shapes, and ambiguous algorithm inputs were deliberately retained for
caller-by-caller review.

Verification: focused autonomy/recovery suites 62/62; strict typecheck exit 0; ESLint exit 0; full
suite 1,506 files / 22,980 passed / 23 skipped / 0 failed after each coherent wave; production
dependency audit zero; production build exit 0 after each wave with only the protected middleware
filename deprecation. Behavior commit `c6b872d9ca68c17b49341803783d7be2ee77f660` deployed as
`dpl_5Wbr568U9gb6cC8sKKneL9UD1QPG`; all 77 non-dynamic page contracts returned the expected public
200 or protected 307 with zero unexpected statuses. Cleanup commit
`b23a4cfce96a253461db1840f1326ff563e66d6f` deployed as
`dpl_HGeMMdB8PL3UvSAC6PSQqMx8jAUY`; five production version reads returned the exact final SHA and
three representative route passes were correct. Vercel's representative function remains 2.19 MB.
No paid provider call, data mutation, hosted environment mutation, or destructive operation
occurred.

## 2026-07-16 - Autonomous delay recovery and full page-contract sweep (90c3f843)

Converted the shared deadline fallback from a passive “next visit” message into one automatic
router refresh after 1.5 seconds. A per-page timestamp in session storage enforces a 30-second
cooldown, and unavailable browser storage fails calm rather than risking an unbounded loop.
Changes' failed snapshot read and first-ever snapshot-building states now use that same mechanism
and no longer ask the user to refresh manually. No button, cron, provider call, or publishing right
was added.

Verification: focused retry and Changes empty/building suites 6/6; strict typecheck exit 0; ESLint
exit 0; full suite 1,505 files / 22,975 passed / 23 skipped / 0 failed; production dependency audit
zero; production build exit 0 with only the protected middleware-filename deprecation. Product
commits `c2305fd0` and `90c3f843fa9f3d89d1d298a645e01c41395228c5` were pushed to `origin/main`;
Vercel deployment `dpl_85SP949LwuwozpMaEdzMDsd2dMvw` reached Ready with a 2.19 MB representative
function. Five `/api/version` reads returned the exact final SHA and deployment ID. A hosted sweep
of all 77 non-dynamic page routes returned the exact public-200 or protected-307 contract with zero
unexpected statuses, including zero 404s and 500s. No paid call, data mutation, hosted environment
mutation, or destructive operation occurred.

## 2026-07-16 - Retired runtime remnants removed (fc7c980a)

Removed the unreachable synchronous `.data/robots-state.json` implementation and its Node
filesystem imports from the robots parser. The public tenant-explicit repository path is now the
only implementation and the surrounding documentation matches it. Removed one stale type import
and three unused planner locals/destructures that never affected deterministic action selection.

Verification: focused robots-parser and action-planner suites 65/65; strict typecheck exit 0; ESLint
exit 0 with no warnings or errors; full suite 1,504 files / 22,971 passed / 23 skipped / 0 failed;
`npm audit --omit=dev --audit-level=moderate` found zero vulnerabilities; production build exit 0
with only the protected middleware-filename deprecation. Commit
`fc7c980ae381ac98e74be1dba8642c4807f5956d` was pushed to `origin/main`; Vercel deployment
`dpl_6t7ms8gLGTnoQy1LiiCLqWrsL1ZM` reached Ready and retained the 2.18 MB representative function.
Five consecutive `/api/version` reads returned the exact SHA and deployment ID. Three production
route passes returned `/login` 200 and the correct 307 login continuation for `/`, `/today`,
`/changes`, `/results`, `/research/keywords`, and `/settings/connectors`. No paid call, hosted
environment mutation, data mutation, or destructive file operation occurred.

## 2026-07-16 - Production server-artifact boundary (1f3bb082)

Next's dynamic filesystem tracing was packaging nearly the full local repository into every server
route, including `.data/_backups`, 824 tests, 124 docs, 100 scripts, source files, migrations, and
temporary state. Added a universal output-file-tracing exclusion for workstation/runtime-external
material and pinned the boundary with a cataloged architecture invariant. Hosted truth remains
Supabase plus compiled Next chunks; local `.data` is gitignored and must never enter a deployment.

Before/after evidence: worst route manifest about 3,843 → 233 files; aggregate `.nft.json` size about
23 MB → 1.5 MB; `.next/server` 126 MB → 105 MB; local repository references across final manifests
reduced to the intentional root `package.json`; broad Turbopack NFT warnings 2 → 0. Vercel's
representative function fell from 14.02 MB to 2.18 MB. Verification: focused invariant 9/9; strict
typecheck exit 0; full suite 1,504 files / 22,971 passed / 23 skipped / 0 failed; production
dependency audit zero; ESLint error-only gate exit 0; production build exit 0; three local
production-mode route passes and three hosted passes for `/api/version`, `/login`, `/`, `/today`,
`/changes`, `/results`, `/research/keywords`, and `/settings/connectors`. Commit
`1f3bb082a0cac2f56887fdeffa56cb19d75b7318` was pushed to `origin/main`; Vercel deployment
`dpl_EgNF9R1mjis3zwu5LKp7LUD3nW2r` reached Ready and `/api/version` returned the exact SHA. Only the
separate middleware-filename deprecation remains. No paid call, data deletion, or environment
mutation occurred.

## 2026-07-16 - Autonomous customer-loop hardening (0cbbac4d)

Closed the requested parity items 2 and 3 plus defects found during three audit passes. Completed
owned-site crawls now re-queue after seven days through the existing on-visit background cycle, and
unfinished queues advance there too. The compact Changes Not now menu records a fixed dismissal
reason through the canonical response store or performs one accurately labeled one-week snooze; it
no longer offers tomorrow/month labels that persisted the same one-week date. Auto-advance no
longer requires operator mode or claims a replacement draft is ready when only scheduled. Removed
hidden Yelp loading/client state/actions from Connections. Corrected render-time clock access,
command palette state/dependencies, chart render mutation, static imports, and async fail-soft page
boundaries. Upgraded Next to 16.2.10, pinned PostCSS 8.5.19, and removed unused vulnerable xlsx.

Verification: focused autonomous/tenant/extractor gate 98/98; focused connector gate 34/34;
stale-crawl/dismissal gate 34/34; strict typecheck exit 0; ESLint error-only gate exit 0; first
complete suite 1,502 files / 22,960 passed / 23 skipped; final complete suite 1,503 files / 22,962
passed / 23 skipped / 0 failed; `npm audit --omit=dev --audit-level=moderate` found zero
vulnerabilities; production build exit 0. The build retains two broad Turbopack NFT trace warnings
and the protected middleware-filename deprecation warning. Commit `0cbbac4d1bfedd4c06649a6b656927031795c56c`
was pushed to `origin/main`; Vercel deployment `dpl_6XDXDaeiEUtJWFnRp2JRLXNggRVy` reached Ready;
production `/api/version` returned the exact SHA. Three consecutive production requests verified
`/login` 200 and the expected 307 login continuation for `/`, `/today`, `/changes`, `/results`,
`/research/keywords`, and `/settings/connectors`. No paid provider call, data deletion, or hosted
environment mutation was performed.

## 2026-07-14 - Customer journey exits legacy diagnostics (940a2e40)

Authenticated product use exposed a category error: old operator routes rendered inside the normal
Beacon shell and instructed the user to run local TypeScript scripts, read on-disk reports, set
environment configuration, or interpret empty internal forensics. A normal SaaS user should never
be responsible for those operations, and the canonical autonomous state already lives in Today,
Changes, Results, and the global shell receipt.

The diagnostics index and filesystem-backed brain page now return users to Today; spike forensics
returns users to Results; and the old action-pack allocator dump returns users to the canonical
Changes list. Today's overflow link for new-page opportunities also stays inside Changes rather than
opening rank-revenue diagnostics. The legacy engineering implementations remain present, avoiding
an unapproved destructive deletion, but they are no longer terminal customer workflows. No button,
cron, environment change, paid call, or second product surface was added. A new architecture
invariant pins all four redirects and the customer link, and its catalog entry is synchronized.

Verification: focused route/invariant suites 19/19; strict typecheck exit 0; full suite 1,496 files
passed, 22,893 tests passed, 23 skipped, 0 failed in 87.31 seconds; production build exit 0. Build
emitted two pre-existing broad Turbopack NFT trace warnings and the existing middleware deprecation
warning. Product commit `940a2e40` and documentation tip `94ac32f4` were pushed to `origin/main`;
Vercel deployment `dpl_66ydvpq8Rydr867C6ioZSQRkcDPK` reached Ready; production `/api/version`
returned exact tip SHA `94ac32f4d43cf8a661f1b3e10225f9611bc7598d`; `/login` returned 200;
and unauthenticated protected-route requests reached their expected login continuations. The four
signed-in redirects still require one authenticated browser read-back, so no visual claim is made.

## 2026-07-14 - P0 recommendation-surface tenant isolation (dfa8ff8a)

Authenticated operator evidence showed a coherent Iranopedia Today page and tenant header, but the
Iranopedia Changes page ranked Ritz construction queries. This was not a labeling defect. The
tenant-explicit Changes background builder called ambient worklist and new-page loaders; the
worklist in turn called ambient Today-move and competitor-audit readers. Outside request context,
those dependencies selected the process-default Ritz tenant, and the resulting Ritz-derived list
was persisted under Iranopedia's correctly scoped Changes snapshot key.

The rebuild now passes its explicit tenant through the Changes surface, worklist, Today-move,
new-page, and competitor-audit paths. Tenant business configuration is hydrated from Supabase before
falling back to synchronous local configuration. Changes and worklist snapshots now persist the
requested tenant ID and explicit reads reject legacy snapshots with no identity as well as mismatched
snapshots, forcing a clean rebuild instead of serving potentially contaminated data. The worklist
also applies a last-line owned-domain guard to absolute edit targets while preserving relative URLs
and legitimate new-page moves. Regression coverage pins A/B competitor-audit reads, source wiring,
snapshot rejection/identity writes, and the domain guard.

Verification: strict typecheck exit 0; full suite 1,495 files passed, 22,888 tests passed, 23 skipped,
0 failed in 89.21 seconds; production build exit 0. Build emitted the three pre-existing broad
Turbopack NFT trace warnings and existing middleware deprecation warning. Product commit
`dfa8ff8a1549cda3fd4d8bd1290357cb14573e4f` pushed to `origin/main`; Vercel deployment
`dpl_A9CEmJDPbQcWn2YNh3sErzjRkVs4` reached Ready; production `/api/version` returned that exact SHA;
`/login` returned 200; unauthenticated `/changes` returned the expected 307 to login. Authenticated
post-fix Iranopedia list verification is still pending, so no corrected-data claim is made yet.

## 2026-07-14 - Final candidate keyword-demand completion (287d7c3a)

Closed the last same-cycle demand seam before final ranking. Earlier enrichment measured an initial
shortlist, but a newly discovered native AEO or SERP-steal candidate could enter the final allocator
without exact keyword volume. Because unsized create-page candidates then shared the same fallback
score, materially different demand could collapse to effort or ID order.

The autonomous visit runner now performs one fail-soft `final-keyword-demand` step after native AEO
teardown and before final surfaces/fusion. It prioritizes AEO gaps, SERP steals, then graph move
labels; normalizes and deduplicates exact queries; removes fresh 14-day cache hits; caps the pool at
25; and calls the existing DataForSEO keyword-volume runner at most once. That runner retains its
configured/dry-run/cache/spend-ledger/monthly-cap fail-closed gauntlet. The refreshed keyword library
then attaches exact volume across worklist, AEO, steal, and keyword-library lanes before the single
allocator pass. Volume breaks only an otherwise-equal tie when both candidates have no expected-
value bounds; sized opportunities retain the existing effort tiebreak. No forecast is inferred from
volume. The autonomous status receipt reports actually checked final terms.

Verification: focused final-demand/allocator/autonomy/status suites 57/57; strict typecheck exit 0;
full suite 1,494 files passed, 22,880 tests passed, 23 skipped, 0 failed in 86.25 seconds; production
build exit 0. Build emitted three pre-existing broad NFT trace warnings and the existing middleware
deprecation warning. Product commit `287d7c3a8663d8a7e22d177909c1e2f4b99004c8` pushed to
`origin/main`; Vercel deployment `dpl_5KTG1sFoYjVxSoPiSV7maNDC9dWi` reached Ready; production
`/api/version` returned that exact SHA; `/login` returned 200; `/changes` returned the expected 307
to `/login?next=%2Fchanges`. Authenticated tenant-data inspection remains pending; no such claim is
made.

## 2026-07-14 - Final live-winner + native AEO convergence (06644b31)

Closed two evidence-loss seams in the autonomous research path. First, native AI polling already
selected and tore down up to five cited winner pages per prompt, but its persisted gap verdict
dropped the winner URLs, per-answer citation counts, exact native questions, related fanouts, and
the structural consensus. The verdict and unified allocator now retain that complete AEO receipt;
ResearchDossier and EvidencePacket use it for competitor references, outline headings, schema,
answer shape, and opening pattern before the one PreparedMove is drafted.

Second, exact final-ranked moves already received a live Google winnability check, but Beacon threw
away the organic winner URLs and page facts before drafting, and final-ranked create-page moves did
not get the same autonomous check. Preparation now researches the exact top order first through the
existing DataForSEO gauntlet, adds up to two relevant organic winners per query, tears them down
through the existing polite 14-day cache, recompiles both graph-backed and allocator-only packets
with those facts, then drafts in the unchanged allocator order. Create-page rejects are held before
LLM spend. Google/AI overlap remains honest: a page found by the current Google read is not counted
as independent AI confirmation. The durable receipt and global status line report successfully
analyzed final Google winners. No UI control, cron, second ranker, render-time call, or publish path
was added.

Verification: 11 focused files / 118 passed; strict typecheck exit 0; full suite 1,493 files passed,
22,874 tests passed, 23 skipped, 0 failed in 61.46 seconds; production build exit 0. Build emitted
three pre-existing broad NFT trace warnings and the existing middleware deprecation warning.
Product commit `06644b31` pushed to `origin/main`; Vercel deployment
`dpl_54nD1Pt4nucC8NQXxm8vMeUMRoe3` reached Ready; production `/api/version` returned exact SHA
`06644b312642dac62a956731db4580018344c46e`; `/login` returned 200; `/changes` returned the expected
307 to `/login?next=%2Fchanges`. Authenticated data-backed inspection remains pending because the
in-app browser bootstrap could not attach in this environment; no authenticated UI or tenant-data
claim is made.

## 2026-07-14 - Unified ranked preparation release (4191a90d)

Closed the remaining structural split between the final Changes allocator and preparation. The
server-side Changes snapshot now retains a compact projection of its final actionable order and
strips it before client serialization. Worklist, AEO citation-gap, SERP-steal, and keyword-library
winners therefore enter one EvidencePacket/PreparedMove path in the exact order the operator sees,
without a second score or queue. Allocator-only packets preserve the real query, lane instruction,
competitor URL, fanout questions, and monthly GSC/search-volume evidence, then join the existing
cached ResearchDossier and winner teardown. Search volume has its own honest evidence basis rather
than being labeled as GSC or AI attention. Autonomous completion, overnight prepare-ahead,
post-ship auto-advance, and explicit preparation all read the same ranked snapshot. No UI control,
cron, network producer, render-time paid call, or publishing behavior was added.

Verification: focused allocator/payload/evidence/preparation suites 70/70; strict typecheck exit 0;
full suite 1,490 files passed, 22,865 tests passed, 23 skipped, 0 failed; production build exit 0.
Build emitted three pre-existing Turbopack NFT trace warnings and the existing middleware deprecation
warning. Deployment receipt: `4191a90df21a4fb2818f6ba292b858d06de17407` pushed to
`origin/main`; Vercel deployment `dpl_2wBB3xVAb3JYVEEaw7k2yJ5f79NL` reached Ready; production
`/api/version` returned that exact SHA; `/login` returned 200; `/changes` returned the expected 307
to `/login?next=%2Fchanges`. Authenticated data-backed inspection remains pending.

## 2026-07-14 - Autonomous clarity + GSC query convergence (d6dcb0c7)

The first dream-state convergence slice closes a real evidence-loss defect: the graph already loaded
each owned page's top GSC queries, but EvidencePacket replaced them with an empty list. Tenant-explicit
query text and impression weights now survive graph compilation into the packet, the intent veto, the
prepared pack, and structured drafting. Create-page/cold-start moves retain the prior graph/fanout
fallback. Evidence hashes use ten-point query-share buckets, so a tiny rolling-window count change does
not trigger paid re-drafting while a material intent shift still invalidates the pack.

The durable on-visit receipt now also powers one quiet header state across every signed-in page:
researching, moves ready, partially refreshed, or up to date. This adds no button, new scheduler, cron,
provider call, or publishing path. The Today detail line reuses the same domain presenter. The unified
allocator's formerly ambient keyword-library read now calls the existing tenant-explicit reader.

Verification: strict typecheck exit 0; focused gate 7 files / 89 passed / 0 failed; complete Vitest gate
1,489 files / 22,855 passed / 23 intentional conditional skips / 0 failed in 83.65 seconds; production
build exit 0 outside the sandbox. The first sandbox build failed only because Turbopack could not bind
its internal local port (`Operation not permitted`); the unrestricted rerun compiled successfully,
finished TypeScript, generated all static pages, and finalized every route. Two pre-existing broad NFT
trace warnings remain. No production data, paid API, environment variable, or publish action was used.
The four-commit stack pushed `96e137ab..d6dcb0c7` to `origin/main`. Vercel deployment
`dpl_6x3xjQVMjS4dyswTbjKVujMpJNxz` reached production and `/api/version` returned the exact full SHA
`d6dcb0c7009c52fff3f95cde2912c85865b38cf3`; `/login` returned 200 and `/changes` returned the
expected 307 redirect to `/login?next=%2Fchanges`. Authenticated receipt/header inspection did not run:
the in-app browser bootstrap failed before tab attachment with a runtime property conflict. This is an
environment limitation, not hosted UI proof; no authenticated claim is made.

## 2026-07-13 - Autonomous research-before-ranking MVP + cleanup wave (partially pushed; next release pending)

Beacon's disconnected manual/nightly research pieces are now composed into one post-response,
tenant-explicit daily pass scheduled from the signed-in shell. The causal order is evidence first,
then final graph fusion and ranking, capped preparation, and Today snapshot last. It includes stale
connector pulls, top-12 winner teardown, top-three competitor DataForSEO Labs keyword mining and
clone briefs, top-five research-pack keyword/SERP enrichment, AI-citation topics, the merged
GSC/fanout/PAA question universe, factual claim conflicts, internal PageRank/orphans, displacement,
striking-distance SERP steals, and native-citation commonality. Existing provider dry-run, cache,
ledger, breaker, and spend caps remain the only paid-call path; publishing is never invoked.

Verification so far: strict typecheck exit 0; 49 focused autonomy/ordering/tenant-receipt/cron tests
green; full pre-cleanup suite 1,505 files, 23,132 passed, 62 skipped, 0 failed in 239.14 seconds.
Five mixed legacy suites then had only their obsolete skipped blocks removed; their remaining 73/73
assertions are green and 22 obsolete skips are gone. An isolated CI-clean copy proved four-worker
file parallelism with all 1,505 files / 23,132 passed / 40 remaining conditional skips / 0 failed
in 77.10 seconds; the real checkout repeated the green gate in 74.47 seconds, versus 239.14 seconds
serial.

The autonomous scheduler and first suite-cleanup commits are pushed as `ce4d4345` and `96e137ab`.
The next local wave adds the tenant question universe's multi-engine poll to the same visit cycle,
uses a five-call native concurrency pool while keeping DataForSEO engines sequential for ordered
budget accounting, includes engine spend in the receipt, and distinguishes `already_ran` from zero
work. A reviewed deletion batch removes 60 unreachable/test-only files and about 5,550 lines; no
surviving production import references a deleted module and core safety suites remain. The complete
post-deletion gate is strict typecheck exit 0 plus 1,488 files / 22,849 passed / 23 intentional
conditional skips / 0 failed in 118.68 seconds. The focused post-poll gate is 21/21.

The production build also completed successfully outside the filesystem sandbox before the final
AI-poll hardening (the first attempt
failed only because Turbopack could not bind its internal local port under sandbox policy). Three
pre-existing broad NFT trace warnings remain; route generation and TypeScript both completed.
No production data, environment variable, paid provider, or Wix publish was used. Final combined
build, commit, push, Vercel SHA verification, and authenticated visit receipts remain pending.

## 2026-07-13 - Test-suite bloat audit + accidental-network fix (eef191db, b66ae0c1)

The maximum audit measured 1,503 files / 23,192 tests, about 322,000 test lines versus about
379,000 production TypeScript lines, 360 source-reading test files containing 4,273 statically
collected cases, 62 skipped tests, and 257 strict unused-declaration findings (210 source, 21 scripts,
26 tests). Static runtime reachability identified 44 apparently orphaned production files (about
4,360 lines), 103 files reachable only from tests (about 21,042 lines), 23 offline validation/script
files, and one script-only file. These are candidates for bounded deletion, not a claim that every
file is safe to remove; computed imports remain the principal residual.

Runtime profiling found one concrete defect: eleven unrelated onboarding launch tests used the real
default first-scan path and each waited about six seconds on a bounded crawl. The test harness now
defaults the existing injectable dispatcher to a successful no-network outcome; scan-specific tests
still supply their own dispatcher and crawler. Focused result: 33/33, 17ms test-body time. Clean full
gate: strict typecheck exit 0; 1,503 files, 23,130 passed, 62 skipped, 0 failed; suite duration 234.91s
versus 308.95s before (74.04s / 24% faster); production build exit 0. No product behavior changed.
`origin/main` reached `b66ae0c1`; Vercel deployment `dpl_3Sdb2dsjJdL78UGjt4Bb3i8DCTda` reached
Ready and production `/api/version` returned the exact SHA; `/login` returned 200.

## 2026-07-13 - Research-to-draft orchestration connected (a2c60e85, 004e2694)

The `/changes` one-click plan builder now executes the existing dream-state components in the
order its UI already promised: competitor winner teardown, keyword/SERP enrichment, top-move
preparation, then competitor-grounded regeneration. Before this change, the command never invoked
the teardown producer, so a cold topic could reach drafting with no competitor evidence and the
final regeneration step could have nothing to use. The action is fail-soft per external step and
reports total analyzed winner pages separately from pages freshly fetched, so cache hits are never
described as fresh research.

Verification in the clean `codex-high-impact-integration` worktree: strict typecheck exit 0; focused
orchestration suite 14/14; full Vitest gate 1,503 files, 23,130 passed, 62 skipped, 0 failed; Next.js
production build exit 0. No paid research run, Wix write, publish, or tenant data mutation was used
to prove the orchestration contract. `origin/main` reached `004e2694`; production `/api/version`
returned that exact SHA and deployment `dpl_AkWz6reNCUREHgnrtWjv737Ajhe6`; `/login` returned 200 and
`/changes` returned the expected 307 auth redirect to `/login?next=%2Fchanges`.

## 2026-07-11 - Lane P3: C4 classifier + frozen-artifact validation harness executed (uncommitted, operator gate pending)

Run id pv-2026-07-11-a on tenant-iranopedia, per scratchpad/proof-validation-protocol.md
(conditions C1 to C12 binding) and the Lane P3 packet. Repo code:
src/domains/proof-gsc/validation/ (pure modules: series index, matched controls on
pre-treatment scale/variance/trend with predeclared alternates and NO fallback, variance
stabilized log-lift clicks statistic, CTR absolute diff-in-diff with missing-rate guards,
matched-null block-placed permutation gate that gates the VERDICT, floors with LOO widening,
placebo set design, injection suite, old-classifier baseline, ledger reclassify with reason
codes) plus scripts/proof-validation/step0 to step10. Verified: npm run typecheck green,
31 vitest tests green (src/domains/proof-gsc/validation/). NOTHING committed, NOTHING
persisted to any store, CALIBRATED_VERDICT_VERSIONS untouched (still empty).

Snapshot: 78,567 finalized page-day rows, 2025-03-15 to 2026-07-07 (D=480), 25 ledger rows;
manifest sha256 in scratchpad/proofval/snapshot-pv-2026-07-11-a/manifest.json. Frozen
classifier locked at sha256 6d6e082ba01edc38a028daa56bf5e4ebfe7b1210afc632ead48c7c2a60abe0a2.

Headline numbers. OLD deployed classifier on 119 fresh calibration placebo units: 69.7
percent FPR (random pages 66.7, engine-mimicking decliners 82.6, medium tier 90.0).
C4 HELD-OUT evaluation (touched once): random lane point FPR 0 to 10 percent per cell but
the C3 release gate FAILED everywhere; at n around 20 judged units per cell even zero hits
gives a Wilson upper of 16 percent, above the 12 percent bar, and the shadow lane never
reached 20 units. THE EVALUATION SET IS SPENT (protocol step 12): certification needs new
calendar (history aging forward) or new pages. Injection suite: zero detection at every
lift to +50 percent under the calibrated floors; single-page changes on this tenant are
individually unprovable at realistic effect sizes; pooling is the path. Ledger: all 25 rows
render MEASURING under the single 28 day primary window (none closed at watermark
2026-07-07); at the 7 day context read, 0 of the 12 old decided verdicts survive C4; 6 rows
are crawl_not_found including 2 stored wins (NOT_VERIFIED_LIVE). C4 does not release; no
version registered.

---

## 2026-07-11 - Proof-model wave landed: predeclaration contract + C4 validation (250e136d, 48a5857f)

Lane P2 landed (250e136d). The predeclaration contract is now code: the judged metric is frozen
at ship, the 28 day window is the single primary decision window, the 56 day window is a
demote-only helper (a won that did not hold demotes, it never upgrades), and 7, 14, and 84 days
are context-only reads that never write the verdict enum. The append-only confirmation_reads
store ships alongside. Both migrations were applied to prod by the architect through the
management connection and verified by read-back: 9 predeclaration columns on the proof record,
and the confirmation_reads table with deny_anon and is_tenant_member RLS.

Lane P3 landed (48a5857f). The C4 classifier and the frozen-artifact validation harness are in
the tree, and the full runbook executed on run pv-2026-07-11-a. Validation headline receipts:
the old classifier fired won or lost on 69.7 percent of 119 fresh placebo units (Wilson 61.0 to
77.3), and 82.6 percent on engine-mimicked decliners. C4 held-out false-positive rate per cell
lands 0 to 10 percent points, but no cell passes the release gate (point at or under 5 percent
AND 95 percent upper bound at or under 12 percent) because 20 units per cell cannot push the
upper bound under 16 percent. The evaluation set is SPENT per the protocol. The minimum
detectable effect exceeds 50 percent in every cell, so single-page changes on this tenant are
individually unprovable at honest floors, and pooled verdicts are the certification path. All 25
decided ledger rows reclassify to measuring under the predeclared 28 day clock (earliest close
2026-07-18): 23 have insufficient history, and 2 are not verified live (the stored wins on
caspian-red-deer and persian-horned-viper describe changes the crawler cannot find on the live
pages). At the 7 day context read, 0 of 12 old decided verdicts survive. Sensitivity: 1 of 115
unit-lanes flips class under control jackknife, and 4.7 percent flip under alternate control
sets.

CALIBRATED_VERDICT_VERSIONS remains empty, no verdict was persisted, and the quarantine stays
exactly as deployed.

Full hermetic gate at the assembled tip (fullgate-integration2.log): typecheck exit 0, test exit
0, build exit 0. Vitest summary: 1486 test files passed (1486), 23026 tests passed and 62 skipped
of 23088, 0 failed. No semantic fixes were needed; the widened ProofWindowDay union (7, 14, 28,
56, 84) did not break the P3 validation modules.

---

## 2026-07-11 - Binding operator decision: verdict quarantine, cron receipts, /api/version landed (b7b8a523, 3543e0d9, f298bd52, b71cd1af)

BINDING OPERATOR DECISION received and recorded on three fronts: proof truth, deployment closure,
and blind validation. This push assembles four reviewed commits onto main plus a dash-guard
fixup, a precompute test-contract fix, and this docs commit.

**Commits assembled (reviewed, cherry-picked in order).** Cron invocation receipts with the
started-row deadman pattern and honest initial-silence escalation (b7b8a523); the /api/version
deployment-identity endpoint (3543e0d9); the fail-closed quarantine of uncalibrated verdicts
(f298bd52); the quarantine review batch closing 12 confirmed gaps (b71cd1af). Plus a one-line
dash-guard test rewritten to unicode escapes for the repo grep-clean rule, and a precompute test
mock migrated to the started-row receipt contract (the cron-receipts commit swapped precompute's
route from recordCronRun to beginCronRun and finishCronRun; the pre-existing test mock still
exported only recordCronRun, so I aligned the test to the new contract and never reverted the
receipts).

**Verdict quarantine landed (f298bd52 plus review batch b71cd1af).** Every stored won or lost
verdict now reads as uncalibrated through the single choke point
src/domains/proof-gsc/verdict-calibration.ts, across learning, ranking, and display. The
adversarial review found 16 findings, confirmed all 16, refuted 0, and the 12 distinct defects
behind them are all fixed. The protective brakes, the circuit breaker and the revert path,
deliberately stay on the raw verdicts, so safety never depends on the quarantined read.

**Cron invocation receipts, /api/version, honest Ritz initial-silence landed (b7b8a523,
3543e0d9).** Cron receipts write a started row the moment a job is invoked, so the stall alarm
can tell a job Vercel never fired from one that died mid-run. /api/version reports the deployed
identity so the pushed SHA can be confirmed on production. Ritz initial-silence is reported
honestly rather than dressed up as activity.

**Migrations APPLIED to prod by the architect via the management connection and verified by
read-back.** cron_runs.phase (default finished, partial index) and
shipped_change_proof.calibration_version (null means uncalibrated) are both live on production
and confirmed by reading them back.

**GSC 16-month backfill executed and verified.** tenant-iranopedia now holds 480 continuous days
from 2025-03-15 to 2026-07-07: 480 rows on gsc_daily_totals and 78,567 rows on
gsc_daily_page_totals. 413 days were added, 0 dates failed, and the run took 297 seconds.

**June GSC reconciliation receipt.** The stored June total is 3,460 clicks and 251,274
impressions, from property https://www.iranopedia.com/, web search type, final data only, 30 of
30 days final, a single property, on Pacific dates. The Search Console UI comparison is pending
the operator.

**Refresh-run diagnosis (2026-07-11).** sync-connectors (09:00 UTC) and measure-due (09:30 UTC)
left zero app-side trace, while publish-canary, autopilot, and precompute ran. Their durations
rule out the 300 second ceiling. The ledger rows were written end-of-run only, so I could not
tell a never-invoked job from one that died mid-run; the new started-receipts close exactly that
gap. The decisive evidence for 07-11 remains the Vercel dashboard cron log.

**Independent statistical validation protocol delivered** (scratchpad
proof-validation-protocol.md). The C4 direction is approved with 12 binding conditions: the
reported false-positive rates are voided as same-sample evidence; the decision uses a single
28-day primary decision window with a demote-only 56-day confirmation; the rules are hash-locked
and frozen; the evaluation set is touched once; a spent holdout may not be reused.

**Full hermetic gate at the assembled tip (fullgate-integration.log).** typecheck exit 0, test
exit 0, build exit 0. Vitest summary: 1481 test files passed (1481), 22962 tests passed and 62
skipped of 23024, 0 failed. This is the clean re-run after the precompute test-contract fix; the
first pass at the pre-fix tip flagged 9 legacy precompute mock assertions that still expected the
old recordCronRun call, and I aligned those tests to the started-row receipt contract rather than
revert the receipts.

**Deployment status.** Pushed. The deployed SHA is unconfirmed until /api/version answers on
production.

## 2026-07-11 - Hygiene batch: trap detection, tenant-explicit SWR writes, dash sweep (0e8d2395, 38e0ce9c, 02cf2374)

2026-07-11 hygiene batch (3 commits on 0e8d2395, 38e0ce9c, 02cf2374, rebased onto 2ebd45d4): (1)
Zero-click and image-intent trap detection: a clicks-tone move whose top query sits at position
<=5 with >=500 impressions and CTR under 0.2 percent decides watch with the honest reason (People
see this in results but almost nobody clicks that kind of search...) via the existing flagged
path; the iran-flags and asiatic-cheetah traps from the pilot now file as watch. (2) The
ambient-tenant after() write bug existed in FOUR sibling SWR stores (worklist, today, results,
graph-snapshot) plus a zero-arg refreshToday in warm-caches; all now thread explicit tenantId with
two-tenant pins. (3) Operator-visible dash sweep: build-canonical-changes plus six core copy
modules fixed; remaining ~1272 non-rendered candidates filed as a background task. Gate GREEN at
the rebased tip (fullgateHY.log: typecheck exit 0, test exit 0 - 1472 test files passed, 22788
tests passed / 62 skipped of 22850, build exit 0). First hermetic pass raced against a stray
concurrent invocation of the same command in the same worktree and was discarded honestly
(different pass counts, 22785 vs 22788, proved cross-contamination); this is the clean isolated
re-run, verified single-process for its full duration.

## 2026-07-11 - Pilot loop 6: no-new-numbers retry reminder, the drafter cycle closes (3232d280)

2026-07-11 pilot loop 6 (3232d280), the drafter cycle closes: no-new-numbers reminder on all
three rephrase-class retries (draft.answer_block v6). Live re-runs: the model now reliably writes
one-fact-per-sentence roundups with real facts; classifications honest (too_thin at 76 words;
needs_source_check with the blocked-Britannica copy); nothing unprovable shipped. CYCLE VERDICT:
paste-ready not achieved this cycle; the fail-closed states with honest operator copy are the
designed fallback. Two filed residuals: model-class length/phrasing variance, and a genuine defect
found in closing: the generation-time invented-numbers firewall scans the draft's own
proofPlan/operatorSteps methodology text (both live attempt-1s died on the model's own target 100
percent line); drafter last mile 2 scoped the downstream gate but not the generation-time check.
That firewall-scope fix is the FIRST item of the next drafter batch. Gate 22759 passed 0 failed.

## 2026-07-11 - Pilot loop 5: one-fact-per-sentence guidance + merged retry instruction (009ef67b)

2026-07-11 pilot loop 5 (009ef67b): one-fact-per-sentence guidance for entity-rich
roundups (each claim stated in its own verifiable sentence, added length reached
via more single-fact sentences, never longer compound ones) plus a merged
too-thin/superlative retry instruction (verification now runs before the too-thin
decision is acted on, one combined instruction fires when both problems hit the
same attempt, single-error retry paths stay byte-identical to the pre-existing
instructions, at most 2 attempts total, fail closed after). draft.answer_block
bumped to prompt-registry v5. Live re-run: 2 real gpt-5-mini runs, both failed
closed on model-class variance (a non-JSON/oversized-field hiccup on one run; a
new invented 100 percent caught by the numeric firewall during the superlative
rephrase retry on the other) - every gate behaved correctly and nothing
unprovable shipped. Residual is model variance, not a gate gap. Next lever:
a no-new-numbers reminder on the rephrase retry instructions.

## 2026-07-11 - Pilot loop 4: entity-reference source guidance shipped (5b655cb5)

2026-07-11 pilot loop 4 (5b655cb5): entity-reference source guidance shipped. Live proof across 3
real drafter runs: all 9 citations chose per-singer Wikipedia biography pages, zero list-index
cites (the loop-3 gap, fully closed); honor facts confirmed verbatim on the fetched bio pages.
Evidence hints thread already-loaded citation URLs into the prompt (zero new fetches, list/index
URLs filtered, empty hint skipped honestly). Superlative rephrase retry hardened (never introduces
a NEW superlative; too-thin retry adds grounded facts only). Honest verdict: not yet paste-ready;
two newly isolated blockers for loop 5: compound sentences bundling a covered honor fact with an
uncovered song-title fact fail whole (fix = one-fact-per-sentence prompt guidance, no gate
change), and the too-thin plus superlative retries share one budget slot (fix = merged retry
instruction, no extra LLM spend). Gate 22749 passed 0 failed.

## 2026-07-11 - Drafter last mile 2: numeric firewall prose scope, roundup full-text coverage live (ffc39807)

2026-07-11 drafter last mile 2 (ffc39807): pilot re-run gap closed. Numeric firewall now scans
PROSE only, never the sources citation array (the re-run killer, a retrievedAt date flagged as an
invented number, is gone; no laundering: a prose number matching only a citation date still
fails). Roundup full-text coverage wired into production verification: a fetchable authoritative
page verifies by full-text entailment when its excerpt does not span-match, one page can back
multiple roundup sentences (proven live: a real Wikipedia bio page covered 3 of 6 sentences in one
run), fetchedText stays transient (stripped at the persist choke point). Multi-source rule: a
fully covered draft is never held hostage by an additional robots-blocked citation (it notes the
blocked source and stays ready); needs_source_check still holds when coverage genuinely fails.
Third pilot re-run verdict, honest: the mechanical blockers are gone; the remaining hold is
correct behavior (an ungrounded superlative refused; a bare list-index page cannot entail
biographical facts). Next bounded iteration = evidence selection (cite entity bio pages for
roundup claims). Gate 22725 passed 0 failed.

## 2026-07-11 - Refresh-reliability wave: tenant-guard fix, auth escalation, refresh_runs ledger

2026-07-11 refresh-reliability: precompute tenant-guard root cause = fan-out warmed non-env
tenants under the parent request's ambient context tripping the cross-tenant guard, fixed with a
runWithTenant AsyncLocalStorage override warming each tenant inline under its explicit context;
auth escalation = 5 consecutive failed cron runs spanning >= 3 days stamps a distinct
needs_attention marker, never auth_failed_at, probe-before-stamp preserved, surfaced on
/settings/connectors with "I have not been able to pull your data since <date>. Reconnecting
usually fixes this."; refresh ledger = new additive refresh_runs table recording every refresh
source-by-source across cron/manual/on-use with honest ok/partial/failed + rows persisted +
data-through date, Profound synced-with-0-rows now reads partial no-new-data; migration
2026-07-11_refresh_runs.sql APPLIED to prod by the architect via MCP, table + RLS verified; gate
22711 passed 0 failed.

## 2026-07-10 - E-39 adaptive control pools (admit-with-caution) - worktree e39-impl

**CORRECTED 2026-07-10 (see the follow-on entry immediately below this one):** the D6 line below
claims "softened all final/highest-confidence copy" - that was inaccurate when written. An
adversarial review of this wave found three RENDERED surfaces still calling a 28-day result
"final" (cumulative-outcome.ts's waiting line, proof-summary-section.tsx's zero-mature lead
sentence, changes-list-client.tsx's Results-tab empty state); a follow-up sweep during the fix
found two more (decision-thresholds.ts on /settings/how-i-decide, results-header-strip.tsx on
Today + Results). All five are fixed in the review-fix commit described below.

**What changed (operator-approved binding spec, 7 decisions):**
- D1 admit-with-caution: `assessEligibility` (src/domains/experiments/experiment-eligibility.ts)
  now returns eligible-with-caution for active_control / same_family_measuring / compound_edit /
  insufficient_controls instead of `eligible:false`. Hard blocks kept ONLY for genuine hazards
  (recent_no_lift, high_risk_page, ownership_uncertain, stale_research, and a new
  `last_clean_donor` when releasing would leave a measurement with zero comparables).
- D2 overlap contaminates never prohibits: existing control-contamination machinery
  (promoteFromFrozenPool / medianBandRead / contamination-timestamp = the overlapping edit's ship
  date) + one-tier confidence drop; new tests pin timestamp-correctness + inputs-never-mutated.
- D3 adaptive 2-3 pool: build-daily-candidates MIN_CONTROLS 3 to 2 (minimum defensible fallback),
  suggestion pool capped at 3 (MAX_CONTROLS), <2 routes to a lower-confidence caution not a freeze;
  measure.ts ladder (2 to medium, 3 to high, <2 to insufficient/low) pinned by new tests.
- D4 verdict-lag repair (measure-lifecycle.ts `resolveVerdictLag`): at 28d+grace recompute+settle
  when GSC data is available; else release + preserve + mark blocked_data + bounded fair retry;
  wall-clock age never manufactures a verdict.
- D5 promotion writer annotates never deletes (promotion-writer.ts `annotateCautionRows`).
- D6 preserve 7/28/56-84: softened all "final"/"highest-confidence" copy over the unbuilt 56-84d
  tier (measurement-maturity mature explanation + "The 28-day checkpoint opens..."; results
  summary "my strongest read so far"; early-signal/verdict-reliability "the full 28-day read");
  ledgered the 56-84d tier as a concrete future slice in NEXT_PHASE_EXECUTION_PLAN.md + a task.
- D7 compute-only: no migration; caution copy derived deterministically; contamination timestamps
  read from existing shipped_change_proof ship dates.

**Read-only ground-truth (live tenant-iranopedia, SELECT-only; project `vlxwevsdvwxvopkjsewo` via
the davinci worktree env - the main-repo .env.local points at a dead project ref that NXDOMAINs):**
25 ledger rows, 6 measuring, 65 universe pages. Eligible BEFORE 35 to AFTER 59 (+24). The +24 are
exactly the 6 compound_edit (treated) + 18 active_control (comparison) pages the spec named as
"24 locked". ALL 24 carry a lower-confidence caution; 0 unsafe pages admitted; the 6 recent_no_lift
(proven-loss) pages stay HARD blocked. The eligibility gain comes only from measurement
inconvenience, never from accepting weak/unsafe evidence.

**Verified:** full hermetic gate at tip (env -i clean shell) GREEN - typecheck_exit=0,
test_exit=0 (1428 files / 22256 passed / 62 skipped), build_exit=0 (fullgate12.log). Probe script
removed; worktree clean. NOT pushed (per instruction).

## 2026-07-10 - E-39 adversarial review P1 fixes (28-day result never final + dash sweep) - worktree e39-impl

**Trigger:** an adversarial review of the E-39 wave above found the D6 claim ("softened all
final/highest-confidence copy") was not true: three RENDERED, operator-facing surfaces still
called a 28-day result "final", violating the preserved 7/28/56-84 contract (the 56 to 84 day
confirmation tier is not built yet, so no copy may claim finality over a window that does not
exist). A dash-hygiene P1 was also raised for one new and one pre-existing em dash in this wave's
diff.

**What changed (P1-1, no 28-day result called final anywhere rendered):**
- `src/domains/proof-gsc/cumulative-outcome.ts` waiting line: "No final verdicts yet..." ->
  "No settled reads yet... Longer confirmation reads come later."
- `src/app/(shell)/results/proof-summary-section.tsx` `buildZeroMatureLeadSentence`: "None of your
  N changes has a final verdict yet." -> "None of your N changes has a 28-day read yet."
- `src/app/(shell)/changes-list-client.tsx` Results-tab empty state: "N changes have a final
  read." -> "N changes have their 28-day read."
- Sweep found two more real rendered surfaces beyond the three named: `src/domains/settings/
  decision-thresholds.ts` (rendered on /settings/how-i-decide: "the 28 day read is final" ->
  "my strongest read available at that point... Longer confirmation reads come later") and
  `src/app/(shell)/results/results-header-strip.tsx` (rendered on Today + Results: "a final
  read" -> "a 28-day read"). All five fixed; all downstream pinned strings (cumulative-outcome,
  proof-plain-vocabulary, cumulative-outcome-strip, results-header-strip, decision-thresholds
  tests) updated to match, plus a new "never renders final for a 28-day result" pin added to
  each so this class fails the gate next time.

**What changed (P1-2, dash sweep):** removed the em dash introduced at `measure-lifecycle.ts`'s
new D4 JSDoc paragraph and the pre-existing one on measurement-maturity.ts's VERDICT line (already
touched by this wave); also cleaned the new E-39 `describe()`/`it()` titles across
build-daily-candidates.test.ts, experiment-eligibility.test.ts, control-contamination.test.ts,
measure-lifecycle.test.ts, measure.test.ts, measurement-maturity.test.ts, and
promotion-writer-caution.test.ts that introduced fresh em dashes this wave. The two dash-detector
regex literals the wave added (which must match the characters they forbid) were rewritten with
unicode escapes so even they carry no literal dash. The dash grep over newly-added diff lines
against 3ae54f98 is now EMPTY. The unscoped grep over the whole diff still surfaces pre-existing,
untouched describe() names as diff-history artifacts (unified diff always echoes the old dashed
line once a nearby line changes) - these predate this wave and are out of scope for this fix.

**Docs:** corrected the D6 claim above (see the "CORRECTED" note on the E-39 entry). Ledgered P2
follow-ups from the review in NEXT_PHASE_EXECUTION_PLAN.md.

**Verified:** targeted vitest suites for every touched file green; full hermetic gate appended to
fullgate12.log (typecheck/test/build all exit 0). Worktree clean. NOT pushed (per instruction).

## 2026-07-09 - Task #230 trust-correction wave: 3-lane integration (Codex audit closure)

**UPDATED 2026-07-10 (see the follow-on entry immediately below this one):** the gate-red state
this entry describes was the state at the integration tip aa8dac5e, before the fixture fix. It was
fixed in eb056890 and the gate has been green since; the "NOT fixed" / "flagged for the architect"
wording below is preserved here as an honest record of what was true at aa8dac5e, not of the
current state.

**Trigger:** a Codex adversarial audit of the W5/W9/spec-debt release (recorded further below in
this same file) reopened 3 P1 and 3 P2 findings against work this log had already called done:
- P1: source-to-draft factual coverage checked only a single-token overlap, so a multi-word
  claim with no matching token in any source could still pass as covered.
- P1: the SSRF source fetcher's protection was a DNS-check-then-connect gap, not an actual pin -
  the check resolved and validated an IP, then the real fetch resolved again and could land on a
  different address (the earlier release's own adversarial review had documented this as one
  accepted residual window; the audit found the gap was not a narrow race, it was open on every
  request).
- P1: the release ledger (this file plus HANDOFF_VERIFIED_STATE.md and
  NEXT_PHASE_EXECUTION_PLAN.md) had drifted from git reality - entries claimed W9 Slice 1 and
  B-15/E-36 were "committed, not pushed" and claimed origin/main was still at 1de8ea67, when in
  fact both commits were already ancestors of origin/main's real tip.
- P2: an ambient-tenant file-store fallback and three of the nine Ask providers could read data
  without an explicit tenant argument, a cross-tenant leak risk if ever called from a context
  that failed to resolve one.
- P2: the SSRF fetcher's timeout was applied per-hop, not to the whole draft-verification
  operation, so a chain of several slow redirects could outlast the intended deadline.

**Fix, three lanes built in parallel isolated worktrees, merged conflict-free (disjoint file
sets, octopus merge, zero textual conflicts):**
- Lane 1 - source-coverage (480c70c0, 1742dee0): source-authority.ts's
  draftFactsCoveredBySources now checks factual coverage per sentence with a negation guard (a
  sentence that flips a source's polarity - e.g. a source says a program ended and the draft says
  it is ongoing - no longer passes as "covered" just because the words overlap). draft-quality.ts
  wires this stricter check into evaluateDraftQuality's ready/missing_source gate. Closes the
  single-token-overlap P1.
- Lane 2 - SSRF-pinning (6b139e98): safe-source-fetch.ts replaces the DNS-check-then-connect gap
  with a socket-pinned fetch - a per-hop undici Agent binds the outbound connection to the exact
  IP the private-range policy already approved, so the address that was checked is the address
  that is actually connected to, closing the DNS-rebinding TOCTOU window for real rather than
  documenting it as accepted. The private-range policy itself is now a full parsed-CIDR check
  (previously a narrower set of blocked ranges). The verify deadline is now enforced across the
  whole draft-verification operation, not reset at each redirect hop. Closes the SSRF P1 and the
  per-hop-deadline P2.
- Lane 3 - tenant-isolation (36dbea5c): the file-store fallback and the three Ask providers that
  could previously read on an unresolved tenant now fail closed - an unresolved tenant raises
  instead of silently reading an ambient/shared file. Closes the ambient-tenant-read P2.
- Doc reconciliation (this entry + the HANDOFF/NEXT_PHASE edits it accompanies): every
  "committed NOT pushed" reference to W9 Slice 1 or B-15/E-36 corrected to PUSHED with its real
  commit SHA, and every "origin/main now 1de8ea67" reference corrected to ee89c14b (origin/main's
  actual position, which already carries W9 Slice 1 and B-15/E-36 as ancestors). Closes the
  doc-staleness P1.

**W5's original "DNS-pinned resolution" claim, corrected:** the W5 release ledger described its
source fetcher as having "DNS-pinned resolution." That was an overstatement of what shipped - it
had a DNS-based private-range check before the fetch, not a pin on the fetch itself. Lane 2 above
is the first wave to actually implement socket-level pinning via a per-hop undici Agent. W5's
entries in HANDOFF_VERIFIED_STATE.md and VERIFICATION_LOG.md (below) are corrected in place to
say so rather than repeat the overstatement.

**Integrated tip:** aa8dac5e (merge commit `merge(trust): integrate SSRF-pinning +
tenant-isolation lanes into source-coverage (Task #230)` on branch trust-correction-230, base
ee89c14b, lanes 480c70c0/1742dee0 + 6b139e98 + 36dbea5c).

**Gate receipts (fullgate7.log, hermetic env -i, geist installed via `npm install --no-save
geist` and confirmed no package.json/lock change):**
- typecheck_exit=0.
- test_exit=1 - 1423 files / 22185 tests passed, 62 skipped, 2 files / 3 tests FAILED.
- build_exit=0.

**The 3 failures, classified THIS-WAVE (not pre-existing, not environmental) by bisection:**
green (40/40) at base ee89c14b; red (3 failed) at Lane 1's own tip 1742dee0, before Lane 2 or
Lane 3 were even merged in - so the break is Lane 1's substance, not an interaction between
lanes and not caused by the merge itself.
- `src/lib/business-config.test.ts` > "tenant A's allowlist never raises authority for tenant B"
  - expects `evaluateDraftQuality(...).status` to be `"ready"` under tenant A's allowlist; gets
  `"missing_source"`. The fixture's FACTUAL_DRAFT has four sentences; the one supplied source's
  `claim` text matches only the first. Lane 1's new per-sentence rule correctly holds the other
  three uncovered sentences - the fixture was never updated to supply matching sources for all
  four.
- `src/domains/page-factory/production-line.test.ts` > "caps drafted pages at
  MAX_DRAFTS_PER_WEEK even with many demand-passing candidates" - expects `res.drafted` to be 5,
  gets 0.
- `src/domains/page-factory/production-line.test.ts` > "skips a candidate whose brief draft
  throws, without failing the whole batch" - expects `res.drafted` to be 1, gets 0.
  Both production-line cases build synthetic multi-sentence drafts without per-sentence source
  coverage; Lane 1's stricter rule now holds every one of them for a missing source, so the
  production line drafts zero pages in fixtures that expected some to clear the gate.
- Lane 1's OWN test suite (draft-quality.test.ts, source-authority.test.ts) was updated for the
  new rule and is green. These two OTHER call-site suites, which exercise the same shared
  evaluateDraftQuality function from a different domain, were not updated in the same commits.
- NOT fixed in this pass. No test fixture or production logic was touched to make these pass -
  flagged for the architect to decide: update the two stale fixtures to Lane 1's new stricter
  rule (if the rule is the intended fix), or adjust the rule if it is over-tightened.

**Push status (at aa8dac5e, superseded below):** NOT pushed pending the fixture fix. See the
2026-07-10 entry immediately below for the fix and the current push status.

## 2026-07-10 - Task #230 fixture fix + adversarial re-audit closure + non-ASCII numeral coverage fix

**Trigger:** two follow-ons to the entry above. First, the two stale fixtures the aa8dac5e gate
run flagged (src/lib/business-config.test.ts's tenant-isolation pin; two governance/fail-soft
cases in src/domains/page-factory/production-line.test.ts) needed to be brought up to Lane 1's new
per-sentence coverage rule. Second, a fresh adversarial re-audit of the whole trust-correction wave
was run to confirm the 3 P1 + 3 P2 findings were genuinely closed, not just declared closed.

**Fixture fix (eb056890, `test(trust): align stale brief + business-config fixtures to the
per-sentence source-coverage rule`):** both fixtures were updated to supply a per-sentence source
matching every protected sentence in their synthetic drafts, rather than relaxing Lane 1's rule -
the rule itself (draftFactsCoveredBySources' per-sentence coverage with a negation guard) was
confirmed to be the intended, correct behavior. Full hermetic gate GREEN at eb056890
(fullgate8.log, hermetic env -i): typecheck_exit=0; test_exit=0 (1425 files / 22188 tests passed,
62 skipped, 0 failed); build_exit=0.

**Adversarial re-audit (2026-07-10):** re-checked all 3 P1 + 3 P2 from the 2026-07-09 entry above
against the eb056890 tip. Verdict: all 3 P1 and all 3 P2 confirmed closed, no P0 found. The audit
additionally surfaced one NEW P2, closed in this same pass:

- **P2 (non-ASCII numeral coverage gap):** `draft-quality.ts`'s GENERIC_NUMBER classifier already
  recognized Arabic-Indic (٠-٩, U+0660-0669) and Extended Arabic-Indic / Persian (۰-۹, U+06F0-06F9)
  digits, so a factual claim written with those numerals (e.g. a Persian-numeral count - Iranopedia
  is Persian content, so this is a live risk, not a hypothetical) was correctly classified as
  factual and source-gated at the whole-draft level. But `source-authority.ts`'s
  per-sentence protected-number check (`sentenceIsProtected`, and the number match inside
  `findSupportingSpan`) used `draftNumbers` (factual-entailment.ts), which is ASCII `\d+`-only. A
  sentence carrying only a non-ASCII numeral therefore had ZERO protected tokens and fell into the
  weaker zero-protected branch, which only requires that at least one qualifying authoritative +
  verified source exist - it never checks the specific number against any excerpt. Net effect: a
  qualifying source describing a DIFFERENT number than the one the draft actually claimed still
  satisfied the gate. Fixed by adding a local `sentenceNumbers` helper in `source-authority.ts`
  that normalizes those same two Unicode digit ranges to their ASCII value before delegating to the
  existing `draftNumbers`, used in place of `draftNumbers` at both call sites
  (`sentenceIsProtected`, `findSupportingSpan`). `draftNumbers` itself (factual-entailment.ts) is
  byte-unchanged, so `checkFactualEntailment`'s existing callers and tests keep their exact prior
  behavior; this is a LOCAL widening, not a shared-semantics change. The structural-number
  exclusion (year +/-1, the 7/14/28 proof window) is unchanged conceptually - a Persian-numeral year
  now correctly normalizes to the same ASCII string the exclusion set already contains, so it is
  excluded exactly like an ASCII-digit year would be.
- **New tests (source-authority.test.ts):** (a) a claim with a Persian/Arabic-Indic numeral and a
  qualifying source whose excerpt names a different number -> `covered:false` (this was the hole -
  previously `covered:true` regardless of the mismatch); (b) the same claim with a qualifying
  source whose excerpt carries the SAME numeral -> `covered:true`; (c) boolean-wrapper parity holds
  for the Persian-numeral claim too. All pre-existing zero-protected-branch tests (the
  no-isolable-claim / superlative-only fixtures) still pass unchanged - this fix only widens what
  counts as a protected number, it does not touch the zero-protected branch's own logic.
- **Verified:** `npx vitest run src/domains/drafts/` green (6 files / 179 tests passed, including
  the 3 new pins). Full hermetic gate GREEN again on top of the numeral fix (fullgate9.log,
  hermetic env -i): typecheck_exit=0; test_exit=0 (1425 files / 22191 tests passed, 62 skipped, 0
  failed - the 3-test delta from fullgate8.log's 22188 is exactly the 3 new pinning tests above);
  build_exit=0.

**Still-open, honestly tracked, non-blocking follow-ups from the re-audit (none are P0/P1):**
1. **Excerpt-realism operator-journey check.** Every fixture and unit test in this suite hand-builds
   a `supportingExcerpt` that exactly backs the claim under test. A REAL per-claim excerpt (fetched
   from a real page, W5 F2) may be shorter, differently worded, or cover only part of a multi-fact
   draft sentence - the per-sentence rule could hold a real multi-fact draft as `missing_source`
   more often than these synthetic fixtures suggest. This needs a seeded-data operator-journey walk
   against real Iranopedia drafts, not another unit test, to know whether the rule is too strict in
   practice. Not started.
2. **Zero-protected-branch topical match.** The branch that fires when a factual draft has no
   individually-isolable protected sentence still only requires >= 1 qualifying authoritative +
   verified source to exist, with no per-sentence excerpt check (there is no sentence to isolate).
   This is a narrower, lower-risk version of the same shape of gap the numeral fix closed above,
   for definitional/lowercase assertions rather than numeral-bearing ones. Low risk, tracked, not
   fixed in this pass.
3. **Whole-draft verify deadline is availability-only, not an SSRF control.** Lane 2's whole-draft
   (not per-hop) verify deadline (2026-07-09 entry above) bounds how long a slow multi-hop redirect
   chain can run before the whole verification gives up - it protects availability. It is not
   itself a defense against SSRF; that is Lane 2's socket-pinned fetch (the per-hop undici Agent
   binding the connection to the exact policy-approved IP). No change needed; noted so the deadline
   is never mistaken for a security control it never claimed to be.

**Push status:** NOT pushed. Same integration branch, same architect-review gate as the entry
above; this task was explicitly instructed not to push. The gate is GREEN and, as of this entry,
there is no known reason left to hold a fast-forward - the hold is procedural (explicit push
instruction pending), not a red gate or an open finding.

## 2026-07-09 - Operator-spec delegated wave (W1c/W4/W6) + per-tenant OAuth reliability wave

**Operator-spec waves (docs/OPERATOR_PRODUCT_SPEC_2026-07-09.md):**
- W1c (76aaf9eb): dynamic move count on Today (B-8, quality cliff at the first tracking-strength
  item past position 3, min 3 / max 10) + the drop card states the drop and stops inventing causes
  (B-10, sitewide-move context line, algorithm_weather removed as a claimed cause).
- W4 (e62aeffe): New Pages semantic clustering (singularized token-set + head-noun subset,
  cluster volume = max + 30 percent of the rest), honest ranking floor, Rising/Seasonal/Stable
  signal labels replacing Hot/Warm/Emerging, sources mini-list on the card, draft disabled
  without sources. Straggler test fixtures caught up in 97b5b916.
- W6 (53fc4077): I-59 on-visit freshness (12h staleness check fires the existing one-click
  refresh in the background via next/after, 6h throttle marker tenant-scoped + Supabase-mirrored;
  the after() scheduling was an architect fix, a plain floating promise dies with the lambda),
  I-60 amber "warn" staleness box separate from red alarms, I-61 reliability report renders only
  failing/stalled jobs. Verified: typecheck clean, 264-test VERIFY sweep + 77-test re-run green,
  both routes 200 on the Iranopedia dev server with the background refresh observed firing.

**Service-account path REJECTED and parked (90cebafb):** operator decision, per-tenant OAuth is
canonical; the full SA build stays recoverable at 31af9539, never pushed or deployed.

**OAuth root-cause audit (11 agents: code trace + live Google docs + adversarial skeptics):**
the old "unverified sensitive scope keeps 7-day expiry on In-production apps" theory was REFUTED
(Google ties 7-day expiry to Testing status only; undeclared sensitive scope costs the
unverified-app screen + 100-new-user lifetime cap, matching the Audience 2/100 gauge). Confirmed
code killers: unconditional prompt=consent churning the documented 100-refresh-tokens-per-
account cap, and refresh results never persisted (rotations silently dropped). NEW verified
hole: the callback preserve-merge no-ops on a soft-failed store read, then full-row-upserts
refresh_token:"" over a healthy token. Two UNGATED BEACON_GSC_SITE_URL reads leaked the founder
GSC property onto other tenants (gsc-signal loader + auto-measure recrawl). Corrected report +
operator checklist (declare analytics.readonly, no SA keys) appended to
docs/OAUTH_ROOT_CAUSE_2026-07-09.md.

**Per-tenant OAuth reliability wave (2b789757), ready for verification, NOT claimed permanent:**
- DB-side never-erase + cross-instance CAS: save_connector_token_guarded_v1 RPC
  (migrations/2026-07-09_connector_token_guarded_upsert.sql) APPLIED to prod Supabase and proven
  with 5 rolled-back SQL assertions (retain-on-empty, both-empty refusal writes nothing, staler
  refresh no-ops, fresher refresh persists without touching the refresh token, refresh never
  inserts); EXECUTE revoked from anon/authenticated, service_role only; app falls back to an
  equally-refusing app-side path only on PGRST202/205/42883, loudly.
- Callback: discriminated store read; refresh-token-less responses retain the stored token only
  on a proven same account (id_token sub); soft-failed read / empty store / unproven identity
  aborts with NO write (?error=refresh_token_missing / account_mismatch, honest first-person copy).
- Connect / Replace / Reconnect intents in the signed state; all deliberate flows show the
  account chooser + consent; ordinary syncs never run OAuth; replace with a different account can
  never silently keep the old account's refresh token.
- openid+email identity scopes alongside the single per-kind data scope (least-privilege pins
  updated); google_account_sub/email persisted; "Connected as <email>" renders on new grants.
- In-process single-flight refresh dedupe on top of the DB CAS; rotated tokens persist everywhere.
- Tenant isolation: both BEACON_GSC_SITE_URL consumers now gate on BEACON_TENANT_ID === tenantId.

Verified: typecheck exit 0 (checked without piping tsc); 166 tests green across the OAuth
surface including the operator's 7-test regression suite (tenant-A-cannot-alter-B, replace-A-
leaves-B-byte-identical, refresh-token-less-cannot-erase incl. the soft-fail hole, replacement
mismatch rejected, GA4 property tenant-scoped, scopes least-privilege and separate, staler
concurrent refresh no-ops), all hermetic (no live Supabase/Google, no .env fallback);
/settings/connectors renders 200 on the Iranopedia dev server, healthy GSC card shows
"Pull my Search Console data" + "Replace Google account" + "Using property
https://www.iranopedia.com/". Pending by design: the two-real-account hosted acceptance test
(Ritz + Iranopedia) before any "permanent fix" claim.

**RELEASE (pushed to main, acceptance operator-gated):**
- Gate remediation commit 6dda391a: north-star semantic tokens (design-ratchet) + rpc-aware
  store harness.
- Hermetic full gate receipts (fullgate2.log): typecheck_exit=0; test_exit=0 with 1413 files /
  21901 passed / 0 failed / 62 skipped; build_exit=0.
- Adversarial review verdict: no P0. P1-1 cross-instance patch-path race + P2 notes recorded;
  fix queued as the oauth-patch-mode package.
- Prod RPC verified read-only: definition matches the migration, EXECUTE granted to
  service_role only.
- PUSHED: fast-forward 1f588042..6dda391a; origin/main is now 6dda391a.
- Vercel: build confirmation unavailable to the agent (no token in the environment); production
  reachable, HTTP 307 (/), 200 (/login), 307 (/settings/connectors), fresh x-vercel-id present
  on every poll.
- Authenticated both-tenant smoke: OPERATOR-BLOCKED (no smoke credentials available to the
  agent).
- Still pending: operator acceptance (two-account OAuth test) + one-week durability proof.

**W5 DRAFT SAFETY RELEASE (implemented, committed, pushed to main; hosted smoke operator-blocked):**
- Operator stop-ship audit on the first W5 fix attempt found two P0s and four P1s: P0 SSRF in the
  source fetcher (an unvalidated outbound URL could reach internal hosts), P0 a weak 50 percent
  token-overlap threshold that let unrelated claims pass as supported; the four P1s were an
  ambient tenant read inside after() (no explicit tenant on the deferred call), re-verify gated on
  due measurements only (a manual re-check could not run early), a verifyState downgrade that lost
  a passing verdict on a partial re-run, and retry starvation (a stuck job never freed its slot for
  a later attempt). Ship was stopped before any of these findings went live.
- Redesign, implemented in the isolated worktree: commit a01a5fc3 (hardening - a source fetcher
  with a DNS-check-then-connect private-range block, span-level claim support replacing the weak
  overlap check, an atomic verify envelope, tenant-explicit re-verify, and retry fairness with
  honest exhausted-attempts copy), 81d2c500 (adversarial review fixups), 1de8ea67 (test re-pin);
  built on base e1a43fb8, all atop bf3f2cbc + e1a43fb8 (the W5 packages) and a24ab1ae
  (oauth-patch-mode).
- Adversarial review verdict at the time: no P0. One residual documented and accepted: a
  DNS-rebinding TOCTOU window between the pinning check and the fetch itself, accepted per the
  operator's own spec (blind SSRF defense is authority-gated and the pinning remediation is named
  directly in code for the next pass). CORRECTION (2026-07-09, Task #230 below): a later Codex
  audit found this check-then-connect gap was not a partial mitigation with one residual window -
  the fetch itself was never actually pinned, so the gap was open on every request, not only
  during a race. Closed for real by the socket-pinned fetch in the Task #230 entry below.
- Gate receipts (fullgate4.log): typecheck_exit=0; test_exit=0 (1418 files, 22087 passed, 62
  skipped, 0 failed); build_exit=0.
- Both W5 migrations (shipped_change_verify_columns, connector_token_patch_mode) were previously
  applied to prod Supabase and verified; no new migration in this release.
- PUSHED: fast-forward d43ff7e3..1de8ea67; origin/main is now ee89c14b, having since folded in
  W9 Slice 1 (6c808c09), B-15/E-36 (118d5252), and the Task #230 trust-correction wave below.
- Deployed = Vercel build confirmation unavailable to the agent (no token in the environment);
  reachability-checked = production reachable, HTTP 307 (/), 200 (/login), 307
  (/settings/connectors), fresh x-vercel-id present on every poll.
- Authenticated both-tenant smoke: operator-blocked (no smoke credentials available to the agent).

**W9 ASK SLICE 1 (fact-provider registry + denylist + deterministic zero-LLM answers + one
wired intent; committed on an isolated worktree branch, rebased onto 88753ba0, and PUSHED -
commit 6c808c09, now an ancestor of origin/main ee89c14b):**
- Bounded vertical slice on the approved architecture (P1 + denylist + deterministic path).
  Nothing rewritten - every existing fact-assembly.ts assembler kept its body byte-identical;
  only additive exports, additive types, and two new call sites.
- src/domains/ask/providers/provider-types.ts + registry.ts: AskFactProvider
  { id, classes, prodLive, gather(tenantId, question) } wrapping all 9 fact-assembly.ts
  assemblers as thin, behavior-identical adapters. All 9 marked prodLive: true after tracing
  every underlying loader to a direct Supabase table (gsc_daily_totals, shipped_change_proof,
  PLANS, cron_runs) or a store already in json-store.ts's SUPABASE_MIRRORED_STORES - none of
  the 9 is file-only today. gatherFacts() dispatches by class and catches each provider
  independently (one throwing provider never blanks another registered for the same class).
- src/domains/ask/providers/denylist.test.ts: grep-based architecture pin (same pattern as
  outreach-pipeline.test.ts): no file under src/domains/ask may import connector-store,
  google-auth, adjudicator-budget, budget-ledger-supabase, verify-budget-ledger,
  run-engine-poll, visibility-observation-explicit-store, or the raw Profound client. A
  permanent forward guard, not a one-time check.
- router.ts: new isDeterministicQuestionShape(question, questionClass) - true for
  page_ranking (always a rank shape) and site_trend (always a count shape), plus any
  "how many"/"list" phrasing under any class. composer.ts's composeAskAnswer calls it right
  after the hasData check and returns fallbackAnswer() directly when true - a locked operator
  decision (these bypass the LLM outright, not only as a budget/failure fallback). Zero new
  LLM calls added; several call sites now make ONE FEWER LLM call than before.
- types.ts: AskFact extended additively with freshnessIso?, providerId?, prodLive?.
  composer.ts's fallbackAnswer appends "Data through <date>, from my <specialist> read." when
  a fact carries freshnessIso - reusing the existing team/identity.ts specialist names.
- ONE intent wired end to end through the registry: site_trend (sitewide GSC clicks).
  ask-actions.ts routes site_trend through gatherFacts(tenantId, routed) + buildAskDossier
  instead of fact-assembly.ts's direct switch case; siteTrendProvider stamps
  freshnessIso/providerId="gsc-daily-totals"/prodLive=true onto every fact via one small
  additive read (latestGscDailyDate, a second call to the same loadDailyTotalsForTenant
  already used by assembleSiteTrendFacts). EXACT RENDERED SENTENCE (proven in
  providers/site-trend-wiring.test.ts, 10 flat days of 20 clicks): "Here is what I know about
  the site's traffic: Sitewide clicks over the last 7 reported days: 140. That is +133%
  versus the prior 7 days (60 clicks). Data through 2026-07-08, from my Search demand read."
  source: "fallback" (zero LLM calls, proven by a complete spy asserted never called).
- Two-tenant isolation proven at the registry level AND through the full chain
  (route -> gather -> dossier -> compose): tenant A's gather/answer never carries tenant B's
  fact values or numbers (registry.test.ts + site-trend-wiring.test.ts).
- NON-GOALS HONORED: no new UI beyond the answer sentence; no migration; no multi-provider
  planner (8 of 9 providers exist wrapped but are not yet live-routed - Slice 2); no semantic
  retrieval; no history/memory changes; no new LLM calls.
- VERIFIED at the rebased tip (base 88753ba0): npx vitest run src/domains/ask/ -> 8 files /
  119 tests passed (5 pre-existing ask suites unchanged and green + 3 new: denylist.test.ts,
  registry.test.ts, site-trend-wiring.test.ts; composer.test.ts and router.test.ts extended
  in place). Full hermetic gate receipts in fullgate5.log (typecheck/test/build exits +
  vitest totals; the hermetic env needed npm install --no-save geist first, package.json/lock
  untouched - pre-existing worktree gap, confirmed via git-stash bisection to predate this
  change). No dev server, no paid call, fully hermetic.
- FILES: src/domains/ask/{types.ts, router.ts, composer.ts, fact-assembly.ts} (all
  additive/export-only changes to existing functions); NEW src/domains/ask/providers/
  {provider-types.ts, registry.ts, registry.test.ts, denylist.test.ts,
  site-trend-wiring.test.ts}; src/app/(shell)/ask/ask-actions.ts (site_trend now calls the
  registry); composer.test.ts + router.test.ts extended with the new deterministic-bypass/
  freshness pins.
- DONE / NEXT: this commit is PUSHED (6c808c09, folded into origin/main ee89c14b). Slice 2
  (multi-provider planner, routing the other 8 wrapped providers live, semantic retrieval,
  session memory) is explicitly out of scope and unbuilt.

**SPEC-DEBT B-15 + E-36 (operator spec, two smallest open items; committed on an isolated
worktree branch rebased onto 6c808c09, and PUSHED - commit 118d5252, now an ancestor of
origin/main ee89c14b):**
- E-36 ("NEVER auto-revert; ask first") was a LIVE spec violation, not a missing affordance:
  decideRevert (src/domains/autopilot/revert-policy.ts) had an auto_revert branch that fired for
  a settled negative at day 14+ with clean attribution, and runNightlyRevertPass
  (src/domains/autopilot/run-revert.ts) executed those decisions through
  runRevertForProofRecord to LIVE restores, gated only by the site-wide autopilot arm - no
  per-change operator confirmation anywhere on the path. The /results surface even advertised
  it ("I will put the old version back tonight if you do not."). Fix: decideRevert now only
  ever returns propose or none (RevertAction narrowed, auto branch deleted); the nightly pass
  counts propose-eligible rows for /results but never pushes; the operator-gated one-click
  restoreOldVersionAction is the ONLY execution path. New first-person proposal copy: "This
  title change is 0.4 percentage points of click rate behind its comparison pages at the
  14 day check. I never put a change back on my own. Want me to prepare the restore? One click
  puts the old title back, and nothing happens until you say so." Confirmation-required pins:
  an exhaustive decideRevert sweep asserting no input combination yields anything but
  propose/none, a nightly-pass pin proving zero pushes for fully eligible candidates, and a
  /results source pin failing if the auto-forewarning copy or an "auto_revert" branch returns.
- B-15 (Today to Changes deep-link): each "What to do next" card on Today now links
  /changes?focus=<changeId> (CanonicalChange.id, URL-encoded) instead of the bare /changes.
  ChangesListClient consumes ?focus= once, opens the exact row's existing detail affordance
  (setSelectedId) and scrolls to it via the same rowRefs/scrollIntoView pattern the session
  loop already uses - no new route, no new detail surface. The /changes/[id] route was
  deliberately NOT reused: it is keyed by changelog-entry id, a different identity space than
  CanonicalChange.id. Verified against live Iranopedia data on a dev server: every Today move
  card rendered a distinct ?focus= href and /changes?focus=<id> rendered the matching
  change-row-<id> node; an unknown focus id degrades to the plain list.
- Verified at the rebased tip: 262 tests passed + 1 pre-existing unrelated skip across the
  autopilot/results/changes/today suites (including new today-opportunities-focus-link.test.tsx
  + changes-list-client-focus-link.test.ts); npm run typecheck exit 0. Commit 118d5252
  (feat(spec): B-15 Today-to-Changes deep-link + E-36 revert requires explicit confirmation).

## 2026-07-08 - Incident: app-wide 504 + "same 6 changes for 9 days" (15477039, 86fde79b)

Operator hit `504 MIDDLEWARE_INVOCATION_TIMEOUT` across the app and, separately, Today
kept showing the same 6 already-applied changes for 9 days. Two root causes, both fixed.

**1. Middleware 504 (15477039).** `src/lib/auth/supabase-middleware.ts` runs on EVERY
request and makes two blocking Supabase calls (auth.getUser + tenant_members) with no
ceiling; a slow/cold Supabase blew Vercel's middleware budget -> 504 on every route. Added
`withMwTimeout` (5s per call) reusing the existing graceful degrades (getUser timeout ->
login redirect; tenant timeout -> env-tenant fallback). 2 fake-timer tests prove each hang
degrades, never 504s. Prod was measured fast (0.46s) so the 504 was a transient Supabase
moment; this makes it impossible for that class to white-screen the app again.

**2. Same-6-for-9-days (86fde79b).** Ground truth: last daily plan created 2026-06-30;
none since. `ensurePlanPreview` (warm-caches precompute step 3) skipped generation whenever
`getAcceptedPlan` returned ANY still-"accepted" plan. A daily plan only leaves "accepted"
on a manual "Finish for today" click; applying the moves leaves them "measuring". So the
06-30 accepted batch blocked every new plan for 9 days. Fix: only TODAY's accepted batch
blocks; a PRIOR-day accepted batch auto-completes (completePlan; proof rows measure on
independently) and today's plan builds. Never-applied moves stay in the backlog and get
re-picked. Manually triggered precompute post-fix: plan-preview ran but returned "nothing
eligible tonight" - the strict experiment batch is control-starved this month (~51 pages
locked as measurement controls). NOT loosening the rigor gates; the operator works the full
82-move `/changes` backlog (verified: 82 recommended_edits) + Today's "What to do next"
(which draws from the same backlog, not the strict batch). Experiment-batch starvation logged
as a known limitation that self-clears as experiments unlock.

Verified: typecheck clean; middleware tests 12/12; warm-caches 26/26; full clean-shell suite
running as the gate. Both branches pushed. Prod smoke fast (/login 200).

---

## 2026-07-08 - Operator-walkthrough goal: 8 issues fixed at root + shipped (45f4697d)

**Goal:** the operator walked the live app on day 1 and flagged a batch of issues;
the /goal directive was "fix every one plus anything found, quadruple-checked, no new
hardcoding/fixtures, smart long-term." All done and shipped to main.

**Root causes + fixes (each tenant-agnostic, no hardcoded tenant/fixture):**
- **Perf ("everything slow, always")** [48831cdc]: `demand-graph-snapshot` was written via
  a json-store name absent from `SUPABASE_MIRRORED_STORES`, so on Vercel it lived only in
  one warm lambda and evaporated between instances - every /today,/changes,/new-pages load
  rebuilt the ~6s graph. Prod had ZERO snapshot rows while the two DERIVED surfaces
  (worklist/today-surface) persisted fine. Mirrored it; added `warmFreeSurfaces` after a
  manual refresh; `maxDuration=60` on /today for the refresh action.
- **Today hid the to-do list** [9eaff39c]: `buildTodayView` only showed nextOpportunities
  for planStatus none/completed; once tonight's batch is applied + measuring it's
  "in_progress", which forced the ranked list to [] ("I don't see my new moves"). Now
  shows it whenever there's no pending plan work; promoted `OpportunitiesSection` above the
  applied recap; cap 5->6.
- **Quiet source read as "broken"** [32e1da40]: role-based `PipelineViolation.severity` -
  only the GSC spine 0-rows alarms; optional sources (dead Profound) are info-level and
  never drive the "needs attention" banner or Ask's is-anything-broken answer.
- **Coverage vs citation** [32e1da40]: coverage-map splits content-coverage (top) from AI
  citation (bottom); "covered but not cited" framed as the opportunity, not a green 100%.
- **Junk AI prompts** [6fb6c8ff]: 3 "Evaluate the Frontier Models company X" deactivated
  (reversible is_active=false) + `isBorrowedAccountSentinelPrompt` filter at run + seed
  paths so they never return for any tenant.
- **Ask page-level** [0991dbd5]: new `page_ranking` class answers "what page makes most
  money / most traffic / is bleeding" from real per-page GA4 value + GSC clicks; honest
  revenue-vs-conversions (never an invented dollar).
- **Money hidden from UI** [56530446, prior]: every $ stripped from the New Pages board +
  prepare buttons.
- **GA4 "Sync didn't finish"**: verified HEALTHY (55.6k rows through 2026-07-08); transient
  reconnect blip, no code fix.

**Quadruple-check (found + swept):** GA4 ai-referral date-bomb (fixed-date token vs real
`new Date()` >7d guard) clock-pinned [37c69291]; proved NO other date-bombs (all connector
expiry tests inject `now` or fake the clock) and NO other non-mirrored SWR caches; removed
an em-dash I introduced + swept the touched file [45f4697d]; audited all changed prod files
for hardcoded tenant IDs (none in logic).

**Verified:** `npm run typecheck` clean; per-slice targeted suites green; **FULL clean-shell
suite 1404 files / 21781 passed / 62 skipped / 0 failed** (real npm exit 0, no pipe mask);
pushed both branches; prod smoke /login 200, /today+/changes+/ask 307 (auth redirect).

---

## 2026-07-07 - Final-touches closeout: /local honest cold-state + gate green (8d731d8a)

**Goal:** make the final-touches audit's top-10 fixes trustworthy on the gate. The prior two
commits (fd1b2065 trust/number-correctness + 943fb3bd ux/rough-edges) had shipped, but the full
suite showed 4 failures introduced by the batch. Root-caused all four:

- **2x `tests/routes/local-smoke.test.ts`** - caused by the Slice D `/local` cold-state guard
  (finding #5), which is CORRECT product behavior: a fully-cold tenant (no reviews, no synced/
  imported source) now renders "No local health to show yet · Connect Google Business Profile"
  instead of a bare "0 / 100" scorecard. The two tests asserted the old scorecard, so they now
  seed a real local source (Google Business Profile token) to exercise the populated page they
  verify; a NEW test locks in the honest empty state (asserts NOT "/ 100").
- **2x `tests/lib/local-presence.test.ts`** - a LOCAL-only test-isolation artifact (green on a
  clean CI checkout; only reproduces after repeated local runs). The json-store import-runs
  anti-race guard (`src/lib/persistence/json-store.ts`) refuses to overwrite a non-empty
  `import-runs.json` with `[]`, so the connector-fallback describe's `writeStore("import-runs",[])`
  was a no-op vs a stale `.data/tenants/ritz-builders/import-runs.json` (a leaked 2026-04-20 stamp
  from the file's own test 227). Fixed by adding the same `forceClearImportRunsFile()` helper the
  `google-`/`yelp-reviews-sync` tests already use (their comments literally name this file as the
  polluter). Guard behavior itself unchanged (its invariant test still passes).
- **Em-dash sweep** of the rendered `/local` surface: removed every em/en dash (header, staleness
  notes, freshness `{" · "}` separators, "How this works" list) per the hard rule.

**Verified:** `npm run typecheck` clean; both fixed files green (28 tests incl. the new one);
`google-`/`yelp-reviews-sync` + `json-store-routing` + `json-store-routing-invariants` green (65);
**full clean-shell suite `env -i` = 1403 files / 21772 passed / 62 skipped / 0 failed** (was
`4 failed | 21767 passed`). Pushed `943fb3bd..8d731d8a` to `claude/daily-experiments-native` +
`main`. Prod smoke: `/login` 200, `/local` 307 (auth redirect, expected). No migration, no new
env var, no paid call.

---

## 2026-07-07 - Bug #14: a revert was counted as a second shipped change (Wins + totals doubled)

**Goal:** an auto-revert records "I put the old version back" as its OWN proof-ledger row
(`actionType = revert_<original>`, run-revert.ts). The ONE-COUNT choke point counted that
bookkeeping row as a distinct shipped change, so a ship + its revert read as TWO changes,
doubling the running total and inflating Wins across the Results header strip, the three bands,
Today's tiles, and the cumulative strip. Fix it once, at the single band/count choke point.

**VERIFY-FIRST (confirmed before editing):**
- Confirmed the revert marker is pure and unambiguous: `run-revert.ts:62-64` sets
  `REVERT_ACTION_PREFIX = "revert_"` and records the revert as its own shipped change with
  `actionType: revert_<originalActionType>` (`run-revert.ts:414`); `isRevertRecord` (line 82)
  keys on that prefix. The ORIGINAL row only gets an ADDITIVE note (`appendShippedChangeNote`,
  shipped-change-store.ts:579) - its windows/verdict are never mutated.
- Confirmed `splitLedgerLifecycle` (domains/changes/lifecycle-counts.ts) is the SINGLE band
  membership rule every count routes through: Results 3 bands + header strip (results/page.tsx:504
  and cumulative-outcome-strip.tsx via computeCumulativeOutcome), Today tiles
  (lifecycle-counts-data.ts -> computeLifecycleCounts -> countLedgerLifecycle), the cumulative
  strip (cumulative-outcome.ts:140), won-dollar-rule.ts (97/113), and report-model.ts (150).
- Confirmed the revert row does TWO harms, not one: it double-counts AND, because
  `detectMeasurementOverlaps` runs over all rows, its same-page ship flags the ORIGINAL win as
  attribution-limited (dragging a genuine win down to measuring). Reproduced on a fixture:
  BEFORE `countLedgerLifecycle([won edit_title, revert_edit_title on same page])` = `{measuring:2,
  decided:0, won:0}` (2 changes, the real win lost). AFTER = `{measuring:0, decided:1, won:1}`
  (ONE change, the win preserved).
- Confirmed `cumulative-outcome.ts:144` computed `shipped = rows.length` directly (a SECOND leak
  the split did not cover) and `changes-data.ts:368` computed `shippedThisWeekCount` off raw
  `ledgerRows.length` (session strip) - both counted reverts.

**Fix (choke point + the two raw-length leaks):**
- `domains/changes/lifecycle-counts.ts`: added `actionType?` to `LedgerLifecycleRow`, a pure
  `isRevertLedgerRow` + `excludeRevertBookkeeping` (returns the SAME array reference when there is
  no revert -> byte-identical no-revert ledger), and filter reverts at the TOP of
  `splitLedgerLifecycle` BEFORE overlap detection. Every downstream count is fixed by this one edit.
- `domains/proof-gsc/cumulative-outcome.ts`: `shipped` now = `decided + measuring` (the filtered
  split totals), never `rows.length`; added `actionType?` to `CumulativeOutcomeRow`.
- `src/app/(shell)/changes-data.ts`: `shippedThisWeekCount` now filters via
  `excludeRevertBookkeeping` so the session strip agrees with the fixed lifecycle counts.

**Verified:** `npm run typecheck` = clean for all touched files (the only two tsc errors are
pre-existing and unrelated: `today-lead-headline.ts` / `today-briefing.test.tsx`
`celebratesWinWithFigure`, files not touched here). Tests: lifecycle-counts (19 -> 23, +4 bug-#14
pins including the byte-identical same-reference pin and a legacy-no-actionType pin),
cumulative-outcome (+1 shipped-excludes-reverts pin), won-dollar-rule, report-model,
results-ledger-data, results-surface-store, results-header-strip, proof-revert-proposal,
run-revert, session-flow, today-view, changes-data, live-changes-data - all green
(137 + 65 across the two runs). No dev server (pure read-model change).

---

## 2026-07-07 - Cold-tenant fix batch (#5, #4, #12, #13): four honest cold states before Ritz sees them

**Goal:** four surfaces mislead a brand-new tenant with no data (Ritz, who the operator opens
tomorrow): a scary 0-out-of-max local scorecard, a generic error on the only cold-Today CTA, a
false "clean day" reassurance on too little traffic, and a "(DataForSEO)" vendor leak. Fix all
four so the cold state reads honestly. Scope: `src/app/(shell)/local/page.tsx`,
`src/app/(shell)/war-room-sections.tsx`, `src/app/(shell)/daily-experiments-actions.ts`, and the
operator-failure copy map `src/domains/diagnostics/operator-failure.ts`. Additive.

**VERIFY-FIRST (each cited line confirmed before editing):**
- #5 `local/page.tsx:70` - confirmed the day-zero guard was `if (!snapshot.hasListing && !snapshot.hasReviews)`.
  Confirmed in `src/lib/local-presence.ts:360` that `hasListing = Boolean(config.domain?.trim())`,
  so ANY tenant that saved a domain in Config flips it true - it is not a real signal of local data.
- #4 `daily-experiments-actions.ts:47` - confirmed the cold-Today CTA returned the prose sentence
  `"No eligible experiments today (nothing materially better that's scientifically clean)."`.
  Confirmed the section consumer `daily-experiments-section.tsx:804` renders it via
  `reasonCopy(r.reason)` = `failureForReason(reason).message`; an unknown code falls through to the
  FALLBACK `"Something didn't go through."` (operator-failure.ts:59). Confirmed the cold CTA is the
  `"Show me today's changes"` button (daily-experiments-section.tsx:866).
- #12 `war-room-sections.tsx:194-208` - confirmed the "No friction found this week. Clean pages."
  empty state fired on `rows.length === 0`. Confirmed `routeClarityFriction` returns null below its
  `minSessions: 20` floor (clarity-move-router.ts:43,62), so a below-floor page is indistinguishable
  from a clean above-floor page in `allRouted` alone - the false-win root cause.
- #13 `war-room-sections.tsx:554` - confirmed the rendered subtitle read
  `"Real monthly searches (DataForSEO) where no page of yours is the answer today."`, one line below
  a sibling (553) that already used the plain "keyword research" phrasing.

**What changed:**
1. #5 - guard now fires on ABSENCE of meaningful local data: `!snapshot.hasReviews && !hasLocalSource`
   where `hasLocalSource = Boolean(snapshot.lastSync.google || .yelp || .manual)`. New empty state:
   `"No local health to show yet"` + `"Connect your Google Business Profile to see your local health.
   Once a reviews source is connected or imported, I show your listing health, NAP consistency, and
   review sentiment here. I never estimate any of these from other signals."` with a
   `"Connect Google Business Profile"` primary link. The 0/max scorecard no longer renders.
2. #4 - action returns the stable code `{ ok:false, reason:"no_eligible_today" }`; added a
   `no_eligible_today` row to REASON_COPY (kind `waiting_for_source`, NOT `unexpected_error`):
   title `"Nothing is queued for today yet."`, message `"I don't have a clean change to suggest yet.
   I'm still gathering data. Connect Google Search Console so I can see which pages to work on."`,
   nextAction `"Connect Search Console"`.
3. #12 - added `FRICTION_EVALUABLE_SESSION_FLOOR = 20` (mirrors the router's own floor, display-only)
   and count `evaluablePages`. When `evaluablePages === 0` the band renders the honest low-traffic
   line `"Not enough visits yet to judge page experience."` +
   `"I watched sessions on N pages from the last 28 days, but none has enough traffic to call yet.
   I will flag any friction as soon as one does."` The genuine "clean day" line now only fires when
   at least one page cleared the floor (and appends `"N with enough traffic to judge"`). Demand card
   untouched.
4. #13 - subtitle now reads `"Real monthly searches from keyword research where no page of yours is
   the answer today."` No rendered "DataForSEO". (One JSDoc comment at line 530 still says it - a
   code note, never rendered.)

**VERIFIED:**
- `npm run typecheck`: my 4 files are clean. One PRE-EXISTING unrelated error remains in
  `today-newpages-card-serp-copy.test.tsx` (PreparedSerpVerdict missing intent/generatedAt/costUsd) -
  a file I was scoped out of and did not touch.
- New render pins (renderToStaticMarkup, real HTML): `local/local-cold-tenant.test.tsx` (3),
  `war-room-cold-tenant.test.tsx` (4), + a `no_eligible_today` case in `operator-failure.test.ts`.
  All green.
- Affected suites green: operator-failure (10), design-system-guard (raw-palette ratchet holds at
  1297 <= 1298 baseline; no em/en dashes in primitives), clarity-move-router, local-presence-attention.
- PRE-EXISTING (not mine): `tests/lib/local-presence.test.ts` has 2 failures in
  `getLocalPresenceSnapshot`'s connector `last_synced_at` merge (a `src/lib/local-presence.ts`
  loader I did not edit); the /local page component reads that snapshot but does not compute it.

---

## 2026-07-07 - Issues #17, #8, #7: fix the winnability contradiction + kill "SERP"/"DataForSEO" jargon on the Today MoveCard

**Goal:** three trust fixes, all on the interactive §7 MoveCard. Scope:
`src/app/(shell)/today-moves-card.tsx` (+ new `today-moves-card.test.tsx`) and the twin
`SOURCE_LABEL` chip map in `src/app/(shell)/results/page.tsx`. Additive only.

**VERIFY-FIRST (each cited line confirmed before editing):**
- #17 (~line 580): the winnability block guarded only on `m.winnabilityLine` and branched on
  `m.winnabilityHeld`. The non-held (green "worth doing") line rendered even while the page was
  mid-measurement, contradicting the amber "This page is mid-measurement ... Wait for the read"
  banner above (line ~419). No measuring-state guard existed.
- #8 (line 118): `SOURCE_LABEL` mapped `dataforseo: "Live SERP"` (banned vendor acronym, rendered
  as a chip). Confirmed a twin map at `results/page.tsx:919` renders the same chip on Results.
- #7 (lines 503, 508): the research line rendered `(DataForSEO)`, the label `SERP rewards:`, and
  the raw `{rp.serpPattern.format}` slug (e.g. bare "table").

**What changed:**
- #17: gated the winnability line so the non-held branch is suppressed while measuring:
  `m.winnabilityLine && (m.winnabilityHeld || !(m.alreadyMeasuring || m.pageMeasuring))`.
  The amber held line (which agrees with "wait") still renders.
- #8: relabeled `dataforseo` to `"Live Google check"` in BOTH `SOURCE_LABEL` maps
  (today-moves-card.tsx + results/page.tsx).
- #7: dropped the `(DataForSEO)` parenthetical; relabeled `SERP rewards:` to
  `What Google is rewarding:`; added a `FORMAT_PLAIN` slug map (table -> "a comparison table",
  list -> "a scannable list", ugc -> "real user answers", faq -> "an FAQ", guide ->
  "a step-by-step guide", product -> "a product or shop page", mixed -> "a clear answer plus
  structured sections") applied to `rp.serpPattern.format`.

**Rendered proof (renderToStaticMarkup, text-only):**
- Chip: `Live Google check` (was `Live SERP`).
- Research line: `What Google is rewarding: a comparison table: add a comparison table near the
  top · winners: yelp.com` (was `SERP rewards: table: ...`); no `(DataForSEO)`.
- Mid-measurement + held: amber banner `This page is mid-measurement - shipping another change now
  muddies the proof. Wait for the read, or use "Ship anyway" below.` AND held line `so I am
  holding this.` (both agree with "wait").
- Mid-measurement + non-held: the green "worth doing" line is ABSENT (`includes("worth doing") ===
  false`).

**Tests:** new `today-moves-card.test.tsx` (18 assertions) pins the contradiction suppression, the
plain chip label, the plain reward wording, every format-slug mapping, and no "SERP"/"DataForSEO"/
banned-dash in the rendered card. Ran `npm run typecheck` (clean) + the card test with the four
guards (`no-banned-dash-display-surfaces`, `no-operator-jargon`,
`forbidden-customer-vocabulary-contract`, `design-system-guard`): 105/105 pass. Residual
"SERP"/"DataForSEO" in the card file (lines 496, 555) are comments only, never rendered.

## 2026-07-07 - Issue #6: kill the lab word "SERP" from the New Pages card (operator-facing)

**Goal:** the vendor/lab word "SERP" was reaching a paying customer as BUTTON text, a button
tooltip, a verdict-block label, and helper copy on the New Pages card. Replace every
operator-visible "SERP" with the plain "Google" framing the file already used elsewhere
(the "✓ Google checked" pill). Scope: `src/app/(shell)/today-newpages-card.tsx` ONLY, additive.

**VERIFY-FIRST:** grepped the file for `serp` (case-insensitive) before editing. The cited lines
were confirmed: line 425 rendered `SERP: {topDomains}`, line 479 the button label
`Checking SERP… / ↻ Re-check SERP / Validate with live SERP`, line 476 the `title=` tooltip, and
line 434 the helper strings `SERP budget cap reached. / No SERP result.`. The remaining `serp`
hits (lines 6, 11, 49-71, 416, 430-432, 475) are internal code identifiers (`serp`/`setSerp`
state, `serpPending`, `SerpValidationResponse`, `validateCreatePageWithSerpAction`,
`plainSerpReason`, the `serp-actions` import, one comment) - never rendered, so out of scope.

**What changed (4 operator-facing replacements, all in today-newpages-card.tsx):**
1. Verdict domain line: `SERP: …` -> `Top Google results: …`
2. Button labels: `Checking SERP…` -> `Checking Google…`; `↻ Re-check SERP` -> `↻ Re-check Google`;
   `Validate with live SERP` -> `Check live Google results`
3. Button tooltip: `Run a live Google SERP check (DataForSEO) and verdict this page…` ->
   `Run a live Google check and verdict this page…`
4. Helper copy: `SERP budget cap reached.` -> `Google check budget cap reached.`;
   `No SERP result.` -> `No Google result.`
   (The `DATAFORSEO_DRY_RUN` / `DataForSEO not connected.` strings on that line are a separate
   token, out of scope for issue #6, left untouched.)

**Pin test (additive):** `src/app/(shell)/today-newpages-card-serp-copy.test.tsx` renders the real
`NewPageCard` with `renderToStaticMarkup` (prepared-verdict fixture + no-verdict fixture) and asserts
`/serp/i.test(html) === false`, that the Google labels/tooltip render, and that no banned dash leaks.

**Rendered proof (renderToStaticMarkup):**
- BEFORE: `<button …>Validate with live SERP</button>` / `↻ Re-check SERP` / `SERP: site-one.com, …`
- AFTER: `<button title="Run a live Google check and verdict this page: build, wait, or skip">↻ Re-check Google</button>`,
  `Check live Google results` (no-verdict state), `Top Google results: site-one.com, site-two.com, site-three.com`,
  and the existing `✓ Google checked` pill. Zero "SERP" in the markup.

**Verified:**
- `npm run typecheck` -> EXIT 0 (clean).
- Targeted vitest (8 files, 119 tests, all pass): today-newpages-card-serp-copy (new, 5 tests),
  today-newpages-full-page-draft, today-newpages-summary, today-newpages-wiki-gap,
  no-banned-dash-display-surfaces, no-operator-jargon, forbidden-customer-vocabulary-contract,
  design-system-guard.
- design-system ratchet holds: raw palette classes in today-newpages-card.tsx still 22 (text-only
  edits touch no classes); baseline 1298 unchanged.

---

## 2026-07-06 - RANK-7: BACKLINKS link-gap engine (the "#1 ranking" half) + outreach feed

**Goal:** turn the already-built backlink reads + winnability arithmetic into a real link-authority
Move, and feed the fully-built-but-starved outreach pipeline its first backlink-gap signals.
VERIFY-FIRST, extend not rebuild.

**STEP 0 findings (the audit confirmed exactly):**
- `dataforseo-labs.ts` ALREADY reads referring domains (`runBacklinksSummary`, `parseBacklinksSummary`)
  through the shared money gauntlet (30d cache, dry-run default, fail-closed shared cap). Not a gap.
- `winnability.ts` ALREADY does the backlink-gap arithmetic (`theirAvg / ownCount`, `>50x` reject
  UNLESS difficulty `< 30`). Not a gap.
- `outreach/pipeline.ts` (mine-leads / draft-pitch / send-pitch) is FULLY built but was fed ZERO
  backlink-gap signals - `mineOutreachLeads` had exactly 3 sources (wiki_gap, keyword_gap_competitor,
  profound_citation).
- CONFIRMED: reads + arithmetic + outreach exist, but there was NO link-gap DETECTION trigger and the
  outreach pipeline got no backlink signals.

**What I built (deterministic over the existing $0 reads, no new paid pattern):**
1. `src/domains/link-authority/link-gap.ts` (PURE) - `computeLinkGaps` reuses `computeWinnability`'s
   backlink arithmetic: emits when a competitor RANKS (rank <= 20), you rank poorly (> 10 or absent),
   BOTH referring-domain reads are present, the multiple exceeds 50x, AND Google difficulty is not low.
2. `src/domains/link-authority/load-link-gaps.ts` (loader I/O, $0) - joins the cached keyword-gap store
   with `readAllCachedBacklinks` (NEW $0 cache-only helper in `dataforseo-labs.ts`, mirror of
   `readAllCachedKeywordDifficulty`) + cached difficulty. No fresh paid call, no cron phase (RANK-8
   owns nightly - noted as a follow-up if a durable snapshot is ever wanted).
3. `src/domains/link-authority/to-outreach-signals.ts` (PURE) - turns link gaps into the digital-PR
   outreach targets `mine-leads.ts` merges (new 4th `link_gap` lead source).
4. `triggers/link-gap.ts` (PURE) - emits `pursue_local_pr` (existing off-site authority action, so the
   registry stays at 40 and applyQueueRules routes it to diagnostic_only, promotion stays blocked -
   correct for a "build authority first" manual play). trigger_signal `link_gap`.
5. Wired the outreach feed: `OutreachLeadSource += "link_gap"` (text column, no migration),
   `computeOutreachLeads` gains an optional `linkGapTargets` (byte-identical when omitted),
   `mineOutreachLeads` loads + merges them, `sourcesChecked.linkGap`, pipeline.ts messaging.

**Quoted rendered copy (customer_copy, via renderToStaticMarkup in the trigger + diagnostics tests):**
> supplehomes.com ranks for "persian rugs" and their page has about 70x the links from other sites
> that yours does (210 referring domains to your 3). You likely cannot outrank them by editing the
> page alone here, so build authority first: earn a few strong links to this topic before you keep
> polishing the page.

**Empty-safe pin:** no warmed backlink cache OR gap within threshold => `loadLinkGapsForTenant` returns
`[]` => loader adds nothing => byte-identical to before RANK-7 (a content tenant is a complete no-op).
No outreach `link_gap` lead either. Pinned by tests in link-gap / load-link-gaps / trigger / compute-leads.

**Counter pins fixed (36 -> 37):** `PREDICATE_COUNT` in load-trigger-candidates-for-tenant.ts; the two
loader-test assertions + it()-title (predicates_run=37); the it()-title + two assertions in
recommendation-triggers-page.test.tsx (predicates_run counter reads 37, data-description-predicates-run="37").
New copy template `linkGapCopy` registered in the customer-copy-vocab PROBE_SETS.

**Verified:** `npm run typecheck` clean. Targeted suites all green: link-authority (3 files), triggers
(incl. link-gap), serp/dataforseo-labs (+readAllCachedBacklinks), outreach (all), copy-vocab,
predicate-purity, catalog-sync, registry-active-set, offsite-contract, design-system-guard, loader +
counters. Broad sweep `tests/architecture/` + `src/domains/recommendation-intelligence/triggers/` +
`tests/domains/recommendation-intelligence/` = 300 files, 5922 passed / 32 skipped. No live paid call in
tests, no dev server. Ratchet (design-system-guard) did NOT go up.

**Needs live DataForSEO backlink data to prove end-to-end:** the gap only fires once a real verdict run
has warmed the `bulk_referring_domains` cache for the competitor's AND the tenant's pages (the reads are
$0-cache-only by design). Also: the outreach lead currently names the competitor domain as the digital-PR
starting point; listing the ACTUAL high-authority referring domains linking to a competitor needs a
backlinks referring-domains-LIST read (the current cached read is counts-only) - a bounded follow-up.

## 2026-07-06 - RANK-8: nightly auto-scheduling of the built-but-orphaned DataForSEO AI-visibility poll

**Goal:** make the competitor-AI-visibility intelligence track itself nightly instead of only on an
operator click. VERIFY-FIRST, extend not rebuild.

**STEP 0 findings (the premise corrected by the code):**
- The per-prompt AI-engine poll (`runLlmPromptResponses` via `run-engine-poll.ts`) was ALREADY
  scheduled: `/api/cron/ai-engines` is registered in `vercel.json` (Mon/Wed/Fri 10:17), idempotent
  per UTC night, full gauntlet. Not a gap.
- `runHistoricalVolume` (seasonality) was ALREADY nightly: cron-sync PHASE 1d-3 (peak calendar) calls
  it every night for the top seasonal cluster heads, riding the 30d cache + dry-run + fail-closed cap.
  Not "ad-hoc-only". Left untouched.
- The REAL gap: `runLlmMentions` (the topic-level "which domains does AI cite for this TOPIC" producer
  in `dataforseo-llm-mentions.ts`) had ZERO callers anywhere in `src/` - no cron, no route, no action.
  Its 7d cache (`dataforseo-llm-mentions` store) is READ at $0 by FIVE surfaces (war-room AI band,
  team standup, coverage map, sov-weekly, second-order-citations) via `readAllCachedLlmMentions`, but
  NOTHING ever filled it, so those surfaces rendered permanently empty.

**Built (additive, respects every cost rail):**
- `src/domains/ai-visibility/run-topic-mentions.ts` - `runTopicMentionsForTenant`: picks the tenant's
  top demand-graph node labels (by fused `demandWeight`) as topics, passes real node queries as the
  question when present, and calls `runLlmMentions` through its full existing gauntlet. Adds the N43
  global breaker as the OUTER guard on the paid path (projected at worst-case = every topic a miss),
  fail-closed, hermetic under vitest. $0-when-inactive PIN: with DataForSEO unconfigured OR dry-run on
  (both defaults) it returns a typed no-op BEFORE reading the graph and BEFORE any paid path - never
  spends, never side-effects. Caps at `MAX_TOPICS_PER_RUN` (5; now exported); never throws.
- Wired into `cron-sync.ts` as isolated fail-soft PHASE 2a-m (after the teardown, before precompute),
  deadline-bounded like the other enrichment phases. Honest receipt added to the `cron_runs` notes:
  `{ topicMentions: { tenants, polled, skipped, costUsd } }`.

**Cadence + caps:** nightly, but the 7d per-(model,topic) cache means ~6 of 7 nights are $0 cache
hits; only an aged-out topic spends. Worst case 5 topics x $0.03 = ~$0.15/tenant on a refresh night.
Every rail respected, none loosened.

**Verified:** `npm run typecheck` clean. `npx vitest run` (clean shell) green:
- new `run-topic-mentions.test.ts` 14/14 (polls when configured+stale+affordable; $0 NO-OP +
  runMentions never called when unconfigured/dry-run; cache_hit/capped $0; breaker trip + breaker
  throw both fail-closed and hold the call; worst-case projection; topic cap; noise/dedupe;
  fail-soft on graph-throw and producer-throw; status mapping). All DataForSEO/ledger/breaker MOCKED,
  no live paid call, no dev server.
- affected suites: dataforseo-llm-mentions + cost-breaker + dataforseo-labs 86/86; budget-ledger +
  verify-budget-ledger + ops-pipeline-section + investigation-section + trend/seasonal surface-pins
  85/85; full ai-visibility folder 293/293.

**Needs a live DataForSEO account + cap headroom to prove:** with `DATAFORSEO_DRY_RUN=false` + a
configured key + a non-empty demand graph, one nightly run should populate the mention cache and light
up the five reader surfaces (expected first-night spend <= ~$0.15/tenant; subsequent nights $0 on cache
hits). Cannot be proven from this env (Google/Supabase/OpenAI keys only, DataForSEO in dry-run).

## 2026-07-06 - RANK-2: real dollar / revenue ROI on the export-a-win card

**Goal:** make "this change earned about $X a month" real wherever a value exists, and honestly say
"connect revenue to see dollars" where it does not. VERIFY-FIRST, extend not rebuild.

**STEP 0 audit finding:** the dollar system was already mature. GA4 revenue metric is pulled
(`runGa4RevenueReport`, `GA4_REVENUE_METRICS`, `revenue_unavailable` fail-soft). A per-tenant value
model exists (`business-config.revenueModel` = rpm | per_lead, edited in /settings/config). The honest
money math exists (`change-dollar-value.ts` returns `{usdPerMonth: null-when-no-basis, basisSentence}`;
`won-dollar-rule.ts` is THE ONE DOLLAR RULE for cumulative dollars). The cumulative-outcome strip
already renders `estimatedUsdPerMonth`. The genuine gap: the **export-a-win card** (`win-card.tsx` /
`report-model.ts` WinCard) showed only clicks a month, never the dollar figure a win already carries in
`dollarValue.usdPerMonth`, and never the honest connect-prompt.

**Built (additive, empty-safe, no invented numbers):**
- `src/domains/money/resolve-monthly-dollars.ts` - THE one pure money model: `resolveMonthlyDollars`
  returns `{usd, basis}` where usd is non-null ONLY with a real basis (`value_per_conversion` /
  `value_per_visit`; `ga4_revenue` reserved for a future measured-payout path). `groundedDollarLine`
  builds the celebratory line (always "estimate, not measured revenue"); `CONNECT_REVENUE_PROMPT` is
  the one honest ungrounded string.
- Wired into `report-model.ts` WinCard (`dollarLine` / `dollarPrompt`, exactly one non-null) and
  `win-card.tsx` (renders the grounded line or the prompt, tokens + ReceiptLine only).
- `reports-data.ts` resolves the tenant revenue model (same lookup as run-measurement / nightly pass)
  and threads it in; fail-soft to null (prompt) on any config error.

**PINS:** no value config + no per-change priced figure => no dollar figure anywhere, honest prompt
instead; a configured rate but a null-priced win => prompt, never a fake $0; negative/zero => prompt.

**Verified (no dev server; renderToStaticMarkup):**
- `npm run typecheck` green.
- New: `tests/domains/money/resolve-monthly-dollars.test.ts` (16), reports-render RANK-2 cases (3).
- Suites green: money+revenue+reports+results+proof-gsc dollar rules (254), tests/architecture (4810,
  design-system-guard + no-em-dash + jargon guards all pass), ga4 + recommendation-intelligence +
  jargon guards (1141).
- Grounded quote: "This change earned about $420 a month, based on your Search Console clicks and the
  value you set per lead. This is an estimate at your own rate, not measured revenue."
- Ungrounded quote: "Connect revenue or tell me what a lead is worth, and I will show these wins in
  dollars." (NO dollar figure anywhere on the ungrounded card).

**Needs operator input to light up live:** set a value per lead (per_lead) or per 1,000 visits (rpm)
in /settings/config, OR connect a real revenue source. Until then the win cards honestly show the
prompt. The config-driven path is proven fully offline; a truly-measured per-change GA4 purchase-
revenue basis (`ga4_revenue`) has no code path yet (that revenue lives page-level in `revenue_facts`).

---

## 2026-07-03 - R17 (P2 GSC depth pack): close R17b test gap + build R17c

**Goal:** finish R17 by (1) closing the R17b test gap and (2) building the genuinely-missing R17c
items, each EXTENDING the shipped GSC depth stack (weekly-dimensions store + fresh-tail + per-page
signals), never touching the daily `is_final` tables.

**STEP 0 audit finding:** the R17b v1 items were already built and wired end-to-end:
searchAppearance + device grain (136/268, `weekly-dimensions.ts` + sync + scoreboard expander),
fresh-tail settling lane (264, `fresh-tail.ts` + loader + scoreboard chart), back-of-results
register (428, `back-of-results.ts` + loader, on the keywords page + question universe), brand
split (265), ingestion-gap re-pull (266), striking portfolio (267), anonymized-query share (492).
The GAP was co-located tests: `fresh-tail.ts`, `back-of-results.ts`, and the weekly-dimensions
SYNC engine had none. R17c items 138 / 428 / 491+493 were genuinely unbuilt.

**R17b tests added (34):** `fresh-tail.test.ts` (13 - window math, empty-safe, and a source-scan
pin that the loader never references `gsc_daily_rows`/`gsc_daily_totals`/`is_final` and only writes
the volatile cache), `back-of-results.test.ts` (13 - band/floor boundaries, page collapse, brand
exclusion, cap, empty-safe), `weekly-dimensions-sync.test.ts` (8, via the DI seams - first-run
prior-week backfill, cadence no-op, fail-soft skips, partial-week-never-persists, tenant isolation).

**R17c built:**
- **428 country grain** - added a third bounded weekly request (`country` dimension, same egress
  discipline as device/searchAppearance) to `weekly-dimensions-sync.ts`; `GscWeeklyCountryRow` +
  `plainCountryLabel` (alpha-3 -> plain names, unknown codes self-hide, never a raw code) +
  `buildCountryLine` + `countryLine` on the lens; rendered in the scoreboard "How you show up on
  Google" expander. Copy: *"Most of your Google traffic is from the United States (82 percent);
  Iran is your second market (11 percent)."*
- **138 budgeted indexation sweep** - `indexation-sweep.ts` (pure select + copy) + loader that
  reuses `GSC_INSPECT_PER_RENDER_LIMIT` and the bounded `loadGscSignal` adapter (24h-cached URL
  Inspection, batch capped BEFORE any inspection - no raw loop, never past the cap). Only Google's
  explicit "no" counts; inconclusive -> checked but never "not indexed". Rendered on the keywords
  page. Copy: *"2 of your top 5 pages are not indexed by Google yet, so they earn no Google traffic
  no matter how good the content is. I will flag getting them indexed as the first move."*
- **491 footprint registry** - `buildGscFootprint` rolls up pages x distinct searches x total
  appearances from the per-page signal already synced ($0). Copy: *"Google shows 2 of your pages
  across 4 different searches, 5,000 times in the last 90 days. That is your whole Google footprint
  right now."*
- **493 Discover probe** - added an additive `searchType?: "web"|"discover"|"news"` param to
  `gscSearchAnalyticsQuery` (defaults "web", contract test stays green); `loadDiscoverPresence`
  does ONE Discover-typed read behind a new 12h volatile cache (`gsc-discover-probe`, registered in
  json-store mirror + GLOBAL_STORES). Self-hides honestly - a null/empty feed is cached and NEVER
  fabricated. Copy: *"Google Discover showed your pages 4,200 times in the last 90 days, bringing
  in 130 visitors. Discover is Google's phone home feed, a separate source from search."*

**Empty-safe pins:** every builder returns null / self-hides on no data (no country grain, older
snapshot, under a click/impressions floor, no batch, everything indexed, no Discover data). Never a
raw alpha-3 code, never a bare zero, never a fabricated Discover presence.

**Verified:** `npm run typecheck` clean. New + affected suites green:
`src/domains/gsc/**` + `src/lib/connectors/gsc/**` + contract + design-system-guard + catalog-sync
+ store-classification + no-banned-dash surfaces = **228 passed (16 files)**; research +
recommendation-intelligence consumers = **950 passed**. Both new surfaces rendered via
`renderToStaticMarkup` and copy quoted above. Design-system ratchet held (used `text-status-warning`
token, not raw `amber`, so raw-palette count did not rise). No dev server (per instruction).

---

## 2026-07-03 - P4 (measurement-rigor pack): audit + verification, no rebuild

**Goal:** complete P4 (the statistical-honesty items that make a proof verdict trustworthy) by
building ONLY the genuinely-missing items, each EXTENDING the shipped proof stack.

**STEP 0 audit finding:** all five P4 items were ALREADY built earlier today (R10a/R10b) and are
wired + rendered end-to-end. Each has a complete pure module, honest-absence guards, Beacon-voice
copy, a substantive test file, is computed in `run-measurement.ts` (or `load-ledger.ts` for the
ledger-wide FDR pass), fed to N10 via `gradeFromPresentation`'s `extras`, and rendered on
`/results/page.tsx`. Nothing was genuinely missing, so nothing was rebuilt (per the "extend, never
rebuild" instruction). Confirmed:
- **151 distinct-query growth** - `query-breadth.ts` (14 tests), win rows, `queryBreadth.sentence`
  rendered at page.tsx:1238, `breadthLine` in "See the math".
- **288 equivalence testing** - `equivalence.ts` (13 tests); computed in run-measurement (closed
  28d window, non-won, has Bayesian read); feeds N10 `provenNeutral`; rendered at page.tsx:1261.
- **289/291 FDR control** - `fdr-adjust.ts` (19 tests, Benjamini-Hochberg, name in comment only);
  applied at ledger load in `load-ledger.ts` (`attachFdrToLedger`); feeds N10 `fdrCaution`/
  `fdrPoolSize`; rendered at page.tsx:1245.
- **291 clean-window salvage** - `clean-window-salvage.ts` (15 tests); reuses the algorithm-weather
  shock ledger; rendered UNDER the weather caveat at page.tsx:1433.
- **378 novelty-decay flags** - `novelty-decay.ts` (9 tests); feeds N10 `noveltyDecay` (demotes to
  shaky); rendered at page.tsx:1315.

**Verified:**
- `npm run typecheck` - PASS (exit 0).
- Targeted P4 + N10 suites (query-breadth, equivalence, fdr-adjust, novelty-decay,
  clean-window-salvage, verdict-reliability, run-measurement): 160 passed.
- Full `src/domains/proof-gsc/` + `src/app/(shell)/results/`: 61 files, 961 passed.
- `tests/architecture/design-system-guard.test.ts` + `catalog-sync.test.ts`: 27 passed (design
  ratchet did NOT go up - P4 sentences render through the existing `<p className>` pattern).
- **Byte-identical-verdict pin:** verdict-reliability.test.ts explicitly pins that omitting the
  R10a/R10b `extras` yields grades identical to before the params existed (tests at lines
  328/334/439/473/504). A fresh/undecided tenant with no P4 extras wired gets byte-identical grades.
- **History never mutated:** `recordToRow` (shipped-change-store.ts:326) emits NONE of
  `queryBreadth`/`equivalence`/`noveltyDecay`/`cleanWindowLift`/`fdrRead`/`panelOutcome`/
  `earlySignal` - all computed-only, recomputed per measure, exactly the shipped `trafficOutcome`
  pattern. No em/en dashes in any P4 file.
- **Rendered copy quoted** (via renderToStaticMarkup, the exact page.tsx JSX shape):
  - 151: "This page now shows up for 13 more searches than before; the win is reach, not just rank."
  - 289: "This change genuinely did nothing, and I can prove that now; that is different from not
    knowing. The plausible effect sits between 3 fewer and 4 extra clicks a month, too small to
    matter either way."
  - 291: "With 5 changes measured at once, one or two will look like winners by chance; this one is
    close enough to that line that I am holding the champagne."
  - 152: "A Google update muddied 9 of these 28 days; on the 19 clean days this change is still up
    20 percent."
  - 378: "The first week jump faded. This looks like novelty, not a lasting win. Week 1 ran about 7
    extra clicks a day and week 4 is back to its old level."
  - N10 (proven-neutral -> solid): "I would treat this read as solid: this change genuinely did
    nothing, and I can prove that now; that is different from not knowing. The lesson still counts."

**Result:** P4 is complete and verified. No code changes were required (already shipped); this entry
records the audit + full re-verification of the shipped state.

---

## 2026-07-03 - R23 P21: Digest + memory pack (while-you-were-away + product-limits copy)

**Goal:** build the 2 buildable, non-email-gated operator-facing P21 pieces (v1 238 + v1 356).
All ADDITIVE, self-hiding, tokens/primitives only, no new env, design ratchet unchanged.

**What changed:**
1. **While-you-were-away block (v1 238)** - one honest catch-up line on Today for a returning
   operator. NEW `src/components/today/today-while-away.ts` (pure selector) + `today-while-away-card.tsx`
   (token-only card) + `src/app/(shell)/today-last-seen-store.ts` (tiny per-tenant last-seen
   store, server truth, fail-soft, registered in store-classification.ts as `today-last-seen`).
   Wired into `src/app/(shell)/page.tsx` under the lead headline: reads the last-seen mark, diffs
   the SAME canonical FP3 lifecycle counts (decided/won/toDo) the tiles + Results use, and stamps a
   fresh mark via `after()`. Self-hides on first visit / a refresh under 6h / a quiet return / an
   unknown last-seen. Won-clicks-a-month uses the SAME per-record window math as the lead headline
   (adaptProofRecordForLead), summed over changes that won since the last visit.
   Rendered copy: "While you were away: 2 changes finished measuring (1 won, up about 38 clicks a
   month), and 3 new opportunities appeared." A settled-but-none-won return: "1 change finished
   measuring (none won this time)." Opportunities-only: "2 new opportunities appeared."
2. **Product-limits copy (v1 356)** - honest "What I cannot do yet" surface. NEW
   `src/domains/settings/product-limits.ts` (registry) + `src/app/(shell)/settings/limits/page.tsx`
   (token/primitive page) + a row added to `settings-sections.ts` so it shows in the index + tab
   strip. Rendered copy includes: "I can push SEO fields like your title and meta description
   straight to Wix, but for full page content I draft it for you to paste."; "I do not send email
   digests yet."; "I measure results with your Search Console data, so calling a change a win or a
   miss takes a few weeks."

**Skipped/roadmapped (per P21 line):** v1 92 operator-taste memory (overlaps shipped P15 learning);
v1 230 weekly email digest + v1 358 trust-explainer page (email is RESEND-gated, methodology
deprioritized); v1 240 strategist history (roadmapped).

**Verified:** `npm run typecheck` clean. New tests: today-while-away.test.ts (12) +
today-while-away-card.test.tsx (3) + product-limits.test.ts (6) = 21 passing (render tests quote
the copy above). Affected suites green: today components (16 files / 134), design-system-guard
(ratchet held at 1298, my 3 new files add 0 raw palette), catalog-sync, customer-nav-exposure,
results-ledger-data, store-classification + routing (41). Count agreement confirmed: the block reads
`lifecycle.decided/won/toDo` from the single `loadLifecycleCounts()` call that also drives the
Results tile (line 469), the results-ready alert (line 225), and the measuring strip (line 468), so
"N changes finished measuring" equals the Results decided delta, never a contradicting count.

---

## 2026-07-03 - R23 P12: Push-depth pack (safer + more capable publish path)

**Goal:** make the EXISTING publish path safer + more capable, all ADDITIVE + SAFE. NO new env,
NO real external write, ALL Wix calls in tests MOCKED, NO live publish. The Ritz hard-block +
dry-run-default + daily/monthly caps + non-destructive assertion are PRESERVED and PINNED.

**What changed (4 NEW modules under `src/domains/push/`, all additive, no shipped-path callers yet):**
1. **Atomic multi-field bundle (v1 179)** - `push-bundle.ts`: `executePushBundle` stages MULTIPLE
   SEO fields (title + meta + schema) as ONE all-or-nothing unit with ONE receipt. Three phases:
   VALIDATE every field with `executePush({dryRun:true})` (side-effect-free) -> if any refuses,
   ABORT before a single write; COMMIT each for real; on a mid-way commit failure, ROLL BACK the
   already-landed fields via the existing `buildRevertEdit` -> `executePush` restore. COMPOSITION
   only: executePush stays the sole write authority; no rail is bypassed. BYTE-IDENTICAL PIN: a
   single-field bundle makes EXACTLY one executePush call and returns it verbatim (no dry-run
   pre-pass, no rollback machinery).
2. **Read-back verification tier (v1 393)** - `read-back.ts`: after a (mocked) push, re-read the
   field (`wixGetDataItem` / `wixGetStoreProduct`, READ-ONLY) and compare to what we sent. Pure
   `compareReadBack` returns verified / unverified / inconclusive; a mismatch is UNVERIFIED, never
   "live"; a read error is inconclusive, never verified. Fail-safe direction is always toward NOT
   claiming live.
3. **Per-URL cooldown (v1 465)** - `push-cooldown.ts`: refuses a second push to the SAME URL inside
   a window (default 6h), reusing the outbox's `pushed` rows (no new store), with an honest "I
   already published a change to /X today ... I can push again in about N hours". Pure
   `cooldownDecision`. BYTE-IDENTICAL PIN: outside the window (or no prior push) returns
   `{blocked:false}` and the caller proceeds unchanged; tenant-scoped; failed pushes never start a
   cooldown.
4. **Whole-day rollback readiness (v1 340/342)** - `rollback-plan.ts`: pure `planWholeDayRollback`
   turns a day's push ledger + snapshots into the EXACT reverse-ops to undo that day. It PLANS,
   never executes (operator-gated, like the per-edit revert). Restores the START-OF-DAY value when
   a field was pushed twice (collapses to one op); SKIPS empty-previous (would blank the field) and
   no-snapshot pushes (e.g. a create) with honest reasons. RITZ EXCLUDED (returns an empty excluded
   plan).

**PINS held (verified by tests):** `push-service-pins.test.ts` exercises the REAL executePush with a
MOCKED Wix client and proves (1) Ritz `tenant-ritz-founder` returns dev_note with NO write / NO
snapshot / NO reservation (even on a dry-run); (2) a dry-run returns before any adapter write,
snapshot, or reservation (uses the read-only cap CHECK); a real push DOES write; (3) an over-cap
reservation refuses before any write. Byte-identical pins covered in `push-bundle.test.ts`
(single-field) + `push-cooldown.test.ts` (outside window).

**Nothing was published.** No live publish ran; no dev server; every Wix call in every test is a
vitest mock; no new env; no cap/budget change.

**VERIFIED:** `npm run typecheck` clean. New suites green: push-cooldown (12), read-back (17),
rollback-plan (9), push-bundle (9), push-service-pins (6) = 53 new tests. Affected suites green:
all `src/domains/push/` (10 files, 105 tests incl. publish-outbox + stage-change); executePush-
adjacent (execution-actions, page-rewrite-actions, proof-revert-proposal, action-types,
production-line, change-pack-body-push = 81); provenance-surface-pins (23). No dashes in any
authored source or operator copy (dash-detection assertions aside).

**ROADMAPPED (rest of P12, untouched):** ground-truth field mapping (181), Wix Blog drafts (182),
Ricos serializer (343), reference fields (392), factory-page render audit (394), element-scoped
probes (466), publish windows (526), two-phase page creation (529), scope probes at connect (531),
external-edit flags (532), pre-bundle export (590), bulk endpoint (591). Wiring the 4 new helpers
into the shipped push receipt / worklist surface is a separate opt-in step (on their own they change
no behavior).

---

## 2026-07-03 - R23 P19: DataForSEO-depth pack (FREE, deterministic parts only)

**Goal:** build the $0 parts of P19 that compute over ALREADY-PERSISTED data with ZERO new paid
DataForSEO calls and NO cap/budget change. The paid items (108/114/124/252/364/365/418) stay
roadmapped.

**What changed (4 NEW pure modules under `src/domains/serp/`, all additive/empty-safe/deterministic):**
1. **difficulty-from-proof (v1 366)** - `difficulty-from-proof.ts` estimates how hard a page is to
   win from Beacon's OWN settled proof-ledger outcomes, bucketed by the Google position band the
   change STARTED in (top3 / striking 4-10 / deep 11+ / unranked). difficulty = (1 - winRate) x 100.
   NO paid difficulty read (the $0 companion to `winnability.ts`, which needs 3 paid reads). Below
   `MIN_BAND_OUTCOMES` (3) settled results in a band -> null + honest "not enough history yet" line.
   Rendered copy: "Of our own moves that started in striking distance (positions 4 to 10), 8 of 10
   won (80%), so this is a realistic win for us." Empty: "I do not have enough of our own results
   for pages in striking distance (positions 4 to 10) to say how hard this is to win yet. I need 3
   settled results in this range; I have 0 so far."
2. **rank-to-visits (v1 367)** - `rank-to-visits.ts` converts a rank move to expected monthly visits
   by REUSING the one canonical CTR curve (`forecast/tenant-ctr-curve.ts`), default or tenant-fitted.
   Rendered copy: "Moving from #8 to #3 is worth about 75 more visits a month, based on the typical
   click rate at each Google position." Empty: "I do not have a rank and monthly impressions for this
   yet, so I cannot put a visits number on it. Once Search Console shows both, I will."
3. **cost-reconciliation (v1 417)** - `cost-reconciliation.ts` reconciles ESTIMATED (call_count x
   SERP_PER_CALL_USD, pinned byte-identical to dataforseo-serp `SERP_COST_USD`) vs ACTUAL
   (`llm_budget_ledger` spent_usd) research spend, read-only over the ledger. Rendered copy: "I
   estimated $0.048 and actually spent $0.05 on live research this month." Empty: "I have not spent
   anything on live research yet this month, so there is nothing to reconcile."
4. **rank-distribution (v1 489)** - `rank-distribution.ts` buckets persisted GSC query positions into
   top 3 / striking distance / page two and beyond. Rendered copy: "Of 214 searches you show up for,
   38 are in the top 3, 71 are in striking distance, and 105 are on page two or beyond." Empty: "I do
   not have ranked searches for you yet, so there is no rank spread to show."

**Zero new spend confirmed:** no producer touched (dataforseo-serp gauntlet execution untouched);
NO cap/budget config edited; dry-run defaults unchanged; all four modules are read-side/pure over
persisted data. Ratchet unmoved (design-system-guard green; the renderToStaticMarkup proof used
tokens only, `text-meta text-muted-foreground`, no raw palette classes; no `(shell)` file changed).

**Verified:**
- `npm run typecheck` -> clean.
- New tests: `npx vitest run` on the 4 new `.test.ts` -> 30 passed (difficulty from a proof-history
  fixture + empty + band-scoping; rank-to-visits math vs known default CTR points 0.11@#3 / 0.034@#8
  + empty + no-real-move; cost reconciliation from a ledger fixture + empty + drift pin vs
  SERP_COST_USD; rank-distribution buckets + empty + band boundaries).
- Affected suites: `npx vitest run src/domains/serp src/domains/forecast/tenant-ctr-curve.test.ts
  src/domains/forecast/opportunity-math.test.ts src/lib/cost/verify-budget-ledger.ts` -> 458 passed
  (32 files); `tests/architecture/design-system-guard.test.ts` + proof-gsc store -> 25 passed.
- Rendered the four sentences (populated + empty-safe) via `renderToStaticMarkup`, token-only, all
  dash-free (verified programmatically). NO paid call, NO dev server.

**Roadmapped (paid, NOT built):** v1 108 AI search-volume column, 114 capped backlink radar, 124
task-queue routing, 252 depth-30 sweeps, 364 Trends wiring, 365 one gauntlet runner, 418 unlinked
mentions - all gated on a cap raise / new paid calls.

---

## 2026-07-03 - R23 P23: reports pack (export-a-win card + internal monthly report, INTERNAL-only)

**Goal:** build the two operator-facing "proof it worked" artifacts (v1 233 export-a-win card;
v1 257+575 merged internal monthly report page). Both COMPOSE already-computed proof-ledger data
(no new store, no new measure, no LLM); numbers must agree with /results and /changes.

**What changed (NEW `src/app/(shell)/reports/` island + one navigation title entry):**
1. **Report read-model** - `reports-data.ts` (`loadReportModel`, request-cached) reads the EXACT
   same snapshot /results reads (`loadResultsLedgerSurface`), and `report-model.ts` shapes it PURELY.
   Count agreement is by construction: bands + shipped/won/measuring/decided come from
   `computeCumulativeOutcome` (which calls `splitLedgerLifecycle`, THE ONE-COUNT RULE), the total
   clicks figure IS `outcome.winClicksPerMonth`, and the misses reuse `buildRecapItems` (the same
   items /results' "We got this wrong" renders).
2. **Export-a-win card (v1 233)** - `win-card.tsx` `WinCardView` renders one measured win,
   screenshot-ready, tokens/primitives only (Card/Pill/ReceiptLine). Per-win route
   `reports/win/[id]/page.tsx`. Self-hides via `WinCardEmpty`. Rendered copy (28-day win, +38/mo):
   "Measured win  28-day read  +38 clicks a month  on the persian comedians page, since we shipped
   the title rewrite on Jun 25.  From your Search Console data, measured against comparison pages you
   did not change, checked just now." Empty state: "No measured wins yet. Ship a change and I will
   show the first one here in a few weeks, once its full read comes in."
3. **Internal monthly report (v1 257/575)** - `reports/page.tsx`, operator-gated
   (`BEACON_OPERATOR_MODE`, same guard as /diagnostics) + `force-dynamic`, hidden from nav. Rendered
   headline: "This month I shipped 5 changes. Across everything I am tracking, 2 won, 2 are still
   measuring, and 1 did not move the needle." Misses line: "1 change did not move the needle. Here is
   what we learned." One miss item: "That one did not work: the meta description rewrite on
   /persian-singers. Here is what we learned: the full read showed the effect was too small to
   matter." Empty ledger -> "No changes shipped yet. Ship a move from your Changes list and this
   report fills in as its read comes back."

**Verified:** `npm run typecheck` clean. Tests: reports pack 22/22 (report-model count-agreement +
win-card shaping + jargon/dash guard + renderToStaticMarkup copy pins) all green; affected suites
green - design-system-guard (ratchet held at 1298; the 5 reports source files add 0 raw palette
classes, tokens/primitives only), catalog-sync, proof-jargon-guard, results-ledger-data,
cumulative-outcome, lifecycle-counts, results-recap, app-sidebar, customer-nav-exposure. Count
agreement asserted directly against `computeCumulativeOutcome` + `countLedgerLifecycle`. Needs live
data: real rendered numbers appear only once Iranopedia has a matured 28-day win (the code + copy are
proven via static render). No dev server used (route only proves live data).

## 2026-07-03 - R23 P10: entity + author (E-E-A-T) system (3 highest-impact Moves)

**Goal:** build the three highest-impact E-E-A-T Moves (v1 118+218, 243+263, 372, 507) that extend
the SHIPPED Wikidata/QID biography work into a sitewide entity + author trust layer. All
deterministic over data Beacon already has, English-first, tenant-agnostic, empty-safe.

**What changed (NEW `src/domains/entity/eeat-*` island + ONE new trigger file):**
1. **Sitewide entity + sameAs (v1 118/218)** - `eeat-entity-link.ts` `classifyEntityLinkGaps` +
   `composeEntityAboutSchema`. A content page whose own title/H1/H2 names an entity Beacon already
   resolved to a Wikidata QID (the shipped `wikidata-entity-cache`) but does not link it earns an
   `add_schema` Move with a ready-to-paste WebPage/about/sameAs block. Rendered copy: "This page is
   about Nowruz and 2 other things your page names, which Google already knows in its Knowledge
   Graph. I built the structured data that links your page to it. Paste it into the page so Google
   and AI connect your page to the topic." Composed JSON-LD validated by the scanner's own
   `validateSchema` (0 warnings).
2. **Author / reviewer Person byline (v1 243/263)** - `eeat-author.ts` `classifyAuthorGaps` +
   `hasVisibleByline`. A guide-shaped content page with no Person schema AND no visible "By <Name>"
   byline earns an `add_answer_block` DIRECTIVE (Beacon never invents a person's name). Empty when a
   byline / Person schema is already present. Rendered copy: "This guide page does not say who wrote
   it. Add a real author byline and Person structured data so Google and AI can trust who wrote
   this. A named, credible author is one of the strongest trust signals a content page can carry."
3. **Knowledge-Graph / brand presence (v1 372/507)** - `eeat-brand-presence.ts`
   `classifyBrandPresence` + `composeBrandEntitySchema` (reuses the shipped `buildEntitySchema`).
   Connector-free, cold-start-safe: reads only the site-root snapshot's schema. Honesty gate: the
   check abstains unless the homepage was actually crawled. Self-hides when Organization schema +
   sameAs are already present. Rendered copy (no_org_schema): "Google does not yet clearly know
   Iranopedia as a brand. I built the Organization structured data that names who you are and links
   to your site. Paste it into your homepage, then add your real profile links, so Google can lock
   in who you are."

**Wiring:** `load-eeat-signals.ts` is the ONE I/O boundary (reads the Wikidata cache + joins to the
already-loaded snapshots; NEVER calls Wikidata or an LLM). The ONE new trigger
`triggers/entity-eeat.ts` holds three PURE predicates. Loader runs the pack after the image-SEO
lane; the P10 schema cards SUPERSEDE a prior LOW-confidence generic `missing_schema` card on the
same URL (they are the stronger, customer-facing framing) while deferring to any medium/high card;
the author directive dedups by the finer dedupe_key so it can coexist with an answer-block directive
on the same page.

**Counter pins (all fixed):** `PREDICATE_COUNT` 30 -> 33 in
`load-trigger-candidates-for-tenant.ts`; both `predicates_run` assertions in the loader test (30 ->
33); the two `30` assertions + the it() title in `recommendation-triggers-page.test.tsx` (30 -> 33,
incl. the `>30<` regex and `data-description-predicates-run` + `30</span> active` prose pins). Repo
grep confirms no remaining `predicates_run`/`PREDICATE_COUNT`-adjacent `30`.

**Empty-safe pins:** each detector has an EMPTY-input test; the three predicates each have an
empty-input test; brand self-hides (null) when well represented AND when the homepage was not
crawled (honesty gate); entity gap empty when the cache is empty or the page names no known entity;
author gap empty when a byline/Person schema is present.

**Verify:** `npm run typecheck` clean. 49 new tests (11 entity-link + 11 author + 6 brand + 11
loader-signals + 6 trigger + 4 loader-integration) all green. Affected suites green together (69
files / 1207 tests): entity, demand-graph entity-schema, recommendation-intelligence (loader +
triggers + copy-templates), expected-schema, diagnostics recommendation-triggers page,
customer-copy-vocab, predicate-purity, page-classifier-applied, catalog-sync, design-system-guard,
no-banned-dash. 3 new copy templates registered with probe sets in the copy-vocab invariant. Rendered
copy quoted via `renderToStaticMarkup` (all first-person, concrete, next-step, no dash, no lab word).
No dev server (generation-path, operator-diagnostic feature). Design-system ratchet unchanged (no new
raw-palette shell surfaces).

---

## 2026-07-03 - R23 P5: team-deliberation pack (visible debate quality on the roundtable)

**Goal:** deepen the VISIBLE debate on the daily card so it reads like a real team argued the
decision, not "good keyword, do it." Built four deliberation lines onto the EXISTING roundtable
(`TeamRoundtable` in `daily-experiments-section.tsx`), each additive and self-hiding, derived
only from the SpecialistOpinions the team already emits (no new I/O, no LLM, no new score logic).

**What changed:**
1. **Agreement score (v1 387)** - `computeAgreement(opinions, winningAction)` in
   `src/domains/demand-graph/debate-summary.ts`. One honest line stating how much the team agreed,
   with the odd one out's worry named. Self-hides (line null) when <= 1 teammate could pick an
   action. Rendered copy (real review): "1 of 3 teammates agreed on this. The odd one out
   (Visitor behavior) worried about the page experience." / unanimous: "All 2 teammates who could
   weigh in agreed on this."
2. **Devil's advocate (v1 231/314)** - `devilsAdvocateLine(opinions)` in debate-summary.ts. States
   the single strongest case AGAINST (veto over downgrade), so every card shows the counter-argument.
   Rendered: "The skeptic's take: High on-page friction, fixing the experience first protects any
   traffic a content move would win." Self-hides when nobody argued against it.
3. **Falsifier (v1 312)** - `falsifierLine(proofPlan, action)` in
   `src/domains/experiments/team-review.ts`, from the proof plan's longest window + primary metric,
   verb agreeing with the metric's number, direction-aware (a friction fix should FALL). Rendered:
   "What would prove this wrong: if the click rate does not rise within 4 weeks, this was the wrong
   call and I will retract it." Self-hides with no proof plan.
4. **Quorum gate (v1 163)** - `worthALook` flag on `TeamReview` when exactly ONE teammate weighed in
   and nobody corroborated (never demotes a vetoed decision or a 2+-opinion Move). The card shows a
   "Worth a look" Pill + "Only one teammate had the data to weigh in here, so treat this as a lead
   to check, not a sure thing." instead of the confident agreement line.

All four persist on `TeamReview` (flows through build-daily-plan-record + build-today-preview
automatically; additive/optional so pre-P5 plans parse unchanged). Card touched with TOKENS ONLY
(raw-palette count in `daily-experiments-section.tsx` stays 0; design ratchet unchanged at 1298).

**Verified:** `npm run typecheck` clean for all touched files (only pre-existing
`src/domains/entity/eeat-*` errors remain, an off-limits slice, not introduced here).
Tests: debate-summary 22 pass (agreement math + self-hide on 0/1 voter, devil's advocate picks
strongest + empty when none, veto-over-downgrade), team-review 24 pass (falsifier copy + window/
metric/number/direction, quorum demotes lone-weak + leaves corroborated, no-dash across new
strings), roundtable render 11 pass (renderToStaticMarkup pins the agreement/devil's-advocate/
falsifier copy + Worth-a-look chip + byte-identical self-hide on absent/single-opinion review).
Affected suites green: move-router, specialist-opinions, daily-experiments-section,
build-daily-candidates, daily-plan, build-today-preview, team-scoreboard store + loader,
catalog-sync, design-system-guard, no-banned-dash-display-surfaces. Full architecture guard sweep:
219 files / 4731 pass.

---

## 2026-07-03 - R23 P17: read-path perf pack (request-cache the two hottest ledger reads)

**Goal:** make the /changes + cockpit render never-cold by cutting redundant DB
round-trips on the hot read path, BEHAVIOR-PRESERVING (rendered output byte-identical;
only read count changes). Survey first found the codebase already heavily optimized:
the cross-request Demand Graph SWR snapshot (candidate 1) is BUILT and tested
(`graph-snapshot-store.ts`; the New Pages board already reads `loadDemandGraphForTenantCached`,
so both surfaces share one build), and every heavy per-page loader (GSC RPC-aggregated,
GA4/Clarity/fanout/audits already `react.cache`-wrapped + column-projected) is done. The
one large residual was redundant reads of two stores per request.

**What changed (2 optimizations, both the blessed `react.cache` request-scope dedup, matching ga4-page-values / clarity-page-signals / fanout-seeds):**

1. **`loadShippedChanges` request-cached** (`src/domains/proof-gsc/shipped-change-store.ts`).
   A single /changes render read the proof ledger (`SELECT * FROM shipped_change_proof`)
   FIVE times per request: four learners inside the demand-graph build (win-rate prior,
   effect-size prior, page-outcome caution, dismissal do-not-repeat) plus the ActionPack's
   daily-experiment gate; the cockpit reads it again from scoreboard + stand-up + moves
   loader. Now one query per request. Split into `loadShippedChangesUncached` + a
   `cache()` export; the 32 call sites are unchanged.

2. **`loadDetectedChangepoints` request-cached** (`src/domains/proof-gsc/algorithm-weather-store.ts`).
   The cockpit read the shock-window blob from two components (cumulative-outcome strip +
   scoreboard) AND three times inside the graph build's learning gates. Now one read per
   (tenantId, now) per request.

**Why behavior-preserving:** `react.cache` is scoped to one React request/render, so every
caller in a render sees the exact same rows it would have read alone (deep-equal output);
outside a request scope (crons/scripts/tests) `cache()` is a plain passthrough, so the
nightly measurement + revert loops keep reading live. Audited every writer of the ledger:
NO code path does read -> upsert -> read-fresh within one request (server actions read once,
upsert, then `revalidatePath()` which starts a fresh request/cache); the measurement/revert
upsert loops run in cron scope where the cache is a no-op. The changepoint store's only
writer runs in the nightly cron, so no read-after-write hazard.

**Deliberately NOT done (risky / would change output / ownership):**
- Threading ONE shared ledger + shock-window read through the four graph-build learners
  (the fully-explicit, call-count-testable version) touches `src/domains/learning/**`, owned
  by another agent. Roadmapped for that owner: add a `LedgerLearningBundle` param.
- `react.cache` on `getLatestMoveDrafts` / `readAllCachedKeywordDemand`: NOT safe. Several
  callers (`serp-steal-lane`, `displacement-check`, `native-teardown-runner`) do
  read -> save -> read-fresh within one call and would get a stale cached map. Roadmapped:
  a render-only `getLatestMoveDraftsCached` variant (the raw/Cached split the graph loader uses).
- Collapsing `competitor-citations-loader`'s up-to-50k-row client-side aggregation into a
  Postgres GROUP BY RPC: needs a migration (Supabase DDL); roadmapped when in-window rows grow.
- Payload column-slim: owned loaders already project columns; the ledger's `SELECT *` maps
  every column via `rowToRecord` (narrowing it would break the additive-column PGRST204
  file-fallback), so no slim there.

**Identical-output pins:** `shipped-change-store.cache.test.ts` (6) - byte-identical
`rowToRecord` mapping, IDENTICAL output on repeat calls (deep-equal + `sortNewest` order),
file fallback + undefined-table fallback unchanged, ONE `select().eq()` round-trip per
invocation (the wrap never double-reads), 0-arg import surface intact.
`algorithm-weather-store.cache.test.ts` (6) - clicks+impressions merge + cross-series dedup +
honest-empty unchanged, IDENTICAL output on repeat calls, ONE `readStore` per invocation,
`react.cache` wrapper in place (arity-0 tell). Read-reduction proven: 4 ledger + 3 changepoint
reads in the graph build (plus the cross-surface duplicates) collapse to 1 each per request.

**Verified:** `npm run typecheck` clean; new cache suites 12/12; affected suites green -
`proof-gsc` + `demand-graph` + `action-pack` + `src/lib/persistence` (1107), `learning` +
worklist/results surface stores + `changes` (209), architecture guards incl. the design-system
ratchet (unchanged - no `(shell)`/component/token files touched) + tenant-scoped reads (22).
`learning/**` reverted byte-identical (out of ownership). No dev server (perf proven by the
identical-output pins + single-read-per-call assertions, not wall-clock).

---

## 2026-07-03 - R23 P8: AEO defense pack (zero-source opening, defend-a-cited-query, brand-description accuracy)

**What changed (3 deterministic $0 detectors over ALREADY-PERSISTED Profound rows; each additive + self-hiding when no data; no new API call):**

1. **Zero-source opening** (v1 ~192): a tracked question AI actually gets asked about where AI cites no one confidently yet (>= 10 observed answers and the strongest cited domain sits at or below 25% of the topic's citations, or there are no citations at all). A first-mover opening. `src/domains/aeo/detect-defense.ts` (pure) reads `profound_citation_rows` + `profound_visibility_rows` executions via `src/domains/aeo/load-defense-signals.ts`; predicate `aeo_zero_source_opening` in `triggers/`.
2. **Defend-a-cited-query** (v1 ~116/117): a competitor domain that was NOT cited in the prior capture NEWLY appears in the latest capture for a topic the tenant used to own or co-own (own domain cited in the prior capture). Detected from a real 2-capture citation-row history delta. Reference platforms (Wikipedia, Reddit, ...) and the tenant's own domain are excluded. Predicate `aeo_defend_cited_query`.
3. **Brand-description accuracy** (v1 ~255): from the tenant's own persisted brand-mention answers (`profound_answer_rows`, `own_mentioned=true`, `response_excerpt`), flags a deterministic industry-family contradiction (e.g. a restaurant guide AI describes as a hotel) against the tenant's business-config industry. Predicate `aeo_brand_description_check`.

**Rendered copy (renderToStaticMarkup, verified, no dashes, no lab jargon):**
- Zero-source: `On "best time to visit Iran", AI does not confidently recommend anyone yet across about 42 answers I checked. Publish a clear, quotable answer for this on your site now and you can own it before a competitor does.`
- Defend: `surfiran.com just started getting recommended by AI for "persian saffron", a question you used to own. Strengthen your answer block on this topic now, before they lock in the spot.`
- Brand-desc: `AI is describing you as a hotel, but your site says you are a Persian culture guide. Add one clear line stating what you actually are, high on your homepage, so AI has the correct fact to learn from.`

**Empty-safe pins:** each predicate returns `[]` with no site-root URL and no signals; the loader fail-softs to an all-empty bundle on any Supabase error or empty table (`load-defense-signals.test.ts`), and each detector returns `[]` on the absent-pattern fixture (`detect-defense.test.ts`, including a real 2-capture delta and a no-false-positive fixture).

**PREDICATE_COUNT:** 26 -> 29 (loader + both counter test files aligned: `load-trigger-candidates-for-tenant.test.ts` and `recommendation-triggers-page.test.tsx`).

**Verified:** `npm run typecheck` clean; 14 affected suites green in a clean CI-equivalent shell (340 tests) - new detector/loader/trigger tests (53), predicate-purity, copy-vocab (+3 probe sets), copy-sanitize-purity, catalog-sync, design-system ratchet (unchanged, no `(shell)` files touched), loader meta counter, diagnostics page counter, promotion-eligibility, safety-gates. Needs live Profound data on Iranopedia to prove real cards render.

---

## 2026-07-03 - R23 P15: Learning-depth pack (learn-from-dismissals + do-not-repeat, intent-dimension outcome prior pin, visible "Beacon learned" tile)

**What changed (the visible "Beacon learned" loop; 3 items; all decided-only + byte-identical when undecided):**

1. **Learn-from-dismissals + do-not-repeat** (`src/domains/learning/dismissal-learning.ts` PURE + `src/domains/learning/load-dismissal-signals.ts` I/O edge, wired as ONE post-pass in `demand-graph/load-graph.ts` after the existing priors): never re-suggests an exact thing already rejected (opportunity_dismissals) or already shipped/live (proof ledger) - keyed on the same coarse (moveType x page) cooldown key; and gently deprioritizes a KIND of move the operator keeps skipping (>= 3 dismissals, bounded [0.8, 1.0]). Reads only the dismissal + proof stores; raw MoveComponents never touched.
2. **Intent-dimension outcome prior** (v1 139): FOUND ALREADY BUILT + WIRED - `learning/experiment-prior.ts` (decided-only, >= 3, moveType/pageType/queryCluster backoff, clamp [0.85,1.15], byte-identical when undecided) applied at `load-graph.ts` line 566. NOT rebuilt (contract: resurrect/reuse). Pinned with a stacked zero-risk contract test (prior composed with dismissal-learning = identity on empty).
3. **Visible "Beacon learned" line** (`src/domains/insight/beacon-learned-summary.ts` PURE + `beacon-learned-tile.tsx`, wired self-hiding onto `/changes`): one honest sentence from the SAME decided-only outcomes the ranking learns from; reuses `computeDimPriors` win-rate math; self-hides below 3 decided.

**Rendered line (renderToStaticMarkup, verified):** "I've learned your answer-block changes win most often (4 of 5 measured), so I'm putting them higher. Your title and wording tweaks have not moved the needle (0 of 3), so I'm easing off them." Receipt: "From 8 of your changes that have finished measuring." Tile self-hides (renders empty string) below 3 decided outcomes.

**Byte-identical-when-undecided PIN:** a fresh tenant (no dismissals, no shipped/rejected keys, no decided outcomes) gets its moves back with the SAME array reference, same order, same scores; the tile renders nothing. Pinned in tests.

**Verified:** `npm run typecheck` (0 errors in touched files; one pre-existing unrelated error in `recommendation-intelligence/triggers/aeo-zero-source-opening.ts`, out of scope). Tests: dismissal-learning (11) + beacon-learned-summary (10) + beacon-learned-tile (3) all green; affected suites green - learning+insight+primitives (129), demand-graph (258), recommendation-intelligence (252), experiments learned-prior-surface-pins (13).

---

## 2026-07-03 - R23 P11: Technical-SEO pack (dead-URL-with-demand recovery, broken-link fixer + link liveness, redirect-chain + soft-404 hygiene)

**What changed (3 deterministic, empty-safe detectors surfacing real new fix-Moves from data Beacon already has - GSC + page_snapshots + the URL-inspection cache; new `src/domains/technical-seo/**` domain + one new trigger per item, wired LAST in the trigger loader with cross-source cooldown dedupe):**

1. **Dead-URL-with-demand recovery** (`technical-seo/dead-url-recovery.ts` + trigger `triggers/dead-url-recovery.ts`, `fix_status_code`, confidence medium): crosses GSC demand against snapshot 404/410 AND Google's URL-inspection coverage verdict (the `index_dropped` leg catches a 200 page Google's index treats as gone). Rendered copy: "Google still sends people to your /old-nowruz-guide page (200 times in the last 90 days, 8 of them clicked through), but the page now returns Not Found. Restore the page, or point this address at the page that replaced it, to stop the bleed."
2. **Broken internal links + link liveness** (`technical-seo/broken-links.ts` + `technical-seo/link-liveness.ts` + trigger `triggers/broken-links.ts`, `add_internal_link`, one card per source page): owned pages' own snapshot statuses give liveness at $0; an optional polite + capped (25) + fail-soft + mockable HEAD pass resolves external/unsnapshotted targets. Unknown targets are never counted broken. Rendered copy: "2 links on your /persian-food page point at pages that no longer exist. Fixing them keeps readers and Google moving through your site."
3. **Redirect-chain + soft-404 hygiene** (`technical-seo/redirect-hygiene.ts` + trigger `triggers/redirect-hygiene.ts`, `fix_status_code`): multi-hop chains (>=2 hops from the liveness pass) + soft-404s (authoritative Google `coverage_state === "Soft 404"`, sidestepping the JS-shell trap). Rendered copy: "Your /guides/old address points through 2 redirects before it lands. Point it straight at the final page so Google keeps the ranking and readers load faster." / "Your /persian-cities page loads with a normal response, but Google's index reads it as empty and treats it as a missing page. It still shows for 420 searches in the last 90 days. Put real content on the page, or send this address to the right page, so Google stops dropping it."

Supporting: pure assembly boundary `technical-seo/load-technical-inputs.ts` (snapshots + GSC + inspection map -> engine inputs, resolves/dedupes/self-links internal links, flags unknown targets + demand-carrying owned redirecting pages for probing); I/O boundary `technical-seo/load-inspections.ts` (reads ALREADY-SYNCED gsc_url_inspections rows only, never the URL Inspection API). 4 new customer-copy templates + vocab probe sets.

Wiring: 3 new predicates registered in `load-trigger-candidates-for-tenant.ts` (PREDICATE_COUNT 23 -> 26), one fail-soft block after the R19 content-lifecycle family; dead-URL runs first so it wins the recovery framing over R19's bad_status card; all three cross-source cooldown-deduped against the existing status/link triggers (a page an earlier trigger claimed never double-cards).

Empty-safe pins: every detector returns [] / null on empty input, below the 100-impression demand floor, all-live links, no chain / single-hop, healthy coverage, and unknown-liveness targets; broken-links suppresses everything when NO page has link data (data-unavailable, not "clean"); each trigger abstains on no findings. Ratchet holds (no `src/components/today/**`, `src/app/(shell)` files touched; no new UI surface).

Verified: `npm run typecheck` clean project-wide. `npx vitest run` technical-seo + triggers + loader + diagnostics-page + copy-vocab + trigger-predicate-purity + page-classifier + registry-active-set + gsc + pages/snapshots + catalog-sync + proof-gsc = 684 + 924 green (incl. 52 new detector/liveness/trigger tests: each detector fires on a fixture + is EMPTY on a clean fixture + no false positives, liveness mocked via injectable fetch; both stale predicates_run counters corrected 21 -> 26). renderToStaticMarkup quoted above. NEEDS LIVE DATA TO PROVE: a tenant with real GSC demand on a now-404/redirecting/soft-404 URL (dead-URL + soft-404 light up once the URL-inspection cache holds a gone/soft-404 verdict; broken-links + redirect-chain light up once the nightly liveness pass runs) - today they self-hide until such data exists. Rest of P11 (CrUX/PSI lane, lang/dir audit, URL-variant splits, freshness propagation, robots/sitemap drift alarm, X-Robots-Tag capture, schema-validator breadth, TTFB capture, pagination index policy, OG/Twitter capture, source-link rot) is roadmapped.

## 2026-07-03 - R23 P14: Today dashboard pack (lead headline, smoke alarm with page blame, goal pace / start-my-day, still-arriving shading)

**What changed (four additive, self-hiding Today blocks; all live in my owned `src/components/today/**` as pure selectors + token-only cards, wired into `src/app/(shell)/page.tsx` with data it already loaded, so no new raw-palette class lands under (shell)):**
- **Lead headline (v1 459/461)** - NEW pure `buildTodayLeadHeadline` (`today-lead-headline.ts`) composes ONE plain top-of-Today line: the biggest win this week PLUS the next move. Reuses the re-measured proof ledger, tonight's first pick, `today.attention[0]`, and the same 84-day scoreboard click series. `adaptProofRecordForLead` rolls each won record's latest CLOSED window `adjustedLift` to a monthly rate (the SAME math the cumulative-outcome strip uses). Rendered copy (real Iranopedia-shaped data): `Your biggest win this week: /farsi-numbers is up about 40 clicks a month. Your next move: Tighten the title on /persian-comedians.` It REPLACES the old single-signal `LeadStoryCard` in page.tsx (deleted with its raw-palette tone maps) so there is exactly ONE lead block, never two.
- **Smoke alarm with page blame (v1 324)** - NEW pure `buildTodaySmokeAlarm` (`today-smoke-alarm.ts`) names the single worst-bleeding page + the exact click loss from the SAME per-page GSC decay signal the war-room friction band reads, with a real floor (>=10 lost, >=25 prior) so noise never rings it. Deliberately does NOT re-raise the data-pipe alarm (OpsPipelineSection owns that). Rendered: `Heads up: /nowruz lost 18 clicks in the last 4 weeks. I have a fix ready.` (the "I have a fix ready" tail only when a change is queued for that page). Self-hides when nothing clears the floor.
- **Goal pace / start-my-day (v1 329/331)** - NEW pure `buildTodayGoalPace` (`today-goal-pace.ts`): the honest weekly pace read plus the concrete 20-minute ritual step, every number reused (shippedThisWeek = trailing-7d ledger tally; ready = tonightPicked minus tonightApplied; measuring = FP3 lifecycle count; weekly goal = shipped + ready, no new store). Rendered: `You have shipped 3 of your 5 changes this week. Two left. Start your day: open the top change on /persian-comedians, ship it, then check yesterday's numbers. About 20 minutes.` Ritual routes to tonight's plan / measuring results / planning depending on what is actionable, so it is never a dead end.
- **Still-arriving shading (v1 520)** - NEW pure `today-still-arriving.ts` (`readStillArriving` / `stillArrivingPhrase` / `StillArriving` pill) over the ONE shared `measurement-maturity` resolver: a number is "final" only at `mature_result`; every in-flight state reads `still measuring` (or `still arriving` for a blocked-on-Google window). Integrated into the lead win-lift: a win off a 7/14-day window renders `/singers is on track for about 39 clicks a month, still arriving.` instead of a hard number that will change. Standalone pill renders `still measuring, final read around Jul 18`; renders nothing (empty string) once mature.

**Verified:** `npm run typecheck` clean project-wide. Tests: 45 new pins (today-lead-headline 12, today-smoke-alarm 6, today-goal-pace 8, today-still-arriving 13, today-briefing render 6 quoting exact copy via renderToStaticMarkup) + full `src/components/today` (120) + `src/domains/changes` + design-system-guard + catalog-sync + today-smoke + today-empty-state-copy = 254 across the affected suites, all green. Ratchet: deleting the old LeadStoryCard's raw-palette tone maps dropped the (shell) total 1342 -> 1298; baseline lowered to 1298 in the same change (only ever goes down). End-to-end rendered copy quoted above (composed selectors -> cards via renderToStaticMarkup with realistic data). Empty-state pins: all four selectors return null on an empty tenant and the cards self-hide; `StillArriving` renders `""` when final. No banned em/en dashes. No new persistence, no migration, no shared read-model edits (lead-story.ts / session-flow.ts / measurement-maturity.ts read-only). NOT yet ground-truthed on the live dev server (compose path proven by unit + render tests; a live `/` render on tenant-iranopedia is the remaining check). The rest of P14 (touched-pages toggle, early-drift flags, bleeding band, YoY context, projection cone, revenue series, threshold crossings, workhorse leaderboard, question-mix trend, waiting-on-operator aging, weekday-adjusted brief, time-of-day ordering) stays roadmapped.

---

## 2026-07-03 - R23 P13: Worklist UX pack (rank explanation, honest minute math, word-level diff, not-now durations + re-draft)

**What changed (four additive Changes-list items, all byte-identical when the operator takes no new action):**
- **Rank explanation (v1 348/398)** - NEW pure `rankReasonAt(c, move, rank)` in `src/app/(shell)/worklist-row-helpers.ts` builds ONE plain sentence from the demand + winnability already on the change. Rendered on each actionable row in `changes-list-client.tsx`: e.g. `This is first because it has real demand (1.2k times shown on Google a month) and you can win it now.` Self-hides (null) when there is no concrete number to stand on. Drops the "you can win it now" tail when the change is quality-flagged.
- **Honest minute math (v1 592)** - `honestMinutesLabel(c)` (coarse honest buckets, no fake precision) replaces the raw `~5 min` chip with `about 5 minutes` (exact figure on hover); `sessionMinutesLine(changes)` renders the flat To do/Ready session total `Today's 3 changes: about 15 minutes.` using the SAME 5-minute fallback the "Tonight's 30 minutes" budget uses, so the two never disagree. Rolls into `about 1 hour 30 minutes` past 60.
- **Word-level diff (v1 349/397)** - deterministic dependency-free LCS `wordDiff(before, after)` + `resolveDiffPair` (prefers the prepared paste-ready value). New `WordLevelDiff` component renders a `See exactly what changes` disclosure: removed words struck through (`title="Removed"`), added words bold (`title="Added"`), plus the color-independent legend `Struck-through words go away, bold words are new.` Only for diffable edits (title/description/headline/answer) with a real before AND after.
- **Not-now durations + one-click re-draft (v1 350/351)** - new `NotNowMenu` replaces the bare `Skip` with an honest snooze menu (`Not now: remind me in a week` is the DEFAULT, matching the store's 7-day DEFER_DAYS exactly) plus `Redraft this instead` (opens the row detail, reaching the existing in-place Regenerate control). Every duration + the default route through the SAME `respondToRecommendation('deferred')` path the old Skip used and always advance the session (no dead end). Custom remind-date persistence is a shared-store follow-up (noted, not built).

**Verified:** `npm run typecheck` clean. Tests: 24 helper unit pins (worklist-row-helpers.test.ts) + 6 render pins quoting exact copy via renderToStaticMarkup (worklist-row-render.test.tsx) + existing changes-list session/ux3/changes-data suites + design-system-guard ratchet (still <= 1342, unchanged) + catalog-sync + no-banned-dash-display-surfaces = all green (130 across the 6 changes suites, +50 for catalog-sync/dash). Rendered copy quoted above. No banned em/en dashes. No new persistence, no shared read-model edits, no dev server, no migration, $0. Fixed one stale R20 source-pin in changes-list-client-ux3.test.ts (`useWorklistSession(visible)` -> the post-R20 `useWorklistSession(visible, {` shape the session test already asserts).

---

## 2026-07-03 - R24: campaign tail (prompts SSR title, Today deep link, N13 recrawl demotion, N47 primary-source, N48 expert-review)

**What changed (five additive rec-quality + polish items, all byte-identical when inactive where noted):**
- **Item 1 (prompts SSR title)** - `src/app/(shell)/prompts/[id]/page.tsx` now exports `generateMetadata` that reads ONLY `getTrackedPrompts()` (small table, no drilldown build) and names the actual question. A shared link / browser tab now reads `Best builders in the Bay Area for a whole-home renovation? - Beacon` instead of the root layout's generic `Beacon`. Falls back to `AI question not found - Beacon` on an unknown/invalid id, `AI question - Beacon` on a read error (never crashes the link).
- **Item 2 (Today deep link)** - `src/components/today/v2/today-v2-working.tsx` "View pending" repointed from the inert `/changes?tab=pending_implementation` (the canonical list reads `?status=`, never `?tab=`, so it silently opened the default view) to `/changes?status=ready`, which opens the exact accepted-but-not-live slice the label promises (canonical-change `statusView`: ready/apply/verify -> "ready").
- **Item 3 (N13 recrawl demotion)** - NEW `src/domains/recommendations/recrawl-demotion.ts` (pure `evaluateRecPrecondition` + `selectRecrawlDemotions` + `latestSnapshotByPath`) compares a rec's precondition against the LATEST page snapshot; when the fresh crawl proves it's already met (title/meta/h1 now read the proposed copy, schema type now present, named H2 now exists) it retires the rec with the honest note `You already fixed this. I retired it. Your title now reads "...".`. Wired read-time in `load-queue.ts` (reuses the page_snapshots read already there; retired rows become `expired` machine-hygiene status + honest `why`) and as a nightly runner `recrawl-demotion-runner.ts` mirroring `queue-sweeper.ts`. Byte-identical when nothing is resolved (selection returns []). No new lifecycle status, no migration.
- **Item 4 (N47 primary-source)** - `EvidenceLine` (in `src/domains/recommendation-intelligence/evidence-summary.ts`) gained optional `sourceUrl`/`sourceLabel`; the GSC headline-query bullet now carries the REAL Google search (`googleSearchUrlForQuery`), and `recommendation-v2-card.tsx` renders a clickable `See this search on Google ->` link on that bullet. Reuses the existing EvidenceLine shape (no parallel evidence system); byte-identical when a line has no sourceUrl.
- **Item 5 (N48 expert-review)** - `expert-verdict.ts` gained a pure lower-only `reviewExpertQuality` (specific number / concrete next step / no generic filler / no self-contradiction); wired into `buildRecommendationQaVerdict` (`recommendation-qa.ts`) so a rec that already cleared the confidence gate but reads like filler is HELD with the honest reason `I held this one back for review because it reads like generic filler... I want it to read like an expert wrote it before you act on it.` Reuses the existing recommendation-qa / expert-verdict gate (extended, not forked); passes through byte-identical on a clean rec, surfacing via the existing `confidenceReason` + status-override path.

**Verified:** `npm run typecheck` clean (zero errors outside the reserved run-autopilot.ts / domains/eval / domains/safety/canary files another agent holds, which have pre-existing in-progress errors unrelated to this batch). Tests: 131 across all R24 suites green (recrawl-demotion 15 + recrawl-demotion-runner 3 + expert-review-quality 9 + recommendation-qa 15 + evidence-summary 19 + recommendations-v2-card 31 + v2-qa-polish-bundle 13 + prompts-detail-force-dynamic 4 + prompt-drilldown-smoke 4 + design-system-guard ratchet still at baseline 1342). Affected suites green: recommendations + recommendation-intelligence = 179 files / 3102 pass / 2 skipped; page-surgeon + catalog-sync + prompts + today = 6 files / 28 pass. Rendered copy quoted above via renderToStaticMarkup + generateMetadata unit tests. No banned em/en dashes in new source. No dev server, no migration, no new env var, $0.

---

## 2026-07-03 - R22b: the eval / regression safety net (N36 gold library, N33 benchmark, N35 replay, N34 ablation, N37 synthetic journey, N42 model-fallback) + the R22a canary wire-in follow-up

**What changed (six deterministic eval pieces in a NEW `src/domains/eval`, all PURE, no live API, no spend, plus the one-call canary wire the R22a caveat flagged):**
- **N36 gold library** - `src/domains/eval/gold-library.ts`. 8 frozen, TENANT-AGNOSTIC synthetic fixtures, each a runnable `buildDemandGraph` input + the expert-correct decision (gap action, ship-or-hold, coarse rank band, dependency hold). One case per gap bucket (create_page land-grab, answer_block uncited, edit_page weak rank, fix_experience friction, healthy monitor, low_demand below-floor) plus an evidence-thin abstention hold and a technically-blocked dependency hold. Every threshold mirrors build-graph DEFAULTS so the expected bucket is the one the REAL scorer lands on. No real customer data.
- **N33 benchmark** - `src/domains/eval/benchmark.ts`. Runs the REAL pure pipeline (`buildDemandGraph` + `assessAbstention` + `planDependencies`) over the library and scores agreement on four axes (action, disposition, rank band, dependency hold). `runBenchmark()` returns `{passed, total, casesPassed, casesTotal, misses[]}`. Score on the gold library: **8/8 cases, 32/32 axes**. A regression is a score drop; the misses list names the case + axis that broke. Rank band is score-relative (>=50% of top = top, >=10% = mid, else bottom) so a non-regressing math tweak never reads as a false miss. Honest operator line: `"I checked myself against 8 known-good cases and got 8 right."`
- **N35 replay** - `src/domains/eval/replay.ts`. `replayDecisions(captured)` re-runs the current scorer over a captured decision set and flags any DIVERGENCE from the recorded action (deterministic diff, no network). `goldCapturedDecisions()` derives a self-contained baseline from the library; `replayGoldBaseline()` has **zero divergences** today. A tampered captured action is caught (test).
- **N34 ablation** - `src/domains/eval/ablation.ts`. Zeroes one signal at a time across the library and reports each signal's marginal contribution to correct decisions. Honest findings: **GSC demand drops 4 gold cases** (most load-bearing, feeds the demand floor), AI/competitor evidence drops 1 (the answer_block case), Clarity friction drops 1 (the fix_experience case), search volume drops 0 (redundant with GSC impressions on this library - an honest "not pulling weight here" result, not hidden).
- **N37 synthetic journey** - `src/domains/eval/synthetic-journey.test.ts`. ONE end-to-end integration test walking find -> abstention-hold -> prepare -> ship (canary) -> measure (citation outcome) -> learn (outcome prior) through the REAL pure modules, asserting the item threads coherently and no stage silently drops it (the ready item ships, the thin-evidence item is honestly held and never reaches ship, a win feeds the next-run prior).
- **N42 model-fallback benchmark** - `src/domains/eval/model-fallback.ts`. Declares the canonical fallback chain over the gateway's real models (primary gpt-5-mini -> escalation gpt-5.4-mini; each rung at/above `REASONING_TIMEOUT_FLOOR_MS`, reasoning_effort pinned low per the gpt5mini-timeout lesson). `validateFallbackChain` asserts well-formedness (>= 2 rungs, no repeat, positive timeout at/above the reasoning floor, reasoning_effort set); `decideFallback` is the deterministic fallback decision on SYNTHETIC outcomes and is LOUD by construction (`silent:false`, an operator-visible reason on every advance, and a stop-not-degrade when the chain is exhausted). No live call.
- **FOLLOW-UP canary wire (R22a caveat closed)** - `src/domains/autopilot/run-autopilot.ts` now calls R22a's composed `canaryHoldForBatch` (from `push/stage-change.ts`, which reads the live N43 breaker + dash-strips the copy) as the FINAL gate right after `decideAutopilotShips` and BEFORE the ship loop. On `held:true` it ships NOTHING and returns the plain `canaryHoldReason`; on a clean batch it is byte-identical (the ship loop runs untouched). Injected via a new `deps.canaryHoldForBatch` + `deps.getTenantDomain` (lazy-imported defaults so the autopilot module never statically pulls the push graph). Fail-safe: a gate error never blocks a healthy batch. NOTE: R22b's canary.ts is UNCHANGED from R22a (an earlier redundant pure helper was reverted); the wire reuses R22a's existing composed gate exactly as the caveat intended.
- **Optional operator surface** - new operator-only `/diagnostics/self-check` page (`force-dynamic`, gated) renders all four self-checks + the honest benchmark line. Diagnostics-only, never a primary customer surface.

**Byte-identical pins:** N33/N34/N35 are deterministic (identical report on a second run, test-pinned); N37 uses only pure modules; N42 has no live call; the canary wire returns held:false on a clean batch so the ship loop is unchanged (autopilot test "a clean batch ships byte-identically" + fail-safe test).

**Verified (tests only, no dev server, per task):** `npm run typecheck` clean project-wide. New tests: gold-library 5, benchmark 5, replay 4, ablation 7, model-fallback 13, synthetic-journey 2 (**eval domain 36 across 6 files**), + autopilot canary wire 5, + self-check page 2. Affected suites green together (eval + safety + llm + autopilot + push + self-check page + diagnostics architecture): **all pass**. Full suite run once as the final gate. No banned dashes in any new source (the only dash matches are the guard regexes in the tests).

## 2026-07-03 - R22a: four operational-safety primitives (N43 cost breaker, N41 publish outbox, N50 canary gate, T0d backup-verify)

**What changed (four bounded, deterministic safety primitives + their wire points; eval-train half N33-N37/N42 deferred to R22b):**
- **N43 GLOBAL cost circuit-breaker** - `src/domains/safety/cost-breaker.ts`. Sums the WHOLE `llm_budget_ledger` for the current UTC month (every tenant + platform) and trips CLOSED when the combined total crosses `BEACON_GLOBAL_MONTHLY_CAP_USD` (default 100; unset/NaN/<=0 resolves to the SAFE default, never unlimited). Belt-and-suspenders OUTSIDE the per-platform caps (never loosens them). Wired as the OUTER guard BEFORE the per-platform cap in BOTH paid entrypoints: dataforseo-serp `runSerpQuery` (new step 3.5, after the free cache/dry-run returns, via an injectable `deps.globalBreaker` that is hermetic under vitest) and the LLM gateway `openAIChatCompletion` (new `checkGatewayCostBreaker`, runs before `checkGatewayBudget`, applies to BOTH gateway_check and caller postures, hermetic under vitest unless a `costBreakerImpl` is injected). Reached only on the paid path, so it can never block free work. Fail-CLOSED on an unreadable/unknown total. Honest status line: `"I have spent $0.42 of my $100 monthly ceiling across all research."`
- **N41 idempotent publish outbox** - `src/domains/push/publish-outbox.ts`. Deterministic key per (tenant, target_url, change_hash, ship_date); `change_hash` is a sha256 of (action + element key + whitespace-normalized proposed text). Wired into `executePush` (push-service.ts) AFTER the Ritz hard-block + cap reservation + element-key resolution and BEFORE any Wix write: a same-day identical re-push short-circuits with the prior receipt (no second live write). Only a terminal `pushed` short-circuits (a prior FAILED attempt still retries). The 4 terminal `pushed` sites (create/seoData/field-edit/body-section) record the outbox via `recordLedger`. A dry-run has NO outbox side effect (audit #35). Byte-identical first-seen (returns `{seen:false}`, push proceeds unchanged). Fail-soft (read error -> seen:false, never blocks a legit push).
- **N50 canary gate** - `src/domains/safety/canary.ts` (pure `runCanaries`) + `canaryHoldForBatch` in stage-change.ts (composes the pure checks with the LIVE N43 breaker + tenant domain). Five deterministic invariants over a batch of prepared moves: no banned dash, no empty required field, no off-tenant URL, spend under the global breaker, >=1 evidence ref per move. Any failure HOLDS the WHOLE batch with one plain reason (`"I held tonight's batch: 2 drafts were missing a title or a target page. Nothing was published."`); a clean/empty batch is never held (byte-identical downstream). The arm/stage FINAL gate; only ever MORE conservative than the per-move rails.
- **T0d backup-verification receipt** - `src/domains/ops/backup-verify.ts`. Read-only pass: reads `json_store_blobs` (per-store newest updated_at), compares against `SUPABASE_MIRRORED_STORES` (now exported from json-store.ts), counts mirrored vs missing, flags stale (>30h). Writes ONE honest receipt (`"Backup check: 14 of 14 stores mirrored, newest 2h ago."` / owns gaps plainly). Wired as cron-sync PHASE 6 (final phase, after token-expiry), isolated fail-soft. Never mutates any mirrored store.

**New stores (registered in store-classification.ts GLOBAL_STORES + json-store.ts SUPABASE_MIRRORED_STORES, exactly once each):** `publish-outbox`, `backup-verify-receipts`.

**Byte-identical pins:** N41 first-seen key -> push proceeds unchanged; N43 -> reached only on the paid path (cache hit / dry-run / deterministic work never reach it), hermetic no-op under vitest; N50 clean/empty batch -> not held; T0d -> read-only, one receipt write only.

**Verified (tests only, no dev server, per task):** `npm run typecheck` clean. New tests: cost-breaker 17, canary 15, publish-outbox 13, backup-verify 12, gateway breaker +16 (existing gateway suite extended). Affected suites green together: safety + push + cost + ops + serp + llm/gateway + tests/domains/push = **75 files, 1137 pass**. Architecture + persistence guards green (**220 files, 4544 pass, 32 skip**), incl. two `tenant-isolation-exempt` markers for N43's and T0d's DELIBERATELY fleet-wide reads (a global ceiling / whole-mirror check by design; each aggregates to a scalar, no per-tenant data crosses a boundary). Two pre-existing push integration tests updated to reflect the new (correct) N41 short-circuit ordering. No banned dashes in any new source (the only dashes are deliberate test fixtures feeding the dash detector).

**Caveat:** `canaryHoldForBatch` is provided as the composed arm/stage final gate but is not yet CALLED by the autopilot batch runner (`src/domains/autopilot/run-autopilot.ts` was out of R22a's edit scope); adopting it there is a one-call follow-up. The eval-train half (N33/N34/N35/N36/N37/N42) is deferred to R22b.

---

## 2026-07-03 - R21b: wire the three R21 cores into the LIVE read/pipeline paths (dormant -> live, additive, byte-identical-when-inactive)

**What changed (wiring only; the cores + their tests shipped at 65022b87 and are unchanged):**
- **N49 abstention LIVE on /changes** - `src/app/(shell)/changes-data.ts`. New pure exports `abstentionEvidenceFor` (reduces a CanonicalChange + its source TodayMove to the three real-signal classes; GENEROUS so it never holds an evidenced row) and `partitionActionableByEvidence` (runs `partitionByEvidence` on ONLY bare `suggested` rows; every earned status - ready/apply/measuring/result/blocked - and every skipped row rides through untouched). Wired as the FINAL filter after dedupe/rank/freshness: a no-evidence suggestion moves to a watching state (removed from the confident list) and the held count surfaces via `heldForEvidenceLine` folded into the EXISTING `suppressedRowsNote` slot (FP2/FP9's note), never a second widget. Byte-identical when every suggestion is evidenced (held 0, `changes === fresh`).
- **N45 dependency holds LIVE in the nightly plan** - `src/domains/experiments/build-today-preview.ts`. Builds `DependencyCandidate[]` from `teamReviewed` (new exported `leverFieldToActionType` maps each daily lever to its canonical ActionType; `linkDetail.destinationUrl` threads the hub link), runs `planDependencies -> dependencyHoldLookup`, re-keys id->host-stripped-path, and passes it as the planner's already-supported `prerequisiteHolds`. A dependent is held with `prerequisite_pending` + plain sentence, surfaced verbatim in the R14a "Why not the others?" inspector. Byte-identical when the batch has no dependency (empty holds; the common case for content/link/answer levers).
- **N32 event caveat LIVE on /results (read side)** - `src/app/(shell)/results/page.tsx`. Loads the ledger via `loadExternalEvents` (deadline-bound, fail-soft -> []), builds per-row `eventCaveatById` (via `eventCaveatForWindow` passing the row's OWN `weatherCaveat` as `weatherSentence` for dedupe) and `eventMachineryFlagById` (via `eventReliabilityFlagsForWindow`). Threads `machineryOrCompoundFlagged` into the N10 `gradeFromPresentation` interference slot (the shock is NOT re-passed - N10 already has it via `weatherQuarantined`). New pure export `shouldRenderEventCaveat` renders the caveat ONLY when it differs from the weather line already on the card (a shock never prints twice). Self-hides on an empty ledger.

**Rendered copy (quoted from the passing tests):**
- N49 held line: "6 possible moves are waiting for more evidence before I recommend them." (and singular "1 possible move is waiting for more evidence before I recommend it.")
- N45 inspector line (renderToStaticMarkup of WhyNotOthers): "Build /hub first. There is no point linking to a page that does not exist yet."
- N32 non-shock caveat: "My data pipeline stalled between Jun 1 and Jun 4, so any result measured in that stretch was reading numbers that had stopped updating."

**Verified (tests only, no dev server, per task):** `npm run typecheck` clean for every file touched (the ONLY errors in the run are pre-existing in `src/domains/safety/cost-breaker.test.ts` - an unrelated `NODE_ENV`/ProcessEnv cast, untouched by R21b). Named suites green: changes + experiments + proof-gsc + recommendations + events + results + the two app-dir wire tests = **147 files, 2886 pass, 2 skipped**. New tests: N49 6 (hold no-evidence + pass evidenced unchanged + byte-identical + never-re-gate-earned + reads source-move + dash/copy), N45 4 (mapper + full chain renders prerequisite_pending + byte-identical-when-none + already-shipped-clears), N32 10 (wiring pins + non-shock renders + shock deduped to weather + self-hide empty/clean + dash). Updated 1 pre-existing planner-call source-scan pin to include the new `prerequisiteHolds` arg. No banned dashes in any new source. Jargon guard on /results green.

**Caveat:** N32's nightly persist writes the ledger; if the nightly pass has not run for a tenant, `loadExternalEvents` returns [] and every /results row is byte-identical (self-hides). Live ground-truth of the rendered caveats awaits a tenant with a persisted non-shock event.

---

## 2026-07-03 - R21: N32 external-event ledger + N49 calibrated abstention + N45 dependency planner (N31/N44 deferred)

**What changed (three pure cores + one store + additive surfacing, all extending shipped engines):**
- `src/domains/events/external-event-ledger.ts` (N32) - ONE honest-context ledger of the things that move rankings for reasons no single page edit explains. Four kinds, all auto-detected from signals Beacon already has: `google_update` + `traffic_shock` (RELABELED verbatim from algorithm-weather's shock windows, NEVER re-detected, so the two layers cannot disagree; a suspected shock inside a confirmed update is deduped away), `connector_outage` (deadman.ts stalled jobs / down site, dated from the last-known-good run), `own_site_change` (>= 2 DISTINCT pages shipped on one day; five edits to one page never trip it). `eventCaveatForWindow` DEDUPES against the weather guard: a window over a shock reuses `weatherCaveatSentence` verbatim (one sentence, never two), and only NON-shock overlaps (outage/cluster) surface this ledger's own caveat. `eventReliabilityFlagsForWindow` feeds N10 the shock as its EXISTING `weatherQuarantined` input (no double-count) plus a fresh `machineryOrCompoundFlagged` bit for the two kinds weather does not cover.
- `src/domains/events/external-event-store.ts` (N32) - GLOBAL + Supabase-mirrored json-store (`external-event-ledger`), latest-wins per tenant, 30-day staleness floor, empty-list-is-a-real-truth. Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts (SUPABASE_MIRRORED_STORES). Persisted nightly in cron-sync PHASE 1g2 (reuses the weather pass's totals; reads deadman + proof ledger per tenant; isolated try/catch; deadline-bounded; FREE, no LLM/paid call).
- `src/domains/recommendations/abstention.ts` (N49) - the Quality Constitution's law 2 made enforceable. A candidate is sufficient to recommend when it has AT LEAST ONE of {demand signal, competitor teardown, real GSC/behavior signal}; with NONE (a pure proxy guess) it is HELD in an honest "watching" state, never shown as a confident move. `partitionByEvidence` is the final-filter seam (byte-identical when every item is evidenced: held is empty, ready is the input in order). `heldForEvidenceLine` is the honest count surface. Distinct from the LLM-side specific-edit abstention contract (that gates a generated edit's packet; N49 gates whether a candidate deserves to be a move at all).
- `src/domains/experiments/dependency-planner.ts` (N45) - derives prerequisite edges between queued candidates: `fix_technical_block` (a content edit on a noindex/broken-status/canonical-elsewhere page, reusing R19's technical-demand signal), `build_hub_page` (an add_internal_link into a not-yet-built create_page in the same batch), `add_schema_first` (a table/FAQ/comparison whose rich result needs a pending add_schema on the same page). Holds a dependent with the planner's new `prerequisite_pending` ExcludedReason + plain sentence until its prerequisite ships; a dependent held by two edges is held once with the most-severe reason. Additive to daily-experiment-planner (new optional `prerequisiteHolds` lookup; byte-identical when omitted; new copy translation in daily-experiments-copy.ts).

**Rendered customer copy (Beacon voice, no lab words, no em/en dashes):**
- N32 outage caveat: "My data pipeline stalled between Jun 1 and Jun 4, so any result measured in that stretch was reading numbers that had stopped updating."
- N32 own-site cluster: "I shipped changes to 2 pages on Jun 20, so a result measured across that day mixes several changes together."
- N32 shock (deduped to weather's own wording): "Google shifted the whole playing field around Mar 10 while this was measuring, so I am reading this result cautiously."
- N49 watching state: "I do not have enough evidence to recommend this yet, so I am watching it and will bring it to you the moment a real signal shows up."
- N49 held count: "6 possible moves are waiting for more evidence before I recommend them."
- N45 technical hold: "Fix the indexing problem on /iran-flags first. Optimizing a page Google is told to ignore wastes the work."
- N45 hub hold: "Build /best-persian-restaurants first. There is no point linking to a page that does not exist yet."
- N45 schema hold: "Add the schema on /compare first. Without it this content will not earn the richer result in search."

**Verified (tests only, no dev server):** `npm run typecheck` clean project-wide. 140 new tests: external-event-ledger 57 (per-kind detection, dedupe vs weather, own-site distinct-page floor, overlap read, N10 no-double-count flags), abstention 34 (sufficiency rule per signal, watching/ready sentences, byte-identical-when-all-evidenced partition, count line singular/plural/zero, dash + lab-word scans), dependency-planner 34 (per-kind edge derivation, the three hold sentences, NO-false-holds on clean/already-shipped/cleared, collapse to most-severe, lookup adapter), plus 4 planner-wiring tests (prerequisite hold + plainReason + byte-identical-when-omitted) and 1 copy test. Affected suites green as a gate: proof-gsc + experiments + recommendation-intelligence + recommendations + events + persistence = 2834 pass, 2 skipped (149 files). No banned dashes in any new source.

**Caveat / deferred:** N31 solar-calendar rollover + N44 topic objectives DEFERRED to a later slice to keep this batch bounded (both are additive and independent of the three shipped here). N32's nightly persist is wired but not ground-truthed live this session (tests only per task); the READ-side surfacing (a /results row calling eventCaveatForWindow, and threading `machineryOrCompoundFlagged` into the N10 grade) and the N49/N45 live pipeline wire-in (partitionByEvidence into promote-to-queue; dependencyHoldLookup into build-today-preview's planDailyExperiments call) are the natural next steps - all three cores are proven correct and additive-safe, wiring them into the live nightly/read paths is the follow-up. No migration, no new env var, no paid call.

## 2026-07-03 - R19: N24 content-lifecycle (prune/merge/retire) + N22 JS-shell dual-fetch + N21 demand-first technical crawl

**What changed (four pure cores + a pure assembly boundary + three additive capped triggers):**
- `src/domains/lifecycle/content-lifecycle.ts` (N24) - pure classifier of every owned page into keep / improve / merge / prune / retire from stored signals. PINNED never-prune-with-demand floor (>= 30 impressions/90d = keep, however thin/unlinked/dated). prune = < 5 impr AND < 200 words AND zero inbound (abstains when the link graph is unusable) AND not recently published (sitemap lastmod within 90d). retire = a passed dated event (a year older than 2 years ago in title/H1/URL) with collapsed/near-zero demand. merge = a registry gsc_ranks conflict where the owner holds a >= 5:1 impressions share, carrying a PREPARED redirect target (the dominant page). Byte-identical when no page qualifies.
- `src/domains/lifecycle/js-shell.ts` (N22) - pure JS-shell SMELL heuristic: a demand page (>= 100 impr) with a title/H1 but a near-empty SERVER-HTML body (<= 40 words AND zero body-paragraph excerpts) = content is JS-injected and may be invisible to non-JS crawlers. Honest by construction: the copy says it detects the smell and to verify by viewing source, it does NOT run a headless render (out of scope without a browser).
- `src/domains/lifecycle/technical-demand.ts` (N21) - pure demand-first technical crawl over stored snapshot fields (http_status, robots_meta, has_canonical_mismatch): flags broken status / noindex / canonical-elsewhere ONLY on pages Google actually sends searches to (>= 100 impr). Complements the existing page-type-driven bad-http-status/canonical-mismatch/noindex triggers with demand-first copy.
- `src/domains/lifecycle/load-lifecycle-inputs.ts` - pure assembly boundary joining the ALREADY-LOADED snapshots + GSC page/decay signals + internal-authority inbound counts + sitemap lastmod + ownership registry gsc_ranks conflicts into the three engines' input shapes ($0, no new I/O).
- Three additive trigger adapters (capped, demand-ranked like buried-page.ts) wired LAST in `load-trigger-candidates-for-tenant.ts` behind a single shared authority read + cross-source cooldown_key dedup + one fail-soft block: `triggers/content-lifecycle.ts` (merge_pages, confidence low - TRIPLE-locked to diagnostic_only: generatorActive:false + no eligibility entry + confidence low; never auto-executes a prune/redirect), `triggers/js-shell-content.ts` (fix_page_experience, confidence low), `triggers/technical-demand.ts` (fix_status_code medium / fix_noindex + fix_canonical low as indexing directives). 8 new vocab-scanned copy templates in customer-copy-templates.ts.

**Rendered customer copy (Beacon voice, no lab words, no em/en dashes):**
- prune: "Your /old-thin-page page gets almost no Google traffic (3 times shown in 90 days), is very thin, and nothing links to it. Consider removing it or folding it into a stronger page so it stops diluting your site."
- merge: "Your /persian-cats and /persian-cat pages both target the same topic, and /persian-cats gets 90 percent of the traffic. Fold /persian-cat into /persian-cats and redirect it so all the authority points one way."
- retire: "Your /nowruz-2021 page is about something that already happened and barely gets searched now (4 times shown in 90 days). Consider retiring it or pointing it to a page about the current year so its links keep their value."
- JS-shell (N22): "Your /persian-cities page's main content only appears after JavaScript runs, so the page Google and AI crawlers first receive looks nearly empty. Some AI crawlers and older bots do not run JavaScript and may see an empty page. Open this URL with JavaScript turned off, or view its page source, and confirm the real content is in the HTML the server sends."
- noindex-on-demand (N21): "Google shows your /iran-visa page for real searches (340 times in the last 90 days), but the page tells search engines not to index it. That is likely a mistake. Remove the noindex tag if this page should be found."

**Verified (tests only, no dev server):** `npm run typecheck` clean project-wide. New unit tests: content-lifecycle core (32: prune boundaries + never-prune-with-demand floor + recently-published protection + abstain-on-null-inbound, retire passed-event/current-year/collapse, merge 5:1 gate + redirect target + dedup, dead-page-is-status-fix, byte-identical-empty, count reconciliation), js-shell (18: shell smell boundaries, demand gate, title/h1 gate, dead-page skip), technical-demand (22: robots noindex parse, broken-status incl. redirects, per-page co-carry rules, demand gate boundary), load-lifecycle-inputs (8: canonical joins, null-inbound, decay-collapse, lastmod normalization, gsc_ranks-only merge conflicts), and the three trigger adapters (content-lifecycle 8, js-shell-content 3, technical-demand 5: action types, confidence routing, demand-rank + cap, byte-identical-empty). Copy-vocab invariant extended with 8 new probe sets (all pass forbidden-vocab). Trigger-purity ratchet passes (3 new trigger files pure). Affected suites green as a final gate: 315 files / 5976 tests (src+tests recommendation-intelligence + architecture + linkgraph + ownership + provenance + the /diagnostics/recommendation-triggers page). Corrected a PRE-EXISTING stale /diagnostics predicates_run assertion (18 -> 21, matching the loader's PREDICATE_COUNT already at 21 since R18).

**Caveat:** live ground truth not run this session (tests only per task). PREDICATE_COUNT left at 21 (my 3 engines reuse the shared meta counter; the value is a cosmetic hand-maintained field). All three engines are byte-identical / self-hiding when their inputs are empty (pinned). No migration, no new env var, no paid call, no dev server. Nothing here ever executes a prune or a redirect - every card is a proposal on the operator-only diagnostic surface.

---

## 2026-07-03 - R18: N23 internal PageRank + click-depth + P7 entity auto-interlink + term-coverage grade

**What changed (three pure cores + a snapshot store/loader + three additive triggers):**
- `src/domains/linkgraph/internal-pagerank.ts` (N23) - pure iterative PageRank (damping 0.85, 20 iterations, dangling-mass corrected so rank sums to ~1), BFS click-depth from the inferred homepage, and strict inbound-orphan detection over the tenant's `page_snapshots` internal_links adjacency. Deterministic (sorted node order, fixed iterations). EMPTINESS GUARD: a zero-edge adjacency yields an empty result (never "every page is an orphan"), matching orphan-page.ts. Persisted per tenant via the new `internal-pagerank` tenant-scoped SWR store (`internal-pagerank-store.ts` + `internal-pagerank-loader.ts`), rebuilt nightly as isolated fail-soft cron PHASE 2a-s.
- `src/domains/linkgraph/entity-interlink.ts` (P7, v1 95/112) - pure: for a source page, finds OTHER owned pages whose OWNER topic (N2 registry, never a contender) is genuinely mentioned in the source's REAL stored body (topicTokens whole-entity match) but not yet linked, and proposes a contextual link on the topic words.
- `src/domains/linkgraph/term-coverage.ts` (P7, v1 411) - pure: grades a page's coverage against a demand-backed rubric (winner-consensus subtopics from the nightly gap verdicts + uncovered demand questions from the R11 question universe), naming the 3 biggest missing subtopics. EMPTY RUBRIC -> coverage=null (never graded as 0% off no data).
- `src/domains/linkgraph/load-linkgraph-triggers.ts` - the I/O boundary that assembles interlink candidates + coverage items from already-stored data ($0).
- Three additive trigger predicates wired into `load-trigger-candidates-for-tenant.ts` (18 -> 21 predicates), cross-source deduped by cooldown_key so no page emits two link cards: `buried_page` (add_internal_link; demand-gated orphaned or too-deep high-demand pages; dedupes against orphan_page), `entity_interlink` (add_internal_link to the owner; dedupes against internal_link_opportunity), `term_coverage_gap` (add_h2_section; ranking band 5-15 + coverage < 0.6 + a named gap).

**Rendered customer copy (Beacon voice, no lab words, no em/en dashes):**
- buried (no links): "Your /iran-visa page gets real Google demand (340 times shown in the last 90 days) but nothing else on your site links to it, so Google sees it as an afterthought. Add links to it from 2 or 3 related pages."
- buried (too deep): "Your /iran-visa page is 5 clicks from your homepage and gets real Google demand (340 times shown in the last 90 days). Important pages should be 2 or 3 clicks from home, so add a link to it from a page closer to the front."
- entity interlink: "This page talks about Nowruz traditions, and you already have a page for it (/nowruz) that this page never links to. Add a link on the words "Nowruz traditions" so readers and Google can find it."
- term coverage: "You rank around #8 for "iran visa", and the pages beating you all cover visa fees, processing time, and required documents while yours does not. Add a section on each to close the gap."

**Verified (tests only, no dev server):** `npm run typecheck` clean project-wide. New unit tests: internal-pagerank (16: convergence, mass-sum, determinism, BFS depth, orphan/inbound, emptiness guard, self-link/dedup, homepage override + structural inference), entity-interlink (14: whole-entity body match, owner-not-contender, already-linked skip, self-link skip, cap/rank, byte-identical empty), term-coverage (14: heading/body coverage, missing-label extraction + demand rank, empty-rubric null, near-dup dedup), store (5), stripAdditionLabel (4), buried_page trigger (9), entity_interlink trigger (7), term_coverage_gap trigger (13). Affected suites green as a final gate: 119 files / 1687 tests (src+tests recommendation-intelligence, demand-graph, changes, linkgraph, copy-vocab + trigger-purity + page-classifier-applied + diagnostic-source-and-copy invariants, store-classification). Copy-vocab invariant extended with 4 new probe sets; page-classifier-applied opt-out (`@no-classifier-required`) added to the 3 new predicates (inputs are pre-classified upstream). Trigger-loader test updated: predicates_run 18->21, forTenant calls 3->4 (the link-graph read).

**Caveat:** live ground truth not run this session (tests only per task); the `internal-pagerank` store is empty until the nightly PHASE 2a-s runs against a reachable database. All consumers self-hide / are byte-identical when the snapshot, registry, gap verdicts, or question universe are empty (pinned). No migration, no new env var, no paid call, no dev server.

---

## 2026-07-03 - R14b: P1 trust receipts slice 2 (receipts everywhere, see-the-math completion, named controls, spend joins, threshold registry, CSV export)

**What changed (receipts everywhere):** ONE shared receipt convention (`src/components/data/receipt-line.tsx`: pure `buildReceiptLine` + muted `ReceiptLine`, "From your Search Console data through Jul 2, checked just now.") applied to the 10 most trust-critical assertion sites: Today scoreboard clicks chart (through = the loaded series' own last day) + its AI citations count, the cumulative outcome strip on Today AND Results (newest `measuredAt` off the loaded rows; optional field added to CumulativeOutcomeRow), Today's counts tiles, Today's plan panel (plan's own createdAt, threaded server-side as `planReceiptLine`), the /changes ranked list (`ChangesView.receiptLine`, ranked-at + plan assembly stamp), the /results Measured outcomes band (already-loaded latestGscDate), the /keywords hero (newest row lastChecked), the /activity stream header, and the data-sources strip's all-healthy collapse (freshest sync). Loader field additions only; zero new reads.

**What changed (see-the-math completion):** the strip's dollar figure now opens (details/summary, same pattern as the cards) into the per-win rows it sums (`buildWonDollarBreakdown` in won-dollar-rule.ts, the EXACT same selection as the sum, pinned to add up) plus THE ONE DOLLAR RULE in one sentence (`WON_DOLLAR_RULE_SENTENCE`). Change rows with a SIZED forecast open a "See the math" disclosure with the opportunity-math inputs (times shown 90d, current position, curve basis) via `CanonicalChange.forecastInputs` + pure `buildForecastInputLines`; honest-fallback rows carry none.

**What changed (named controls on charts):** Sparkline gained a `comparisons` prop (dashed muted series, shared y scale, honest aria-label); /results loads the comparison pages' own daily series (first 8 rows, max 2 controls each, capped 16 paths, one extra bounded fail-soft read) and draws them dashed on each card's chart with the legend "Compared against /a and /b, chosen before shipping." (`controlsLegendLine`).

**What changed (spend-to-outcome joins):** /activity now composes llm_budget_ledger day rows (`readRecentSpendRows`, 30 days, capped 90, read-only) into plain "I spent $0.03 checking live Google results for 12 keywords. Every paid call is logged before it runs." stream rows (kind `spend`, plain purpose per platform, $0 rows never render, sub-cent reads "under a cent", deep link /settings/spend). The /results card expand shows its linked move's prep spend when > $0 ("Preparing this change cost $0.04 in checks.", from ActionPack.dataforseoValidation.costUsd via the existing proof-linker).

**What changed (threshold registry):** `/settings/how-i-decide` (new Settings section) lists every live decision threshold in plain words from ONE registry (`src/domains/settings/decision-thresholds.ts`) that IMPORTS the enforcing constants (measure.ts windows/floors incl. the 10 percent minimum-lift bar and the 1-in-20 by-chance bar, control floor, MIN_OUTCOME_SAMPLES, MIN_SETTLED_FOR_CALIBRATION, CTR-curve bucket floors, MAX_DRAFTS_PER_WEEK + $0.30 weekly writing ceiling, the $50 DataForSEO monthly cap + per-check cost, NIGHTLY_PROMPT_CAP); MIN_BASELINE_IMPRESSIONS / MIN_LIFT_FRACTION / MIN_CONTROLS_FOR_COMPUTED / DEFAULT_MONTHLY_CAP_USD gained `export` for it. A test pins registry values === source constants + the voice rules (no lab words, no dashes).

**What changed (CSV export):** "Download as spreadsheet" on /results and /activity via GET route handlers (`/results/export`, `/activity/export`) returning text/csv + attachment from the SAME loaders the pages read (results SWR snapshot; composed activity stream) - no new data sources. One shared RFC-4180 encoder (`src/lib/csv.ts`); pure row builders (`results-csv.ts` plain-word columns, `activity-csv.ts`).

**Tests:** 60 new across 10 files (receipt-line 10, trust-receipts 8, decision-thresholds 16, forecast-input-lines 5, csv 5, results-csv 3, activity-csv 2, activity-stream +2, cumulative-outcome-strip +5, sparkline +4), all green. Suites green: tests/architecture (219 files / 4526, ratchet 1342 held), tests/domains (268 / 3996), tests/app (71 / 793, after swapping an `items-baseline` class the /results jargon guard rightly flagged), src/domains colocated (447 / 7340), src app-shell + components + lib colocated (99 / 1031). `npm run typecheck` clean. Known pre-existing failure NOT from this change: tests/lib/connectors/ga4/revenue-report.test.ts (4 tests, token_expired, env/token-dependent; same file R12 recorded). No dev server (tests only, per task); $0 spend; no migrations.

---

## 2026-07-03 - R12: T0e new-site golden path (URL-first signup, resumable crawl, day-0 baselines, first-audit scorecard, stalled-signup rescue)

**What changed (URL-first signup):** new `/onboard` root page + `startFromUrl` action: one site address -> reachability probe (honest inline error on a dead/robots-blocked address) -> domain saved to the pending tenant (status-guarded, race-safe, same posture as saveBusinessProfile) -> per-tenant BusinessConfig persisted via the EXISTING deriveAndPersistTenantConfig -> business name filled from the site's derived name (else `deriveNameFromDomain`, only while still the placeholder so typed-beats-derived holds) -> bounded first look -> redirect `/onboard/done`. Auth callback now lands first-time signups on `/onboard`; the guided 4-step wizard is one link away and untouched.

**What changed (resumable crawl past the 18-page cap; absorbs session tasks 74/182):** new `src/domains/scanning/crawl-frontier.ts` + `crawl-frontier` store (GLOBAL rows carry tenant_id per the site-uptime-probes cron-fan-out pattern; Supabase-mirrored so the cursor survives Vercel lambdas). Init reuses in-process-scan's bounded discovery (helpers exported, not duplicated); each batch is hard-bounded (max 15 pages, 45s budget, 8s/request, 250ms delay, polite-fetch UA + robots respect) and upserts through the SAME extractor + dual-write with the SAME `page-<sha16>` ids, so re-runs are idempotent. Continuation: cron-sync PHASE 1d-2b (isolated fail-soft, includes pending_onboarding tenants, respects the enrichment deadline) + the on-demand "Keep scanning now" action on /onboard/done, until frontier exhaustion or the 150-page cap. Registry-write failure leaves the cursor untouched (clean retry, no orphaned snapshots); robots-blocked pages advance the cursor so the queue can never wedge.

**What changed (day-0 baselines):** `runFirstLook` orchestration (url-first.ts): after the first batch, seeds the tenant question library from crawled question-shaped titles/H1s/H2s/FAQ lines (tenant-question-library gained an additive `loadCrawl` seed source + "crawl" candidate tag; Profound > GSC > crawl priority) and runs the top 5 derived terms (biggest pages' cleaned titles) through the EXISTING DataForSEO SERP gauntlet (14-day cache, dry-run default, monthly cap - no new paid path). Receipts persist on the frontier state for the scorecard.

**What changed (first-audit scorecard + guided first win):** `/onboard/done` composes `composeFirstAuditScorecard` from the crawl's compact page facts at $0: honest progress line ("I have read 45 of about 120 pages so far. I keep going in the background."), gap counts (missing titles/descriptions, thin pages, questions answered), the deterministic first-win ladder (no title on a real page > homepage missing description > biggest page missing description > thin page > missing H1) with concrete numbers, the skippable Connect Search Console card (reuses getGoogleAuthUrl; property auto-detect via the existing pickGscPropertyForDomain www-insensitive ladder), Keep scanning, pre-launch next steps, and the shared R3 FinishSetupCard. Unreachable site renders a clear sentence + Try again (force re-look), never a blank screen.

**What changed (stalled-signup rescue):** `src/domains/onboarding/stalled-signups.ts` (pure classification: pending > 24h with no URL / no scan / unreachable / wedged scan; moving and completed scans stay quiet) + a self-hiding /diagnostics section with per-row plain problem + exact fix (recovery-map conventions) and one-click resume (bounded first read or one more batch; operator-gated, no status flips).

**Tests:** 47 new (20 crawl-frontier: resume math, batch page+time bounds, link discovery under cap, robots/registry failure postures, idempotent ids, honest copy; 12 first-audit: question/term derivation, first-win ladder, scorecard math; 5 url-first orchestration incl. fail-soft baselines; 5 stalled-signup classification; 5 /onboard/done render pins across scorecard/unreachable/empty/complete/launched states). Updated contracts: auth-callback redirect pin (URL-first), onboard language sweep covers the 4 new surfaces (test files excluded from the walk). Suites green: tests/architecture (219 files / 4526 tests), scanning + onboarding + onboard app + finish-setup + question-library + cron-sync pins + persistence (~380 further targeted tests). `npm run typecheck` clean. Known pre-existing failure NOT from this change: tests/lib/connectors/ga4/revenue-report.test.ts (4 tests; imports only ga4/data-api, untouched here). No dev server (tests only, per task); $0 spend; no migrations (the Supabase mirror rides the existing json_store_blobs table, registration only).

---

## 2026-07-03 - R14a: P1 trust receipts slice 1 (/activity, verdict revisions, we-got-this-wrong, why-not-in-plan)

**What changed (/activity):** new nav route `/activity` (system group beside Connections/Settings; customer-nav contract test updated in the same change) - ONE reverse-chronological stream composed from EXISTING stores only, no new writes: shipped proof-ledger rows with WHO shipped them (a pushed autopilot ship receipt on the same page + day reads "I shipped ... myself", everything else "You shipped ..."), plan accept/abandon stamps from the daily-plan store, cron receipts under their plain schedule-map names (raw job keys pinned to never render), repeated failures ONLY above the existing error-spike floor (10 in 24h, one row), and connection events off connector token stamps (connected_at while live, auth_failed_at as "needs a reconnect"). Pure composer `src/domains/activity/activity-stream.ts`; deadline-bounded loader (5s per source, 15s page, HonestDelay past it); paged 50 with Newer/Older; honest EmptyState. Every row: when, what, one plain sentence, deep link (`/results#proof-<id>` via a new stable card anchor, `/#daily-experiments`, `/settings/health`, `/diagnostics/errors`, `/settings/connectors`).

**What changed (verdict revision history):** `ShippedChangeRecord.verdictRevisions` - APPEND-ONLY `{at, from, to, reason}` entries written at the measureRecord seam ONLY when a RE-measurement changed the stored verdict (first measurement = announcement, unchanged verdict = no entry, operator override named as "you set this result aside from learning"); past entries never rewritten. PERSISTED (unlike the computed attachments): `verdict_revisions jsonb` migration applied + verified on beacon-main (vlxwevsdvwxvopkjsewo) via the management connection; pre-migration environments keep the PGRST204 file-fallback posture. Rendered in the /results card expand: `I first called this a win; the 28-day read on 2026-07-19 revised it to no clear effect.`

**What changed (we got this wrong):** self-hiding `/results` section below the three bands (before "What Beacon has learned"): revised-DOWNWARD verdicts (rank won > undecided > lost) with `I called the description change on /persian-cats a win too early and took it back. Here is what changed: the 28-day read on 2026-07-19 showed no clear effect.` plus proven-neutral (equivalence) rows with `That one did not work: the description change on /persian-cats. Here is what we learned: ...`; max 5, newest first, each linking its own card anchor.

**What changed (why not in plan):** `DailyExperimentPlanRecord.excluded` (additive optional, JSON-column store so zero schema change) freezes the planner's OWN ExcludedExperiment rows at preview-build time, capped 8 with plain-sentence holds (interference/last-clean-donor/query-overlap) first; content-addressed plan id unchanged by exclusions. The daily card gains a quiet `Why not the others?` expander rendering plainReason verbatim or the new EXCLUDED_REASON_COPY translation (every ExcludedReason code covered, raw codes pinned to never render). Zero new selection logic - pure surfacing.

**Tests:** 58 new across verdict-revisions (append-once/idempotent-per-change/override reason), activity-stream composition (all five sources, who-shipped, plain cron names, spike floor gating, invalid-date drops, paging), results-recap membership + rendered copy, activity-list render pins, daily-plan exclusion freezing (cap 8, plain-first, id-stable, absent-when-empty), excluded-reason copy coverage, WhyNotOthers render pins. Affected suites green: results+proof-gsc (55 files / 886), experiments+ops+activity (48 files / 700), tests/architecture incl. design-ratchet at 1342 + updated customer-nav contract (219 files / 4505), ops+autopilot dirs (188), section/copy pins (145). `npm run typecheck` clean. No dev server (tests only, per task instruction); one additive migration applied; $0 spend.

---

## 2026-07-03 - R13: N3 claim-level provenance graph (substrate for N25/N26/N27)

**What changed (the claim model):** new pure `src/domains/provenance/claim-graph.ts` - a `ClaimRecord` per factual claim: stable id (fnv-1a of normalized claim text + subject key), claimText, subject (distinguishing topic tokens, 2-token floor), value (number / date / is-a definition name / free), sources (`page_extract | teardown | operator | correction_evidence`, each with ref + observedAt + RULE-BASED reliability: operator input high, dated authoritative domains high (wikipedia/britannica/.gov/.edu), competitor pages medium, own stored pages medium, undated ALWAYS low), firstSeenAt/lastConfirmedAt, affectedPages (owned pages whose stored text contains the value + 2 subject tokens), volatilityClass (the N27 seed: dates/years fast, counts slow, definitions static), status (`conflicting` when two sources or records on the same subject carry MATERIALLY different values - numbers more than 5 percent apart or differing dates, never punctuation/formatting; `consistent` when confirmed by 2+ sources or one high-reliability source; `unverified` otherwise). This generalizes the N8 factual-entailment primitive; extraction is bounded and narrow (sentences with a number, a date, or an is-a definition; one claim per sentence; 25/page, 500/tenant, highest-GSC-traffic pages first).

**What changed (extraction + rebuild):** `claim-graph-loader.ts` reads page_snapshots body samples + card texts + FAQ answers for the top-60-traffic pages, attaches dated teardown sources from the competitor-audit cache (attach-only: a teardown confirms or disputes an OWN-page subject, it never fills the cap with facts about pages we do not own; ambient-tenant-gated in the cron fan-out so it can never misfile cross-tenant), merges prior rows (firstSeenAt stable; operator/correction-backed claims survive traffic rotation), persists to the new `claim-graph` store (GLOBAL classification + Supabase-mirrored), rebuilt nightly as isolated fail-soft cron phase 2a-r. SHIP SEAM: `registerShippedDraftClaims()` fires (fail-soft, never blocking) from `stage-change.ts` after a push lands - the shipped draft's checked facts register with operator sources, and the N8 entailment check re-runs so any dated correction finding attaches as a correction_evidence source.

**Surfaces (small, integrated):** (a) the daily card's "How we know" expander gains one provenance line per claim the draft leans on (capped 3, conflicting claims excluded), via `DailyEvidenceBrief.claims` wired in build-today-preview - pinned lines: `From your /iran-flags page, confirmed Mar 2026.` and `From britannica.com, seen 3 weeks ago.`; (b) owned-page conflicts feed the existing trigger pipeline as `claim_conflict` -> `watch` candidates (capped 3, medium confidence, no promotion-eligibility entry so it can NEVER auto-push) - pinned sentence: `Two of your pages disagree about the year Persepolis was built (515 BC on /persepolis, 518 BC on /iran-history). Pick one and I will keep them consistent.` (the N26 seed); (c) operator `/diagnostics/provenance`: counts by status + volatility, the full conflicting list, a 25-claim sample with source lines.

**Tests:** 66 new in src/domains/provenance (extractor fixtures incl. BC dates + token floors, materially-different rule incl. the 5 percent band + thousands-separator never-conflict, reliability rules, cap ordering highest-traffic-first, volatility defaults, prior-merge + operator-source survival, registration + correction attach, pinned surface lines, byte-identical-when-empty at the evidence seam, dash guards) + surface pins at every consumer seam + 2 probe rows in the copy-vocab invariant. Verified: `npm run typecheck` clean; provenance (66), drafts+push+copy-vocab+json-store-routing+stage-surfaces+citability-pins (234), experiments+design-guard+dash-guard (556), demand-graph+changes+team-pins (351), recommendation-intelligence (187), trigger/vocab/diagnostics architecture guards (75) all green. No dev server (tests only, per task instruction); no migration, no new env, $0 spend. Ground-truth caveat: the live Iranopedia graph build was not run this session (store fills on the next nightly sync); N25 stale-fact detection, N26 fact propagation, and N27 volatility deadlines ride this substrate in the follow-up slice.

---

## 2026-07-03 - R10b: P4 measurement rigor slice 2 (distinct-query growth, equivalence, FDR, clean-window salvage)

**What changed (v1 151, distinct-query growth):** new `src/domains/proof-gsc/query-breadth.ts` - counts distinct queries with >= 1 impression on the treated page over two EQUAL-LENGTH windows either side of the ship (never 28d baseline vs a 7d basis, which would bias the count by window length) from gsc_daily_rows' page+query grain, bounded + paged with an honest null on row-cap truncation (an undercounted distinct set is not a count). Attaches `queryBreadth {before, after, kind: broader|deeper|flat}`; the win card renders the reach sentence ("This page now shows up for 18 more searches than before; the win is reach, not just rank.") or the depth one; the raw before/after counts always sit in "See the math". Presentation only - never the verdict, not an N10 input.

**What changed (v1 289, equivalence):** new pure `src/domains/proof-gsc/equivalence.ts` - once the 28 day window closes on a NON-win with a Bayesian read (item 67), checks whether the whole 90 percent plausible range sits inside the too-small-to-matter band (under 5 percent of baseline monthly clicks AND under 10 clicks/month, strict boundaries; smallSample or zero-baseline = honest null, a thin sample proves nothing). Attaches `equivalence.provenNeutral` + the honest close ("This change genuinely did nothing, and I can prove that now; that is different from not knowing."). N10: a proven-neutral 28 day read grades SOLID through the "inconclusive" maturity (the whole point - the lesson is reliable even though the change did not win), never rescuing any shaky disqualifier (contamination/weather/thin traffic still demote first); gradeAllowsLearning doc updated for the one deliberate widening.

**What changed (v1 291, FDR):** new pure `src/domains/proof-gsc/fdr-adjust.ts` - the pool-wide step-up adjustment (the method name lives only in code comments, never on a surface) at 10 percent across all mature win rows, applied at the loadProofLedger choke point (the only place every simultaneous measurement is in hand; measureRecord sees one record and cannot rank a pool). Row p source: the empirical permutation-null read when present, else a Poisson-scale z off the basis window's adjusted click lift. A win that cleared its own bar but lost the pool-wide one attaches `fdrRead.fdrCaution` + "With 12 changes measured at once, one or two will look like winners by chance; this one is close enough to that line that I am holding the champagne." (amber on the card). N10 demotes an fdrCaution win from solid to decent, pool count in the sentence. A pool under two rows returns the ledger byte-identical.

**What changed (v1 152, clean-window salvage):** new pure `src/domains/proof-gsc/clean-window-salvage.ts` - partitions the basis window's days into muddied (inside any shock window) vs clean, and with >= 10 clean days on BOTH sides (the baseline excludes shock days too, so a muddied baseline can never fake a lift) computes the treated page's own lift on the clean days alone: "A Google update muddied 9 of these 28 days; on the 19 clean days this change is still up 20 percent." Rendered directly under the weather caveat (caveat stays named, verdict/learning gates untouched); honest-absence guards mirror weekday-baseline.ts (unfinalized days are unknown, never zeros). loadProofLedger builds the shock list ONCE per ledger and passes it through a new optional measureRecord param; a lone "Measure now" self-reads the persisted changepoints fail-soft.

**Posture (all four):** computed-only attachments on ShippedChangeRecord, recomputed per measure/load, recordToRow untouched so nothing persists; stored verdicts, windows, and clocks never touched.

**Rendered copy (exact, from pinned tests):** reach - `This page now shows up for 18 more searches than before; the win is reach, not just rank.` · depth - `This page shows up for about the same searches as before, but they are sending 30 more clicks; the win is depth, not reach.` · proven neutral - `This change genuinely did nothing, and I can prove that now; that is different from not knowing. The plausible effect sits between 6 fewer and 4 extra clicks a month, too small to matter either way.` · N10 solid-neutral - `I would treat this read as solid: this change genuinely did nothing, and I can prove that now; that is different from not knowing. The lesson still counts.` · champagne hold - `With 12 changes measured at once, one or two will look like winners by chance; this one is close enough to that line that I am holding the champagne.` · N10 demotion - `I would treat this read as decent: with 12 changes measured at once, one or two will look like winners by chance, and this one is close enough to that line that I am holding the champagne.` · salvage - `A Google update muddied 9 of these 28 days; on the 19 clean days this change is still up 20 percent.`

**Tests:** 4 new fixture files (query-breadth, equivalence, fdr-adjust incl. all-significant/none-significant/marginal-loses pools + the ledger pass, clean-window-salvage incl. day partition, baseline shock exclusion, both floors, labels) + new verdict-reliability N10 cases + new run-measurement wiring cases (caller-passed vs self-read shock lists, verdict untouched either way, honest nulls). Verified: `npm run typecheck` clean; full `src/domains/proof-gsc` = 767 tests green (42 files, was ~712 pre-slice); external ledger consumers (fact-assembly, dossier, results surface/actions/ledger-data) = 106 green. No dev server (computed-only slice, tests only per task instruction); no migration, no new env, $0 spend.

---

## 2026-07-03 - R11: N30 demand-ranked question universe + N20 SERP-consensus study + N29 snippet capture

**What changed (N30):** new pure `src/domains/research/question-universe.ts` merges every question-shaped demand signal into ONE ranked universe per tenant: GSC queries that are actually questions (who/what/when/how/is/can, with impressions + Google's own owner page), AI fanout expansions (Profound + native poll via loadFanoutSeedsForTenant), the tenant's tracked question library (tracked_prompts), and captured People-also-ask rows (dataforseo_serp_history). Near-duplicates collapse by the N2 ownership-registry convention (topicTokens + strict smaller-side subset, 2-token floor, numbers count so "nowruz 2026" never merges with "nowruz 2025"). Each row: sources, demandScore (impressions + fanout weight x 20 + PAA 40 + library 10), ownership (registry verdict, else GSC impressions owner), coverageStatus checked against the owner page's REAL stored extracts (h2_list + stored FAQ questions + body sample; answered / partial / not_answered, plus honest `unchecked` when no extracts exist - never a verdict off missing data). Rank = demand x not-covered (answered rows keep their demand number but sink to priority 0). Loader `question-universe-loader.ts` persists to the new `question-universe` store (GLOBAL classification + Supabase-mirrored, capped 300 rows/tenant), rebuilt nightly as isolated fail-soft cron phase 2a-q (before the draft precompute so tonight's drafts seed from tonight's universe). Consumers, every seam pinned byte-identical when the universe is empty: (a) precompute-drafts seeds the answer-block AND FAQ drafters with topic-matched uncovered questions; (b) /prompts gains the self-hiding "Questions people ask that no one answers well" section (top 5 uncovered, plain-words evidence lines, impressions always "shown on Google", never "searches"); (c) New Pages cards carry `universeQuestions` (top 3 for the topic, rendered as "Questions this page should answer") which also feed the opening drafter.

**What changed (N20):** `consensusOf()` in teardown-commonality.ts - the 3-of-5 read over the same CompetitorPageFacts the D2 teardown already stores: answer block, FAQ, table (Table structured data only - the teardown does not extract raw table presence yet, honestly rare), tool/calculator, image-count band, word band. An element on 3+ of the top 5 is consensus; an element on exactly ONE winner is a named outlier and never reaches a brief (pinned end to end through routeGapVerdict). Null below 3 usable teardowns (a 3+ agreement cannot be observed on 2 pages). Carried as `CommonalityBrief.consensusSpec` into BOTH GapVerdict brief shapes (optional field, old persisted verdicts still parse). Hardening: the brief's own majority floors (hasFaqConsensus/hasToolConsensus/schemaTypes) now floor at 2 winners, closing the 2-source hole where a single page's quirk counted as "consensus".

**What changed (N29):** new pure `src/domains/serp/snippet-capture.ts` extends the shipped feature-steal engine (same dataforseo_serp_history rows, `own_url` added to the reader): competitor-owned answer box + our rank 2-10 emits a FORMAT-MATCHED `featured_snippet_capture` -> `add_answer_block` candidate through the existing trigger pipeline, right beside N18's snippet-promise block in load-trigger-candidates-for-tenant.ts. The own-page shape is classified from stored early body text only (prose/list/table/unknown; a page already answering in the box's format is skipped - no format gap). Capped at 5, closest rank first, deduped against the existing steal-lane cards by query, weak owners medium confidence, Wikipedia-class owners honestly low ("a long shot, but the format gap is real"). Copy via a new scanned `snippetCaptureCopy` template ("answer box", never a lab word).

**Rendered copy (exact, from the pinned tests):** /prompts section title - `Questions people ask that no one answers well`; evidence line - `shown on Google 340 times in the last 90 days`; N29 directive - `Google shows a numbered list from britannica.com in the answer box above your #4 spot for "iran flag history". Your page answers in prose. Match the list format with a tight numbered list high on the page to compete for that box. That owner is a strong site, so this is a long shot, but the format gap is real.`

**Tests:** 20 new question-universe (merge/dedupe/rank, coverage detection, empty-universe reference-equality pins, plain-words label rule), 20 new snippet-capture, 7 new consensusOf + 2 verdict outlier pins, +3 probe rows in the copy-vocab invariant, feature-steal fixture gained ownUrl. Verified: `npm run typecheck` clean; serp+research+demand-graph (654), recommendations+rec-intel loader+copy templates (1261), prompts/today routes + full src/app (651+14), tests/persistence + full tests/architecture (4600), ai-visibility+contracts+lib (1409) all green. No dev server (tests only, per task instruction). Ground-truth caveat: the live Iranopedia universe build could not be demonstrated during this session - the Supabase project was returning Cloudflare 522 timeouts on every read (fail-soft paths verified honest-empty instead); the nightly phase will populate the store when the database is reachable.

---

## 2026-07-03 - R8: N5 information-gain gate + N28 scaled-content governor + N18 snippet-promise audit

**What changed (N5, the law that unfreezes the factories):** new pure `src/domains/drafts/info-gain-gate.ts`. `scoreInfoGain(draft, competitorExtracts)` scores what a create-page brief ADDS over the torn-down winners: novel sections (outline headings sharing ZERO distinguishing tokens with every competitor heading/FAQ, via the relevance gate's own `topicTokens`), novel fact sentences (>= 2 distinguishing tokens found in NO competitor extract), and original assets (planned tables/datasets/tools no winner has). Verdicts: `adds_something` (>= 2 novel sections OR >= 3 novel facts), `thin_addition`, `duplicate_of_serp`, or `unchecked` (no brief or no teardown evidence - a pinned byte-identical no-op; never block on missing data, never fake a check). Every verdict carries ONE plain sentence naming the strongest novel contribution or the strongest overlap. Wired as a HARD gate in `load-graph.ts` right after sibling collapse: duplicate_of_serp reclassifies to `edit_page` at a known owned URL else drops with the honest reason (logged + surfaced in `coverage.infoGain`); thin_addition demotes below every adds_something row (bounded score adjustment outside the pure scorer, same pattern as the priors); surviving Moves carry `infoGain` for the card - the New Pages card renders it as "What this page adds" / "Overlap check". `GRAPH_SCHEMA_VERSION` bumped 1 -> 2 (scoring contract changed; pre-gate snapshots recompute, not trusted).

**What changed (N28, law 3):** new pure `src/domains/push/factory-governor.ts` - `governFactoryBatch` enforces, in ranked order: the N5 verdict (duplicate/thin refused), one-topic-one-page (two batch titles clash only when the smaller distinguishing-token set is a SUBSET of the larger - the registry's resolveOwner rule, so entity-attribute siblings sharing one word stay alive), the weekly pace (max 5/week counting the shipped ledger + factory batch history via `countInWeekOf`), and the monthly growth ratio (new pages this month < 10 percent of the tenant's indexed `pages` count; unknown count = guard honestly skips). Output `{allowed, refusals: [{slug, plainReason}]}` + `summarizeRefusals` batch-card sentence. I/O edge `factory-governor-context.ts` (shipped_change_proof create_page rows + batch history + a head-count on `pages`; every read fail-soft). Wired into BOTH factories: `factory-run.ts` (cluster factory - refused items skipped pre-spend, reasons ride the existing rejected/rejectedReasons counters) and `production-line.ts` (weekly cron - governor pre-draft, N5 scored post-brief against topic-matched teardown extracts from the steal-brief + audit-cache join; refusals persist on the batch record as `governorRefusals`/`governorSummary` and render on the batch card in amber). Plan doc flipped: factories UNFROZEN 2026-07-03.

**What changed (N18):** new pure `src/domains/recommendations/snippet-promise.ts` - four checkable promise kinds (cost, count/list, how-to, date) detected in title+meta, each with a concrete fulfillment signal scanned over the first 200 stored body words; pages with >= 100 GSC impressions only; no stored body text = honest abstention. Fed through the existing trigger pipeline as `snippet_promise_gap` -> `update_intro` (medium confidence, capped at 5, highest impressions first, canonical dedupe/cooldown keys, copy via a new scanned `snippetPromiseCopy` template). Because the egress-lean snapshot projections omit `body_paragraph_sample`, a new bounded scoped read (`early-body-text.ts`, max 40 URLs, only promise-carrying + impression-clearing pages) merges body text in - the same silent-empty fix pattern as the link-graph read.

**Rendered sentences (exact, from the pinned tests):** N5 thin - `This would mostly repeat what en.wikipedia.org already says about Persian cats; the one new angle is a section on "Monthly care cost table".` N28 batch card - `I skipped three of four: two would repeat what the winners already say, one would push this week's new pages past a healthy pace.` N18 - `The title promises the cost but the first 200 words never give a number.`

**Tests:** 52 new (17 info-gain-gate, 15 factory-governor, 12 snippet-promise, +8 probe rows in the customer-copy vocab invariant). Three production-line fixtures updated honestly (titles like "Topic 0 Meaning"/"Topic 1 Meaning" ARE one topic under the token rule; replaced with genuinely distinct subjects). Verified: `npm run typecheck` clean; `src/domains/{demand-graph,drafts,push,page-factory}` 450 tests green; `tests/domains/push` + `tests/domains/recommendation-intelligence` + full `tests/architecture` + `src/domains/recommendations` + page-factory cron route = 6827 passed / 34 pre-existing skips; full `src/app/(shell)` + `tests/app` = 1281 passed / 1 skip. No dev server (tests only, per the task instruction) - the operator-journey walk of the New Pages card / batch card rendering is the named follow-up.

---

## 2026-07-03 - R7: N39 production error spine + N40 external API contract tests

**What changed (JOB 1, N39):** every high-value swallowed-error catch now writes one durable row instead of a log line that dies with the lambda. New `src/lib/obs/error-ledger.ts`: `recordAppError({route, tenantId, action, message, stack?, context})` -> the new `app-errors` json-store (GLOBAL_STORES: rows carry tenantId because the writers are cron fan-outs and next/after tasks with no ambient request context; SUPABASE_MIRRORED_STORES so hosted-prod errors survive lambda recycling, with the blob helpers' PGRST205/42P01 handling as the file-fallback). CAP: newest 200 rows per tenant bucket, pruned on every write. CONTRACT: recordAppError NEVER throws (read failure, write failure, its own bugs all absorbed). Wired catch points, each passing its real route/action: all ~21 per-phase catches in `cron-sync.ts` (per-source sync throw, tenant-sync, ai-referrals, revenue-facts, trend-radar, family-demand-profiles, seasonal-archive, gsc-deep-backfill, peak-calendar, language-gap, aa-calibration, algorithm-weather, pooled-verdicts, refresh-queue, competitor-teardown, move-draft-precompute, pipeline-invariants, forensic-investigation, site-uptime-probe, global-patterns, token-expiry, cron-ledger) + the route-level catch; the `/changes` and `/results` SWR background-refresh `after()` catches (moves-data.ts, results-ledger-data.ts); `stage-in-wix-actions.ts` both fail-closed catches; `recommendations/actions.ts` accept per-edit-fanout catch + approve-and-push refused branch (the armed one-click path funnels there); the LLM draft gateway's fail-closed `llm_call_threw` catch (tenant from packet). Surfaces: `/diagnostics/errors` (operator-gated by the diagnostics layout; last 50 grouped by route+message with count + most recent Pacific time, honest empty state) and `src/domains/ops/error-spike.ts` -> ONE line joining the EXISTING OpsPipelineSection alert on Today (one-widget rule), self-hiding under 10 failures/24h, sentence: "Something failed 14 times since yesterday, mostly on the nightly data sync. Details are on the Diagnostics page." ("mostly" clause only for a strict-majority route with a plain-English subject aligned to deadman.ts wording; raw route keys never reach Today).

**What changed (JOB 2, N40):** `tests/contracts/` (5 test files, 21 tests, 8 checked-in fixtures) parse REAL upstream response shapes through the ACTUAL parsing code paths, $0 and no live calls: GSC searchanalytics rows + sites.list via `gscSearchAnalyticsQuery`/`gscListSites` with injected fetchImpl (also pins OUR request body contract); GA4 runReport via `narrowRunReportRows` + name-mapped `narrowRevenueRows` (shuffled-header fixture pins name-based mapping, malformed rows dropped not mis-parsed); Wix collections/items/product-SEO via `wixListDataCollections`/`wixQueryDataItems`/`wixGetStoreProduct` with the token seam (pins the `type ?? fieldType` fallback and the seoData.tags title/meta shape the push snapshot depends on); DataForSEO SERP via `parseDataForSeoSerp` (organic ranks, AI Overview top-level references, featured-snippet owner/format, PAA answer domains, own-rank resolution, malformed-body honesty); OpenAI structured response via the real `generateOpenAIBundle` with fetchImpl (envelope + stringified json_schema content + usage-priced cost; refusal and missing-choices drift both yield the SAFE empty bundle). Plus `scripts/contract-probe.ts`: OPERATOR-RUN ONLY live smoke (double-gated: BEACON_CONTRACT_PROBE=1 AND not CI; header documents the never-in-CI rule and the tiny real spend), reusing the same client functions/parsers, PASS/SKIP/FAIL per API, DataForSEO rides the real money gauntlet (dry-run/cache/cap honored).

**Tests:** 33 new N39 tests (`error-ledger.test.ts` 14 incl. cap/prune/never-throws via in-memory json-store mock; `error-spike.test.ts` 9 both-states incl. the exact quoted sentence + no-raw-route-leak; `ops-pipeline-errorspike.test.tsx` 4 render pins incl. the one-widget rule; +2 pins added to `ops-pipeline-section.test.ts`, whose self-hide pin was updated honestly for the third condition; existing `ops-pipeline-deadman.test.tsx` gained a quiet error-spike mock) + 21 new N40 contract tests. Verified: `npm run typecheck` clean; targeted sweeps all green - ops domain + push domain + cron routes (413 + 38), gateway/stage/accept/SWR suites (118), connectors (521), full `tests/architecture` (4486 passed / 32 pre-existing skips), contracts (21). No dev server (tests only, per the task instruction). Did not touch daily-experiment-planner, changes-data, opportunity-expiry, or ownership files (another agent owns them).

---

## 2026-07-03 - R6: N12 same-query experiment blocking + N46 opportunity expiration

**What changed (JOB 1, N12):** the query-overlap-only subset of N14's interference graph is now wired LIVE into the nightly planner (N14's full graph, which hits 100% of ships on the real ledger, stays intentionally un-flipped). New `toQueryOverlapHoldEntry`/`computeQueryOverlapHoldsForLedger` in `src/domains/proof-gsc/interference-graph.ts` filter the already-composed graph to `query_overlap` edges only and build the planner's own first-person hold sentence (distinct from the graph's third-person `/results` sentence). `src/domains/experiments/daily-experiment-planner.ts` gained: (a) an optional `queryOverlapHolds` param + new `"query_overlap_hold"` `ExcludedReason`, checked right after the N16 last-clean-donor hold, for open-measurement overlap; (b) a new intra-batch pass (`candidateQuerySet`, `queriesOverlap`) applied right after scoring/sorting - walks the score-ranked eligible pool and holds any LATER candidate whose queries overlap an already-accepted pick this same pass, first-ranked wins. Both reuse the EXACT `MIN_QUERY_OVERLAP_JACCARD`/`MIN_QUERIES_FOR_OVERLAP_JUDGMENT` floors interference-graph.ts already enforces (imported, never reimplemented or loosened). `DailyCandidate` gained an optional `relatedQueries: ReadonlyArray<string>` field (falls back to `[targetQuery]` when absent - the honest default, since most daily-experiment candidates carry exactly one target query today). `build-today-preview.ts` wires `relatedQueries` from the already-computed `queriesByUrl` map (the page's real GSC top queries, used for the keyword-research brief - no new read) and builds the ledger-ship adapter (`InterferenceLedgerShip[]`) from the SAME already-loaded ledger via `outcomeStateOf`/`measurementWindowOf` - no new store, no new read, fail-soft (a graph-build error never blocks the plan).

**Rendered hold sentences (exact, quoted):** open-measurement - "I am holding this because it competes for the same searches as a change I am already measuring on /iran-flags/umayyad-caliphate-flag." Intra-batch - "I am holding this because it competes for the same searches as tonight's pick for /iran-animals/persian-cat."

**What changed (JOB 2, N46):** new pure `src/domains/changes/opportunity-expiry.ts`: `classifyOpportunityFreshness(dates, now)` takes whatever dated evidence a caller actually has (general `EvidenceDate[]` shape: serp_verdict/competitor_teardown/gsc_window/seasonal_window/keyword_research/plan_batch) and returns fresh / aging (>=21d) / expired (>=45d, OR a seasonal window whose `windowPassedAt` has already passed, checked first and unconditionally). No dated evidence at all classifies fresh with `daysSinceFreshest: null` - never a fabricated age. `summarizeExpiry` builds the honest expander sub-line: "M of these aged out; I will re-check their evidence before pitching them again." Wired at two seams: (1) PRESENTATION - `src/app/(shell)/changes-data.ts`'s new `applyOpportunityFreshness`, called AFTER `dropBoardDuplicateNewPageRows` (dedupe/rank already complete; this never re-ranks, only marks `CanonicalChange.freshness`/`agingChip` in place), using the one genuinely-available date today - the accepted/preview plan's own `createdAt` - matched to rows via `sourceIds`. `changes-list-client.tsx`: an expired row stably sinks to the tail of the curated pool (never removed, never re-ranked relative to its peers) so it naturally falls into the SAME existing "N more lower-priority ideas" expander, with the new honest sub-line rendered beneath it; an aging row shows a quiet inline chip next to its other meta chips ("evidence from 3 weeks ago"). (2) PLANNER SKIP - `daily-experiment-planner.ts` gained an optional `DailyCandidate.evidenceFreshness` field + new `"evidence_expired"` `ExcludedReason`, checked right after the power/underpowered gate; `build-today-preview.ts` resolves it per-candidate from the SAME cached `readCachedSerpPatterns()` read the keyword-research brief already uses (a real staleness gap - that cache carries no TTL of its own today) - no new store, no new read. Nothing is ever deleted; the next nightly evidence refresh naturally re-classifies a row once its evidence updates.

**Honest caveat (researched, not assumed):** every genuine evidence-fetch timestamp elsewhere in the codebase (`KeywordDemand.fetchedAt`, `PreparedSerpVerdict.generatedAt`, `PeakCalendarSummaryRow.computed_at`) is stripped at the projection boundary before reaching `TodayMove`/`CanonicalChange` today (confirmed via direct research across `daily-evidence-brief.ts`, `action-pack/adapters.ts`, `seasonality.ts`). Most `/changes` rows (the worklist-sourced majority, not today's plan) therefore have no dated evidence threaded to this layer yet and stay honestly unclassified (fresh by the module's own contract, never a false expiry). The seasonal-window-passed rule is fully built and tested but has no live per-row seasonal binding to feed it yet - the natural next wiring step once a dated evidence feed (per N8's own documented next-action) lands.

**Tests:** 9 new `interference-graph.test.ts` cases (`toQueryOverlapHoldEntry`/`computeQueryOverlapHoldsForLedger`), 9 new `daily-experiment-planner.test.ts` cases (N12 open-measurement + intra-batch + floor-respected + byte-identical pins) + 5 new cases (N46 planner skip), 18 new `opportunity-expiry.test.ts` cases (boundaries, seasonal-passed, summarizeExpiry), 7 new `changes-data.test.ts` cases (`applyOpportunityFreshness`). One pre-existing source-text pin (`effect-prior-surface-pins.test.ts`) updated honestly to match the new, still-correct `planDailyExperiments({...})` call shape (queryOverlapHolds appended after lastCleanDonorHolds). Verified: `npm run typecheck` clean project-wide; full targeted sweep - `src/domains/experiments` + `src/domains/proof-gsc` + `src/domains/changes` + `changes-data.test.ts` + `changes-list-client-ux3/session.test.ts` + full `tests/architecture` = 5778 tests passed, 32 pre-existing skips (matches baseline). No dev server used (tests only, per the task's own instruction). Did not touch `src/domains/obs`, `src/lib/obs`, or any api-contract test file - confirmed via `git diff --stat` these are a different, concurrent agent's uncommitted work already present in this worktree (`ops-pipeline-section.tsx`, `src/domains/ops/error-spike.ts`, `src/lib/obs/error-ledger.ts`, `tests/contracts/`), and one unrelated pre-existing test failure in `ops-pipeline-section.test.ts` traces to that same untouched file.

---

## 2026-07-03 - R4: /results SWR snapshot layer + THE ONE DOLLAR RULE

**What changed (JOB 1, FP1's named follow-up):** /results no longer re-measures every shipped change against GSC on every render. New `src/app/(shell)/results/results-surface-store.ts` (tenant-scoped "results-surface" store, registered in store-classification + the json-store Supabase mirror list) snapshots the fully RE-MEASURED proof ledger; new `src/app/(shell)/results/results-ledger-data.ts` serves it with the proven worklist SWR flow (snapshot serves instantly with `computedAt`; stale snapshot background-refreshes via `after()`; only a true cold start pays the synchronous re-measure). The page shows an honest age line ("I last re-checked these numbers against your Google data N minutes ago. I refresh them in the background."). The store replicates worklist-surface-store's 2026-07-02 empty-rebuild guard (an empty rebuild never replaces a non-empty snapshot). EVERY ledger mutation invalidates the snapshot at one choke point (shipped-change-store's upsert/recrawl writers), covering record/recompute/revert/exclude/recrawl AND armed-publish auto-records; the recompute action persists its just-measured ledger as the fresh snapshot, and the passive auto-measure pass rebuilds the snapshot in its own after() window so "Refresh in a moment to see the verdict" stays true. ProofSummarySection + CumulativeOutcomeSection + the raw-change-log count now read the SAME snapshot ledger (passed down / request-memoized), so one /results render triggers at most one measure path. All BoundedSection deadline wrappers kept. Measurement history is never cached-mutated: the snapshot is presentation only.

**What changed (JOB 2, one dollar rule):** the FP8 strip summed every won-band `dollarValue.usdPerMonth` while Today's lifetime odometer applied stricter exclusions, so two dollar totals could disagree on one screen. New `src/domains/proof-gsc/won-dollar-rule.ts` is THE ONE DOLLAR RULE (the stricter set, honesty over size): dollars count only for a won + mature change with clean attribution (no shock-window overlap, no weak comparison match) and a real ran GA4 traffic outcome with a positive control-adjusted monthly rate, carrying a computed usdPerMonth. `cumulative-outcome.ts` (strip on Today + Results) and `scoreboard-section.tsx`'s `buildLifetimeEarningsRows`/`buildCounterfactualRows` (odometer + portfolio line) now select rows through this one module; the strip section loads shock windows (or takes /results' already-loaded set) so the rule actually fires everywhere.

**Tests:** new `results-surface-store.test.ts` (7: empty-rebuild guard replicated + staleness), `results-ledger-data.test.ts` (8: fresh/stale/cold/failed-refresh SWR flow + age-line copy), `tests/domains/proof-gsc/won-dollar-rule.test.ts` (8 incl. the DOLLAR PARITY pin: strip total === odometer total from the same fixture ledger, both quarantine together); `cumulative-outcome.test.ts` +3 stricter-rule exclusions, fixtures updated to carry traffic outcomes. Verified: `npm run typecheck` clean (two pre-existing failures in another agent's ops/deadman test files only); suites green: all `src/app/(shell)` (54 files / 589), proof-gsc domain + results + persistence + affected architecture/routes sweeps (270 + 795 + 111 tests), design-system ratchet unchanged at 1342.

**Rider:** ProofSummarySection's "worth about $X a month at your rates" clause (the third cumulative dollar figure, on the same /results screen as the strip) was also swapped onto `sumWonDollarsPerMonth`, so all three money surfaces now share the one rule.

## 2026-07-03 - FINISHED PRODUCT FP4: route-name unification (/changes, /results), registry-driven titles, settings merge, Ask chips

**What changed:** (1) ROUTE RENAMES: the ranked Changes list moved from /worklist to /changes (the old /changes-to-Results redirect stub deleted; /worklist is now a permanent 308 redirect preserving query strings) and the results page moved from /proof to /results (/proof 308-redirects, query preserved). Every internal link, revalidatePath, palette entry, breadcrumb parent, and test retargeted (72 /worklist + 45 /proof references swept; module names like worklist-surface-store.ts intentionally unchanged). Keyboard chords re-keyed to match the names: G C = Changes, G E = Results, G A = Ask; G R dropped with Drafts out of the nav. (2) TITLES FROM THE NAV REGISTRY: new routeCrumbFor()/surfaceNameFor() in src/lib/navigation.ts (ONE longest-prefix registry naming every reachable shell route); app-header.tsx derives title + parent from it, so no route renders its raw slug or a bare "Detail" (the "research / Detail" and "Settings / Detail" classes are dead). Detail pages push their real subject via the new fail-soft <HeaderTitle/> (shell-provider): prompts/[id] shows the question text, changes/[id] shows the change title, /page/... shows the page path. (3) LEGACY SWEEP: /expansion deleted (zero inbound links) + dead moves/moves-worklist-client.tsx; bookmark shims retargeted to the new canonical paths (/moves + /opportunities -> /changes, /experiments + /recommendations index -> /changes?status=ready); verified-live-and-kept: /review (diagnostics links it), /briefs + /topics/opportunity/[id] + /competitors/[id] (settings/history chain), /local (settings/import + methodology), /observations/[id] (Today proof links), /settings/history, /connections + /ai-questions redirects. vercel.json crons all hit /api/* (untouched, verified). (4) SETTINGS MERGE: new settings-sections.ts is the ONE table of contents rendered by BOTH the tab strip and the /settings index (7 sections, Connections leads, labels agree with the sidebar); the sidebar group heading "Settings" above the "Settings" item removed (empty group label). (5) ASK RIDER: citation chips dedupe by destination and render human names via surfaceNameFor ("Results", "Changes", "AI questions"), never raw hrefs; new plainChangeKind() in plain-language.ts kills edit_meta/add_answer_block/lever-key leaks in Ask fact sentences; dead "/keywords" hrefs fixed to /research/keywords.

**Verified:** npm run typecheck clean. Suites: tests/routes + tests/architecture + tests/app + src/app/(shell) + src/components + src/domains/changes|trend-radar|ask (358 files, 6071 passed after fixes) plus src/domains/citability|refresh|experiments|team|language-gap|serp|seasonal|allocator|outreach + src/lib (113 files, 1564 passed). Honest test updates: customer-nav-exposure (new hrefs/chords/settings registry), changes-smoke rewritten as the FP4 redirect contract (including query preservation), demo-path settings pin follows the registry, fact-assembly pins plain action names. Dev server (port 3142): /changes 200 with header h1 "Changes" + PageHeader "Changes"; /results 200 with h1 "Results"; /worklist?status=ready streams NEXT_REDIRECT;replace;/changes?status=ready;308 + meta refresh; /proof streams NEXT_REDIRECT;replace;/results;308; /research/keywords header h1 "Keywords" (was "research / Detail"); /settings/connectors breadcrumb "Settings / Connections"; /page/iranian-singers breadcrumb "Page report / /iranian-singers".

## 2026-07-03 - FINISHED PRODUCT FP8: the "$250 answer" (cumulative outcome strip + collapsed proof cards)

**What changed:** (1) New pure aggregator `src/domains/proof-gsc/cumulative-outcome.ts` reuses FP3's `splitLedgerLifecycle` (the ONE-COUNT rule) and sums each WON change's own measured basis-window clicks delta (`adjustedLift`, rolled monthly via the same `toMonthlyRate` change-dollar-value uses; never invented, legacy rows without a delta contribute 0), sums per-win `dollarValue.usdPerMonth` when the GA4-backed rate exists, and computes the REAL first-verdict date (earliest still-measuring ship + 28 days, soonest future close first). (2) New `src/app/(shell)/cumulative-outcome-strip.tsx` - ONE strip rendered on BOTH Today (below the lead story, one import + one Suspense slot in `page.tsx`) and Results (the header strip slot in `proof/page.tsx`, which grew into this strip; the FP3 counts sentence renders inside it via the unchanged `ResultsHeaderStrip`, now token-classed). Wins state: "You have shipped 3 changes. 1 has a final read (1 win), and 2 are still measuring below." + "Your win is adding about 90 extra clicks a month, measured against similar pages we did not change." + (only when a rate exists) "At your rate, that is about $42 a month. This is an estimate, your rate times the extra visits the win earned, not measured revenue." Zero-verdict state: "You have shipped 2 changes, all still measuring below." + "No final verdicts yet. The first one lands around Jul 18 when the earliest 28-day window closes." (past-close variant honestly says it is waiting on Google's data). (3) `/proof` ledger cards collapsed: ONE summary line per card (page link, six-word badge as a Pill colored by maturity tone, the single most important number - measured basis lift for settled rows, next-read countdown for in-flight - plus plain action + ship date); the full chip grid, sparkline, caveats (recrawl/weather/contamination/seasonal render exactly as before), math, comparisons, and actions moved behind a "Show the full read" expander. Deleted the raw-palette `TONE_STYLE`/`OUTCOME_STYLE` maps (Pill intents now carry the maturity-tone rule). Measurement history untouched; read-only aggregation.

**Tests:** new `tests/domains/proof-gsc/cumulative-outcome.test.ts` (12) and `src/app/(shell)/cumulative-outcome-strip.test.tsx` (5, renderToStaticMarkup pins of both states). Targeted sweep: proof-gsc domain + all `src/app/(shell)` tests + changes domain = 65 files / 756 passed; full `tests/architecture` = 219 files / 4482 passed. `npm run typecheck` clean; eslint clean on every touched file. Design ratchet lowered 1481 -> 1342 (measured live).

---

## 2026-07-03 - FINISHED PRODUCT FP3 + FP5: one count per stage, one home per job

**What changed (FP3, contradicting counts):** new `src/domains/changes/lifecycle-counts.ts` is THE ONE-COUNT RULE: a shipped change is DECIDED exactly at a mature result (28d window + 2 comparisons + 200 baseline impressions + won/lost verdict + no overlapping edit, i.e. `deriveMeasurementMaturity === "mature_result"`); everything else shipped is MEASURING (the exact set Results shows as In flight); tonight's picked/applied reuse execution-checklist's `summary.left` formula. New request-cached loader `src/app/(shell)/lifecycle-counts-data.ts` feeds it the canonical stores once per request. Consumers rewired: Today (`page.tsx` tiles + standup + measuring strip + results-ready alert remap), the Changes list (`changes-data.ts` `measuringCountCanonical` now rule-based + new `decidedCountCanonical`; Measuring AND Results tabs show "X of Y" against the canonical numbers), and Results (`proof/page.tsx` band membership now `splitLedgerLifecycle`, plus a new `ResultsHeaderStrip`: "You have shipped 25 changes. 9 have a final read (3 wins), and 16 are still measuring below."). This kills the 16-vs-25 cross-link class at the source: Today's "N measuring -> View all in Results" now equals In flight (N).

**What changed (FP5, duplicate homes):** (a) `DailyExperimentsSection` renders ONLY on Today; `/worklist` shows the one-line `TonightSummaryChip` ("Tonight: 6 picked, 6 applied. See them on Today →") from the same FP3 counts. (b) The New Pages board's single home is `/worklist`; Today shows `TodayNewPagesSummaryLine` ("I found 9 new pages worth building. The full board, with drafts and competitor teardowns, lives in Changes."); the board's dedupe normalizer switched to the ownership-registry `topicTokens` (proper singularization: "biggest cities in iran" == "biggest city in iran"), exported as `topicIdentityKey`; page-less create rows already on the board are dropped from the ranked list (`dropBoardDuplicateNewPageRows`); board cards duplicating this week's page-factory batch are excluded via `excludeTopics`. (c) On `/proof` the "Your changes" timeline no longer stacks as a second full list under the measured-outcomes ledger; it lives behind one collapsed "See the raw change log" expander (BoundedSection wrapper intact). (d) Measuring's single home is Results; the worklist measuring/results empty states say so.

**Tests:** new `lifecycle-counts.test.ts` (23), `tonight-summary-chip.test.tsx` (4), `results-header-strip.test.tsx` (4), `today-newpages-summary.test.ts` (3); `changes-data.test.ts` +5 (board dedupe), `dedupe-new-page-cards.test.ts` +4 (singular/plural pins). Targeted sweep across every touched area (`src/domains/changes`, `src/domains/proof-gsc`, `src/domains/allocator`, `src/domains/demand`, shell proof/worklist/today tests): 90+ files, 1300+ tests green. `npx tsc --noEmit` clean.

**Ground truth:** dev server on :3142 returns 200 on `/`, `/worklist`, `/proof`; sections render honest-delay fallbacks because local Supabase reads 522 (pre-existing), so rendered copy is pinned by the renderToStaticMarkup tests above (the quoted chip and header-strip sentences are exact test assertions).

---

## 2026-07-03 - MASTER PLAN v2 item UX3: Changes as a dense inbox

**What changed:** `/worklist`'s `ChangesListClient` (`src/app/(shell)/changes-list-client.tsx`) rows were already one compact line (status via border+text, page/dossier link, the exact action, the honest D7 upside range, evidence chip, effort, status); this pass closed the remaining four UX3 pieces without touching the D6 daily-ritual session loop it also owns.

- **Split detail panel.** New `RowDetailContent` factors the exact content that used to render inline under an opened row (MoveCard, or the before/after/instructions fallback) into a standalone component. `ChangesListClient` now lifts `selectedId` to list level; on `lg+` screens a sticky right panel (`w-[380px]`, `max-h-[calc(100vh-2rem)]`, scrollable) renders `RowDetailContent` for whichever row is selected, so opening a row never reflows the list or loses scroll position. Below `lg`, the same content still renders inline under the row (`lg:hidden`), unchanged in substance. The row's own `aria-expanded` toggle button still drives this state (now via `onToggleDetail`), so keyboard Enter and the D6 banner's "Open it" link keep working via the same `button[aria-expanded]` click path.
- **Applied-batch collapse.** Changes with `selectedForToday === true` that have moved to `verify`/`measuring`/`result` (i.e., tonight's accepted daily plan once it starts shipping) collapse into one row once 2+ qualify: "Tonight's batch: N applied, all verified" (or "M of N verified" while some are still confirming), with a "Show receipts" / "Collapse" toggle to reveal the individual rows. Scoped to `canCollapseBatch = !grouped && !tonight` so "By goal" and "Tonight's 30 minutes" still show every row exactly as before.
- **One command.** New `prepareTonightsPlanAction` in `src/app/(shell)/today-moves-actions.ts` runs `enrichTopResearchPacksAction` -> `prepareTopMovesAction` -> `regenerateTopDraftsFromTeardownAction` in sequence (enrichment first so the drafts written after it can use fresh competitor/keyword facts), each still independently capped/cached exactly as before, fail-soft per step (an enrichment or improve failure never blocks the base prepare pass). New `PrepareTonightButton` (today-moves-prepare.tsx) is the single "Prepare tonight's plan (takes a minute)" button on `/worklist`; the three granular buttons (`PrepareTopMovesButton`, `EnrichResearchButton`, `RegenerateFromTeardownButton`) moved into a new `PrepareOverflowMenu`, a native `<details>`/`<summary>` disclosure, no new dependency.
- **Buyer-language strategy names.** Display-only rename in the `STRATEGIES` array: `balanced` -> "Best opportunities", `growth` -> "Fastest growth", `clean` -> "Safest bets". The `Strategy` union values and `strategy.ts`'s ranking math are untouched.
- **Multi-select.** A checkbox per row (`onToggleSelect`, `aria-label="Select <page title>"`) feeds a list-level `checkedIds` Set. A floating bar appears once at least one row is checked ("N selected", Mark done / Skip / Clear) and runs a bounded, sequential loop (`runBulk`) over exactly the checked ids, awaiting each row's `respondToRecommendation` call before moving to the next and showing honest "Marking done 2 of 5..." progress text, then funnels every row through the same `rowAction` the single-row buttons use (so the D6 session counter and next-best pointer advance correctly for bulk actions too).

**Tests:** 21 new tests in `changes-list-client-ux3.test.ts` (strategy label rename, split-panel state wiring, batch-collapse predicate + copy + dash-clean, multi-select bulk-loop sequencing/reuse/progress text, and confirmation that D6's `useWorklistSession(visible)` + auto-scroll are unchanged) plus 12 new tests in `today-moves-prepare-ux3.test.ts` (the combined action composes the three existing pipelines rather than reimplementing them, operator-gating, fail-soft-per-step, the button's "(takes a minute)" line, the overflow menu holding all three granular buttons, dash-clean copy, and `/worklist/page.tsx` wiring the new components). All pre-existing D6 pins still pass unmodified: `changes-list-client-session.test.ts` (14 tests) and `worklist-session-strip.test.tsx` (11 tests). Full targeted sweep: `src/app/(shell)/` + `src/domains/changes/` + `src/domains/allocator/` + `prepare-today-moves.test.ts` = 586 passed, 1 pre-existing unrelated skip. `npm run typecheck` clean project-wide.

**Ground truth (real tenant-iranopedia, dev server on :3142, `curl -m 200`, server not restarted):** `/worklist` returns HTTP 200. Strategy picker renders all three buyer-language labels with "Best opportunities" `aria-pressed="true"` (the default) and "Fastest growth"/"Safest bets" as the other two. A real compact row (quoted from the rendered HTML): page link "persian female first names", a "Title" family chip, a 59-day sparkline, "To do" status chip, the line `You're losing "persian girl names" - clicks dropped 51% (221 -> 109) over the last month. Refreshing this page can win them back.`, then `Capture clicks`, `~1 min`, a "Directional signal" evidence chip, a "Review" button, and a "Skip" button, plus a checkbox `aria-label="Select persian female first names"`. 196 rows total each carry a checkbox (`type="checkbox"` count == `data-change-row=` count). "Prepare tonight's plan (takes a minute)" and the "More options" overflow trigger both render in the section header. The applied-batch summary correctly does NOT render today: this tenant has 4 changes currently `measuring` from other lanes but 0 rows with `selectedForToday: true` in verify/measuring/result, confirming the collapse is honestly scoped to tonight's accepted-plan cohort specifically, not "any measuring row" (would have been a fabrication otherwise). The "Change detail" side panel correctly does not render pre-selection (no row open by default).

**Docs:** `docs/BEACON_500_MASTER_PLAN.md`'s UX3 line marked done with the same detail; `docs/HANDOFF_VERIFIED_STATE.md` and `docs/NEXT_PHASE_EXECUTION_PLAN.md` both got a new top-of-changelog entry per this repo's append-at-top convention.

**Next action:** UX4 (Today as a concise briefing) per the locked UX0 -> UX1 -> UX2 -> UX3 -> UX4 -> UX5 order.

---

## 2026-07-03 - MASTER PLAN v2 item N10: one verdict-reliability grade

**What changed:** new pure module `src/domains/proof-gsc/verdict-reliability.ts`. `gradeVerdictReliability()` takes the same feeder outputs `measurement-maturity.ts`'s `buildMeasurementPresentation()` already computes (recrawl N11's `recrawlPending`, contamination N13's `controlContaminationFlagged`, `weakComparisonFlagged`, `weatherQuarantined`, `seasonalInflectionFlagged`, shared attribution derived from `attributionQuality`) plus two sufficiency numbers (`controlsUsed`, `baselineImpressions`) and an optional permutation-null read (`{nGreater, nTotal}`), and returns one of four grades, checked top to bottom so any disqualifier wins:

- `"too early"` - not shipped yet, OR recrawl is pending (outranks everything else, even a closed calendar window), OR no checkpoint has closed.
- `"shaky"` - a window closed but at least one integrity problem is unresolved: contamination, weak comparison pages, a weather/seasonal overlap, shared attribution (accidental overlap or an intentional compound package), sample below the mature-eligibility floor, or the untouched-page permutation comparison disagrees (looks like noise).
- `"decent"` - clean of every "shaky" reason, but either not yet mature (early/interim checkpoint), or mature with a sample that clears the mature-eligibility floor (2 controls / 200 baseline impressions, matching `measurement-maturity.ts`'s `MIN_CONTROLS_FOR_MATURE`/`MIN_BASELINE_FOR_MATURE`) but not the deeper "high confidence" floor.
- `"solid"` - mature, clean, and a DEEP sample (3+ controls, 3,000+ baseline impressions - the exact floor `measurement-maturity.ts`'s `maturityConfidence()` requires for "high" presentation confidence), and, when a permutation-null read exists, the untouched-page comparison agrees (`nGreater / nTotal <= 0.05`, the same threshold the card's own plain sentence already uses).

Every grade carries `reasons: string[]` (plain English, most important first) and one first-person `sentence` (e.g. "I would treat this read as solid: 28 days mature, clean comparisons, enough traffic to mean something."). `gradeFromPresentation()` adapts straight from a `MeasurementPresentation` + sufficiency numbers so a read site never restates the six feeder flags by hand. `gradeAllowsLearning(grade)` returns true for solid/decent - built as a verified superset-safe proxy for `MeasurementPresentation.learningEligibility`: every disqualifier `learningEligibility` checks (`maturity === "mature_result"`, `attributionQuality === "clean"` - which excludes BOTH "limited" and "compound", `!weatherQuarantined`, `!weakComparisonFlagged`, `!seasonalInflectionFlagged`, `!recrawlPending`, `!controlContaminationFlagged`) is also a shaky/too-early disqualifier in the grade, so the grade is never MORE permissive than `learningEligibility`.

**Wired, computed-only, same additive seam as every other N10 feeder:**
- `src/app/(shell)/proof/page.tsx` builds a `gradeById` map immediately after the existing `presById` map, reusing the SAME `basisWin`/`controlsUsed`/`baselineImpressions`/`permutationRead` values already in scope for that row - zero new reads. Threaded through `LedgerRowGroup` (new optional `gradeById` prop) into `LedgerCard` (new optional `grade` prop). Renders as a small neutral-gray-scale chip (`GRADE_STYLE`, deliberately never red/green so it never competes with the badge's own maturity color) next to the six-word badge, with the full sentence as its `title` attribute for a hover explanation. The grade sentence is also the first line inside "See the math" (`<details>`), styled `font-medium` to stand out as the summary line above the existing sentence/permutation/caveat lines.
- `src/domains/ask/fact-assembly.ts`'s `assembleMeasurementFacts()` (the `measurement` class D8 wired the neighboring confidence/dollar/permutation fields into) gets a one-line addition per row: since Ask's fast $0 path has no tenant-wide attach joins for recrawl/contamination/weather/seasonal, it computes a cheaper ledger-only grade (`deriveMeasurementMaturity` + `gradeVerdictReliability` fed only from the record's own `windows`/`controlMatchWeak`/`baseline`/`permutationRead`) and appends "I would grade this read as shaky." (or whichever grade) after the existing sentence. This is honestly a partial grade (missing contamination/recrawl/weather/seasonal signals the full `/proof` card has), matching the additive posture used everywhere else - an absent feeder just doesn't fire.

**Tests:** 32 new tests in `src/domains/proof-gsc/verdict-reliability.test.ts` - one case per rule boundary (too-early: not shipped / recrawl pending outranking a closed window / no checkpoint closed; shaky: each of the 7 individual disqualifiers plus a multi-reason stack; decent: early checkpoint, interim checkpoint, thin-controls, thin-baseline, and the exact floor boundary reading solid not decent; solid: no permutation wired, permutation agrees, permutation exactly at the 5% threshold), an 8-scenario `gradeFromPresentation`/`gradeAllowsLearning` alignment suite built directly against real `buildMeasurementPresentation()` output (clean mature, weak comparison, recrawl pending, contamination, seasonal inflection, accidental overlap, intentional compound package, early checkpoint), and a dash-clean guard (source file scan + every generated sentence across the full grade matrix). Re-ran every file that imports `measurement-maturity`/`verdict-reliability` (`measurement-maturity.test.ts`, `proof-plain-vocabulary.test.ts`, `proof-split-clock.test.ts`, `proof-weather-caveat.test.ts`, `load-experiment-outcomes.test.ts`, `algorithm-weather.test.ts`) - 148 tests, all green, zero pins needed updating. `npm run typecheck` clean project-wide. Targeted sweep: `src/domains/proof-gsc/` + `src/domains/ask/` + `src/app/(shell)/proof/` + `load-experiment-outcomes.test.ts` = 731 tests, all green.

**Ground truth (real tenant-iranopedia, dev server on :3142, `curl -m 200`):** `/proof` returns HTTP 200 and renders a grade chip on all 25 real shipped-change ledger rows. Real distribution: **9 "shaky" + 16 "too early", 0 "solid", 0 "decent"** - an honest picture given N13's own finding that all 25 real ships have at least one unresolved contaminated comparison page, and N11's finding that the recrawl-inspection sweep (`gsc_url_inspections`) has 0 rows for this tenant yet. Three real quoted cards (page path, grade, sentence):

- `/best-persian-restaurants` - shaky - "I would treat this read as shaky: a comparison page changed mid-window and I could not find a clean replacement, this window overlapped a Google update or a sitewide shift, this window overlapped a seasonal demand swing for this page's family, pages I did not touch moved this much on their own, so this could be normal noise."
- `/famous-iranian-singers` - shaky - "I would treat this read as shaky: a comparison page changed mid-window and I could not find a clean replacement, this window overlapped a Google update or a sitewide shift, this window overlapped a seasonal demand swing for this page's family."
- `/iran-flags/pahlavi-iran-flag` - too early - "I would call this too early to read: no checkpoint has closed yet."

All 25 rendered rows also carry the grade sentence inside "See the math" as a `<p class="font-medium ...">` element (confirmed by direct HTML parse of the live response, not just the chip's `title` attribute) - the full receipt count (25) matches the chip count (25) exactly.

**Honest caveats:** (1) today's real Iranopedia ledger has zero "solid"/"decent" rows, so the live render only proves the "shaky"/"too early" branches of the grade ladder - the "decent" and "solid" paths (including the exact 3-controls/3,000-baseline-impressions floor boundary) are fully covered by the pure-function test suite but not yet visually confirmed on live data; this will change automatically once N13's contamination backlog clears on a new ship or the pending `control_donor_pool` migration lets a fresh ship earn a real promotion. (2) Ask's per-row grade is a cheaper, ledger-only computation than the `/proof` card's grade (no recrawl/contamination/weather/seasonal joins) - by design, matching the fast $0 posture of the rest of `fact-assembly.ts`; the two can disagree on the same row (Ask may read "decent" where `/proof` reads "shaky" if a contamination flag exists that Ask's cheap path can't see) and that gap is an accepted, documented tradeoff, not a bug.

**Next action:** N14 (full interference graph: internal links, templates, sitewide changes, redirects, overlapping topics) is the next Quality Constitution law-4 item in the master plan's N-series, or apply the still-pending `migrations/2026-07-03_shipped_change_proof_control_donor_pool.sql` migration so new ships start earning real contamination-swap promotions and can eventually surface a live "solid" grade.

## 2026-07-02 - DREAM SITE V1 item D8: Ask coverage deepened to the real new stores

**What changed:** `/ask`'s context assembly (`src/domains/ask/fact-assembly.ts` + `router.ts`)
could only see 6 sources (page dossier, GSC totals, the answer-intelligence index, the proof
ledger's verdict/actionType, the accepted/preview plan) even though the app now holds 9 more:
the allocator's unified best list, D2 gap verdicts, D3 steal briefs, native AEO intel (recurring
domains + we-are/are-not presence), the keyword library, the hypothesis log + forecast
calibration, cron health, the publish canary, and the proof ledger's own reliability fields
(`confidence`, `dollarValue`, `permutationRead`) that were already on `ShippedChangeRecord` but
never read. Audited by direct file reads plus a parallel research agent cross-check of every
loader's exact signature; both converged on the same 9 gaps.

**Closed (source coverage, not a rebuild - the composer/router/history pipeline is untouched):**
- `router.ts`: two new question classes (`keyword_next`, `system_health`) with speaker mappings
  (`dataforseo`, `llm`); broadened `COMPETITOR_PATTERNS` to catch "recommend instead of me",
  `MEASUREMENT_PATTERNS` to catch "last batch of changes", added `KEYWORD_PATTERNS` and
  `SYSTEM_HEALTH_PATTERNS`, and a `why (is|isn't) ... (plan|planned|selected|included)` clause on
  `PLAN_PATTERNS` so a no-page-named "why isn't this page in the plan" still routes somewhere
  useful instead of the generic site_trend catch-all.
- `fact-assembly.ts`:
  - `assembleCompetitorFacts` now also calls `loadNativeIntel()` and cites up to 5 recurring
    domains (distinct-prompt count, citation count, engines) plus the absent-everywhere prompt
    count, alongside the existing answer-intelligence-index facts. Fail-soft independently of the
    index call (a `Promise.all`, each `.catch`-guarded).
  - New `assembleKeywordNextFacts()` reads `loadKeywordLibrary()`, filters to keywords with real
    volume and either no owner page or a position worse than 10, sorted by volume, capped at 5;
    an honest "every high-volume keyword already has an owning page" fact when nothing qualifies.
  - New `assembleSystemHealthFacts(tenantId)` fuses `loadCronHealthView()` (failure streaks + a
    failed-last-run headline), `readPipelineHealth(tenantId)` (real invariant violations, their
    own first-person `sentence` cited verbatim), and `readPublishHealth(tenantId)` (a failed
    token/url-map/dry-run check, citing `fixHint` when present). Says "everything checked came
    back clean" only when at least one check actually ran; an honest "no check yet" otherwise.
  - `assembleMeasurementFacts` now names `confidence`, `dollarValue.basisSentence`, and a
    permutation-null read ("N of M untouched pages moved this much") per recent ship, not just
    verdict/actionType/date.
  - `assemblePageFacts` now states plainly when a page has no open recommendation and no plan
    pick - the honest answer to "why isn't this page in the plan" for a named page.
- `composer.ts`: `CLASS_LABEL` gained the two new classes' plain-English labels.

**Bug found and fixed while ground-truthing:** `assembleSystemHealthFacts`'s "everything is
clean" fallback checked `cronJobs.length > 0`, but `loadCronHealthView()` always returns one
entry per job in the static `CRON_SCHEDULE_MAP` config - even for a tenant with zero real cron
runs ever - so the check was true for every tenant regardless of data, which would have made
"is anything broken" always say "clean" for a brand-new tenant. Fixed to require at least one
job with a real `lastRun` (or a non-null pipeline/publish check) before calling it clean. Pinned
with a new test (`fact-assembly.test.ts`, "does not claim 'clean' when cron-health-view returns
jobs with no real lastRun").

**Tests:** `router.test.ts` gained 6 tests pinning the exact 5 target-question routes (plus the
page-named variant winning page_specific). `fact-assembly.test.ts` gained tests for the enriched
`competitor` class (native-intel facts + fail-soft when native-intel throws), the enriched
`measurement` class (confidence/dollar/permutation facts), the new `keyword_next` class (surfaces
gaps, honest "already owned" fallback, empty-library and throw fail-soft), and the new
`system_health` class (failure streak, pipeline violation, failed publish check, all-clean, no
check yet, the cron-health-view false-positive pin, and a triple-throw fail-soft). One pre-existing
test's expectation was updated (`page_specific` "empty dossier" case now correctly asserts one
honest "no recommendation, no plan" fact instead of zero facts - the new behavior is intentional,
not a regression). `src/domains/ask/` totals: 94 tests (was 66), all passing. `npm run typecheck`
clean project-wide.

**Ground truth (real LLM spend, tenant-iranopedia, via a one-off `scripts/ground-truth-ask-d8.ts`
calling the real `askQuestionAction` pipeline, deleted after the run):**

1. *"who does AI recommend instead of me"* → competitor/dataforseo → **"Based on the prompts you
   track, AI most often cites reddit, then facebook, youtube, en.wikipedia.org, and
   media.gettyimages.com, and it failed to mention us on 7 of the 8 prompts. I recommend
   prioritizing visibility improvements because AI is favoring those other domains in your
   tracked prompts."** Cited: 5 native-intel recurring-domain facts + the absence count, all
   `/prompts`. Correct source (native 4-engine poll), real numbers.
2. *"which keyword should I chase next"* → keyword_next/dataforseo → **"I recommend we chase the
   keyword 'tehran' next because it has the highest monthly search volume and we currently do not
   own a page for it... I do not know keyword difficulty, conversion value, or effort required
   from the facts provided."** Cited: 5 real keyword-library rows (tehran 246,000/mo, flag of
   iran 135,000/mo, isfahan/abbasid caliphate/capital of iran ~27-33k/mo), all `/keywords`.
   Correctly sourced, honest about what it doesn't know.
3. *"what did my last batch of changes do"* → measurement/proof → **"In the last 7 days I shipped
   16 changes including edit_meta on /iran-flags/pahlavi-iran-flag... Of the 4 decided changes, 1
   won and 3 did not help, a 25% win rate. The five listed edits shipped on 2026-07-01 and are
   still measuring with low confidence, so I do not yet know their final impact."** Cited: the
   real proof ledger, each recent ship now naming its confidence level, all `/proof`. Correctly
   sourced with the new reliability depth.
4. *"is anything broken right now"* → system_health/profound → **"Yes. The data pipe is broken
   at the AI answer feed stage: the feed is connected but last night's sync wrote 0 rows, and
   downstream numbers are stale rather than zero. Start by running a reconnect check on the
   Connections page to restore the feed."** Cited: a real `readPipelineHealth` violation
   sentence, `/diagnostics`. This is the fixed-bug case in action - before the fix this would
   have said "clean" regardless; after the fix it correctly surfaced a real, live pipeline break.

All 4 answers judged good: each cited the intended new source, every number traces to a real
fact, no hallucination, no jargon, no em/en dashes. Confirmed durably persisted in Supabase
(`json_store_blobs`, scope `ask-history::tenant:iranopedia`, `select jsonb_pretty(content)`
returned all 4 rows with matching question/answer/citedFacts/askedAt).

**Honest caveat (operator-journey rendering):** could not get a screenshot or DOM snapshot of the
live `/ask` chat bubbles - the one open preview-browser tab against the dev server was already
stuck (`RangeError: Maximum call stack size exceeded` inside a `Map.set`, spamming an
already-in-progress reload loop against `/`, first observed before any D8 edits were made, so
not caused by this work) and every DOM-dependent preview tool (`preview_snapshot`,
`preview_eval`, `preview_screenshot`) timed out against it; `preview_resize` (a pure viewport
command) succeeded, confirming the tab's JS thread specifically was wedged, not the CDP
connection. Separately, the long-running dev-server process holds `ask-history` in an in-process
cache (`src/lib/persistence/json-store.ts`'s module-level `cache` Map) that is populated once
per process and only updated by a write FROM that same process - a standalone script's write
(even though it lands in the identical Supabase row the live page reads on a cold cache) does
not invalidate that process's stale snapshot, so the live page kept rendering 0 history entries
across three separate `curl` fetches even after the real write was confirmed in Supabase. Per the
"do not restart it" instruction the dev server was left running. The database-level proof (exact
`AskHistoryEntry` rows, matching question/answer/citedFacts) stands in for the pixel-level one
this pass; a fresh preview tab or the next dev-server restart for an unrelated reason will show
the same 4 answers rendered as chat bubbles with no further code changes needed.

**Not done / explicitly deferred:** D2 gap verdicts and D3 steal briefs (the allocator's other two
lanes) were not wired into a NEW ask fact source in this pass - the allocator's fused list is
already what `/worklist` renders, and `page_specific` already surfaces a page's `currentMove`
(which is allocator-ranked) when one exists; adding a raw gap-verdict/steal-brief dump would
duplicate that without adding a question class that needs it more directly than the existing
`plan`/`page_specific` classes already do. The hypothesis log and forecast-calibration summary
were also left unwired for the same reason - `measurement`'s new dollar/permutation facts and
`keyword_next`'s honest volume gaps cover the 4 target questions more directly than a raw
calibration-bias sentence would, and pulling in a 4th new store for a question nobody asked risks
"architecture, not source coverage." Either can be added the same way (one more `Promise.all`
branch, one more fail-soft catch) if a real question surfaces that needs them.

---

## 2026-07-02 - DREAM SITE V1 item D6: the daily ritual loop, static mode (FLOW half)

**What changed:** the operator's daily loop on `/worklist` - mark a change done (or skip it),
and Beacon always hands back the next best thing to do, with an honest running count of what
shipped today. Static mode only (the operator does the marking); dynamic auto-mode is a later
item. Scoped to the FLOW layer (client affordances + session state) per the concurrent D4
allocator DATA-layer boundary - `unified-list.ts` and the data-assembly loaders were not touched.

**Files:**
- `src/domains/changes/session-flow.ts` (new, pure) - `findNextActionable`, `nextBestLine`,
  `noDeadEnd`, `isActionableRow`. Walks the caller's already-ranked list; never re-ranks.
- `src/app/(shell)/worklist-session-strip.tsx` (new) - `useWorklistSession` hook (same-day
  localStorage counter + next-best pointer) and `WorklistSessionBanner` (the rendered strip).
- `src/app/(shell)/changes-list-client.tsx` (edited) - mounts the session hook over `visible`;
  wires `onAction` into every `<Row>`; adds a bare "Skip" button (calls the existing
  `respondToRecommendation(..., "deferred")`); adds j/k/enter/d keyboard nav; auto-scrolls +
  rings the next-best row.
- `src/app/(shell)/today-moves-card.tsx` (edited) - `MoveCard` gained an additive optional
  `onAction?: (action: "shipped" | "snoozed") => void` prop, called from the existing `ship()`,
  `stage()`, and `snooze()` success paths only (all still call the same `respondToRecommendation`
  action as before - no new persistence).
- `src/domains/proof-gsc/weekly-recap.ts` (edited) - added `shippedToday` and
  `stillDoubleCheckingCount`, both Pacific-calendar-day-keyed (matching
  `defaultPacificShipDate`'s clock) reads over the same ledger rows `shippedInLastDays` reads.
- `src/app/(shell)/page.tsx` (edited) - added `DailyCounterStrip`, rendered under the header,
  reading the two new `weekly-recap.ts` exports against the SAME `ledgerRows` already loaded
  for the streak line (no second ledger read).

**Tests:** `session-flow.test.ts` (13), `weekly-recap.test.ts` (+8, total 8 new since the file
was extended), `worklist-session-strip.test.tsx` (10, render + source-pinned wiring), 
`changes-list-client-session.test.ts` (11, source-pinned wiring: no-dead-end, keyboard, reuse of
existing server actions). `npm run typecheck` clean project-wide. Full re-verify of
`src/app/(shell)`, `src/domains/changes`, `src/domains/proof-gsc`: **1047 passed, 1 pre-existing
skip, 78 files.**

**Ground-truthed live on tenant-iranopedia** (read-only; no measurement state written):
- A `loadShippedChanges()` probe confirmed 25 real ledger rows exist, most recent shipped
  `2026-07-01T05:04:23Z` UTC = `2026-06-30` Pacific. `shippedToday`/`stillDoubleCheckingCount`
  both correctly returned 0 for "now" (2026-07-02 Pacific) - the Today strip self-hid honestly
  instead of showing a false "0 shipped" banner. Confirmed via `curl -m 60 http://localhost:3142/`
  (200, 323KB) that the literal string "Today you shipped" does not appear (correctly self-hidden).
- A `loadChangesView()` + `rankChanges(..., "balanced")` probe against real data returned 206
  total changes, 196 actionable. A simulated 5-step session walk using the real pure
  `findNextActionable`/`nextBestLine` produced 5 distinct, correct "Next best: ..." lines
  quoting real recommendations (e.g. *"Next best: You're losing 'persian girl names' - clicks
  dropped 51% (221 -> 109) over the last month... on persian female first names."*). Confirmed
  `noDeadEnd` holds both after 5 handled and after ALL 196 actionable rows are handled (honest
  end of queue, never a silent stall).
- `curl -m 60 http://localhost:3142/worklist` (200, ~1.2MB) confirmed 57 real distinct
  `change-row-<id>` markers rendered live, each with the new "Skip" button present.
- Did not mark any real row done on the live app: every existing ledger row was already
  `measuring` (already shipped/verified), so a fresh mark would have polluted live proof data.
  Verified the mark-done path instead via the source-pinned reuse checks above (the `d` key and
  the MoveCard `onAction` wiring both call the SAME `respondToRecommendation("accepted", ...)`
  `ship()` already used pre-D6) plus the two read-only ground-truth probes above.

**Caveats / NOT built:** dynamic mode (auto-prepare + a publish counter that runs without the
operator marking each row) is out of scope for this item - static mode was the full D6 ask for
now. The two throwaway ground-truth probe scripts were deleted after the run (no dead files left
behind).

---

## 2026-07-02 - DREAM SITE V1 item D2: native-cited teardown + commonality + gap verdict

**What changed:** the polite teardown engine's target planner now ALSO consumes the native poll's
cited pages, not just Profound's. New exports on `src/domains/demand-graph/competitor-page-audit.ts`
(the file this slice owns): `planNativeCitedTargets` (pure - groups native observation rows by
prompt, picks up to 5 cited pages per prompt, deduped by domain, ranked by in-prompt citation
count, noise/aggregator domains skipped via the existing relevance-gate list) and
`auditNativeCitedTargets` (I/O - politely fetches each target, 14d cache-aware, fail-soft per URL).
Profound-cited single-target planning is untouched and additive.

New `src/domains/demand-graph/teardown-commonality.ts` (pure) - "the best ideologies": given 2-5
competitor teardown facts for the same prompt, extracts a consensus outline (headings a MAJORITY
share), the dominant answer shape (definition-first/table/FAQ/steps/narrative), a word-count band
around the median, majority schema types, the dominant opening pattern, and (when we own a
matching page) `whatTheyAllHaveThatWeDont`. Fewer than 2 usable facts returns `null` - never
fabricates a consensus from one page. `commonalitySentence` renders the plain-language,
dash-free, operator-facing line.

New `src/domains/demand-graph/teardown-commonality-verdict.ts` (pure) - routes each prompt to
exactly one outcome: OWNED -> an atomic-edit brief (the owned URL, the specific missing shared
elements as additions, fanout questions to weave in); UNOWNED -> additive commonality fields for
a create-page candidate brief. Ownership reuses the same signal `create-page-ownership-gate.ts`
established (a resolved owned URL), never re-litigated. Contract enforced throughout: briefs
describe structure + facts to cover, never competitor prose - the drafter (a later step) writes
100% original content.

New `src/domains/demand-graph/native-teardown-runner.ts` (I/O composition) wires the above into
one nightly per-tenant run, including a real owned-page-facts lookup (`getRepository().forTenant
().getPageSnapshots()`, same pattern `gap-compiler.ts` uses) so the atomic-edit `additions` list
is a REAL comparison, not always empty. Wired as an isolated fail-soft `native-teardown` step in
`src/domains/ops/warm-caches.ts` (last of 8 steps, after `serp-steal-lane`; capped at 10
prompts/night, $0 spend - polite fetch only, same posture as displacement-check/serp-steal-lane).

**Ground-truthed live** on the real 24-row native poll (tenant-iranopedia, D1's 8-prompt run):
8 prompts analyzed, 31 real competitor pages fetched and parsed (0 blocked, all "ok" on first
run), 7 of 8 prompts produced a real CommonalityBrief (1 had only 1 fetchable page -> honest
`no_verdict`), verdicts: 6 new_page, 1 atomic_edit, 1 no_verdict. Second run against the same data
proved the 14d cache (0 fresh fetches, 31 served from cache).

**Bugs found and fixed during ground-truth (before calling this done):**
1. The atomic-edit `ownedUrl` carried the AI engine's `?utm_source=openai` tracking param -
   fixed by running the resolved owned URL through the existing `canonicalizeCitationUrl`.
2. The atomic-edit `additions` list was ALWAYS empty because owned-page facts were never loaded
   (`buildCommonalityBrief` was called with no `ownedFacts`) - fixed by adding the owned-snapshot
   lookup described above; re-verified live, e.g. "Persian Female First Names" now correctly lists
   10 real missing shared elements (a shared heading, an interactive tool, 7 schema types, a
   direct-answer opening) versus the 5 real competitor pages.

**Tests:** 68 new/updated (`teardown-commonality.test.ts` 18, `teardown-commonality-verdict.test.ts`
9, `competitor-page-audit.test.ts` +7 for `planNativeCitedTargets`, `warm-caches.test.ts` +5 for
the new step, existing pinned-order tests updated for the 8-step sequence). `npm run typecheck`
clean project-wide. Adjacent-domain regression check: 680 tests passing across
`src/domains/demand-graph`, `tests/domains/demand-graph`, `tests/domains/ops`,
`src/domains/ai-visibility` (no full-suite run, per the standing GitHub Actions minutes rule -
targeted + adjacent-domain coverage only).

**Caveats:** word-count bands can be wide when a real competitor's static HTML fetch returns thin
content (one girl-names competitor returned 14 words - likely JS-hydrated content a polite static
fetch cannot see); this is an honest reflection of real fetched data, not a computation bug. The
`native-teardown` step in `warm-caches.ts` has not yet run through an actual nightly cron
invocation (only the direct `runNativeTeardownForTenant` ground-truth script) - the composition
is deps-injectable and unit-tested the same way `displacement-check`/`serp-steal-lane` are.

---

## 2026-07-02 - DREAM SITE V1 item D7: honest opportunity math (math layer + data fields)

**What changed:** new `src/domains/forecast/opportunity-math.ts` (pure) - the ONE canonical
`computeOpportunity()` entry point every naive at-stake number should route through. Composes,
never duplicates: `ctrOpportunity90d`/`forecastRange` (`@/domains/experiments/pick-expectations`)
for the tenant CTR curve, the bias-correction factor (item 27, `clampCorrectionFactor`), and the
empirical capture band (item 64, `blendCaptureBand`/`captureBandForFamily` inputs, passed in by
the caller). Output: `{lowPerMonth, highPerMonth, days, basis, hypothesisId}`. `days` defaults per
lever family (14 for text-level changes - title/meta/h1/answer/link - matching the existing
14-day-read language in `pick-expectations.ts`'s `changeOurMind`; 28 for structural/new-page
changes) and accepts a measured override when a caller has one. `basis` is a plain sentence naming
real evidence ("Based on your own click rates at each Google position and N settled results, a
title change at position 9 usually adds 6 to 15 clicks a month within 28 days.") or, honestly,
"I do not have enough history to size this yet" (no position/impressions) / "the gap here is too
small to size honestly right now" (a real position exists but the page already meets or beats its
curve's expected CTR - never a fabricated range either way). `hypothesisId` is a deterministic
djb2 hash of `tenant|page|lever|day` so repeated renders of the same opportunity on the same day
log once, and the same id space is shared by `build-canonical-changes.ts`'s plan-pick path (which
already had a numeric forecast via `buildPickExpectations`) via a local copy of the same hash.
`computeOpportunityFromGap` is a second, lower-level entry point for a caller that only has a
pre-computed 90-day CTR-curve gap (not yet migrated to pass raw position/impressions) - same
`forecastRange` call, same output shape, byte-identical range math, just without the plain-English
position clause in the basis sentence.

**Hypothesis capture:** new `src/domains/forecast/hypothesis-log.ts` - an additive-only, fail-soft
I/O store (`captureHypothesis`/`loadHypothesisLog`/`hasHypothesisRecord`/
`computeAndCaptureOpportunity`) following the exact `forecast-calibration-store.ts` sibling
pattern: GLOBAL classification (rows carry `tenant_id`) + Supabase-mirrored (`opportunity-
hypotheses`, registered in `src/lib/persistence/store-classification.ts`'s `GLOBAL_STORES` and
`src/lib/persistence/json-store.ts`'s `SUPABASE_MIRRORED_STORES`). This is the render-time half of
"every forecast funds a learnable hypothesis" - `forecast-calibration-store.ts` already grades a
forecast at its day-28 settle; this store proves the exact hypothesis was on screen beforehand, so
the two can be joined by `hypothesisId`/page/lever later. Idempotent per `hypothesisId` (a repeat
capture of the same day's hypothesis is a no-op, first capture stands, never mutated).

**Naive-claim sweep (data layer only, per the item's explicit file-scope restriction):**
- `src/domains/changes/canonical-change.ts` / `build-canonical-changes.ts`: `upside` was
  `m.demand ?? null` (a raw GSC-impressions/demand-graph-weight number labeled "monthly demand at
  stake") - now the midpoint of `computeOpportunity`'s own range, null exactly when the range is.
  `expectedOutcome` was a bare `forecastRange(...)` call with no correction factor or capture
  band applied - now the full `basis` sentence from `computeOpportunity`/`computeOpportunityFromGap`.
  Added additive optional fields `expectedOutcomeLow/High/Days` and `hypothesisId` to
  `CanonicalChange` (numeric twins of the prose range, same pattern as `PickExpectations.
  forecastLow/High`, item 28).
- `src/app/(shell)/changes-data.ts`: now loads `forecast-calibration-store.ts`'s ledger, resolves
  the tenant's own `correctionFactor` + per-`actionFamily` `captureBand` via
  `forecast-calibration.ts` (the SAME machinery `build-today-preview.ts` already uses for the
  nightly plan - not a second implementation), threads the real `topQueryPosition/Impressions/
  Clicks90d` signal into `CanonicalMoveInput`, and fire-and-forget captures every actionable
  (`suggested`/`ready`/`apply`) row's hypothesis via `captureHypothesis` (best-effort; a logging
  hiccup can never slow or break the render).
- `src/app/(shell)/today-moves-data.ts` + `src/app/(shell)/moves/moves-data.ts`: `demandAtStake`
  was literally `top.reduce((s, m) => s + (m.demand ?? 0), 0)` - the exact "500k people at risk"
  pattern the operator named verbatim in the DREAM SITE V1 mission text. Now the sum of each shown
  move's own `computeOpportunity` forecast midpoint (using its real top query's position/
  impressions/clicks when present), honest-zero for a move with no live per-query GSC signal -
  never an inflated impression/weight count.
- `src/domains/action-pack/types.ts` / `adapters.ts`: added nullable `ActionPack.forecast`
  (`ActionPackForecast`), computed in both `moveCandidateToActionPack` and
  `aeoActionPackToActionPack` (always null for the latter - Profound-coverage packs carry no GSC
  position signal, so every one would honestly read "not enough history," which would just be
  visual noise repeated on every card - the field's absence IS the honest signal). Carried through
  both `dedupeActionPacks` and `collapseCreateContentPacks`'s merge logic (prefer existing/richer,
  same posture as the other optional evidence fields).

**What was deliberately left alone (in scope for a future slice, not this one):**
`adapters.ts`'s `whyNotNoiseForMove` still surfaces a raw `demand`/`dollarValue`/`impressions`
number - but explicitly LABELED as such ("demand 26981", "$-signal 412", "26,981 GSC impressions")
as evidence-of-relevance provenance text, not presented as a clicks/revenue forecast; this is a
different, already-honest pattern (trust receipts) and changing it was out of this item's naive-
claims-only scope. `build-daily-plan-record.ts`/`build-today-preview.ts`'s plan-pick path was not
touched - it already computes an honest range via `buildPickExpectations` (CTR curve + correction
factor + empirical capture band, same machinery), it simply does not yet call
`captureHypothesis`; wiring that in is listed as follow-up, not done here, since it sits in a file
this item's rules did not require touching and doing so risked a larger blast radius than the
sweep needed.

**Tests:** 28 new (`src/domains/forecast/opportunity-math.test.ts`) covering the honest-gap path,
byte-identical range math vs a direct `forecastRange`/`ctrOpportunity90d` call, correction-factor
and capture-band composition, the basis sentence's real-evidence content (position/target/settled-
count clauses), lever-name coverage across both the `ExperimentLever` and `ActionType`
vocabularies (a real regression: an unmapped lever produced "a change change" until fixed), time-
to-impact defaults + measured override, hypothesisId determinism, and `computeOpportunityFromGap`'s
byte-identical legacy path. 15 new (`src/domains/forecast/hypothesis-log.test.ts`) covering round-
trip, tenant scoping, idempotency, the honest null-range capture case, fail-soft read/write, and
additive-only (never-mutates) history. `src/domains/action-pack/collapse-create-page-packs.test.ts`
updated (added `forecast: null` to its literal `ActionPack` factory). Re-verified: 154 existing
targeted tests across `src/domains/forecast`, `src/domains/changes`, `src/domains/action-pack`,
`src/domains/experiments/{pick-expectations,forecast-calibration,forecast-calibration-store,
empirical-capture}.test.ts`, and `src/lib/persistence` all green; the full `src/app/(shell)` suite
(41 files, 452 passed, 1 pre-existing skip) green. `npm run typecheck` clean project-wide.

**Ground-truth (real Supabase, tenant-iranopedia, read-only, no writes):**
`scripts/_d7-opportunity-math-probe.ts` loads the real ranked worklist + real GSC per-query rows
and prints the OLD claim vs the NEW range/basis for the top 10 pages ranked by the OLD naive
demand number (the pages most likely to have carried an inflated claim). Result: OLD sum across
these 10 = 280,713 (raw demand-graph weight/impressions); NEW sum = ~11 real clicks/month. Per-row
detail: 3 of 10 have a real live per-query GSC signal (`/persian-male-names` pos 3.76/10.0% CTR
vs curve's ~8% at pos 4 - already overperforming, honest null; `/persian-female-first-names` pos
5.62/6.51% CTR vs curve's ~5% - already overperforming, honest null; `/iran-flags` pos 8.53/0.08%
CTR vs curve's ~3% at pos 9 - genuine gap, forecasts "6 to 15 clicks a month within 28 days");
7 of 10 have no live per-query row for that exact URL variant today (honest "I do not have enough
history to size this yet", not a stale reuse of the demand-graph's precomputed weight). Command:
`set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia npx tsx --require
./scripts/mock-server-only.cjs scripts/_d7-opportunity-math-probe.ts`.

**Scope compliance:** confirmed zero diff on `src/app/(shell)/changes-list-client.tsx`, demand-
graph candidate generation (`build-graph.ts`, `gap-compiler.ts`, `load-graph.ts`,
`evidence-packet.ts`), `src/app/(shell)/research/keywords/**`, and `src/app/(shell)/page/[...path]/
**` (the dossier route) - all owned by concurrent agents per this item's explicit instructions.

**Not yet wired (follow-up, listed not built):** the `/moves` and Changes-list UI components
actually rendering `ActionPack.forecast` / `CanonicalChange.expectedOutcomeLow/High/basis` (data
fields exist and are populated end to end; client rendering is a UX-track follow-up;
`changes-list-client.tsx` already renders `c.expectedOutcome` unconditionally when truthy, so it
picks up the new honest sentence automatically with zero code change, but does not yet show the
new numeric range or a "why" breakdown); `build-daily-plan-record.ts`/`build-today-preview.ts`'s
plan-pick path capturing a hypothesis at render time; a launched-page graduation path for
`create_page`/`create_new_page` candidates (correctly honest-gap today since no position exists
pre-launch, by design - not a bug, just unbuilt).

---

## 2026-07-02 - DREAM SITE V1 item D1: native 4-engine poller becomes the internal Profound (analysis layer)

**What changed:** the analysis layer over the already-built native 4-engine poller
(`src/domains/ai-visibility/run-engine-poll.ts`, unchanged). New pure module
`src/domains/ai-visibility/native-intel.ts` computes, from `prompt_answer_observations` rows
only: recurring domains (third-party sites AI keeps citing across distinct prompts, ranked by
distinct-prompt count then citation count, own-domain and search-engine redirect-wrapper hosts
excluded), recurring exact pages at the same ranking shape, a per-prompt per-engine
we-are/we-are-not matrix with the real answer sentence quoted when mentioned (null, never
fabricated, when the mention falls outside the stored 400-char excerpt), and native question
expansion (question-mark sentences extracted from answer text, list-marker prefixes stripped,
deduped, never a question expanding into its own source prompt). New
`src/domains/ai-visibility/native-intel-loader.ts` does the one paged Supabase read (1000-row
cap, most-recent-first, tenant-scoped) and builds tenant brand variants; fail-soft to an honest
empty report throughout.

**Surface:** `/prompts` gained a new self-hiding "Who AI keeps recommending" block
(`src/app/(shell)/prompts/native-intel-view.tsx`), rendered above the existing Profound-powered
`AiQuestionsView` in both page branches of `src/app/(shell)/prompts/page.tsx`, honestly labeled
"From my own checks of the AI engines... not from Profound." Additive, not a replacement:
Profound stays wired; full deletion is a staged D1-followup per the operator's own "ok to
delete... but" framing in the DREAM SITE V1 mission text, not executed here.

**Fanout pipeline:** `src/domains/demand-graph/load-fanout-seeds.ts` (the single loader every
`fanoutSeeds` consumer reads - demand graph, evidence packets, keyword research, FAQ drafter) now
merges Profound fanout rows with native question-expansion seeds via new `mergeFanoutSources`
(pure): same `FanoutSeed` shape, new additive optional `source: "profound" | "native"` field
added to the type in `src/lib/connectors/profound/summarize-fanouts.ts`, deduped by normalized
question text (weight summed, prompts unioned on overlap), so every existing consumer gets native
follow-up questions for free with zero call-site changes.

**Ground truth (real spend, real data):** `prompt_answer_observations` was empty for
tenant-iranopedia going into this work (first real nightly cron run was pending). Ran ONE bounded
live poll of 8 real Iranopedia questions (the tenant's own synced Profound prompt seeds via
`loadProfoundQuestionSeeds`, not the global prompt-library store, which currently holds a
different tenant's questions - confirmed a pre-existing condition, out of scope here) through
`runEnginePollForTenant`'s own existing budget gauntlet (native OpenAI/Perplexity keys +
DataForSEO cache/dry-run/monthly-cap path). Real cost: **$0.5366** (gemini $0.2966 + claude $0.24,
both real DataForSEO spend; claude's 8 calls all failed server-side and were still billed;
chatgpt + perplexity ran on native API keys at $0 marginal cost). DataForSEO monthly spend before
this run was $0.129 of the $50 cap; after, $0.666.

Wrote 24 real observation rows across 3 working engines (chatgpt, gemini, perplexity; claude
errored on every call). Real native-intel output over those 24 rows: 15 recurring domains led by
reddit.com (7 of 8 prompts, Perplexity), facebook.com (5 of 8, Perplexity), youtube.com (4 of 8,
chatgpt/perplexity), en.wikipedia.org (3 of 8, chatgpt/perplexity); we-are/we-are-not matrix 1
present / 7 absent (Iranopedia's own `/persian-female-first-names` page was cited by ChatGPT at
citation rank 4 on "What are beautiful Persian girl names and their meanings?", mention position
1016 characters into the answer, outside the 400-char excerpt window so no sentence could be
quoted for that cell - honest, not a bug); 0 native follow-up questions found this run (the
400-char `answer_excerpt` truncates before most markdown-formatted answers reach a "?" - a real,
documented limitation of the current storage, not a defect in the extractor, confirmed by manual
inspection of all 24 raw excerpts).

**Rendered proof:** `curl -m 180` against the running dev server, `/prompts`, tenant-iranopedia.
Block renders with the real numbers above: "From my own checks of the AI engines (ChatGPT, Gemini
and Perplexity), not from Profound. I asked 8 real questions directly and read what came back."
"You showed up: 1." "You were absent: 7." "Sites that keep coming up: 15." Per-prompt engine
badges render real prompt text and per-engine status (e.g. "ChatGPT: does not"). The empty
native-questions sub-section correctly self-hides (verified zero occurrences of its header string
in the rendered HTML) rather than showing a hollow placeholder.

**Tests:** 38 new/updated, all green - `native-intel.test.ts` (30, covering recurrence ranking,
own-domain and redirect-wrapper exclusion, sentence extraction, the presence matrix including
latest-observation-wins and absent-everywhere sorting, question extraction and rollup, the
combined report), `tests/domains/demand-graph/load-fanout-seeds.test.ts` (+5 for
`mergeFanoutSources`), `summarize-fanouts.test.ts` (2 updated for the new `source` field). Broader
targeted run across the `ai-visibility` domain (`run-engine-poll`, `engine-gaps`,
`question-universe`, `answer-drift-loader`, `second-order-citations`): 106/106 pass, no
regressions. `npm run typecheck` clean project-wide.

**Found and flagged, not fixed (outside D1's file scope):** `observation_runs` writes silently
fail with a `tenant_id` NOT NULL constraint violation somewhere in the dual-write path during the
live poll, even though `run-engine-poll.ts` sets `tenant_id` correctly on the row it builds - this
breaks any "did last night's poll actually run" audit read from that table. Spawned as a separate
background task rather than fixed here since the root cause lives in `dual-write.ts` /
`persist-run.ts`, outside the analysis-layer scope of this item.

**Caveats:** the global prompt-library store (`src/domains/prompts/prompt-library.ts`) is
tenant-agnostic (GLOBAL, per its own file header) and currently holds a different tenant's
prompts; the real nightly cron for tenant-iranopedia would poll those irrelevant questions unless
this is fixed, which is a pre-existing condition outside D1's scope, not introduced or fixed here.
Native question expansion will read as under-populated until either the stored answer excerpt is
lengthened or more nights of real polling accumulate more raw text to extract from - the pipeline
is correct and tested; the current live count (0) is a data-volume/truncation fact, not a bug.

---

## 2026-07-02 - MASTER PLAN v2 item UX0: New Pages data-correctness prerequisites

**What changed (operator personally found all of these live, fixed all 4):**

**1. New-page generator corruption, root-caused and fixed:**
- **Root cause of the topic-gluing bug:** `src/domains/demand/keyword-match.ts`'s `FILLER` set
  didn't include superlatives/quantifiers ("most", "many", "common", etc.), so "most beautiful
  natural places" and "most common name in iran" shared the word "most" and falsely matched as a
  weak keyword hit. That false match then let `src/domains/demand/canonical-create-page.ts` merge
  two UNRELATED topics because both loosely touched the same noisy cached keyword. Fixed both:
  the FILLER set now excludes superlatives, and `mergeSignal()` requires the two candidates ALSO
  share a distinguishing token with EACH OTHER (not just the shared keyword) before a weak-keyword
  merge is allowed.
- **New explicit coherence gate** (`src/domains/demand-graph/topic-coherence-gate.ts`, PURE): tests
  a candidate's member sub-queries/URLs against its own head label (reusing
  `evidence/relevance-gate.ts`'s distinguishing-token rule); drops disagreeing members, suppresses
  the whole candidate when <50% agree. Wired into `load-graph.ts`'s create_page synthesis (drops/
  suppresses BEFORE a candidate becomes a Move, logged) and, independently, into
  `prepare-create-page-verdicts.ts`'s Prepare-all action (never spends a SERP call on an incoherent
  candidate; reports `skippedQualityGate` back to the operator).
- **New ownership gate** (`src/domains/demand-graph/create-page-ownership-gate.ts`, PURE): a
  create_page Move whose OWN attached AEO evidence shows `ownCitationCount > 0` (AI already cites
  the tenant for this topic) is reclassified to `edit_page` (pointing at the actual cited owned
  URL) or dropped - never left claiming "you have no page yet". Runs right after the Profound
  evidence attach, before canonicalization.
- **Title-grammar hardening** (`src/domains/demand-graph/clean-topic-label.ts`): new
  `isUnparseableLabel()` rejects a label trailing off on a bare orphan verb (generic English list:
  hear/read/see/cross/keep/etc.) - catches "Deadly Misconceptions About Iran Hear Cross". Wired
  into both `isJunkTopic` (board-facing gate) and `load-graph.ts`'s local `isJunkTopicLabel`
  (upstream candidate-creation gate).
- **Duplicate-topic dedup** (`src/domains/demand-graph/dedupe-new-page-cards.ts`, PURE): a final
  pass over the New Pages board's combined card list (graph + keyword-gap + wiki-gap cards)
  collapses reordered/near-duplicate topics ("restaurants in tehran" vs "tehran restaurants") to
  ONE card, keeping the one with a real DataForSEO search-volume number over a proxy score.

**2. Measuring-count unification:** `src/app/(shell)/changes-data.ts` now also reads
`loadProofLedgerCached` (same canonical source `page.tsx`'s A2 fix already threads on Today) and
exposes `measuringCountCanonical` on `ChangesView`. `changes-list-client.tsx`'s Measuring tab badge
shows the canonical count, and says "N of M" (e.g. "10 of 16") whenever this worklist's own subset
is smaller than the tenant-wide total - never a bare number that silently disagrees with Today.

**3. Impressions vs. searches, swept app-wide:** `c.upside` in `changes-list-client.tsx` (GSC
impressions/demandWeight) was labeled "searches/mo at stake" - fixed to "shown on Google/mo at
stake". A repo-wide audit (deep-research subagent) found 4 more instances of the same bug class,
all fixed: `build-daily-candidates.ts` ("People search X (N searches)" -> "Google shows this page
for X (N times a month)"), `refresh-brief.ts` (`buildNewQueryGapSentence`, same fix),
`language-gaps.ts` ("This page draws N searches typed in..." -> "shown on Google N times a month
for queries typed in..."), and the workbench striking-distance surface (`workbench-view.tsx` +
`page-brief.ts`) whose `strikingDistance.volume` field is GSC impressions dressed as "searches/mo"
because the intended DataForSEO/SEMrush source (`packet.semrush`) has been permanently dead code
since the Phase F.1 SEMrush removal - relabeled to "shown ...{n}/mo" (a real DataForSEO rewire is
flagged as a separate future item, out of this pass's scope).

**4. Prepare-all safety:** `prepareCreatePageVerdicts` now runs the same coherence gate directly
(belt-and-suspenders with the upstream load-graph gate) and reports `skippedQualityGate: {label,
reason}[]` in its summary; `NewPagesPrepareButton` surfaces "skipped N that failed my quality
check" in its result message. Also fixed 2 pre-existing em-dash violations in that button's copy
while editing it.

**Ground truth (real tenant-iranopedia data, dev server on :3142, `curl -m 180`, plus a
`scripts/_ux0-newpages-gate-probe.ts` tsx probe against the live Supabase-backed demand graph):**
- Coherence gate: 2 candidates SUPPRESSED ("all about nowruz kids", "how create relaxing spa" -
  each only 1/3 members on-topic), 4 candidates TRIMMED (1-2 off-topic members dropped, card kept).
- Ownership gate: 10 candidates DROPPED for being already AI-cited under their own domain
  (including "persian literature", "gifts", "irans most beautiful places" and 7 others) - 0
  reclassified to edit_page this run (no specific owned URL was identified in the cited-pages set
  for any of them, so the gate correctly dropped rather than guessed a URL).
- Live `/worklist` render, quoted: the "Iran Natural Attractions" card now shows "Also covers:
  Travel Iran Beautiful Natural Wonders" (absorbed as a sibling under a coherent parent, not its
  own corrupted card). "Persian Literature" and "Deadly Misconceptions About Iran Hear Cross" do
  not appear anywhere in the rendered board. The Measuring tab renders literally `Measuring 10 of
  16` (quoted from the live HTML). A ranked-change row renders `13 shown on Google/mo at stake`
  (tooltip: "13 times shown on Google a month, at stake") where it previously said "13 searches/mo
  at stake".
- All 3 operator-found corrupted labels confirmed gone/reclassified by both the fresh-snapshot
  probe and the live curl.

**Tests:** 46 test files / 580 tests green across every touched module (topic-coherence-gate.ts,
create-page-ownership-gate.ts, dedupe-new-page-cards.ts, clean-topic-label.ts, keyword-match.ts,
canonical-create-page.ts, load-graph.ts, prepare-create-page-verdicts.ts, changes-list-client.tsx,
build-daily-candidates.ts, refresh-brief.ts, language-gaps.ts, page-brief.ts and its shared
recommendation-intelligence pinned-copy test). `npm run typecheck` clean. One pre-existing pinned
test was updated to match the new, correct, dash-free copy
(`tests/domains/recommendation-intelligence/page-brief.test.ts`, which imports the SAME
`page-brief.ts` module the workbench uses). A full `npx vitest run` (20k tests) surfaced 8
additional pre-existing failures, all confirmed by direct import-trace to be unrelated to this
item's files (concurrent work in `proof-gsc`/`experiments`/`citability`/unrelated diagnostics
domains) - not fixed here, out of scope, flagged for their respective owners.

**Recommended capability for next step: Balanced** - UX1 (Universal Page Dossier) is DONE per the
master plan; UX2's first slice (Keywords library) is also DONE. Next up per the locked sequencing
is continuing UX2's remaining sub-hubs (Pages, Topics, Content roadmap) or UX3 (Changes as a dense
inbox) - medium-complexity UI + data-flow work, not architecture-level, so Sonnet-tier is right.

## 2026-07-02 - MASTER PLAN v2 item UX1: Universal Page Dossier backbone

**What changed:** completed `/page/[...path]` (the page dossier route) and wired every reachable
page-name surface in the app to it. Added a content band (title/meta description/H1/word
count/last-crawled freshness) and a "Visit the live page" header link. New bounded loader
`loadPageContentSnapshot(tenantId, url)` in `src/domains/recommendation-intelligence/page-freshness.ts`
does one `.eq("tenant_id").eq("url")` point read against `page_snapshots` (same pattern as
`answer-alignment-store.ts`/`factual-entailment-store.ts`, including the www./bare-host retry),
never a bulk scan. `PageDossier.liveUrl` resolves the best-known full URL from data already loaded
in the composition (GSC canonical URL, then the current change/plan pick, then the latest shipped
record) with zero new I/O.

**Dossier sections, before -> after:** chart, queries, team reads, current move, rewrite, history
(6 bands) -> chart, queries, content (new), team reads, current move, rewrite, history (7 bands).

**Link-wiring swept the app** for plain-text page-path/URL renders not yet going through the
shared `dossierHref` helper. Newly wired: `changes-list-client.tsx` (`/worklist` Changes row
title - the single highest-traffic unwired surface), `diagnostics/page-surgeon/page-surgeon-client.tsx`,
`diagnostics/page-surgeon/proof/page.tsx`, `diagnostics/page-surgeon/review/review-client.tsx`.
Already wired before this item (confirmed, untouched): `today-moves-card.tsx` (MoveCard),
`daily-experiments-section.tsx`, `proof/page.tsx` (Results ledger), `war-room-sections.tsx`.
8 reachable surfaces total link into the dossier now.

**Investigated and explicitly skipped** (confirmed orphaned - zero inbound links anywhere in the
app, not in `src/lib/navigation.ts`'s `navigationGroups`, not linked from any card): `/pages`
(deliberately disabled placeholder route, own file header says so), `/topics`, `/workbench`.

**Investigated and explicitly not built** (would need new join/aggregation logic, out of scope
for a read-only composition item that must not add heavy new computation): an internal
links-in/out band (no linking-graph loader exists anywhere in the codebase today) and a
competitors-on-this-page's-topics band (competitor teardown audits are keyed by domain, not by
page or topic, and no existing join bridges the two). AI citations/questions-answered are already
covered by the existing `teamReads.funnel` band (crawled/cited/aiClicks counts + a plain
bottleneck sentence).

**Fixed in passing:** 15 pre-existing em/en dash violations across the 4 newly-touched files
(`changes-list-client.tsx`, `page-surgeon-client.tsx`, the Page Surgeon proof page, the Page
Surgeon review client) - found while editing those files, fixed per the operator's absolute
no-dash rule since they sat immediately next to the new code.

**Tests:** 7 new tests for `loadPageContentSnapshot` (empty input, found row, www-fallback
found, no row either variant, read error, thrown exception, malformed-URL is a no-op retry) in
`src/domains/recommendation-intelligence/page-freshness.test.ts`. Extended
`page-dossier-data.test.ts` (content/liveUrl composition + fail-soft cases) and
`dossier-sections.test.ts` (Suspense count, content-band empty state + definition-list shape,
header live-link markup, 4 new cross-app link pins). 65 total dossier-area tests pass.
`npm run typecheck` clean project-wide.

**Ground-truthed live on tenant-iranopedia** via `curl -m 180` against the running dev server
(`http://localhost:3142`):

- `/page/persian-female-first-names` rendered end to end with real data: header with "Visit the
  live page ↗"; a 59-day clicks chart; 10 real top queries (top: "persian girl names", 429
  clicks / 6,588 impressions / position 5.6); the new content band ("Popular Persian Girl Names
  List with Meanings" title, a real meta description, "Popular Persian Female(Girl) First Names
  and their Meanings" H1, 1,091 words, "Last crawled 21 days ago"); team reads (1,510 clicks /
  44,430 impressions over 90 days; visitor friction with a real rage/dead-click read; "AI answers
  cited this page 11 times"); a live current recommendation ("Capture clicks... clicks dropped
  51% (226 -> 110)"); an honest empty history band.
- `/worklist` rendered real `/page/...` links on Changes row titles: `/page/ahvaz`,
  `/page/cities`, `/page/famous-iranian-poets`, and 20+ other distinct pages linked on one render.
- `/diagnostics/page-surgeon/proof` rendered `/page/persian-male-names` and the corrected
  "Page Surgeon, proof plan" heading (dash removed).
- Zero em/en dashes found in any of the three rendered pages' raw HTML.

**Caveats:** internal-links and competitors-per-page bands remain unbuilt (see above, both need
new join logic this item's scope excludes). `/pages`/`/topics`/`/workbench` still exist as routes
but stay unwired since nothing in the live app can navigate to them today; if they are ever
revived, they should get dossier links too. One other agent committed unrelated concurrent work
(`4c73c154`, `77a0e024`) to this shared branch/worktree during this session; this item's changes
rode along inside those commits since `git commit` on a shared worktree captures the full working
tree, not just one agent's files - confirmed byte-for-byte via `git show`/`git diff` that nothing
of this item's work was lost or altered by that overlap.

---

## 2026-07-03 - MASTER PLAN v2 item N13: detect and replace comparison pages edited mid-window (worktree, NOT committed)

**What changed:** a ship's diff-in-diff comparison pages (controlPages) are chosen once at
selection time but nothing previously watched whether those pages changed DURING the
measurement window, silently contaminating the verdict. New pure classifier
`src/domains/proof-gsc/control-contamination.ts` reads a ship's window + the full ledger (every
other ship, to catch a control that was itself later treated) + `page_snapshots` content-hash
history (to catch a control edited for reasons the ledger has no record of) and classifies each
control `clean | treated_by_us(date) | content_changed(betweenScans) | unknown(sparse coverage)`.
Sparse scan coverage is honestly `unknown`, never assumed clean.

**Operator-corrected design (mid-task):** the first pass re-ranked a fresh comparison-page
candidate pool at READ time using live GSC data when a substitute was needed - outcome-aware,
biasing the verdict toward whatever the replacement happened to show. Corrected to FREEZE-AT-SHIP-
TIME / PROMOTE-NOT-RESELECT: `auto-record-on-ship.ts` now persists the FULL ranked donor pool
(`control-matching.ts`'s complete `RankedControl[]` - kept and excluded, original order, with the
matching inputs) as a new `controlDonorPool` field, written ONCE at ship time, never rewritten.
Migration `migrations/2026-07-03_shipped_change_proof_control_donor_pool.sql` adds the additive
`control_donor_pool jsonb` column (NOT applied - the store tolerates the column missing via the
existing PGRST204 file-fallback convention, same posture as `control_match_notes`). At read time,
`control-contamination.ts`'s `promoteFromFrozenPool` walks ONLY that frozen pool in its original
order and promotes the next eligible ("kept", not already a control, not the treated page, not
already promoted for another contaminated control) donor - no re-ranking, no fresh candidate
computation, no live data. When the pool is absent (predates N13) or exhausted, no promotion
happens; the verdict still runs on the original controls with an honest caution caveat.

**Surfaced:** `measurement-maturity.ts` gained `controlContaminationFlagged`/
`controlContaminationCaveat` (additive, same posture as `weakComparison`/`seasonalInflection`/
`recrawlPending` - demotes `learningEligibility` to false, explicitly named as an N10 verdict-
reliability composite input). `/proof`'s card renders the caveat both inline (amber, same style as
the weather/parallel-trends caveats) and inside "See the math".

**Tested:** `src/domains/proof-gsc/control-contamination.test.ts` (28 tests: classifier precedence,
sparse-coverage honesty, frozen-pool promotion order including "never pick a later/better-looking
donor over the next-in-line one", exhausted/absent-pool fallback) + `attach-control-contamination.test.ts`
(13 tests: batch snapshot-history read paging + host-variant matching, ledger-wide classification,
promotion end-to-end, fail-soft) - 41 new tests total. `npm run typecheck` clean. Targeted vitest:
`src/domains/proof-gsc/` full directory 523/523 pass; `"src/app/(shell)/proof/"` 84/84 pass.

**Ground-truthed on the real 25-ship Iranopedia ledger** (`scripts/ground-truth-control-contamination.ts`,
read-only, no writes): **all 25 ships have at least one contaminated control today** (229 total
across all ships; most read `unknown` from sparse `page_snapshots` coverage inside their windows).
**7 real `treated_by_us` cases, all the same root cause:** `/cities` and `/funny-farsi-phrases`
(shipped 2026-06-20), `/iran-animals/asiatic-cheetah`, `/iranian-actors-actresses`,
`/famous-iranian-comedians`, `/farsi-numbers`, `/famous-iranian-singers` (all shipped 2026-06-21) each
used `/persian-male-names` as a comparison page; `/persian-male-names` was itself treated (a schema
change) on 2026-06-22, inside every one of those 7 ships' still-open measurement windows. Confirmed
this slips through the pre-existing `experiment-eligibility.ts` guard
(`activeTreatmentPaths`/`cleanControlPaths`, which already excludes a control that is CURRENTLY
"measuring" from the diff-in-diff math) because that guard keys off `outcomeStateOf`, and
`/persian-male-names`'s stored `verdict` already flipped to `inconclusive` at its 7-day checkpoint
even though its 14- and 28-day windows are still open - so `activeTreatmentPaths` no longer sees it
as active even though it plainly still is. This is a real, currently-live gap N13 closes; confirmed
live via a throwaway script that `cleanControlPaths` returns `/persian-male-names` unfiltered for
`/cities`'s controls today. **0 of the 25 ships have a `controlDonorPool`** (all predate N13), so
every one of the 229 contaminated controls correctly reports "no clean substitute available,
reading with caution" - 0 swaps, by design, never a post-hoc fabricated pick.

**Rendered verification** on the live dev server (`http://localhost:3142/proof`,
`x-beacon-tenant: tenant-iranopedia`, warm compile ~30-60s, curl -m 300): the `/cities` card renders
the amber caveat `A comparison page changed during measurement, so I am reading this result with
caution.` both as a visible `text-amber-700` line on the card and as a `<p>` inside "See the math",
alongside the page's existing weather/seasonal/permutation-null caveats. 25/25 ledger cards carry the
caveat in the rendered payload, matching the ground-truth script's count.

**Caveats:** the migration is written but NOT applied (operator/orchestrator applies); until it is,
`controlDonorPool` stays null for every new ship too (file-fallback round-trips it correctly once
Supabase has the column). No existing ship can be retroactively backfilled with a frozen pool - the
whole point of freeze-at-ship-time is that a pool computed after the fact would already be
post-outcome-informed, so the 25 real ships will always show 0 swaps until new ships are recorded
after this lands. Sparse `page_snapshots` coverage means `content_changed` detection is currently
weak in practice (`unknown` dominates) - improves automatically as weekly rescans accumulate more
in-window snapshots per page.

---

## 2026-07-02 - MASTER PLAN v2 item N11: recrawl-gated measurement clock (worktree, NOT committed)

**OPERATOR CORRECTION APPLIED (same day, after the entry below was written):**

1. **Split clock.** The recrawl gate applies ONLY to Google-search outcomes (the GSC
   ranking/impressions/clicks/CTR verdict lane). GA4 traffic reads, Clarity behavior reads,
   publishing-integrity checks, and conversion measurements start at live_at as before and are never
   capped at "Waiting". Concretely: `measurement-maturity.ts` now also neutralizes `direction` to
   "unknown" while pending (the plain Search line renders "Not clear yet.", never a stale-index
   "This is probably hurting."), nulls `nextCheckpoint` while pending (no false "matures YYYY-MM-DD"
   countdown through `proofBadgeMaturesOn`), and gained a `recrawlConfirmedAt` input: once confirmed,
   the SEARCH checkpoints count from the confirmed index crawl via the new downgrade-only
   `effectiveSearchBasisDay` (a stored-mature 28d window with only 14 days since the index crawl reads
   as interim; with under 7 days it reads as collecting, "First checkpoint opens <confirm+7>. ... The
   search clock counts from when Google re-read this page."). The `/proof` card's GA4 traffic block
   renders unconditionally on `rec.trafficOutcome` - pinned by the new
   `src/app/(shell)/proof/proof-split-clock.test.ts` (7 tests: search-lane gated pins + a source scan
   asserting no recrawl field ever appears in the guard window of the trafficOutcome/citationOutcome/
   rankOutcome renders + the caveat renders through the same visible seam as the sibling guards).
2. **Corrected copy** (recrawl-clock.ts `recrawlBlindSentence`, renders as the card caveat and the
   Waiting explanation): "Google has not re-read this page yet, so the search clock has not started.
   Visit tracking started the day the change went live." (+ "It has been N days since you shipped
   this." when known).
3. **Index-crawl semantics.** `gsc_url_inspections.last_crawl_time` is `indexStatusResult.lastCrawlTime`
   - the crawl behind Google's INDEXED version, not a live-page inspection. All doc comments in
   recrawl-clock.ts / attach-recrawl-clock.ts / measurement-maturity.ts / page.tsx reworded; basis
   "inspection" now documented as "Google's index shows a crawl after the change went live"; a test
   pins that operator copy never contains "inspect".
4. **Checkpoint-144e7734 preservation:** proof-badge.ts untouched (a pending row maps to exactly
   "Waiting", one of the six C2 words, pinned); See-the-math structure untouched.

Corrected totals: 127 targeted tests green across 7 files (recrawl-clock 19, attach-recrawl-clock 9,
auto-measure-recrawl 5, measurement-maturity 63 incl. the new split-clock + confirmed-shift describes,
proof-plain-vocabulary 21, proof-split-clock 7, proof-jargon-guard 3); typecheck clean on all owned
files (transient errors in other concurrent agents' in-flight files - serp-history.ts,
page-dossier-data.ts - are not part of this slice and resolve as those agents land).

**What changed:**

- New `src/domains/proof-gsc/recrawl-clock.ts` (pure, no I/O): given a ship's `liveAt`, its URL-Inspection
  history, and an optional cheap SERP-title fallback, computes `{ recrawlConfirmedAt, basis, daysBlind,
  hasInspectionHistory }` - the earliest evidence Google actually re-read the NEW content. `basis` is
  `"inspection"` (a `gsc_url_inspections` crawl strictly after `liveAt`), `"serp_title"` (built, not yet
  wired to a real data source - `serp-history.ts`'s `SerpRankPoint` carries rank only, no displayed
  title), or `"none"`.
- New `src/domains/proof-gsc/attach-recrawl-clock.ts`: one Supabase read of `gsc_url_inspections` per
  render, grouped by `inspection_url`, joined to ledger rows by id. Mirrors
  `attach-seasonal-inflection.ts` exactly. Fail-soft to an empty map on any read error.
- `measurement-maturity.ts`: additive `recrawlPending?: boolean` + `recrawlDaysBlind?: number | null`
  inputs and `recrawlPending: boolean` + `recrawlPendingCaveat: string | null` outputs, same posture as
  `weatherCaveat`/`weakComparisonCaveat`/`seasonalInflectionCaveat`. When `recrawlPending` is true,
  `deriveMeasurementMaturity` caps the result at `"collecting"` (existing "Waiting" badge) regardless of
  which 7/14/28-day window has calendar-closed, `verdict` stays null, and `learningEligibility` is
  additively false. The `collecting` case's headline/explanation are overridden to the honest line
  "Google has not re-read this page yet, so the clock has not started." (+ a days-blind clause when
  known). `shipped_change_proof` history is never mutated - this is a read-time reinterpretation only,
  same as every sibling guard in this file.
- Correctness guard: a page that has NEVER been inspected (`hasInspectionHistory=false`) is deliberately
  NOT treated as "blind" - only a page with at least one inspection reading, none of which confirm the
  new content, gets capped. Without this distinction, wiring the guard in today (when
  `gsc_url_inspections` is empty for every real tenant) would have frozen the entire ledger to "Waiting."
  The same absence-vs-blind bug was caught and fixed twice: once in the `proof/page.tsx` read-path wiring
  (`recrawlClockById.get(l.id)?.hasInspectionHistory === true && ...`) and once in the nightly-assist
  prioritization (a genuine `attachRecrawlClockForLedger` failure now returns 0 spent instead of
  defaulting every row to "pending").
- `src/app/(shell)/proof/page.tsx`: wired `attachRecrawlClockForLedger` alongside the existing
  `attachSeasonalInflectionForLedger` call, threaded into `buildMeasurementPresentation`.
- `src/domains/proof-gsc/auto-measure.ts`: the existing nightly `measure-due` cron's bounded per-tenant
  pass (`measureDueForTenant`) now also spends up to `MAX_RECRAWL_INSPECTIONS_PER_PASS` (8) `gscUrlInspect`
  calls on the due rows most needing a recrawl check (oldest-shipped-first), reusing `gscUrlInspect`'s own
  24h Supabase cache. Gated on `BEACON_GSC_SITE_URL` being set (the same operator-substrate posture
  `load-gsc-signal.ts` already documents) - no new cron, no new site-URL resolution logic. New
  `AutoMeasureResult.recrawlInspections` field (additive).
- `src/app/api/cron/measure-due/route.ts`: updated the one literal `AutoMeasureResult` fallback object to
  include the new field.

**Tests:** 33 new/updated targeted tests -
`recrawl-clock.test.ts` (16), `attach-recrawl-clock.test.ts` (9), `auto-measure-recrawl.test.ts` (5),
plus 6 new cases in `measurement-maturity.test.ts` and 1 literal-completeness fix in
`proof-plain-vocabulary.test.ts`. Full targeted run: 98/98 passing. `npm run typecheck`: 0 errors
project-wide (2 pre-existing errors in unrelated concurrent-agent scratch files
`scripts/n8-*-tmp.ts` are untouched by this slice).

**Ground truth (real Supabase read, tenant-iranopedia, 2026-07-02):**

| Ship date | Path | Action | Verdict | Recrawl status |
|---|---|---|---|---|
| 2026-07-01 | /chaharshanbe-suri | add_answer_block | measuring | BLIND (never inspected, 2 days) |
| 2026-07-01 | /iran-flags/late-safavid-military-flag | edit_meta | measuring | BLIND (never inspected, 2 days) |
| 2026-07-01 | /iran-flags/abbasid-caliphate-golden-emblem-flag | edit_meta | measuring | BLIND (never inspected, 2 days) |
| 2026-07-01 | /finglish | add_answer_block | measuring | BLIND (never inspected, 2 days) |
| 2026-07-01 | /iran-flags/pahlavi-iran-flag | edit_meta | measuring | BLIND (never inspected, 2 days) |
| 2026-07-01 | /iran-flags/umayyad-caliphate-flag | edit_meta | measuring | BLIND (never inspected, 2 days) |
| 2026-06-30 | /iran-animals/caspian-horse | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/red-fox | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/persian-wolf | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/caspian-red-deer | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/persian-cobra | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/persian-horned-viper | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/booted-eagle | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/persian-onager | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/baluchistan-black-bear | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-30 | /iran-animals/persian-leopard | edit_title | measuring | BLIND (never inspected, 3 days) |
| 2026-06-22 | /persian-male-names | schema | inconclusive | BLIND (never inspected, 11 days) |
| 2026-06-22 | /best-persian-restaurants | schema | lost | BLIND (never inspected, 11 days) |
| 2026-06-21 | /famous-iranian-singers | section_add | won | BLIND (never inspected, 11 days) |
| 2026-06-21 | /farsi-numbers | intro_answer_block | inconclusive | BLIND (never inspected, 11 days) |
| 2026-06-21 | /iran-animals/asiatic-cheetah | intro_answer_block | inconclusive | BLIND (never inspected, 11 days) |
| 2026-06-21 | /famous-iranian-comedians | meta | inconclusive | BLIND (never inspected, 11 days) |
| 2026-06-21 | /iranian-actors-actresses | title | inconclusive | BLIND (never inspected, 11 days) |
| 2026-06-20 | /cities | meta | lost | BLIND (never inspected, 13 days) |
| 2026-06-20 | /funny-farsi-phrases | meta | lost | BLIND (never inspected, 13 days) |

25/25 ships: 0 confirmed, 25 never-inspected (`gsc_url_inspections` has 0 rows for this tenant - the
sweep is new, nothing has run yet). Because `hasInspectionHistory=false` for all 25, none of them are
capped as "recrawlPending" today - the guard is correctly silent until the nightly sweep actually
inspects a page. Confirmed via `curl -m 180 http://localhost:3142/proof` (real dev server, HTTP 200 in
134.5s) that the page renders byte-identical to before this change (same "Waiting" / "matures
2026-07-04" copy on the real `/cities` row). A synthetic check of `buildMeasurementPresentation` with a
simulated confirmed-inspection-but-unconfirmed input (the `/cities` row's real ship date + verdict)
reproduces the exact copy that will render once the sweep populates a row: headline `"Waiting"`,
explanation `"Google has not re-read this page yet, so the clock has not started. It has been 13 days
since you shipped this."`, tone `"waiting"`, `verdict: null`, `learningEligibility: false`.

**Caveats:**

- The `serp_title` fallback basis is built and unit-tested but has no real data source wired in yet -
  `serp-history.ts`'s stored snapshots carry rank only, no displayed title. Every real confirmation today
  will come from `basis: "inspection"` once the nightly sweep runs.
- The nightly-assist inspection budget only fires when `BEACON_GSC_SITE_URL` is set (operator-substrate,
  single global property) - a genuine multi-tenant per-tenant property resolver lives in
  `sync-search-analytics.ts`'s private `resolveProperty` and was intentionally NOT touched or duplicated
  here (out of this slice's ownership: connectors core).
- This worktree has concurrent agent activity on N8/N13 touching the same shared files
  (`measurement-maturity.ts`, `proof/page.tsx`, `auto-record-on-ship.ts`); all edits were reconciled by
  hand mid-session (re-reading before each write) so both slices' fields/wiring coexist. Not yet
  committed or merged.

---

## 2026-07-02 - Worklist operator-experience fix batch B (10 findings, worktree, NOT committed)

**Fixed (all on `/worklist`, the "Changes" list):**

- **B1 (decoration masquerading as evidence):** `expectedEvidenceStrength(family)` in `src/domains/changes/canonical-change.ts` was used as the DEFAULT evidence strength for every bare suggestion, so all 71 text-lever moves showed "Strong comparison" with zero real comparison data behind them. Added `defaultEvidenceStrength(family)` (directional/tracking only, never strong) for the pre-comparison-data case in `src/domains/changes/build-canonical-changes.ts`'s `fromMove`; `expectedEvidenceStrength` is now only a ceiling reached once real controls (plan-item reservations) or a real proof record exist. Live result: 0 "Strong comparison" (was 71), 71 "Directional signal."
- **B2 (16-word status thesaurus):** `STATUS_CHIP` in `src/app/(shell)/changes-list-client.tsx` collapsed to 4 display words (To do / In progress / Measuring / Done); precise sub-state (apply/verify) moved to small secondary text. `preparedPill` in `src/app/(shell)/today-moves-card.tsx` collapsed Generic draft/Topic mismatch/Too thin/Needs work into one "Needs review" pill (the precise reason still shows in the expanded detail text).
- **B3 (money ambiguity):** "44.4k /mo at stake" now renders "44.4k searches/mo at stake."
- **B4 (naked number):** `friction ${Math.round(...)}` in `src/domains/action-pack/adapters.ts` now renders as the plain label "visitors get stuck here" above the existing 15-point meaningful-friction floor, and is dropped below it.
- **B5:** the lowercase "review" quality chip renamed to "Flagged."
- **B6:** removed the redundant near-duplicate subtitle paragraph in `src/app/(shell)/worklist/page.tsx`; kept the `PageHeader` description as the single intro line.
- **B7:** `loadChangesView` in `src/app/(shell)/changes-data.ts` now reads `readPublishHealth` (fail-soft) when Ready is 0 and renders "0 ready to publish until your Wix pages are mapped" (linking to `/settings/connectors`) or "0 ready right now" otherwise.
- **B8:** "Prepare my top 10" button label gained "(takes a minute)"; no invented dollar figure.
- **B9 (raw slug links):** added `displayPageLabel()` in `changes-list-client.tsx` that prefers the move's real query/topic over a slug-shaped `pageLabel`, falling back to a humanized slug; the raw path now shows only as small secondary text. Also fixed the root cause in `src/app/(shell)/moves/moves-data.ts` (`humanPageLabel`) for the coverage-only ActionPack path that fed raw paths into `pageLabel` in the first place.
- **B10:** "1 marketplace" / "2 AI-cited overlap" chips in `src/app/(shell)/today-newpages-card.tsx` renamed to "1 shopping site ranks here" / "cited by AI alongside 2 rivals."

**Tests:** `src/domains/changes/build-canonical-changes.test.ts` gained 2 new cases (a bare suggestion is directional; a plan item with real reserved controls stays strong) and the pre-existing "clean tests" fixture was corrected to use a genuinely-mature-proof move instead of a bare suggestion (23 tests total, was 21). Targeted run across the 9 affected test files: **107/107 passing.** `npm run typecheck`: clean project-wide.

**Ground truth (live dev server, `curl -sL -m 120 http://localhost:3000/worklist`, real tenant-iranopedia data):** confirmed via the rendered HTML for every item above (exact before/after quotes captured in the session transcript), including the `.data/tenants/iranopedia/worklist-surface.json` stale-cache case for B9 (the client-side `displayPageLabel` fallback fixes the display even when the server cache still holds pre-fix raw-slug labels, so the fix does not depend on cache invalidation timing).

---

## 2026-07-02 - MASTER PLAN v2 item N9 (pause recommendations when data sources contradict, law 1, worktree, NOT committed)

**Built:**

- `src/domains/evidence/source-contradiction.ts` (new, pure, no I/O, no LLM): `detectSourceContradictions(input)` runs three deterministic rules against a page's per-source evidence and returns whatever fired ([] = no contradiction):
  - `detectTrafficMismatch` (rule a) - GSC clicks >=30 with GA4 sessions within a 5% near-zero tolerance band of those clicks (or the reverse: GA4 sessions >=30 with GSC clicks near-zero). Both samples must be present (a missing GA4/GSC read is absence, not contradiction).
  - `detectRankVisibilityMismatch` (rule b) - GSC's own position for a query is top-5 with >=20 impressions (a confident, real-volume ranking claim) while a stored live-SERP snapshot for the SAME normalized query says the tenant's domain is absent from the observed top 10. Requires both a qualifying GSC query sample and a completed SERP snapshot for that exact query.
  - `detectPageGoneButClicked` (rule c) - the latest crawl snapshot recorded an error/gone HTTP status (4xx/5xx, snapshot <=30 days old so a stale crawl never counts as "gone today") while GSC still reports >=5 recent clicks for that URL.
  - Every rule has a documented floor so ordinary noise can never fire it, and every rule requires BOTH sides of the comparison to be genuinely present - absence (a source with no rows) is unknown, never treated as conflicting, per Quality Constitution law 1 ("Believe... Contradicting sources pause the claim" and the explicit unknown-vs-conflicting distinction).
- `src/domains/recommendations/recommendation-quality.ts` (the single choke point every rec passes through before the nightly plan, confirmed by grepping both `recommendation-quality.ts` and `recommendation-qa.ts` and tracing their callers): `reviewRecommendation` gained an optional `sourceEvidence` input and now runs `detectSourceContradictions` FIRST, ahead of every other quality check. A fired contradiction short-circuits to a new `QualityDecision = "paused_source_contradiction"` (added alongside approved/approved_with_caution/needs_revision/rejected/needs_evidence) carrying the honest, numbers-first `operatorReason` ("Search Console and Analytics disagree about this page (1,200 clicks vs 3 visits in the same period). I am not recommending changes to it until I trust the data. Checking again nightly."). `passesDailyGate` already excludes anything that isn't approved/approved_with_caution, so the pause is automatically kept out of the nightly plan and Prepare with zero new exclusion logic. New `isPausedForSourceContradiction(result)` helper for callers that need to group paused recs explicitly. The pause is NEVER persisted - `RecommendationQualityResult.sourceContradictions` and the decision are recomputed from live evidence on every call, so a later read with agreeing sources returns a normal decision with no cleanup step (pinned by a dedicated unpause test).
- `src/domains/experiments/build-today-preview.ts` wired at the real nightly-selection call site using data ALREADY loaded in that pipeline (GSC per-page signals + the cached page-snapshot HTTP status) - zero new I/O added. This covers rule (c) end-to-end; GA4 sessions and live-SERP snapshots are not loaded on this $0 pipeline today, so rules (a)/(b) see honest absence there rather than a fabricated contradiction. `excludedByReason.paused_source_contradiction` reports the count separately from `quality_rejected` so the nightly diagnostics stay honest about WHY a candidate didn't make the plan.
- `src/app/(shell)/daily-experiments-data.ts` - `QualitySummary` gained a `paused` count (re-runs the same gate over the active plan's already-selected items for display; practically always 0 today since a paused candidate would have been excluded upstream before it could enter the plan, but wired so the UI has an honest bucket if a future caller threads richer evidence through here).
- `src/app/(shell)/daily-experiments-section.tsx` - `QualityLine` gained a self-hiding amber line ("⏸ N paused until the data agrees - checking again nightly") that renders only when `summary.paused > 0`; absent on every ordinary night.

**Tests:** `src/domains/evidence/source-contradiction.test.ts` (28 new - every rule's firing case, every documented floor's non-firing boundary, both directions of rule (a), query-normalization and cross-query non-firing for rule (b), redirect-vs-gone and staleness non-firing for rule (c), explicit absence-is-not-contradiction coverage for every rule at every argument position, and aggregate multi-rule firing). `src/domains/recommendations/recommendation-quality.test.ts` gained a new N9 describe block (9 new - pause supersedes an otherwise-clean approval, the exact honest sentence with real numbers, all three rules pausing independently, three different flavors of "never fires on missing data," agreeing sources never false-pausing, and a dedicated computed-not-persisted unpause test). All pre-existing tests in both touched domains plus `build-today-preview.test.ts` and `daily-experiments-section.test.ts` stay green (1254 tests total in the targeted run, all passing, 2 pre-existing skips unrelated to this change). `npm run typecheck`: clean project-wide.

**Ground truth (tenant-iranopedia, read-only probe against the live configured Supabase project, `set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_ground-truth-source-contradiction.ts`):** GSC has signal for 197 pages, GA4 for 396 pages, 217 page snapshots exist, 180 pages have BOTH GSC and GA4 present (rule a could evaluate agree/disagree on all 180). **Real result: 4 real `traffic_mismatch` contradictions found** - `/basic-persian-phrases` (30 GA4 visits vs 0 GSC clicks), `/category/best-sellers` (346 vs 0), `/cuisine` (31 vs 0), `/famous-iranian-poets` (34 vs 1) - genuine GSC-shows-nothing-but-GA4-shows-real-visitors gaps, most likely a GSC indexing/property-mapping issue on those specific paths rather than a detector bug (spot-checked the raw GSC/GA4 rows directly; the gap is real in the underlying data). **0 `page_gone_but_clicked`** - 0 page snapshots currently record any error/gone HTTP status, so there was honestly nothing to find (not a bug: the rule needs a real 4xx/5xx snapshot to exist first). **Rule (b) was not exercised in this probe** - it needs `dataforseo_serp_history`, which lives under `src/domains/serp/**`, out of N9's ownership scope to touch; the rule is fully covered by its own unit tests in isolation. **Caveat found and NOT fixed here (flagged as a separate follow-up task):** `loadGa4PageValuesForTenant`/`loadGscPageSignalsForTenant` can key the same logical page under both a relative path and its full canonical URL with DIFFERENT aggregated numbers under each key (e.g. GA4 sessions28d = 30 under `/basic-persian-phrases` vs 24 under `https://iranopedia.com/basic-persian-phrases` in the same run) - a pre-existing data-loading quirk in those two loaders, not introduced by N9, but worth a dedicated fix since a naive single-key lookup could silently pick the smaller of two real numbers.

---

## 2026-07-02 - MASTER PLAN v2 item N6 (intent classification vetoes the wrong lever, worktree, NOT committed)

**Built:**

- `src/domains/demand-graph/intent-veto.ts` (new, pure, no I/O, no LLM): `checkIntentVeto({ packet, action, tenantHasNoTransactionalSurface? })` classifies the dominant query intent behind a Move (reusing the existing `classifyQueryIntent` from `src/domains/experiments/answer-intent.ts`, untouched) and checks whether the proposed lever can serve it. Since `EvidencePacket.demand.queries` is always `[]` in production today (confirmed: no per-query GSC impressions survive past `build-graph.ts`), it follows the exact synthesis convention `prepare-today-moves.ts` already ships: the Move's own label counts at weight 2, each AI fanout sub-question at weight 1. Three documented rules, first-match-wins: (1) `add_answer_block` on a dominant "when"/"cost" intent (the chaharshanbe bug, structurally closed) - veto at >=55% dominant share, downgrade at 40-55%, silent below; scoped to `add_answer_block` only, NOT `change_title_meta` (a title can still promise a date without changing shape, so it does not carry the same failure mode); (2) `change_title_meta` on a navigational-reading query (reuses the existing coarser `src/domains/demand-graph/query-intent.ts` classifier for the navigational/transactional bucket answer-intent.ts does not have) - veto; (3) `create_page` on a transactional-reading query when the tenant has no transactional surface (threaded in by the caller from `BusinessConfig.contentSiteMode`, never fetched by this module) - downgrade only, and abstains (never guesses) when the flag is unset. Every objection is a standard `Objection` with `kind: "wrong_lever_for_intent"`, cites the real queries that drove the call in `evidenceRefs`, and reads in the "That question wants a date, not a definition..." plain-English style the task specified.
- `src/domains/demand-graph/move-router.ts` wired: `routeMove` now calls `checkIntentVeto` against the action as decided so far (seed or vote-elected) and folds its Objection into the SAME existing veto/downgrade arrays that already feed `appliedObjections` - no new machinery. A `wrong_lever_for_intent` veto routes the action to `"wait"` (there is no single correct replacement lever the way `already_ranks` -> edit or `fix_ux_first` -> fix_ux have one) and its `rationale` becomes the plain-English detail line directly, which surfaces live through `src/domains/experiments/team-review.ts`'s existing `decision.appliedObjections.some(o => o.severity === "veto")` check (confirmed by reading that file - it already promotes the router's own rationale to the card verdict on any veto, so no app-layer wiring was needed this slice). New optional `RouteInput.intentVeto?: { enabled?: boolean; tenantHasNoTransactionalSurface?: boolean }` - omitted, the check still runs (it is a pure $0 check) but abstains on anything it cannot know; `enabled: false` fully disables it for a byte-identical pre-N6 call site.
- Minimal required additions to keep two exhaustiveness-checked maps compiling: `ObjectionKind` gained `"wrong_lever_for_intent"` in `specialist-opinions.ts`, and `OBJECTION_LABELS` gained the matching plain-English row ("This move would answer the wrong question") in `debate-summary.ts`. No other change to either file.
- `scripts/ground-truth-intent-veto.ts` (new, read-only probe, no writes/paid calls): loads every real packet via `loadChangePacksForTenant`, routes each with and without the veto, and reports veto/downgrade/silent counts plus the clearest fired examples.

**Tests:** `src/domains/demand-graph/intent-veto.test.ts` (24 new - abstention paths incl. empty label/wrong lever shape/unknown transactional-surface flag, rule 1 veto + downgrade banding + the "never fires on what/how/where/who/list/compare" sweep + the explicit non-firing on `change_title_meta`, rule 2 navigational veto + the normal-query non-firing control, rule 3 downgrade + the no-transactional-surface-flag non-firing control on a non-create action, and a dash-cleanliness sweep over every rule's generated copy). `src/domains/demand-graph/move-router.test.ts` gained an N6 describe block (8 new - the byte-identical-when-abstaining pin over every pre-existing fixture in the file, the `intentVeto: { enabled: false }` opt-out, the chaharshanbe-class veto end-to-end through `routeMove`, evidence-naming on the applied objection, a regression check that a specialist-sourced veto still fires unaffected, the downgrade-band case, and the `tenantHasNoTransactionalSurface` threading test). **32/32 new tests passing.** Full `src/domains/demand-graph` directory (13 files, 180 tests) plus `specialist-opinions.test.ts`, `debate-summary.test.ts`, `team-review.test.ts`, `answer-intent.test.ts`, `build-today-preview.test.ts` all green. `npm run typecheck`: 0 errors from this change (two pre-existing errors seen mid-session in `src/domains/recommendations/recommendation-quality.ts` were unrelated concurrent-worktree work already present before this slice started, and typecheck is fully clean as of the final run).

**Ground truth (tenant-iranopedia, read-only probe against the live configured Supabase project, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-intent-veto.ts`):** across the current **182 real actionable Moves**, the veto fires on **2** (both vetoes, 0 downgrades, 180 silent): `"iran world cup jersey 2026"` and `"iran 1998 world cup jersey"`, both `answer_block` gaps routed to `add_answer_block` -> blocked to `"wait"` with rationale `"That question wants a date, not a definition, so I blocked the answer block and suggest a date-first fix instead. Evidence: '...' is a date lookup (100% of the query signal), and a definitional answer would not satisfy it."`. **Honest caveat:** both real hits are driven by `answer-intent.ts`'s bare-4-digit-year fallback in its `WHEN_RE` regex (untouched, out of this slice's ownership) rather than an explicit "when/date" cue - a product query naming a year (e.g. "2026 World Cup jersey", the edition/year as a qualifier) is arguably not the same failure class as the canonical chaharshanbe-suri bug (a genuine "when does this happen" question). The two title-rewrite candidates that WOULD have fired before the rule-1 scoping-to-`add_answer_block`-only decision (`"chaharshanbe suri 2026"` and `"sizdah bedar 2026"`, both `edit_page` gaps routed to `change_title_meta`) are the closest real "nearest misses" to the canonical bug class, and now correctly do NOT fire since a title can promise a date without changing shape. No navigational or transactional-surface hits appeared in the live set (Iranopedia's queries carry no login/contact/booking-style cues today) - both rules 2 and 3 are exercised only by the unit tests against real, honest example queries, and will fire automatically on real data if/when such queries enter the graph.

---

## 2026-07-03 - MASTER PLAN v2 item N7 (SERP-overlap intent clustering, precursor to N2 ownership registry, worktree, NOT committed)

**Built:**

- `src/domains/serp/intent-clusters.ts` (pure, no I/O): `computeIntentClusters` takes a tenant's tracked queries plus already-captured `QuerySerpSnapshot[]` (the `top_domains` ranked organic array `dataforseo_serp_history` already stores), reduces to one snapshot per query (latest wins), computes pairwise top-10 URL overlap via `sharedResultCount`/`overlaps` (>=4 of 10 shared is the default threshold, `DEFAULT_OVERLAP_THRESHOLD`), and unions transitively-overlapping queries into clusters with a small local union-find (A-B-C merge into one cluster even when A and C alone do not clear the threshold). Each cluster reports `sharedUrls` (URLs appearing in 2+ member queries), `ownPagesInCluster` (own URLs found via the same root-domain matching `resolveOwnRank` uses elsewhere in the SERP domain, best-rank-first), and `conflict: true` when 2+ distinct own URLs compete inside one cluster. `IntentClusterCoverage` reports totalQueries / queriesWithSerpData / queriesMissingSerpData / coverageRatio so a caller never mistakes "no SERP history yet" for "no cannibalization exists."
- `src/domains/serp/intent-clusters-loader.ts` (the I/O boundary, kept separate so the pure module stays dependency-free): `trackedQueriesFromGscSignals` (pure) derives the query universe from an already-loaded GSC page-signal map's `topQueries` (capped at 300); `loadSerpSnapshotsForQueries` reads ONLY already-stored `dataforseo_serp_history` rows for those queries ($0, no new paid SERP pulls, fail-soft to `[]` on any error); `loadIntentClustersForTenant` composes both plus `computeIntentClusters` into one end-to-end tenant loader.
- `src/domains/recommendation-intelligence/triggers/intent-cluster-conflict.ts`: new trigger, additive, mirrors `sov-drop-alert.ts`'s exact thin-pure-wrapper pattern. Filters to `conflict: true` clusters with 2+ own pages, ranks biggest-cluster-first, caps at 3/run, emits `merge_pages` (the SAME action `thin_content_overlap` already uses; no promotion-ladder eligibility entry, so it can never auto-push regardless of confidence) anchored on the cluster's best-ranking own page, naming the other own URLs to fold in. `confidence: "medium"` (one tier above `thin_content_overlap`'s `"low"`) since this fires off literal Google top-10 overlap, not a token-similarity proxy.
- `intentClusterConflictCopy` added to `customer-copy-templates.ts` ("Google shows the same results for N of your questions and sends N of your pages to fight for them. Combining them into one page usually earns a better spot than splitting the same audience two ways."); registered a probe set in the `recommendation-intelligence-customer-copy-vocab` architecture invariant test.
- `load-trigger-candidates-for-tenant.ts` wired additively: one pre-load block calling `loadIntentClustersForTenant` (reuses the already-loaded `gscSignals` map and `businessConfig.domain`, no second GSC read), and one emission line `intentClusterConflict({ tenantId, clusters: intentClusters, signalAt })` placed alongside the page-anchored `displacementCheckAlert` call (no site-root dependency needed).

**Tests:** `src/domains/serp/intent-clusters.test.ts` (18 - shared-count math, threshold boundary at exactly 4-of-10, custom thresholds, empty-set handling, latest-snapshot-per-query dedup, cluster formation, non-overlap rejection, transitive A-B-C union-find merge, own-page identification incl. subdomain-counts/suffix-lookalike-rejection, conflict flagging on 2+ vs 1 own page, never-fabricate-when-ownDomain-null, honest coverage reporting incl. the zero-tracked-queries edge, and conflict-first sorting), `src/domains/serp/intent-clusters-loader.test.ts` (4 - the one pure reduction `trackedQueriesFromGscSignals`: empty map, cross-page dedup + normalization, empty-query filtering, cap), `src/domains/recommendation-intelligence/triggers/intent-cluster-conflict.test.ts` (10 - candidate shape, best-rank anchor selection, evidence/operator-trace content, customer-copy dash-free + vocab-clean assertion, impact-estimate branching, biggest-cluster-first ranking + maxCandidates cap, and the abstain/skip paths). **32/32 new tests passing.** Updated `tests/architecture/recommendation-intelligence-customer-copy-vocab.test.ts` with the new probe set. Targeted regression sweep (the 3 new test files + the customer-copy-vocab and trigger-predicates-purity architecture invariants + `load-trigger-candidates-for-tenant.test.ts` + `customer-copy-templates.test.ts`) - **149/149 passing.** `npm run typecheck`: 0 errors project-wide.

**Ground truth (tenant-iranopedia, read-only probes against the live configured `beacon-main` Supabase project, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs <probe>`):** `dataforseo_serp_history` holds **83 real rows across 83 distinct queries** for this tenant. The GSC `topQueries` universe (300 tracked queries after the cap) only overlaps **7 of those 83** - most of Iranopedia's actual top-impression GSC queries (brand-name variants, restaurant-city queries, greeting/food questions) have never had a live DataForSEO SERP pull, so `coverage.queriesWithSerpData = 7`, `coverageRatio ≈ 0.023`, honestly reported. **Real result today: 0 clusters, 0 conflicts.** A direct pairwise sanity dump of the 7 usable queries showed the closest real pair, `"largest cities in iran"` vs `"cities of iran"`, sharing exactly 3 of 10 results - correctly NOT clustered, one below the 4-of-10 line; every other pair among the 7 shared 0 results. This confirms the overlap math runs correctly against real captured rows; the zero-cluster outcome reflects thin SERP-history coverage today, not a bug.

**Honest caveats:** clusters and conflicts cannot be demonstrated on real production data today because so few of the tenant's tracked queries have an existing SERP capture - the clustering and conflict-detection logic are exercised only against constructed fixtures in the 32 tests above for the "2+ overlapping queries" and "conflict" cases. No further code change is needed for real clusters to appear: they will surface automatically as more tracked queries accumulate SERP history through the DataForSEO gauntlet other features already spend on (displacement-check, feature-steal, AI-overview reads all append rows to the same `dataforseo_serp_history` table).

---

## 2026-07-02 - BEACON 500 item 79 (cross-engine share of the answers per topic, with drop alerts that open moves, worktree, NOT committed)

**Built:**

- `src/domains/ai-visibility/sov-weekly.ts` (pure math + one async loader, compute at read time, no new store, `store-classification.ts` untouched): merges 3 sources that never met before, each labeled and never averaged into one number. `native_poll` reduces `prompt_answer_observations` (via the existing `run-engine-poll.ts` writer) into per (engine, topic, ISO week) cells: owned share = distinct prompts mentioned / distinct prompts polled. `profound_visibility` reduces `profound_visibility_rows` into per (topic, week) cells carrying Profound's OWN share-of-voice definition plus the top competitor, on separate fields so the two numbers cannot be blended. `llm_mentions_cache` wraps the existing `readAllCachedLlmMentions()` into a single always-current top-cited-domain reading per topic (no week bucketing, since the cache only holds the latest fetch). `isoWeekKey`/`isoWeekStartDate`/`compareIsoWeeks` implement real ISO 8601 week numbering (verified against the 2020-W53 edge case). `computeSovTrend` gives week-over-week and 4-week point deltas, gated so a comparison is only computed when BOTH weeks clear `MIN_PROMPTS_PER_CELL` (3). `detectSovDropAlerts` fires on a `SOV_DROP_THRESHOLD_POINTS` (15pt) fall or a drop to exactly zero from nonzero, both weeks must clear the floor, and names the exact prompts that flipped (mentioned prior week, not mentioned current week, polled in both - a prompt dropped from rotation is never mistaken for a flip). Topics come from a small local `promptToTopic` (duplicated from, not imported from, the AI Questions app-route file, so the domain has no app-layer dependency; both call the same `cleanTopicLabel` domain helper). All Supabase reads paged at 1000 rows (`queryAllPagedScoped` for observations; a matching local paginator for `profound_visibility_rows`); each of the 3 source reads is independently try/caught (`partial: true` on any failure, the others still return real data).
- `src/domains/recommendation-intelligence/triggers/sov-drop-alert.ts`: new trigger, additive, follows `profound-aeo-gap.ts`'s exact pattern (topic-level unit, site-root-anchored `add_answer_block` directive, `@no-classifier-required` opt-out, worst-drop-first ranking, capped at 3 candidates/run via `maxCandidates`). Thin wrapper over `sov-weekly.ts`'s own `SovDropAlert[]` - does no drop math itself, so the math stays pinned in one place. `impact_estimate` is `high` when 3+ prompts flipped or the drop hit zero, else `medium`.
- `sovDropAlertCopy` added to `customer-copy-templates.ts` (additive function, no em/en dashes, unlike several pre-existing templates in that file that use an em dash); registered a probe set in the `recommendation-intelligence-customer-copy-vocab` architecture invariant test.
- `load-trigger-candidates-for-tenant.ts` wired additively: pre-loads `loadSovWeeklyForTenant` alongside the existing `profoundTopicSignals` pre-load (same `buildOwnAliasSet` call, reused), calls `sovDropAlert(...)` right after `profoundAeoGap(...)` inside the same tenant-level block, `PREDICATE_COUNT` 14 to 15.
- `src/app/(shell)/prompts/sov-weekly-section.tsx`: new self-hiding section, owns its own tenant/business-config/loader resolution so the page mounts it with one line. Renders nothing when `trends.length === 0` (no native-poll history yet). Shows a per-engine table for the top topics with text trend arrows ("up 12 pts" / "down 15 pts" / "flat" / "still collecting" below the floor), any active drop alerts, and a separately-labeled Profound footnote. Mounted with `<SovWeeklySection />` in BOTH render branches of `src/app/(shell)/prompts/page.tsx` (the confirmed real AI-visibility surface - not `/competitors`, not Today): once inside the live `AiQuestionsView` branch, once inside the legacy `PromptsPage` branch (the latter is pre-existing-unreachable for a tenant with Profound receipts, per the page's own existing branching comment, unrelated to this change).

**Tests:** `src/domains/ai-visibility/sov-weekly.test.ts` (48 - ISO week bucketing incl. the real 2020-W53 boundary and the 2025-12-29-rolls-into-2026-W01 edge case, round-trip + chronological-sort helpers, engine canonicalization incl. the legacy `openai` alias, observation projection incl. fallback-topic resolution and drop-on-unusable-data, native share math incl. same-prompt-multiple-observations-in-one-week and the floor flag, Profound reduce incl. top-competitor-by-mentions-not-share, llm-mentions single-reading reduce, merge honesty incl. an explicit "the two share fields never coexist on the same object" assertion, trend math incl. below-floor nulling, and drop detection incl. threshold-boundary-exactly-15, fall-to-zero-regardless-of-size, never-off-one-prompt, and only-name-a-prompt-polled-in-both-weeks) and `tests/domains/recommendation-intelligence/triggers/sov-drop-alert.test.ts` (10 - candidate shape, dedupe/topic-cluster-label keying per (engine, topic, week), evidence + operator-trace content, customer-copy dash-free assertion, impact-estimate branching, worst-first ranking + maxCandidates cap, and both abstain paths). **58/58 passing.** Updated 3 existing test files whose hardcoded predicate-count assertions needed to move from 14 to 15 (`tests/domains/recommendation-intelligence/load-trigger-candidates-for-tenant.test.ts` incl. a `.forTenant()` call-count assertion from 2 to 3, `tests/app/diagnostics/recommendation-triggers-page.test.tsx` x2) - all still pass. `npm run typecheck`: 0 errors project-wide, both before and after. Targeted regression sweep: `src/domains/ai-visibility/`, `src/domains/recommendation-intelligence/`, `tests/domains/recommendation-intelligence/`, `tests/architecture/`, the 3 diagnostics trigger test files, and `src/app/(shell)/prompts/` together - 309 test files, 6701 tests, all green (41 pre-existing skips, unrelated).

**Ground truth (tenant-iranopedia, read-only probes against the live configured `beacon-main` Supabase project, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs <probe>`):** `prompt_answer_observations` and `profound_visibility_rows` are BOTH still **0 rows for tenant-iranopedia today** (and 0 rows globally, for every tenant, on this project) - confirmed via a direct exact-count query on both tables plus a full `loadSovWeeklyForTenant` run, which returned `{ partial: false, nativeCells: 0, profoundCells: 0, trends: 0, dropAlerts: 0 }` - `partial: false` means all 3 source reads genuinely succeeded and simply found nothing, not that a read failed. The `dataforseo-llm-mentions` cache DOES carry one real record: topic "persian carpets", citing `bofandeh.com` (1), `en.torreh.net` (1), `en.wikirug.org` (1), fetched 2026-07-01T23:34:55Z - the loader surfaced it correctly as `llmMentionsReadings: 1`. Confirmed the `/prompts` page live on the running dev server (`curl http://localhost:3142/prompts`, 200 OK): the page rendered the real `AiQuestionsView` branch (confirmed via the "AI questions" nav label + heading in the response body) with no error-boundary markers, and the SoV section's own heading text was absent from the response (0 matches for "How much of the answers you get") - the self-hiding guard fired correctly, exactly as the empty-history ground truth predicts.

**Honest caveats:** with 0 native-poll history for this tenant, the per-engine table, trend arrows, and drop alerts cannot be demonstrated on real production data today - they are exercised only against constructed fixtures in the 58 tests above. The section and trigger will start producing real numbers the moment the nightly 4-engine poll (`run-engine-poll.ts`, already live per master plan item 4) accumulates a few weeks of `prompt_answer_observations` for this tenant; no further code change is needed for that to happen. The legacy-branch mount line in `page.tsx` is compiled, typechecked, and covered by the loader-level tests, but is not reachable live today for a tenant with Profound receipts (pre-existing branch logic, confirmed unrelated to this change via the page's own existing comment).

**Next action:** none required from the operator for this item specifically; run the nightly AI-engines poll for a couple of weeks and the SoV table (and any real drop alerts) will appear on `/prompts` automatically, with no new UI to build or flag to flip.

## 2026-07-02 - BEACON 500 item 77 (answer-drift detection on the live poll stream, worktree, NOT committed)

**Built:**

- `src/domains/ai-visibility/answer-drift.ts` (pure, no I/O, no LLM): `detectBrandDrift` (brand_added/brand_dropped when the tenant's brand appears/disappears between two answer snapshots, descriptor_changed when the brand is mentioned in both but the descriptor window around it changed - reuses `extractMentionPosition`/`extractDescriptorWindow` from `prompt-answer-observations/extraction.ts` rather than reimplementing brand-position math), `diffSentences` (sentence-level added/removed/changed diff via symmetric shingle containment, reusing `splitSentences`/`shingles`/`shingleContainment` from `answer-alignment.ts` - imported read-only, that file is untouched), and `detectAnswerDrift` (the stamped `DriftEvent` builder callers use). Every generated sentence field is safe to run through `stripBannedDashes` at the call site.
- `src/domains/ai-visibility/answer-drift-loader.ts` (server-only I/O): `scanAnswerDrift` reads `prompt_answer_observations` for a tenant, PAGED past the 1000-row default cap (mirrors the exact pattern in `answer-alignment-store.ts`/`second-order-citations.ts`), groups by `(prompt_id, platform)`, and for each pair with 2+ dated snapshots picks the latest plus whichever prior snapshot lands closest to 7 days back (tolerance band 4-10 days - never compares two same-night polls or a stale multi-month-old pair as "this week"). Brand variants come from `getTenant(tenantId).business_name` + `rootDomain(tenant.domain)`, the same convention `run-engine-poll.ts` already uses (no new business-config surface). Concept-links a drop/change to an open worklist move by reusing `scoreTopicMatch` against `readWorklistSurface()` rows (the same relevance-gate rule `spike-move-match.ts` uses) - link-only, never mutates or reorders the worklist. NO new store: drift is computed fresh on every call from the existing table, nothing added to `store-classification.ts`. Does not import or touch `run-engine-poll.ts`.
- `src/app/(shell)/team-standup.tsx` (the one standup component, extended not rebuilt): a new compact "AI answer changes this week" block renders under the existing footer lines only when `loadRecentDriftEvents` returns events from the last 7 days. Copy mirrors the exact operator phrasing from the item spec ("Perplexity stopped mentioning you on the question ... this week. Here is the sentence that replaced you." / "Gemini started recommending you for ... this week.") plus one added sentence for descriptor changes and an optional "I already have an open move for <page>" concept-link line. `page.tsx`'s mount of `<TeamStandup>` was not touched.

**Tests:** `src/domains/ai-visibility/answer-drift.test.ts` (20 - brand_added/brand_dropped/descriptor_changed/no-change/no-brand-mentioned/empty-variants/short-variant-ignored for `detectBrandDrift`; added/removed/changed/unchanged-is-silent/empty/short-fragments-dropped for `diffSentences`; stamping + the nothing-to-compare cases (empty text, identical text, one-sided-empty) + a banned-dash guard for `detectAnswerDrift`) and `src/domains/ai-visibility/answer-drift-loader.test.ts` (5 - fail-soft empty-tenant/unknown-tenant/concurrent-call/limit-respecting behavior, run in a clean shell with no Supabase env so the "poll history too shallow to compare yet" path is exercised for real, not mocked). **25/25 passing.** `npm run typecheck` clean in every file this item touches (pre-existing unrelated errors remain in `tests/domains/autopilot/**` and `tests/lib/connectors/indexnow/**` from other concurrent work, confirmed by name, not touched here).

**Ground-truth (tenant-iranopedia, read-only probe against the live configured Supabase project, $0):** `prompt_answer_observations` has **0 rows for tenant-iranopedia today** (confirmed via a direct count query plus a platform-breakdown scan of up to 2000 rows and a 20-row any-tenant recency scan - the table itself has 0 rows for ANY tenant on this project right now). This matches the item-71 ground-truth finding already on record above ("this tenant has 0 native engine-poll rows"). Coverage result: `{ pairsWithHistory: 0, pairsComparable: 0, observationsConsidered: 0 }`, 0 drift events. This worktree's local `.data/tenants/iranopedia/prompt-answer-observations.json` file-store fallback is also empty (fresh worktree, `.data/` is gitignored per project convention).

**Honest caveat:** the nightly native engine poll (`run-engine-poll.ts`, wired to `/api/cron/ai-engines`) has apparently not yet written any rows to `prompt_answer_observations` in this environment, so answer-drift genuinely has nothing to compare yet - this is not a bug in the drift detector, it is the honest state of the upstream data source it depends on. The moment the poll accumulates 2+ weekly-spaced observations for any (prompt, engine) pair, `scanAnswerDrift` will start finding real events on its next call with zero additional wiring. Verified the detection logic itself is correct via the pure-module unit tests above (synthetic but realistic before/after answer pairs for every event kind).

---

## 2026-07-02 - BEACON 500 item 71 (align AI answers to pages sentence by sentence: the passage that beat you, the line AI quoted, worktree, NOT committed)

**Built:**

- `src/domains/ai-visibility/answer-alignment.ts` (pure, no I/O): `splitSentences` (abbreviation-aware sentence splitter), `shingles`/`shingleContainment` (order-sensitive 5-gram containment), `alignAnswerToPage`/`bestAlignedPassage` (best-matching page sentence per answer sentence, sorted, score-floored), `summarizeWinningShapes` (length band, list/table/prose structure, entity/number/definition-first opening pattern - EXPORT ONLY, not wired into structured-drafter.ts/llm-answer-block.ts per scope), `alignmentContentHash` (cache key).
- `src/domains/ai-visibility/answer-alignment-store.ts` (server-only): reads `profound_answer_rows.response_excerpt` (paged, tenant-scoped, `.not("response_excerpt", "is", null)`), a lean scoped `page_snapshots` reader for one owned URL's `body_paragraph_sample`/`card_texts`/`faqs`, and builds real (if coarser) competitor page text from the already-cached `CompetitorPageFacts` (title/metaDescription/outline/faqQuestions - raw competitor body text is never persisted in this codebase). `getCompetitorAnswerAlignment`/`getOwnedAnswerAlignment` run the alignment and persist via `saveMoveDraft`/`getLatestMoveDrafts` (kind `"answer_alignment"`) keyed by content hash so an unchanged re-render skips recompute entirely.
- `src/domains/ai-visibility/answer-alignment-actions.ts` (`"use server"`, async-only exports as Next.js requires): `getCompetitorAnswerAlignmentForClient` resolves `currentTenantId()` server-side before delegating - a client component's card cannot supply its own tenantId.
- One additive line in `src/domains/demand-graph/move-draft-store.ts`'s `MoveDraftKind` union (`"answer_alignment"`, free-text DB column, no migration - matches the exact pattern every prior kind used).
- `src/app/(shell)/today-moves-card.tsx` (the worklist Move card, rendered on `/worklist` via the Changes list): a lazy one-shot `useEffect` fetch (only when a real competitor teardown already exists) renders "The exact words the AI used: ..." under the existing "Steal this" line.
- `src/app/(shell)/proof/page.tsx` (the ledger card, `LedgerCard`): a new async `AiQuotedReceipt` server component renders "AI quoted this line: ..." directly under the existing "AI answers:" lane, gated on `citationOutcome.verdict === "gained"` or a real post-ship `treatedPostCount > 0`.

**Tests:** `src/domains/ai-visibility/answer-alignment.test.ts` (37 - sentence splitting incl. abbreviations/newlines/empty/garbage, shingle order-sensitivity/case-insensitivity/custom-n, containment asymmetry, full alignment incl. score sort/maxResults/no-overlap/empty-input/adversarial-length, `summarizeWinningShapes` for every length band/structure/opening pattern combination, content-hash determinism/whitespace-stability) and `src/domains/ai-visibility/answer-alignment-store.test.ts` (20 - competitor text assembly from facts, topic-to-answer-row matching incl. a regression test for a real ground-truth bug found below, truncation to the 12k-safe cap, JSON round-trip, malformed-content safety). **57/57 passing.** `npm run typecheck` clean in every file this item touches (a handful of unrelated pre-existing errors exist elsewhere in this shared worktree from other concurrent agents - confirmed by name, not touched here).

**Ground-truth (tenant-iranopedia, read-only probes, $0):**

- `profound_answer_rows`: 4,314 rows carry non-empty `response_excerpt` text (990/1000 sampled, avg 498 of the 500-char cap applied at write time in `sync-prompt-intelligence.ts`). `prompt_answer_observations` (native engine-poll) has 0 rows for this tenant today.
- `page_snapshots`: 210/217 rows have real `body_paragraph_sample`/`card_texts` text.
- Owned-side alignment (full cross-product scan, prose-only filter): **200 clean hits.** Best: a perfect score-1.0 match - ChatGPT's answer to "What are famous Rumi quotes about love?" quotes `"Let yourself be silently drawn by the strange pull of what you really love."` verbatim, aligned to the exact same sentence on `iranopedia.com/famous-iranian-philosophers`. Second-best: score 0.778 on the Nowruz page (ChatGPT's "It celebrates the arrival of spring and the beginning of the new year" vs the page's near-identical sentence).
- Competitor-side alignment on real Moves: **0/30 sampled Moves with a competitor URL produced a hit** even after fixing a real topic-matching bug (see below). Root cause confirmed via a 3-gram/4-gram/5-gram diagnostic: the cached competitor facts (headings + FAQ questions + meta description, never raw body paragraphs) are structurally too coarse to share literal word runs with an AI's prose answer, even on a genuinely on-topic page (e.g. parentcalc.com's Persian-boy-names page vs a ChatGPT answer listing the same names in prose - both are about the same topic, neither shares a 3-word run). This is an honest data-coverage gap in `competitor-page-audit.ts` (out of this item's ownership), not a defect in the alignment math.
- Bug found and fixed during ground-truthing: `pickAnswerExcerptForTopic`'s original 0.3 one-sided-containment floor let a single coincidental shared word decide a "topic match" (e.g. "iran flag" matched a "What are the most beautiful cities in Iran?" prompt purely via "iran"). Fixed to require 2+ shared non-generic tokens and raised the floor to 0.5; re-ran the same probe and confirmed the false-positive class is gone (topic-matched moves dropped from 12/30 to the correct 6/30). Added 3 regression tests pinning this exact bug.

**Honest caveats:** the durable Profound answer store only ever holds a 500-char excerpt of what may have been a much longer live answer - this module never claims to see the "full" answer, only whatever excerpt exists. The competitor-side feature will render nothing on most cards today, correctly, because the underlying page text it has access to is genuinely too coarse; it is not silently faking a match. No migration, no new store, no LLM, no em/en dashes in any new copy (`proof-jargon-guard.test.ts` still 31/31 passing after this change).

**Built (all new, under `src/domains/seasonal/`, extends the existing item-21/63 seasonal domain):**

- `family-demand-profile.ts` (pure): per-pageFamily weekly + annual demand profiles. Annual half
  reuses `seasonality.ts`'s exact share (>=0.6) + floor (>=200 impressions) method, grouped by
  `pageFamilyOf(topPage)` instead of by raw query, over `gsc_monthly_archive` rows. Weekly half buckets
  recent `gsc_daily_page_totals` rows by ISO week-of-year, same share/floor discipline, gated on
  `MIN_WEEKS_FOR_WEEKLY_PROFILE` (4) distinct weeks before it will name a window.
- `load-family-daily-rows.ts`: bounded, paged (1000-row PostgREST pages) read of `gsc_daily_page_totals`
  for a whole tenant, mirroring `load-monthly-archive.ts` exactly.
- `family-demand-profile-store.ts` + `run-family-demand-profiles.ts`: GLOBAL json-store
  (`seasonal-family-profiles`, tenant_id rows, Supabase-mirrored), same sibling pattern as
  `seasonal-store.ts`/`peak-calendar-store.ts`. Orchestrator loads both sources, builds profiles, persists.
- `event-calendar.ts` + `event-calendar-store.ts`: the tenant's event calendar (GLOBAL json-store
  `event-calendar`, tenant_id rows, Supabase-mirrored). Entries are `{id, name, dateRule, learnedFromData,
  pageFamilies, confidence?, observedImpressions?}`. `deriveEventsFromProfiles` turns a family's detected
  annual window into an entry named after the family SLUG (never a curated holiday - title-cased
  `pageFamilyOf`, e.g. "Iran Flags"), `mergeDerivedEntries`/`mergeDerivedEventsIntoCalendar` never
  overwrite an id already present, so an operator's rename/edit survives every re-derivation. Full CRUD
  (upsert/delete) for operator-entered entries.
- `seasonal-inflection.ts` + `attach-seasonal-inflection.ts`: computed-only
  `measuredAcrossSeasonalInflection` flag. `computeSeasonalInflection` checks whether a measurement
  window [start, end) overlaps a family's detected annual (calendar months) or weekly (ISO weeks)
  window. Wired into `measurement-maturity.ts`'s `MaturityInput`/`MeasurementPresentation` as new
  optional `seasonalInflection`/`seasonalInflectionCaveat` fields, additive exactly like
  `weakComparison`/`shockWindows` - a caller that never passes it sees byte-identical output, and when
  it fires it additively demotes `learningEligibility` to false and renders a caveat. Wired into the real
  read site (`src/app/(shell)/proof/page.tsx`) via `attachSeasonalInflectionForLedger`, which loads the
  tenant's family profiles once and computes the flag per ledger row. HARD RULE respected: nothing here
  is added to `recordToRow` in `shipped-change-store.ts` - there is no column for it, so it cannot be
  persisted even by mistake; it is recomputed fresh on every read.
- `seasonality-voice.ts`: a new `"seasonal"` teammate through the exact `SpecialistOpinion` contract
  (added `"seasonal"` to the `Specialist` union and `"seasonal_demand_cliff"` to `ObjectionKind` in
  `specialist-opinions.ts`, plus label entries in `debate-summary.ts`). `emitSeasonalOpinion` abstains
  with no computed profile; objects (DOWNGRADE, never veto) against `create_page`/`edit_existing_page`/
  `change_title_meta`/`add_answer_block` when "now" sits inside a family's peak window within
  `CLIFF_LOOKAHEAD_DAYS` (10) of it closing ("shipping into a demand cliff"); flags proactive prep
  (informational, no objection) when the next window opens 4-8 weeks out ("prep now"). Wired into
  `attachOpinions` in `specialist-opinions.ts` (the real pipeline entrypoint every call site already
  uses) and threaded per-Move by page family in `prepare-today-moves.ts` (loads all profiles once,
  looks up per packet).

**Tests:** 5 new test files, 61 new tests (`family-demand-profile.test.ts` 15,
`load-family-daily-rows.test.ts` 4, `event-calendar.test.ts` 16, `seasonal-inflection.test.ts` 12,
`seasonality-voice.test.ts` 14 including a pluralization regression found during ground-truth). Full
`src/domains/seasonal/` suite (12 files) plus every downstream consumer touched
(`measurement-maturity.test.ts`, `specialist-opinions.test.ts`, `debate-summary.test.ts`,
`move-router.test.ts`, `prepared-move-pack.test.ts`, `proof-outcome-caution.test.ts`,
`proof-weather-caveat.test.ts`, the `gsc-no-hardcoded-site-url` architecture test): **258/258 passing**.
`npm run typecheck`: clean.

**Ground truth (tenant-iranopedia, real data, 2026-07-02):**

- `runFamilyDemandProfiles`: 54 families detected in ~4.2s. `gsc_monthly_archive` currently holds only
  2 distinct months (May + June 2026 - the archive-rollup started recently), so every family's annual
  window reads `months=[5,6] share=1 confidence=one_season` - this is HONEST, not a bug: the existing,
  already-shipped `detectSeasonalQueries` (item 21) shows the identical pattern on the same tenant/data
  (verified side-by-side), and `confidence` correctly never claims "repeated" with only 1 year of
  history. The flag rate will fall naturally as the archive accumulates more months/years.
- Event calendar: 54 candidate entries derived (e.g. "Iran Flags", "Iran Animals", "Persian Male
  Names"), each named after the family slug. Merge is idempotent (re-running produced 54, not 108).
- Seasonal-inflection check against the real 25-row proof ledger: 19/25 rows flagged as spanning the
  currently-detected window (honest given the 2-month-old archive - 6/25 correctly passed through
  unflagged, confirming the check discriminates rather than flagging everything).
- Seasonality voice: fired 0/40 on real Moves as of 2026-07-02 (correct - the May-June window closed 1-2
  days before probe time, past the 10-day cliff lookahead, and the next occurrence is ~10 months out,
  past the 4-8 week prep band). Hand-verified both branches fire correctly at the right calendar
  offsets (cliff fires within 10 days of window close, e.g. "closes in about 1 day"; prep fires 4-8
  weeks before the next window opens) via a timing probe with simulated `now` values.

**Caveats:** `src/domains/llm/draft-pattern.ts`/`.test.ts` are untracked files from a concurrent agent in
this shared worktree, not touched by this item. `docs/BEACON_500_MASTER_PLAN.md`,
`docs/HANDOFF_VERIFIED_STATE.md`, and several `src/` files outside `src/domains/seasonal/` show as
modified in `git status` from other concurrent agents' work in the same worktree - none of that is this
item's changes (verified via targeted `git status --porcelain` filtering before finishing).

---

## 2026-07-02 - BEACON 500 item 70 (learned per-specialist vote weights by lever family, with calibration shrink, worktree, NOT committed)

**Built:**

- `src/domains/team-scoreboard/specialist-weights.ts` (new, pure, no store): extends the
  `src/domains/learning/experiment-prior.ts` pattern (MIN_DECIDED=3, clamp band, explainable counts,
  neutral-until-proven) from Moves to TEAMMATES. `resolveSpecialistWeight(specialist, family, overall,
  familyCell, label)` resolves a bounded [0.85, 1.15] weight from a (specialist, lever-family) settled
  won/lost cell when it has >= MIN_DECIDED (3) decided votes; below that it backs off to the
  specialist's overall record; below that it is neutral (weight 1, basis "neutral", tag null).
  `shrinkForBand`/`worstShrinkAcrossBands`/`applyCalibrationShrink` independently bucket
  `calibration.ts`'s existing conviction bands and fold a bounded shrink (floor 0.85) into an earned
  weight when a band's stated conviction exceeds its measured win rate by more than 15 points on >= 5
  samples (`OVERCONFIDENCE_MARGIN`, `MIN_BAND_SAMPLE_FOR_SHRINK`). `buildSpecialistWeightTable(cells,
  labelFor)` builds a read-time lookup table from the scoreboard's existing per-specialist rows (no new
  persisted store - computed fresh from whatever `compute-scoreboard.ts` already wrote).
- `src/domains/demand-graph/move-router.ts` (owned slice): new optional `specialistWeight` field on
  `RouteInput` (type `SpecialistWeightLookup = (specialist, family) => { weight, tag } | null |
  undefined`). Inside the vote tally, each opinion's per-action confidence share is now multiplied by
  `specialistWeight?.(o.specialist, actionFamilyOf(a))?.weight ?? 1` before being added to that action's
  running vote total; `totalVoteWeight` folds in the same (averaged, across an opinion's suggested
  actions) weight so a boosted/shrunk specialist moves its real share of the team's total voice, not
  just its own action's tally. New `appliedWeights: AppliedSpecialistWeight[]` field on
  `MoveRouterDecision` records every non-neutral (weight != 1) resolution actually used, deduped per
  (specialist, family). With no `specialistWeight` passed (every existing call site: `team-review.ts`,
  `prepare-today-moves.ts`, `today-moves-data.ts`), every weight defaults to exactly 1 and the vote math
  is numerically identical to before this change - `appliedWeights` is always `[]`.
- `src/domains/team-scoreboard/load-team-scoreboard.ts`: new `loadSpecialistWeightTable(tenantId)`
  (React `cache()`'d, fail-soft to an all-neutral table) is the $0 read edge a caller can bind into
  `routeMove`'s `specialistWeight` lookup. New `loadActiveSpecialistWeights(tenantId)` returns every
  currently non-neutral `ReliabilityWeight` across the tenant's scoreboard, for a surface that wants the
  full list without re-deriving per Move.
- `src/app/(shell)/team-standup.tsx` (the existing item-38/43 scoreboard surface, not a shared worklist
  card): `loadScoreboardForStandup` now also calls `loadActiveSpecialistWeights` and appends one
  plain-English line per specialist with an active learned weight (deduped to its first/strongest
  cell), e.g. "Search demand has called 8 of its last 11 winners here, so its vote counts a bit more."
  Stacked under the existing footer/calibration/objection lines; silent (empty array) until a cell
  clears MIN_DECIDED, same honest-silence posture as every other accountability line on this strip.

**Verified:**

- `npm run typecheck` clean in every file this item owns (`move-router.ts`, `specialist-weights.ts`,
  `load-team-scoreboard.ts`, `team-standup.tsx`). Three pre-existing/concurrent errors remain in
  `src/domains/demand-graph/debate-summary.ts` and `src/domains/demand-graph/specialist-opinions.ts`
  from another in-flight agent's session adding a `"seasonal"` specialist to the `Specialist` union -
  explicitly out of this item's ownership (`specialist-opinions.ts` is on the do-not-touch list) and
  confirmed via `git status` that neither file is touched by this change.
- 49 new/updated targeted tests, all green:
  - `src/domains/team-scoreboard/specialist-weights.test.ts` (24 new): MIN_DECIDED gating on both the
    family and overall cells (below/at-exactly/above the floor), family-then-overall backoff (thin
    family backs off to a proven overall record; both thin resolves neutral), clamp band holds across
    the full 0..20 win-rate sweep (never exceeds [0.85, 1.15]), shrink math (no shrink below the sample
    floor, no shrink when the overshoot is inside the 15-point margin, a real shrink when overshoot
    exceeds it, floored at 0.85 under extreme overconfidence, null `winRatePct` never shrinks),
    `worstShrinkAcrossBands` picks the single worst band, `applyCalibrationShrink` leaves a neutral
    resolution untouched and re-clamps + replaces the tag on an earned one, and
    `buildSpecialistWeightTable` cold-start-neutral / unknown-specialist-neutral / family-miss-backs-
    off-to-overall.
  - `src/domains/demand-graph/move-router.test.ts` (25 new, appended to the existing 25 pre-existing
    cases which all still pass): a dedicated "byte-identical when cold" suite - no lookup passed, an
    always-neutral-returning lookup, and an always-`undefined`-returning lookup all produce output
    `toEqual` the no-lookup baseline; a real up-weight nudging a close election (without asserting it
    must flip, since the bound is deliberately small); a down-weight visibly shrinking a family's vote
    share; `appliedWeights` populated/deduped correctly including the two-distinct-families-from-one-
    opinion case; `appliedWeights` empty when a lookup returns a tag at weight exactly 1 (nothing to
    explain); and a pin that the veto/downgrade/overlap-boost score machinery (the `create_page`
    overlap-boost `1300` case) is completely unaffected by vote weighting.
  - Full `src/domains/team-scoreboard/` suite re-run (119 tests, 6 files) - all still green, no
    regressions from the new `load-team-scoreboard.ts` additions.
- No em/en dashes in any new or touched file (`specialist-weights.ts`, its test, `move-router.ts`, its
  test, `load-team-scoreboard.ts`, `team-standup.tsx`) - checked by direct byte search, zero matches.

**Ground-truthed live on Iranopedia** (`tenant-iranopedia`, read-only probes, $0, no writes beyond the
existing idempotent scoreboard recompute):

- The real team scoreboard (`scripts/ground-truth-team-scoreboard.ts`) currently has **0 specialists
  and 0 settled-and-joined picks** (`totalSettled=0`, `settledJoined=0` from a fresh
  `buildTeamScoreboardSummary` run). Root cause, confirmed directly: 25 real proof-ledger rows exist (1
  won, 3 lost, 5 inconclusive, 16 measuring) but under the maturity gate ALL 25 are still
  `collecting`/`early_checkpoint` (16 collecting, 9 early_checkpoint) - none has reached
  `mature_result` yet. Separately and independently, of the 2 real plan records in history, **0 plan
  picks carry a `teamReview`** - the team-review wiring postdates both plans, exactly the same drought
  item 38's own ground-truth already documented.
- Because the scoreboard itself has nothing settled to learn from, every `specialist-weights.ts`
  resolution is honestly neutral today: `buildSpecialistWeightTable([])` (equivalent to the current
  empty-cells state) resolves every `(specialist, family)` lookup to `{ weight: 1, basis: "neutral",
  tag: null }`, so `loadActiveSpecialistWeights("tenant-iranopedia")` returns `[]` and the new standup
  line does not render for any specialist right now. This is the expected, honest cold-start state, not
  a bug - it will self-activate the same day item 38's own scoreboard first reports real settled+joined
  votes for any specialist (>= 3 decided votes in a family, or overall).

**Caveat:** the three existing `routeMove` call sites (`team-review.ts`, `prepare-today-moves.ts`,
`today-moves-data.ts`) are outside this item's ownership boundary (only `move-router.ts` +
`team-scoreboard/**` were owned this slice) and were intentionally left unwired - they continue to omit
`specialistWeight`, so today's routing behavior is unchanged end to end. `loadSpecialistWeightTable`/
`loadActiveSpecialistWeights` exist as the ready-to-bind read edge for whichever slice wires a real
caller in next.

---

## 2026-07-02 - BEACON 500 item 72 (second-order citation playbook: get listed on the sources AI already trusts, worktree, NOT committed)

**Built:**

- `src/domains/ai-visibility/second-order-citations.ts` (new): pure ranking (`rankSecondOrderDomains`)
  and deterministic classification (`classifyDomain`, host/URL-path pattern based - reference,
  ugc_community, media_press, directory, listicle, other) plus a `react cache()` loader
  (`loadSecondOrderCitationPlaybook`, no store, no migration). The loader reads `profound_citation_rows`
  (Supabase, tenant-scoped, PAGE-read past the 1000-row PostgREST cap, MAX_ROWS 50,000) and the
  `dataforseo-llm-mentions` 7-day cache (`readAllCachedLlmMentions`) for real tracked prompts when
  available. Excludes the tenant's own domain (from `getBusinessConfig(tenantId).domain`) and reuses
  the EXISTING noise-domain list (`domainOf`/`isNoiseDomain` from `domains/evidence/relevance-gate.ts`)
  rather than writing a new blocklist. `isRealisticOutreachTarget` flags directory/listicle/media_press
  as real outreach targets; reference and ugc_community are flagged "different playbook" (never a pitch
  email target). Optionally links a domain to an existing `outreach_pipeline` row by domain key
  (read-only; conceptual link only, nothing here sends anything).
- `src/app/(shell)/competitors/second-order-citations-section.tsx` (new): self-hiding section, "The
  sources AI already trusts," top 8 domains with a class chip, "cited N times on your topics," the
  example cited page + a prompt it wins, and the plain-English suggested action. Renders nothing when
  `result.domains.length === 0`.
- `src/app/(shell)/competitors/page.tsx`: 2 import lines + 1 new `SecondOrderCitationsBody` async
  component + 1 `Suspense`-wrapped mount line, placed after the clone-brief cards and before the
  operator-only outreach pipeline section. No other page edits.

**Verified:** `npm run typecheck` clean (0 errors project-wide at the time of this change). 20 new
targeted tests in `src/domains/ai-visibility/second-order-citations.test.ts`, all green: classification
per class (reference/ugc_community/media_press/directory/listicle/other), outreach-target flags
(directory/listicle/media_press yes, reference/ugc_community no), own-domain exclusion, noise-domain
exclusion via the reused `relevance-gate.ts` list, ranking order by citation count, real-prompt-hint vs
topic-derived fallback for `examplePrompt`, outreach-pipeline linkage by domain key, empty-input honesty,
and a pin that generated copy (`suggestedAction`, `examplePrompt`) never contains an em or en dash.

**Ground-truthed live on Iranopedia** (`tenant-iranopedia`, read-only probe, $0 - no paid calls fire on
render): `scripts` ad hoc probe via `set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia
npx tsx --require ./scripts/mock-server-only.cjs <probe>` confirmed 20,712 real `profound_citation_rows`
for this tenant (the initial MAX_ROWS of 20,000 silently truncated 712 rows on the first pass - caught
via a direct `count: "exact"` query and fixed by raising the cap to 50,000 before finalizing). Real
output, 2,985 distinct third-party domains ranked after exclusions:

| domain | class | outreach target | citations | example topic |
|---|---|---|---|---|
| wikipedia.org | reference | no (different playbook) | 1,328 | Hafez / Taarof / Chaharshanbe Suri |
| persiscollection.com | other | no | 411 | Persian housewarming gifts |
| talkpal.ai | other | no | 261 | Persian vocabulary/culture |
| britannica.com | reference | no (different playbook) | 245 | Hafez biography |
| surfiran.com | listicle | yes | 238 | Best Persian foods |
| adventureiran.com | other | no | 200 | Iran's most beautiful places |
| mypersiancorner.com | other | no | 168 | Persian/Farsi terminology |
| orienttrips.com | listicle | yes | 164 | Historical sites in Iran |
| iranicaonline.org | other | no | 148 | Iranian cinema |
| visitouriran.com | other | no | 136 | Iran travel guides |

Own domain `iranopedia.com` correctly excluded (0 leakage rows). Class distribution across all 2,985
domains: other 2,744, listicle 178, media_press 48, ugc_community 7, directory 5, reference 3 - 231
domains total classify as realistic outreach targets. 0 domains currently linked in the outreach
pipeline (empty for this tenant today, so every card renders with `inOutreachPipeline: false`).

**Honest caveat:** most of this tenant's real citing domains are travel/culture blogs with no
directory-shaped path and no press-host match, so they classify as "other" rather than a false-positive
guess - the classifier is intentionally conservative (pattern match or "other," never inferred). Only 8
of 2,985 domains are directory-shaped on this tenant's real data; `google.com` appears in the raw feed
(DataForSEO/Profound sometimes cite a Google SERP-viewer URL as the citation target) and correctly
classifies as `other`/not-an-outreach-target rather than being hidden, since the reused noise-domain list
is scoped to social/UGC/recipe-aggregator noise, not search engines, and a new list was out of scope for
this item.

---

## 2026-07-02 - BEACON 500 item 63 (seasonality engine: proven peak calendar + GSC deep backfill, worktree, NOT committed)

**Built:**

- `src/lib/connectors/gsc/deep-backfill.ts` (new): resumable deep-history backfill up to
  `DEEP_BACKFILL_DAYS` (480) in `CHUNK_DAYS` (30) chunks, checkpointed in a new
  `gsc_backfill_progress` table (`migrations/2026-07-02_gsc_backfill_progress.sql`, additive,
  RLS mirrors peers, NOT yet applied to prod). `startDeepBackfill` / `runDeepBackfillChunk` /
  `continueDeepBackfillIfStarted` / `readBackfillProgress`. The cursor only advances on a
  successful chunk; a failed chunk (network/quota/auth) leaves it untouched so the identical
  window retries next time. `src/lib/connectors/gsc/sync-search-analytics.ts` gained an
  additive optional `endDate` param (back-compat default: pulls through the natural
  `lastFinalDay` as before) so a chunk can bound both ends of its window.
- Operator trigger: `/diagnostics/connectors` gained a "Load my full Search Console history"
  section (`startGscDeepBackfillNow`, `loadGscDeepBackfillStatus`, `startGscDeepBackfillFromForm`
  in that page's `actions.ts`); the nightly cron's new PHASE 1d-2 (`continueDeepBackfillIfStarted`)
  continues an in-progress backfill one chunk per night until complete.
- `src/domains/serp/dataforseo-labs.ts` gained `runHistoricalVolume` (Labs
  `historical_search_volume/live`), the same money gauntlet as every sibling Labs call (configured
  check, 30-day cache, dry-run default, fail-closed shared cap, ledger), `HISTORICAL_VOLUME_COST_USD`
  = $0.08, bounded to `HISTORICAL_VOLUME_KEYWORDS_LIMIT` = 20 keywords/call.
- `src/domains/seasonal/seasonality.ts` gained `computePeakCalendar` + `PeakCalendarEntry`: upgrades
  a `repeated` confidence to a new `proven` level only when the archive's own 2+-year finding AND an
  independently-computed Labs multi-year window (same share/floor method, run over the Labs curve's
  own years) agree on the SAME peak month(s). `clusterLabel` is always the query text itself,
  title-cased - zero hardcoded holiday/topic names anywhere, per the operator's hard rule.
- New `src/domains/seasonal/peak-calendar-store.ts` (persistence, `seasonal-peak-calendar` store,
  registered in `store-classification.ts` GLOBAL_STORES + `json-store.ts` SUPABASE_MIRRORED_STORES)
  and a new PHASE 1d-3 in `cron-sync.ts`: cross-checks the top detected `repeated` cluster heads
  (capped at 20) against Labs nightly, persists the calendar. The 30-day Labs cache means a stable
  cluster-head set only spends once per month even though the cron runs nightly.
- New `src/domains/seasonal/seasonal-candidates.ts`: `findSeasonalCandidates`, a bounded source
  (`MAX_SEASONAL_CANDIDATES_PER_NIGHT` = 2) firing only when a calendar entry's peak opens 6-8 weeks
  out (`SEASONAL_CANDIDATE_LEAD_MIN_WEEKS` = 6, `_MAX_WEEKS` = 8), following the item-56
  `refresh-candidates.ts` precedent exactly (same eligibility-map input shape, same
  one-card-per-page-per-night guard). Wired into `build-daily-candidates.ts` as a new
  `seasonal_prep` lever/action-family "content", additive after the refresh block so a page the
  refresh queue already claimed tonight is correctly skipped here. `QualityLever`
  (`recommendation-quality.ts`) and `BuiltCandidate.leverField` both extended additively.
  `build-today-preview.ts` wires `loadPeakCalendar` in and passes `peakCalendar` through.

**Tests:** 65 new, all green.

- `src/lib/connectors/gsc/deep-backfill.test.ts` (17): chunking bound, cursor-advance-on-success,
  cursor-frozen-on-failure (resumability), final-chunk clamps to target exactly, `not_started` /
  `already_complete` short-circuits, nightly-continuation no-op for a never-started tenant, dash guard.
- `src/domains/serp/dataforseo-labs.test.ts` (+9 new, 39 total): `parseHistoricalVolume` malformed-input
  safety, `runHistoricalVolume`'s gauntlet (batched call/dedup/cap, dry-run, fail-closed cap, cache hit,
  empty-list rejection).
- `src/domains/seasonal/seasonality.test.ts` (+11 new, 26 total): the proven-confidence matrix (upgrade
  on agreement, no-upgrade on single-Labs-year / different-month / flat-curve, case-insensitive keyword
  match, unrelated-cache-noise immunity), `clusterLabel` derivation, field pass-through, empty input,
  extended dash-guard file list.
- `src/domains/seasonal/seasonal-candidates.test.ts` (15, new file): lead-window boundaries (exactly 6
  and 8 weeks), bounding, eligibility + dedup guards, honesty gate (no top page), team-voice content
  per confidence level, dash guard.
- `src/domains/seasonal/seasonal-wire.test.ts` (8, new file): real `seasonal_prep` candidate emission
  through `buildDailyCandidates`, bounding at 2/night, lead-window silence, byte-identical-when-absent,
  mid-measurement exclusion, honesty gate, the seasonal-vs-refresh double-fire guard (refresh wins the
  page when both would fire), dash guard.
- `tests/app/diagnostics/connectors-page.test.tsx` (updated): new action mocks + a render pin for the
  new backfill section heading.

**Verified:** `npm run typecheck` 0 errors in every file this item owns (two pre-existing unrelated
errors - `proof/page.tsx` `selectHeadlineSentence` and `global-patterns/nightly-aggregate.test.ts` -
confirmed via `git diff --stat` to belong to concurrent in-flight work in this shared worktree, not
this item). Targeted sweep: 248 tests / 19 files green (the 5 new test files above plus every touched
shared file: `build-daily-candidates.test.ts`, `build-today-preview.test.ts`, existing seasonal suite,
existing GSC connector suite, `dataforseo-labs.test.ts`, `recommendation-quality.test.ts`, the
json-store/store-classification/cron-sync architecture suites, both connectors-diagnostics suites). No
full suite run this slice (targeted-only per the cost-discipline directive). No git add/commit (per
instruction).

**Ground-truthed live on Iranopedia (read-only probes only, zero writes, zero spend):**
`gsc_daily_rows` really does span only 2026-05-02 to 2026-06-29 (58 days, confirms item 56's starved-
archive note); `gsc_monthly_archive` currently holds exactly 1 distinct rolled-up month (2026-05).
Running the REAL detector + calendar over that live archive found 20 seasonal-shaped queries, and
**every single one is honestly `one_season` - zero `repeated`, zero `proven`** (the May-June-only
window makes every query's 2-month share look like 100 percent of its "annual" total, which is
exactly the starved-data artifact the item's own honesty framing predicted, not a bug).
`gsc_backfill_progress` does not exist in prod yet - the migration is written but NOT applied (the
operator did not request a live backfill or migration apply this slice, per the task's explicit
guardrail: "Do NOT run the live backfill or spend on Labs... the operator triggers the real backfill").

**Caveats / what is deliberately NOT done this slice:** the `gsc_backfill_progress` migration is
written but not applied to prod Supabase; no real GSC backfill was triggered; no real DataForSEO Labs
spend occurred (dry-run/mocked only in tests); the peak calendar will read as all-`one_season` on
every render until the operator runs the real backfill and enough months accrue. Work is
uncommitted in this worktree per the operator's "no git add/commit" instruction for this task.

---

## 2026-07-02 - BEACON 500 item 59 (ask-your-team chat, worktree, NOT committed)

**Built:** New `src/domains/ask/` domain, deterministic-first per the plan's architecture:

- `router.ts` (pure) - `routeQuestion(question)` classifies free text into one of
  `page_specific | site_trend | ai_visibility | measurement | competitor | plan`, extracts a
  named page path (`extractPagePath`: explicit `/slug`, "the X page", "X page's", or "on X"
  with a stop-word guard), and maps each class to the real teammate who owns it (gsc/profound/
  dataforseo/proof/llm) via `TeammateKey` from `team/identity.ts`.
- `fact-assembly.ts` - `assembleAskDossier(routed)` builds a bounded (max 10), fail-soft, $0
  dossier per class by composing ONLY existing loaders, never new query logic: page questions
  reuse `loadPageDossier` (item 54's `/page` composition loader) wholesale; site-trend reads
  `loadDailyTotalsForTenant` + `detectChangepoints` (item 32's CUSUM detector); ai_visibility and
  competitor read `getAnswerIntelligenceIndex`'s brand-positioning/co-citation sections;
  measurement reads `loadProofLedgerCached`; plan reads `getAcceptedPlan`/`getLatestPreviewPlan`.
  Every fact is `{value, source, href}`; every loader call is individually try/caught so one
  source failing never blanks the others (mirrors `page-dossier-data.ts`'s own discipline).
- `composer.ts` - `composeAskAnswer(question, dossier)` calls the budget-gated
  `callStructuredLLM` (a new `ask_answer` Zod schema registered in `llm/schemas.ts`, reusing the
  SAME numeric-fidelity/placeholder/dash/superlative firewall every other structured draft
  passes through in `structured-drafter.ts`) and falls back to `fallbackAnswer` (a deterministic
  template built directly from the top facts) whenever the LLM is off, over budget, or fails
  validation twice. An extra guard drops any `citedFacts` entry whose href was not actually
  provided in the dossier (never surface a fabricated link).
- `history-store.ts` - `appendAskHistory`/`loadAskHistory`, the registered + Supabase-mirrored +
  capped (`MAX_HISTORY = 50`) append-only Q+A history, following the exact
  `strategy-mix-store.ts`/`adjudicator-history.ts` sibling pattern (`readStore`/`writeStore` from
  `json-store.ts`). Registered `ask-history` in `store-classification.ts` (TENANT_SCOPED_STORES)
  and `json-store.ts` (SUPABASE_MIRRORED_STORES).
- `suggested-questions.ts` - `loadSuggestedQuestions()` derives up to 3 example questions from
  the same live loaders (a real changepoint date, a real displacing competitor), padded with
  generic fallbacks so the row is never empty.
- `/ask` route (`src/app/(shell)/ask/`): `page.tsx` (server, loads history + suggestions),
  `ask-actions.ts` (`askQuestionAction` server action: route -> assemble -> compose -> persist,
  tenant always from `currentTenantId()`, never client input), `ask-chat-client.tsx` (client chat
  UI: input, teammate-identity chip bubbles matching `team-standup.tsx`'s exact styling
  convention, cited-fact links underneath each answer). Nav link added to
  `src/lib/navigation.ts` next to Today/Changes/Results.

**Tests:** 54 new tests, all green - `router.test.ts` (19: extraction matrix + class-priority
matrix incl. page-wins-over-trend, stop-word guards, empty-input safety), `fact-assembly.test.ts`
(14: one test per class's happy path + empty path + fail-soft-on-throw, plus a facts-capped-at-10
bound), `composer.test.ts` (10: fallback shape, LLM-success shape, LLM-off fallback,
budget-blocked fallback, **numeric-fidelity firewall pin** - an invented 87%/"manual Google
penalty" claim is rejected and falls back, a fabricated-href citedFacts entry is dropped),
`history-store.test.ts` (7: round-trip, newest-first ordering, MAX_HISTORY cap, TENANT_SCOPED +
Supabase-mirror registration pins, fail-soft on read/write rejection), `suggested-questions.test.ts`
(4: always-3-questions floor, real-changepoint surfacing, real-competitor surfacing, fail-soft on
both loaders rejecting). Updated `tests/architecture/customer-nav-exposure.test.ts` (Invariant 1)
to include `/ask` in the expected sidebar set, per that test's own instruction to update it in the
same commit as an intentional customer-surface widening. Full targeted sweep (`src/domains/ask` +
`src/app/(shell)/ask` + the nav-exposure test + `llm/schemas.test.ts` + `src/lib/persistence` +
`tests/lib/persistence`): 200 tests, all green. `npm run typecheck`: 0 errors in every file this
item touched (one pre-existing, unrelated `TS2556` failure in `src/domains/page-factory/
production-line.test.ts` remains from another item's concurrent in-flight work in this shared
worktree - confirmed via `git status` that the file is untracked/not authored by this item and
predates this session; not this item's ownership). No full suite run per the operator's standing
CI-minutes directive (targeted only).

**Ground-truthed live on Iranopedia** (`tenant-iranopedia`, real `gpt-5-mini` calls, roughly a
cent total across a few runs, no store writes from the probe): asked "why did clicks drop in
early June" through the real pipeline (`routeQuestion` -> `assembleAskDossier` ->
`composeAskAnswer`, no mocks). Routed to `site_trend`. Assembled 4 real facts: `848` sitewide
clicks over the last 7 reported days (`+6%` vs. the prior 7 days' `803`), and two real
CUSUM-detected changepoints - a sustained `56%` drop starting `2026-06-02` and a `52%` drop
starting `2026-06-05`, both correctly flagged as lining up with a possible Google algorithm
shift (consistent with the item-32 algorithm-weather finding of a real clicks shock in that
window). The LLM composed a grounded, fully-cited answer naming both real dates, both real
magnitudes, and the real recovery figure, honestly stating it could not confirm the exact
technical cause beyond the correlation. **Found and fixed a real bug during this live run:** the
first version of the fact-list prompt format wrapped each fact's source in `[brackets]` (e.g.
`[gsc] Sitewide clicks...`), and the model naturally echoed that bracketed prefix into
`citedFacts[].fact` when copying "verbatim" - tripping the shared placeholder firewall
(`/\[[^\]]*\]/` in `structured-drafter.ts`) and causing a spurious fallback on roughly half of
runs even though the underlying answer was fully grounded and correct. Fixed by reformatting the
fact list from `N. [source] TEXT (source: href)` to plain `TEXT | HREF` with an explicit
no-brackets instruction in the system prompt; verified 2-for-2 clean LLM answers (no fallback)
after the fix. This is now the byte-identical prompt shipped in `composer.ts`.

---

## 2026-07-02 - BEACON 500 item 60 (clone-and-beat briefs, candidate factory, worktree, NOT committed)

**Built:** `src/domains/serp/money-pages.ts` (new, pure) - aggregates the SAME `ranked_keywords` /
`domain_intersection` rows the item 16 keyword-gap engine already pulls ($0 marginal) into
traffic-weighted competitor "money pages": groups by ranking URL (a new `rankingUrl` field parsed
onto `KeywordGapRow` in `dataforseo-labs.ts`, from `serp_item.url`), sums `volume * winnability(rank)`
per URL (reusing `keyword-gaps.ts`'s existing CTR-decay curve as the traffic proxy, since DataForSEO
never reports real traffic for a page that is not the tenant's own), bounded to the top 20 per
competitor domain. `src/domains/serp/clone-brief.ts` (new, pure) - builds the "their best page, our
better version" brief from one money page + its teardown facts (the EXISTING, untouched
`competitor-page-audit.ts` engine) + the tenant's owned-topic labels: their structure (`whatWins`,
called through only when facts are real, never on the dash-producing null-facts branch), the demand
they capture (top 5 keywords + volumes), the coverage gap vs owned pages (`computeCoverageGaps`,
reusing `relevance-gate.ts`'s `topicTokens` distinguishing-token filter so generic brand words never
count as a gap), and a "build our better version" pointer feeding create-page candidates the same way
keyword-gap cards already do. `src/domains/serp/clone-brief-store.ts` (new) - persistence, same shape
as `keyword-gap-store.ts` (one row per tenant, 30d staleness, capped at 25). `keyword-gap-producer.ts`
extended additively: after computing gaps, labels each with item 18's `computeWinnability` from a
CACHED-ONLY difficulty read (`applyWinnabilityToGaps`, $0, honest labeling - a "reject" gap still
shows, never silently dropped), then aggregates money pages from the same rows and runs up to
`MAX_BRIEF_TEARDOWNS` (5) bounded, polite, cache-aware teardowns (reuses the fresh 14d
`competitor-page-audit` cache when present, else one `auditCompetitorPage` fetch per URL - never a
paid API). `/competitors` gets a new "Their best pages, and how we would beat them" card section
(`CloneBriefCards`/`CloneBriefsBody` in `page.tsx`) reading the new store at $0, under the existing
gap-engine trigger; the existing "Find what competitors rank for" button's run now also builds briefs,
no new button. Registered `clone-brief-results` in `store-classification.ts` (GLOBAL_STORES) and
`json-store.ts` (SUPABASE_MIRRORED_STORES) so hosted prod persists it.

**Tests:** 45 new/updated tests, all green - `money-pages.test.ts` (11: URL-less rows skipped, junk
rows dropped, weighted sum math, duplicate-keyword best-rank-wins, per-domain top-20 cap independent
across competitors, top-10 keywords-per-page cap, `pickTeardownTargets` bounding). `clone-brief.test.ts`
(13: coverage-gap token diff, torn-down/blocked/not-read/fetch-failed honesty, build-pointer reasoning,
dash guard across every teardown-status branch). `clone-brief-store.test.ts` (5: round-trip, one-row-
per-tenant, 25-cap, 30d staleness, fail-soft). `keyword-gap-producer.test.ts` (+7: money pages found
+ bounded briefs with no extra Labs calls, fresh-cache reuse skips re-fetch, cached-difficulty
winnability labeling incl. an honestly-unlabeled gap, never-drops-a-gap pin, brief-build failure
fail-soft, dash guard on brief summaries). `keyword-gaps.test.ts` (+4: `applyWinnabilityToGaps` labels
from cache / stays null when uncached / never drops / dash guard). `dataforseo-labs.test.ts` (updated:
`rankingUrl` parsed from both nested and flattened `serp_item.url`). A real dash bug was caught and
fixed by the new tests: `whatWins(null)` returns a bare em dash by (pre-existing, untouched) design in
`competitor-page-audit.ts`; the producer now only calls it when `facts` is non-null, never inheriting
that violation. `npm run typecheck` - 0 errors (confirmed by isolating one pre-existing, unrelated,
in-progress-elsewhere `page-factory/production-line.test.ts` TS2556 via `git stash` - not in item 60's
ownership and not touched).

**Ground-truth (real Iranopedia, forced dry-run + cached-only, per the gate):** Queried prod Supabase
`json_store_blobs` directly - `dataforseo-labs-cache` and `keyword-gap-results` have ZERO rows for
every tenant (the Labs-based keyword-gap engine, items 16/18, has never actually been clicked live
against real DataForSEO). A forced-dry-run probe (`DATAFORSEO_DRY_RUN=true` before any import) against
`tenant-iranopedia` correctly reported `status: dry_run`, `$0.00` spent, competitors
`persiscollection.com, eavartravel.com, surfiran.com` (from the real demand graph's citation evidence),
0 money pages, 0 briefs - honest, not an error, since there is no cache to reuse. Proved the
brief-building half against REAL data instead: 45 real `competitor-page-audit` teardown rows exist in
prod Supabase for `tenant-iranopedia` (fetched 2026-07-01). Ran the real, unmodified
`aggregateMoneyPages` + `buildCloneBrief` functions against the real teardown facts for
`mypersiancorner.com/farsi-persian-iranian-a-brief-guide-to-terminology/` (title "Farsi? Persian?
Iranian?: A Brief Guide to Terminology", 732 words, has FAQ, `whatWins()` = "FAQ · answer block · 12
schema type(s) · 732 words · interactive tool · 16 images · strong internal linking · dated/fresh")
paired with one fabricated `KeywordGapRow` standing in for the not-yet-run Labs pull (clearly labeled
as fabricated, since Labs has never returned real rows for this or any tenant). Output: a real,
dash-clean brief - `trafficWeight: 612`, `summary`: "mypersiancorner.com earns an estimated 612
traffic-weighted points from this one page, led by 'farsi vs persian difference' at about 720 searches
a month. Their page wins on FAQ · answer block · 12 schema type(s) · 732 words · interactive tool · 16
images · strong internal linking · dated/fresh. We have no page covering brief, terminology, corner
yet, that is our opening." **Caveat found (spun off, not fixed here - out of item 60's ownership):**
the real page's `topTerms` (an existing, untouched field on `competitor-page-audit.ts`) leaked
boilerplate/site-name tokens ("corner", "brief", "not") into the coverage-gap list; flagged as a
background task against `extractCompetitorFacts`'s stopword handling, not a bug in the new item 60
code, which only consumes what that function already provides. The next real click of "Find what
competitors rank for" (operator-triggered, ~$0.66, cost ceiling unchanged since teardowns ride the
free polite fetcher) will populate real money pages end to end.

**Not done / deferred:** no live Labs data exists yet for any tenant, so the actual list of real
traffic-weighted money pages and a Labs-sourced brief remain unseen until the operator clicks the
button for real (documented in the master plan entry, not hidden).

---

## 2026-07-02 - BEACON 500 item 61 (agentic full-page rewrites, worktree, NOT committed)

**Built:** `src/domains/llm/rewrite-page.ts` (new walker, mirrors item-55's `draft-full-page.ts`):
rewrites the CURRENT page's h2 sections one at a time, grounded on each section's own old body text
plus GSC demand + any competitor/fanout facts supplied, through the same `callStructuredLLM("section_draft")`
+ shared numeric-fidelity firewall + `evaluateSectionDraftQuality` (item 55's section gate) pipeline.
Retries once on a regeneratable quality failure; on a second failure KEEPS THE ORIGINAL TEXT VERBATIM
(never a fabricated stub - a rewrite is only ever an improvement or a no-op, never new invented text).
Review surface: `src/app/(shell)/page/[...path]/dossier-rewrite.tsx` (client) + `page-rewrite-actions.ts`
(server actions: generate, load-saved, stage-accepted) mounted on the page dossier (item 54's `/page/[...path]`
route, the cheapest existing mount with per-page evidence already loaded). Per-section accept/reject
checkboxes; "Publish accepted sections" stages ONLY the checked sections through `executePush`'s existing
`replace_section` body-push route (`target_element_key: "section:<heading>"`), so every push still runs
the Ritz hard-block, publish-permission check, armed-mode check, wix_cms-target check, daily cap,
pre-push snapshot (revertible), and never-wipe guard - no new write path, pure composition. Persistence:
`move_drafts` kind `page_rewrite` (new `MoveDraftKind` member, compact per-section old/new/kept-reason
JSON under the 12k cap) so the review survives reload, keyed `page-rewrite:<path>`. New `full_rewrite`
`ActionType` (registry entry, `generatorActive: false` - always operator-triggered) and a distinct
`full_rewrite` `ExperimentFamily` (was previously folded into the generic `content` regex match) so the
diff-in-diff ledger's learned priors separate "full section rebuild" outcomes from "single-lever edit"
outcomes, per the item's requirement. On any successful section publish, calls the existing
`autoRecordShippedChangeForRec` with `actionType: "full_rewrite"` so measurement/hold/learning start
automatically, exactly like every other ship path.

**Tests:** `src/domains/llm/rewrite-page.test.ts` (19 tests) - one-rewrite-per-current-section, cap at
`MAX_REWRITE_SECTIONS`, grounds on the section's own old body text, honest "no body text on file" prompt
branch, ORIGINAL-KEPT-ON-FAILURE pin (exact old text preserved, never a stub sentence), numeric-fidelity
firewall reject (invented stat with no basis in old text/grounding -> kept original) and allow (a number
already in the old text may be restated), budget-fail-closed (LLM never called, every section kept
original) and provider-off (byte-identical originals), assembleRewrite old!==new/keptReason shape, dash
guard, persistence round-trip. `page-rewrite-actions.test.ts` (18 tests) - operator gate on generate/load/
stage, budget/off reason pass-through, ACCEPTED-ONLY STAGING PIN (only the sections passed as `accepted`
call `executePush`, confirmed via the exact `target_element_key`/`proposed_text`/`action_type` on the call),
one section's refusal never blocks another's push, RITZ REGRESSION (refuses before any `executePush` call
when tenant is `RITZ_TENANT_ID`, receipt says "advise mode"), armed-publish rails gating (staged-not-armed,
no publish permission, non-wix_cms target each independently refuse with zero pushes), ENROLLMENT PIN
(`autoRecordShippedChangeForRec` called with `actionType: "full_rewrite"` only when >=1 section actually
published, never called on a total refusal), dash guard on every receipt/refusal reason. Existing shared
files touched (registry/family/exhaustive-switch additions) verified still green: `action-types.test.ts`,
`recommendation-action-rows.test.ts`, `experiment-eligibility.test.ts`, `family-win-propagation.test.ts`,
`run-strategy-review.test.ts`, `refresh-surface-pins.test.ts`, `proof-history-voice.test.ts`,
`draft-full-page.test.ts`, `draft-quality.test.ts`, `body-merge.test.ts` (206 tests / 10 files, all pass).
`npm run typecheck`: 0 errors from this item's changes (one pre-existing unrelated error in
`src/domains/page-factory/production-line.test.ts`, an untracked file from concurrent item-62 work in
this shared worktree - outside this item's ownership, not touched). No full suite run (targeted sweep
per the CI-minutes rule); no git add/commit per the gate.

**Ground-truthed live on Iranopedia** (`tenant-iranopedia`, real `gpt-5-mini` call via
`BEACON_LLM_PROVIDER=openai`, NO publish - read-only probe script, deleted after the run): rewrote 4 h2
sections of `https://iranopedia.com/persian-male-names` (a name-index page) for a total of $0.0025 (well
under the $0.03-0.06 budget target). Honest quality read: every section stayed grounded (no invented
numbers beyond the injected GSC stat), carried real sources, had no em/en dashes, no content-plan
language, and correctly passed the quality gate as genuinely copyable text - but the rewrites were
repetitive/generic across sibling name entries and the walker mis-scoped the page-level GSC stat
("52,735 impressions... in the last 90 days") into one individual name's opening sentence, because this
page's h2 headings are per-name list entries with almost no distinguishing old body text to rewrite
against. No hard rule was violated; the finding is that name-index-style pages are a poor fit for
section-level rewriting, while a page with real narrative h2 sections (e.g. a Nowruz/Sofreh Aghd
explainer) would exercise the "sharpen the existing prose" grounding as intended. Recommended next
verification: run against a narrative page before the first operator-facing publish.

---

## 2026-07-02 - BEACON 500 items 44+45 (body-push idempotency gap-fix + Wix deep links, worktree, NOT committed)

**Item 44 verification (VERIFY-AND-CLOSE):** the master-plan ask predates wave 1 item 2, which already
built the safe body-append push route. Checked the three specific asks: (a) do
add_answer_block/add_faq/add_h2_section actually route (not refuse) when a body field is mapped -
YES, confirmed in `push-service.ts`'s body-section route (`bodyMergeModeForAction` + `resolveWixBodyFieldForUrl`
+ `executeBodySectionPush`); (b) is the append idempotent on re-push - NO, this was a real gap: neither
`body-merge.ts` nor `executeBodySectionPush` detected an already-present section, so re-pushing the same
answer block or FAQ would stack a second copy; (c) does the snapshot cover the whole body - YES, confirmed
`previous_text: existingText` captures the full serialized field before every merge.

**Gap fix:** added `sectionAlreadyPresent` + a `normalizeForComparison` helper to `body-merge.ts`
(strips tags/markdown-heading-hashes/whitespace/case; RICOS compares per paragraph text line).
`mergeBodyContent` now short-circuits `prepend_answer`/`append_faq` to an honest no-op
(`{ ok: true, merged: existing, alreadyApplied: true, summary: "this section is already on the page..." }`)
when the draft is already present verbatim (normalized); `replace_section` is untouched (idempotent by
construction, never short-circuited). `push-service.ts`'s `executeBodySectionPush` checks
`merge.alreadyApplied` right after the merge call: on a real push it skips the live Wix write and skips a
new snapshot (nothing changed, nothing new to undo), ledgers the attempt as `push_failed` with detail
`body_noop_already_applied: <field>` (so it never eats a daily-cap slot for a push that changed nothing),
and returns `{ kind: "pushed" }` with an honest "already there, no change" receipt (the content genuinely
is live, so `pushed` is the correct outcome kind, not `refused`); a dry-run of an already-applied section
reports the no-op with zero side effects (same audit-#35 contract as every other dry-run branch).

**Item 45 build:** new pure `src/domains/push/wix-deep-link.ts` - `buildWixEditorLink({siteId,
dataCollectionId, dataItemId?})` returns a `URL` or `null`. Two real Wix dashboard URL shapes: a Wix
Stores product (`dataCollectionId === "Stores/Products"`, matching the same string push-service.ts/
push-snapshots.ts already special-case) with a known item id resolves to
`https://manage.wix.com/dashboard/{siteId}/stores/products/{itemId}` (the product editor); any other
mapped CMS collection resolves to `https://manage.wix.com/dashboard/{siteId}/database/data/{collectionId}`
(the Content Manager for that collection - Wix has no stable per-item deep link for non-Stores
collections, so the collection view is the closest honest target). Honest null on any missing piece
(no site connected, no collection mapping, a Stores product with no item id) - never a guessed or dead
link. Wired as a read-only affordance (no auto-actions) beside Copy/Open page on both card surfaces:
`ExecutionCard` (`daily-experiments-section.tsx`, fed by a new `wixEditorUrlByUrl` map computed once per
build in `daily-experiments-data.ts`) and the worklist `MoveCard` (`today-moves-card.tsx`, fed by a new
`wixEditorUrl` field per move computed once per build in `today-moves-data.ts`, keyed off the same
url-map entry the push service itself resolves). One `getWixUrlMap()` + one `getWixConnectorToken()`
read per page build in each loader, not per card/move.

**What verified:** `npm run typecheck` 0 errors. Targeted vitest: `tests/domains/push/` full sweep
195 passed / 0 failed (10 new `wix-deep-link.test.ts` resolver tests - mapped CMS item, Stores product,
unmapped null, dash-clean, purity; 9 new idempotency tests across `body-merge.test.ts` and
`push-service-body.test.ts` - re-push no-op for plain/html/RICOS, no false positive on a genuinely
different section, replace_section unaffected, end-to-end no-duplicate-write + no-double-snapshot +
no-cap-spend through `executePush`, dry-run no-op). No full suite run (targeted push-domain sweep per
the CI-minutes rule). Dash guard: scanned every line added/changed in this slice for em/en dashes -
found two in doc-comments only (not operator-facing copy) and rewrote both to plain punctuation.

**Ground-truth against real Supabase** (project `vlxwevsdvwxvopkjsewo`, read-only): `connector_tokens`
confirms Iranopedia's Wix connector is connected with a non-empty `site_id` (not disconnected). But both
`wix_collection_config` and `wix_url_map` return 0 rows for every tenant (tables exist, migrated, just
empty) - the operator has never run the collection-mapping step on `/diagnostics/wix`. Result: today, no
card resolves a working "Open in Wix" link for Iranopedia (every lookup honestly returns null), the exact
same pre-existing gate that already blocks the field-edit and body-append live-push routes. The resolver
and wiring are correct and will start producing real links the moment at least one collection is mapped
and synced - no code change needed then.

---

## 2026-07-02 - BEACON 500 item 38 (specialist scoreboard, worktree, NOT committed)

**What changed:** new `src/domains/team-scoreboard/` domain. `brier.ts` (PURE) -
`voiceProbability(stance, conviction)` (supporting = conviction/100, dissenting = 1 - conviction/100),
`dissentProbability(severity)` (a fixed, documented conviction table since team-review.ts's objections
carry a severity, not a numeric conviction: veto -> 80% conviction against, downgrade -> 60%),
`brierScore(probability, outcome)`, `aggregateVotes` (won/flat/lost tallies + mean Brier + a
small-n `calibrationNote` below 5 votes), `buildSpecialistScoreboard` (groups by specialist then by
actionFamily), `bestForecaster`/`buildBestForecasterLine` (silent unless a specialist clears its own
minimum sample). `compute-scoreboard.ts` - `findPlanPickForProofId` generalizes
`findForecastedPickForProofId` (forecast-calibration.ts) to return the whole `PlannedExperimentRecord`
(so its `teamReview` is available, not just the numeric forecast); `votesFromTeamReview` turns one
settled pick's team review into scored votes (supporting voices keyed by their raw specialist id,
dissenting/objecting voices keyed by their plain label, since team-review.ts only persists a label on
an objection); `buildTeamScoreboardSummary` does a full, idempotent recompute from `loadShippedChanges()`
+ `listPlans(tenantId, 120)`, gated by the EXACT eligibility `load-experiment-outcomes.ts` uses
(`deriveMeasurementMaturity` mature_result + `detectMeasurementOverlaps` + the algorithm-weather shock
guard), and persists to a new GLOBAL Supabase-mirrored store `team-scoreboard` (registered in
`store-classification.ts` + `json-store.ts`, "latest wins" full-replace-per-tenant, same pattern as
`algorithm-weather-store.ts`). `load-team-scoreboard.ts` is the $0 read edge (`loadTeamScoreboardView`,
`loadSpecialistRecordLine`). Wired as an isolated fail-soft tail step (same posture as `harvestWinners`)
at both measure-pass tail call sites: `auto-measure-on-use.ts` (passive) and
`today-moves-actions.ts#measureAppliedMovesAction` (operator-triggered) - neither touches `measure.ts`
itself. `team-standup.tsx` gains an honest one-line footer (silent below 5 settled-and-joined picks) plus
a trivially-additive per-chip "N of M" record suffix keyed by the same specialist id each chip already
uses. NEVER mutates a plan record or a ledger row - read-only over both.

**What verified:** `npm run typecheck` 0 errors (one transient `scripts/_debug6.ts` error from a
concurrent agent's in-flight file, gone on retry - not mine). Targeted vitest: 53 new tests across
`brier.test.ts`, `compute-scoreboard.test.ts`, `team-scoreboard-store.test.ts`,
`load-team-scoreboard.test.ts`, all green (perfect-forecaster/contrarian/abstain-exclusion/small-n-honesty
on the Brier math; eligibility-gate pins incl. a real confirmed-Google-update-window collision caught by
the fixture dates; idempotent-recompute; store round-trip; surface pin + silence-below-5; dash guard).
Existing `auto-measure-on-use.test.ts` still green.

**Ground-truth on real Iranopedia data** (`scripts/ground-truth-team-scoreboard.ts`): 25 ledger rows,
0 at `mature_result` today (16 `collecting`, 9 `early_checkpoint` - the known mature-verdict drought).
Separately, only 2 plans exist (both 2026-06-30), 0 picks on either carry a `teamReview` - the
team-review wiring in `build-today-preview.ts` (commit 59ba8fe2) postdates both plans, so the honest
join count today is 0/0. This is expected and not a bug: once a future nightly batch runs through the
team-review-wired planner AND its picks mature past 28 days, `buildTeamScoreboardSummary` will start
producing real per-specialist Brier scores automatically, no code change required - this is the
substrate, and the substrate is correctly reporting "nothing to score yet" rather than fabricating one.

## 2026-07-02 - BEACON 500 item 32 (algorithm-weather guard, worktree, NOT committed)

**What changed:** new `src/domains/proof-gsc/changepoint.ts` - pure CUSUM changepoint detector,
`detectChangepoints(dailySeries, {threshold, drift, baselineWeeks, minHistoryDays})` -> `[{date, direction,
magnitude}]`. Weekday-normalizes first (each day divided by the trailing same-weekday mean over
`baselineWeeks`) so Search Console's real weekend/weekday cyclicity never fakes a shift, then runs a
two-sided CUSUM over the normalized ratio series. Tuned (threshold 0.5, drift 0.1 of the trailing mean) to
fire on a sustained shift around 18-20 percent while staying silent below about 15 percent and on pure
weekday-cyclic noise (probed by hand: 15% silent, 18% fires, 40% fires) - matches the "catch >=20 percent
sustained shifts" target. New `src/domains/proof-gsc/google-updates.ts` - typed, operator-extendable
`CONFIRMED_GOOGLE_UPDATES` const, seeded with 6 entries verified directly against Google's own Search
Status Dashboard (Dec 2025 core, Feb 2026 Discover core, Mar 2026 spam, Mar 2026 core, May 2026 core, Jun
2026 spam) via a deep-research pass; deliberately excludes an unconfirmed June 19 2026 volatility rumor.
New `src/domains/proof-gsc/algorithm-weather.ts` - merges confirmed ranges + detected changepoints into
`ShockWindow[]` (`confirmed`/`suspected`, with plain-English labels), `overlappingShock(start, end, shocks)`
overlap check (confirmed wins over suspected), and `weatherCaveatSentence` (first person, one sentence, no
dashes). New `src/domains/proof-gsc/algorithm-weather-store.ts` - GLOBAL Supabase-mirrored json-store
(`algorithm-weather-shocks`, registered in `store-classification.ts` + `json-store.ts`) holding the nightly
CUSUM pass per tenant, 30-day staleness. Nightly step wired as PHASE 1g in `cron-sync.ts` (reads
`loadDailyTotalsForTenant(tenantId, 90)`, runs `detectChangepoints` on clicks and impressions, persists via
`writeAlgorithmWeatherSummary`; isolated try/catch per tenant, does not touch PHASE 1c-1f).
`measurement-maturity.ts` additive: new `shockWindows?` input field, new `measurementWindowOf(shippedAt,
windows)` pure helper (the ship-to-basis-checkpoint window every read site now shares), and two new
presentation fields `weatherCaveat: string | null` / `weatherQuarantined: boolean` computed purely from an
overlap check - a caller that never passes `shockWindows` sees byte-identical output to before this field
existed; `learningEligibility` gains `&& !weatherQuarantined`. Results page (`/proof`) loads last night's
detected changepoints + builds shock windows, threads them into every row's presentation, and renders
`pres.weatherCaveat` as an amber caveat line under the Search sentence. `load-experiment-outcomes.ts`
(the single read site both `load-graph.ts`'s demand-graph priors and `load-demand-opportunities.ts` consume)
additively extends `maturityGatedVerdict`: a mature, cleanly-attributed verdict whose own measurement window
overlapped a shock is ALSO neutralized to `"measuring"` before it reaches the prior, the same way an
early/attribution-limited read already is - never mutates the stored ledger row.

**Verified:** `npm run typecheck` 0 errors. 133 new/updated targeted tests green across 8 files:
`changepoint.test.ts` (12 - step up/down, sub-threshold no-fire, the documented ~20% target, gradual drift
not just a single-day jump, weekday-cyclic noise-only silence, flat-series silence, short-series fail-closed,
malformed-input safety, one-alarm-per-shift, dash guard), `algorithm-weather.test.ts` (16 - confirmed-window
assembly incl. default rollout length, suspected-window spread, the overlap matrix incl. inclusive
boundaries and confirmed-over-suspected precedence, the merge/build function, the caveat sentence, dash
guard), `google-updates.test.ts` (6 - seed-list shape: start<=end, unique ids, dash guard on every label),
`algorithm-weather-store.test.ts` (8 - round-trip, latest-wins-per-tenant, empty-pass-is-a-real-state,
30-day staleness, unknown-tenant, clicks+impressions dedup merge, registration pins), `measurement-maturity.
test.ts` (7 new - `measurementWindowOf`, no-shockWindows-is-byte-identical, a mature win quarantined by an
overlapping shock keeps its headline/tone but loses learning eligibility and gains the caveat, a non-
overlapping shock has zero effect, an in-flight record can also carry the caveat, dash guard on the rendered
sentence), `load-experiment-outcomes.test.ts` (7 new file - end-to-end prior-exclusion pin with the real
[pure] measurement-maturity/algorithm-weather modules and mocked stores: no-shock behavior unchanged,
overlapping shock neutralizes both `loadExperimentOutcomes` and `loadProofOutcomeRows`, non-overlapping
shock has no effect, per-tenant scoping, fail-soft on a store read error), `proof-weather-caveat.test.ts` (4
new file - static pin that `/proof`'s page.tsx actually wires `loadDetectedChangepoints` ->
`buildShockWindows` -> `shockWindows` into `buildMeasurementPresentation` and renders `pres.weatherCaveat`),
plus the pre-existing `proof-jargon-guard.test.ts` (9, re-verified green with the new caveat line present).
No full suite run (per operator directive - targeted + typecheck only); no git add/commit (per task gate).

**Ground-truth on real Iranopedia data** (`scripts/ground-truth-algorithm-weather.ts`, read-only, no writes):
90 days of real `gsc_daily_totals` (2026-05-02 to 2026-06-28, 58 rows) produced 2 real CUSUM changepoints on
clicks (2026-06-02 down 56%, 2026-06-05 down 52% - clicks genuinely drifted from ~150/day in early May to
~100-115/day by mid-June) and 3 on impressions (2026-06-15 up 66%, 2026-06-16 up 96%, 2026-06-21 up 67% -
impressions genuinely spiked from ~8k/day to 13-15k on Jun 15-16 and to ~11.9k on Jun 21). Merged with the
6 seeded confirmed updates this produced 11 shock windows. Checked against the real 25-row proof ledger: all
25 current in-flight verdicts (all `collecting`/`early_checkpoint`, none mature yet) overlap either the
detected mid-June suspected window or the confirmed June 2026 Google spam update (Jun 24-26) and would carry
the weather caveat - honest, because every one of these rows shipped and started measuring in the exact week
Iranopedia's own sitewide numbers were genuinely moving and a real Google update also landed. No mature
verdict exists yet in the real ledger, so the prior-exclusion gate has not fired on real data yet, but the
unit/integration tests pin that it will the moment a mature+shock-overlapping row appears.

**Honest caveats:** (1) the `CONFIRMED_GOOGLE_UPDATES` seed list was verified by a deep-research web pass
against Google's own status dashboard, not by the operator directly - solid confidence, but the operator can
review/extend `google-updates.ts` at any time. (2) with only 58 days of real daily-totals history, the
CUSUM's `minHistoryDays=21` gate is satisfied but the "detected shocks currently cover essentially the whole
recent ledger" result reflects a site that has been been through both a real Google update and real organic
volatility in the same month - not a guard that is miscalibrated. (3) `proof-summary-section.tsx`'s
aggregate counts were left unextended (out of scope, additive-only diff) - only the per-row Results caveat
and the prior/lesson exclusion were required by this item.

---

## 2026-07-02 - BEACON 500 item 30 (winner memory feeds every drafter prompt, worktree, NOT committed)

**What changed:** new `src/domains/llm/winner-memory.ts` (composes beside `proof-history-voice.ts`'s
`aggregateSettled`, does not touch it) - `extractStructuralFeatures(text)` (pure: wordCount, leadsWithAnswer
via a deferral/dictionary-opener check, hasNumber, questionHeading); `harvestWinners(tenantId)` reads
`loadShippedChanges()`, keeps ONLY records where `verdict === "won"` AND `deriveMeasurementMaturity(...)
=== "mature_result"` (never an early/interim/inconclusive signal), retains the real `before`/`after` text
already on `ShippedChangeRecord` (honest `beforeText: null` when the ledger never recorded a prior - never
fabricated), buckets by `actionFamilyOf(actionType)`, and persists the newest 10 per (tenant, actionFamily)
to a new `winner-memory` json-store (GLOBAL classification + Supabase-mirrored, registered in
`store-classification.ts` + `json-store.ts` next to the other measure-pass-tail stores); `buildWinnerFewShots
(tenantId, lever)` returns a prompt fragment naming the top 2 same-lever winners with their measured CTR
lift + structural fingerprint, or `''` when none exist. Wired additively into `structured-drafter.ts`:
`ANSWER_BLOCK_SYSTEM`/`ATOMIC_EDIT_SYSTEM` gain an optional `tenantId` on their input types, and the
fragment is appended (`SYSTEM + fewShots`) only when non-empty - a missing/empty-winners tenantId leaves
the prompt byte-identical to before. `tenantId` threaded through the two real call sites
(`build-today-preview.ts`'s answer-write pass + LLM meta/title enrich drafter, `prepare-today-moves.ts`'s
`draftForPacket`) since both already have it in scope. Harvest hook wired at the measure-pass tail in two
places: `auto-measure-on-use.ts`'s passive `scheduleAutoMeasure` (fires after any due-row settles) and
`today-moves-actions.ts`'s explicit `measureAppliedMovesAction` ("Measure now") - both isolated,
try/catch-wrapped, fire only when `result.settled > 0`, and can never fail the measurement pass they ride
along with.

**Verified:** `npm run typecheck` 0 errors (pre-existing unrelated failures from concurrent in-flight item
31 work in `measure.test.ts` - 4 tests for a `VerdictFloors` calibration harness not owned by this item -
confirmed untouched by this change). 57 new/updated targeted tests green: `winner-memory.test.ts` (24 - the
`extractStructuralFeatures` matrix, mature-won-only harvest pin including insufficient-controls and
early/interim rejection, after-only honesty, idempotency, the 10-per-family cap newest-first, cross-tenant
isolation, the few-shot fragment shape/empty-case/cap-at-2/em-dash guard, registration pins), plus 9 new
prompt-injection pins added to `structured-drafter.test.ts` (byte-identical system prompt when no winners
exist for answer_block AND atomic_edit title/meta, fragment present when winners exist, correct lever
lookup per field, zero I/O when no tenantId given). Full targeted sweep (`llm/`, `proof-gsc/`,
`experiments/`, `demand-graph/prepare-today-moves.test.ts`, `lib/persistence/`): 277+ tests green, no
regressions.

**Ground truth (real Iranopedia, headless probe `scripts/ground-truth-winner-memory.ts` via
`set -a; . ./.env.local; set +a; BEACON_GROUND_TRUTH_TENANT=tenant-iranopedia npx tsx --require
./scripts/mock-server-only.cjs scripts/ground-truth-winner-memory.ts`, with `BEACON_TENANT_ID` overridden
inside the script since `loadShippedChanges()` reads the AMBIENT tenant and `.env.local`'s default is
`tenant-ritz-founder`):** confirmed via direct Supabase query that exactly ONE row across the whole
`shipped_change_proof` table has `verdict = 'won'` today - `/famous-iranian-singers` (shipped 2026-06-21).
Its `windows` array shows only `day: 7` has `ran: true` (the 28-day window doesn't close until
2026-07-19), so `deriveMeasurementMaturity` correctly classifies it `early_checkpoint`, not
`mature_result`. Result: **`harvestWinners` correctly harvests ZERO winners today, and every
`buildWinnerFewShots` fragment (answer/title/meta/title_meta/h1) is honestly `''`** - this is the true
current state of the product, not a bug. The singers win becomes harvestable once its 28-day window
closes (assuming the verdict holds), at which point its real before/after section text and structural
features will start appearing in the answer/title few-shot fragments with no further code changes.

**Honest caveats:** the feature is fully built, tested, and wired into both the passive and explicit
measure-pass hooks, but has never yet had a real example to inject because no shipped change on this
tenant has reached 28-day maturity as a clean win. `leadsWithAnswer` is a heuristic (deferral-opener +
dictionary-opener regex check), not a semantic judgment - it will occasionally misclassify an unusual
sentence shape. The store caps at 10 examples per (tenant, actionFamily) and injects only the newest 2;
this is a deliberate cost/simplicity tradeoff, not a completeness claim.

## 2026-07-02 - BEACON 500 item 23 (beat-Wikipedia finder, worktree, NOT committed)

**What changed:** new `src/domains/wiki-gap/`:
`wikipedia-client.ts` - `fetchArticleFacts(title)` on the FREE Wikipedia action API only
(`action=query&prop=extracts|revisions&explaintext=1&redirects=1` for real full-article word
count + last revision, `action=parse&prop=sections&redirects=1` for section count), identified
`BeaconBot` User-Agent, ~1 req/sec module-level throttle, 30-day json-store cache mirrored to
Supabase. `find-wiki-citations.ts` - mines wikipedia.org sightings tenant-agnostically from
`prompt_answer_observations.citation_urls`, `profound_citation_rows`, and item 20's
`dataforseo_serp_history.ai_overview_domains`, maps each to an article title + best-known query
text, dedupes by article. `beatability.ts` (pure) - scores thinness/staleness/generic-coverage/
demand into `{score, band, evidenceSentence}`. `produce-wiki-gaps.ts` - bounded to 20 lookups per
run, persists to `wiki-gap-results`. New Pages board (`today-newpages-data.ts`) gains up to 3
additive wiki-gap cards; `/competitors` gets a "Check the Wikipedia pages AI prefers" trigger
beside the item-16 keyword-gap button.

**Two real bugs caught and fixed via live ground-truth before shipping** (not caught by unit
tests, since the fixtures were self-consistent):
1. The REST summary endpoint's `extract` field is the LEAD PARAGRAPH ONLY, not the full article -
   a first live run read "Ancient Persia" as 103 words when its real redirect target ("History of
   Iran") has 18,425. Switched to the action API's `explaintext=1&redirects=1` combined
   extracts+revisions call, verified against manual `curl` calls before and after.
2. Profound's `category_id` (used as a fallback "query text" for `profound_citation_rows`
   sightings, which carry no real prompt text) is a raw UUID, not a human label - a first live run
   displayed a UUID as query text. Added a `looksLikeUuid` guard so that field stays honestly null
   instead of showing garbage.

**Tests:** 72 new tests green (wikipedia-client: parsing incl. the extracts/redirects regression
case, throttle, 30-day cache staleness/hit/miss; find-wiki-citations: domain/title extraction,
dedupe, UUID guard, fail-soft per source; beatability: thinness/staleness/generic/demand matrix +
a wide dash-guard matrix; produce-wiki-gaps: bounding, sorting, persist-failure fail-soft, dash
guard; today-newpages feed bounding/non-overlap; the /competitors action gate). `npm run
typecheck`: 0 errors.

**Ground-truthed live on Iranopedia** (`tenant-iranopedia`, real Wikipedia network calls, real
Supabase reads): found 274 wikipedia.org citations (all sourced from imported
`profound_citation_rows` - native poll observations and AI-Overview history are currently empty/
silent for this tenant), checked the bounded 20 in score order. After the word-count fix, only 1
scores genuinely beatable ("Ahmadi (surname)", 133 words, medium band, last touched today); the
rest are correctly recognized as long, well-maintained articles (Anthropic 2,788 words, the real
Ancient-Persia target 18,425 words) - the honest, expected outcome against a real encyclopedia-
grade competitor. Verified against manual `curl` calls to the same Wikipedia endpoints that the
reported word counts and revision dates match exactly.

---

## 2026-07-02 - BEACON 500 item 26 (citability rewriter: mine what AI actually quotes, worktree, NOT committed)

**What changed:** new `src/domains/citability/`:
`pattern-classifier.ts` (pure, no I/O) - regex/token classifier for 6 quotable-pattern buckets
(stat_first, definition, attributed_claim, list_lead, date_anchored, other) plus a shared sentence
splitter and a cited-sentence locator (finds the sentence containing or nearest to any citation
marker in raw answer text). `mine-answer-patterns.ts` (server-only) - bounded-paged miner: reads
`prompt_answer_observations` (tenant-scoped, `citation_count > 0`, projected to citation columns
only) and `answer_texts` (joined by `observation_id`, no tenant_id column on that table so it is
only ever queried by ids that already passed the tenant-scoped read), both in exactly 1000-row
`.range()` chunks per the repo's PostgREST-cap convention; aggregates classified cited sentences
into a `PatternProfile` (bucket counts, shares, dominant patterns), fail-soft to an empty profile on
any read error. `citability-score.ts` (pure) - `scorePageCitability(pageText)` -> 0-100 score
(20 points per bucket present in the opening 6 sentences, half credit if present later in the page),
missing/present pattern lists, and up to 3 one-line topFixes; imports the same classifier the miner
uses so scoring and mining always agree. `citability-hints.ts` (pure) - joins the item-7
crawl-citation-funnel's `crawled_not_cited`/`cited_no_clicks` stalled pages with the rubric over
cached page text into a bounded (max 2/night) "make it quotable" hint carrying the exact topFixes
and the deliverable-4 evidence sentence. `citability-store.ts` (server-only) - Supabase-mirrored
json-store for the mined profile (30-day freshness), following the seasonal-store/spike-store
sibling pattern; registered in `store-classification.ts` (GLOBAL_STORES) + `json-store.ts`
(SUPABASE_MIRRORED_STORES).

**Wiring (additive, composes beside items 14/21/24/25's hint feeds):** `build-today-preview.ts`
reads the item-7 funnel (`loadCrawlCitationFunnel`) + builds page text from the same cached
`page_snapshots` facts every other lever already reads, computes `citabilityHintsByPath`
(bounded 2/night), attaches a `citability` field to the selected pick's `evidenceBrief`, adds an
"AI citability" roundtable voice (profound/"AI citations" teammate), and threads `topFixes` into
`draftAnswerBlockStructured`'s `evidenceHints` for pages that are both an answer-gap AND a
citability target. `daily-evidence-brief.ts` gained `EvidenceCitability` on `DailyEvidenceBrief`.
`daily-experiments-section.tsx` gained a `CitabilityEvidence` component rendering the exact
deliverable-4 line ("AI reads this page but never quotes it. The pages AI does quote lead with
numbers and plain definitions; this one does neither.") inside the "How we know" expander, beside
`KeywordResearch`/`SerpReaction`/`CompetitorSteal`.

**Tests:** 70 new tests across `pattern-classifier.test.ts` (bucket classification fixtures + cited-
sentence location), `mine-answer-patterns.test.ts` (paging discipline pin: exact `.range()` call
sequence at PAGE_SIZE=1000, answer_texts `.in()` chunking, tenant scoping, fail-soft), `citability-
score.test.ts` (score matrix: empty text, all-5-patterns-present near 100, plain narrative low,
half-credit-outside-opening-window, bounded topFixes, determinism), `citability-hints.test.ts`
(funnel-stage gating, demand gate, threshold gate, bounding, ordering, dedup, path normalization,
exact evidence-line string), `citability-surface-pins.test.ts` (wiring pins + dash guard over every
touched file, seasonal-surface-pins.test.ts pattern). All green; `npm run typecheck` 0 errors on
every file this item touches (pre-existing errors in `wiki-gap`/`language-gap` from other agents'
concurrent in-flight work on this shared worktree, not touched here, not fixed here per instruction).

**Ground-truth on real Iranopedia data (`set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-
iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_citability-probe.ts`):**
`prompt_answer_observations` and `answer_texts` are BOTH EMPTY (0 rows) on the current beacon-main
Supabase project (`vlxwevsdvwxvopkjsewo`) - confirmed globally, not a tenant-scoping bug (`pages`
and `daily_metric_snapshots` are also 0; `page_snapshots` correctly shows 217, matching prior
verified state). The 22.8k citation rows referenced in the item live in `profound_citation_rows`
(20,712 rows for tenant-iranopedia), which is an aggregated import table with NO answer-text column
by design (verified against the baseline schema) - so the miner cannot mine phrasing patterns from
it, and correctly returns an honest empty `PatternProfile` rather than fabricating one. This is a
real upstream data gap (the native-poll pipeline that would populate `prompt_answer_observations`
with real answer text has not run for Iranopedia since the beacon-main cutover), not a defect in the
miner. The funnel+rubric JOIN half of the lever, which does not depend on answer text, works fully
end to end on real data: 43 pages are `cited_no_clicks` (AI cites them, GA4/crawler feeds dark);
top 2 by demand both score 0/100 (missing all 5 quotable patterns) and would be tonight's "make it
quotable" hints: `/persian-male-names` (51,999 impressions, 7 citations) and
`/persian-female-first-names` (43,810 impressions, 11 citations).

**Honest caveats:** the miner is real and tested but currently has nothing to mine (recommend re-
running `scripts/_citability-probe.ts` once the native-poll pipeline backfills real answer text for
Iranopedia); `DEFINITION_RE` is a conservative heuristic that can still classify grammatically-
definitional-but-content-free sentences ("X is a wonderful time") as `definition` - acceptable per
the task's "pure regex/token heuristics" instruction but worth tightening if false positives show up
in a real mined profile. The lever's funnel+rubric half does not need a nightly cron step (computed
at request time like the funnel itself, $0); only the mining pass would benefit from a scheduled
re-run once real answer text exists.

---

## 2026-07-02 - BEACON 500 item 21 (permanent GSC seasonal archive + 6-week prep-now moves, worktree, NOT committed)

**What changed:** new `migrations/2026-07-02_gsc_monthly_archive.sql` (table `gsc_monthly_archive`:
tenant_id/query/month PK, impressions/clicks/top_page; RLS deny-anon + is_tenant_member like every
sibling table) - APPLIED to Supabase project `vlxwevsdvwxvopkjsewo` and verified (columns, RLS
policies, live row counts checked via SQL). New `src/domains/seasonal/`:
`archive-rollup.ts` (bounded, monthly-chunked, PAGED reads of `gsc_daily_rows` -> idempotent upsert
into the archive; backfills all history on first run, then only re-rolls the current+prior month),
`load-monthly-archive.ts` (paged reader for the detector), `seasonality.ts` (pure detector: finds
queries whose 1-2 adjacent calendar months hold >= 60 percent of annual impressions with a >= 200
floor, ALL derived from data, never a hardcoded holiday/month; confidence `one_season` vs `repeated`
requires 2+ distinct years), `seasonal-hints.ts` (prep-now hints when the 6-week-out deadline falls
within 21 days, capped 2/night) + `seasonal-store.ts` (Supabase-mirrored json-store, registered in
`store-classification.ts` + `json-store.ts`). Wired: PHASE 1d in `cron-sync.ts` beside (not
disturbing) PHASE 1c; the hint feed additively beside the item-14 spike hints in
`build-today-preview.ts` (new "Seasonal window ahead" team-review voice); ONE seasonal row in the
Demand band (`war-room-sections.tsx`, below the spike rows, silent when nothing is due; the
WarRoomQuietLine check extended to include it). One item-14 pin test string updated to match the
now-additively-extended guard clause (behavior unchanged, just no longer the ONLY condition).

**Bug found + fixed during ground-truth (not by code review):** this Supabase project's PostgREST
caps every response at 1000 rows regardless of the requested `.limit()`/`.range()` width. The first
rollup pass used a 5000-row page size and a 20,000-row `.limit()` in the loader; both silently
truncated to 1000 rows per call while the loop's offset still advanced by the full requested size,
so most of every month's rows were skipped without error. Ground-truthing against real Iranopedia
caught it immediately (archive totaled 2,733 impressions vs 295,890 in the raw daily rows). Fixed
both to page in 1000-row chunks (matching the repo's existing `PAGE_SIZE = 1000` convention in
`gsc-page-signals.ts`/`clarity-page-signals.ts`) and re-verified: archive now holds 295,888 of
295,890 real impressions (rounding-scale diff only), and a second run stays byte-idempotent (same
19,061 rows, same total, `isBackfill: false`, only current+prior month re-rolled).

**Verified:** `npm run typecheck` 0 errors. Targeted vitest: 46 tests in `src/domains/seasonal/*`
(detector matrix: single-peak, bimodal-extend, bimodal-no-extend, flat/non-seasonal, floor-gated,
single-year vs repeated-year confidence, ranking, dash guard) + rollup idempotency/backfill/paging
shape (mocked Supabase) + hint bounding (21-day window, cap 2, one-per-page) + row-mapper edge cases
+ surface/wiring pins (Demand band placement, cron PHASE 1d isolation, additive hint wire). Plus the
pre-existing item-14 trend-radar suite (10 tests) still green after the one pin-string update.

**Live ground truth on Iranopedia (`tenant-iranopedia`):** raw `gsc_daily_rows` spans 2026-05-02
through 2026-06-28 (about 2 months; GSC's 16-month retention is far from binding yet). First-run
backfill wrote 19,061 monthly-archive rows across 2 months (295,888 impressions, matching the raw
total). The detector found 20 "seasonal" queries (top: "iran flag" 9,184 impressions in May+June,
"persian girl/boy names", several Iran-flag history pages) - but EVERY one is `confidence:
"one_season"` (0 `repeated`), which is the honest and expected result: with only 2 months of raw
history, any evergreen query with data trivially satisfies "one window holds most of the year," so
this is not yet real Nowruz-class seasonality, just the detector correctly refusing to claim
`repeated` confidence it cannot back up. All 20 findings' `prepByDate` sits about 9 months out
(next May/June), so the prep-now hint feed correctly emits zero hints right now (nothing is inside
the 21-day urgency window) - no false urgency was fabricated. Store round-trip verified (write 20
windows, read back 20). **Honest caveat: this feature cannot yet prove a real seasonal wave for
Iranopedia; it needs a second year of synced GSC history before `confidence: "repeated"` can ever
fire.** The archive itself is permanent and will keep compounding toward that regardless.

---

## 2026-07-02 - BEACON 500 item 18 (winnability arithmetic in every build verdict, worktree, NOT committed)

**What changed:** built on item 16's `runLabsQuery` gauntlet (genericized over the row type, default
unchanged, so every existing caller behaves identically). `dataforseo-labs.ts` additions:
`runBulkKeywordDifficulty(keywords[])` (ONE batched `bulk_keyword_difficulty/live` call, up to 1000
keywords, $0.05 conservative estimate), `runBulkDomainRanks(domains[])` (ONE batched Backlinks
`bulk_ranks/live` call, up to 1000 targets, $0.05), `runBacklinksSummary(urls[])` (ONE batched
Backlinks `bulk_referring_domains/live` call, bounded to 100 URLs, $0.05), plus a `$0`
`readAllCachedKeywordDifficulty()` reader (flattens fresh 30d cache rows into a keyword-to-difficulty
map). New pure `src/domains/serp/winnability.ts`: `computeWinnability({difficulty, domainRanks,
backlinkGap, serpShape})` returns `{score 0-100, band winnable/hard/reject, reasons[], sentence,
readsAvailable}` with documented thresholds (median domain rank >= 70 or difficulty >= 70 = hard;
either >= 85 = flat reject; backlink gap > 50x = reject unless difficulty < 30, in which case it
stays winnable on merit); absent reads degrade confidence honestly (readsAvailable drops, never a
fabricated number) - zero reads returns the honest cautious default (band "hard", one reason: no
data yet). `serp-validation.ts` gained an additive optional `winnability` input: arithmetic can only
ever DOWNGRADE a shape-optimistic build (to wait on "hard", to reject on "reject") and adds the
concrete-number sentence to `reasons`; it NEVER upgrades a shape-based reject (already-rank,
marketplace/UGC stay authoritative - winnability answers "can you win a content SERP", not "is this
even a content SERP"). `prepare-create-page-verdicts.ts` restructured into two passes: pass 1 fetches
every candidate's SERP snapshot (unchanged) and collects the winning-domain union; pass 1.5 runs the
THREE batched reads exactly ONCE for the whole run (difficulty for every candidate label, domain
ranks for every distinct winning domain, backlinks for the top 3 best-ranked winning URLs across the
whole run plus the tenant's strongest owned page as the "your page" backlink proxy); pass 2
re-validates each candidate with the arithmetic layered on top and persists the additive
`PreparedSerpVerdict.winnability {score, band, sentence}` field (existing consumers unaffected, field
is optional). `daily-evidence-brief.ts`'s `EvidenceKeyword`/`CachedDemand` gained an additive
`difficulty` field: the competition line upgrades to the real cached 0-100 score when one exists for
that exact query ($0 read via `readAllCachedKeywordDifficulty`, wired into `build-today-preview.ts`),
unchanged (competition label only) otherwise. Also fixed pre-existing em dashes in
`serp-validation.ts` and `prepare-create-page-verdicts.ts` comments/reasons while touching those
files (hyphens only, per the hard rule).

**What verified:** `npm run typecheck` 0 errors. Targeted vitest, 5 files / 86 tests green:
`dataforseo-labs.test.ts` (32 - parsers honest on malformed input, gauntlet respected via mocks for
all three new endpoints incl. dry-run/cap/error paths, batching asserted via the posted payload,
`readAllCachedKeywordDifficulty` freshness + fail-soft), `winnability.test.ts` (13 - full threshold
matrix, missing-data degradation, score bounds, dash guard), `serp-validation.test.ts` (13, 7 new -
unchanged behavior without `winnability` input, downgrade build-to-wait and build-to-reject, NEVER
upgrades a shape reject, dash guard), `prepare-create-page-verdicts.test.ts` (7, new file - batching
asserted (exactly 1 call each for a 2-candidate run), zero calls on an empty run, dry-run leaves the
verdict unchanged, hard/reject difficulty downgrades the persisted verdict with the number in
`reason`, domain-rank+backlink reads feed the sentence, dash guard), `daily-evidence-brief.test.ts`
(19, 2 new - difficulty upgrade + honest fallback). Dry-run probe against real Iranopedia
(`DATAFORSEO_DRY_RUN=true`, `BEACON_TENANT_ID=tenant-iranopedia`, real demand graph): 30 real
create_page candidates; ran `prepareCreatePageVerdicts` with `maxValidations=10`; all 10 SERP
snapshots served from the 14d cache ($0); exactly ONE dry-run plan each for
`bulk_keyword_difficulty/live`, `backlinks/bulk_ranks/live`, and `backlinks/bulk_referring_domains/live`
(the whole 10-candidate batch, not 10 separate calls), each priced at $0.05, total priced plan for a
live run ~$0.15, well under the documented $0.50/run ceiling; `winnabilityCostUsd: 0` confirmed no
spend in dry-run. Scratch probe script lived only in the session scratchpad, never added to the repo.

**Caveats:** the "your page" side of the backlink gap uses the tenant's highest-GSC-impression owned
page as a proxy (the create-page candidate does not exist yet, so there is no real per-page backlink
count to read) - honestly documented in code, not fabricated, but it is a proxy, not the actual
future page's authority. `runBulkDomainRanks`/`runBacklinksSummary` were built against the documented
DataForSEO Backlinks API request/response shapes (target/rank, target/referring_domains/backlinks)
but not verified against a live paid response (dry-run only, per instructions - never spend live
money this run). Did not touch `dataforseo-serp.ts`, `proof-gsc/**`, `seasonal/**`, or
`run-measurement.ts` (other agents' concurrent work in the same worktree, per instructions); one
pre-existing `runLabsQuery` genericization (`<T = KeywordGapRow>`, default unchanged) was needed so
the three new endpoints could reuse the identical gauntlet without a second money path - purely
additive, existing callers (`runRankedKeywords`, `runDomainIntersection`) unaffected. Not committed;
`git add`/`git commit` intentionally left to the operator per the gate instructions for this task.

---

## 2026-07-02 - BEACON 500 item 19 (live-SERP rank re-checks in the measurement loop)

**What changed:** built on item 17 (append-only `dataforseo_serp_history`, `resolveOwnRank`,
`serp-history.ts` readers, `buildRankMovementSentence`). New `src/domains/proof-gsc/rank-recheck.ts`:
`resolveTargetQuery` (pure, first non-empty `targetQueries` entry), `pickWasRank` (earliest history
point within 3 days of ship), `windowAlreadyRechecked`/`nextRecheckableWindow` (idempotency reusing
the history table itself as the marker, no new column), `runRankRecheck` (cache-busted
`runSerpQuery({ forceFresh: true })` for "now", computed-only result, fail-soft throughout).
`dataforseo-serp.ts` gained one additive `opts.forceFresh` flag on `runSerpQuery` that skips ONLY the
14-day cache read; the configured/dry-run/cap/ledger gauntlet is unchanged (surgical string-anchored
edit, done alongside the item-20 agent's concurrent work in the same file). Wired into
`measureRecord` (`run-measurement.ts`): after the GSC verdict/windows are computed, a new
`rankOutcome` field (computed-only, mirrors `trafficOutcome`/`citationOutcome`, never persisted -
`shipped-change-store.ts`'s `recordToRow` still omits it) is attached fail-soft. Bounded to
`MAX_RANK_RECHECKS_PER_PASS = 8` re-checks per pass via a new `allowRankRecheck` param threaded
through both batch callers (`auto-measure.ts`'s cron pass and `auto-measure-pass.ts`'s passive
on-page-load pass), each tracking its own shared counter so a big backlog never fires more than 8
live reads (~$0.024) per run. Presentation: one new "Google rank: Google moved this page 9 to 4 for
"query" since the change." line on the `/proof` row, silent when there is nothing honest to say
(no query, no re-check has fired, or the page fell out of the tracked results).

**What verified:** `npm run typecheck` 0 errors. Targeted vitest: `rank-recheck.test.ts` (28 tests -
target-query resolution, was/now math incl. a real win/hold/drop, missing-was honesty, idempotency,
bounded-pass constant, dry-run/failure safety, dash guard), `run-measurement.test.ts` (4 tests -
fail-soft integration: a thrown or null rank re-check never changes verdict/confidence/windows;
`allowRankRecheck=false` and "no target query" both correctly skip the call), new
`dataforseo-serp-forcefresh.test.ts` (5 tests - forceFresh bypasses the cache but still honors
dry-run/cap/disabled), plus the pre-existing `proof-jargon-guard.test.ts` (7 tests, unmodified) which
automatically covers the new "Google rank:" line and confirms it is dash-clean and jargon-free. 12
files / 191 tests green in the targeted run (full suite intentionally not run, per the CI-minutes
rule). Dry-run probe against real Iranopedia (`DATAFORSEO_DRY_RUN=true`,
`BEACON_TENANT_ID=tenant-iranopedia`, DataForSEO confirmed configured): 25 real shipped changes, all
25 have a resolvable target query, 5 are due for a 7-day re-check right now
(`/best-persian-restaurants`, `/famous-iranian-singers`, `/farsi-numbers`,
`/iran-animals/asiatic-cheetah`, `/cities`), priced plan 5 x ~$0.003 = ~$0.015 (under the 8/pass
bound). Ran `runRankRecheck` for real on those 5: all 5 correctly return `null` (honest silence,
never a fabricated number) because item 17's history table has zero points captured near their ship
dates yet - self-heals as history accumulates from ordinary live SERP reads. No live money spent
(dry-run held throughout); scratch probe scripts deleted after the run, nothing added to `scripts/`.

**Caveats:** the "was" side depends entirely on item 17 having captured a history row within 3 days
of a change's ship date; changes shipped before item 17 existed (all 25 current Iranopedia rows)
will show the rank-re-check line silent until either the operator lets ordinary traffic populate
history near a future ship, or a future backfill/synthetic seed intentionally back-dates a "was" row
(deliberately NOT done here - fabricating a was-rank was explicitly out of scope). Did not touch
`dataforseo-labs.ts`, `winnability.ts`, `prepare-create-page-verdicts.ts`, `seasonal/**`, or
`trend-radar/**` (other agents' concurrent work in the same worktree; one pre-existing unrelated
typecheck-clean / one pre-existing unrelated test failure in `parseAiOverview`'s truncation length,
noted but not fixed, per instructions).

---

## 2026-07-02 - BEACON 500 items 7, 10-13 (wave boundary at 13 of 610)

**What changed:** item 7 crawl-to-citation-to-revenue funnel (real finding: 43 Iranopedia pages
cited by AI, all stalled at cited-no-clicks; war-room band names the top 3); item 10 pipeline
volume invariants after nightly sync (caught a true live violation: Profound stamping fresh syncs
but 0 citation rows for 3 days; red Ops card on Today); item 11 rollback on negative verdicts
(propose on /proof + bounded auto-revert under the armed autopilot policy; push_snapshots
migration APPLIED to prod so snapshots survive lambda recycles); item 12 LLM final review on the
nightly batch (one budgeted call through the existing structured-drafter egress, flags but never
drops, live run 6/6 looks_right at ~$0.01); item 13 5am Pacific precompute cron (real warm pass
21.8s, receipts persisted, /diagnostics line). vercel.json: precompute cron 12:03 UTC daily.

**Verified:** typecheck 0; 300 targeted tests green across the slice; full suite in a clean shell
plus build at this wave boundary (results in the commit message); prod smoke after push.

---

## 2026-07-02 - BEACON 500 item 6: AI-referral sessions attributed to pages (ga4_ai_referral_daily)

**What changed:** New `ga4_ai_referral_daily` Supabase table (PK tenant/page/day/source_domain,
deny-anon RLS, migration `migrations/2026-07-01_ga4_ai_referral_daily.sql`, applied via MCP and
verified with a select). New GA4 Data API report `runGa4AiReferralReport` in
src/lib/connectors/ga4/data-api.ts: [date, pagePath, sessionSource] dimensions, request-side
CONTAINS filter over AI assistant sources, same 401-refresh-once + bounded-pagination posture as
the traffic report, fully SEPARATE so a failure never touches ga4_url_traffic. Canonical source
classification in src/lib/connectors/ga4/ai-sources.ts (chatgpt.com absorbs chat.openai.com and
openai.com; bard absorbs into gemini; you.com and meta.ai exact-only so thankyou.com stays out).
Nightly isolated cron step `pullGa4AiReferralsForTenant` (dormant until GA4 key, idempotent
4-column upsert). Loader src/domains/ai-visibility/ai-referrals.ts (react cache, fail-soft on
missing table) with totals, per-assistant split, top pages, day series. ONE line in the Today AI
band: "AI assistants sent you N visitors these 30 days, most from X, most to /page." Silent at zero.

**Verified:** typecheck 0 errors; 46 new targeted tests green (ai-sources 12, sync-ai-referrals 9,
ai-referral-report 10, loader 15) plus all 169 GA4 connector tests and cron-sync tests still pass.
Live probe `scripts/_ai-referrals-live.ts` ran against real Iranopedia GA4: local
GOOGLE_CLIENT_SECRET is stale (Google returns invalid_client on refresh; prod refreshed GSC the
same morning, so hosted credentials work), so the sync returned token_expired and the table sits
at an honest 0 rows; the Today line correctly stays silent. First real rows land on the first
hosted nightly cron after this deploys.

**What changed:** New `revenue_facts` Supabase table (PK tenant/page/day/source, deny-anon RLS,
migration `migrations/2026-07-01_revenue_facts.sql`, applied via MCP as `revenue_facts`). Operator
unit-economics card on /settings/config (`revenueModel` on BusinessConfig: rpm or dollars per lead).
Nightly pass `runRevenueFactsPass` in cron-sync (isolated try/catch): operator rate x real GA4
traffic -> rows with basis "your rate x real traffic"; ad-network slot
(src/lib/connectors/adnetwork, AdSense/Mediavine/Raptive stubs) fails closed until credentials
exist. Readers in src/domains/revenue/load-revenue.ts (react cache). Today scoreboard gains ONE
money sentence that names its basis and self-hides with no data.

**Verified:** migration applied + rolled-back upsert round trip on prod (RLS on, 2 policies);
`npm run typecheck` clean for these files (the single repo error is another agent's in-flight
src/domains/autopilot file); targeted vitest 90/90 (producer math, idempotent shape, loader
mapping, honest labels, dash guard) + 69/69 adjacent (business-config, cron-sync); live
ground-truth on Iranopedia: pass wrote 3,260 rows from real GA4 traffic, re-run left exactly
3,260 (idempotent), Today rendered "Real traffic was worth about $28.26 over the last 7 tracked
days. That is your rate x real traffic, not a measured payout." Test rate + rows then fully
reverted (config off, rows deleted) so no invented dollars remain live.

---

## 2026-07-01 - THE BEACON 500 master backlog assembled and shipped

**What changed:** New docs/BEACON_500_MASTER_PLAN.md (610 ranked items) from a 26-agent discovery
workflow (20 repo-grounded specialist finders, 5 adversarial synthesizers, 1 completeness critic;
2.38M subagent tokens, 495 tool uses) merged with the 37 unfinished Final Premium Plan items as
[CARRY-OVER n] entries. Ranking: impact descending, then medium/small/large effort within each band.
docs/FINAL_PREMIUM_PLAN_PROGRESS.md header marked superseded-for-sequencing.

**Verified:** extraction filtered to the 6 final-stage agents only (finder duplicates excluded, checked
by transcript-role grep); assembly dedup + dash-assert passed (zero em/en dashes in the 610-item doc);
impact histogram sane (4 at 9, 66 at 8, 147 at 7); carry-over count 37 confirmed in the doc. Docs-only
change: no typecheck/test run needed.

---

## 2026-07-02 - FINAL PREMIUM PLAN Wave 2 COMPLETE (items 55-57,59,68-72,6,93 + earlier checkpoint)

- Worklist command center: goal-grouped default, 30-minute mode, lever chips + row sparklines, wide search (888b49e6)
- Results three bands + countdown chips + zero-jargon guard w/ empty whitelist (8a842716); live-verified In flight + 50 chips
- Today SWR surface: warm 1.79s measured; surfaces mirrored to json_store_blobs (447fe5b3)
- Wave gate: 943+ files, 15,744 passed / 0 failed (clean shell); build compiled; prod smoke login 200 / root 307

## 2026-07-01 (later) - FINAL PREMIUM PLAN Wave 2 checkpoint (items 4,5,27,28,29,31,33,34,35,58,60,61)

- Charts: src/components/data/sparkline.tsx (+5 tests incl. GSC-lag honesty), MoveCard/daily-card sparklines, /proof before/after lines via proof-gsc/daily-series.ts (16 rows live-verified, 58-day series)
- Team voices: proof-history redirection (+6 tests), keyword-research voice, live-SERP voice through enrichPickSerpPatterns (same cap/cache/ledger gauntlet; live-verified wikipedia/reddit/etsy reads on real picks)
- Expectations: pick-expectations.ts (+4 tests) -> forecast range, exit plan, effort on daily cards; expectedOutcome on ready worklist rows (live-verified)
- Copy: Treatment: -> Change went live:; bulk paste checklist button; em/en dashes stripped from all touched files
- Gates: typecheck green throughout; full suite (clean shell) 943 files / 15,736 passed / 0 failed; npm run build compiled; deploy smoke login 200 / root 307
- Commits: c23643be, 5e7d237b, b15ee200, 1abbf8c3, 4840e354 (all pushed to main, Vercel auto-deployed)

## 2026-07-01 — Phase 1d (competitor "steal this" on the /worklist MoveCard) + card dash-clean

**What changed (commit `05298d8a`):** brought the daily card's reasoning to the demand-graph MoveCard on /worklist. A read-only map first confirmed the MoveCard ALREADY surfaces keyword volume + SERP winners (via the Research Pack), so the only missing layer was the actionable competitor **"steal this"** breakdown (it showed raw "what wins" text, not what STRUCTURE to take).
- `today-moves-data.ts`: new `TodayMove.competitorSteal`, computed via the pure `whatToSteal()` builder (reused from `daily-evidence-brief`) from the on-topic competitor's page facts, gated by the same relevance/whoCited checks.
- `today-moves-card.tsx`: renders a "Steal this: ..." line under "What wins"; wraps the SERP `elementImplication` + `whatWins` + steal strings in `stripBannedDashes` (handles cached em-dash data); replaced the literal em-dash SERP separator with a colon; **stripped ALL ~17 pre-existing literal em/en dashes** from this primary /worklist surface (the file was not covered by the display-dash guard).
- Reuse-not-duplicate: no new builders; the MoveCard's existing keyword + SERP rendering was left as-is.

**Verified live on Iranopedia (`buildTodayMovesData`, real data):** 12 moves, **5 show "steal this"** (persian boy names -> steal parentcalc's answer+FAQ(4)+tool; cities -> FAQ(8)+tool; achaemenid -> FAQ(2)+tool+schema), 3 show a SERP reaction. tsc 0 · dash-guard + evidence-brief tests green (65). No proof/reservation/Wix/GSC writes.

---

## 2026-07-01 — Phase 2 slice E-2 (live SERP reaction + competitor teardown on the daily card)

**What changed (commit `247ef279`, branch `claude/daily-experiments-native`):** the daily card's "How we know" expander now shows the full battlefield alongside the keyword research: (1) **What wins on Google now** - the winning page shape (list/guide/faq/table/product) + the top domains Google rewards + the exact on-page move that shape implies; (2) **Who is beating you** - the top competitor page's domain + a "steal this" line (highest-leverage stealable elements: direct answer, FAQ, tool, schema, depth).
- `daily-evidence-brief.ts`: extended `DailyEvidenceBrief` with optional `serp` + `competitor`; new PURE builders `buildSerpEvidence`, `whatToSteal`, `buildCompetitorEvidence` (dependency-free, tenant-agnostic) + 8 new unit tests.
- `build-today-preview.ts`: $0 cached reads of `readCachedSerpPatterns` (per-tenant) + `loadChangePacksForTenant` (owned->competitor teardown), relevance-gated (drops loosely-matched / <0.3 relevance so no off-topic rival, per the evidence-relevance discipline). Combines keyword + serp + competitor into one brief; each section omitted when absent (graceful degrade).
- `daily-experiments-section.tsx`: guarded `SerpReaction` + `CompetitorSteal` blocks in the expander; all dynamic strings run through `stripBannedDashes`. Also fixed an em dash I introduced in E-1's rendered keyword row (`- N/mo` -> `: N/mo`) + the file header + my E-1/E-2 comments.

**DataForSEO live populate (operator-authorized $50/mo cap):** ran ONE populate under the **Iranopedia tenant** (`research-serp-patterns` + `competitor-page-audit` are TENANT_SCOPED, unlike the GLOBAL keyword cache) -> 6 fresh SERP patterns (**$0.0930**) + 11 competitor audits (**$0** own-crawl), both to the tenant-scoped stores so prod reads them. Verified end-to-end on real data: **9/12 top pages show a SERP reaction, 4/12 a competitor teardown** (e.g. "persian boy names" -> ugc pages led by web.mit.edu/reddit -> "win with a first-person angle"; steal parentcalc's answer+FAQ+tool; world-cup jersey correctly flagged a product SERP).

**Verified:** typecheck 0 · 14 evidence-brief tests (8 new) + 51 dash-guard tests green · live end-to-end populate+verify on Iranopedia. No proof rows or measuring experiments mutated. **Remaining:** Phase 1d (/worklist MoveCard brief), Phase 3 friction fixes, app-wide dash sweep (spawned task).

---

## 2026-07-01 — Phase 2 slice E-1 (keyword-research evidence on the daily card) + DataForSEO flipped LIVE

**What changed (commit `2b3c675d`, branch `claude/daily-experiments-native`):** the daily move card's "How we know" expander now shows the KEYWORD RESEARCH behind the move — the page's top searches with real DataForSEO monthly volume + paid-**competition** level (labeled "competition", never "difficulty"/"KD", because DataForSEO exposes competition, not a difficulty score).
- New pure `src/domains/experiments/daily-evidence-brief.ts` (`buildKeywordBrief`): builds up to 6 keyword rows (term / volume / competition) from a page's queries + a cached-demand map; returns null when NO query has cached demand (card degrades to exactly what it showed before); `addressableVolume` sums only known volumes.
- Carried `evidenceBrief?` through `BuiltCandidate` → `PlannedExperimentRecord` → `build-daily-plan-record` (type-only import, no runtime cycle).
- `build-today-preview.ts` reads `readAllCachedKeywordDemand()` ($0 cache read, no spend), indexes by lowercased term, and attaches a brief per selected move from the page's top-8 GSC queries.
- `daily-experiments-section.tsx`: guarded `KeywordResearch` block rendered inside the existing "How we know" details. No em dashes.

**DataForSEO flipped LIVE (operator funded + authorized "go live within the $50/mo cap"):** `.env.local` already had `DATAFORSEO_DRY_RUN=false`, cap `$50` fail-closed. Ran ONE capped keyword-volume call over Iranopedia's 180 highest-impression real GSC queries → **status=ok, cost $0.0750, 167/180 terms with real volume** (tehran 246k/mo, iran flag 135k/mo low; world-cup product page HIGH competition). The keyword cache is a global json-store persisted to Supabase (40 → 214 terms), so the deployed app reads the same real demand. (Ledger attributed the $0.075 to `tenant-ritz-founder` — a cosmetic artifact of the headless run having no request tenant context; it is the operator's own single account either way.)

**Verified:** `npm run typecheck` 0 · `daily-evidence-brief.test.ts` 6 new + `build-daily-candidates` + `daily-llm-enrich` = 24 green · end-to-end on real Iranopedia data (readAllCachedKeywordDemand → buildKeywordBrief over real top queries) = **12/12 top pages produce a correct brief**. The JSX render is a guarded conditional inside the already-shipped `<details>` expander (typecheck + data-path verified); no live Iranopedia browser screenshot this turn (dev default tenant is Ritz, which has no cached demand, so a screenshot needs a manual `BEACON_TENANT_ID=tenant-iranopedia` spin-up + an LLM plan generation). No proof rows or measuring experiments mutated. **Remaining E:** live top-10 SERP reaction + competitor teardown ("what to steal") in the same brief (E-2). Then Phase 1d (/worklist brief), Phase 3 (friction fixes), app-wide dash sweep.

---

## 2026-07-01 — Phase 2 slices D-2 (writes missing answers) + D-3 (inline edit, approve-before-live) + honesty verification

**Full honesty gate (operator asked to double-check everything):** clean-shell `npm run typecheck` 0 + `npm run test` = **936 files, 15,666 passed / 71 skipped / 0 failed**. Git truth: all Assistant-First commits are on branch `claude/daily-experiments-native`, pushed, NONE merged to main (nothing on prod yet). Live data unchanged: 25 proof rows, the 6 edits still MEASURING, 25 controls active (zero production writes this session). Browsed `/worklist` on the `beacon-iranopedia` dev server: the friendly card renders correctly on real data. Fixed 3 browse findings (card paste normalized to hyphens, empty "Why it wins" guarded, page-intro em dashes) + the SERP-verdict em dashes; flagged ~511 files of app-wide visible dashes as a separate tracked sweep (not overclaimed as done).

**Slice D-2 (commit `41d58dfe`):** the daily batch WRITES a missing answer. `safe-answer-block.ts` gained `proposeAnswerGap` (entity + demand, no extractive answer, not already leading) + `buildWrittenAnswerProposal` (an `add_new_text` op). `build-today-preview.ts` LLM-writes for the top gap pages (cap 6), grounded in the page body + intent; the numeric-fidelity firewall blocks a fabricated date, so a page truly lacking the date yields no write (honest gap). `build-daily-candidates.ts` emits the add-a-written-answer candidate (`draftSource=llm`). Verification is UNCHANGED (the existing "answer near the top" check confirms an added line like a moved one).

**Slice D-3 (commit `f84a7fba`):** inline-editable proposed text. The card's "Paste this" is a textarea (text levers); `markDailyExperimentAppliedAction` accepts `editedText` and verifies + records the EDITED text via a shallow proposedText override (link levers key on anchor/dest, so excluded). The frozen plan proposal is unchanged; nothing publishes until the operator applies + Beacon confirms live.

**Verified:** tsc 0 · experiments + llm + copy + dash-guard suites green (222 in the D-3 run; 195 in the D-2 run; 6 new D-2 tests + reuse). OpenAI only, capped, off unless BEACON_LLM_PROVIDER=openai, fail-soft. No DataForSEO (funded by operator 2026-07-01; slice E now unblocked). No proof rows mutated. **Remaining:** E (keyword universe + live top-10 teardown), Phase 1d (/worklist brief), Phase 3 (friction fixes), app-wide dash sweep (spawned task).

---

## 2026-07-01 — Phase 2 slices C + D-1 (intent-aware LLM writer) + PROOF counts impressions

**Slice C (commit `d2e7b762`):** the LLM drafter is now intent-aware. New pure `intentDirective(intent)` in `structured-drafter.ts` + optional `intent` on the answer-block and title/description drafters, injected into the prompt so the model writes the right answer TYPE (a date for "when", a price for "cost", not a definition). Wired into `prepare-today-moves.ts` (classifies intent from topic + fan-outs). Back-compat: no intent = no directive.

**Slice D-1 (commit `21b26653`):** the LLM now writes sharper descriptions/titles in the DAILY batch at plan time, so cards arrive already written. New injectable `daily-llm-enrich.ts` (unit-tested) runs over selected candidates; the draft replaces the deterministic `proposedText` flagged `draftSource="llm"` and the card shows "Beacon wrote this, edit before you use it" (`WrittenByBeacon`). Falls back to deterministic on LLM off / over-budget / error / empty / no-change. Wired in `build-today-preview.ts` (captures impression-weighted intent per page, drafter backed by the budgeted structured-drafter). OpenAI only, capped; no DataForSEO. `draftSource`/`llmRationale` carried BuiltCandidate → PlannedExperimentRecord → card.

**PROOF now counts impressions as a result (operator ask):** `measure.ts` gained an impressions diff-in-diff (`treatedImpressionsDelta`/`controlImpressionsDelta`/`adjustedImpressionsLift`, pro-rated like clicks). `summarizeVerdict` returns `impressionsLift` + `wonOnImpressions`, and UPGRADES an otherwise-"inconclusive" verdict to "won" when impressions rose meaningfully vs controls AND the treated page genuinely gained impressions (conservative floor = max(50, 20% of window-scaled baseline)). A real click/CTR/rank LOSS stays lost (visibility does not redeem a regression). `proofOutcomeSentence` now credits visibility ("the page is showing for more searches, +N impressions"). Flows to the stored verdict, the /proof sentence, and the learning prior automatically.

**Verified:** `typecheck` 0 · proof-gsc suite 40 (6 new) + full proof dir 84 · experiments+llm+copy 194 · structured-drafter 18 · no em dashes. All test LLM calls use injected completions (zero real spend). No proof rows or measuring experiments mutated. **Remaining:** D-2 (answer-block WRITING = add-operation + verifier change), D-3 (inline edit), E (keyword universe + live teardown, DataForSEO held for operator funding), Phase 1d (/worklist card), Phase 3 (friction fixes).

---

## 2026-07-01 — Assistant-First Phase 0 (audit + vision) + Phase 1a-1c (friendly reasoned /today card)

**Phase 0 (Assistant-First mission):** confirmed live state (prod 200; the 6 Iranopedia edits all MEASURING with baseline + 7/14/28 windows + 25 controls; umayyad/pahlavi GSC-submitted). Ran a 14-agent adversarially-verified code audit of the recommendation flow (answer-intent mismatch, lab-console wording, reasoning-brief gap, verifier false-negatives, wrong-field, GSC quota, is-LLM-wired-into-daily) + a 5-angle/10-source cited research pass on the verifier visual-vs-DOM problem. Key findings: the DAILY card is a thin deterministic lab-console while the maximum-reasoning lives on the separate /worklist Prepare flow; the structured-LLM layer is already built (do not rebuild). Verifier research conclusion (cited): Google/AI render the page, so Wix hero placement is fine for SEO/AEO and only our Cheerio verifier is wrong; most efficient fix is a $0 inline-CSS-order + near-H1 heuristic (Browserless only as documented escalation). Operator approved all sections A-F, brief on both surfaces, GSC manual+friendly-queue, build order card -> engine -> friction.

**Phase 1a-1c (committed `101e17ee`, branch `claude/daily-experiments-native`):**
- `daily-plan-types.ts` + `build-daily-plan-record.ts`: carry `whyNow` through `PlannedExperimentRecord` (it was computed in `build-daily-candidates.ts` then dropped, so the card never got the reason). Updated 3 test fixtures for the new required field.
- `build-daily-candidates.ts`: de-jargoned the `whyNow` copy, removed em dashes.
- `daily-experiments-section.tsx`: rewrote the card to lead with "The move / Why it wins / Paste this / How we track it" + a "How we know" expander holding the search/current-state/comparison-pages/measurement detail. Friendly assistant voice, lab jargon and em dashes gone. All server actions + the plan->approve->apply->confirm->tell-Google state machine unchanged.
- `daily-experiments-copy.ts` (new pure module) + `daily-experiments-copy.test.ts` (new): friendly language layer, unit-tested so it can never drift back to jargon.

**Verified:** `npm run typecheck` 0; `npx vitest run src/domains/experiments src/domains/changes/build-canonical-changes.test.ts` = 176 passed; new copy test 5 passed; `no-banned-dash-display-surfaces` 51 passed; zero em/en dashes in the rewritten files. No proof rows or measuring experiments touched. Live browser render of the heavy cockpit deferred to Vercel prod (known local dev fragility). **Remaining Phase 1:** the same brief on the /worklist MoveCard (1d). Then Phase 2 (engine C+D+E), Phase 3 (friction F).

---

## 2026-07-01 — Recommendation-Quality Adversarial Harness (Finalization Program, Move 4)

**What changed — a deterministic quality gate + adversarial audit around existing recommendations (not a new engine).**

- **New PURE** `src/domains/recommendations/recommendation-quality.ts`: `reviewRecommendation` → decision (approved / approved_with_caution / needs_revision / rejected / needs_evidence) + hardFailures/cautions + stable reason codes → friendly copy (`passesDailyGate`, `qualityLabel`). Composes relevance-gate (intent fit), draft-quality (copy), safe-answer-block (factual firewall); adds year-intent, sibling-ownership, lever-eligibility, link-alignment, origin-definitiveness.
- **Gate wired** `build-today-preview.ts`: candidates run the review before `planDailyExperiments`; rejected/needs_evidence dropped (`quality_rejected` in `excludedByReason`).
- **UI** `daily-experiments-data.ts` `qualitySummary` + `daily-experiments-section.tsx` compact "✓ All N passed today's quality checks (+ caution)" line.
- **False-positive fix**: the copy gate now checks the page's OWN label tokens (not only draft-quality's fixed vocabulary), so a meta naming "Umayyad Caliphate" isn't falsely read as "dropped the entity" (tenant-agnostic).

**Tested:**
- `npx tsc --noEmit` → **0 errors**; `npm run build` → **Compiled successfully**.
- `npx vitest run src/domains/recommendations/ src/domains/experiments/ src/domains/changes/` → **178/178 pass** (18 new adversarial corpus: Doodool→jewelry reject, self-link, anchor mismatch, sibling ownership, proof-blocked, protected control, active conflict, Clean-insufficient-controls, year-intent, generic template, origin caution, valid approvals, determinism, no-raw-codes).
- **LIVE-DATA QA audit** (tsx against real prod Supabase, latest preview `1d4fa003`): 6 selected + 2 backups → **7 approved · 1 approved_with_caution** (Chaharshanbe origin), **0 rejected** → preview unchanged, unaccepted. Web fact-check confirmed the Chaharshanbe Zoroastrian-origin claim is scholarly-disputed (Encyclopaedia Iranica / Wikipedia). Umayyad white banner, Abbasid Black Standard, Pahlavi tricolor+Lion-Sun, Finglish=Latin-script — well-established, approved.
- **Data integrity (before == after):** proof rows **19** · reservations **0** · plan **preview** (`1d4fa003`). No proof/reservation/plan/Wix/GSC writes; no migration; no paid API.
- **Verification honesty:** the dev-server visual smoke was blocked this run by a Node/undici `transformAlgorithm` streaming error + GSC-401 churn destabilizing the render; the gate is proven by the live-data QA audit + tsc/build/tests rather than a screenshot.

---

## 2026-07-01 — Failure / Empty / Loading / Mobile / A11y Hardening (Finalization Program, Move 3)

**What changed — a bounded resilience + usability pass; no new architecture.**

- **New PURE** `src/domains/diagnostics/operator-failure.ts`: `toOperatorFailure`/`failureForReason`/`isKnownReason` — one small taxonomy (9 kinds) mapping internal reason codes/thrown errors → friendly copy, raw code preserved only in `technicalCode` for logging.
- **Partial failure**: `changes-data.ts` per-loader `.catch()` on the plan-store reads (a plan/reservation outage no longer blanks the whole Changes list).
- **Raw codes removed**: `error.tsx` (no raw `error.message`; friendly + digest + console log); `daily-experiments-section.tsx` routes every `r.reason` (apply/submit/skip/finish/plan/accept/abandon) through the translator (removed `APPLY_FAILURE_COPY`/`ACCEPT_FAILURE_COPY`).
- **Loading**: `worklist/loading.tsx` + `proof/loading.tsx` route skeletons sized to the layout.
- **Empty states**: Changes distinguishes filtered vs clean-tests-eligibility ("Switch to Balanced") vs no-mature-results vs genuinely-empty, each with a next action + `role="status"`.
- **Mobile**: Changes control cluster responsive (strategy wraps, tabs scroll, search full-width); Results tiles 2×2.
- **A11y**: strategy/status = `role=group` + `aria-pressed` + focus rings; rows `aria-expanded`/`aria-controls`; state by text + border not color alone; daily `aria-busy`/`aria-live`; nested `<a><button>` removed; StatusBadge `aria-label`.
- **Crash guards**: `m.ga4?.sessions`, `m.friction?.deadPct/ragePct`, `TONE/CONF/EVIDENCE` fallbacks, `metricsLine` NaN guards, `key={i}` → stable keys (today-moves-card ×6 + proof ×1), dropped a non-null `!`.

**Tested:**
- `npx tsc --noEmit` → **0 errors**; `npm run build` → **Compiled successfully**.
- `npx vitest run src/domains/changes/ src/domains/proof-gsc/ src/domains/learning/ src/domains/diagnostics/` → **125/125 pass** (15 new: error translation, raw-code suppression — PGRST/RPC/Error.message never reach the user-facing string, thrown-error handling, isKnownReason).
- **Live render (dev server, real Iranopedia, operator mode):** /worklist desktop renders clean (**0 console errors**); strategy `role=group` + **7 `aria-pressed`** (3 strategy + 4 tabs) + **7 `aria-expanded`** present. /worklist @ 375px → **0 horizontal overflow** (scrollW = clientW = 375; strategy 250px, tabs 309px scrollable, search 351px full-width all fit). /proof @ 375px → **0 horizontal overflow**; the maturity tiles render a clean 2×2 grid + the GSC-lag banner wraps (screenshot). Today MoveCard wraps cleanly at 375px.
- **Data integrity (prod Supabase, before == after):** proof rows **19** · active reservations **0** · plan **preview**. No proof/reservation/plan/Wix/GSC writes; no migration.

---

## 2026-07-01 — Measurement Truth + Maturity (Finalization Program, Move 2)

**What changed — one shared maturity model; an early read can never read as a final verdict.**

- **New PURE core** `src/domains/proof-gsc/measurement-maturity.ts`: `deriveMeasurementMaturity` (8 states; maturity is from the CLOSED window, not the stored verdict), `buildMeasurementPresentation` (maturity / direction / verdict-only-at-mature / maturity-capped confidence / honest headline+explanation / nextCheckpoint / evidenceStrength / attributionQuality / learningEligibility / tone), `detectMeasurementOverlaps` (same-page-within-28d → attribution_limited from ship timestamps; no new table), `isMatureOutcome`/`isInFlight`.
- **Learning gate** `src/domains/learning/load-experiment-outcomes.ts`: a non-mature verdict is neutralized to "measuring" before it reaches `computeDimPriors`/`proof-outcome-caution`, so 7/14-day signals never permanently train ranking or block a lever; only 28-day mature + clean attribution trains. Pure prior modules unchanged.
- **Today/Changes** `today-moves-data.ts` (+ `TodayMove.proofMaturity/proofDirection`), `build-canonical-changes.ts` + `canonical-change.ts` (+ `measurementHeadline/measurementDetail/nextCheckpoint/attributionLimited`), `changes-data.ts`, `changes-list-client.tsx`: a proof shows as a "Result" only when mature; otherwise "Measuring" with the honest headline + next checkpoint + overlap flag; evidence strength follows maturity.
- **Results** `proof/proof-summary-section.tsx` (maturity-stratified counts), `proof/page.tsx` (per-row color by maturity tone, sentence drops premature "Likely hurting (high confidence)", settled/exclude gates by maturity).

**Tested:**
- `npx tsc --noEmit` → **0 errors**; `npm run build` → **Compiled successfully**.
- `npx vitest run src/domains/proof-gsc/ src/domains/changes/ src/domains/learning/` → **116/116 pass** (40 new: maturity boundaries 7/14/28; the live `/cities` 7-day case → early_checkpoint/no-verdict/low-confidence/not-learning-eligible; blocked_data/collecting language; attribution overlap; mature helped/did-not-help/no-lift; adapter threading early≠result; overlap detector).
- **Live render (dev server, real Iranopedia, operator mode):** `/proof` → "Proof at a glance" = **19 Measuring · 0 Helped · 0 No clear lift · 0 Did not help · No mature results yet** (was Winning 0 / Measuring 17 / No clear lift 2); `/cities` + `/funny-farsi-phrases` rows = **"Early negative signal"** (not "Did not help / high confidence"); GSC-lag banner = "2 changes are waiting on Search Console data, not stalled." `/` MoveCard top move = "Page measuring · same edit still measuring". **0 console errors** (only fail-soft GSC token-refresh warnings in this dev env).
- **Data integrity (prod Supabase, before == after):** proof rows **19** · active reservations **0** · plan **preview** · the two `verdict=lost, confidence=high` rows **still lost/high in the DB** (history preserved — the presentation reinterprets them, the row is never rewritten) · 17 measuring. No proof/reservation/plan/Wix/GSC writes.

---

## 2026-07-01 — Canonical Changes List (Finalization Program, Move 1)

**What changed — one object, one lifecycle, one list.** Replaced the fragmented worklist/experiments/drafts/results mental model with a single `CanonicalChange` rendered as one compact list on `/worklist`.

- **Domain core (PURE, no migration):** `src/domains/changes/canonical-change.ts` — `CanonicalChange` type (`id = tenant::pagePath::changeFamily`), `deriveStatus` (most-settled-wins resolver: skipped → settled/active proof → execution stage → page-measuring-blocked → selected/prepared-ready → suggested; **preview/accept ≠ measuring**), `changeTypeFamily`, `statusView`, evidence strength (`strong`/`directional`/`tracking`). `strategy.ts` — `rankChanges` (Balanced = upside + evidence + ready − effort − risk; Growth = pure upside; Clean = strong-comparison only, filters new/blocked/high-risk; blocked always last), `goalMatches`, `statusCounts`. `build-canonical-changes.ts` — the adapter: plan items seeded first (own their page+lever), worklist moves collapse onto the same id by most-advanced `STATUS_RANK`, reserved controls → `blocked`+`protected`.
- **App layer:** `src/app/(shell)/changes-data.ts` (`loadChangesView` — read-only fan-in of `loadMovesWorklist` + accepted/preview plan + active reservations → `buildCanonicalChanges`; returns a `sourceId→TodayMove` map for expand). `changes-list-client.tsx` (strategy control + 4 status tabs with live counts + goal `<select>` + search + compact rows; expand reuses the existing `MoveCard` — no action rewrite). `worklist/page.tsx` now renders the Changes list; PageHeader → "Changes"; Daily panel kept above as the today slice.

**Tested:**
- `npx tsc --noEmit` → **0 errors**.
- `npx vitest run src/domains/changes/` → **16/16 pass** (changeTypeFamily families; deriveStatus precedence incl. preview≠measuring, accept≠measuring, verify≠measuring, active=measuring, mature=result, page-measuring=blocked; dedup: plan page not duplicated, different levers separate, reserved control blocked+protected, same-lever collapse to most-advanced; strategy clean/growth filtering + blocked-last; goal filters; statusCounts).
- `npm run build` → **Compiled successfully**.
- **Live render (dev server `beacon-iranopedia`, real Iranopedia, operator mode):** `/worklist` shows header "Changes", strategy control [Balanced·Growth first·Clean tests], status tabs **To do 68 · Ready 6 · Measuring 5 · Results 2**, goal filter + search; today's 6 changes appear ONCE in Ready as "Today · Apply in Wix · Strong comparison · [Apply]" — no duplication, no research dump. **0 console errors.**
- **Data integrity (prod Supabase, post-change):** `shipped_change_proof` = **19** · active `control_reservations` = **0** · latest `daily_experiment_plans` status = **preview** (unaccepted). No writes to proof/reservations/plans/Wix/GSC — additive read-model + UI only.

---

## 2026-07-01 — Consolidation + recommendation-quality sprint

**Recommendation fixes (the levers now respect query/topic intent):**
- `safe-internal-link.ts`: added an intent-fit gate (`destinationIsRelevant`) — a cross-family link must share a distinctive token with the page's target query/label; same-family links allowed; no source context → no-op (backward-compatible). Fixes the Doodool t-shirt → "Persian jewelry" off-topic link. `proposeSafeInternalLink` now takes `sourceQuery`/`sourceLabel`; wired from `build-daily-candidates`.
- `safe-answer-block.ts`: rejects `WEAK_ANSWER_LEAD` ("is home to / located near / famous for …") and collects candidates then prefers a `DEFINITIONAL` sentence. Fixes Shiraz's "is home to Persepolis" geography error (Persepolis is near, not in, Shiraz) — now picks a definition or emits nothing.
- `build-daily-candidates.ts`: year-intent fallback — when the GSC query carries a year the extractive (evergreen) answer can't contain, the displayed/measured query drops the year (Chaharshanbe "chaharshanbe suri 2026" → "chaharshanbe suri"). The answer itself was already a correct definition.
- Reviewed the 4 flag metas + Finglish — factual, query-relevant, distinct, good length → kept.
- **Live ground-truth (read-only, real Iranopedia):** the batch is now **6 clean items** (4 meta + 2 answer) instead of 8 — Doodool + Shiraz correctly dropped; Chaharshanbe retargeted; Finglish + 4 flags kept.

**Expiry dead-end:** `DEFAULT_EXPIRY_MIN` 30 → 1440 (`build-daily-plan-record.ts`); `acceptDailyExperimentPlanAction` auto-refreshes a pure-expiry failure (re-plan + persist + `plan_refreshed` typed result) instead of returning raw `plan_expired`; friendly copy + `router.refresh()` in `daily-experiments-section.tsx`.

**Dedup:** `action-pack/load.ts` reads (fail-soft) the daily plan + active reservations and drops existing-page packs whose page is already in today's plan or reserved as a control — one page no longer shows conflicting advice in two places. Single chokepoint; create packs never blocked.

**Nav:** sidebar → Today · Changes (was Worklist) · Results · Research (AI questions + Competitors) · Settings. Drafts (/recommendations) + Ready-to-ship (/experiments) dropped as separate nav products; routes preserved.

**Tests:** +3 answer-block (weak-lead/definitional), +3 internal-link (intent-fit), expiry assertions updated. **Gates:** tsc 0 · experiments **141** + proof/action-pack **70** = 211 passed · build PASS.

**Data integrity:** fresh preview `tenant-iranopedia::2026-06-30::1d4fa003` (6 items) persisted, status preview, **unaccepted**; 19 proof rows + 0 reservations + 0 accepted plans unchanged. No Wix / no GSC / no proof writes.

---

## 2026-07-01 — Daily Experiment EXECUTION workflow (apply → verify live → atomic activation → GSC)

**Built (post-acceptance loop):** `execution-state.ts` (item/plan state machine; forbidden shortcuts to `active`), `live-verification.ts` (deterministic per-lever live proof via cheerio over a fresh fetch), `execution-checklist.ts` (pure read model + Wix instructions), `daily-experiment-plan-store.ts` (+`activateItemViaRpc`/`skipItemViaRpc`/`updateItemExecution`/`completePlan`/`listReservationsForPlan`), `daily-experiments-actions.ts` (+`markDailyExperimentAppliedAction`/`confirmGscSubmissionAction`/`skipDailyExperimentItemAction`/`completeDailyPlanAction`), `daily-experiments-{data,section}.ts(x)` (checklist UI), `shipped-change-store.ts` (+`markRecrawlRequestedById`).

**Migration applied to prod (`vlxwevsdvwxvopkjsewo`):** `2026-07-01_daily_experiment_activation.sql` → `activate_daily_experiment_item` + `skip_daily_experiment_item` (SECURITY INVOKER, service-role-only EXECUTE, anon denied). **Rolled-back atomicity proof:** valid activation (proof row + reservations active + item status, all-or-none), idempotent re-activation (consistent proof id, no dup), **proof-id-collision fail-closed** (foreign row at `${path}::${date}::${lever}` → `proof_id_collision`, nothing flipped), forced `verified_live=true`, skip release + idempotency, wrong-tenant, can't-skip-active, insufficient-controls → no stray proof. Post-rollback: **0 synthetic rows; the 19 Iranopedia proof rows untouched.**

**Adversarial review (17-agent workflow):** 31 findings (4 crit/9 high/11 med/7 low). Confirmed reals all fixed: internal-link cross-domain + nav-link false-positives (same-origin + source-paragraph-scoped), answer-block hidden/chrome/substring false-positives (visibility filter + chrome strip + near-whole-paragraph), proof-id collision (×2 — id disambiguation + RPC fail-closed), missing accepted→completed edge (completePlan + auto-complete + "Finish today's batch"), markFailed downgrading an active item (status guard + observable error), ledger fail-closed on the contamination gate, reservation-aware control re-check, GSC self-reported labeling.

**Gates:** `tsc` 0 · experiments+proof tests **192 passed (15 files)** · `npm run build` PASS. No proof before live verification · deterministic verification (no LLM) · tenant from server context · real Iranopedia plan never auto-accepted.

---

## 2026-07-01 - Dream-state mission: team decides + visible + evidence real in prod
- Forensic audit (9 parallel investigators): docs truthful; 4 rec generations with asymmetric experiment gating (only daily read the ledger); research caches file-only (absent in hosted prod); team modules live-but-invisible; live data real (25 proof rows, 16 measuring, plan accepted 6/30); page_snapshots 20d stale; legacy recommended_edits queue shelfware (82 rows all "recommended").
- Shipped: json_store_blobs Supabase mirror (migration applied + seeded both tenants); shared measuring-gate in action-pack/load.ts + promotion-writer.ts (same deriveExperimentStates as the planner); experiments/team-review.ts (pure, 4 tests) wired into build-today-preview (veto + bounded score multiplier + frozen debate); teamReview carried BuiltCandidate -> PlannedExperimentRecord; TeamRoundtable on daily cards; MoveCard debate open-by-default; war-room-sections.tsx (friction fixes / AI crawlers / demand opportunities / New Pages) mounted on /.
- Verified: typecheck 0; team-review 4 + experiments-domain 189 + gate-targeted 114 + clarity-router 8 tests green; blob table verified via SQL (6 scope rows); live ground-truth: 4/4 picks with real debates, excluded ledger shows same_family_measuring 5 + active_control 10; war room rendered live (screenshots) with real Clarity friction; zero writes to proof/reservations/plans/Wix/GSC (in-memory previews only).
- Full suite + build: run as the final merge gate this session (see commit messages for per-slice gates).

## 2026-07-01 - FINAL PREMIUM PLAN Wave 1 complete (22/23)
- Shipped across 12 main deploys: scoreboard (items 1-3), Today story+greeting (41-42), teammate identity + standup (13,43), LLM verdicts + voices + whyNot + conviction (25,26,30,32), auto-measure cron + proof-history voice (79,80), daily card design-system rebuild (11,12), IA consolidation (99,100), voice guide + ritual (111,120,45), war-room counts/freshness/buttons (46,47,48), OWNED AI-visibility producer + fusion (82). Item 81 parked with named bug (scan CLI config threading).
- Live proof: iranopedia.com cited by the live LLM answer for "persian carpets" (DataForSEO ai_optimization, $0.0271, ledger-verified); scoreboard renders real 840-click week with win markers; standup shows six teammates with real numbers.
- Wave gate: full suite 15,721 passed / 0 failed (one pin legitimately updated to the item-45 plain-language copy); build compiled; budget-ledger race fixed (parallel spend no longer dropped on 23505).

## 2026-07-02 - Topical coverage map (master plan item 9, worktree, NOT committed)

**What changed:** new src/domains/coverage/ - build-hubs.ts (pure Persian-safe token clustering: Unicode tokenizer + EN/FA stopwords + glue-token pruning + union-find on 2-shared-token joins + recursive anchor split of chained mega components, singletons to an "other" bucket), coverage-map.ts (pure per-hub coverage rows: answered count, coverage percent, AI checked/cited join, top-3 missing questions with create_page pointers, first-person summary line, opportunity-weight ranking = unanswered demand + AI-checked-but-uncited demand; plus coverageCandidateSeeds() feed for the daily builder), load-coverage-map.ts (react.cache loader over $0 stored reads: demand-graph SWR snapshot, GSC question queries, keyword-universe cache, fanout seeds, cached prompt opportunities, cached LLM mentions; top 12 hubs; fail-soft null). New CoverageMapSection on Today (/) after the war room: coverage bar per hub, "answers X of Y", "AI picks you on A of B checked", best next page pointer; self-hides under 3 hubs.

**Verified:** npm run typecheck 0 errors; 41 targeted vitest green (build-hubs 17, coverage-map 15, section contract 9). Headless Iranopedia ground truth (~2.7s warm graph): 12 gap-ranked hubs from 1540 search + 250 AI + 217 keyword terms; top rows: Iranian Wedding 0/3 answered (AI 0/1), Nowruz 7/12 (58 percent, AI 1/4, missing "nowruz gifts" matched to the create_page move), culture prompts 1/3. Mega-hub bug found by ground truth (one hub swallowed 95 percent of terms) and fixed with the anchor split; em dashes leaking from raw prompt texts folded to hyphens at ingestion.

**Follow-up:** wire coverageCandidateSeeds() into the daily candidate builder (one line in its caller) once a create-page lever exists there; fanout seeds are honestly 0 until a Profound fanout sync lands rows.

## 2026-07-02 - Change-level dollar attribution (BEACON_500 item 22, worktree, NOT committed)

**What changed:** new `src/domains/proof-gsc/change-dollar-value.ts` (pure) - `computeChangeDollarValue({trafficDelta, windowDays, keyEventDelta, revenueModel})` rolls a change's already-measured delta up to a monthly rate and multiplies by the operator's own unit-economics rate (item 3: rpm or per_lead) into `{usdPerMonth, basisSentence, confidence}`. Honest degradation: no revenue model -> `usdPerMonth` is null and the sentence names only the extra visits, in clicks; negative lift states a plain cost ("costing you about $X a month"), never floored at zero; deterministic, no I/O. A second pure helper, `extraSessionsFromTrafficOutcome`, derives the CONTROL-ADJUSTED extra-sessions figure from `trafficOutcome.adjustedSessionsPct x treated.sessionsPre` instead of the raw `sessionsPost - sessionsPre` delta - this mirrors (does not duplicate) the diff-in-diff `traffic-outcome.ts` already computes, and matters because the raw delta can carry the OPPOSITE sign from the adjusted lift whenever comparison pages moved together. Wired into `measureRecord` (`run-measurement.ts`): after `trafficOutcome` computes, a new `resolveChangeRevenueModel` reads the operator's config the same way the item-3 nightly pass does (`hydrateBusinessConfigFromSupabase` falling back to `getBusinessConfig`), and `dollarValue` attaches to the record with the exact same computed-only, fail-soft, never-persisted posture as `trafficOutcome`/`citationOutcome`/`rankOutcome` (`shipped-change-store.ts` `recordToRow` does not touch it). Presentation: a pure `shouldShowChangeDollarLine` gate wired into the `/proof` Wins band row (`page.tsx`) shows the dollar line only on a mature win with a positive `usdPerMonth` - never on a measuring/in-flight row, never on a learning (non-win) row, never with no revenue model. `proof-summary-section.tsx` gained a pure `buildProofHonestySentence` helper so the item-75 honesty sentence appends ", worth about $X a month at your rates" only when at least one mature win actually has a positive dollar value.

**Verified:** `npm run typecheck` 0 errors in every file this item owns (two pre-existing errors remain in other agents' concurrent in-flight `wiki-gap`/`citability` modules this cycle, confirmed unrelated - untracked files, not touched by this change). 40 new targeted tests green: `tests/domains/proof-gsc/change-dollar-value.test.ts` (34 - pure-math matrix across rpm/per_lead/none/negative/sparse-confidence, the `extraSessionsFromTrafficOutcome` sign-correctness cases, the `shouldShowChangeDollarLine` won-only/measuring-never gate, and a dash-guard sweep), `src/domains/proof-gsc/run-measurement-dollar-value.test.ts` (7 - loader-join wiring with mocked GA4/business-config, incl. a regression test reproducing the real Iranopedia sign-flip shape), `src/app/(shell)/proof/proof-summary-dollar-sentence.test.ts` (7 - the honesty-sentence append rule). Full targeted proof/revenue/dash-guard sweep: 338 tests green across 21 files, zero regressions in the existing `run-measurement.test.ts` (item 19 rank-recheck suite) or the `proof-jargon-guard` dash/jargon scan (which now also covers the new copy for free).

**Ground truth (real Iranopedia, headless probe via `set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs <probe>`):** no revenue model is configured for this tenant today (`revenueModel: null`), so every one of the 9 ledger rows with a `trafficOutcome` that has run reads clicks-only, as designed. Iranopedia's one real `verdict: "won"` row (`/famous-iranian-singers`, shipped 2026-06-21) shows `trafficOutcome.label: "Visitor traffic (11 days): +15% visits vs similar pages"` and `dollarValue.basisSentence: "This change is earning you about 35 extra visits a month. Set your rate per visitor or lead in settings to see this in dollars."` - consistent with each other because of the control-adjusted fix (the probe first caught the bug: before the fix, this exact row said "costing you about 30 extra visits a month" because the raw sessions dipped 87 to 76 even though the page won relative to its comparison page, which fell further). The Wins band itself currently renders no extra dollar line for this row (by design: `shouldShowChangeDollarLine` requires a positive `usdPerMonth`, which is null with no revenue model) - the moment the operator sets a rate in settings, this exact row turns into a real "worth about $X a month" line with no further code changes.

**Honest caveats:** the dollar figure is always an estimate ("your rate x the extra visitors this change earned"), never presented as a measured payout; it inherits every limitation of `trafficOutcome` itself (thin GA4 volume, no controls yet, a 7-11 day early read). Confidence bands (low/medium/high) are new and based on the magnitude of the monthly extra-sessions/events figure, not on the underlying GSC/GA4 sample size directly - a reasonable first cut, worth revisiting if it ever disagrees with the operator's gut on a live row.

## 2026-07-02 - Farsi/Finglish language-gap matrix (BEACON_500 item 24, worktree, NOT committed)

**What changed:** new `src/domains/language-gap/` domain, tenant-agnostic by design (script-vs-romanization detection, Persian folding as the first shipped data table, not hardcoded logic). `classify-query.ts` (pure) - `classifyQuery(q)` returns `{script: 'arabic_fa'|'latin'|'mixed'|'other', language: 'fa'|'finglish'|'en'|'unknown', confidence}` using Unicode Arabic-block ranges for script plus a word-initial-onset-anchored Finglish detector (`kh-`/`gh-`/`ch-` at a word start count as full signals, mid-word double-vowels count as half signals, a digit-for-word tell like "4shanbe" and a `knownLatinRoots` hit each count as near-certain). `variant-folding.ts` (pure) - `foldVariant`/`clusterVariants` canonicalize transliteration spelling families (kh/gh, double-vowel collapse, char/chahar elision, digit-for-letter) via `PERSIAN_FOLDING_TABLE`, an ordered rewrite-rule list shipped as DATA; `PERSIAN_KNOWN_LATIN_ROOTS` is a short companion list of real Persian-culture romanizations that lets the classifier confidently tag short, otherwise-ambiguous words. `page-language.ts` (pure) - classifies an owned page's crawled `page_snapshots` text (title/meta/h1/h2/body/FAQ) into `{hasFarsiContent, farsiRatio, lettersSampled}` via the same script test. `language-gaps.ts` (pure) - the matrix join: `findContentLanguageGap` (real Farsi-script/Finglish demand on a page with no matching-script content; skips pages never crawled rather than fabricating a claim) and `findVariantSpellingGap` (a Farsi-content page missing high-impression spelling variants), combined in `buildLanguageGaps` (one finding per page, ranked by impressions). `language-gap-hints.ts` (pure, bounded 2/night) + `language-gap-store.ts` (Supabase-mirrored json-store, registered in `store-classification.ts` + `json-store.ts`, 14-day freshness) + `run-language-gap-pass.ts` (the only I/O file - reads the already-cached `loadGscPageSignalsForTenant` + `getPageSnapshots()`, joins on NORMALIZED PATH since GSC and snapshot URLs can disagree on host). Wired additively: `cron-sync.ts` PHASE 1e (isolated try/catch per tenant, does not touch PHASE 1c/1d), `build-today-preview.ts` hint feed + "Language gap" team-review voice beside the existing spike/seasonal/feature-steal hints, one violet Demand-band row in `war-room-sections.tsx` below the seasonal row (silent when none, quiet-line extended).

**A real precision bug found and fixed mid-build:** the first classifier cut counted ANY digraph substring match (kh/gh/ch/double-vowel) anywhere in the query, which correctly caught "chaharshanbe soori" but also false-positived on ordinary English/loanword queries from real Iranopedia GSC data - "genghis khan flag" (gh+kh) and "persian cheetah"/"iranian cheetah" (ch+ee) all scored as Finglish. Fixed by anchoring the strong consonant-cluster signals to word-initial position (rare in English outside loanwords like "khan"/"ghost", common as a Finglish word onset) and weighting mid-word double-vowels as only half-signals, then re-verified against the same real data with zero false positives remaining.

**Verified:** `npm run typecheck` 0 errors. 87 targeted tests green across 6 files (`classify-query.test.ts` 22, `variant-folding.test.ts` 17, `page-language.test.ts` 9, `language-gaps.test.ts` 20, `language-gap-hints.test.ts` 8, `language-gap-surface-pins.test.ts` 11) plus the sibling `trend-radar`/`seasonal`/`serp` surface-pin suites (112 tests) re-verified green after the additive Demand-band guard extension (two pre-existing sibling assertions updated to match the new `&& !languageGapRow` guard, following the exact precedent item 21 set when it extended item 14's assertion). Verified live in the browser: fetched the real running dev server (`localhost:3142`, `DATA_SOURCE=supabase`, real tenant-iranopedia data) and confirmed the rendered RSC payload contains the exact expected copy in the correct DOM position (violet row after the sky seasonal row, inside "Demand you do not own yet").

**Ground truth (real Iranopedia, headless probe `scripts/_language-gap-probe.ts` via `set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_language-gap-probe.ts --persist`):** 1281 total query rows across 197 pages with GSC signal, 1124 distinct queries classified - 1 Farsi-script, 27 Finglish, 1095 English. Real transliteration families clustered correctly, e.g. "chaharshanbe soori" (4 spellings: chaharshanbe suri/charshanbe soori/chaharshanbe soori/chahar shanbeh soori, 141 impressions), "shabe yalda" (3 spellings, 119 impressions), "doodool tala" (2 spellings, 598 impressions). 4 real gaps found and persisted to the `language-gap-matrix` store: `/nowruz` (424 impressions), `/chaharshanbe-suri` (404), `/sizdah-bedar` (220), `/shabe-yalda` (167) - all `farsi_demand_no_farsi_content`. Spot-checked `/nowruz` directly: the real crawled page (title "When is Nowruz 2026? Learn about the Persian New Year", h1/meta/h2s/body all sampled) uses zero actual Farsi-alphabet characters anywhere - every word is Latin-script romanization ("Nowruz", "Haft-Seen", "Chaharshanbe Suri") - confirming the finding is genuinely correct, not a page-language false negative.

**Honest caveats:** the digraph/onset heuristic remains inherently approximate (no formal Finglish transliteration standard exists); short, ambiguous romanizations ("norooz", "tahdig", "nowruz" itself) only classify confidently when they hit the `PERSIAN_KNOWN_LATIN_ROOTS` list, so an unseen short romanization with no digraph corroboration could under-classify as English (fails toward silence, not toward a fabricated claim). `missing_variant_spellings` gaps did not fire on this Iranopedia data pull (every page with a real transliteration family either had zero Farsi content, caught by the other gap kind, or already mentioned every spelling); the code path is unit-tested but awaits a live example. The mentions-checker is a simple case-insensitive substring test against sampled crawl text, not a fuzzy match.

## 2026-07-02 - Permutation null wired into GSC verdicts (BEACON_500 item 37, worktree, NOT committed)

**What changed:** new `src/domains/proof-gsc/permutation-null.ts` (pure math + one I/O shell) - `buildPermutationNull({tenantId, shipDate, windowDays, preWindowDays, excludePaths})` expands the treated diff-in-diff from a handful of hand-picked control pages to every untreated, adequate-traffic page on the site: reuses `aa-calibration.ts`'s deterministic placebo-page picker (`pickPlaceboPages`/`ledgerExclusionPaths`) for candidate selection, then reads the SAME window the treated verdict was judged on (same ship date, same day length, via `readWindowForPages`/`readCumulativeSince`) so the null shares the treated window's exact market weather rather than a re-seeded pseudo date. Each candidate's leave-one-out pseudo-lift (its own clicks delta minus the mean of every OTHER candidate's delta) mirrors `placebo-inference.ts`'s citation-engine shape. `percentileOf(lift, nullDist)` reports where the treated lift lands (`{percentile, nGreater, nTotal}`); bounded to `MAX_NULL_PAGES` (60) and gated by `MIN_NULL_PAGES` (20, below which the read is an honest skip, never a fabricated percentile). `permutationSentenceFromCounts(nGreater, nTotal)` is the plain-English, no-jargon sentence for the Results row ("Out of N untouched pages, only M moved as much as this one did. That is strong evidence the change caused it."), built directly from the same counts attached at measure time so the sentence can never disagree with the gate that read them. Wired additively into `measure.ts`'s `summarizeVerdict` (`permutationP?: number` - HIGH confidence now additionally requires `permutationP <= PERMUTATION_P_HIGH_MAX` (0.05); absent `permutationP` is byte-identical to pre-item-37 behavior; a failing permutation read demotes an otherwise-HIGH verdict to MEDIUM, never LOW, and never changes the verdict/lift itself) and into `run-measurement.ts`'s `measureRecord` (computes the permutation read for the newly-run basis window before calling `summarizeVerdict`, fail-soft on any error, attaches `permutationRead` computed-only on `ShippedChangeRecord` exactly like `trafficOutcome`/`citationOutcome`/`rankOutcome`/`dollarValue` - never persisted, `recordToRow` omits it). Presentation: the Results row (`/proof` `page.tsx`) gains one additive line below the existing `Search:` confidence sentence, rendered only when `rec.permutationRead` exists.

**Verified:** `npm run typecheck` 0 errors in every file this item owns (pre-existing errors this cycle belong to other agents' concurrent in-flight `control-matching`/`pooled-verdict` work, confirmed unrelated - untracked/other-owned files, not touched by this change). 29 new targeted tests green: `permutation-null.test.ts` (23 - candidate selection/window-sharing/bounding/leave-one-out math/percentile math/sentence copy/dash guard), `run-measurement-permutation.test.ts` (6 - attach-on-enough-pages, honest skip below MIN_NULL_PAGES, fail-soft on a thrown null builder, confidence never upgrades from a strong read and never un-demotes from a weak one, verdict/windows always unchanged), plus 4 new cases added to the existing `measure.test.ts` `summarizeVerdict` suite (byte-identical pin with no `permutationP`, a clearing p keeps HIGH, a failing p demotes HIGH to MEDIUM with the verdict unchanged, and confidence never upgrades purely from a great permutation p on an otherwise-low-sufficiency read). Full existing `proof-gsc` suite re-verified green: 377 tests across 25 files (test/file counts include sibling agents' concurrent additions this session), zero regressions.

**Ground truth (real Iranopedia, headless probe `scripts/ground-truth-permutation-null.ts` via `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-permutation-null.ts`):** the real `/famous-iranian-singers` ledger row (shipped 2026-06-21, `section_add`, judged on clicks) has a closed 7-day window with a +12.44 adjusted-clicks lift. The real permutation null over this tenant's untreated pages (bounded at the 60-page cap, sharing the exact same 2026-06-21 to 2026-06-28 window) found only 1 of 60 untouched pages moved as much (percentile 0.0167, well under the 0.05 high-confidence bar). Real sentence rendered: "Out of 60 untouched pages, only 1 moved as much as this one did. That is strong evidence the change caused it."

**Honest caveats:** the null distribution is built once per measured window (not cached across calls), so a measure pass over many records reads GSC cumulative totals repeatedly rather than sharing one read across records in the same run - fine at today's ledger size (25 rows) but a candidate for a follow-up batch-level cache if the ledger grows much larger. The percentile is a magnitude-only (two-sided) comparison, matching `placebo-inference.ts`'s existing convention, so a page that moved sharply in the OPPOSITE direction of the treated lift still counts as "moved as much" - this is intentional (a fair null asks "how often does a page swing this hard", not "how often does it swing this way") but worth knowing when reading the top-pseudo-lift debug list. This item's HIGH-confidence gate only ever makes confidence stricter (never looser), by design, so it will not by itself turn any existing MEDIUM read into HIGH.

## 2026-07-02 - Comparison-page matching hardened: scale/trend + SUTVA guard (BEACON_500 items 33 + 36, worktree, NOT committed)

**What changed:** new `src/domains/proof-gsc/control-matching.ts` (pure) - `rankControlCandidates({treated, candidates})` ports `baselineSimilarityRatio` (0.25-4.0x band, near-zero-baseline special case) and `maxTrendSlopeDivergence` (0.6 clicks/day) verbatim from `attribution/natural-controls.ts`, and adds a new SUTVA guard: `queryOverlap > MAX_QUERY_OVERLAP` (0.2, documented) excludes a candidate that shares too much search demand with the treated page. Returns per-candidate `{similarityRatio, slopeDivergence, queryOverlap, verdict: kept|excluded, reason}` in plain first-person language ("comparison page", never "control"). Fail-soft by contract: a null similarity/overlap input always PASSES that check; when the strict pass leaves fewer than `MIN_SURVIVORS` (2), the ranker widens to the best-available candidates (ranked by distance from each band) and sets `usedFallback: true` - but a query-overlap exclusion is NEVER re-admitted during widening (a cannibalizing sibling stays excluded even as a fallback, since it would corrupt the read rather than merely weaken it). Two new I/O readers in `auto-record-on-ship.ts`: `loadBaselineDailySeries` (per-page daily clicks from `gsc_daily_page_totals`, the accurate untruncated table) and `loadQueryOverlap` (impression-weighted query overlap from `gsc_daily_rows`), both paged via `.range()` in 1000-row chunks per this project's PostgREST response cap. `matchControlsForShip` wires the two readers + the pure ranker together for one ship. `autoRecordShippedChangeForRec` now runs its raw top-12-by-demand candidate pool through the matcher (previously a blind top-3 slice); the kept set becomes `controlPages`, and a new additive `controlMatchNotes` (plain-language receipt of every excluded candidate) plus `controlMatchWeak` (true when the matcher used its fallback) land on the `ShippedChangeRecord` via a new additive migration (`control_match_notes` jsonb, `control_match_weak` boolean default false) - existing ledger rows are never mutated; only new ships get matched selection. `measurement-maturity.ts` gained an additive `weakComparison` input mirroring the existing algorithm-weather-guard pattern exactly: `weakComparisonCaveat`/`weakComparisonFlagged` on `MeasurementPresentation`, honest sentence "The comparison pages were not moving like this page before the change, so I am reading this result cautiously," and it additively revokes `learningEligibility` the same way a shock overlap does - never changes maturity/verdict/headline. `load-experiment-outcomes.ts`'s `maturityGatedVerdict` gained one more additive `if (r.controlMatchWeak === true) return "measuring"` clause, composing with the existing weather gate. The Results row (`/proof` `page.tsx`) renders the new caveat right below the weather caveat; `proof-summary-section.tsx` and `today-moves-data.ts` thread the flag through their own presentation builders for consistency.

**A real bug found and fixed by the ground-truth probe, not by unit tests:** `gsc_daily_page_totals` and `gsc_daily_rows` store the raw GSC property host (`www.iranopedia.com`), while every matcher input arrives already canonicalized (bare `iranopedia.com`, via `canonicalizeCitationUrl`). The first cut of both readers filtered `.eq`/`.in` on the canonical form and silently matched zero rows for every page, so every candidate read `baselineClicksPerDay: 0` and `slopeDivergence: 0`, masking real signal. Fixed with a `withWwwVariant` helper that queries both host forms and canonicalizes rows back on read; pinned with two new host-normalization tests (`auto-record-on-ship.test.ts`).

**Verified:** `npm run typecheck` 0 errors in every file this item owns (pre-existing errors this cycle belong to other agents' concurrent in-flight work on `measure.ts`/`daily-experiment-planner.ts`/pooled-verdict/team-scoreboard, confirmed unrelated - not touched by this change). 78 new targeted tests green: `control-matching.test.ts` (18 - baseline-ratio/slope-divergence pure math, mismatched-scale exclusion both directions, near-zero-baseline branch, diverging-trend exclusion, SUTVA overlap exclusion incl. boundary-inclusive and never-re-admitted-in-fallback, fail-soft null-input passes, all-excluded fallback with honesty flag, zero-candidates no-op, dash guard), `auto-record-on-ship.test.ts` (19 - paging discipline on both new readers, query-overlap math, www-host-normalization regression pins, matcher end-to-end wiring, `buildControlMatchNotes` copy, and 10 integration pins on `autoRecordShippedChangeForRec` covering matcher-used/notes-stamped/weak-fallback-flagged/min-2-floor-enforced/matcher-throws-falls-back-to-raw-top-3/pre-existing no-url+unresolved-url+idempotency behavior untouched), 6 new cases in `measurement-maturity.test.ts` (byte-identical default, caveat+learning-revocation on a mature win, explicit-false reads as unset, in-flight can also carry the flag, composes independently with the weather guard, dash guard), 8 new cases in `load-experiment-outcomes.test.ts` (both loader functions, undefined-field back-compat, composes-with-weather). Fixed one latent bug in the existing `load-experiment-outcomes.test.ts` fixture while adding these (`record(over)` accepted an override param but never spread it into the returned object, so `record({ confidence: "high" })` never actually overrode anything - existing tests happened to only ever pass the already-default value, so nothing was masked; fixed by spreading `...over`). Full existing `proof-gsc` suite + `learning` suite + `/proof` shell surface + `natural-controls.test.ts` re-verified green: 501 tests across 34 files, zero regressions. `proof-jargon-guard.test.ts` (dash + lab-word scan of `page.tsx`/`proof-summary-section.tsx`) passes clean on the new caveat copy for free.

**Ground truth (real Iranopedia, headless probe `scripts/ground-truth-control-matching.ts` via `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-control-matching.ts`):** for the 3 most recent ledger rows (all shipped 2026-07-01: `/chaharshanbe-suri`, `/iran-flags/late-safavid-military-flag`, `/iran-flags/abbasid-caliphate-golden-emblem-flag`), re-running the matcher against today's real top-12-by-demand candidate pool excluded 9 of 12 candidates on every row - Iranopedia's biggest pages (`persian-male-names`, `persian-female-first-names`, `funny-farsi-phrases`, etc.) are wildly mismatched in scale against these near-zero-baseline flag subpages, exactly the class of bug item 33 targets. On the second row the matcher additionally caught a real SUTVA violation: `iran-flags/achaemenid-empire-flag` shares 33 percent of its search demand with the treated page (over the 20 percent limit) and was excluded as a title win there would visibly steal its clicks. All 3 rows triggered `usedFallback: true` after the strict exclusions, correctly falling back to the least-mismatched 3 candidates rather than zero. Agreement with what was actually recorded at ship time was 0 of 3-5 pages on every row - expected and not a bug: the actually-recorded set came from each row's own top-12 pool AT SHIP TIME (excluding whichever pages were already treated then), while the probe's re-derived pool is today's fixed top-12-by-demand across the whole site, so an exact replay of history was never the goal - the point was confirming the matcher's math finds real scale/trend/overlap problems in a live candidate pool, which it did.

**Honest caveats:** the ground-truth probe re-derives "what would the matcher pick today" against a live, current candidate pool - it cannot exactly replay the historical candidate pool available at the original ship time (already-treated exclusions differ day to day), so the "0 agreement" number above measures the matcher's independent judgment, not a disagreement with the old code's specific historical picks. `controlMatchNotes`/the weak-comparison caveat are not yet rendered anywhere except the Results row explanation line added here - a future pass could surface the exclusion reasons themselves in the UI (currently only stored on the ledger row for the receipt trail). The `www.`-host fix generalizes to any single-variant host mismatch but was only exercised against the `www.` case found live; a tenant with a different canonicalization drift (e.g. trailing slash differences already handled elsewhere) is not separately covered here.

## 2026-07-02 - Buy the missing decisive evidence before the batch finalizes (BEACON_500 item 39, worktree, NOT committed)

**What changed:** new `src/domains/experiments/buy-missing-evidence.ts`. `findEvidenceGaps(picks, opts)` is pure decision logic (no I/O): given tonight's already-selected picks (each carrying its `EvidencePacket` when one exists, plus a cached-SERP-pattern flag and a fresh-history flag), it ranks by `rankScore` (the caller passes `ctrOpportunityClicks`), takes the top 5 (bound configurable via `maxGaps`), and returns only the ones with a packet AND a real target query AND no existing live-SERP evidence - a page with no packet has nothing to debate and is never a "gap." `buyEvidenceForPick(gap, opts)` is the I/O half: it calls `runSerpQuery` (injectable via `opts.runQuery` for tests, defaulting to the real gauntleted function - production code never bypasses the gauntlet) and only on a genuine "ok" or "cache_hit" status with a non-empty snapshot does it call `validateCreatePage` to build a `SerpValidation` and a first-person receipt sentence ("I checked Google live before finalizing this pick: for \"...\" the top results say this is worth building..."); every other status (disabled/dry_run/capped/error/no_results) or a thrown error resolves to `{status: "declined", declineReason}` - never throws, never fabricates evidence. `reviewCandidateWithTeam` (`team-review.ts`) gained a third, optional, additive `extras: SpecialistExtras` param (defaults to `{}`, every existing caller unaffected) so a freshly bought `serpVerdict` can be threaded into a re-review. Wired into `build-today-preview.ts` immediately before the strategist verdict-drafting pass (so the fresh voice is available when the strategist synthesizes): builds `EvidenceGapCandidate` rows from `selected` + the already-built `packetByPath`/`serpByTerm` maps, calls `findEvidenceGaps` bounded to 5, and for each real gap calls `buyEvidenceForPick` with the tenant's own domain (`currentTenant().domain`, fail-soft to null); on a genuine purchase it re-runs `reviewCandidateWithTeam` for ONLY that pick, re-attaches the proof-history voice if missing, appends a "Live Google results" voice carrying the receipt sentence, and recomputes `teamScoreMultiplier` the same way the original R1 review loop does. A decline (including forced dry-run) leaves the pick's original team review and abstain completely untouched - the batch never blocks.

**Verified:** `npm run typecheck` 0 errors. 26 new targeted tests green: `buy-missing-evidence.test.ts` (18 - gap detection with/without a packet, cached-pattern/fresh-history coverage skip, blank-query skip, top-5 bounding with a 12-candidate matrix, custom `maxGaps` incl. 0, a mixed covered/gap/no-packet batch, purchase success with a build verdict + receipt sentence, fail-soft declines for dry_run/capped/disabled/error/thrown-exception/zero-results, `cache_hit` still counts as "bought", dash guard on the receipt sentence) and 2 new cases in `team-review.test.ts` pinning the re-review wiring itself (no `extras` -> the live-Google voice stays silent exactly as before; passing a `serpVerdict` via `extras` makes the dataforseo teammate speak where it was silent, an abstain-to-voice transition). Full `experiments`/`serp`/`demand-graph` domain sweep re-verified green: 692 tests across 51 files, zero regressions.

**Ground truth (real Iranopedia, headless probe forcing `DATAFORSEO_DRY_RUN=true`, calling `buildTodayExperimentPreview` read-only with no persistence):** tonight's real batch selected 4 picks. 3 of them ("rashidun caliphate flag", "khwarazmian empire flag", "khorasan carpet") already carried a cached SERP pattern from the existing item-29 nightly enrichment step and were correctly recognized as covered - no purchase attempted, no spend. Exactly 1 pick ("iran islamic republic flag history", query "iran flag") was a genuine silent-voice gap; item 39's buy step fired for it, served from the real 14-day DataForSEO cache ($0 marginal cost, log line `[dataforseo-serp] cache hit query=iran flag`), and its team review gained a live "Live Google results" voice reading "I checked Google live before finalizing this pick: for \"iran flag\" the top results say this is worth building. Content-page SERP (5/10 editorial), out-buildable." - confirming the full abstain-to-voice pipeline (gap detection -> gauntleted buy -> re-review -> receipt line) fires correctly end to end on real data. Only one DataForSEO call was attempted across the whole run, matching the expectation that item 39 should activate for exactly the picks item 29's earlier enrichment step did not already cover.

**Honest caveats:** the probe's one live gap happened to resolve via a pre-existing 14-day cache hit rather than a genuinely fresh live paid call, so this run did not exercise the real non-cached "ok" status end-to-end against production (that path is covered by unit tests with an injected `runQuery`, not by this ground-truth run). `hasFreshSerpHistory` is currently always passed as `false` from `build-today-preview.ts` (the caller has no existing per-query history-freshness lookup wired at this call site) - this is honest, not a bug: it only means a pick could theoretically be re-bought if a history row exists but no cached pattern does, and `runSerpQuery`'s own 14-day cache still prevents a real double spend in that case. The re-review's fresh voice is not yet cross-checked against the earlier item-29 "Live Google results" voice for the SAME pick (impossible today since item 39 only fires when item 29 found nothing), so no dedupe logic between the two voices has been exercised on live data.

## 2026-07-02 - Ground the LLM title/meta pass + elect the winning action from the vote tally (BEACON_500 items 48+49, worktree, NOT committed)

**Item 48 - what changed:** `build-today-preview.ts`'s `llmDrafter` (the nightly title/meta "write it" pass) called `draftAtomicEditStructured` with `outline: []`, so the rewrite LLM never saw the page's own title/h1/meta/body even though `factsByPath` already held them from `page_snapshots`. New pure helper `buildOutlineFromFacts(facts)` turns a page's `PageFacts` into the drafter's `outline` array (`Title: ...` / `H1: ...` / `Meta: ...` then each body paragraph), bounded to ~1500 chars total so a long page never blows the prompt budget; empty-safe (no snapshot or no facts returns `[]`). The `llmDrafter` closure now looks up `facts.get(url)` (the same per-candidate facts map the rest of the file already builds) and passes the built outline, and composes `evidenceHints` from the item-26 citability `topFixes` BESIDE it (never clobbering) when the page is also a citability target. `MetaTitleDrafter`'s input type (`daily-llm-enrich.ts`) gained an optional `url` field, additive, threaded from the one existing call site. Confirmed the answer-block drafter path (`draftAnswerBlockStructured`, used for D-2 written answers) already passed `outline: (f.bodyParagraphs ?? []).slice(0, 8)` and `evidenceHints: citability?.topFixes` - no gap there, so only the title/meta path needed the fix.

**Item 49 - what changed:** `move-router.ts`'s `routeMove` normalizes each specialist to ONE total vote split evenly across its `suggestedMoveTypes` (a voice listing two actions now casts its confidence split between them, never doubled) and tallies a `totalVoteWeight`. A new election step runs right after seeding and before vetoes: when the top-voted action beats the seeded action by more than `VOTE_ELECTION_MARGIN` (25 percent of total vote weight, exported documented constant) AND at least `VOTE_ELECTION_MIN_VOICES` (2, exported documented constant) distinct specialists back it, the vote winner takes the decision - `electedBy: "vote"` and the winning `margin` are persisted on `MoveRouterDecision`, and `rationale` gains the debate line ("The team outvoted the default here: N voices back [action] over [seed action] (X% margin)."). The min-voices guard is a deliberate addition beyond the literal item text: without it, Clarity's Sprint-1 "downgrade, not veto" friction opinion (`suggestedMoveTypes: ["fix_ux"]`, a single voice) would unilaterally out-vote the seed on its own, breaking the existing, intentional "Clarity is a downgrade in Sprint 1, not a veto" test contract - a lone specialist should never override the graph's own classification; election requires genuine multi-voice consensus. Vetoes still apply after election: the veto `hitsCurrent` check now matches against BOTH the (possibly vote-elected) current action and the original seed action, so a veto aimed at the graph's seed classification still fires and is still recorded in `appliedObjections` even when the vote already moved the decision away from that seed before the veto block ran.

**Verified:** `npm run typecheck` 0 errors in every file this pair of items owns (`build-today-preview.ts`, `daily-llm-enrich.ts`, `move-router.ts` and their tests); pre-existing errors this cycle are confirmed to live entirely in `src/domains/retrieval-twin/` (another agent's concurrent in-flight item-50 work, untouched here). New/updated tests: `build-today-preview.test.ts` (new file, 5 cases pinning `buildOutlineFromFacts` - empty-safe on no snapshot and on an all-empty-fields snapshot, populates from title/h1/meta/body, skips blank paragraphs, bounds total output to <=1500 chars on a long page) and 2 new cases in `daily-llm-enrich.test.ts` (url threaded through to the drafter). `move-router.test.ts` grew from 8 to 17 tests: added `electedBy`/`margin` assertions to the two existing degradation/partition tests (both stay "seed", proving the fix is additive), plus new coverage for one-vote normalization (a two-action voice splits its confidence; two single-action voices can out-vote a split one), margin election (a decisive 4-voice win elects with the debate line and no dashes; a ~9% margin stays under threshold and keeps the seed), the min-voices guard (a single high-confidence voice never elects alone; `VOTE_ELECTION_MIN_VOICES >= 2`), the Clarity regression pin (its lone downgrade-paired vote still cannot elect `fix_ux`), and vetoes-after-election (a veto against the seed still fires and is recorded even after the vote already moved the action; a veto can still override a vote-elected action outright, forcing `wait`). ALL 8 pre-existing tests pass unmodified in behavior. Full `demand-graph` domain suite re-verified green: 147 tests across 12 files. Full `experiments` domain suite re-verified green: 339 tests across 24 files. Fixed one em-dash slip in my own new test `describe(...)` titles (caught by my own dash-guard pass, not by a broken test) - replaced with hyphens per the no-em/en-dash rule; this file's pre-existing `describe` titles elsewhere in the same file (and in `daily-llm-enrich.ts`'s file header) already used em dashes before this change and were left as-is (not authored by this change, out of surgical scope).

**Real grounded-vs-ungrounded draft comparison (item 48, live `OPENAI_API_KEY`, gpt-5-mini, ~$0.005 total for both calls):** same page (title "Persian Wedding Traditions", body covering the Sofreh Aghd spread, sar zadan-e ghand sugar ritual, and cash-gift customs), same query ("persian wedding traditions"), same field (meta). UNGROUNDED (`outline: []`, today's pre-fix behavior) produced a generic, partly wrong meta ("...including the sofreh aghd, dowry, music and rituals" - "dowry" is not actually on this page, a near-hallucination the numeric firewall cannot catch since it is not a number) with a thin `evidenceRefs.detail` ("Page titled ... currently had no meta description"). GROUNDED (outline built from the same facts via `buildOutlineFromFacts`) produced a meta naming the page's real specifics ("centered on the Sofreh Aghd... mirror and candle, sar zadan-e ghand... gift customs") with an `evidenceRefs.detail` that quotes the actual body content precisely. This matches the item's own framing: grounding is the cheapest quality lift in the LLM engine, and the difference here is a materially more accurate, page-specific draft for well under a cent.

**Honest caveats:** the `w >= 1` threshold in the router's pre-existing "Considered X (support N)" whyNot transparency line was calibrated for the OLD doubled-vote weights; with one-vote normalization, per-action weights are generally smaller, so this line will fire less often than before for near-miss alternatives. This is a pre-existing constant unrelated to the election feature itself and was left unchanged (in scope was the election mechanism, not recalibrating an orthogonal transparency threshold); no test depended on its exact firing behavior. `daily-experiment-planner.ts`, `team-standup.tsx`, source-freshness, and retrieval-twin/strategy-review were explicitly out of ownership for this pair of items and were not touched, even though `team-review.ts`/`prepare-today-moves.ts`/`today-moves-data.ts` all consume `routeMove`'s output - checked each and confirmed they only read pre-existing fields (`rationale`, `appliedObjections`, `action`, `baseScore`/`adjustedScore`, `confidenceLevel`, `whyNotAlternatives`), so the new additive `electedBy`/`margin` fields need no consumer changes, but nothing yet surfaces the new debate line specially in the UI beyond it riding the existing `rationale` string these consumers already display.

## 2026-07-02 - Weekly strategy review: the plan reallocates itself, not just reports (BEACON_500 item 51, worktree, NOT committed)

**What changed:** new `src/domains/strategy-review/` domain, four files. `build-dossier.ts` is the deterministic, $0 dossier: `buildStrategyDossier` (pure) folds already-loaded settled outcomes (via `computeDimPriors` from `experiment-prior.ts`, filtered to the `actionType` dimension) into per-family won/lost records, bounds this week's trend spikes (item 14)/seasonal windows (item 21)/language gaps (item 24) to 5 each sorted by strength, and includes the forecast-calibration bias (item 28) only once it clears `MIN_SETTLED_FOR_CALIBRATION`; `loadStrategyDossier` is the fail-soft I/O shell calling the existing loaders (`loadExperimentOutcomes`, `loadQuerySpikes`, `loadSeasonalQueries`, `loadLanguageGaps`, `loadCalibrationRecords`) with each source degrading to an empty slice on its own error. `apply-mix.ts` is pure: `clampStrategyMix` is where "the LLM proposes, deterministic clamps dispose" is enforced - every weight clamped to `[0.5, 2.0]`, any family not in the caller's known set dropped, every reason dash-stripped; `applyStrategyMix` multiplies a candidate's score by its family's clamped weight with an identity-when-absent guarantee (absent mix, absent family, or a neutral 1.0 weight all leave `score` byte-identical and attach no tag). `strategy-mix-store.ts` follows the trend-radar/seasonal/language-gap GLOBAL-store sibling pattern exactly, except it is APPEND-ONLY history (never "latest wins") capped at `MAX_HISTORY_WEEKS` (12) per tenant, with the append refusing (not overwriting) a second write for the same `(tenant_id, weekOf)`. `run-strategy-review.ts` routes through the EXISTING `callStructuredLLM` gauntlet (no new OpenAI egress point) with a new `strategy_review` schema registered in `src/domains/llm/schemas.ts` (`leverMix[]`, `focusFamilies[]` capped at 3, `memo` <=900 chars, `confidence`); on `off`/`blocked_budget`/`validation_failed`/a thrown dossier build it fails open LOUDLY (a `log.warn`) by carrying the previous week's mix forward unchanged as an explicit `source: "fail_open"` record (or writing nothing when there is no previous week to carry). `surface.ts` renders the Monday recap band's one-liner, self-hiding when the record is stale (more than 9 days from its `weekOf`) or absent, and signs it "- your strategist, Sunday night" with a belt-and-suspenders dash strip. Wired at ONE surgical call site in `build-today-preview.ts`: a new `applyWeeklyStrategyMixToCandidates` helper (private, not exported) runs right after the existing R1 team-review loop, composing the clamped family weight multiplicatively onto `teamScoreMultiplier` (the same composable slot item 29's family-win boost already shares) and attaching an additive `strategyMixTag` field on `BuiltCandidate` (`build-daily-candidates.ts`) for the "this week's plan leans into..." card copy; absent mix or neutral weight is a no-op. Cron at `src/app/api/cron/strategy-review/route.ts`: `CRON_SECRET` bearer guard (fail-closed, matching `/api/cron/autopilot`), a Sunday-only gate (`?force=1` escape hatch for manual runs), computes the COMING week's Monday via `mondayOfWeek`, fans out across `listTenants()`, and checks `hasStrategyMixForWeek` per tenant before calling `runStrategyReview` (per-week idempotency at the call site, not inside the run function, so a manual/test invocation is never silently blocked). Does not touch `vercel.json` per the item's own instruction. Monday recap band wired in `src/app/(shell)/page.tsx` right below the existing item-27 calibration sentence, same self-hiding/fail-soft pattern.

**Verified:** `npm run typecheck` 0 errors in every file this item owns; the only remaining errors are two pre-existing `@ts-expect-error` findings in `src/domains/retrieval-twin/retrieval-budget.test.ts` (another agent's concurrent in-flight item-50 work, confirmed unrelated - not touched here). 166 new targeted tests green across 8 files: `apply-mix.test.ts` (20 - weight clamping both directions, unknown-family drop, case-insensitivity, first-occurrence-wins on duplicates, dash-strip, non-finite-weight neutral fallback, focus-family cap-at-3/dedupe/dash-strip, and the full identity-when-absent + multiplication + never-mutates-input + independent-per-candidate matrix for `applyStrategyMix`), `build-dossier.test.ts` (12 - per-family fold, thin-sample omission below `MIN_DECIDED`, bounding+sort-by-strength for trends/seasonal/gaps, calibration null-below-floor/present-above-floor, empty-week honesty, prompt rendering with honest placeholders), `strategy-mix-store.test.ts` (16 - registration pins for GLOBAL classification + Supabase mirror, round-trip, tenant scoping, latest-lookup, idempotency refusal, fail-soft read/write, the 12-week cap with per-tenant isolation, never-mutates-existing-rows), `surface.test.ts` (9 - freshness window both directions, unparseable-date staleness, null/stale/empty-memo all self-hide, the exact signed line, dash guard even against a hypothetically-regressed stored memo), `run-strategy-review.test.ts` (17 - known-family vocabulary pin, happy-path record shape + persistence + weight clamping + unknown-family drop + dash-strip + focus cap, per-week idempotency refusing a second write, and the full fail-open matrix: off/no-previous-mix writes nothing, budget-blocked carries the previous mix forward with a loud warn, validation-failure-after-retry carries forward, no-previous-week-on-failure writes null, dossier-throw fails open before ever calling the LLM, and a throwing store write never propagates), `wiring.test.ts` (4 - a source-grep pin confirming `build-today-preview.ts` imports the three strategy-review modules, calls the composition helper additively, and clamps before ever touching `teamScoreMultiplier`), plus `schemas.test.ts` growing by 9 cases (`StrategyReviewSchema` valid/empty-leverMix-rejected/focusFamilies-default-empty/focusFamilies-cap-at-3/memo-too-long/reason-too-long/bad-confidence/weight-above-schema-ceiling) and the `SCHEMA_BY_KIND` registry list updated to include `strategy_review`, and `route.test.ts` (12 - `mondayOfWeek`/`isSunday` pure date math incl. the Sunday-resolves-to-next-day case, auth guard 503/401 x2, day-gate skip/force/Sunday-runs, tenant fan-out with the coming week's Monday, per-tenant idempotency skip, and per-tenant error isolation that still returns 200 with the other tenant's real result). Full re-verified sweep of everything this item's edits touch: 544 tests across 37 files (`strategy-review` + `experiments` + `llm` + `lib/persistence`), zero regressions.

**Real strategy review (live `OPENAI_API_KEY`, gpt-5-mini, ~1 cent, real Iranopedia dossier via a throwaway `scripts/_strategy-review-dry-run.ts` probe, deleted after the run):** the real dossier for the coming week (2026-06-29) had 0 settled decided outcomes (a genuinely thin week), 5 real demand spikes (top: "persian leopardi" 154 this week vs 3 typical, 47.4x), 5 real seasonal windows all peaking months 5-6 (Iran flag, Persian names, Persian numbers, Persian wolf), and 4 real Farsi-content gaps (top: `/nowruz` with 424 impressions of Farsi/Finglish demand and no Farsi content). The real LLM response correctly stayed conservative exactly as instructed for a thin week: `leverMix` proposed only neutral 1.0 weights for title/meta/schema with the honest reason "No settled wins or losses this week so maintain neutral emphasis" (no fabricated confidence in a mix it had no evidence for), `focusFamilies` picked 3 real, grounded targets (iran flag and persian numbers from the real spikes+seasonal overlap, nowruz from the real language gap), and the memo plainly said it changed nothing in lever weights due to no settled results while shifting focus to the spike topics and language gap. The record persisted correctly to the real `strategy-mix-history` Supabase-mirrored store for `tenant-iranopedia`, weekOf `2026-06-29`, `source: "llm"`. One rough edge caught by this real run and fixed afterward: the model interpreted the original system-prompt instruction to write a "signed" memo literally and prepended its own "Signed: ..." phrase, which would have doubled up against `surface.ts`'s own appended "- your strategist, Sunday night" signature; the system prompt was tightened to explicitly forbid the model from adding its own sign-off (the app owns that), re-typechecked and re-tested clean (67/67 strategy-review tests) after the change but not re-run against the live API a second time (the first real run already proved the pipeline end to end; the prompt wording tweak is covered by the existing unit tests' exact-string assertions, not by spending a second real cent).

**Honest caveats:** with a genuinely empty settled-outcomes week (the common case for a young or newly-active tenant), the lever mix the review produces is entirely neutral by construction - this is correct behavior (conservative under thin data, per the item's own instruction), not a mix that has actually reallocated anything yet; the feature will only visibly reweight the plan once real won/lost verdicts accumulate past `MIN_DECIDED` (3) for at least one action family. The Monday recap band's freshness window (9 days either side of `weekOf`) was chosen to comfortably cover "the week we're currently in" and "the week that just started after a Sunday-night run" without a stale record ever reading as current, but has no dedicated test proving it survives a leap across a DST boundary (unlikely to matter since all date math here is UTC-anchored, not wall-clock). `applyWeeklyStrategyMixToCandidates` in `build-today-preview.ts` is not directly unit-tested against the full `buildTodayExperimentPreview` fixture graph (that file is large, heavily fixtured, and actively edited by other concurrent agents this session) - instead it is covered by a source-grep wiring pin (`wiring.test.ts`) plus full coverage of the two pure functions it calls (`clampStrategyMix`, and the store's `loadLatestStrategyMix`), which is the same trust boundary the codebase's own `forecast-calibration-store.test.ts` registration-pin pattern relies on elsewhere. The cron route's own idempotency check (`hasStrategyMixForWeek` before calling `runStrategyReview`) and `runStrategyReview`'s internal idempotency (refusing a second `appendStrategyMixRecord` for the same tenant+week) are two independent, overlapping guards by design - belt and suspenders, not redundant, since `runStrategyReview` can also be called directly (e.g. a future manual "run this week's review now" action) without going through the cron route's pre-check.

## 2026-07-02 - Item 50: retrieval twin (predicted citation likelihood)

**Built:** `src/domains/retrieval-twin/` - `chunker.ts` (pure, heading-aware ~200-token chunking, tested 13 cases), `retrieval-budget.ts` (checkBudget/recordSpend sibling to adjudicator-budget.ts, own `.data/retrieval-twin-budget.json` + shared `llm_budget_ledger` platform "other", fail-closed, tested 15 cases), `embeddings.ts` (budgeted/cached/batched OpenAI text-embedding-3-small client, allowlisted in `tests/architecture/llm-safety-invariants.test.ts`, tested 17 cases), `build-index.ts` (bounded indexer: top ~150 owned pages by GSC impressions + all cached "ok" competitor teardown audits, paged 1000-row Supabase reads, tested 10 cases), `retrieve.ts` (pure cosine similarity + ranking math, tested 15 cases), `citation-likelihood.ts` (per-page "who wins the answer race" report: fanout questions first, GSC query fallback, tested 13 cases). Additive evidence field `EvidenceRetrieval` + pure `buildRetrievalEvidence()` added to `daily-evidence-brief.ts` (tested 4 new cases) - the wire into `build-today-preview.ts` is a deliberate one-line follow-up (that file is actively owned by a concurrent agent this session; the wire shape mirrors the existing `citability`/`staleSource` evidence-merge pattern at its line ~616/657). Operator action: "Check who wins the answer race" button on `/competitors` (`retrieval-twin-action.ts` + `retrieval-twin-button.tsx`, tested 4 cases) - operator-gated, bounded, no cron wiring.

**Migration applied + verified (Supabase MCP, project `vlxwevsdvwxvopkjsewo`):** `retrieval_chunks` table (`tenant_id, id` PK, `source` check owned/competitor, `chunk_text` capped 1200 chars, `embedding jsonb`, RLS `deny_anon` + `tenant_authenticated_rw` via `is_tenant_member`) - confirmed columns + policies via `execute_sql`; `get_advisors` shows no new findings for this table.

**Real run (OPENAI_API_KEY live):** indexed the top 20 Iranopedia owned pages by GSC impressions + 35 cached "ok" competitor teardown audits -> 613 chunks built, 539 embedded for $0.000215 (a full run; a second run was a 100% cache hit at $0.0000). Real report on `/persian-male-names`: for "persian boy names" (GSC fallback query, no fanout data synced yet) the page's best passage ranks 8th of 539 candidates; the passage to beat is parentcalc.com's "Persian & Iranian Boy Names with Meanings". For "iranian boy names" it ranks 6th of 539.

**Bugs found and fixed by the live-run gate (would have shipped broken without it):** (1) `retrieval-twin-budget` store name was never registered in `store-classification.ts`, so every budget check threw and fail-closed every embed - fixed by registering it as a GLOBAL store next to `llm-budget`. (2) the cache write did one unbatched `upsert` of all embedded rows in a run, which hit a real Postgres statement timeout at 539 rows - fixed by writing in bounded 50-row slices. (3) the cache read did one unbatched `.in()` lookup of all chunk ids, which a real Supabase client rejected outright ("Bad Request", GET URL too long) past ~100 ids - fixed by reading in bounded 100-id slices. (4) `buildCitationLikelihoodReport` canonicalized the page URL (stripping "www.") before querying GSC, but `gsc_daily_rows.page` stores the URL WITH "www." - silently zeroed every GSC-fallback match; fixed by passing the caller's original URL to the GSC loader. All four fixes have dedicated regression-pin tests.

**Verified:** `npm run typecheck` 0 errors (repo-wide, no pre-existing errors left over from this work). 144 targeted tests green across 12 files (`chunker.test.ts` 13, `retrieval-budget.test.ts` 15, `embeddings.test.ts` 17, `build-index.test.ts` 10, `retrieve.test.ts` 15, `citation-likelihood.test.ts` 13, `retrieval-twin-action.test.ts` 4, plus the pre-existing `daily-evidence-brief.test.ts` 36 and `llm-safety-invariants.test.ts` suites re-verified green). No full suite run (per the CI-minutes conservation rule) - only targeted files plus the architecture pin. Did not touch `build-today-preview.ts`, `move-router.ts`, `daily-experiment-planner.ts`, or `team-standup.tsx` (all actively owned by a concurrent agent this session per `git status`); my only shared-file edits were purely additive (new type, new function, new import line, new store-classification entry, new allowlist entry).

**Honest caveats:** no fanout/tracked-prompt data is synced for tenant-iranopedia yet (`profound_fanout_rows` reads 0 rows; a differently-named `profound_query_fanout_rows` table has 1309 rows but is not what `load-fanout-seeds.ts` reads - a pre-existing naming mismatch unrelated to this work, left untouched per scope), so every real report above used the GSC-query fallback, never the fanout path - the fanout branch is unit-tested but not yet exercised against live data. The daily-card evidence line (`EvidenceRetrieval`) is wired at the type/pure-function layer only; the actual per-page report has to be precomputed and read cheaply for `build-today-preview.ts` to surface it, which needs a small caching layer this slice didn't build (the operator action currently reports one example page per index run, not a report per every daily-card pick).

## 2026-07-02 - Item 62: the entity-attribute page factory becomes a governed weekly production line

**Built:** `src/domains/page-factory/production-line.ts` (new) - the chain runner: loads factory candidates via the existing `loadPageCandidates`, dedupes against open demand-graph Moves and prior weeks' batches (`dedupe-candidates.ts`, new), validates demand at $0 against cached DataForSEO keyword volumes or graph demand (`validate-demand.ts`, new: pass on a strong/exact cached-keyword match >=100/mo OR a graph Move naming the same entity with fused demand >=50; a candidate with no cached keyword data at all is QUEUED for the next capped keyword batch, never rejected; a real weak/under-floor match is honestly REJECTED with an accurate reason distinguishing "under the volume floor" from "too weak a topic match"), then drafts the top `MAX_DRAFTS_PER_WEEK` (constant, 5) through the existing `draftCreatePageStructured` brief drafter -> `evaluateCreatePageBriefQuality` gate -> the item-55 `draftFullPageStructured` section walker, tracking a running cost against `WEEKLY_LLM_CEILING_USD` (0.30) that fail-closed stops calling the drafter once reached (remaining candidates requeue for next week, never dropped). Every result is fail-soft per candidate (a thrown brief/page draft never blocks the rest of the batch) and the whole run is idempotent per (tenant, weekOf) via a new `src/domains/page-factory/batch-store.ts` (GLOBAL json-store, Supabase-mirrored, registered in `store-classification.ts` + `json-store.ts`, mirrors the `strategy-mix-store.ts`/`refresh-store.ts` sibling pattern but supports in-place per-item status mutation for the operator's approve/skip). Cron at `src/app/api/cron/page-factory/route.ts` mirrors `/api/cron/strategy-review` exactly: `CRON_SECRET` bearer guard (fail-closed), a Monday-only gate (`?force=1` escape hatch), fans out across `listTenants()`, checks `hasFactoryBatchForWeek` per tenant before running (belt-and-suspenders alongside the runner's own idempotency). Does not touch `vercel.json`. Drafted pages persist through the EXISTING `move_drafts` store (`saveMoveDraft`, kinds `create_page_brief` + `full_page_draft`, both already used by item 55) - one new `MoveDraftKind` added (`factory_page_brief`, additive, reserved for a future compact-brief-only persistence path; the runner currently reuses `create_page_brief` since `CreatePageBrief` already fits under the cap). NEVER auto-publishes: every batch item lands `status: "pending"`. New review card mounted on `/worklist` (the New Pages board's home, cheaper mount than Today): `page-factory-batch-data.ts` (loader, re-assembles the persisted brief + full-page draft from `move_drafts`), `page-factory-batch-card.tsx` (client card: per-page Approve/Skip, an expandable full-page viewer reusing the item-55 collapsible pattern, and an "I published this" confirm-URL step), `page-factory-batch-actions.ts` (server actions: approve/skip just flip the batch item's status via `updateFactoryBatchItemStatus`, no write; `confirmFactoryPagePublishedAction` is the only action that starts measurement, calling the EXISTING `autoRecordShippedChangeForRec` ship->proof bridge with its own auto-selected comparison-page set - the identical contract `markMoveAppliedAction` already uses, so Beacon still never publishes anything itself, the operator's explicit "I published this" confirmation is the only trigger).

**Verified:** `npm run typecheck` 0 errors repo-wide. 86 new/targeted tests green across 6 files: `validate-demand.test.ts` (9 - cached-keyword pass, under-floor reject naming the volume, graph-demand fallback pass, graph-demand under-floor stays queued, no-cache-data queued, cache-exists-but-no-match queued, highest-demand-signal-wins on multiple graph matches, and the weak-match-above-floor honest-reason regression this run's own real-data probe caught), `dedupe-candidates.test.ts` (5 - passthrough, prior-batch slug dedupe across any status, open-Move entity dedupe, unrelated-entity keeps, cross-week slug independence), `batch-store.test.ts` (13 - registration pins for GLOBAL classification + Supabase mirror, round-trip, tenant scoping, latest-lookup, weekly idempotency refusal on a second create, history cap with per-tenant isolation, per-item status update without touching sibling items/weeks, targetUrl set alongside status, fail-soft on an unknown tenant/week/slug), `production-line.test.ts` (11 - no-candidates short-circuit, the 5/week hard cap even with 10 demand-passing candidates, under-floor rejection, no-cached-data queuing, open-Move dedupe, the cost-ceiling early stop with requeue, per-(tenant,weekOf) idempotency with the drafter called only once across two invocations, a Ritz-tenant regression documenting that staging is allowed but every item stays "pending" - the live-write Ritz block lives in `executePush`/`autoRecordShippedChangeForRec`, not this module - and fail-soft coverage for a graph-load throw and a single candidate's brief-draft throw not blocking the rest of the batch), `route.test.ts` (12 - auth 503/401 x2, Monday-only day gate with force override, per-tenant fan-out with the same weekOf, per-tenant idempotency skip, per-tenant error isolation, and a Ritz fan-out pin), plus the pre-existing `move-draft-store.test.ts` and the repo's `no-banned-dash-display-surfaces.test.ts` + `json-store-routing-invariants.test.ts` + `canonical-store-tenant-isolation.test.ts` architecture guards re-verified green (144+35 tests). No full suite run (CI-minutes conservation rule) - targeted files plus the architecture pins only. Live dev-server smoke: `/worklist` returns 200 with the expected page content and the new card self-hides cleanly (no batch generated yet for Iranopedia), confirming the full import chain (`worklist/page.tsx` -> `page-factory-batch-data.ts` -> `batch-store.ts` -> `store-classification.ts`/`json-store.ts`) compiles and executes with no runtime error.

**Real batch preview (read-only $0 probe against real Iranopedia data, `scripts/_page-factory-probe.ts`, no LLM calls, nothing written):** 40 raw entity x attribute candidates, 19 survive dedupe against 227 open demand-graph Moves and 0 prior batches (first run). Against 217 fresh cached DataForSEO keyword rows: 13 candidates clear the demand floor. This week's batch (ranked, capped at 5) would be: "Flags Meaning" and "Flags Examples" (cached keyword, 135,000/mo each), "History of Persian" (graph demand 52,735), "History of Iranian" (graph demand 17,640), "History of Empire" (graph demand 13,709) - 8 more real passing candidates wait for next week under the cap. 2 candidates ("Product Examples", "Animals Examples") have no cached keyword data yet and are queued for the next keyword batch, never drafted or rejected. 4 candidates ("Product Meaning", "History of Product", "Animals Meaning", "History of Animals") were correctly rejected: the entity-attribute factory's generic "Product"/"Animals" entities only weak-matched an unrelated cached keyword ("pedar sag meaning", a real Persian phrase with no relation to "product" or "animals"), confirming the confidence-gated matcher rejects spurious matches rather than drafting off noise.

**Honest caveats:** the production line's own tests inject `draftBrief`/`draftFullPage` (never call the real OpenAI API), so the $0.30/week ceiling's exact stop-point under real gpt-5-mini pricing has not been exercised end to end against a live key - the unit tests pin the requeue-on-ceiling BEHAVIOR with synthetic costs, not the real dollar amount a live 5-page week would spend (`draftCreatePageStructured` projects $0.03/brief, `draftFullPageStructured` typically far less than $0.08/page after quality-gate fallback stubs, so 5 pages should land near $0.15-0.20 in practice, under the ceiling, but this is an estimate from the existing item-55 cost model, not a fresh live run this slice paid for). The review card's "I published this" flow assumes the operator pastes the drafted content into their CMS by hand and reports the resulting URL, mirroring the New Pages board's existing paste-ready contract exactly (there is no generic Wix dynamic-page collection mapping this slice can safely auto-resolve for a brand-new page today, so `executePush`'s armed `create:<collectionId>` route is available for a future operator-driven wire-up but is not called automatically here - staying "never auto-publish" holds either way). `factory_page_brief` (the new `MoveDraftKind`) is added but currently unused by the runner (it reuses `create_page_brief`, which already fits); kept for a possible future factory-specific compact persistence path rather than removed, since the task explicitly asked for the store-registration groundwork. Did not touch `outreach`, `/ask`, `money-pages`, or `rewrite-page` (all actively owned by concurrent agents this session per `git status`).

## 2026-07-02 - Items 67 + 68: Bayesian verdicts with credible intervals + measure the target queries directly

**Built:** `src/domains/proof-gsc/bayesian-read.ts` (new, pure, zero dependencies) - CTR modeled beta-binomial (pre window as an informative prior via add-one Bayes-Laplace smoothing, post window updates the posterior), clicks modeled gamma-Poisson (same add-one prior shape, pre window as a daily-rate prior). Both posteriors are moment-matched to a normal distribution (documented approximation in the module header, with its bounds: degrades under ~10 clicks or ~30 impressions in a window, flagged via `smallSample`) so `P(lift > 0)` and a 90% credible interval on monthly clicks are exact closed forms of that normal approximation. `buildBayesianRead` orchestrates by metric (routes CTR-judged changes through the beta-binomial model, everything else through gamma-Poisson, returns null for a position-judged change since an average rank has no honest count/rate model). `bayesianSentence` renders the plain-English line ("We are 87 percent sure this helped, likely 5 to 40 extra clicks a month"), `bayesianAgreesWithVerdict` is the direction-agreement gate (won agrees at pWin>=0.7, lost at pWin<=0.3), `selectHeadlineSentence` composes the two into the Results-row upgrade rule. Explicitly documented as an ADDITIVE quantification layer, not a second decision path this cycle: the stored `verdict`/`confidence` are never touched by this module. `src/domains/proof-gsc/target-query-read.ts` (new) - per-target-query diff-in-diff reading `gsc_daily_rows` (the only table with the page+query grain) for the record's own `targetQueries`, treated page vs its comparison pages, over the same basis window the page-level verdict uses. WWW-variant safe: reuses the exact `withWwwVariant` pattern `auto-record-on-ship.ts` already proved for this same table (raw GSC host form vs canonicalized bare host), paged in 1000-row chunks up to a 20k-row bound. Honest silence (empty array) when there are no target queries, no window has closed, or a query has under 50 impressions in either window (`MIN_QUERY_IMPRESSIONS`) - never fabricates a read off a sliver of data. Both wired ADDITIVELY into `measureRecord` (`run-measurement.ts`): a new `treatedPostByDay` map captures each window's raw treated-post metrics (the loop previously only kept `computeWindowLift`'s derived deltas) so the Bayesian read can use the SAME basis window's real clicks/impressions without re-deriving them from the lift math; `bayesianRead` and `targetQueryRead` are new computed-only fields on `ShippedChangeRecord` (`shipped-change-store.ts`), same NOT-persisted posture as `trafficOutcome`/`citationOutcome`/`rankOutcome`/`permutationRead` (recordToRow omits them, recomputed every measure). Results row (`src/app/(shell)/proof/page.tsx`): the headline sentence upgrades to the Bayesian wording via `selectHeadlineSentence` only when a read exists and agrees in direction with the floor verdict (a disagreeing or absent read leaves the existing floor-derived sentence untouched); up to 2 target-query sentences render below the permutation-null line, filtered to rows that had something honest to say.

**Verified:** `npm run typecheck` 0 errors in every file these two items own (`bayesian-read.ts`, `target-query-read.ts`, `run-measurement.ts`, `shipped-change-store.ts`, `proof/page.tsx`); the remaining repo-wide errors during this session all live in concurrently-edited files this pair of items never touches (`seasonal/seasonality.test.ts`, confirmed another agent's in-flight work). 74 new targeted tests: `bayesian-read.test.ts` (48 - closed-form normal-CDF sanity vs known table values, a full CTR matrix (flat/large-clear-win/large-clear-loss/small-sample-flagged/zero-click-prior-never-NaN/monthly-scaling-by-window-length), a full clicks matrix (same shape, gamma-Poisson), metric routing (CTR/clicks/null-on-position), sentence plain-language + range-wording matrix (positive/negative/coin-flip/small-sample-caveat/straddling-zero/all-negative), the direction-agreement gate at both boundaries (0.7 and 0.3) plus non-final verdicts never agreeing, the `selectHeadlineSentence` presentation pin (upgrades on agreement, keeps the floor sentence on disagreement or absence, never fires for measuring/inconclusive/insufficient_data, and a pin proving the verdict input itself is never mutated), and a dash guard on the source file), `target-query-read.test.ts` (26 - basic control-adjusted CTR/position diff-in-diff against a closed-form hand-check, no-target-queries and blank-query short-circuits with zero reads attempted, the full thin-data silence gate at both window boundaries and exactly at the 50-impression floor, silent-drop for a query missing from GSC entirely, www-variant safety for both the treated page and a control page stored under the opposite host form, fail-soft on a read error and a missing tenant id, the sentence formatter's CTR-only/position-only/neither-present/decline-reads-as-down cases, and a dash guard). `run-measurement.test.ts` grew by 8 integration cases (4 each for items 67/68): a real bayesianRead attaches for a CTR-judged action type without changing verdict/windows, none attaches for a position-judged action type, null before any window has run, and fail-soft framing; target-query resolves to `[]` when Supabase is unreachable (no env in this test file) without altering the verdict, skips entirely with no target queries, and stays null-safe pre-measurement. ALL existing proof-gsc suites re-verified green alongside the new work: 33 test files, 491 tests total across `src/domains/proof-gsc/**` and `src/app/(shell)/proof/**` (includes the pre-existing `measure.test.ts`, `run-measurement.test.ts`, `permutation-null.test.ts`, `proof-jargon-guard.test.ts` all passing byte-identical to before this change on their existing assertions). No full repo suite run (CI-minutes conservation rule) - targeted proof-gsc + proof directories only, which is the full ownership surface for this pair of items.

**Real Iranopedia probe (read-only, `scripts/ground-truth-bayesian-target-query.ts`, no paid calls, nothing written):** the `/famous-iranian-singers` shipped-change record (`section_add`, shipped 2026-06-21, targetQueries: "iranian singers"/"persian singers"/"famous iranian singers"/"famous persian singers"/"persian singer") with its stored verdict UNCHANGED at `won`/`high` confidence (7-day window). Real `bayesianRead`: pWin=0.82, 90% credible interval [-9, 33] extra clicks/month, sentence "We are 82 percent sure this helped, likely 9 fewer to 33 extra clicks a month." - and since 0.82 clears the 0.7 agreement threshold for a `won` verdict, the Results-row headline genuinely upgrades to this Bayesian wording (confirmed via the same `selectHeadlineSentence` the UI calls). Real `targetQueryRead`: 2 of the 5 target queries had enough data to report (the other 3 were too thin, honestly silent) - "iranian singers" (position 11.1 to 8.3, click rate down 0.3 points, likely a rank-not-yet-converted-to-clicks case) and "persian singers" (click rate up 2.7 points, position flat at 14.6). Both queries reported `controlsUsed=0` (the 4 assigned comparison pages, entrepreneur/scientist/athlete/male-names lists, genuinely do not rank for singer-related queries in `gsc_daily_rows`, so the sentence correctly falls back to the treated page's own raw movement rather than fabricating a control adjustment from zero usable comparators).

**Honest caveats:** the Bayesian read is intentionally NOT a diff-in-diff (reads the treated page's own pre vs post, never subtracts control-page drift) because a closed-form Bayesian treatment of a three-way treated-pre/treated-post/control-drift comparison has no simple conjugate form without silently breaking the beta/gamma conjugacy this module leans on; this is documented in the module header as the explicit trade (the Bayesian read answers "how sure am I THIS PAGE moved", the floor verdict still answers "how sure am I this page moved MORE than similar pages"), which is why the headline upgrade requires directional AGREEMENT between the two rather than ever replacing the floor verdict as the decision-maker. The normal-moment-matching approximation is honest but not exact for thin samples (documented + gated via `smallSample`, verified in the real probe's case as `false` since the singers page has real volume). `targetQueryRead`'s control adjustment can silently degrade to zero controls (as seen in the real probe) when no comparison page shares demand for a specific long-tail query - this is the correct, honest behavior (no fabricated adjustment) but means the per-query sentence sometimes reports raw movement rather than a true diff-in-diff; this is called out explicitly in the sentence's own framing ("On the exact search we aimed at") which never claims to be control-adjusted. `writeCalibrationIfDue`'s call site in `run-measurement.ts` and other nearby code were being concurrently edited by other agents in this shared worktree during this session (confirmed via repeated `git status`/re-read checks after two mid-session full-file reverts of `run-measurement.ts`/`shipped-change-store.ts` back to their pre-edit state, both re-applied and re-verified); the final on-disk state was re-confirmed intact and green immediately before this report.

---

### 2026-07-02 - BEACON_500 item 74: pattern tagging + few-shot from the ledger

**What changed:** new `src/domains/llm/draft-pattern.ts` (pure) classifies any draft/answer-block text into one of `definition_first | stat_first | table | qa_pair | step_list | prose_other` from markdown/HTML structure alone, plus a pure `aggregateWinsByPattern` that tallies decided proof-ledger outcomes by `(pattern, pageFamily)` with a hard `MIN_DECIDED_FOR_CONFIDENCE = 3` floor (unconfident cells never surface a claim). `winner-memory.ts` extended: each harvested `WinnerExample` is now tagged with its `pattern` at harvest time (computed-only, the ledger/`shipped_change_proof` rows are never mutated); new `loadPatternAggregate`/`loadPatternAggregateWithRows` read the WHOLE ledger (not just wins) fresh on every call and classify+tally every decided shipped artifact; new `buildWinnerFewShotsWithPattern(tenantId, lever, pageFamily)` returns the existing item-30 fragment plus, only when a confident cell exists for that page family, one appended style-hint line naming the winning pattern and a real winning page (never fabricated - `winningPageForCell` only names a page whose row actually won). `structured-drafter.ts`: `AnswerBlockStructuredInput`/`AtomicEditStructuredInput` gained an optional `pageFamily` field (omitting it is fully backward compatible - every existing caller is untouched and behaves byte-identically); `StructuredDraftResult`'s "drafted" branch gained an optional `fewShot` field; the atomic-edit drafter prepends the exact controlled provenance sentence ("I wrote this the way your last winners were written: <pattern>, like the block that won on <page>.") to the model's own `rationale` (re-capped at the schema's 400-char limit) only when a confident cell backed the draft, which rides through the ALREADY-WIRED `rationale` -> `llmRationale` -> `WrittenByBeacon` channel with zero changes to `build-today-preview.ts`/`daily-plan-types.ts`. The one draft-provenance component, `src/app/(shell)/daily-experiments-section.tsx`, gained a pure exported `splitFewShotLine` that detects the controlled-sentence prefix and renders it as a second, visually distinct line under the existing "Beacon wrote this" line - a pure renderer of whatever the drafter decided, no new fields threaded through the daily-plan types.

**Not wired end-to-end yet (explicitly out of scope for this slice's ownership):** no caller currently passes `pageFamily` into `draftAnswerBlockStructured`/`draftAtomicEditStructured` (`build-today-preview.ts`/`prepare-today-moves.ts` are outside this item's ownership, which was scoped strictly to `src/domains/llm/**` + the one component), so the pattern-aware few-shot path is fully built and tested but not yet activated in the real nightly batch. Threading `pageFamily` from those callers is the natural next slice.

**Verified:** `npm run typecheck` clean (0 errors). Targeted tests only (CI-minutes discipline): 101 tests across 4 files - `draft-pattern.test.ts` (26, new: classifier fixture matrix for all 6 patterns + priority ordering + HTML-stripping + jargon-free labels; `aggregateWinsByPattern`'s floor discipline including the exact-at-floor boundary, pending exclusion, and citation-outcome folding; `bestConfidentPattern`'s honest null when no cell/family clears the floor), `winner-memory.test.ts` (37, +11 new: pattern tagging at harvest, the whole-ledger aggregate's floor discipline, page-family grouping via the first-path-segment rule, and `buildWinnerFewShotsWithPattern`'s byte-identical-when-cold pin plus its confident-cell injection and the honest-null-winning-page-on-all-losses case), `structured-drafter.test.ts` (32, +9 new: byte-identical system prompt when no pageFamily or no confident cell, the pattern-hint fragment appended only when confident, the `fewShot` result field only ever present on a "drafted" status, and the atomic-edit rationale prepend + 400-char recap pin), `daily-experiments-section.test.ts` (6, new: `splitFewShotLine`'s prefix-detection matrix including the no-trailing-text case and a dash guard). All other tests that import either owned file re-verified green (9 files, 126 tests: `rewrite-page`, `batch-adjudicator`, `draft-full-page`, `run-strategy-review`, `ask/composer`, `load-experiment-outcomes`, `retrieval-budget`, `prepare-create-page-verdicts`, `draft-pitch`).

**Real Iranopedia probe (read-only, `scripts/_probe-draft-pattern-item74.ts`, no writes, no LLM calls):** 25 shipped_change_proof rows, all with non-empty after-text. Real pattern distribution: `prose_other` 21, `stat_first` 3, `definition_first` 1 (zero `table`/`qa_pair`/`step_list` so far - expected, Iranopedia's ledger so far is mostly title/meta/schema edits and operator notes, not yet answer-block-heavy content). Real verdict distribution: `measuring` 16, `inconclusive` 5, `lost` 3, `won` 1 - but the honest `isDecided` gate (mirroring `winner-memory`'s existing maturity discipline) found **zero** decided rows: every non-measuring record's actual measurement maturity resolves to `early_checkpoint` (only the 7-day window has closed on all of them), so none has reached `mature_result`/`inconclusive` maturity yet even though their stored `verdict` field already shows a non-"measuring" value. Confirmed this is correct, not a bug, by cross-checking `deriveMeasurementMaturity` directly against each record's real windows. Result: the `(pattern, pageFamily)` aggregate is honestly empty and no page family has a confident pattern yet - the few-shot pattern hint would not fire tonight for any pick, which is the expected state this early in the ledger's life (need >=3 MATURE 28-day-window decided ships in the same pattern+family before any claim surfaces).

**Honest caveats:** pattern classification is a deterministic structural heuristic, not a semantic read - a JSON-LD schema blob or an operator's shipped-change note (both of which appear in the real ledger's `after` field alongside genuine answer-block prose) classifies as `prose_other` rather than crashing or mislabeling, which is the correct fail-soft behavior but means the "pattern" signal is only as clean as what actually gets stored in `after`. The pattern-aware few-shot capability is fully built, tested, and pinned but genuinely inert in production until a follow-up slice threads `pageFamily` through `build-today-preview.ts`/`prepare-today-moves.ts` (both outside this item's ownership) AND the ledger accumulates enough mature, decided, same-pattern-same-family ships to clear the floor - both preconditions are currently unmet on the real tenant, and this log says so plainly rather than overstating readiness.

---

### 2026-07-02 - BEACON_500 item 75: opened a Bing lane (IndexNow pings + honest receipt trail) for ChatGPT visibility

**What changed:** ChatGPT's browsing rides Bing's index, and there was zero Bing anywhere in the repo, so a page absent from Bing could never be cited by ChatGPT regardless of quality. New `src/lib/connectors/indexnow/**`: `client.ts` implements the IndexNow protocol (`POST https://api.indexnow.org/indexnow` with `{host, key, keyLocation?, urlList}`), treats both HTTP 200 and 202 as success, retries exactly once on any failure, and never throws regardless of network outcome (fail-soft by construction, not by a wrapping try/catch at the call site). `config-store.ts` holds the tenant's opaque IndexNow key plus an optional host/keyLocation override and an optional separate Bing Webmaster API key, as a per-tenant singleton json-store (`indexnow-config`) - deliberately NOT added as a new provider to the large `ConnectorProvider` union in `src/lib/connector-store.ts`, since IndexNow has no OAuth flow and no bearer-API calls made on the tenant's behalf; widening that shared file's many overloads/unions for a single opaque string would have meant a large, collision-prone edit to a file several other concurrent agents in this worktree also touch, whereas the `autopilot-state` singleton-store pattern already covers "one per-tenant config object, self-hides when absent" cleanly. `receipts-store.ts` is a per-tenant append-only ping log (`indexnow-receipts`, capped 100, newest-first) so the UI can say "I told Bing X minutes after this went live" instead of inventing an index-status claim. `setup-copy.ts` centralizes the plain-English one-time setup instructions (generate a key, host a `<key>.txt` file, paste the key back in) so the diagnostics section and the save action never drift on wording. `ping-on-verify.ts` is the actual wiring point: `pingIndexNowOnVerifiedLive` self-hides (no ping, no receipt written) with no key configured, and otherwise pings + always records a receipt (success or failure) without ever throwing into the publish path that calls it; `scheduleIndexNowPing` is the fire-and-forget wrapper. `bing-webmaster.ts` is an OPTIONAL read of the official Bing Webmaster API's URL-submission-quota endpoint, gated entirely on a separately-configured `bingWebmasterApiKey` - self-hides to `null` (never a fabricated number) with no key, and NEVER scrapes Bing's actual search results (which would violate ToS); there is no free "is this page indexed" API, so the index-status story is honestly limited to the receipt trail plus this optional quota line.

**Wiring (small additive edits, per ownership):** both real verify-live sites now call `scheduleIndexNowPing` the moment (and only the moment) `probeLiveText` returns `probe.kind === "found"` - i.e., after an operator-approved publish has already landed AND a live re-read has confirmed the exact proposed text is on the page: `src/domains/push/stage-change.ts` (the worklist "Stage in Wix" one-click path) and `src/app/(shell)/recommendations/actions.ts` (`approveAndPushRecommendedEdit`, the two-click Approve & Push path). Neither call site awaits the ping (fire-and-forget) and the ping's own internals swallow every possible failure, so a Bing outage can never affect the publish result already returned to the operator. Ritz (`tenant-ritz-founder`) structurally cannot reach this path: `executePush` hard-refuses Ritz before any write happens, so `probeLiveText` is never even called for that tenant, let alone `probe.kind === "found"`.

**Surface:** one new section, `src/app/(shell)/diagnostics/connectors/indexnow-section.tsx` (an async function returning JSX, called as `await IndexNowSection()` rather than used as a `<IndexNowSection />` JSX tag - the existing page test renders the whole page via raw `renderToStaticMarkup`, which suspends on an async Server Component used as a JSX tag outside Next's RSC renderer; calling it as a plain awaited function keeps it a normal server-render, matching how the rest of the page already loads its data), plus `indexnow-actions.ts` for the key-save `<form action>`. Mounted on `/diagnostics/connectors` with exactly one import line and one JSX interpolation of the pre-awaited result, per the ownership contract ("one new section component + one mount line"). The section shows: the setup instructions (no key) or the configured host + key-file reminder (key present), the optional Bing Webmaster quota line (only when that separate key is also configured), and the last 5 receipts with a plain ok/failed indicator and a relative "N minutes ago" timestamp.

**Store registration:** re-read `src/lib/persistence/store-classification.ts` immediately before editing (per the concurrent-agent protocol) and confirmed no conflicting edit had landed since the first read. Added `indexnow-receipts` to `TENANT_SCOPED_STORES` (per-tenant array) and `indexnow-config` to `SINGLETON_STORES` (one object per tenant), both with dated comments explaining the classification choice. Also added both store names to `SUPABASE_MIRRORED_STORES` in `src/lib/persistence/json-store.ts` - Vercel lambda writes skip disk, so without the mirror an operator-saved key would silently vanish on the next lambda recycle (disarming the lane with no visible error) and the receipt trail would always read empty on hosted prod; this is the same rationale already documented for `autopilot-state` and `ask-history`.

**Verified:** `npm run typecheck` clean in every owned/touched file. 30 new targeted tests across 5 files under `tests/lib/connectors/indexnow/`: `client.test.ts` (8 - exact payload shape incl. optional `keyLocation` omission, 200-and-202-both-succeed, exactly-one-retry-then-give-up, retry-can-still-succeed, never-throws-on-network-error, URL-derived-host convenience wrapper, invalid-URL fail-soft), `config-store.test.ts` (6 - null when unconfigured, fail-soft-to-null on a read error, blank-key stored row reads as unconfigured, full round-trip, optional fields omitted rather than `undefined`-leaking, throws on an attempted blank-key save), `receipts-store.test.ts` (5 - empty by default, fail-soft-to-empty on a read error, newest-first prepend, write failures never throw, list stays capped at 100), `ping-on-verify.test.ts` (6 - self-hides with zero receipts written when unconfigured, pings with the configured key/host and records a success receipt, records a failure receipt without throwing, derives host from the URL when no host override is set, never throws even if the config read itself throws, the fire-and-forget wrapper never throws synchronously), `bing-webmaster.test.ts` (5 - self-hides to null with no Bing Webmaster key and makes zero fetch calls, parses a good response, fails soft to null on a non-ok response, fails soft to null on a malformed body rather than inventing a number, fails soft to null on a network error). Re-ran every existing test file touched by the wiring to confirm no regression: `stage-change.test.ts` (28 passing), `stage-in-wix-surfaces.test.ts` (24 passing), `connectors-page.test.tsx` (5 passing, including the fix for the async-component suspension), `connectors-actions.test.ts` (10 passing), `store-classification.test.ts` (6 passing), `json-store-routing-invariants.test.ts` (22 passing), `json-store-routing.test.ts` (19 passing), `json-store-vercel.test.ts` (6 passing), plus the recommendations-actions-adjacent suites (`sprint6a1-phase12-wiring.test.ts`, `accept-per-action.test.ts`, `accept-changelog-title.test.ts`, `no-tenant-id-empty-string-literals.test.ts`, `perf-recs-queue-cached.test.ts`, `today-recommendation-responses-fresh.test.ts` - 62 passing, 4 pre-existing skips unrelated to this change). Total: 150+ tests run across the affected surface, all green. Did NOT run the full 15k-test suite (CI-minutes conservation rule); pre-existing unrelated typecheck errors in `draft-quality.ts`, `production-line.ts`, and `run-autopilot.test.ts` were confirmed via `git status --porcelain` to belong to other agents concurrently active in this shared worktree, not to this item's ownership surface (`src/lib/connectors/indexnow/**`, the verify-live wiring points, the one new section, and the store registrations).

**Real Iranopedia probe (read-only, `npx tsx --require ./scripts/mock-server-only.cjs <probe>` against the real configured Supabase project with `.env.local` sourced, deleted after use, NO ping sent to api.indexnow.org):** `getIndexNowConfig()` returns `null` for `tenant-iranopedia` right now - **no IndexNow key is configured for this tenant today**, confirmed against the live store, not assumed from the feature being new. The lane therefore self-hides exactly as designed: no ping has ever fired, `indexnow-receipts` is empty, and the diagnostics section renders the setup instructions verbatim: "I can tell Bing about every change the moment it goes live, which helps ChatGPT find your pages too, since it browses using Bing's index. To turn this on: 1. Generate a key (any random letters and numbers, 8 or more characters). 2. Create a text file named <key>.txt containing just that key. 3. Upload it to your site so it loads at https://yoursite.com/<key>.txt. 4. Paste the same key here. Once I can see the file, I will ping Bing after every live change."

**Honest caveats:** this item cannot verify that Bing actually indexes a pinged URL, or how quickly - IndexNow is a notification protocol ("here is a URL that changed"), not an indexing guarantee, and there is no free, ToS-compliant way to check Bing's actual index status, so the surface intentionally never claims one; the receipt trail says "I told Bing," never "Bing indexed this." The optional Bing Webmaster quota check is unverified end-to-end against a real Bing Webmaster account in this session (no such key exists for any tenant yet) - its unit tests cover the request/response contract and every fail-soft branch, but the first real call will only happen once an operator connects a real Bing Webmaster Tools account. Because no tenant has a key configured, the verify-live wiring's ping call path (`pingIndexNowForUrl` actually hitting the network) has only been exercised under mocks, never against the real `api.indexnow.org` endpoint from this environment - this is intentional per the task's hard rule against sending a real ping for a fake key, and the protocol client's own tests independently pin its request/response handling against every documented status code.

**Next action:** the operator generates an IndexNow key, uploads the key file to `iranopedia.com`, and pastes the key into the new IndexNow section on `/diagnostics/connectors`; the very next operator-approved live publish will automatically ping Bing with zero further code changes, and the receipt trail will start showing real "I told Bing" lines.

## 2026-07-02 - Portfolio circuit breaker: autopilot pauses itself after consecutive losses (BEACON_500 item 80, worktree, NOT committed)

**What changed:** new `src/domains/autopilot/circuit-breaker.ts` (pure). `evaluateCircuitBreaker({ proofRecords, receipts, now, config? })` decides TRIP when either gate fires: (a) the last two consecutive SETTLED ship batches each net negative, where a "batch" groups `shipped_change_proof` rows by Pacific ship date (the table carries no plan/batch id today - confirmed by grep across the proof-gsc and experiments domains - so this follows the task's fallback instruction), "settled" mirrors `autopilot-policy.ts`'s own DECIDED_VERDICTS (won/lost/inconclusive; measuring and insufficient_data never count), and the per-record outcome is a straight re-read of the SAME basis-window lift the proof lane already computes (`adjustedLift`/`adjustedCtrLift`/`adjustedPosLift`, chosen by the record's own `pickProofMetric`) - no new math; or (b) >= N (default 2) rollback (autopilot revert) receipts fired within a trailing window (default 7 days), read from the existing `AutopilotReceipt` `kind: "revert"` field. Output carries `{ tripped, reason (first-person, real numbers, no dashes), evidence (the exact batches/rollback timestamps cited), sinceIso }`. FAIL-SAFE: malformed input or a thrown error inside evaluation degrades to `{ tripped: false }` with a diagnostic reason - a bug in the breaker can never itself pause a healthy tenant, only real settled evidence can.

**Persistence (extended, not rebuilt):** `autopilot-store.ts`'s existing `AutopilotState` (already a registered Supabase-mirrored singleton, `"autopilot-state"` in `store-classification.ts`) gained an additive `circuitBreaker: CircuitBreakerState` field (`{ tripped, reason, trippedAt, sinceIso, resumedAt }`), normalized fail-soft to "never tripped" on any malformed/missing data. New `tripCircuitBreaker()` persists a fresh trip and always clears any stale `resumedAt` (a new trip can never be masked by an old resume). New `resumeCircuitBreaker()` is the operator's one-click undo - clears `tripped` and stamps `resumedAt`; this IS the consecutive-loss counter reset, since the run path only re-evaluates the breaker when it is not already tripped, so resuming lets the very next settled batch start a clean count. No new json-store was needed; `store-classification.ts` required no edit (the store name/registration is unchanged, only its JSON shape grew additively).

**Enforcement:** `run-autopilot.ts` (the nightly pass that both `/api/cron/autopilot` and, transitively, the auto-accept path call) gained a breaker check inserted after the publishing/target guards and BEFORE the daily-run marker stamps: an already-tripped breaker returns instantly (`breakerTripped: true`, no candidate load, no day stamp, so a paused night never even counts as "ran today"); otherwise the breaker is re-evaluated fresh off the current settled ledger + receipts every run, and a NEW trip this run also pauses THIS run (never ships one more batch after the evidence is already in) and persists via `tripBreaker`. `runRevertPass` (item 11's automatic rollback pass) is called later in the same function, so a tripped breaker pauses both shipping and reverting in one gate. A breaker LOAD error (not a trip - a genuine I/O failure loading proof records/receipts) is caught, logged loudly, and the run continues (fail-safe direction: an outage in the breaker's own inputs must never block a healthy tenant). Manual operator actions (the existing `/recommendations` accept path) are untouched - only the autonomous nightly path is gated.

**The card:** new `circuit-breaker-card.tsx` (client, self-hiding, "I paused myself" with the real-number reason line, "what is paused" / "what still works", one-click Resume calling the new `circuit-breaker-actions.ts` server action `resumeAutopilotCircuitBreaker` gated behind `canPublishForCurrentTenant`), `circuit-breaker-section.tsx` (server wrapper, fail-soft to null, sibling pattern to `OpsPipelineSection`). Mounted with ONE line + import in `src/app/(shell)/page.tsx` (Today) right before the team standup, so a paused autopilot is the first thing seen; also mounted inside the existing `AutopilotCard` on `/settings/connectors` (loads its own `CircuitBreakerCardView` alongside its existing settings load, same self-hiding component).

**Verified:** `npm run typecheck` 0 errors repo-wide. 70 new/updated targeted tests across 3 files, all green: `circuit-breaker.test.ts` (25 - `outcomeOf` per-metric reads incl. picking the longest ran window, `groupIntoSettledBatches` grouping/exclusion/summing, `countRollbacksInWindow`, both trip gates with boundary cases - exactly-zero net is not negative, a single negative batch never trips, a batch with zero settled rows is skipped entirely, custom config thresholds, the rollback gate checked independent of and before the batch gate - fail-safe on malformed `proofRecords`/`receipts`/`now`/`windows` and on a thrown error, plain-language dash-guard and first-person/owns-the-miss copy checks), `autopilot-store.test.ts` (+8 for `getCircuitBreakerState`/`tripCircuitBreaker`/`resumeCircuitBreaker`, incl. a stale-resume-cleared-on-fresh-trip case, a malformed-persisted-state-normalizes-safe case, and resume never touching the rest of config/receipts), `run-autopilot.test.ts` (+5 for pause enforcement: already-tripped skips before the day marker, a fresh trip mid-run pauses AND persists, a healthy breaker never blocks, a breaker load error fails safe and the run keeps going, 2 rollbacks pause even with healthy ship batches). Full `tests/domains/autopilot/` sweep re-verified green: 164 tests across 7 files, zero regressions.

**Ground truth (real Iranopedia, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs <probe>`, read-only, no persistence):** 25 real `shipped_change_proof` rows: 16 measuring, 5 inconclusive, 3 lost, 1 won (the "1 won / 3 lost / rest measuring" ledger). Grouped into exactly 2 settled batches by Pacific ship date: `2026-06-21` (7 settled changes, netOutcome = **+12.43**, dominated by a `section_add` clicks win of +12.44 that outweighs several small negative CTR/clicks reads on the same night) and `2026-06-19` (2 settled changes, netOutcome = **-0.01**, both `meta`-lever CTR reads, essentially flat-negative). **Honest answer: the breaker would NOT trip today.** Reasoning: gate (a) needs the last TWO CONSECUTIVE settled batches to both net negative - only one of the two real batches is negative (and only barely), so the consecutive-negative condition is false; gate (b) needs >= 2 rollbacks in the trailing 7 days - `autopilot-state`'s receipts array is empty (0 total, 0 revert-kind) for this tenant today, so that gate is also false. Autopilot itself is `enabled: false` for tenant-iranopedia right now, so this is a dry evaluation of what the breaker sees, not a live pause decision.

**Honest caveats:** the batch-by-ship-date grouping is a deliberate fallback (no plan/batch id exists on the ledger today) - a night that ships across a Pacific-midnight boundary, or a future plan/batch id landing on the ledger, would change what counts as "one batch"; this can be swapped for a true plan/batch key later as a pure input-shape change with no call-site rewrite. Mixed-metric batches (clicks + CTR + position summed together for the single netOutcome number) means a batch's sign can be dominated by whichever lever happens to carry the largest magnitude that night, which is honest (each record's own already-computed number) but not unit-normalized across metrics - the plain-language reason line names the clicks total specifically when clicks dominate, and falls back to a more general phrase otherwise. The rollback-count gate has never been exercised against real production revert receipts (this tenant's revert history is empty), so its real-data path is verified by unit tests with synthetic receipts, not by this ground-truth run.

**Next action:** the operator can arm autopilot for tenant-iranopedia (`/settings/connectors`) to start feeding the breaker with a live nightly evaluation; nothing else is required for the breaker itself to start protecting a future armed run.

## 2026-07-02 - Passage-level quotable coverage per fanout question (BEACON_500 item 78, worktree, NOT committed)

**What changed:** `extractability.ts` grades a whole page on coarse factors (has FAQ, has schema, word count). New `src/domains/pages/passage-answerability.ts` (pure, no I/O) is one layer more precise: it splits a page's content body (`page_snapshots.body_paragraph_sample`, or raw text) into paragraph-ish passages and scores EACH passage against a target question on 4 quotability rules mirrored from `competitor-page-audit.ts`'s existing answer-block heuristic (that file untouched, per scope) - self-contained 30-70 words, entity-named first sentence (no pronoun opener like "It is..."), a concrete number or date, and shares the question's own content terms. `scorePassageForQuestion` returns a 0-100 score (25 points per rule) plus plain-English fixes phrased as instructions ("Name the subject in the first sentence instead of opening with 'it'"), never lint labels. `scoreQuestionAgainstPassages` picks the best passage per question, preferring one that at least addresses the question's terms over a better-formatted but off-topic one (a clean, unrelated passage must never look like coverage). `computePageAnswerabilityCoverage` rolls this up per page across all target fanout questions into `{coveragePercent, bestPassage, uncoveredQuestions}` - an empty question list or a page with no passages yields an honest 0%/empty result, never a fabricated pass.

**Draft-quality wiring (additive, owned slice):** `src/domains/drafts/draft-quality.ts` gained a new `not_quotable` status and a 7th check inside `evaluateDraftQuality`, run only after every earlier check already passed: a draft whose text fails `pronoun_opener` OR `not_self_contained` (checked via `checkPassageRules`, using the draft's `query`/`topicLabel` as the target question) is rejected the same way a generic/thin draft already is, with `canRegenerate: true`. Deliberately narrow to just those 2 of the 4 rules: checked against the real Iranopedia draft corpus in the existing test fixtures, several genuinely-good "ready" answers (ab-2 Nowruz USA, ab-3 Persian wedding) carry no digit at all and would have been wrongly rejected by a "must have a number" or "must match query terms" hard gate - the item's own additive/pin requirement ("existing verdicts for passing drafts must not change") ruled that out, so `no_number_or_date` and `off_question` stay informational (only surfaced when the OTHER checks already fail) rather than rejecting on their own.

**Surface (one owned component):** `/diagnostics` already renders whole-page extractability via `ExtractabilitySection`; added a sibling `QuotableCoverageSection` right after it in `src/app/(shell)/diagnostics/page.tsx` - "What AI can quote here": pages-checked / avg coverage / pages-with-gaps stat blocks, then a disclosure listing each gapped cited page's coverage percent, its single best passage (truncated), and up to 3 unanswered AI questions with one-line reasons. Loads `loadFanoutSeedsForTenant` once at the page's existing tenant-scoped Promise.all data-fetch (both the loader and the token-overlap matcher `fanoutSeedsForNode` are pre-existing, unedited) and threads a new `fanoutSeeds` field onto the existing `DiagnosticsContext` type.

**Sub-wire evaluated and SKIPPED with reason (not forced):** the item asked to thread passage failure reasons into the LLM answer-block drafter's `evidenceHints` IF a clean optional param already exists. `llm-answer-block.ts`'s own `AnswerBlockDraftInput` has no such param. `structured-drafter.ts`'s `AnswerBlockStructuredInput` DOES carry a pre-existing `evidenceHints?: string[]` seam (already used by `prepare-today-moves.ts`'s `evidenceHintsFor`), but threading REAL passage failures through it would require passage-level content that does not exist on the `EvidencePacket` at draft time (only structural facts from the competitor audit, no body-paragraph field) - fabricating a generic instruction instead of a genuine failure reason would violate the item's own "thread the failure reasons" wording, so this sub-wire is left undone on purpose rather than faked with placeholder guidance.

**Verified:** `npm run typecheck` 0 errors project-wide (this change introduces none; 0 pre-existing errors found in a fresh run either). 24 new/updated targeted tests: 21 in `src/domains/pages/passage-answerability.test.ts` (passage splitting incl. array/blank-line/single-newline/empty inputs, each of the 4 rules individually incl. their fix-text wording, score math incl. the 0/25/50/75/100 ladder, best-passage selection incl. the addresses-question-over-better-formatting preference, per-page coverage math incl. 100%/partial/0%-honest-empty/no-questions-yet cases), 7 in `src/domains/drafts/draft-quality.test.ts` (4 PIN tests reproducing the exact real Iranopedia fixtures already in the suite to prove they still pass, 3 NEW tests: pronoun-opener rejection, under-30-word rejection above the pre-existing 25-word floor, and a no-number-at-all draft that must still pass). Re-ran the full `src/domains/pages/`, `src/domains/drafts/`, and `src/domains/demand-graph/` directories (503 tests, 24 files, all green) plus the 3 most relevant diagnostics architecture tests (`diagnostics-page-dynamic.test.ts`, `diagnostics-no-module-level-state.test.ts`, `indexability-diagnostics-operator-only.test.ts`, 21 tests, all green) to confirm no regression from the `DiagnosticsContext` type/data-fetch change.

**Ground truth (real tenant-iranopedia, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs <probe>`, read-only):** the synced `page_snapshots` (217 rows) ALL pre-date the `body_paragraph_sample` field (Plan A/B1, 2026-04-20 per the type's own doc comment) - confirmed by field-presence count: 0 of 217 rows carry it. `profound_fanout_rows` is also empty for this tenant (0 fanout seeds via `loadFanoutSeedsForTenant`). Both are honest pre-existing data gaps, not bugs in this module - `/diagnostics` will show the correct empty state today. To still ground-truth real numbers, live-fetched 5 real Iranopedia URLs (read-only, one fetch each, same technique as `ground-truth-expert-rec.ts`) and extracted a real `PageSnapshot` via the existing `extractPageSnapshot`, then scored each against its own H2 headings turned into questions (a fair stand-in for fanout questions when none are synced): `iran-timeline` **100%** coverage, best passage (score 100): "Following the fall of the Achaemenid Empire, Alexander the Great's successors engaged in the Wars of the Diadochi, a series of brutal conflicts that lasted around 60 years. These wars were highly destructive, comparable to the Mongol conquests..."; `iran-flags` **50%**; `funny-farsi-phrases` **50%**; `persian-kabobs/barg-kabob` **0%**; `persian-kabobs/joojeh-kabob` **0%** (both kabob pages genuinely have 0 `<p>` tags in their live HTML - confirmed via a direct curl + grep - so `body_paragraph_sample` legitimately extracts nothing; this is a pre-existing `extractor.ts` gap on that page template's markup, out of this item's ownership, reported not fixed). Average across the 5 real pages: **40%**. Draft-rejection impact: read all 11 real `answer_block` prepared-move drafts synced for this tenant and ran the new quotability check against each - **0 newly rejected**. All 11 open by naming their subject first ("The Iranopedia page...", "The Iran 1998...", "Onager: The onager...", etc.) and sit in the 39-52 word range, so the additive design holds on real production data, not only on synthetic fixtures. Also surfaced in passing (not fixed, out of this item's ownership): draft #1 ("The Iranopedia page 'Early Safavid dynasty flag' describes...") reads exactly like the pre-existing `META_NONANSWER` pattern is meant to catch but doesn't, because the quoted page title in the middle of the sentence breaks that regex's `the\s+\w+\s+page\s+describes` direct-adjacency requirement - a real, separate gap in `draft-quality.ts`'s existing rule set, unrelated to and not touched by this item.

**Honest caveats:** the 40% average and the 5-page table come from a live fetch, not the synced Supabase snapshot store, because the synced data has no paragraph text yet - this is disclosed above, not hidden. The self-contained word band (30-70) and the coverage threshold (75/100 = at most one rule failing, gated so `off_question` failing alone can never count as coverage) are judgment calls tuned against the real draft corpus and the AEO 40-60-word norm cited in the item; they are documented in the module's own comments and easy to retune if real usage disagrees. `QuotableCoverageSection` only evaluates pages that have BOTH `body_paragraph_sample` AND at least one matched fanout question, so on tenant-iranopedia today it will render its honest empty state ("No cited pages have both saved content and AI fan-out questions to check yet") rather than the live-fetch numbers shown here - those came from a separate, one-off ground-truth script, not the shipped surface itself.

**Next action:** none required from the operator for this item specifically; `QuotableCoverageSection` will start showing real per-question numbers automatically the moment either a fresh crawl repopulates `body_paragraph_sample` (the field already exists in the type, extraction already writes it, so this is a data-freshness gap that closes on the next scan) or `profound_fanout_rows` gets synced for tenant-iranopedia, whichever lands first - zero further code changes needed.

## 2026-07-02 - Citable dataset pages from owned data with Dataset schema (BEACON_500 item 76, worktree, NOT committed)

**What changed:** new `src/domains/datasets/` domain (tenant-generic, no topic hardcoding). `dataset-candidates.ts` detects two kinds of "be-the-source" opportunity purely from data SHAPE: (a) `page_family` - clusters of the tenant's own pages sharing a structural fingerprint (same `schema_types` set + a recurring generic-word H2 shape, e.g. "History"/"Meaning"/"Population"), never grouped by topic vocabulary; (b) `beacon_aggregate` - stats pages built from data ONLY Beacon holds (the tenant's own GSC query universe size + impressions, and the AI fanout sub-query universe). Ranked by real demand (summed GSC impressions across a family, or the aggregate's own query/fanout count), top 3 returned as `DatasetCandidate` objects with `{slug, title, description, columns, rowCountEstimate, sourceFamilies, methodologyLine (dated, honest), whyItWins, demandScore, datasetTag}`. `dataset-schema.ts` has a PURE `composeDatasetSchema` emitting valid schema.org Dataset JSON-LD (name/description/dateModified/creator from business config/license/variableMeasured from columns) - kept in its own module per the item's explicit instruction not to touch `expected-schema.ts`/`draft-enrichment.ts` (another in-flight item owns those). `dataset-page-spec.ts` builds the full page brief (sortable table spec, methodology line, the exact "Cite this page: `<title>`, `<site>`, updated `<date>`." block, the composed JSON-LD) and adapts a `DatasetCandidate` into the page-factory's own `PageCandidate` shape.

**Wiring (additive, 2 files):** `production-line.ts` calls `loadDatasetCandidatesForTenant` alongside the existing entity-attribute `loadPageCandidates`, merges dataset candidates into the `passed` list as pre-validated `graph_demand` verdicts carrying their OWN real, measured demand number (stronger proof than the generic label-matcher's coincidental token overlap, so they bypass `validateCandidateDemand` rather than fight it) - `validate-demand.ts`/`dedupe-candidates.ts` themselves are untouched, only their call site gained a second input stream. `batch-store.ts` gained one additive optional field, `datasetTag?: "dataset_page"`, on `FactoryBatchItem` so a dataset-sourced item can be told apart later; set on `production-line.ts`'s item-push when the slug came from the dataset stream. Since a published factory-batch item always records `actionType: "create_page"` (already in `citation-outcome.ts`'s `CITATION_RELEVANT_ACTIONS`), dataset pages automatically qualify for AI-citation attribution once shipped - no edit needed to the citation-outcome lane itself. Rendering rides the EXISTING `PageFactoryBatchCard`/`page-factory-batch-data.ts` untouched (verified: neither branches on `attribute`, both already show title/why/demand-badge/status/brief generically) - confirmed this is genuinely the only place New Pages candidates render today (checked the worklist New Pages board first, per the item's own instruction).

**Verified:** `npm run typecheck` 0 errors project-wide. 44 new/updated targeted tests, all green: `dataset-candidates.test.ts` (16 - family clustering incl. tenant-agnostic vocabulary swap proof, min-size gating, no-structural-signal exclusion, demand summation incl. zero-demand honest fallback, schema-type title fallback when no H2 shape token exists, both `beacon_aggregate` builders, ranking incl. tie-break, no-em-dash guard), `dataset-schema.test.ts` (9 - valid Dataset shape, dated `measurementTechnique`, url/@id with and without a page path, null on unusable domain, creator-name fallback, script-tag wrapper), `dataset-page-spec.test.ts` (7 - the exact cite-line sentence, full brief assembly, graceful null-jsonLd degradation, the PageCandidate adapter), plus re-ran `src/domains/page-factory/` (74 tests, all green, confirms the additive wiring never changed a single existing production-line/batch-store/dedupe/validate-demand assertion) and `src/domains/proof-gsc/citation-outcome.test.ts` (33 green, confirms `create_page` attribution is untouched).

**Ground truth (real tenant-iranopedia, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs <probe>`, read-only):** first probe attempt read 0 page_snapshots rows via the generic `getPageSnapshotsForTenant` json-store path - root-caused to `page-snapshots` not being in `SUPABASE_MIRRORED_STORES` (that table is dual-written directly by `dual-write.ts`'s `syncPageSnapshots`, bypassing the generic mirror), so the loader was rewritten to read `page_snapshots` DIRECTLY from Supabase (paginated, 1000-row pages, capped at 5 pages), confirming 217 real rows exist for this tenant. Second finding: page-family demand summed to 0 because `page_snapshots.url` carries the `www.` host while the demand graph's `pageNodes[].url` (GSC-derived) carries the bare host - fixed by joining on the shared `canonicalizeCitationUrl` key (same util `citation-outcome.ts` already uses for the identical www-mismatch problem) instead of the raw URL string. **Real top 3 for tenant-iranopedia today:** #1 "The 1,122 Real Questions People Search For This Site" (`beacon_aggregate`, 1,122 rows, demandScore 500,600 real GSC impressions); #2 "ImageObject Data: 84 Pages Compared" (`page_family`, 84 rug-gallery pages sharing the `ImageObject` schema type, demandScore 129,498 impressions); #3 "Product Data: 32 Pages Compared" (`page_family`, 32 merch-store pages sharing the `Product` schema type, demandScore 20,581 impressions). Verified the full page-brief + Dataset JSON-LD end to end for the #1 candidate against the tenant's real business config (name "Iranopedia", domain "iranopedia.com") - valid `@type: Dataset`, correct `creator`/`url`/`@id`/`variableMeasured`, and the exact cite line "Cite this page: The 1,122 Real Questions People Search For This Site, Iranopedia, updated 2026-07-02."

**Honest caveats:** `profound_query_fanout_rows` is empty for tenant-iranopedia today (0 fanout sub-queries), so `buildFanoutVolumeCandidate` never fires on real data yet - it is unit-tested against synthetic input only; it will start producing a real 3rd/4th candidate the moment a fanout sync lands rows for this tenant (zero further code changes needed, same "closes on next sync" pattern as item 78's coverage gap). The 84-page ImageObject family and 32-page Product family both carry NO recurring H2 shape token (their only real H2 is a generic "Iranopedia" nav heading), so their compiled table only has an "Entity" + "Page Type" column - a genuinely thinner dataset than a family with real per-page facts like the 8-page Tabriz/Isfahan/Kerman city-profile cluster also found in the same data (population/climate/facts H2s) but which did not make the top 3 by demand this run; the detector and ranker are working as designed, this is just what today's real demand numbers produce. `MAX_SUPABASE_PAGES = 5` (5,000-row ceiling) is a defense-in-depth constant, not yet exercised against a tenant with more than 217 snapshot rows.

**Next action:** none required from the operator for this item specifically - dataset candidates will start appearing on the existing "This week's page factory batch" card on `/worklist` automatically the next time `runProductionLineForTenant` runs for a tenant with a qualifying family or aggregate size, with no new UI to build or flag to flip.

## 2026-07-02 - BEACON 500 wave 6 boundary (items 69-80)
- Full suite, clean shell (env -i, redirected to file): 19,148 passed / 5 failed -> 5 fixed (async SovWeeklySection mounted as JSX suspended renderToStaticMarkup in the /prompts route tests; awaited as a function call per the item-75 precedent) -> re-run of both files 7/7 green. Effective 19,153 / 0.
- npm run build: exit 0. npm run typecheck: 0.
- Slice-15 combined targeted run: 873 tests green across ai-visibility/datasets/pages/drafts/page-factory/triggers/autopilot/indexnow/push + dash and catalog guards.
- Integration wiring verified: specialistWeight threaded into all 3 routeMove call sites + reviewCandidateWithTeam; pageFamily threaded into both production drafter call sites.
- No new migrations this wave (stores: indexnow-config, indexnow-receipts registered + mirrored).

## 2026-07-03 - Cron health ledger + failure streak escalation + Google token-expiry warning (BEACON_500 items 85 + 84, worktree, NOT committed)

**What changed (item 85, the substrate):** new `cron_runs` table (`migrations/2026-07-03_cron_runs.sql`, NOT applied - the orchestrator applies migrations). Additive, idempotent (`CREATE TABLE IF NOT EXISTS`), RLS `deny_anon` + `tenant_authenticated_rw` (allows `tenant_id IS NULL` fleet-level rows, mirrors `gsc_backfill_progress`/`outreach_pipeline`). New `src/domains/ops/cron-runs-store.ts`: `recordCronRun` (fail-soft by contract, never throws) + `listRecentCronRuns`, following the `shipped-change-store.ts`/`outreach-store.ts` PGRST205/42P01/PGRST204 file-fallback pattern exactly (registered `cron-runs` + `token-expiry-warnings` in `store-classification.ts` as GLOBAL). Wired into `syncAllConnectedForActiveTenants` (`src/lib/connectors/cron-sync.ts`, owned this slice - one ledger write per run, wrapped in its own try/catch after the real sync result is computed) and `/api/cron/measure-due` (one row per run). New `src/domains/ops/cron-schedule-map.ts`: a hardcoded static mirror of `vercel.json`'s `crons` array (never parses vercel.json at runtime on Vercel) with a `nextScheduledRun` cron-time calculator; pinned by `cron-schedule-map.test.ts`, which reads the REAL `vercel.json` at test time and fails if the map drifts. New `src/domains/ops/cron-health-view.ts` composes the ledger into plain English ("I showed up 7 of 7 nights this week. Search Console synced 7 of 7 nights.") and a new panel `src/app/(shell)/settings/connectors/cron-health-panel.tsx` renders it, mounted with one line on `/settings/connectors` (the real route - confirmed `/settings/connections` is the nav label, not a separate route).

**What changed (item 84, escalation):** `src/domains/ops/cron-streak.ts` derives consecutive-failure streaks per (tenant, provider) FROM the `cron_runs` ledger's `per_source` results (one source of truth, no parallel counter on `connector-store.ts`). New trigger `src/domains/recommendation-intelligence/triggers/connector-failure-streak.ts` (pure wrapper, same shape as `sov-drop-alert.ts`) fires a `watch`-action fix card at 3+ consecutive failed nights, naming the real provider, the night count, and the real last error, with the reconnect path; wired additively into `load-trigger-candidates-for-tenant.ts` (predicate count 17 to 18) and a new `connectorFailureStreakCopy` template in `customer-copy-templates.ts` (no dashes). Google token-expiry forecast: `src/domains/ops/token-expiry-forecast.ts` computes days-until-Testing-mode-refresh-token-death from a Google connection's `connected_at` (stable across access-token refreshes, confirmed by reading `updateConnectorToken`'s `GoogleConnectorPatch` type - it has no `connected_at` field). `src/domains/ops/token-expiry-notify.ts` orchestrates the T-2-day check: sends ONE email via the EXISTING `src/lib/email/resend.ts` channel to the single configured operator inbox (`BEACON_DIGEST_TO` - this is a single-operator app, there is no per-tenant operator-email field, confirmed by search), never emails anyone else, skips and logs honestly when unconfigured. Dedupe via `src/domains/ops/token-expiry-warning-store.ts`, keyed on `connected_at` so a reconnect opens a fresh warning cycle. Both wired into `cron-sync.ts` as an isolated PHASE 5 try/catch (item 84) plus the PHASE-5-adjacent ledger write (item 85), after everything else so a failure here can never delay or break the real sync.

**Verified:** `npm run typecheck` 0 errors project-wide. 105 new/updated targeted tests across 11 files in `src/domains/ops/` (cron-runs-store, cron-schedule-map incl. the live-vercel.json pin, cron-streak, cron-health-view, token-expiry-forecast, token-expiry-notify, token-expiry-warning-store) plus `connector-failure-streak.test.ts` (10), all green. Browser-verified live on the running dev server: `/settings/connectors` renders the new "How reliably I show up" panel server-side for all 7 scheduled jobs (confirmed via `curl` on the raw HTML and a live browser screenshot), each honestly showing "I have not run yet" / "No history yet" since `cron_runs` does not exist yet - proving the PGRST205 file-fallback engages correctly pre-migration with zero error boundary.

**Ground truth (real tenant-iranopedia, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/_cron-health-probe.ts`, read-only except one probe ledger write that hit the file fallback):** real connector states today - `google_gsc` connected, `connected_at` 2026-06-23T01:40:38Z (grant age 9.77 days, Testing-mode refresh token already **2 days past its 7-day death window**), `last_synced_at` 2026-07-02T17:19:39Z (still syncing - the 401 `invalid_client` errors seen live in the dev logs are a separate, already-documented `GOOGLE_CLIENT_SECRET` misconfiguration, not this feature); `google_ga4` connected, `connected_at` 2026-06-26T16:45:02Z (grant age 6.14 days, **1 day left** in its Testing-mode window - would trigger the T-2 email tonight if `BEACON_DIGEST_TO`/`RESEND_API_KEY` were configured); `google_gbp` not connected; `clarity` connected, `connected_at` 2026-06-18T20:25:40Z (grant age 13.99 days - Clarity is not Google OAuth so the 7-day Testing-mode rule does not apply to it, listed for completeness only); `profound` connected, `connected_at` 2026-06-22T18:27:08Z (grant age 10.07 days, N/A - also not Google OAuth). The `cron_runs` table does not exist in the real `beacon-main` Supabase project yet (confirmed live: `PGRST205 Could not find the table 'public.cron_runs' in the schema cache`) - the probe's write correctly fell back to `.data/global/cron-runs.json` (cleaned up after verification, `.data/` is gitignored). `BEACON_DIGEST_TO` and `RESEND_API_KEY` are BOTH unset in `.env.local` today, so `checkTokenExpiryForTenants` correctly skipped every provider with `action: "skipped_not_configured"` and logged honestly - no email was sent by this probe run despite `google_ga4` being at the T-2 threshold, confirming the "never send when unconfigured" safety rule holds on real data.

**Honest caveats:** the failure-streak trigger and the health panel's streak section are unit-tested against constructed fixtures only - the real `cron_runs` ledger has zero history for tenant-iranopedia today (pre-migration), so neither can be demonstrated with real streak data yet; both will start producing real numbers the moment the migration is applied and a few nightly cron runs accumulate. The connector-state findings above surface TWO pre-existing, already-documented issues this item did not cause and does not fix: the `GOOGLE_CLIENT_SECRET` misconfiguration (real root cause of "revoked" errors, tracked separately) and the Google OAuth app's "Testing" publishing status (root cause of the literal 7-day refresh-token death this item's forecast exists to warn about) - publishing the OAuth app in Google Cloud Console remains the actual fix for the underlying expiry; this item only makes the countdown visible and adds a warning email.

**Next action:** apply `migrations/2026-07-03_cron_runs.sql` (additive, safe to run anytime); set `BEACON_DIGEST_TO` + `RESEND_API_KEY` in the environment so the T-2 warning email can actually fire (it is fully wired and tested, just unconfigured today); optionally publish the Google OAuth consent screen to stop the 7-day expiry cycle at its source.

## 2026-07-02 - Bounded main-content excerpt extraction + backfill helper (MASTER PLAN v2 item N19, worktree, NOT committed)

**What changed:** `src/domains/pages/extractor.ts` - `body_paragraph_sample` extraction fixed in two ways: (1) cap raised from 10x300 chars (~3k) to 20x300 chars (~6k, the item's target), fair per-entry truncation; (2) a leaf block-level fallback (`div, span, li, dd, blockquote, figcaption` with no element children, generic 8-word floor) that fires only when the primary `<p>`-tag pass finds zero usable paragraphs - fixes the exact kabob-page-shape gap named in the 2026-07-02 handoff (passage-answerability item 78). Also added `normalizeExtractedText`, which strips zero-width space/ZWNJ/ZWJ/BOM/NBSP before word-counting, so editor-placeholder `<p>` tags (real Wix pattern, confirmed live) correctly read as empty instead of "1 word." `src/domains/pages/types.ts` doc comment updated to match. New `src/domains/pages/content-excerpt-backfill.ts`: `runContentExcerptBackfill(tenantId, { limit })` (default 20, hard-capped 100) finds pages missing an excerpt via a lean tenant-scoped Supabase read, re-fetches via the existing polite fetcher, re-extracts, and persists via `syncPageSnapshots`, preserving the original row's id/fetched_at. Fail-soft (PGRST204/PGRST205/42P01 -> empty candidate list; per-page fetch failure recorded, never throws).

**No migration:** confirmed live against the real `beacon-main` Supabase project that `page_snapshots.body_paragraph_sample` already exists as a live `ARRAY` column - the gap was extraction quality, not schema, so no migration file was needed or written.

**Verified:** `npm run typecheck` 0 errors project-wide. 25 new targeted tests (8 `extractor.test.ts`, 17 `content-excerpt-backfill.test.ts`), all green; full `src/domains/pages/` suite 328 tests green. One pre-existing failure unrelated to this item found in `src/domains/language-gap/language-gap-surface-pins.test.ts` (caused by other in-flight uncommitted work already in this worktree - `build-today-preview.ts`/`debate-summary.ts` changes from a different item - confirmed by isolating this item's diff alone, which does not reproduce the failure; not fixed, out of N19's ownership).

**Ground truth (real tenant-iranopedia):** live-fetched the exact two zero-paragraph kabob pages named in the handoff (`/persian-kabobs/barg-kabob`, `/persian-kabobs/joojeh-kabob`) - both are genuinely empty JS-rendered Wix shells server-side (7 body words total, zero-width-space-only `<p>` tags, no recoverable text at any DOM depth) and honestly stay at 0 paragraphs; this is a real client-side-rendering ceiling, not a bug in this extractor. `/iran-animals`, a different real page with actual intro prose in a leaf `<span>` and zero `<p>` tags in `<main>`, went from 0 to 1 real paragraph recovered (226 chars). `/iran-timeline` and `/funny-farsi-phrases` (already had real `<p>` content) grew from the old 10-entry cap to the new 20-entry cap, reaching 5,711 and 3,786 excerpt chars respectively. Verified a downstream consumer read-only: fed the fixed extractor's `/iran-animals` output into `computePageAnswerabilityCoverage` (item 78, not touched) and coverage went from the previously-reported 0% to 67%. Ran `runContentExcerptBackfill("tenant-iranopedia", { limit: 5 })` for real against production Supabase: 13 candidates found, 5 attempted, 3 filled (homepage, `/iran-animals`, `/iran-world-cup-jersey-evolution`), 2 correctly still empty, 0 fetch failures; confirmed by direct SQL read the writes landed and total row count held at 217 (no duplicate rows from the upsert). 10 rows remain (including the 2 genuinely-empty kabob pages, which will stay empty regardless of retries).

**Next action:** run `runContentExcerptBackfill` again with a larger limit (or wire it into a cron) to finish the remaining ~10 rows; the next full scan of any tenant fills this field automatically going forward with zero additional wiring.

## 2026-07-02 - Operator-experience fix batch C: /proof (Results) brutal-review fixes C1-C8 (worktree, NOT committed)

**What changed (display mapping only, no domain enum/measurement math touched):**
- **C1** (buried honest lead): new `buildZeroMatureLeadSentence` in `proof-summary-section.tsx` - when zero changes have a mature verdict, the top of "Proof at a glance" now reads "None of your N changes has a final verdict yet. The first ones are due [real weekday/any day now]. Early signals below can still flip." using the real ledger count + real soonest-checkpoint date (already computed for the calendar strip), replacing the old buried "No mature results yet." line further down.
- **C2** (15-way uncertainty thesaurus): new `src/app/(shell)/proof/proof-badge.ts` - `proofBadgeLabel`/`proofBadgeLabelFromVerdict` collapse the visible card badge to exactly six words (Waiting / Leaning good / Leaning bad / Helped / Did not help / No clear change) plus `proofBadgeMaturesOn` for the secondary "matures YYYY-MM-DD" text. The `measurement-maturity.ts` domain enum, `tone`, and `headline` fields, and `measure-lifecycle.ts`'s `proofMaturityLabel` are UNCHANGED (still pinned by their own tests) - the precise internal wording now renders only inside each card's "See the math" detail.
- **C3** (row-one contradiction): new `src/app/(shell)/proof/proof-reconciliation.ts` - `searchAndTrafficDisagree` compares the already-computed Search direction (`pres.direction`) against the already-computed traffic sign (`trafficOutcome.adjustedSessionsPct`); when they clash, the card shows "Google clicks and site visits disagree right now. That is common early. The 28-day Google read is the one that decides." directly under the Search line.
- **C4** (statistics as headline): new `src/app/(shell)/proof/proof-plain-search-line.ts` - `plainSearchHeadline` replaces the "We are X percent sure..." primary line with a plain call ("This is probably hurting." / "This helped." / "Not clear yet."); the full percent+range sentence (`selectHeadlineSentence`/`bayesianSentence`, untouched) now lives inside a new "See the math" `<details>` block per card.
- **C5** (untouched-pages trap sentence): the visible primary line is now "Pages I did not touch moved this much on their own, so this is normal noise, not proof yet." (or the strong-evidence variant at <=5%); the raw `permutationSentenceFromCounts` sentence (unchanged, still pinned) moved into "See the math".
- **C6** (banned word): `changes-v2-client.tsx`'s empty-state footer "Those are the experiments you shipped" -> "Those are the changes you shipped"; added this file to `proof-jargon-guard.test.ts`'s scanned `FILES` list (it renders inside `/proof` via `ResultsTimeline`) - "experiment" was already in `BANNED_WORDS`.
- **C7** (seasonal paragraph x15): the section-level line "`{n}` of these overlap the May-June demand swing for their topics, so I read them cautiously." now renders ONCE above the ledger (computed from a real per-row count); each affected card shows a small "seasonal swing overlaps" chip instead of the full paragraph, with the full sentence preserved in "See the math".
- **C8** (manual-change disclaimer): new `LedgerRowGroup` component in `page.tsx` splits each outcome band (Wins / What we learned / In flight) into "Changes Beacon recommended" and "Changes you made yourself (I am watching them too)" sub-groups by ActionPack-link presence; the old per-card "Manual or legacy change, not traced to a ranked move." line was removed (redundant with the group header).

**Verified:** `npm run typecheck` 0 errors project-wide. New `src/app/(shell)/proof/proof-plain-vocabulary.test.ts` (21 tests) pins all four new pure helpers. Targeted run: 50 test files / 664 passed / 1 pre-existing skip across `src/app/(shell)/proof`, `src/app/(shell)/changes`, `src/domains/proof-gsc`, `src/domains/seasonal`, `src/domains/action-pack` - zero regressions, including every previously-pinned string in `proof-jargon-guard.test.ts`, `measurement-maturity.test.ts` (`.headline` pins), `measure-lifecycle.test.ts` (`proofMaturityLabel` pins), `bayesian-read.test.ts`, and `permutation-null.test.ts`.

**Ground truth (real tenant-iranopedia, dev server, `curl -sL -m 180 http://localhost:3000/proof`):** confirmed live against 25 real tracked changes. Top-of-page lead: "None of your 25 changes has a final verdict yet. The first ones are due Saturday. Early signals below can still flip." Badge vocabulary confirmed collapsed to only Waiting/Leaning good/Leaning bad on every visible card (no "COLLECTING DATA"/"TOO EARLY TO CALL"/etc. outside the collapsed "See the math" detail). The exact `/cities` card named in the brief: badge "Leaning bad", "matures 2026-07-04", primary line "This is probably hurting.", reconciliation line "Google clicks and site visits disagree right now. That is common early. The 28-day Google read is the one that decides." directly above "Visitor traffic (12 days): +27% visits vs similar pages", plain permutation line "Pages I did not touch moved this much on their own, so this is normal noise, not proof yet.", and "See the math" containing the full "We are 71 percent sure this hurt, likely 19 fewer to 10 extra clicks a month..." and "Out of 60 untouched pages, 60 moved as much as this one did..." sentences unchanged. Section-level seasonal line read "19 of these overlap the May-June demand swing for their topics, so I read them cautiously." with exactly 19 matching per-card chips. "Changes Beacon recommended" / "Changes you made yourself (I am watching them too)" group headers confirmed rendering in 2 of the 3 outcome bands (the bands that actually mix both kinds of change).

**Honest caveats:** pre-existing em dashes found live in operator-typed `rec.notes` free-text ledger entries (e.g. "Daily experiment (meta) — verified live...") are unrelated data content, not generated copy, and out of this batch's scope (the jargon/dash guard only scans source text, not runtime ledger data). Not fixed here.

**Next action:** none required from the operator; this is a pure display-language fix, already live in dev. Recommended next: extend the same "See the math" collapse pattern to the `/changes/[id]` attribution drilldown, which still leads with the full statistics sentence on its own surface.

## 2026-07-02 - Operator-experience fix batch A: Today (/) brutal-review fixes A1-A10 (worktree, NOT committed)

**What changed (display/wiring fixes, no domain measurement logic touched):**
- **A1** (buried alert + lying hero): `OpsPipelineSection` moved to the very top of `page.tsx`'s `Cockpit`, above `PageHeader` and Tonight's card (self-hides when the pipe is healthy, unchanged). `ScoreboardSection` now takes `stale`/`staleCheckedAt` props (read once from `readPipelineHealth` in `page.tsx`) and renders an amber "numbers last updated `<date>`" badge next to the "AI recommended you N times" stat when the pipe is degraded. Updated the `ops-pipeline-section.test.ts` mount-order pin from "above the attention band" to "above the hero".
- **A2/A3** (contradicting counts): `page.tsx` now computes ONE canonical `measuringCount` from the proof ledger (`ledgerRows.filter(r => r.verdict === "measuring").length`, the same source `TeamStandup`'s Strategist chip already used) and threads it into `TeamStandup`, `TodayCounts` (the KPI tile), and `MeasuringSection` (the "Showing N of M" line) so all three agree. `FrictionFixesSection` in `war-room-sections.tsx` now computes `totalFriction` (all routed pages, matching the standup's "Behavior" chip count) and shows "showing 4 of 18 pages" instead of a bare "4 pages" with no total.
- **A4** (fake stat weight): `TeamStandup`'s AI-citation line now checks `MIN_TOPICS_FOR_RATIO = 3`; below it, renders "N topic(s) checked so far" instead of "cite you on N of M topics checked".
- **A5** (broken sentence): `funnelSummaryLine` in `crawl-citation-funnel.ts` now appends "of them" to each clause ("AI crawlers fetched N of them", "AI answers cite N of them") so a single-clause sentence reads as complete instead of stopping mid-thought.
- **A6** (jargon): added `plainSchemaTypes`, `plainSerpReason`, `plainPageParts` to `plain-language.ts` (display-only transforms, no domain enum changes). Applied at three Today render sites: `today-newpages-card.tsx`'s "Schema: Article, FAQPage" -> "Behind-the-scenes labels AI reads: Article, FAQ" (both the visible render and the copy-to-clipboard brief text); the live-SERP verdict reason "Content-page SERP (5/10 editorial), out-buildable." -> "Google's results here: 5 of the top 10 are articles, which you can compete with."; `daily-experiments-section.tsx`'s "Left untouched: title, H1, other body text, internal links, schema" -> "title, main heading, body text, links between your pages" (schema dropped, not user-editable).
- **A7** (boilerplate x3): "N competitor pages get cited for this, you have no page yet" (which also carried a pre-existing em dash) hoisted to the "New pages to build" section subhead in `today-newpages-section.tsx`; each card in `today-newpages-card.tsx` now shows only "N competitor pages cite this topic."
- **A8** (tiny-sample percent): added `smallSampleCount`/`parseRateFromEvidence` to `war-room-sections.tsx` - below 30 sessions, the friction evidence line now appends the raw count, e.g. "49.6% dead-click rate (3 of 6 visitors)". `routeClarityFriction`'s own thresholds (unchanged) mean the floor mostly matters in the 20-29 session band; verified the pure helper directly reproduces the exact "3 of 6 visitors" example from the review at 6 sessions/49.6%.
- **A9** (contradicting confidence badge): `CauseRow` in `investigation-section.tsx` now suppresses the "Medium confidence." badge specifically for `kind === "algorithm_weather"` causes, since that cause's own sentence already hedges ("this may not be specific to this page") - a site-wide finding no longer gets a page-level confidence label next to its own hedge.
- **A10** (done-but-nagging): `ExecutionChecklistView` in `daily-experiments-section.tsx` now renders "All applied. I am watching the results." instead of the "Apply each one in Wix..." instructions once `s.left === 0`.
- Bonus (same-file, same hard rule): removed 5 more pre-existing em dashes from `today-newpages-card.tsx` string literals encountered while fixing A6/A7 (not previously covered by a no-dash pin test on this file).

**Verified:** `npm run typecheck` 0 errors project-wide. Targeted vitest: 16 test files / 181 tests passed, 0 failures - `ops-pipeline-section.test.ts` (updated pin), `investigation-section.test.ts`, `daily-experiments-section.test.ts`, `scoreboard-section-money-lines.test.ts`, `today-newpages-full-page-draft.test.ts`, `today-newpages-wiki-gap.test.ts`, `daily-experiments-copy.test.ts`, `coverage-map-section.test.ts`, `crawl-citation-funnel.test.ts`, the five war-room-sections.tsx-scanning surface-pin suites (trend-radar/refresh/language-gap/ai-overview/seasonal, all re-verify the no-em-dash-anywhere rule against the file I edited), `today-view.test.ts`, and `today-kpis.test.ts`.

**Ground truth (real tenant-iranopedia, dev server, `curl -sL -m 120 http://localhost:3000/`):** confirmed every fix live in the rendered page in the same session: pipe alert renders before the hero stat (byte offset 115571 vs 180532) with the "numbers last updated Jul 2" badge actually showing (the dev pipe is genuinely degraded right now); "picked 6 changes tonight, 16 measuring, 1 won" / "16 Measuring" tile / "Showing 5 of 16 measuring" all agree; "friction on 18 pages" / "showing 4 of 18 pages" agree; "1 topic checked so far" (no ratio); "I tracked 43 pages through the AI funnel: AI answers cite 43 of them."; "Left untouched: title, main heading, body text, links between your pages"; New Pages subhead carries the competitor-cited sentence once, cards show "6 competitor pages cite this topic."; zero "Medium confidence." badges remain; "All applied. I am watching the results." replaces the apply instructions on the fully-applied batch. A6's schema-type and SERP-reason transforms were unit-verified directly (`plainSchemaTypes(['Article','FAQPage'])` -> "Article, FAQ"; `plainSerpReason(...)` -> "Google's results here: 5 of the top 10 are articles, which you can compete with.") since no card in the current live dataset happened to have a prepared brief or a just-run live SERP check to exercise that render path today.

**Next action:** none required from the operator; live in dev. Recommended next: the same "canonical count, list says showing N of M" pattern used for A2/A3 likely applies to other places /worklist and /proof independently compute their own subsets of the same underlying counts - worth a dedicated audit pass.

## 2026-07-02 - Operator-experience fix batch D: nav, settings, competitors, prompts brutal-review fixes D1-D12 (worktree, NOT committed)

**What changed (display language + one route-level test addition, no domain logic touched):**
- **D1** (honesty contradiction): `src/app/(shell)/settings/connectors/connectors-client.tsx`'s two intro paragraphs reworded. Old copy said "Beacon never runs in the background, only while you are actually using it" and "Nothing runs on a hidden schedule" directly above the "How reliably I show up" panel listing 7 nightly cron jobs. New copy: "Connecting a tool just gives Beacon access. From there, a nightly job keeps your data fresh and checks that each connection is healthy, and whenever you use the app it also quietly refreshes anything that has gone stale... The one thing that never happens on its own is a change to your live site, that only happens after your click, unless you arm autopilot yourself." Same honest reframe in the second panel.
- **D2** (engineer page reachable by customers): confirmed `src/app/(shell)/diagnostics/layout.tsx` ALREADY gates the entire `/diagnostics` route tree with `isOperatorModeServer()` + `notFound()` (pre-existing code, not written this batch) - every one of the 23+ pages under `/diagnostics` (including the one telling users to "Set BEACON_FOUNDER_NAMES in .env.local" and mentioning "known Bay Area geographies") is unreachable for non-operators. No source change needed; added new `tests/architecture/diagnostics-layout-operator-gate.test.ts` with both source-text pins AND two behavioral tests that actually call the layout function with `isOperatorModeServer` mocked false/true, proving `notFound()` throws for non-operators and children render unchanged for operators.
- **D3** (raw slugs as questions): `src/domains/ai-visibility/second-order-citations.ts` - `SecondOrderDomainPlaybook.examplePrompt` changed from `string` to `string | null`. New pure `cleanTopicPhrase` strips junk slug tokens (wiki, wikipedia, mag, magazine, blog, post, article, news, category, tag, page, index, home, archive, topic, product, products) and bare numbers from a topic label; when a real tracked prompt exists it's used unchanged, otherwise the framing changed from `"A question about ${primaryTopic}"` (which rendered raw slugs like "A question about wiki chaharshanbe suri") to `"It wins answers about ${cleanedTopic}."`, and the line is hidden entirely (`examplePrompt: null`) when nothing clean remains. `src/app/(shell)/competitors/second-order-citations-section.tsx` updated to skip rendering the line when null.
- **D4** (dead rows x19): `src/app/(shell)/competitors/page.tsx`'s "Pages to beat" section now filters to only rows carrying real teardown content (`pg.whatWins`), and collapses the unread remainder into one line: "N more competitor pages are queued; I read a few each night." instead of repeating "Not read yet" for every row.
- **D5** (non-answer x4): `second-order-citations.ts`'s `CLASS_ACTION.other` (and `suggestedActionFor`, which gained a 4th `citationCount` parameter, default 0 for back-compat) now reads "`${domain}` on `${topic}`: cited N times so far; after about `${OTHER_CLASS_CITATION_FLOOR}` citations I can name the exact page to pitch." instead of the flat "I don't have enough signal yet to say exactly how to get listed there." repeated verbatim for every "other"-class domain. New documented constant `OTHER_CLASS_CITATION_FLOOR = 10` (no existing floor to derive it from, so it is an explicit, commented choice).
- **D6** (cron jargon): `src/domains/ops/cron-schedule-map.ts` relabeled 4 of 7 display-only job labels: "Wix publish canary" -> "Wix connection check", "AI engine poll (Mon/Wed/Fri)" -> "AI answer check (Mon/Wed/Fri)", "Draft precompute warm pass" -> "Getting drafts ready", "Nightly measurement pass" -> "Nightly results check". The pin test (`cron-schedule-map.test.ts`) only asserts path+schedule against the real `vercel.json`, never label text, so no test needed updating - confirmed by inspection and a full test run.
- **D7** (secret settings wing): `src/app/(shell)/settings/page.tsx` rewritten from a bare `redirect("/settings/connectors")` into a real index page listing all 5 settings surfaces (Your business info, Connections, Imported history, Spend receipts, How Beacon measures) each with a one-line description and a link - `/settings/config`, `/settings/history`, `/settings/spend`, and `/settings/methodology` were previously reachable only by typing the URL directly (no tab in `settings-tabs-client.tsx` links to them). The tab bar itself is unchanged (Connections still deep-links from the tabs). Updated the one pin test (`tests/architecture/demo-path-fixes-2026-05-06.test.ts`) that asserted the old `redirect("/settings/connectors")` call; it now asserts the link exists in the new index page and the page still never defaults straight to Import.
- **D8**: `src/app/(shell)/settings/connectors/autopilot-card.tsx`'s "Proven change types on this site right now: 0" reordered to lead with the explainer: "A change type earns autopilot after 10 measured results here. So far: 0 have qualified." The redundant explainer sentence that used to live in the zero-state sub-line was trimmed to avoid repeating the same mechanic twice.
- **D9** (stat costume change): `/competitors`' `StatTile` and `/prompts`' `ai-questions-view.tsx` `Stat` components both gained an optional `subtitle` prop. "Competitor domains" on `/competitors` now shows "across all your topics"; "Rival domains cited" on `/prompts` now shows "on the questions I track" - the two differently-scoped domain counts (490 vs 195 in the review) no longer read as interchangeable metrics.
- **D10**: `src/app/(shell)/prompts/ai-questions-view.tsx` computes `citedRowsShown` (rendered rows where `!q.ownAbsent`) vs `totals.cited` (the tile's un-clustered total) and appends "(showing N of M cited)" to the existing "Showing X topics clustered..." line whenever clustering hides some cited rows.
- **D11**: `src/app/(shell)/ask/ask-chat-client.tsx` empty-state copy: "or the plan" -> "or tonight's plan on Today".
- **D12** (dash+jargon sweep): `src/domains/competitors/discover.ts`'s `suggestMove` copy had 2 em dashes ("Create content targeting ... — you have no citations there", "Strengthen ... — they lead with...") replaced with commas. `src/app/(shell)/settings/methodology/page.tsx` line 144 reworded from "Statistical confidence intervals — tiers are labels, not proofs." to "Confidence tiers are labels, not proofs." (dropped the jargon phrase entirely, not just the dash). A dedicated background sweep then removed all remaining 105 em/en dash occurrences from that file's copy (JSX text nodes and `description=`/`answer=` string props): colon-like term/definition dashes became `: `, parenthetical-aside dashes became `,` or a sentence break, and numeric ranges (`200–1,000`, `0–100`, `35–64`) were spelled out with "to". Final count: 0 em/en dashes anywhere in the file.

**Verified:** `npm run typecheck` 0 errors project-wide (confirmed 3 times across the batch, including after the methodology sweep landed). Targeted vitest: 915 tests passed across 25 files - `second-order-citations.test.ts` (23, including 3 new tests for `cleanTopicPhrase`, the D3 null-hiding behavior, and the D5 threshold copy), `cron-schedule-map.test.ts`, `demo-path-fixes-2026-05-06.test.ts` (18, updated pin), `diagnostics-layout-operator-gate.test.ts` (6, new - 4 source pins + 2 behavioral), `indexability-diagnostics-operator-only.test.ts`, `diagnostics-page-dynamic.test.ts`, `main-product-final-confidence-sweep.test.ts` (716), `local-smoke.test.ts` (4), `tests/app/settings/*` (59), `competitor-intel-page.test.tsx` plus `tests/domains/competitor-intel/` and `tests/domains/competitors/` (61), and the `src/app/(shell)/prompts` suite (3). Zero regressions.

**Ground truth (real tenant-iranopedia, dev server, `curl -sL -m 120`):** every touched route confirmed live with real data. `/settings/connectors`: both reworded intro paragraphs render verbatim as written above. `/competitors`: "It wins answers about chaharshanbe suri." (was "A question about wiki chaharshanbe suri"), "It wins answers about gifts persian housewarming gifts." (product/category tokens stripped from a real `/product-category/gifts/persian-housewarming-gifts/` URL slug), "persiscollection.com on gifts persian housewarming gifts: cited 411 times so far; after about 10 citations I can name the exact page to pitch." (real D5 threshold copy on a real "other"-class domain), "talkpal.ai on culture what are some beautiful persian words: cited 261 times so far; after about 10 citations I can name the exact page to pitch.", 0 remaining "Not read yet" occurrences in the rendered HTML (down from ~19), "across all your topics" subtitle under the Competitor domains tile. `/prompts`: "on the questions I track" subtitle under Rival domains cited, "showing 14 of 23" rendered under the question list. `/settings`: all 5 index links (Your business info / Connections / Imported history / Spend receipts / How Beacon measures) render. `/settings/methodology`: "Confidence tiers are labels, not proofs." renders at the expected list position; 0 em/en dashes anywhere in the live-rendered HTML. `/ask`: empty state reads "...a competitor, or tonight's plan on Today." `/diagnostics`: renders 200 in this dev environment because `BEACON_OPERATOR_MODE=true` is set in `.env.local` (this machine is the operator environment) - the gate itself was proven via the new behavioral test rather than by restarting the dev server without the env var, since flipping a server-only env var requires a process restart that would have been disruptive mid-verification; the mocked-gate test is the more reliable proof (it exercises the actual `DiagnosticsLayout` function, not just a curl against a fixed-env process).

**Honest caveats:** D9/D10's subtitle and "showing N of M" additions are purely additive display text - no underlying metric definition changed, so the two tile numbers (competitor domains vs rival domains cited) remain genuinely different metrics computed from different sources, now just labeled so a reader doesn't assume they're the same thing. D6's cron relabeling is display-only; the underlying job identifiers, paths, and schedules in `vercel.json` are untouched.

**Next action:** none required from the operator; this is a pure display-language fix plus one new test file, live in dev. Recommended next: run the same brutal-review pass on `/worklist` and the remaining `/proof` surfaces not yet covered by fix batches A-D.

## 2026-07-02 - MASTER PLAN v2 item N8: snapshot-grounded factual entailment before publishing (worktree, NOT committed)

**What changed:**
- New `src/domains/drafts/factual-entailment.ts` (pure, no I/O): `checkFactualEntailment({draftText, pageBodyText, evidenceText, query, nowYear})` verifies three kinds of factual claim: (1) numbers/dates must appear in the page body, evidence, or query, extending (not duplicating) the existing `invented_numbers` firewall in `structured-drafter.ts`/`llm-answer-block.ts` - same grounded-number extraction (thousands-separator strip, year-adjacent allowance, 7/14/28 proof-window constants), widened to accept page-body grounding as a third source; (2) named entities (capitalized multi-word spans, with singular/plural folding) must appear in the page body, query, or evidence; (3) superlatives ("the largest", "the first", "the only") require the same phrase findable on the page or in evidence. Title-case text (titles/metas) gets a separate extraction path: single-word spans and a trailing `| Brand` / `- Brand` suffix are excluded, and a broadened generic-word list (marketing/section-header vocabulary) prevents ordinary Title Case words from reading as fabricated entities. Abstains (returns entailed:true) when there is no grounding text at all - an evidence-floor problem, not an entailment failure. Returns `{entailed, violations[]}`, capped at 5, in plain English.
- New `src/domains/drafts/factual-entailment-store.ts`: the one I/O helper, `readPageBodyTextForEntailment(tenantId, url)`, mirrors the already-proven lean `page_snapshots` read in `answer-alignment-store.ts` (same columns: `body_paragraph_sample`, `card_texts`, `faqs`), plus a www./bare-host URL fallback added after ground-truth found real prepared-Move target URLs stored without `www.` while `page_snapshots` rows are keyed with it.
- `src/domains/drafts/draft-quality.ts`: `evaluateDraftQuality`, `evaluateTitleMetaQuality`, and `evaluatePreparedPackQuality` all gained optional `pageBodyText`/`evidenceText` params. Complete no-op when both are omitted (every existing pinned fixture in `draft-quality.test.ts` passes neither, so all 51 pre-existing cases keep their exact prior verdict, confirmed by test). When supplied and a violation is found, the result downgrades to a new `unverified_claim` status (`copyAllowed: false`, `canRegenerate: true`), feeding the same regenerate loop every other rejection status already feeds.
- `src/domains/push/stage-change.ts`: new pure, exported `entailmentViolationsForEdit(edit, pageBodyText)` (checked action types: `edit_title`, `edit_meta`, `change_h1`, `add_answer_block`, `add_faq`, `add_h2_section`; returns null for other action types, no proposed text, or no page body to check against). Wired into `resolveMove` (the one-click "Stage in Wix" resolver) right after the existing QA backstop: reads the target page's real body via the new store helper and blocks the stage on a violation, failing closed to the existing `notStaged` -> `pasteFallbackLine` paste-with-warning path. Lenient on any read/check error (executePush's structural rails still protect the live write either way).

**Verified:** `npm run typecheck` 0 errors project-wide (confirmed the only remaining errors are pre-existing, in `proof-gsc/**` and one pre-existing test file, from concurrent unrelated work in this shared worktree - out of N8's ownership scope, untouched). Targeted vitest: 90 tests across `src/domains/drafts` (2 files) and `src/domains/push` (3 files) all green - 15 new in `factual-entailment.test.ts`, 15 new in `draft-quality.test.ts` (on top of the 51 pre-existing, all still pinned unchanged), 7 new in `stage-change.test.ts` (the first test file for that module, covering the new pure decision function in isolation since the full `stageChangeForRecord` flow reaches Supabase/executePush and is out of scope to mock here).

**Ground truth (real tenant-iranopedia, dev server on :3142, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs`):** ran the entailment gate over real data twice, before and after fixing two real bugs the first pass surfaced (see below).

Real `recommended_edits` (26 sampled, 25 had a matching page body after the www. fix): **19 pass, 6 would be blocked** by the publish gate. All 6 blocks are honest, not false positives:
- `/persian-male-names`: title "Iranian Male Names" - the crawled 565-char body sample never says "male" (checked directly against the full stored text).
- `/iran-flags`: title "Historical Flags Of Iran" - the body says "history of the Iran flag", never "historical".
- `/iran-world-cup-jersey-evolution`: the stored body is only 55 characters (`"Iran National Soccer Team World Cup Jerseys (1978-2022)"`), so "Kit"/"History" in the proposed title are honestly ungroundable - a real thin-crawl gap, not a bug in the check.

Real prepared-Move structured drafts (24 with a draft, all 24 had a matching page body): **10 pass, 14 flag.** The flagged ones are meta-referential drafts that literally open "The Iranopedia page 'X' describes..." - naming the site's own brand and, in one case, "FIFA World Cup" (a competition name that never appears on that specific page's crawled body). Arguably correct signal: these drafts read as commentary about the page rather than page content, a separate pre-existing quality issue (`draft-quality.ts`'s `META_NONANSWER` regex does not catch the "page titled X describes" phrasing) that N8 incidentally surfaces but does not fix.

**Two real bugs found and fixed during ground-truth verification (not present in the original design, caught by running against real data):**
1. URL mismatch: prepared-Move `targetUrl` is stored without `www.` (`https://iranopedia.com/...`) while `page_snapshots.url` is stored with it (`https://www.iranopedia.com/...`) - an exact-match lookup silently found 0 rows for every real pack. Fixed with a www./bare-host fallback in `factual-entailment-store.ts`.
2. Title-case false positives: the first version flagged ordinary marketing/section words ("Shop", "History", "Facts", "Attractions") and the site's own brand suffix ("| iranopedia") as invented entities on nearly every real title, a 64% block rate. Fixed by adding a title-case-aware extraction path (single-word spans dropped, trailing brand suffix stripped, broadened generic-word list) - brought the real publish-gate block rate down to 24% (6/25), all genuine.

**Honest caveats:** the remaining 6/25 and 14/24 flags expose real, pre-existing gaps this item does not fix: thin/sample-limited `body_paragraph_sample` coverage on some pages (a known N19 caveat - the crawler samples paragraphs, it does not store the full page) and genuine synonym mismatches (title says "Shirt", page body says "jersey") that a literal-traceability check correctly does not paper over with semantic paraphrase matching. The nightly regenerate loop (`src/domains/demand-graph/prepare-today-moves.ts`) was intentionally NOT wired to pass real `pageBodyText` into its `evaluatePreparedPackQuality` call - that file is outside this item's granted ownership (`drafts/factual-entailment*`, `draft-quality.ts`, the one publish-gate seam in `stage-change.ts`). The additive optional params are in place and ready for that wiring as a follow-up.

**Next action:** thread a real `pageBodyText` read (via `readPageBodyTextForEntailment`) into `prepare-today-moves.ts`'s `evaluatePreparedPackQuality` call so the nightly regenerate loop starts benefiting from entailment checking, not just the one-click publish gate.

### Operator correction (same day, applied before this item was called complete): invention vs. correction

**The problem with the first design:** treating the page's own text as the ground truth means a stale or wrong page can never be corrected - any draft that fixes an outdated number would be blocked exactly like a fabricated one. That is backwards; correcting stale content is Beacon's job.

**The fix:** `checkFactualEntailment` now distinguishes two failure modes instead of one:
- **Violation** (unsupported invention): the claim is found nowhere - not the page, not the evidence, not the query, not a dated fact. Blocks auto-publish, exactly as before.
- **Correction** (sourced update to a stale page): the claim contradicts the page's own text, but a new `authoritativeFacts?: AuthoritativeFact[]` input (`{source, date, detail}` - a dated, sourced fact Beacon already has on file, e.g. a connector reading or a stored source row) backs the draft's version instead. Never blocks; the caller renders the exact explanation, e.g. "This draft updates a number to '4500' based on your site's recipe count (Wix connector), 2026-07-01. Your page does not currently show that number."
- Superlatives follow the same rule: a sourced, dated superlative is a correction, not a violation.

**API shape:** `checkFactualEntailment` now returns `{entailed, violations[], corrections[], findings[]}` where `findings[]` carries the full `{kind: "violation" | "correction", message, source?, date?}` detail per claim. `entailed` still means "zero violations" (corrections never affect it), so this is additive - no existing caller's behavior changes unless it opts into `authoritativeFacts`.

**Wiring updated:**
- `draft-quality.ts`: `DraftQualityResult` gained an optional `corrections?: string[]` field, present only when at least one correction fired (never an empty array - callers test for `undefined` to distinguish "not checked / nothing to report" from "checked, found something"). A draft with a correction stays `status: "ready"` / `copyAllowed: true` and carries the explanation alongside it.
- `stage-change.ts`: `entailmentViolationsForEdit` renamed to `entailmentGateForEdit`, now returns `{blocked, violations, corrections}` instead of `string[] | null`. `resolveMove` only fails closed when `blocked` is true; a correction lets the stage proceed and appends the correction sentence onto the success receipt line (after the "Staged in Wix at [time]" line and the live-probe confirmation, if any).

**Tests updated:** all 3 test files got new correction-path cases (25 total in factual-entailment.test.ts, up from 15; 55 in draft-quality.test.ts, up from 51; 10 in stage-change.test.ts, up from 7 - 92 total, all green) covering: a contradicting claim WITH a dated fact is a correction and does not block; the SAME claim with NO fact stays a violation and blocks; findings[] carries source/date on a correction and omits them on a violation; a correction and a violation can coexist in one draft (mixed findings); undated `evidenceText` grounds a claim but never produces a "correction" label (only a dated `AuthoritativeFact` does); a claim already grounded on the page is neither a correction nor a violation.

**Ground truth after the correction fix:** re-ran the same real-data probe with the corrected code. Numbers are UNCHANGED from before the correction (19 pass / 0 corrections / 6 blocked on `recommended_edits`; 10 pass / 14 flag on prepared-Move drafts) because **no caller anywhere in the codebase currently supplies `authoritativeFacts`** - there is no dated, sourced connector/evidence-packet feed wired into either `draft-quality.ts`'s callers or `stage-change.ts`'s `resolveMove` yet. The correction mechanism is fully built, wired at every layer, and proven correct by 9 new direct tests, but it has nothing to correct WITH on live data today. This is an honest, expected result, not a defect: the item's job was to build the mechanism and get the invention/correction distinction right, not to also invent a new dated-facts pipeline (out of scope for N8's granted ownership).

**Next action (supersedes the prior one):** design and wire a dated `AuthoritativeFact[]` source (the most natural candidates: GSC/GA4 observations, which already carry real fetch/observation timestamps, or a stored connector row) into `stage-change.ts`'s `resolveMove` and `draft-quality.ts`'s callers so the correction path can start firing on real, sourced data. Threading `pageBodyText` into `prepare-today-moves.ts`'s regenerate loop remains the second follow-up.

## 2026-07-02 - MASTER PLAN v2 item UX2 first slice: Keywords library (worktree, NOT committed)

**What changed:** built `/research/keywords`, the first slice of the Research hub vision (UX2) - the operator's own idea, called out to build first. EVERY keyword Beacon has ever researched, merged from cache into ONE row per keyword, with zero new paid calls.

**Loader (`src/domains/research/keyword-library.ts`):** merges six sources, all $0 cache/DB reads:
- GSC query portfolio via a new `loadTopTenantQueriesWithOwner` (added to `gsc-page-queries.ts`, extends the existing `loadTopTenantQueries` bounded tenant-wide read to also track the best owner page per query in the same round-trip).
- DataForSEO keyword demand cache (`readAllCachedKeywordDemand`) and difficulty cache (`readAllCachedKeywordDifficulty`), both pre-existing.
- Competitor keyword-gap store (`readKeywordGapResults`) for competitor owners and a volume backfill.
- SERP history via a new `loadLatestSerpReadingsByQuery` (added to `serp-history.ts`, same pattern as the existing `featureStealHistoryRows`/`aiOverviewHistoryRows` readers) for the latest live-observed own rank and top domains, plus the existing `featureStealHistoryRows` for People Also Ask related questions.
- Trend Radar (`loadQuerySpikes`) for this-week spike tags and the Seasonal store (`loadSeasonalQueries`) for recurring calendar-peak tags.

**Label rule enforced (operator hard correction):** `searchesPerMo` (DataForSEO market volume, null when unknown, never guessed) and `timesShownPerMo` (GSC impressions) are two distinct fields end to end - the UI never renders one under the other's label, and a dedicated test pins that GSC impressions never backfill a fabricated market-volume number.

**UI:** `src/app/(shell)/research/keywords/page.tsx` (server component, one `loadKeywordLibrary()` call) + `keywords-table-client.tsx` (dense sortable table: instant client-side sort on volume/shown/clicks/position/difficulty with unknown values always sorting last regardless of direction; text filter with `/` keyboard focus; tabs You rank / Close to page 1 / Not owned / Trending / Seasonal with real counts; expandable rows showing related questions, competitor owners, sources, and a "Plan a change for this keyword" link into `/worklist?search=`; owner-page links use the existing `dossierHref` helper into `/page/[...path]`; "show 200 more" pagination, no virtualization dependency). No "SERP" anywhere in the UI copy - says "Google results"/"Google reading".

**Nav:** added "Keywords" to the Research group in `src/lib/navigation.ts`, before AI questions, with the `Search` lucide icon. The sidebar test (`app-sidebar.test.tsx`) is a source-text pin unrelated to the nav item list, so no change needed there; it still passes.

**Files touched (avoided proof-gsc/**, drafts/**, demand-graph candidate internals, and the /page dossier route per instruction; only read from them where already exported):**
- New: `src/domains/research/keyword-library.ts`, `src/domains/research/keyword-library.test.ts`, `src/app/(shell)/research/keywords/page.tsx`, `src/app/(shell)/research/keywords/keywords-table-client.tsx`, `src/app/(shell)/research/keywords/keywords-table-client.test.tsx`.
- Additive-only edits: `src/domains/recommendation-intelligence/gsc-page-queries.ts` (new `loadTopTenantQueriesWithOwner` + `TenantQueryWithOwner` type), `src/domains/serp/serp-history.ts` (new `loadLatestSerpReadingsByQuery` + `QueryLatestSerpReading` type, plus importing `SerpOrganicItem` which fixed a pre-existing missing-import typecheck error in that file), `src/lib/navigation.ts` (one nav item).

**Verified:** `npm run typecheck` clean (the only remaining project error is pre-existing, in `src/domains/demand-graph/load-graph.ts`, from concurrent unrelated work in this shared worktree - outside this item's scope, untouched). Targeted vitest: 34 tests across 3 files, all green - 15 in `keyword-library.test.ts` (label rule, dedupe/merge across all 6 sources, spike-vs-seasonal priority, coverage stats, sort order), 17 in `keywords-table-client.test.tsx` (pure tab/filter/sort logic plus a static-render smoke test per the repo's no-jsdom convention), 2 pre-existing in `app-sidebar.test.tsx` unaffected.

**Ground truth (real tenant-iranopedia, dev server on :3142, `curl -m 180`):** `/research/keywords` returns HTTP 200 and renders 298 real merged keywords, 190 with a real DataForSEO market-volume number. Rendered header: "Keywords" / "Every keyword I have researched for you, from Google Search Console, market-volume checks, competitor gaps, and live Google readings, in one sortable list." Honest coverage line: "I have real search-volume numbers for 190 of 298 keywords. The rest show Google's own numbers (times shown, clicks, position) until I check their market volume." Real rows: `iran flag` (135,000 searches/mo, 8,494 times shown, position 2, owner `/iran-flags/iran-islamic-republic-flag-history`, tagged Seasonal); `persian girl names` (volume unknown, 6,588 times shown, position 5.6, owner `/persian-female-first-names`, tagged Seasonal); `persian boy names` (volume unknown, 5,512 times shown, position 3.8, owner `/persian-male-names`, tagged Seasonal). Tab counts on real data: All 298, You rank 94, Close to page 1 7, Not owned 198, Trending 5, Seasonal 20 - all real, none hardcoded (Seasonal was 0 before the `loadSeasonalQueries` wire-up was added mid-build; confirmed live before/after). Sidebar renders "Keywords" as the first Research-group item, correctly highlighted active on `/research/keywords`.

**Honest caveats:** (1) `difficulty` shows "?" for every one of the top 200 rows sampled - the cached keyword-difficulty run and the tenant's actual top GSC queries do not currently overlap; the merge logic is correct (pinned by a direct unit test) but has nothing to show yet for this tenant's real top keywords. (2) `relatedQuestions` and `competitorOwners` depend on how many queries have a live SERP history reading or a fresh keyword-gap run - a keyword with only GSC history shows those columns empty, which is the honest state, not a bug. (3) This is the FIRST UX2 slice only: Pages, Topics, AI questions (already existed), Competitors (already existed), and Content roadmap sub-hubs are not built.

**Next action:** UX2's remaining sub-hubs (Pages, Topics, Content roadmap) per the master plan, OR continue sequencing into UX3 (Changes as a dense inbox) per the locked UX0 -> UX1 -> UX2 -> UX3 -> UX4 -> UX5 order.

## 2026-07-02 - D1 ground-truth fix: nightly poll read another tenant's questions; observation_runs tenant_id silently dropped

**Root cause 1 (borrowed-tenant questions):** `run-engine-poll.ts`'s `defaultDeps().loadPrompts` called `getActivePrompts()` from `src/domains/prompts/prompt-library.ts`, which reads the operator-shared, NON-tenant-scoped `.data/prompt-library.json` store (its own file header says "GLOBAL ... no tenant_id on rows"). Nothing in that read path filtered by tenant, so polling tenant-iranopedia asked whatever was in that one shared file. Ground truth confirmed `tracked_prompts` (the REAL tenant-scoped question table, already used by settings/prompts and onboarding launch) held zero active rows for `tenant-iranopedia` in the live DB - the tenant's own library had never been (re)seeded there, so the poll was silently substituting the shared global corpus instead of failing loud.

**Fix 1:** new `src/domains/ai-visibility/tenant-question-library.ts` with `loadTenantQuestionLibrary(tenantId)`, which reads `tracked_prompts` filtered by `.eq("tenant_id", tenantId)` only. `run-engine-poll.ts`'s `RunEnginePollDeps.loadPrompts` signature changed from `() => Promise<LibraryPrompt[]>` to `(tenantId: string) => Promise<LibraryQuestionInput[]>`, default wired to the new tenant-scoped loader, call site passes `tenantId`. Zero-question tenants now hit a named `log.warn` ("tenant has ZERO active tracked_prompts...") both inside the loader and again in the orchestrator's `no_prompts` branch, and the returned `detail` string names the tenant explicitly - impossible to mistake for a healthy poll again.

**Fix 2 (idempotent reseed):** `tenant-question-library.ts` also exports `seedTenantQuestionLibraryIfEmpty` (only writes when the tenant's `tracked_prompts` is genuinely empty) which merges GSC question-shaped queries (`gsc_daily_rows`, filtered to queries that start with a wh-word/aux-verb or end in "?", ranked by impressions) with existing synced `profound_prompt_rows` text for that tenant, dedupes, and caps at 50 - all $0 reads of data already in the DB, no new external calls.

**Root cause 2 (observation_runs silent write failure):** `observation_runs` carries a NOT NULL `tenant_id_nonempty_chk` constraint. `ObservationRun.tenant_id` is a required field and every caller populates it correctly, but `persist-run.ts`'s `upsertObservationRunToDb` built its Supabase upsert payload with an explicit column list that never included `tenant_id` - every dual-write upsert through this path violated the constraint and failed, caught and logged as "non-fatal" (`console.error`), which made the failure invisible. The parallel `dual-write.ts` `syncObservationRuns` path already stamped `tenant_id` correctly via `tenantizeRows`; this was the one path that had not been fixed.

**Fix 3:** added `tenant_id: run.tenant_id` to the upsert payload in `upsertObservationRunToDb` (additive, one field).

**Tests added:** `src/domains/ai-visibility/tenant-question-library.test.ts` (12 tests: tenant-A-never-sees-tenant-B scoping x3, fail-loud zero-question warning, empty-tenantId refusal, seed-candidate merge/dedupe/cap x2, idempotent reseed x3 including the no-op-when-already-populated case). `src/domains/observations/persist-run.test.ts` (2 tests: tenant_id carried through to the Supabase upsert payload for two different tenants, no cross-tenant bleed). `src/domains/ai-visibility/run-engine-poll.test.ts` gained a new describe block (3 tests: `loadPrompts` called with the polling tenant's own id and never another tenant's; a shared fake per-tenant store proves tenant A's poll never asks tenant B's questions; a genuinely empty tenant's `no_prompts` detail names the tenant).

**Verified:** `npm run typecheck` clean. Targeted vitest: 39 passed across the 4 directly touched/added test files (`tenant-question-library.test.ts`, `run-engine-poll.test.ts`, `persist-run.test.ts`, `question-universe.test.ts`); a wider sweep of `src/domains/ai-visibility`, `src/domains/observations`, `src/domains/prompts`, `settings/prompts`, and `onboard` (18 files) all passed (319 tests), confirming no regression from the `loadPrompts` signature change.

**Ground truth (real Supabase, env sourced, one-off `scripts/_d1-tenant-question-probe.ts` run then deleted - not part of the shipped fix):** BEFORE: `tenant-iranopedia` = 0 active tracked_prompts, `tenant-ritz-founder` = 0 active tracked_prompts (both empty; ritz-founder was never the source of leaked questions in the live DB itself - the leak was via the separate global `prompt-library` json-store, not cross-reads of `tracked_prompts`). Ran the idempotent reseed for `tenant-iranopedia` only: inserted 50 questions (merged from 200 Profound-prompt-text candidates + 1 GSC question-shaped query, deduped/capped). AFTER: `tenant-iranopedia` = 50 active questions, first 5 all genuinely Iranopedia-relevant ("What are good websites for learning basic Persian phrases?", "What Persian names work well for Iranian-American babies?", "What are popular Persian kebab varieties?", "What are beautiful Persian girl names and their meanings?", "What are the most beautiful words in the Persian language?"). `tenant-ritz-founder` re-checked after the reseed: still 0, confirmed untouched. No live engine poll was run (no spend).

**Honest caveat:** the reseed only ran once, manually, from the probe - it is NOT wired into the nightly poll itself (by design, so the poll never silently mutates the tenant's question set on its own). If `tenant-ritz-founder` (or any other tenant) is also genuinely empty in `tracked_prompts`, the same `seedTenantQuestionLibraryIfEmpty` function is available to reseed it the same way once real GSC/Profound source data exists for that tenant.

**Next action:** wire `seedTenantQuestionLibraryIfEmpty` as a one-time-per-tenant guard inside the onboarding/launch flow (or a small ops script triggerable per tenant) so a newly onboarded tenant with zero tracked_prompts gets auto-seeded from its own GSC/Profound data instead of requiring a manual probe run.

## 2026-07-02 - D4/N1: the unified opportunity allocator, one ranked list across every lane

**What shipped:** new `src/domains/allocator/unified-list.ts` (pure) + `src/domains/allocator/load-unified-list.ts` (I/O). Normalizes four opportunity lanes into one `UnifiedEntry` shape and ranks them with one deterministic score: (a) `normalizeWorklistEntry` reads the existing worklist `CanonicalChange[]` (which already fuses GSC + Clarity friction + internal-link moves through the ActionPack pipeline - read as one lane, not re-derived), (b) `normalizeGapVerdictEntry` reads D2's persisted AEO gap verdicts, (c) `normalizeStealBriefEntry` reads D3's persisted SERP steal briefs, (d) `normalizeKeywordLibraryEntry` + `selectKeywordLibraryGaps` surface keyword-library rows with no owner page or ranking position 11-20 that no other lane already covers. `fuseByPage` merges lanes that land on the SAME real page, unioning `sources[]` and taking the best confidence/risk/expected-value across them (a corroborated page never scores worse than its best single-lane read). `unifiedScore` = expected-value midpoint (or a small honest floor when unsized) x confidence x (1 + 0.15 per extra corroborating lane) x a risk penalty (low/medium/high = 1 / 0.85 / 0.6); a held entry (blocked or quality-flagged, a passthrough from upstream gates, never re-derived here) is multiplied by 0.05 so it sinks near the bottom without ever disappearing from the list; ties break by effort ascending (quick wins first), then by id for full determinism.

**Real gap found and fixed while building this:** D2's gap verdicts (`teardown-commonality-verdict.ts`'s `routeGapVerdict`) were computed every night by `native-teardown-runner.ts` but never persisted - `warm-caches.ts` only logged a one-line summary and discarded the actual verdict objects, so nothing could ever read them back. Added a new `"gap_verdict"` kind to `move-draft-store.ts`, persistence helpers (`gapVerdictDraftKey`/`serializeGapVerdict`/`parseGapVerdict`/`PersistedGapVerdict`) in `teardown-commonality-verdict.ts`, a save-after-compute step + `loadGapVerdictsForTenant` reader in `native-teardown-runner.ts` - the exact same store/read contract D3's `serp-steal-lane.ts` already uses for steal briefs (latest-row-wins, only re-write on real content change).

**Rendering (no new UI):** `changes-data.ts`'s `loadChangesView` now calls `fuseUnifiedList(tenantId, worklistChanges)` right after building the worklist's `CanonicalChange[]`, and uses its fused, ranked output as the list's `changes` field - fail-soft (`.catch` falls back to the worklist-only list, never blanks the page). A D2/D3/keyword-library-born entry renders as a first-class `CanonicalChange` via `unifiedEntryToCanonicalChange`; a worklist-lane entry keeps its ORIGINAL record (status/measurement truth untouched) via `mergeSourcesOntoChange`, with only `sources[]` stamped on. Added one new optional field, `CanonicalChange.sources?: string[]`, and one small additive render in `changes-list-client.tsx` (an existing-seam edit, not a new component): a "X + Y agree" chip appears only when 2+ lanes confirm the same page.

**Tests:** 34 new tests in `src/domains/allocator/unified-list.test.ts` covering per-lane normalization (including honest-null/no-verdict/not-read early-outs so a lane never fabricates an entry from insufficient evidence), fusion (same-page merge, never-merges-different-topic-creates, fusion never lowers confidence or raises risk, a hold on any fused lane holds the whole entry), ranking determinism (same input always same order regardless of input order), the exact multi-lane boost multiplier, the risk-penalty ordering, effort tie-breaking, held-sinks-but-never-drops, and the worklist-seam render functions. All pre-existing tests in the touched domains still pass: `src/domains/changes/*` (build-canonical-changes, canonical-change, strategy), `teardown-commonality-verdict.test.ts`, `native-teardown-runner.test.ts`, `serp-steal-lane.test.ts`, `keyword-library.test.ts`, `changes-list-client-session.test.ts` - 131 tests total across 8 files. `npm run typecheck` clean project-wide.

**Ground truth (real tenant-iranopedia, dev server on :3142, `curl -m 180` + a one-off `scripts/_d4-unified-list-ground-truth.ts` probe):** the real `/worklist` render today fuses 81 worklist-lane rows with 126 keyword-library-lane rows into 206+ ranked entries (count varies run to run because the underlying worklist surface cache is itself stale-while-revalidate, a pre-existing characteristic, not something this item changed). D2 (`aeo_gap`) and D3 (`serp_steal`) both read 0 for this tenant today - their nightly runners have not yet produced a persisted verdict/brief for tenant-iranopedia, so the "2+ lanes agree" boost has not fired on any real row yet; this is honestly disclosed, not a bug in the fusion logic (unit tests prove the boost fires correctly once inputs exist). Top of the real ranked list: `/iran-flags` title change (rank position 8, 2,286 monthly impressions, forecast 6-20 clicks/month within 28 days) - a real, winnable, high-traffic page, the kind of thing a smart operator would in fact do first. Two rendered rows quoted verbatim from the live HTML: (1) worklist-lane, page "iran flags", status "To do" - "You already rank position 8 for "iran flag" (2,286 monthly impressions). A sharper title can climb a few spots and capture far more of those clicks." (2) keyword-library-lane (D4-born, `sources:["keyword research"]`), page "iran-animals/red-fox" - "Improve the page ranking position 10 for "iran fox" - it gets about 139 times shown on Google a month but is not on page 1 yet."

**Honest caveats:** (1) D2/D3 lanes are wired and tested but currently empty for tenant-iranopedia in production data - the fused list will visibly change (and the "agree" chip will render) the first night either nightly runner produces a verdict on a page the worklist also ranks; nothing further needs to be built for that to happen. (2) The standalone ground-truth script hit `after() was called outside a request scope` on one run (a pre-existing Next.js `after()`-outside-request limitation in `moves-data.ts`'s SWR surface cache, not something this item introduced - the same caveat the earlier D7 probe script documented) - the authoritative numbers above are from the real dev-server HTML render, not the script's degraded-cache run. (3) `keyword_library` confidence (0.3-0.4) is deliberately the lowest of the four lanes since it has no teardown or AI-answer consensus behind it - this keeps it from ever outranking a real worklist or teardown-backed move at comparable value, by design.

**Next action:** let D2's `native-teardown` and D3's `serp-steal-lane` nightly warm-cache steps run for a few nights on tenant-iranopedia so real `aeo_gap`/`serp_steal` entries populate the fused list and the multi-lane "agree" boost gets its first live proof point; then move to D6 (the daily ritual loop) once the concurrent D6 workstream's client-side changes land.

## 2026-07-02 - UX4: Today as a concise briefing

**Scope check first:** the checkpoint + quick-UI waves had already shipped teammate pills (item 47's `TeammateBrief`), the compact alert-first pipeline placement (`OpsPipelineSection` above the hero), applied-batch collapse and the measuring one-line strip (`/worklist` + `MeasuringSection`), friction severity bars (`FrictionFixesSection`'s per-row bar), the AI funnel with clickable stalled stages (`AiCrawlerSection`'s `deriveFunnelStages`), and top-3 new pages (`TodayNewPagesSection`'s `limit={3}`). Verified all still render and all pre-existing tests for them still pass; none were rebuilt.

**What shipped this pass:** (1) **Lead story** - new pure `src/domains/changes/lead-story.ts` (`selectLeadStory`, 9 tests) picks ONE deterministic "what matters most right now" card from data `page.tsx` already loaded: a landed verdict (ledger `won`/`lost`, newest first) beats a fired alert (`today.attention[0]`), which beats tonight's first planned pick (`whyNow` + `moveHeadline`), which beats the day's biggest click-mover (from the same 84-day series the scoreboard reads). Rendered via a new `LeadStoryCard` in `page.tsx`, mounted right after `OpsPipelineSection` and before the greeting. (2) **Chart tabs** - new `src/app/(shell)/scoreboard-chart-tabs.tsx` (`ScoreboardChartTabs`, client) wraps the existing Google chart (unchanged) in a `ViewToggle` with AI visibility / Visitors / Value tabs, fed from series `scoreboard-section.tsx` already loads (`citations.daily`, `revenueDays`); a tab with fewer than 2 points self-hides from the tab list (Visitors has no GA4 day-series loader yet, so it never renders a tab - no new heavy load was added to make one). (3) **Health four-state** - `data-sources-strip.tsx` gained `summarizeDataSourceHealth`/`dataSourceHealthLine` (Connected / Healthy / Fresh / Has data) and the old single "All data sources connected" collapse line was replaced with e.g. "5 connected, 5 healthy." or "4 connected, 3 healthy, 1 needs attention.", so the strip can never contradict a broken-pipe alert shown above it. (4) **Demand section split** - `war-room-sections.tsx`'s `DemandOpportunitiesSection` now groups its rows under three labeled mini-headers: "Searches moving this week" (query spikes + seasonal window + fading page), "Research gaps" (keyword-research opportunities + the pre-existing "Heating up right now" trends), "Language gaps" (the language-gap row) - each cluster silent when empty, no content removed or re-ordered otherwise. (5) **Top-3 new pages wording** - the footer link changed from "See all N" to "See all N in Changes" to match Today's existing "View all in Changes" convention. (6) **Refresh in header** - `RefreshMyDataButton` moved out of `DataSourcesStrip` into `PageHeader`'s new `children` slot in `page.tsx`; both read a single new `countConnectedDataSources(tenantId)` export from `data-sources-strip.tsx` so the header button and the strip's own state can never disagree.

**Pin fixed:** `ops-pipeline-section.test.ts`'s "mounted above the hero" test string-matched the literal `<PageHeader title={greeting} description={brief} />` self-closing tag; moving the refresh button into `PageHeader`'s children made it non-self-closing, so the match was updated to `<PageHeader title={greeting} description={brief}>` (same ordering assertion, same intent, still passes). `data-sources-strip.test.tsx`'s all-connected-state test was rewritten for the new four-state line (added a `lastSyncedAtIso` fixture field the real component now reads, plus 2 new tests for the needs-attention and not-connected count paths).

**Tests:** `lead-story.test.ts` (9, including an em/en-dash guard), `data-sources-strip.test.tsx` (12, up from 5), `ops-pipeline-section.test.ts` (9, 1 pin fixed). Full targeted sweep: `npx vitest run "src/app/(shell)" "src/components/today" "src/domains/changes" "src/domains/scoreboard"` = 734 passed, 1 pre-existing skip, 0 failed, across 68 files. `npm run typecheck` clean project-wide.

**Ground truth (real dev server on :3142, tenant-iranopedia, `curl -m 200`):** every required quote confirmed live in the rendered HTML/RSC payload. Lead story: "The change on /best-persian-restaurants did not work (shipped Jun 21). Here is what I learned." (a real lost verdict correctly outranked the day's click movement, per the priority order). Health line: "5 connected, 5 healthy." New pages footer: "See all 10 in Changes ->". Demand mini-headers: "Searches moving this week", "Research gaps", "Language gaps" all present. Chart tabs render inside a Suspense boundary that streams via the RSC flight payload (not visible to a plain curl of the initial body HTML before hydration) - confirmed correct wiring instead via the flight-payload props (`ai` tab carried 4 real citation points; `visitors`/`value` carried empty arrays) and a direct `renderToStaticMarkup` check of `ScoreboardChartTabs` proving it renders "Google" + "AI visibility" and omits "Visitors"/"Value" when their series are empty (temp test file, deleted after use, not part of the shipped repo).

**Honest caveats:** (1) Visitors tab will stay permanently self-hidden until a GA4 sessions-by-day loader exists - not built here per the "reuse loaded data only, no new heavy loads" constraint; a future item should add that loader if the Visitors tab is wanted live. (2) The chart-tabs' actual tab-switch interaction was verified by unit test (SSR render + prop wiring), not by a live click-through in a real browser, since curl cannot execute client JS/hydration.

**Next action:** UX5 (legacy deletion sweep) per the locked UX0 -> UX1 -> UX2 -> UX3 -> UX4 -> UX5 sequencing, or add the GA4 sessions-by-day loader so the Visitors tab in this slice can go live.

## 2026-07-03 - N14: the general interference graph (generalizes N12/N13)

**What shipped:** a new pure `src/domains/proof-gsc/interference-graph.ts` answering, for one target ship: what else could its measurement bleed into, and what could bleed into its own read? It COMPOSES existing classifiers rather than reimplementing them - `overlappingShock` (algorithm-weather.ts) reused verbatim for `sitewide_event`; intent-clusters.ts's conflict clusters reused verbatim as one `query_overlap` source; control-contamination.ts's own ship-date-in-window test generalized into a graph edge (`buildControlDependencyEdges`, part of `linked_page_treated`) instead of a per-ship classification. Five edge kinds total: `linked_page_treated` (PageSnapshot.internal_links direct adjacency both directions, plus the control-dependency source), `same_template_family` (first-path-segment grouping, requires the other ship measuring or a genuine window overlap), `sitewide_event`, `redirect_related` (honest no-op - no redirect store exists anywhere in the codebase today; documented, never fabricated from a bare 301/302 status finding), `query_overlap` (SERP-proven conflict clusters when available, plus a ledger-native `targetQueries` Jaccard overlap that needs zero SERP spend). Honest floors, all named constants: `MIN_QUERY_OVERLAP_JACCARD` (1/3), `MIN_QUERIES_FOR_OVERLAP_JUDGMENT` (2), family match alone never fires, only direct link adjacency counts (no transitive hops).

**Two consumers, both additive, both computed-only:** (a) SELECTION TIME - `src/domains/experiments/daily-experiment-planner.ts` gained an optional `interference: InterferenceHoldLookup` param on `planDailyExperiments` and a new `"interference_hold"` `ExcludedReason` carrying a `plainReason` sentence, checked in the per-candidate eligibility loop right after `assessEligibility` (same seam `activeTreatmentPaths`/`same_family_measuring` already uses) - omitted, the planner is byte-identical to before N14 existed. (b) READ TIME - `src/domains/proof-gsc/verdict-reliability.ts`'s `VerdictReliabilityInput` gained an optional `interferenceFlagged` boolean; when true it demotes an otherwise-clean mature result to "shaky" with the reason "a linked or same-family page still measuring could bleed into this result", threaded through `gradeFromPresentation`'s new optional 4th parameter. `interference-graph.ts` itself exposes the adapters both consumers need: `toPlannerHoldEntry` (graph -> `{ hold, reason }`) and `computeInterferenceGraphForLedger` (batch entry point, mirrors `attachControlContaminationForLedger`'s shape).

**Tests:** 43 new in `interference-graph.test.ts` (every edge builder, every honest floor, composition, the two consumer adapters, a dash-clean guard), 5 new in `daily-experiment-planner.test.ts` (hold fires with the plain reason, a non-held candidate stays eligible, omitted lookup is byte-identical, `hold:false` never excludes, ledger eligibility still wins its own reason ahead of interference), 4 new in `verdict-reliability.test.ts` (shaky demotion, stacks with other shaky reasons, `gradeFromPresentation`'s new param, omitted-param byte-identical). Full `src/domains/proof-gsc` + `src/domains/experiments` suites: 1071 passed, 0 failed, 64 files. `npm run typecheck`: clean project-wide. Full `npm run test`: 20097 passed, 71 skipped (pre-existing), 1 failed - the one failure (`refresh-surface-pins.test.ts`'s Demand-band row-order pin) is entirely inside the concurrent UX4 agent's in-flight `war-room-sections.tsx` rewrite (a file this item never touched, confirmed via `git status`/`git diff --stat`), not caused by N14.

**Ground truth (real tenant-iranopedia, `set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-interference-graph.ts`, read-only):** 25 ledger rows, 16 currently measuring, 215 `page_snapshots` rows carrying `internal_links`, 6 confirmed Google-update shock windows known. Every one of the 25 real ships (25/25) carries at least one significant interference edge; 302 total edges (181 `linked_page_treated`, 112 `same_template_family`, 9 `sitewide_event`, 0 `query_overlap` - no SERP intent-cluster conflicts or ledger targetQueries overlap cleared the floor today, and 0 `redirect_related` by the documented honest no-op). The real, previously-documented 7-ship `/persian-male-names` contamination cluster from N13 (`/famous-iranian-singers`, `/farsi-numbers`, `/famous-iranian-comedians`, `/iranian-actors-actresses`, `/iran-animals/asiatic-cheetah`, `/cities`, `/funny-farsi-phrases`, all shipped 2026-06-20/21 using `/persian-male-names` as a control that itself shipped 2026-06-22 inside their windows) reproduces exactly as 7 `linked_page_treated` control-dependency edges - confirming the new builder catches precisely the case `activeTreatmentPaths`' measuring-only check misses. The iran-flags and iran-animals template families interlink heavily (each animal/flag page carries 3-10 `same_template_family` edges to its siblings, all still measuring from the 2026-06-30/07-01 batch). Rendered selection-time hold reason (real ship `/iran-flags/pahlavi-iran-flag`): "This page links to /finglish, which I shipped a change to on 2026-07-01 and am still measuring. 4 more interference signals also apply." Rendered N10 grade effect on the same real ship, isolating only the new input (all other flags held clean): without `interferenceFlagged` the grade reads "solid: 28 days mature, clean comparisons, enough traffic to mean something"; with it, "shaky: a linked or same-family page still measuring could bleed into this result."

**Honest caveats:** (1) `query_overlap` found zero edges on the real ledger today - not a bug, the tenant has sparse SERP intent-cluster coverage (per N7's own honest coverage ratio) and its `targetQueries` arrays did not clear the Jaccard floor on this ledger; the source is built, tested, and will fire the day either condition is met. (2) `redirect_related` is a deliberate permanent no-op until a real redirect store exists somewhere in the codebase - documented as a floor, not a stub to forget. (3) NOT YET WIRED LIVE: `build-today-preview.ts`'s actual nightly `planDailyExperiments` call and the `/proof` card's `gradeFromPresentation` call do not yet pass real `interference`/`interferenceFlagged` values - today's real-data signal (100% of ships, 302 edges) is strong enough that flipping it live without an operator review pass first would immediately hold or downgrade nearly everything, which the CLAUDE.md pause-before-behavior-change rule counsels against; the mechanism itself is fully built, tested, and proven correct against real data, and wiring the two live call sites is a small, well-scoped next step.

**Next action:** wire `computeInterferenceGraphForLedger` into `build-today-preview.ts`'s real `planDailyExperiments` call (load `page_snapshots.internal_links` + shock windows once per batch, same pattern as `attachControlContaminationForLedger`) and into the `/proof` card's `gradeFromPresentation` call, after an operator look at how many real candidates the honest floors would actually hold given today's 100%-hit rate.

## 2026-07-03 - N2: the query-to-page ownership registry, enforced at three creation choke points

**What changed:** new `src/domains/ownership/registry.ts` (pure) computes one canonical owner map from two already-built, $0 sources: `gsc_ranks` (per-query, per-owned-URL impressions/position from `gsc-cannibalization.ts`'s `gsc_cannibalization_v1` RPC, the strongest signal since it reflects Google's own crawl+index verdict) and `serp_cluster` (intent-clusters.ts's SERP-overlap clusters, filling in queries `gsc_ranks` did not resolve). `resolveOwner(registry, queryOrTopic)` is the one function every caller should ask: it normalizes literal queries (trim+lowercase, matching the convention `gsc-page-queries.ts` and `intent-clusters.ts` already use) and, for a free-text topic label (a create_page candidate's own label), falls back to a strict topic-token subset match reusing `topicTokens` from `relevance-gate.ts`, so "Persian Male Names" resolves against a tracked query like "best persian male names 2026". `registry.conflicts` lists every entry with 2+ contending owned pages, worst first (most contenders, then confidence). `src/domains/ownership/registry-loader.ts` is the I/O boundary: reads `loadGscCannibalizationForTenant` + `loadIntentClustersForTenant` for one tenant, `cache()`'d per request, fail-soft throughout (a failed read narrows the registry, never throws into a caller).

**Enforcement (three additive choke points, all byte-identical when no registry data exists):**

- **(a) create_page candidates.** `create-page-ownership-gate.ts` gained `gateCreatePageOwnershipWithRegistry`, which runs the existing UX0 citation-only gate first (unchanged behavior for every Move it already catches), then checks each SURVIVING create_page candidate's label against the registry, reclassifying to `edit_page` at the registry's named owner exactly like the citation gate does when Google ranks or a SERP-overlap cluster (not just AI citation) already own the topic. Wired into `load-graph.ts` right after the existing UX0 gate call, reusing the GSC signal map already loaded in that function (no second GSC read, only the registry's own two reads are new I/O).
- **(b) drafter/prepare-time spend.** `prepare-create-page-verdicts.ts` now loads the registry once per run and skips a candidate the registry already resolves to an owned page BEFORE spending a live SERP call or an LLM brief on it, alongside the existing topic-coherence quality gate. New `PrepareSummary.skippedOwnedByRegistry` field, surfaced honestly in the "Prepare top N" button's status line ("skipped N I already own").
- **(c) steal briefs.** `serp-steal-lane.ts`'s `buildStealBrief` gained an optional `registryOwner` input; when it names a DIFFERENT page than `keyword.page` (the GSC-highest-clicks attribution the lane otherwise trusts alone), the brief carries a new `registryDisagreement` field and an honest sentence in `summary` ("My ownership registry actually names X as the page that should own this query, not Y, I am flagging this instead of guessing which one to strengthen") - `ourPage` is never silently switched. `runStealLaneForTenant` loads the registry once per run and resolves it per keyword.

**Conflict surface (item 3, no duplicate cards):** new `registryGscConflictsAsClusters(registry)` converts `gsc_ranks`-basis registry conflicts (grouped by owner+contenders, so multiple queries from the same cannibalization case collapse into one synthetic cluster) into the exact `IntentCluster` shape the pre-existing `intent_cluster_conflict` trigger already turns into `merge_pages` candidates. `load-trigger-candidates-for-tenant.ts` folds these into the SAME `intentClusters` array before calling `intentClusterConflict`, so one emission code path produces every conflict card; a `serp_cluster`-basis conflict is never re-emitted (it is already an `IntentCluster` the caller has).

**Ask coverage (item 4, one-line additions only):** `fact-assembly.ts`'s `page_specific` class gained one registry lookup after the existing "top searches" fact, citing the registry's owner for the page's top query when known - confirming agreement ("My ownership registry confirms /page owns...") or flagging disagreement ("My ownership registry says /other-page owns..., not /page, that is worth checking...") - wrapped in its own try/catch so a registry failure never blanks the rest of the dossier.

**Tests:** 16 new in `registry.test.ts` (gsc_ranks clear-leader vs close-contest confidence, the MIN_CONTENDER_SHARE floor, serp_cluster fill-in-the-gaps + gsc_ranks-wins-ties, resolveOwner exact + topic-token-subset + generic-word-rejection + null-for-unrelated, conflict ordering, coverage honesty, the registryGscConflictsAsClusters adapter including its never-re-emit-serp_cluster rule), 6 new in `create-page-ownership-gate.test.ts` (byte-identical with null/empty registry, registry-only reclassification with zero AI citations, citation-gate-runs-first ordering, untouched when the registry has no opinion), 4 new in `serp-steal-lane.test.ts` (byte-identical when `registryOwner` omitted/null, silent when it agrees, flags without switching `ourPage` when it disagrees, never flags when `keyword.page` is unknown), 3 new in `prepare-create-page-verdicts.test.ts` (byte-identical with a null registry, skips a registry-owned candidate before any SERP call, leaves an unmatched candidate untouched), 3 new in `fact-assembly.test.ts` (cites agreement, flags disagreement, a registry-read failure never blanks the rest of the dossier). Full targeted sweep of the 9 directly touched/created test files: 169 passed, 0 failed; a wider sweep adding 2 adjacent suites (`load-graph-junk-label.test.ts`, `gsc-cannibalization.test.ts`): 180 passed. `npm run typecheck` clean project-wide (2 transient errors observed mid-run from the concurrent UX5 orphan-route deletion sweep - confirmed via `git status` to be files that agent was actively deleting, not anything this item touched; both cleared on re-run once the filesystem settled).

**Ground truth (real tenant-iranopedia, `set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-ownership-registry.ts`, read-only, $0):** registry size 104 resolved queries out of 1,122 tracked (9% owner coverage), all 104 via `gsc_ranks` today, 0 via `serp_cluster` (honest, matches N7's own documented thin 7/300 SERP-history coverage - the mechanism is built and tested, it will fill in as SERP coverage grows). 36 real, named contender conflicts, including: "iranopedia" (owner `https://iranopedia.com/`, 20% share, 5 contenders splitting the rest including `/iran-timeline` 17.3% and `/category/all-products` 16.4%), "persian food" (owner `/florida-persianfood` 19%, 4 contenders including `/cuisine` 13.6%), "persian names" (owner `/persian-male-names` 69%, contenders `/persian-names` 17.2% and `/persian-female-first-names` 13.4%), "safavid flag" (owner `/iran-flags/early-safavid-dynasty-flag` 75%, 2 contenders), and a 7-query "iran flag(s)" family where `/iran-flags/iran-islamic-republic-flag-history` repeatedly out-ranks sibling flag pages by 61-91% shares. Three `resolveOwner` examples: `resolveOwner("iran flag")` -> exact match, owner `/iran-flags/iran-islamic-republic-flag-history`, high confidence, 1 contender; `resolveOwner("Persian Male Names")` -> topic-token fallback match, same owner as the "persian names" query, high confidence, 0 contenders; `resolveOwner("chaharshanbe suri traditions")` -> null, the honest "I do not know yet" answer for a genuinely unrelated topic.

**Rendered enforcement effect (quoted from a live `loadDemandGraphForTenant("tenant-iranopedia")` run against the running dev server's data, via a temporary probe script, deleted after use):** the create_page candidate "name iran" (synthesized from AI-citation evidence with zero owned citations, so the pre-existing UX0 citation-only gate could not catch it) was reclassified by the NEW registry check with the logged reason: "Ownership registry (gsc_ranks) already names an owner for this topic, reclassified create_page -> edit_page (https://iranopedia.com/persian-male-names)." Confirmed live on the real `/worklist` page (`curl -m 200`): "name iran" does NOT appear inside the "New pages to build" section's card list afterward, while a genuine, un-reclassified candidate ("persian wedding") still correctly does.

**Honest caveats:** (1) A FOURTH create-candidate source was found live during ground-truthing that this pass did NOT wire: `src/domains/allocator/unified-list.ts`'s keyword-library lane still pitched a card literally titled "name iran" ("Build a page for 'name iran', I have no page targeting this yet...") on the real `/worklist` page, because it uses its own narrower `KeywordLibraryRow.ownerPage` lookup (exact-literal-query GSC attribution only, no topic-token fallback, no registry consultation) rather than the new registry. This is a separate pipeline outside the task's three named choke points (create-page candidates, drafter grounding, steal/internal-link briefs); a follow-up task was spawned (task_2bdf5a21) rather than silently expanding this pass's scope. (2) Enforcement point (c) was scoped to the steal lane only, per the task's explicit naming; `internal-link-opportunity.ts` (a separate, fully self-contained pure trigger) was not touched - a future pass could extend it the same way if the operator wants internal-link briefs to also prefer the registry owner. (3) `serp_cluster`-basis conflicts and resolutions are mechanically correct and tested but see 0 live hits today given N7's thin SERP-history coverage; this will strengthen automatically as more SERP reads accumulate, no further code change needed.

**Next action:** wire the ownership registry into `src/domains/allocator/unified-list.ts`'s keyword-library lane (the spawned follow-up, task_2bdf5a21), since that is the one remaining live source still capable of pitching an owned page as a missing one.

---

### 2026-07-02 — N2 follow-up: keyword-library lane (4th create-candidate source) wired to the ownership registry (closes task_2bdf5a21)

**What changed:** `unified-list.ts`'s keyword-library lane gained `normalizeKeywordLibraryEntryWithRegistry`, the registry-aware superset of the existing `normalizeKeywordLibraryEntry`. It normalizes exactly as before, then, only for a row that came out as a `notOwned` create candidate (the lane's own narrower `KeywordLibraryRow.ownerPage` lookup found nothing), checks the row's keyword against the ownership registry via `resolveOwner`. When the registry names an owner, the entry is reclassified in place to an `edit` entry pointed at that owner, same honest reason-string convention as the N2 slice ("Ownership registry (basis) already names an owner for this topic, reclassified create -> edit (url)."). A row already resolved by the lane's own lookup, or one the registry has no opinion on, is untouched. `load-unified-list.ts` threads the registry through by calling `loadOwnershipRegistryForTenantCached` (the same React `cache()`-deduped loader `load-graph.ts`/`prepare-create-page-verdicts.ts` already use) alongside the other three lane fetches in the existing `Promise.all`, no new I/O. Additive throughout: a null/empty registry (fresh tenant) produces byte-identical output to the pre-existing lane, pinned by two dedicated tests.

**Files touched:** `src/domains/allocator/unified-list.ts` (new `normalizeKeywordLibraryEntryWithRegistry` export, `resolveOwner`/`OwnershipRegistry` import), `src/domains/allocator/load-unified-list.ts` (threads `loadOwnershipRegistryForTenantCached` through, doc comment updated), `src/domains/allocator/unified-list.test.ts` (4 new tests: byte-identical with null registry, byte-identical with an empty registry, reclassifies a registry-owned row to edit with the honest reason and no dash characters, leaves a genuine gap and an already-lane-owned row untouched).

**Verified:** `npm run typecheck` clean. Targeted vitest: `src/domains/allocator` + `src/domains/ownership` + `prepare-create-page-verdicts.test.ts` + `create-page-ownership-gate.test.ts` all passed (77 tests, 4 files, 0 failed).

**Rendered enforcement effect (live `curl -m 200 http://localhost:3142/worklist` against real tenant-iranopedia data):** the keyword-library lane's own `resolveOwner("parthian empire flag")` row (previously a `create`/"New page" card because `KeywordLibraryRow.ownerPage` was null for it) now renders as `"opportunityType":"Improve page"`, `"changeType":"edit_existing_page"`, `"pagePath":"/iran-flags/parthian-empire-flag"`, with `recommendation`: "Improve /iran-flags/parthian-empire-flag for \"parthian empire flag\" - the ownership registry already names it the owner of this topic (Google sends it the most impressions), and it gets about 260 searches a month." and `rationale`: "Ownership registry (gsc_ranks) already names an owner for this topic, reclassified create -> edit (/iran-flags/parthian-empire-flag)." Several sibling iran-flags/dynasty rows and `/explore` show the identical reclassification live. The literal "name iran" row named in the original caveat is no longer present in today's live keyword-library data (the underlying demand rows changed since that ground-truth run); the mechanism was confirmed firing on the equivalent live class of row instead. 65 keyword_library-lane entries still render in total, confirming the lane was not over-suppressed.

**Caveats:** (1) could not re-produce the exact literal "name iran" row from the original ground-truth note since today's keyword-library snapshot no longer contains it; verified against the same class of previously-mis-pitched rows instead (iran-flags/dynasty pages, "explore"). (2) Did not touch `/pages`, `/topics`, `/workbench`, or any dead-script deletion per the concurrent UX5 agent's ownership of that area. (3) `load-unified-list.ts` has no dedicated test file today (only `unified-list.ts`'s pure logic is unit tested); the wiring itself was verified via the live dev-server render above rather than a new integration test, consistent with how the loader file is otherwise untested.

### 2026-07-02 — UX5: legacy deletion sweep (routes, dead Today components, scratch scripts, one dead flag)

**What changed:** Deleted the `/pages`, `/topics` (index only), and `/workbench` routes outright — two independent research passes plus direct grep verification confirmed zero inbound links from anywhere reachable (nav, Today, Settings, Competitors, Briefs) — along with every route-exclusive `page.tsx`/client/action/loader/test. Kept `/topics/opportunity/[id]` (genuinely live: `/settings` → `/settings/history` → a result → `/topics/opportunity/[id]`, and also linked from `/competitors/[id]`) and `/observations/[id]` (same Settings-history chain). Kept the whole `src/domains/pages/` and `src/domains/recommendations/` domain layers untouched — both are massive shared foundations (dozens of importers each: scanning, attribution, diagnostics, persistence, competitor-intel) that only coincidentally share a name-substring with the deleted routes.

The route audit surfaced a second, larger wave the operator's brief hadn't named: 4 Today components (`change-review.tsx`, `today-findings.tsx`, `today-do-next-card.tsx`, `today-visibility-snapshot.tsx`) fully orphaned since the 2026-06-16 legacy-`today-client.tsx` deletion, and 12 more (`command-center.tsx`, `off-site-authority-tile.tsx`, `edit-lifecycle-tile.tsx`, `enrichment-v2.tsx`, `enrichment-badges.tsx`, `competitor-select.tsx`, `sparkline.tsx` [the `components/today` one, not `components/data`'s live one], `implementation-queue.tsx`, `lifecycle-strip.tsx`, `morning-brief.tsx`, `poll-health-calm-banner.tsx`, `collapsible-section.tsx`, `stat-sparkline.tsx`, `today-metrics-disclosure.tsx`, `today-primary-action.tsx`, `top-pick-builder.ts`) orphaned since the 2026-06-28 `today-v2-sections.tsx` deletion — each host deletion had left its dependents, and their dedicated architecture contract tests, stale for days to weeks without a full sweep. Also deleted: `recommendations-v2-working-rail.tsx` (the `/recommendations?v2=1` layout's Working rail — that layout's client, `recommendations-v2-client.tsx`, was already gone; the rail never had a live host), the fully-dead `domains/insight` State-of-the-Union chain (`state-of-union.ts`, `compute-state-of-union.ts`, `compute-opportunity-map.ts`, `outcome-prior.ts` — none had a caller anywhere), `gap-ledger.ts` (`domains/product`, zero importers), `today-competitor-line.ts` (`domains/competitors`, zero importers — was the one thing calling `builder-benchmark.ts`'s now-deleted dead `topNextMoves` field), `today-one-decision.ts` + `today-next-line.ts` (`src/lib`, zero importers anywhere, only referenced each other and their own tests), `load-why-them.ts` (`domains/competitor-intel`, zero production importers — its `getPromptLibrary()` call was the operator's original UX5-brief candidate #4; the rest of the prompt-library store stays, `diagnostics/page.tsx` and `find-wiki-citations.ts` both still call it), `site-findings-labels.ts` (vocabulary module built exclusively for the dead Today components above).

Trimmed rather than deleted where a live type/export shared a file with dead code — same pattern the codebase already uses for the legacy `/today` substrate (a v2 loader narrows a big legacy type for field shapes even after the component that populated it is gone): `page-primary.ts` kept `actionLabel`/`PRIMARY_ACTION_LABEL` (used by `today-v2-data.ts`), dropped `resolvePagePrimary`/`REVIEW_HREF`/`estimateConfidence`/`estClicksLabel` (zero callers beyond their own test); `today-summary.ts` kept the `TodaySummary`/`TodayVerifiedFix`/`TodayNextMove` types (still the declared shape of `today-shared-types.ts`'s `TodayClientProps.summary` field), dropped the dead `buildTodaySummary` function whose only reachable output linked to the deleted `/pages`; `command-center-data.ts` kept `isOperatorMode` (5 live `/diagnostics/*` importers), dropped `resolveCommandCenterData`/`deriveBrainSummaryFromCounts`/all the `CommandCenter*` types; `builder-benchmark.ts` kept everything except the dead `topNextMoves` field (whose only consumer was the now-deleted `today-competitor-line.ts`) and its two `/pages` hrefs; `today-shared-types.ts` dropped the now-fully-unread `commandCenter`/`commandCenterIsOperator` fields. Repointed the one live dead-end link: `today-newpages-card.tsx`'s "Plan this page" CTA was `href="/pages"` (a stub even before deletion); repointed to `/worklist#new-pages`, matching the identical pattern one line away in the sibling `today-newpages-section.tsx`. Removed a stale command-palette help section documenting hotkeys (`resolveQueueKeyAction`) for a queue client (`recommendations-v2-client.tsx`) that no longer exists. Removed a dead `workbench` breadcrumb case in `app-header.tsx` pointing at the deleted route.

Deleted the never-wired `BEACON_AUTO_PROMOTE_SCHEMA` flag (`src/lib/flags.ts`) — its own header comment and two prior doc entries already said "OFF by default, no scan-side wire-up shipped"; zero production callers, only defensive test mocks. Deleted 67 orphaned scripts under `scripts/`: 58 confirmed independently via a `git grep`-per-filename pass across the whole repo (zero hits outside the file itself — not in `package.json`, not imported, not in any doc); plus `audit-schema-missing.cjs` (superseded `.cjs` duplicate of the still-used `.ts`), `run-import.ts`/`test-import.ts`/`classify-historical-changes.ts` (explicitly flagged for deletion in the still-live `docs/PROFOUND_MAY_10_READINESS.md` punch list — `customer-one-backfill.ts`, the 4th script that doc named, was kept: `tests/scripts/customer-one-backfill.test.ts` imports its functions directly), `_probe.ts`/`_check-recent.ts` (named as "ad-hoc debug throwaways" in an archived audit, never acted on), and the superseded `mock-next-cache-cli.cjs`/`_next-cache-shim.cjs` pair (package.json/vitest.config.ts both wire the differently-named `mock-server-only.cjs` instead).

Architecture test fallout from the second wave: 9 tests trimmed to their still-live pins (`exec-confidence-default-surfaces`, `repeat-citation-no-customer-surface`, `threshold-decision-loader-wiring`, `indexability-diagnostics-operator-only`, `ux6-1-trust-restoration-contract`, `perf-recs-detail-fast-not-found`, `v2-recommendations-no-customer-legacy-hops`, `no-banned-dash-display-surfaces`, `metric-honesty.test.tsx`), 9 deleted outright because every remaining assertion was about a deleted file (`today-command-center-contract`, `ux5b-premium-hierarchy-contract`, `ux6-2-vocabulary-hierarchy-contract`, `off-site-customer-tile-no-queue`, `off-site-customer-tile-safe-copy`, `repeat-citation-today-tile-band-counter`, `pages-smoke`, `scan-action-delegates`, `scan-action-revalidate-after-scan`). `docs/ARCHITECTURE_INVARIANTS_CATALOG.md` synced by deleting the corresponding rows outright (following the catalog's own documented option-(a) precedent from the 2026-07-01 `perf-today-discrepancy-gated` retirement — "file + row deleted", not marked `retired`, since `retired` is reserved for rows whose file is intentionally kept for history) and updating three rows (`threshold-decision-loader-wiring`, `indexability-diagnostics-operator-only`, `repeat-citation-no-customer-surface`) whose prose still described a since-deleted pin.

**Files touched:** 161 files deleted, 48 edited (see git diff for the full list — the largest single categories are `scripts/*` (67 deletions), `src/components/today/*` (16 component + 10 test deletions), `src/app/(shell)/{pages,topics,workbench}/*` (route deletions), `src/domains/insight/*` (9 deletions), and `tests/architecture/*` (9 deletions + 9 trims)).

**Verified:** `npm run typecheck` clean (re-run after every batch of deletions, including a `.next/types` cache clear each time — Next's route-manifest cache holds stale route references otherwise). Full `npm run test`: 18988 passed, 62 pre-existing skips, 1186 test files passed / 1 failed. The 1 failure (`src/domains/refresh/refresh-surface-pins.test.ts` — "places the fading row below the language-gap row") is confirmed pre-existing and unrelated: `git diff` shows zero changes from this sweep to `war-room-sections.tsx` (the file the test reads), and it matches the exact failure the concurrent N14 agent's session already documented as "inside the concurrent UX4 agent's in-flight `war-room-sections.tsx` rewrite." Dev server smoke via `curl -m 200`: `/`, `/worklist`, `/proof` all 200 (unchanged); `/pages`, `/topics`, `/workbench` now correctly 404 (were 200-stub/200-full before); `/recommendations` still 200 (its intentional redirect to `/worklist?status=ready` fires, confirmed with `-L`); `/topics/opportunity/test-id` still 200 (kept route renders).

**Caveats:** (1) `builder-benchmark.ts`'s `issues: PersistedIssue[]` parameter is now unused inside `computeMarketBenchmark` (only fed the deleted `topNextMoves` block) but was left in the public signature rather than changed, since both live callers (`settings/history/results-page.tsx`, `diagnostics/page.tsx`) pass it positionally — a signature change is a separate, larger-blast-radius edit than this sweep's scope. (2) `builder-benchmark.ts`'s `strongestAreas`/`weakestAreas`/`biggestLosses` output fields are also unread by any current caller (confirmed via grep) but were left in place — trimming them is general dead-field pruning across live, actively-modified domain logic, a different and larger task than the route/component/script/flag deletions this pass targeted. (3) Did not touch `src/domains/allocator/*`, `src/domains/ask/*`, `src/domains/demand-graph/*`, `src/domains/serp/*`, `src/domains/ownership/*`, or `docs/HANDOFF_VERIFIED_STATE.md`/`docs/VERIFICATION_LOG.md`'s N2/ownership-registry entries — those are the concurrent N-track agent's in-flight work, confirmed via `git diff` to have zero overlap with this pass. (4) Left the `/experiments` and `/opportunities` redirect stubs alone — both are zero-inbound-link 1-line redirects, but per `navigation.ts`'s own comment and the `customer-nav-exposure` test's allowlist they are deliberate direct-URL/bookmark-compatibility shims, not orphans; deleting them would only break old bookmarks with no code-health benefit. (5) Historical dated log entries elsewhere in `docs/` (audits, old plans) that mention the deleted files by name were left as-is — they are an accurate record of what existed at the time, consistent with how this repo's docs already treat prior deletions (e.g. `today-client.tsx`'s 2026-06-16 deletion note above still names files that no longer exist).

## 2026-07-02 FINISHED PRODUCT wave 1 (FP1, FP2+FP9, FP6a, FP7)
Operator verdict ("screams unfinished, would pay 0 dollars") drove a 12-agent diagnosis
(wf_b48c0a1f-301): verdict = finish, not features. Wave 1 shipped: FP1 always-paint floor
(layout.tsx zero blocking reads, load-with-deadline helper, honest-delay copy; / and /competitors
stream-close at ~8s through a live Supabase 522 storm that previously held streams open forever),
FP2 worklist root fixes (lever-aware forecast fallbacks replace the 90x stamped sentence, null-page
dedupe, cannibalization rationale reconciled, suppressed-rows note, Ready-0 explanation), FP9 top-3
picks + 20-row cap + expander, FP7 dead-data cleanup (Difficulty column removed, zero-signal rows
collapsed, cron panel one-liner until first receipt, keywords hero line), FP6a design primitives
(Card/Pill/SectionHeader/EmptyState/PageShell on existing tokens, 5-size type scale, twMerge
font-size fix, raw-palette ratchet baseline 2884). Verified: npm run typecheck clean; guard 19/19;
catalog synced; 4,600+ targeted tests green incl. 108 new FP2 tests, 35 FP6a, 51 FP7, 420+ FP1.
Live walkthrough: "This section is taking longer than it should. It will be here on your next
visit." quoted from the real / and /worklist streams. Known open (wave 2 head): /worklist
/research/keywords /settings/connectors /ask page BODIES are still unbounded (pre-existing) and
hang when Supabase 522s; prod unaffected (200 in 2.2s).

## 2026-07-02 FINISHED PRODUCT wave 2 (FP6b: worst-3 raw-styled surfaces migrated to primitives)

Migrated the three worst raw-Tailwind-palette files under `src/app/(shell)` onto the FP6a
primitives (Card/Pill/SectionHeader/EmptyState) + globals.css tokens + the five-size type scale,
per the FP6a audit's own worklist (`today-moves-card`, `changes-list-client`,
`daily-experiments-section`; `war-room-sections.tsx` and `today-newpages-card.tsx` deferred to a
later wave). Per-file raw-palette-class counts (same `RAW_PALETTE` regex the guard test uses):
`today-moves-card.tsx` 597 -> 69, `changes-list-client.tsx` 340 -> 34, `daily-experiments-section.tsx`
280 -> 0. Live `src/app/(shell)` total: 2884 (prior baseline, itself already lower than the guard's
constant thanks to concurrent FP-wave edits) -> 1773 measured after this migration; lowered
`RAW_PALETTE_BASELINE` to 1773 in the same commit.

Method: every status chip mapped to one of Pill's six intents (STATUS_CHIP: suggested/blocked/
skipped -> neutral, ready/apply/verify "In progress" -> waiting, measuring -> measuring, a settled
"Done" result -> neutral since the status alone never says won/lost; STATUS_INTENT for the
execution-checklist statuses: not-yet-applied -> neutral, verification/activation/gsc-pending ->
measuring, verification_failed -> attention, verified_live/active -> live, gsc_submitted -> won, the
one celebratory treatment, for the fully-told-Google state; MoveCard's confidence high/medium/low ->
live/waiting/neutral, since confidence is a forecast not a verdict). Every bespoke card container
converted to `<Card>` (or its token classes when the container needed a non-Card element, e.g. an
outer `<section>`/`<details>`); the ChangesListClient goal-group and "Other improvements" headers and
the DailyExperimentsSection h2 converted to `<SectionHeader>`; the empty-changes-list state converted
to `<EmptyState>`. Deleted every `dark:` variant across all three files (0 remain; tokens make the
dark palette free). Kept deliberately, with an inline comment at each site: the four action-tone
identity colors on MoveCard (citation=violet/clicks=sky/experience=amber/page=emerald - a real
per-category identity the six verdict-based Pill intents don't cover), the MoveCard "Research" violet
box and "Prepared" indigo box (distinct content-type identities), and ChangesListClient's FAMILY_CHIP
per-lever-family colors (10 content-type identities, not verdicts) - all called out in this commit's
source comments so a future pass doesn't collapse them onto Pill intents.

**Behavior-preservation evidence:** ChangesListClient's D6 session loop (j/k/enter/d, next-best
highlight/auto-scroll), UX3 (strategy tabs, top-3 Start-here block, 20-row cap + expander, split
detail panel, multi-select + bulk bar, applied-batch collapse) and the Measuring-tab canonical-count
badge are all still pinned by their existing source-string tests, unchanged except one honest
class-assertion fix (see below) - zero logic edits, only classNames + JSX container swaps. Full
targeted suite before vs after: 176 tests / 13 files green both times (`changes-list-client-ux3`,
`changes-list-client-session`, `daily-experiments-section`, `daily-experiments-copy`,
`changes-list-client-measuring-badge`, `stage-in-wix-surfaces`, `batch-adjudicator-final-review`,
`source-freshness-surface-pins`, `citability-surface-pins`, `learned-prior-surface-pins`,
`feature-steal-surface-pins`, `dossier-sections`, `design-system-guard`). One class-assertion pin
fixed honestly: `changes-list-client-ux3.test.ts`'s literal `border-t border-gray-100 px-1 py-1
lg:hidden` regex updated to `border-t border-border-subtle px-1 py-1 lg:hidden` (the same layout
classes, now on the token). Also fixed a pre-existing em dash in `changes-list-client.tsx`'s
Measuring-tab empty-state hint copy (unrelated to the class migration, caught while editing the same
line).

**Verified:** `npm run typecheck` clean except two pre-existing unrelated errors in
`worklist-surface-store.test.ts` (confirmed via `git stash` to predate this change - a concurrent
agent's in-flight file in the same worktree). `npx vitest run` on the 13 files above: 176/176 passed,
both before and after. `design-system-guard.test.ts`: 19/19 passed with `RAW_PALETTE_BASELINE`
lowered to 1773. A scratch `renderToStaticMarkup(<ChangesListClient .../>)` smoke render (added and
removed in this session, not committed) confirmed `data-slot="pill"` and the FAMILY_CHIP label
actually appear in real output, not just in source.

**Caveats:** (1) Live dev-server curl of `/` and `/worklist` returned the pre-existing
`beacon.deadline.timedOut` / "This section is taking longer than it should" HonestDelay fallback
(FP1) both times at a consistent ~25s, before MoveCard/ChangesListClient ever render - confirmed via
`git stash` + repeated curls that this is a pre-existing data-loading deadline, not a regression from
this change (both routes return HTTP 200, no compile errors, and a concurrent agent was heavily
rebuilding `worklist/page.tsx`/`proof/page.tsx` in the same dev-server process at the time). Visual
confirmation of the live rendered page is therefore based on typecheck + the source-pinning test
suite + the scratch render smoke test, not a resolved live curl; recommend re-checking the rendered
page once the dev server is quiet. (2) Did not touch `war-room-sections.tsx` or
`today-newpages-card.tsx` (explicitly deferred to a later wave) or any of
`worklist/page.tsx`/`research/keywords`/`settings/connectors`/`ask`/`proof` (concurrent agent's
territory, confirmed untouched via `git diff --stat`).

## 2026-07-02 FINISHED PRODUCT wave 2 (FP1 extension + FP6b + snapshot guard)
Always-paint extended to every page: /worklist closes at 25.4s, /research/keywords 15.5s,
/settings/connectors 15.4s, /ask 15.5s, /proof 20.1s, all measured LIVE during the Supabase 522
storm (the honest fault path); declared Suspense boundaries == resolved on all five; bare pulse
fallbacks replaced with content-shaped or deadline-paired states. Root-caused and guarded the
empty-snapshot poisoning: the fail-soft rebuild persisted a 0-move worklist surface during the
outage; writeWorklistSurface now refuses to replace a non-empty snapshot with an empty rebuild
(5 new tests) and the poisoned snapshot self-heals on the first healthy rebuild. Drive-by fix:
operator-only "What Beacon has learned" section was leaking to all viewers (un-awaited
isOperatorModeServer always truthy). FP6b: three worst files migrated onto tokens + primitives
(today-moves-card 597 to 69 raw classes, changes-list-client 340 to 34, daily-experiments-section
280 to 0, dark: variants deleted, behavior pins green before and after); ratchet lowered 2884 to
1773. Gates: npm run typecheck clean; 350+ targeted tests green across both lanes + guard 19/19.
Caveat: real-content visual pass blocked by the ongoing local Supabase data-path outage (health
endpoint answers, REST reads wedge); prod unaffected (login 200 in 1.7s). Re-verify visuals after
recovery or on prod.

## 2026-07-02 FINISHED PRODUCT wave 3 (FP3+FP5, FP6b-2, FP10a)
One-count story: lifecycle-counts.ts encodes the single DECIDED/MEASURING/TONIGHT rule; Today
tiles, Changes strip, Results header and bands all read it; Results header renders "You have
shipped 25 changes. 9 have a final read (3 wins), and 16 are still measuring below." and the
worklist chip renders "Tonight: 6 picked, 6 applied. See them on Today." One home per job:
tonight's cards, New Pages board, measuring list, and the /proof archive each render exactly
once (see the wave's duplication table in the FP3+FP5 report). today-newpages-card 144 to 22 raw
classes + dark-broken board fixed; Connections collapsed to a real status surface. Ratchet holds
at 1651 (one new raw focus ring converted to the ring token during the gate). Gates: typecheck
clean, guard 19/19, proof 88/88, 300+ targeted tests + 1,300+ in the FP3+FP5 lane, 124 connectors,
48 newpages. Live streams still show honest-delay fallbacks locally (Supabase 522 storm ongoing);
copy verified via render tests; prod unaffected.

## 2026-07-03 FINISHED PRODUCT wave 4 (FP8, FP6b-3, FP10b, prompts anti-stall)
FP8 the $250 answer: one cumulative outcome strip on Today + Results ("Your win is adding about 90
extra clicks a month, measured against similar pages we did not change." / zero-verdict state names
the real first-verdict date); dollar line only when GA4-backed; 12-chip proof cards collapsed to
one line + Show-the-full-read; 12 new pure aggregation tests. FP6b-3: war-room-sections 187 to 19
raw classes, 107 pin tests green. FP10b: competitor intelligence folded into /prompts with real
rows (en.wikipedia.org 74 citations, steal-this links into the worklist), /competitors redirects,
debug console relocated to /diagnostics/competitor-intel, outreach pipeline preserved there, nav
Research = Keywords + AI questions. Rider: /prompts head reads deadline-bounded (the pre-existing
indefinite stall FP10b found is closed). Ratchet 1342. Gates: typecheck clean; wave-4 batch 951
tests green; FP8 sweeps 756 + 4482 architecture; FP10b final gate 964. Prod smoke pending deploy.

## 2026-07-03 FINISHED PRODUCT campaign complete (FP4 final slice)
FP4 route + vocabulary collapse: /worklist is now /changes and /proof is now /results for real
(308 redirects with query preservation from every legacy path; /moves /opportunities /experiments
/recommendations /ai-questions /competitors /connections shims retargeted; /expansion deleted);
page titles and breadcrumbs derive from the nav registry (the "research / Detail" class is dead);
one Settings registry feeds the sidebar and the tab strip; Ask citation chips render human names
via plain-language and dedupe; the cockpit button reads Changes (the four-names finding closed);
golden-path copy says Results. CLOSEOUT GATES: npm run build compiled clean on the renamed
routes; FULL suite in a clean shell 19k-scale green (1,202 test files, one stale copy string
fixed during the gate); typecheck clean. All ten FP moves are now shipped (FP6 migration covered
the five worst files; remaining raw classes are documented identity colors, ratchet 1342 and
falling). The campaign's diagnosis quotes and kill list live in run wf_b48c0a1f-301.

## 2026-07-03 FINAL LIST R2 + R4 (T0c deadman + results snapshot + one dollar rule)
R2/T0c: pure deadman classifier (healthy/late/stalled + honest never-ran grace + two-strike site
probe), Today banner joins the existing alert block (never a second widget), cron panel shows the
same words per job, vercel.json-vs-schedule-map preflight on /diagnostics, nightly PHASE 4b site
probe, and SIX receiptless cron routes now write cron_runs receipts (they were unwatched). 366
tests. R4: results-surface-store SWR snapshot (empty-rebuild guard replicated; every ledger
mutation invalidates through one choke point; /results opens instantly with "I last re-checked
these numbers against your Google data N minutes ago"), and won-dollar-rule.ts makes the stricter
exclusion set THE dollar rule on Today strip, scoreboard odometer, and proof summary, pinned by a
dollar-parity test. Combined gate: typecheck clean, 423 targeted tests green, ratchet 1342.

## 2026-07-03 FINAL LIST R3 (T0b one-click recovery)
New src/domains/ops/recovery-actions.ts (pure, no I/O): the ONE map from a failure state to
{plainProblem, exactFix, href, selfServe?} for every connector failure (token expired/revoked,
never connected, sync stale, zero rows written, Wix url-map empty, GSC property-mismatch/www-host
trap), every cron pace (late/stalled, honest own-schedule wording when no button exists, never
"investigate this"), the site-down probe, and the 5 [G] operator-gated setup items. Never invents a
write action, only names existing ones (Google reconnect, per-source Sync now, the Wix mapper, GSC
deep-backfill start). Wired into three surfaces off the same map: connectors-client.tsx (new
ConnectorFixLine on GA4/Profound/Clarity + a Wix-specific wix_url_map_empty line, new
wixUrlMapCount prop from page.tsx via getWixUrlMap().length), cron-health-panel.tsx (a "Fix this:"
line under every late/stalled job row and the collapsed no-history line), and ops-pipeline-section.tsx
(Today's data-pipe alert matches each deadman sentence back to its job via DeadmanVerdict.jobs and
appends a "Start with:" line from the same map; deadman.ts's own pinned sentence copy is untouched,
this line is additive). New src/domains/ops/finish-setup.ts reads real state (Wix url-map row
count, BEACON_DIGEST_TO+RESEND_API_KEY presence by name only, IndexNow config presence, GSC
backfill-progress status, revenueModel presence) into a new self-hiding "Finish setting up" card at
the top of /settings (finish-setup-card.tsx). Corrected two setup-item facts while building: GSC
full backfill deep-links to /diagnostics/connectors's real "Load my full Search Console history"
button (was pointed at a page with no such button); the digest email item honestly names Vercel env
vars since no in-app form sets BEACON_DIGEST_TO/RESEND_API_KEY. Rendered examples: GA4 auth failure
"Fix this: Click Connect Google Analytics on the Connections page to reconnect. It takes under a
minute and nothing else changes."; stalled sync-connectors cron "Fix this: Pull each connected
source's data yourself right now with the Sync now button on its card, on the Connections page.
Open the Connections page."; Wix connected + 0 mapped pages "Fix this: Open Wix page mapping and
click Discover collections, then Save mapping for each page type. I cannot publish anything to your
site until this is done." Verified: npm run typecheck clean project-wide; 106 new tests (33
recovery-actions unit, 14 finish-setup loader, 4 finish-setup-card render, plus new/updated render
pins in ops-pipeline-deadman/connectors-wix-card/connectors-ga4-card); targeted sweep across
src/domains/ops, src/app/(shell)/settings, ops-pipeline-deadman.test.tsx, src/app/(shell)/diagnostics,
tests/app/diagnostics, tests/app/settings, and the FULL tests/architecture suite all green: 5054
tests total, 0 failures, 32 pre-existing skips (including no-banned-dash-display-surfaces and
gsc-no-hardcoded-site-url). No dev server (verified via tests); no migration, no new env var, no new
write action. Caveat (flagged, not fixed): connector-store.ts's pre-existing getConnectorHealth()
healthReason strings carry 2 em dashes, a pre-existing violation spawned as a separate background
task rather than touched in this pass.

## 2026-07-03 FINAL LIST R5 (N15 effect-size learning + N16 sustainable control pool)

N15: new pure src/domains/learning/effect-size-prior.ts learns from the MAGNITUDES of settled
outcomes (not just won/lost): per (lever family x page-type band) bucket, a recency-weighted
(~90 day half-life) mean relative-clicks lift shrunk toward the site mean by 3 pseudo-observations,
minimum 3 decided samples per level with a backoff ladder bucket -> lever -> site -> neutral, output
clamped [0.8, 1.3] plus a plain tag ("Changes like this earned about +12 percent clicks on average
across 4 finished tests"; the site-level backoff is deliberately tagless so cards never repeat a
generic line). Decided rows come through the IDENTICAL maturity/weather/parallel-trends gate the
win-rate prior uses (new gateRecordsToEffectObservations/loadEffectObservations in
load-experiment-outcomes.ts); read-only over the ledger. Wired at the same post-score seams:
load-graph.ts applies applyEffectSizePriorToMoves right after the win-rate prior (MoveCandidate
gains effectPrior; the worklist card's learned slot prefers the magnitude tag when a real bucket
fired), and the nightly planner folds effectPriorScoreFactor into scoreCandidate with the prior
resolved in build-today-preview.ts from the already-loaded ledger and frozen onto the plan record
(daily-plan-types/build-daily-plan-record; new EffectSizeTag on both pick cards). Byte-identical
ranking when no level has 3+ usable settled magnitudes, pinned.

N16: control-contamination.ts gains computePoolHealth (still-clean count over the effective
serving set + the untreated frozen-pool bench; unverified scan coverage counts as still clean so
sparse scans never fake damage), lastCleanDonorHoldSentence, and medianBandRead (>=3 same-family
untouched pages). attach-control-contamination.ts: every attachment now carries poolHealth +
poolHealthLine ("2 of 4 comparison pages are still clean.", open measurements only, rendered in
the Results "See the math" expander via a new controlPoolHealthLine passthrough on
buildMeasurementPresentation); when the frozen pool is EXHAUSTED it falls back to a median-band
read (reuses buildPermutationNull's shared-window deltas, lazily imported, max 3 ships per pass,
sentence: "Every comparison page for this change was disturbed, so I checked it against the typical
untouched page in its section instead... That is a weaker comparison, so I am reading this result
cautiously.") appended as the card's visible caveat, still feeding N10's grade as shaky through the
existing contamination flag; and computeLastCleanDonorHolds feeds a new planner input
(lastCleanDonorHolds -> ExcludedReason "last_clean_donor" with the plain hold sentence, same
pattern as interference_hold), wired in build-today-preview before planDailyExperiments. Frozen-pool
ordering from N13 untouched: no re-ranking, no outcome-aware selection, nothing persisted.

Verified: npm run typecheck clean project-wide. New/extended tests: effect-size-prior.test.ts (22:
relative-lift extraction incl. pro-rating + clamps, half-life weights, shrinkage math on fixtures,
backoff ladder, [0.8, 1.3] clamp, tag wording dash-free, byte-identical-when-thin pin, seam apply),
load-experiment-outcomes.test.ts (+7 decided-magnitude gating), control-contamination.test.ts (+11
pool health, median band, hold sentence), attach-control-contamination.test.ts (+8 pool-health
line, holds, median-band batch incl. not-exhausted negative), daily-experiment-planner.test.ts (+7
effect fold + last_clean_donor hold + identity-when-empty pins), effect-prior-surface-pins.test.ts
(11 wiring pins). Targeted sweeps all green: learning+experiments+proof-gsc (68 files / 1180
tests), demand-graph+demand+results (37/414), src/app (58/627+1 skip),
strategy-review+global-patterns+team-scoreboard (14/229). No dev server (tests only per the R5
brief); no migration, no new env var, nothing persisted to the ledger.

## 2026-07-03 FINAL LIST R3 + R5 (T0b recovery map + N15/N16 learning depth)
R3/T0b: recovery-actions.ts maps every detectable failure to plainProblem + exactFix + deep link +
existing self-serve action (reconnect, sync-now, Wix mapper); wired into Connections cards, the
cron panel, and the Today alert block (one fix story everywhere); "Finish setting up" checklist on
/settings for the five operator-gated items, self-hiding when done. 106 new tests, 5,056 sweep.
Also fixed three pre-existing em-dash operator strings in connector-store healthReason. R5: N15
effect-size prior (control-adjusted magnitude, 90d recency half-life, shrinkage toward the site
mean, 3-sample backoff ladder, clamp 0.8-1.3, byte-identical-when-thin pinned) applied at the
proven post-score seams (load-graph + nightly planner) with a plain magnitude tag on cards; N16
pool health ("2 of 4 comparison pages are still clean"), median-band fallback when the frozen pool
exhausts (graded shaky, honest caveat), and a last-clean-donor planner hold. 66 new tests; suites
1,180 + 414 + 627 + 229 green. Combined gate: typecheck clean, 1,515 targeted tests green.

## 2026-07-03 FINAL LIST R8 + R9 (factories unfrozen + one CTR curve)
R8: N5 info-gain gate (adds_something / thin_addition / duplicate_of_serp with the strongest
novelty or overlap named; unchecked no-op pinned) hard-gated in the create pipeline + the weekly
factory; N28 governor (5 new pages/week, topic-twin block, 10 percent monthly growth cap, honest
refusal reasons persisted to the batch card); N18 snippet-promise trigger (cost/list/how-to/date
promises vs the first 200 words). FACTORIES UNFROZEN. 52 new tests; sweeps 450 + 6,827 + 1,281.
R9: four rival position-to-CTR tables consolidated into tenant-ctr-curve.ts (median-bucket fit
from own GSC with sample floors, brand excluded, honest basis copy; one dead rival deleted);
title scorer retrains from settled tests with the bounded thin-data-neutral discipline. 48 new
tests, ~4,300 sweep. Closeout: typecheck clean; FULL suite in a clean shell green after updating
three stale em-dash pins in connector-store-supabase.test.ts (1,229 files).

## 2026-07-03 FINAL LIST R10a + R11 (measurement rigor slice 1 + question universe)
R10a: four computed-only measurement reads (frozen query panel with direction-disagreement
sentences, weekday-median baselines preferred when they differ 20 percent, early-decisive/futile
flags that never touch the clock, novelty-decay detection), all feeding N10 as optional inputs,
nothing persisted to measurement history. 57 new tests; proof-gsc 690 + consumers 309 green. R11:
N30 question universe (4 sources merged, registry-token dedupe, coverage vs real page extracts,
demand x not-covered rank, nightly phase 2a-q, three consumers pinned byte-identical-when-empty,
"Questions people ask that no one answers well" on /prompts), N20 SERP consensus (3-of-5 rule,
outliers named and never briefed, 2-source hole closed), N29 featured-snippet capture (format-
matched steal directives, honest long-shot framing vs strong owners). 44 new tests; sweeps 654 +
1,261 + 665 + 4,600 + 1,409. Combined gate: typecheck clean, 1,266 targeted green. Ground truth
on real rows still owed: the Supabase data plane remained unreachable all session (522s), the
universe store fills on the first healthy nightly.

## 2026-07-03 R1 COMPLETE: two production root causes found and fixed
(1) Supabase instance wedged ~8h: every statement timed out; postgres logs showed even internal
health queries at 10-14s. Fixed with a management-API restart; database answered on poll attempt 6.
(2) CRON_SECRET was never set in Vercel: the cron route fails closed without it, so ALL 8 scheduled
jobs have been refused since the auth check shipped. This, not code, is why cron_runs was empty,
why the AI answer feed wrote 0 rows, and why ga4_ai_referral_daily never filled. Fixed: secret
generated, added to Production env (also in local .env.local), redeployed, then the sync was
triggered through the real cron path: 200 in 115s, Iranopedia synced GSC + GA4 + Clarity +
Profound, Ritz honestly failed google_gsc (transient) + google_ga4 (token expired, the recovery
map's exact case). First real receipt persisted to cron_runs and the deadman/receipts panel now
runs on real data. Empty worklist snapshot self-heals on the next healthy rebuild.

## 2026-07-03 R13b (N25 N26 N27) + live pipeline ground truth
Stale-fact detection (deadlines 180d/540d/never, aged-year auto-fast, says old never wrong),
fact propagation (one bundled once-only plan per correction, prepared atomic fixes on the
diagnostics history, never-auto-push pinned by construction), volatility deadlines. 155
provenance tests + 112 adjacent + 548 regression green; typecheck clean. LIVE GROUND TRUTH after
the CRON_SECRET fix: question-universe blob 37.7KB written 13:00 UTC by phase 2a-q's first real
run, site-uptime-probes written 13:01 by the R2 probe's first run, ga4_ai_referral_daily 226
rows; worklist-surface still the pre-outage empty snapshot, self-heals on next visit/precompute.

## 2026-07-03 R12 + R14b shipped together (+ GA4 time-bomb fixture defused)
R12/T0e: URL-first onboarding (/onboard takes a URL, probes reachability, first-look crawl),
resumable crawl-frontier store past the 18-page cap (15 pages/45s batches, nightly continuation
phase 1d-2b + Keep-scanning action, 150-page cap, robots-respecting), day-0 baselines through the
existing capped gauntlet ($0), /onboard/done first-audit scorecard with a guided first win
("Your first win. Add a search description."), stalled-signup rescue on /diagnostics. 47 new
tests. R14b: receipts under 10 trust-critical assertions via one ReceiptLine convention,
see-the-math on the dollar strip + forecast rows, named dashed comparison pages on /results
charts, spend-to-outcome rows on /activity, /settings/how-i-decide rendering 12 thresholds pinned
to their enforcing constants, CSV export on /results + /activity. 60 new tests. Also defused the
GA4 revenue test time bomb (fixture token expired by real calendar on Jul 3; now relative).
Combined gate: typecheck clean, 714 targeted green, architecture 4,526, ratchet 1342.

## 2026-07-03 R15 (N4 + N17) behavior-verdict lane + task completion
N4 behaviorOutcome: computed-only attachment per shipped change on the live_at clock (never the
GSC/recrawl clock) reading GA4 engaged share + conversions (ga4_url_traffic) and Clarity
frustration per 100 visits + quick-back share (clarity_daily_url_metrics) for the treated URL,
with hard sample floors (50 GA4 sessions / 100 Clarity visits per window, honest null per metric
below them) and one plain composite sentence (better/worse/mixed/same variants + visit receipt).
N17 taskCompletionShare = engaged share adjusted down by quick-back share, same floors; "About 7
in 10 visitors who land here appear to find what they came for." card line + before/after answer
delta line on answer-block/FAQ ships. N10 corroboration-only pin: a won verdict with worse
behavior demotes solid to decent with the reason named; behavior alone never upgrades (no
behavior-better input exists). Wired into the /results card expand as one self-hiding "How
visitors behaved" block after the traffic outcome (with a ReceiptLine), and the cumulative
strip's win rows cite behavior corroboration in the see-the-math expander (one line, only when
present, never a selection input). New files: behavior-outcome.ts (pure), clarity-window.ts,
behavior-window.ts + behavior-outcome.test.ts. Verified: typecheck clean; 960 proof-gsc tests
(53 files), 240 results/strip/changes tests, 77 ask tests green; dash-clean scans.

## 2026-07-03 R15 + R16 shipped (behavior lane + the ONE LLM gateway)
R15 (previous commit): behavior-verdict lane + task completion. R16: every OpenAI call site
consolidated onto src/domains/llm/gateway.ts (allowlist 10 files to 2; page-surgeon judge,
serp-hypothesis, cluster-factory, page-intent adjudicator previously had NO cap or NO timeout,
now capped fail-closed with 90s reasoning floors + error-ledger reporting); 21-entry schema
registry with validate-retry-once-fail-closed; 26-entry prompt registry + regression harness on
recorded fixtures (version bump without fixture fails a named test); content-hash call cache
(300 LRU, $0 hits, bypass on explicit regenerate); de-templating guard (3-gram containment vs
last 20 same-family outputs, flags "reads like a repeat", demotes pack quality); tokenized
numeric firewall with formatting tolerance; injection sanitizer on all evidence-fed prompts (13
adversarial fixtures). Also removed a pre-existing invisible control character in the drafter.
CLOSEOUT GATE: typecheck clean + FULL suite in a clean shell 1,272 test files ALL GREEN.

## 2026-07-03 R17a (P2 GSC depth pack, slice 1 of 3): brand split + gap classification + striking portfolio + anonymized share
Four modules under the new src/domains/gsc: (1) brand-split.ts is now the ONE brand classifier
(R9's brandTokensFor/isBrandQuery moved from tenant-ctr-curve.ts, which re-exports; plus
brandTokensForConfig adding the domain label). The Today scoreboard gains the non-brand growth
sub-line ("Non-brand clicks: N (the growth that finds NEW people), up X% vs the week before.
Counted from searches where Google shows me the words."), windowed on the scoreboard's OWN
last-7/prior-7 reported days via a clicks-greater-than-zero bounded read that DROPS the lens on a
truncated read instead of under-counting. The three biggest mixed-total growth claims now name
their lens: headline ("clicks, last 7 reported days, every search counted"), weekly sentence
("N clicks from every search"), cumulative-strip receipt ("Counts clicks from every search,
including ones that mention your name."). (2) ingestion-gaps.ts classifies every missing GSC day
as final_lag/gap/pre_history from gsc_daily_totals dates (one row per day, egress lean); the
connections GSC card says "I am missing N days of Google data between X and Y. I will re-pull
them tonight." and the nightly sync re-pulls up to 10 gap days a night (newest first) through the
SAME extracted syncOneDay body, writing an explicit zero-totals marker when Google reports
nothing so a genuinely quiet day stops re-flagging (pulled truth, never interpolation). Source
pins keep FINAL_LAG_DAYS and the wiring in lockstep. (3) striking-portfolio.ts owns
isStrikingDistance (moved from gsc-page-queries.ts, re-exported) and aggregates the portfolio
("N searches rank just below the top results... shown X times in the last 90 days" + "Reaching
the top 3 is usually worth L to H extra clicks a month" sized via the tenant CTR curve +
forecastRange's capture band); ONE loader feeds both the keywords hero second line and the Today
demand band (gated over 10 searches, wired into the band's silence checks + quiet line).
(4) anonymized-share.ts computes the hidden-query share per page (page totals vs visible
query-grain sum, both already on gsc_page_signals via the new queryVisibleImpressions90d field)
and the dossier Top queries band notes "About a third of this page's Google traffic comes from
searches Google keeps private. The numbers below cover what Google shows me." over 30 percent.
Verified: npm run typecheck clean; 68 new unit tests across 4 modules (brand fixtures incl.
multi-word brands, gap boundary classification, portfolio aggregation + CTR sizing, share math);
targeted suites green: scoreboard/forecast/keywords (117), dossier + deep-backfill +
scoreboard-section + cumulative strip (104), connections cards + smoke (29), sync-dependent
suites (160), page-signal consumers + demand-graph (503), war-room surface pins (61, four pin
strings extended additively), design-system ratchet + dash guards + jargon guards (87, ratchet
unchanged at 1342). Full suite deliberately not run per slice (CI-minutes rule); typecheck +
targeted only.

## 2026-07-03 FIX: HonestDelay-everywhere on Iranopedia (per-tenant warm)
Operator saw every section on the live app show "This section is taking longer than it should."
Root cause: the precompute/warm cron's cross-tenant cache guard (warm-caches.ts) skipped every
tenant whose ambient context != BEACON_TENANT_ID (=ritz), so Iranopedia's SWR snapshots never
warmed and every section fell to the deadline fallback. Compounded by the Supabase platform
incident (Jun30-Jul3) wedging the instance (restarted via mgmt API) and the earlier
CRON_SECRET-unset bug. FIX (commit 7fb45d8f): precompute re-invokes itself once per tenant with
x-beacon-tenant set; middleware forwards that header ONLY for requests carrying CRON_SECRET
(trusted). VERIFIED: triggered post-deploy, Iranopedia warmed in 71s all-ok, worklist-surface
538 bytes -> 168,433 bytes, today-surface -> 55,495, results-surface 135,338. The empty-snapshot
guard correctly allowed the non-empty rebuild to overwrite the poisoned empty one.

## 2026-07-03 R20 (D6 dynamic auto-mode): auto-advance prepare + live counter + prepare-ahead toggle
Built on the EXISTING D6 static rails (session-flow.ts, worklist-session-strip.tsx) and the
armed-publishing/autopilot rails; nothing rebuilt.
(1) AUTO-ADVANCE PREPARE: the moment a change ships in the session flow, the next best
opportunity auto-prepares in the background. autoAdvancePrepareAction (today-moves-actions.ts)
schedules ONE bounded prepareTodayMovesForTenant pass via next/after (zero latency, never blocks),
cache-first + capped (maxN 3, $0.05) so a warm cache is $0; fail-soft to the on-demand Prepare
button. The card shows honest "Preparing the next one while you work..." -> "The next one is
ready." (reuses Preparing/Ready, no new lifecycle word). PREPARE only, never publishes.
(2) LIVE COUNTER: the session strip shows "N shipped today, M ready, next best is /page." +
"X shipped this week, Y measuring." Derived purely (sessionProgressLine/weeklyOutcomeLine in
session-flow.ts) from the SAME FP3 lifecycle counts (readyCount = tonightPicked-tonightApplied,
measuringCountCanonical, shippedThisWeekCount) now threaded through ChangesView; no new store.
(3) PREPARE-AHEAD TOGGLE: AutopilotConfig.prepareAheadOvernight (DEFAULT OFF, additive) + a
DISTINCT settings toggle (setPrepareAheadOvernight, autopilot-card.tsx) + a new gated
"prepare-ahead" step in warm-caches.ts. Off = byte-identical skip (nightly path unchanged, no
config side effect); on = drafts+SERP-checks the top Moves (maxN 10, $0.15 cap, cache-first).
NEVER publishes - publishing stays operator-gated / the separate publish-autopilot switch. Runs
LAST + isolated + fail-soft. Safe even without one-click publishing armed (it can't write to the
site) and allowed on advise-only Ritz.
VERIFIED: npm run typecheck clean. New/updated unit tests: session-flow (+9: progress/weekly line
arithmetic, self-hide, dash+jargon guards), warm-caches (+3: prepare-ahead off=byte-identical
skip / on=runs last+honest note / failure isolated; existing order+count pins updated for the new
step), autopilot-policy (+3: prepareAheadOvernight default-off/explicit-true-only/independent of
publish), autopilot-actions (+5: perm-gated, on-without-publishing-armed, advise-only allowed,
round-trip, view surfaces flag), worklist-session-strip (+7 render+pins: new lines, prepare
status, done-only auto-advance, single call site, fail-soft to Ready), changes-list-client
session pins updated. Targeted suites green: push+ops+autopilot+settings+changes+tests/app/changes
(675), session-flow+warm-caches+autopilot-policy+strip+session+settings (134). Full shell/app run:
1827 passed, 1 skipped; the only 2 failures are the documented Google-OAuth-callback env-
contamination class (pass in a clean shell: `env -u OAUTH_STATE_SECRET ...` -> 11/11), unrelated
to this change. Full suite deliberately not run per slice (CI-minutes rule).

## 2026-07-03 P9 competitor-watch pack (3 deterministic $0 detectors)

Built the 3 highest-impact, cost-free sub-items of P9, each over ALREADY-PERSISTED
`dataforseo_serp_history` rows (no new paid SERP call anywhere), additive and self-hiding
when empty.

1. **Broken-competitor opportunity** (v1 250+259) - `src/domains/serp/broken-competitor.ts`
   (pure diff: a rival that held a Google top-8 spot in an earlier in-window capture and is
   gone from the latest) + trigger `broken-competitor-alert.ts` (`create_page`, site-root
   anchor, medium confidence). Reader `loadBrokenCompetitorFindings` in `serp-history.ts`.
   Rendered copy (renderToStaticMarkup): "theknot.com used to show up at #1 on Google for
   'persian wedding' and just dropped off. The search still has demand, so this is your
   opening to take that spot with a strong page."
2. **True-competitor discovery** (v1 420) - `src/domains/demand-graph/competitor-discovery.ts`
   (pure overlap: domains that keep appearing in the top-10 across the tenant's tracked
   queries, ranked by how many searches they beat you on) + read-side loader
   `competitor-discovery-loader.ts`. Rendered honest list: "These 2 sites keep beating you
   on the searches you care about." then per-row "supplehomes.com beats you on 3 of 3
   searches (best spot #1)."
3. **Google-results feature appear/disappear alert** (v1 251) -
   `src/domains/serp/serp-feature-change.ts` (pure diff over serp_features /
   ai_overview_present / snippet_owner / paa_questions between earliest and latest capture;
   winnable features only = answer box / People Also Ask / image row) + trigger
   `serp-feature-change-alert.ts` (`add_answer_block`, only "appeared" becomes a Move).
   Reader `loadSerpFeatureChanges` in `serp-history.ts`. Rendered copy: "Google just added
   an answer box for 'farsi numbers'. Add a clear answer block near the top to grab it
   before a competitor does."

Wiring: 2 new predicates registered in `load-trigger-candidates-for-tenant.ts` (PREDICATE_COUNT
21 -> 23), site-root anchor block, cross-source cooldown dedupe already covers them. 3 new
customer-copy templates + probe sets in the vocab invariant. No cron-sync change needed (all
read/generation-time over data the SERP writer already persists).

Empty-safe pins: every detector returns [] / null-headline on empty input, single-capture
history, out-of-window captures, own/noise domains, and no-change; both predicates abstain on
no findings and no site root. Ratchet holds (no `src/app/(shell)` files touched).

Verified: `npm run typecheck` clean. `npx vitest run` serp + demand-graph +
recommendation-intelligence + catalog-sync + trigger-predicate-purity + page-classifier +
no-queue-write + design-system-guard = 931 + 19 green (incl. 39 new detector/predicate tests +
copy-vocab 61 green). renderToStaticMarkup quoted above. NEEDS LIVE DATA TO PROVE: a tenant
with 2+ SERP-history captures per tracked query (Iranopedia once nightly SERP captures
accumulate) will light these up; today they self-hide until the history diff exists. Rest of
P9 (counter-refresh on competitor updates, volatility pre-build check, backlink watch,
teardown-by-traffic prioritization, seed-demand-from-competitor-URL) is roadmapped.

---

## 2026-07-03 — P24 Image-SEO lane (alt-text lever end-to-end)

BEACON_500 P24 (v1 410+576+578 merged, 248, 552). Built the alt-text lever from data the
crawler can capture, three pieces, all additive + empty-safe.

1. **PageSnapshot image extractor** (the blocker) - `src/domains/pages/extractor.ts` now captures
   every `<img>` (src resolved absolute, alt STATE, declared width/height) into a new optional
   `images` field on `PageSnapshot` (`src/domains/pages/types.ts`, new `PageImage` type).
   Distinguishes a MISSING alt (`null`, a real gap) from an EMPTY alt (`""`, decorative,
   deliberately never flagged). Empty -> `undefined` (byte-identical to pre-field snapshots).
   Skips no-src + `data:`/`blob:` placeholders; cap 200. Tenant-agnostic.
2. **Alt-text audit + inventory** - new domain `src/domains/image-seo/alt-audit.ts`
   (`auditPageAltText` + `buildTenantAltInventory`): per-page + per-tenant missing/covered/
   decorative coverage math, demand-prioritized by GSC 90-day impressions, empty-safe when no
   images captured. Rendered headline: "3 of 4 pictures on your site have no alt text."
3. **Activated the `add_image_alt_text` lever** - deterministic drafter
   `src/domains/image-seo/draft-alt-text.ts` (filename -> H1 -> title -> top-query, sentence case,
   never invents) + engine `src/domains/image-seo/classify.ts` + trigger
   `src/domains/recommendation-intelligence/triggers/add-image-alt-text.ts`. Fires for a
   real-demand page (>=100 impressions/90d) with pictures missing alt text, names page + count,
   drafts the description inline. Only EXISTING images (no N5 gate). Registry entry flipped to
   ACTIVE-as-directive (generatorActive stays false on purpose so the LLM is never told to draft
   an edit type it has no generator for). Rendered copy (renderToStaticMarkup, routed to the
   customer `candidates` bucket, no dashes):
   "2 pictures on /persian-food have no alt text, the words screen readers and Google read. Add
   short descriptions so Google Images and screen readers understand them. I drafted: "Persian
   koobideh kabob"."

Wiring: 1 new predicate in `load-trigger-candidates-for-tenant.ts` (PREDICATE_COUNT 29 -> 30,
both loader-test assertions aligned), late fail-soft block with cross-source cooldown dedupe, no
cron-sync change (image capture happens INSIDE the existing scan via the extractor). 1 new copy
template + probe set in the vocab invariant.

Empty-safe pins: old snapshots with no `images` field (contribute 0), pages where every image
already has alt, decorative empty-alt pictures, no-demand pages, and pages where no missing
picture can be grounded into a draft - all abstain / return byte-identical output.

Verified: all 9 edited files parse clean (esbuild). `npx vitest run` green: image-seo (24),
pages incl. extractor + competitor-page-snapshots (317), all triggers incl. add-image-alt-text
(134), action-types + predicate-purity + copy-vocab + catalog-sync + design-system-guard (143).
End-to-end render proof (classify -> trigger -> applyQueueRules -> renderToStaticMarkup) confirms
customer-queue routing + dash-free copy + the inventory headline. `npm run typecheck` is blocked
ONLY by a concurrent agent's in-flight unclosed brace in `src/domains/learning/
load-experiment-outcomes.ts` (line 273, a `M`-status file NOT in this lane); that same parse
error is why the loader test module cannot transform (loader -> demand-graph/load-graph ->
learning/load-experiment-outcomes). My loader source + counter edits are correct and will pass
once that file is closed. NEEDS LIVE CRAWL TO PROVE: a real scan populating `snapshot.images`
for Iranopedia; on hosted Supabase the egress-lean snapshot projection must also add `images`
(same posture as `internal_links`) + a `page_snapshots.images` column migration - a
persistence-owner follow-up (works end-to-end on the file backend today). ROADMAPPED: image
filesize/format audit, next-gen-format nudges, and NEW original/licensed images (behind N5's
gate) are the rest of the P24 pack.

---

2026-07-03 - P20 transliteration + spelling-variant demand (v1 129). Built a GENERIC,
tenant-configured canonical-spelling demand engine (english-first, NO language hardcoding).
New optional per-tenant config `BeaconTenant.spelling_variants` (array of {canonical, variants[]});
absent/empty = the whole feature is a byte-identical no-op (pinned). New domain
`src/domains/spelling-demand/**`: pure `consolidateSpellingDemand` (sums demand across a group's
spellings onto the canonical, returns only genuinely-split groups; script-agnostic normalization
that preserves any writing system), pure `buildSpellingDemandMoveItems` (demand floor + suppresses
when one owned page already ranks for 2+ spellings), and a server `loadSpellingDemandMoveItems`
(reads config + the ALREADY-LOADED GSC signals, $0). ONE new trigger
`triggers/spelling-demand-move.ts` emits a `create_page` Move (reuses existing action type;
trigger_signal `spelling_demand_move`) anchored on the site root. One new copy template
`spellingDemandConsolidationCopy` + its copy-vocab probe set. Wired into the shared trigger loader
as a config-gated fail-soft block. PREDICATE_COUNT 33 -> 34; ALL counter pins updated (loader const
+ 2 loader-test assertions + it()-title + the 2 triggers-page test assertions + the it()-title).
VERIFIED: `npm run typecheck` clean; new suites green (consolidate 20, build-move-items 8,
load-spelling-demand 7, spelling-demand-move trigger 12); registry-adjacent suites green (loader,
triggers-page, copy-vocab, predicate-purity, catalog-sync, design-system-guard,
diagnostic-source-and-copy = 215 tests); keyword-portfolio + tenants + action-types green.
Rendered copy (quoted): "'saffron' and 3 other spellings of it get 1,400 searches a month combined,
more than any single spelling shows on its own (the biggest one is only 620). One page built around
'saffron' that also names the other spellings can own all of that demand at once." ROADMAPPED (v1 374):
optional native-script term surfaced INSIDE the drafted answer/page body; a tenant-config editor UI
for declaring spelling groups (no UI shipped this slice, config is a data field).

---

2026-07-03 - P16 onboarding-intelligence pack (v1 380 CMS detection, 381 robots AI-block,
382 JS-shell rendering). Built a NEW GENERIC `src/domains/site-health/**` domain: three pure,
deterministic, empty-safe READ-SIDE detectors useful for ANY tenant (not just signups).
(1) `detectAiCrawlerBlock(indexability)` reads the ALREADY-PARSED robots.txt allow/deny signals
(gptbot/claudebot/perplexitybot/google-extended/googlebot) and names exactly which AI assistants
and/or Google's crawler are blocked, plainly (e.g. "ChatGPT (GPTBot) and Claude (ClaudeBot)").
Returns null when all allowed/unknown (allowed !== false). (2) `detectJsShellFact(page)` reuses the
existing pure `@/domains/lifecycle/js-shell` `looksLikeJsShell` heuristic (one definition, no drift)
to flag a page whose source HTML is near-empty behind a client app; null when it renders real HTML.
(3) `detectCms(signals)` recognizes the platform (Wix/Squarespace/Shopify/WordPress/Webflow/Ghost/
Duda/HubSpot/Drupal/Joomla) from generator meta > schema @type > URL host > body/asset marker, as a
capability fact (Wix reads push_and_draft since a push lane exists; every other platform reads
draft_only, honest about reach). NO tenant hardcoding; null when undetectable. Plus a self-hiding
token-only READ surface `src/components/site-health/site-health-panel.tsx` (Card/Pill/SectionHeader/
ReceiptLine, no raw palette, no dashes; renders nothing when every fact is empty).
RECONCILIATION: the Move-emitting halves of the robots-AI-block and JS-shell checks were ALREADY
shipped by prior slices (R19 / N22 `js_shell_content` + Slice 4.5.C.alpha2 `robots_blocks_ai_bots`,
both wired in the shared trigger loader). Per the "do NOT rebuild" rule this slice did NOT duplicate
those Moves and therefore did NOT add a loader predicate: PREDICATE_COUNT stays 34 and all counter
pins remain 34 (loader const + 2 loader-test assertions + it()-title + 2 triggers-page assertions).
The site-health domain is the plain-English READ layer that names the specifics the generic Move copy
leaves out (which exact bots, which platform). CMS (v1 380) is genuinely net-new (no prior CMS code).
VERIFIED: `npm run typecheck` clean; new suites green (ai-crawler-block 9, js-shell-fact 6, cms-detect
10, site-health-panel render 5 via renderToStaticMarkup = 30 tests total in the pack, counting the
barrel-covered exports); registry-adjacent suites all green unchanged (recommendation-triggers-page,
load-trigger-candidates loader, customer-copy-vocab, predicate-purity, catalog-sync,
design-system-guard = 236 tests across the affected set). Rendered copy (quoted, verbatim):
robots "Your site tells AI assistants not to read it (ChatGPT (GPTBot) and Claude (ClaudeBot) are
blocked in robots.txt). They literally cannot see you, so they can never recommend you. Unblock them.";
JS-shell "Your /pricing page loads almost empty until JavaScript runs, so the HTML Google and AI
assistants first receive looks blank. Some AI crawlers and older bots do not run JavaScript and may
see a blank page. Add server-rendered text so they can read it."; CMS "You are on Wix. I can push SEO
fields here, and draft the rest for you to paste." ROADMAPPED (stay unbuilt): v1 292/293/294/295/437/
506 signup-funnel / day-0 demand pack / derived-services chips / launch teardown / schema starter
pack / signup-to-first-win instrumentation; and a crawler pass that captures generator meta + asset
hosts onto PageSnapshot so `detectCms` fires on production custom-domain sites (today it fires when
those signals are present, correctly empty until captured).

## 2026-07-06 — RANK-4: wake up Profound's AI-crawler feed (ai_crawler_skip Move)

STEP 0 (verify-first): the two tables were NOT unread. `profound_referral_rows`
already has readers via `src/domains/profound-deep/` (loader + pure aggregators,
shipped 2026-06-25/28) and its signal renders customer-facing on the war-room
("AI answers sent N visitors"), team-standup, and the profound-coverage
diagnostic. The genuine gap was the AI-crawler feed (`profound_bot_rows`): it fed
DISPLAY panels only; the pure `findCrawlabilityGaps` / `buildFunnelLinkHints`
functions existed but were NEVER wired to emit a Move. Built that Move.

- NEW `src/domains/aeo-traffic/load-crawler-skip-gaps.ts` — $0 I/O loader +
  pure `assembleCrawlerSkipGaps` (reuses the shared react.cache bot loader + GSC
  demand + the pure crawlability math). Fail-closed: only produces a gap when the
  crawler feed is reporting; empty feed / no demand / all-crawled -> [].
- NEW trigger `triggers/ai-crawler-skip.ts` (`ai_crawler_skip`, action
  `add_internal_link`) + `aiCrawlerSkipCopy` in customer-copy-templates. Deduped
  against buried_page / orphan_page / internal_link_opportunity by cooldown_key.
- PREDICATE_COUNT 34 -> 35; all three counter pins fixed (loader const + 2 loader
  test assertions + diagnostics page test it()-title and its 2 assertions), plus
  the copy-vocab probe set registered.
- Ground truth: both `profound_bot_rows` and `profound_referral_rows` are EMPTY
  (0 rows, all tenants) — the borrowed Profound workspace is topic-scoped, not
  site-scoped Agent Analytics. The trigger is dormant + empty-safe; it lights up
  with zero further code the moment a site-scoped workspace syncs.
- Verified: `npm run typecheck` clean; 248 tests green across 12 affected suites
  (new loader + trigger, profound-deep bot/referral, trigger-loader + diagnostics
  counter pins, copy-vocab, predicate-purity, catalog-sync, registry-active-set,
  crawl-citation-funnel). renderToStaticMarkup quoted the card copy. NOTE: the
  design-system raw-palette ratchet failure (1304 vs 1298) is from a CONCURRENT
  task's `today-moves-card.tsx` edits in this shared worktree, NOT this change —
  my files add 0 raw-palette classes.

## 2026-07-06 — RANK-3: live Google-results winnability on the existing-page prepare path

STEP 0 (verify-first): confirmed the gap. `prepare-create-page-verdicts.ts`
already runs a live SERP verdict (BUILD/WAIT/SKIP) for NEW-PAGE candidates
(capped 25/run, 14d-cached, persisted as move_drafts kind=serp_verdict, verdict
via validateCreatePage + winnability.ts). `prepareTodayMovesForTenant` did NOT
run any live SERP winnability check for EXISTING-PAGE moves — a move could reach
"ready_to_review" purely because a draft existed, even when the top Google
results are marketplaces/directories a content change cannot outrank.
`derivePreparedStatus` already carried a `hasSerpVerdict` param but the prepare
loop never passed it (defaulted false); the ladder had no "hold" state.

Built (reused the create-page pattern; capped/cached/fail-soft/dry-run-respecting):
- NEW pure `src/domains/serp/existing-page-winnability.ts` —
  `decideExistingPageHold(verdict, moveType)` returns { hold, line }. Holds on a
  marketplace/UGC wall (>=6 or intent=marketplace_ugc) or a winnability-arithmetic
  reject band; never holds on "you already rank" for an edit_page/fix_experience
  move (the ranking page IS what we improve); answer_block + already-ranking is a
  surfaced-but-not-held lower-upside note.
- `prepare-today-moves.ts`: added an OPTIONAL live check per existing-page move
  (answer_block / edit_page / fix_experience) gated EXACTLY like create-page —
  cache-first (fresh persisted serp_verdict reused at $0) then ONE runSerpQuery
  whose own gauntlet (configured -> cache -> DRY-RUN default -> global breaker ->
  per-platform monthly cap fail-CLOSED -> ledger) decides any spend. Verdict is
  derived via validateCreatePage + persisted as serp_verdict (no migration).
  A held move caps readiness at serp_checked and SKIPS the LLM draft entirely
  (saves LLM spend, no confident "ready" for an unrankable target). New summary
  fields: winnabilityHeld, serpCostUsd. New opts: checkWinnability (default ON),
  runSerp (test injection).
- `prepared-move-pack.ts`: `derivePreparedStatus` + `buildPreparedMovePack` take
  an optional `winnabilityHold` (caps at serp_checked) + `winnabilityLine`; both
  additive/omit-default so cold behavior is byte-identical.
- Surface: `today-moves-data.ts` threads winnabilityLine/winnabilityHeld off the
  fresh persisted pack; `today-moves-card.tsx` renders one honest line
  (status-success tokens + Zap when winnable, status-warning tokens + TriangleAlert
  when held) — tokens only, ratchet held at 1298 (did NOT rise).

Quoted rendered copy (renderToStaticMarkup):
- Winnable: "The top Google results here are 5 of 10 real content pages you can
  beat, so this is worth doing."
- Held: "The top Google results here are marketplaces and directories I cannot
  outrank with a content change, so I am holding this until there is a better
  angle."

PIN (additive + zero-spend when inactive): when SERP is unconfigured / dry-run /
cache-empty, runSerpQuery returns disabled/dry_run/capped with NO snapshot -> no
verdict -> no hold, no line, no spend, drafting proceeds exactly as before
(pinned by tests).

Verified: `npm run typecheck` clean. 170 tests green across 11 affected suites
(NEW existing-page-winnability 8, NEW prepare-today-moves integration 7 with
MOCKED DataForSEO — winnable->draft_ready+, marketplace->held@serp_checked+no
LLM call, byte-identical/$0 when dry-run, cap/breaker fail-soft, cache-first $0,
dash guard; prepared-move-pack, draft-quality x2, winnability, serp-validation,
prepare-create-page-verdicts, catalog-sync, design-system-guard, warm-caches).
NO live paid call in tests, no dev server. NEEDS a live DataForSEO run
(DATAFORSEO_DRY_RUN=false, provider+auth set) to prove the real hold on a live
marketplace SERP; the shared $50/mo dataforseo-serp cap governs it and each
existing-page check is ~$0.003 (10 top-moves ≈ $0.03/run, cache-first after).

## 2026-07-06 — RANK-6 (Wix publish depth) VERIFY-FIRST: both audit premises stale, no rebuild

Task premise (RANK-6): (1) fix a url-map pagination bug that silently truncates
Wix collections at 1000 items, and (2) upgrade edit_title / edit_meta drafts from
deterministic template to LLM-quality. VERIFY-FIRST audit found BOTH already built,
wired into production, and tested. No code change made — rebuilding would violate
the extend-not-rebuild contract and duplicate live capability.

Finding 1 (pagination) — ALREADY FIXED. url-map.ts:223 calls
`wixQueryAllDataItems` (client.ts:205-239), which pages the Wix
`/wix-data/v2/items/query` `paging.offset` until a short page, capped at
`WIX_QUERY_MAX_PAGES=50` × `WIX_QUERY_PAGE_SIZE=1000` = 50k items/collection
with a LOUD `log.warn` on ceiling (never a silent truncation). First-page error
surfaces verbatim; later-page error returns partial (partial beats zero). Rate-
limit/backoff (429/502/503 + Retry-After) preserved. Proof: existing
tests/lib/connectors/wix/query-all-pagination.test.ts (6 cases) — 42 short→1
fetch, 2500→3 pages offsets [0,1000,2000], exact 2000→trailing empty page,
MAX_PAGES ceiling stops at 50k, first-page error surfaces, later-page partial.

Finding 2 (LLM title/meta) — ALREADY BUILT. `openaiProvider` (providers/openai.ts)
generates edit_title/edit_meta via the ONE gateway `openAIChatCompletion`
(promptId "rec.specific_edit_bundle", action "specific-edit-provider"), CTR-minded
+ grounded via strict json_schema + SYSTEM_PROMPT, reasoning_effort low. Monthly
cap respected: budget stays with callers (llm-draft-gateway.ts checkBudget before /
recordSpend after; recommended-edits-persistence runProviderAndPersist same). On
budget-block / network / empty bundle it returns an empty bundle and the
deterministic generators (providers/generators/edit-title.ts, add-h2-section.ts,
add-faq.ts) are the fail-soft fallback. push-service.ts writes the resulting
`proposed_text` and enforces the SERP-length gate (PUSH_TITLE_MAX_CHARS ~60 /
PUSH_META_MAX_CHARS ~155).

DEFERRED (unchanged, correct to defer): Wix Blog draft-post + Media import
(wixCreateDraftPost/wixPublishDraftPost/wixImportMedia) were removed 2026-07-01
(FINAL PREMIUM item 102) as built-but-never-wired dead code; client.ts:419-424
documents the rebuild path (POST /blog/v3/draft-posts, .../publish, POST
/site-media/v1/files/import). That is a larger new-capability effort, not the
high-value core, and RANK-6 explicitly allowed deferring it.

Verified (no code changed, so pins/ratchet/rails byte-identical by construction):
`npm run typecheck` clean. 82 tests green — query-all-pagination (6),
client-backoff, url-map-probe, gateway (29 across those 4 files); openai provider
+ push-service-pins (53 across 2). No live publish, no dev server, no paid call;
all Wix + LLM calls mocked. Push rails confirmed intact (unchanged): Ritz hard-
block, dry-run default, caps, non-destructive full-item PUT preservation, no
URL/slug changes (isProtectedUrlField).

---

## 2026-07-06 — RANK-5: LOCAL SEO engine (service-area page factory + trigger + LocalBusiness/Service schema)

STEP 0 (verify-first): local was more built than expected. CONFIRMED working:
`src/lib/local-presence.ts` (NAP audit + 0-100 listing-health composite + Today/
Market strips), `src/lib/connectors/google-reviews-sync.ts` (GBP OAuth reviews
pull), `src/domains/geo/coverage.ts` (city-level coverage matrix + gap detection,
type only — no live caller computes it yet), `business-config.ts` (locations /
services / urlPatterns config), and the SHIPPED `src/domains/page-factory/
city-service-factory.ts` (generateCityServiceCandidates) + load-page-candidates
loaders. GAP: the city x service factory + coverage matrix were built but NEVER
wired into the recommendation trigger loader (no service-area create_page Move),
and no LocalBusiness/Service JSON-LD was composed (generic WebPage skeleton only).

BUILT (additive, config-driven, empty-safe):
1. `src/domains/local-seo/service-area-gaps.ts` — PURE detectServiceAreaGaps:
   reuses generateCityServiceCandidates, ranks by geo-coverage (absent/weak +
   rival pages first), attaches competitor-page proof (canonical-city match via
   normalizeCity). No cities OR no services -> [] (content-tenant no-op).
2. `src/domains/local-seo/load-service-area-gaps.ts` — loader-side I/O wrapper
   (config locations x services + demand-graph owned URLs for dedup); fail-soft.
3. `src/domains/local-seo/local-schema.ts` — PURE composeLocalSchema: LocalBusiness
   (+ Service on service pages) JSON-LD from configured name/address/phone/
   areaServed; null for a tenant with no local identity.
4. `triggers/service-area-page.ts` — PURE predicate (@no-classifier-required),
   emits create_page anchored on site root, deduped vs existing create_page Moves.
5. customer-copy-templates.ts — serviceAreaPageCopy (+ probe in the vocab test).
6. draft-enrichment composeSchema EXTENDED (not forked): a city/service/homepage
   add_schema card gets LocalBusiness/Service via ctx.localBusiness + pageTypeByUrl;
   promotion-writer threads both from businessConfig (only when a local identity
   exists). No config -> byte-identical generic WebPage skeleton.
7. Loader wired + PREDICATE_COUNT 35 -> 36; all 3 counter pin sites fixed
   (PREDICATE_COUNT, 2 loader-test assertions, triggers-page it()-title + 2
   assertions incl. data-description-predicates-run + "36</span> active").

QUOTED RENDERED COPY (create_page card, /diagnostics/recommendation-triggers):
"You have no page for kitchen remodeling in Oakland, a market where you should
compete. I can already see 8 competitor pages there, so the demand is real. Build
one page for kitchen remodeling in Oakland so you can show up when people search
for it there." (0-rival variant drops the competitor clause honestly.)
LocalBusiness JSON-LD (service page) round-trips to a valid schema.org @graph with
LocalBusiness (@id, name, url, PostalAddress, telephone, areaServed City[]) +
Service (name, provider @id back-ref, areaServed).

NO-OP-WHEN-NO-CONFIG PIN: a tenant with NO locations/services config produces no
gaps (detectServiceAreaGaps -> [], loader skips the push) AND no local schema
(composeLocalSchema -> null -> generic skeleton). Byte-identical to before RANK-5.
Iranopedia (content tenant, no service areas) is a complete no-op.

VERIFIED: `npm run typecheck` clean. Targeted suites GREEN:
- new: service-area-gaps (11), local-schema (10), service-area-page trigger (10)
- loader + counters (load-trigger-candidates ok), triggers-page render (incl. new
  service_area_page card render test), copy-vocab, predicate-purity,
  classifier-applied, diagnostic-source-and-copy (9 files / 237 tests)
- geo, city-service-factory, expected-schema, schema-validator, draft-enrichment,
  promotion-writer(+draft-safety), catalog-sync, design-system-guard (ratchet not
  raised), no-queue-write, promotion-writer source/eligibility/live-write pins,
  forbidden-vocab, copy-sanitize-purity, promotion-preview-no-writes (18 files).
No dev server, no paid call, no live publish.

NEEDS A LIVE LOCAL TENANT (Ritz) TO PROVE END-TO-END: a real GBP connection +
business-config with locations/services (Ritz has neither wired in this env). The
engine self-hides until a tenant has locations x services config; proving the
create_page Moves + LocalBusiness schema on a rendered customer surface needs
Ritz's GBP + service-area config populated. Geo coverage ranking is also
opportunistic — no live producer calls computeGeoCoverage yet, so gaps currently
rank on config relevance until a coverage feed is wired (config-only gaps are
fully valid and empty-safe).

============================================================================
2026-07-07 - TWO FABRICATED-CLICKS TRUST BUGS IN THE NIGHTLY RANKING (fixed)
============================================================================
Both bugs put a WRONG clicks number on a daily-experiment card that ALSO hijacked
the nightly score. Verify-first: opened each cited line and confirmed the bug
before touching it.

BUG 1 - SEASONAL PREP SHOWED IMPRESSIONS LABELED AS CLICKS.
  build-daily-candidates.ts (seasonal block) set
    ctrOpportunityClicks: seed.expectedImpressions
  but seed.expectedImpressions is a raw IMPRESSIONS count for the peak window
  (seasonality.ts windowImpr -> PeakCalendarEntry.expectedImpressions ->
  seasonal-candidates.ts). Every OTHER lever fills ctrOpportunityClicks with a
  real CTR-gap CLICKS number. Downstream, pick-expectations divides that field by
  3 for the monthly forecast AND scoreCandidate / the build-today-preview power
  sort use it as the clicks spine. So a seasonal card read a ~1/CTR-inflated
  "roughly 330 to 1,000 extra clicks a month" off a 4,000-impression window, and
  seasonal picks dominated the batch ~1/CTR over a real title fix.
  FIX: convert impressions -> honest clicks at assignment, at a conservative
  target rank, using the shared CTR curve:
    ctrOpportunityClicks: Math.round(seed.expectedImpressions * expectedCtrAt(SEASONAL_TARGET_POSITION))
  (new exported const SEASONAL_TARGET_POSITION = 8; expectedCtrAt(8)=0.034).
  The raw impressions still ride ONLY the whyNow reach line, where they are
  already labeled "impressions in that window".
  BEFORE (fixture, 4,000-impression window): forecast "roughly 330 to 1,000
  extra clicks a month" (a lie); ctrOpportunityClicks 4,000.
  AFTER: ctrOpportunityClicks 136 (round(4000*0.034)); forecast "roughly 10 to
  35 extra clicks a month"; a real #6 title fix on the same 4,000 impressions now
  outscores the seasonal pick (its clicks spine is larger, as it should be).

BUG 2 - REFRESH FORECAST DIVIDED BY 3 TWICE (3x undercount).
  decay-queue.ts computes clicksLostPerMonth = clicksLostQuarter/3 (already
  MONTHLY); refresh-candidates.ts passes it through; build-daily-candidates.ts
  (refresh block) set ctrOpportunityClicks: seed.clicksLostPerMonth. But
  pick-expectations.ts divides ctrOpportunityClicks by 3 again -> a 3x undercount
  that CONTRADICTS the same card's own "down about N clicks a month" line built
  in decay-queue's buildRefreshSentence.
  FIX: honor the ctrOpportunityClicks contract (a 90-day figure) so the
  downstream /3 restores the true monthly:
    ctrOpportunityClicks: seed.clicksLostPerMonth * 3
  decay-queue's own copy is untouched.
  BEFORE (fixture, 60 clicks/month fade): forecast "roughly 5 to 15 extra clicks
  a month" while the card said "down about 60 clicks a month" (3x contradiction).
  AFTER: forecast "roughly 15 to 45 extra clicks a month", centered on the same
  60/month fade the card claims.

FILES: src/domains/experiments/build-daily-candidates.ts (both fixes + new
SEASONAL_TARGET_POSITION const); tests src/domains/seasonal/seasonal-wire.test.ts
(+3 pins) and src/domains/refresh/refresh-wire.test.ts (+1 pin, existing 60->180
pin corrected to encode the contract not the bug).

VERIFIED: `npm run typecheck` clean for ALL owned files
(experiments/**, refresh/*, seasonal/*); the only tsc errors are pre-existing in
src/components/today/* (another agent's in-flight headline work, outside this
change and modified concurrently). Suites GREEN: seasonal-wire (11), refresh-wire
(6), pick-expectations, build-daily-candidates, build-today-preview,
daily-experiment-planner, plus all of seasonal/ and refresh/ -> 23 files /
314 tests passed. No dev server, no paid call.


============================================================================
2026-07-10 - WAVE 1 PRODUCT-TRUTH RELEASE (P0-A + P0-B + review fix) on
branch wave1-integration (base origin/main d73aa6af), PENDING PUSH
============================================================================

2026-07-10 - P0-A Wave 1 (trust-core): removed the FALSE sitewide monthly-visits
total. ga4_monthly_sessions_v1 summed non-additive GA4 sessions across
ga4_url_traffic (url,date) rows, inflating June 12,862 visits and the
10,000-goal celebration. North star now leads with proven Search Console clicks
(property-grain gsc_daily_totals), honest reconciliation line, goal never graded
from clicks. Summing RPC marked INVALID-FOR-SITEWIDE for Wave 2. monthlyVisitGoal
has no settings-UI editor; Wave 2 owes the true GA4 rollup + editor.
(Commit 7a2adb7b.)

2026-07-10 - P0-B Wave 1: page GETs (/, /changes, /results) never fire paid
DataForSEO/live-SERP or LLM calls and never run unbounded synchronous
full-ledger re-measure; they serve persisted state with honest staleness and
rebuild paid-free in after(). Found and closed: /changes fired paid SERP + two
full re-measures per render; /results had a >2min sequential waterfall. Measured
after: SERP=0 LLM=0 on all three routes for both tenants. Stage timing behind
BEACON_PERF_LOG=1. Wave-2 packet delivered (waterfall parallelization,
Changes-consumes-snapshot, N+1 batching, budgets: warm <=2s cold <=4s).
(Commit bcfb4aa4.)

2026-07-10 - WAVE 1 ADVERSARIAL REVIEW VERDICT: no P0. One P1 and one P2 fixed
in this branch's review-fix commit (dd85908e); the remaining P2s are ledgered in
NEXT_PHASE_EXECUTION_PLAN's "Wave 2 (product-truth addendum)".

P1 (trust-core, same false-total class as P0-A, dormant only because Iranopedia
has 0 GA4 rows): the Today stat row's GA4 card
(src/domains/today-summary/build-source-stat-cards.ts buildGa4Card) summed
v.sessions28d across every per-URL ga4_url_traffic row into one
"Visits (28 days)" stat under a "Website visits" card. GA4 sessions are not
additive across pages, so any GA4-connected tenant would have rendered an
inflated number. CHOICE: card REMOVED (buildGa4Card returns null), not replaced
with an honest-state card. Reasoning: unlike the north star, this card has no
other trustworthy number to carry (its engaged-rate and conversions stats derive
from the same non-additive per-page sum), and the Today stat grid's contract is
"a card shows real numbers or does not show at all"; a permanently apologetic
card would be a bolted-on state the grid never had. The card returns in Wave 2
only on the true property-grain rollup, never on the per-URL sum. Per-page GA4
uses elsewhere are untouched. Pin tests (new
src/domains/today-summary/build-source-stat-cards.test.ts): no card ever renders
a cross-page-summed GA4 sessions total, no card carries the "Website visits"
source or "Visits (28 days)" label, empty-map case stays hidden, and GSC/AEO
cards still render around the gate; the legacy suite
(tests/domains/today-summary/build-source-stat-cards.test.ts) was aligned to the
new contract, with the ordering test now pinning GSC -> Clarity -> AEO plus the
same no-false-total assertions, instead of asserting the old GA4 card back into
existence.

P2 #3 (staleness honesty): /results
(src/app/(shell)/results/results-ledger-data.ts latestMeasuredAt) returned now()
when the persisted ledger was non-empty but NO record had a measuredAt, which
would render "I re-checked these numbers just now" over never-measured rows.
Fixed: latestMeasuredAt returns null in that window, ResultsLedgerSurface's
computedAt is string | null, and ledgerCheckedAgoLine(null) renders no
checked-line at all, so the freshness line never claims a check that did not
happen. Pinned in results-ledger-data.test.ts (cold start with unmeasured rows
serves computedAt null; ledgerCheckedAgoLine(null) is null).

VERIFIED (fullgateW1.log in the session scratchpad): full hermetic gate at
91dde46a (the review-fix commit before two content-identical amends):
typecheck_exit=0, build_exit=0, test_exit=1 with exactly 2 failures, both in the
LEGACY tests/domains/today-summary suite asserting the OLD false-number contract
(GA4 card expected to exist). Tests fixed to the new contract (never the code
reverted), plus a comment-only dash sweep; final hermetic TEST-PHASE rerun at
the amended tip dd85908e: test_exit=0 (1432 files / 22284 tests passed, 62
skipped), local tsc --noEmit exit 0 at the same tip. typecheck_exit=0 and build_exit=0 carry from
91dde46a since the deltas are test files and comments only, which cannot change
the build; noted honestly rather than re-paying a full build.

============================================================================
2026-07-10 - WAVE 2 PRODUCT-TRUTH RELEASE (W2A + W2B + finisher) on branch
wave2-integration (base origin/main 4b10fe27, folding in Wave 1 + E-39), PUSHED
============================================================================

2026-07-10 - W2A Wave 2 (commit 3e0dc5d5): true sitewide GA4 series. Replaces
the retired non-additive per-URL summing RPC with a date-grain source and an
idempotent (tenant, property, date) store, so a re-sync upserts rather than
duplicates. The north-star visits card is reconciliation-gated: it restores
only when the reconciliation is fresh, matches the tenant's currently
configured GA4 property, and is non-vacuous (an all-zero comparison is never
read as a pass). Ships a goal editor on settings so monthlyVisitGoal is no
longer hardcoded. Migration 2026-07-10_ga4_daily_totals.sql applied to prod by
the architect via MCP; tables verified present.

2026-07-10 - W2B Wave 2 (commits a9023bfa, b6deaf55, 6428b5a0, 147382ed):
Results/Changes rearchitecture. /results collapses its seven sequential side
reads into one parallel Promise.all, streams the cumulative strip, proof
summary, and measured-outcomes board through their own Suspense boundaries so
the header paints first, batches the per-card alignment N+1 into a single
read, and moves the render-path saveMoveDraft mutation to after() (read-only
on the GET). /changes is now served from a persisted tenant-scoped SWR
snapshot: single-flight rebuild (concurrent stale readers collapse to one
rebuild), a genuine empty-vs-building distinction on a cold first load
(instead of a false "No changes yet"), a computedAt staleness label, and a
default payload of slim row summaries with the full dossier loaded on demand
(measured fixture: 279,902 to 36,181 bytes, 87 percent smaller). Ledger loaders
and the after() rebuild now thread tenantId explicitly instead of reading
ambient state. Measured dev-labeled only (not a healthy-infra measurement):
/changes warm went from about 25s to about 7.3s once the ~14s fuse moved off
the render path. The budgets stated in the original packet (warm 2s, cold 4s)
are NOT claimed here; there is no healthy-infra measurement available to
confirm them from this environment.

2026-07-10 - Wave 2 finisher (commits 20297eac, 62e83046): closed four truth
gaps the first W2A/W2B pass left open. Reconciliation
(reconcile-ga4-monthly-series.ts): a vacuous all-zero comparison (direct report
empty, or every reconciled month 0-vs-0) is no longer written as a pass, it now
returns an honest error/no_data state; a completed month that GA4 reports
directly (with traffic) but that is missing from the rollup within its covered
range is now flagged as a mismatch too (an interior gap), while a leading
not-yet-synced month still reads as honest coverage, not a gap. Card gate
(ga4-sitewide-rollup.ts): loadReconciledVisitsForTenant now resolves the
tenant's currently configured ga4_property_id and requires the reconciliation
marker's property_id to match, so a different (old) property can never inherit
an old passing reconciliation. On-demand refresh wiring
(refresh-ga4-sitewide.ts, cron-sync.ts, settings connectors actions.ts): the
manual "Update data" click and the on-use auto refresh previously pulled only
the per-page GA4 table, so the true sitewide series and its reconciliation lit
up only after the nightly cron; both paths now run the sitewide sync and
reconcile whenever GA4 is connected (fail-soft, dormant until a key exists),
so the north-star card can go live on an operator refresh without cron
dependence. Changes surface: markChangelogEditShipped now invalidates the
tenant-scoped /changes SWR snapshot on a real ship flip (not only
revalidatePath), matching every other ship path, and ChangesSection is exported
so the empty-vs-building copy distinction is render-pinned. Pinned by new
tests: reconcile-ga4-monthly-series.test.ts (vacuous zero-vs-zero, missing
month in both directions), ga4-sitewide-rollup.test.ts (property-mismatch
guard), sync-sitewide-sessions.test.ts (the GA4 ~48h data-shift re-pull
window), refresh-all-connected.test.ts + on-use-sitewide-refresh.test.ts (both
refresh paths pull the sitewide series), mark-changelog-shipped-invalidates.test.ts
(real ship invalidates the snapshot, a no-op flip does not),
changes-empty-vs-building.test.tsx (distinct rendered copy), and a
rr-pattern.test.ts clock-pin that removed a wall-clock flake from the
aggregation's own determinism check.

Honest gap: a dedicated Wave-2 adversarial review pass was attempted twice and
did not complete either time. The coverage behind this release is the Wave-1
adversarial review of P0-A/P0-B (verdict: no P0, see the 2026-07-10 Wave 1
entries above) plus an operator-authored 16-item proof list, each item verified
by a named test in the finisher commits listed above. This release has not had
its own dedicated adversarial pass; that is ledgered as an open item, not
implied to have happened.

VERIFIED: full hermetic gate GREEN at the branch tip 62e83046 (fullgateW2.log
in the session scratchpad): typecheck exit 0, test exit 0 (22390 passed, 0
failed), build exit 0.

## 2026-07-10 - Wave 3B/3C/drafter last-mile (commits 08d8f4be, ebf5aad5, 24ea752d, merged dfeb33ef)

Today is rebuilt around one command card: 4 kinds (the deterministic
candidates), picked by a fixed priority order, with a 6-slot hierarchy
underneath it for everything else. Kills executed in the same pass: the
smoke card, the lead card, the opportunities card, "no action required" as
its own standalone state, the cockpit duplicate of the command card, and
non-local-timezone dates (every date on Today now renders in the tenant's
local timezone instead of UTC).

Changes is rebuilt around one decision per card: a 6-action enum replaces the
prior open-ended status set, each card carries a 10-field summary, WAIT never
produces a draft, BUILD is gated behind its prerequisites, and items that
passed AI validation are relabeled instead of sitting in an ambiguous state.

The drafter last-mile pilot (G4-G7): superlative claims must be grounded in a
source before they render, an honest needs_source_check state replaces
silently dropping an ungrounded claim, roundup coverage now reads full text
instead of excerpts only, and a tenant allowlist gates which tenants the
pilot runs for.

Net effect on the design ratchet token count: 1298 to 1238.

## 2026-07-10 - Adversarial review, Wave 3 plus the Wave 2 surfaces (per operator instruction)

An adversarial review pass covered Wave 3 and, per operator instruction,
revisited the Wave 2 surfaces alongside it. Findings: 1 P1 (a flagged item
could become the Today command card while it was still archived on Changes,
a state-integrity gap between the two surfaces) plus 8 P2s. All 9 are fixed
in 3586c3dd. The review confirmed threshold behavior, decision integrity on
Changes, drafter trust behavior, and that the Wave 2 reconciliation edge
cases remain honest under the new Wave 3 surfaces.

## 2026-07-10 - Architect browser audit on the rendered app (real Iranopedia data, desktop and mobile, screenshots)

A rendered-app audit against real tenant-iranopedia data, both desktop and
mobile, with screenshots at each step. The intended transformation was
verified live: one command card built from real data, one canonical count
and date shown everywhere on the page (no more disagreeing numbers), honest
freshness copy including the AI-through-Jun-26 caveat, and a visibly more
compact page.

5 P1s were found and fixed: the top 3-5 default was actually rendering 26
cards; 5 separate "START HERE" labels appeared at once; a degenerate
outranks line; a self-test copy contradiction; and a celebratory greeting
shown on a day with real problems outstanding. Post-fix re-audit verified
live: 5 cards, exactly 1 "Start here", an honest self-test line, a neutral
greeting, and the accent-button CTA in place.

## 2026-07-10 - Honest self-test correction (important truth item)

The self-test false-positive rate is genuinely 0.925 (sample size 40) for
tenant-iranopedia. This is not a measurement artifact or a bug: the surface
copy now states the rate honestly instead of hiding or rounding it away, and
frames early signals as directional rather than conclusive given that rate.
Tightening the verdict floors so this rate comes down is queued as proof-model
work, not fixed in this wave.

VERIFIED: full hermetic gate GREEN at the branch tip 3586c3dd (fullgateW3.log):
typecheck exit 0, test exit 0 (22672 passed, 0 failed), build exit 0.


## 2026-07-11 - Drafter batch 2: generation-time firewall prose scope, Wave 4 closes (a5e2705a)

2026-07-11 drafter batch 2 (a5e2705a): generation-time invented-numbers firewall scans prose
only via the ONE shared prose-scope helper (draftProseStringValues now excludes
proofPlan/operatorSteps/risks alongside sources; evidenceRefs.detail stays scanned so
fabricated evidence numbers still fail; no laundering through excluded fields). The loop-6
killer (proofPlan target 100 percent) drafts on attempt 1, proven live (one real run on
/famous-iranian-singers drafted attempt 1, no retry) and by deterministic pin. Gate GREEN at
the rebased tip a5e2705a (fullgateDB2.log): typecheck exit 0, test exit 0 (1472 test files
passed, 22794 passed / 62 skipped of 22856), build exit 0.

WAVE 4 CLOSES: the workflow-parity loop ran six product iterations; final scorecard G1 ranking
WORKING LIVE, G2 trap detection WORKING (hygiene batch), G4 superlatives WORKING, G5
blocked-source honesty WORKING LIVE, G6 roundup coverage WORKING LIVE, G7 allowlist WORKING
LIVE (prod-applied); PARTIAL with named follow-ups: G3 teardown render, G8 impact-math
abstention on thin history, G9 discarded-alternatives argument. The drafter now takes a real
opportunity from its own ranked queue to a drafted, gate-checked answer on attempt 1.

## 2026-07-11 G3 winners panel (ecaa2836)

The deduped Google+AI winner analysis the product always computed now renders in the /changes
detail view. Pure projection over persisted evidence (fuseTeardownTargets ranking + teardown
signals + collected dates), cap 5, overlap badge (Google AND AI pick this one), plain words,
honest absence state wired to the existing compare action, never on the slim board payload. 16
pins. Gate 22809 passed 0 failed.

G3 moves from PARTIAL to WORKING. Next in the workflow parity queue: G8 (impact math abstention
on thin history), then G9 (discarded alternatives argument).

## 2026-07-11 - G8 sibling-based impact ranges (a949ba50)

2026-07-11 G8 sibling-based impact ranges (a949ba50): when the primary forecast abstains on a
clicks-tone move with material impressions, the product now sizes a transparent range from the
tenant's OWN sibling pages (position band +/-3, at least 500 impressions, at least 1 percent CTR,
at least 3 qualifying siblings, p25-to-median band, floored at 0, abstains under 3 clicks a
month). The singers fixture reproduces the pilot's hand math: 85 to 200 extra clicks a month,
with the full basis rendered (they earn 2.5 to 5 percent of views as clicks; this page earns 0.8
percent on 4,765 views a month at position 6). Honest abstention and already-ahead states
preserved; ranking math byte-identical; structural two-tenant isolation. 23 pins. Gate 22832
passed 0 failed.

G8 moves from PARTIAL to WORKING. G9 (discarded alternatives argument) is next and is the last
Wave 4 partial remaining.

## 2026-07-11 - G9 what else I considered panel (74ba6832)

2026-07-11 G9 what else I considered panel (74ba6832): the router debate's rejected
alternatives (veto-severity objections only, downgrades never claim rejection) and dissenting
teammate voices now render in plain words in the /changes detail view, from the already-persisted
routerDecision (appliedObjections + dissenting). Honest absence renders nothing. Cap 3
alternatives + 1 dissent, detail-hydration only, 14 pins. Gate 22849 passed 0 failed.

ALL Wave 4 partials (G3, G8, G9) are now shipped product.

## 2026-07-11 - Blind-defect correction release candidate

Integrated the three held blind-benchmark fixes onto the verified production source baseline and
reviewed them as one release candidate. Uncertified pooled Results rows now self-hide behind a
separate pooled calibration registry. The Changes zero-click guard blocks click-capture claims and
unsupported impression-driven edits, while preserving citation work only when a named AI-citation
gap independently supports it. New-page candidates demote to the owned page when GSC serving or
owned content proves coverage; secondary covered topics are removed with an acknowledgment that
names the page and counts any additional topics. Internal detector vocabulary was removed from
operator-facing rationale.

Verification: focused regression gate 149/149; allocator copy correction 43/43; strict typecheck
exit 0; full suite 1,489 files passed, 23,083 tests passed, 62 skipped, 0 failed; production build
exit 0. This records a green release candidate, not deployment. The exact pushed SHA and hosted
`/api/version` receipt belong in the deploy report after the push/deploy ladder completes.

Deployment receipt: `origin/main` fast-forwarded to `eacd00494cb093f9da830a8d7837fdb449744d54`;
Vercel production deployment `dpl_5MAQ55cD1Tm6micR4aAECdP9hP9K` reached Ready and
`https://beacon-bice.vercel.app/api/version` returned that exact SHA. Unauthenticated Results,
Changes, and Today smokes returned the expected 307 login gate. Authenticated content remains the
next operator-session gate.

## 2026-07-11 - Evaluation-claim boundary release candidate

Corrected a systemic evidence-label defect: `src/domains/eval/benchmark.ts` described its visible,
trained-on gold fixtures as a blind benchmark. Its report now carries the machine-readable
`known_case_regression` class and operator copy says plainly that it catches regressions but is not
a blind test. Added a separate fail-closed blind-holdout contract requiring a valid candidate SHA,
five unique cases covering edit/new-page/zero-click/decline/do-nothing, preregistration before a
frozen prediction, expert-label reveal only afterward, every judgment passing, and zero code
changes in response. A tuned case is counted as spent and forces a replacement. Diagnostics shows
that no fresh blind result is registered rather than borrowing credibility from known fixtures.

Verification: focused adversarial suite 11/11; strict typecheck exit 0; full suite 1,490 files
passed, 23,087 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment is not
claimed in this entry until the push, Vercel Ready state, and exact `/api/version` match complete.

Deployment receipt (2026-07-12): `origin/main` fast-forwarded to
`02f8ca317178f3a97c75dbc10f31521cb01b80f3`; Vercel deployment
`dpl_21ktccabjCRMwXPDMCRsmAxVpqjM` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Truthful sync-connectors HTTP health release candidate

Confirmed a silent-success defect: `syncAllConnectedForActiveTenants` computed degraded versus
broken health and wrote it to `cron_runs`, but omitted that health from its returned result; the
route therefore returned `200 {ok:true}` for every non-throwing completion, including broken
connectors and empty fleet/source inventory. The result now carries the same health roll-up the
ledger uses. The route returns healthy 200, known-degraded 207, broken 500, zero active tenants or
zero connected sources 503, and 503 when the invocation receipt fell back to ephemeral file
storage. The sync work and per-source receipt still complete; only monitoring truth changes.

Verification: route contract 9/9; strict typecheck exit 0; full suite 1,490 files passed, 23,092
tests passed, 62 skipped, 0 failed; production build exit 0. Production receipt history remains
unverified from this environment: Supabase DNS resolution failed and Vercel returned no historical
request logs. Deployment remains pending in this entry.

Deployment receipt: `origin/main` fast-forwarded to
`7967d7295578f3071e89df3094612c5f756da1b7`; Vercel deployment
`dpl_6QoQcWo2WjXpCPdEdiPfeEed3JQZ` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Results initial-paint streaming release candidate

Removed the remaining source-level initial waterfall on `/results`. The root page now awaits only
the persisted ledger, the one dependency required to paint the shell. Connection health, action
pack worklist, latest finalized GSC date, calibration records, and operator mode start in parallel
as one shared promise and are awaited only inside streamed status, recompute, measured-board, and
learning consumers. Existing 15-second deadlines and fail-soft fallbacks remain; the measured-board
skeleton and Search Console status copy stay honest; no read is duplicated. Auto-measure remains
operator-only and runs after the shared context resolves.

Verification: focused Results streaming/side-read/ledger suites 18/18; strict typecheck exit 0;
full suite 1,491 files passed, 23,095 tests passed, 62 skipped, 0 failed; production build exit 0.
Hosted latency is not claimed until authenticated production measurement. Deployment remains
pending in this entry.

Deployment receipt: `origin/main` fast-forwarded to
`86ecd1f163873ce303bd3f28ed0954bfd949cb71`; Vercel deployment
`dpl_2w8qbu3vTav2sK7sjtoUd3Jbre3j` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - GA4 property-calendar reconciliation release candidate

Confirmed and fixed the remaining month-boundary correctness defect behind Today visit totals.
GA4 buckets `date` and `yearMonth` in the property's reporting timezone, but reconciliation chose
its report range and current month in UTC, and the daily rollup also marked `partial` in UTC. Added
one shared property-calendar utility. The rollup now requires exactly one valid stored property
timezone and uses it for partial-month classification. Reconciliation uses that same timezone for
its 420-day direct-report window/current month and requires the live GA4 response timezone to match.
Missing, invalid, conflicting, or changed timezones write an error marker and withhold visits.

Verification: focused property-calendar, rollup, reconciliation, and monthly-pulse suites 47/47;
strict typecheck exit 0; full suite 1,492 files passed, 23,103 tests passed, 62 skipped, 0 failed;
production build exit 0. Boundary fixtures cover both UTC-ahead and property-ahead cases. Hosted
Today/GA4 read-back is not claimed. Deployment remains pending in this entry.

Deployment receipt: `origin/main` fast-forwarded to
`d2ed71932f711bb0087a86e4d6d707ccb98e27fc`; Vercel deployment
`dpl_66rmRW8ZkJuuTUgJpC5xEs7ieGjo` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Today post-snapshot parallel context release candidate

Confirmed that Today still serialized roughly eleven independent reads after its cached composite:
connected-source count, pipeline health, proof ledger, lifecycle counts, Monday calibration and
strategy memo, 84-day GSC totals, decay signals, deadman, error spikes, and last-seen state. Moved
them into one `Promise.all` after tenant/composite resolution. Every loader is called exactly once,
retains its prior deadline and fail-soft fallback, and feeds the same command/ranking/copy logic.
Worst-case wait is now the slowest bounded context read rather than their additive sequence.

Verification: focused Today parallel-context/SWR/data-window suites 23/23; strict typecheck exit 0;
full suite 1,493 files passed, 23,106 tests passed, 62 skipped, 0 failed; production build exit 0.
Hosted latency is not claimed until authenticated measurement. Deployment remains pending.

Deployment receipt: `origin/main` fast-forwarded to
`1a02d8a40d8728bce38c198f93df112f19e2969f`; Vercel deployment
`dpl_Hhp4yQ3K8KUEEMume8yb4URf34v1` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Legacy Profound import tenant boundary release candidate

Confirmed a reachable cross-tenant defect in Settings' advanced CSV import. The server action
hardcoded `ritz-builders`, the orchestrator recovered a potentially different tenant from the
process environment, and entity/benchmark identity came from process-global site config plus a
founder-specific competitor catalog and owned-entity fallback. The action now resolves the request
tenant exactly once and passes it explicitly. The importer derives account, owned brand, domain,
aliases, benchmark labels, and configured competitor domains from that tenant's business config;
it has no Ritz fallback. Because its legacy citation and answer-text cold stores are synchronous
local files rather than tenant-routed stores, the importer fails closed on Vercel and unless the
request tenant exactly matches the configured local process tenant. It therefore cannot mutate a
different tenant while this legacy path remains available.

Verification: focused import action/entity/runtime/default-surface suites 317/317; strict typecheck
exit 0; full suite 1,495 files passed, 23,110 tests passed, 62 skipped, 0 failed; production build
exit 0. The first full-suite attempt correctly failed only because the new architecture test was
not yet registered in the required catalog; the catalog entry was added and the entire gate was
rerun from zero. Deployment remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`ac2f8d604f13fe34bc142a81756123ec53f3dea4`; Vercel deployment
`dpl_6JyFwK8ui1v7ek1LBUWGDVb9NKbT` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Today compulsory-gate parallelization release candidate

Today's warm snapshot was still unreachable until the demo/first-reading gate completed, and that
gate serialized import/activity detection, connector detection, and tenant resolution before its
already-parallel narrow observation/prompt reads. The three independent first-wave reads now start
in one `Promise.all`; demo and first-reading decisions, fail-soft handling, data sources, and outer
eight-second deadline remain unchanged. This removes additive latency without adding a refresh,
write, paid call, or inferred state on GET.

Verification: focused Today gate/window/streaming suites 29/29; strict typecheck exit 0; full suite
1,495 files passed, 23,111 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment
remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`a0722e1ff5453f8c5a53e2c060432ae41bed3aab`; Vercel deployment
`dpl_HDRyUfviHxPJWLmLdKjmLoNxGcuV` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Tenant-neutral inventory matcher release candidate

Confirmed that the live recommendation queue's inventory matcher applied one construction-builder
synonym table to every tenant before deciding whether to create a page or strengthen/expand an
existing page. The default tokenizer now performs only universal plural normalization. Vertical
equivalences such as construction→builder, renovation→remodel, architectural→architect, and
your→my are absent unless a caller explicitly supplies a curated map. The active queue supplies
none, so a content tenant cannot have an editorial construction topic redirected to a builder page.
Builder fixtures retain their historical expectations only by passing fixture-local synonyms.

Verification: page-inventory decision suites 44/44; strict typecheck exit 0; full suite 1,495 files
passed, 23,112 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment remains
pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`19409888330495a357bdf26cb26043b14d870928`; Vercel deployment
`dpl_Fig9Z3qVeo6cN4Bu5kCjmd3opQD3` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Explicit owned-URL identity release candidate

Confirmed that owned-URL canonicalization read a process-global site config and always mapped
`rfritz.com` to whichever site domain had populated that cache. The pure canonicalizer now requires
an explicit tenant domain and an optional explicit legacy-domain list. No alias means no rewrite;
the hardcoded founder alias and Palo Alto path rewrite are removed. Profound citation-index builds
pass their tenant business domain explicitly; native citations retain their already-current URL;
attribution passes its existing site-domain argument rather than re-reading inside canonicalization.
An A→B→A same-process test proves the founder alias cannot become Iranopedia ownership and that the
second A call is byte-identical to the first.

Verification: focused ownership/citation isolation suites 17/17; strict typecheck exit 0; full suite
1,496 files passed, 23,114 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment
remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`000d1c99ff9997cac2f7b3877c1838942a347691`; Vercel deployment
`dpl_fJDXrTGzf21PGFXCsguwAZcAz7cy` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Evidence-tier explicit site identity release candidate

Evidence-tier classification used process-global `getSiteConfig()` only to resolve a relative
changelog URL. It now accepts an explicit tenant domain. Absolute URLs remain self-contained;
relative URLs without domain context fail closed as non-structural and lower confidence rather than
borrowing another tenant's identity. `classifyAllEntries` threads the same explicit argument. An
A→B→A same-process regression proves explicit domains remain stable and no-context behavior is
conservative.

Verification: focused explicit-site identity suites 3/3; strict typecheck exit 0; full suite 1,497
files passed, 23,115 tests passed, 62 skipped, 0 failed; production build exit 0. The first full
run had one unrelated diagnostics operator-mode test time out at 30 seconds under suite contention;
that file passed 52/52 in 1.69 seconds alone, then the complete gate was restarted from zero and
passed. Deployment remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`51f4eb6385c5855525ec2629e33e5c667de323d6`; Vercel deployment
`dpl_Z8NV37tNvpim8dRt8YE8qiqvuXoD` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Attribution explicit site identity release candidate

Attribution URL matching and candidate citation support still read the process-global site config.
They now accept one optional explicit tenant domain threaded through `computeAttribution`, aggregate
attribution/verdict helpers, and `discoverCandidates`. Relative URLs without that context fail
closed (`unknown` or no citation bonus); absolute URLs remain self-contained. Candidate evidence
tiering receives the same domain so tier, URL match, and citation support cannot disagree. A same-
process A→B→A regression proves a relative A change matches A strongly, not B, and repeats
byte-identically. An architecture invariant forbids `getSiteConfig` across attribution, evidence
tier, owned canonicalization, and citation-index modules.

Verification: focused attribution/evidence identity suites 2/2; strict typecheck exit 0; full suite
1,499 files passed, 23,117 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment
remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`c06e4b568e5e0444e449f1f7a49bf1943952a43c`; Vercel deployment
`dpl_89KSA3c7UmmZUdBnFVp8zn9oGLpz` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Explicit attribution registry selection release candidate

The candidate scorer kept tenant-keyed page registries but selected among them through one mutable
module-global `_lastWarmedTenant` pointer. Overlapping A/B requests could therefore score A with B's
page registry or citation-topic index. `warmPageRegistry` now accepts/returns an explicit tenant ID,
loads pages and citation evidence through that tenant's repository, and synchronous candidate
discovery selects both maps using `options.tenantId`. Missing tenant context returns empty maps.
Diagnostics, Review, and History thread tenant ID (and domain) through warming and discovery. The
architecture pointer allowlist is empty, so reintroducing this pattern fails CI.

Verification: focused registry/identity architecture suites 5/5; strict typecheck exit 0; full suite
1,499 files passed, 23,117 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment
remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`f31ecd141cc8c32e0624c810d7895559abdd7634`; Vercel deployment
`dpl_GyuYSHRba1uWXJf8RG6QLCQabiyB` reached Ready and production `/api/version` returned the exact
SHA.

## 2026-07-12 - Tenant-aware Proposed Brief archetypes release candidate

The live Proposed Briefs builder treated any opportunity with a `city` value as local coverage
expansion, producing LocalBusiness schema, NAP, areaServed, project/testimonial proof, and doorway-
page checks for editorial topics such as Tehran. The active page now resolves the current tenant's
business type and threads it through compute/build. Coverage expansion requires explicit
`local_service`; content publisher, SaaS, other, and unknown types receive `new_page`. The neutral
new-page template describes page-appropriate schema and names LocalBusiness only when applicable.

Verification: tenant-aware brief-archetype suite 4/4; strict typecheck exit 0; full suite 1,500 files
passed, 23,121 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment remains
pending and is not claimed.

Deployment status: `origin/main` fast-forwarded to
`14ab4258baac443f30bb6547d2801041fd5866ff`; Vercel deployment
`dpl_Er1u1y9j6TQEw7ZrZUHoS7LwboVn` reached Ready. Exact production `/api/version` verification was
not available from the environment, so deployed-SHA identity remains unclaimed.

## 2026-07-12 - Tenant-explicit recommendation target URLs release candidate

The active product recommendation engine converted relative changelog targets with
process-global `absoluteUrlForPath`, so a shared process could emit another tenant's domain on
strengthen/investigate cards and citation-count lookups. The engine now accepts `siteOrigin`, the
active Changes detail page derives it from that tenant's business config, and a pure resolver
returns null for relative URLs when identity is absent. Absolute external URLs remain unchanged.
An A→B→A regression proves stable isolation.

Verification: focused recommendation URL/engine suites 18/18; strict typecheck exit 0; full suite
1,501 files passed, 23,123 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment
remains pending and is not claimed.

Deployment receipt: `origin/main` fast-forwarded to
`83fa59b5e344954f0be478f2b7a344afe7b28232`; Vercel deployment
`dpl_DhUmhaZqqD6RDfcMJUnVVyXDpJ8T` reached Ready and production `/api/version` returned the exact
SHA. This also verifies the Proposed Brief commit in the deployed tip's ancestry.

## 2026-07-12 - Tenant-explicit website scan release candidate

The active scan orchestrator previously logged and regenerated findings with process-global site
configuration, while its CLI child inherited `BEACON_SITE_DOMAIN` unless that value happened to be
empty. In a shared process, tenant B could therefore crawl tenant A and persist the resulting
snapshots/findings under B. The orchestrator now resolves the current tenant's hydrated business
config once, validates its domain, always overwrites the child domain, and threads the same explicit
tenant/domain pair through robots, homepage identity, and finding generation. Invalid or missing
identity fails before scan state or evidence is written. A→B→A and source-wiring regressions pin the
boundary.

The full gate also exposed two pre-existing clean-worktree harness defects: data-dependent dogfood
suites claimed to skip when recommendation fixtures were absent but instead registered no tests or
required a non-empty local queue. They now skip only the fixture-dependent assertion when the fixture
is genuinely absent; all substantive assertions remain unchanged whenever dogfood data exists.

Verification: focused scan/harness suites 36/36 across six files; strict typecheck exit 0; full suite
1,502 files passed, 23,126 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment
receipt: `origin/main` fast-forwarded to `199acb0ed3e5fc87e5b2b683c6e164105f3a6214`;
Vercel deployment `dpl_5jxepUZ4v4uCPpwSV3VAJdiZrKKJ` completed and production `/api/version`
returned the exact SHA.

## 2026-07-12 - Tenant-explicit post-import milestones release candidate

Post-import milestone sync mixed two identity sources: competitor type used the current tenant's
business config, but owned citation attribution and milestone generation used process-global site
config. It now resolves one current-tenant business config and uses its normalized domain for both
competitor rank and milestone sync. Business config, citation evidence, and imported results load in
parallel rather than a three-step waterfall. Missing tenant domain fails closed before writing a
misattributed milestone.

Verification: focused tenant milestone/scan suites 5/5; strict typecheck exit 0; full suite 1,503
files passed, 23,128 tests passed, 62 skipped, 0 failed; production build exit 0. Deployment receipt:
`origin/main` fast-forwarded to `96a475b07eaa264953f7fe530482ada1671972b8`; Vercel deployment
`dpl_86HMDuEocVmHqUugtqaFxfobsQni` completed and production `/api/version` returned the exact SHA.

## 2026-07-13 - Main/worktree reconciliation

Reconciled git reality across the visible root checkout, `origin/main`, the Codex integration
worktree, and the recent Opus/Fable worktrees. Every July 10-12 Opus code commit that appeared ahead
of `origin/main` has a patch-equivalent integrated commit on main. The only recent branch-only commit
was a stale documentation wrapper (`93c4f859`), not missing product behavior. It was not replayed over
the newer verified-state ledger.

The visible root `main` was 1,188 commits behind. Its four local June 16 audit-pointer edits were
preserved reversibly as `stash@{0}` and the checkout was fast-forwarded to `96a475b0` without deleting
untracked files. The 596-line June audit remains untouched and untracked because its active-priority
claims are now stale; importing it as the current plan would regress truth. The old 27-file W5
worktree diff also remains quarantined: it is the explicitly stopped pre-redesign partial containing
the unsafe fetch/verification approach later replaced by the reviewed W5 implementation already on
main (`a01a5fc3`, `81d2c500`, `1de8ea67`). No quarantined code was merged.

Verification: `main` and `origin/main` both resolved to
`96a475b07eaa264953f7fe530482ada1671972b8` before this docs-only commit; production `/api/version`
returned the same code SHA and deployment ID `dpl_86HMDuEocVmHqUugtqaFxfobsQni`. No behavior changed,
so the existing full gate receipt (1,503 files, 23,128 passed, 62 skipped, build green) remains the
applicable code gate.

## 2026-07-11 - E-39 D4 wiring complete (32696319, review P2)

2026-07-11 E-39 D4 wiring complete (32696319, review P2): honest engineering call, option B.
The dead resolveVerdictLag fields (markState/retryEligible) implied wiring that would duplicate
what the maturity derivation already provides; deleted with the WHY documented. The ONE real
gap fixed: a measurement past the full retry bound (28d + grace + retry window, constants
shared with the recompute job so bounds never drift) now reads a distinct honest terminal state
(Measurement stopped. I could not finish measuring this one; the data never arrived. It no
longer blocks anything.) instead of still-arriving forever; never in-flight, never mature,
never fabricates, never re-freezes, excluded from learning. Floors/56-84d untouched (sign-off
pending). Gate 22843 passed 0 failed at pre-rebase tip + rebased-tip gate GREEN at 32696319
(fullgateE39P2.log: typecheck 0 / test 0 / build 0; 1475 files, 22860 passed, 62 skipped,
0 failed).

## 2026-07-14 - ResearchDossier convergence release candidate

Added one tenant-explicit research convergence layer for graph-derived Moves. It joins the existing
keyword library (GSC plus cached DataForSEO volume/difficulty), cached live-SERP winner patterns,
AI prompt/citation/fanout evidence, competitor clone briefs, and ranked question coverage without
performing network I/O or ranking again. The canonical EvidencePacket now carries the dossier and
includes its material hash; timestamp-only cache refreshes do not invalidate drafts. Preparation
uses dossier hints, unanswered questions, and source candidates, and PreparedMovePack persists a
compact research provenance/count receipt. No producer, button, cron, publish path, or new paid call
was added.

Verification: focused dossier/preparation suites 42/42; strict typecheck exit 0; full suite 1,490
files passed, 22,859 tests passed, 23 skipped, 0 failed; production build exit 0 (three pre-existing
Turbopack NFT trace warnings plus the existing middleware deprecation warning). Local auth-bypass
server smoke returned HTTP 200 for `/`, `/changes`, `/results`, `/ask`, `/prompts`, and
`/settings/connectors`. The in-app browser runtime could not initialize, and local Supabase network
access failed, so no authenticated visual/data-backed claim is made. Deployment receipt:
`4f7fa7340335ffa40ed31733aa813cae7eb2537e` pushed to `origin/main`; Vercel deployment
`dpl_4QMQYSjHpbNWzb92hbKeQtzcFLpr` reached Ready; production `/api/version` returned the exact SHA;
`/login` returned 200; `/changes` returned the expected 307 to `/login?next=%2Fchanges`.

Follow-up warm-path correction: `defaultRefreshWorklist` now refreshes the canonical worklist and
then explicitly rebuilds the separate fused Changes snapshot. Previously the autonomous cycle could
finish with new research while `/changes` continued serving its prior snapshot until that cache's
own stale-refresh window. Today still refreshes last. Verification: focused autonomy/warm-surface
suites 28/28; strict typecheck exit 0; complete suite 1,490 files / 22,859 passed / 23 skipped / 0
failed; production build exit 0 with the same pre-existing warnings. Deployment receipt:
`acca40f3e4041f36dc717fae4162ca8eac032489` pushed to `origin/main`; Vercel deployment
`dpl_HaJPBbXRVuJ9bbhfRE5wx2Prs347` reached Ready; production `/api/version` returned the exact SHA;
public login returned 200 and protected Changes returned the expected 307 to login.

## 2026-07-14 - Autonomous recovery and deep keyword research release

Normal signed-in navigation now uses the existing post-response cycle to detect and repair an
abandoned weekly page-factory run. If the tenant/week batch already exists, Beacon reconciles the
receipt; otherwise it reruns the same idempotent production line. Failure remains visible and
retryable. Today separately represents data-pipeline trust and background-work health, so a failed
page batch cannot discredit accurate Search Console totals.

DataForSEO research now reads up to 500 ranked keywords for each of five selected exact winning
pages and independently reads up to 1,000 related keywords for each of five final topic seeds. The
30-day cache, dry-run, cost ledger, breaker, and monthly cap remain authoritative. Cached related
rows are promoted into the unified keyword library. Winner teardown now produces a compact observed
content blueprint; candidate factual sources flow into drafting and must pass the existing fetch,
authority, and entailment gate. Topic clustering, AEO fanout relevance, and exact-source redirect
safety were hardened with regressions.

Verification: strict typecheck exit 0; complete suite 1,497 files / 22,909 passed / 23 conditional
skips / 0 failed in 82.28 seconds; production build exit 0 with the existing middleware deprecation
and two Turbopack NFT trace warnings; `git diff --check` exit 0. Product commit
`4779a1bb7bd429df368f468ca9b1253d765c0331` was pushed to `origin/main`; Vercel deployment
`dpl_4Fijnb9Xc2V16QWDZkDNRE1Pvi9f` reached Ready. Production `/api/version` returned that exact SHA,
`/login` returned 200, and unauthenticated `/changes` returned the expected 307 to
`/login?next=%2Fchanges`. Authenticated Iranopedia data-backed inspection remains the operator's
next proof and is not claimed here.

## 2026-07-14 - Authenticated autonomous-flow correction

Authenticated Iranopedia verification exposed operational defects hidden by the prior green local
gate. Production logs proved a 404 request to `/today`, a timed-out `gsc_page_signals_v1` statement,
and a tenant business-config placeholder warning during the same interaction. Product output proved
the abandoned page-factory alarm had not cleared, Changes warmed through a delay and then changed
order/numbers, and New Pages retained factual openings that failed the authoritative-source gate.

The correction adds `/today` as a redirect to canonical Today, bounds an autonomous continuation to
210 seconds with a terminal retryable receipt, reduces failed-attempt cooldown to one minute so
subsequent navigation continues through existing caches, and moves page-factory recovery after the
primary brain. Recovery is narrowed to one grounded brief with no full-page walker. A page-factory
receipt is no longer a red Today alarm. The expensive per-page GSC aggregate is request-memoized.
Both prepared-move and New Pages preparation hydrate the explicit tenant config before source
classification. The autonomous pass now runs the existing capped New Pages prepare path for up to
five candidates, and that path supplies exact SERP result URLs as source candidates while retaining
the existing fetch, authority, and entailment fail-closed gate.

Verification: focused correction suites 10 files / 86 tests passed; strict typecheck exit 0;
complete suite 1,498 files / 22,934 passed / 23 conditional skips / 0 failed in 93.58 seconds;
production build exit 0 with the existing middleware deprecation and two Turbopack NFT trace
warnings; `git diff --check` exit 0. Product commit
`198299e3b9ad24000dfec72eee795ecb7845a550` was pushed to `origin/main`; Vercel deployment
`dpl_8JZ3ipLJZVP9K4PC4zFvB7bJBoog` reached Ready; production `/api/version` returned that exact
SHA. Unauthenticated `/today` and `/changes` correctly reached their login continuations. The
signed-in `/today` compatibility redirect and regenerated source-ready Iranopedia brief remain the
next operator proof and are not claimed here.

## 2026-07-15 - Instant autonomous surfaces

The previous handoff incorrectly asked the operator to wait up to four minutes and refresh to prove
background completion. That is an engineering verification ritual, not an acceptable product
contract. The actual root was broader: mutations deleted the durable Today/Changes presentation
snapshots, turning a warm product cold, and the visit runner did not publish its fused surfaces until
after every slow research producer and preparation step.

Today and Changes invalidation now preserves the last-known-good payload and only ages its timestamp;
the existing SWR reader serves it immediately and replaces it after a complete background rebuild.
The autonomous runner publishes the best usable worklist, fused Changes view, and Today composite
from cached evidence as its first isolated step, then performs deeper graph, competitor, DataForSEO,
AI, source, and drafting enrichment. Running and timed-out receipts keep the prior completed summary,
and the header says the saved result is usable while refresh continues. The Changes snapshot ceiling
is reduced from 25 seconds to 5 seconds.

Verification: focused snapshot/autonomy suites 8 files / 41 tests passed before the final receipt
coverage; strict typecheck exit 0; complete suite 1,498 files / 22,939 passed / 23 conditional skips /
0 failed in 65.95 seconds; production build exit 0 with the existing middleware deprecation and two
Turbopack NFT trace warnings; `git diff --check` exit 0. Product commit
`d685cd1505bc79495bf58cfb6bfb52bd29e90721` was pushed to `origin/main`; Vercel deployment
`dpl_55VKFwGfyomtHgp8fzotYF2M4ged` reached Ready; production `/api/version` returned that exact SHA.
Unauthenticated `/today` and `/changes` reached their expected login continuations. Authenticated
rendering is intentionally not claimed from this environment.

## 2026-07-15 - Autonomous-ready customer release

Beacon now automatically prepares the strongest five ranked Changes into exact copy-ready edits
through the existing evidence, source, winnability, quality, cache, ledger, and spend guards. This
does not require Wix; Wix is used only if the operator later chooses Beacon-managed publishing.

The visit-driven research pass is now an eight-stage durable pipeline: baseline, graph,
competitors, keywords, AI, knowledge, opportunities, and finalize. Each successful stage is
checkpointed. A failure stops dependent work and preserves the first unfinished stage; a later
navigation resumes there without redoing completed stages. Timeouts preserve the latest checkpoint
and the last useful summary, so saved customer results remain ready while deeper evidence refreshes.

Today, Changes, and New Pages now read one tenant-scoped `CustomerSurface` release. Builders assemble
the full next release before writing it last; a partial rebuild cannot make the pages disagree, and
soft invalidation retains the prior complete release during refresh. The legacy snapshots remain
warm for non-customer callers.

Verification: focused autonomy/customer-surface suites 6 files / 23 tests passed; `npm run
typecheck` exit 0; complete `npm run test` 1,500 files / 22,948 passed / 23 conditional skips / 0
failed in 67.18 seconds; `npm run build` exit 0 with the existing middleware deprecation and three
Turbopack NFT trace warnings; `git diff --check` exit 0. Product commit
`17255d5b11834ff9f9fc0ba78bae0c9f9f9af89a` was pushed to `origin/main`; Vercel deployment
`dpl_4feLx2WfyhYiX5fQgEhWUAXF6FkQ` reached Ready. Production `/api/version` returned that exact SHA,
`/login` returned 200, and unauthenticated `/today` and `/changes` returned their expected 307 login
continuations. No paid provider run or hosted environment mutation was performed during verification.

## 2026-07-15 - Continuous execution loop and three-stage customer journey

Implemented the operator-selected items 2 and 3; item 1 was intentionally skipped. A new
tenant-scoped queue-maintenance service restores a floor of five ready changes from the exact final
Changes order. It refreshes the atomic customer release before deciding what is missing, scans the
full ranked queue past cached or quality-held entries, prepares only missing capacity with live SERP
checks disabled and a hard $0.05 cap, preserves rejected cached drafts instead of repeatedly paying
to regenerate them, and publishes the completed Today + Changes release last. The lane runs after
done, skip, and not-now actions and on ordinary same-day navigation when the daily deep-research pass
does not need to run. Deep research retains its existing once-daily resumable cadence.

The customer interface now centers Today → Changes → Results. Sidebar navigation contains Today,
Changes, Results, Connections, and Settings. Ask, keyword research, AI questions, and activity
receipts remain available through command search. Changes exposes To do and Ready only, removes the
manual preparation controls and secondary research/page-factory boards, leads each expanded card
with exact copy-ready text, and collapses evidence machinery. Measurement remains on Results, where
the manual record form is now a collapsed fallback.

Verification was deliberately repeated. Focused behavior pass: 10 files / 110 tests passed.
Independent tenant/customer-surface pass: 17 files / 251 tests passed. Strict `npm run typecheck`
passed. Complete `npm run test` passed twice; the final pass reported 1,502 files / 22,959 passed /
23 conditional skips / 0 failed in 74.79 seconds. `npm run build` exited 0 with the existing
middleware deprecation and two Turbopack NFT trace warnings. `git diff --check` passed. Product
commit `ef41bac649037928b5c199020eea2b9c01f03e2b` was pushed to `origin/main`; Vercel deployment
`dpl_aTkX6JkZjE8HzmK9VgKPwRtDyuGt` reached Ready. Production `/api/version` returned that exact SHA;
`/login` returned 200; and unauthenticated `/`, `/today`, `/changes`, and `/results` returned their
expected 307 login continuations. No paid provider run or hosted environment mutation was performed.

## 2026-07-16 - Intelligence-path residue audit

Reviewed strict-unused findings inside recommendation, attribution, citation, research, drafting,
and page-planning algorithms instead of treating the compiler list as deletion authority. Removed
proven dead constants, state flags, imports, sets, and local helpers across 14 modules. The only
runtime refinement is in the first-mention checker: it now constructs the configured native-script
span regex once per check and reuses it. Exported contracts, ranking and confidence behavior,
budgets, persistence, and customer controls are unchanged.

Verification: focused domain pass 16 files / 362 tests; follow-up pass 4 files / 81 tests; `npm run
typecheck` exit 0; `npm run lint` exit 0 (existing warnings remain non-blocking); complete `npm test`
1,506 files / 22,980 passed / 23 conditional skips / 0 failed; `npm run build` exit 0 with only the
existing middleware-filename deprecation; `npm audit --omit=dev --audit-level=moderate` found zero
vulnerabilities; `git diff --check` exit 0. Strict-unused output fell from 201 to 185 lines and
affected source-tree files from 97 to 85. Product commit
`e7719d1e7d5e5f1786094db091ddb740579684ac` was pushed to `origin/main`; Vercel deployment
`dpl_2Gcq4kKxcf6p3vboppkjDcfqA9GQ` reached Ready with a representative 2.18 MB function. Production
`/api/version` returned the exact SHA five consecutive times. Three exhaustive hosted sweeps covered
all 77 non-dynamic page contracts (231 requests) with zero unexpected statuses. No paid provider,
hosted environment, or data mutation was performed.

## 2026-07-17 - Signed-in Today, Changes, and Results correction

Authenticated Iranopedia text exposed two customer-level contradictions. Changes said Beacon kept
five items copy-ready while its authoritative count was Ready 0, and the safest redirect card hid
the source URL until expansion. The page now states the actual gate, keeps zero-ready language
fail-closed, and exposes exact verified source-to-destination mappings in the recommendation. The
existing eight-stage autonomous receipt now produces a factual stage count, next-stage label, and
header progress rail without estimating provider time.

Results now leads with a compact 7/14/28-day evidence explanation, orders in-flight work by its next
unread checkpoint, renders only the closest five by default, and keeps every later read available
behind one disclosure. Manual recording follows the tracked outcomes instead of interrupting the
normal journey. The same audit fixed exact edited-copy propagation into live verification and the
proof record, explicit-domain ownership correction in performance series, repeated-label chart
positions, redundant or dead imports/props, and a GA4 test clock that expired with wall time.

Verification before release: focused trust and regression pass 8 files / 92 tests; Results-focused
pass 5 files / 14 tests; `npm run typecheck` exit 0; `npm run lint` exit 0; complete `npm run test`
exit 0 after correcting the newly exposed date-dependent test; `npm run build` exit 0 with only the
existing protected middleware-filename deprecation; `npm audit --audit-level=high` exit 0. No paid
provider, hosted environment, or customer data mutation was performed.

Founder follow-up closed the compound-action gap before final release. The overlap model already
declared an intentional `compound` state but its detector never emitted it. Same-page rows shipped
on the same date now receive a stable sorted combo identity and render as one named package in
Results. The page-level result remains visible, but the learning edge neutralizes every member
lever, so a simultaneous title and answer edit can never teach Beacon that either lever won alone.
An edit on a later date inside the 28-day window remains an accidental overlap and stays
attribution-limited. Focused compound, maturity, learning, Results-copy, and architecture guards:
5 files / 152 tests passed; typecheck and lint exited 0.

## 2026-07-17 - Competitor-evidence tenant boundary

Removed the last ambient-tenant selection from the competitor teardown evidence graph. Cache reads
and merged writes now require an explicit tenant ID, including native cited-page teardown, final
ranked SERP winner research, keyword-gap clone briefs, retrieval indexing, answer alignment,
competitor intelligence, claim provenance, factory governance, demand-graph compilation,
displacement analysis, SERP-steal analysis, and internal diagnostics. Missing tenant identity fails
closed. The isolation regression now proves separate explicit reads and that a refreshed audit is
written with the requested tenant scope.

Verification before release: focused pass 8 files / 69 tests; `npm run typecheck` exit 0; `npm run
lint` exit 0 with 93 existing warnings and zero errors; complete `npm run test` 1,511 files / 22,994
passed / 23 conditional skips / 0 failed; `npm run build` exit 0 with only the existing protected
middleware-filename deprecation; `npm audit --omit=dev --audit-level=moderate` found zero
vulnerabilities; `git diff --check` exit 0. No paid provider call, hosted environment mutation, or
customer-data mutation was performed.

Release: commit `5a86983599bedcd91cd6db910d39a138f76c5133` was pushed to `origin/main`.
Vercel deployment `dpl_7k4SwpVX1aaYY87TMQTExN97Jhby` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, and `/results`
returned their expected 307 login continuations.

## 2026-07-17 - One canonical change-result handoff

The historical `/changes/[id]` route no longer tells a second outcome story from the legacy
scorecard, URL-outcome, and stored citation-attribution stack. It fresh-reads the tenant changelog,
matches the row to proof-gsc by normalized page and ship date, and redirects to the exact Results
card. Multiple changes on the same page and date intentionally share the same canonical compound
result. Rows that predate proof tracking land on Results without a fabricated verdict. Focused
verification: 5 files / 36 tests; strict typecheck; lint exit 0 with 91 existing warnings and zero
errors; complete suite 1,512 files / 22,999 passed / 23 conditional skips / 0 failed; production
build exit 0 with only the existing protected middleware-filename deprecation; dependency audit
zero; `git diff --check` clean. No paid provider call, hosted environment mutation, or customer-data
mutation was performed.

Release: commit `19d292c1fc8f0fe56cf4a674fdafc99e5413ef51` was pushed to `origin/main`.
Vercel deployment `dpl_83UnjoPduKince2gFTMwZZxyDQsw` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, and `/results`
returned their expected 307 login continuations.

## 2026-07-17 - Long-horizon confirmation runner

Connected the predeclared repeated-look contract and the existing durable `confirmation_reads`
table to the canonical proof runner. Every closed 7/14/28/56/84-day window is appended under a
stable computation version and first-write-wins identity. Existing reads are loaded before work,
reused without duplicate queries or writes, and a stored day-56 decision is reapplied instead of
being silently changed by later historical-data corrections. Day 56 is strictly demote-only; day
84 is context-only. A 56-day demotion remains provisional while certified placebo history is
absent, so this does not weaken the verdict-calibration quarantine. The canonical 7/14/28 window
array and every existing Results contract remain unchanged. Verification: proof-gsc 60 files /
1,057 tests; strict typecheck; lint exit 0 with 91 existing warnings and zero errors; complete suite
1,513 files / 23,004 passed / 23 conditional skips / 0 failed; production build exit 0 with only
the existing protected middleware-filename deprecation; dependency audit zero; `git diff --check`
clean. No paid provider call, hosted environment mutation, or customer-data mutation was performed.

Release: commit `ec0d8f1f6c0eb617265d50d2574d3d846bb9d4e5` was pushed to `origin/main`.
Vercel deployment `dpl_3oUFgc7CZAQcx5DuWqMXMCMTcJmL` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, and `/results`
returned their expected 307 login continuations.

## 2026-07-17 - Cached keyword portfolio reaches the live action plan

Connected the previously isolated keyword-portfolio logic to the Today/Changes move projection
and the canonical page-element plan. Each existing-page move now merges its GSC queries with the
already-paid DataForSEO demand cache, Labs related-keyword corpus, cached keyword difficulty, and
AI fan-out questions. Intent and topic gates choose a primary target, supporting H2s, FAQs, and
separate-page candidates while keeping wrong-page terms out. The chosen portfolio now drives the
visible owner list, addressable volume, title target, section plan, FAQ plan, and "keep off this
page" warning. Related-keyword and difficulty projections share one underlying cache read; the
customer render path makes no paid provider call. Candidate ordering is deterministic by demand
and difficulty rather than cache insertion order.

An exhaustive run also exposed an order-dependent `/changes/[id]` test mock. Its proof ledger is
now controlled through one stable mutable test seam, eliminating mock re-registration leakage in
the complete suite without changing production behavior.

Verification before release: focused keyword/action/cache/UI pass 4 files / 95 tests; isolated
route regression 2/2; `npm run typecheck` exit 0; `npm run lint` exit 0; complete `npm test` 1,513
files / 23,007 passed / 23 conditional skips / 0 failed; `npm run build` exit 0 with only the
existing protected middleware-filename deprecation; `npm audit --omit=dev --audit-level=moderate`
found zero vulnerabilities; `git diff --check` clean. No paid provider call, environment change,
or customer-data mutation was performed.

Release: commit `49d56191208088534196994ac5d93e910d305c58` was pushed to `origin/main`.
Vercel deployment `dpl_CbeNZZVZ8p5sMTcr83EsyVmoPqyB` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, and `/results`
returned their expected 307 login continuations.

## 2026-07-17 - Citation intelligence converges into PreparedMove

Connected three existing but fragmented intelligence families to the visit-driven autonomous
knowledge stage: real quoted-sentence pattern mining, week-over-week AI answer drift, and
second-order citation sources. They run in parallel with the existing question, claim, and
internal-authority rebuilds so the new intelligence does not add their scan times serially. One
bounded tenant-explicit snapshot is persisted through the existing Supabase-mirrored blob path.
The ResearchDossier filters that snapshot to the current move and carries relevant citation
phrasing, brand drift, and repeatedly cited source evidence into the existing PreparedMove hints
and reference candidates. No new customer screen, ranker, control, cron dependency, paid API call,
or automatic outreach action was added.

The audit found and corrected two trust defects in second-order evidence. The loader selected
`citation_count` but discarded it, flattening every stored aggregate row to one; it now preserves
the real count through a pinned pure projection. Its optional DataForSEO prompt hints now use a
tenant-explicit cache reader instead of ambient routing during background work.

Verification before release: focused citation/dossier/autonomy pass 7 files / 81 tests; focused
storage routing/invariant pass 4 files / 53 tests; strict typecheck; lint exit 0; complete suite
1,514 files / 23,010 passed / 23 conditional skips / 0 failed; production build exit 0 with only
the existing protected middleware-filename deprecation; dependency audit zero; `git diff --check`
clean. No paid provider call, hosted environment mutation, or customer-data mutation was performed.

Release: commit `5a892dd077067435a9074b2d6565992e4afd7b15` was pushed to `origin/main`.
Vercel deployment `dpl_75KYzWB1N32RbW3P6f77nZWvca8y` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, and `/results`
returned their expected 307 login continuations.

## 2026-07-17 - Clarity, competitor forensics, and fanout QA converge

Connected three remaining evidence-depth gaps to the canonical ResearchDossier. Page-matched
Clarity metrics now route through the existing deterministic friction router and contribute an
exact behavior-backed fix instruction only above its session and rate floors. The existing
"why them, not you" engine now has a bounded tenant-explicit loader over configured competitors,
page-level citation evidence, captured competitor structure, owned snapshots, prompts, and answer
observations; only reports with the existing citation and concrete-prompt floors reach the current
move. Fanout relevance is applied before fanout text may expand topic matching, closing a leak where
an off-topic AI question could still pull unrelated keyword evidence after being removed from the
visible AI block. Relevant and multi-source-corroborated fanouts are recorded separately and
withheld rows remain observable in the dossier.

The path is read-only and cache-backed. It performs no crawl, native poll, DataForSEO call, customer
data mutation, or automatic publish, and adds no customer surface, button, cron dependency, ranker,
or serial autonomous stage. Verification before release: focused dossier/forensics/Clarity/question
pass 4 files / 34 tests plus final convergence/route-isolation/architecture pass 5 files / 35 tests;
strict typecheck; lint exit 0 with 91 pre-existing warnings and zero errors; complete suite 1,515
files / 23,012 passed / 23 conditional skips / 0 failed; production build exit 0 with only the
existing protected middleware-filename deprecation; dependency audit zero; `git diff --check`
clean. No paid provider call, hosted environment mutation, or customer-data mutation was performed.

Release: commit `46fe9517fc3d4d46d09f0f50e51123d7b4010eb0` was pushed to `origin/main`.
Vercel deployment `dpl_FEHMGhczSg7QSLovu4oTqXZSo43U` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, and `/results`
returned their expected 307 login continuations.

## 2026-07-17 - Retired runtime and UI archives leave compilation

Collapsed the root Diagnostics route from a 2,255-line all-in-one implementation to a 12-line
redirect to Today. The prior body was already unreachable after its unconditional redirect, but
its static imports still forced a large engineering dependency fan into compilation and kept 16
unused-code warnings alive. Its full source is preserved as non-compiled text under `docs/archive`.
The architecture contract now pins the index as a tiny redirect with no domain, persistence,
seed-data, or operator-engine imports; deep operator routes remain untouched.

The provider dependency audit proved that `providers/index.ts` had zero production importers and
that the Anthropic implementation was an explicit-failure stub reachable only through that dead
barrel and its own test. Runtime dispatch already imports deterministic/OpenAI directly and
`resolveLLMProvider` rejects Anthropic. Both retired files are preserved as non-compiled archive
text; provider tests now pin the implemented runtime set. Historical `source="anthropic"` values
remain accepted for provenance. Inactive page-extractor entries were not archived because the live
dispatcher depends on their exhaustive map even though their registry flags are off.

Net compiled-source reduction: 2,423 lines. Lint warnings fell from 91 to 75 with zero errors.
Verification before release: corrected architecture/provider focus 6 files / 80 tests plus catalog
sync 8/8; strict typecheck; lint exit 0; complete suite 1,514 files / 22,997 passed / 23
conditional skips / 0 failed; production build exit 0 with only the existing protected
middleware-filename deprecation; dependency audit found zero vulnerabilities; `git diff --check`
clean. No paid provider call, hosted environment mutation, or customer-data mutation was performed.

Release: commit `2f3821cb780cce5e9b63cc2694fcd68178e3481b` was pushed to `origin/main`.
Vercel deployment `dpl_4Ch3YCpk3CgKGLEjGquceoriokzY` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, `/results`, and
the retired `/diagnostics` link returned their expected 307 login continuations.

## 2026-07-17 - Results server and proof-card boundary

Split the highest-risk oversized customer route without changing its data flow or presentation.
The Results server route now owns tenant resolution, deadline-bounded reads, measurement assembly,
compound grouping, and streaming orchestration; a separate synchronous presentation module owns
ledger grouping and proof-card rendering. The route fell from 1,982 to 1,052 lines. The extracted
968-line renderer imports no request context, persistence repository, or `next/server` capability
and contains no async work. Existing source-level invariants were moved to follow their actual
render seam instead of weakening or deleting them.

The new boundary test pins the overlap-learning rule directly: simultaneous same-page edits render
as one named package, the result belongs to the combination, and Beacon may not credit either edit
alone. Verification before release: Results focus 20 files / 166 tests; expanded route/dossier/
effect-prior focus 23 files / 206 tests; strict typecheck; lint exit 0 with 75 existing warnings and
zero errors; complete suite 1,515 files / 23,001 passed / 23 conditional skips / 0 failed;
production build exit 0 with only the existing protected middleware-filename deprecation;
dependency audit found zero vulnerabilities; `git diff --check` clean. No paid provider call,
hosted environment mutation, or customer-data mutation was performed.

Release: commit `3648fdd267aa161266a9d89824c7da6441df0236` was pushed to `origin/main`.
Vercel deployment `dpl_EU3Djg319UTva4UzmaAnwUDrzv1q` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, `/results`, and
`/diagnostics` returned their expected 307 login continuations. This completes the accepted
eight-slice exhaustive audit loop.

## 2026-07-17 - Trust-integrity backlog closure (release pending)

Closed the remaining code-verifiable trust ledger in one release-shaped slice. Added durable,
tenant-routed, release-SHA-bound blind-holdout receipts; fail-closed publish-cap behavior and
manual ship authorization; exact Wix SEO-schema restore; deterministic per-edit acceptance IDs;
live-slug duplicate-create refusal; conservative fan-out parsing; and ordered/paginated GA4 proof
windows. Hardened crawl persistence against HTTP error documents, short CMS shells, partial scans,
scan caps, and single-URL scans while retaining last-known canonical evidence. New page IDs are
tenant+URL stable and reuse legacy IDs by URL. Corrected FAQ added/lost direction, content-publisher
schema expectations, GSC sparkline date gaps, legacy citation-decay claims, >48-character AI-claim
firewall bypass, cross-source review duplication, invalid tenant segment defaults, and warm-process
site-config leakage. Unique atomic-write temp paths close an independent multi-worker collision
found by the full suite.

Verification before release: focused suites passed throughout; `npm run typecheck` exit 0;
`npm run lint` exit 0 with 74 existing warnings and no errors; complete `npm run test` passed 1,530
files / 23,048 tests / 23 conditional skips / 0 failures; `npm run build` exit 0 with only the
existing protected middleware-filename deprecation; `npm audit --omit=dev` found 0 vulnerabilities;
`git diff --check` clean. No paid provider call, customer-data mutation, hosted environment change,
or publish occurred. External gates are explicitly not claimed: five unseen blind cases, hosted
refresh receipt, unit economics, Ritz reconnection, one approved publish, live verification, and
the predeclared measurement windows remain next.

## 2026-07-17 - Historical audit ledger closure (deployed)

Finished the older audit-wave and generic-cold-start items that were still live after the main
trust slice. Today citation rate now uses an exact observation-level numerator stored in existing
snapshot metadata; legacy rows keep a bounded compatibility fallback. Article/WebPage schema
descriptions reuse the meta prose gate, Page Surgeon breadcrumbs carry the real URL hierarchy and
omit the homepage, and the existing nightly path runs crawl-proven recommendation retirement
before the 30-day/50-row machine-queue sweeper. Profound cached coverage now produces up to five
unique best-page answer-block candidates with one per URL; the homepage card is fallback-only.
Schema-less publishers can self-classify from repeated substantial editorial structure, while
address/phone, insufficient page count, and local page signals fail closed. Crawl evidence older
than 45 days is labeled with its exact age and high confidence is lowered without hiding the row.

This release also includes the earlier trust closure: SHA-bound immutable blind receipts; publish
cap/authorization rails; exact Wix revert and live-slug protection; acceptance idempotency; stable
tenant+URL page identity; trustworthy crawl carry-forward; FAQ/schema/GSC/citation fixes; tenant
classification/config isolation; review content dedupe; and collision-free atomic JSON writes.

Verification: focused suites remained green throughout; strict `npm run typecheck` exit 0;
`npm run lint` exit 0 with 74 pre-existing warnings and zero errors; isolated complete
`npm run test` passed 1,534 files / 23,070 tests / 23 conditional skips / 0 failures;
`npm run build` exit 0 with only the existing middleware/proxy deprecation; `npm audit --omit=dev`
found 0 vulnerabilities; `git diff --check` clean. No paid call, customer-data mutation, hosted
environment change, or publish occurred.

Release: commit `9350d0dce45b041ee0d363a3f6da0c3924be1d92` was pushed to `origin/main`.
Vercel deployment `dpl_5eBWaXqFgrX6CdUDFQuAtQNVmmrF` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, `/results`, and
`/diagnostics` returned their expected 307 login continuations. External usage gates remain
explicitly unclaimed: five unseen blind cases, one hosted refresh receipt, real unit economics,
Ritz reconnection, one approved publish, live verification, and the predeclared measurement windows.

## 2026-07-17 - On-use autonomy and server-sealed blind validation (deployed)

Removed the last mismatch between Beacon's intended single-user experience and its deployed
operating contract. `vercel.json` now declares no schedules, and cron preflight treats that as the
intentional on-use mode instead of a failure. The existing authenticated visit runner remains the
primary bounded post-response path for stale connector refresh, crawl progress, cached surface
publication, research, demand enrichment, move preparation, and Ready-queue refill. Connections now
derives “Automatic upkeep” from the real visit receipt and latest connected-source refresh rows;
it no longer invents “Last night's sync” from cron metadata. Historical activity rows without a
live schedule also no longer say they ran on schedule. Guarded maintenance routes remain callable,
but no customer health or readiness claim depends on them.

Replaced the post-hoc blind-receipt form with an append-only, server-sealed three-phase store. The
operator preregisters the complete unseen input, freezes the complete prediction against the live
release SHA, and only then reveals the independent expert label and pass/fail result. The server
stamps event order and stores artifact digests, rejects case-ID reuse, refuses reveal before a
prediction, and automatically spends a case if the live build changed. Only the canonical receipt
generated from five diverse server-ordered passing cases can satisfy the existing gate; callers can
no longer supply their own timestamps, SHA claim, or all-success receipt.

Verification before release: `npm run typecheck` exit 0; `npm run lint` exit 0; isolated complete
`npm run test` passed 1,536 files / 23,080 tests / 23 conditional skips / 0 failures (23,103 total,
66.35 seconds); `npm run build` exit 0 with only the existing protected middleware-filename
deprecation; `npm audit --omit=dev` found 0 vulnerabilities; `git diff --check` clean before this
documentation sync. Vercel's retained seven-day logs showed no executions for the former scheduled
endpoints, confirming the old schedule-derived UI was not operational evidence. Direct production
database reads were unavailable from this environment because the hosted database name did not
resolve, and the signed-in browser runtime failed to initialize, so no authenticated hosted receipt
or timing is claimed. No paid provider call, environment change, customer-data mutation, or publish
occurred. Still external: five genuinely unseen cases, one authenticated hosted receipt/timing pass,
real unit economics, Ritz OAuth reconnection, one approved Iranopedia publish, live verification,
and its predeclared measurement windows.

Release: commit `cacb0ad32972b6662208246660764bb31b911471` was pushed to `origin/main`.
Vercel deployment `dpl_3BA1TVcUjYa6brJGJBpqZyxTyCwW` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, `/results`,
`/diagnostics`, and `/settings/connectors` returned their expected 307 login continuations.

## 2026-07-17 - On-use customer-language convergence (deployed)

Audited every live customer-facing occurrence of “overnight,” “nightly,” “tonight,” and “scheduled
run” after removing Vercel schedules. The audit found one major product contradiction: Connections
still mounted an Autopilot card promising unattended overnight publishing and draft preparation,
even though the on-use visit runner does not execute that publisher and all live publishing remains
on a separate approval/safety path. The card is no longer mounted. Its underlying guarded,
unscheduled maintenance code remains untouched; no publishing authority or stored configuration was
mutated.

Converged the remaining real touchpoints on the operating contract. Today machinery and shared
recovery now say background work advances while the operator uses Beacon. Today/Changes batches,
progress, holds, plan links, dossier labels, team summary, power analysis, proof-history explanation,
and safety-canary copy say “today.” Activity, unanswered questions, source-contradiction pauses,
GSC gap recovery, AI polling, citation follow-up, revenue-model confirmation, background
investigation, publish-path failures, and receipt notes no longer claim a hidden nightly schedule.
Internal structured-draft and batch-review prompts use the same wording so generated artifacts do
not leak the old promise back into customer copy. Added
`tests/architecture/on-use-customer-language.test.ts` and cataloged it; the invariant pins the
unmounted Autopilot control and the critical recovery/execution/supporting-surface language.

Verification before release: targeted convergence coverage passed 13 files / 201 tests, followed by
the expanded shared-copy and maintenance set; `npm run typecheck` exit 0; `npm run lint` exit 0 with
74 existing warnings and zero errors; isolated complete `npm run test` passed 1,537 files / 23,085
tests / 23 conditional skips / 0 failures (23,108 total, 56.50 seconds); `git diff --check` clean
before this documentation sync. No paid provider call, environment change, customer-data mutation,
OAuth action, or publish occurred. Hosted acceptance remains external: five unseen cases, one
authenticated visit/source receipt and signed-in timing pass, real unit economics, Ritz reconnect,
one approved Iranopedia publish, live verification, and its predeclared measurement windows.

Release: commit `9174b0f1cc318714d0ac6c41bd56f3478dc44f4f` was pushed to `origin/main`.
Vercel deployment `dpl_FGsSQhMVrfzCQfx2SwJDSzN4mTjc` reached Ready and production
`/api/version` returned that exact SHA. Unauthenticated `/`, `/today`, `/changes`, `/results`,
`/activity`, `/research/keywords`, and `/settings/connectors` returned their expected 307 login
continuations.
