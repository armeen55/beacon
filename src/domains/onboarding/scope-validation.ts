/**
 * scope-validation — Gap C.2 (2026-05-07).
 *
 * Pure validators + normalizers for the /onboard/scope step (step 2 of
 * the wizard): cities served + services / project mix.
 *
 * No I/O, no env reads, no Supabase, no Next.js. The server action
 * calls these before any DB write; the form renders the per-field
 * error messages on validation failure.
 *
 * Out of scope (later mini-phases):
 *   - Auto-detect from homepage crawl (Gap D).
 *   - Geo lookup / disambiguation (e.g., Atherton vs Atherton, CA).
 *   - Operator-locked maximum-cities cap differs by tier (locked at 20
 *     here; tiering is Gap E+).
 */

import type { ProjectMixTag } from "@/domains/tenants/types";

export const CITIES_MAX_COUNT = 20;
export const CITY_NAME_MAX_LENGTH = 60;

/**
 * Allowed values for project_mix on the tenants row. Pinned here as
 * a runtime-checkable list so the validator can reject unknown values
 * the client posts. Mirrors the `ProjectMixTag` type — adding a tag
 * to the type without adding it here is a build error caught by the
 * `satisfies ReadonlyArray<ProjectMixTag>` annotation.
 */
export const PROJECT_MIX_TAGS = [
  "new_construction",
  "whole_home_remodel",
  "kitchen_bath",
  "adu_addition",
  "teardown_rebuild",
  "commercial_residential",
] as const satisfies ReadonlyArray<ProjectMixTag>;

export const PROJECT_MIX_LABELS: Record<ProjectMixTag, string> = {
  new_construction: "New construction",
  whole_home_remodel: "Whole-home remodel",
  kitchen_bath: "Kitchen & bath",
  adu_addition: "ADUs / additions",
  teardown_rebuild: "Teardown / rebuild",
  commercial_residential: "Mixed-use commercial / residential",
};

/**
 * Normalize a raw city-list input (free text or array) into a deduped
 * list of clean city names. Operates without I/O.
 *
 * Rules:
 *   - Accept either a string (comma- or newline-separated) or an array.
 *   - Trim each token.
 *   - Drop empty tokens.
 *   - Cap each token at CITY_NAME_MAX_LENGTH characters.
 *   - Title-case each word inside the city ("menlo park" → "Menlo Park",
 *     "ATHERTON" → "Atherton"). Preserves multi-word cities and ", CA"
 *     suffixes.
 *   - Deduplicate case-insensitively (first occurrence wins).
 *
 * Returns the cleaned list. May be empty — the caller decides whether
 * empty is acceptable (validateScopeProfile rejects empty).
 */
export function normalizeCityList(input: unknown): string[] {
  let tokens: string[] = [];
  if (typeof input === "string") {
    // Prefer newline as the primary separator so "City, ST" pairs
    // survive as one token. Fall back to comma when the operator
    // typed a flat list ("Atherton, Menlo Park, Los Altos").
    if (/\n/.test(input)) {
      tokens = input.split(/\n+/);
    } else {
      tokens = input.split(/,/);
    }
  } else if (Array.isArray(input)) {
    tokens = input.map((v) => (typeof v === "string" ? v : ""));
  } else {
    return [];
  }

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > CITY_NAME_MAX_LENGTH) continue;
    const titleCased = titleCaseCity(trimmed);
    if (!titleCased) continue;
    const dedupKey = titleCased.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    cleaned.push(titleCased);
  }
  return cleaned;
}

/**
 * Title-case a city name, preserving "CA" / state-abbreviation tails.
 * "menlo park" → "Menlo Park"
 * "ATHERTON, ca" → "Atherton, CA"
 */
function titleCaseCity(s: string): string {
  // Split on comma to handle "City, ST" suffixes separately.
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  const cityPart = parts[0]
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .filter(Boolean)
    .join(" ");
  if (!cityPart) return "";
  if (parts.length === 1) return cityPart;
  // Treat any 2-letter trailing token as a state abbreviation.
  const tail = parts.slice(1).join(", ");
  if (/^[a-zA-Z]{2}$/.test(tail.trim())) {
    return `${cityPart}, ${tail.trim().toUpperCase()}`;
  }
  return `${cityPart}, ${tail}`;
}

/**
 * Type-guard for ProjectMixTag. Used both at validation time and as
 * the runtime allowlist for incoming arrays.
 */
export function isProjectMixTag(v: unknown): v is ProjectMixTag {
  return (
    typeof v === "string" &&
    (PROJECT_MIX_TAGS as ReadonlyArray<string>).includes(v)
  );
}

export type ScopeProfileInput = {
  /** Free-form (comma or newline separated) OR pre-split array. */
  cities: string | string[];
  /** Selected project_mix tags. May contain unknown values; validator
   *  drops them. */
  projectMix: string[];
};

export type ScopeProfileValidationResult =
  | {
      ok: true;
      normalized: { cities: string[]; projectMix: ProjectMixTag[] };
    }
  | {
      ok: false;
      errors: { cities?: string; projectMix?: string };
    };

/**
 * Validate + normalize the scope-step submitted form.
 *
 * Rules (North-star onboarding, 2026-06-11 — BOTH fields optional):
 *   - cities: 0..CITIES_MAX_COUNT after normalization. The wizard
 *     serves EVERY vertical — a content publisher or online business
 *     has no "cities served", and the old ≥1 rule forced them to
 *     invent fake geo data (a hard blocker on URL-only onboarding).
 *     When empty, launch falls back to the SITE-DERIVED locations
 *     (areaServed/address) for prompt generation; a business with
 *     neither simply starts with brand prompts.
 *   - projectMix: 0..6 known tags. The six tags are builder
 *     vocabulary — non-builders truthfully pick none, and the
 *     site-derived services now feed their prompts instead. Unknown
 *     tags are silently dropped (defense-in-depth against tampered
 *     POSTs; the form only emits known tags).
 */
export function validateScopeProfile(
  input: ScopeProfileInput,
): ScopeProfileValidationResult {
  const errors: { cities?: string; projectMix?: string } = {};

  const normalizedCities = normalizeCityList(input.cities);
  if (normalizedCities.length > CITIES_MAX_COUNT) {
    errors.cities = `Pick ${CITIES_MAX_COUNT} cities or fewer for now — you can add more after launch.`;
  }

  const filteredProjectMix = (Array.isArray(input.projectMix)
    ? input.projectMix
    : []
  ).filter(isProjectMixTag);
  // Dedupe project_mix while preserving order.
  const dedupedProjectMix: ProjectMixTag[] = [];
  const seenTags = new Set<ProjectMixTag>();
  for (const t of filteredProjectMix) {
    if (seenTags.has(t)) continue;
    seenTags.add(t);
    dedupedProjectMix.push(t);
  }

  if (errors.cities || errors.projectMix) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    normalized: {
      cities: normalizedCities.slice(0, CITIES_MAX_COUNT),
      projectMix: dedupedProjectMix,
    },
  };
}
