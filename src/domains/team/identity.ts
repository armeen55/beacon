/**
 * team identity (2026-07-01, FINAL PREMIUM PLAN item 13) - ONE visual identity per teammate,
 * used everywhere a specialist appears (roundtable voices, standup strip, war-room bands,
 * evidence chips). Pure constants, safe for client and server components. Colors are fixed so
 * the operator learns them: you can tell who is speaking from color alone.
 */

export type TeammateKey =
  | "gsc"
  | "ga4"
  | "clarity"
  | "profound"
  | "dataforseo"
  | "wix"
  | "llm"
  | "commerce_asset"
  | "proof";

export type TeammateIdentity = {
  key: TeammateKey;
  /** Operator-facing name (matches debate-summary labels). */
  name: string;
  /** Solid dot / accent color. */
  color: string;
  /** Soft background for chips. */
  bg: string;
  /** Readable text color on the soft background. */
  text: string;
  /** One word for tight spots. */
  short: string;
};

export const TEAMMATES: Record<TeammateKey, TeammateIdentity> = {
  gsc: { key: "gsc", name: "Search demand", color: "#2563eb", bg: "#eff6ff", text: "#1d4ed8", short: "Demand" },
  ga4: { key: "ga4", name: "Revenue", color: "#059669", bg: "#ecfdf5", text: "#047857", short: "Revenue" },
  clarity: { key: "clarity", name: "Visitor behavior", color: "#d97706", bg: "#fffbeb", text: "#b45309", short: "Behavior" },
  dataforseo: { key: "dataforseo", name: "Live Google results", color: "#7c3aed", bg: "#f5f3ff", text: "#6d28d9", short: "Google" },
  profound: { key: "profound", name: "AI citations", color: "#db2777", bg: "#fdf2f8", text: "#be185d", short: "AI" },
  wix: { key: "wix", name: "Publishing", color: "#475569", bg: "#f8fafc", text: "#334155", short: "Publish" },
  llm: { key: "llm", name: "Strategist", color: "#4f46e5", bg: "#eef2ff", text: "#4338ca", short: "Strategist" },
  commerce_asset: { key: "commerce_asset", name: "Commerce", color: "#0d9488", bg: "#f0fdfa", text: "#0f766e", short: "Commerce" },
  proof: { key: "proof", name: "Results so far", color: "#0891b2", bg: "#ecfeff", text: "#0e7490", short: "Results" },
};

/** Lookup that tolerates unknown keys (a typo'd specialist gets a neutral identity, never a crash). */
export function teammateOf(key: string): TeammateIdentity {
  return (
    TEAMMATES[key as TeammateKey] ?? {
      key: "llm",
      name: "Specialist",
      color: "#6b7280",
      bg: "#f9fafb",
      text: "#4b5563",
      short: "Team",
    }
  );
}
