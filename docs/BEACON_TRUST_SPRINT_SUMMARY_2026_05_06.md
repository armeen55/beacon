# Beacon Trust Sprint — Final Synthesis (A–I) + Top-5 Fixes Proposal

**Date:** 2026-05-06
**Scope:** every score, every recommendation type, every attribution claim, the data underneath
**Method:** 7 read-only audit agents (4 phases, file:line + row-level evidence)
**Status:** SYNTHESIS — STOP before implementation, awaiting operator approval on the fix bundle

> Operator brief: "I do not fully trust scores, visibility math, recommendations, tracking, attribution, analysis, the brain, whether Beacon is proving real things or just presenting confident-looking outputs. Today's goal is trust. Be brutal. No hype. No 'probably.' Every claim must point to code, rows, tests, or a concrete audit sample."

Source audits:
- `docs/BEACON_SCORE_PROVENANCE_AUDIT_2026_05_06.md` (Phase 1.A + 1.B)
- `docs/BEACON_RECOMMENDATION_BRAIN_AUDIT_2026_05_06.md` (Phase 2.A + 2.B)
- `docs/BEACON_ATTRIBUTION_TRUST_AUDIT_2026_05_06.md` (Phase 3.A + 3.B)
- `docs/BEACON_DATA_INTEGRITY_AUDIT_2026_05_06.md` (Phase 4)

---

## A. What Beacon's brain currently gets right

1. **Native polling captures real signal.** `prompt_answer_observations` is the single source of truth for /today; scores derive from it via tenant-scoped reads. The denominator/numerator for the composite chart on native-only days is sound.
2. **Prompt categorization (early / winning) is honest.** `opportunity-classify.ts` has an explicit `≥3 obs` floor and clamps the lookback window forward to `NATIVE_REGIME_START` (`opportunity-classify.ts:139-150`). It will not call something "winning" on thin data.
3. **The Z-score core is well-defended against low-count noise.** `POISSON_SIGMA_FLOOR = 1.0` (`url-verdict.ts:84`) prevents `sigma=0 → z=Infinity`. `deltaPctMinBaseline = 1.0` refuses "+1100%" headlines on tiny baselines. The empirical backtest correctly suppressed 4 of 5 placebos (4/5 = 80% true-negative rate).
4. **The mixed-source guard is honest.** `not_enough_native_baseline` abstain is a genuine refusal to compare across measurement systems with no calibration ratio (`url-verdict.ts:296-381`). Trust the abstains.
5. **The sampling-status guard (M3+S4+D4) closes the worst proof-day loophole.** A 5-prompt manual recovery on May 4 won't ship a `helping` verdict; it will demote to `nothing_yet`.
6. **The validator suite for recommendations is real.** Placeholder copy, raw UUIDs, competitor-name leak, brand-claim grounding, em-dashes, FAQ shape, leading superlatives — all validated. Phase 4 confirmed **0 placeholder rows** in 20 sampled production rec rows.
7. **Recommendation packet construction is clear-source per evidence type.** Each field cites where it came from; the entity-pollution-filter is applied to leaderboard + competitor angles + AI search signal.
8. **Sample-20 production rec quality is ~85% SHIP_NOW or minor-edit.** Read top-down by a thoughtful customer, the rec content is mostly defensible.
9. **The recorder is idempotent.** `recordUrlOutcome` preserves `recorded_at` while bumping `transitions` so audit trail survives verdict flips (`url-change-outcome.ts:347-430`).
10. **No LLM-generated placeholder copy in production.** Phase 4 Check 7 confirms zero `Draft answer` / `TBD` / `[insert` / `rewrite below` / `(operator: rewrite)` rows shipped today.

## B. What it gets wrong

1. **Empty-tenant rows.** 28,285 `daily_metric_snapshots` + 14,096 `prompt_answer_observations` rows have `tenant_id=''`. RLS deny-all may not catch empty string (only NULL).
2. **Duplicate observations not de-duped.** 117+ duplicate `(prompt_id, platform, day)` keys on 2026-04-23 from re-run chunks inserted as new rows.
3. **Partial chunks contaminating snapshots.** 2026-04-23 (`total_possible=117`), 2026-04-26 (`66`), 2026-05-06 (`99`) — day-over-day visibility deltas are apples-to-oranges.
4. **Mentions/Citations tile silently falls back to ALL-TIME Profound `results` totals** when the `daily_metric_snapshots` query returns no row. Operator can be looking at "today" or "5 years of Profound" depending on a Supabase hiccup.
5. **Brand vs competitor formula asymmetry on the leaderboard.** Brand uses `composite(mentionRate, citationRate)` with position-weight on citations; competitors get flat `count/total*100`. The "X% share-of-voice" number is not strictly comparable across rows.
6. **Share Capture banner is a coincidence detector marketed as causal.** Math: brand `delta > 0.5pp` AND ≥1 top-5 competitor `delta < −0.5pp`. Does NOT verify mention redistribution. Two unrelated platforms moving oppositely trip it.
7. **ChatGPT/Perplexity primary % headline shows the LATEST day rate, not the window average.** A single-prompt proof day reads "Primary 100%" or "0%". High variance on small samples.
8. **The Z-score engine is undefended against trend, prompt-mix, concurrent-change, and site-wide platform shifts.** Empirical backtest produced 1/5 false positives (placebo-2: sparse pre-window + sigma_floor=1.0 → z=+2.17 on 2 partial pre-days).
9. **`change.live_at` is populated for 1 of 334 changelog rows.** All attribution falls back to commit `timestamp` — a much weaker proxy.
10. **Recommendation queue order discards the prioritizer score.** `prioritize.ts:124-132` computes a 6-factor score; the customer-facing table re-sorts by `(STATUS_BUCKET → priorityForRow → observationCount)` and ignores it. The "rec.tier === 'now'" semantic is invisible to the operator.
11. **Confidence is the literal string `"medium"` on all 31 production rec rows.** HIGH and LOW signals don't ship today. The rubric exists but is unused.
12. **`competitorPageBlueprints.h1/topH2s/faqQuestions/metaDescription` are hardcoded null** (`specific-edit-evidence.ts:1214-1219`). SYSTEM_PROMPT Rule 15 tells the model to "LEARN the STRUCTURE / ANGLE these pages take" — the model literally cannot.
13. **Rule 16.A abstention is enforced ONLY in the LLM SYSTEM_PROMPT** (`openai.ts:399-506`). No validator gate rejects a non-empty bundle on a low-confidence packet. If the model ignores the rule, the bundle ships.
14. **Lookback window inconsistency on the same /today page.** Classifier = 7d clamped to native regime; leaderboard default = 14d, no native clamp. Surfaces disagree on what "recent" means.
15. **Entity-pollution-filter applied to leaderboard but NOT to the prompt classifier.** A directory miscategorized as `competitor` would falsely trip Outranked; would NOT pollute leaderboard.
16. **`MEASUREMENT_QUALITY_BOUNDARY` is referenced in plans but does not exist in code.** Only `NATIVE_REGIME_START = "2026-04-22"` exists.

## C. Which numbers are trustworthy (SHOW WITH CONFIDENCE)

| Number | Verdict | Why |
|---|---|---|
| Prompt category count: **early** | TRUSTWORTHY | `<3 obs` floor. Honest. |
| Prompt category count: **winning** | TRUSTWORTHY | `≥3 obs` per platform AND `primary_rate ≥ 0.5`. Honest. |
| Z-score abstain: `nothing_yet` / `too_early` / `not_enough_data` / `not_enough_native_baseline` | TRUSTWORTHY | Empirical backtest: 4/5 placebos correctly suppressed; the sampling guard demotes correctly. |
| Recommendation source label (`deterministic` vs `openai` vs `operator_edited`) | TRUSTWORTHY | Validator enforces source coherence. |
| Lifecycle classification (live_verified, pending_implementation, needs_review, imported_historical, scan_confirmed) | TRUSTWORTHY | Pure functions, well-tested. |
| `aiSearchSignal.topSearchQueries` (when present, OpenAI-native rows) | TRUSTWORTHY | Verbatim AI emissions; canonical filtering. Honest blind spot for Perplexity / AIO. |
| `aiSearchSignal.topDescriptors` | TRUSTWORTHY | Schema v2.1 deterministic windows. |
| `brandAssertions[]`-grounded brand-claim copy | TRUSTWORTHY | Operator-curated source of truth; validator-enforced. |

## D. Which numbers are directional only (SHOW WITH GUARDRAIL COPY)

| Number | Verdict | Reason |
|---|---|---|
| Composite visibility (chart headline) | DIRECTIONAL | No sampling-status gate; case-mismatch hazard; mixes native + historical_recovered. |
| Mentions / Citations tile | DIRECTIONAL | Silent fallback to all-time Profound `results`. |
| ChatGPT primary % | DIRECTIONAL | Shows latest day, not window. |
| Perplexity primary % | DIRECTIONAL | Same; lower volume. |
| Competitor leaderboard share-of-voice | DIRECTIONAL | Brand vs competitor formula asymmetry; Profound dilution. |
| Prompt category counts: **outranked / close / absent** | DIRECTIONAL | No pollution filter on classifier; case-sensitive co-mentions. |
| Recommendation `priorityForRow` rank | DIRECTIONAL | Single-prompt evidence floors at HIGH on severity+observationCount alone. |
| Z-score `helping` verdict on a recently-changed URL during prompt-set rollout | DIRECTIONAL | Engine cannot detect the prompt-mix multiplier. |

## E. Which recommendations are customer-safe (SHIP AS-IS)

From the Phase 2.B sample-20 (~85% SHIP_NOW or minor-edit):

| Type | Customer-safe when… |
|---|---|
| `add_faq` (question) | Targets a real owned page (`evidence.owned_page` present), question is verbatim user-language from the prompt. |
| `add_h2_section` (geo cluster page, owned page present) | At least 2 affected prompts cited as evidence, owned_page in evidence, no competitor name in `proposed_text`, body avoids "architect-led design-build" boilerplate already on a sibling page. |
| Operator-edited rec (`source='operator_edited'`) | Brand-claim grounder caught and respected — these are exemplars (rows #12-14 in the Phase 2.B sample). |
| `add_faq` (answer) for service-in-city scope | When evidence includes both `owned_page` and ≥1 specific descriptor; not generic Bay-Area dressed as city-specific. |

## F. Which recommendation types should be disabled or downgraded

| Type | Status | Why |
|---|---|---|
| Deterministic `add_h2_section` Branch-1 ("Why teams choose us over {Competitor}") | DOWNGRADE — never ship as-is | Structurally violates SYSTEM_PROMPT Rule 12. Validator's `validateCompetitorPublicCopy` SHOULD reject; queue thins silently and operator never knows. |
| Deterministic `add_faq` (combined Q+A in one row) | DOWNGRADE — verify or delete | Violates W3 §3.8 pairing contract. UNVERIFIED whether `checkFaqPairing` is scoped LLM-only. Either dead code or live regression. |
| `add_faq` (answer) on single-prompt evidence with no `owned_page` and no `competitor` (sample row #5 Atherton) | HOLD FOR REVIEW — display LOW pill | Today displays as `medium`. Should display as LOW with an "evidence too thin" reason. |
| `add_faq` (answer) with self-promotional voice ("Ritz Builders recommends hiring…") (sample row #1 Modern Bay Area) | HOLD FOR REVIEW — display LOW pill | Voice violates customer-FAQ contract. Engine should detect first-person brand voice in answer position and downgrade. |
| Any rec carrying `competitorPageBlueprints` evidence promising structure analysis | DOWNGRADE the SYSTEM_PROMPT or POPULATE the structure | `h1/topH2s/faqQuestions/metaDescription` are hardcoded null. Either feed the model the blueprint structure or stop telling it to use it. |
| `crossTenantPatterns` evidence | UNRELIABLE (already declared stub) | Will mislead if displayed; today gated by `sampleSize >= 5` rule which is impossible to satisfy. |
| `priorOutcomes` evidence | UNRELIABLE (stub) | Producer doesn't exist. |

## G. Which attribution claims are unsafe

| Claim | Safety | Why |
|---|---|---|
| `helping` on a URL whose changelog has `live_at = NULL` (333 of 334 rows today) | UNSAFE — anchored on weak proxy | Engine uses commit `timestamp`. Operator's actual deploy day is unknown. |
| `helping` on a URL where the post-window includes the dates 2026-04-23 / 2026-04-26 / 2026-05-06 | UNSAFE — partial-chunk contamination | Snapshot denominators are 66/99/117 vs 100/200. Comparison is apples-to-oranges. |
| `helping` on a URL whose pre-window has `< 5 days_with_full_polls` | UNSAFE — placebo-2 false-positive class | Empirical backtest: sparse partial pre-days + sigma_floor=1.0 inflates z. |
| `helping` on a URL where prompts were added/removed during the post-window | UNSAFE — confounded by prompt-mix multiplier | No detection in code. |
| `helping` on a URL with two changelog rows within the 14-day baseline window | UNSAFE — concurrent-change contamination | No deconfounding pass. |
| `helping` ON ANY URL in a window where Beacon's daily-poll volume changed materially | UNSAFE — no site-wide control series | Per-URL math cannot subtract a platform-level shift. |
| Z-score `helping` with `z ∈ (1.2, 1.8)` | FALSE NEGATIVE class | Real-3 menlo-park (mu doubled, post sustained) is currently called `nothing_yet`. |

**Net guidance: every `helping` verdict on /changes today should carry a "this is a leading indicator, not a proof" disclaimer until the prompt-mix + concurrent-change + sampling preconditions are gated.**

## H. Top 5 trust fixes to implement (proposal — STOP before implementation)

Each fix is bounded and ships behind operator-mode or a feature flag. None require new tables, RLS changes, paid polling, or queue mutation. Each cites the file:line(s) it touches.

### Fix 1 — `tenant_id` backfill + non-empty CHECK constraints (Phase 4 #1) — **HIGH leverage**

**What:** Decide the fate of 28,285 `daily_metric_snapshots` + 14,096 `prompt_answer_observations` rows with `tenant_id=''`. Either:
- (a) Backfill `tenant_id='tenant-ritz-founder'` (likely correct — they're pre-cutover Profound data) via a single `UPDATE` migration, OR
- (b) Hard delete (only if confirmed stale) — operator decision.

Then add `CHECK (tenant_id <> '' AND tenant_id IS NOT NULL)` to both tables (Supabase migration). Audit the new RLS deny-all policy to confirm it rejects empty strings, not just NULL.

Also: delete the 2 stray test-tenant rows in `recommended_edits` (`test-c1c-1777584795434-a/b`).

**Touches:** Supabase migration files only (no code changes). Re-run `supabase mcp` advisors post-migration.

**Why first:** RLS without empty-string protection means a future cross-tenant dashboard could leak. This is the single largest active footgun.

### Fix 2 — De-dup observations + re-snapshot 3 contaminated dates (Phase 4 #2-3) — **HIGH leverage**

**What:** Two-step migration:
1. De-dup `prompt_answer_observations` by `(tenant_id, prompt_id, platform, observed_at::date)` keeping latest `run_id`. Drop ~117 stale rows on 2026-04-23 alone (Phase 4 Check 1).
2. Add unique index `(tenant_id, prompt_id, platform, observed_at::date)` to prevent recurrence.
3. Re-snapshot 2026-04-23, 2026-04-26, 2026-05-06 by re-running `buildFromObservations()` against the de-duped table. Update `daily_metric_snapshots` rows in place.
4. Surface `total_possible` in operator UI on the visibility chart sample-size tooltip — partial days become visible.

**Touches:** `scripts/dedupe-observations-2026-04-23.ts` (new, idempotent, dry-runnable), `src/components/today/visibility-score-chart.tsx` (tooltip).

**Why second:** every visibility number on /today depends on this table being clean.

### Fix 3 — "Why this score" + "Why this verdict" disclosure drawers (the trust dashboard) — **MEDIUM leverage, HIGH user-trust**

**What:** Two new components, gated behind `NEXT_PUBLIC_OPERATOR_MODE=true` initially, customer-safe later:

(a) **`<ScoreProvenanceDrawer>`** on the visibility chart and on each KPI tile (Mentions, Citations, ChatGPT primary %, Perplexity primary %). Renders a self-describing block:
```
This number = {numerator-name} / {denominator-name} (window: {window-label}, sampling: {samplingStatus}, source: {dataSource})
{Sample-size warning when applicable}
{Confidence: trustworthy | directional | unreliable}
```

(b) **`<VerdictProvenanceDrawer>`** on each /changes lifecycle row. Renders the underlying math:
```
mu_pre = {x} (over {N_pre} days, {N_pre_full} full / {N_pre_partial} partial)
mu_post = {y} (over {N_post} days, {N_post_full} full / {N_post_partial} partial)
sigma_pre = {raw → floored}
z = {value}, sustainUp = {n}/{7}, sustainDown = {n}/{7}
Anchor: {live_at OR timestamp} ({source})
Disclaimers: {prompt-mix changed in window? site-wide shift? concurrent change?}
```

Both drawers consume data already in the rec / verdict response — no new computation, just transparent presentation.

**Touches:** new files `src/components/trust/score-provenance-drawer.tsx`, `src/components/trust/verdict-provenance-drawer.tsx`; trigger buttons added to `today-client.tsx`, `visibility-leaderboard.tsx`, `scorecard-client.tsx`.

**Why third:** the operator (and eventually the customer) cannot trust a number they cannot drill into. This is the operator-mode-first version of the eventual "internal trust report" route.

### Fix 4 — Validator-side enforcement of Rule 16.A + ranking layer reconciliation (engine-side) — **HIGH leverage**

**What:** Three coordinated edits inside `src/domains/recommendations/`:

(a) **Add `validateAbstentionContract()` to `specific-edit-validator.ts`.** Rejects any edit whose packet matches Rule 16.A's hard-abstain conditions (`packet.resolution?.confidence === 'low' && packet.brandAssertions.length === 0`, OR `packet.competitorPageBlueprints.length === 0 && packet.aiSearchSignal.topSearchQueries.length === 0 && packet.brandAssertions.length === 0`). Closes the SYSTEM_PROMPT-only loophole.

(b) **Thread `prioritize.ts`'s `_score` into the customer-facing table sort** in `recommendation-action-rows.ts:1568-1576`. Replace `(STATUS_BUCKET → PRIORITY_RANK → observationCount)` with `(STATUS_BUCKET → prioritizerTier → priorityForRow → observationCount)`. The "rec.tier === 'now'" semantic becomes visible.

(c) **Add `confidence_score: number` to the rec row** (a numeric blend of `affectedPromptCount × evidenceDepth × resolverTier`). Display as "evidence depth: 4/10" in the row meta. Drives ordering ahead of file-creation order, which today is the de-facto rank.

**Touches:** `specific-edit-validator.ts` (new validator), `recommendation-action-rows.ts` (sort + display), `confidence.ts` (numeric score).

**Why fourth:** the brain has the right rubric internally; the customer sees none of it. Sample-20 found 13 SHIP_NOW recs but the queue is ordered such that NEEDS_MAJOR_EDIT row #1 lands at the top.

### Fix 5 — Z-score preconditions: `pre_days_with_full_polls >= 5` + new `weak_signal` tier — **MEDIUM leverage, HIGH math correctness**

**What:** Two precise edits to `url-verdict.ts`:

(a) **Hard precondition.** Before any non-`nothing_yet`/non-abstain verdict, require `baselineFullPollDays >= 5`. If not satisfied, abstain with `not_enough_full_pre_days`. Closes the placebo-2 false-positive class (sparse partial pre-days + sigma_floor inflating z).

(b) **New `weak_signal` tier.** Between `too_early` and `helping`: if `z ∈ (1.2, 1.8)` AND `sustainUp >= 5` AND `baselineFullPollDays >= 5`, return `weak_signal` with copy "early lift, watch for 7 more days." Catches the real-3 menlo-park false-negative class.

(c) **Update `lifecycle-attribution-copy.ts`** to map `weak_signal` to a customer-safe phrase: "early signs of lift" (not "this change worked"). Lifecycle pill gets a yellow color.

**Touches:** `src/domains/attribution/url-verdict.ts` (precondition + tier), `src/domains/attribution/lifecycle-attribution-copy.ts` (copy map), `src/components/display/lifecycle-status-pill.tsx` (color).

**Why fifth:** the empirical backtest gave us the exact false-positive cause (sparse pre-window) and the exact false-negative cause (z just under cutoff). Both are bounded fixes.

### Fixes deferred (intentionally)

| Idea | Why deferred |
|---|---|
| Trend / slope correction in pre-window | Architectural; needs careful baseline modeling. Pre/post-mean comparison + `sustainUp` already mitigates the worst case. |
| Concurrent-change deconfounding | Architectural; needs change-graph queries. Add only when a real customer's change cadence demands it. |
| Site-wide control series | Architectural; needs a domain-level baseline series. Defer until ≥3 customers (otherwise the "control" is too noisy). |
| Prompt-mix multiplier detection | Architectural; needs `tracked_prompts` change history table. Add when prompt churn becomes operator-felt (not yet). |
| Brand-vs-competitor formula symmetry on leaderboard | Wedge-touching: changing the brand formula away from composite+position-weight may change the headline number. Operator decision required. |
| Rebuild `competitorPageBlueprints` structure (h1/topH2s/faqQuestions/metaDescription) | High value but needs scan-side extraction work. Strip the SYSTEM_PROMPT promise first (Fix 4-extension), populate later. |
| Replace Mentions/Citations fallback to all-time `results` with hard-fail empty state | Minor edit but operator may want to keep the soft fallback for bootstrapping new tenants. Operator decision. |

## I. Is Beacon safe to demo honestly?

**Yes, with three guardrails. No, without them.**

### What's demo-safe today (with current copy)

- The `/today` chart with the 14d default window, lookback ≥ 2026-04-22.
- The lifecycle strip — counts on `live_verified`, `pending_implementation`, `needs_review` are accurate.
- The /changes "Live verified" tab default — 1 row, accurate.
- The /recommendations queue contents (each individual rec is 85% SHIP_NOW or minor-edit per Phase 2.B).
- The /prompts list with category labels.
- All abstains everywhere — `not_enough_native_baseline`, `nothing_yet`, `too_early`, `not_enough_data`. **Trust the abstains.**

### What's demo-unsafe without guardrails

1. **The "Share Capture" banner** — disable until the formula symmetry on the leaderboard is fixed OR re-label as "co-incidence: you went up while X went down" (not "you captured share"). Currently UNRELIABLE.
2. **Any `helping` verdict on /changes** — add a "leading indicator, not proof" disclaimer until Fix 5 lands. Empirical false-positive rate 1/5 on placebos.
3. **Mentions/Citations tile during a Supabase hiccup** — the silent fallback to all-time `results` could show a number 100× larger than reality. Either keep dev-tools open during the demo or land the hard-fail empty state first.

### What MUST be true before the next investor / customer demo

- Empty-tenant rows fixed (Fix 1).
- Duplicate observations de-duped (Fix 2).
- "Why this score" / "Why this verdict" drawers behind operator mode at minimum (Fix 3) — so that when someone asks "is this real?", you can show them the math.

**With Fixes 1–3 landed (the three HIGH-leverage data + transparency fixes), Beacon is honestly demonstrable. Fixes 4–5 are the engine-side polish that take it from "honestly demonstrable" to "engine demonstrably better than what was before."**

---

## Awaiting operator approval

Per operator brief: **STOP before implementation. The audit identifies the top fixes; you decide which ship tonight.**

Recommended sequencing (for when approved):

1. **Fix 1 first** — Supabase migration only, no code. Bounded, reversible (backups), highest data-trust unlock.
2. **Fix 2 next** — observation de-dup + re-snapshot. Touches `daily_metric_snapshots`; backup pre-migration.
3. **Fix 3 in parallel with 1+2** — pure UI work, no migrations. Behind `NEXT_PUBLIC_OPERATOR_MODE=true` initially.
4. **Fix 4 after 1-3** — engine-side validator + sort. Bounded code edits.
5. **Fix 5 last** — Z-score preconditions + new tier. Requires test coverage on `url-verdict.test.ts` golden + a new `lifecycle-status-pill.tsx` color path.

**Recommended capability for the implementation phase: Max** — Fix 1 (multi-table migration) and Fix 5 (verdict-engine semantics) are both Opus-tier; Fix 3 is Sonnet-tier; Fix 2 + Fix 4 are Sonnet-tier with Opus review.

**End of synthesis. STOP.**
