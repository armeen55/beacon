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

