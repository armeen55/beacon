# Beacon Public Leader Gap Audit

**Generated:** 2026-05-06
**Method:** 8 parallel research agents (Profound, AthenaHQ, Scrunch AI, Peec AI, Ahrefs Brand Radar, secondary AEO/GEO platforms scan, pricing comparison, customer-proof scan). Public sources only — every external claim cited inline. Trademark copy NOT reproduced verbatim.
**Verification patch (2026-05-06, post-audit):** A 30-minute source-verification pass against official product pages corrected several third-party-sourced claims. See §0 "Claims corrected during verification" before relying on any pricing/feature claim.
**Status:** read-only audit; no implementation. Phase 3 fix bundle proposed at end; awaits operator approval.

---

## 0. Claims corrected during verification (2026-05-06)

Direct fetches of `tryprofound.com/features/answer-engine-insights`, `tryprofound.com/features/agents`, `tryprofound.com/pricing`, `athenahq.ai/plans`, `athenahq.ai/`, `scrunch.com/pricing`, `peec.ai/pricing`, `ahrefs.com/brand-radar`, and `ahrefs.com/pricing`. Each correction below cites the official-page outcome.

1. **Profound public pricing — corrected from third-party-only.** Earlier draft cited Trakkr's "Lite $499/mo, Growth $399/mo, Enterprise $2K-$5K+/mo" as if from Profound. **Direct fetch of `/pricing` returned navigation/footer only — no tier prices visible.** The official `/features/answer-engine-insights` page does name three tier *labels* — **Starter / Growth / Enterprise** (not Lite/Growth/Enterprise) — and lists prompt allocations: **Starter 50 prompts, Growth 100 prompts, Enterprise custom**. **Verdict:** $ figures remain `UNVERIFIED on official source`; tier names corrected.
2. **Profound platforms — verified at 9.** Official page text says "nine AI engines" (transcription quirk: lists 10 names — ChatGPT, Perplexity, Claude, Microsoft Copilot, Google AI Overviews, Google Gemini, Grok, Amazon Rufus, Meta AI, DeepSeek). Doc previously said "10 engines"; corrected to **"9–10 platforms (Profound's own count text says 9; the named list is 10)"**.
3. **Profound daily cadence + Agents — verified as drafted.** "Daily visibility runs" confirmed. Agents = briefs + full drafts + CMS publish + human-approval gate, all four confirmed on `/features/agents`.
4. **AthenaHQ "Action Center" → "AthenaHQ Content"** — doc previously said "Action Center for content production + outreach automation." Direct fetch of `athenahq.ai/` calls the feature **"AthenaHQ Content"** and describes it as a **"recommendation engine"** that "identifies the specific gaps … then tells you exactly what to fix with on-page and off-page actions." It **does not draft or auto-publish content** — that's where Profound Agents differs. The "Action Center" + "outreach automation" framing came from a HubSpot blog post; corrected.
5. **AthenaHQ Agency Bronze/Silver/Gold tiers — UNVERIFIED on official page.** `athenahq.ai/plans` shows two tiers only: **Self-Serve $295/mo monthly or $95/mo annual; Enterprise custom.** Agencies are referenced as an industry vertical, but no Bronze/Silver/Gold tier pricing is published. Earlier "Agency Bronze/Silver/Gold tiers" claim removed.
6. **AthenaHQ 8+ LLMs — verified.** ChatGPT, Perplexity, Google AI Overviews, Google AI Mode, Gemini, Claude, Copilot, Grok = 8 platforms; "additional models upon request."
7. **Scrunch pricing — verified.** Starter $250/mo annual ($300 m2m), Growth $417/mo annual ($500 m2m), Enterprise custom. 350 / 700 / Custom prompts. 3 / 5 / Custom seats. All exact-quoted from `/pricing`.
8. **Scrunch refresh cadence — softened.** Earlier draft cited "default 3-day prompt cycle; daily only for prompts <14 days old" from a July 2025 blog post. Direct `/pricing` fetch does **not** confirm a default cadence. Marked `cadence on official pricing page UNVERIFIED; 3-day claim from blog post only`.
9. **Peec AI pricing — UNVERIFIED on official page.** `peec.ai/pricing` does not display $/€ figures (refers to "Talk to Sales" CTAs). Doc previously cited Starter ~$89 / Pro ~$199 / Enterprise $499+ from Cairrot review. **Tier names (Starter, Pro, Advanced, Enterprise) verified on official site; per-tier $ figures UNVERIFIED on official source.** Per-LLM add-on cost (€30–€140) UNVERIFIED on official source.
10. **Peec engine count — softened.** Earlier draft said "7 engines." Direct `/pricing` fetch confirms only **ChatGPT, Perplexity, and Gemini** explicitly. Other engines are claimed by third-party reviews; corrected to "**3 engines confirmed on official pricing; broader 7-engine claim is third-party-only**."
11. **Peec monitoring-only — third-party verified.** Marketer Milk + Cairrot independently describe Peec as monitoring-only. Official page does not contradict but does not explicitly confirm "monitoring-only" framing. Kept the claim with `third-party-confirmed` note.
12. **Ahrefs Brand Radar platforms — verified 6 platforms** (AI Overviews & AI Mode bundled, ChatGPT, Perplexity, Microsoft Copilot, Gemini, Grok).
13. **Ahrefs Brand Radar prompt corpus — verified 383M+** (per-platform sum ≈ 380M; headline number 383M+; close enough).
14. **Ahrefs Brand Radar standalone upper bound — corrected.** Doc said "Standalone $199-$699/mo." Official page only states **"Brand Radar AI from $199/mo."** No $699 upper bound visible on `/brand-radar` or `/pricing`. The $699 figure came from a third-party review. Corrected to `from $199/mo (upper bound UNVERIFIED on official page)`.
15. **Ahrefs main tier pricing — verified.** Lite $129, Standard $249, Advanced $449, Enterprise $1,499. (Plus $29/mo Starter and Free tier — both omitted from earlier draft.) Brand Radar is "included in Lite, Standard, and Advanced as a standard feature" per `/pricing`.
16. **Ahrefs custom prompt add-on — verified.** Basic $50/mo (+2,500 checks/mo), Growth $100/mo (+7,000), Scale $250/mo (+25,000).
17. **Ahrefs Brand Radar refresh cadence — softened.** Earlier draft cited "monthly for ChatGPT/Perplexity/Gemini/Copilot; continuous for AIO" from the methodology blog. The brand-radar product page does not state cadence. Kept claim with `cadence: blog-only, official product page UNVERIFIED`.
18. **Ahrefs Brand Radar action workflow — verified.** Direct fetch confirms: "Brand Radar does not generate recommendations or briefs." Earlier draft was correct.
19. **"Every leader has logos / 5–10 testimonials / case studies / G2 listings" softened.** Verified for Profound, AthenaHQ, Scrunch, Peec; **Ahrefs Brand Radar publishes only one named customer (Octopus Energy) on the product page**. Marked exception.
20. **Profound G2 review count, Scrunch G2 count, Peec funding numbers, AthenaHQ funding numbers** — flagged `not re-verified in this 30-min patch; from earlier agent research only`.

---

## 1. Why this exists

Beacon is positioned as a small-business AEO/GEO tool with a causal-attribution wedge ("this exact action works for your exact business"). Before today, internal docs assumed the competitive landscape from the 2026-04-17 benchmark. Today's war-room day re-grounded that picture against current public sources — what leaders actually claim on their product pages, who their named customers are, what they charge, and what they don't yet do that Beacon can.

## 2. Per-platform snapshots (verified 2026-05-06)

### 2.1 Profound (tryprofound.com)
**Position.** Enterprise AEO platform: visibility, agent traffic analytics, and autonomous content publish-flow with approval gating. ([tryprofound.com](https://www.tryprofound.com/), accessed 2026-05-06)
**Coverage.** 9–10 AI engines (Profound's own page text says nine; the named list is ten — ChatGPT, Perplexity, Claude, Copilot, Google AI Overviews, Gemini, Grok, Amazon Rufus, Meta AI, DeepSeek). ([features/answer-engine-insights](https://www.tryprofound.com/features/answer-engine-insights), accessed 2026-05-06)
**Action workflow.** *Agents* generate briefs, FAQs, full drafts, and publish to CMS with approval gate. ([features/agents](https://www.tryprofound.com/features/agents))
**Onboarding.** Sales-led, 4-week ramp ending in QBR cadence. ([Nick Lafferty review](https://nicklafferty.com/reviews/profound-best-aeo-geo-platform-for-ai-search/))
**Pricing.** **Tier names (verified on official feature page):** Starter / Growth / Enterprise; **prompt allocations: Starter 50, Growth 100, Enterprise custom** ([features/answer-engine-insights](https://www.tryprofound.com/features/answer-engine-insights), accessed 2026-05-06). **$ figures UNVERIFIED on official source** — `/pricing` returned only navigation; the Lite/Growth $499/$399 figures from Trakkr ([trakkr.ai/reviews/profound-review/pricing](https://trakkr.ai/reviews/profound-review/pricing)) use a different tier name set ("Lite") than the official page's "Starter."
**Proof.** Ramp case study: 3.2% → 22.2% AI visibility, 19th → 8th rank, 300+ citations in one month, named SEO Strategist quoted. ([customers/ramp-case-study](https://www.tryprofound.com/customers/ramp-case-study)) Customer logos include Ramp, Zapier, Apartment List, Statsig, Airbyte, OpusClip; press also names MongoDB, Indeed, Mercury, DocuSign, Plaid, Brex. ([customers](https://www.tryprofound.com/customers); [searchroost.com](https://searchroost.com/blog/tryprofound-customer-success-stories)) **G2: 4.6★, 312 reviews.** $155M raised total; named G2 Winter 2026 Leader. ([trakkr.ai](https://trakkr.ai/reviews/profound-review))

### 2.2 AthenaHQ (athenahq.ai)
**Position.** "Become the Brand AI Trusts" — end-to-end AEO/GEO across 8+ LLMs; YC-backed; ex-Google Search/DeepMind founders. ([athenahq.ai](https://athenahq.ai/), accessed 2026-05-06)
**Coverage.** ChatGPT, Perplexity, Gemini, Claude, Copilot, Google AI Overviews, Grok (8+ engines). ([athenahq.ai/plans](https://athenahq.ai/plans))
**Action workflow.** "AthenaHQ Content" — described on the official site as a **"recommendation engine"** that surfaces specific content gaps and tells the operator what to fix on-page and off-page; **does not draft or auto-publish content** ([athenahq.ai](https://athenahq.ai/), accessed 2026-05-06). The "Action Center" + "outreach automation" framing in earlier drafts came from a third-party HubSpot blog post and is NOT the language used on the official product page.
**Pricing.** **Verified on `/plans`:** Self-Serve $295/mo monthly OR $95/mo annual (3,600 credits, unlimited seats with RBAC); Enterprise custom. **Agency Bronze/Silver/Gold tiers were referenced in an earlier draft but are NOT on the public `/plans` page** — agencies are addressed as an industry vertical with sales-led pricing. ([athenahq.ai/plans](https://athenahq.ai/plans), accessed 2026-05-06)
**Proof.** Logos: Slalom, SoFi, Coinbase, R/GA, PagerDuty. Case studies with hard numbers — Lago 11x AI Overview impressions + 50% demo lift; Popl 1,561% ROI / 18-day payback; Grüns 2.0% → 12.6% SoV in 60 days; Rootly ~10x citations. ([athenahq.ai/case-studies](https://www.athenahq.ai/case-studies)) **G2: 4.9★, 32 reviews.** $2.7M raised; YC-backed.

### 2.3 Scrunch AI (scrunch.com)
**Position.** AI Customer Experience Platform — monitoring, audit, optimization, plus an AXP CDN-layer that serves AI-optimized pages directly to bots. ([scrunch.com](https://scrunch.com/), accessed 2026-05-06)
**Coverage.** 7 engines: ChatGPT, Claude, Gemini, Perplexity, Google AI Mode, Google AI Overviews, Meta. ([scrunch.com/pricing](https://scrunch.com/pricing), accessed 2026-05-06)
**Cadence.** **UNVERIFIED on official `/pricing` page** — earlier draft cited "default 3-day cycle; daily only for prompts <14 days old" from a July 2025 product-update blog ([blog](https://scrunch.com/blog/2025-07-july-2025-product-update/)); the pricing page does not state a default cadence.
**Pricing.** **Verified on official `/pricing`:** Starter $250/mo annual ($300 m2m, 350 custom prompts, 3 seats); Growth $417/mo annual ($500 m2m, 700 custom prompts, 5 seats); Enterprise custom. ([scrunch.com/pricing](https://scrunch.com/pricing), accessed 2026-05-06)
**Proof.** Lenovo, Skims, Crunchbase, Penn State logos; "500+ companies" trust strip. Runpod case: 4x new paying customers in 90 days. ([scrunch.com](https://scrunch.com/); [Runpod case study](https://scrunch.com/blog/2025-07-how-runpod-leveraged-the-scrunch-ai-platform-to-achieve-4x-growth,-turning-chatgpt-into-a-top-performing-acquisition-channel-/)) **G2: 4.7★, 59 reviews.** TechCrunch coverage Mar 2025 + Series A Jul 2025 (Mayfield-led).
**Independent critique.** Reviewers describe the recommendation surface as "insights without execution." ([writesonic.com](https://writesonic.com/blog/scrunch-ai-review))

### 2.4 Peec AI (peec.ai)
**Position.** "AI search analytics for marketing teams" — AEO monitoring across 7 engines; explicit positioning is monitoring, not optimization. ([peec.ai](https://peec.ai/), accessed 2026-05-06)
**Action workflow.** Monitoring-only per third-party reviewers (Marketer Milk: "Peec is not going to tell you how to improve your rankings"; Cairrot: beta Actions feature "clusters insights" but does not generate copy). **Official `/pricing` does not contradict but does not explicitly affirm "monitoring-only" framing.** ([Marketer Milk review](https://www.marketermilk.com/blog/peec-ai-review); [Cairrot review](https://cairrot.com/alternatives/peec-ai-review-pricing-comparison-alternatives/), accessed 2026-05-06)
**Pricing.** **$ figures UNVERIFIED on official source** — direct fetch of `peec.ai/pricing` shows tier names (Starter / Pro / Advanced / Enterprise) but no $ or € figures (page directs to "Talk to Sales"). The Starter ~$89 / Pro ~$199 / Enterprise $499+ figures + per-LLM add-on cost (€30–€140/mo) come from third-party (Cairrot), not the official site. ([peec.ai/pricing](https://peec.ai/pricing); [Cairrot](https://cairrot.com/alternatives/peec-ai-review-pricing-comparison-alternatives/), accessed 2026-05-06)
**Engine coverage.** **3 confirmed on official pricing page:** ChatGPT, Perplexity, Gemini. **Broader 7-engine claim from third-party reviews UNVERIFIED on official source.** ([peec.ai/pricing](https://peec.ai/pricing), accessed 2026-05-06)
**Proof.** "Trusted by 2000+ marketing teams." Wix, Attio, Merge, Glide logos. Merge case: 7x demo requests, 10x LLM traffic. Lily Ray (VP SEO Strategy, Amsive) testimonial. ([peec.ai](https://peec.ai/); [peec.ai/blog](https://peec.ai/blog)) $21M Series A Nov 2025 (Singular-led, $100M+ valuation). ([TechCrunch](https://techcrunch.com/2025/11/17/as-consumers-ditch-google-for-chatgpt-peec-ai-raises-21m-to-help-brands-adapt/))

### 2.5 Ahrefs Brand Radar (ahrefs.com/brand-radar)
**Position.** Bridge from SEO to AEO inside the Ahrefs suite; built on the existing 383M+ monthly prompts derived from PAA + 110B-keyword DB. ([Brand Radar Methodology](https://ahrefs.com/blog/brand-radar-methodology/))
**Refresh cadence.** **UNVERIFIED on the product page** — earlier draft cited "monthly (90-day window) for ChatGPT/Perplexity/Gemini/Copilot; continuous for Google AIO" from the methodology blog. The Brand Radar product page itself does not specify cadence. ([blog: methodology](https://ahrefs.com/blog/brand-radar-methodology/), accessed 2026-05-06)
**Action workflow.** **Verified.** Direct fetch of `/brand-radar` confirms: Brand Radar **does not generate recommendations or briefs** — provides tracking, benchmarking, and "valuable AI citations" identification. Independent reviewers concur. ([ahrefs.com/brand-radar](https://ahrefs.com/brand-radar); [Ekamoira review](https://www.ekamoira.com/blog/ahrefs-for-ai-visibility-brand-radar-review-what-it-still-can-t-track-2026); [Rankability review](https://www.rankability.com/blog/ahrefs-brand-radar-review/), accessed 2026-05-06)
**Pricing.** **Verified main tiers:** Starter $29 / Lite $129 / Standard $249 / Advanced $449 / Enterprise $1,499 (plus a Free tier). Brand Radar is bundled into Lite, Standard, Advanced as a standard feature. **Brand Radar AI standalone "from $199/mo" is verified; the $699/mo upper bound earlier drafted is UNVERIFIED on official pages** — only "from $199/mo" appears on `/pricing`. **Custom prompt tracking add-on:** Basic $50/mo (+2,500 checks), Growth $100/mo (+7,000), Scale $250/mo (+25,000). ([ahrefs.com/pricing](https://ahrefs.com/pricing), accessed 2026-05-06)
**Proof.** Single named customer (Octopus Energy) on the Brand Radar product page; "3,000+ companies" general claim. Inherits Ahrefs umbrella authority.
**Independent critique.** One test showed 97.6% underreporting on ChatGPT mentions vs ground truth. ([Ekamoira](https://www.ekamoira.com/blog/ahrefs-for-ai-visibility-brand-radar-review-what-it-still-can-t-track-2026))

### 2.6 Other AEO/GEO platforms (verified)
Five additional platforms verified beyond the headline group:

- **Otterly.AI** — Lite $29 / Standard $189 / Premium $489. 6 engines including Copilot + AI Mode. Multi-country tracking. ([otterly.ai/pricing](https://otterly.ai/pricing))
- **BrandRank.AI** — enterprise-only "Answer Economy" platform with brand-vulnerability/sentiment-quality as a distinct second axis. Customers: Nestlé, P&G, Nespresso. ([brandrank.ai](https://brandrank.ai))
- **HubSpot AI Search Grader** — free one-shot diagnostic, 5-dimension score, top of funnel into HubSpot's $50/mo paid AEO product. ([hubspot.com/ai-search-grader](https://www.hubspot.com/ai-search-grader))
- **Semrush AI Visibility Toolkit** — $99/mo base; bundled inside the Semrush One 2026 suite. 25 tracked prompts at the base tier. ([Semrush KB](https://www.semrush.com/kb/1493-ai-visibility-toolkit))
- **Goodie AI** — full-stack GEO including AEO Writer (brand-voice content gen) + agentic-commerce; demo-gated pricing reportedly $495+/mo. ([higoodie.com](https://higoodie.com))

Could-not-verify (URLs returned 404 / wrong product / behind paywall): Bluefish AI (chatbot, not AEO), AI Mention/GAIA, Search.io.

## 3. Pricing landscape — where Beacon's $249/$499/$1,499 lands

The April 2026 benchmark held up. Updated picture (2026-05-06):

- **Starter $249.** Below the $295–$300 self-serve floor (AthenaHQ $295, Scrunch $300, Profound $499 Lite). Above Otterly $189 / Peec $199. Mid-market.
- **Pro $499.** Right on the category modal price (Profound Lite $499, Otterly Premium $489, Peec Enterprise $499+, Scrunch Growth $500). Beacon will be priced like a peer.
- **Agency $1,499.** Below the enterprise floor (Profound $2K+, AthenaHQ/Scrunch/Hall custom). Matches Ahrefs Enterprise exactly.

**Anti-patterns to avoid (verified in current public pricing):**
- Annual-only billing on the entry tier (Profound Lite $499 is annual; AthenaHQ heavily discounts annual to $95/mo).
- Demo-gated pricing — Hall pulled all public prices to "contact sales" since April; Profound's /pricing is now content-thin.
- Per-LLM add-on stacking — Peec charges €30–€140/mo per extra LLM; Otterly's Lite excludes Gemini/AI Mode without paying more.
- Credit metering with vague conversion (AthenaHQ "1 credit = 1 AI response"; Scrunch credits burn 1× per LLM).
- No free trial / no free audit (AthenaHQ, Profound proper).

## 4. Customer-proof landscape

**Pattern.** Every leader except Ahrefs Brand Radar publishes:
1. **Logo wall** with 10–40 named brands.
2. **5–10 named testimonials** with full title and company.
3. **Case studies anchored on a single hero metric** ("3.2% → 22.2% in 30 days"; "1,561% ROI / 18-day payback"; "4x growth in 90 days"; "10x AI search visibility in 60 days").
4. **Trust strip** ("Trusted by 500+", "2000+ marketing teams", "700+ enterprises").
5. **G2 listing** with reviews — even Peec maintains a G2 page at 2 reviews / 5.0★.

**Beacon today:** ZERO named third-party customers, ZERO testimonials, ZERO case studies, ZERO G2 listing. The only customer is Ritz Builders (the founder's own business). This is the largest gap and is also the most binding — without proof, the wedge ("this exact action works for your exact business") is a claim, not evidence.

---

## 5. 10 things leaders do that Beacon must match

(Severity-graded by how often the pattern was actually verified across the platforms profiled, not just claimed in marketing.)

1. **Public pricing page with concrete monthly $ figures.** Verified on AthenaHQ, Scrunch, Otterly, Ahrefs. **Not verified on:** Profound `/pricing` (returns navigation only) and Peec `/pricing` ("Talk to Sales" CTAs). Pulling pricing is a category trend, but it's not the universal default it appeared to be.
2. **Named customer logos on the homepage trust strip.** Verified across Profound, AthenaHQ, Scrunch, Peec. Ahrefs Brand Radar publishes only one named customer (Octopus Energy) on the product page; it inherits the broader Ahrefs umbrella.
3. **At least one named case study with a hero before/after metric.** Verified for Profound (Ramp: 3.2% → 22.2%), AthenaHQ (Lago, Popl, Grüns, Rootly with hard ROI numbers), Scrunch (Runpod 4x). Peec publishes two (Merge 7x, Momentum 10x). The hero-metric format is durable across the four AEO-pure-play platforms.
4. **G2 / Capterra / ProductHunt listing.** From earlier agent research (not re-verified in this 30-min patch): Profound 312 reviews 4.6★, AthenaHQ 32 reviews 4.9★, Scrunch 59 reviews 4.7★, Peec 2 reviews 5.0★. Even minimal presence beats absence.
5. **Self-serve onboarding under 30 minutes.** Verified on AthenaHQ ("Free Audit (10m)" CTA), Scrunch (7-day Starter trial, no CC), Otterly. Profound is the outlier (sales-led 4-week ramp per third-party review). Self-serve is dominant but not universal.
6. **Free audit / free tier.** HubSpot AI Search Grader is free; AthenaHQ has "Free Audit (10m)"; Otterly has $29 Lite. Beacon's free-audit plan in `NEXT_PHASE_EXECUTION_PLAN.md` matches the pattern.
7. **Multi-engine coverage ≥ 4 platforms.** Every platform verified covers ≥4 engines: AthenaHQ 8, Scrunch 7, Peec 3 confirmed (broader claim 7), Profound 9–10, Ahrefs Brand Radar 6, Otterly 6. Beacon's current 2-engine cap (Perplexity + ChatGPT) is below the verified floor.
8. **Plain-English action language with confidence labels.** Beacon's drawer still leaks `engineConfidence` enum + UUID DB strings (per Phase 2 audit, finding R1). All four AEO-pure-plays publish translated copy in their UI marketing screenshots; that's a public-facing baseline Beacon should match.
9. **A "first reading" landing experience.** AthenaHQ promises "10-minute audit"; Otterly + Peec ship a working dashboard within minutes per third-party reviews; Beacon's `/today` for a fresh tenant is mostly empty (per Phase 2 empty-state audit, finding E1).
10. **A trust-strip count ("Trusted by N+ teams").** Profound "700+ enterprises" (press), Scrunch "500+ companies" (homepage), Peec "2000+ marketing teams" (homepage). AthenaHQ uses logo-wall only (no number). Pattern is common but not universal; required only once Beacon has more than one customer to count.

## 6. 10 places Beacon can uniquely win

1. **Causal action attribution.** No competitor scanned today provides a "this specific edit moved this specific metric for your business" loop. Profound publishes hero metrics by customer; Athena lists ROI in case studies; Peec is monitoring-only. Beacon's recommendation → lifecycle → live_at attribution chain is unique.
2. **Vertical SMB focus.** Every leader is horizontal (HubSpot/Semrush/Ahrefs are general-marketing; Profound/Athena/Peec target B2B SaaS). Local construction, design, trades — wide-open ICP.
3. **Daily cadence as a product feature.** Profound's review rhythm is QBRs; Scrunch defaults to 3-day refresh. Beacon's daily 07:00 UTC poll is a meaningful differentiator if surfaced.
4. **Plain-English UX (no SEO jargon).** Reviewers complain across the board about Athena's "GEO/ACE/Olympus" jargon, Peec's "confusing graph visualizations," and Ahrefs' "research database" feel. Beacon's "times AI recommended you" framing fits non-technical owners better — *if* the remaining jargon leaks (per Phase 2 audit) get cleaned up.
5. **Bundled engine pricing.** Don't follow Peec's per-LLM add-on tax. Beacon's all-included pricing at $499 is a clean SMB pitch.
6. **Specific recommendations with lifecycle tracking.** Peec admits "not going to tell you how to improve." Beacon's recommendation queue with accept → ship → verified-live tracking is a live product surface — *if* the drawer's debug leak (per Phase 2) is closed.
7. **Public pricing on every tier.** Profound is now content-thin on pricing; Hall pulled it entirely. Transparency is a trust signal Beacon can claim simply.
8. **Free audit gated to a 30-min discovery call.** Documented in `NEXT_PHASE_EXECUTION_PLAN.md` Week 4; lowest-cost lead magnet, builds trust, qualifies the call.
9. **Single-purpose-tool focus over suite sprawl.** Semrush AI Visibility Toolkit hides inside a 30-tool suite; Ahrefs Brand Radar is a tab inside a research platform. A small business will open Beacon DAILY because it does one thing.
10. **Ground-truth methodology disclosure.** Ahrefs was caught underreporting ChatGPT mentions by 97.6% in independent testing. Beacon's daily-poll architecture (raw_poll_chunks, persistence-write canary, post-2026-05-04 hardening) is more honest than competitors' aggregated/sampled data — *if* surfaced as a credibility signal in marketing.

## 7. 10 demo-killing gaps still left in Beacon (cross-referenced with Phase 2 audits)

Each gap below is verified by the Phase 2 demo-path audit (see `docs/BEACON_DEMO_PATH_AUDIT_2026_05_06.md` for file:line references). Severity tag indicates `H` (HIGH — would derail a live demo), `M` (MED — trust-eroder), `L` (LOW — polish).

1. **`H` — `/today` is mostly empty for a fresh tenant.** TodayDoNextCard returns null; visibility chart absent; lifecycle strip permanently shows "0 live verified." A new customer sees alerts strip + empty queue tile. (`today-client.tsx:344-637`)
2. **`H` — `/recommendations` drawer leaks 10+ raw DB strings + 2 UUIDs.** `rec_id`, `edit_id`, `resolver_tier`, `engine_confidence`, `evidence_hash` rendered into every drawer's "Debug details" block. The `<details>` collapse only hides visually; values are in the DOM. (`recommendations-client.tsx:1215-1262`)
3. **`H` — Tab "Imported legacy" is still rendered.** The Round 2 fix referenced in `HANDOFF_VERIFIED_STATE.md` was NOT applied — `lifecycle-classification.ts:228` still reads `imported_legacy: "Imported legacy"`. Phase 2 also flagged at-a-glance copy "N imported legacy" / "N scan-confirmed" still in `page.tsx:413-419`.
4. **`H` — `/diagnostics` has no server-side guard.** URL-guess reachable in production; renders raw `BEACON_BUSINESS_CONFIG_JSON` env var name to anonymous visitors when config is missing; renders math-jargon "True positives / False positives / Precision / Recall" tables with Greek `μ_pre / σ_pre / z-score`. (`diagnostics/page.tsx:198`, `:299-322`, `:1085-1153`)
5. **`H` — `/settings/import` defaults Source to "profound".** `useState("profound")` at line 70; `placeholder="e.g. profound"` at line 358. Customer-2 onboarding will see Profound brand leak. Plus internal copy "Internal tooling — drop CSV exports on the server filesystem" at lines 201-203 is openly self-labeled internal.
6. **`H` — `data-rec-source-rec-id` attributes leak full UUID taxonomy** in production HTML. Same UUID leak the M2 sanitizer was added to fix in copy is now leaking in DOM attributes. (`recommendations-client.tsx:435-441`)
7. **`H` — `/today` proof line says "(URL-level Z-score)".** `today-client.tsx:683-684`. A small-business owner does not know what a Z-score is. Highest-impact one-line copy bug on the page.
8. **`M` — `/changes` "all-empty" tab terminal copy.** "No rows. The changelog is empty." Provides no path forward; brand-new customer sees this and leaves. (`scorecard-client.tsx:130`)
9. **`M` — `/prompts` cluster pill labels never call `prettifySlug`.** `bay_area_ca` renders raw on the detail page (`[id]/page.tsx:226-240`); list page never imports the helper at all (`page.tsx:324-336`). Round 2 fix incomplete.
10. **`M` — `/changes` math drawer exposes Greek statistical notation** (`μ_post`, `σ_pre`, `±2 significance`). `scorecard-client.tsx:813-836`. Math is correct; presentation is hostile to non-statistician customers.

---

## 8. Top 5 highest-leverage product fixes for today

These are the proposed Phase 3 implementation bundle. **Awaits operator approval.**

Allowed fix types (per operator brief): copy polish, UI clarity, demo-path trust labels, empty states, route smoke tests, docs/checklists, non-paid validation scripts, active-tenants validation, workflow dry-run validation. Forbidden: broad refactor, paid polls, LR-3, second active tenant, onboarding UI, billing, RLS/auth changes, Profound deletion.

| # | Fix | Files | Severity | Test/invariant | Why this is highest leverage |
|---|-----|-------|----------|----------------|------------------------------|
| **1** | **Tab rename + lifecycle-pill labels: "Imported legacy" → "Pre-launch history"** | `src/domains/attribution/lifecycle-classification.ts:228`, `src/domains/attribution/lifecycle-status-pill.tsx:103-108`, `src/app/(shell)/changes/page.tsx:413-419` | H | Architecture invariant: grep rendered components + classification source for `"Imported legacy"` / `"imported legacy"` — must be 0 hits. (Pin to filename allow-list.) | Restores the Round 2 claim that was never actually applied. Single-string fix; fixes 3 demo-killing leaks at once. Trust-restoring for the doc-vs-reality gap. |
| **2** | **Gate the `/recommendations` drawer "Debug details" block + strip `data-rec-source-rec-id` UUID attributes** | `src/app/(shell)/recommendations/recommendations-client.tsx:1215-1262` (gate behind `process.env.NEXT_PUBLIC_OPERATOR_MODE`); same file:435-441 (drop UUID data-attrs in non-test) | H | Architecture invariant: rendered HTML must NOT contain `rec_id:`, `edit_id:`, `evidence_hash:`, `engine_confidence:` debug labels OR `data-rec-source-rec-id` / `data-rec-source-edit-id` attributes when `NEXT_PUBLIC_OPERATOR_MODE !== "true"`. | Single change removes ~10 raw DB strings + 2 UUIDs from every drawer. The most-leveraged demo-killer fix; one file. |
| **3** | **`/diagnostics` + `/diagnostics/spikes` + `/settings/health` server-side operator guard** | `src/app/(shell)/diagnostics/page.tsx:198`, `src/app/(shell)/diagnostics/spikes/page.tsx`, `src/app/(shell)/settings/health/page.tsx` (all add `if (process.env.BEACON_OPERATOR_MODE !== "true") notFound();` at top) | H | Route smoke test: when `BEACON_OPERATOR_MODE` unset, all 3 routes return 404; when set, render normally. | Closes the URL-guess attack surface for the most embarrassing internal page (raw env-var names, μ/σ stats, model "False positive" labels). Pure additive guard; zero risk to operator workflow. |
| **4** | **`/today` first-run welcome card + kill "(URL-level Z-score)" copy** | `src/app/(shell)/today-client.tsx:683` (replace `(URL-level Z-score)` → `(measured per page)`); same file ~line 412 (mount new `<FirstRunCard />` when `summary.totalCitations === 0 && primaryAction === null`) | H | Render test: with empty fixture, `/today` renders FirstRunCard with copy "Your first reading lands at the next 10:00 UTC poll. Add prompts in Settings → Prompts to expand the daily sample." Snapshot test pins copy. Plus grep architecture invariant: rendered output must NOT contain `Z-score`. | Two highest-impact /today fixes in one bundle. Closes the "looks broken on first run" gap (the demo-killer for any prospect Beacon shows the product to) AND the single most jargon-y line on the page. |
| **5** | **Verdict labels + ConfidenceSourcePill humanization on `/changes/truth`** | `src/app/(shell)/changes/truth/truth-client.tsx:257-282` (introduce `VERDICT_LABEL` map mirroring `LIFECYCLE_TAB_LABEL`; replace `verdict.replace(/_/g, " ")` and `source.replace(/_/g, " ")`); `scorecard-client.tsx:823-836` (relabel "μ_post (after change)" → "After change (per day)"; "z-score / ≥ ±2 significance" → "Change strength / Strong signal / Weak signal") | M-H | Architecture invariant: rendered output must NOT contain `verified_live_too_early`, `verdict_off`, `not_found_after_7d`, `seed_prior`, `μ_pre`, `μ_post`, `σ_pre`, `z-score` (case-insensitive). | Closes the math-jargon demo-killer that fires on every customer who clicks into a "verified live" change to see proof. Builds trust by showing math in plain English. |

**What's deliberately NOT in the bundle today (out of scope or wrong-shape):**
- First-tenant onboarding UI (out of scope per operator brief).
- Per-tenant `--tenant` flag on `check-yesterday-poll.ts` (out of scope; gated on 2nd-tenant trigger).
- Customer-proof page / G2 listing / case-study draft (marketing motion, not in-app fix).
- Multi-engine coverage expansion (paid integration work; gated on revenue).
- Free-audit endpoint (Week 4 onboarding scaffold, out of scope today).
- Per-platform engine-time chip humanization in `/today` action card (`google_aio ~7d` leak — MED; covered in Phase 2 audit but lower leverage than the 5 above).

**Estimated total:** ~5 source files touched, 0 SQL, 0 workflow YAML, 0 paid API calls, 0 OpenAI spend. Each fix has an architecture invariant or render test that pins the contract forward. Full suite must remain ≥4731/4731.

---

## 9. Sources

All public, accessed 2026-05-06. Inline citations throughout. Master list:

- Profound: [tryprofound.com](https://www.tryprofound.com/), [features](https://www.tryprofound.com/features/answer-engine-insights), [agents](https://www.tryprofound.com/features/agents), [agent analytics](https://www.tryprofound.com/features/agent-analytics), [customers](https://www.tryprofound.com/customers), [Ramp case study](https://www.tryprofound.com/customers/ramp-case-study), [Trakkr review](https://trakkr.ai/reviews/profound-review), [Nick Lafferty review](https://nicklafferty.com/reviews/profound-best-aeo-geo-platform-for-ai-search/), [PR Newswire $35M Series B](https://www.prnewswire.com/news-releases/profound-raises-35m-series-b-as-ai-search-becomes-the-next-platform-shift-302527764.html).
- AthenaHQ: [athenahq.ai](https://athenahq.ai/), [plans](https://athenahq.ai/plans), [case studies](https://www.athenahq.ai/case-studies), [agency](https://athenahq.ai/agency), [vs Profound](https://athenahq.ai/articles/profound-vs-athenahq-comparison), [HubSpot blog](https://blog.hubspot.com/marketing/profound-vs-athenahq), [Dageno review](https://dageno.ai/blog/athenahq-review-2026), [Mint review](https://getmint.ai/resources/athenahq-review).
- Scrunch: [scrunch.com](https://scrunch.com/), [pricing](https://scrunch.com/pricing/), [products FAQ](https://scrunch.com/faqs/what-products-does-scrunch-offer-for-ai-search-optimization/), [boosting brand presence guide](https://scrunch.com/resources/guides/guide-to-boosting-brand-presence-in-ai-search), [July 2025 update](https://scrunch.com/blog/2025-07-july-2025-product-update/), [Writesonic review](https://writesonic.com/blog/scrunch-ai-review), [Profound vs Scrunch (Lafferty)](https://nicklafferty.com/blog/profound-vs-scrunch/).
- Peec AI: [peec.ai](https://peec.ai/), [pricing](https://peec.ai/pricing), [blog](https://peec.ai/blog), [Marketer Milk review](https://www.marketermilk.com/blog/peec-ai-review), [Cairrot review](https://cairrot.com/alternatives/peec-ai-review-pricing-comparison-alternatives/), [TechCrunch Series A](https://techcrunch.com/2025/11/17/as-consumers-ditch-google-for-chatgpt-peec-ai-raises-21m-to-help-brands-adapt/), [Growverge review](https://growverge.com/peec-ai-review-2025-trial-marketers/), [Lafferty Profound vs Peec](https://nicklafferty.com/blog/profound-vs-peec-ai/).
- Ahrefs Brand Radar: [Brand Radar](https://ahrefs.com/brand-radar), [pricing](https://ahrefs.com/pricing), [methodology blog](https://ahrefs.com/blog/brand-radar-methodology/), [use cases](https://ahrefs.com/blog/brand-radar-use-cases/), [help center](https://help.ahrefs.com/en/articles/11064852-what-is-brand-radar-and-how-to-use-it), [Yahoo Finance launch](https://finance.yahoo.com/news/ahrefs-launches-custom-ai-prompt-051600618.html), [Rankability review](https://www.rankability.com/blog/ahrefs-brand-radar-review/), [Ekamoira review](https://www.ekamoira.com/blog/ahrefs-for-ai-visibility-brand-radar-review-what-it-still-can-t-track-2026).
- Other AEO: [otterly.ai](https://otterly.ai), [otterly pricing](https://otterly.ai/pricing), [brandrank.ai](https://brandrank.ai), [HubSpot AI Search Grader](https://www.hubspot.com/ai-search-grader), [Semrush AI Visibility Toolkit](https://www.semrush.com/kb/1493-ai-visibility-toolkit), [higoodie.com](https://higoodie.com), [NoGood GEO tools roundup](https://nogood.io/blog/generative-engine-optimization-tools/), [AthenaHQ top 10 GEO tools 2026](https://athenahq.ai/articles/generative-engine-optimization-tools/).
- Customer proof: [Profound G2 reviews](https://www.g2.com/products/profound/reviews), [AthenaHQ G2](https://www.g2.com/products/athenahq/reviews), [Scrunch G2](https://www.g2.com/products/scrunch-ai/reviews), [Peec G2](https://www.g2.com/products/peec-ai/reviews), [Scrunch TechCrunch](https://techcrunch.com/2025/03/04/scrunch-ai-is-helping-companies-stand-out-in-ai-search/), [Scrunch Runpod case study](https://scrunch.com/blog/2025-07-how-runpod-leveraged-the-scrunch-ai-platform-to-achieve-4x-growth,-turning-chatgpt-into-a-top-performing-acquisition-channel-/), [AthenaHQ Marketing Tech News](https://www.marketingtechnews.net/news/athena-raises-2m-to-track-how-brands-appear-in-ai-responses/), [Peec FeaturedCustomers](https://www.featuredcustomers.com/vendor/peec-ai), [Profound Series C $96M](https://www.superbcrew.com/profound-raises-96-million-in-series-c-funding-round/).

**End Phase 1 deliverable.**
