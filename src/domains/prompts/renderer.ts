/**
 * CX2.2 — Prompt renderer.
 *
 * Takes a tenant's BeaconTenant profile + the template library and
 * produces a deterministic set of rendered prompts for an audit run.
 *
 * Rendering fills {variables} from tenant fields:
 *   {city}          → tenant.cities_served (one per rendered prompt)
 *   {business}      → tenant.business_name
 *   {service}       → inferred service label from project_mix
 *   {project_type}  → human-readable project_mix label
 *   {budget}        → human-readable budget_range label
 *   {competitor}    → from tenant.discovered_competitors
 *
 * Sampling: a builder with 11 cities × 100 templates = 1100 possible
 * renderings. We cap at ~120 per run by sampling proportionally across
 * strata, weighted by the tenant's project_mix.
 *
 * Determinism: the sampler is seeded by `tenantId + date` so the same
 * tenant on the same day always gets the same prompt set.
 */

import type { BeaconTenant } from "@/domains/tenants/types";
import type { PromptDefinition, PromptStrata } from "./contracts";
import { BUILDER_PROMPT_TEMPLATES } from "./templates-local-builder";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_PROMPTS_PER_RUN = 120;

const PROJECT_MIX_LABELS: Record<string, string> = {
  new_construction: "new home construction",
  whole_home_remodel: "whole home remodel",
  kitchen_bath: "kitchen and bathroom remodel",
  adu_addition: "ADU or home addition",
  teardown_rebuild: "tear down and rebuild",
  commercial_residential: "multi-unit residential",
};

const BUDGET_LABELS: Record<string, string> = {
  under_1m: "under $1 million",
  "1m_5m": "$1-5 million",
  "5m_plus": "$5 million+",
  mixed: "various budgets",
};

// ---------------------------------------------------------------------------
// Variable substitution
// ---------------------------------------------------------------------------

export type RenderedPrompt = {
  /** Unique key for dedup: `${definition.id}::${city}::${platform}` */
  rendering_key: string;
  /** The PromptDefinition this was rendered from. */
  definition: PromptDefinition;
  /** The fully rendered prompt text (variables filled). */
  text: string;
  /** Which city this rendering targets (if template uses {city}). */
  city: string | null;
  /** Which competitor this rendering references (if template uses {competitor}). */
  competitor: string | null;
};

function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Deterministic seeded random (simple mulberry32)
// ---------------------------------------------------------------------------

function seedFromString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * Render prompts for a tenant's audit run.
 *
 * Returns up to `MAX_PROMPTS_PER_RUN` rendered prompts, sampled
 * proportionally across strata and deterministically seeded by
 * tenantId + date.
 */
export function renderPromptsForTenant(opts: {
  tenant: BeaconTenant;
  date?: string;
  maxPrompts?: number;
  templates?: PromptDefinition[];
}): RenderedPrompt[] {
  const {
    tenant,
    date = new Date().toISOString().slice(0, 10),
    maxPrompts = MAX_PROMPTS_PER_RUN,
    templates = BUILDER_PROMPT_TEMPLATES.filter((t) => t.is_active),
  } = opts;

  const rng = mulberry32(seedFromString(`${tenant.id}::${date}`));
  const cities = tenant.cities_served.length > 0
    ? tenant.cities_served
    : ["your area"];
  const competitors = tenant.discovered_competitors;
  const projectTypes = tenant.project_mix
    .map((p) => PROJECT_MIX_LABELS[p])
    .filter(Boolean);
  const budgetLabel = BUDGET_LABELS[tenant.budget_range] ?? "various budgets";

  // Generate all possible renderings.
  const allRendered: RenderedPrompt[] = [];

  for (const def of templates) {
    const needsCity = def.template.includes("{city}");
    const needsCompetitor = def.template.includes("{competitor}");
    const needsProjectType = def.template.includes("{project_type}");

    const cityList = needsCity ? cities : [null];
    const competitorList = needsCompetitor
      ? competitors.length > 0
        ? competitors.slice(0, 3) // cap competitor variants
        : [] // skip comparative prompts if no competitors known yet
      : [null];
    const projectTypeList = needsProjectType
      ? projectTypes.length > 0
        ? projectTypes
        : ["custom home construction"]
      : [null];

    for (const city of cityList) {
      for (const competitor of competitorList) {
        for (const projectType of projectTypeList) {
          const vars: Record<string, string> = {
            business: tenant.business_name,
            service: projectTypes[0] ?? "custom home construction",
            budget: budgetLabel,
          };
          if (city) vars.city = city;
          if (competitor) vars.competitor = competitor;
          if (projectType) vars.project_type = projectType;

          const text = fillTemplate(def.template, vars);
          const rendering_key = `${def.id}::${city ?? "none"}::${competitor ?? "none"}`;

          allRendered.push({
            rendering_key,
            definition: def,
            text,
            city: city ?? null,
            competitor: competitor ?? null,
          });
        }
      }
    }
  }

  // Deduplicate by rendered text.
  const seen = new Set<string>();
  const deduped = allRendered.filter((r) => {
    if (seen.has(r.text)) return false;
    seen.add(r.text);
    return true;
  });

  // If under cap, return all.
  if (deduped.length <= maxPrompts) return deduped;

  // Sample proportionally across strata.
  const byStrata = new Map<PromptStrata, RenderedPrompt[]>();
  for (const r of deduped) {
    const list = byStrata.get(r.definition.strata) ?? [];
    list.push(r);
    byStrata.set(r.definition.strata, list);
  }

  const result: RenderedPrompt[] = [];
  const strataKeys = [...byStrata.keys()];
  const totalAvailable = deduped.length;

  for (const strata of strataKeys) {
    const pool = shuffle(byStrata.get(strata)!, rng);
    const proportion = pool.length / totalAvailable;
    const take = Math.max(1, Math.round(proportion * maxPrompts));
    result.push(...pool.slice(0, take));
  }

  // Trim to cap (rounding may overshoot slightly).
  return shuffle(result, rng).slice(0, maxPrompts);
}
