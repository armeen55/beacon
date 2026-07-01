# BEACON - THE FINAL PREMIUM PLAN (120 items) - 2026-07-01

> The operator's brief: "this has to be huge... minimum 100 items... something so good I can pass
> it to the next agent to produce it... every important page... the finalized premium amazing feel...
> every time you do something ask if it truly makes you feel like this is the smartest tool in the
> world, if it convinced you, if you would pay $250 or more. Brutally honest."
>
> THE TEST for every item below: **would a stranger pay $250/mo after 60 seconds on this screen?**
> Each item: [P0/P1/P2 priority] [S/M/L effort] what to do + where + the acceptance feeling.
> Grounded in: the 9-agent forensic audit (2026-07-01), live DOM sweeps of every route, the live
> Iranopedia data, and every piece of operator feedback on record. No em dashes anywhere, ever.
>
> THE THREE ROOT CAUSES (why it "feels off" despite working):
> 1. **No scoreboard.** The product never answers "am I winning?" with a picture. A $250 tool opens
>    on a chart of your traffic with your changes marked on it. Beacon opens on text.
> 2. **No craft consistency.** Three styling systems coexist (Tailwind cards, inline-style cards,
>    legacy sections). Small gray text everywhere. No motion, no identity, no celebration. It reads
>    like an internal dashboard, not a product.
> 3. **Reasoning reads templated.** The team debates now, but voices are stiff one-liners and the
>    verdict is a sentence pattern. The "smartest tool in the world" writes like a sharp human
>    strategist: flowing, specific, opinionated, and it tells you what would change its mind.

---

## A. THE SCOREBOARD - make winning visible (the single biggest missing thing)

1. [P0/L] **Build the hero progress chart on Today**: weekly clicks + impressions for the whole site
   (GSC data already synced, `gsc_daily_totals`), rendered as a beautiful area chart at the very top
   of `/`. Acceptance: you open Beacon and instantly see the line you are trying to move.
2. [P0/M] **Annotate shipped changes on the chart**: a marker dot per shipped change (from
   `shipped_change_proof.shippedAt`), green when its verdict is won, gray while measuring. Hovering
   a marker shows "Meta rewrite on /iran-flags... shipped Jul 1". This is the causal story in one
   picture and NOBODY else's tool does it this clearly.
3. [P0/S] **One-line verdict under the chart**: "Last 7 days: 412 clicks, up 9% vs the week before.
   16 changes measuring, first verdicts Friday." Plain sentence, real numbers, from data.
4. [P1/M] **Per-page mini-charts**: every card that names a page (daily card, MoveCard, Results row)
   gets a 90-day clicks sparkline next to the page name (data exists in `gsc_daily_rows`).
   Acceptance: no page is ever just a URL string again.
5. [P1/M] **Before/after chart on every Results row**: treated page line vs control-average line,
   ship date marked. The diff-in-diff, drawn instead of described.
6. [P1/S] **Countdown chips**: "first read in 3 days" on every measuring item, computed from the
   7/14/28 windows (measurement-maturity.ts already computes checkpoint dates).
7. [P2/M] **A weekly recap band on Today** (Mondays): "Last week: 6 shipped, 1 win (+31 clicks/mo on
   /finglish), 2 no-lift, 3 still measuring." Auto-written from the ledger, celebratory tone on wins.
8. [P1/S] **Streak + totals in the header area**: "22 changes shipped in 14 days" with a small flame
   or momentum indicator. Makes daily use feel like progress, not chores.
9. [P2/S] **AI-visibility mini-scoreboard**: citations-over-time sparkline (profound_citation_rows
   has dates) next to the Google chart, once R4 lands: "AI recommended you 214 times this month."
10. [P0/S] **Kill every number that appears without a trend or comparison.** A bare "26,569
    impressions" means nothing; "26,569 impressions, up 12% this month" means everything. Sweep
    every stat chip on / and /worklist and attach direction.

## B. DESIGN SYSTEM + PREMIUM FEEL (the craft layer)

11. [P0/L] **One card system.** Kill the inline-style objects in `daily-experiments-section.tsx`
    (CARD/LABEL/PASTE consts) and rebuild the daily card with the same Tailwind design language as
    the MoveCard. One border radius, one shadow scale, one spacing rhythm across the whole app.
12. [P0/M] **A real typography scale.** Today almost everything is 11 to 13px gray. Define and apply:
    display (page titles), headline (card titles 16 to 18px semibold), body (14px), caption (12px),
    numeric (tabular figures for all metrics). Headlines must feel like headlines.
13. [P0/M] **Teammate identity system.** Each specialist gets a fixed color + small glyph + short
    name used EVERYWHERE: Demand (blue), Revenue (green), Behavior (amber), Google results (violet),
    AI citations (pink), Publishing (slate), Strategist (indigo). Update SPECIALIST_LABELS
    consumers, the roundtable, war-room bands, and evidence chips to use identity chips, not plain
    bold text. Acceptance: you can tell who is speaking at a glance from color alone.
14. [P1/M] **Design the roundtable like a real conversation**: avatar chip on the left, claim as a
    speech line, conviction as a thin progress bar (not "(100%)"), objections visually offset like a
    reply. It should look like a team thread, not a bullet list.
15. [P1/M] **Motion pass**: streamed sections fade+rise in (Suspense boundaries already exist),
    status changes crossfade, the Copy button confirms with a micro-animation, chart draws on load.
    150 to 250ms, ease-out, subtle. No motion on reduced-motion preference.
16. [P1/S] **Celebrate wins.** When a verdict flips to won, the Results row and the Today recap get
    a one-time confetti-adjacent (subtle) highlight + a green glow that decays. Wins must FEEL good.
17. [P1/M] **Dark mode done properly** across the new surfaces (the daily card's inline styles
    ignore dark tokens today). All colors through CSS variables.
18. [P0/S] **Number formatting discipline**: tabular-nums everywhere, thousands separators, "26.5k"
    over "26,569" in chips, full number on hover. One `formatMetric` helper, used everywhere.
19. [P1/S] **Iconography**: one icon set (lucide), 16px, consistent stroke. Kill the mixed unicode
    glyphs (currently a mix of check marks, warning triangles, arrows as text).
20. [P1/M] **The header becomes a cockpit bar**: business name, the scoreboard number (7-day clicks
    + delta), data freshness dot (green under 24h), and the one primary action. Kill dead space.
21. [P2/M] **Empty states designed**: every self-hiding section gets a designed empty state when it
    would help ("No friction found this week. Clean pages." with a small illustration), never blank.
22. [P2/S] **Consistent skeletons** sized to real content for every Suspense boundary (worklist and
    proof have them; war-room bands and daily card do not).
23. [P1/S] **Focus + hover states** on every interactive element (several buttons have none).
24. [P2/M] **Mobile pass on Today + war room**: cards stack cleanly at 375px, chart resizes, no
    horizontal scroll (worklist already passed this; the new sections have not been checked).

## C. THE ROUNDTABLE + REASONING QUALITY (make it read like the smartest strategist alive)

25. [P0/L] **LLM-written verdicts (grounded)**: replace the templated "Biggest opportunity the team
    sees..." with a per-pick LLM synthesis over the REAL opinions + evidence (structured-drafter
    pattern: budget-gated, numeric-fidelity firewall, fail-soft to the deterministic sentence).
    Target voice: "Google already ranks you #3 for iran flag but only 1 in 1000 searchers click.
    The snippet is the weak link, not the ranking. AI tools cite 5 rivals for this topic and never
    you, which is the bigger prize. Fix the description tonight; the answer block is next." That
    paragraph is worth $250/mo. The template is not.
26. [P0/M] **Give every voice a number.** Audit all 8 emitters in specialist-opinions.ts: no claim
    ships without a concrete figure ("Visitors hit friction (score 60)" must become "26% of visitors
    dead-click on this page"). Rewrite the weak claims.
27. [P0/M] **Add the PROOF-HISTORY voice to the debate**: a ninth deterministic emitter reading the
    measured ledger for the page family + lever ("We tried a title change on a flags page in June:
    no lift after 28 days. That is why tonight is a description, not a title."). Learning, visible.
28. [P0/M] **Add the KEYWORD-RESEARCH voice**: volume + competition from the cached universe as its
    own teammate line ("135,000 searches a month for iran flag, low competition"), not buried in
    the how-we-know expander.
29. [P1/M] **SERP voice on existing-page picks**: run the gauntlet-gated live SERP for the target
    query of each nightly pick (6 to 8 queries a night, ~$0.02) so the Google-results teammate
    almost never abstains on the batch. Budget is a rounding error; abstaining teammates are not.
30. [P0/S] **Render "why not the alternatives"**: the router already computes whyNotAlternatives;
    show the top one on the card ("Considered a new page: vetoed, you already rank #3"). Nothing
    says "smart" like showing the road not taken.
31. [P1/S] **Render "what would change our mind"**: one falsifiability line per pick, deterministic
    from the proof plan ("If clicks do not move in 14 days, we roll this back and try the answer
    block instead"). Confidence with an exit plan is trust.
32. [P0/S] **Conviction as a visual meter** on the card face (thin bar + "Team conviction: high"),
    not a percentage in parentheses.
33. [P1/S] **Disagreement is a feature**: when voices conflict, render the tension explicitly
    ("Demand says go, Behavior says fix the page first. The team sided with Demand because the
    friction is below the veto line."). The router's appliedObjections already carry this.
34. [P1/M] **Expected outcome ranges** per pick: honest forecast from CTR-curve math already in
    build-daily-candidates ("If this works: roughly 20 to 60 extra clicks a month"). Label it an
    estimate. Money talk, not SEO talk.
35. [P1/S] **Name the operator's cost**: every card face shows "2 minutes in Wix". Effort clarity
    makes 6 changes feel like a 12-minute win, not homework.
36. [P2/M] **A "Challenge this" button** per pick: one click asks the LLM to argue AGAINST the
    pick using the same evidence, rendered inline. Adversarial by request; deeply convincing.
37. [P1/M] **Fix the abstain problem structurally**: when fewer than 3 voices speak on a pick, the
    card says "Two teammates had evidence on this page" honestly, and the nightly builder prefers
    (all else close) picks where more of the team has evidence. Fuller debates = smarter feel.
38. [P2/S] **Roundtable everywhere the product recommends anything**: New Pages board cards and
    Competitor moves get the same TeamRoundtable component (they already have packets).
39. [P1/S] **Kill remaining robotic phrasings** in debate strings: "competitor page(s)" (pick the
    plural properly), "score 60: dead/rage clicks" (translate to percentage), "(e.g. domain)".
40. [P2/M] **The Strategist voice gets a memory**: reference the operator's own history ("You
    shipped 4 flag metas this week; this is the 5th and last before we wait for reads").

## D. TODAY / WAR ROOM (the flagship page, finish the job)

41. [P0/M] **Reorder Today into a story**: 1 Scoreboard chart, 2 "Tonight" (the team's batch),
    3 "Measuring" (compact), 4 "What the team found" (war room), 5 sources strip. Attention items
    become a slim banner, not a section.
42. [P0/S] **Personal greeting + daily brief line**: "Tuesday, Jul 1. The team reviewed 42 pages
    today and picked 4 changes worth about 25 minutes." Set the scene like an assistant would.
43. [P0/M] **Team standup strip**: a horizontal row of the 7 teammate identity chips, each with its
    one-line daily report ("Behavior: friction on 4 pages" / "AI citations: 5 rivals cited on flag
    topics") and a dot when it found something new today. Click scrolls to its band. THIS is the
    "cool teamwork thing" at first glance.
44. [P1/S] **Batch progress bar**: "Tonight: 2 of 6 applied" with a segmented bar on the daily
    panel header; segments fill as items verify live.
45. [P0/S] **Rewrite the hero copy jargon**: "These 35 pages are controls for active experiments"
    becomes "35 similar pages are being used as comparisons this month, leave them unchanged so the
    results stay trustworthy." Sweep every string in the daily panel through this filter.
46. [P1/S] **War-room band headers get counts + freshness**: "Visitor behavior found friction (4
    pages, read today)". Every band header shows when its data was last read.
47. [P1/M] **Friction fixes become actionable cards**: each row gets "Add to tonight" (creates a
    fix_ux item in the plan flow) or at minimum a copyable instruction. Intelligence without a
    button is trivia.
48. [P1/M] **Demand band links to action**: each unowned-demand row gets "Draft this page" (routes
    to the existing New Pages prepare flow for that keyword).
49. [P2/S] **War room self-summarizes when quiet**: "The team found nothing urgent beyond tonight's
    picks. Clean day." Confidence in silence.
50. [P1/M] **"While you were away" block** when the operator has not opened Beacon for 48h+: what
    shipped, what changed verdicts, what the team found since (deterministic digest).
51. [P2/M] **Make DataSourcesStrip the "team health" strip**: same teammate identities, green dot
    when fresh, amber "last read 3 days ago", red + one-click reconnect when auth is dead (GSC
    invalid_client currently fails silently in logs while the UI smiles).
52. [P1/S] **Remove the "Switch to Ritz Builders" pill from the header for daily use** (move tenant
    switching into settings); it reads like a dev tool on the flagship screen.
53. [P2/M] **New Pages board on Today shows its 3 best only** with "See all 9" into /worklist, so
    Today stays a briefing, not a second backlog.
54. [P1/S] **Chart + hero must be dash-clean and jargon-clean** (23 em/en dashes currently visible
    on Today from persisted copy: strip at render for all persisted-plan text).

## E. CHANGES (/worklist) - from list to command center

55. [P0/M] **Face-lift the row density**: each row = identity chip of the lever, page name with
    sparkline, one-line why with a real number, conviction meter, one primary button. Everything
    else on expand. Today rows read as text soup.
56. [P1/S] **"Tonight's 30 minutes" mode**: a toggle that filters to the accepted plan + top ready
    items fitting a 30-minute budget (effortMinutes exists on every item).
57. [P1/S] **Group by goal, not status, as the default view** ("Win more clicks" / "Get cited by
    AI" / "Fix the experience" / "Build new pages"), tabs stay for status. Business language first.
58. [P0/S] **Kill the "Treatment:" label** in the /changes detail attribution drilldown (the last
    raw lab term on an operator surface, found by the forensic sweep) plus the "reservationCount"
    string in daily messages.
59. [P1/M] **Search that actually finds**: search across page path, query, teammate claims, and
    verdicts ("dead click", "iran flag", "won") with instant results.
60. [P1/S] **Bulk "copy all tonight's pastes"**: one button that copies a numbered, Wix-ordered
    checklist of every pending paste (execution-checklist already builds instructions).
61. [P1/S] **Every ready row shows its expected outcome range** (same estimate as C34) so the list
    reads like an investment menu, not a chore list.
62. [P2/S] **Sticky batch bar** at the bottom while items from tonight's plan are pending: "2 left,
    ~7 minutes" with jump-to-next.
63. [P1/S] **Row-level freshness**: "evidence read 2h ago" chip; anything stale (>14d SERP, >7d
    snapshot) gets an amber "re-check before shipping" hint with the one-click refresh.
64. [P2/M] **Keyboard flow**: j/k to move, enter to expand, c to copy paste text. Power feel.
65. [P1/S] **Rename ambiguous statuses in UI copy**: "suggested/ready/measuring/won" everywhere;
    kill "verification_pending" style codes from any tooltip or aria label.
66. [P2/S] **Show the safety net proudly**: a quiet line above the list: "12 pages are protected
    right now (mid-measurement or serving as comparisons). Beacon will not recommend changes there."
    Turn the invisible gate into visible trustworthiness.
67. [P2/M] **Undo/rollback affordance** on shipped items: every applied change shows its rollback
    text one click away (rollbackText exists on every record).

## F. RESULTS (/proof) - from lab console to outcome story

68. [P0/L] **Rewrite the page as three bands**: "Wins" (mature, won, celebrated), "Learning"
    (mature, no-lift or lost, framed as knowledge gained), "In flight" (measuring with countdown
    chips). Kill the current stats-first layout.
69. [P0/M] **De-jargon the entire surface**: 47 "experiment", 35 "control", 29 "baseline" instances
    in visible text today. Vocabulary: change, comparison pages, before/after, verdict, window.
    Extend the no-banned-dash + jargon test guard to /proof components so it can never regress.
70. [P0/M] **Every row gets the before/after mini-chart** (A5) as the row's centerpiece; the
    numbers become supporting cast.
71. [P1/S] **Win rows state the money**: "+31 clicks/mo on /finglish since Jun 12" as the headline,
    method detail behind How we know.
72. [P1/S] **Learning rows state the lesson**: "Title changes did not move flags pages. The team
    now deprioritizes titles on this family." (outcome-priors already exist; SAY them.)
73. [P1/S] **A verdict calendar strip**: the next 14 days with dots for upcoming 7/14/28 reads, so
    the operator knows when to come back.
74. [P2/S] **Filter by teammate**: "show changes the Behavior teammate drove" etc.
75. [P1/S] **Aggregate honesty header**: "16 measuring, 1 win, 3 no-lift, next verdicts Friday" as
    a sentence, not four stat tiles.
76. [P2/M] **Manual mark-done flow polish**: the record-any-page form gets the same premium card
    treatment + teammate confirmation ("Got it. Tracking against 4 comparison pages from today.").
77. [P2/S] **Export/share a win**: one click renders a clean image/PDF card of a win (chart +
    sentence) for sharing. Founders show these off; it markets the product for you.
78. [P1/S] **Kill the "Approved & ready to ship" stray band** on /proof (it duplicates /worklist
    inventory on the results surface; results = outcomes only).

## G. THE ENGINE - intelligence depth that earns the price

79. [P0/M] **Auto-measure**: a due-window measure pass (light cron + on-render fallback) so
    verdicts land WITHOUT clicking Results (run-measurement.ts is manual-only today). The learning
    loop cannot compound on manual clicks.
80. [P0/M] **Feed verdicts back as the proof-history voice** (C27) AND into the R&R ranking via the
    bounded prior (insight/outcome-prior.ts is built and idle; wire it in load-graph.ts post-score).
81. [P0/M] **Weekly snapshot rescan** (crawl own site, $0): page_snapshots are 20 days stale, so
    every draft argues against old content. Add staleness badge to any evidence derived from a
    snapshot older than 7 days.
82. [P0/M] **R4: DataForSEO LLM-mentions as the owned AEO signal**, fused with Profound into ONE
    "AI citations" teammate voice (both sources named in the evidence expander). Under the $50 cap.
83. [P1/M] **Weekly keyword-universe refresh** (one $0.075 batch per week per tenant, budget-gated)
    so volumes never silently go stale; freshness shown in the how-we-know brief.
84. [P1/M] **Nightly precompute at ~5am local**: the daily plan preview, LLM drafts, debates, and
    war-room reads all computed before the operator wakes. Morning open = instant + full. (The
    on-demand posture stays for refresh; this is a warm cache, not a behavior change.)
85. [P1/M] **LLM adjudicator on the nightly batch** (the reasoning-gap fix, standing): after the
    deterministic picks, one budget-gated LLM pass sanity-checks each pick against its evidence
    ("does this answer match the search intent?") and can flag, never silently drop.
86. [P1/M] **Standing adversarial regression**: encode the operator's cases as tests that run on
    real fixtures weekly: boy vs girl names contamination, cities hub vs city pages, flags parent
    vs dynasty children, swear-words proof-blocked lever, Chaharshanbe date intent. (The forensic
    agent died before finishing these; make them permanent.)
87. [P1/S] **Per-page dossier route** (/page/[path]): everything the team knows about one page in
    one place: chart, queries, teammates' reads, history of changes + verdicts, current
    recommendation. Linked from every page name. This becomes the "research" surface.
88. [P2/M] **Cannibalization + internal-link intelligence into the debate**: the GSC cannibalization
    detection exists; surface it as a Demand-voice objection ("two of your pages fight for this
    query") instead of a separate buried card.
89. [P2/M] **Trend radar goes live on real deltas**: WoW query-spike detection from gsc_daily_rows
    feeding the Demand band ("chaharshanbe searches will spike in March; prep in February").
90. [P2/L] **Wix draft-writing where possible**: for CMS-pushable fields, "Apply in Wix" becomes
    "Stage in Wix" (existing armed-publish rails, operator approves; Ritz stays blocked). Cuts the
    paste friction that makes nightly batches feel manual.
91. [P2/M] **GSC indexing queue polish**: after verify-live, one screen lists the URLs to request
    indexing for, ordered, with copy buttons and "mark done" (quota-aware, manual by design).
92. [P1/S] **Spend receipts page** (settings): "$1.42 spent this month of $50" per provider with
    per-call lines. Cost honesty is premium trust.

## H. SPEED (premium = instant)

93. [P0/M] **Today warm render under 2s**: persist the TodayView + war-room reads with the SWR
    pattern already used for the worklist surface (stale-while-revalidate, background refresh).
94. [P1/M] **Worklist warm under 3s**: same treatment for loadChangesView; the demand graph
    snapshot cache exists, extend it to the full view model.
95. [P1/S] **Optimistic UI on every button** (apply/skip/copy/accept): instant visual state, server
    reconciles; no dead-feeling clicks.
96. [P2/S] **Prefetch on hover** for row expansion data and the dossier route.
97. [P1/S] **Never block the shell on data**: every band already streams; ensure the header +
    scoreboard skeleton paint in the first flush (audit the Suspense boundaries).
98. [P2/S] **Measure and pin**: a perf budget test that fails CI if / or /worklist server render
    exceeds budget on the seeded fixture.

## I. DELETE / CONSOLIDATE (a premium product is also what it does NOT have)

99. [P0/S] **Merge Connections vs Connectors**: /connections folds into /settings/connectors, one
    nav item ("Connections"), redirect the old route. Two nav entries for the same job reads broken.
100. [P0/S] **Fix nav label/route mismatches**: Results points at /proof, AI questions at /prompts;
     rename routes or labels so URL, label, and page title agree everywhere.
101. [P1/M] **Delete today-data.ts (3,131 LOC dormant)** after confirming the one type-only import
     (today-do-next-card) is dead or re-pointed; delete the unmounted src/components/today/v2/* and
     the other 9 unmounted Today components the audit listed (or mount them deliberately; no limbo).
102. [P1/S] **Delete the Wix blog/media handlers** (wixCreateDraftPost/wixPublishDraftPost/
     wixImportMedia): zero callers, push-service documents them as unwired. Reduce surface area.
103. [P1/S] **Decide the backlink stub**: delete link-authority/backlink-provider.ts (no callers)
     and keep the plan in docs, OR schedule it. No zombie code.
104. [P0/M] **Retire the legacy recommended_edits queue as an operator surface**: 82 rows, 100%
     never actioned, 6+ days stale, now double-gated. Fold anything still unique into the canonical
     Changes adapter and stop rendering the legacy queue path on /today hero (single decision
     path = single truth).
105. [P1/S] **Archive the stale docs**: move the 16 AUDIT_*.md + 21 sprint/report docs + findings
     docs into docs/archive/ with one INDEX.md; canonical four stay. 2MB of dead weight confuses
     every future agent.
106. [P2/S] **Gate /diagnostics/* routes** behind operator mode at the route level (23 routes are
     currently URL-reachable; the forensic audit flagged it).
107. [P1/S] **One LLM entry point**: fold llm-draft-gateway's remaining uniqueness into
     llm/structured-drafter (or make the gateway call it) so there is ONE budgeted, firewalled LLM
     path; delete the duplicate after tests move.
108. [P2/S] **Unify dismiss/skip stores** (opportunity_dismissals vs recommendation_response) behind
     one API so a dismissal on one surface can never leak an item back on another.
109. [P1/S] **App-wide banned-dash + jargon guard**: extend the existing test to cover EVERY file
     under src/app + src/components (currently a whitelist); fix the ~30 remaining visible
     instances once, then the guard holds the line forever.
110. [P2/S] **Delete dead nav shortcuts** ("G T"/"G C" hints) unless keyboard nav (D64) ships; half
     -implemented power features read as neglect.

## J. VOICE + TRUST (the assistant personality, everywhere)

111. [P0/M] **Write the Beacon voice guide and apply it**: first person ("I checked...", "We
     think..."), always a number, always a next step, never hedging without a reason, never a raw
     code, wins celebrated in one sentence, losses owned ("That one did not work. Here is what we
     learned."). Sweep: daily panel, roundtable, war room, Results, empty states, errors.
112. [P1/S] **Every evidence line carries its source + age**: "GSC, read 2h ago" / "live Google
     results, read Jun 27" / "your page, crawled Jun 11 (stale)". Tiny gray text, huge trust.
113. [P1/S] **Every claim clickable**: query names link to the GSC UI filtered view (or dossier),
     competitor domains open the actual page, "26% dead clicks" links to the Clarity project.
114. [P2/S] **A "why should I trust this" page** (one static, beautiful explainer of the method:
     comparisons, windows, verdicts, caps) linked from every How we know footer.
115. [P1/S] **Honest degradation everywhere**: when a teammate's auth is dead (GSC token refresh is
     401 in the logs RIGHT NOW while the UI says nothing), the team standup strip shows it and every
     debate that misses that voice says "Demand data is 3 days old (reconnect)".
116. [P2/S] **Kill silent successes**: every server action returns a one-line receipt the UI shows
     ("Verified live on iranopedia.com at 9:42pm. Tracking started.").
117. [P1/S] **Name the product's own limits**: pages with thin evidence say "The team does not have
     enough evidence here yet" instead of a weak recommendation (the eligibility machinery exists;
     the COPY must say it proudly).
118. [P2/S] **Session memory of the operator's taste**: when the operator edits a paste text before
     applying, store the diff and show "You usually soften our wording; here is a softer variant"
     after 3+ edits (learning/change-patterns.ts is built and idle).
119. [P2/M] **Weekly email digest** (operator-triggered opt-in): the Monday recap band as an email.
     The product should reach out when there is news worth money.
120. [P0/S] **The final acceptance ritual**: after every future change, the agent must answer in the
     PR/commit: "Does this screen convince a stranger to pay $250/mo? What number does it show?
     What decision does it enable? What would I cut?" If the answer is weak, the change is not done.

---

## SEQUENCING FOR THE NEXT AGENT (do not reorder P0s)

- **Wave 1 (the feel flips here):** A1-A3, A10, B11-B13, C25, C26, C30, C32, D41-D43, D45, F79-F82, I99-I100, J111, J120.
- **Wave 2 (conviction depth):** C27-C29, C31, C33-C35, A4-A6, D46-D48, E55-E61, F68-F72, H93.
- **Wave 3 (compounding + polish):** the rest, deletions I101-I110 interleaved (one deletion per feature slice, keeps the tree honest).
- Standing rules: no em dashes anywhere; plain business language; every slice ground-truthed on real
  Iranopedia data + visually inspected; full suite + build as the merge gate; main + deploy per slice.
