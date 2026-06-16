/**
 * Expert-rec-engine PHASE A → Slice 1 (2026-06-16) — render-time display
 * guard for the customer-visible EVIDENCE LINES (GSC / SEMrush / Clarity /
 * answer-engine), the sibling of `why-display-guard.ts`.
 *
 * WHY THIS EXISTS — audit cross-cutting BUG #5: the 2026-06-15 evidence-line
 * surface (the number-rich "why this, why now" bullets on the recommendation
 * card, the detail brief, and the changes brief) renders `line.value` /
 * `line.label` / `line.detail` DIRECTLY — only the `why` field was guarded by
 * `checkWhyDisplaySafe`, and only the `why` field was pinned by an architecture
 * test. So a UUID, an internal taxonomy token, a leaked competitor name, or the
 * answer-engine VENDOR name (e.g. a Profound `asset_name`/`category_id` flowing
 * into "AI assistants answer this citing {competitor}") could render verbatim.
 *
 * THE RAIL: each rendered string field of an evidence line must pass the SAME
 * `checkWhyDisplaySafe` checks (uuid / long-hex / internal-token / competitor)
 * AND must not name the white-labeled answer-engine vendor. A line that fails
 * is SUPPRESSED (dropped) rather than partially rendered — evidence lines are
 * terse bullet fragments where the calm `why` fallback sentence would not fit,
 * and showing NOTHING is the honest, safe default (better a missing bullet than
 * a leaked token). The guard never mutates stored data.
 *
 * WHITE-LABEL SCOPE (deliberately narrow to avoid false positives): only the
 * tool name Beacon white-labels — "Profound" — is blocked here. The underlying
 * engine names (ChatGPT / Gemini / Claude / Perplexity) are NOT blocked on
 * evidence lines because they can legitimately appear inside a tenant's own GSC
 * query text (e.g. a site that genuinely ranks for "chatgpt alternatives");
 * Beacon's own answer-engine FRAMING stays white-label at the copy-template
 * layer (templates say "AI assistants", never the vendor).
 *
 * PURE / deterministic / no I/O / no LLM / no Supabase / no mutation. Usable
 * from server and client components alike (mirrors `why-display-guard.ts`).
 *
 * Pinned by:
 *   • tests/domains/recommendations/evidence-line-display-guard.test.ts
 *   • tests/architecture/recommendation-evidence-line-render-guard.test.ts
 */

import { checkWhyDisplaySafe, type WhyDisplayGuardContext } from "./why-display-guard";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

/**
 * Answer-engine VENDOR terms that must never reach customer-facing evidence
 * copy (white-label rail). Kept to the single tool name Beacon white-labels to
 * avoid suppressing legitimate tenant query text that mentions an engine.
 */
export const ANSWER_ENGINE_VENDOR_TERMS: ReadonlyArray<string> = ["Profound"];

function containsVendorTerm(text: string): boolean {
  for (const vendor of ANSWER_ENGINE_VENDOR_TERMS) {
    const re = new RegExp(
      `\\b${vendor.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * True when EVERY rendered string field of the evidence line is display-safe:
 * passes `checkWhyDisplaySafe` (uuid / long-hex / internal-token / competitor)
 * and names no white-labeled vendor. Empty/absent fields are skipped.
 */
export function isEvidenceLineDisplaySafe(
  line: EvidenceLine,
  context: WhyDisplayGuardContext = {},
): boolean {
  const fields = [line.value, line.label, line.detail];
  for (const field of fields) {
    if (typeof field !== "string" || field.length === 0) continue;
    if (!checkWhyDisplaySafe(field, context).ok) return false;
    if (containsVendorTerm(field)) return false;
  }
  return true;
}

/**
 * Filter an evidence-line array to only the display-safe lines. Suppresses
 * (drops) any line that would leak — the render surfaces call this immediately
 * after reading the lines off `row.detail`, before mapping them to JSX.
 */
export function filterDisplaySafeEvidenceLines(
  lines: ReadonlyArray<EvidenceLine> | null | undefined,
  context: WhyDisplayGuardContext = {},
): EvidenceLine[] {
  if (lines == null) return [];
  return lines.filter((line) => isEvidenceLineDisplaySafe(line, context));
}
