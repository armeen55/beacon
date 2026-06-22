# Deep Workbench Optimizer — Audit + Build Plan (2026-06-20)

> Source: brutal 11-surface product audit + build ranking + per-page drafts + implementation plan,
> run as an adversarially-verified 18-agent workflow on REAL Iranopedia data (local dev server on
> branch `claude/max-capability` against prod beacon-main, operator mode, tenant-iranopedia — one
> push ahead of deployed prod). Full raw output archived in the session task result for `wjdx80fw9`.
> Operator correction governing all of this: **cannibalization is ONE signal, not the product.**
> The product is a maximum-SEO-movement optimizer.

---

## Decision (ranked by REAL SEO movement, not elegance)

| Rank | Build | Score | Why |
|---|---|---|---|
| **1** | **B. Deep Workbench Optimizer (per-page action matrix + verdict)** | **88** | ~70% already exists as a pure contract (14 AtomicChangeTypes, 11-row diagnosis matrix, dependency_order, full artifact bundle) but is unsurfaced + read-only. Iranopedia's shape is the exact target: strong-rank low-CTR titles, 214/215 no FAQ, 217 schema-missing + 33 invalid, 53/215 thin, zero-click definitional queries. |
| 2 | D. Title/meta/H1/answer-block generator | 80 | The highest-leverage SUBSET of B; deliver inside B, not standalone. |
| 3 | E. Content expansion / H2 generator | 58 | Real but slower; a lever inside B. |
| 4 | G. Wix mapping / push readiness | 52 | No direct movement, but the throughput multiplier — every draft is paste-only until pages are mapped. Should follow B closely. |
| 5 | F. Internal-link generator | 45 | Compounding but slow; a lever inside B (the honest fix cannibalization actually needs). |
| 6 | C. New-page generator | 40 | Lowest near-term movement; the dominant problem is under-optimized EXISTING pages. |
| 7 | H. Proof improvements | 35 | Measures movement, doesn't create it. Sequence after shippable changes. (Position/CTR-delta verdict = task #160.) |
| **8** | **A. Cannibalization vertical slice** | **28** | LAST. Its two biggest Iranopedia rows are DOUBLE-COUNTED CTR leaks (pages at #2.4 / #3.4, sub-0.5% CTR → the money is a title/snippet rewrite at the held rank, not a structural move). Operator-hostile + a trust bug. Becomes ONE chip inside B. |

**Pick: B.** Agrees with the operator prior. The first slice is NARROW: rank the artifacts Beacon already drafts + emit a per-lever matrix + a "do this first" verdict, deterministic-first.

---

## Pre-build fixes (from the adversarial critique — do these or the plan mis-specs)

1. **Deterministic schema-without-pack is not buildable as written.** `composeJsonLd` is private in `artifact-bundle.ts`. Either `export composeJsonLd`, or call the exported `composeChangeArtifact({action:"schema", ...synthetic AtomicChange}, packet, [], [])`. Decide up front; fold the one-line export into slice 1.
2. **Slice-3 test can't use `workbench-page-gating.test.ts`** — it fully mocks `loadWorkbench`, so `matrix` never runs. Use the pure-function tests (slices 1–2) or a dedicated `workbench-data-matrix.test.ts` that mocks `loadPageSurgeonContext` + `assemblePacketForUrl`.
3. **Correct the cannibalization-clamp justification.** The gain is already floor-clamped AND ceiling-bounded (`expectedCtrForPosition` caps ~0.27), so "1,535 clicks off 618 impressions" CANNOT come from that formula — investigate where the 1,535 actually originates (likely a different/larger case's `combinedImpressions` being displayed). The REAL trust bug is `opportunity.ts:131` hardcoding `KIND_PRIORITY` cannibalization FIRST, burying fixable title money. Keep the clamp (cheap/safe) but fix the framing.
4. Minor labeling: H2 have-vs-owed diff is NET-NEW logic (not a `buildDiagnosisMatrix` reuse); import `expectedCtrForPosition` from `opportunity.ts` (the same one `buildOpportunity` uses); "Ship this now" branch must key off `push.method==="wix_cms_field" && canAutoApply && rollbackReady`.

---

## Build slices (deterministic-first; NO paid APIs, NO publish, NO full suite)

**New (pure, no I/O, no LLM):** `src/domains/insight/workbench-matrix.ts` (+test), `src/domains/insight/workbench-priority.ts` (+test).
**Edited:** `src/app/(shell)/workbench/workbench-data.ts` (add `matrix`+`picks`, no new read), `src/app/(shell)/workbench/workbench-view.tsx` (add "Beacon's call" header + lever-matrix section).

- **Slice 1 — `workbench-matrix.ts`** `buildWorkbenchMatrix(packet, pack, cannibalization)` → 10 lever rows (title, meta, h1, answer_block, h2_sections, visible_qa, internal_links, schema, new_page, cannibalization). Each row: `needed`/`whyNeeded` from `detectPageProblems`; `status` from `buildDiagnosisMatrix`; `proposed`+`proposedSource` (`llm_brief` from `pack.bundle` artifact when present; `deterministic` for schema/internal-links; `needs_endpoint` otherwise — NEVER fabricated); `expectedBenefit` from `buildOpportunity`+`deriveSerpGuard`; `risk`; `push` from `classifyArtifactPushability`. Cannibalization row = structural note (`proposed:null`), estimate clamped to `combinedImpressions`.
- **Slice 2 — `workbench-priority.ts`** `decideVerdict(row)` → the 6 chips (Ship this now / Hold this / Needs SERP check / Needs Wix mapping / Manual only / Do not touch), fixed precedence. `prioritizeWorkbench(rows,...)` → five picks (bestSingle / bestBigger / safest / fastestMeasurable / highestUpside). Cannibalization NEVER `bestSingle`; `bestBigger` only if its clamped estimate truly leads.
- **Slice 3 — wire into `workbench-data.ts`** call both pure fns with the packet/pack already assembled; no new read.
- **Slice 4 — `workbench-view.tsx`** "Beacon's call" header (lead move + chips) + the lever-matrix centerpiece. `needs_endpoint` rows render the existing honest line ("Drafting needs the analysis endpoint, which isn't configured yet. No spend happens here."), never blank. No publish controls. NO em/en dashes in new copy.
- **Slice 5 (deferred, LLM-gated)** when `OPENAI_API_KEY` present (gpt-5-mini, `reasoning_effort:low`, ≥90s, loud fallback), proposed cells for title/meta/H1/answer-block/FAQ/new-page fill from the brief — NO view change (matrix already reads `pack.bundle`).

**First three commits:**
```
feat(workbench): per-lever SEO action matrix projector (deterministic-first)
feat(workbench): action-priority verdict chips + five named picks
feat(workbench): wire matrix + picks into loadWorkbench (no new I/O)
```
**Targeted test:** `npx vitest run src/domains/insight/workbench-matrix.test.ts src/domains/insight/workbench-priority.test.ts "src/app/(shell)/workbench/workbench-page-gating.test.ts"`
**Screenshots (after slice 4):** a CTR-leak title page; best-persian-restaurants (was "drafting disabled"); a cannibalization page (confirm it's one row, not the lead); a healthy page (all "Do not touch").
**Capability tier:** Balanced.

---

## Per-page drafts (real GSC + crawl data; verified zero invented numbers; all titles ≤60, metas ≤155, no dashes)

| Page | Real shape | Biggest move | Exact title (proposed) | Verdict / push |
|---|---|---|---|---|
| **/funny-farsi-phrases** | 29,967 impr / 807 clk / 2.69% / pos 6.4. Owns "insults" (pos 1.8) but title omits "swear words" where it ranks pos 7–13 with authority. | **Title + H1 term-coverage** to win the swear/curse cluster; answer block for zero-click definitional queries. | `Persian Swear Words, Insults & Funny Farsi Phrases` (50) | Title/meta/H1 **Ship now** (Wix). Answer block/FAQ/schema **Hold — fact-check glosses** (prior pack wrongly said "son of a dog"; literal is "dog's father"). |
| **/farsi-numbers** | 17,136 impr / 64 clk / 0.37% / strong ranks. Dominant query "persian numbers 0-9 names and symbols" = 3,776 impr / **0 clicks** / pos 6. | **Snippet rewrite** (title/meta/H1 lead the 0-9 phrasing) + 0-9 answer block. ~621 clicks at stake (high conf). | `Persian Numbers 0-9: Names, Symbols and 1-10` (44) | Title/meta/H1 **Ship now**. Answer block / Q&A **Hold — fact-check transliterations/glyphs**. Do NOT ship the pack's bad `/persian-last-names` links. |
| **/best-persian-restaurants** | pos 18.7 (page 2), 754 impr / 1 clk, 399 words, zero sections/schema. Striking-distance: restaurants persian 8,100/mo, near-me 4,400/mo. | **Depth: 5–6 H2 sections + expand to ~900–1,300 words** (rank is gated by depth, not title). Metadata bundle ships alongside as the fast baseline. | `Best Persian Restaurants Near You (2026) by State & City` (56) | Metadata **Ship now (bundle)**. Sections/expand **Hold — draft + geo fact-check**. Schema: BreadcrumbList **Ship now**, FAQ/ItemList **Hold**. |
| **/persian-female-first-names** | 35,617 impr / 1,237 clk / 3.47% / pos 7.3. Already asks 3 questions on-page but `faqs:[]` + `schema:[]`. | **Answer its own 3 questions (40–60w extractable) + ItemList/FAQPage/Breadcrumb schema.** Not a CTR rewrite. | `Persian Girl Names: 190+ Names With Meanings` (44) — Needs SERP check | Schema (ItemList/Breadcrumb) safest add. Answers/depth **Manual — fact-check meanings**. Cannibalization = a de-optimize note on `/persian-male-names`, NOT this page. |
| **/cities** | 16,173 impr / 66 clk / 0.41% / pos 9.1. "iran list of cities" 490 impr / **0 clicks**. Already HAS a FAQ H2 (8 Q&A) but `schema:[]`. | **Top answer block + FAQPage/ItemList schema** on the Q&A it already has; sharper meta. **Hold the title** (already strong, rank fragile). | `Cities in Iran: List of 15 Largest by Population (2026)` (55) — **Hold** | Schema + meta **one-click Wix**. Answer block **Manual**. Title **Hold**. Ship order: schema+meta → answer block → measure 7–14d. |

---

## Audit: cross-surface trust bugs to fix (the app must look like a pro, not leak artifacts)

**Highest-trust (visible, undercut everything):**
- **/ + /opportunities:** cannibalization "~1,535 est. clicks" off a 618-impression / 1-click cluster (`opportunity.ts` KIND_PRIORITY puts cannibalization first, burying real title money on achaemenid #2.4 and iran-flag-history #3.4). Demote KIND_PRIORITY; clamp the estimate.
- **/workbench/cities:** a `site:www.iranopedia.com` operator query is treated as cannibalization → "Choose / as the lead page ... (best current rank )" with an EMPTY lead + empty rank. Fix the RPC (`migrations/2026-06-20_gsc_cannibalization_rpc.sql`: exclude `query ilike 'site:%'`) and print the real rank number (`workbench-view.tsx:240`).
- **/changes:** renders "No changes yet" directly above a real measuring /cities change (two data sources disagree on one screen).
- **/recommendations:** each Ready card shows 3 disagreeing "what to do" answers (Page Surgeon headline vs Type chip vs "Legacy task" line); schema card headline is flatly wrong.

**Pluralization / copy bugs (one-line each):** "comparable untreated page s" (×3: proof page.tsx:174/320, proof-ledger-strip.tsx:81), "0 sampled day s" (visibility-score-chart.tsx:362), "1 days ago" (connection-health.ts:78), "striking-distance keyword(s)" (opportunity.ts:196), "1 clicks"/"0 click s" (workbench-view.tsx:147/193), "1 page-1 page(s)" (state-of-union.ts:117), home page titled bare "home" (opportunity.ts:117).

**Em/en-dash hard-rule violations (user-visible):** `/` (12), `/settings/connectors` (25+), `/connections` (1), `/workbench/farsi-numbers` (2), plus `evidence-summary.ts:172/189/195/271/341` + `bridge.ts:188` fallback "—". (The 5 previously-cleaned routes — /proof, /changes, /workbench/cities, /opportunities — are still clean.)

**Honesty / data-path:** "367%" friction (>100% is meaningless — relabel as friction-per-visit); two different friction scales on / for the same site; /connections + /settings/connectors count Wix as "connected" while it shows "no successful sync yet"; "Search data Jun 15 – Jun 15" reads as broken (single-day range); "reading all six sources" / "Refresh my data" hero promises a button that isn't on that page; "AI visibility responded" copy on GSC-only numbers.

**The structural theme (app-brain not chat-brain):** every core surface DEAD-ENDS. /, /opportunities, /workbench, /recommendations, /proof all describe + diagnose but offer no inline Accept / draft / push / mark-shipped. The Deep Workbench Optimizer (build B) is the fix: rank the levers, attach the draft, make the lead move shippable from the page.
