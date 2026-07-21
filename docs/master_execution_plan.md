# Beacon Master Context Vault

> **PURPOSE:** The durable record of Beacon's current architectural and product decisions, the
> ones that are still in force, not the chronology of how we got here.
>
> **NOT FOR:** Current state (see `HANDOFF_VERIFIED_STATE.md`), active execution steps (see
> `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (see `architecture.md`), verification proof
> (see `VERIFICATION_LOG.md`).
>
> **2026-07-21 compaction:** This file was 3,370 lines (228 KB), mostly a completed Phase 0
> planning vault (target-architecture matrices, a persistence-dependency audit, and the full
> Phase 1A-13 / Phase 14-23 / Shell A-H / Intelligence-Expansion / Tiered-nano-phase histories, all
> now COMPLETE or superseded) plus a stale 2026-04-09 pricing table. All of that moved verbatim to
> `docs/archive/MASTER_EXECUTION_PLAN_HISTORY.md`, nothing was deleted or rewritten, only
> relocated. What remains below is everything that reads as a **current** decision, invariant, or
> live idea: the dated repo-truth decision records, the repo Identity block, the full Dream-state
> convergence decision log, and the Future Ideas parking section.
>
> **ORGANIZATION (current):**
> - **Current Repo Truth**: dated architectural/trust decisions still in force, plus repo identity
> - **Dream-state convergence decision**: the active `ResearchDossier -> UnifiedEntry ->
>   PreparedMove` architecture and its accumulated boundary decisions (2026-07-13 through
>   2026-07-17)
> - **Future Ideas**: dream-state / post-V1 ideas not yet in the active execution plan
> - **Archived history**: pointer to `docs/archive/MASTER_EXECUTION_PLAN_HISTORY.md`

---

## Current Repo Truth

### Trustworthy-baseline and identity decision (2026-07-17)

A failed crawl response is never a page change. HTTP error documents and sub-500-character CMS
rendering shells are rejected; full-replace snapshot and element stores preserve the last
trustworthy canonical observation for failed, capped, or intentionally single-page scans while
dropping URLs genuinely removed from the current sitemap. Fresh observations alone may generate
diffs, alerts, or scan-success counts. Page registry identity is tenant+normalized-URL stable for
new URLs, while an existing URL retains its historical ID during migration.

Missing tenant classification is a first-class `unknown` state, not an implicit local-service
tenant. Unknown turns segment-specific engines off and stays in its own global-pattern bucket.
Site domain/brand configuration is tenant-keyed in one warm process and prefers the tenant's own
business configuration over process-global site env. Review identity is content-based across
manual and connector sources (normalized author + date + text), with exact provider ID still the
strongest replacement key. These are permanent trust boundaries, not presentation choices.

### Historical audit closure decisions (2026-07-17)

Citation rate means the share of observations citing the owned brand, never the number of cited
URLs divided by answers. New snapshots carry the exact observation numerator inside their durable
metadata so correctness does not depend on a hosted schema migration; old rows use an explicitly
bounded compatibility fallback. Schema descriptions must pass the same prose/label-list firewall
as meta copy. Breadcrumbs must express root → intermediate path → leaf and are omitted on the
homepage. Machine-created recommendation queues are bounded at 50 pending rows and 30 days; crawl-
proven resolutions retire first, then the sweeper runs, so the two writers never race one row.

Profound prompt intelligence is interpreted through the existing prompt-to-page coverage compiler.
At most five strongest unique existing-page gaps enter the queue, one per target URL; the old root-
page recommendation is visibility-only fallback behavior. Provider prompt creation stays operator-
managed, especially for borrowed workspaces. Publisher inference may use repeated editorial
structure without Article schema only when there is no address/phone; the launch threshold is two
substantial semantic articles and the post-crawl threshold is five substantial non-local pages.
Recommendations grounded in a crawl older than 45 days remain visible but state the exact age and
cannot retain high confidence.

### Autonomous operating model decision (2026-07-13)

Beacon must not hide its core intelligence behind a sequence of research buttons or depend on cron
for a single-user product. A normal signed-in visit schedules a bounded, once-per-tenant/day
post-response cycle that acquires fresh connector, SEO, AEO, competitor, question, claim and link
evidence before final ranking and draft preparation. Research remains inspectable through a
structured visible receipt, paid work remains cache/ledger/cap guarded, and publishing always
requires its separate safety path. Vercel schedules are intentionally empty: guarded maintenance
routes may remain for explicit operations, but no customer health, readiness, or product copy may
depend on or infer a cron execution. The receipt should collapse to one calm global status across
navigation, while the detailed audit remains available on Today. Real query evidence must survive
into the prepared move; no downstream intent or draft step may silently replace loaded GSC queries
with a guessed label.

### Blind-validation integrity decision (2026-07-17)

A blind result is eligible only when Beacon itself seals the chronology against one release SHA:
preregister an unseen input digest, freeze a prediction digest before the label is available, then
reveal the independent expert-label digest and result. Events are append-only and server-timestamped;
case IDs are single-use, reveal-before-prediction is invalid, and a build change spends the case.
Five diverse passing cases remain the minimum. A caller-supplied receipt, timestamp, SHA assertion,
or post-hoc success blob is regression evidence at best and can never certify a release.

### Continuous execution-loop decision (2026-07-15)

Beacon's daily product loop is Today → Changes → Results. Supporting research and receipt surfaces
remain reachable through command search, but they do not compete in the primary sidebar. Changes is
an execution queue, not a second analytics or research dashboard: its visible states are To do and
Ready, exact copy leads, and evidence machinery is collapsed. Measurement and settled outcomes live
on Results. Customer language follows that same clock: current work is “today's,” and autonomous
work is described as advancing while Beacon is used or as new evidence arrives. No mounted customer
control or recovery sentence may promise an overnight, nightly, or next-scheduled action while
Vercel schedules are intentionally empty. Dormant automated-publishing controls do not belong on
Connections; publishing remains on its separate explicit safety path.

The ready queue maintains a tenant-scoped floor of five through ordinary signed-in navigation and
after any handled change. Maintenance consumes the already-ranked, already-cached evidence graph,
scans the full authoritative Changes order, prepares only missing capacity under a hard cost cap,
does no live SERP work, and republishes one atomic customer release. The deeper competitor,
DataForSEO, AI, source, and keyword pipeline keeps its once-daily resumable cadence. A rejected
cached draft is preserved for deep or explicit repair rather than regenerated on every visit.

The 2026-07-16 hardening pass extends that same ordinary-use guarantee to owned-site inventory:
unfinished crawl frontiers continue after a response, and a completed crawl re-queues after seven
days. Operator feedback stays inside the single compact Not now menu; a fixed dismissal reason is
persisted through the existing recommendation-response learning path, while deferral is one
truthfully labeled week. Scheduling background preparation must never be presented as completed
work; only a subsequent server surface may claim a new edit is ready.

Deadline recovery follows the same autonomy rule. If a server section misses its bounded deadline,
Beacon retries the current page once automatically after the abandoned load has had time to warm
the durable cache. A per-page session cooldown prevents retry loops. Cold or failed Changes reads
must never assign “refresh and wait” work back to the user.

Results settlement follows the same rule: opening the authenticated Results surface schedules the
existing bounded, zero-paid-call measurement and reverification pass whenever work is due. This
safe maintenance is a product behavior, not an operator-mode feature. Manual proof mutations and
restore actions retain their independent protections. Registration failures must not advance a
throttle for work that never started.

Strict unused-code diagnostics are an audit signal, not deletion authority. Remove proven imports
and locals in bounded batches; review public parameters and algorithm inputs against all callers
before changing them. The 2026-07-16 baseline was 231 diagnostic lines across 113 source-tree files;
the first reviewed batch reduced it to 201 lines and 97 files.
The second reviewed batch examined algorithm-adjacent values rather than deleting by compiler
label, removed only proven residue, and reduced the output to 185 lines across 85 source-tree files.

### Production artifact boundary decision (2026-07-16)

Production server traces may contain compiled Next output, runtime dependencies, and the root
package manifest only. They must not package `.data`, backups, source, tests, docs, scripts,
migrations, Supabase development files, or temporary operator material. Hosted persistence is
Supabase; repository/workstation artifacts are neither runtime dependencies nor deployable data.
This boundary reduced the representative Vercel function from 14.02 MB to 2.18 MB and is pinned by
the `server-trace-local-state-boundary` architecture invariant.

### Identity
- **Name:** `beacon`, private, version 0.1.0
- **Framework:** Next.js 16.2.10, React 19.2.4, App Router
- **Persistence:** `.data/*.json` via `src/lib/persistence/json-store.ts` (comment: "NOT the long-term production architecture"); optional per-tenant roots `.data/tenants/{slug}/` when `BEACON_TENANT` is set (`src/lib/tenant.ts`)
- **Mode:** Single-user first; lightweight tenant isolation for early external users (env-selected slug). No auth/billing/teams in product rules unless explicitly requested.


---

## Dream-state convergence decision (active, 2026-07-13)

Do not build another producer, hidden packet, or parallel ranking system. The active architecture is
one tenant-explicit seam: `ResearchDossier -> UnifiedEntry -> PreparedMove`. It must converge GSC/GA4
signals, DataForSEO keyword and SERP evidence, top Google and AI-cited winner evidence, clone briefs,
factual sources, and existing learning/measurement state into the one allocator and one prepared
atomic move. The first slice reuses existing stores and threads the evidence currently displayed on
Today into the EvidencePacket and drafter; publishing remains operator-approved.

**Second slice implemented 2026-07-14:** graph-derived moves now receive the compact dossier from
the tenant-explicit cached research corpus. Material dossier evidence participates in the canonical
evidence hash; timestamp-only refreshes do not churn drafts. The drafter receives grounded SERP,
AI, keyword, competitor, and unanswered-question hints/references, while PreparedMove persists only
a compact evidence-source/count receipt. This preserves the decision above: no new producer, ranker,
page, button, cron, or publishing path.

**Third slice implemented 2026-07-14:** the final actionable Changes order now emits a compact
server-only `RankedUnifiedEntry` handoff. Allocator-only AEO, SERP-steal, and keyword gaps are adapted
into the existing EvidencePacket/PreparedMove path with exact instructions, competitor/fanout seeds,
ResearchDossier convergence, and measured-demand provenance; graph-backed worklist entries reuse
their canonical packets. Preparation preserves this final order instead of re-sorting. The handoff is
removed from the client payload, and no new surface, producer, scheduler, ranker, or publish path was
introduced. Remaining proof is operational: authenticate, run one real visit cycle, and inspect a
real allocator-only winner end to end.

**Fourth slice implemented 2026-07-14:** both winner-research lanes now cross the convergence seam
without data loss. Native AI cited-page teardown persists cited URLs/counts, exact questions,
fanouts, and multi-page structural consensus into the unified allocator and ResearchDossier. The
exact final Changes order receives one guarded/cache-first live Google read per top query, up to two
on-topic organic winners are torn down through the existing polite cache, and those facts enter the
EvidencePacket before drafting. New-page moves use the same check and stop before LLM spend on a
Google reject. This preserves one ranker and one prepared-move path; no new page, button, cron, or
publishing path exists. Remaining proof is operational and authenticated, not another architecture
slice.

**Fifth slice implemented 2026-07-14:** final candidate demand now closes inside the same visit-run
before the allocator's one final pass. Beacon prioritizes native AEO gaps, then SERP steals, then
graph move labels; excludes fresh exact cached demand; and sends at most 25 missing queries through
one existing guarded DataForSEO keyword-volume batch. Exact volume is attached across all allocator
lanes and may only break an otherwise-equal tie when both entries are honestly unsized. It does not
create expected clicks, override a sized opportunity, or introduce another formula/ranker. The
receipt exposes checked terms. The remaining proof is one authenticated hosted tenant run showing
the receipt and allocator-only winner through PreparedMove.

**Sixth slice implemented 2026-07-14:** ordinary navigation is now the repair surface. The existing
post-response visit cycle detects an abandoned weekly page-factory receipt and idempotently retries
or reconciles the tenant/week batch; no control, customer script, environment ceremony, or new cron
was introduced. Research depth is deliberately two-dimensional: up to 500 ranked keywords for each
selected exact winning page and, independently, the provider's 1,000-row per-call related-keyword
maximum for each selected final topic seed. Full responses are cached for 30 days behind the shared
spend gauntlet, while compact rows are promoted into the unified keyword library and dossier so the
paid corpus is reused. Winner structure becomes an observed content blueprint, source candidates
must survive the existing verification gate, unrelated fanout is suppressed, obvious topic siblings
merge, and redirects require an exact safe source URL. The remaining proof is one normal signed-in
Iranopedia visit followed by a refresh and inspection of the resulting top move.

**Authenticated-production correction implemented 2026-07-14:** autonomous work is a bounded,
continuable product state, not one enormous post-response promise. A visit attempt receives a
terminal receipt by 210 seconds; a partial pass resumes through the producers' caches after a short
cooldown, so the header cannot remain `running` indefinitely. Weekly page recovery is subordinate
to the primary research brain and is deliberately one brief without the full-page walker. New-page
source completion now runs automatically for up to five candidates using the exact pages already
returned by the paid SERP read plus the hydrated tenant authority allowlist. Same-request GSC page
aggregation is memoized to reduce statement-timeout instability. `/today` is a supported alias for
canonical Today, and an automatically repaired scheduler receipt is kept out of the red customer
alarm because it is neither operator-actionable nor a Google-data trust failure.

**Instant-autonomy decision, 2026-07-15:** research freshness and product availability are separate
contracts. Today and Changes always serve the last complete tenant-scoped snapshot; a mutation marks
that snapshot stale but never deletes it, and a replacement becomes visible only after the full new
surface is built. The autonomous runner must publish a usable cached-evidence surface before slow or
paid enrichment. Provider latency, a partial pass, or a continuation deadline may delay deeper
evidence, but may not turn normal navigation into a waiting ritual or erase the operator's usable
ranking. Customer instructions must never ask for timed waits or double refreshes to make Beacon work.

**P0 tenant-isolation decision, 2026-07-14:** every background or post-response builder that begins
with an explicit tenant must keep that tenant explicit through every nested recommendation and
research read. Request-ambient or process-default tenant selection is forbidden inside that graph.
Persisted recommendation surfaces must carry tenant identity and fail closed on missing or
mismatched identity; absolute edit targets receive a final owned-domain check before display. This
decision follows authenticated evidence of an Iranopedia Changes snapshot built from Ritz ambient
dependencies. It is a correctness boundary for the connected brain, not optional multi-tenant SaaS
scope, and it must remain intact before further autonomous proof is accepted.

**Customer-operation boundary, 2026-07-14:** the connected brain is judged through the normal
product journey: Today explains current state, Changes holds the one ranked worklist, Results shows
movement, and Activity shows what Beacon did. Filesystem reports, CLI scripts, environment setup,
feature flags, internal taxonomy, and alternative allocator dumps are engineering evidence, not
customer work. Old diagnostic URLs must return a signed-in user to the corresponding canonical
surface rather than teaching them to operate Beacon's implementation.

---

**Autonomous-ready customer-release decision, 2026-07-15:** a usable customer state is one atomic,
tenant-scoped release shared by Today, Changes, and New Pages. Producers may update their own caches
independently, but customer pages adopt a new version only after the whole release is assembled.
Normal navigation automatically prepares the first five ranked moves through the existing guarded
PreparedMove path; a CMS connection is never a prerequisite for copy-ready work. The intelligence
pipeline checkpoints dependency-ordered stages and stops at the first failed stage so resumption is
truthful and does not build downstream claims on missing evidence. This adds no customer control,
cron, publishing permission, or render-time paid call.

**Ready and result-compression decision, 2026-07-17:** To do is ranked evidence, not a promise that
an edit is publishable. Ready is reserved for exact copy or an exact safe redirect map that passed
the existing evidence and quality gates; a zero count must never imply a guaranteed draft is about
to appear. Background progress may show only durable completed pipeline stages, never invented time
remaining. Results is an answer surface, not a second worklist: lead with the evidence clock and the
nearest reads, keep later measuring rows accessible but collapsed, and place manual fallback paths
after the normal tracked journey.

**Compound-action boundary, 2026-07-17:** simultaneous edits cannot be causally separated from one
page-level outcome. Same-page edits shipped on the same date are one intentional package with a
stable sorted combo identity. Results may report the package outcome but must not credit or train
any member lever. A later edit inside the measurement window is accidental overlap and remains
quarantined. A future combo prior may learn only from repeated calibrated outcomes for that exact
package identity; it may never back-propagate the package result into its ingredients.

**Competitor-evidence tenant boundary, 2026-07-17:** competitor teardown evidence is owned by an
explicit tenant at every layer, including cache merge/write operations. Request context may resolve
the tenant once at a customer-facing boundary, but background research, final-ranked SERP teardown,
keyword-gap work, retrieval indexing, graph compilation, diagnostics, and downstream learning must
pass that ID through directly. An empty tenant fails closed; an ambient process default may never
select a different tenant's competitor cache.

**Canonical change-result boundary, 2026-07-17:** Results/proof-gsc is the only customer-facing
measurement truth. A raw changelog deep link may resolve identity and navigation, but it may not
recompute or present a parallel verdict. Page + ship date links changelog rows to proof records;
same-page same-date edits therefore resolve to the same compound package. A historical row with no
proof record lands on Results without an outcome claim.

**Repeated-look execution boundary, 2026-07-17:** a predeclared proof run appends one immutable
read per window and computation version. The 28-day read remains the only primary decision; day 56
may only demote a win that failed to hold, and day 84 is context-only. A later pass must reuse the
first-written day-56 decision rather than recompute history into a different answer. Until a
certified 56-day placebo history exists, any demotion is labeled provisional and no long-horizon
read may release or bypass the calibration quarantine.

**Keyword-to-action boundary, 2026-07-17:** cached keyword research is useful only when it changes
the canonical move's exact page plan. GSC queries, DataForSEO demand/related-keyword/difficulty
caches, and AI fan-out questions merge into one intent-gated portfolio. That portfolio may choose
the title target, supporting sections, FAQ answers, and adjacent topics that need their own page;
it may not stuff an off-topic or wrong-intent term into the current page. Customer renders read
the cache once, never invoke a paid producer, and never create a second recommendation ranker.

**Citation-intelligence convergence boundary, 2026-07-17:** quoted-sentence patterns, answer
drift, and second-order cited sources are background-derived evidence for the canonical move
dossier, not independent customer worklists or ranking engines. The autonomous knowledge stage
computes them from existing tenant data in parallel and persists one tenant-explicit snapshot.
Repeated-source strength must preserve the stored aggregate citation count. A second-order URL may
be used as a source/distribution lead, never as automatic proof of a factual claim or permission to
send outreach.

**Evidence-depth convergence boundary, 2026-07-17:** Clarity behavior, citation-backed competitor
forensics, and AI fanout quality converge before drafting in the same ResearchDossier. Behavior may
prescribe a fix only above deterministic session/rate floors; competitor gaps require a captured
page plus cited prompts; fanouts must pass move relevance before they can widen keyword matching,
with multi-source corroboration tracked separately. None creates a parallel ranker or customer UI.

**Retired-runtime boundary, 2026-07-17:** unreachable or explicit-failure runtime surfaces with zero
production importers leave compilation, but their source is preserved as non-compiled archive text
until permanent deletion is explicitly approved. Customer redirects and the implemented provider
set receive architecture pins. A disabled registry entry is not considered dead when a live
dispatcher still requires it for exhaustive type/runtime mapping.

**Results presentation boundary, 2026-07-17:** the route owns request context, bounded reads,
measurement assembly, and compound grouping; proof-card rendering stays synchronous and cannot
read persistence or request state. Simultaneous same-page changes remain one compound learning
package, and presentation code may never assign the package result to an individual lever.

---

## FUTURE IDEAS (not in current execution plan)

These are ideas, experiments, and dream-state features that are NOT in the active phases. They live here so they are never lost. Move to `NEXT_PHASE_EXECUTION_PLAN.md` only when they become active work.

### V1+ Ideas

- **Dark mode** — premium feel improvement (currently light-only)
- **PDF export** — weekly proof summary for clients/stakeholders (Phase 31 gap)
- **Notification badge queue** — real-time alerts system (Phase 31 gap)
- **Geo heat map Stage-2 UI** — visual geographic coverage (Phase 31 gap, data shape exists)
- **Onboarding guided tour** — step-by-step first-run experience beyond setup wizard
- **Playwright E2E tests** — browser-level route smoke testing
- **Module-cache invalidation** — TTL or per-request initialization for production data freshness
- **Profound-native ingestion (2026-04-12 prep)** — API → normalize → **Supabase** with idempotent upserts + source/run tags; product routes keep reading the same domain contracts. Readiness audit: `docs/NATIVE_INGESTION_READINESS_AUDIT.md`. CSV batch remains the bridge; **workbook import removed** from the app; **`writeLegacyBridge`** now calls **`syncResults` / `syncChangelogEntries` / `syncImportRuns`** when dual-write is on so the Profound path is not file-only.

### Post-V1 Ideas

- **Multi-model AI sampling** — native Perplexity/ChatGPT/GAIO querying (client exists, not wired to prod)
- **Revenue bridge** — calls, forms, LSA, GBP actions linked to visibility changes (Tier 2.1)
- **Weekly export / proof summary** — automated PDF/deck for clients (Tier 2.2)
- **Competitive attack system** — one-click countermove strategies (Tier 2.3)
- **Assignment + ownership model** — team workflow with snooze/delegate
- **Email/SMS/Slack digest** — push notifications for morning briefing
- **Mobile-optimized view** — job-site 60-second triage
- **Auth + billing** — multi-tenant SaaS (currently single-user, filesystem isolation only)
- **Agency multi-tenant** — proper RLS, per-client dashboards, white-label
- **Content syndication tracking** — which external platforms drive AI citations
- **Adversarial stress testing** — brand defense prompt testing (scaffold exists)
- **What-if simulator** — outcome prediction from action types (scaffold exists)
- **Conversion path tracking** — prompt → answer → citation → visit → conversion (scaffold exists, needs analytics integration)

### Experimental / Dream State

- **Founder authority tracking** — person-entity mentions in AI answers
- **Training data pipeline assessment** — content visibility channel scoring
- **Citation genealogy** — trace source ancestry of AI citations (module exists)
- **Prompt mining** — discover new prompts from competitor citations
- **Real-time competitive monitoring** — continuous competitor citation tracking
- **AI content optimization suggestions** — structure improvements for better AI pickup

---

## Archived history

Everything that used to sit between "Current Repo Truth" and this line, the target-architecture
matrix, the domain-model/systems reference (section 4-16), the Phase 0.5 persistence audit, Phase
1A-13, the 2026-04-09 pricing table (superseded by the current ladder in
`docs/OPERATOR_PRODUCT_SPEC_2026-07-09.md`), Master Roadmap Phases 14-23 (including the
not-yet-authorized Auth/Billing/Agency phases), the Shell A-H overhaul log, the full "Intelligence
Expansion" cluster plan, the Tiered nano-phase ladder (1.1a-2.3h), and the 2026-04-11 audit
summary, moved verbatim to `docs/archive/MASTER_EXECUTION_PLAN_HISTORY.md` on 2026-07-21. Nothing
was lost; it was reference and completed-phase chronology, not a live decision.
