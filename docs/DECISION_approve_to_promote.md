# DECISION NEEDED — surface the operator-review recommendation layer (α₂ "approve-to-promote")

**Raised:** 2026-06-13 (midnight shift) · **Status:** parked for operator (operator-locked decision U4) · **Severity:** high — it gates everything built this shift

## The finding (verified in prod, cron run 27460+ , 2026-06-13)

Tonight's new triggers — **answer-block readiness, source ledger (uncited_content), internal-link brain, keyword-gap, cannibalization** — all FIRE correctly (iranopedia candidates rose 273 → **332**), score, and are **visible on the operator diagnostic** `/diagnostics/recommendation-triggers` (the "Candidates" + "Safety-suppressed" sections). But **none reach the customer-facing `/recommendations` queue**, because they are all `operator-review-only` tier, and:

> `src/domains/recommendation-intelligence/safety-gates.ts:135` — *"operator-review-only auto-suppressed until α₂'s approve-to-promote affordance (operator-locked α₀a.2 decision U4)."*

That affordance was never built. So `operator-review-only` candidates are suppressed from promotion **by design**, awaiting an operator decision. This is NOT a bug — it is the locked gate doing its job. The gap is the unbuilt affordance.

## What works TODAY (the dream is already real for the proven layer)

iranopedia's live queue = **37 cards**, all `customer-queue-ready`: `edit_meta` ×10, `fix_schema` ×10, `add_schema` ×10, `change_h1` ×4, `edit_title` ×3. These auto-promote and are Accept-ready now (schema on store products pushes live on Accept; the rest are paste-ready). The "connect → see ranked cards → click Accept" path is **live** for the high-confidence deterministic layer.

## Why the new triggers are correctly operator-review-only

They are advisory/directive, not paste-and-go: answer-block + sources name *what* to add but the owner writes the factual answer (hard rail: no fabricating cultural/historical facts); internal-link + keyword-gap are judgment calls. `operator-review-only` is the **right** tier — re-tiering them to `customer-queue-ready` would be wrong (they aren't auto-applyable). So the fix is NOT re-tiering; it's the review affordance.

## The decision (pick one)

- **A — Build α₂ "approve-to-promote" (RECOMMENDED).** A "Recommendations awaiting your review" lane (on `/recommendations` or operator surface) that lists the suppressed operator-review candidates with full card content; a per-card "Promote to queue" operator action writes the candidate into `recommended_edits` (status `recommended`), after which it follows the **same** Accept→push path (still operator-gated, caps + snapshots intact — this adds a review gate, it never weakens a safety rail). Fulfills U4's stated condition.
- **B — Keep them diagnostic-only.** The new triggers stay visible only on `/diagnostics/recommendation-triggers`; the main queue remains the proven customer-queue-ready layer. Simpler; the advisory layer is "operator power-user" only.

## Mechanism notes for option A (so the build is unambiguous)

- The candidates are ALREADY computed as `selectPromotableCandidates(...)` output with `eligible: false` + `suppression_reason: "diagnostic_only_tier"` + `tier: "operator-review-only"` (see `promote-to-queue.ts` + the diagnostic page which already renders `promotionSafetySuppressed`).
- Need: (1) a per-tenant store of operator-approved candidate keys (dedupe_key); (2) a server action `approveOperatorReviewCandidate(key)`; (3) the gate at `safety-gates.ts:135` honors approved keys (promote instead of suppress); (4) the lane UI; (5) update the operator-lock pin test deliberately with the rationale.
- Safety: no auto-push; Ritz still dev-note; the lock's INTENT (no unreviewed auto-promotion) is preserved because the operator explicitly approves each one.

**Implementation is READY (parked, not merged): draft PR #101** builds option A end-to-end (engine gate + per-tenant approved-keys store + operator-mode approve/unapprove actions + a "Promote to queue" button on /diagnostics/recommendation-triggers), full suite green. It is INERT in prod (no tenant has approved anything and it isn't merged) — review and merge it if you choose A, or close it for option B. Not merged autonomously: U4 is operator-locked and the UX is your call. Also spawned as a task chip. Recommend A.
