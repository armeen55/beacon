# Proof Engine — statistical methodology + external validation

> Why the causal "Proof" claim survives scrutiny (the category wedge's
> credibility). Validates the engine's design + thresholds against the
> difference-in-differences (DiD) econometrics literature, and names the one
> sourced refinement that would harden it further. Researched 2026-06-12.

## What the engine computes (verified in code)

`natural-controls.ts` implements **difference-in-differences with natural
controls**: for a shipped edit on a treated URL, `adjusted_lift = treatedΔ −
mean(comparable-untreated-URL Δ)`, where Δ is post-window minus pre-window
owned-citation rate. Config (`DEFAULT_CONFIG`): `preWindowDays=14`,
`postWindowDays=14`, `overlapBufferDaysBefore=7`, `minControlPreCitations=3`,
`minControlsForComputed=2`, `minControlsForHighConfidence=3`. Status discipline:
`computed` (a real DiD estimate, ≥2 controls) vs the honest non-causal buckets
(`weak_estimate` / `no_controls` / `insufficient_baseline` / `insufficient_post_data`).

## What the literature VALIDATES

1. **Few-treated / many-controls is the canonical DiD setting.** Bertrand,
   Duflo & Mullainathan and the Conley–Taber line identify the treatment effect
   from a small number of "changers" against a large pool of non-changing units —
   exactly the engine's one-treated-URL vs many-comparable-untreated-URLs design.
2. **Parallel trends is the core identifying assumption, and pre-period testing
   is the right guard.** The engine's `preWindowDays` baseline + the
   `overlapBufferDaysBefore` gap operationalize a pre-trend check; the World-Bank
   pre-trend-testing guidance is the standard practice this mirrors.
3. **With few controls, be conservative about confidence — never over-claim.**
   The small-number-of-groups literature (Donald & Lang 2007; the SHARE
   simulation review) shows cluster standard errors bias *downward* with few
   groups, causing over-rejection. The engine's posture matches: `computed`
   requires ≥2 controls but **high confidence requires ≥3**
   (`minControlsForHighConfidence`), and `proof-sentence.ts` reserves
   cause-and-effect language for `computed` and softens low-confidence reads.
   `no_controls` / `insufficient_baseline` honestly decline to infer — which is
   the literature's prescription, not a limitation.

**Conclusion:** the engine's design + thresholds are consistent with DiD best
practice. The "Proof" claim is defensible: it is a transparent DiD estimate
against real comparable pages, graded by control count, never a black-box score.

## The one sourced refinement that would harden it (next build)

The small-cluster literature's strongest recommendation is **permutation /
placebo inference** rather than relying on a point estimate alone: re-run the
DiD assigning the "treatment" to randomly chosen *untreated* control URLs and
check how often a lift ≥ the observed one appears by chance (a placebo
distribution → an empirical p-value). This is deterministic (no LLM, no paid
API — fits the rails), reuses the existing control pool, and would let a
`computed` outcome carry a real significance level instead of a control-count
tier. Build sketch: in `natural-controls.ts`, after computing `adjusted_lift`,
draw K placebo treatments from the control pool, compute their pseudo-lifts,
and report `placebo_p = (#|pseudo| ≥ |observed|)/K`; gate `confidence: "high"`
on both `≥minControlsForHighConfidence` AND `placebo_p < 0.1`. Pin with a test
(a strong real lift → low p; noise → high p).

## Sources (≥5)

1. Bertrand, Duflo & Mullainathan (2004), *How Much Should We Trust
   Differences-in-Differences Estimates?* — serial-correlation + inference
   pitfalls; the canonical caution. (NBER t0312)
2. Conley & Taber (2011), *Inference with "Difference in Differences" with a
   Small Number of Policy Changes* (Review of Economics & Statistics) —
   inference for few changers using a large pool of non-changers.
3. Donald & Lang (2007), *Inference with Difference-in-Differences and Other
   Panel Data* — two-part procedure valid with a small number of groups.
4. World Bank Development Impact — *Revisiting the DiD Parallel Trends
   Assumption: Pre-Trend Testing* — the pre-window guard.
5. Cunningham, *Causal Inference: The Mixtape* (ch. 9, Difference-in-Differences)
   — placebo/permutation inference + the natural-controls framing.
6. Roth, Sant'Anna et al. (2023), *What's Trending in Difference-in-Differences?*
   (Journal of Econometrics) — modern synthesis incl. small-sample inference.
