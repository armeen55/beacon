# Beacon Verified State

> What is implemented and verified now. The target product is `PRODUCT_TRUTH.md`; never describe target behavior here as shipped. Update only after a verified deployed state change.

## Current foundation

- Branch `main`; MVP rebuild started at `4669fbb5`. Stack: Next.js App Router, strict TypeScript, Supabase, Vercel.
- Verified source and production on 2026-09-12: `080db9274a042025422de4eb2e681dcb669464d3`, deployment `dpl_8TboPWd4pFfQB31PEz3im8a4nJSM` READY. Production `/api/version` HTTP 200 reports that exact SHA on `main`; login HTTP 200 and anonymous Changes HTTP 307 to login. Query-backed winner identity, acquisition readback, paid-content preservation and task-focused section/table comparison retain their prior verified contracts. Writers/reviewers share selected captured competitor material with provenance and completeness limits, research rather than claim authority; comparison reader v3 binds quotes to exact supplied sanitized source (not candidate quotations), retains typed heading/entity topics including comma-containing names, and separates rejected-only from valid empty comparisons. The existing-page editor now selects owned material with the same task/query-aware section reader as winners under the prior 4,800-character comparison allowance. Late owned answers, qualifications and table rows travel into citable page-copy evidence within the existing 12,000-character budget and the identical writer/reviewer packet; comparison metadata carries capture identity rather than duplicating text. Owned identity covers the full supplied body, headings and completeness; unshown changes invalidate the comparison cache, and an empty model result on selected/incomplete/freshness-unconfirmed owned material remains unread rather than proving a whole-page absence. Packet partial state retains sampled and stale-owned capture limits. Page-job v2 now identifies purpose/shape/audience/subjects and observed conversion actions, never a missing capability: the obligatory `missing` field is removed from its schema, durable projection and writer handoff; legacy values remain stored history but are excluded, including from banked assignment instructions. Durable identity covers selected extract plus prompt/version/schema, NOT unseen body content or model identity; unchanged identification is free, stale identity refreshes within the existing pool, and failed save acknowledgement returns `unsaved` while preserving usable in-memory work and the actual provider-attempt charge. Frozen-source full gate: 2,045 passed, 24 skipped, 89 files; foundation/lint/typecheck/build passed, 21 existing lint warnings. Comparison identity tests were consolidated while retaining visible/unshown winner-change assertions and adding unshown owned-change identity. Two unrelated-site counterexamples assert late owned material reaches actual comparison requests and citable writer/reviewer packets under unchanged budgets; prior page-identification and receipt contracts remain. Production/test/combined LOC: 74,477/20,525/95,002; test/combined ceilings ratcheted down, no new routes/dependencies/domains/exports. This source slice: $0 provider spend/calls, one tenant-scoped Data API HTTP 200 read confirming stored body/headings shape, one full gate/local build and one Git-triggered production deploy; no funded drive, cron/environment change, migration or stored-data deletion. Prior narrow audit used one management HTTP 401 and three Data API HTTP 200: scoped saved rugs/Takbir/slang drafts held for review; a Parthian link remained stored ready with differing anchor/copy spelling; dated Farsi-numbers/Safavid captures showed no schema/ImageObject only. NOT CERTIFIED: authenticated production journey, future model editorial quality or sustained live waterfall; task-adequate owned-page reading, semantic entailment and whole-page absence proof; full prompt-injection resistance; body/model-sensitive durable identity, stale identity/promise authority and concurrent write recency; reader-task shape/capacity and complete operator heading/copy/mutation contract across all edit families; visible-content/schema dependency refresh, complete schema-value capture/verification (schema_hash currently types only) and current rich-result guidance; historical owned-scoped fact-bank reconciliation, acquisition-mode whole-review objections and canonical-validator remediation; live cross-process cache writers or history-query scaling/retention; atomic metric-window consistency, source-watermark outage semantics and complete verification validity. Prior canonical AI recurrence, five-page SEO comparison and manual publishing remain. Last inspected cron remains active every ten minutes; billing failure is not a global pause. GSC finalized through Sep 9 and GA4 page traffic current at last inspection; separate GA4 totals/referrals and legacy technical scans stale.
- Canonical AI truth remains Supabase-only; retired observation dual-writes and legacy readers stay removed. Source research rejects explicit social/forum/community sources, reads ordinary publishers, and distinguishes unsupported completed findings from unread evidence. Confirmation requires one authority or two independent credible publishers, with each quotation verified inside its own fetched passage. Historical August inventory counts, single-run prices and the likely Ahvaz finding are not current stock or authorization; current eligibility must be established per fact record.
- The foundation guard caps production, tests, combined LOC, domains, routes, exports, files, dependencies, and Markdown. `npm run gate` runs the guard, lint, typecheck, tests, and build. Five kernels exist (Account, Evidence, Decision, Measurement, Runtime); five surfaces (Today, Visibility, Changes, Results, Connections). Wix is removed; publishing is manual for every account. Supabase authentication provisions one membership and one tenant per new user.
- One login resolves exactly one account, fail-closed (2026-07-23; loop-proofed 2026-07-26): on product paths the
  middleware injects the single membership's account; zero, multiple, erroring, or timed-out lookups redirect to
  login. Public paths skip the membership gate, so a stranded authenticated session can always reach login, the
  signup recovery card (retry provisioning + sign out), and sign-out instead of looping. Login and signup render
  mapped plain-language messages, never raw codes. No account switcher, enumeration, or selection cookie exists;
  an authenticated request never reaches an env-tenant fallback. `BEACON_OPERATOR_MODE` is presentation-only.
  `provisional_name` is an internal signup seed; surfaces render the BusinessProfile name, then the domain.
- Canonical Account, Website, and BusinessProfile records exist (Slice 1 + closure, 2026-07-23): the Account is
  the `tenants` row (vertical columns retired to unread legacy) resolved through account-scoped Supabase queries;
  Website is the one canonical projection of `Account.domain` (the only persisted website authority; Settings
  shows it read-only); BusinessProfile lives in the Account kernel as provenance-carrying sections (value, origin,
  confidence, source URLs) over the approved Product Truth fields, backed by the `business_config` row at
  schemaVersion 2 with raw pre-canonical JSON preserved under an inert `legacy` key. Profile reads are async and
  Supabase-only: a cold first read resolves the real identity, a missing row or transient failure is never cached,
  and no file, env, founder, or process-global fallback exists. Provisioning writes a generic row; missing configuration fails generic at every former leak site.
- Test fixtures carry generic identities; synthetic non-Latin-script sample content is retained for coverage. Revenue settings were removed (an MVP non-goal); unit economics is dormant, and the last dead revenue and relevance helpers were deleted with the queue truth correction; publishing remains manual.
- No account can become stranded (2026-07-26): signup writes the real `business_name` column (every prior signup
  failed on a nonexistent `provisional_name` insert); an id collision can never attach a new user to an existing
  tenant; the callback resumes unfinished onboarding by resolved status. One lifecycle resolver gates the product
  pages: pending resumes `/onboard`, paused/cancelled read one honest notice, a failed or anomalous read is
  bounded retry, never a redirect, lockout, or onboarding bounce. Active accounts manage tracked questions in
  Settings, Business info via ONE shared prompt service and editor also used by Step 5 (which hydrates from the
  approved set): unchanged wording keeps its row id and history, a rewording carries `superseded:<oldId>`, legacy
  seed rows are untouched, 10..100 enforced in Settings, a valid save resumes the same paused Research Run on the next visit.
  jsonb `tags` reads pass JSON (contains() silently errored to empty, which would have kept research paused after
  a save). Copy is true: no auto-publish or per-charge approval claims, no raw exception text, research runs on
  the scheduled dispatcher with a visit as recovery only, Today's paused line carries the control that fixes it.

## What is real but incomplete

- The seven-step onboarding and approved-question flow is live and CONNECTED (Slice 5 + closure, 2026-07-24)
  on `/onboard`: one basis, website to activation. Every `tracked_prompts` row carries a deterministic basis
  fingerprint; only current-basis rows render, count, approve, or activate, and approval's other-basis sweep
  (locally pending-only, 2026-07-26) keeps stale prompts untracked pre-activation. Website replacement
  mid-onboarding is one atomic idempotent RPC: new domain, goal cleared, prompts deactivated with history kept,
  profile reset, crawl restarted. Profile confirmation is truthful (every section operator confirmed). The prompt
  step has include/exclude, edit, group, remove behind group disclosure, server-validated per tenant and basis;
  new rows carry all four engines; the deterministic fallback never pads. Pre-activation OpenAI spend durably
  reserves projected cost BEFORE each call against the lifetime $2 cap, reconciling to actual (write failure
  overcounts and blocks); live-validated at $0.0378. Page snapshots persist (14 real upserts). Connections shows
  "Return to setup" while onboarding. Pending accounts start no Research Run at either boundary; activation is
  idempotent, requires the setup window server side (approval holds 20..50, floor bending to a thin candidate pool; activation re-checks 10..50 on the set that survived it) plus website, confirmed profile, goal, and terms,
  starting exactly one durable Research Run. Verified end to end rendered, desktop and mobile, with real crawl,
  real model calls, mid-flow website/goal changes. One inert synthetic pending account remains for review.
- Durable Research Runs exist (Slice 4, 2026-07-24), triggered by the Supabase-scheduled dispatcher every 30
  minutes (Dream V1, live since 2026-08-03; deployed and verified at `899d9985`), with an authenticated visit as
  the recovery trigger only. Recovery passes carry a scoped unit plan; answer re-reads reach the last 26 weeks
  exactly; the credit breaker allows bounded concurrent probes, one per process; a call abandoned at the client's
  own deadline carries no usage receipt and never settles an answer, which stays owed until a real reading lands.
  The EvidenceSnapshot and keyword discovery read the canonical ai_observations record (latest useful row per
  active question and engine, paged until every active pair is found or the shortfall is said; live-verified at
  140 pairs), never the funnel's transient window and never the deleted legacy projection; a cited address gets
  one vote per answer and rivals rank by distinct questions; every settled reading flows into case receipts
  dated and naming every observation behind it (a withheld time-sensitive line is disclosed, never hidden),
  creates its own bounded consume pass through a fingerprint and watermark that read the same rows by construction, and moves evidence identity; harvested keywords accumulate across passes, a failed read
  keeps history and says so, and the tracked-question truth lives in the Account kernel. Everything below describes the runtime as built. A visit renders the saved surfaces first, then
  claims or resumes the account's Research Run through an atomic database-time lease RPC. At most one
  unfinished run per account across all dates (partial unique index): the claim resumes it whatever day
  it started (same row, phase, cursor, progress; a live foreign lease blocks, an expired one reclaims), a
  same-day completion (the operator's Pacific day, computed in the claim RPC) blocks a redundant pass; a new daily cycle starts only when none is
  open. A partially failed refresh durably persists the providers that synced before pausing. Seven phases mirror
  the real work (refresh sources, GSC backfill, keyword discovery, AI observation, search analysis, winning pages,
  surface publish); progress, phase, cursors durable; a killed invocation resumes at the persisted phase;
  concurrency cannot duplicate work; Today shows ONE stable status line (2026-07-26): an open error-free run reads
  "Research in progress" with the durable AI-check count (only while that phase is current), identical across
  lease states; a pause names its reason only for the recording phase; a failed tracked-question read pauses as
  its own transient reason, never a false "no questions". The scoreboard sentence carries no measuring count (the
  proof strip owns measurement). The truth boundary holds: a failed connector, backfill, or publication pauses the
  run with a bounded error, never advancing or presenting as completed; a phantom state conflict (a memoized stale
  read once paused a healthy run and zeroed its receipt) retries its phase ONCE under the same lease and attempt
  identity at $0, discarding stale counters; only a second conflict pauses; admin Supabase reads opt out of fetch
  caching and request memoization so they always hit Postgres; lease mutations are database-time security-definer
  RPCs (an expired owner cannot mutate; completed rows reject mutation); each phase's idempotency key persists
  before its side effect and survives interrupted retries; completion copy names its finish time and never claims
  research is current. All three migrations applied; the claim RPC smoke-proven against the real database.
- The DataForSEO research funnel is lifecycle-true and feeds ONE canonical evidence input (Slice 6 + closures
  6B..6I, 2026-07-25). A TYPED registry owns each engine's ask; providerCall routes Standard-vs-Live; the
  boundary returns the FULL envelope and never auto-retries paid work after a refusal or ambiguity. Money:
  tenant-independent `evidence_cache`, single-flight claim, breaker, ATOMIC reserve before the network,
  reconcile; persistence fails closed. One paid-response policy: temporary codes release, everything else
  refunds into a durable blocked hold; an uncertain outcome is quarantined, recovered only via free
  tasks_ready; a BLOCKED response pauses the run visibly. Completion counts only current canonical pairs.
  Every observation carries a frozen MODE: consumer_search is THE canonical ChatGPT signal; standardized_response is canonical for the other engines plus a bounded auxiliary chatgpt sample.
  Gemini wrappers resolve to the real source before ranking. Funnel state is Supabase-only, basis-scoped.
  The canonical EvidenceSnapshot is the ONE public evidence input; the hash fingerprints material content
  only. Proof is hermetic AND live-validated (2026-07-25, $0.07 across all engines, cent-exact ledger). Production research is ENABLED (2026-07-25). Full mechanics: git history of this section.
- OpenAI generation flows through one strict Responses API gateway (Slice 3, 2026-07-23): json_schema
  strict:true, every call site converted, the Completions transport deleted. Account-scoped end to end
  (2026-07-24): tenant-scoped cache, budget, transport, provenance, and error ledger; the per-account LLM
  budget rides a tenant-scoped file backstop with the durable Supabase ledger authoritative; one account's spend never throttles another. The OpenAI key enables this path directly, no secondary flag.
- DOING NOTHING IS THE DEFAULT AND AN EXACT RESULTS PAGE MUST EXPLAIN THE ACTION (2026-07-27): each page is
  diagnosed against its OWN exact query rows and the shipped click curve BEFORE any draft; an action needs
  impressions to trust, a real gap at that position, and enough recoverable clicks to be worth a morning. A row I
  hold nothing about is not a page I judged. HOLDING the live results page is not READING it: ActionDiagnosis reads
  the line Google displays for the page, the wording that recurs across the SITES beating it (one site twice is that
  site's style), and the gap between them, so only a named cause with a competing explanation ruled out becomes
  work; token containment is deleted. Nothing reaches a drafter before a diagnosis, so an unsupported change costs
  nothing. Confidence follows evidence completeness, never the draft. A page's own words are readable through a
  targeted reader over the snapshot columns the shared projection drops (explicit account, three URLs, bounded,
  fails closed), so drafts are checked against the page itself. An investigation gets BOTH halves of its evidence:
  the results page for that exact search and the pages that win it, priority first, noise domains excluded; only a
  query with no results page yet can be closed by buying one. The diagnosis and every alternative it ruled out are
  receipt items, and every count is derived from real items. A held Ready change is re-judged and set aside when the
  evidence stops supporting it. Copy is honest about its own limits: search averages cover every country and device,
  so a page missing from one collected results page is a different slice of Google and never proof it does not rank,
  and a rank counting ads and packs is never printed as a position. Decision generation 6: PROMPT-TO-PAGE
  GENERATION STAYS DELETED (2026-07-28), because turning a competitor's example prompt into a page shipped
  duplicates of pages the account already owned. The ONLY door to a new page is an EARNED create_new, proved by
  a bought page comparison; no other trigger creates, drafts or resurrects one. Live replay 2026-07-27 (SHA
  e92bdbd1): 0 actionable, 23 investigations, 164 watch, 31 do nothing, 0 Ready; the next pass buys the three
  searches with no results page yet. ONE canonical path produces the ranked queue AND at most one deep existing-page Change per pass: receipt-first, citable research REQUIRED, thin evidence = refusal.
  Parts bundle ONLY when they are one repair; a bundle REPLACES its shallow rows. Evidence tells the truth about itself: query identity on the receipt, winners attaching ONLY on
  exact URL or exact member query or prompt, a page that arrived by rank never called an AI citation, internal links
  withheld while no body backs them, metric sentences naming their scope, and a producer failure never publishing a
  fresh timestamp over stale proposals. Page snapshots read Supabase. Business Info is provenance-safe. Results
  bands are maturity-true: early = Promising, Win = 28-day only, still-measuring carries no verdict. Today counts
  the full Ready list, names how many pages are under investigation, and carries the decision's own verdict for the page it blames; manual implementation and 7/14/28 stand.
## Known target mismatches

- Profound and SEMrush survive only as historical-row reads and inert comments (Slice 2 removed the connector
  provider, seeding, drafter sources, confidence gate, benchmark, and Actions dispatch); never revive them.
- Production DataForSEO is ENABLED (operator-approved 2026-07-25): credentials are the sole activation, bounded
  by the provider $25 day cap, a $250 per-account month cap and a $500 global breaker (raised 2026-07-31).
- Real-customer names remain only in historical code comments (executable strings and fixtures are clean).
- Legacy `.data`/dual-write code remains for non-account stores; the Account/Profile path no longer uses it.

## Environment readiness

Verified variable-name presence without reading or printing values:
- Local and Vercel production have Supabase and OpenAI credentials.
- Vercel production has Google OAuth client credentials and a GSC site configuration.
- DataForSEO credentials are live-validated locally AND set on Vercel production; missing credentials fail closed. Never place credentials in chat, documentation, commits, or command output.

## Current routes

- Today `/`; Visibility `/visibility`; Changes `/changes` and `/changes/[id]`; Results `/results`; Connections
  `/settings/connectors`; minimal settings, onboarding, login, signup, Google callback, and version routes. New customer routes require operator approval.

## V1 Truth Convergence (Phases 0-9 complete, 2026-08-01)

Canonical `ai_observations` keeps every AI answer whole (identity: tenant, prompt, version, engine, reporting
day, sample slot; journey keeps fan-outs, retrieved-not-cited and citations apart; pao is a projection).
Tracked prompts carry `version` and `core`; the planner observes slot 0 daily (on visit today, on schedule
under Dream V1), slots 1-2 via Update data (max 3/day), and never fabricates a missed day. Cases are a partition (one owner per anchor); freshness
is one leaf matrix; diagnosis is a 15-cause ladder with competing explanations and a falsifier on every
proposal. `change_proposals` holds ONE current row per (account, case, page, action family) with supersession
chains. A marked change is a Shipment: write-once `implemented_at` stamp and baseline, live verification, and
28-day windows anchored on the stamp (conditional day-56). AI outcomes read slot-0 rows; mention rate divides
by analyzed. Today is four total states reading one release blob, so no two surfaces disagree on a count. All
four 2026-07-31 migrations applied to production before the push. The live account runs the operator's own
35 approved questions and nothing else (an earlier 85 here summed two tenants; the synthetic onboarding
account's 50 candidates are core-flagged off, reversibly, and 50 legacy seeds stay deactivated).

## V1 Closure and Decision Honesty (2026-08-01 and 2026-08-02, deployed with this state)

The loop's integrity breaks are closed: one derived BrandIdentity with a deterministic text and citation
matcher behind the model; whole-range paginated reads that throw rather than truncate; retrieved-but-not-
cited derived by canonical url subtraction; batched analysis; terminal pair states on the canonical row; the
open-tab continuation controller; one Pacific reporting day including the cycle key RPC; origin receipts on
fan-out keywords; atomic supersession; lint in the gate; the proxy convention. On top of that, pinned by end
to end tests: the deep read has five doors and each earns on ITS OWN evidence (an AI citation loss or a
coverage verdict needs no Google click deficit; a door that did not measure clicks may not conclude a
wording change; two pages splitting a search can only consolidate or refuse). The owned page is one bounded
representation of everything the store holds with a derived completeness verdict; the store keeps samples,
so whole-page questions answer yes or unknown, never a false no, and absence claims are filtered against the
held page before they fire. Analysis coverage is resumable by piece: the answer hash lands only at full
coverage, a partial stays due and resumes at the first unread piece, and every completed-check denominator
counts only settled readings. A full rewrite or new page is Ready only when every planned section and the
opening drafted and validated; source packs name the source whole or say the operator picks it and hold for
review, and the component card renders where, why, and the sources. Dream V1 is live at 27e6e8bf: a pg_cron dispatcher (every 30 minutes, Vault bearer, honest receipts, 503 on an unreadable fleet, rotation past account 20) drives the same canonical cycle a visit drives, and one due-work truth opens recovery passes for missing observations, unread answers, crawl debt and unpublished releases; the first autonomous day completed 2026-08-03 for Iranopedia (35 prompts x 4 engines, 140 of 140 terminal observations, zero duplicates, $1.43 provider spend) and the crawl advances autonomously (58 of 217 pages read whole at this writing); one canonical actionable verdict guards every door to a Change including mutation time, one release identity spans Today and Changes, destructive consolidations need a proven survivor and server-side confirmation, a stale run closes honestly at Pacific midnight from any phase, Visibility actions re-resolve the session before any read, ledger outages say so instead of rendering zeros, and the one unsafe consolidation withdrew through the canonical sweep leaving an honest empty queue. The operator's signed-in walk of the surfaces remains theirs to take.

## Ready River (2026-09-01 night, local only, Vercel paused)

Every open change carries ONE typed next obligation (decision/obligation.ts) stamped at the store door; the store merges against the fresh row only when words change, refuses a same-id save over an implemented row, loads the canonical table alone, and counts lanes by row state; the sweep retires briefs never drafted words; structured data is field `schema` with its own gate and verifier; counts and dates are supported by their numbers; Results names a recommendation later withdrawn. Verified on localhost 3141 at 91b3975a: Ready 6, lanes 6 / 24 / 90 agree with the store, full gate green. Open: the walk still runs families in code order rather than the plan's funded order (funded editor keys can expire behind lower-ranked spend), and a repeated zero-spend pass rewrites 26 rows.

## Queue truth correction (2026-08-15, deployed and verified at 3fb808bb)

The copy machinery worked and the brain laundered unproven work into ready-looking cards. Ten corrections, all replacements. NEEDS_REVIEW NO LONGER PRESENTS AS FINISHED: Changes renders status `ready` as the paste-ready lane and everything else in a separate labelled review area carrying the whole argument and no Copy, no Mark done, no one-press record; the promotion into `ready` is now real, stamped by drafted-copy when a deliverable clears the drafter, the deterministic editor contract, the judge AND the canon validator (nothing had ever moved a card out of `needs_review`, so validated copy sat in the same lane wearing the same buttons as a card nobody had written). EVERY DIAGNOSIS-NAMED PAGE CARRIES A DISPOSITION: the differentiation producer stamps one verdict per named address BEFORE it drafts (differentiate / keep_as_is, each with its reason, on `ChangeBundle.dispositions`), and completeness refuses a bundle that owes work on a named page and wrote none, so a three-page split can no longer answer complete after silently losing two pages. CLAIMS ARE EXTRACTED FROM THE COPY, not from what the writer declared: a structural pass reads coordinated lists and enumerating prepositions out of `finalCopy` and refuses any member the page's own stored evidence does not carry (the phrase list it replaces could only catch sentences somebody had thought of); the accessories description that promised "filter by type, color, or region" is refused off the real stored body (content_hash 7ba2fa6d05c5f3d7) on "color" and "region on Iranopedia", while an honest paraphrase built from that page's own products passes. It is deliberately NOT a vocabulary test, which this codebase has already thrown out once. The judge now reads the whole stored body bounded at 24,000 characters and is told when it was truncated; accepted claims and their evidence ids persist on the row. ONE AI EVIDENCE TRUTH: `citesOwnSite` (evidence/ai-visibility) is the only ownership predicate, read off both the domain and the url with a real label boundary, and Visibility, the cause ladder and the $0 producer all call it; the producer's denominator counts EVERY answer that reported sources, not only the ones that had already failed the test. On live rows this retires the two false cards and keeps the two true ones: "famous Iranian people" and "funny Persian phrases" credit the site in 2 of 3 stored answers each and no longer mint a gap card, while "basic Persian phrases" and "famous landmarks" credit it in 0 of 3 and still do. IDENTITY IS COMPLETE: the stored fingerprint carries each piece's page, placement, objective, mechanism, anchor and redirect target plus the bundle's dispositions, and finished copy survives a pass only while `copyIdentity` (basis, the target page as this pass read it, diagnosis, evidence ids, placement, affected pages, lever) is byte for byte unchanged. RANK IS EXPECTED VALUE: the 250-wide lifecycle band is deleted, correctness is settled before the ranker, and the queue orders on recoverable clicks or audience, cause fit, evidence, effort, risk, overlap and this site's own finished readings. EVERY PAID ATTEMPT COUNTS: one hard 30-call budget per pass, shared by every editor and decremented BEFORE each drafter and judge call, replaces a cap that counted only successes (364 charged calls had produced seven visible cards); OpenAI spend is one atomic `increment_llm_spend` RPC under an advisory lock instead of a client-side read-then-write that silently lost one of any two concurrent charges. The regenerated queue is three finished changes and nine held for review, ordered on worth: the 18,130-view templated description leads at 42.1, the 152-click girl-names title follows at 37.6, and the description on a page shown three times ranks last of the three at 6.8 instead of beside them. Research stays paused for the live account. Deployed and verified live at 3fb808bb (`/api/version` on the production host answers that sha on `main`). TWO REPAIRS LANDED ON TOP OF IT in the next commit, deployed with it (verify the current sha at `/api/version`). THE GROUNDING BLOCKER: the coverage corpus carried the writer's own claim text, so a hallucination authenticated itself, and the two questions are now split. Claim coverage still asks whether every material assertion in the copy maps to a persisted claim, against those claims plus the exact stored words each one names, so a faithful paraphrase of cited evidence still passes. Support entailment is new and never includes a claim in the corpus it is tested against: each claim is read against the quoted facts its own supportedBy names, on the words the copy actually leans on, which is exactly where a claim can vouch for a lie. On the live account this refused the one ready card: the shoes description declared "The page includes Love Eshgh black and white variants" against four headings and a body excerpt that name the shoes and never say the page includes anything, so the row was demoted to review rather than kept ready for presentation, and the account now shows zero ready, two waiting on a review and ten still being developed. THE DANGEROUS-CHANGE LIFECYCLE: step two of Product Truth's two-step hold existed nowhere, so no redirect, merge, canonical or de-index could ever become work. A complete, cause-settled, dangerous change held in review now carries a confirmation on its own detail page beside its pieces, addresses, destination, copy, risks and evidence; the server re-reads the row, re-runs actionability, completeness, unsettled cause, the dangerous-component check and the row's identity, and promotes only on a stamp that still names the exact version (copy, pieces, destination, risk grade, evidence, basis). A stale stamp refuses, safe review work cannot reach the door, and nothing is ever promoted automatically. VISIBLE QUEUE INTEGRITY (same day, prepared for deploy): the store's own promotion (`answerReviewedProposal`) now refuses directly on the row itself, calling `deliverableGaps`, `unsettledCause` and a zero-cost banked-copy grounding recheck before the existing receipt-integrity check, never by classifying a stored limitation's wording, so a benign-reading limitation beside a real defect cannot ride a draft to `ready`; the HARD_LIMITATION phrase list is now display classification only. The research lane is no longer cut to one page (`changes-data` serves it whole; the release already held it in memory) and the feed opens every remaining opportunity in a disclosure rather than leaving it behind an unopenable count. Every research card links to the same read-only detail page a draft opens on, and its "Next" line reads the typed `researchOnly` field and the step a producer places last instead of matching a sentence's wording.

## Verification

- Use the real main tree at `/Users/armeen/beacon`; preserve untracked `.codex/` and `supabase/` content. Run
  `npm run gate` before completion. An accepted plan authorizes commit, push to `origin/main`, deployment, and
  hosted smoke verification, subject to the destructive and external-state pauses in `AGENTS.md`.
