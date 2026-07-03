/**
 * model-fallback (BEACON_500 N42, 2026-07-03, R22b) - the model-fallback quality
 * benchmark so a cheaper model can never SILENTLY degrade output.
 *
 * THE PROBLEM. Every LLM caller passes ONE model to the gateway today; there is
 * no first-class, shared fallback CHAIN. When a call times out or the response is
 * malformed, each caller improvises its own retry, and the gpt-5-mini reasoning
 * timeout lesson taught us the failure mode that hurts most: a fallback that
 * happens SILENTLY, so the operator never learns a cheaper/second model quietly
 * produced the answer. N42 makes the chain explicit and DETERMINISTICALLY
 * checkable:
 *   1. It declares the canonical fallback chain over the gateway's real models
 *      (primary -> fallback order), each rung carrying its own timeout and, for
 *      reasoning models, its reasoning_effort - all consistent with the gateway's
 *      own effectiveTimeoutMs / isReasoningModel / REASONING_TIMEOUT_FLOOR_MS.
 *   2. It validates the chain is WELL-FORMED: at least a primary + one fallback,
 *      no repeated model, every rung has a positive timeout at or above the
 *      reasoning floor when it is a reasoning model, and reasoning_effort set on
 *      reasoning rungs.
 *   3. It provides the deterministic fallback-DECISION function - given a rung's
 *      synthetic outcome (timeout / http error / malformed / ok), does the chain
 *      advance, and is the advance LOUD (an operator-visible reason) rather than
 *      silent? A silent advance is itself a benchmark failure.
 *
 * NO live calls. Everything here is config + pure decision logic, validated on
 * SYNTHETIC responses, so it runs in CI at $0 and can never spend or hit a
 * network.
 *
 * Pinned by model-fallback.test.ts.
 */

import {
  isReasoningModel,
  effectiveTimeoutMs,
  REASONING_TIMEOUT_FLOOR_MS,
} from "@/domains/llm/gateway";

/** One rung of the fallback chain. */
export type FallbackRung = {
  model: string;
  /** Requested timeout for this rung, in ms. Floored to the reasoning floor for
   *  reasoning models by the gateway; declared here already at/above the floor so
   *  the config reads honestly. */
  timeoutMs: number;
  /** reasoning_effort for reasoning models (the gpt-5-mini lesson: pin it low so
   *  the default effort cannot blow the ceiling). Null for non-reasoning models. */
  reasoningEffort: "low" | "medium" | "high" | null;
  /** Plain note: why this rung sits where it does. */
  note: string;
};

export type FallbackChain = {
  /** The task family this chain serves (for the operator surface). */
  task: string;
  rungs: FallbackRung[];
};

/**
 * THE canonical fallback chain. Primary is gpt-5-mini (the model every caller
 * uses today); the fallback is gpt-5.4-mini, a stronger rung tried when the
 * primary times out or returns something unusable - we escalate to a MORE
 * capable model on failure, never quietly DROP to a cheaper one that could
 * degrade the answer without anyone noticing. Every rung is a reasoning model,
 * so each pins reasoning_effort low and sits at or above the 90s reasoning floor.
 */
export const DEFAULT_FALLBACK_CHAIN: FallbackChain = {
  task: "structured drafting and adjudication",
  rungs: [
    {
      model: "gpt-5-mini",
      timeoutMs: REASONING_TIMEOUT_FLOOR_MS,
      reasoningEffort: "low",
      note: "The primary. Cheapest reasoning model; pinned to low effort so the default effort cannot blow the 90s ceiling.",
    },
    {
      model: "gpt-5.4-mini",
      timeoutMs: REASONING_TIMEOUT_FLOOR_MS,
      reasoningEffort: "low",
      note: "The escalation. A stronger model tried only when the primary fails, so a failure never silently returns a weaker answer.",
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. Chain validation - is the chain well-formed?
// ---------------------------------------------------------------------------

export type ChainValidationIssue = {
  rungModel: string | null;
  problem: string;
};

export type ChainValidation = {
  wellFormed: boolean;
  issues: ChainValidationIssue[];
};

/**
 * Validate a fallback chain is well-formed. PURE. A well-formed chain:
 *   - has at least a primary AND one fallback (a single-rung "chain" cannot fall
 *     back at all),
 *   - never repeats a model (a repeat cannot add resilience),
 *   - gives every rung a positive timeout,
 *   - floors every reasoning rung's timeout to the reasoning floor (the gateway
 *     would floor it anyway; a chain that DECLARES a sub-floor timeout is lying),
 *   - sets reasoning_effort on every reasoning rung (the gpt-5-mini lesson).
 */
export function validateFallbackChain(chain: FallbackChain): ChainValidation {
  const issues: ChainValidationIssue[] = [];

  if (chain.rungs.length < 2) {
    issues.push({
      rungModel: null,
      problem: "A fallback chain needs a primary and at least one fallback, so a failure has somewhere to go.",
    });
  }

  const seen = new Set<string>();
  for (const rung of chain.rungs) {
    if (seen.has(rung.model)) {
      issues.push({ rungModel: rung.model, problem: "This model appears twice; a repeat cannot add resilience." });
    }
    seen.add(rung.model);

    if (!(rung.timeoutMs > 0)) {
      issues.push({ rungModel: rung.model, problem: "This rung has no positive timeout." });
    }

    if (isReasoningModel(rung.model)) {
      if (rung.timeoutMs < REASONING_TIMEOUT_FLOOR_MS) {
        issues.push({
          rungModel: rung.model,
          problem: `This reasoning model sits below the ${REASONING_TIMEOUT_FLOOR_MS / 1000}s floor, so it would silently time out and fall back.`,
        });
      }
      if (rung.reasoningEffort === null) {
        issues.push({
          rungModel: rung.model,
          problem: "This reasoning model has no reasoning effort set, so the default effort could blow the ceiling.",
        });
      }
      // The declared timeout must match what the gateway would actually enforce.
      if (rung.timeoutMs !== effectiveTimeoutMs(rung.model, rung.timeoutMs)) {
        issues.push({
          rungModel: rung.model,
          problem: "The declared timeout does not match the timeout the gateway would enforce for this reasoning model.",
        });
      }
    }
  }

  return { wellFormed: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 2. The fallback DECISION - given a rung's synthetic outcome, advance or stop?
// ---------------------------------------------------------------------------

/** The outcome of trying one rung, reduced to what the decision needs. This is
 *  what a SYNTHETIC response test supplies - never a live call. */
export type RungOutcome =
  | { kind: "ok" }
  | { kind: "timeout" }
  | { kind: "http_error"; status: number }
  | { kind: "malformed"; detail: string };

export type FallbackDecision = {
  /** Advance to the next rung, or stop here. */
  action: "accept" | "advance" | "exhausted";
  /** LOUD reason for the advance/stop. Never empty on an advance - a silent
   *  advance is a benchmark failure, so the decision always carries the words the
   *  operator would see. */
  reason: string;
  /** True when the failing rung fell back WITHOUT an operator-visible reason.
   *  Always false by construction here (the whole point of N42); asserted by the
   *  test so a future change that drops the reason is caught. */
  silent: boolean;
};

/**
 * Decide the next step for a rung outcome. PURE. An "ok" outcome is accepted; a
 * timeout / http error / malformed outcome advances to the next rung IF one
 * exists (and says so LOUDLY), or reports the chain exhausted. `hasNextRung`
 * lets the caller thread whether a fallback rung remains.
 */
export function decideFallback(outcome: RungOutcome, rungModel: string, hasNextRung: boolean): FallbackDecision {
  if (outcome.kind === "ok") {
    return { action: "accept", reason: `${rungModel} returned a usable response.`, silent: false };
  }

  const why =
    outcome.kind === "timeout"
      ? `${rungModel} timed out`
      : outcome.kind === "http_error"
        ? `${rungModel} returned HTTP ${outcome.status}`
        : `${rungModel} returned a malformed response (${outcome.detail})`;

  if (!hasNextRung) {
    return {
      action: "exhausted",
      reason: `${why} and there is no fallback left, so I stopped and did not publish a degraded answer.`,
      silent: false,
    };
  }
  return {
    action: "advance",
    reason: `${why}, so I am escalating to the next model. I am telling you rather than switching quietly.`,
    silent: false,
  };
}

// ---------------------------------------------------------------------------
// 3. The benchmark - validate the default chain + a synthetic failure walk.
// ---------------------------------------------------------------------------

export type ModelFallbackReport = {
  chainWellFormed: boolean;
  chainIssues: ChainValidationIssue[];
  /** True when a synthetic primary-timeout walk advances LOUDLY to the fallback
   *  and never advances silently. */
  loudFallbackVerified: boolean;
  /** One honest operator line summarizing the check. */
  sentence: string;
};

/**
 * Run the model-fallback benchmark over the canonical chain, deterministically,
 * on synthetic outcomes. PURE / no network / no spend.
 */
export function runModelFallbackBenchmark(chain: FallbackChain = DEFAULT_FALLBACK_CHAIN): ModelFallbackReport {
  const validation = validateFallbackChain(chain);

  // Synthetic walk: the primary times out; the decision must advance LOUDLY.
  let loudFallbackVerified = true;
  if (chain.rungs.length >= 2) {
    const primary = chain.rungs[0]!;
    const decision = decideFallback({ kind: "timeout" }, primary.model, true);
    if (decision.action !== "advance" || decision.silent || decision.reason.trim() === "") {
      loudFallbackVerified = false;
    }
    // And the last rung, on failure, must stop (never advance into nothing).
    const last = chain.rungs[chain.rungs.length - 1]!;
    const end = decideFallback({ kind: "malformed", detail: "bad json" }, last.model, false);
    if (end.action !== "exhausted" || end.silent) loudFallbackVerified = false;
  } else {
    loudFallbackVerified = false;
  }

  const ok = validation.wellFormed && loudFallbackVerified;
  return {
    chainWellFormed: validation.wellFormed,
    chainIssues: validation.issues,
    loudFallbackVerified,
    sentence: ok
      ? `My fallback plan is sound: ${chain.rungs.length} models in order, and if one fails I tell you before I try the next.`
      : `My fallback plan has ${validation.issues.length} ${validation.issues.length === 1 ? "problem" : "problems"} to fix.`,
  };
}
