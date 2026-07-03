/**
 * consolidate-spelling-demand (P20, v1 129, 2026-07-03).
 *
 * PURE. Given a tenant's declared spelling / transliteration groups and the
 * observed demand per raw term, sum the demand across every spelling in a group
 * onto the group's canonical term, and surface the TRUE combined demand.
 *
 * The play: "'saffron' and 3 other spellings of it get 1,400 searches a month
 * combined, more than any single spelling shows. One page can own all of them."
 *
 * GENERIC + language-agnostic. No hardcoded terms, no locale logic. With no
 * groups (or no matching demand) the result is empty and every caller behaves
 * exactly as before this engine existed.
 *
 * Matching is deterministic and script-agnostic: a term matches a group
 * spelling when their normalized forms are equal. Normalization lower-cases,
 * trims, and collapses internal whitespace — it does NOT strip or reinterpret
 * any script, so a Latin, Cyrillic, Arabic, or CJK spelling is compared exactly
 * as the tenant wrote it. This keeps the engine honest for any writing system
 * without embedding rules for any of them.
 *
 * No em or en dashes anywhere.
 */

import type {
  ConsolidateSpellingDemandInput,
  ConsolidateSpellingDemandResult,
  ConsolidatedSpellingGroup,
  ConsolidatedSpellingMember,
  SpellingVariantGroup,
} from "./types";

/** Lower-case, trim, collapse internal whitespace. Script-preserving. */
export function normalizeSpelling(s: string): string {
  return s.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
}

/** The distinct, normalized spellings a group covers (canonical + variants). */
function groupSpellings(group: SpellingVariantGroup): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [group.canonical, ...group.variants]) {
    if (typeof raw !== "string") continue;
    const norm = normalizeSpelling(raw);
    if (norm.length === 0 || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/**
 * Consolidate observed demand across each group's spellings onto the canonical
 * term. Returns only groups where 2+ distinct spellings carried demand — a lone
 * spelling already shows its own size, so there is nothing to consolidate.
 */
export function consolidateSpellingDemand(
  input: ConsolidateSpellingDemandInput,
): ConsolidateSpellingDemandResult {
  const { groups, demand } = input;
  if (groups.length === 0 || demand.length === 0) return { groups: [] };

  // Sum demand per normalized term first (a source may list a spelling twice).
  const demandByNorm = new Map<string, { display: string; demand: number }>();
  for (const d of demand) {
    if (typeof d.term !== "string") continue;
    const norm = normalizeSpelling(d.term);
    if (norm.length === 0) continue;
    const value = typeof d.demand === "number" && d.demand > 0 ? d.demand : 0;
    const existing = demandByNorm.get(norm);
    if (existing) existing.demand += value;
    else demandByNorm.set(norm, { display: d.term.trim(), demand: value });
  }

  const out: ConsolidatedSpellingGroup[] = [];
  for (const group of groups) {
    const canonical =
      typeof group.canonical === "string" ? group.canonical.trim() : "";
    if (canonical.length === 0) continue;
    const canonicalNorm = normalizeSpelling(canonical);
    const spellings = groupSpellings(group);
    if (spellings.length < 2) continue; // no alternate spelling to fold in

    const members: ConsolidatedSpellingMember[] = [];
    let combinedDemand = 0;
    for (const norm of spellings) {
      const hit = demandByNorm.get(norm);
      if (!hit || hit.demand <= 0) continue;
      combinedDemand += hit.demand;
      members.push({
        term: hit.display,
        demand: hit.demand,
        isCanonical: norm === canonicalNorm,
      });
    }

    // Only surface a group when the demand is genuinely SPLIT across 2+
    // spellings — that is the only case where consolidation reveals something a
    // single query does not already show.
    if (members.length < 2 || combinedDemand <= 0) continue;

    members.sort(
      (a, b) => b.demand - a.demand || a.term.localeCompare(b.term),
    );

    out.push({
      canonical,
      combinedDemand,
      topSpellingDemand: members[0]!.demand,
      spellingsWithDemand: members.length,
      members,
    });
  }

  // Biggest combined demand first; stable canonical tiebreak.
  out.sort(
    (a, b) =>
      b.combinedDemand - a.combinedDemand ||
      a.canonical.localeCompare(b.canonical),
  );
  return { groups: out };
}
