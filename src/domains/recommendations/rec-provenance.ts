/**
 * Recommendation PROVENANCE — a small, pure classifier that labels where a queue
 * recommendation came from, so an old single-field deterministic suggestion is
 * never mistaken for an evidence-rich one. Drives a chip on the card + detail.
 *
 * Mirrors RecommendedEditRow.source (SpecificEditSource). Pure. No I/O.
 */

export type RecProvenanceKind = "signal_backed" | "ai_drafted" | "basic" | "operator" | "recovered";

export type RecProvenance = {
  kind: RecProvenanceKind;
  /** Short customer-safe chip label. */
  label: string;
  tone: "success" | "info" | "neutral" | "warn";
  /** True for the older deterministic single-field generators (the "legacy" class). */
  isBasic: boolean;
};

// Sources that fuse a real external signal — the newer, evidence-led generators.
const SIGNAL_SOURCES = new Set([
  "gsc_led", "clarity_friction", "aeo_readiness",
  "uncited_content", "keyword_gap", "striking_distance", "schema_engine",
  "internal_link_brain", "missing_schema_content",
]);
// LLM-drafted copy.
const AI_SOURCES = new Set(["openai", "anthropic", "llm", "llm_draft"]);
// Plain deterministic promotion / single-field generators — the legacy class.
const BASIC_SOURCES = new Set(["deterministic", "deterministic_promotion", "promotion", "seed", "seeded"]);

/** Classify a recommendation's generation source. `null`/unknown → "basic"
 *  (conservative: an unlabeled rec is treated as a plain legacy suggestion). */
export function classifyRecProvenance(source: string | null | undefined): RecProvenance {
  const s = (source ?? "").trim().toLowerCase();
  if (SIGNAL_SOURCES.has(s)) return { kind: "signal_backed", label: "Signal-backed", tone: "success", isBasic: false };
  if (AI_SOURCES.has(s)) return { kind: "ai_drafted", label: "AI-drafted", tone: "info", isBasic: false };
  if (s === "operator_edited") return { kind: "operator", label: "Operator-edited", tone: "neutral", isBasic: false };
  if (s === "historical_recovered") return { kind: "recovered", label: "Recovered", tone: "warn", isBasic: true };
  // deterministic / promotion / seeded / unknown → the legacy "basic" class.
  if (BASIC_SOURCES.has(s) || s === "") return { kind: "basic", label: "Basic", tone: "neutral", isBasic: true };
  // Any other named signal source we didn't enumerate — treat as signal-backed
  // (it carries a specific provenance, so it isn't the plain legacy class).
  return { kind: "signal_backed", label: "Signal-backed", tone: "success", isBasic: false };
}
