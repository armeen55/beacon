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

**Execution rule:** work the Top 50 in order; any T0 item may jump the queue because it protects
everything else. Tick items here, commit naming them, push branch + main, smoke prod. Full suite
every 10-12 items. Ground-truth every item on real tenant data.

**Operator-journey rule (CLAUDE.md, mandatory):** no item is complete until its rendered surface
was walked as a real operator journey and the completion report quotes the actual rendered copy.
Integrated over bolted-on: reuse existing status words, counts, and sections; never ship raw
slugs, internal keys, jargon, or unexplained zeros. Judge performance on prod, never dev.

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

- [ ] N1. **Unified opportunity allocator**: one ranked decision across optimize, create, link, prune, fix, promote by expected value, confidence, risk, effort. (NEW; absorbs v1 400 value-per-minute)
- [ ] N2. **Query-to-page ownership registry**: enforced; future cannibalization mistakes become impossible. (NEW; absorbs v1 143 draft grounding, 242 mixed-intent split, 270/271 wrong-landing-page + canonical gates)
- [ ] N3. **Claim-level provenance graph**: every factual claim linked to source, date, reliability, affected pages. (NEW; absorbs v1 89/90 clickable sources + source-age, 275 facts_to_verify, 310 multi-source claims)
- [ ] N4. **GA4 + Clarity behavior-verdict lane**: engagement, scroll, frustration, conversion, traffic measured together on every ship. (NEW; absorbs v1 503 GA4 floors, 385 protect-revenue objection)
- [ ] N5. **Information-gain gate**: every new page or section must contribute something competitors do not. (NEW; precondition for any factory)
- [x] N6. **Intent classifier that vetoes the wrong lever** (v1 130; extend the shipped answer-intent classifier into a router veto) - SHIPPED 2026-07-02 (worktree, not yet merged): `src/domains/demand-graph/intent-veto.ts` wired into `move-router.ts`'s existing veto/downgrade machinery; 2 real vetoes on live Iranopedia data, 32 new tests. See `docs/VERIFICATION_LOG.md`.
- [x] N7. **SERP-overlap clustering so one page owns one intent** (v1 120; feeds N2) - SHIPPED 2026-07-02: intent-clusters.ts (union-find over stored SERP overlap) + conflict trigger; honest 7/300 SERP coverage today, grows with every paid SERP read.
- [ ] N8. **Snapshot-grounded factual verification before publishing** (v1 147 entailment check; law 3)
- [x] N9. **Pause recommendations when data sources contradict** (v1 162 cross-check; law 1) - SHIPPED 2026-07-02 (worktree, not yet merged): `src/domains/evidence/source-contradiction.ts` (3 deterministic rules, absence-never-fires) wired into `reviewRecommendation` as a new `paused_source_contradiction` decision, excluded from the nightly plan by the existing `passesDailyGate`; 4 real contradictions found live on Iranopedia, 37 new tests. See `docs/VERIFICATION_LOG.md`.
- [ ] N10. **One verdict-reliability grade**: recrawl, completeness, contamination, controls, volatility, sample strength in one grade. (NEW; absorbs v1 290 coherence, 337 unreliable days, 379 completeness guard, 504 verdict stability)
- [ ] N11. **Recrawl-gated measurement clock** (v1 132+153+183 merged: measure only after Google recrawls)
- [ ] N12. **Block concurrent experiments competing for the same queries** (v1 149; with N2)
- [ ] N13. **Detect and replace comparison pages edited mid-window** (v1 87+175 merged; contamination chip v1 391 rides along)
- [ ] N14. **Full interference graph**: internal links, templates, sitewide changes, redirects, overlapping topics. (NEW; generalizes N12/N13)
- [ ] N15. **Learn from effect sizes, not binary wins** (v1 141; plus 142 beta-posterior shrinkage, 496 recency half-life)
- [ ] N16. **Sustainable control-pool strategy** for when good comparison pages get treated. (NEW; absorbs v1 199 donor repair, 200 median band, 211 synthetic control, 434 holdouts)
- [ ] N17. **User-task completion measurement**: did visitors find the answer they searched for? (NEW; rides N4)
- [ ] N18. **Search-snippet promise audit**: does the page immediately fulfill what the title and description promised? (NEW)
- [x] N19. **Store useful page content** so Beacon reasons about the actual body (v1 98 main-content excerpt; unblocks answer-alignment competitor side + passage coverage on synced snapshots) - DONE 2026-07-02, worktree not committed
- [ ] N20. **Study top 3 SERP winners consensus, not one outlier** (v1 99)
- [ ] N21. **Real JavaScript-rendered technical crawl** (v1 110 On-Page API; capped, gauntleted)
- [ ] N22. **Verify important content in source AND rendered HTML** (v1 111 dual-fetch)
- [ ] N23. **Internal PageRank + click-depth intelligence** (v1 97+121 merged into one internal-authority engine; anchors from real queries v1 495)
- [ ] N24. **Evidence-based pruning, merging, retiring** (v1 113+241+100+215 merged: one content-lifecycle engine with the merge-and-redirect executor on the Wix Redirects API)
- [ ] N25. **Sitewide stale-fact detection** (v1 102; law 1)
- [ ] N26. **Fact propagation engine**: correct one fact once, update every page and schema reference. (NEW; rides N3+N25)
- [ ] N27. **Content-volatility classes** with different freshness deadlines for dates, populations, biographies, evergreen history. (NEW)
- [ ] N28. **Scaled-content spam governor** before any factory expands (v1 101; law 3; factories FROZEN until N5+N3+N28 exist)
- [ ] N29. **Featured-snippet capture + format-matched steal moves** (v1 109; EXTENDS the shipped feature-steal columns and spike hints, not a new engine)
- [ ] N30. **Demand-ranked question universe** from GSC, PAA, AI fanouts, SERPs (v1 127+370 merged; feeds drafting and coverage)
- [ ] N31. **Solar-calendar year-rollover engine** (v1 104; tenant-configured calendar awareness, english-first output)
- [ ] N32. **External-event ledger**: Google updates, outages, PR, social spikes, major site changes recorded automatically (NEW; absorbs v1 170 annotations; generalizes the shipped algorithm-weather)
- [ ] N33. **Blind Beacon-vs-human-expert benchmark** (NEW; scored recommendation face-off on real pages)
- [ ] N34. **Teammate ablation testing**: prove which specialists actually improve decisions (NEW; absorbs v1 161 veto paper trades)
- [ ] N35. **Historical policy replay before new planner logic ships** (NEW; absorbs v1 454 debate replay in CI, 315 shadow challenger)
- [ ] N36. **Gold-standard library**: real pages, evidence, correct decisions, unacceptable recommendations (NEW; absorbs v1 436 fixture corpus, 449 hermetic suite)
- [ ] N37. **Nightly synthetic journey**: plan through publish, verification, measurement on a fixture tenant (NEW)
- [x] N38. **Wix publishing canary** (v1 86; SHIPPED at 77ac7252: token probe + url-map check + dry run + honest fix line)
- [ ] N39. **Production error monitoring** with release, route, tenant, action context (NEW; the T0 spine; absorbs v1 376 LLM telemetry, 404 swallowError, 582 web-vitals beacon)
- [ ] N40. **External API contract tests**: detect silent Google, Wix, DataForSEO, GA4, LLM response changes (NEW; absorbs v1 308 boundary validation, 444 row schemas)
- [ ] N41. **Transactional outbox + idempotency keys** for every publish, rollback, cron, paid side effect (NEW; absorbs v1 474 advisory locks, 473 resume cursors, 528 revision check)
- [ ] N42. **Model-fallback quality benchmark** so cheaper models cannot silently degrade output (NEW; absorbs v1 276 provider failover, 501 retry escalation, 146 task routing)
- [ ] N43. **Cross-vendor cost circuit breaker**: LLM, DataForSEO, crawl, polling under one governor (NEW; absorbs v1 472 spend velocity, 407 daily pacing, 419 per-class budgets, 279 envelopes, 453 one ledger primitive)
- [ ] N44. **Topic-level strategic objective**: balance non-brand traffic, citations, revenue, authority, risk per topic (NEW; N1 reads this)
- [ ] N45. **Recommendation dependency planner**: prerequisites before dependent changes (NEW; with N14)
- [ ] N46. **Opportunity expiration**: stale SERPs, seasonal moves, old evidence leave the queue automatically (NEW; absorbs v1 164 veto expiry, 360 freshness chips, 468 aging)
- [ ] N47. **Primary-source acquisition planner**: interviews, datasets, expert quotes, surveys, original research (NEW; absorbs v1 261; the shipped dataset pages are its first output lane)
- [ ] N48. **Expert-review + disputed-fact workflow** for sensitive, historical, medical, contested claims (NEW; with N3)
- [ ] N49. **Calibrated abstention**: Beacon knows when evidence is insufficient and declines (NEW; law 2; absorbs v1 311 escalation rules, 202 thin_evidence objection)
- [ ] N50. **Canary rollout for new recommendation policies** before they hit every nightly batch (NEW; with N35)

---

## TIER 0 INTERLEAVE: FLY-AWAY SURVIVAL (may jump the queue; the operator must be able to run alone)

- [ ] T0a. **Owner's manual** (docs/OWNERS_MANUAL.md): the daily 20-minute ritual, weekly and monthly rituals, a screen guide, and the one-time setup checklist (map Wix collections, publish the Google OAuth app out of Testing mode, IndexNow key file, set BEACON_DIGEST_TO + RESEND_API_KEY, load full Search Console history, set the revenue model). Live findings to encode: the Wix token works but the page map is empty; google_gsc is already past its 7-day token window.
- [ ] T0b. **One-click recovery for every known failure**: each health card names the exact fix and deep-links it (extends shipped connector health + canary; absorbs v1 187+227+350 verification-recovery merge, 527 auto-heal unmapped urls, 530 push retry, 354 schema-cache heal, 226 retry ladder).
- [ ] T0c. **Operational deadman** (v1 194+355+362 merged): stalled-cron banner, env + cron-registration preflight, site uptime/DNS/SSL/domain-expiry probes. Rides the shipped cron_runs ledger.
- [ ] T0d. **Backups proven by restore drill** (v1 105) + credential encryption and rotation runbook (v1 247) + hack/cloaking sentinel (v1 106) + crawler citizenship (v1 480) + SSRF hardening (v1 249).
- [ ] T0e. **New-site golden path hardened** (v1 154, 155, 156, 157, 158, 212, 296, 298, 383, 505, 508, 509, 577 consolidated): URL-first signup, GSC connect in wizard with backfill, background cold-start crawl past the 18-page cap, day-0 SERP + AI baselines, first-audit scorecard, guided first win, re-read-my-site action, honest unreachable-site failures, rescue stalled signups. This is "grow any website I want" made real.
- [ ] T0f. **Weekly editorial QA sample vs autonomy** (v1 481) + operator-override audits (v1 274): the human spot-check lane that keeps trust honest.

---

## CONSOLIDATED PACKS (after the head; each pack is one slice-sized initiative, dedup applied)

- [ ] P1. **Trust receipts pack** (v1 91, 173, 174, 176, 177, 204, 214, 334, 336, 338, 339, 390, 405, 463, 464, 523, 524, 525): one-line receipts everywhere, verdict revision history, why-not-in-plan inspector, named controls on charts, see-the-math, spend-to-outcome joins, /activity audit log, CSV export, we-got-this-wrong recap section, threshold registry in plain words.
- [ ] P2. **GSC depth pack** (v1 136, 137, 138, 195, 264, 265, 266, 267, 268, 428, 492, 491+493 merged): searchAppearance, budgeted indexation sweep, brand split, ingestion-gap classification, fresh-data lane, device grain, striking-distance portfolio headline, back-of-results register, country grain, footprint registry, anonymized-query gap, Discover probe.
- [ ] P3. **Tenant CTR curve** (v1 131+140+369+384+273 merged into ONE implementation): fit from own GSC data, retrain the title scorer from settled tests, pin the survivor with tests.
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
