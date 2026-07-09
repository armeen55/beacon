# Operator Product Spec - 2026-07-09 (the 85-question interview)

> THE governing product contract, from Armeen's free-form answers to the 85-question
> interview. Where docs conflict, THIS wins. Every decision is numbered to the interview.
> "I decide" items are marked DELEGATED with the decision recorded.

## The core promise (his words, #84)
"connect sources -> see the next best move -> get safe copy -> approve once -> verify the
outcome." Most impressive part today: the evidence/recommendation/proof architecture. Most
broken-feeling: claiming a publish loop before its hosted state is durable. The embarrassing
failure classes to never repeat: unsupported causal claims, blank recommendation cards,
wrong-tenant language, unsourced encyclopedia facts.

## A. Objective + measurement frame
- (1) "Best opportunity" = PURE TRAFFIC GROWTH, where AI citations, clicks, and impressions
  all feed that one goal, grounded in the research already done (keywords, SERP, query
  fanouts). One objective, not a blend picker.
- (2) An ecommerce shop EXISTS with GA4 revenue/events data, but: "prove to me that you can
  increase traffic first." Money later.
- (3) Measurement horizon: WEEKLY WON'T CUT IT. Use monthly (and 3-month) views. North star:
  peak was 20k monthly visitors, now ~5-6k; back into the 10k+ range = revival. "i just want
  more more more."
- (4) Ritz + Iranopedia run HAND IN HAND (the first two clients); priority Iranopedia.
- (5) Daily budget: 10-20 min max; target a complete session in 10 (#82).

## B. Today page (rebuild spec)
- (6) Structure, top to bottom: [1] anything broken / needs fixing NOW (red banner rules in
  I-60), [2] big things happening he can't see (wins, losses, drops), [3] a site overview
  summary (impressions, clicks, pages, monthly-visitors north star vs the 10k goal), [4] the
  next best moves, [5] link out to Changes for the full ranked list.
- (7) The "Tonight's plan" batch box: KILL from Today ("fucking sucks").
- (8) Move count: DYNAMIC by opportunity quality, not a fixed 6.
- (9) Section verdicts: team standup line = corny, kill until it can be "way cooler"; AI
  crawlers band = kill ("don't do shit"); coverage map = kill and rebuild from scratch later
  ("the worst thing I've ever seen, bully that page"); war room bands = fold the useful
  signals into moves/evidence, not standalone bands.
- (10) Click-drop investigation card: state the drop and stop, no invented causes. LLM
  reasoning is ALLOWED when useful - "stop hiding shit behind walls," flags/gates off.
- (11) DELEGATED: Update-data refreshes data AND regenerates the moves (background, page
  stays responsive; warmFreeSurfaces already does this).
- (12) No email/text digest for now.
- (13) Red banner at top for genuinely broken things: yes.
- (14) KILL the "team" framing. Replace with the evidence chain, SPECIFIC AND HUGE:
  "best move = X because this query fanout is #1 in its category, keyword research found Y
  opportunity, the SERP shows Z is beatable, and we reverse-engineered the top pages."
  Prove the work, don't name fake teammates.
- (15) DELEGATED: clicking a move on Today deep-links to its Changes detail.

## C. Changes page
- (16) DELEGATED (he said analyze + decide): ONE flat ranked list, opportunity-ordered, with
  a small type tag per card (title/answer/new page/fix). Bucket headers removed.
- (17) "Watching" (insufficient evidence, the abstention holds) = separate lower-priority tab.
- (18) Kill the "I'm holding back 42 lower-priority ideas" line (noise).
- (19) Show difficulty (easy/medium/hard) + time, time secondary.
- (20) Replace the "directional signal / X + Y agree" chips with ONE concise evidence
  sentence per card - specific, numbers in it (the B-14 chain, shortened).
- (21) Card buttons: "See draft" and "Not now". "Approve & Push" lives only in detail view.
- (22) Detail view = exact before/after text, two evidence sentences, sources, constraints,
  one clear action.
- (23) Kill the strategy picker (Best opportunities/Fastest growth/Safest bets).
- (24) Copy/paste is the operating mode FOR NOW (that is how he operates both sites). Keep
  building durable Wix mapping underneath, but do not market one-click publishing until the
  mapping/rollback/auth stack is durable. End-to-end comes "once we start flowing."
- (25) AUTO-VERIFY manual changes: crawl the page and match the shipped text (no honor
  system).

## D. New pages board
- (26) Default proposal = title + outline + SOURCE PACK + opening paragraph. Full draft only
  offered after factual sources are present.
- (27) Merge true semantic duplicates into one canonical proposal; show DEDUPLICATED demand,
  never blindly summed volumes.
- (28) Floor: only show ideas above 50 searches/mo, or exceptional strategic gaps with a
  stated reason.
- (29) Rank by opportunity + winnability + authority cost + intent, NOT volume alone.
- (30) Weak-Wikipedia targets only when Beacon can produce a better SOURCED page.
- (31) Create Wix DRAFT pages only after mapping is durable; never auto-publish.
- (32) No weekly cap on new pages - if the opportunity calls for pages over edits, he builds.
- (33) Replace Hot/Warm/Emerging with Rising / Seasonal / Stable, each with evidence.

## E. Results + measurement
- (34) Language: "estimate, not proof." Never a causal promise.
- (35) Tiers: 7-day early signal, 28-day provisional verdict, 56-84-day confidence. AND:
  never lock him out of re-editing a page mid-measurement - overlapping continuous changes
  are allowed, attribution just gets noted honestly. "idc how we revive."
- (36) NEVER auto-revert; ask first.
- (37) Results bands: Wins / What we learned / (third band: still-measuring). NOTE: he said
  "Watching" but that word is reserved for the Changes evidence-hold tab (C-17); the Results
  third band renders "Measuring" to avoid one word meaning two things (operator-journey rule).
- (38) HIDE all dollar estimates until real revenue data is connected.
- (39) Smaller ADAPTIVE control pools; never freeze 35 pages by default; controls only when
  needed (research the right minimum).
- (40) Forecasts: show a range + a conservative midpoint.
- (41) Weekly recap ON TODAY (not email, for now).

## F. Ask
- (42-46) Ask = "literally ChatGPT with access to every single datapoint I have." A Beacon
  insider LLM with full data access that can just talk. Implementation details delegated.

## G. AI prompts / AEO engine
- (47) FORGET running prompts for now. He has 100-200 prompts ready for BOTH tenants.
  PREREQUISITE RESEARCH (deliverable before wiring anything): compare executing them
  natively via DataForSEO AI-optimization endpoints vs OpenAI/Perplexity APIs - what each
  can extract (competitor data, query fanouts, citations), cost per prompt per platform,
  cheaper alternatives, and a recommendation.
- (53 implied) The prompt list stays operator-controlled.

## H. Keywords / research
- (54) Keywords page = the permanent cached library of every keyword ever researched ("our
  own little rally database") - keep it self-serve analyzable.
- (55) DataForSEO ceiling stays $50/mo until Beacon proves incremental value.
- (56) Competitor intel = "steal this move" evidence inside cards, not a standalone
  destination.
- (57) Seasonal alerts appear on Today only while the preparation window is open.
- (58) Same-week spike moves only for genuinely time-sensitive opportunities.

## I. Connections / automation / alerts
- (59) NO CRON DEPENDENCE. Freshness must be guaranteed at login/on-demand ("refreshed on
  log in or whatever is best"). Long term reads/analysis may automate nightly as an
  optimization, but the app must never depend on it; content publishing NEVER automated.
- (60) RED alerts only: GSC auth failure, site down, failed publish, tenant-security issue.
  Staleness = AMBER, never red.
- (61) Remove the reliability report ("I showed up 2 of 6 nights") unless something needs
  action.
- (62) One-click publishing ships only after Wix map/config + rollback state + authorization
  are durable.
- (63) One-click approval is the FLOOR FOREVER for content. Autopilot only ever for data
  refresh + measurement.
- (64) Google OAuth expiry = root-cause investigation priority, with traceable refresh-token
  diagnostics.
- (65) Local/Yelp/GBP = Ritz-only for now; per-client needs handled via config/segments.
- (66) Wix CMS dynamic pages are mappable today; hand-built Wix pages need a separate
  inventory/mapping path before auto-push can cover them.
- (67) Keep Clarity, surface only SEVERE actionable friction.
- (68) Spend stays out of customer nav.

## J. Drafts + factual safety
- (69) EVERY factual draft requires 1-2 authoritative sources before it is paste-ready. No
  exceptions.
- (70) First mention: Persian spelling where available + transliteration + English context.
- (71) Answer blocks 80-150 words WITH source citations (40-60 is too thin).
- (72) Meta style: let real CTR data decide.
- (73) Capture his final edit as a structured diff automatically (crawl + diff against the
  proposed text); never require manual paste-back. Beacon learns from the diff.

## K. UX
- (75) Cut ~35% of visible copy; progressive disclosure.
- (76) Dark mode: keep, not a priority.
- (77) Mobile: quick review/approve must work; deep investigation is desktop.
- (78) Remove decorative emoji; keep meaningful accessible status icons.
- (81) Sole operator; no collaboration roles until someone else truly uses it.
- (83) Absorb the ACTION layer of GSC + Wix so he stops opening their dashboards.

## Ranked execution plan (from this spec)
1. W1 Today rebuild (B-6..15): kill Tonight box + AI-crawler band + coverage map + standup,
   dynamic moves, north-star overview (monthly visitors vs 10k), evidence-chain copy,
   drop-card shut-up, weekly recap slot, red/amber taxonomy.
2. W2 Changes rebuild (C-16..23): flat ranked list + type tags, Watching tab, evidence
   sentence, See draft/Not now, detail = before/after + sources + constraints, kill picker +
   holding-back line.
3. W3 Measurement honesty (E-34..41): estimate-not-proof, 7/28/56-84 tiers, never lock
   pages, adaptive controls, hide dollars, ask-before-revert, range + midpoint.
4. W4 New pages (D-26..33): dedup clustering + deduplicated demand, 50/mo floor,
   opportunity ranking, Rising/Seasonal/Stable, source-pack-first.
5. W5 Draft safety (J-69..73): sources required, 80-150 words, Persian first-mention rule,
   crawl-diff edit capture, auto-verify manual ships (C-25).
6. W6 Freshness + alert taxonomy (I-59..61): on-login stale refresh, red/amber rules, kill
   reliability noise, truthful automation copy.
7. W7 OAuth root-cause (I-64).
8. W8 AI-prompt stack research doc (G-47) - research only, no build.
9. W9 Ask insider-LLM (F-42) - full-data access.
10. W10 Copy cut 35% + emoji strip (K-75/78).
11. W11 Keywords rally-database polish (H-54).
12. W12 Wix durable mapping foundation (C-24, I-62, I-66) - background workstream.
