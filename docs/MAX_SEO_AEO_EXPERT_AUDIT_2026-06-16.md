# Beacon Max SEO/AEO Expert Audit - 2026-06-16

Goal: identify 500 concrete gaps between current Beacon and a top-tier SEO/AEO expert, then pair every gap with the step that would close it. This is not a bug list only. It is a product, data, workflow, UX, safety, and expertise audit for the goal: connect sources once, pull the maximum truth, produce evidence-backed recommendations, let Armeen approve, publish safely to Wix, and prove what worked.

Current codebase reviewed at local `main` after fast-forward to `origin/main` (`c45ed80` at audit start). Existing grounding docs reviewed: `docs/HANDOFF_VERIFIED_STATE.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/DOMAIN_AUDIT_FINDINGS_2026-06-14.md`, and `docs/UX_TEARDOWN_2026-06-15.md`.

Source base for standards and API assumptions:

- Google Search Central SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Google helpful content guidance: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google structured data docs: https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
- Google Search Console Search Analytics API docs: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- Google Search Console URL Inspection API docs: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- GA4 Data API docs: https://developers.google.com/analytics/devguides/reporting/data/v1
- Wix Data REST docs: https://dev.wix.com/docs/rest/business-solutions/cms/data-items
- Wix Data Collections REST docs: https://dev.wix.com/docs/rest/business-solutions/cms/data-collections
- Wix SEO settings and variables docs: https://support.wix.com/en/article/wix-seo-using-variables-in-your-seo-settings
- Semrush API docs: https://developer.semrush.com/api/
- Microsoft Clarity docs: https://learn.microsoft.com/en-us/clarity/
- OpenAI crawler docs: https://platform.openai.com/docs/bots
- Robots Exclusion Protocol RFC 9309: https://www.rfc-editor.org/rfc/rfc9309
- Internal connector research: `docs/CONNECTOR_AUTOMATION_MAP.md`, `docs/GOLDEN_PATH_SETUP.md`, `docs/FUSION_ROADMAP_2026-06.md`

Important stance: "10x expert" does not mean zero-touch publishing. For Iranopedia, expert-grade means the system is more thorough than a consultant while staying review-gated, provenance-rich, factual, and reversible.

## Top 25 P0 / P1 Gaps

1. P0 - Wix URL map and collection config are still file-store backed in `src/lib/connectors/wix/url-map.ts`; hosted durability is not expert-grade until moved to Supabase.
2. P0 - A content edit can be live-proven now, but broad Wix field-role mapping is still manual and collection-by-collection.
3. P0 - Recommendations can still reflect AEO-first wording and "0 AI answers" even when GSC says pages have real demand.
4. P0 - GSC is connected, but property selection/backfill/freshness is still a product chore, not a sealed loop.
5. P0 - GA4 row pagination is still capped at 10,000 rows in `src/lib/connectors/ga4/data-api.ts`; large sites will silently undercount.
6. P0 - Profound replaces native polling, but the app is dependent on external category setup and a capped 10-category sync.
7. P0 - Crons are intentionally off; the "daily expert" behavior depends on manual refresh unless a safe scheduler is rebuilt.
8. P0 - LLM draft quality is not guaranteed unless `BEACON_LLM_PROVIDER=openai` and validated draft persistence are fully enabled.
9. P0 - The UI still exposes internal operator concepts and old product assumptions in comments, diagnostics, and some copy paths.
10. P0 - Ranking still uses handcrafted severity tables, not calibrated learnings from actual Iranopedia outcomes.
11. P1 - A human SEO expert would inspect rendered Wix pages; Beacon still relies heavily on snapshots and can produce shell-capture false positives.
12. P1 - Search opportunity scoring lacks a full query-intent, SERP-feature, and content-effort model.
13. P1 - AEO answer-block recommendations are still mostly directives; they do not yet generate source-backed factual answer drafts for Iranopedia.
14. P1 - Entity disambiguation for Persian/Iranian people, places, foods, transliterations, and history is not yet a first-class domain layer.
15. P1 - Structured data is not yet deeply domain-aware for recipes, products, articles, people, places, breadcrumbs, and collections.
16. P1 - No expert-grade editorial citation system exists for historical/cultural claims.
17. P1 - No per-change outcome receipt is consistently shown as a first-class artifact across Recommendations and Changes.
18. P1 - No search-demand-to-Wix-field binding wizard exists; today it is still engineer/operator mediated.
19. P1 - No automatic safe "propose, dry-run, proof, approve, publish, verify, rollback" happy path for every eligible card.
20. P1 - No screenshot/render verification is attached to recommendations before pushing.
21. P1 - No competitor content-diff and SERP-diff loop is integrated into the ranking surface.
22. P1 - No cost, quota, and stale-source dashboard exists for Semrush/Profound/GSC/GA4/Clarity/Wix together.
23. P1 - No real content calendar / cluster roadmap exists for Iranopedia's long-term revival.
24. P1 - No hard separation yet between "hackathon demo mode" and "real Iranopedia operator mode."
25. P1 - The app is powerful, but it still needs a single Golden Path UI that proves "expert system" without reading docs.

## 500 Gap-To-10x Matrix

### A. Product Thesis, Scope, And Expert Workflow

001. Gap: Beacon still reads like an AEO tool in key surfaces. Step: rename every user-facing frame around SEO plus AEO plus publishing plus proof.
002. Gap: The product promise is not visible in one sentence. Step: add an app-wide north-star: "evidence-backed site improvements, approved by you, pushed safely."
003. Gap: The workflow is split across Today, Recommendations, Settings, Diagnostics. Step: create one Golden Path command center.
004. Gap: Diagnostics do product-critical work. Step: graduate connector refresh, promotion, Wix mapping, and proof recompute into normal UI.
005. Gap: Expert consultants give an audit plan first. Step: show a ranked "site revival plan" with phases, effort, and evidence.
006. Gap: Beacon lists tasks before explaining strategy. Step: add strategic goals per tenant: traffic recovery, AI citations, content coverage, monetization.
007. Gap: Recommendations lack a visible expert rationale hierarchy. Step: display "why now", "why this page", "why this change", "risk", and "proof plan".
008. Gap: The UI shows "Needs more evidence" too often. Step: convert uncertainty into exact missing inputs and next data action.
009. Gap: A human expert triages false positives. Step: add a "not a real issue" feedback loop that suppresses similar future cards.
010. Gap: Expert process starts with baseline. Step: create a baseline snapshot: indexability, GSC, GA4, Clarity, Semrush, Profound, Wix map.
011. Gap: Expert process has timelines. Step: add 7-day, 30-day, 90-day expected outcome windows per card.
012. Gap: Expert process separates quick wins from strategic bets. Step: classify each card as quick win, fix, refresh, new content, experiment, infrastructure.
013. Gap: Expert work includes opportunity cost. Step: score what Beacon is not recommending and explain why.
014. Gap: Current queue is row-centric. Step: group cards into campaigns: Kabobs meta, Persian names refresh, rugs cluster, internal links.
015. Gap: The system lacks a "do not touch" policy surface. Step: add protected pages, protected fields, and protected content categories.
016. Gap: Operator-only and customer surfaces blur. Step: audit every `/diagnostics/*` dependency and expose only necessary controls.
017. Gap: Crons-off reality is not productized. Step: either rebuild safe automation or make on-demand refresh a first-class daily habit.
018. Gap: The app does not yet teach the owner what changed. Step: add daily changelog receipts in plain English.
019. Gap: Expert tools show progress over time. Step: add revival scoreboard: clicks recovered, pages improved, AI citations gained, issues closed.
020. Gap: Recommendations still feel isolated. Step: tie each card to a business or editorial objective.
021. Gap: No "expert confidence" calibration is visible. Step: show high confidence only when at least two independent signals agree.
022. Gap: No "do nothing" advice. Step: add explicit abstain recommendations for pages that are already good.
023. Gap: No "watch this" lane from real sources. Step: add watchlist for high-demand pages with insufficient evidence.
024. Gap: No deadline or cadence. Step: add daily operating loop: refresh, review top five, approve one, verify, measure.
025. Gap: The UI hides the product's biggest achievement: live safe Wix push. Step: show a "Wix push-ready" checklist on every card.
026. Gap: Expert audits inspect the whole site first. Step: generate a site inventory with page type, data availability, pushability, and priority.
027. Gap: Beacon's promise is not vertical-neutral enough. Step: replace residual builder/service assumptions with content-site/entity-site language.
028. Gap: Product still references old artifacts in docs. Step: split historical docs from active operating docs.
029. Gap: The current "max automation" story is buried in `docs/GOLDEN_PATH_SETUP.md`. Step: surface it inside onboarding and Today.
030. Gap: There is no "source of truth" page for what each connector can do. Step: build connector capability matrix in-app.
031. Gap: The app can look broken when one source is missing. Step: make partial-data mode explicit and useful.
032. Gap: The owner cannot easily tell "real data" from "derived estimate". Step: mark first-party, third-party, behavioral, AI-answer, and crawl evidence.
033. Gap: Expert systems explain assumptions. Step: attach assumptions to every score.
034. Gap: Expert systems retain memory. Step: store decisions, overrides, and outcomes as training signal.
035. Gap: The app lacks a kill switch per recommendation family. Step: add per-trigger enable/disable controls.
036. Gap: The app lacks a "today's safest move" claim. Step: compute and display one best low-risk, high-evidence action.
037. Gap: No "what not to do" section. Step: warn against high-risk SEO spam, thin pages, fake facts, and bulk publishing.
038. Gap: The hackathon demo path and real path are conflated. Step: create demo data mode that is visually branded as demo.
039. Gap: Expert consultants produce artifacts clients can share. Step: generate receipt cards for every accepted change.
040. Gap: Expert consultants manage stakeholder trust. Step: show pre-change state, proposed diff, safety checks, and rollback before publish.
041. Gap: No "site health debt" number. Step: create a transparent health score from crawl, index, content, evidence, and outcome signals.
042. Gap: The app lacks portfolio memory across sites. Step: keep single-user first, but design reusable lessons without leaking tenant data.
043. Gap: The user must know what to click. Step: add guided wizard when a connector is connected but not synced or configured.
044. Gap: No "why this beats an SEO expert" product narrative. Step: show breadth, freshness, proof loop, and one-click execution.
045. Gap: Expert review includes manual SERP inspection. Step: add a task type for "needs manual SERP look" instead of pretending certainty.
046. Gap: Expert review includes brand voice. Step: add an Iranopedia style guide and enforce it in drafts.
047. Gap: Expert review includes factual source review. Step: require source citations before factual content drafts are pushable.
048. Gap: Expert review includes legal/cultural sensitivity. Step: add sensitive-topic flags for history, religion, politics, identity, and health.
049. Gap: The app has no "learning from failure" loop. Step: when a change does not work, record why and demote similar future moves.
050. Gap: The product is still tool-shaped. Step: make it outcome-shaped: revive Iranopedia traffic and AI visibility.

### B. Data Ingestion, Connector Freshness, And Source Truth

051. Gap: GSC connected does not guarantee a property is selected. Step: add property picker and hard "not ready" state until selected.
052. Gap: GSC backfill defaults may miss full available history. Step: add operator-selectable 16-month backfill with progress and quota guard.
053. Gap: GSC final data lag is not visible enough. Step: display final vs fresh/incomplete windows on every GSC-derived card.
054. Gap: GSC rows can be zero due to wrong property shape. Step: verify URL-prefix vs domain property and show selected property.
055. Gap: GSC query data is page/query-heavy. Step: aggregate safely by canonical URL, query intent, country, device, and search appearance.
056. Gap: GSC evidence can overfit to 90 days. Step: allow 28, 90, 180, and 16-month comparisons with seasonality labels.
057. Gap: GSC "average position" can mislead. Step: show query-level position distribution and impression-weighted movement.
058. Gap: GSC CTR benchmarks are generic. Step: calibrate expected CTR from this site's own query history by position and device.
059. Gap: GSC opportunities lack SERP feature context. Step: mark whether query likely has AI overview, video, recipe, local, image, or shopping intent.
060. Gap: GSC data does not prove semantic quality. Step: fuse GSC with page content completeness and external sources before drafting.
061. Gap: GA4 is optional but not deeply integrated yet. Step: make GA4 page value part of ranking and proof receipts.
062. Gap: GA4 Data API caps at 10,000 rows. Step: add pagination, `rowCount` checks, ordering, and truncation warnings.
063. Gap: GA4 property selection is a multi-step chore. Step: show selected property, stream, timezone, and last successful data pull.
064. Gap: GA4 conversions are generic. Step: configure meaningful Iranopedia events: lesson clicks, shop clicks, outbound clicks, signups.
065. Gap: GA4 attribution can mislead. Step: separate landing-page value from session attribution and annotate limitations.
066. Gap: GA4 lacks content grouping. Step: derive content groups from Wix collection/page type and persist them.
067. Gap: GA4 engagement metrics are underused. Step: rank pages by engagement decay, not just traffic decay.
068. Gap: GA4 has no anomaly detection in UI. Step: alert on page traffic drops, spikes, and broken conversion paths.
069. Gap: GA4 data can be incomplete after consent blockers. Step: display analytics coverage confidence.
070. Gap: GA4 does not connect to approval receipts. Step: attach pre/post GA4 sessions and conversions to every shipped change.
071. Gap: Semrush key entry is not enough. Step: verify API plan, database, units, and supported endpoints after connect.
072. Gap: Semrush is directional not first-party. Step: mark Semrush metrics as estimates and rank below GSC when both exist.
073. Gap: Semrush keyword gaps can create duplicate content. Step: run topical overlap and canonical target checks before create-page recs.
074. Gap: Semrush competitor discovery is not automatic enough. Step: detect organic competitors per topic and compare against tracked competitors.
075. Gap: Semrush unit budgets can be burned accidentally. Step: add unit estimate, daily cap, and dry-run per sync.
076. Gap: Semrush API data can stale quickly. Step: show last pull date on every Semrush-backed card.
077. Gap: Semrush databases are country-specific. Step: route Iranopedia queries through correct regional databases and language assumptions.
078. Gap: Semrush backlinks/offsite authority are underused. Step: ingest backlinks/refdomains for citation/source authority opportunities.
079. Gap: Semrush cannibalization needs editorial clustering. Step: build canonical cluster decisions before recommending merges/links.
080. Gap: Semrush lacks direct GSC validation. Step: require GSC corroboration for high-risk title/content changes when possible.
081. Gap: Profound categories are external setup. Step: build a category readiness check and recommend missing categories.
082. Gap: Profound sync caps at 10 categories. Step: add paged category queue across refreshes with progress.
083. Gap: Profound rows are topic-scoped, not page-scoped. Step: map topics to best target pages using content inventory and GSC queries.
084. Gap: Profound evidence parser depends on detail strings. Step: persist structured fields for AEO gaps instead of parsing prose.
085. Gap: Profound data freshness is not fully known. Step: show observed data dates, pulled_at, and freshness confidence.
086. Gap: Profound visibility does not equal answer quality. Step: add answer-text snippets and citation-context review.
087. Gap: Profound competitors can be ambiguous. Step: normalize competitor entities, domains, aliases, and language variants.
088. Gap: Profound bot/referral reports need page-level fusion. Step: tie AI crawler hits and AI referrals to specific URL improvements.
089. Gap: Profound source domains are underused. Step: identify citation sources AI trusts and create source-acquisition tasks.
090. Gap: Profound API errors can hide behind no-data states. Step: split no key, expired key, no category, no rows, and API failure in UI.
091. Gap: Clarity has severe lookback limits. Step: accumulate daily snapshots and show historical coverage start date.
092. Gap: Clarity sampling can be noisy. Step: require session floors and confidence intervals.
093. Gap: Clarity friction is advisory. Step: attach session replay links or exact DOM selectors when available.
094. Gap: Clarity privacy configuration is not visible. Step: show masking/consent readiness before using behavioral data.
095. Gap: Clarity API quota is tiny. Step: build a budgeted queue and never poll more than allowed.
096. Gap: Wix connector validates storage but not capabilities. Step: after connect, test read collections, read items, write dry-run, and publish scope.
097. Gap: Wix site ID can point to wrong site. Step: verify site domain matches tenant domain before marking connected.
098. Gap: Wix collection schema discovery is not a normal UI path. Step: add collection browser and suggested mappings.
099. Gap: Wix SEO variable binding is manual. Step: detect missing binding and generate exact Wix instructions per dynamic page type.
100. Gap: Connectors refresh independently but not strategically. Step: add "refresh all, then recompute, then promote" as one safe workflow.

### C. Crawl, Rendering, Indexability, And Technical SEO

101. Gap: Wix JS shell captures caused false missing title/H1 cards. Step: keep and expand empty-shell guards to all snapshot-derived triggers.
102. Gap: Snapshot quality is not scored. Step: classify each crawl as rendered, shell, blocked, timeout, redirect, or stale.
103. Gap: No browser-rendered crawl validation is attached to recs. Step: add Playwright rendering for pages flagged by HTML-only crawls.
104. Gap: HTTP 200 is not enough. Step: inspect rendered title, meta, H1, canonical, robots, structured data, and body text.
105. Gap: Canonicalization has many variants. Step: normalize protocol, host, slash, query, canonical tag, sitemap URL, and Wix link fields.
106. Gap: Query parameters may fragment URL evidence. Step: strip tracking params and define preserved params.
107. Gap: Wix generated `link-*` fields are platform-specific. Step: store field roles and generated link fields per collection.
108. Gap: Sitemaps are not a full inventory. Step: compare sitemap, Wix CMS, GSC pages, GA4 landing pages, and crawled pages.
109. Gap: Robots analysis needs bot-specific rules. Step: evaluate Googlebot, Bingbot, OAI-SearchBot, GPTBot, Claude/Perplexity if desired.
110. Gap: Training bot and search bot rules differ. Step: separate "allow search inclusion" from "allow model training."
111. Gap: AI crawler access is not a UI health card. Step: add AI bot readiness card with robots.txt evidence.
112. Gap: URL Inspection API is not a complete crawl substitute. Step: use it for representative high-value URLs and cache results.
113. Gap: URL Inspection has quotas. Step: budget inspection calls by priority and stale age.
114. Gap: Indexability recs can override intentional noindex. Step: require page-type policy before noindex/robots recommendations.
115. Gap: Status-code recs need redirect chain context. Step: store full redirect chain and final canonical.
116. Gap: Redirects can be good or bad. Step: classify redirects as canonicalization, migration, broken, or loop.
117. Gap: Meta robots can differ by rendered vs source HTML. Step: inspect final rendered DOM and raw HTML.
118. Gap: Structured data validation is not enough. Step: compare schema to visible content and page type.
119. Gap: FAQ rich results are not a broad strategy. Step: treat FAQ as user/AEO format, not rich-result guarantee.
120. Gap: Recipe pages need special schema review. Step: add Recipe schema eligibility for Iranopedia food pages only when visible content supports it.
121. Gap: Product pages need Product schema integrity. Step: verify price, availability, image, reviews, brand, and offers before schema changes.
122. Gap: Person/place pages need entity schema nuance. Step: add Person/Place schema only with factual source support.
123. Gap: Breadcrumb schema on dynamic pages requires page hierarchy. Step: infer hierarchy from Wix collection URL patterns.
124. Gap: Image SEO is underdeveloped. Step: inventory image alt text, filenames, dimensions, lazy loading, and open graph images.
125. Gap: Core Web Vitals are not first-class. Step: ingest CrUX/PageSpeed or lab metrics for top pages.
126. Gap: Mobile rendering is not verified per recommendation. Step: crawl mobile viewport for top-priority pages.
127. Gap: Navigation crawlability is not deeply checked. Step: inspect internal links as rendered anchors, not just sitemap links.
128. Gap: Internal link opportunities lack anchor-quality scoring. Step: propose context-specific anchor text and source paragraph.
129. Gap: Orphan-page detection depends on internal link data. Step: ensure link graph extraction is complete and rendered.
130. Gap: Thin-content detection needs page-type thresholds. Step: define minimum useful content by collection type.
131. Gap: Duplicate title/meta detection needs intent awareness. Step: avoid flagging intentional collections or pagination.
132. Gap: Stale-content detection needs freshness semantics. Step: treat evergreen history pages differently from events/restaurants/products.
133. Gap: Page modified dates are not consistently used. Step: track lastmod from sitemap, Wix item update date, and content diff date.
134. Gap: Canonical mismatch can be subtle on Wix. Step: compare canonical tag, sitemap URL, GSC page key, and collection link.
135. Gap: Meta descriptions can be empty due to Wix template binding. Step: detect binding absence separately from empty field value.
136. Gap: Titles can be template-generated. Step: map title variables to CMS fields before title recs become pushable.
137. Gap: H1 can be visible but absent in raw HTML. Step: use rendered DOM for H1 decisions on Wix pages.
138. Gap: JS errors can affect AI/browser rendering. Step: connect Clarity errors and browser console captures to crawl health.
139. Gap: External resources can block rendering. Step: flag third-party scripts delaying content paint.
140. Gap: Search snippets depend on content beyond meta. Step: evaluate first paragraph, headings, and answer-first passages.
141. Gap: No "crawl confidence" score per page. Step: compute crawl confidence from render success, repeated captures, and source agreement.
142. Gap: No "index confidence" score per page. Step: combine sitemap, robots, noindex, canonical, URL Inspection, and GSC impressions.
143. Gap: No "retrievability" score for AI. Step: combine bot access, HTML text, structured data, and citations.
144. Gap: No bulk technical audit report. Step: create a sortable Pages inventory with all technical flags.
145. Gap: No permanent URL damage guard beyond push client. Step: add pre/post URL 200 verification for every Wix push.
146. Gap: Cache effects can confuse verification. Step: verify plain URL and cache-busted URL and record both.
147. Gap: Publish step on Wix can be required. Step: make "Wix publish required" a detected post-write state.
148. Gap: HTTP probes do not inspect meta after all cache layers. Step: fetch with normal UA, Googlebot UA, and cache-buster.
149. Gap: Broken page recovery is not automated enough. Step: include rollback plus URL-repair workflow with explicit approval.
150. Gap: Technical SEO is currently trigger-based. Step: add continuous technical health monitoring with trend lines.

### D. Recommendation Generation, Ranking, And Evidence Quality

151. Gap: Trigger count is strong but still static. Step: calibrate trigger yield and false-positive rate by tenant.
152. Gap: PREDICATE_COUNT is a manual constant. Step: derive predicate count from registry to avoid stale diagnostics.
153. Gap: Ranking severity tables are handcrafted. Step: learn weights from shipped outcomes and expert overrides.
154. Gap: GSC-led cards can still be drowned by old AEO phrasing. Step: make evidence source decide card wording.
155. Gap: "0 AI answers" can be misleading for high-GSC pages. Step: only show AI-answer absence when Profound evidence exists.
156. Gap: Recommendation titles can sound like internal transforms. Step: humanize titles from user intent, not action_type.
157. Gap: Proposed titles sometimes say "Add a page title." Step: treat that as instruction copy, not final title copy.
158. Gap: Cards with no proposed_text are weak. Step: require draft, paste-ready instructions, or explicit "needs authoring" badge.
159. Gap: Some customer-queue-ready actions still need field mapping. Step: add pushability as a gating dimension.
160. Gap: Confidence labels do not explain data sufficiency. Step: show exact source count behind confidence.
161. Gap: Recommendations need "why not bigger". Step: compare chosen action against alternatives: title, intro, internal link, new page.
162. Gap: Query-level evidence is currently one headline query. Step: show top query cluster and affected queries.
163. Gap: CTR opportunity uses generic expected CTR. Step: build site-specific CTR baselines by intent/device.
164. Gap: Upside estimates can overstate. Step: label as directional and show formula.
165. Gap: Position averages hide volatility. Step: show rank trend and stability.
166. Gap: Decay signals need seasonality. Step: compare YoY or same seasonal window when possible.
167. Gap: Keyword-gap recs need content uniqueness. Step: require overlap checks against existing pages and planned pages.
168. Gap: Cannibalization needs canonical decision logic. Step: recommend merge, internal link, title differentiation, or no action.
169. Gap: Internal link recs need source placement. Step: propose exact source page, paragraph, anchor, and target.
170. Gap: Orphan recs need crawlable-link validation. Step: verify source page can render anchor href to target.
171. Gap: Schema recs need visible-content validation. Step: block schema whose properties are not visible.
172. Gap: Uncited-content recs need source selection. Step: recommend source type and candidate URLs, not just "add proof."
173. Gap: Answer-block readiness can encourage generic answers. Step: require concise, source-backed, entity-specific answer drafts.
174. Gap: Clarity friction recs lack replay detail. Step: include element/path/session evidence when available.
175. Gap: Indexability recs can be destructive. Step: keep them review-only unless policy confirms they are accidental.
176. Gap: Promotion dedupe protects ID collisions but loses secondary evidence. Step: merge evidence from duplicate candidates into one stronger card.
177. Gap: `mapped_rows` dedupe keeps first row but not all reasons. Step: attach suppressed sibling signals to the chosen row.
178. Gap: Eligibility tiers are static. Step: allow per-tenant promotion policies after enough outcomes.
179. Gap: Diagnostic-only rows are invisible to normal workflow. Step: show "expert review queue" in the main product.
180. Gap: Operator-review-only rows require too much manual ceremony. Step: create one-click "promote after review" with proof preview.
181. Gap: Safety flags zero scores but may be hidden. Step: expose safety flags and how to resolve them.
182. Gap: Draft safety validator is packet-light for deterministic path. Step: run richer validation with source packets before pushability.
183. Gap: Brand assertion model is not Iranopedia-specific enough. Step: configure brand voice, factual boundaries, and allowed claims.
184. Gap: LLM generation is optional and env-gated. Step: make draft-generation readiness a visible setup step.
185. Gap: Anthropic provider is a stub. Step: either remove from user promise or implement provider parity.
186. Gap: OpenAI provider prompt still has Ritz examples. Step: de-verticalize provider examples and inject tenant-specific examples.
187. Gap: Some generated drafts may optimize for SEO but not readers. Step: add helpful-content rubric before acceptance.
188. Gap: No expert editorial rubric in scoring. Step: score clarity, depth, originality, citation quality, and user task fit.
189. Gap: No YMYL/sensitive-topic handling. Step: downrank or require human-authored drafts for medical, legal, political, religious claims.
190. Gap: No multilingual query matching. Step: map Persian, English, Finglish, transliteration, and alternate spellings.
191. Gap: No entity graph for Iranopedia. Step: build entity IDs for people, places, foods, dynasties, languages, diaspora terms.
192. Gap: Query intent is shallow. Step: classify informational, navigational, transactional, local, image, recipe, comparison, and definition intent.
193. Gap: Recommendations do not yet model search funnel. Step: group pages by awareness, comparison, action, and retention.
194. Gap: No topic-authority model. Step: compute coverage depth per topic cluster and missing supporting pages.
195. Gap: No citation-likelihood model. Step: estimate whether an AI answer can quote a passage from the page.
196. Gap: No "answerability" measure. Step: detect whether page has direct definitions, lists, tables, FAQs, timelines, and comparisons.
197. Gap: No content freshness model by entity. Step: mark which topics need updating based on news or timelessness.
198. Gap: No content risk model for fabricated facts. Step: require citation-backed drafts for non-trivial facts.
199. Gap: No measurement design per recommendation type. Step: attach expected measurable movement and time window.
200. Gap: Recommendation intelligence is broad but not expert-calibrated. Step: run expert reviews against top 100 cards and tune thresholds.

### E. Iranopedia Content, Editorial Authority, And Factual Quality

201. Gap: Iranopedia is an encyclopedia/content site, not a service business. Step: default page types to content/entity/recipe/product/collection.
202. Gap: Food pages need recipe-specific completeness. Step: audit ingredients, instructions, time, servings, nutrition, image, schema, and sources.
203. Gap: Recipe meta can be improved without touching page content. Step: use dedicated SEO fields bound to Wix templates.
204. Gap: Empty recipe shells need content, not meta tweaks. Step: detect low body completeness and draft ingredient/instruction tasks.
205. Gap: Cultural facts need sources. Step: require at least one credible external source before publishing new historical claims.
206. Gap: Transliteration variants matter. Step: store aliases like koobideh/kubideh/koubideh and Persian script where relevant.
207. Gap: Name pages need linguistics expertise. Step: include meaning, origin, Persian spelling, pronunciation, gender, variants, and citations.
208. Gap: Persian last names need entity disambiguation. Step: separate surname lists, notable people, meanings, and etymology.
209. Gap: Rug pages need visual and historical depth. Step: cover region, motifs, materials, weave, care, buying guide, and citations.
210. Gap: City/restaurant pages need freshness. Step: add update cadence and data source for restaurant status, hours, location, reviews.
211. Gap: Product pages need commerce SEO. Step: audit title, description, structured data, images, alt, price, variants, shipping, and internal links.
212. Gap: "Famous Iranians" pages need biography trust. Step: cite dates, roles, achievements, and avoid unsourced claims.
213. Gap: History pages require chronology. Step: add timelines, dynasty context, maps, and source-backed event summaries.
214. Gap: Religion/culture pages need sensitivity. Step: require human review and source citations before generated edits.
215. Gap: Geography pages need maps and coordinates. Step: support Place schema and map/image assets where accurate.
216. Gap: Language pages need examples. Step: include Persian script, pronunciation, transliteration, grammar, and usage examples.
217. Gap: Finglish cross-promotion can distract. Step: make promotional banners measurable and non-blocking for content readability.
218. Gap: Internal navigation is broad. Step: create hub pages for Persian food, names, rugs, cities, history, language, culture.
219. Gap: Content clusters may be incomplete. Step: build cluster coverage maps from GSC, Semrush, and existing CMS collections.
220. Gap: Some pages may be too image/light-text. Step: detect pages with low extractable text despite visual content.
221. Gap: Some pages might have text formatting issues. Step: render and inspect typography, bullet hierarchy, and mobile readability.
222. Gap: Page intros may not answer directly. Step: add answer-first intro pattern for informational pages.
223. Gap: Pages lack citation-friendly passages. Step: draft concise quotable definitions and facts with sources.
224. Gap: Tables are underused. Step: use tables for comparisons, timelines, nutrition, names, variants, and regions.
225. Gap: Lists can be thin. Step: enrich list pages with methodology, grouping, and examples.
226. Gap: Topic authority depends on internal links. Step: build cross-links among related food, city, culture, and language pages.
227. Gap: GSC high-click pages need preservation. Step: protect top pages from risky title/H1 rewrites unless evidence is strong.
228. Gap: Low-traffic pages need pruning or expansion. Step: classify as expand, consolidate, noindex, redirect, or keep.
229. Gap: New page generation can create thin content. Step: require source-backed outline, unique angle, and internal link plan.
230. Gap: User value must beat competitors. Step: compare each target page against top-ranking and top-cited pages.
231. Gap: Iranopedia authority signals are not explicit. Step: add About/editorial policy/source policy/last reviewed pages.
232. Gap: Author/editor attribution is weak. Step: add author/editor fields where appropriate.
233. Gap: Content freshness is not visible. Step: show "updated" or "reviewed" dates when meaningful and accurate.
234. Gap: Images need provenance. Step: track image source/license/alt/caption for cultural and historical media.
235. Gap: Entity pages need canonical IDs. Step: support Wikidata/ISBN/geonames-like references when appropriate.
236. Gap: Diaspora content needs geography. Step: map Persian communities and restaurants by region with citations.
237. Gap: Shop pages need separation from encyclopedia. Step: distinguish commerce pages from educational pages in SEO strategy.
238. Gap: Page templates may not expose SEO fields. Step: create dedicated SEO fields per collection and bind them once.
239. Gap: Metadata can duplicate page copy. Step: keep SEO description separate from visible intro when helpful.
240. Gap: Meta drafts can be too generic. Step: include exact entity, intent, value, and non-clickbait phrasing.
241. Gap: Title drafts need brand strategy. Step: define when to include "Iranopedia" and when not.
242. Gap: H1 drafts need user language. Step: use natural entity names, not keyword-stuffed variants.
243. Gap: FAQs need evidence. Step: generate FAQs from GSC questions and page content, not from imagination.
244. Gap: Source lists can become spammy. Step: require source quality scoring and editorial relevance.
245. Gap: Outbound links need governance. Step: track external link health, authority, and date checked.
246. Gap: Cultural terms need pronunciation. Step: add pronunciation snippets where user demand exists.
247. Gap: Related searches can drive coverage. Step: mine GSC queries for unanswered subtopics.
248. Gap: Iranopedia needs long-term content calendar. Step: produce weekly editorial batches by cluster and evidence score.
249. Gap: The app should not fabricate "expertise." Step: show where human editorial input is required.
250. Gap: To beat experts, Beacon must encode Iranopedia editorial memory. Step: create tenant-specific editorial rules and examples.

### F. AEO, AI Visibility, And Answer Engine Optimization

251. Gap: AEO is now mostly Profound-dependent. Step: make Profound readiness and category coverage visible.
252. Gap: Native AI reading was deleted. Step: decide whether to reintroduce safe on-demand sampling or rely entirely on Profound.
253. Gap: AI visibility without answer text is incomplete. Step: ingest answer snippets, citation context, and cited source domains.
254. Gap: "AI assistants cite competitor" needs page mapping. Step: map each topic gap to best existing page or new page brief.
255. Gap: AEO gaps should not always create answer blocks. Step: choose answer block, source section, comparison table, FAQ, or new page.
256. Gap: Answer blocks can be generic. Step: require exact user question, direct answer, supporting facts, and citations.
257. Gap: AEO success differs by model. Step: break visibility by ChatGPT, Perplexity, Gemini, Claude, etc. when available.
258. Gap: AEO success differs by persona/region. Step: store model, geography, language, and persona dimensions.
259. Gap: AI citations often come from authoritative third-party sources. Step: identify source domains and build authority/outreach tasks.
260. Gap: AI referral traffic is not fused enough. Step: combine Profound referrals, GA4 source/medium, and server logs if possible.
261. Gap: AI crawler readiness is not enough. Step: verify bots can access content and that content is quotable.
262. Gap: GPTBot and OAI-SearchBot have different purposes. Step: expose bot-specific robots policy and recommended settings.
263. Gap: AEO claims can be overconfident. Step: use directional language and show sample size.
264. Gap: AI answer monitoring needs freshness. Step: show last observed answer date and number of answers behind each claim.
265. Gap: AI visibility should not dominate SEO. Step: weight AI-answer evidence alongside GSC/GA4, not above first-party demand by default.
266. Gap: Answer blocks need citation-backed facts. Step: require source ledger before generating factual answer content.
267. Gap: AI citations favor concise passages. Step: add "quotable passage" recommendations with snippet preview.
268. Gap: AI may cite pages with clean structure. Step: prioritize headings, summaries, lists, and schema for key topics.
269. Gap: Profound topic categories may not cover all Iranopedia clusters. Step: suggest category list from site inventory and GSC queries.
270. Gap: Fanout queries are underused. Step: ingest query fanouts and use them to expand sections.
271. Gap: Sentiment is underused. Step: detect negative/misleading descriptions and suggest corrective content.
272. Gap: Competitor citation analysis is underdeveloped. Step: compare why competitor got cited: source, passage, schema, authority, freshness.
273. Gap: AI answer gaps need evidence threshold. Step: require minimum answers/executions before creating recs.
274. Gap: AI answer absence can be normal. Step: avoid penalizing obscure topics with no answer demand.
275. Gap: AI referrals need attribution. Step: tie AI referral path to landing page and shipped changes.
276. Gap: AEO recommendations need validation loop. Step: after publish, check if answer visibility changed.
277. Gap: AEO snippets need factual exactness. Step: validate with sources and page content before publishing.
278. Gap: AI engines may ignore meta descriptions. Step: focus AEO recs on visible content and citations, not just meta.
279. Gap: LLM citations can lag. Step: set measurement windows longer than normal crawl windows.
280. Gap: AI answer engines vary in crawl cadence. Step: record per-model lag and expected reassessment timing.
281. Gap: There is no "answer coverage" map. Step: map user questions to pages and direct answer availability.
282. Gap: No passage-level scoring. Step: score whether a paragraph answers the query in 40-80 words.
283. Gap: No entity co-occurrence model. Step: ensure pages mention related entities AI expects for the topic.
284. Gap: No citation graph. Step: track who AI cites, why, and what sources those pages cite.
285. Gap: No "source gap" recs. Step: recommend adding citations from domains already trusted in AI answers.
286. Gap: No AI bot log validation outside Profound. Step: optionally use server logs or Cloudflare bot reports.
287. Gap: No distinction between being mentioned and being cited. Step: track mention share, citation share, primary recommendation, sentiment separately.
288. Gap: No answer-structure analysis. Step: classify competitor answer snippets as list, table, definition, comparison, step-by-step.
289. Gap: No "best answer block" template library. Step: create templates for definition, recipe, timeline, comparison, city guide, biography.
290. Gap: No AI safety guard for sensitive content. Step: prevent generated answer blocks on contested history without citation review.
291. Gap: AEO signals may lag SEO signals. Step: show expected delay and avoid premature failure calls.
292. Gap: AEO wins need screenshots/quotes. Step: store short compliant snippets and links, not full answer dumps.
293. Gap: Profound data can be paid/enterprise-gated. Step: show plan readiness and failure reason.
294. Gap: No fallback when Profound unavailable. Step: provide crawl/GSC-based AEO readiness tasks without claiming AI observation.
295. Gap: No "citation eligibility" checklist. Step: per page: indexable, crawlable, answer-first, sources, schema, authority, freshness.
296. Gap: No LLM-output comparison against page content. Step: detect when AI says facts not present on site and suggest corrections.
297. Gap: No "answer shelf" on pages. Step: add structured direct answers near top of high-demand pages.
298. Gap: No "AI source acquisition" workflow. Step: recommend getting listed/cited on sources AI already trusts.
299. Gap: AEO dashboards can become vanity metrics. Step: tie AI visibility to traffic/referrals/conversions when available.
300. Gap: To beat AEO experts, Beacon must link answer demand to publishable, source-backed content. Step: build that loop end-to-end.

### G. Wix Publishing, Safety, And Long-Term Automation

301. Gap: Wix URL map persistence uses `readStore`/`writeStore`. Step: move `wix-url-map` and `wix-collection-config` to Supabase.
302. Gap: Field-role mapping is JSON text. Step: build a guided Wix collection mapper UI.
303. Gap: Mapping requires knowing field keys. Step: discover collections and fields from Wix and suggest roles automatically.
304. Gap: Meta SEO binding is manual. Step: detect SEO fields and provide per-template binding checklist.
305. Gap: Beacon cannot change dynamic page SEO templates via Data API. Step: encode this limit in the UI and never imply otherwise.
306. Gap: Wix site publish can be required. Step: after field write, verify live HTML and ask for Publish when needed.
307. Gap: Wix cache can show stale 404/meta. Step: verify origin/cache-busted and bare URL separately.
308. Gap: Slug break incident proved PUT risk. Step: keep full-field merge tests and add live-safe preflight for every write.
309. Gap: Protected URL fields guard is client-level. Step: also guard in push-service before adapter calls.
310. Gap: Write payload size guard is conservative but not user-facing. Step: show "too large to push" with exact field size.
311. Gap: Daily cap is one-size-fits-all. Step: make caps per risk type: meta low, body medium, create page high.
312. Gap: No staging/draft flow for CMS edits. Step: use Wix drafts where available or create review-only copy instructions.
313. Gap: No multi-card transaction. Step: batch accepts should remain sequential with receipts and stop-on-failure.
314. Gap: No publish queue calendar. Step: let owner schedule approved changes while retaining review gate.
315. Gap: No pre-push rendered diff. Step: show old field, new field, affected URL, source evidence, and safety checks.
316. Gap: No post-push visual diff. Step: capture before/after screenshot or HTML diff for key fields.
317. Gap: Rollback snapshots exist but need UI. Step: expose rollback button with prior value and safety caveat.
318. Gap: Revert can conflict with non-destructive guard. Step: ensure revert path bypasses shrink guard only when snapshot proves prior value.
319. Gap: Product schema route is limited. Step: expand supported Wix surfaces: CMS pages, blog drafts, store products, static pages when safe.
320. Gap: Blog post support exists but not productized. Step: add blog draft creation flow for new long-form content.
321. Gap: Media import exists but is not connected to content workflows. Step: add image sourcing/upload plan with alt/caption.
322. Gap: No page-factory wizard. Step: create new-page CMS item workflow with collection-specific required fields.
323. Gap: New pages need internal links. Step: require at least one source link and one hub link before publishing.
324. Gap: New pages need sitemap/index validation. Step: verify URL 200, sitemap presence, and noindex after publish.
325. Gap: Wix collection item schemas vary. Step: store per-collection capabilities and required fields.
326. Gap: Field roles can be wrong. Step: validate by writing a dry-run or reading live page variables before enabling push.
327. Gap: Field writes can clobber concurrent editor changes. Step: re-read immediately before write and show if value changed since approval.
328. Gap: Human Wix edits can race Beacon. Step: compare snapshot captured at approval vs current before push.
329. Gap: No approval reason record. Step: store who approved, why, source evidence, and expected metric.
330. Gap: No "unsafe to push" category taxonomy. Step: classify refused pushes: no mapping, protected field, too destructive, no snapshot, API error.
331. Gap: Wix API permissions can be too broad. Step: document minimum scopes and verify token capabilities.
332. Gap: Wrong site connection risk remains. Step: verify API site domain against tenant domain and show mismatch refusal.
333. Gap: No connector secret rotation reminder. Step: show key age and rotate guidance.
334. Gap: No Wix quota dashboard. Step: show API errors, rate limits, retries, and backoff status.
335. Gap: No "what will publish" global preview. Step: show pushable vs paste-ready counts by source and collection.
336. Gap: Cards can be accepted without being pushable. Step: differentiate Accept as staging vs Approve & Push as live.
337. Gap: The current Accept wording can confuse. Step: use explicit buttons: Save to queue, Approve & Push, Copy instructions.
338. Gap: Bulk Accept can stage many cards. Step: ensure it never live-publishes and labels staging clearly.
339. Gap: No per-field review templates. Step: title/meta/H1/body/schema/new-page each needs tailored review UI.
340. Gap: Meta changes can be low-risk but high-impact. Step: make bound SEO fields the first-class, safest publish lane.
341. Gap: Body edits are higher risk. Step: require source-backed diff and visible page preview.
342. Gap: Schema edits need validation after publish. Step: run schema validation and rich-result eligibility checks.
343. Gap: New page creation needs slug governance. Step: generate slug, check uniqueness, and verify no existing URL.
344. Gap: Slug repair is too manual. Step: retain protected repair path with explicit "URL repair" authorization.
345. Gap: Wix dynamic pages require publish semantics. Step: model CMS data live vs template publish required separately.
346. Gap: No "undo drill" test. Step: run periodic dry-run rollback simulation on safe fixture data.
347. Gap: No external backup before large pushes. Step: export affected collection rows before multi-card batches.
348. Gap: No staging tenant. Step: optionally connect a sandbox Wix site for dangerous feature tests.
349. Gap: No publish impact estimate by risk. Step: rank push risk: metadata, schema, text, create page, URL repair.
350. Gap: To beat experts, Beacon must be safer than manual editing. Step: make preflight, snapshot, verify, and rollback non-optional.

### H. Measurement, Proof, And Learning Loop

351. Gap: A single meta push is proof of plumbing, not product value. Step: track outcome movement over 7/28/90 days.
352. Gap: Proof engine exists but needs first-class UI. Step: show proof receipts on every shipped change.
353. Gap: Causality is hard. Step: use natural controls, matched pages, and caveats instead of raw before/after.
354. Gap: Proof windows differ by change type. Step: metadata faster, content slower, AEO slower; encode windows.
355. Gap: Search data lags. Step: delay verdicts until final GSC windows are available.
356. Gap: AI answer data lags differently. Step: store per-source reassessment windows.
357. Gap: No confidence interval display. Step: show low sample warnings and avoid overclaim.
358. Gap: No "expected KPI" per card. Step: attach target metric: clicks, impressions, CTR, rank, AI citations, conversions, engagement.
359. Gap: No "counterfactual" to unshipped recommendations. Step: compare shipped pages to similar untouched pages.
360. Gap: GA4 proof needs page path mapping. Step: canonicalize GA4 paths to same URL keys as GSC/Wix.
361. Gap: AI referral proof needs source mapping. Step: normalize AI referral sources and path.
362. Gap: Clarity proof needs enough sessions. Step: only call friction fixed after session floor.
363. Gap: Semrush proof is slower/noisier. Step: use Semrush for direction, not primary proof.
364. Gap: No "learning summary" after a failed change. Step: record whether failure was execution, evidence, timing, or strategy.
365. Gap: No rollback outcome tracking. Step: if rolled back, mark outcome invalid and preserve audit trail.
366. Gap: No page-level lifecycle state in user language. Step: show recommended, staged, pushed, watching, proven, reverted.
367. Gap: No proof artifact for demos. Step: make one printable/shareable receipt per change.
368. Gap: No pipeline health metrics. Step: show source freshness, rec generation date, push verification date, proof status.
369. Gap: No outcome-driven re-ranking. Step: after proof, upgrade/downgrade similar future moves.
370. Gap: No personalization from Armeen's edits. Step: learn style and rejection reasons.
371. Gap: No expert benchmark comparison. Step: compare Beacon decisions against manual expert audit decisions.
372. Gap: No "missed opportunity" analysis. Step: detect high-value pages with no recommendations and explain why.
373. Gap: No page-level historical timeline. Step: show all changes, source pulls, recommendations, and outcomes per URL.
374. Gap: No connector failure impact analysis. Step: explain which recommendations are missing because a source is stale.
375. Gap: No measurable content-quality metric. Step: define helpfulness dimensions and track pre/post.
376. Gap: No proof for internal links. Step: measure crawl/index changes and assisted rankings.
377. Gap: No proof for schema. Step: measure validation status, impressions, and CTR where relevant.
378. Gap: No proof for AEO answer blocks. Step: measure answer mentions/citations and referral changes by topic.
379. Gap: No proof for meta descriptions. Step: measure CTR/snippet changes, not ranking.
380. Gap: No proof for titles. Step: measure CTR plus ranking movement, annotated by query.
381. Gap: No proof for H1/body edits. Step: measure query expansion, engagement, and answer citations.
382. Gap: No proof for new pages. Step: measure indexation, impressions, clicks, internal link discovery, and AI citations.
383. Gap: No page health trend. Step: show moving score over time.
384. Gap: No query cluster trend. Step: show top queries gained/lost per cluster.
385. Gap: No entity coverage trend. Step: track entity pages created, expanded, updated, cited.
386. Gap: No content decay monitor. Step: alert when previously strong pages decline.
387. Gap: No SEO experiment log. Step: record hypothesis, change, expected impact, result.
388. Gap: No "expert did this manually" time saved estimate. Step: estimate hours saved per task type.
389. Gap: No trust calibration. Step: show which Beacon rec families historically worked.
390. Gap: No false-positive rate per trigger. Step: track dismissed/edited/rolled-back rates.
391. Gap: No source reliability score. Step: score GSC, GA4, Semrush, Profound, Clarity availability and quality.
392. Gap: No "data debt" impact on rec quality. Step: show how connecting missing sources would change confidence.
393. Gap: No direct connection from proof to next plan. Step: after each verdict, recommend next action.
394. Gap: No long-term compounding view. Step: show monthly cumulative clicks, citations, and content coverage improved.
395. Gap: No exportable investor/demo proof. Step: create a short proof dashboard for "live change shipped and verified."
396. Gap: No automatic post-publish GSC inspection queue. Step: inspect high-priority URLs after publish within quota.
397. Gap: No "proof pending" expectation setting. Step: show exact earliest date a verdict can be trustworthy.
398. Gap: No alerting when a shipped change hurts. Step: notify owner when a page drops beyond threshold.
399. Gap: No "do more like this" surface. Step: cluster successful changes and suggest repeats.
400. Gap: To beat experts, Beacon must close the loop. Step: every recommendation must end in measured learning.

### I. UI, UX, Trust, And Daily Operator Experience

401. Gap: Today must feel like the mission control. Step: put connected sources, top opportunity, proof status, and next action above everything.
402. Gap: Recommendations still feel card-stack-heavy. Step: add filters by source, risk, pushability, page type, and expected impact.
403. Gap: The owner needs "what do I do now?" Step: always show one next best action.
404. Gap: Source setup confusion is costly. Step: add setup checklist with green/yellow/red per connector.
405. Gap: GSC connected but not selected can confuse. Step: make needs-attention state prominent.
406. Gap: Wix connected but not mapped can confuse. Step: show "connected, not push-ready" with field mapping CTA.
407. Gap: Semrush/Profound not connected should not make product look empty. Step: show what works now and what improves after connecting.
408. Gap: Diagnostics are scary. Step: rename customer-visible diagnostics to Setup, Data, Publishing, or Health.
409. Gap: Copy still uses provider names inconsistently. Step: customer copy says "AI Answers"; connector setup can say Profound.
410. Gap: Badges need meaning. Step: badges should count urgent actions, not raw internal rows.
411. Gap: Keyboard shortcuts are power-user only. Step: keep them but make click paths obvious.
412. Gap: Evidence bullets need hierarchy. Step: show one headline fact, then expandable raw evidence.
413. Gap: Expert users need raw data. Step: add "view source rows" in detail page.
414. Gap: Non-technical owner needs simple language. Step: avoid enums, raw IDs, and internal trigger names.
415. Gap: Technical owner needs confidence. Step: show raw signal provenance behind each line.
416. Gap: Accept vs Review language is ambiguous. Step: make each button's effect explicit.
417. Gap: Bulk actions can scare. Step: label "stage only" and show no live publish.
418. Gap: Pushable cards need visual distinction. Step: add "Ready to push to Wix" badge only when mapping is verified.
419. Gap: Paste-ready cards need friction lowered. Step: one-click copy, exact Wix instructions, and checklist.
420. Gap: Rejected cards disappear too easily. Step: keep an archive with rejection reason.
421. Gap: Deferred cards need reminders. Step: show due dates and why deferred.
422. Gap: Working rail should be outcome-focused. Step: group accepted/pushed/watching/proven.
423. Gap: Changes page should prove value. Step: make it a scorecard, not only a log.
424. Gap: Prompts page may be legacy AEO-heavy. Step: position prompts as one evidence source, not the product center.
425. Gap: Settings page mixes config and connectors. Step: separate Business Profile, Connectors, Publishing, Editorial Rules.
426. Gap: UI lacks domain memory. Step: show Iranopedia-specific collections, clusters, and source readiness.
427. Gap: Expert audit should be printable. Step: generate PDF/Markdown audit exports.
428. Gap: Evidence receipts are not standard. Step: attach receipt component to every approved change.
429. Gap: No "demo mode" wall. Step: if fake data is used for hackathon, label every fake source visibly.
430. Gap: No mobile-first review path. Step: ensure cards, diffs, and approval buttons work on phone.
431. Gap: Onboarding is too technical. Step: ask for domain, Wix key, GSC, then auto-detect rest.
432. Gap: Error copy needs action. Step: every failure should say what happened and what to do.
433. Gap: Loader failures can degrade silently. Step: show layer-specific banners with retry controls.
434. Gap: Progress feedback for syncs is limited. Step: show running/complete/failure per source with row counts.
435. Gap: No "last refreshed" by source on Recommendations. Step: add freshness badges in queue header.
436. Gap: No "why this page" inventory view. Step: per page, show data, issues, recommendations, and history.
437. Gap: No "search winners/losers" page. Step: add GSC leaderboard for pages and queries.
438. Gap: No "AI winners/losers" page. Step: add AI answer visibility leaderboard when Profound connected.
439. Gap: No "publishing readiness" page. Step: show mapped collections and pushable counts.
440. Gap: No "field mapping confidence" UI. Step: show sample URLs and live probes per mapping.
441. Gap: No "safe mode" toggle. Step: allow read-only mode that disables all live pushes.
442. Gap: No "max mode" runbook in UI. Step: guided flow for connecting all sources and enabling drafts.
443. Gap: No cost transparency. Step: show paid API usage and remaining budgets.
444. Gap: No source conflict explanation. Step: when Semrush and GSC disagree, explain which wins.
445. Gap: No "expert notes" field. Step: let Armeen add editorial judgment per page/card.
446. Gap: UI does not yet feel inevitable. Step: make the happy path three visible steps: refresh, approve, verify.
447. Gap: Too many historical docs confuse agents. Step: summarize active state in one canonical doc.
448. Gap: No built-in demo deck. Step: generate three-slide story from live proof receipt.
449. Gap: No "time until ready" estimate. Step: show what is blocked by user setup vs code.
450. Gap: To beat experts, UI must reduce cognitive load. Step: productize the expert workflow into a daily cockpit.

### J. Reliability, Security, Architecture, And Scaling

451. Gap: Local docs and current code can drift. Step: keep handoff, execution plan, and verification log updated after each behavior change.
452. Gap: Historical docs are huge. Step: archive stale sections and keep current plan concise.
453. Gap: `.data` remains an edge risk on Vercel. Step: every hosted-critical store must read/write Supabase.
454. Gap: Wix URL map is hosted-critical but file-backed. Step: migrate it first.
455. Gap: Push snapshots and ledgers need tenant-explicit writes. Step: remove ambient tenant fallbacks from scripts/cron paths.
456. Gap: Scripts contain tenant-specific one-offs. Step: move one-off rescue scripts to archived ops or delete after documenting.
457. Gap: Some scripts set live env inline. Step: make live-write scripts refuse unless explicit CLI flags are passed.
458. Gap: Secrets are in Supabase payload plaintext. Step: encrypt connector token payloads before broader customer use.
459. Gap: Service-role access is broad. Step: isolate token operations and avoid importing admin clients into broad modules.
460. Gap: Tenant isolation has many historical footguns. Step: add integration tests for cross-tenant connector, rec, push, and proof paths.
461. Gap: Founder tenant special-casing remains. Step: reduce founder legacy paths and test non-founder as default.
462. Gap: Environment flags are complex. Step: produce a single env readiness report.
463. Gap: V2/legacy history still affects docs. Step: purge dead "legacy" instructions from active runbooks.
464. Gap: No CI proof in this audit run. Step: run typecheck/test/build before behavior merges.
465. Gap: Full suite can hit worker limits. Step: define reliable chunked test commands and CI equivalents.
466. Gap: No production smoke automation. Step: add smoke tests for Today, Recommendations, Settings, Wix diagnostics, and live URL verification.
467. Gap: No error reporting setup is visible. Step: add logging/alerts for failed syncs, failed pushes, and source staleness.
468. Gap: No uptime monitoring for iranopedia.com pages. Step: monitor top URLs and recently pushed URLs.
469. Gap: No queue for long connector jobs. Step: add safe background job system or Vercel-compatible task queue.
470. Gap: Crons removed to save risk/cost. Step: reintroduce safe scheduler only after budget, locks, and observability exist.
471. Gap: On-demand refresh can be forgotten. Step: add reminders or heartbeat automation if the owner wants daily follow-up.
472. Gap: API rate limits vary by source. Step: centralize quota model with per-source budgets.
473. Gap: Retry behavior differs by connector. Step: standardize retry/backoff/idempotency contracts.
474. Gap: Partial sync failures can look successful. Step: require row counts, skipped counts, and reason codes everywhere.
475. Gap: No schema migration checklist for prod. Step: every migration needs rollback notes and data-impact classification.
476. Gap: No broad source-data lineage. Step: every row should trace to connector, pull time, property/site ID, and raw source.
477. Gap: No immutable audit trail for live writes. Step: store append-only push events and snapshots.
478. Gap: No safe replay. Step: support dry-run replay from a past card and current site state.
479. Gap: No integrity checker after push. Step: verify protected fields unchanged after every Wix write.
480. Gap: No deletion endpoints exposed, which is good. Step: keep delete/write surface minimized and invariant-tested.
481. Gap: No broad permissions audit for Wix key. Step: detect if key has excess permissions and warn.
482. Gap: No Google OAuth scope audit in UI. Step: show exact granted scopes per connector.
483. Gap: No connector disconnect policy. Step: preserve cached data while stopping future reads/writes.
484. Gap: No PII policy for Clarity/GA4. Step: document masking, consent, and no LLM sharing rules.
485. Gap: LLM prompts may include sensitive business data. Step: add redaction and source-minimization before provider calls.
486. Gap: No prompt/version registry for LLM drafts. Step: version prompts and validators so outcomes can be traced.
487. Gap: No model fallback strategy. Step: define primary, fallback, and abstain behavior.
488. Gap: No hallucination score for generated content. Step: validate claims against page/source ledger before pushability.
489. Gap: No lock around simultaneous pushes. Step: add per-tenant/per-URL push mutex.
490. Gap: No idempotency keys for live push actions. Step: prevent double-submit from writing twice.
491. Gap: No clear separation of staging and live rows. Step: model staged, approved, pushed, reverted as distinct lifecycle states.
492. Gap: No database-driven Wix mappings. Step: add migration and repository methods for mappings and URL map.
493. Gap: No broad import/export backup. Step: export key Supabase tables before risky migration or bulk publish.
494. Gap: No smoke for real Iranopedia after deploy. Step: verify `iranopedia.com` top URLs and Beacon pages after each push.
495. Gap: No "cannot beat expert because" QA checklist. Step: run this 500-point matrix monthly and mark done/accepted/deferred.
496. Gap: No source-of-truth prioritization beyond docs. Step: turn top P0/P1 into tracked tasks inside `NEXT_PHASE_EXECUTION_PLAN.md`.
497. Gap: No "definition of done" for 10x expert. Step: define acceptance tests: source-backed rec, Wix push, live verify, proof loop.
498. Gap: No "demo vs production" security boundary. Step: keep fake hackathon data in a separate mode with no real keys.
499. Gap: No long-term daily habit automation. Step: add optional daily reminder/run summary that never publishes without approval.
500. Gap: Beacon is close to a powerful operator but not yet an expert replacement. Step: ship durable data, source-backed drafting, safe Wix automation, proof, and learning as one loop.

## Recommended Execution Order

1. P0: make Wix mappings and URL map durable in Supabase, then expose a guided mapper.
2. P0: clean Recommendations copy and ranking so GSC-first SEO evidence does not read like AEO-only "0 AI answers."
3. P0: finish connector readiness: GSC property/backfill, GA4 pagination/property, Semrush/Profound readiness states.
4. P1: build the unified daily Golden Path UI: Refresh, Review, Approve, Verify, Learn.
5. P1: add source-backed draft generation for Iranopedia content with factual-source gates.
6. P1: make every push produce a receipt with before/after, live verification, and rollback.
7. P1: attach proof windows and outcomes to every shipped change.

Definition of 10x expert: Beacon does not merely suggest SEO tasks. It continuously gathers better evidence than a human can manually gather, ranks it with transparent confidence, drafts only when source-backed, publishes only with approval, verifies the live site, proves results, and learns from every outcome.
