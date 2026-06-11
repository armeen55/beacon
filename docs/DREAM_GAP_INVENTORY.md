# The Dream-Gap Inventory — every named thing between today's Beacon and "one brain, three businesses, twenty minutes a day, zero hardcoding" (2026-06-10)

**The dream, restated as testable claims:** (1) the engine learns each business's entire world from scratch; (2) it runs growth while you sleep; (3) every morning it hands you a short queue of exact moves with receipts; (4) one approve click ships end-to-end; (5) the three businesses teach each other through one brain; (6) nothing is hardcoded; (7) your total involvement is ~20 min/day.

**STATUS UPDATE — 2026-06-11 night shift (see `docs/P0_WALLS_LEDGER.md` + `docs/NIGHT_SHIFT_LOG.md`):**
DONE: #16 #17 (scan fleet DB-driven, Iranopedia crawled nightly) · #24 (competitor auto-seed) · #35+#67 (per-tenant content rules + factory injection) · #42/#108 (nightly generation cron, live) · #100-as-v1+#101 (edit-rate learning + digest line) · #111 (nightly url-map re-sync) · #114+#49 (queue sweeper: TTL+cap, new `expired` status) · #119 (tenant switcher + owner memberships for all 3) · #120 (digest built; WAITING FOR OPERATOR: RESEND_API_KEY) · #98+#99 (page-shape layer, gated on BEACON_CROSS_TENANT_BRAIN — ON for runner jobs).
PARTIAL: #4 (factory surfaced; blog/media still WIRE) · #55 (10 more action types draft deterministically via promotion enrichment) · #43/#44 unchanged · #116 (watchdog now covers scan+generation+poll per tenant; per-tenant alert routing remains).
ALSO FIXED (not in the original 178 — found by the night shift): citation_evidence_index + answer_intelligence_index were GLOBAL singletons blending all tenants (now per-tenant, migrations applied); seven process-global store caches cross-pinned tenants in warm processes (all per-tenant now); the isolation ratchet learned the `const repo =` call shape and watches 6 more getters (allowlist: seed-data aggregator frozen for a daylight refactor).

**Honest scope note:** every item below is a real, distinct unit of work verified against the code this session (receipts where they pin to a file). Tags: **[BUILD]** new code · **[WIRE]** exists but unreachable/unconnected · **[DATA]** needs data/keys/config · **[FLAG]** env activation · **[DECIDE]** product decision · **[HARDCODE]** de-Ritzing · **[INFRA]** platform ceiling. `A#n` cross-refs the 51-issue audit (`AUDIT_50_MULTI_TENANT.md` / fix ledger). Items already FIXED in the ledger are not repeated.

---

## P0 — The seven walls (read these first; everything else is their bricks)

1. **The queue does not refill while you sleep.** Trigger→score→promote generation is operator-click only (diagnostics surface); no schedule anywhere (`daily-scan.yml` runs the MATCHER, not generation). Claim (2) fails today for all three businesses. [BUILD]
2. **The decide-layer is blind for any tenant but Ritz.** The scan matrix reads `ops/active-tenants.json` — Ritz only — so Iranopedia/Finglish have no page snapshots; 14 of 16 triggers need them. No crawl → no surgical queue. [DATA+BUILD]
3. **Drafting covers 3 of 19 action types.** Generators exist for add-faq, add-h2-section, edit-title only (`providers/generators/`); the dream's "merge these two thin pages," "refresh this 2019 page," "build this 40-page cluster" have NO draft path (merge/refresh/split/cluster have no generator; the LLM specific-edit gateway has no production caller). [BUILD]
4. **The factory and half the Wix adapter are unreachable.** `generateClusterCards`, `wixCreateDraftPost`, `wixImportMedia` have ZERO callers in the product (verified). The cluster path, blog path, and media path exist as code, not as product. [WIRE]
5. **The brain cannot do the dream's signature trick.** Cross-tenant patterns are keyed BY SEGMENT (deliberately, for isolation) — "a page-shape that wins for Ritz transfers to Iranopedia" requires a vertical-AGNOSTIC abstraction layer (page-shape features: answer-first intro, FAQ block, table, schema type) that does not exist. The dream's proof-of-no-hardcoding is architecturally prevented right now. [BUILD+DECIDE]
6. **Nothing reaches you.** No email/SMS/notification of any kind (verified zero delivery infra); the morning brief is computed on page load, not delivered; poll-failure alerts go to GitHub issues. "Approve over coffee" requires you to remember to open the app. [BUILD]
7. **Learning from you doesn't exist.** `verified_live_modified` stores your edits; nothing consumes the delta (verified: consumers treat it as a status only). The "it learns your taste until your edit rate drops" loop is unimplemented. [BUILD]

---

## A — SENSE: "knows what people are asking AI" (claims 1, 2)

8. Google AI Overviews / AI Mode sensing — no poller; for local + consumer queries this is the largest answer-engine surface. [BUILD]
9. Gemini poller — `cron-poll.ts:73` accepts only `perplexity|openai`. [BUILD]
10. Claude-as-engine poller (claude.ai answers) — absent. [BUILD]
11. Copilot/Bing poller — absent. [BUILD]
12. Per-platform poller plug-in seam — adapters are bespoke; adding engine N is a fork-and-edit, not a registry entry. [BUILD]
13. Prompt-volume signal (which questions are ASKED most) — native polling measures answers, not demand; Semrush/GSC partially proxy; no unified demand rank. [BUILD]
14. Prompt refresh/rotation — tracked_prompts are static after seeding; no loop retires dead prompts or adds emerging ones from fan-out/search-queries data. [BUILD]
15. Prompt auto-generation from sensed data (fan-outs, PAA, GSC queries) into tracked_prompts — generator exists for onboarding only (`prompt-generator.ts`); no continuous loop. [WIRE+BUILD]
16. Scan matrix must read the tenants table (like the poll does), not `ops/active-tenants.json`. (A#40) [BUILD]
17. Iranopedia added to the scan fleet (today: file has Ritz only — verified). [DATA]
18. Per-tenant crawl budget/caps (a 5,000-page encyclopedia vs an 80-page builder site need different crawl ceilings). [BUILD]
19. JS-render fallback for tenant sites the raw fetch can't read (the Wix test passed for Iranopedia, but claim (1) says ANY site — SPA tenants get an empty inventory silently). [BUILD]
20. GSC connection for Iranopedia — the resurrection chart ("flatline bends up") REQUIRES it; token exists for Ritz only. [DATA]
21. GA4 (or equivalent) for Iranopedia — outcome half of the loop. [DATA]
22. Scheduled connector refresh — `refresh-all` is an operator click; nightly GSC/GA4/CallRail/Semrush pulls don't happen while you sleep. [BUILD]
23. GSC first-ever sync for Ritz (token connected 2026-05-19, never synced — verified in the connector audit). [DATA]
24. Competitor-universe seeding for new tenants — discovery exists from citations (`discover.ts`) but nothing writes discovered rivals into `competitor_config` automatically. [WIRE]
25. Competitor-intel refresh on a schedule (sitemap crawl + page fetch is an operator click on `/diagnostics/competitor-intel`). [BUILD]
26. Per-engine answer-text capture wired for analysis — `answer-texts` store exists (GLOBAL); per-tenant scoping + consumption in forensics ("real quotes") unbuilt. (A-follow-up) [WIRE+HARDCODE]
27. Bot/crawler-hit sensing per tenant (the "ChatGPT bots spiked within days" receipt) — log-based crawler analytics absent; only citations measured. [BUILD]
28. Indexation sensing for new pages (GSC URL-inspection exists for Ritz-era flows; not wired into post-push verification of created pages). [WIRE]
29. Sitemap auto-discovery + monitoring for the TENANT's own site (exists for competitors only). [BUILD]
30. Uptime/staleness watchdog per tenant per source (the freshness heartbeat is Ritz-era single-tenant copy). [BUILD+HARDCODE]

## B — UNDERSTAND: "learns each one's entire world from scratch" (claim 1)

31. Automated onboarding chain: domain → crawl → topic/service inference → prompt seed → competitor discovery → segment inference — exists as disconnected pieces; no orchestrated "first 24 hours" pipeline. [BUILD]
32. Segment inference or picker in onboarding (provisioning now defaults neutral; nothing ever SETS the real segment). (A#22) [BUILD]
33. Topic-model per tenant — topics are prompt `topic_id` strings; no derived topic map of the tenant's whole site (the encyclopedia's hundreds of topics vs the builder's ~6 services). [BUILD]
34. Page-role classification beyond builder vocab — `pages/classify.ts` city/service patterns are builder-shaped; an encyclopedia needs entry/category/glossary/listicle roles. [HARDCODE+BUILD]
35. Per-tenant content-rules store ("Persian never Farsi", word counts per type) — rules exist only as per-cluster arguments I typed; a stranger can't define theirs. (A#48) [BUILD]
36. Per-tenant brand-assertion vocabulary — `brand-assertions.ts` is builder-framed. (A#39) [HARDCODE]
37. Multilingual awareness — extraction stopwords, tokenizers, descriptor mining are English-only; Iranopedia's Persian-language content and transliteration (Finglish!) are invisible to the text layer. [BUILD]
38. Existing-content quality baseline at onboarding (which pages are thin/stale/duplicated — the input to "surgical") — page-issues exist Ritz-era; needs to run per tenant post-crawl automatically. [WIRE]
39. Historical import for non-Profound tenants (Iranopedia's 30K-citation history lives outside Beacon; no generic CSV/GSC-history import for a new tenant's past). [BUILD]
40. Business-config self-serve editing (settings form exists Ritz-era; per-tenant write path for a stranger unverified/unpolished). [WIRE]
41. Key-pages inference (the `keyPages` config field is hand-typed; should derive from crawl + traffic). [BUILD]

## C — DECIDE: "a short queue of exact moves" (claim 3)

42. Scheduled nightly generation pipeline per tenant: scan-delta + citations + GSC → triggers → score → dedupe → promote → queue (the P0-1 wall, itemized): a cron entry + a tenant-matrix generation job + idempotency. [BUILD]
43. Merge/consolidate detector ("two thin city pages bleeding into each other") — no trigger computes content-overlap/cannibalization across the tenant's own pages. [BUILD]
44. Stale-content detector ("this 2019 page") — no trigger reads content age/last-modified vs topic volatility. [BUILD]
45. Prune/noindex recommender (resurrections require cutting dead weight; no trigger proposes removal — and the push layer correctly forbids deletes, so this needs its own explicit approval flow). (A#29-adjacent) [BUILD+DECIDE]
46. Cluster-opportunity planner ("40-page Persian-phrase cluster nobody is answering") — cluster PLANS are hand-written objects; no engine derives cluster candidates from prompt-gap × competitor-absence × demand. [BUILD]
47. Internal-linking planner (add_internal_link is an action type with no generator and no cross-page link-graph analysis). [BUILD]
48. Queue prioritization across MOVES of different kinds (today: per-rec scoring exists; no unified expected-value ranking across edit/create/merge/prune for the morning's top-N). [BUILD]
49. Queue sizing/cadence control ("short queue" — no per-tenant daily queue cap or freshness window; the queue is an unbounded list). [BUILD]
50. Receipts ON the card — evidence exists in packets/diagnostics; the queue card shows label+why but not the one-line receipt chain (asked-by-AI volume, competitor cited instead, GSC decline) the dream describes. [BUILD]
51. Cross-source receipts join (Semrush keyword + Profound-style prompt + GSC decline on ONE card) — sources exist; the join surface doesn't. [BUILD]
52. Per-engine targeting in decisions ("this page-shape for ChatGPT, that for Google") — outcome data isn't split per engine in scoring. [BUILD]
53. Seasonal/temporal triggers (Nowruz pages before Nowruz) — no calendar-aware trigger. [BUILD]
54. Dismissal-reason learning — dismiss exists; the WHY isn't captured or learned from. [BUILD]
55. 19−3 = 16 action types lack generators: add_answer_block, add_table, edit_table_row, add_proof_section, add_comparison_section, add_cost_section, add_timeline_section, add_internal_link, add_schema, fix_schema, reorder_sections, split_page, merge_pages, create_page (deterministic), update_intro, add_image_alt_text, rewrite_faq, edit_meta. Each is its own slice (some deterministic, some LLM). [BUILD ×16]
56. The LLM specific-edit gateway (packet-based, hardened) still has NO production caller — the highest-quality drafting path is idle. (Long-standing S6) [WIRE]
57. The promotion dry-run default — live-write to the customer queue is operator-gated/env-shaped; the autopilot needs it on per tenant with guardrails. [FLAG+DECIDE]

## D — DRAFT: content the dream would actually ship

58. AEO-grade page generation: factory emits flat text fields — no FAQ schema block, no JSON-LD, no answer-first structure, no internal links, no images. (A#50) [BUILD]
59. Image pipeline entirely absent: selection from tenant media, generation, alt-text, upload (wixImportMedia unwired). [BUILD+WIRE]
60. Wix richContent format support (client sends `contentText` only; real Wix posts/pages want structured rich content). [BUILD]
61. Grounding/fact-check pass for generated claims (prompt-level instruction only; no retrieval-grounded verification before a card becomes pushable). (A#49) [BUILD]
62. Citation/source attachment on generated content ("citations where claimed" rule has no mechanism). [BUILD]
63. Tenant voice/style conditioning (no per-tenant style examples fed to generation; Iranopedia voice ≠ Ritz voice). [BUILD]
64. Title/meta generator wiring for edit_meta/edit_title at LLM quality (edit-title generator is deterministic template). [BUILD]
65. Refresh-rewrite generator (rewrite a stale page section preserving facts + structure) — none. [BUILD]
66. Merge-draft generator (combine two pages into one, with redirect plan) — none; also needs the URL-change approval flow the caps forbid. [BUILD+DECIDE]
67. Per-cluster → per-tenant default content rules injection (factory takes rules per call; should pull from the per-tenant store, #35). [WIRE]
68. Draft cost budgeting per tenant per day for generation (per-run cap exists; daily generation ledger enforcement not wired — infra now exists from the poll cap). (A#33) [WIRE]

## E — SHIP: "it ships end-to-end" (claim 4)

69. Wix blog publishing path in push-service (`wixCreateDraftPost`/publish unwired — create_page handles CMS items only). [WIRE]
70. Wix media attach on create/edit (hero images on new pages). [WIRE+BUILD]
71. Wix dynamic-page binding check for created items (item without a bound dynamic page = invisible page reported as shipped). (A#28) [BUILD]
72. Wix collection LIST API (operator pastes collection GUIDs; the adapter should enumerate collections + fields). [BUILD]
73. Wix url-map: verify derived URLs actually 200 before marking pushable. (A#24) [BUILD]
74. Wix url-map pagination >1000 items (encyclopedia-scale collections). [BUILD]
75. Wix rate-limit/backoff per tenant key. (A#46) [BUILD]
76. Wix OAuth app instead of raw API key paste (self-serve trust + scoped permissions). (A#14-adjacent) [BUILD+DECIDE]
77. git/Vercel adapter — THE Finglish ship path: repo+token connector, branch, content-file write (MDX/TSX?), PR open, merge policy, deploy verify. Entirely unbuilt (dev-note stub). [BUILD]
78. Finglish repo conventions decision (where content lives, file format, routing) — prerequisite to #77. [DECIDE]
79. WordPress adapter (the dream says "whatever they're on"; WP is the biggest CMS on earth). (A#23) [BUILD]
80. Webflow/Shopify/other adapters — per-platform. (A#23) [BUILD]
81. Adapter capability registry (which targets support create/edit/blog/media/redirects) so the decide-layer only proposes shippable moves per tenant. [BUILD]
82. Pre-push snapshot + one-click rollback. (A#29) [BUILD]
83. Optimistic concurrency on Wix item updates (revision check). (A#26) [BUILD]
84. Batch approve → capped batch push UX (cards push one-by-one today). [BUILD]
85. Redirect management for merge/prune (forbidden by caps today — needs its own explicit approval class). [BUILD+DECIDE]
86. Push-ledger durability on Vercel (json best-effort; Supabase mirror for caps math). (A#27/#42) [BUILD]
87. Ritz ticket DELIVERY: the dev-notes page exists; "hands the dev team a stack every morning" needs export/routing (email/Slack/Linear/GitHub-issue per ticket) + schedule. [BUILD]
88. Ritz ticket acknowledgement loop (did the dev ship it? today the scanner infers; an explicit ticket-status round-trip would close the loop faster). [BUILD]

## F — VERIFY & MEASURE: receipts and the bending chart

89. `BEACON_LIFECYCLE_ENABLED` default OFF — the automatic verify-live matcher (pushed→verified, outcome clocks) is gated; must be on per environment for autopilot. [FLAG]
90. Verify-live for CREATED pages (matcher matches edits on existing inventory; new-URL verification needs the crawl to pick up the page + indexation check). [BUILD]
91. Probe robustness (Wix propagation lag mislabels "pending"; retry-with-backoff probe). (A#25) [BUILD]
92. GSC time-series surface for the resurrection chart (impressions/clicks per page over time, annotated with shipped moves) — the money visual; GSC search-analytics pull exists Ritz-era, the annotated chart doesn't. [BUILD]
93. Per-engine outcome split (citations by engine per page over time → feeds #52). [BUILD]
94. Outcome attribution for created-from-scratch pages (Mode A keys on live_at; fine — but baseline-less new pages need the "first citation ever" framing wired to the morning receipts). [WIRE]
95. Multi-tenant canary + R4 verify (canary is single-tenant-by-design; check-yesterday-poll is tenant-agnostic — per-tenant health rows + per-tenant alert routing). (A#43) [BUILD]
96. Anomaly detection on shipped content (post-push traffic/citation DROP alarm → auto-flag for rollback). [BUILD]
97. Weekly per-tenant scorecard artifact (the "receipts attached" rollup; exists as scattered surfaces, not a single artifact). [BUILD]

## G — LEARN: "one brain, they teach each other" (claim 5)

98. Vertical-agnostic page-shape feature extractor (FAQ-block present, answer-first intro, table, schema types, word-count band, heading pattern) — the abstraction that makes cross-business transfer possible. [BUILD]
99. Cross-SEGMENT pattern layer keyed on those abstract features (deliberately separate from the segment-scoped keys, which stay for vertical-specific patterns). [BUILD+DECIDE]
100. Inner loop: learn from `verified_live_modified` text deltas (store prompt/draft/final triples → few-shot or rule extraction → next drafts closer to approved). (P0-7) [BUILD]
101. Edit-rate metric per tenant (the "my edit rate dropped" proof). [BUILD]
102. Outer loop activation: the brain producer + Move Forecast are gated and data-starved (need ≥2 tenants WITH outcomes; Iranopedia has zero shipped edits). [DATA+FLAG]
103. Per-engine page-shape learning ("Google rewards utility pages, ChatGPT local-intent") — systematize the by-hand discovery into per-engine pattern stats. [BUILD]
104. Dismissal/approval signal into scoring (#54 feeds here). [BUILD]
105. Pattern → trigger feedback (a winning pattern should RAISE the score of matching candidates automatically; today patterns surface as evidence text only). [BUILD]
106. Brain privacy scrubber adversarial test pass before real strangers join the pool. (A#9) [BUILD]
107. Forecast surfacing on the morning card ("N similar moves, X% helped, ~D days") — composer exists (move-forecast.ts), no card surface. [WIRE]

## H — AUTOPILOT: "while you sleep" (claim 2)

108. Nightly per-tenant generation job (P0-1; the single biggest missing cron). [BUILD]
109. Nightly connector refresh job (GA4/GSC/CallRail/Semrush per tenant). (#22) [BUILD]
110. Scheduled competitor-intel refresh. (#25) [BUILD]
111. Scheduled wix url-map re-sync (new CMS items appear; map staleness breaks pushes). [BUILD]
112. Scheduled citation-evidence + answer-intel index rebuilds per tenant (rebuild exists; per-tenant scheduling/coverage verify). [WIRE]
113. Scheduled brain recompute at n≥2-with-outcomes. [WIRE]
114. Queue-staleness sweeper (expire/refresh cards whose evidence aged out). [BUILD]
115. Per-tenant scheduling config (a dying site wants daily; a stable site weekly). [BUILD]
116. Job observability per tenant (which nightly steps ran/failed per business — the GitHub-issue alert is repo-global). (A#43) [BUILD]
117. Off-GitHub-Actions execution path for the fleet (minutes ceiling ≈ 2 tenants on free tier; Vercel cron / queue / worker decision). (A#32) [INFRA+DECIDE]

## I — THE 20 MINUTES: the morning ritual (claims 3, 7)

118. Unified cross-tenant morning queue (one surface: all three businesses' top moves; today: per-tenant /recommendations + operator wix console). [BUILD]
119. Tenant switcher UI (cookie seam exists from the middleware fix; nothing sets it — verified zero UI). [BUILD]
120. Morning email/notification with the queue + one-click through to approve (zero delivery infra exists — verified). (P0-6) [BUILD]
121. Approve-from-card for ALL move kinds in one place (push lives on the operator wix console; recommendations approve doesn't push). [BUILD]
122. Batch approve. (#84) [BUILD]
123. Mobile-usable approval surface (coffee ≠ desk). [BUILD]
124. Receipts rendering on cards. (#50) [BUILD]
125. "What happened yesterday" digest strip (shipped → verified → first outcomes). [BUILD]
126. Operator-vs-customer surface unification per role (diagnostics/* are operator-flag-gated; a tenant owner needs THEIR versions of connect/push/intel — the per-tenant publish auth landed; the surfaces themselves still 404 without the global flag because the PAGES check `isOperatorModeServer`). [BUILD]
127. Time-to-approve instrumentation (prove the 20 minutes). [BUILD]

## J — THE THREE ARCS: per-business punch lists

**Iranopedia (resurrection):**
128. Wix API key + site id pasted. [DATA]
129. Collection mappings + url-map sync (then #72/#73 make it humane). [DATA]
130. Add to scan fleet (#17) → page inventory → triggers live. [DATA]
131. GSC property connect (#20) → the flatline baseline. [DATA]
132. Persian-phrase cluster plan as the first factory run (cluster planner #46 or hand-plan v1). [DATA+WIRE]
133. Merge/refresh moves for the thin/stale city pages (#43/#44/#65/#66). [BUILD]
134. Persian-language text handling in extraction (#37). [BUILD]
135. Content-rule store entry (Persian-never-Farsi etc.) (#35). [DATA]
136. The resurrection chart (#92). [BUILD]

**Finglish (launch-already-cited):**
137. Real domain decision + tenant activation (currently pending_onboarding with placeholder domain — deliberate). [DECIDE+DATA]
138. Repo + token + conventions (#77/#78). [DECIDE+BUILD]
139. Launch footprint plan: which 20–40 pages earn citations pre-launch (cluster planner against language-learning prompts). [BUILD+DATA]
140. Prompt seed for language-learning intent (generator exists; needs Finglish inputs). [DATA]
141. Waitlist/site integration decisions (where content lives relative to the app). [DECIDE]
142. PR→deploy→verify loop on the real repo (the adapter's first live test). [BUILD]

**Ritz (the job, run by a machine):**
143. Morning ticket delivery channel + schedule (#87). [BUILD]
144. Ticket round-trip status (#88). [BUILD]
145. Queue generation scheduled (#108) so the stack is fresh daily. [BUILD]
146. Ads/HubSpot signals — explicitly OUT per current invariants; the dream's Ritz arc is content/AEO tickets only until you decide otherwise. [DECIDE]

## K — ZERO-HARDCODING RESIDUE (the named survivors of the 91-file sweep, post-fixes)

147. `GEO_CONTAINMENT` + derived `ALL_CITIES` (attribution/config.ts:61; pages/classify.ts) — Bay-Area map in attribution + page classification. [HARDCODE]
148. `CITY_ALIASES` (geo/normalize.ts:13). [HARDCODE]
149. `BAY_AREA_CITIES` (recommendation-title-humanizer.ts:249) — display humanizer. [HARDCODE]
150. `SERVICE_KEYWORD_MAP` defaults + `TOPIC_ADJACENCY` builder topics (query-index.ts:295; opportunity-candidates/builders.ts) — self-degrading but builder-flavored. [HARDCODE]
151. `pages/classify.ts` CITY_PAGE_PATTERN + builder page-roles (#34). [HARDCODE]
152. `builder-benchmark.ts` — the market benchmark is literally builder-named/shaped. [HARDCODE]
153. `brand-assertions.ts` builder vocab (#36). [HARDCODE]
154. Extraction descriptor stopwords builder words (harmless noise for others; still vocab debt). [HARDCODE]
155. `morning-brief.ts` Ritz-era assumptions (sections/copy). [HARDCODE]
156. `keyword-gap-scanner`, `frontier-planner/compiler`, `page-job-fit`, `today-primary-decision-copy`, `evidence-tier` — Ritz-era heuristics flagged in the 91-file sweep; each needs a config pass or segment gate. [HARDCODE ×5]
157. `ops/active-tenants.json` Ritz hard-guard in workflows. (A#40) [HARDCODE]
158. `prompt-library` + `answer-texts` GLOBAL stores → tenant-scope. (A-noted) [HARDCODE]
159. `seed-data.ts` demo content Ritz-flavored (sample workspace). [HARDCODE]
160. vitest env pins tenant-ritz-founder (fine for tests; listed for completeness as intentional). [HARDCODE-OK]
161. Founder-fallbacks in tenant-features/business-config (intentional, documented; revisit when Ritz is "just a customer"). [HARDCODE-OK]
162. Remaining ~140 of the 163 ritz-string references — sweep each: legit fixture/comment vs load-bearing (the ratchet + this list cover the known load-bearing ones; the sweep is the long tail). [HARDCODE]

## L — PLATFORM / INFRA / SECURITY CEILINGS

163. DB-level RLS rewrite (auth.uid + tenant_members policies) — the permanent #A1 fix; the ratchet is the interim. [INFRA]
164. Connector-token encryption at rest. (A#14) [INFRA]
165. Tenant delete/retention/export (GDPR/CCPA; live keys persist after cancel). (A#45) [INFRA+BUILD]
166. Vercel-FS-safe persistence for the remaining json-only stores (url-map, collection-config, push-ledger, scan-state...). (A#42) [INFRA]
167. Fleet execution off GH-minutes. (#117/A#32) [INFRA]
168. Same-day-collision audit for every uniqueness-indexed dual-write table (the June-3 pattern). (A#41) [BUILD]
169. Per-tenant Wix/Google/API quota isolation (one tenant's 429s shouldn't starve another's jobs). [BUILD]
170. Secrets rotation story (keys pasted once, never rotated/expired). [INFRA]
171. Audit log of operator/user actions (who approved/pushed what, when — exists only as push-ledger for pushes). [BUILD]
172. Billing — explicitly out of scope by invariant; the dream says nothing about charging, listed as the eventual gate to "anyone." [DECIDE]

## M — TRUST AT AUTOPILOT SCALE (what keeps the dream from shipping slop)

173. Grounding verification before pushable (#61) — the single most important content-trust item once volume rises. [BUILD]
174. Per-tenant banned/required term stores feeding the factory's hard-reject (#35/#67). [BUILD]
175. Post-push anomaly alarm + rollback path (#96/#82). [BUILD]
176. Human-sampling policy at scale (e.g., auto-ship only after N approved-without-edit in a category — the leash-loosening rule, explicit). [DECIDE+BUILD]
177. Dry-run preview rendering of a card's resulting page (see the page before approving, not JSON). [BUILD]
178. Locked copy-discipline checks (no causal verbs, no fabricated stats) as validators on generated content, mirroring the outcome-surface vocab invariant. [BUILD]

---

## The honest tally

**178 numbered items** (a handful are ×N bundles — the 16 missing generators alone are 16 real slices — so the true unit-of-work count is ≈ **200–210**). That is the complete, receipts-grounded distance to the dream as the codebase stands tonight. Not 500 — I won't pad; everything here is real and distinct, and nothing real was left out.

**Distribution:** ~55% [BUILD], ~12% [WIRE] (already written, just unreachable — the cheapest wins), ~10% [DATA/FLAG] (keys, rows, env), ~12% [HARDCODE], ~8% [INFRA], ~5% pure [DECIDE].

**The shortest path that makes the dream FEEL true (the demo-able core, in order):**
1. #17+#16 — Iranopedia into the scan fleet → its inventory exists.
2. #108 — the nightly generation cron → queues refill while you sleep.
3. #128–131 — Wix key + mappings + GSC → Iranopedia ships and charts.
4. #4-WIREs (#69/#59-min/#56) + 3–4 generators from #55 (refresh, answer-block, schema, internal-link) → the queue gets surgical.
5. #118–121 + #120 — the unified morning queue + the email → the coffee ritual exists.
6. #98–100 — the abstract page-shape layer + the inner loop → "one brain" stops being a metaphor.

Everything else is compounding depth behind those six.
