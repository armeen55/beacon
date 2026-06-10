/**
 * 2026-06-10 — Dev-note export (§push, advise mode).
 *
 * The Change Card already IS the dev note — this formats one as a
 * paste-ready ticket (markdown). This is RITZ'S ONLY OUTPUT PATH
 * (Invariant 2) and the safe default for any tenant without an
 * explicit publish target. PURE.
 */

import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

export function formatDevNote(edit: RecommendedEditRow): string {
  const lines: string[] = [];
  lines.push(`## ${edit.display_label ?? edit.action_type}`);
  lines.push("");
  lines.push(`**Page:** ${edit.target_url}`);
  if (edit.target_element_key) {
    lines.push(`**Element:** ${edit.target_element_key}`);
  }
  lines.push(`**Difficulty:** ${edit.difficulty} · **Confidence:** ${edit.confidence}`);
  lines.push("");
  lines.push(`**Why:** ${edit.why}`);
  lines.push("");
  if (edit.current_text && edit.current_text.trim() !== "") {
    lines.push("**Current:**");
    lines.push("```");
    lines.push(edit.current_text.trim());
    lines.push("```");
    lines.push("");
  }
  lines.push("**Change to (exact copy, paste as-is):**");
  lines.push("```");
  lines.push((edit.proposed_text ?? "").trim());
  lines.push("```");
  if (edit.expected_impact) {
    lines.push("");
    lines.push(`**Expected impact:** ${edit.expected_impact}`);
  }
  if (edit.risks.length > 0) {
    lines.push("");
    lines.push(`**Risks:** ${edit.risks.join("; ")}`);
  }
  if (edit.measurement_plan) {
    lines.push("");
    lines.push(`**How we'll measure:** ${edit.measurement_plan}`);
  }
  lines.push("");
  lines.push(`_Beacon card ${edit.id} · generated ${edit.created_at.slice(0, 10)}_`);
  return lines.join("\n");
}
