# Beacon Ideas Parking Lot

> **PURPOSE:** Dump ideas here. Each one gets a 60-second analysis, a status tag, and a decision timeline. Don't lose anything. Don't ship anything rushed.
>
> **NOT FOR:** Current execution (→ `HANDOFF_VERIFIED_STATE.md`, `NEXT_PHASE_EXECUTION_PLAN.md`), completed work (→ `VERIFICATION_LOG.md`), historical architecture (→ `master_execution_plan.md`).

---

## How this file works

Every idea gets an entry with 6 things:

1. **The idea** — 1-2 sentences, plain English
2. **Source** — where it came from (friend, own thought, customer, competitor observation, etc.)
3. **Why it's interesting** — the upside
4. **Why it's hard / risky** — the honest tradeoff
5. **Claude's take** — direct assessment: yes / maybe / no / not now
6. **Status** — one of:
   - `parked` — captured, no action scheduled
   - `validating` — researching feasibility
   - `queued month N` — scheduled for a future sprint
   - `building` — active work
   - `shipped` — in production
   - `killed` — decided against, with reason

Reopen any idea at any time. Mark updates with dates.

---

## Active / Queued

### 0. AEO/SEO best-practice coverage audit (2026-06-16) — what's left to build

**Added:** 2026-06-16 · **Status:** `reference` (code-grounded audit; updates the "what NEW capability to ship" question)

- **The idea:** Per the goal's "IF THE LIST IS DONE → mine best practices, find fresh gaps" clause, this is a code-grounded map of every proven AEO/SEO best practice vs Beacon's deterministic trigger/draft coverage, so we know exactly what's genuinely left to build (vs already-done / gated / speculative).
- **Coverage — ALREADY BUILT + concrete on connected data (GSC/Clarity/scan):** title (missing/weak/dup/low-CTR/striking-distance → `composeTitle`); meta (missing/dup → `composeMeta`); H1/headings (missing/weak/mismatch/H2); structured data (`composeSchema` — Article **with author + publisher Organization** + `mainEntityOfPage` + BreadcrumbList, store-breadcrumb, invalid-schema repair); indexability (robots/sitemap/noindex/canonical/status → `composeFixDirective`); internal links (orphan + opportunity → `composeInternalLinks`); **freshness/decay + stale + merge (`gsc_decay`/`stale_content`/`thin_content_overlap` → grounded directives, 2026-06-16 `0bb6526`)**; answer-blocks (`composeAnswerBlockDirective`, FAQ-retired-aware); source/E-E-A-T citations (`composeSourcesDirective`); page-experience/CWV (clarity rage/dead/script → `composeClarityDirective`); AI-bot access (robots-blocks-ai-bots). **The deterministic engine covers essentially every PROVEN on-connected-data practice.**
- **Genuine remaining gaps, honestly status'd:**
  - **Per-query answer/decay grounding** (name the exact question/keyword a page is losing) — high value, but needs the HEAVY `gsc_page_signals` per-query RPC (times out for big tenants — the #72 class). `validating` (needs a light per-query path first).
  - **Five-source fusion + LLM-drafted entity/topical-authority** — `gated` on operator action (Profound/SEMrush keys, Google reconnect, `BEACON_LLM_PROVIDER=openai`).
  - **`llms.txt`** (emerging AI-crawler manifest) — `parked/skeptical`: adoption unproven as of 2026; recommending it as HIGH-confidence undercuts the "trustworthy" bar. Revisit if major crawlers commit.
  - **Image alt-text / multimodal** — `parked`: the scanner doesn't capture per-image alt text, so no data to trigger on.
  - **New on-page length/duplicate triggers (title>60, meta length, multiple-H1)** — `killed`: SAFE (promotion dedups same-(tenant,action,url) `edit_title` to one rec) but low NET value — high-value cases already caught by the GSC triggers. See the edit_title-promotion-dedup memory.
- **Claude's take:** The connected-data deterministic frontier is mature. The next *genuinely* high-value capabilities are gated (operator switches) or need a light per-query GSC path. Don't ship speculative (llms.txt) or redundant (length triggers) capabilities to fill space — it dilutes trust. Ship the gated fusion the moment the keys land.

### 1. LLM-as-judge ablation for page rewrites

**Added:** 2026-04-18 · **Status:** `queued month 3`

- **The idea:** Before suggesting a rewrite, generate N=10-20 variations, simulate AI retrieval against them using Claude/GPT-4 as judges (or the real 4 AI platforms once the native engine lands), pick the winner. Ship the predicted winner with "won 17/20 matchups" confidence evidence.
- **Source:** Armeen's friends (unprompted, 2026-04-18)
- **Why it's interesting:**
  - Defensibly rigorous — "we tested 20 options" >> "a formula suggested this"
  - Every variation tested becomes training data for the shared brain
  - Native Darwin loop — exactly the Darwin-narrowing Armeen described earlier
  - Unique moat when paired with change-log data (you see what changed; Profound doesn't)
  - Premium-tier justification for $499+ pricing
- **Why it's hard / risky:**
  - Claude-as-judge ≠ real AI retrieval — ~70% accuracy best case, possibly 40% worst case
  - You won't know real accuracy until months of shipped-prediction data accumulate
  - Confidently-wrong predictions are churnable (meh suggestions are forgivable)
  - Cost: ~$200/mo per customer in LLM calls at 10 pages × 2 audits/month
  - Latency jumps from ~1s to ~30-90s per rec
  - Profound can build this in 2-3 months if they prioritize — moat is short-term unless paired with vertical + change-log
  - Horizontal ablation is replicable. Beacon's advantage IS ablation × builder vertical × change-log data.
- **Claude's take:** YES, directionally brilliant. But NOT for Day 7. Rushing it now burns 5-7 days of a 70-day timeline on an unvalidated bet that only gets validated by months of outcome data. Much stronger if launched month 3 when (a) native engine lets you judge with real AIs, (b) outcome data lets you prove "our predicted winners lifted citations in 6/8 real ships," (c) revenue covers costs. **Month-3 ablation is 10x more defensible than Day-7 ablation.**
- **Prerequisites before building:**
  - Native engine live (Week 2-3) — enables real-AI co-judges
  - 1-3 customers shipping predicted recs (Week 7-10) — enables prediction validation
  - Revenue ≥ $1,500 MRR — covers $200/mo/customer LLM costs at reasonable margin
- **Updates:**
  - 2026-04-18: Captured. Timeline: month 3+ (~June-July). Revisit when native engine ships.

---

### 2. Claude Code / GitHub PR integration — "one button, PR opens"

**Added:** 2026-04-18 · **Status:** `queued month 4+`

- **The idea:** User clicks "Try this" on an action card → Beacon dispatches the rewrite to Claude Code / GitHub API → PR opens on user's repo automatically. User reviews, merges, ships. Attribution starts.
- **Source:** Armeen's friends (2026-04-18)
- **Why it's interesting:**
  - Closes the "Beacon says → I do → Beacon observes" loop from 20 min to 30 sec
  - Massive dogfeed accelerator for Armeen personally
  - Paying customers love "click button, site updates" UX
  - Natural Pro/Agency tier gate
- **Why it's hard / risky:**
  - Every customer has different stack (WordPress 70% / Webflow 15% / custom 15%). Each needs a different integration.
  - Customers won't connect production repo to 1-person SaaS on day 1. Trust takes months.
  - PR templating, diff UI, merge-conflict edge cases = weeks of build per platform
  - Auto-applying content changes is high-stakes — wrong rewrite → broken brand voice → churn
- **Claude's take:** MAYBE, and later. Copy/Email is the right v1 — that's what Profound / Hall / Peec / AthenaHQ all ship. Customer integrations become interesting at month 4-5 when a paying customer says *"I'd pay more if you could apply this to my WordPress directly"* — then build for THAT customer's stack first. Don't guess.
- **For Armeen's own dogfeed specifically:** ~2-day build of a simple CLI (`beacon-apply <rec-id>`) that writes to Ritz's repo via Claude Code. Positive ROI but not urgent — 50 min/week of time saved vs 2 days of build. Payback in 6 weeks.
- **Updates:**
  - 2026-04-18: Captured. Timeline: month 4-5 for customer-facing. Optional earlier for Ritz dogfeed if velocity becomes a bottleneck.

---

### 3. Full-page ablation (rewrite entire page, not just one element)

**Added:** 2026-04-18 · **Status:** `queued month 4+`

- **The idea:** Instead of "change this H2," Beacon rewrites the whole page (H1 + H2 + subhead + body + schema) and shows a diff for review. User approves the diff, ships.
- **Source:** Armeen's friends (2026-04-18)
- **Why it's interesting:**
  - Massive wow factor
  - Agency-tier premium feature
  - More dramatic lift (compounding many small improvements into one ship)
- **Why it's hard / risky:**
  - Variation space explodes (5 elements × 20 variations each = 3.2M combinations)
  - Brand-voice risk explodes (LLMs rewriting whole paragraphs → soulless marketing copy)
  - Attribution signal weakens — which of the 20 changes moved the citations?
  - Review friction explodes — customers must read + approve entire page, not one line
- **Claude's take:** NOT YET. Start single-element, prove the trust loop, then expand. Full-page is month 4+ territory with hardened brand-voice guardrails.
- **Updates:**
  - 2026-04-18: Captured. Hold until single-element ablation proves out.

---

## Parked (captured, no action)

### Rebuild /pages — focused per-URL citation history

**Added:** 2026-05-05 · **Status:** parked

- **The idea:** Rebuild the `/pages` route as a small, Supabase-only per-URL citation-history view. ~1 page worth of data per URL: citation count over time (pulled from the citation evidence index), last crawl timestamp, list of currently-open recommendations on that page, link back to /recommendations and /changes filtered to the URL.
- **Source:** M5 of the operator's 2026-05-05 brutal full-system audit. Quote: "Current /pages is hidden from nav but routable and half-broken … fix /pages to read Supabase and show basic URL/page citation history."
- **Why it's interesting:** /pages is the natural drill-down from /today's leaderboard and /recommendations' target-URL chips. When customer 2 lands and asks "what's the citation history on `/services/whole-home-remodel`?" the answer should be one click, not three.
- **Why it's hard / risky:** The previous /pages route was 882 lines reading from ~15 domain stores (page-snapshots, page-snapshot-diffs, render-checks, sitemap-reconciliation, page-issues, outcome-watch, guardrail-alerts, rollout-waves, pattern-evidence, citation-evidence-index, playbook-briefs, fix-briefs, opportunity-scoring, scorecard, outcome events). Several stores return empty on Vercel. Fixing the full surface is a 2289-line refactor. The cheap rebuild is "throw all that away, read citation evidence index from Supabase, render ~200 lines."
- **Claude's take:** YES — but bounded. Scope: read-only per-URL citation history from `citation_evidence_index` (Supabase), no patterns/waves/playbooks/issues UI, no `page-store.ts` or `page-snapshot-diff-store.ts` reads, no schema changes. ~200 lines, ~1 day. **Defer until customer 2 is on the calendar** (per master-plan §3.7 — /pages stays hidden through W4). At that point: 1 dev-day, plus a smoke test that verifies the route renders empty-state gracefully when the citation evidence index is missing.
- **Updates:**
  - 2026-05-05: Captured. The current /pages is now a deliberate not-ready placeholder (M5 Option B). Supporting files preserved (`pages-client.tsx`, `issue-actions.ts` are imported by other components / routes).

---

## Killed (decided against, with reason)

*None yet. When an idea gets killed, move it here with the date and reason so we don't re-litigate it.*

---

## Template for new ideas (copy-paste)

```
### [Idea name]

**Added:** YYYY-MM-DD · **Status:** parked | validating | queued month N | building | shipped | killed

- **The idea:**
- **Source:**
- **Why it's interesting:**
- **Why it's hard / risky:**
- **Claude's take:**
- **Prerequisites before building:** (if any)
- **Updates:**
  - YYYY-MM-DD: [what changed]
```

---

## Deferred from Plan A + B1 (2026-04-20)

These were considered and explicitly deferred when extraction coverage + scanner coverage-text expansion shipped. Captured here so we don't lose them.

### Image alt text as extraction field

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Extract `<img alt="">` values into a `image_alts` field on `PageSnapshot`.
- **Source:** Plan A + B1 audit; operator decision to trim before ship.
- **Why it's interesting:** Alt text sometimes carries the cleanest editorial label for a section/card (e.g. "Custom Home Builder Palo Alto hero image").
- **Why it's hard / risky:** Alt text is often empty, SEO-stuffed, or filename-derived. Including it naively in coverage would flood the scanner with low-signal tokens.
- **Claude's take:** Worth it only if we can filter junk (length threshold, exclude filename-stub patterns, exclude alts that match the filename). Defer until dogfood shows a case where a concept is ONLY covered in alt text.

### Nav-label / menu-label extraction (for coverage)

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Extract `<nav>`-descendant link labels into a `nav_labels` field and use them in scanner coverage.
- **Why it's interesting:** Menu items are the canonical labels for site sections; most pages in the same site share the same nav, so the menu itself is a good concept-vocab anchor.
- **Why it's hard / risky:** If every page has the same nav, then every page looks like it covers every listed service → false "covered" signals everywhere. The whole point of the B1 cross-page boilerplate defense.
- **Claude's take:** Only safe with a dedup-across-pages filter ("this token appears in ≥ 50% of pages' nav → strip"). That's extra logic not in current scope. Keep parked.

### Internal link anchor text as coverage signal

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Use `internal_links[].anchor_text` on a page as part of that page's coverage text.
- **Why it's hard / risky:** Same cross-page boilerplate problem as nav_labels. Navigation anchors + footer links repeat across pages.
- **Claude's take:** Same mitigation path as nav_labels; park together.

### Singular-fold matcher migration in scanner

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Replace scanner's raw `.includes()` coverage match with a normalized + singular-fold match (same `containsConcept` helper as 3A's trust guardrail).
- **Why it's interesting:** Would catch `homes` ↔ `home` variants that substring match misses. 3A uses this; scanner does not.
- **Why it's hard / risky:** Changes semantics of the existing `pageCoverageRatio` math. Need to re-verify saturation-miss threshold behaves the same. Might have cascading effects on what fires as `saturation_miss` vs `gap`.
- **Claude's take:** Defer until dogfood shows a specific case where raw substring misses a real semantic coverage. Current word-level split already helps somewhat.

### LLM second-pass judge for phrase quality / rec review

**Added:** 2026-04-20 · **Status:** `queued month 2-3`

- **The idea:** For each top candidate keyword-positioning rec, run an LLM pass to check (a) phrase reads natural, (b) concept belongs on this page archetype, (c) alternative phrasing exists. Use the LLM as judge/rewrite layer on ≤ 5 shortlisted recs per render.
- **Why it's interesting:** The 10% of cases where deterministic rules can't catch awkwardness ("Design-Build Custom Home Builder Silicon" level nuance). Also enables rewriting robotic phrases to human-natural ones.
- **Why it's hard / risky:** Cost (~$0.001 per rec × 50/render × 30 tenants = manageable). Latency (~1s added to each render unless cached). Trust (LLM might rewrite in a way that subtly changes meaning).
- **Claude's take:** Yes — but only AFTER everything deterministic is squeezed dry. Current plan already goes far; LLM is the cleanup layer, not the engine.
- **Prerequisites before building:** native-engine work (month 1-2), LLM-as-judge ablation v1 (idea #1 above), explicit cost/latency budget.

### Broaden Rule A STOPWORDS / Rule C NOUN_HEAD_SET

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Expand B2's narrow sets with additional prepositions (over, under, about, against, among, beyond, across) and additional head-nouns (specialist, professional, provider, service, team, partner, advisor, manager, director, organization).
- **Source:** B2 audit; operator-tuned narrow for v1.
- **Claude's take:** Only if dogfood shows specific concepts slipping through that the narrower v1 set doesn't catch. Keep v1 narrow; add incrementally with evidence.

### Rule E (tenant-vocab resonance) at scanner level

**Added:** 2026-04-20 · **Status:** `killed (for v1)` — may revisit if scanner-level log discipline matters.

- **The idea:** Require every scanner-emitted concept to contain ≥ 1 token from tenant scope.
- **Why killed for v1:** Redundant with router's `off_scope` suppress; operator directive: "B2 should be phrase-shape only, not hidden relevance filtering."
- **Claude's take:** Could be revisited if we ever want scanner-level log visibility into off-scope concepts that the router later suppresses. Low priority.

### Tier-3 positive findings surfaced on Today

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** The scanner computes Tier 3 "positive" concepts (both we and competitors cite) but filters them out of the Today stack. Could surface as a separate "you're competitive on" stripe.
- **Claude's take:** Good for confidence / proof display, not for decision surface. Defer until there's a product surface that needs it.

### Surface `new_page_opportunity` cards on Today

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Router produces `new_page_opportunity` recs at priority 200 — below the 4-card cap, so they never render. Reserve a dedicated slot (e.g. "Growth ideas" stripe below Wins-to-learn-from).
- **Why it's interesting:** Router is already correctly producing ~15 of these per render for Ritz. Operator just can't see them.
- **Why it's hard / risky:** Adding a third Today section changes the Decide-tonight / Wins hierarchy. Touches Today layout.
- **Claude's take:** Ship after a few more cleanup passes. Ideally with a distinct "low-confidence growth" framing.

### Widen router's own `pageJobTokens` with Plan A new fields

**Added:** 2026-04-20 · **Status:** `parked`

- **The idea:** Plan A+B1 widened the scanner's coverage check but deliberately did NOT widen the router's `pageJobTokens` (operator constraint: "do not touch the router"). Worth reconsidering once dogfood shows the router missing legitimate fits that broader extraction would catch.
- **Claude's take:** Only worth it if dogfood shows concrete cases where the router's fit-scoring misses a page that clearly covers the concept in H3/body/cards.

### Spotlight / Phase 3D + operator memory / Phase 5 + nightly loop / Phase 6

**Added:** 2026-04-20 · **Status:** `queued month 2+`

- Covered in the top-level customer-one plan. Deferred until rec quality stabilizes after A + B1 dogfood.

### Change Detail (/changes/[id]) copy polish

**Added:** 2026-04-24 · **Status:** `parked`

- **The idea:** `/changes/[id]` now reads durable truth (Sprint 1 Phase 1.6), but some rendered copy still feels robotic or redundant:
  - "Check back in ~26 days" reads too mechanical
  - "Expected outcome" panel repeats the hypothesis verbatim (two panels saying the same thing)
  - Outcome summary is useful but could be more human / plain-English
  - "Beacon recommended" linkage is cool but doesn't yet name the specific recommendation the change fulfilled
- **Source:** Armeen, post-Sprint-3 hosted walkthrough (2026-04-24)
- **Why it's interesting:** Detail page is now trustworthy — next lever is warmth/clarity. Operator spends real time reading this once per confirmed change.
- **Why it's hard / risky:** Copy tone pass only, but "Beacon recommended" → "which rec" needs the response→changelog linkage to surface the rec id + title cleanly. Touches `/changes/[id]/page.tsx`.
- **Claude's take:** Pure copy + linkage polish. Low risk. Queue after Sprint 6 (recs UX detail) since that sprint will surface recommendation titles in a format directly reusable here.


---

### Prospect Audit mode — the sales weapon

**Added:** 2026-06-09 · **Status:** `parked` (Claude recommends: build BEFORE more engine work)

- **The idea:** Point the existing engine at ANY local-service domain (a prospect, not a tenant) and auto-generate a shareable one-page audit: "We asked AI 25 real questions about kitchen remodels in Palo Alto. AI recommended Supple Homes 14 times. You: 2. Here are the 3 pages you're missing and the first move." Cold outreach becomes "let me show you something about your business."
- **Source:** Claude gap analysis (2026-06-09) — the pricing ladder has a free-audit rung with NO product surface behind it.
- **Why it's interesting:** It's the only missing piece that directly manufactures paying customers before the June 26 target. ~80% assembly of existing engines (prompt runner, co-mention competitor extraction, visibility scoring, deterministic recommendation triggers). Every audit is also a demo.
- **Why it's hard / risky:** Each audit burns real API spend (~$1–3 at 25 prompts × 2 platforms); needs a "not-a-tenant" run mode so prospect data doesn't pollute tenant stores; shareable page needs to be public-safe (no operator surfaces leaking).
- **Claude's take:** YES — highest-leverage unbuilt thing in the whole project. Sales surface, not engine. Build the moment the stack ships.

### Weekly owner email + "you just got recommended" alert

**Added:** 2026-06-09 · **Status:** `parked`

- **The idea:** A weekly plain-English email ("AI recommended you 14 times this week, up 3. Your ADU page got cited for the first time Tuesday. 2 calls landed on cited pages. Next move: …") + a real-time ping the first time a page ever gets cited. Owners screenshot "ChatGPT just recommended Ritz Builders" and forward it.
- **Source:** Claude gap analysis (2026-06-09) — recon confirmed ZERO email/notification infra exists; the product only delivers value if the owner logs in.
- **Why it's interesting:** This is the renewal driver. A non-technical owner won't open a dashboard weekly; the email IS the product, the dashboard becomes the drill-down. All read-models already exist — this is render-to-email.
- **Why it's hard / risky:** Needs an email provider (Resend free tier) + an operator-approved sending key; deliverability/cadence tuning; must reuse the locked forbidden-vocab discipline so automated copy never overclaims.
- **Claude's take:** YES — second-highest leverage. Renderer + preview surface buildable now; sending is operator-gated (key).

### Google AI surface coverage (Gemini + AI Overviews)

**Added:** 2026-06-09 · **Status:** `parked`

- **The idea:** Real pollers today are OpenAI + Perplexity only (Gemini/Claude/Copilot appear in type unions, not pollers). Add Gemini API polling (easy, same pattern as poll-openai) and Google AI Overviews/AI Mode via a SERP API (~$50/mo at this volume).
- **Source:** Claude gap analysis (2026-06-09) — recon of scripts/poll-*.
- **Why it's interesting:** For local services, Google's AI surfaces are where the most real buyers actually are. "AI visibility" with a Google-shaped hole is the first objection a savvy prospect raises.
- **Why it's hard / risky:** AI Overviews has no official API — SERP-API dependence (cost + fragility); Gemini is straightforward but adds per-poll cost.
- **Claude's take:** YES on Gemini (cheap, fits the existing poller pattern). MAYBE on AI Overviews — validate with a SERP-API trial month before committing.

### Competitor move detection — "steal this move"

**Added:** 2026-06-09 · **Status:** `shipped` (2026-06-09, commits e1efe35+1a0eee9 — domain src/domains/competitor-intel/, customer section on /competitors, operator /diagnostics/competitor-intel; preview-verified)

- **The idea:** Watch the top-8 real competitors' key pages for content changes. When a competitor ships a change and their citations rise within the window: "Supple Homes added an ADU cost page June 2; AI started citing it June 8. Want the equivalent move?"
- **Source:** Claude gap analysis (2026-06-09).
- **Why it's interesting:** It's the cross-tenant brain's "learn from others" story WITHOUT needing tenant #2 — at n=1 this is the only honest learning-network pitch available. Pairs with the existing co-mention competitor list + citation time series.
- **Why it's hard / risky:** Page-change detection on sites you don't own (crawl etiquette, diff noise); correlation copy must stay associative (the forbidden-vocab discipline applies); competitor citation series already exist but per-URL granularity needs checking.
- **Claude's take:** YES, after audit + email. Differentiated and demo-able; medium build.

### Call-transcript → prompt mining

**Added:** 2026-06-09 · **Status:** `parked`

- **The idea:** CallRail can return call transcripts. Mine what callers actually ask ("do you do ADUs under 800 sq ft?") and propose them as tracked prompts — your own phone calls write your AI-question tracking list.
- **Source:** Claude gap analysis (2026-06-09), enabled by the CallRail connector shipped today.
- **Why it's interesting:** Closes a loop nobody else has; prompts grounded in real buyer language instead of operator guesses. Compounds the wedge.
- **Why it's hard / risky:** Transcripts are a CallRail plan add-on (verify availability); needs an extraction pass (LLM or rules) — touches the no-LLM constraint; privacy: transcripts contain PII, must never leave the tenant boundary.
- **Claude's take:** MAYBE-LEANING-YES — month 2-ish, after the LLM provider is on anyway. Cheap to validate: pull 20 transcripts, hand-check signal.

### "Why them, not you" forensics per lost prompt

**Added:** 2026-06-09 · **Status:** `shipped` (2026-06-09, same commits — deterministic v1: gaps + descriptor contrast + loss rows; follow-up: thread real quotes from the newly-found answer-texts.json store)

- **The idea:** For a prompt where a competitor gets recommended and you don't: show the actual AI answer text, which competitor page got cited, and a side-by-side vs your equivalent page with the gap named ("they list prices; you don't"). Actionable jealousy.
- **Source:** Claude gap analysis (2026-06-09). Adjacent to (but read-only, so much earlier than) the parked full-page ablation idea.
- **Why it's interesting:** Answer snapshots + citation evidence already exist; this is a drilldown view, not new collection. It's the emotional core of the sale — owners FEEL losses to named rivals.
- **Why it's hard / risky:** Gap-naming beyond simple structural checks wants the LLM; v1 can ship with deterministic gaps only (the 16 trigger checks already produce these).
- **Claude's take:** YES as a v1 deterministic drilldown; LLM gap-naming upgrades it later.

### Money language — a decision, not a feature

**Added:** 2026-06-09 · **Status:** `parked` (needs an Armeen decision)

- **The idea:** Resolve the standing tension: the operating instinct is "speak money and customers," but the locked N4 forbidden-vocab invariant deliberately bans $/revenue/ROI/leads from measured-outcome surfaces (honesty discipline). Proposed line: money language lives on SALES surfaces (prospect audit, pitch, marketing); measured-outcome surfaces keep speaking sessions + calls; optionally add a clearly-labeled owner-entered calculator ("your numbers: avg job value × qualified calls") that does arithmetic without Beacon claiming causation.
- **Source:** Claude gap analysis (2026-06-09) — surfaced while wiring CallRail call counts into outcome copy.
- **Why it's interesting:** One ADU job ≈ $200k+; "Beacon's tracked calls cover its price 40x" is THE renewal sentence — but only if it stays honest.
- **Why it's hard / risky:** Eroding the invariant on outcome surfaces would undermine the category-defining trust posture (the whole Proof Engine pitch is "the only ROI claim that survives scrutiny").
- **Claude's take:** Keep the invariant on outcome surfaces; put dollars on sales surfaces + an owner-entered calculator. Decide deliberately.

## 2026-06-11 (day shift) — deferred with reasoning

### Instant first-scan at launch (PAT-gated)
A freshly launched tenant waits for the next nightly scan (≤24h) before anything crawls. With `BEACON_GH_WORKFLOW_DISPATCH_PAT` set in Vercel, the launch action could dispatch the scan workflow immediately — first crawl within minutes of signup. **Honest take:** real time-to-value win — but NOT plug-and-play (verified 2026-06-11): `daily-scan.yml` has no `workflow_dispatch` inputs (a launch dispatch would re-crawl the WHOLE fleet) and `concurrency: cancel-in-progress: true` on a shared group (a signup at 08:50 UTC would CANCEL the legit nightly mid-flight). The build needs: an optional `only_tenant` input threaded to the matrix, a per-trigger concurrency key, and only then the launch-side dispatch. Status: one focused session once the PAT lands.

### Universal city gazetteer for discrepancy detection
`entity/discrepancy-detect.ts` checks content for mentions of non-owned locations/services against founder-vertical candidate lists — conservative-incomplete for other geos (a Tucson dentist's "Phoenix" mention is missed). A real fix needs a generic gazetteer (or deriving candidates from the tenant's citation corpus). **Honest take:** coverage gap, not wrong output; only worth building once a paying non-Bay tenant cares about NAP discrepancies. Status: month-2+.

### today-data.ts split (3,048 lines)
The biggest file-size discipline violation in the repo; touched by everything on /today. **Honest take:** a pure-move refactor needs a dedicated session with the full suite as the only gate — both shifts correctly refused to do it as a side-quest. Status: schedule a focused session.

### `ritz_obs_count` → `own_obs_count` rename
Internal evidence field named for the founder tenant (recommendation-engine, keyword-gap-scanner). Rendered copy is already neutral ("your page"). **Honest take:** pure naming debt across engine+types+tests; zero behavior. Bundle into the next engine-touching session.

### `only_tenant` for the generation workflow (chain completion)
The scan workflow now takes a tenant-scoped dispatch (#37). The natural next link: after a launch-time first scan completes, dispatch a tenant-scoped first GENERATION so the queue fills the same day (today it waits for the 05:30 nightly). Needs the same only_tenant + concurrency treatment on `nightly-generation.yml`, plus a completion trigger (workflow_run or the watchdog). **Honest take:** half the value of #37 again; build when the PAT lands and the first-scan path is observed working live. Status: next session after PAT.

## 2026-06-13 (midnight shift) — deferred Iranopedia superpowers, with reasoning

### Sensitivity review gate (config-driven)
For a cultural/political encyclopedia like Iranopedia, edits touching sensitive entities (political figures, regime/protest topics, religious minorities) should carry a visible "review carefully" caution and never auto-promote to customer-queue-ready. **Honest take (verified 2026-06-13):** the existing `CandidateSafetyFlag` mechanism is the WRONG fit — `safety = flags.length === 0 ? 1 : 0` zeroes the score and effectively SUPPRESSES the card (safety flags mean "do not ship this draft," not "review carefully"). And every content trigger is ALREADY operator-review-only, so the marginal value now is just a visible caution + future-proofing for when customer-queue auto-promote expands. The mechanism must be a SEPARATE annotation (not a safety_flag) + a per-tenant sensitive-term config with an EMPTY default (never hardcode a list of "sensitive Iranian political topics" — that's exactly the bias/fabrication the rails forbid; the operator configures it). Status: build mechanism + empty default when customer-queue auto-promote broadens, or sooner if the operator supplies a term list.

### Entity / transliteration consistency
Detect the same entity transliterated inconsistently across pages ("Chaharshanbe Suri" vs "Chaharshanbeh Soori") and recommend a canonical form. **Honest take:** real AEO value (entity clarity is a documented citation factor) but HIGH false-positive risk — needs fuzzy variant matching + a sourced transliteration standard, and Persian↔Latin romanization has multiple legitimate schemes (UN, ALA-LC, BGN/PCGN). Not deterministic-safe without a per-tenant canonical-form config. Status: research transliteration standards first; build only with operator-confirmed canonical forms.

### uncited_content content-area link extraction (chipped as a session task)
`uncited_content` fires on external_link_count === 0, but template-linked sites (iranopedia: 184 pages @ exactly 2, 111 @ exactly 5 external links — footer chrome) never hit zero, so genuinely uncited articles are missed. The honest fix is at the SCANNER: count external links in the CONTENT AREA only (main/article, excluding header/footer/nav), or persist the full external-link list so cross-page chrome can be diffed away (same document-frequency idea as buildChromeDetector / thin-content-overlap). **Honest take:** correct fix, but touches the scan/PageSnapshot shape (architecture ratchets) → a dedicated scanner session. Status: spawned as a separate task this session.

### "The scorer learns" — feed proven outcomes into ranking (design parked 2026-06-13)
The END-STATE wants the scorer to learn from proven outcomes. The data path is ready: `deriveTaxonomyTarget(registry.signalType, registry.changelogAssetType, target_url)` → `primary_bucket` → `buildCausalSelfForecast(outcomes, …)` → `helpingRate` (the same shared classifier the proof engine uses → zero drift). **Honest take (verified 2026-06-13):** the obvious approach — a bounded boost-only multiplier in `priorityScore` — BREAKS the operator-locked blocker-invariant ("indexability blockers outrank content polish"). Empirically: a `gsc_low_ctr` content card with GA4 weight 1.5 + upside-cap + a 1.2 proven boost scores **74**, beating an index blocker's **67** — there's only ~8% headroom, and any cross-tier content multiplier eventually exceeds it. Reverted rather than bulldoze the lock. **Correct design (recommended):** a WITHIN-TIER secondary sort key in `promote-to-queue` — sort by `priority_score` desc, THEN by proven `helpingRate` desc. This never touches `priority_score`, so the blocker invariant is intact by construction; proven-winners only re-rank among equal-priority cards. **Status:** fully dormant today (0 computed outcomes — Ritz 166 watching/0 computed; the Profound→proof bridge #108 now helps produce computed outcomes). Build the secondary-sort version in daylight once computed outcomes exist to validate against. Status: next-session, non-blocking.

### Profound SOV-gap trigger — "AI cites competitors for topic X, not you" (designed + sourced 2026-06-13, build-blocked)
END-STATE audit found Profound's `profound_visibility_rows` is a dead-end table with NO consumer (the audit's #1 BLOCKER; #108 only consumes `profound_citation_rows` → proof, NOT visibility). The wedge play: when AI answer engines give competitors meaningful share-of-voice in a tracked category and the customer's own brand is absent/low, emit a recommendation — a topic-level play, analogous to `semrush_keyword_gap` → `create_page`/expand-existing via the duplicate-topic guard.
**Sourced firing rule** (research digest, 5 sources — Profound Query-Visibility API ref, Profound API Cookbook, GEO/KDD-2024 arXiv-2311.09735, Discovered Labs AEO benchmarks, "Don't Measure Once" arXiv-2604.07585): fire per (category × model) when **own SOV < 10% AND (a competitor SOV ≥ 30% OR ≥ 3× own SOV) AND executions ≥ 100 for the cell AND the gap holds across ≥ 2 consecutive periods**; below 30 executions NEVER fire — surface "watching / insufficient data." HONEST sourcing: the 10%/30% cutoffs are practitioner CONVENTION (vendor blogs, not RCTs) → ship as per-tenant TUNABLE config, never constants; the **executions≥100 gate is the one statistically-rigorous leg** (SOV is a proportion; margin-of-error ∝ 1/√n) — lead the trust story on it, not the cutoffs. Gate + NAME the AI model (citation behavior differs hugely by engine — Perplexity ~30% vs ChatGPT ~13% vs Claude ~5% SOV for the same set; ~11% citation overlap ChatGPT↔Perplexity) → fire per-model, optionally roll up a category headline.
**Own-brand identification = NAME-MATCH ONLY** (decisive finding): Profound's visibility report has NO ownership flag — `asset_name` is a plain string, the customer's brand is one named asset among competitors (set at Profound onboarding via "list your owned assets"). Match `asset_name` against the tenant's owned-brand name(s) from config (reuse the existing brand-variant matcher in `prompt-answer-observations/extraction.ts`); normalize case/whitespace/aliases; **treat a missing own-brand row as 0% SOV, not null** (absence IS the signal). Abstain when no asset matches the brand (no false positives).
**Why BUILD-BLOCKED (not built tonight, parked instead of half-built blind):** (1) DATA GAP — the sync persists only opaque `category_id`, NOT the category NAME, so topic→page matching (needed for `target_url`) is impossible without a sync/schema change to also persist category names. (2) The ≥2-period guard needs accumulated historical Profound rows that don't exist (Profound dormant — no Enterprise key connected). (3) Can't verify against real rows tonight, and payoff is doubly-inert (dormant-until-key + U4-suppressed at operator-review tier). **Build order when Profound is connected:** (a) sync change to persist `category_name` alongside `category_id`; (b) `loadProfoundSovGapsForTenant` loader (group by category×model, own-vs-competitor by name-match, executions gate, per-period diff); (c) `profound_sov_gap` trigger reusing the keyword-gap `create_page`/expand pattern; (d) action-type + eligibility (operator-review) + draft + tests + ratchets. Status: ready-to-build sourced spec; gated on operator connecting Profound Enterprise + the category-name sync change.

### Benchmark cold-store → Supabase: unlock COMPUTED proof outcomes for Ritz (PROVEN 2026-06-13, daylight-execute)
**The wedge's missing data.** Ritz shows **0 computed / 166 watching** proof outcomes in prod because the proof engine's benchmark regime (`buildUrlCitationHistory`, dates < `NATIVE_REGIME_START` 2026-04-22) reads pre-native citation history from the LOCAL cold-store (`process.cwd()/.data/citations-by-date/*.json`, 48 shards) — which does NOT exist on the ephemeral cron runner, so every pre-04-22 change gets no baseline → "watching." The native regime (post-04-22) barely overlaps Ritz's changelog (ends ~04-27), so almost nothing computes.
**PROVEN worth it (verify-first dry-run, 2026-06-13, ZERO prod write):** ran the real `buildAndPersistTenantProof("tenant-ritz-founder")` with a no-op persist, `DATA_SOURCE=supabase` (real changelog 289 + observations 21,047 from prod) + the 48 benchmark shards copied into the local `.data` so the cold-store could read them. Result: **computed 0 → 6**, weak → 84, watching → 57 (`by_status`: computed 6, no_controls 82, weak_estimate 2, insufficient_baseline 57, zero_signal 20, ineligible_layer 112, ineligible_event 10). **HONEST READ — verified the 6 individually, do NOT overclaim "6 wins":** all 6 are the SAME change (`/locations/menlo-park`, treatment 2026-04-07, identical lift 6.214 cit/day = 54%, 4 controls), counted 6× because the changelog has 6 duplicate rows (`cl-real-200`..`205`) for one edit; and **0/6 are placebo-significant** (all `placebo_p=0.5` → the engine correctly caps them at MEDIUM with the honest warning "untreated pages moved this much by chance"). So the real unlock is modest + honest: ONE distinct, medium-confidence, placebo-INSIGNIFICANT measured outcome populates the `/changes/[id]` drilldown with a real diff-in-diff number + an honest "could be chance" caveat instead of a blank "still watching" — it does NOT manufacture high-confidence wins today, and it surfaces a DUP-CHANGELOG data-quality issue (cl-real-200..205 should dedupe to one). The migration is still the PREREQUISITE for the wedge ever computing (value compounds as native polling accumulates + more changes earn benchmark baselines), but the immediate demo payoff at n=1-placebo-insignificant is small — ship it for completeness/honesty, not as a "6 wins" headline.
**Exact build (daylight — core-wedge persistence + prod data, operator-present):** (a) new Supabase table `benchmark_citations_by_date` (date PK-ish, JSONB array of CitationObservation per day, tenant_id) — additive; (b) cold-store Supabase read backend — `getCitationsForDate`/`getAllCitationDates` read the table when `DATA_SOURCE==="supabase"` (today they're local-file-only), fail-soft to local; (c) one-time loader script: read the 48 local `.data/citations-by-date` shards → upsert into the table (idempotent by date; the shards are owned+competitor citations, `is_owned` preserved); (d) verify the next cron produces computed≈6 for Ritz, then the `/changes/[id]` causal drilldown + Today "Proven by Beacon" rail + the EV forecast all light up with real claims. **Why daylight, not tonight:** touches the attribution/persistence core wedge (CLAUDE.md Max-tier/high-risk), needs the prod data load + cron-read flip to validate end-to-end, and can't be CI-gated during the current GitHub runner outage. NOT speculative — the 0→6 proof is in hand. Status: **ready-to-build, daylight-execute** — the prerequisite for the wedge ever computing, but verified to yield only ONE distinct placebo-insignificant medium-confidence outcome today (not "6 wins"); ship for honesty/completeness + to surface the dup-changelog issue, value compounds later. Chipped for the operator (honest framing).

---

## 2026-06-24 — AEO/GEO citation-tactics research (autonomous loop, web-sourced)

**What makes AI assistants cite a site in 2026 (synthesized from 2026 AEO guides):**
1. **Two distinct citation pathways** — training-corpus recall (~6–12mo refresh) vs live RAG retrieval (~24–72h). Optimization must be platform-specific; Perplexity/ChatGPT-search lean RAG (fresh, structured), some Gemini/Google-AI lean corpus. *Beacon implication:* the AEO layer should eventually tag which platform a gap is on (Profound fanouts carry platform) and bias toward RAG-winnable tactics for the fast wins.
2. **Answer-block format that gets extracted (highest-leverage, measurable):** question-as-H2/H3 heading → **direct answer FIRST in 40–60 words**, standalone/complete when lifted out → then supporting evidence (stats/examples). AirOps reports **2.8× citation lift** for structured question-headings + FAQ vs unstructured. *Beacon implication:* the `intro_answer_block` draft directive should enforce the 40–60-word direct-answer-first + question-heading shape. **STATUS: ALREADY IMPLEMENTED (verified 2026-06-24)** — `composeAnswerBlockDirective` (draft-enrichment.ts:1173) already instructs exactly this: "2–3 sentence direct answer (about 40–60 words) as the FIRST content block, right under the headline; first sentence must NAME the subject (no 'it'/'this') so it stands alone if quoted; if a heading covers the topic phrase it as the actual question; keep it as visible body text — don't rely on FAQ markup (rich results retired)." Beacon's directive already matches the 2026 best practice. No change needed.
3. **Structured data is read as on-page TEXT** by ChatGPT/Perplexity (Mark Williams-Cook / SERoundtable 2026) — JSON-LD alone is NOT enough; the answer must be in the VISIBLE content. *Beacon implication:* this VALIDATES Beacon's existing honesty stance (schema = "support, not magic") and means answer-block (visible) > schema-only for AEO. Keep pairing a visible answer block with FAQ schema, never schema alone.
4. **Fastest wins (map exactly to Beacon's existing levers):** refresh high-impression/low-CTR pages to answer questions directly; add FAQ + Article schema; build 2–3 topical-authority hubs. *Beacon implication:* no new system needed — the GSC-led CTR-leak + answer-block + schema recs ARE the AEO playbook. The gap is FORMAT quality (point 2) and topic→page AEO mapping (NEXT_PHASE lever 0g).

**Honest take:** Beacon already has the right LEVERS. The edge is (a) answer-block FORMAT discipline (40–60w, question-heading, extraction-complete) and (b) turning the 22,840 Profound citation rows into per-topic, per-page AEO recs (lever 0g). Both are bounded builds, not new systems. Sources: bigeyeagency.com, frase.io, airops.com (ChatGPT content structure), seroundtable.com (structured-data-as-text).
