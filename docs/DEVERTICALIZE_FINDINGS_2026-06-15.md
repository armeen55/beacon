# De-verticalization confirmed findings (workflow wf_eff873be-385, 2026-06-15)

> ## SWEEP STATUS (2026-06-15) — active leaks + config-threading done; ground-truth verified
> **CONFIG-THREADING ROUND 2 (2026-06-15 PM) — vertical-tuned classifiers now tenant-driven:**
> - `seed-data.server.ts` seed fallback now fires ONLY for the seed-owner tenant
>   (`a29f571`) — was bleeding the founder's builder demo (changelog/results/
>   opportunities/competitors) into EVERY import-less tenant; ground-truth-found
>   via Iranopedia's ⌘K palette + fixed + re-verified both directions.
> - `frontier-planner.ts` city/service frontier classification: dropped the hardcoded
>   Bay-Area-city + builder-service regex → `getCurrentTenantFrontierVocab()` from
>   BusinessConfig.locations/.services, threaded through all 4 call sites (`100256f`).
> - `builder-benchmark.ts` competitor benchmark: dropped the 9-domain builder name map
>   + 5-domain builder directory filter + " Construction"→"custom homes" rewrite →
>   names from the tenant's competitor universe (domainToLabel), directories from
>   config.directoryDomains (universal default), generic topic-label cleanup;
>   `getCurrentTenantBenchmarkOpts()` threaded through /today line, /competitors,
>   /diagnostics, settings/history (`3ed7837`).
> - `opportunity-candidates/builders.ts` TOPIC_ADJACENCY builder map → adjacency
>   derived from the tenant's OWN services (expand into other services); threaded
>   serviceVocab via computeOpportunityCandidates at /expansion + /diagnostics (`291ac9b`).
>
> **RESIDUAL (deliberately left — risk/value justified, not oversight):**
> - `openai.ts` SYSTEM_PROMPT builder/Ritz few-shot examples: PEDAGOGICAL (teach
>   format rules — full entity name, no keyword-stuffed queries, evidence-grounded
>   claims), NOT output-determining. The model applies the rules to the PACKET's
>   actual tenant data, so a non-builder's LLM output uses their content, not builder
>   content. Rewriting a ~700-line tuned + test-pinned prompt risks degrading output
>   for ALL tenants; not worth doing under deadline. Proper fix remains a
>   `buildSystemPrompt(packet)` refactor that injects the tenant brand into the few
>   INSTRUCTIONAL "Ritz" references (vs the illustrative examples). (L, low harm.)
> - `opportunity-candidates/builders.ts` DEFAULT_EXPANSION_CITIES: Bay-Area geo
>   FALLBACK, fires only when a caller passes undefined cities. Normal path threads
>   cfg.locations (tenant-aware). Kept per the #149-family "Ritz parity" decision;
>   neutralizing to [] risks Ritz /expansion breadth. (No non-builder harm — they
>   thread their own locations.)
> - `query-fanout-audit.ts` KNOWN_GEO_TOKENS: UNWIRED feature (no production caller),
>   so no output impact; de-vert deferred until it ships.
>
> **DONE (the active wrong-output leaks for non-builder tenants):**
> - query-relevance: `query-index.ts` DEFAULT_CITIES (Bay-Area cities applied to
>   Iranopedia's relevance) + "bay area" homepage boost + SERVICE_KEYWORD_MAP (`7e7e47c`)
> - competitor alerts: `detect-changes.ts` builder/Bay-Area topic patterns (`36d026d`)
> - rec titles: `recommendation-title-humanizer.ts` BAY_AREA_CITIES geo default (`359eeea`);
>   `composeRecommendedMove` now threads tenant services (`97c8c4e`)
> - morning-brief: "Bay Area" title fabrication + builder section skeletons +
>   "Custom Home Builder" anchor + builder stopwords (`9c57354`, `963ad62`)
> - `/today` scannerKnownLocations Bay-Area city list (`98e43da`)
> - competitor universe: builder demo-competitor fallback → honest-empty (`b2d57c3`)
> - business-config placeholder directory blocklist → universal (`6de2418`)
> - geo/normalize.ts hardcoded "CA" state (`12659fa`)
> - profound entity-seed owned-entity "Bay Area"/"custom home building" scope (`9dd100d`)
> - frontier-compiler "{City} Custom Home Builder" title + detect-findings content-asset
>   severity gate (`e251cb5`)
> - onboarding/settings copy: builder placeholders/subtitles → neutral (`98e43da`)
>
> **DEFERRED (tracked, M/L-effort, lower actual harm — mostly no-op or
> degrade-gracefully for non-builders; do NOT rush near a deadline):**
> - `openai.ts` SYSTEM_PROMPT — extensively Ritz/builder few-shot examples
>   throughout; needs a per-tenant `buildSystemPrompt(packet)` refactor (L), not
>   a piecemeal string-swap (partial edit breaks pinned tests + leaves it inconsistent).
> - `recommendation-title-humanizer.ts` TOPIC_TAGS builder table (tenant services
>   tried first → mostly no-op; high test-churn to remove).
> - `geo/normalize.ts` region-term tenant-threading (narrow: non-BA local tenant
>   with region-labeled city data); `entity-seed` builder COMPETITOR_DOMAINS (no-op
>   for non-builders); onboarding scope-form builder grid (cosmetic — validation +
>   prompt-gen already handle non-builders); pages/expected-schema, classify-asset-type,
>   frontier-planner, brand-assertions, page-classifier, opportunity-candidates/builders,
>   builder-benchmark, competitors/classify-type (vertical-tuned classification/scoring).
> See per-finding detail below for the exact fix + effort.

> ## GROUND-TRUTH-DISCOVERED (2026-06-15, rendering Iranopedia — the workflow EXCLUDED seed-data so missed these)
> - **DONE:** `log-change-sheet.tsx` placeholder "e.g. Palo Alto City Page" → neutral.
> - **DONE (`a29f571`, root-caused deeper than the palette):** the ⌘K command
>   palette's builder-changelog leak ("Custom Home Building" cl-2/cl-3) was NOT a
>   palette bug — it was `seed-data.server.ts loadFromRepoOrSeed`, which fell back
>   to the FOUNDER's builder demo seed for ANY tenant with no `import_runs`. A
>   GSC-led content tenant (Iranopedia) has real data but never imported a CSV →
>   got Ritz's demo across getChangelogEntries / getResults / getOpportunities /
>   getCompetitors / getBriefs. Fix: the seed only falls back for its OWNER tenant
>   (derived from the seed's own `tenant_id`); every other import-less tenant gets
>   EMPTY (honest empty states). GROUND-TRUTH VERIFIED both ways on the real dev
>   server: as Iranopedia the palette leak is gone; restored to Ritz the founder
>   keeps its full dataset. This resolves the whole class — not just the palette.

53 confirmed of 88. Status: [ ]=todo [x]=done [~]=already-fixed-this-session [defer]=dormant/low.

## [HIGH/M] src/domains/geo/normalize.ts :13-138
- cat: geography/locale
- fix: Make the geo taxonomy tenant-driven instead of the baked Bay-Area tables. Concretely: (1) Change normalizeCity / isRegionTerm to accept a tenant taxonomy param (region terms + optional state/metro maps) derived from the tenant's BusinessConfig (l(tenantId).locations, plus a new optional region/state field), rather than the module-level CITY_ALIASES/METRO_MAP/REGION_TERMS constants. Keep the constants only as an explicit per-tenant config for the Ritz/Bay-Area tenant, not a global default. (2) St

## [HIGH/S] src/domains/product/morning-brief.ts :1321-1323
- cat: geography/locale
- fix: Mirror the 2026-06-11 fix already applied to suggestTitleRewrite (lines 974-982): in the no-city branch, drop the invented region word entirely — change line 1321-1323 to `const newTitle = cityName ? \`Best ${phraseTitle} in ${cityName}${suffix}\` : \`${phraseTitle}${suffix}\`;`. The brand suffix (siteName) already carries identity, so no region word is needed. (Optional richer fix: thread the existing `cities?: ReadonlyArray<string>` array — already available at the call site, line 643 — into g

## [HIGH/S] src/domains/product/morning-brief.ts :921
- cat: geography/locale
- fix: Replace the hardcoded regex city-extraction (L921-924) with a match against the injected tenant `cities` list, mirroring the vocab service extraction directly below (L941-948): sort cities longest-first to prefer multi-word matches, then find the first whose lowercased form is contained in topQueryLower. Concretely: `let city: string | null = null; if (cities && cities.length > 0) { const sorted = [...cities].map((c) => c.trim().toLowerCase()).filter((c) => c.length >= 2).sort((a, b) => b.length

## [HIGH/S] src/app/(shell)/today-data.ts :1208-1215
- cat: geography/locale
- fix: Drop the literal Bay-Area/California augmentation entirely and feed only the per-tenant value: `const scannerKnownLocations: string[] = scannerBusinessConfig.locations ?? [];`. If the 'commonly co-occurring neighbor metros' behavior is still wanted, make it per-tenant data, not a code literal — add an optional businessConfig field (e.g. `neighborLocations?: string[]` or reuse a tenant-config geo list) and union that: `[...(scannerBusinessConfig.locations ?? []), ...(scannerBusinessConfig.neighbo

## [HIGH/M] src/domains/onboarding/scope-validation.ts :30-46
- cat: industry-vertical-vocabulary
- fix: Make the scope step's selectable service categories segment/site-driven instead of the fixed builder PROJECT_MIX_TAGS grid. Concretely: (1) derive a provisional TenantSegment from the step-1 site crawl (deriveBusinessProfile / launch-config segment heuristic already exist) and persist/pass it into ScopeForm; (2) when the provisional segment is local_residential_builder, keep the PROJECT_MIX_TAGS checkbox grid; (3) for all other segments, drive the step from the site-derived BusinessConfig.servic

## [HIGH/M] src/domains/entity/discrepancy-detect.ts :200-250
- cat: industry-vertical-vocabulary
- fix: Seed the candidate location/service universe from per-tenant data instead of the hardcoded arrays. (1) Concretely: pass the tenant's observed terms into buildLocationPatterns/buildServicePatterns. The cheapest, no-new-IO source is the tenant's own AI-answer corpus plus business config: gather candidate location/service terms from getBusinessConfigForCurrentTenant (cfg.locationTerms/cfg.locations and cfg.serviceTerms/cfg.services) — the same config entity-extract.ts already loads — and/or from te

## [HIGH/M] src/domains/pages/frontier-planner.ts :169-170
- cat: service/keyword taxonomy
- fix: Thread the per-tenant BusinessConfig into computeFrontiers and replace the two literal regexes with the existing dynamic helpers. Concretely: import getLocationRegex and getServiceRegex from @/lib/business-config and add a `config: BusinessConfig` parameter to computeFrontiers (all three call sites in topics/page.tsx and the one in package-actions.ts already run in tenant context, so resolve via getBusinessConfig() / getBusinessConfigForCurrentTenant and pass it in). Build `const cityRe = getLoc

## [HIGH/S] src/domains/product/morning-brief.ts :1323
- cat: geo/taxonomy hardcoding
- fix: Mirror the already-shipped suggestTitleRewrite fix: in the no-city branch, drop the region literal entirely so the title carries only the phrase plus the existing brand suffix. Change lines 1321-1323 to: const newTitle = cityName ? `Best ${phraseTitle} in ${cityName}${suffix}` : `${phraseTitle}${suffix}`; (the suffix already carries the brand name extracted from the existing title, so no region word is fabricated for any vertical/geo). If a region word is genuinely wanted, thread the tenant regi

## [HIGH/M] src/domains/entity/discrepancy-detect.ts :202-237
- cat: service/keyword taxonomy
- fix: Make detectDiscrepancies vertical-agnostic by deriving the candidate scan universe from per-tenant data instead of the hardcoded literals. Concretely: (a) inside detectDiscrepancies, fetch the tenant config via getBusinessConfigForCurrentTenant() (already used in today-data.ts:2901) and pass cfg.locations/cfg.locationTerms and cfg.services/cfg.serviceTerms into buildLocationPatterns/buildServicePatterns as the candidate seed; (b) additionally union in the entity index's external (non-owned) loca

## [HIGH/M] src/adapters/profound/entity-seed.ts :14-39
- cat: competitor
- fix: Stop hardcoding competitors and brand scope in entity-seed.ts. (1) Change buildEntitySeed(accountId) to buildEntitySeed(accountId, opts) accepting a resolved competitor list and brand-scope fields. (2) Seed ONLY the owned brand from getSiteConfig() (already done) but source location_scope/service_scope from getBusinessConfig(tenantId) (e.g. cfg.location / cfg.serviceScope) instead of the literals "Bay Area" / "custom home building"; default to null when absent. (3) In import-orchestrator.ts, bef

## [HIGH/S] src/domains/competitors/universe-defaults.ts :8-46
- cat: competitor
- fix: In loadCompetitorUniverseRuntime() (src/domains/competitors/universe-read.ts), replace the final demo_defaults_explicit fallback (L122-127) so the no-config path returns the SAME honest empty/no-universe runtime the import branch already produces (origin "empty_import_mode", entries [], fingerprint of []), which buildTodayCompetitorLine, the /competitors page, and gap-ledger already render as the vertical-neutral "No competitor universe configured — treat cited external domains as uncategorized 

## [HIGH/M] src/domains/onboarding/scope-validation.ts :30-46
- cat: prompt_question_template
- fix: Drive the "what kind of work do you take on?" step from per-tenant derived signals instead of a fixed builder enum. Preferred: in scope-form.tsx, render confirmable chips from the already-collected per-tenant services/industry (getBusinessConfigForCurrentTenant().services / persistedConfig.services, lowercased, derived during onboarding) rather than mapping PROJECT_MIX_TAGS -> PROJECT_MIX_LABELS; fall back to a free-text "what services do you offer?" input when no derived services exist. If a fi

## [HIGH/M] src/app/(shell)/onboard/scope/scope-form.tsx :119-153
- cat: user-facing copy assuming a business type
- fix: Stop unconditionally rendering the six builder PROJECT_MIX_TAGS in the onboarding scope step. Thread the tenant's segment (or site-derived BusinessConfig.services) into the scope page: in src/app/(shell)/onboard/scope/page.tsx, load the persisted/derived segment + BusinessConfig (the same persistedConfig.services already used in launch-flow.ts:229) and pass it to ScopeForm. In scope-form.tsx, only render the builder project-mix grid with the "What kind of work do you take on?" legend when segmen

## [HIGH/S] src/app/(shell)/onboard/competitors/page.tsx :42
- cat: user-facing copy assuming a business type
- fix: Replace the literal subtitle on line 42 with vertical-neutral copy, e.g. subtitle="Pick the competitors you want Beacon to compare you against." This matches the already-neutral form label on competitors-form.tsx line 67 ("Competitors to compare you against") and the documented "company names" field semantics. No logic change; single-string edit.

## [HIGH/M] src/lib/business-config.ts :216-225
- cat: business-config defaults
- fix: Two coordinated changes. (A) In src/lib/business-config.ts PLACEHOLDER_CONFIG.directoryDomains, replace the home-services list with a TRULY universal blocklist — channels that pollute any vertical's leaderboard: ["yelp.com","reddit.com","bbb.org","facebook.com","instagram.com","linkedin.com","nextdoor.com","google.com/maps"] — and DROP houzz.com/angi.com/thumbtack.com/homeadvisor.com/buildzoom.com (move builder-specific ones into Ritz's own tenant config file). (B) In src/domains/onboarding/deri

## [HIGH/M] src/domains/pages/classify-asset-type.ts :84-101
- cat: vertical-tuned scoring/page-classification feeding severity
- fix: Make the scan-path classification config-driven instead of the hardcoded classifyAssetType. In detect-findings.ts:662, thread the tenant BusinessConfig into generateFindings (orchestrate-scan.ts already resolves tenantId; load getBusinessConfig there) and classify via classifyPageType(curr.url, businessConfig). When businessConfig.contentSiteMode is true (or classifyPageType returns "content"), diff against CONTENT_PAGE_EXPECTED_SCHEMA (Article required, BreadcrumbList recommended) via diffSchem

## [HIGH/M] src/domains/pages/expected-schema.ts :32-85
- cat: vertical-tuned schema expectation (drives severity/findings)
- fix: In detect-findings.ts at the schema_missing_for_page_type loop (lines 661-703), thread businessConfig into generateFindings (orchestrate-scan.ts already has tenantId; load it via getBusinessConfig/getBusinessConfigForCurrentTenant) and branch like missing-schema.ts does: compute pageType = classifyPageType(curr.url, businessConfig); when pageType === 'content' (or businessConfig.contentSiteMode / segment is content_publisher/product), evaluate coverage with diffSchemaCoverageForSpec(CONTENT_PAGE

## [MEDIUM/M] src/domains/entity/discrepancy-detect.ts :200-213
- cat: geography/locale
- fix: Thread a tenant-derived candidate vocabulary into detectDiscrepancies instead of the literal Bay-Area/builder arrays. detectDiscrepancies currently takes only entityIndex; extend its signature (and the callers at today-data.ts:1865, diagnostics/page.tsx:1353/1503/1917, profound-adapter.ts:148) to also pass the tenant config (or a precomputed candidate set). Build the location candidate set from getBusinessConfig(tenantId): use config.locationTerms (falling back to config.locations) — the SAME so

## [MEDIUM/M] src/domains/pages/frontier-planner.ts :169-170
- cat: geography/locale
- fix: Thread the tenant's BusinessConfig into computeFrontiers (the /topics page and package-actions are async server contexts that can await getBusinessConfigForCurrentTenant()). Replace the literal regexes with config-driven matching: build a city set from cfg.locations and a service vocabulary from cfg.services (lowercased), then classify topicLower as city_frontier if it starts with / contains any cfg.locations entry, and service_frontier if it contains any cfg.services entry; set geography/servic

## [MEDIUM/S] src/app/(shell)/today-data.ts :1208-1215
- cat: geo-hardcoding
- fix: In today-data.ts replace the scannerKnownLocations literal (lines 1209-1216) with only the tenant's own location vocabulary: const scannerKnownLocations: string[] = Array.from(new Set([ ...(scannerBusinessConfig.locations ?? []), ...(scannerBusinessConfig.locationTerms ?? []) ])); Delete the hardcoded Bay-Area city array entirely. This keeps the city-suppression filter correct for any vertical/geo (empty for content sites, tenant-specific for local businesses). If neighbor expansion is wanted la

## [MEDIUM/S] src/domains/product/morning-brief.ts :1323, 1099-1103
- cat: geo-hardcoding
- fix: In generateQueryGapSteps (morning-brief.ts ~line 1310-1312), drop the hardcoded "Bay Area" fallback exactly as the sibling suggestTitleRewrite already does: when cityName is null, omit any region word — newTitle = cityName ? `Best ${phraseTitle} in ${cityName}${suffix}` : `${phraseTitle}${suffix}`; (the brand suffix already carries identity). If a city/region word is desired for non-location pages, pass the tenant's cities config into generateQueryGapSteps (it is already available at the generat

## [MEDIUM/M] src/domains/pages/frontier-planner.ts :169-177
- cat: industry-vertical-vocabulary
- fix: Add a BusinessConfig parameter to computeFrontiers and replace the two inline literals with getLocationRegex(cfg)/getServiceRegex(cfg) from src/lib/business-config.ts. In the two callers, resolve cfg via getBusinessConfigForCurrentTenant() (already async server contexts in topics/page.tsx and package-actions.ts) and pass it in. Reconcile the city-anchor difference: getLocationRegex is unanchored (\b...\b) while the current code anchors at start (^), so either run getLocationRegex(cfg) against to

## [MEDIUM/S] src/domains/pages/frontier-compiler.ts :233
- cat: industry-vertical-vocabulary
- fix: In compileMissingPage, resolve the tenant's vertical noun from BusinessConfig instead of the "Custom Home Builder" literal. compileMissingPage is sync, so pass the config in (compileFrontierAttack already runs server-side at /topics/page.tsx:449 where await getBusinessConfigForCurrentTenant() is available): const cfg = await getBusinessConfigForCurrentTenant(); const verticalNoun = cfg.services?.[0]?.trim() || cfg.industry?.trim() || "Services"; then suggestedTitle: f.geography ? `${cap(f.geogra

## [MEDIUM/M] src/domains/product/morning-brief.ts :1178
- cat: industry-vertical-vocabulary
- fix: Thread the resolved tenant BusinessConfig (from getBusinessConfigForCurrentTenant — BusinessConfig in src/lib/business-config.ts already exposes per-tenant `services: string[]` and `industry: string`) into generateInternalLinkSteps via buildMorningBrief and both call sites (lines 718 and 1484). Replace `const anchorText = citedTopic ?? \`Custom Home Builder in ${cityName}\`` with a per-tenant fallback: `const vocab = cfg.services?.[0] ?? cfg.industry; const anchorText = citedTopic ?? (vocab ? \`

## [MEDIUM/L] src/domains/recommendations/providers/openai.ts :91, 191-304, 540-700
- cat: industry-vertical-vocabulary
- fix: 1) Add tenant identity to the packet: thread a tenantBrandName (full + short form) and an industry/vertical label into SpecificEditEvidencePacket (from getBusinessConfigForCurrentTenant / active-tenants) in specific-edit-evidence.ts, alongside the existing brandAssertions. 2) Convert SYSTEM_PROMPT from a static const into a buildSystemPrompt(packet) function that interpolates these fields: replace "ships directly into Ritz's pages" with packet.tenantBrandName; make the Rule 18 brandAssertions il

## [MEDIUM/M] src/domains/recommendations/brand-assertions.ts :239-356
- cat: industry-vertical-vocabulary
- fix: Generalize the four builder-anchored noun alternations to vertical-agnostic terms and incorporate the tenant's own industry noun. Concretely: (1) For best_in_market and leading_brand, replace the literal builder-noun group `(?:builders?|firms?|...|partners?)` with a vertical-agnostic group that includes generic provider/business nouns (provider|practice|clinic|firm|agency|studio|company|business|service|shop|store|restaurant|dentist|doctor|lawyer|attorney|...) PLUS the tenant's industry noun(s).

## [MEDIUM/M] src/domains/competitors/universe-defaults.ts :8-45
- cat: tenant-specific-defaults
- fix: In src/domains/competitors/universe-read.ts, do not serve the builder demo set as the universal fallback. Replace the final `buildRuntime("demo_defaults_explicit", DEMO_CONFIGURED_COMPETITOR_ENTRIES, ...)` with an empty universe (origin like "empty_no_config", entries: []) for any tenant that has no configured competitors, mirroring the existing empty_import_mode shape. Only return DEMO_CONFIGURED_COMPETITOR_ENTRIES when the ambient tenant is the builder demo/Ritz tenant (gate behind the builder

## [MEDIUM/M] src/domains/competitors/universe-defaults.ts :8-45 (served via universe-read.ts:122)
- cat: tenant-flavored competitor defaults on render path
- fix: In loadCompetitorUniverseRuntime() (src/domains/competitors/universe-read.ts), do NOT fall through to DEMO_CONFIGURED_COMPETITOR_ENTRIES for real tenants. Gate the demo list behind an explicit demo/sample flag: e.g. only return demo_defaults_explicit when process.env.BEACON_DEMO_MODE === 'true' OR the resolved currentTenantId() equals the founder/demo tenant id (tenant-ritz-founder); otherwise return buildRuntime('no_competitors_configured', [], { universe_version: 0, universe_fingerprint: compu

## [MEDIUM/M] src/domains/competitor-monitoring/detect-changes.ts :191-200
- cat: service/keyword taxonomy
- fix: Thread the tenant taxonomy into the alert pipeline. (1) Change generateCompetitorAlerts to accept an options arg, e.g. generateCompetitorAlerts(changes, { servicePatterns, locationPatterns }), and pass those into inferTopicFromPath(path, patterns). (2) Build the patterns from per-tenant BusinessConfig at the today-data.ts:1338 call site, slugifying the human-readable strings to match URL path tokens: const servicePatterns = (businessConfig.services ?? []).map(s => s.toLowerCase().trim().replace(

## [MEDIUM/M] src/domains/opportunity-candidates/builders.ts :33-57
- cat: service/keyword taxonomy
- fix: Thread a per-tenant topic-adjacency source through generateCandidates the same way `cities` already is. Concretely: (1) add an optional `topicAdjacency?: Record<string,string[]>` (or a sibling-derivation function) param to generateCandidates and computeOpportunityCandidates, defaulting to undefined; (2) in the /expansion and /diagnostics callers, derive it from the current tenant — cheapest M-effort version: build adjacency from BusinessConfig.services (getBusinessConfigForCurrentTenant().servic

## [MEDIUM/S] src/domains/product/morning-brief.ts :1178
- cat: service/keyword taxonomy
- fix: Thread the tenant vocab into generateInternalLinkSteps (it is already passed to generateSteps as `vocab`) and replace the hardcoded literal with a tenant-derived fallback. Concretely: change the fallback at line 1178 to prefer the city page's own title/H1 (already available as cp.title — strip the "| Brand" suffix), else `${vocab.industry} in ${cityName}` when vocab.industry exists, else a neutral generic like `${cityName}` (just the location name) — never a hardcoded vertical noun. E.g.: `const

## [MEDIUM/M] src/domains/product/morning-brief.ts :1081-1112
- cat: service/keyword taxonomy
- fix: Pass the tenant business config (industry + services, already available at the call sites via tenantVocab/opts.industry/opts.services) into generateSectionSkeleton and make the cost/process/design-build/neighborhood branches vertical-neutral by default. Concretely: (1) cost branch → drop "per sq ft" and "permits"; use generic "typical cost ranges for {topic||'this service'}" and a neutral factors list. (2) process branch → "Our {topic||'Service'} Process" with generic neutral steps ("inquiry → c

## [MEDIUM/S] src/domains/product/morning-brief.ts :921
- cat: geo/taxonomy hardcoding
- fix: Replace the hardcoded regex with a scan over the threaded `cities` param (already = businessConfig.locations, lowercased), longest-name-first so multi-word cities win, matched on word boundaries. Concretely, drop lines 921-924 and substitute: build the candidate list from `cities` (guard for undefined/empty -> city = null, which correctly skips the city branch for content sites / national brands with no service-area geography), sort by descending length, and for each candidate test a word-bounda

## [MEDIUM/S] src/app/(shell)/onboard/competitors/competitors-form.tsx :78-82
- cat: competitor
- fix: Replace the hardcoded builder-name placeholder with vertical-neutral example text such as "Competitor One\nCompetitor Two\nCompetitor Three", or better, derive examples from the tenant's already-captured segment/industry (ctx.tenant.project_mix / persistedConfig.industry are available in the onboarding context) and pass them into CompetitorsForm as a prop with a neutral default. Also change the builder-specific wording: in page.tsx line 41-42 the title 'Competitors to watch' is fine but the subt

## [MEDIUM/M] src/domains/pages/builder-benchmark.ts :49-59
- cat: competitor
- fix: Add a `directoryDomains: ReadonlyArray<string>` (and optionally a `competitorNames: Record<string,string>` map from competitor_config/tracked_entities) parameter to computeMarketBenchmark, mirroring discoverCompetitorUniverse/classifyCompetitorType. Replace the inline `["houzz.com","yelp.com","angi.com","reddit.com","diamondcertified.org"]` array on line 62 with a normalized membership check against the passed directoryDomains (using the same `norm === d || norm.endsWith('.'+d)` logic as classif

## [MEDIUM/M] src/domains/opportunity-candidates/builders.ts :15-57
- cat: prompt_question_template
- fix: Replace the module-level builder-only TOPIC_ADJACENCY literal + findAdjacentTopics with a per-tenant/derived adjacency source. Thread an optional adjacency map (or the tenant's own services/topics vocabulary from getBusinessConfigForCurrentTenant) through generateCandidates → generateTopicExpansionCandidates the same way cities is already threaded; derive adjacency from the tenant's own services/topic clusters, or key it by tenant vertical/segment in config. For unknown verticals, return no synt

## [MEDIUM/S] src/domains/recommendations/providers/openai.ts :155, 191-211
- cat: prompt_question_template
- fix: Convert SYSTEM_PROMPT from a static module-level const into a buildSystemPrompt(packet) function that interpolates per-tenant context already available in the packet. Concretely: (1) Replace the literal "Ritz's pages" on line 155 with the tenant's entity name — getBrandNameStyle(packet.tenantId)?.fullName already exists in brand-assertions.ts and returns e.g. "Ritz Builders"; fall back to a neutral "the operator's pages" when null. (2) Replace the hardcoded builder/Bay-Area GOOD few-shots (line 

## [MEDIUM/S] src/app/(shell)/onboard/competitors/competitors-form.tsx :79-81
- cat: user-facing copy assuming a business type
- fix: Make the placeholder vertical-neutral and prefer real per-tenant signal. (1) Pass the tenant's industry/segment (e.g. ctx.tenant.segment or business_category) and discovered_competitors into CompetitorsForm. (2) If discovered_competitors has 2-3 entries, show those joined by \n as the placeholder; otherwise fall back to neutral generic examples like "Acme Co\nBeta LLC\nGamma Inc" (or a segment-aware example map keyed off the tenant segment with a generic default). Concretely, in page.tsx pass ex

## [MEDIUM/S] src/app/(shell)/settings/prompts/settings-prompts-client.tsx :119
- cat: user-facing copy assuming a business type
- fix: In the server page (src/app/(shell)/settings/prompts/page.tsx, which already has tenantId), call getBusinessConfig(tenantId) (or getBusinessConfigForCurrentTenant()) and derive a placeholder example, then pass it as a prop to SettingsPromptsClient. Build it from cfg.services[0] and cfg.locations[0]: when both present use `e.g. Best ${cfg.services[0]} in ${cfg.locations[0]}?`; when service present but no location use `e.g. Best ${cfg.services[0]}?`; otherwise fall back to a vertical-neutral `e.g.

## [MEDIUM/S] src/domains/scanning/detect-findings.ts :677-682
- cat: vertical-tuned severity threshold
- fix: Replace the (homepage || city_page) HIGH gate with a page-type-agnostic, citation-driven gate so any indexable content asset reaching >50 citations can hit HIGH. Concretely, in detect-findings.ts ~line 677, define the set of content-bearing asset types and gate on membership rather than the two-type allowlist, e.g.: const CONTENT_ASSET_TYPES = new Set<AssetType>(["homepage","city_page","service_page","project_page","process_page","brand_page","hub_page"]); const severity: FindingSeverity = CONTE

## [MEDIUM/M] src/domains/recommendation-intelligence/page-classifier.ts :296-322
- cat: vertical-tuned page-importance via classifier fallback
- fix: Two-part. (1) Auto-derive urlPatterns at onboarding instead of relying on the builder-slug fallback: in derive-business-profile.ts/derive-business-config.ts, infer the dominant detail-page prefixes from the crawled keyPages/sitemap (e.g. cluster internal paths by leading segment and set urlPatterns.service to the most common multi-item detail prefix) so a dentist's /treatments/ or a SaaS's /features/ is recognized as the tenant's service-detail pattern. (2) Remove the hardcoded /locations//servi

## [MEDIUM/M] src/domains/pages/frontier-planner.ts :169-170, 212
- cat: vertical-tuned frontier classification + volume threshold
- fix: Thread the tenant's vocabulary into computeFrontiers. (1) Add optional params knownCities?: ReadonlyArray<string> and knownServices?: ReadonlyArray<string> to computeFrontiers (or pass the BusinessConfig). In topics/page.tsx (and package-actions.ts) load getBusinessConfigForCurrentTenant() and pass cfg.locations / cfg.services. (2) Replace the hardcoded regexes at lines 169-170 with the existing injected-list helpers: import extractGeoTag and extractTopicTag from recommendation-title-humanizer; 

## [MEDIUM/M] src/domains/product/morning-brief.ts :914
- cat: query-relevance / stopword vocabulary
- fix: Reduce the inline list to genuine generic English stopwords only — ["best","top","the","for","and","which","who","should"]. Add a tenant-derived stopword set: extend the TenantTitleVocab type (or pass an additional param) to carry businessConfig.stripWords (and optionally the already-available `cities` location tokens), thread it from today-data.ts (businessConfig.stripWords ?? []) through buildMorningBrief -> toBriefItem -> generateSteps -> suggestTitleRewrite the same way `cities`/`vocab` alre

## [MEDIUM/M] src/domains/answer-intelligence/query-index.ts :262-267
- cat: query-relevance / stopword vocabulary
- fix: Split STOP_WORDS into a language-generic core (the,a,an,in,for,of,on,to,and,or,my,is,are,i,do,which,who,what,how,best,top,should -- keep these; they are neutral across verticals) and remove the vertical/geo nouns (hire,builders,builder,home,homes,bay,area,custom,luxury). Add a stripWords parameter to extractKeywords(text, stripWords: ReadonlyArray<string> = []) that unions the generic core with the tenant's words, and add a stripWords param to getRelevantQueriesForPage(... , cities = [], stripWo

## [MEDIUM/S] src/domains/recommendations/recommendation-action-rows.ts :1839,1848
- cat: title/recommended-move topic extraction
- fix: Thread the already-in-scope tenant vocabulary into both calls inside composeRecommendedMove(): change line 1839 and line 1848 from `topic: extractTopicTag(rec.clusterLabel ?? ""),` to `topic: extractTopicTag(rec.clusterLabel ?? "", args.knownServices),`, matching composeMetaRowTitle (line 1757) and the other call sites (769, 1384) in the same file. This makes extractTopicTag try matchKnownService against BusinessConfig.services first, so any vertical gets its own service phrase in the recommende

## [MEDIUM/M] src/domains/recommendations/recommendation-title-humanizer.ts :59-222
- cat: title-generator / topic vocabulary
- fix: Make the topic vocabulary per-vertical instead of a single builder literal, and close the unthreaded calls. 1) Load topic tags from per-tenant/segment config rather than the builder literal: add a topicTags (or segment vocabulary) field to BusinessConfig and thread it (like knownCities/knownServices) into buildRecommendationActionRows / humanizeRecTitle; have extractTopicTag/extractTopicFromPrompts iterate the injected tags. Keep the builder TOPIC_TAGS only as the founder/Ritz segment's vocabula

## [LOW/S] src/domains/answer-intelligence/query-index.ts :266-271
- cat: service/keyword taxonomy
- fix: Strip the seven builder/geo tokens ("builders","builder","home","homes","bay","area","custom","luxury") from STOP_WORDS, leaving only true linguistic stop-words (the,a,an,in,for,of,on,to,and,or,my,is,are,i,do,which,who,what,how,best,top,should,hire). For domain-noise filtering, derive a per-tenant stop-word set from the tenant's own brand/industry words (e.g. tokenize businessConfig.businessName + industry/segment from getBusinessConfigForCurrentTenant) and thread it as an optional parameter int

## [LOW/S] src/domains/recommendations/recommendation-action-rows.ts :1839, 1848
- cat: service/keyword taxonomy
- fix: Pass args.knownServices into both extractTopicTag calls, matching the existing pattern at lines 769/1384: change `topic: extractTopicTag(rec.clusterLabel ?? "")` to `topic: extractTopicTag(rec.clusterLabel ?? "", args.knownServices)` at both line 1839 and line 1848. Even simpler and more consistent: reuse the already-computed `topicTag` local (line 1383-1385), which calls extractTopicTag with args.knownServices on the identical input — passing `topic: topicTag` would dedupe the logic. With known

## [LOW/M] src/domains/competitors/classify-type.ts :3-17
- cat: competitor
- fix: Split classification into a UNIVERSAL hardcoded layer + a per-tenant configurable layer. (1) Keep only truly cross-vertical universals as static fallbacks: national general-press (nytimes/wsj/forbes/bloomberg/businessinsider), big social/platforms (facebook/instagram/linkedin/nextdoor/google.com/maps), and generic forums (reddit/quora/stackexchange). REMOVE the builder/Bay-Area literals (sfchronicle, mercurynews, dwell, hgtv, bobvila, thisoldhouse, thespruce, architecturaldigest, curbed, realtor

## [LOW/S] src/app/(shell)/settings/prompts/settings-prompts-client.tsx :119, 133
- cat: prompt_question_template
- fix: Two options. Cheapest (S, vertical-neutral, no data wiring): replace the three literals with bracketed neutral hints — prompt text "e.g. Best [your service] in [your city]?", topic id "e.g. Your Topic", location "e.g. Your City". Better (still S/M, tenant-personalized): in page.tsx call getBusinessConfigForCurrentTenant() from src/lib/business-config.ts (already async-safe and used by other server routes), pass { industry, city } into SettingsPromptsClient as props, and interpolate: prompt place

## [LOW/S] src/domains/recommendations/recommendation-action-rows.ts :1839, 1848
- cat: user-facing copy assuming a business type
- fix: Pass args.knownServices as the second argument at both call sites so the tenant's own service vocabulary is tried before the builder TOPIC_TAGS fallthrough, matching lines 769/1384: change line 1839 and line 1848 from extractTopicTag(rec.clusterLabel ?? "") to extractTopicTag(rec.clusterLabel ?? "", args.knownServices). Two-line edit, no signature changes, exercises an existing/tested code path in extractTopicTag.

## [LOW/S] src/app/(shell)/onboard/business/business-form.tsx :78, 109
- cat: user-facing copy assuming a business type
- fix: In src/app/(shell)/onboard/business/business-form.tsx line 78, change placeholder="Acme Builders" to a vertical-neutral example such as placeholder="Acme Co" (matching the neutral "Acme Co" already used in business-config.test.ts) or placeholder="Your business name". Leave the domain placeholder "acme.com" (line 109) unchanged — it is already neutral. No downstream/data changes needed since the placeholder is never read.

## [LOW/M] src/domains/recommendations/recommendation-title-humanizer.ts :441-454,383
- cat: title-generator / label sanitization
- fix: Replace the three hardcoded literals with per-tenant config threaded from getBusinessConfigForCurrentTenant. (1) Add `knownCities?: ReadonlyArray<string>` (BusinessConfig.locations) and `stripWords?: ReadonlyArray<string>` (BusinessConfig.stripWords) params to sanitizeClusterLabel and pageNameFromUrl. (2) In sanitizeClusterLabel, build the trailing-geo strip from knownCities (escape + join into `\\s+(city1|city2|...)$`) instead of the literal `Bay Area`, and build the trailing category-noun stri

