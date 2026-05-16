/**
 * Section 6 C6a (2026-05-15) — pure copy renderer for the Changes
 * detail primary-recommendation evidence sub-line.
 *
 * Consumes the Mode A + Mode B pure-helper outputs and decides what
 * (if anything) to render to the customer on the Changes detail v2
 * Act 3 surface.
 *
 * Hard rules (Section 6 R2 lock + Section 12 N4 carry-over):
 *
 *   • lifecycleStage === "stuck" → return null (stuck-stage diagnostic
 *     from A.3 takes precedence; no double-coverage).
 *
 *   • When Mode A status === "pass", suppress the Mode B
 *     still_learning fallback (only render Mode B "pass" lines
 *     alongside Mode A). Prevents "we passed AND we're still learning"
 *     double-talk.
 *
 *   • At most ONE collapsed Mode B still_learning line across both
 *     platforms (never one per platform).
 *
 *   • Empty `lines` after all rules → return null (renderer doesn't
 *     emit blank surfaces).
 *
 *   • brandName is caller-supplied. NEVER hard-code "Ritz Builders".
 *
 *   • Customer copy never uses "drove" / "caused" / "generated" /
 *     "made" / "led to" / "$" / "revenue" / "dollars" / "sales" /
 *     "leads" / "Mode A" / "Mode B" / "Mode C" / internal enum names.
 *     Pinned by
 *     `tests/architecture/change-primary-evidence-forbidden-vocab.test.ts`.
 *
 * Status enum identifiers like `"pass"` / `"still_learning"` / `"silent"`
 * are TS discriminator strings, never rendered to customers. They
 * survive the forbidden-vocab scan via an explicit allowlist in that
 * architecture test header.
 */

import type { ChangePrimaryModeAResult } from "./change-primary-mode-a";
import type { ChangePrimaryModeBResult } from "./change-primary-mode-b";
import type { LifecycleStage } from "./lifecycle-stage";

export type RenderChangePrimaryCopyArgs = {
  modeA: ChangePrimaryModeAResult;
  modeB: ChangePrimaryModeBResult;
  brandName: string;
  /**
   * Optional lifecycle stage. When equal to `"stuck"` the renderer
   * returns null regardless of Mode A / Mode B status — the A.3
   * stuck-stage diagnostic owns that surface slot.
   */
  lifecycleStage: LifecycleStage | null;
};

export type RenderChangePrimaryCopyResult = {
  lines: string[];
};

export function renderChangePrimaryCopy(
  args: RenderChangePrimaryCopyArgs,
): RenderChangePrimaryCopyResult | null {
  const { modeA, modeB, brandName, lifecycleStage } = args;

  if (lifecycleStage === "stuck") return null;

  const lines: string[] = [];

  // Mode A line (pass or still_learning).
  if (modeA.status === "pass") {
    lines.push(
      `In ${modeA.primary_count} of ${modeA.cited_here_count} answers that cited this page, the AI selected ${brandName} as the main recommended option since this went live.`,
    );
  } else if (modeA.status === "still_learning") {
    lines.push(
      "This page has been cited a few times since it went live — not enough answers yet to read primary-recommendation evidence.",
    );
  }

  // Mode B pass lines, in fixed platform order so screenshots + tests
  // stay deterministic.
  const platformOrder: Array<{
    key: "chatgpt" | "perplexity";
    label: "ChatGPT" | "Perplexity";
  }> = [
    { key: "chatgpt", label: "ChatGPT" },
    { key: "perplexity", label: "Perplexity" },
  ];

  let anyStillLearning = false;
  for (const { key, label } of platformOrder) {
    const p = modeB.per_platform[key];
    if (p.status === "pass") {
      // Display fields are guaranteed non-null on pass (status requires
      // pre_total >= 7 AND post_total >= 7, both > 0). Belt-and-
      // suspenders fallback uses 0 if any future change makes them
      // nullable on pass.
      const deltaPp = p.delta_pp ?? 0;
      const preSharePct = p.pre_share_pct ?? 0;
      const postSharePct = p.post_share_pct ?? 0;
      lines.push(
        `On ${label}, primary-recommendation share on the prompts this change targeted was up ${deltaPp} points in the first 14 days after going live versus the prior 14 (${preSharePct}% → ${postSharePct}%).`,
      );
    } else if (p.status === "still_learning") {
      anyStillLearning = true;
    }
  }

  // At most one collapsed Mode B still_learning line, suppressed when
  // Mode A passed.
  if (anyStillLearning && modeA.status !== "pass") {
    lines.push(
      "Beacon is still gathering 14 days of post-launch evidence on the prompts this change targeted.",
    );
  }

  if (lines.length === 0) return null;
  return { lines };
}
