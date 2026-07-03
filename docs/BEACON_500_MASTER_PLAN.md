# BEACON MASTER PLAN v2 (rebuilt 2026-07-02, operator verdict)

**This file supersedes the v1 610-item list.** 86 v1 items shipped (see git history and
docs/VERIFICATION_LOG.md; the full v1 text lives at commit 77ac7252 and earlier). The remaining 524
were audited item by item: ~18 already shipped in substance, ~45 were duplicates or competing
implementations of the same system, ~20 conflicted with premium-single-user-internal-first, ~65
were design polish that can wait, 2 were speculative AI-file tactics Google says are unnecessary.
What remains below is roughly 200 real initiatives: a Top 50 head (the operator's verdict, kept in
his order) plus a Tier 0 survival track and 24 consolidated packs.

**The priority function (locked):** every move must be high impact, and the list is ordered so
that at ANY stopping point the app is maximally able to stand on its own for a non-technical solo
operator with no developers. Reliability and truthfulness outrank cleverness. Google's own
guidance says AI visibility rides on crawlability, indexing, internal links, textual content, page
experience, and people-first quality, with no special AI markup required, so correctness and
content quality outrank AEO accessories.

**Execution rule:** work the FINAL RANKED EXECUTION LIST below in order. Tick items here, commit
naming them, push branch + main, smoke prod. Full suite every 10-12 items. Ground-truth every
item on real tenant data.

---

## FINAL RANKED EXECUTION LIST (2026-07-03, operator directive: merge, dedupe, rank, execute all)

Merged from: every unfinished Top-50/T0/D/UX/pack item below, the pending session-task stragglers,
and the finished-product campaign follow-ups. Deduplicated (stragglers absorbed: task 73/183
superseded by FP1 snapshot-first + deadlines; 74/182 live inside T0e; 95 inside P6; 181 closed by
FP2/FP7 honesty fixes; 162 is operator-gated). Ranked by impact x confidence / effort, dependency
order, and the locked priority function (any stopping point leaves a solo operator maximally able
to stand alone), preferring highest-impact medium-effort work.

QUEUE (strict order; [G] = operator-gated, surface it and continue):
- [x] R1 (2026-07-03, COMPLETE with two root causes). Post-nightly receipts verification found and
      fixed the real story: (1) the Supabase instance was WEDGED for ~8h (every query died on
      statement timeout, even Supabase's own health checks took 14s); restarted via the management
      API, recovered. (2) THE CRONS COULD NEVER RUN: the cron route requires CRON_SECRET which was
      never set in Vercel, so all 8 scheduled jobs were refused by their own auth check since the
      check shipped. Secret generated + set in Production + redeployed; the sync then ran end to
      end (Iranopedia 4/4 sources synced; Ritz honestly failed on its 2 known token issues) and
      wrote the FIRST REAL RECEIPT to cron_runs (sync-connectors, 114s, ok:false marked honestly
      partial). Tomorrow's 2 AM run is the first scheduled unattended pass with working auth.
      preflight, uptime/DNS/SSL probes on the tenant site. Rides cron_runs. Effort M.
- [x] R3 (2026-07-03). T0b one-click recovery: every health card names the exact fix and deep-links it. Effort M.
- [x] R4 (2026-07-03). /results snapshot layer: apply the proven SWR surface-store pattern to the measurement
      ledger read (FP1's named follow-up) + reconcile the FP8 strip dollar sum with the scoreboard
      odometer (one rule, one comment). Effort M.
- [x] R5 (2026-07-03). N15+N16 learning depth: effect-size learning (beta-posterior shrinkage, recency half-life)
      + sustainable control pool (donor repair, median band). First real outcome data arrives
      tonight; this makes tomorrow smarter than today. Effort M each.
- [x] R6 (2026-07-03). N12 same-query experiment blocking (wire the N2 ownership registry + N14 interference
      graph into the planner as a hold; floors per N14 notes) + N46 opportunity expiration (stale
      SERPs, old evidence, seasonal windows leave the queue). Effort M.
- [x] R7 (2026-07-03). N39 production error monitoring with route/tenant/action context (T0 spine) + N40
      external API contract tests. Effort M.
- [x] R8 (2026-07-03). N5 information-gain gate + N28 scaled-content governor (the two laws that
      unfreeze the page factories) + N18 snippet-promise audit. N5: `src/domains/drafts/info-gain-gate.ts`
      hard-gates create_page Moves in load-graph (duplicate_of_serp drops/reclassifies with the honest
      sentence, thin_addition demotes below adds_something; unchecked = pinned byte-identical no-op) +
      post-brief check in the page-factory line. N28: `src/domains/push/factory-governor.ts` (weekly
      pace from shipped ledger + batch history, one-topic-one-page token rule, 10 percent monthly
      growth guard) wired into cluster-factory runs AND the weekly production line; refusals persist
      on the batch record with plain reasons. N18: `src/domains/recommendations/snippet-promise.ts`
      (4 checkable promise kinds vs first 200 words) fed as the `snippet_promise_gap` trigger, capped
      at 5. 52 new tests; graph snapshot schema bumped to v2.
- [x] R9 (2026-07-03). P3 tenant CTR curve (ONE implementation: fit from own GSC, retrain title scorer, pin the
      survivor) - feeds every forecast and title move. Effort M.
- [x] R10 (10a SHIPPED 2026-07-03: query panel, weekday baselines, early-decisive/futile, novelty decay, all
      computed-only feeding N10; 10b DONE 2026-07-03 worktree: distinct-query growth v1 151 `query-breadth.ts`
      reach-vs-depth on the win card, equivalence testing v1 289 `equivalence.ts` provenNeutral graded
      solid-for-learning distinct from inconclusive, FDR v1 291 `fdr-adjust.ts` pool-wide champagne-hold applied
      at the load-ledger choke point demoting too-close wins solid to decent, clean-window salvage v1 152
      `clean-window-salvage.ts` clean-days lift rendered under the weather caveat; alpha-spending v1 286 is
      honestly resolved by R10a's design - early looks are presentation-only and never close or shorten a
      window, so no error budget is ever spent early). P4 measurement rigor pack (fixed query panel,
      day-of-week baselines, adaptive windows, equivalence testing, FDR) - all feed N10's grade. Effort L,
      split into 2 slices.
- [x] R11 (2026-07-03, worktree). N30 demand-ranked question universe + N20 SERP-consensus study + N29
      snippet-capture extension (all extend shipped engines). Effort M. N30:
      src/domains/research/question-universe.ts (pure merge of GSC question-shaped queries + AI fanouts +
      tracked_prompts library + captured PAA into one ranked universe: demand x not-covered, N2 registry
      ownership, coverage checked against the owner page's stored extracts) + loader persisting the
      "question-universe" store (GLOBAL, Supabase-mirrored), rebuilt as an isolated fail-soft cron phase 2a-q;
      consumers: drafter seeding in precompute-drafts (byte-identical when empty, pinned), the self-hiding
      /prompts "Questions people ask that no one answers well" section, and top-3 universe questions on New
      Pages cards + their opening drafter. N20: consensusOf() in teardown-commonality.ts (3-of-5 rule,
      single-winner outliers named and never copied into briefs; brief majority floors hardened to 2 winners
      minimum) carried through CommonalityBrief.consensusSpec into both GapVerdict brief shapes. N29:
      src/domains/serp/snippet-capture.ts (rank 2-10 + competitor-owned answer box -> format-matched
      add_answer_block candidates through the existing trigger pipeline, capped 5, deduped against
      steal-lane cards by query, strong owners honestly low-confidence long shots).
- [ ] R12. T0e new-site golden path hardened (URL-first signup, wizard GSC connect + backfill,
      cold-start crawl past the 18-page cap, day-0 baselines, guided first win; absorbs tasks
      74/182). Effort L.
- [~] R13. N3 provenance graph SHIPPED 2026-07-03 (see the N3 entry below); N25 stale-fact
      detection + N26 fact propagation + N27 volatility deadlines ride the shipped substrate
      in the follow-up slice (volatilityClass + lastConfirmedAt + affectedPages + the conflict
      trigger are the designed seams). Effort M remaining.
- [~] R14. P1 trust receipts pack (receipts everywhere, see-the-math, /activity log, we-got-this-
      wrong recap). Effort L, split. R14a SHIPPED 2026-07-03 (slice 1 of 2): /activity unified
      audit stream (nav-reachable, composed from existing stores only, paged 50), append-only
      verdict_revisions at the measureRecord seam (+ jsonb column applied to beacon-main) rendered
      in the /results card expand, the "We got this wrong" recap below the /results bands, and
      the "Why not the others?" expander on the daily card (plan records now freeze the planner's
      own exclusions, capped 8). R14b takes the remaining P1 items (receipts everywhere +
      see-the-math sweep over items 91/173-177/204/214/334-339/390/405/463-464/523-525).
- [ ] R15. N4 behavior-verdict lane (GA4+Clarity on every ship) + N17 task-completion. Effort M.
- [ ] R16. P6 LLM engine pack (one gateway, schema registry, prompt versioning + regression
      harness, call cache; absorbs task 95). Effort L.
- [ ] R17. P2 GSC depth pack (split into 3 slices). Effort L.
- [ ] R18. N23 internal PageRank + P7 linking/content-depth levers. Effort L.
- [ ] R19. N24 evidence-based pruning/merging + N21/N22 rendered-crawl checks. Effort M.
- [ ] R20. D6 dynamic auto-mode (auto-prepare + publish counter; autopilot rails exist). Effort M.
- [ ] R21. N32 external-event ledger + N31 solar-calendar rollover + N44 topic objectives + N45
      dependency planner + N49 calibrated abstention. Effort M batch.
- [ ] R22. Safety/eval train: N33 benchmark, N34 ablation, N35 replay, N36 gold library, N37
      synthetic journey, N41 outbox/idempotency, N42 model-fallback benchmark, N43 cost breaker,
      N50 canary policies, T0d backups/rotation drill, T0f weekly QA sample. Effort L, sliced.
- [ ] R23. Remaining packs in plan order: P5, P8, P9, P10, P11, P12, P13, P14, P15, P16, P17,
      P19, P20, P21, P22, P23, P24 (P18 code health rides inside every slice, never standalone).
- [ ] R24. Campaign tail: /prompts detail SSR subject title, today-v2-working deep link, N13
      recrawl demotion in the shared band classifier, N47/N48 primary-source + expert-review
      lanes, forensic-repairs triage (task 209). Effort S/M batch.
- [G] Operator-gated (surfaced on /settings, never blocks the queue): Wix page mapping on
      /diagnostics/wix, BEACON_DIGEST_TO + RESEND_API_KEY, IndexNow key, GSC full backfill,
      revenue model config, DataForSEO cap raise.

T0a is DONE (docs/OWNERS_MANUAL.md exists). D5 is covered by shipped atomic change packs + the
factory gates shipped in R8 (N5 + N28 live; factories unfrozen 2026-07-03). UX track complete.
FP campaign complete.

**Operator-journey rule (CLAUDE.md, mandatory):** no item is complete until its rendered surface
was walked as a real operator journey and the completion report quotes the actual rendered copy.
Integrated over bolted-on: reuse existing status words, counts, and sections; never ship raw
slugs, internal keys, jargon, or unexplained zeros. Judge performance on prod, never dev.

---

## FINISHED PRODUCT CAMPAIGN (2026-07-02 operator verdict; GOVERNS UNTIL DONE, jumps the line)

Operator, verbatim: "remember at all times biggest impact moves as possible... everything about
this app completely screams unfinished.. if i saw this current state as a consumer i would pay 0
dollars for this even this looks disgusting truly ... i see the vision though but we are far away
and idk if its more features or what its missing but there is a lot of things deeply missing kep
figuring it out."

12-agent diagnosis (9 surface roasts + design system + product shape + IA, 2026-07-02) answered
his question: **it is finish, not features.** Three root causes: (1) the app often does not paint
(blocking shell awaits, stranded Suspense pulse boxes, no timeouts); (2) it contradicts and
repeats itself (three different counts for one lifecycle stage, one fallback sentence stamped on
90+ of 136 worklist rows, duplicate rows and sections); (3) it is five products stapled together
(77 routes for 9 nav items, two color systems, 294 card class combos, three narrator voices).

The 10 moves, strictly ranked (kill list quotes live in the diagnosis run wf_b48c0a1f-301):
- [x] FP1 (2026-07-02, wave 1). Always-paint floor: no blocking awaits in the shell, 5s deadline + honest sentence on
      every section loader, snapshot-first reads reusing the existing SWR pattern. (WAVE 1)
- [x] FP2 (2026-07-02, wave 1). Worklist quality: kill the 90x stamped fallback sentence at the root, dedupe rows,
      fix the double-render + stray glyph, fix the contradicting cannibalization line. (WAVE 1)
- [x] FP3 (2026-07-02, wave 3). One lifecycle-count loader (domains/changes/lifecycle-counts.ts, one DECIDED/MEASURING/TONIGHT rule) consumed by Today, Changes, Results; the 16-vs-25 class of contradiction dead at the link source.
- [x] FP4 (2026-07-03, wave 4). Vocabulary + route collapse SHIPPED: /worklist is now a permanent
      308 redirect to /changes (the real ranked list lives there; the old /changes-to-Results stub
      died) and /proof 308-redirects to /results, both preserving query strings; every internal
      link, revalidatePath, palette entry, and shortcut retargeted (G C = Changes, G E = Results).
      Titles + breadcrumbs derive from the ONE route registry in src/lib/navigation.ts
      (routeCrumbFor, longest-prefix; no raw slug, no bare "Detail"; the "research / Detail" and
      "Settings / Detail" classes are dead), with detail pages pushing their real subject via
      <HeaderTitle/> (prompts/[id] shows the question, changes/[id] shows the change title,
      /page/... shows the path). Legacy sweep: /expansion deleted (zero inbound) + dead
      moves-worklist-client.tsx; bookmark shims (/moves /opportunities /experiments
      /recommendations index) retargeted to /changes views; /review /briefs /local /observations
      /settings/history /topics/opportunity /competitors/[id] verified live-linked and kept.
      Settings merged onto ONE registry (settings-sections.ts) feeding both the tab strip and the
      /settings index (labels agree with the sidebar: Connections); the sidebar group heading
      "Settings" above the "Settings" item removed. Rider: Ask citation chips dedupe by
      destination and render human names via surfaceNameFor (one "Results" chip, never seven
      "/proof"), and plainChangeKind() kills edit_meta/add_answer_block leaks in Ask answers.
- [x] FP5 (2026-07-02, wave 3). One home per job: tonight's cards on Today only (worklist shows one chip), New Pages board once on the worklist (Today shows one line), measuring lives on Results, /proof double-stack merged behind 'See the raw change log'; singular/plural topic twins deduped via the ownership-registry tokens.
- [~] FP6 (6a wave 1; 6b waves 2-3: today-moves-card 597 to 69, changes-list-client 340 to 34, daily-experiments-section 280 to 0, today-newpages-card 144 to 22 incl. the dark-broken board fix; ratchet 2884 to 1342 across waves 2-4; war-room-sections done 187 to 19, only per-teammate identity colors remain by design). Design system: Card, Pill (5 status intents), SectionHeader, EmptyState, PageShell on
      the existing tokens + raw-palette-count ratchet guard (6a, WAVE 1); then migrate the five
      worst files (today-moves-card 482 raw classes, changes-list-client 225,
      daily-experiments-section, today-newpages-card, war-room-sections) (6b). Rider: one
      narrator voice, first person, via plain-language conventions.
- [x] FP7 (2026-07-02, wave 1). Hide dead-data UI: Difficulty column (0/298), empty related-questions chrome, cron
      panel collapses to one line until it has a real receipt, zero-signal keyword rows behind an
      expander, keywords hero synthesis line. (WAVE 1)
- [x] FP8 (2026-07-03, wave 4). Cumulative outcome ledger on Today + Results (one strip: shipped, wins, measured click lift/mo, GA4-backed dollar estimate only when real, honest first-verdict date when nothing matured); 12-chip proof cards collapsed to one line + 'Show the full read'.
- [x] FP9 (2026-07-02, wave 1, with FP2). Curate the queue: top 3 visually dominant, list capped ~20 behind an expander,
      Ready 0 explained in a real sentence. (WAVE 1, with FP2)
- [x] FP10 (10a wave 3; 10b wave 4: 'Who AI recommends instead of you' with real rows on /prompts, en.wikipedia.org 74 citations + steal-this move links; /competitors redirects to /prompts; debug console moved to /diagnostics/competitor-intel; nav Research = Keywords + AI questions). DONE.

NOT NOW (real but parked): MoveCard density refactor, connector brand icons, autopilot hydration
flash, first-session choreography + morning-brief email (single-user today), per-keyword bulk
actions, hand-fixing dark-mode classes (FP6 makes them free), blue Leaning-bad pill semantics.

WAVE 1 SHIPPED 2026-07-02: FP1 (shell paints instantly, / and /competitors close in 8s through a live Supabase 522 storm; the honest-delay sentence replaces stranded pulse boxes), FP2+FP9 (fallback stamp killed at the root, dedupe, top 3 + capped list), FP7, FP6a (primitives + 2884 raw-palette ratchet). WAVE 2 SHIPPED 2026-07-02: every page now closes (worklist 25s, keywords/connectors/ask 15s, proof 20s, measured live on the 522 fault path, declared boundaries == resolved on all five); empty-rebuild guard on the worklist SWR snapshot (an outage rebuild can never poison a real snapshot again; the current empty one self-heals on the first healthy rebuild); operator-only learning section no longer leaks to every viewer (un-awaited promise gate); FP6b three worst files migrated to tokens/primitives. WAVE 2: FP3+FP5 (one agent, shared files), FP6b
migration. WAVE 3: FP4, FP8, FP10, voice rider. N-track and packs resume after FP10.

---

## THE QUALITY CONSTITUTION (governs everything; each law is an enforceable gate)

1. **Believe:** Beacon may only assert a fact that has a source, a date, and a reliability grade.
   Facts age; stale facts are flagged, not repeated. Contradicting sources pause the claim.
2. **Recommend:** every recommendation carries evidence above a floor, a confidence, and a named
   downside. When evidence is insufficient Beacon says "I do not know enough yet" and declines
   (calibrated abstention). No recommendation may contradict the ownership registry.
3. **Publish:** nothing ships unless it adds information competitors do not have (information
   gain), passes factual entailment against the page's own sources, passes the spam-risk governor,
   and has a rollback payload. Page factories stay frozen until these gates exist.
4. **Measure:** no verdict before Google has recrawled the change; no verdict from contaminated
   comparisons; every verdict carries one reliability grade the operator can read. Verdicts are
   never rewritten silently.
5. **Learn:** only settled, reliability-graded outcomes train priors; effect sizes over binary
   wins; flip-flopping verdicts train nothing; every learning exclusion states its reason.

---

## TOP 50 (operator verdict, his order; source mapping + status annotated)

- [x] N1 (2026-07-02). **Unified opportunity allocator**: one ranked decision across optimize, create, link, prune, fix, promote by expected value, confidence, risk, effort - SHIPPED as DREAM SITE V1 item D4 (worktree, not yet merged). See the D4 entry below for the full build note. (absorbs v1 400 value-per-minute)
- [x] N2. **Query-to-page ownership registry**: enforced; future cannibalization mistakes become impossible. (NEW; absorbs v1 143 draft grounding, 242 mixed-intent split, 270/271 wrong-landing-page + canonical gates) - SHIPPED 2026-07-03 (worktree, not yet merged): `src/domains/ownership/registry.ts` (pure) + `registry-loader.ts` reduce gsc-cannibalization.ts (gsc_ranks) and intent-clusters.ts (serp_cluster) into one `resolveOwner()`; enforced additively at 3 choke points (create_page ownership gate superset in load-graph.ts, prepare-create-page-verdicts.ts spend skip, serp-steal-lane.ts disagreement flag), conflict surface folded into the existing intent_cluster_conflict trigger (no duplicate cards), one ask/fact-assembly.ts cite line. 66 new tests. Real Iranopedia data: 104/1122 queries resolved (9%), 36 named contender conflicts, a live reclassification confirmed absent from /worklist's New Pages board. Honest gap found live and spun off as a follow-up: a 4th create-candidate source (allocator/unified-list.ts's keyword-library lane) still needs wiring. See docs/VERIFICATION_LOG.md's 2026-07-03 N2 entry.
- [x] N3. **Claim-level provenance graph**: every factual claim linked to source, date, reliability, affected pages. (NEW; absorbs v1 89/90 clickable sources + source-age, 275 facts_to_verify, 310 multi-source claims) - SHIPPED 2026-07-03 (R13, worktree): pure `src/domains/provenance/claim-graph.ts` (ClaimRecord: stable id, subject tokens, number/date/definition value, rule-based source reliability (operator high, dated authoritative domains high, competitor medium, undated low), affectedPages, volatilityClass = the N27 seed, consistent/conflicting/unverified status with the materially-different rule: numbers > 5 percent or dates differ, never punctuation) + loader persisting the `claim-graph` store (GLOBAL, Supabase-mirrored, 500/tenant, highest-traffic pages first) rebuilt as isolated fail-soft cron phase 2a-r + ship-time registration from stage-change (a shipped draft's checked facts enter with their N8 correction evidence). Surfaces: per-claim source lines in the daily card's "How we know" ("From your /iran-flags page, confirmed Mar 2026."), the capped `claim_conflict` trigger ("Two of your pages disagree about the year Persepolis was built (515 BC on /persepolis, 518 BC on /iran-history). Pick one and I will keep them consistent." - the N26 seed; watch action, never auto-pushes), and /diagnostics/provenance. 66 new tests + pins at every consumer seam. See docs/VERIFICATION_LOG.md's R13 entry.
- [ ] N4. **GA4 + Clarity behavior-verdict lane**: engagement, scroll, frustration, conversion, traffic measured together on every ship. (NEW; absorbs v1 503 GA4 floors, 385 protect-revenue objection)
- [x] N5. **Information-gain gate**: every new page or section must contribute something competitors do not. (NEW; precondition for any factory) - SHIPPED 2026-07-03 (R8, worktree): pure `info-gain-gate.ts` (novel sections / novel facts / original assets vs the torn-down winners) wired as a HARD gate in load-graph's create-page pipeline + the page-factory production line; unchecked (no brief or no teardown evidence) is a pinned byte-identical no-op.
- [x] N6. **Intent classifier that vetoes the wrong lever** (v1 130; extend the shipped answer-intent classifier into a router veto) - SHIPPED 2026-07-02 (worktree, not yet merged): `src/domains/demand-graph/intent-veto.ts` wired into `move-router.ts`'s existing veto/downgrade machinery; 2 real vetoes on live Iranopedia data, 32 new tests. See `docs/VERIFICATION_LOG.md`.
- [x] N7. **SERP-overlap clustering so one page owns one intent** (v1 120; feeds N2) - SHIPPED 2026-07-02: intent-clusters.ts (union-find over stored SERP overlap) + conflict trigger; honest 7/300 SERP coverage today, grows with every paid SERP read.
- [x] N8. **Snapshot-grounded factual verification before publishing** (v1 147 entailment check; law 3) - SHIPPED 2026-07-02 (worktree, not yet merged): `src/domains/drafts/factual-entailment.ts` (pure numbers/entities/superlatives check) wired as an additive check into `draft-quality.ts` and as a publish-gate backstop in `stage-change.ts`'s `resolveMove`. Operator-corrected mid-build: the page is one grounding source, not the final word - a claim contradicting the page but backed by a dated `AuthoritativeFact` is an allowed CORRECTION (never blocks, may auto-publish with the source+date explanation); only an unsupported INVENTION (found nowhere) blocks. 92 new/updated tests. Ground truth on live Iranopedia data: 25 real recommended_edits checked, 6 blocked as genuine inventions, 0 corrections (no dated-facts source is wired into any caller yet - the mechanism is built and tested, not yet fed real data), 19 pass. See `docs/VERIFICATION_LOG.md`.
- [x] N9. **Pause recommendations when data sources contradict** (v1 162 cross-check; law 1) - SHIPPED 2026-07-02 (worktree, not yet merged): `src/domains/evidence/source-contradiction.ts` (3 deterministic rules, absence-never-fires) wired into `reviewRecommendation` as a new `paused_source_contradiction` decision, excluded from the nightly plan by the existing `passesDailyGate`; 4 real contradictions found live on Iranopedia, 37 new tests. See `docs/VERIFICATION_LOG.md`.
- [x] N10. **One verdict-reliability grade**: recrawl, completeness, contamination, controls, volatility, sample strength in one grade. (NEW; absorbs v1 290 coherence, 337 unreliable days, 379 completeness guard, 504 verdict stability) - SHIPPED 2026-07-03 (worktree, not yet merged): `src/domains/proof-gsc/verdict-reliability.ts` (pure) combines the SAME feeder outputs `measurement-maturity.ts` already computes (recrawl N11, contamination N13, weak comparison, weather/seasonal overlap, shared attribution) plus sufficiency numbers and an optional permutation-null read into one grade: "too early" / "shaky" / "decent" / "solid", each with plain-English reasons and a first-person sentence. `gradeAllowsLearning()` is a verified superset-safe proxy for `learningEligibility` (dedicated alignment test across 8 scenarios). Wired computed-only into `/proof`'s card (a neutral gray chip next to the badge + the sentence inside "See the math") and a one-line addition to `fact-assembly.ts`'s measurement facts. 32 new tests + 148 tests across every measurement-maturity/verdict-reliability importer confirm zero pins broke. Ground truth on the real 25-ship Iranopedia ledger: 9 "shaky" + 16 "too early", 0 "solid"/"decent" today (honest given N13's contamination backlog and N11's empty recrawl-inspection sweep); both untested-live grade paths are fully covered by the pure-function suite. See `docs/HANDOFF_VERIFIED_STATE.md`.
- [x] N11. **Recrawl-gated measurement clock** (v1 132+153+183 merged: measure only after Google recrawls) - SHIPPED 2026-07-02 + operator-corrected same day (worktree, not yet merged): `src/domains/proof-gsc/recrawl-clock.ts` (pure) + `attach-recrawl-clock.ts` wired into `measurement-maturity.ts`'s `recrawlPending`/`recrawlDaysBlind`/`recrawlConfirmedAt`. SPLIT CLOCK per operator correction: gates ONLY the Google-search verdict lane (SEARCH maturity capped at Waiting, direction neutralized, checkpoints count from the confirmed index crawl once known); GA4/Clarity/conversion reads keep their live_at clock and keep rendering (pinned by proof-split-clock.test.ts). Semantics locked: last_crawl_time = Google's INDEXED-version crawl, never a live inspection. Nightly assist in `auto-measure.ts` (bounded `gscUrlInspect` prioritization, no new cron). 127 targeted tests. Ground truth: all 25 real Iranopedia ships read blind today (0 `gsc_url_inspections` rows exist yet - the sweep is new). See `docs/HANDOFF_VERIFIED_STATE.md`.
- [x] N12. **Block concurrent experiments competing for the same queries** (v1 149; with N2) - SHIPPED
      2026-07-03 (worktree, not yet merged, R6): the query-overlap-only subset of N14's interference
      graph is now LIVE in the nightly planner (N14's full graph stays not-yet-flipped, unchanged).
      `computeQueryOverlapHoldsForLedger`/`toQueryOverlapHoldEntry` (interference-graph.ts) filter the
      composed graph to `query_overlap` edges only and build the planner's own first-person hold
      sentence. Two mechanisms, both additive: (1) OPEN-MEASUREMENT - `daily-experiment-planner.ts`
      gained an optional `queryOverlapHolds` param + new `"query_overlap_hold"` `ExcludedReason`,
      checked right after the N16 last-clean-donor check; (2) INTRA-BATCH - a new pass right after
      scoring/sorting (`candidateQuerySet`/`queriesOverlap`, reusing the SAME `MIN_QUERY_OVERLAP_JACCARD`
      + `MIN_QUERIES_FOR_OVERLAP_JUDGMENT` floors, never reimplemented) walks the score-ranked pool and
      holds any LATER candidate whose queries overlap an already-accepted one this pass, first-ranked
      wins. `DailyCandidate` gained an optional `relatedQueries` field (falls back to `[targetQuery]`
      when absent); `build-today-preview.ts` wires it from the existing `queriesByUrl` map (the page's
      real GSC top queries, already computed for the keyword-research brief - no new read) and builds
      the ledger-ship adapter from the SAME already-loaded ledger (`outcomeStateOf`/`measurementWindowOf`,
      no new store). Rendered hold sentences (exact, quoted): open-measurement -
      "I am holding this because it competes for the same searches as a change I am already measuring
      on /iran-flags/umayyad-caliphate-flag." - intra-batch -
      "I am holding this because it competes for the same searches as tonight's pick for
      /iran-animals/persian-cat." Honest floor preserved: a single shared query (either side below
      `MIN_QUERIES_FOR_OVERLAP_JUDGMENT`) never blocks, in BOTH mechanisms, pinned by dedicated tests -
      most real daily-experiment candidates carry exactly one target query today, so this is the
      expected, honest common case, not a bug. Byte-identical when the caller omits the new params or
      no overlap exists (pinned). 9 new interference-graph tests + 9 new planner tests. `npm run
      typecheck` clean project-wide; full `src/domains/experiments` + `src/domains/proof-gsc` suites
      (1123 tests) green; one pre-existing source-text pin (`effect-prior-surface-pins.test.ts`)
      updated honestly to match the new (still-correct) `planDailyExperiments({...})` call shape.
- [x] N13. **Detect and replace comparison pages edited mid-window** (v1 87+175 merged; contamination chip v1 391 rides along) - SHIPPED 2026-07-03 (worktree, not yet merged): `src/domains/proof-gsc/control-contamination.ts` (pure classifier: treated_by_us / content_changed / unknown / clean, honest on sparse scan coverage) + `attach-control-contamination.ts` (read-path join) wired into `measurement-maturity.ts`'s `controlContaminationFlagged`/`controlContaminationCaveat` (N10-bound seam) and the `/proof` card's visible caveat + "See the math". PROMOTION not re-selection (operator-corrected design): a contaminated control is replaced ONLY from that ship's own FROZEN donor pool (`control_donor_pool`, a new additive jsonb column persisted ONCE at ship time in `auto-record-on-ship.ts`, migration `migrations/2026-07-03_shipped_change_proof_control_donor_pool.sql` NOT yet applied) - never a fresh, post-ship-data-informed pick. 41 new tests. Ground truth on the real 25-ship Iranopedia ledger: all 25 ships have at least one contaminated control today (229 total; sparse page_snapshots coverage - 0 in-window scans - dominates as "unknown"); 7 real `treated_by_us` cases confirmed (`/cities`, `/funny-farsi-phrases` shipped 2026-06-20; `/iran-animals/asiatic-cheetah`, `/iranian-actors-actresses`, `/famous-iranian-comedians`, `/farsi-numbers`, `/famous-iranian-singers` shipped 2026-06-21, all used `/persian-male-names` as a control, which was itself treated 2026-06-22 inside their still-open windows) - this slips through the pre-existing `activeTreatmentPaths` guard because that guard only tracks `outcomeStateOf === "measuring"`, and `/persian-male-names`'s stored verdict already flipped to `inconclusive` at its 7-day checkpoint even though its 14/28-day windows are still open. All 25 ships predate `controlDonorPool` (0 swaps possible today, correctly, since no post-hoc substitute can be picked without post-ship data) - every one reads "no clean substitute available, reading with caution" honestly instead of a fabricated swap. Rendered on live dev `/proof` (tenant-iranopedia): the `/cities` card shows the amber caveat "A comparison page changed during measurement, so I am reading this result with caution." both inline and inside "See the math".
- [x] N14. **Full interference graph**: internal links, templates, sitewide changes, redirects, overlapping topics. (NEW; generalizes N12/N13) - SHIPPED 2026-07-03 (worktree, not yet merged): `src/domains/proof-gsc/interference-graph.ts` (pure) composes six edge sources into one graph per target ship - `linked_page_treated` (PageSnapshot.internal_links direct adjacency, both directions, plus a control-dependency source that reuses control-contamination.ts's own ship-date-in-window test rather than a live "measuring" check, so a control that already settled its own 7-day verdict but whose ship date still falls inside a dependent's window still counts - this is deliberately the exact gap N13's `activeTreatmentPaths` guard has), `same_template_family` (first-path-segment grouping, requires the other ship measuring or a real window overlap, never fires on family match alone), `sitewide_event` (algorithm-weather.ts's `overlappingShock` reused verbatim), `redirect_related` (honest no-op - no redirect store exists anywhere in the codebase; documented, not fabricated), `query_overlap` (intent-clusters.ts conflict clusters when SERP data exists, plus a ledger-native `targetQueries` Jaccard overlap that needs zero SERP spend, both floor-gated). Two consumers, both additive: (a) SELECTION TIME - `daily-experiment-planner.ts` gained an optional `interference` lookup param and a new `"interference_hold"` `ExcludedReason` with a `plainReason` sentence, checked in `planDailyExperiments`'s per-candidate loop right after `assessEligibility`, byte-identical when omitted; (b) READ TIME - `verdict-reliability.ts`'s `VerdictReliabilityInput` gained an optional `interferenceFlagged` boolean that demotes an otherwise-clean mature result to "shaky" with the reason "a linked or same-family page still measuring could bleed into this result", threaded through `gradeFromPresentation`'s new optional 4th param. Honest floors: `MIN_QUERY_OVERLAP_JACCARD` (1/3 of the smaller targetQueries set), `MIN_QUERIES_FOR_OVERLAP_JUDGMENT` (2, never a single shared query), same-family match alone never fires (requires measuring or window overlap), only DIRECT link adjacency counts (no transitive hops), redirects never fabricated from a bare HTTP-status finding. 43 new interference-graph tests + 5 new planner tests + 4 new verdict-reliability tests = 52 new; full proof-gsc + experiments suites (1071 tests) green. Ground truth on the real 25-ship Iranopedia ledger: 25/25 ships carry at least one significant edge, 302 edges total (181 `linked_page_treated` including 7 confirmed control-dependency edges reproducing the exact documented `/persian-male-names` 7-ship cluster from N13, 112 `same_template_family` mostly the iran-flags and iran-animals template families interlinking, 9 `sitewide_event` from the June 2026 Google spam update overlapping every still-open window). Rendered hold reason quoted from the real ledger via `scripts/ground-truth-interference-graph.ts`: "This page links to /finglish, which I shipped a change to on 2026-07-01 and am still measuring. 4 more interference signals also apply." Rendered N10 grade effect on the same real ship, isolating the new input alone: without it the grade reads "solid"; with it the grade flips to "shaky: a linked or same-family page still measuring could bleed into this result." NOT YET DONE: live wiring into `build-today-preview.ts`'s actual nightly `planDailyExperiments` call (today's real-data signal hits 100% of ships, which is too aggressive to flip live without an operator review pass first) and into the `/proof` card's `interferenceFlagged` read-time call (same reason - the mechanism is proven correct and tested, wiring it live is the natural next step).
- [x] N15 (2026-07-03, R5). **Learn from effect sizes, not binary wins** (v1 141; plus 142 beta-posterior shrinkage, 496 recency half-life)
- [x] N16 (2026-07-03, R5). **Sustainable control-pool strategy** for when good comparison pages get treated. (NEW; absorbs v1 199 donor repair, 200 median band, 211 synthetic control, 434 holdouts)
- [ ] N17. **User-task completion measurement**: did visitors find the answer they searched for? (NEW; rides N4)
- [x] N18. **Search-snippet promise audit**: does the page immediately fulfill what the title and description promised? (NEW) - SHIPPED 2026-07-03 (R8, worktree): `snippet-promise.ts` compares 4 checkable title/meta promises (cost, count/list, how-to, date) against the first 200 stored body words; `snippet_promise_gap` -> `update_intro` deterministic trigger, capped at 5, highest impressions first; pages with no stored body text honestly abstain (bounded scoped body read added for the egress-lean projections).
- [x] N19. **Store useful page content** so Beacon reasons about the actual body (v1 98 main-content excerpt; unblocks answer-alignment competitor side + passage coverage on synced snapshots) - DONE 2026-07-02, worktree not committed
- [x] N20 (2026-07-03, R11). **Study top 3 SERP winners consensus, not one outlier** (v1 99) - consensusOf() in teardown-commonality.ts: 3-of-5 rule, single-winner outliers named and pinned never to reach a brief; carried on CommonalityBrief.consensusSpec into both GapVerdict brief shapes.
- [ ] N21. **Real JavaScript-rendered technical crawl** (v1 110 On-Page API; capped, gauntleted)
- [ ] N22. **Verify important content in source AND rendered HTML** (v1 111 dual-fetch)
- [ ] N23. **Internal PageRank + click-depth intelligence** (v1 97+121 merged into one internal-authority engine; anchors from real queries v1 495)
- [ ] N24. **Evidence-based pruning, merging, retiring** (v1 113+241+100+215 merged: one content-lifecycle engine with the merge-and-redirect executor on the Wix Redirects API)
- [x] N25 (2026-07-03, R13b). **Sitewide stale-fact detection** (v1 102; law 1)
- [x] N26 (2026-07-03, R13b; plans surface on diagnostics, operator-approved per page, never auto-push by construction). **Fact propagation engine**: correct one fact once, update every page and schema reference. (NEW; rides N3+N25)
- [x] N27 (2026-07-03, R13b; 180d fast / 540d slow / static never, aged-year auto-fast). **Content-volatility classes** with different freshness deadlines for dates, populations, biographies, evergreen history. (NEW)
- [x] N28. **Scaled-content spam governor** before any factory expands (v1 101; law 3) - SHIPPED 2026-07-03 (R8, worktree): `factory-governor.ts` (max 5 new pages/week counting shipped ledger + batch history, N5 adds-something requirement, one-topic-one-page token subset rule, monthly growth under 10 percent of indexed pages) enforced in BOTH cluster-factory runs and the weekly page-factory cron; refused pages persist their plain reason on the batch card. Factories UNFROZEN as of this ship: N5 + N28 are live in the pipeline (N3 provenance still pending in R13 and governs the fact-sourcing side, not the factory gates).
- [x] N29 (2026-07-03, R11). **Featured-snippet capture + format-matched steal moves** (v1 109; EXTENDS the shipped feature-steal columns and spike hints, not a new engine) - snippet-capture.ts: rank 2-10 + competitor-owned answer box emits a format-matched add_answer_block candidate through the existing trigger pipeline, capped 5, deduped against steal-lane cards by query.
- [x] N30 (2026-07-03, R11). **Demand-ranked question universe** from GSC, PAA, AI fanouts, SERPs (v1 127+370 merged; feeds drafting and coverage) - research/question-universe.ts + nightly-persisted store; seeds the FAQ/answer-block drafters, the /prompts unanswered-questions section, and New Pages brief questions.
- [ ] N31. **Solar-calendar year-rollover engine** (v1 104; tenant-configured calendar awareness, english-first output)
- [ ] N32. **External-event ledger**: Google updates, outages, PR, social spikes, major site changes recorded automatically (NEW; absorbs v1 170 annotations; generalizes the shipped algorithm-weather)
- [ ] N33. **Blind Beacon-vs-human-expert benchmark** (NEW; scored recommendation face-off on real pages)
- [ ] N34. **Teammate ablation testing**: prove which specialists actually improve decisions (NEW; absorbs v1 161 veto paper trades)
- [ ] N35. **Historical policy replay before new planner logic ships** (NEW; absorbs v1 454 debate replay in CI, 315 shadow challenger)
- [ ] N36. **Gold-standard library**: real pages, evidence, correct decisions, unacceptable recommendations (NEW; absorbs v1 436 fixture corpus, 449 hermetic suite)
- [ ] N37. **Nightly synthetic journey**: plan through publish, verification, measurement on a fixture tenant (NEW)
- [x] N38. **Wix publishing canary** (v1 86; SHIPPED at 77ac7252: token probe + url-map check + dry run + honest fix line)
- [x] N39 (2026-07-03, R7). **Production error monitoring** with release, route, tenant, action context (NEW; the T0 spine; absorbs v1 376 LLM telemetry, 404 swallowError, 582 web-vitals beacon) - SHIPPED: `src/lib/obs/error-ledger.ts` (recordAppError, never-throws, 200-rows-per-tenant cap, Supabase-mirrored `app-errors` store with PGRST205 file-fallback) wired into cron-sync's per-phase catches + the /changes and /results SWR background-refresh catches + stage-in-wix / accept / approve-and-push action catches + the LLM draft gateway fail-closed path; operator surface at /diagnostics/errors (last 50 grouped by route+message) + the self-hiding >= 10-failures-in-24h spike line joining the existing Today machinery alert (error-spike.ts).
- [x] N40 (2026-07-03, R7). **External API contract tests**: detect silent Google, Wix, DataForSEO, GA4, LLM response changes (NEW; absorbs v1 308 boundary validation, 444 row schemas) - SHIPPED: `tests/contracts/*.contract.test.ts` (21 tests) parse checked-in fixtures of the real GSC searchanalytics/sites, GA4 runReport (traffic + name-mapped revenue), Wix collections/items/product-SEO, DataForSEO SERP (organic + AI Overview + snippet + PAA), and OpenAI structured-response bodies through the ACTUAL client parsers ($0, no live calls); plus the operator-only, double-gated live probe `scripts/contract-probe.ts` (BEACON_CONTRACT_PROBE=1, never CI).
- [ ] N41. **Transactional outbox + idempotency keys** for every publish, rollback, cron, paid side effect (NEW; absorbs v1 474 advisory locks, 473 resume cursors, 528 revision check)
- [ ] N42. **Model-fallback quality benchmark** so cheaper models cannot silently degrade output (NEW; absorbs v1 276 provider failover, 501 retry escalation, 146 task routing)
- [ ] N43. **Cross-vendor cost circuit breaker**: LLM, DataForSEO, crawl, polling under one governor (NEW; absorbs v1 472 spend velocity, 407 daily pacing, 419 per-class budgets, 279 envelopes, 453 one ledger primitive)
- [ ] N44. **Topic-level strategic objective**: balance non-brand traffic, citations, revenue, authority, risk per topic (NEW; N1 reads this)
- [ ] N45. **Recommendation dependency planner**: prerequisites before dependent changes (NEW; with N14)
- [x] N46. **Opportunity expiration**: stale SERPs, seasonal moves, old evidence leave the queue
      automatically (NEW; absorbs v1 164 veto expiry, 360 freshness chips, 468 aging) - SHIPPED
      2026-07-03 (worktree, not yet merged, R6). New pure `src/domains/changes/opportunity-expiry.ts`:
      `classifyOpportunityFreshness` takes whatever dated evidence a caller actually has
      (`EvidenceDate[]` - serp_verdict/competitor_teardown/gsc_window/seasonal_window/keyword_research/
      plan_batch, general-purpose, not tenant-specific) and returns fresh / aging (21d+) / expired
      (45d+, OR a seasonal window whose `windowPassedAt` already passed, checked first and unconditionally)
      + the exact rendered sentences ("evidence from 3 weeks ago", "my evidence for this is 6 weeks
      old"). NO evidence date at all (the honest common case for most rows today - see caveat below)
      classifies fresh with `daysSinceFreshest: null`, never a fabricated age. `summarizeExpiry` builds
      the expander sub-line ("M of these aged out; I will re-check their evidence before pitching them
      again."). Wired at TWO real seams: (1) PRESENTATION - `changes-data.ts`'s new
      `applyOpportunityFreshness`, called AFTER `dropBoardDuplicateNewPageRows` (dedupe/rank already
      done; this never re-ranks, only marks `CanonicalChange.freshness`/`agingChip` in place) using the
      ONE genuinely available date today, the accepted/preview plan's own `createdAt`, matched to rows
      via `sourceIds`. `changes-list-client.tsx`: an EXPIRED row stably sinks to the tail of the curated
      pool (never removed, never re-ranked among its peers) so it naturally falls into the SAME existing
      "N more lower-priority ideas" expander with the new honest sub-line rendered underneath (never a
      second expander); an AGING row gets a quiet inline chip next to its other meta chips. (2) PLANNER
      SKIP - `daily-experiment-planner.ts` gained an optional `DailyCandidate.evidenceFreshness` field
      + new `"evidence_expired"` `ExcludedReason`, checked right after the power/underpowered gate;
      `build-today-preview.ts` wires it from the SAME cached SERP-pattern read the keyword-research
      brief already uses (`readCachedSerpPatterns`, which carries no TTL of its own today - a real,
      previously-unchecked staleness gap this closes) - no new store, no new read. Never deletes
      anything; the nightly evidence refresh naturally re-freshes an expired row the next time it runs.
      **Honest caveat (documented, not fabricated):** every genuine evidence-fetch timestamp in this
      codebase (`KeywordDemand.fetchedAt`, `PreparedSerpVerdict.generatedAt`, `PeakCalendarSummaryRow.
      computed_at`) is stripped at the projection boundary before reaching `TodayMove`/`CanonicalChange`
      today, confirmed via direct research across `daily-evidence-brief.ts`, `action-pack/adapters.ts`,
      and `seasonality.ts` - so most `/changes` rows (the worklist-sourced majority, not today's plan)
      have no dated evidence threaded to this layer YET and are honestly left unclassified (fresh by
      the module's own contract, never a false expiry). The classifier fully and correctly implements
      the seasonal-window-passed rule (tested), but no per-row seasonal binding exists yet to feed it
      live - the natural next wiring step, not a gap in this item's own logic. 18 new opportunity-expiry
      tests + 7 new changes-data tests + 5 new planner tests. `npm run typecheck` clean project-wide;
      full targeted sweep (`src/domains/experiments`, `src/domains/proof-gsc`, `src/domains/changes`,
      `changes-data.test.ts`, `changes-list-client-ux3/session.test.ts`, full `tests/architecture`)
      5778 tests green (32 pre-existing skips, matching baseline).
- [ ] N47. **Primary-source acquisition planner**: interviews, datasets, expert quotes, surveys, original research (NEW; absorbs v1 261; the shipped dataset pages are its first output lane)
- [ ] N48. **Expert-review + disputed-fact workflow** for sensitive, historical, medical, contested claims (NEW; with N3)
- [ ] N49. **Calibrated abstention**: Beacon knows when evidence is insufficient and declines (NEW; law 2; absorbs v1 311 escalation rules, 202 thin_evidence objection)
- [ ] N50. **Canary rollout for new recommendation policies** before they hit every nightly batch (NEW; with N35)

---

## DREAM SITE V1 (OPERATOR DIRECTIVE 2026-07-02: NUMBER 1 PRIORITY, JUMPS THE ENTIRE LINE)

**The operator's own words, verbatim (the mission; do not reinterpret):**
"all i really need dream state is aeo native checker (thats our internal profound) then it
analyzes all of the recurring people on those lists, the pages recurring, where we are, arent
(EVERYTHING profound has including query fanouts), which are all literally free to scrape from the
prompt - i am ok w deleting all mentions and anything profound to start the aeo from scratch ---
but then our difference is we scrape the top 5 results for each prompt to see what they have in
common... take the best ideologies to either make our new page for new gap, or edit our current
page in the gap... alongside using query fanouts for this new content edits.. alongside doing
keyword research.. alongside everything else we can do ??? then 2) not only is it just the aeo
results scraping.. then we scrape by the keyword, competitors that are beating our keywords or
phrases in gsc, the serps, and then steal the best among the top 5 in the serps as well maybe
more -- so combined then combining all of these across everything we have.. i should have the
best list ever.. then in order to not be a copy paste wasteland.. we make everything edit wise
atomic so that we have max evidence for the edit. but for new pages it can be complete new page
based on all the data... and at all times everything should be working together.. the changes
should be in a constant loop of what changes worked why they didnt what we can do next time
continuously getting smarter.. the aeo seo are always one team sharing data with each other --
query fanouts being shared w keyword research being shared with both their scrapes -- ga4 has all
landing pages.. landing pages to money spent.. cart checkouts every key event.. money.. what
paths everything make the paths better conversion optimization.... then gsc for our actual
rankings --- i want to log on everyday.. do whatever number of changes i want to do.. it can be 1
it can be every single change on that list.. if its dynamic maybe you auto do it for me then tell
me to publish or something and keep a counter... or if its static im ok for testing for now for
me to do everything then mark it as edited and the app just double checks once i mark it
published or something... but once i make the edits then it dynamically goes to next best edit
and so on... or NEXT BEST OPPORTUNITY (and all opportunities shouldnt just be a guess of yea this
is 500k ppl at risk since u got 1k clicks of 501k impressions.. it should be a real smart formula
that guesses based on x % you can presume x improvement in x days or something and a constant
guessing. so maybe that can fund our learnings hypothesis. ask section can also just be an llm
tied internal model that helps me analyze that would be fucking sick if that can go through my
data and talk. THIS IS VERSION 1 DREAM SITE."

**Build translation (D-track; existing machinery reused, never rebuilt):**
- [x] D1 (2026-07-02). **AEO native engine as THE source, analysis layer SHIPPED:**
  `src/domains/ai-visibility/native-intel.ts` (pure) + `native-intel-loader.ts` (I/O, 1000-row
  paged read of prompt_answer_observations) compute recurring domains, recurring pages, a
  per-prompt per-engine we-are/we-are-not matrix with the real answer sentence when mentioned,
  and native question expansion (question-mark sentences pulled straight out of answer text, no
  LLM). Surfaced on `/prompts` as a self-hiding "Who AI keeps recommending" block
  (`native-intel-view.tsx`), honestly labeled "from my own checks of the AI engines," additive
  above the existing Profound-powered AiQuestionsView (not a replacement; Profound deletion
  stays a D1-followup, staged cutover). Native fanouts wired into `load-fanout-seeds.ts`
  (`mergeFanoutSources`, source-tagged "native" vs "profound", deduped by normalized question
  text) so every existing fanoutSeeds consumer (demand graph, evidence packets, keyword
  research, FAQ drafter) gets native follow-up questions for free, no call-site change.
  Ground-truthed live: one bounded 8-question poll through the runner's own gauntlet cost
  $0.5366 real (gemini $0.2966 + claude $0.24 DataForSEO, claude's calls all failed
  server-side but were still billed, chatgpt/perplexity used native keys at $0 marginal);
  wrote 24 real observations for tenant-iranopedia (3 of 4 engines answered; claude errored).
  Real result: 15 recurring domains (reddit.com/facebook.com/youtube.com/en.wikipedia.org lead),
  presence matrix 1 present / 7 absent, 0 native questions found (this poll's answer_excerpt
  truncates at 400 chars, before most answers reach a "?" - honest, not a bug; a fuller answer
  text field would raise this count). 38 new/updated tests (native-intel.ts 30, fanout-merge 5,
  summarize-fanouts 3), typecheck clean project-wide. Found + flagged as a separate follow-up
  task (not fixed here, out of D1's file scope): observation_runs writes silently fail on a
  tenant_id not-null constraint in the dual-write path.
- [x] D2 (2026-07-02). **Per-prompt top-5 cited-source scrape, SHIPPED:** the teardown target
  planner now consumes the native poll's cited pages too (`competitor-page-audit.ts`'s
  `planNativeCitedTargets`/`auditNativeCitedTargets`: up to 5 cited pages per prompt, deduped by
  domain, noise/aggregator domains skipped, 14d cache reused; additive, Profound-cited planning
  untouched). New `teardown-commonality.ts` (pure) extracts what winners share: consensus
  headings, answer shape, word-count band, schema types, opening pattern, and (when we own a
  matching page) `whatTheyAllHaveThatWeDont`. New `teardown-commonality-verdict.ts` (pure) routes
  each prompt to an atomic-edit brief (owned) or new-page commonality fields (unowned); briefs
  describe structure + facts to cover, never competitor prose, so the drafter still writes 100%
  original content. Wired as an isolated fail-soft `native-teardown` step in `warm-caches.ts`
  (`native-teardown-runner.ts`, capped at 10 prompts/night, $0 spend, same posture as
  displacement-check/serp-steal-lane). Ground-truthed live on the real 24-row native poll
  (8 prompts, 31 real competitor pages torn down, 6 new_page + 1 atomic_edit + 1 no_verdict
  verdicts); found + fixed 2 real bugs during ground-truth (UTM-decorated owned edit target,
  atomic-edit additions always empty because owned-page facts were never loaded) before calling
  it done. 68 new/updated tests, typecheck clean.
- [x] D3. **SEO mirror:** for GSC keywords/phrases where competitors beat us, read the SERP top 5
  and steal the best (SERP history + feature-steal + clone briefs BUILT; unify with D2 so both
  scrape lanes share one teardown library).
- [x] D4 (2026-07-02). **ONE combined best list, the unified allocator (= N1), SHIPPED:** new
  `src/domains/allocator/unified-list.ts` (pure) fuses every opportunity source that exists today
  into one ranked `UnifiedEntry`: (a) the worklist/canonical changes (buildCanonicalChanges'
  CanonicalChange[], which already carries GSC + Clarity friction (`fix_conversion_friction`) +
  internal-link moves (`add_internal_links`/`consolidate_pages`) through the ActionPack pipeline -
  read as ONE lane, not re-derived), (b) D2's native AEO gap verdicts, (c) D3's SERP steal briefs,
  (d) keyword-library rows with no owner page or ranking 11-20 (`selectKeywordLibraryGaps`) that no
  other lane already covers. Scoring (documented, deterministic, tested): `unifiedScore` = expected-
  value midpoint (or an honest small floor when unsized) x confidence x a +15%-per-extra-lane
  multi-lane-agreement boost x a risk penalty (low/medium/high = 1/0.85/0.6), with effort breaking
  ties within a value band; a held entry (blocked/quality-flagged, passed through from upstream
  gates, never re-derived) sinks near the bottom but is never dropped. `fuseByPage` merges lanes
  that target the SAME real page, unioning `sources[]` and taking the best confidence/risk/value
  across them (fusion only ever lifts, never demotes). Found and fixed a real gap while building
  this: D2's gap verdicts were computed nightly and discarded (`warm-caches.ts` only logged a
  summary) - added `gap_verdict` to `move-draft-store.ts` + persistence in
  `native-teardown-runner.ts` + `loadGapVerdictsForTenant`, the same store/read contract D3's steal
  briefs already use. New `src/domains/allocator/load-unified-list.ts`'s `fuseUnifiedList` is the
  I/O boundary; `changes-data.ts`'s `loadChangesView` calls it right after building lane (a), so
  `/worklist` (no new page - the list IS the allocator) renders D2/D3/keyword-library-born rows as
  first-class `CanonicalChange` rows with zero new UI (one small additive chip in
  `changes-list-client.tsx` renders the new optional `sources[]` field as "X + Y agree" when 2+
  lanes confirm the same page). Ground-truthed live on tenant-iranopedia real data (script +
  actual `/worklist` curl): today only lanes (a) and (d) have live data (D2/D3's nightly runners
  have not yet populated this tenant), so the "2+ lanes agree" boost has not fired yet - honest,
  not a bug; a real fused-multi-lane row will appear the first night native-teardown or the SERP-
  steal lane produces a verdict on a page the worklist also ranks. 34 new tests
  (`unified-list.test.ts`: per-lane normalization, fusion, ranking determinism, multi-lane boost,
  risk penalty, hold passthrough, worklist-seam rendering) + all pre-existing touched-domain tests
  (changes/demand-graph/serp/research, 131 total) still pass, typecheck clean. (this IS N1 the
  allocator; D4 = N1 pulled forward.)
- [ ] D5. **Atomic edits, full new pages:** every edit atomic for max evidence (BUILT); new pages
  complete from all the data, behind the coherence/ownership gates (UX0 shipped them).
- [x] D6 (2026-07-02). **The daily ritual loop, STATIC MODE SHIPPED:** new pure
  `src/domains/changes/session-flow.ts` (`findNextActionable`/`nextBestLine`/`noDeadEnd`) walks
  the SAME ranked+filtered list `strategy.ts` already produces for /worklist - never a second
  ranking. New `src/app/(shell)/worklist-session-strip.tsx` (`useWorklistSession` +
  `WorklistSessionBanner`) owns the client session: a same-day localStorage counter ("You have
  shipped N changes today") and a "Next best: <exactWhat>" banner with Open it/Dismiss.
  `today-moves-card.tsx`'s `MoveCard` gained an additive optional `onAction` prop (fires after
  ship/stage/snooze actually persists via the EXISTING `respondToRecommendation` action - no new
  writes) so `changes-list-client.tsx` can advance the session after ANY row action (done, the
  MoveCard's own snooze, or a new bare "Skip" button on rows with no open MoveCard, which reuses
  the same `respondToRecommendation(..., "deferred")` dismissal path). No dead ends: every `<Row>`
  render site wires `onAction`, the next-best row gets an emerald ring + auto-scroll
  (`scrollIntoView`), and the queue only ever reports "done" honestly (never a fabricated next
  item). Keyboard: native j/k move a focus ring between visible rows, enter opens the focused
  row's detail, d marks it done through the SAME `respondToRecommendation("accepted")` call
  `ship()` uses (silently no-ops with no matching move - never fakes a done state); all ignore
  typing targets and modified keystrokes. Today gained a server-truth `DailyCounterStrip`
  ("Today you shipped N changes. I am double-checking M of them.") reading two new pure
  `weekly-recap.ts` exports (`shippedToday`/`stillDoubleCheckingCount`, Pacific-calendar-day-keyed
  off the SAME ledger rows the header streak already loads) - self-hides on a day with nothing
  shipped, never localStorage. Ground-truthed live on Iranopedia: `loadChangesView()` returned 206
  real changes (196 actionable); a 5-step simulated walk advanced through 5 distinct real
  recommendations with correct "Next best" lines, and the no-dead-end invariant held both mid-walk
  and with every actionable row handled. The real ledger's most recent ship was 2026-06-30
  Pacific, so the Today strip correctly self-hid (honest zero, not a bug) rather than mark a new
  row and pollute proof data. 57 new tests (`session-flow.test.ts` 13, `weekly-recap.test.ts` +8,
  `worklist-session-strip.test.tsx` 10, `changes-list-client-session.test.ts` 11, plus existing
  suites re-verified), `npm run typecheck` clean, full `(shell)`+changes+proof-gsc vitest gate
  (1047 passed, 1 pre-existing skip). NOT yet built: dynamic mode (auto-prepare + publish
  counter) - static mode (operator marks each change themselves) is the whole D6 scope for now.
- [x] D7 (2026-07-02). **Honest opportunity math, math layer + data fields SHIPPED:** new
  `src/domains/forecast/opportunity-math.ts` (pure) - the ONE canonical `computeOpportunity()`
  entry point composing the tenant CTR curve (`ctrOpportunity90d`/`forecastRange` from
  pick-expectations.ts, reused not duplicated) + the bias-correction factor (item 27) + the
  empirical capture band (item 64) into `{lowPerMonth, highPerMonth, days, basis, hypothesisId}`.
  Honest fail path: no position/impressions -> "I do not have enough history to size this yet,"
  never a fabricated number. `computeOpportunityFromGap` gives legacy pre-computed-gap callers
  byte-identical range math immediately. New `hypothesis-log.ts` (additive GLOBAL + Supabase-
  mirrored store `opportunity-hypotheses`) captures every rendered forecast so a day-28 settle
  can grade it later - the render-time half of "every forecast funds a learnable hypothesis"
  (forecast-calibration-store.ts already grades at settle time). SWEPT the naive at-stake claims
  the operator called out by name: `build-canonical-changes.ts`'s `upside` (was raw
  `m.demand`/impressions, now opportunity-math's forecast midpoint) + `expectedOutcome` (now the
  honest basis sentence, with numeric twins `expectedOutcomeLow/High/Days` + `hypothesisId` added
  to `CanonicalChange`); `today-moves-data.ts` + `moves/moves-data.ts`'s `demandAtStake` headline
  stat (was a raw sum of demand-graph weight/GSC impressions - the literal "500k people at risk"
  pattern - now the sum of real forecast midpoints, honest-zero when history is thin); added
  `ActionPack.forecast` (nullable) computed in `action-pack/adapters.ts` from `gscDemand`, carried
  through dedupe/collapse merges. `changes-data.ts` now resolves the tenant's own correction
  factor + per-family capture band (forecast-calibration.ts, same machinery build-today-preview.ts
  already uses) and fire-and-forget captures every actionable row's hypothesis. Ground-truthed
  live on Iranopedia: the old top-10-by-demand sum claimed 280,713; the real CTR-curve math says
  ~11 clicks/month across those same 10 pages today (most already meet or beat their position's
  expected CTR, or have no live per-query GSC row for that exact URL - both honestly disclosed,
  never guessed). 66 new tests (opportunity-math 28, hypothesis-log 15, existing suites re-verified
  120+), typecheck clean. NOT yet wired: `build-daily-plan-record.ts`/`build-today-preview.ts`'s
  plan-pick path (already honest via buildPickExpectations, just not yet logging a hypothesis at
  render time), the `/moves` and Changes-list UI surfaces reading `ActionPack.forecast`/
  `CanonicalChange.expectedOutcomeLow/High` (data fields exist, client rendering is a UX-track
  follow-up), and new-page/create_page candidates (opportunity-math.ts handles the honest-gap case
  for these today by design - no position exists pre-launch - but a launched-page graduation path
  is not built).
- [x] D8. **Ask talks to ALL the data** (retrieval twin BUILT; coverage deepened 2026-07-02: native
  AEO intel, keyword library, cron/pipeline/publish health, proof-ledger reliability depth wired
  into fact-assembly; see HANDOFF for the 4 ground-truthed Q&A transcripts).
- [x] D9. **Full trace audit:** verify the last 20 hours of shipped work is real, wired, not faked;
  delete every dead row/dead code found; then continue down the list.

The N-track (Constitution) and UX-track continue INSIDE the D-track where they overlap (N1=D4,
UX3/UX4 render D6, UX0 gates D5). GA4 money-path depth (checkouts, key events, paths) rides D4/D7.

## UX VISION TRACK (operator verdict 2026-07-02: explore, not read; decided YES on all three vision calls)

The product must feel like a world of clickable OBJECTS (page, query, topic, change, competitor,
AI question), each opening a dossier, instead of one long generated report. Coolness comes from
exploration and responsiveness, not decoration. Data correctness comes BEFORE beauty: never make
a malformed recommendation prettier.

- [x] UX0 (2026-07-02). **Data-correctness prerequisites, DONE:** new-page generator corruption
  fixed at the root (superlative/quantifier words like "most" were false distinguishing tokens in
  `keyword-match.ts`, gluing unrelated topics via a shared noisy keyword; `canonical-create-page.ts`
  now also requires two candidates share their OWN token, not just a common noisy keyword) plus a
  new explicit `topic-coherence-gate.ts` (drops/suppresses incoherent members, wired into
  `load-graph.ts`'s create_page synthesis AND into Prepare-all as a second, direct check); a new
  `create-page-ownership-gate.ts` reclassifies/drops a create_page candidate the tenant is already
  AI-cited for (Persian Literature was pitched as missing while cited: now dropped/reclassified to
  edit_page); `clean-topic-label.ts` gained grammar-sanity (`isUnparseableLabel`, rejects a label
  trailing off on an orphan verb: "...Hear Cross" caught); new `dedupe-new-page-cards.ts` collapses
  reordered-duplicate topics to one card with one real number. Measuring-count unification: worklist
  now reads the SAME canonical proof-ledger verdict count Today reads (`measuringCountCanonical` in
  `changes-data.ts`), showing an honest "10 of 16" when the worklist is a subset. Impressions-vs-
  searches swept app-wide: fixed `changes-list-client.tsx` ("searches/mo at stake" -> "shown on
  Google/mo at stake"), `build-daily-candidates.ts`, `refresh-brief.ts`, `language-gaps.ts`, and the
  workbench striking-distance surface (`workbench-view.tsx` + `page-brief.ts`), all of which were
  GSC impressions mislabeled as "searches". Prepare-all reports "skipped N that failed my quality
  check" honestly. Ground-truthed live: 2 candidates suppressed, 4 trimmed, 10 ownership-dropped on
  real Iranopedia data; all 3 operator-found corrupted cards confirmed gone/reclassified on both a
  fresh probe and the live `/worklist` render. 507 new/updated tests, `npm run typecheck` clean, one
  pre-existing pinned-copy test fixed (`recommendation-intelligence/page-brief.test.ts` shared the
  same `page-brief.ts` module). 8 other pre-existing test failures found during the full-suite gate
  are unrelated (confirmed by import trace, not caused by this item; live in `proof-gsc`/other
  concurrently-owned trees or unrelated domains) - not fixed here, out of this item's scope.
- [x] UX1 (2026-07-02). **Universal Page Dossier backbone, DONE for every reachable surface:**
  /page/[...path] gained a content band (title/meta/H1/word count/freshness from page_snapshots,
  one new bounded point-read `loadPageContentSnapshot`) and a "Visit the live page" header link
  (best-known full URL: GSC's own canonical URL, then the current change/plan, then the most
  recent shipped-change record - no new I/O, just a precedence pick over loaders already in the
  composition). Dossier now covers: header + live link, clicks chart with ship markers, top
  queries, content, team reads (demand/friction/AI funnel/language gap), current
  move/plan pick, rewrite tool, history of shipped changes. Link-wired every reachable page-name
  surface through the shared `dossierHref` (Changes/worklist row titles, the 3 Page Surgeon
  diagnostics screens) on top of the 4 already wired earlier (MoveCard, daily card, Results
  ledger, war-room funnel) - 8 surfaces total. Confirmed NOT reachable from any nav or in-app
  link (skipped, not worth wiring): /pages (deliberately disabled placeholder route),
  /topics, /workbench (orphaned, zero inbound links app-wide). NOT built (would require new
  join/compute logic, out of scope for a read-only wire-up): internal links in/out (no
  linking-graph loader exists) and competitors-on-this-page's-topics (competitor audits are
  keyed by domain, not by page/topic, with no existing join). AI citations/questions already
  covered by the existing funnel band (crawled/cited/aiClicks counts + bottleneck sentence);
  a full per-prompt-text list would need new aggregation and was left alone.
- [x] UX2 (first slice, 2026-07-02). **Research hub with the Keywords library, Keywords slice
  DONE:** `/research/keywords` merges every cache Beacon has ever paid for into one row per
  keyword (searches/mo from DataForSEO, times-shown/clicks/position from GSC, difficulty,
  competitor owners from the keyword-gap store and live SERP history, related questions from
  People Also Ask history, spike/seasonal trend tags) with instant client-side sort, a text
  filter (keyboard `/`), tabs (All/You rank/Close to page 1/Not owned/Trending/Seasonal),
  expandable rows linking to the page dossier and a "plan a change" deep link into `/worklist`.
  Zero new paid calls - purely cache/DB reads. Nav: "Keywords" added to the Research group
  before AI questions. Loader: `src/domains/research/keyword-library.ts`. UI:
  `src/app/(shell)/research/keywords/page.tsx` + `keywords-table-client.tsx`. Verified live on
  Iranopedia: 298 keywords merged, 190 with real market volume. Remaining UX2 scope (Pages,
  Topics, Content roadmap sub-hubs) is not started.
- [x] UX3 (2026-07-02). **Changes as a dense inbox, done:** `/worklist`'s ChangesListClient rows
  were already one compact line (status dot via border+text, page/dossier link, the exact action,
  the honest D7 upside range or "not enough history", evidence chip, effort, status); this pass
  added the remaining four pieces. Split detail panel: a `selectedId` lifted to the list renders
  the exact same `RowDetailContent` (MoveCard + fallback) in a sticky right panel on lg+ screens
  without the list reflowing or losing scroll position; narrow screens keep the prior inline
  expansion (same content, same component, no duplication). Applied-batch collapse: changes with
  `selectedForToday` that reached verify/measuring/result (tonight's accepted plan, once it
  reaches shipping) collapse to one row ("Tonight's batch: N applied, all verified" or "M of N
  verified"), expandable to the individual receipts; only in the flat status views, "By goal" and
  "Tonight's 30 minutes" are untouched. ONE command: `prepareTonightsPlanAction` composes the
  existing enrich -> prepare -> improve-with-competitor-facts pipelines (each still capped/cached/
  fail-soft) behind a single "Prepare tonight's plan (takes a minute)" button; the granular
  buttons moved into a native `<details>` "More options" overflow, no new dependency. Strategy
  names in buyer language: Balanced -> "Best opportunities", Growth first -> "Fastest growth",
  Clean tests -> "Safest bets" (display-only; the Strategy union + ranking math untouched). Multi-
  select: a checkbox per row + a floating "N selected / Mark done / Skip" bar that runs the exact
  same per-row respondToRecommendation calls sequentially with honest "N of total" progress text.
  D6 (next-best advance, shipped counter, j/k/enter/d, Skip) verified unchanged: 134 tests across
  the D6 + new UX3 suites pass, including all pre-existing session-loop pins. Learning-always-on
  language and saved views were not part of this slice (Goal filter labels were already buyer
  language per the operator's scoping instruction; not touched).
- [x] UX4 (2026-07-02). **Today as a concise briefing, done:** teammate pills, applied-batch
  collapse, the measuring one-line strip, friction severity bars, and the AI funnel-with-clickable-
  stalled-stages were already shipped by the checkpoint + quick-UI waves and verified unchanged
  here (all pre-existing tests still green). This pass added the remaining pieces. Lead story:
  `src/domains/changes/lead-story.ts` (`selectLeadStory`, pure, 9 tests) picks ONE deterministic
  headline right after any broken-pipe alert - a landed verdict (won/lost) beats a fired alert,
  which beats tonight's top plan pick, which beats the day's biggest click mover - reusing only
  data the page already loaded (the ledger, `today.attention`, the daily plan, the 84-day click
  series); live on Iranopedia it reads "The change on /best-persian-restaurants did not work
  (shipped Jun 21). Here is what I learned." Chart tabs: `scoreboard-chart-tabs.tsx` wraps the
  existing Google chart in a client `ViewToggle` with AI visibility / Visitors / Value tabs fed
  from series the scoreboard section already loads (citations.daily, revenue-by-day); a tab with
  fewer than 2 points self-hides (Visitors has no day-series loader yet, so it never shows). Health
  four-state: `data-sources-strip.tsx` replaced the single "All data sources connected" claim with
  `summarizeDataSourceHealth`/`dataSourceHealthLine` (Connected / Healthy / Fresh / Has data),
  rendering e.g. "5 connected, 5 healthy." or "4 connected, 3 healthy, 1 needs attention." so it
  can never contradict an alert above it; the pinned test's old assertion was updated, not
  bypassed. Demand section split: `war-room-sections.tsx`'s "Demand you do not own yet" now groups
  its rows under three labeled mini-headers - "Searches moving this week" (spikes, seasonal,
  fading pages), "Research gaps" (keyword-research opportunities + "Heating up right now" trends),
  "Language gaps" - each cluster silent when it has nothing. Top-3 new pages: was already
  `limit={3}`; the footer link now reads "See all N in Changes" (was "See all N", matching the
  rest of Today's "View all in Changes" convention). Refresh in header: `RefreshMyDataButton` moved
  into `PageHeader`'s children slot (reading a shared `countConnectedDataSources` so the header and
  the strip never disagree); the strip below keeps Connect/Manage links only. Operator-journey
  curl against the real dev server confirmed every quoted string live on Iranopedia; one broken
  pin (`ops-pipeline-section.test.ts`'s literal `<PageHeader ... />` source match) was fixed for
  the new non-self-closing tag. 734 targeted tests pass, 1 pre-existing skip, typecheck clean.
- [x] UX5. **Legacy deletion sweep:** anything dead, orphaned, or superseded is deleted outright,
  not hidden (operator hard rule; extends P18). DONE 2026-07-02 (worktree, not committed): deleted
  the `/pages`, `/topics` (index), and `/workbench` routes outright (zero inbound links from
  anywhere reachable, confirmed by two independent audits) plus every route-exclusive component,
  action, loader, and test; kept `/topics/opportunity/[id]` (live via Settings -> Imported history)
  and the whole `src/domains/pages/` + `src/domains/recommendations/` domain layers (both massively
  shared, never route-exclusive). Found and deleted a second, larger wave of orphans the route audit
  surfaced: 4 whole Today components dead since the 2026-06-16 legacy-TodayClient deletion
  (`change-review.tsx`, `today-findings.tsx`, `today-do-next-card.tsx`, `today-visibility-snapshot.tsx`)
  and 12 more dead since the 2026-06-28 `today-v2-sections.tsx` deletion (`command-center.tsx` +
  its resolver `command-center-data.ts`'s dead half, `off-site-authority-tile.tsx`,
  `edit-lifecycle-tile.tsx`, `enrichment-v2.tsx` + `enrichment-badges.tsx` + `competitor-select.tsx`
  + `sparkline.tsx`, `implementation-queue.tsx`, `lifecycle-strip.tsx`, `morning-brief.tsx`,
  `poll-health-calm-banner.tsx`, `collapsible-section.tsx`, `stat-sparkline.tsx`,
  `today-metrics-disclosure.tsx`, `today-primary-action.tsx`, `top-pick-builder.ts`,
  `site-findings-labels.ts`) — each host deletion had left its dependents and their architecture
  contract tests stale for days to weeks; trimmed 9 architecture tests to their still-live pins and
  deleted 9 fully-dead ones outright, syncing `docs/ARCHITECTURE_INVARIANTS_CATALOG.md` per its own
  option-(a) precedent (row deleted, not marked retired, when the file is deleted outright). Also
  deleted: `recommendations-v2-working-rail.tsx` (dead `/recommendations?v2=1` layout that never
  shipped a caller), the fully-dead `domains/insight` State-of-the-Union chain (4 files) alongside
  the workbench-exclusive domain files, `gap-ledger.ts` + `today-competitor-line.ts` +
  `today-one-decision.ts` + `today-next-line.ts` (zero importers anywhere), `load-why-them.ts`
  (competitor-intel), the dead `BEACON_AUTO_PROMOTE_SCHEMA` flag (built, documented as "no scan-side
  wire-up shipped," never wired), and 67 orphaned one-off scratch scripts under `scripts/` (58 found
  by an independent `git grep`-verified pass + 9 more: a dead `.cjs` duplicate, 3 scripts a live doc
  already flagged for deletion, 2 debug throwaways a prior audit flagged, and a superseded
  `mock-next-cache-cli.cjs`/`_next-cache-shim.cjs` pair). Trimmed (not deleted) `builder-benchmark.ts`
  (dropped its dead `topNextMoves` field pointing at the deleted `/pages`) and `page-primary.ts` /
  `today-summary.ts` / `command-center-data.ts` (each kept a live type/export, dropped the dead
  function around it — same pattern as the legacy /today substrate: types can outlive the component
  that once used them because a v2 loader still narrows them for field shapes). Repointed the one
  live dead-end link (`today-newpages-card.tsx`'s "Plan this page" CTA) from `/pages` to
  `/worklist#new-pages`, matching the sibling pattern already used one line away. Net: 161 files
  deleted, 48 edited, roughly 28,300 net lines removed. `npm run typecheck` clean; full `npm run
  test` 18988 passed / 62 pre-existing skips / 1 pre-existing unrelated failure (inside the
  concurrent N14 agent's in-flight `war-room-sections.tsx` rewrite, confirmed zero diff from this
  sweep). Dev server curl: `/`, `/worklist`, `/proof` all 200; `/pages`, `/topics`, `/workbench` now
  correctly 404; `/recommendations` still 200 (redirects to `/worklist?status=ready`);
  `/topics/opportunity/test-id` still 200 (kept, live).

Sequencing: UX0 first (correctness), then UX1 (backbone), UX2 (Keywords), UX3, UX4, UX5
opportunistically. The Constitution head (N-items) continues interleaved; N2's ownership registry
and UX0 are the same fight.

## TIER 0 INTERLEAVE: FLY-AWAY SURVIVAL (may jump the queue; the operator must be able to run alone)

- [x] T0a (docs/OWNERS_MANUAL.md exists). **Owner's manual** (docs/OWNERS_MANUAL.md): the daily 20-minute ritual, weekly and monthly rituals, a screen guide, and the one-time setup checklist (map Wix collections, publish the Google OAuth app out of Testing mode, IndexNow key file, set BEACON_DIGEST_TO + RESEND_API_KEY, load full Search Console history, set the revenue model). Live findings to encode: the Wix token works but the page map is empty; google_gsc is already past its 7-day token window.
- [x] T0b (2026-07-03, R3). **One-click recovery for every known failure**: each health card names the exact fix and deep-links it (extends shipped connector health + canary; absorbs v1 187+227+350 verification-recovery merge, 527 auto-heal unmapped urls, 530 push retry, 354 schema-cache heal, 226 retry ladder).
- [x] T0c (2026-07-03, R2). **Operational deadman** (v1 194+355+362 merged): stalled-cron banner, env + cron-registration preflight, site uptime/DNS/SSL/domain-expiry probes. Rides the shipped cron_runs ledger.
- [ ] T0d. **Backups proven by restore drill** (v1 105) + credential encryption and rotation runbook (v1 247) + hack/cloaking sentinel (v1 106) + crawler citizenship (v1 480) + SSRF hardening (v1 249).
- [ ] T0e. **New-site golden path hardened** (v1 154, 155, 156, 157, 158, 212, 296, 298, 383, 505, 508, 509, 577 consolidated): URL-first signup, GSC connect in wizard with backfill, background cold-start crawl past the 18-page cap, day-0 SERP + AI baselines, first-audit scorecard, guided first win, re-read-my-site action, honest unreachable-site failures, rescue stalled signups. This is "grow any website I want" made real.
- [ ] T0f. **Weekly editorial QA sample vs autonomy** (v1 481) + operator-override audits (v1 274): the human spot-check lane that keeps trust honest.

---

## CONSOLIDATED PACKS (after the head; each pack is one slice-sized initiative, dedup applied)

- [ ] P1. **Trust receipts pack** (v1 91, 173, 174, 176, 177, 204, 214, 334, 336, 338, 339, 390, 405, 463, 464, 523, 524, 525): one-line receipts everywhere, verdict revision history, why-not-in-plan inspector, named controls on charts, see-the-math, spend-to-outcome joins, /activity audit log, CSV export, we-got-this-wrong recap section, threshold registry in plain words.
- [ ] P2. **GSC depth pack** (v1 136, 137, 138, 195, 264, 265, 266, 267, 268, 428, 492, 491+493 merged): searchAppearance, budgeted indexation sweep, brand split, ingestion-gap classification, fresh-data lane, device grain, striking-distance portfolio headline, back-of-results register, country grain, footprint registry, anonymized-query gap, Discover probe.
- [x] P3 (2026-07-03, R9; four rival curves consolidated to one tenant-fittable module + bounded title-scorer retrain). **Tenant CTR curve** (v1 131+140+369+384+273 merged into ONE implementation): fit from own GSC data, retrain the title scorer from settled tests, pin the survivor with tests.
- [ ] P4. **Measurement rigor pack** (v1 150, 151, 152, 285, 286, 288, 289, 291, 378): fixed query panel, distinct-query growth, day-of-week baselines, adaptive windows, alpha-spending, equivalence testing, FDR control, clean-window salvage, novelty-decay flags. All feed N10's grade.
- [ ] P5. **Team deliberation pack** (v1 163, 165, 166, 167, 203, 231+314 merged, 309, 312, 313, 386, 387, 455): quorum rules, control vetting, exploration slot, second round, persisted full decisions, devil's advocate, age-decayed confidence, falsifiers with auto-retract, second pass on big bets, debate-derived multiplier, agreement score, coverage ratchet.
- [ ] P6. **LLM engine pack** (v1 234+284 merged, 144, 145, 148, 277, 278, 280, 281, 282, 283, 375, 377, 403, 432, 499, 500, 502): one gateway with a zod schema registry, brand-voice card, loss-aware redraft, prompt versioning + regression harness, batch API, labeling pass, self-critique grader, call cache, token-true billing, numeric repair, tool-calling drafter, calibrated self-confidence, de-templating guard, best-of-2, injection sanitization.
- [ ] P7. **Internal linking + content depth levers** (v1 95, 96, 112, 244, 409, 411, 412, 564): entity auto-interlink, missing-H2 drafts, term-coverage grade, hub pages, outbound authority citations, near-duplicate detection, boilerplate guard, FAQ JSON-LD dedupe.
- [ ] P8. **AEO defense pack** (v1 116, 117, 190, 191+225 merged, 192, 193, 196, 207, 219, 221, 222, 255, 256, 262+352 merged): defensive moves on competitor ships, defended-queries tracker, stat-injection lever, auto prompt-roster expansion, real-bot crawler preflight, zero-source lane, win-decay watchdog, winning-feature mining, AI accuracy watch, fact fingerprinting, persona variants, brand-description audit, zero-click ledger, UGC counter-play.
- [ ] P9. **Competitor watch pack** (v1 245+325+368 merged, 250+259 merged as an extension of the shipped SERP history, 251, 363, 420, 482, 483): counter-refresh on competitor updates, broken-competitor opportunities, SERP-feature appear/disappear alerts, volatility pre-build check, true-competitor discovery, backlink watch on teardown targets, teardown prioritization by traffic, seed demand from any competitor URL.
- [ ] P10. **Entity + author system** (v1 118+218 merged, 243+263 merged, 372, 507): sitewide entity graph with Wikidata (extends the shipped biography QIDs), author/reviewer Person bylines, Knowledge Graph presence tracking, connector-free entity check at cold start.
- [ ] P11. **Technical SEO pack** (v1 168, 319+475 merged, 320, 321, 456, 457, 458, 515, 516, 517, 518, 519, 560, 585, 586): CrUX/PSI lane, broken-link fixer + nightly link liveness, redirect chains, dead-URLs-with-demand recovery, lang/dir audit, URL-variant splits, freshness propagation, robots/sitemap drift alarm, X-Robots-Tag capture, soft-404s, schema-validator breadth, TTFB capture, pagination index policy, OG/Twitter capture, source-link rot.
- [ ] P12. **Push depth pack** (v1 179, 181, 182, 340, 342, 343, 392, 393, 394, 465, 466, 526, 529, 531, 532, 590, 591): atomic multi-field bundles, ground-truth field mapping, Wix Blog drafts, Ricos serializer, reference fields, whole-day rollback, factory-page render audit, per-URL cooldown, element-scoped probes, publish windows, two-phase page creation, read-back tier, scope probes at connect, external-edit flags, pre-bundle export, bulk endpoint.
- [ ] P13. **Worklist UX pack** (v1 184, 185, 186, 188, 189, 205+206 merged, 217, 344, 345, 346, 347, 348, 349, 351, 397, 398, 399, 533, 534, 535, 536, 592): live guardrails on paste, per-pick toggles, batch verify, steering reasons, reversible batches, word-level diffs, add-to-today, set-aside view, same-page bundling, carry-over, focus mode, one-click re-draft, plan diffs, rank explanations, not-now durations, Wix-surface grouping, VA spreadsheet export, unlock dates, cumulative payoff, URL-synced filters, honest minute math.
- [ ] P14. **Today dashboard pack** (v1 169, 171, 172, 323, 324, 327, 328, 329, 330, 331, 332, 388, 389, 459, 461, 520, 522, 588): touched-pages toggle, smoke alarm with page blame, early drift flags, goal pace, lead story, bleeding band, YoY context, start-my-day routine, projection cone, revenue series, threshold crossings, still-arriving shading, verdict takeover, workhorse leaderboard, question-mix trend, waiting-on-operator aging, weekday-adjusted brief, time-of-day ordering.
- [ ] P15. **Learning depth pack** (v1 139, 272, 373, 429, 430, 431, 497, 498): intent-dimension priors, do-not-repeat registry, learn from dismissals, compound-pair track, prior snapshots + brain changelog, coverage map, inconclusive-rate demotion, effort recalibration.
- [ ] P16. **Onboarding intelligence pack** (v1 292, 293, 294, 295, 380, 381, 382, 437, 506): industry classifier fallback, day-0 demand pack, derived-services chips, launch teardown, robots AI-block check, CMS detection, schema starter pack, JS-shell rendering fallback, signup-to-first-win funnel instrumentation. (T0e ships first; this deepens it.)
- [ ] P17. **Performance pack** (v1 159, 160, 201, 299, 300, 301, 302+304 merged, 303, 305, 441, 442, 443, 511, 540, 553, 580, 581, 583, 604, 605): compile/read/cache work, RPC consolidation, SWR everywhere, payload slimming, never-cold-after-invalidation.
- [ ] P18. **Code health pack** (v1 306, 307, 445, 446, 447, 448, 450, 451, 452, 512, 513, 514, 541, 542, 554, 556, 557, 558, 559, 584, 594, 595, 597, 606, 607, 608, 609): consolidation debt. Work opportunistically inside other slices; never a standalone month.
- [ ] P19. **DataForSEO depth pack** (v1 108, 114, 124, 252, 364, 365, 366, 367, 417, 418, 489): AI search volume column, capped backlink radar, difficulty model from proof history, task-queue routing, rank-to-visits conversion, real-cost reconciliation, depth-30 sweeps, Trends wiring, one gauntlet runner, unlinked mentions, rank-distribution chart.
- [ ] P20. **Transliteration + spelling demand** (v1 129, 374): canonical-spelling demand engine for any tenant whose audience types multiple scripts; optional native-script term in answers. English-first surfaces, tenant-configured.
- [ ] P21. **Digest + memory pack** (v1 92, 230, 238, 240, 356, 358): operator-taste memory, while-you-were-away block, strategist history, weekly email digest, trust explainer page, product-limits copy.
- [ ] P22. **Zero-result + review mining** (v1 427, 490): on-site search gaps, customer-language moves from reviews and transcripts.
- [ ] P23. **Reports pack** (v1 233, 257+575 merged, internal-only): export-a-win card, monthly report page (internal; the public version stays deferred).
- [ ] P24. **Image SEO lane** (v1 410+576+578 merged, 248, 552): image inventory + alt audit + alt-text lever from GSC image data and the cold-start crawl; original diagrams and licensed images only behind N5's gate.

---

## CUT OR DEFERRED (do not build; reasons recorded)

- **llms.txt / special AI files** (v1 115, 471): demoted per Google guidance; revisit only on hard evidence engines consume them.
- **Platform expansion** (v1 216 WordPress, 543 Webflow, 596 Shopify, 341 adapter extraction beyond what P12 needs, 406 Wix App Market OAuth): deferred until a second real customer exists on another platform.
- **Public/multi-tenant growth features** (v1 213+426 public audit funnels, 425 portfolio command center, 575 public win pages, 258+297 cross-tenant transplant beyond the shipped anonymous priors, 435 store segment, 438 site-language prompts, 439 local NAP, 416/551 local packs and rank grids): deferred; premium single-user internal first.
- **Video, tools marketplace, gig-human bridge, email capture** (v1 209, 402, 413, 414): different products; parking lot.
- **DMCA packets** (v1 415): legal exposure without counsel; parking lot.
- **Design polish tail** (v1 235, 253, 322, 401, 421, 422, 423, 424+555, 433, 440, 460, 462, 476, 484, 485, 486, 487, 488, 521, 538, 539, 544, 545, 546, 547, 548, 549, 550, 561, 562, 563, 565, 566, 567, 568, 569, 570, 571, 572+601, 573, 574, 579, 587, 593, 598, 599, 600, 602, 603, 610): deferred until daily operation proves which surfaces survive. Exception: anything a T0/N-item touches gets fixed in passing.
- **Schema generators as strategy** (v1 318, 470): support work inside P11/P24, not growth strategy; structured data must match visible content and only supported types earn features.
- **Already shipped in substance** (v1 109 partial, 119, 125, 126, 178, 197, 232, 259, 317, 326, 333, 335, 395, 494): their extensions live inside N29, N32, P8, P9; do not rebuild.

---

## SHIPPED LEDGER (v1 items 1-86, summary; details in git + VERIFICATION_LOG)

Autopilot + trust budget, Wix body publishing + revert, revenue facts, 4-engine AI polling,
citation-outcome lane, GA4 AI referrals, crawl-citation funnel, question universe seed, coverage
map, armed publishing, the scientist-grade measurement stack (A/A calibration, placebo,
permutation null, control matching, changepoints, weather quarantine, pooled verdicts, power
gates, Bayesian reads, target-query reads, dollar attribution, lifetime earnings, portfolio
counterfactual), the learning loop (planner priors, winner few-shots, family propagation,
forecast calibration + receipts, empirical capture, shadow portfolio, cross-tenant anonymous
brain, specialist vote weights, lever retirement), team accountability (Brier, calibration,
scoreboard, roundtable, debate), retrieval twin + /ask, Sunday strategy review,
buy-missing-evidence, deep seasonality + 16-month backfill + event calendar + seasonal voice,
trend radar, refresh queue, language gaps, citability, wiki-gap, keyword universe + winnability +
keyword gaps, SERP history + AI-overview gaps + feature steal + money pages + clone briefs,
outreach mining (operator-gated), page factory + production line + dataset pages, answer
alignment, second-order citations, Person schema + Wikidata, drafter pattern learning, answer
drift, passage answerability, cross-engine share of voice, autonomy circuit breaker, IndexNow
lane, cron_runs ledger + connector health + token-expiry warnings, publish canary, SERP
displacement reflex, citation-loss cards.
