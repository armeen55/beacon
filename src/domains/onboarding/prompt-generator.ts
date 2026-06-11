/**
 * prompt-generator — Gap E.1 (2026-05-07).
 *
 * Deterministic, template-only starter prompt generator. Takes the
 * onboarding-collected fields (business_name, domain, cities,
 * project_mix, competitors) and emits up to 25 prompt drafts that
 * Beacon will start tracking once the operator launches the tenant.
 *
 * Constraints (operator-locked, pinned by tests):
 *   - 100% deterministic. Same input → same output.
 *   - 100% template-based. NO OpenAI / Perplexity / external API calls.
 *   - Pure function: no I/O, no env reads, no Supabase, no Next.js.
 *   - Caps total output at 25.
 *   - Never produces a row whose text is empty after trimming.
 *   - Never embeds raw enum tokens in customer-rendered text
 *     (uses the SERVICE_PROMPT_TERMS map below).
 *   - Never hardcodes Ritz-specific data (only template + input).
 *
 * Persistence policy (E.1): drafts are PREVIEW-ONLY. The generator
 * re-derives on every /onboard/review render. Persistence to
 * tracked_prompts is deferred to Gap C.4's Launch step so the cron
 * never sees a row for a pending tenant. (Today the cron is also
 * gated at the tenant level by Gap A's status='active' filter, but
 * we keep the second guard by simply not writing prompt rows yet.)
 *
 * Prompt families (priority-ordered):
 *   1. Brand discovery (2 prompts)         — "{name} reviews", "is {name} a good company"
 *   2. Competitor comparison (≤5)          — "{name} vs {competitor}"
 *   3. Service-in-city primary (1/combo)   — "best {service} in {city}"
 *   4. Service-in-city alt phrasings       — "top {service} companies in {city}", etc.
 *   5. Cost / permit / timeline (long-tail)— "how much does a {service} cost in {city}"
 *
 * Rationale field is operator-readable and customer-safe — never
 * surfaces tenant/admin/RLS/schema/Supabase/cron/GitHub language.
 */

import type { ProjectMixTag } from "@/domains/tenants/types";

export const STARTER_PROMPT_MAX_COUNT = 25;

export type PromptCategory =
  | "brand_discovery"
  | "competitor_comparison"
  | "service_in_city"
  | "cost_query";

export type PromptDraft = {
  /** The prompt text Beacon will pose to AI search engines. */
  text: string;
  /** Logical grouping (1:1 with category for v0; later: real cluster ids). */
  cluster: PromptCategory;
  /** City this prompt is scoped to, if any. Stored as the operator's
   *  display string (e.g. "Atherton, CA"). Null for non-geo prompts. */
  city_scope: string | null;
  /** Project-mix tag this prompt is scoped to, if any. */
  service_scope: ProjectMixTag | null;
  /** Coarse category for downstream UI grouping. Mirrors `cluster`. */
  category: PromptCategory;
  /** 1 = highest priority. Stable ordering for review-page rendering
   *  + later activation. */
  priority: number;
  /** Customer-safe one-liner explaining why this prompt matters. */
  rationale: string;
};

/**
 * Search-engine-friendly service phrasings keyed by ProjectMixTag.
 * These appear inside generated prompt text — keep them
 * homeowner-natural (avoid SEO jargon).
 */
const SERVICE_PROMPT_TERMS: Record<ProjectMixTag, string> = {
  new_construction: "custom home builder",
  whole_home_remodel: "home remodel",
  kitchen_bath: "kitchen remodel",
  adu_addition: "ADU builder",
  teardown_rebuild: "teardown and rebuild",
  commercial_residential: "design-build contractor",
};

/**
 * Strip a trailing ", ST" / ", State" so prompts read naturally.
 * "Atherton, CA" → "Atherton". Preserves comma-bearing names that
 * aren't a 2-letter state abbreviation (e.g. "Washington, D.C.").
 */
function stripStateAbbreviation(city: string): string {
  return city.replace(/,\s*[A-Za-z]{2}\s*$/, "").trim();
}

export type StarterPromptInput = {
  businessName: string;
  domain: string;
  citiesServed: string[];
  projectMix: ProjectMixTag[];
  competitors: string[];
  /**
   * North-star onboarding (2026-06-11) — SITE-DERIVED service phrases
   * (BusinessConfig.services, lowercase, any vertical). The builder-tag
   * path above only fires for the six ProjectMixTag verticals; these
   * fire for everyone — "best taco bar in Tucson" comes from the
   * stranger's own site, not from a Beacon vocabulary.
   */
  derivedServices?: string[];
  /** Site-derived industry label (e.g. "restaurant") — one extra
   *  industry-in-city prompt per city. */
  industry?: string | null;
};

/**
 * Generate a deterministic set of starter prompts from onboarding inputs.
 * Returns at most STARTER_PROMPT_MAX_COUNT (=25) drafts. Pure.
 */
export function generateStarterPrompts(
  input: StarterPromptInput,
): PromptDraft[] {
  const out: PromptDraft[] = [];
  const seen = new Set<string>();

  function add(p: Omit<PromptDraft, "priority">): void {
    if (out.length >= STARTER_PROMPT_MAX_COUNT) return;
    const trimmedText = p.text.trim();
    if (!trimmedText) return;
    const key = trimmedText.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ...p,
      text: trimmedText,
      priority: out.length + 1,
    });
  }

  const businessName = (input.businessName ?? "").trim();
  const cities = (input.citiesServed ?? []).filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0,
  );
  const services = (input.projectMix ?? []).filter(
    (s): s is ProjectMixTag => s in SERVICE_PROMPT_TERMS,
  );
  const competitors = (input.competitors ?? []).filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0,
  );

  // ── 1. Brand discovery ────────────────────────────────────────────
  // Highest priority because they fire on direct brand searches —
  // when the answer is "yes, this company is real and reviewed,"
  // it's pure upside.
  if (businessName) {
    add({
      text: `${businessName} reviews`,
      cluster: "brand_discovery",
      category: "brand_discovery",
      city_scope: null,
      service_scope: null,
      rationale:
        "Picks up how AI summarizes your reputation when someone searches your name.",
    });
    add({
      text: `is ${businessName} a good company`,
      cluster: "brand_discovery",
      category: "brand_discovery",
      city_scope: null,
      service_scope: null,
      rationale:
        "Surfaces the trust signals AI emphasizes for your brand.",
    });
  }

  // ── 2. Competitor comparison ──────────────────────────────────────
  // Direct head-to-head. Highest signal for the "who does AI think is
  // better than you" question.
  if (businessName) {
    for (const competitor of competitors) {
      add({
        text: `${businessName} vs ${competitor}`,
        cluster: "competitor_comparison",
        category: "competitor_comparison",
        city_scope: null,
        service_scope: null,
        rationale: `Direct comparison against ${competitor}.`,
      });
    }
  }

  // ── 3. Service-in-city primary ────────────────────────────────────
  // The broad funnel — homeowners typing "best X in Y" into ChatGPT.
  for (const service of services) {
    const term = SERVICE_PROMPT_TERMS[service];
    for (const city of cities) {
      const cityShort = stripStateAbbreviation(city);
      add({
        text: `best ${term} in ${cityShort}`,
        cluster: "service_in_city",
        category: "service_in_city",
        city_scope: city,
        service_scope: service,
        rationale: `Captures homeowners searching for ${term}s in ${cityShort}.`,
      });
    }
  }

  // ── 4. Service-in-city alternate phrasings ────────────────────────
  // Same intent, different wording. AI engines often answer these
  // with different rankings.
  const altTemplates: Array<(s: string, c: string) => string> = [
    (s, c) => `top ${s} companies in ${c}`,
    (s, c) => `who should I hire for a ${s} in ${c}`,
    (s, c) => `best company for ${s} near ${c}`,
  ];
  for (const tmpl of altTemplates) {
    for (const service of services) {
      const term = SERVICE_PROMPT_TERMS[service];
      for (const city of cities) {
        const cityShort = stripStateAbbreviation(city);
        add({
          text: tmpl(term, cityShort),
          cluster: "service_in_city",
          category: "service_in_city",
          city_scope: city,
          service_scope: service,
          rationale:
            "Same intent, different phrasing — AI often ranks results differently here.",
        });
      }
    }
  }

  // ── 5. Cost / long-tail (one per service, anchored on first city) ─
  if (cities.length > 0) {
    const anchorCity = stripStateAbbreviation(cities[0]);
    for (const service of services) {
      const term = SERVICE_PROMPT_TERMS[service];
      add({
        text: `how much does a ${term} cost in ${anchorCity}`,
        cluster: "cost_query",
        category: "cost_query",
        city_scope: cities[0],
        service_scope: service,
        rationale:
          "Cost questions reveal who AI labels as the affordable vs premium option.",
      });
    }
  }

  // ── 6. SITE-DERIVED services + industry (vertical-agnostic) ───────
  // North-star onboarding (2026-06-11): sections 3–5 only fire for the
  // six builder ProjectMixTags. These fire for ANY business from its
  // own site-derived config — a restaurant gets "best taco bar in
  // Tucson", a dentist gets "best teeth whitening in Reno". Dedup via
  // `add` means a builder whose derived phrases overlap the tag terms
  // never double-emits. Region codes ("TX") make awkward prompt cities
  // — only city-shaped names (>2 chars after state-strip) are used.
  const promptCities = cities.filter(
    (c) => stripStateAbbreviation(c).length > 2,
  );
  const derivedServices = (input.derivedServices ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3 && s.length <= 40)
    .slice(0, 8);
  const industry = (input.industry ?? "").trim().toLowerCase();

  if (industry && industry.length >= 3) {
    for (const city of promptCities) {
      add({
        text: `best ${industry} in ${stripStateAbbreviation(city)}`,
        cluster: "service_in_city",
        category: "service_in_city",
        city_scope: city,
        service_scope: null,
        rationale: `The broad "best ${industry}" question — the front door of AI recommendations.`,
      });
    }
  }

  for (const service of derivedServices) {
    for (const city of promptCities) {
      add({
        text: `best ${service} in ${stripStateAbbreviation(city)}`,
        cluster: "service_in_city",
        category: "service_in_city",
        city_scope: city,
        service_scope: null,
        rationale: `Captures people searching for ${service} — derived from your own site.`,
      });
    }
  }

  if (promptCities.length > 0 && derivedServices.length > 0) {
    const anchor = promptCities[0]!;
    add({
      text: `how much does ${derivedServices[0]} cost in ${stripStateAbbreviation(anchor)}`,
      cluster: "cost_query",
      category: "cost_query",
      city_scope: anchor,
      service_scope: null,
      rationale:
        "Cost questions reveal who AI labels as the affordable vs premium option.",
    });
  }

  return out;
}
