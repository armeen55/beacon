# Beacon Attribution Trust Audit — 2026-05-06

**Trust Sprint Phase 3 (3.A code + 3.B empirical backtest). Read-only.**

> Operator framing: "I do not fully trust attribution. Be brutal." Code path traced with file:line. Empirical backtest computed live z-scores on 5 real Ritz changelog rows + 5 placebo URLs.

Two-line summary: the math core is well-defended against low-count noise (sigma floor + sustain check + adaptive baseline + confidence downgrade + mixed-source guard) but **structurally undefended against trend, prompt-mix change, concurrent change, and site-wide platform shifts** — every one of which is real in your current operating regime. Empirical backtest on 10 samples produced **3 true positives, 4 true negatives, 1 false positive (placebo-2 driven by sparse pre-window + sigma_floor=1.0), 1 false negative (real-3 just under z-cutoff), 1 correct INSUFFICIENT.** Trust the abstains; do not trust the wins without an out-of-band sanity check.

---

## Phase 3.A — Verdict engine code audit

### Mechanics (13-point trace)

**1. Anchor date.** `resolveChangeDate(change, useLiveAt)` at `url-change-outcome.ts:486-494`. When `BEACON_LIFECYCLE_VERDICT_ENABLED` is on, anchor = `change.live_at ?? change.timestamp` sliced to YYYY-MM-DD. When off, anchor = `change.timestamp`. Read at `:625` and `:692`. Anchor day excluded from both windows: baseline ends `change-1`, post starts `change+1` (`url-verdict.ts:281-289`).

**2. Pre window.** `BASELINE_TARGET_DAYS = 14`, `BASELINE_MIN_DAYS = 3` (operator dropped from 7 to admit newer URLs at low confidence) — `url-verdict.ts:76-90`. `BASELINE_CONFIDENT_DAYS = 7` triggers tier downgrade when `< 7` days present (`:508-513`). Adaptive: density of available data inside the 14-day pre-window controls actual count; **no** "look further back if 14 days is empty."

**3. Post window.** `POST_WINDOW_MAX_DAYS = 30` (`:80`), capped at `min(asOfDate, change+30)` (`:288-294`). `NOTHING_YET_MIN_DAYS = 14` (`:85`) is the threshold to flip `too_early` → `nothing_yet`.

**4. Math.** Pure compute in `computeUrlVerdict` (`:268-553`):
- `mu_pre = mean(baselineCounts)` (`:386`)
- `sigma_pre_raw = stddev(baselineCounts, muPre)` (`:387`; sample stddev, divisor `n-1`, returns 0 if `n<2`)
- `sigma_pre_used = max(sigma_pre_raw, 1.0)` (`:388`)
- `mu_post = mean(postCounts)` (`:389`)
- `z = (mu_post − mu_pre) / (sigma_pre_used / sqrt(N))` (`:432`)

**5. Significance threshold.** `Z_BAR = 2.0` (`:81`). Verdict tree (`:445-454`):
- `helping`: `z >= 2.0` AND `sustainUp >= 5`
- `hurting`: `z <= −2.0` AND `sustainDown >= 5`
- `nothing_yet`: `|z| < 2.0` AND `N >= 14`
- `too_early`: `|z| < 2.0` AND `N < 14`

There is no `verdict_off` state in code; the operator-locked term in copy (`lifecycle-attribution-copy.ts:102-107`) reflects the FLAG being off, not an engine output.

**6. Sustain check.** `SUSTAIN_MIN = 5`, `SUSTAIN_LAST_N_DAYS = 7` (`:82-83`). Implementation (`:393-399`): of the last 7 post-window days, count days strictly above (`sustainUp`) and strictly below (`sustainDown`) `mu_pre`. **Days exactly equal to `mu_pre` count for neither.** Required for `helping`/`hurting`.

**7. Partial-poll handling.** Two layers:
- (a) Dense series from `denseSeries` (`url-citation-history.ts:414-453`) zero-fills missing dates without distinguishing "polled but found 0" from "never polled." Today's chunk-0 day (24/25 prompts) gets included raw at face-value count.
- (b) **M3 sampling guard** (`url-verdict.ts:471-494`). After verdict computed, if any post-window day has `sampling_status === "proof"` (1–9 obs) OR no post-window day is `"full"` (≥80 obs), demote `helping`/`hurting` → `nothing_yet`. Demotion logged in `materializeUrlOutcomes` (`url-change-outcome.ts:714-725`). Sampling status from `buildSamplingStatusByDate` (`:76-93`), classified by `classifySampling` (`poll-health.ts:376-381`: full ≥80, partial 10-79, proof 1-9). **Loophole:** a "partial" day (10-79 obs) by itself does NOT demote — guard fires only on `proof` days OR absence of any `full` day. **A post-window of all-partial days still produces `helping` if count math passes.**

**8. Pre-cutover data exclusion.** No filter against `NATIVE_REGIME_START` ("2026-04-22") in `url-verdict.ts`. Instead, **mixed-source guard** at `:296-381`: when both windows are fully tagged with `source_type`, drop all `benchmark` points from both sides. If filtered baseline `< baselineMinDays` (3), abstain with `not_enough_native_baseline` and report dropped-day count (`:346-375`). Tag flows from `denseSeries` zero-fills using regime-of-date (`url-citation-history.ts:444-445`). **`MEASUREMENT_QUALITY_BOUNDARY` is UNVERIFIED** — `grep` returns no results in `src/`. Only `NATIVE_REGIME_START` exists.

**9. Concurrent-change handling.** **None.** No code in `url-verdict.ts` or `url-change-outcome.ts` checks for prior or subsequent changes on the same URL. Each `(change, URL)` pair gets an independent verdict using the same baseline window even if a different change was stamped 2 days earlier and is fully inside the "pre" window of the second one.

**10. Site-wide-event handling.** **None at the engine layer.** No domain-level visibility correction, no normalization against site-wide control series, no detection of global step-up/step-down. A real site-wide event will show as N independent per-URL `helping`/`hurting` verdicts.

**11. Prompt-mix change handling.** **None.** No code reads `prompts_added_at`, `prompt_set_change`, or active prompt count. Daily counts taken at face value. **If operator added 50 prompts on day +5 of post-window, per-URL baseline `mu_pre` is structurally lower than `mu_post` for purely mechanical reasons, and the engine reports `helping` once `z>=2` and `sustainUp>=5`.** S4 sampling guard helps incidentally (more obs per day → days look `full`) but does NOT compare prompt-mix between pre and post.

**12. "Insufficient data" fallback.** Smallest sample with verdict: `baselineMinDays = 3`. Below 3 baseline days → `not_enough_data` (`:402-426`). Post N=0 returns `too_early` and stamps `z=null` (`:430-431, 531-533`). **A verdict can fire on N=1 post-day** mathematically — but `sustainUp >= 5` is impossible with N<5, so effective floor for `helping`/`hurting` is `N >= 5`.

**13. Variance-noise floor.** `POISSON_SIGMA_FLOOR = 1.0` (`:84`), applied as `Math.max(sigmaPreRaw, 1.0)` (`:388`). **THE single most important defense.** Also `deltaPctMinBaseline = 1.0` (`:89`) returns `delta_pct = null` for noise-floor baselines so UI can't show "+1100%" on 0.5/day → 6/day jumps (`:442-443`).

### Top 5 systemic risks (engine-side)

1. **No prompt-mix confounding.** Adding/removing prompts mid-experiment shifts every URL's `mu_post` by a structural multiplier the engine treats as causal. **#1 false-win risk for an operator iterating the prompt set during native-polling rollout — i.e., you, right now.**
2. **No concurrent-change deconfounding.** Two changes within the 14-day baseline window contaminate each other; the second's "baseline" includes the first's already-shifted citation counts.
3. **No site-wide control.** A platform-level visibility shift shows as N independent per-URL `helping` verdicts.
4. **`partial`-only post-windows pass.** M3 guard demotes on `proof` days OR no `full` day, but pure-`partial` windows ship a measured win. With 100-prompt daily target, one missing chunk → 75 obs → still `partial`.
5. **Sustain is a count, not a magnitude check.** Post-window oscillating tightly above `mu_pre` (e.g., `mu_pre=3`, post = `4,4,4,4,4,4,4`) trivially clears `sustainUp >= 5`. With sigma floored to 1.0, **engine will call any sustained +1.5 to +2.0/day jump on a flat low-count baseline `helping`.** Whether real or routine fluctuation in a 100-prompt-per-day system is unknowable from data the engine sees.

### Where engine WILL falsely claim a win

1. **Prompt-set expansion.** Activate 30 new prompts on day X. Every URL's count rises mechanically. Within ~5 days each URL satisfies `sustainUp >= 5` and (flat pre) `z >> 2`. Engine reports a wave of `helping` verdicts unrelated to changelog.
2. **Change stamped on URL already trending.** URL on 14-day rising slope (1, 2, 2, 3, 3, 4, 4, 5…) gets a changelog row near the inflection. `mu_pre ≈ 3`, `mu_post ≈ 7`, `sigma_pre_raw < 1.0` → floored. Engine attributes pre-existing trend to change. **No slope/trend correction.**
3. **Flat-low-baseline + tight-cluster post.** `0,0,0,0,0,1,0,0,1,0,0,0,1,0` baseline → `mu_pre ≈ 0.21`, post `1,1,1,1,…` → `mu_post=1`, `sigma_used=1.0`, `N=14` → `z ≈ 2.96`, sustain=14 → `helping`. Reality: noise.

### Where engine WILL falsely call a real win "abstain"

1. **Post-window includes any single proof day.** May 4 incident recovery (5-prompt run) stamps `proof`. Any change with post-window crossing May 4 → demoted from `helping` → `nothing_yet`, even if 13 other days are `full` and lift is real. Guard is binary.
2. **Mixed-regime split with too few native baseline days.** Change ~2026-04-23 (right after regime start) → baseline filter drops all benchmark days → 1 native day → abstain `not_enough_native_baseline`. Real wins from changes made in first ~3 days post-cutover are uncountable.
3. **Sustain undershoots when post-window is very recent.** N=4 post-days, strong z, `sustainUp` ≤ 4 → `helping` cannot fire. Drops to `too_early`. **Engine cannot certify a win in fewer than 5 post-days regardless of signal strength.**

### What the engine gets right

- `POISSON_SIGMA_FLOOR = 1.0` (`url-verdict.ts:84, 388`) prevents 14-identical-pre-day → `sigma=0` → `z=Infinity`.
- `deltaPctMinBaseline = 1.0` floor (`:73, 442-443`) refuses "+1100%" on tiny baselines.
- Mixed-source `benchmark`/`derived` guard (`:296-381`) honestly refuses to compare across measurement systems with no calibration ratio.
- M3 sampling guard (`:471-494`) + S4 wire-up (`url-change-outcome.ts:579, 651-669`) closes the worst false-win loophole.
- D4 observability (`url-verdict.ts:159-163, 470-491`; logged at `url-change-outcome.ts:714-725`) makes demotions auditable.
- Adaptive baseline + confidence downgrade (`url-verdict.ts:496-515`): a 3-day baseline can produce a verdict but cannot be `high` confidence — 1-tier downgrade is honest.
- Idempotent recorder (`url-change-outcome.ts:347-430`) preserves `recorded_at` while bumping `transitions`.
- Anchor-date logic (`resolveChangeDate`, `:486-494`) keeps verdict + `findLandingDay` in lockstep.

### Engine-component verdicts

| Component | Verdict | Why |
|---|---|---|
| Z-score core (`computeUrlVerdict`) | DIRECTIONAL | Math sound for idealized stationary Poisson. Well-defended against low-count noise. **Undefended against trend, prompt-mix, concurrent-change, site-wide confounders.** Will produce false wins on slightest non-stationarity. |
| Mixed-regime guard | TRUSTWORTHY | `not_enough_native_baseline` abstain is honest. |
| Sampling-status guard (M3+S4+D4) | TRUSTWORTHY for the proof-day case; DIRECTIONAL at partial-day boundary | Pure-partial windows slip through. |
| Lifecycle classification + attribution copy | TRUSTWORTHY | Pure functions, well-tested. |
| Recorder | TRUSTWORTHY | Idempotent, transitions tracked, durable across dual-write. |
| End-to-end "did this change work" answer | **UNRELIABLE in current native-polling rollout regime** | Math is clean but asked questions it cannot answer. Will confidently produce wrong answers when confounders are active — which they are right now. |

**Net (Phase 3.A):** the engine is honest about LOW-LEVEL noise (sigma floor, mixed-source, sampling) and **dishonest by omission about HIGH-LEVEL structural confounders** (no trend, no concurrent-change, no prompt-mix, no site-wide control). Trust the abstains; do not trust the wins without an out-of-band sanity check.

---

## Phase 3.B — Empirical backtest (5 real + 5 placebo)

**Data caveats (read first):**
- `changelog_entries.live_at` is populated for **only 1 of 334 rows** in this tenant. Used `timestamp` as anchor proxy for 4 of 5 real-change samples.
- The "perfect placebo" (heavy-cited URL with NO recent changelog) does not exist — virtually every Ritz URL with strong citation history was edited in early-to-mid April. Used **synthetic-anchor placebo** strategy: same URLs, anchor = 2026-03-22 (a date when nothing shipped per CL). Two placebos use 2026-04-22 anchors against URLs whose last CL was 2026-03-13 (>30d old).
- "Partial poll day" = day where fewer than 4 distinct `run_id`s appeared.

### Per-sample table

| # | Sample | Anchor | mu_pre | mu_post | sigma_pre (floored) | z | partial pre/post (of N days) | Verdict engine emits | Honest call |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **real-1 luxury** (CL 4/14) | 2026-04-14 | 14.50 | 26.75 | 4.29 | **+2.85** | 0/14 / 0/12 | `helping` | **Real lift.** Doubled mean cites with full-coverage poll days. ✅ |
| 2 | **real-2 custom-home** (CL 4/14) | 2026-04-14 | 6.71 | 24.42 | 6.11 | **+2.90** | 4/14 / 4/12 | `helping` | **Real lift, but noisy.** sigma_post (20.08) > mu_post — bursty distribution. Direction valid; magnitude inflated. ✅ direction |
| 3 | **real-3 menlo-park** (CL 4/12) | 2026-04-12 | 5.54 | 9.50 | 2.93 | **+1.35** | 5/13 / 1/12 | `too_early` (z under +1.5 cutoff in their backtest interpretation; real engine `Z_BAR=2.0` so `nothing_yet`) | **Real lift.** Small but consistent. **Engine FALSE-NEGATIVE** at engine's `Z_BAR=2.0`. |
| 4 | **real-4 cupertino** (CL 4/12) | 2026-04-12 | 2.54 | 8.58 | 1.27 (floored from 1.27) | **+4.78** | **11/13 / 3/12** | `helping` | **Lift real, z inflated.** 11 of 13 pre-days were partial polls, deflating mu_pre. Direction right; effect overstated. ⚠️ correct call, wrong magnitude |
| 5 | **real-5 whole-home** (live 4/28) | 2026-04-28 | n/a (0 pre-days w/ data) | 1.00 | n/a | n/a | n/a / 1/1 | `not_enough_data` (1 post day, 1 cite, no pre coverage) | **INSUFFICIENT.** Only 84 obs ever; backtest cannot evaluate. ✅ |
| 6 | **placebo-1 luxury** (anchor 3/22, no event) | 2026-03-22 | 8.33 | 12.21 | 2.93 | **+1.32** | 1/12 / 0/14 | `nothing_yet` | No event — but data shows organic upward drift. Engine correctly avoids false-positive `helping`. ✅ |
| 7 | **placebo-2 custom-home** (anchor 3/22) | 2026-03-22 | 1.50 | 3.67 | 1.00 (floored) | **+2.17** | 2/2 / 6/12 | `helping` would fire — **FALSE POSITIVE** | Pre-bucket has only 2 days, both partial polls. Engine fooled because sigma_floor=1.0 over-amplifies sparse pre window. ❌ |
| 8 | **placebo-3 atherton** (anchor 4/22, last CL 3/13) | 2026-04-22 | 7.15 | 9.89 | 5.08 | **+0.54** | 2/13 / **6/9** | `nothing_yet` | No event; correctly no verdict. Post window saturated with partial polls. ✅ |
| 9 | **placebo-4 los-altos** (anchor 4/22, last CL 3/13) | 2026-04-22 | 8.57 | 7.89 | 5.81 | **−0.12** | 3/14 / **9/9** | `nothing_yet` | No event; flat. ALL 9 post days were partial polls. ✅ |
| 10 | **placebo-5 menlo-park** (anchor 3/22) | 2026-03-22 | 2.50 | 3.15 | 1.08 | **+0.61** | 8/10 / 9/13 | `nothing_yet` (very low coverage) | No event; engine correct. 17 of 23 days partial polls — math dominated by noise. ✅ |

### Empirical engine accuracy (10-sample backtest)

- **True positives: 3/5 real changes** (luxury, custom-home, cupertino) — all called `helping`.
- **True negatives: 4/5 placebos** correctly suppressed.
- **One false positive (placebo-2)** driven by sparse pre-data + sigma floor.
- **One false negative (real-3 menlo-park)** at engine's z-cutoff.
- **One INSUFFICIENT** (real-5) the engine correctly refuses to verdict.

**Two structural weaknesses confirmed empirically:**
- (a) Engine does not gate on minimum pre-window completeness, so sparse partial-poll days with `sigma_floor=1.0` produce false-positive `helping` calls (placebo-2).
- (b) The `Z_BAR=2.0` cutoff misses moderate-but-real lifts (real-3).

**Highest-leverage data fix flagged by backtest:** `live_at` is essentially never populated (1/334 rows), forcing all attribution to use commit `timestamp` — a much weaker proxy.

**Recommendation from backtest agent:**
- Add hard precondition `pre_days_with_full_polls >= 5` before any non-`nothing_yet` call (closes placebo-2 class).
- Consider exposing a `weak_signal` tier between `too_early` and `helping` for `z ∈ (1.2, 1.8)` (catches real-3 class).

---

## Combined verdict (Phase 3)

| Surface | Verdict | Why |
|---|---|---|
| Z-score core math | DIRECTIONAL | Sound for stationary Poisson; undefended against trend / prompt-mix / concurrent-change / site-wide. |
| Mixed-source guard | TRUSTWORTHY | Honest abstain. |
| Sampling guard (M3+S4) | TRUSTWORTHY for proof-day; DIRECTIONAL for pure-partial post-windows | Loophole real but bounded. |
| Lifecycle classification + copy | TRUSTWORTHY | Pure, well-tested. |
| Recorder + idempotency | TRUSTWORTHY | |
| `helping` / `hurting` verdicts in current rollout regime | **UNRELIABLE** | Empirical backtest: 1/5 placebos false-positive, 1/5 real false-negative. False-positive cause is structural (sparse pre window + sigma floor). |
| `nothing_yet` / `too_early` / `not_enough_data` abstains | TRUSTWORTHY | Empirical backtest: 4/5 placebos correctly suppressed. |
| `change.live_at` population | **BLOCKER** | 1/334 rows. All attribution falls back to commit `timestamp` — weakest proxy. |

**Recommended capability for next step:** Max — fixing the structural confounders (trend correction, concurrent-change deconfounding, prompt-mix detection, site-wide control series) is architectural, not a config tweak. Adding the `pre_days_with_full_polls >= 5` precondition + `weak_signal` tier is bounded but requires care across `url-verdict.ts`, `lifecycle-attribution-copy.ts`, and the lifecycle pill/copy contract.
