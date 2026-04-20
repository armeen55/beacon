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

*None yet. Add ideas here as they arrive.*

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
