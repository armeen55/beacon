# Beacon — Brutal Fresh-Eyes Audit (2026-05-08)

> **Prompt:** "Tell me what Beacon actually is, what is strong, what is weak, what is fake, what is fragile, what is overbuilt, what is underbuilt, what will break, what will impress customers, and what needs to change to make this a serious product."
>
> **Method:** Read-only inspection of the codebase, routes, domains, scripts, workflows, migrations, tests, env, and a sample of the recent docs. No paid APIs run. No production mutation. Three parallel Explore agents triangulated against direct file reads of the highest-stakes claims.

---

## ⚠️ CORRECTIONS — read this before you read the audit

**This document was revised on 2026-05-08 (later the same day) after a read-only diagnostic pass.** The original audit got its central premise wrong. The error was a buggy regex in the diagnostic grep — `'"live_at":"[^n]'` (no space after the colon) — which silently returned 0 against JSON that actually has `"live_at": "..."` *with a space*. Every "live_at is null on every row" claim that flowed from that grep was wrong.

**What the original audit said and what's actually true:**

| Original claim | Actual on-disk truth |
|---|---|
| "The learning loop is not running. `BEACON_LIFECYCLE_ENABLED` is OFF." | The loop is running. Most likely already enabled in Vercel production cron. Locally the env var is unset, but the local `recommended-edits.json` contains a `verified_live` row stamped 2026-04-28 — which only exists if the runner actually ran. |
| "`live_at` never auto-stamps." | It has stamped. **1 row** in `recommended-edits.json` has `live_at: "2026-04-28T05:26:26.05+00:00"`. **1 changelog row** has the matching `live_at`. |
| "0 causal-stamped changelog rows; chain is dead." | **3 changelog rows** have `source_rec_id` stamped, all to the same parent rec (`create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)`). The chain is built. |
| "0 outcomes; learning is dead." | 0 outcomes is correct, **but the cause is the 14–30 day verdict bake window, not a broken loop.** The H2 stamp is from 2026-04-28; today is 2026-05-08; that's 10 days — still inside the window. The verdict will materialize on its own around May 12–18. |
| "Top-leverage move #1: flip the flag." | Wrong premise. The flag is already flipped where it matters. |

**What the original audit got right and remains true:**
- `engineConfidence: "medium"` is hardcoded on every rec row. Queue is sorted `created_at DESC`, not by impact.
- `add_h2_section` deterministic generator emits competitor names in public copy (literally on disk: `"Why teams choose us over De Mattei Construction"` with `not_found_reason: "invalid_competitor_public_copy_pre_w3"`). Validator catches them, but the generator is still emitting them.
- `competitorPageBlueprints[].h1/topH2s/faqQuestions` are hardcoded null at `specific-edit-evidence.ts:1214-1219`.
- No RLS policies on any of 35+ Supabase tables.
- 44 domain folders. 51 root markdown docs. 2,833-line `today-data.ts`. 1,689-line `recommendations-client.tsx`. Two operator-mode flags. Empty-string `tenant_id: ""` placeholders in 4 production files.
- Routes that look like internal tooling on the customer shell (`/diagnostics`, `/expansion`, `/audit`, `/rank`, `/moves`, `/review`, `/changes/truth`).

**What changed in the audit:** Section A executive summary, Section B item #1, Section D item #1, Section F Hours 0–8, Section G Week 1, Section H lifecycle row, Section I framing. Sections C (strong points), E (kill/merge/elevate), and the unchanged D items are the same. **A new Section J at the end** documents the correction in full and the corrected highest-leverage next step.

The pattern matters more than the regex bug: the original audit was fast and confident because the agents trusted reports they couldn't verify against actual data. Read this audit assuming any specific number could still be wrong; the structural conclusions are firmer than the per-row counts.

---

## A. One-page brutal executive summary (revised)

**What Beacon is, in one sentence.** A Next.js + Supabase single-tenant tool that polls AI assistants nightly for prompts about a business, materializes structured observations (mention position, citation rank, primary recommendation), and turns those into a ranked recommendation queue that's wired to a working — but slow and currently invisible — attribution loop. Currently dogfed on Ritz Builders, with a planned pivot to multi-tenant SaaS at $249–$1499/mo.

**Is it promising?** Yes. The data layer is more honest and more rigorous than 90% of the AEO competitors (raw poll chunks, reconciliation, deterministic extraction, dual-write, fail-loud tenant resolution, real validator gates, real causal stamping). The "causal attribution wedge" pitch is supported by real code, and as of revision-time **there is one verified end-to-end causal example on disk** that proves the chain works: prompt → answer → citation → page → rec → accept → changelog (source_rec_id stamped) → match runner → verified_live → live_at stamped. Just one. The pipe is real; the throughput is low.

**Is it demo-ready?** Yes for a 1-customer dogfeed of /today + /recommendations + /changes if you keep operator mode off and skip /diagnostics, /expansion, /audit, /rank, /moves, /review. Today is a polished dashboard. **But the one thing that would make a real demo land — surfacing the existing causal-stamped change with its `live_at` date and its (eventually) verdict — is not currently surfaced anywhere a customer would see.** The proof exists; the product hides it.

**Is it sellable?** Not yet. Three blockers, in order — and these have shifted from the original audit:
1. **The loop is alive but mostly invisible and underfed.** It produced 1 verified_live transition in roughly a month at current operator cadence. To reach the `credible` learning-score threshold (N≥15 outcomes, per `analyze-recommendation-outcomes.ts:445`), the system needs ~15× more verified_live rows. At current rate that's 12+ months. And the 1 stamp it has produced isn't shown anywhere prominent.
2. **No RLS policies exist on any of 35+ Supabase tables.** Tenant isolation is application-level only; a single bug in `currentTenantId()` or a compromised JWT exposes every customer's data to every other customer.
3. **The deterministic generators emit content the validator rejects** by design (competitor names in public copy, combined Q+A rows), and `engineConfidence` is a literal `"medium"` on all 31 production rec rows — so the queue is sorted by `created_at DESC` with no real signal.

**Biggest risk.** You ship to a paying customer; their /changes page shows zero verdicts for weeks because nothing has matured past bake; your differentiating wedge — "we prove what worked" — produces nothing for them to look at. Meanwhile the competitor names embedded in H2 proposals leak through the validator into a customer's CMS once and the brand is done.

**Biggest opportunity.** Three things, all already half-built. **(1) Surface the existing causal-stamped row** on /today and /changes prominently — "On April 28 you shipped a new H2 on the whole-home-remodel page; the verdict is computing now and will land around May 18." This single change makes the wedge legible. **(2) Diagnose why 2 of the 3 child rec_edits in that same parent rec are stuck at `accepted` and never reached `verified_live`** — if the FAQ Q+A pair is on the live page but the matcher missed them, that's a real bug in the match engine; if they're not on the page, that's a workflow problem with how briefs translate to ship-ready content. Either way, fixing it is the rate-limiter on getting the loop from "1 stamp/month" to "N stamps/week." **(3) Cut the surface area in half.** /audit, /rank, /moves, /review, /expansion, /diagnostics, /briefs, /local, /topics, /pages all exist; only 4 of them are the customer's daily-loop product.

---

## B. Top 10 highest-leverage changes (revised)

| # | Change | Why it matters | Impact | Difficulty | Risk | Bucket | Files |
|---|---|---|---|---|---|---|---|
| 1 | **Surface the existing causal-stamped row prominently on /today and /changes**, AND **diagnose the 2 stuck add_faq rec_edits.** "On 2026-04-28 you shipped a new H2; verdict landing ~2026-05-18" needs to be a hero block, not a row buried in a tab. Then walk the page source of the FAQ target URL by hand to see whether the FAQ block exists but the matcher missed it (real match-engine bug) or whether it isn't on the page (operator-workflow gap). | The loop is alive but invisible. The product currently doesn't show the customer the *one* causal example it has. Fixing visibility makes the wedge legible. Diagnosing the 2 stuck FAQs reveals whether the bottleneck is matcher bugs or operator workflow, which determines the next 30 days of work. | Massive — the difference between "the loop will work eventually" and "look, here's it working." | Medium — the surface change is ~½ day; the diagnosis is read-only and takes ~1–2 hours of looking at live HTML and match-engine logs. | Low. | product + data | `src/app/(shell)/today-data.ts`, `src/app/(shell)/changes/page.tsx`, `src/domains/recommendations/match-engine.ts`, the live `https://ritzbuilders.com/services/whole-home-remodel` HTML |
| 2 | **Add Supabase RLS policies to all 35+ tenant-scoped tables before a second customer is provisioned.** Migrations dir currently has zero `CREATE POLICY` statements. | Tenant isolation today is "we appended `.eq("tenant_id", x)` everywhere" — that's not isolation, that's discipline. One bug = full cross-tenant leak. A skeptical customer will ask. | Critical — blocks any honest claim of multi-tenant safety. | Medium-high — 30+ tables × 4 policies = ~120 policies, plus a `tenant_members` join. ~3–5 days. | Low if done before customer 2; catastrophic if skipped. | data + business | `migrations/`, `src/lib/persistence/repositories/supabase-backend.ts`, `src/lib/auth/supabase-middleware.ts` |
| 3 | **Compute and persist a real `engineConfidence` (HIGH/MEDIUM/LOW) per rec, then sort the queue by it.** Today every row has `confidence: "medium"` literal and the queue is `created_at DESC`. | This is the difference between "ranked decision queue" (the pitch) and "newest LLM packet first" (the reality). The Phase A `prioritize.ts` score is computed and discarded by `recommendation-action-rows.ts`. | Massive — fixes the most embarrassing on-screen lie. | Medium — wire `prioritize.ts` score into the action-rows sort and stop hardcoding `"medium"`. ~1 day. | Low — pure surfacing of existing computation. | product + data | `src/domains/recommendations/prioritize.ts:124-132`, `src/domains/recommendations/recommendation-action-rows.ts:1568-1576`, `src/domains/recommendations/confidence.ts:152-162` |
| 4 | **Kill the `add_h2_section` deterministic generator's competitor-name template** (`Why teams choose us over ${Competitor}` at `add-h2-section.ts:74`) — replace with a generic angle phrasing OR delete the deterministic path entirely. Verified on disk: row 1 of `recommended-edits.json` is dismissed with `not_found_reason: "invalid_competitor_public_copy_pre_w3"`. | Validator strips them, so the queue silently shrinks. The generator is wasted work plus brand-damaging if it ever ships through. | High — removes a real footgun. | Low — 10-line change. | Low. | product + architecture | `src/domains/recommendations/providers/generators/add-h2-section.ts:74`, `src/domains/recommendations/specific-edit-validator.ts:1402` |
| 5 | **Populate `competitorPageBlueprints[].h1/topH2s/faqQuestions/metaDescription`** (currently hardcoded null per `specific-edit-evidence.ts:1214-1219`) so the OpenAI SYSTEM_PROMPT Rule 15 ("learn the structure these pages take") has actual structure to learn from. | The pitch tells the model to learn from competitor structure; the data passed says "here's a URL, good luck." This is the single biggest reason recs default to generic boilerplate ("architect-led design-build" 8/20 times in the prod sample). Improving rec quality also lifts the acceptance rate, which feeds Top-1's underfed-loop problem. | High — directly improves rec quality, which is the throughput input to the loop. | Medium — needs page-extractor coverage on competitor URLs (cheerio/puppeteer already in deps). ~2–3 days. | Low — read-only crawl. | product + data | `src/domains/recommendations/specific-edit-evidence.ts:1214-1219`, `src/domains/scanning/`, `src/domains/recommendations/providers/openai.ts:363-372` |
| 6 | **Cut /audit, /rank, /moves, /review, /expansion, /diagnostics/spikes, and `/changes/truth` from the default nav.** Hide /diagnostics/* behind operator mode (already gated; just stop linking to them). | These routes have unclear purpose, are placeholders, or are operator tools. They make the product feel like internal tooling and dilute the pitch. The customer should see ~5 routes: `/today`, `/recommendations`, `/prompts`, `/changes`, `/settings`. | Big — perceived product clarity 10x. | Low — nav-level change + a few link cleanups. ~1 day. | Low. | UX | `src/app/(shell)/layout.tsx`, `src/components/shell/*`, route folders |
| 7 | **Unify the two operator-mode flags** (`BEACON_OPERATOR_MODE` server-side, `NEXT_PUBLIC_OPERATOR_MODE` client-side) into one consistent gate, and make the production-default UNSET so customer environments are safe-by-default. | Today these are two different env vars used in two different files. Easy to miss one when prepping a customer environment. | Medium — removes a real operational footgun. | Low — single helper + grep cleanup. ~½ day. | Low. | architecture | `src/domains/today/command-center-data.ts:257`, `src/app/(shell)/recommendations/recommendations-client.tsx:25`, `src/app/(shell)/changes/scorecard-client.tsx:24`, `src/app/(shell)/diagnostics/*`, `src/app/(shell)/settings/import/import-page.tsx:16` |
| 8 | **Decompose the two monsters: `today-data.ts` (2,833 lines) and `recommendations-client.tsx` (1,689 lines).** | These two files alone are 4,500+ lines and concentrate the most-edited surface. They're the next stale-cache / hidden-coupling bugs waiting to happen. | Medium — pays back across every future change. | Medium — needs careful extraction with snapshot tests. ~3–4 days. | Medium — high-touch files. Do behind a UX-frozen sprint. | architecture | `src/app/(shell)/today-data.ts`, `src/app/(shell)/recommendations/recommendations-client.tsx` |
| 9 | **Move the LLM budget ledger (`llm-budget.json`) into Supabase.** Today it's local-FS-only on the Vercel runtime. If `.data/` evaporates between deploys, the cap is unrecoverable. | A budget ledger that lives only on ephemeral storage is not a budget ledger. | Medium — turns a "trust me" cost guard into a real one. | Low — one table + dual-write call. ~1 day. | Low. | data | `src/domains/recommendations/adjudicator-budget.ts`, `.data/global/llm-budget.json`, `migrations/` |
| 10 | **Expose `aiSearchSignal.topSearchQueries` as `evidence[].type === "search_query"` rows on the customer-visible rec drawer.** Today the strongest signal in the packet is internal — the operator never sees it. | This is the most differentiated piece of evidence Beacon has (verbatim AI-emitted queries). Hiding it is a self-inflicted weakness vs. competitors. | High — turns "Beacon thinks this matters" into "Beacon has receipts." | Low — 1-day surface change. | Low. | product | `src/domains/recommendations/recommendation-action-rows.ts:254`, `src/domains/recommendations/specific-edit-evidence.ts:538-701`, `src/app/(shell)/recommendations/recommendations-client.tsx` |

---

## C. Top 10 things that are actually strong

1. **Raw poll chunks safety net (`migrations/2026-05-04_poll_integrity_raw_poll_chunks.sql`).** Stores the full provider JSON BEFORE the upsert, with reconciliation status post-hoc. This was clearly built in response to the May 2-4 incident where 600+ prompts and ~$9 of spend persisted zero observations. Most products would have shrugged and re-polled. Doing the safety-net work is the move of a serious team.
2. **Deterministic extraction (`src/domains/prompt-answer-observations/extraction.ts`).** No LLM, no randomness, full unit-test coverage of `extractMentionPosition`, `extractCitationRank`, `extractPrimaryRecommendation`, `rankEntitiesByFirstAppearance`. Reproducible and auditable.
3. **Fail-loud tenant context (`src/lib/tenant-context.ts`).** The throw-on-missing posture is correct: "intentional fail-loud so misconfiguration surfaces immediately rather than silently routing to ritz." No `DEFAULT_TENANT_ID` shortcut. Single best decision in the codebase.
4. **The /recommendations route is honestly degraded under failure.** Every layer wrapped in `safeCall`, errors collected and surfaced as a small banner instead of a 500. "Some recommendation data couldn't load. Showing what we have." That's customer-grade resilience.
5. **The causal stamping schema is real (T6.8).** `recommendation_responses.source_rec_id → changelog_entries.source_rec_id → url_change_outcomes.change_id` is a three-table join that actually wires rec to outcome. **And as of 2026-05-08 there is one fully-traversed instance on disk** — the Whole Home Remodel H2 — proving the chain works end-to-end, not just in theory.
6. **Z-score natural-controls attribution engine.** `helping (z≥2) / weak_signal / nothing_yet / too_early / hurting (z<-2)` is a defensible methodology. Not a popularity heuristic, not a vibe — a real statistical comparison against matched controls.
7. **The validator (`specific-edit-validator.ts`).** Seven hard gates: placeholder detection, UUID leak, competitor public-copy leak, brand-claim grounding, em-dash policing, FAQ pairing, confidence floor. Verified in production data: 21 of 28 dismissed rec_edits carry a `not_found_reason` like `invalid_competitor_public_copy_pre_w3` or `invalid_placeholder_pre_w3`. The gates are not theoretical.
8. **Persistence canary (`scripts/check-yesterday-poll.ts`, `poll-canary.yml` 45 min after main poll).** Detects silent-write failures by comparing expected vs. persisted observations. Combined with the persist-gate that auto-disables next paid poll on failure, this is real production hygiene.
9. **The /today demo-mode gate (`isDemoMode = !hasActiveExperiment()`).** When no real data is imported, the page shows an honest "Import your data" empty state — no fake seed data. That respects the customer.
10. **The shape of the brain is right.** The architecture — observations → packet → LLM/deterministic → validator → ranked queue → causal stamping → match runner → attribution engine → outcome verdicts → learning score per action_type — is the correct product spine. Most competitors don't even attempt the right diagram.

---

## D. Top 10 things that are weak / fake / confusing (revised)

1. **The learning loop is alive but barely.** It produced **1 verified_live transition** in roughly the last 30 days. The learning score requires N≥15 *causal outcomes* (not stamps) to leave `insufficient_sample` and become `credible` (per `analyze-recommendation-outcomes.ts:445`). At current ship rate, getting to N=15 takes 12+ months. **And the 1 stamp that exists is invisible** — there's no hero block on /today saying "Here's what shipped, here's what we expect, here's the verdict landing date." The loop is real; the proof of the loop is hidden.
2. **`engineConfidence: "medium"` is a literal string on all 31 production rec rows.** No HIGH, no LOW, no signal. The queue is sorted `created_at DESC` and dressed up as "ranked." Phase A's `prioritize.ts` computes a real score and Phase B (`recommendation-action-rows.ts`) discards it.
3. **No RLS on 35+ tables.** Migrations dir contains zero `CREATE POLICY` statements. Tenant isolation is application-level only. That is discipline, not security. Cannot honestly tell a customer their data is isolated.
4. **`tenant_id: ""` empty-string placeholders in 4 production files** (`opportunity-candidates/actions.ts:98`, `changelog/actions.ts:79`, `scanning/detect-findings.ts:865`, `results/actions.ts:93`). Comments say upstream callers replace, but if a code path bypasses the call site, an empty string flows into a query that won't error and won't filter — silent corruption.
5. **Two operator-mode flags (`BEACON_OPERATOR_MODE` server, `NEXT_PUBLIC_OPERATOR_MODE` client) for the same conceptual gate.** Easy to set one and not the other.
6. **Deterministic generators produce content the validator rejects.** `add-h2-section.ts:74` builds `Why teams choose us over ${competitor}` — verified on disk as `invalid_competitor_public_copy_pre_w3`. `add-faq.ts:96` builds combined `Q: ... \n\n A: ...` rows which `checkFaqPairing` (`specific-edit-validator.ts:1733`) rejects (W3 §3.8 contract requires two rows). The two halves of the system disagree about the contract.
7. **The /today page is doing too much.** `today-client.tsx` is 911 lines, `today-data.ts` is **2,833 lines**. ~18 sub-sections. That's a kitchen sink, not a homepage.
8. **44 domain folders for a product currently serving one user.** Many could collapse into 5–10 domains. The decomposition was for a future state that hasn't arrived.
9. **51 audit/preflight/sprint-report markdown files in `docs/` root.** The handoff doc itself is 480KB and exceeds my read window. Process velocity masquerading as documentation. A new contributor can't find what's true.
10. **Routes that look like internal tooling on the main shell:** `/diagnostics`, `/diagnostics/brain`, `/diagnostics/spikes`, `/expansion`, `/changes/truth`, `/settings/health`, `/settings/exit-gates`, plus the entire `(builder)` group. /briefs, /briefs/[id], /briefs/proposed exist as a content-generation surface that overlaps with /recommendations. Customer has no idea which page is "the page."

---

## E. Kill / merge / elevate list

### Kill (delete or hide entirely)
- **`/audit`** — placeholder explicitly marked "Coming in CX3."
- **`/rank`, `/moves/[id]`** — no clear purpose; in the `(builder)` group.
- **`/review`** — no exports referenced; orphan.
- **`/expansion`** — comment says "Quarantined hypothesis list — not part of the default operating story."
- **`/changes/truth`** — flag-gated preview; not a customer surface.
- **`/settings/exit-gates`** — unknown purpose.
- **The `add_h2_section` competitor-name template** at `add-h2-section.ts:74`.
- **The `archive/` subfolder in docs/** if the content is truly archived, move it out of the repo or compress to one summary file.
- **The two `_probe.ts` and `_check-recent.ts` scripts** — these read like ad-hoc debug throwaways.

### Merge
- **`/diagnostics`, `/diagnostics/brain`, `/diagnostics/spikes`** → one operator-mode `/diagnostics`.
- **`/briefs`, `/briefs/[id]`, `/briefs/proposed`** → fold into `/recommendations` as a "brief" view-mode.
- **`/topics`, `/topics/opportunity/[id]`** → fold into `/prompts` as a grouping mode.
- **`/competitors`, `/competitors/[id]`** → keep, but consider folding `/local` into a tab on the competitor profile or business profile.
- **The 44 domains** → target 12–15 for v1: `polling`, `observations`, `recommendations`, `validator`, `ranking`, `lifecycle`, `learning`, `tenants`, `pages`, `prompts`, `entities`, `today`, `changes`, `briefs`.
- **`tracked-prompts` ⇆ `prompts` ⇆ `prompt-answer-observations`** → one folder with sub-modules.
- **`event-decisions`, `events`, `outcome-events`, `visibility-events`, `milestones`** → one `events` domain.
- **`patterns`, `global-patterns`, `answer-intelligence`, `learning`** → one `learning` domain.
- **The two operator-mode env vars** → one helper, one flag.

### Elevate
- **The 1 existing causal-stamped change.** "Whole Home Remodel — H2 shipped 2026-04-28, verdict landing ~2026-05-18" is the *only* full demo of Beacon's wedge. Make it a hero block on /today and on /changes. Right now it's invisible.
- **The /changes lifecycle strip** with "live verified / pending / needs review / imported / scan-confirmed" counts. This is the visual proof of the wedge — make it a hero on /today instead of a strip.
- **Citation evidence** ("AI cited *your URL* on this prompt"). Today this is buried. Put it on the homepage hero.
- **"Why this verdict" with Z-score math** (the attribution drilldown on /changes). This is the credibility moment. Promote it; never bury it behind an expand toggle.
- **Brain health canary.** Make a small "system health: green" pill in the nav.
- **The validator gates** — turn the rejection log into a "we caught these issues" surface. Demonstrating that recs were rejected for brand-claim violations *builds* trust.

### Hide behind operator mode
- All `/diagnostics/*` routes (already gated, but stop linking to them from /today).
- The "raw schema enums" / UUID `data-*` attributes (verify gating in customer mode).
- The brain-health JSON dump.
- The Vercel build-guard env vars (`BEACON_LLM_BUILD_OK` is internal-only).
- Any of the `BEACON_DEBUG_*` console.logs.

### Turn into paid/customer-facing value
- **Outcome verdicts** — once the bake clears and N rises, "We shipped 47 changes for you, 12 are working (z≥2), 8 hurt and we rolled them back, 27 too early to tell" is the single most monetizable artifact in the system.
- **Cost tracking ledger** — show the customer "you've used $4.10 of your $50/mo poll budget."
- **The brain-health canary** — show "Beacon ran your nightly poll on 2026-05-08 07:00 UTC, persisted 198/200 prompts."

---

## F. "If I had 72 hours" plan — exact order (revised)

**Hour 0–8 — make the existing proof legible, and find out what's stuck.**
1. Surface a hero block on /today and a banner on /changes for the 1 causal-stamped change: "Whole Home Remodel — H2 shipped 2026-04-28, verdict computing, expected ~2026-05-18." Pull from `recommended-edits.json` + `imported-changes.json` directly; no new schema.
2. Walk the live HTML at `https://ritzbuilders.com/services/whole-home-remodel`. See whether there's an FAQ section corresponding to `faq_question[new]:b1c2d3e4...`. If yes, the matcher missed it — read `match-engine.ts` and find why. If no, the operator hasn't shipped that FAQ yet — that's a workflow signal.
3. **Stop. Don't widen scope.** The point of day 1 is: prove the loop is visible, find out what the bottleneck on the next stamp is.

**Hour 8–24 — make the queue rank.**
4. Wire `prioritize.ts` score into `recommendation-action-rows.ts` sort. Stop hardcoding `"medium"`.
5. Surface engineConfidence (HIGH/MEDIUM/LOW) on each row with a one-line "why this confidence" hover.
6. Surface `aiSearchSignal.topSearchQueries` as `evidence[].type === "search_query"` rows in the rec drawer.
7. Smoke-test on Ritz; confirm the queue order changes visibly.

**Hour 24–48 — kill the surface area lie.**
8. Remove `/audit`, `/rank`, `/moves`, `/review`, `/expansion`, `/changes/truth`, `/diagnostics/spikes`, `/settings/exit-gates`, `/settings/health` from the main nav.
9. Hide all `/diagnostics/*` behind a single unified operator-mode helper (`isOperatorMode()`).
10. Verify customer-mode demo on /today, /recommendations, /prompts, /changes — that's the 4-page product.
11. Delete `add-h2-section.ts:74` competitor-template branch; replace with cluster-label-only path.

**Hour 48–72 — make outcomes visible (broader than just the one row).**
12. Build a "results" hero block on /today showing the 14-day outcome trend per change_id (helping/weak/none/hurting counts) — even when 0/0/0/0, the block should show the two upcoming "verdict expected" dates.
13. Move the lifecycle strip from /changes onto /today as the first scroll-position-2 block.
14. Add a "Beacon ran your nightly poll on [date], persisted [n/n] prompts, no drift detected" trust pill in the shell.
15. Record a 90-second demo. Watch it back. If you wouldn't pay $499/mo to be the customer in that video, stop, re-plan.

**Do NOT do in 72 hours:** RLS, multi-tenant cron rewiring, billing, file-store → Supabase migration, populating `competitorPageBlueprints`. Those are 30-day work.

**Capability for this 72-hour bundle:** **Balanced (Sonnet)** for 0–24 (the matcher diagnosis is bounded; the surfacing work is straightforward). **Max (Opus)** if the matcher diagnosis turns up a real engine bug — that's harder reasoning.

---

## G. "If I had 30 days" plan (revised)

**Week 1 — fix what's invisible and what's stuck (the F-plan above).**
- Existing causal stamp is surfaced; matcher gap on the 2 stuck FAQs is diagnosed; ranking real; surface area cut; broader outcomes hero on /today.
- Exit criterion: a 90-second demo where /today → /recommendations → accept → /changes → outcome verdict (or "expected ~ date") is fully end-to-end with the 1 real example *visible*.

**Week 2 — fix the trust posture.**
- RLS on all 35+ tables. Tested with two seeded test tenants attempting cross-reads.
- Move `llm-budget.json` into Supabase. Add a per-tenant `daily_budget_usd` enforcement check at the polling entry point.
- Unify operator-mode flags into one helper. Audit every `data-rec-*` and `data-attribution-*` attribute for customer-mode leak.
- Populate `competitorPageBlueprints[].h1/topH2s/faqQuestions` via the existing puppeteer/cheerio scanner. **This alone will materially lift recommendation quality and acceptance rate, which feeds the throughput problem from Week 1.**

**Week 3 — fix the recommendation quality.**
- Decompose `today-data.ts` and `recommendations-client.tsx` (~4,500 lines combined) into focused modules. Snapshot tests first.
- Add a Rule 16.A validator gate (today it's SYSTEM_PROMPT-only — soft).
- Replace deterministic `add_h2_section` competitor template; consider whether the deterministic path should exist at all once the LLM has structure populated.
- Build a brand-voice grounder.
- Re-audit the rec queue against the prior 20-row sample. Goal: <30% boilerplate.

**Week 4 — fix the path to the second customer.**
- Take a real second customer (not synthetic). Run `onboard-tenant.ts`, set their env, fire a real poll, confirm RLS holds, observations land scoped, recs generate scoped, no Ritz data bleeds.
- Honest measurement: how many operator-hours did the second-customer onboarding take? If >4, build the missing automation before #3.
- Document a single onboarding runbook (1 markdown file, replacing the 51 in `docs/` root). Everything else moves to `docs/archive/`.

**Capability for the 30-day bundle:** mostly **Balanced (Sonnet)** for the implementation grind; **Max (Opus)** at the start of weeks 2 and 3 for the architecture work (RLS design, file decomposition).

---

## H. Before charging customers — checklist (revised)

| Check | Status today | Why it matters |
|---|---|---|
| Match runner producing verified_live transitions on a regular cadence | ⚠️ Running. Producing ~1 transition per month at current operator ship rate. Verdict materializer is correctly waiting out the 14–30 day bake window on the 1 stamp that exists. | Loop is alive but underfed; not blocking, but throughput needs lifting |
| The 1 existing causal-stamped change is visible somewhere a customer would see | ❌ Invisible | The proof exists; the product hides it |
| The 2 stuck FAQ rec_edits diagnosed (page-not-shipped vs matcher-bug) | ❌ Unknown | Determines whether bottleneck is workflow or code |
| RLS on all tenant-scoped tables | ❌ Zero policies | Cannot honestly claim isolation |
| `engineConfidence` is a real ranking signal, not a literal `"medium"` | ❌ Hardcoded | Queue is sorted by `created_at`, not impact |
| `add_h2_section` competitor-template branch removed | ❌ Active | Brand-damaging if it ever ships through |
| `competitorPageBlueprints` structure populated | ❌ Hardcoded null | LLM has no structure to learn from |
| Operator-mode unified into one flag, customer-default OFF | ⚠️ Two flags | Easy to leak debug surfaces |
| `/diagnostics/*`, `/expansion`, `(builder)/*` routes hidden from default nav | ⚠️ In nav | Looks like internal tooling |
| `tenant_id: ""` placeholders eliminated from production paths | ❌ 4 instances | Silent-corruption risk |
| LLM budget ledger persisted to Supabase | ❌ Local-FS only | One bad deploy = lost ledger |
| Per-tenant `daily_budget_usd` enforced in code (not just env-var default) | ❌ Honor system | Cost overrun risk at scale |
| Per-tenant cron — not all tenants polled by one sequential job | ❌ Sequential | Breaks at ~10 tenants |
| Multi-tenant primary-indicator in `tenant_members` | ❌ Redirect on N>1 | Single user = single tenant only |
| Onboarding self-serve — operator does not need to set 4 Vercel env vars per tenant | ❌ Manual | Doesn't scale past ~5 tenants |
| `docs/` rationalized (one runbook, archive the 50+ sprint reports) | ❌ 51 root MDs | Future-you cannot find truth |
| Customer-mode demo of /today, /recommendations, /prompts, /changes recorded and reviewed | ❌ Not done | The single highest-leverage check |
| `add_faq` Q+A row format aligned with validator pairing contract | ❌ Conflict | Either dead code or live regression |
| Honest "system health" pill that reflects last poll's persistence rate | ❌ Hidden in /diagnostics | Trust signal currently invisible |

**Minimum-viable subset to charge a single second customer at $249/mo:** RLS, the 1 existing stamp surfaced + the 2 stuck rec_edits diagnosed, hardcoded confidence fixed, unified operator mode, dead routes hidden. The rest is week 3–4.

---

## I. Final verdict (revised)

**Pick: narrow the product (and make the loop visible).**

The bones of Beacon are stronger than the original audit gave credit for. The loop is not dead — it has produced one fully-traversed causal example, on disk, dated 2026-04-28. The problem isn't that the engine is off. The problem is **(a) the engine is producing ~1 verified_live row per month**, **(b) nothing in the product currently shows the customer that the engine produced anything**, and **(c) the surface area around the engine is so noisy** (44 domains, 41 routes, 51 markdown plans, two operator flags, monster files) that even a competent observer can't tell what's working.

**You do not need to rebuild core architecture.** The data layer and the lifecycle/attribution spine are real. The original audit's "the loop doesn't run, flip the flag" framing was wrong; the loop runs, and the flag is set where it matters.

**You do need to:**
1. **Make the loop visible.** The 1 causal-stamped change deserves a hero block on /today and a banner on /changes. The 2 stuck rec_edits deserve a diagnosis (page-not-shipped vs matcher-bug). Real ranking, real confidence, real surfacing of `aiSearchSignal.topSearchQueries`.
2. **Cut the surface in half.** 4 customer routes + 1 operator route; everything else hidden or merged.
3. **Add the trust posture.** RLS, unified operator gate, budget in Supabase, cleaned `tenant_id` placeholders.

**Do not pivot positioning.** The "causal attribution wedge" is the right pitch and is supported by real code and one real example. The pitch is currently incomplete because the example is hidden, not because it's missing.

**Do not pivot to Ritz-only case study.** The case study is the demo; the demo doesn't sell unless it shows outcomes; outcomes don't show unless the loop is fed and surfaced. Same root cause as the SaaS path.

**Do not keep building as-is.** The velocity that produced 51 sprint-report markdowns and 44 domains is the same velocity that hardcoded `"medium"` confidence into the queue and left the 1 working stamp invisible on the homepage. Slow down. Land a 4-page customer surface that actually shows the loop, then accelerate.

**Recommended capability for the next bundle: Balanced (Sonnet)** for the visibility work and the matcher diagnosis (both bounded, both well-specified). **Max (Opus)** if the matcher diagnosis surfaces a real engine bug (state-machine reasoning) or for the RLS architecture in week 2. The original audit said Max for the next 72 hours; the corrected analysis says Sonnet — the work is no longer "turn on a system" (system-design), it's "make a working system legible" (implementation).

**Final word.** The most encouraging signal in this codebase is still the May 4 incident response (raw chunks safety net + canary). The corrected version of the most concerning signal is no longer "the loop is dead" — it's **"the team built something genuinely working but the product surface doesn't let a customer see that it's working."** Different problem, smaller fix, same urgency. Close the gap between what the engine produces and what the customer sees. Everything else follows.

---

## J. What this audit got wrong, and what changed (the correction in detail)

**The bug.** A single regex in my diagnostic grep:

```
grep -c '"live_at":"[^n]' recommended-edits.json    →  0   ❌ wrong
grep -c '"live_at": "[^n]' recommended-edits.json   →  1   ✓ correct
```

The JSON files are formatted with a space after every colon (`"live_at": "..."`). The first grep didn't account for the space. It matched zero rows. From that I concluded "live_at is null on every row" and built the audit around it.

**The blast radius.** That single false negative cascaded into:
- "The learning loop is not running."
- "Live_at never auto-stamps."
- "BEACON_LIFECYCLE_ENABLED is OFF."
- "0 causal-stamped changelog rows."
- The original Top-1 highest-leverage change ("flip the flag and run a manual scan").
- The original 72-hour Hours 0–8 plan.
- The original 30-day Week 1 framing.
- The original Section I final verdict ("you do need to: turn the loop on").

All wrong on the same root cause.

**The actual ground truth (verified by re-grepping with the correct format):**
- `recommended-edits.json` has 28 rows: 20 recommended, 7 dismissed, **1 verified_live with `live_at: "2026-04-28T05:26:26.05+00:00"`**.
- `imported-changes.json` has 334 rows; **3 carry `source_rec_id`**, all to the parent rec `create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)`. **1 of those 3 has `live_at` stamped** — the H2. The other 2 (the FAQ Q+A pair) have `source_rec_id` but no `live_at`.

**Why 2 of 3 changelog rows have no `live_at`.** Per [match-runner/index.ts:246-267](src/domains/recommendations/match-runner/index.ts:246), `persistChangelogLiveAt` is enqueued only when an edit transitions to `verified_live*`. The H2 transitioned (the matcher found it on the live page). The FAQ Q+A pair did not transition (the matcher didn't find them, OR the operator never published them). So the 2 corresponding changelog rows correctly stay un-stamped on `live_at`. **This is not a bug.** The system correctly says "the H2 is live; the FAQs are not (yet)."

**Why `causal_with_outcome: 0` despite the 1 stamp.** The verdict materializer needs a 14–30 day post-`live_at` window to compute a Z-score. The stamp is from 2026-04-28. Today is 2026-05-08. That's 10 days. We are still inside the bake period. The verdict will materialize on its own around 2026-05-12 to 2026-05-18.

**Why the local file matches Supabase despite locally-unset `BEACON_LIFECYCLE_ENABLED`.** Most likely the flag is set in Vercel production cron, the runner ran in production on 2026-04-28, dual-write to Supabase succeeded, and the local file was either dual-written (if the runner ran from the operator's machine that day) or pulled from Supabase via `bootstrap-from-supabase.ts`. Either way, the file's modification date (2026-05-05) is consistent with a refresh from Supabase. **The local file and Supabase are not drifting.**

**The corrected highest-leverage move.** Not "flip the flag." The flag is already flipped. The corrected move is: **make the existing one stamp visible, and find out what's blocking the next ten.** Visibility is a ½-day surface change. The diagnosis is a 1–2 hour read-only walk through the live page HTML and the match engine logs.

**Pattern lesson.** The original audit was fast and confident because the agents trusted reports they couldn't verify against actual data. The reports were correct (the analyzer reads via `seed-data.server` → `getRepository()`, which routes to Supabase when `DATA_SOURCE=supabase`, and Supabase has the truth). My grep was wrong. The agents' "loop is broken" inference followed from my grep, not from the reports. Be more skeptical of shape-of-system claims that hinge on a single diagnostic.

**What the second pass found that the first pass missed.**
- 1 fully-stamped causal example exists on disk and proves the chain works end-to-end.
- The verdict-materializer bake window is the gating factor on visible outcomes, not a flag flip.
- The "rate of new stamps" — not the existence of the loop — is the real bottleneck.
- The 2 stuck FAQ rec_edits are a more interesting diagnostic question than the original audit's "flip and scan" suggestion.

---

*End of audit. Last revision: 2026-05-08 (post-Option-A correction).*
