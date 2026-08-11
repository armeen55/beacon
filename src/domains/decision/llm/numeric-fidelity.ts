/**
 * llm/numeric-fidelity (2026-07-03, BEACON 500 R16 / P6) - the no-invented- numbers firewall, upgraded from digit-run matching to TOKENIZED number extraction with formatting tolerance.
 *
 * The rule is unchanged: a generated text may only cite numbers that appear in the evidence packet. What changed is HOW "appears" is decided:
 *
 *   - "5,400" and "5400" are the SAME number (thousands separators stripped
 *     on both sides before comparison).
 *   - "3.50" and "3.5" are the same number (trailing zeros normalized).
 *   - Percentages match ROUNDED: an output "45%" is grounded by an evidence
 *     "44.6%" (both round to 45). Formatting a grounded share differently is
 *     not an invented stat.
 *
 * STRICTLY MORE PERMISSIVE than the legacy digit-run check: any token the old firewall accepted is still accepted (each >= 2-digit run being grounded keeps
 * a token grounded), so no pinned suite can start rejecting good drafts. The tolerance paths only rescue formatting variants that used to be false
 * rejections. Genuinely ungrounded numbers still fail, and the drafter's repair retry injects the CORRECT grounded numbers before failing closed.
 *
 * PURE - no I/O. Pinned by numeric-fidelity.test.ts.
 */

/** Strip thousands separators: a comma between digits is formatting, not meaning. */
function stripThousandsSeparators(text: string): string {
  return text.replace(/(?<=\d),(?=\d)/g, "");
}

type NumericToken = {
  /** The token as matched (thousands separators already stripped). */
  raw: string;
  /** Canonical numeric text: no trailing zeros / trailing dot. */
  normalized: string;
  /** True when the token is percent-marked ("45%" or "45 percent"). */
  isPercent: boolean;
  value: number;
};

const TOKEN_RE = /\d+(?:\.\d+)?%?/g;

function normalizeNumericText(t: string): string {
  if (!t.includes(".")) return t;
  return t.replace(/0+$/, "").replace(/\.$/, "");
}

/** Extract every numeric token from a text, with percent detection ("45%" or "45 percent"). */
function extractNumericTokens(text: string): NumericToken[] {
  const stripped = stripThousandsSeparators(text);
  const out: NumericToken[] = [];
  for (const m of stripped.matchAll(TOKEN_RE)) {
    const withPct = m[0]!;
    const isSuffixPercent = withPct.endsWith("%");
    const numeric = isSuffixPercent ? withPct.slice(0, -1) : withPct;
    const after = stripped.slice((m.index ?? 0) + withPct.length);
    const wordPercent = /^\s*(?:percent|pct)\b/i.test(after);
    out.push({
      raw: numeric,
      normalized: normalizeNumericText(numeric),
      isPercent: isSuffixPercent || wordPercent,
      value: Number(numeric),
    });
  }
  return out;
}

export type GroundedNumbers = {
  /** Normalized full tokens ("5400", "44.6", "3.5"). */
  tokens: Set<string>;
  /** Plain digit runs (the legacy ledger) - keeps the upgrade strictly more permissive. */
  digitRuns: Set<string>;
  /** Rounded integer values of percent-marked grounded tokens ("45" for "44.6%"). */
  roundedPercents: Set<string>;
};

/** Build the grounded-number ledger from the evidence text. */
export function buildGroundedNumbers(grounded: string): GroundedNumbers {
  const tokens = new Set<string>();
  const roundedPercents = new Set<string>();
  for (const t of extractNumericTokens(grounded)) {
    tokens.add(t.normalized);
    if (t.isPercent && Number.isFinite(t.value)) roundedPercents.add(String(Math.round(t.value)));
  }
  const digitRuns = new Set(stripThousandsSeparators(grounded).match(/\d+/g) ?? []);
  return { tokens, digitRuns, roundedPercents };
}

/** Add extra allowed digit runs (years, proof-window constants) to a ledger. */
export function allowNumbers(g: GroundedNumbers, allowed: Iterable<string>): GroundedNumbers {
  for (const a of allowed) {
    g.digitRuns.add(a);
    g.tokens.add(normalizeNumericText(a));
  }
  return g;
}

function tokenIsGrounded(t: NumericToken, g: GroundedNumbers): boolean {
  // (a) exact normalized token ("5,400" -> "5400"; "3.50" -> "3.5").
  if (g.tokens.has(t.normalized)) return true;
  // (b) legacy digit-run acceptance: every >= 2-digit run in the token grounded.
  //     (Single-digit runs were never checked by the legacy firewall.)
  const runs = (t.raw.match(/\d+/g) ?? []).filter((r) => r.length >= 2);
  if (runs.length > 0 && runs.every((r) => g.digitRuns.has(r))) return true;
  // (c) rounded-percent tolerance: "45%" is grounded by an evidence "44.6%".
  if (t.isPercent && Number.isFinite(t.value) && g.roundedPercents.has(String(Math.round(t.value))))
    return true;
  return false;
}

/**
 * Every ungrounded numeric token in `text` (deduped, order preserved). Tokens whose digit content is a single digit are ignored (never a "stat"), matching the legacy firewall's floor.
 */
export function findUngroundedNumbers(text: string, grounded: GroundedNumbers): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of extractNumericTokens(text)) {
    if (t.raw.replace(/\D/g, "").length < 2) continue;
    if (tokenIsGrounded(t, grounded)) continue;
    const label = t.isPercent ? `${t.raw}%` : t.raw;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * The grounded numbers to INJECT into a repair retry ("cite only these"). Capped so a huge evidence packet cannot bloat the prompt.
 */
export function groundedNumberList(grounded: GroundedNumbers, max = 30): string[] {
  return [...grounded.tokens].slice(0, max);
}
