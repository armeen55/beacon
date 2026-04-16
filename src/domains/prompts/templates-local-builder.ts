/**
 * CX2.1 — Prompt template library for local residential builders.
 *
 * ~100 prompt templates with {variables} that the renderer (CX2.2) fills
 * from a tenant's BeaconTenant profile. Templates are stratified:
 *
 *   ~35 brand_category  — "who is the best X in Y"
 *   ~25 geography       — city-specific queries
 *   ~20 project_type    — remodel/ADU/new construction
 *   ~12 long_tail       — budget/lot/timeline/permits
 *   ~8  comparative     — "X vs Y", "compare builders"
 *
 * Each template carries an id, version=1, and content_hash computed at
 * module load. PromptDefinition is the CX2 contract; these are the seed.
 *
 * Variables available to the renderer:
 *   {city}          — from tenant.cities_served
 *   {business}      — tenant.business_name
 *   {service}       — inferred from project_mix
 *   {project_type}  — from tenant.project_mix tags
 *   {budget}        — from tenant.budget_range label
 *   {competitor}    — from tenant.discovered_competitors
 */

import type { PromptDefinition, PromptStrata } from "./contracts";
import { hashPromptTemplate } from "./contracts";

// ---------------------------------------------------------------------------
// Raw templates (text only — converted to PromptDefinition at bottom)
// ---------------------------------------------------------------------------

type RawTemplate = {
  id: string;
  template: string;
  topic_cluster: string;
  strata: PromptStrata;
};

const RAW_TEMPLATES: RawTemplate[] = [
  // ═══════════════════════════════════════════════════════════════════
  // BRAND CATEGORY (~35)
  // ═══════════════════════════════════════════════════════════════════
  { id: "bc-best-builder", template: "Who are the best custom home builders in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-top-builder", template: "What are the top-rated home builders in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-luxury-builder", template: "Who are the best luxury home builders in {city}?", topic_cluster: "luxury_home_builder", strata: "brand_category" },
  { id: "bc-recommended-builder", template: "Which home builder would you recommend in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-hire-builder", template: "I want to build a custom home in {city}. Which builder should I hire?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-reputable-builder", template: "Who are the most reputable residential builders in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-high-end-builder", template: "Which builders in {city} specialize in high-end custom homes?", topic_cluster: "luxury_home_builder", strata: "brand_category" },
  { id: "bc-trusted-gc", template: "Who are the most trusted general contractors in {city} for residential projects?", topic_cluster: "general_contractor", strata: "brand_category" },
  { id: "bc-best-gc", template: "Best general contractor for home building in {city}?", topic_cluster: "general_contractor", strata: "brand_category" },
  { id: "bc-find-builder", template: "How do I find a good home builder in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-reliable-builder", template: "Who is the most reliable custom home builder in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-design-build", template: "Best design-build firms for custom homes in {city}?", topic_cluster: "design_build", strata: "brand_category" },
  { id: "bc-award-winning", template: "Which home builders in {city} have won awards for their work?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-experienced-builder", template: "Which builders in {city} have the most experience with residential projects?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-modern-builder", template: "Who builds the best modern custom homes in {city}?", topic_cluster: "modern_home", strata: "brand_category" },
  { id: "bc-family-builder", template: "Which builder in {city} is best for building a family home?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-local-builder", template: "Who are the best local home builders in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-green-builder", template: "Which builders in {city} specialize in energy-efficient or green homes?", topic_cluster: "green_building", strata: "brand_category" },
  { id: "bc-premier-builder", template: "Who is the premier home builder in {city}?", topic_cluster: "luxury_home_builder", strata: "brand_category" },
  { id: "bc-residential-gc", template: "Top residential general contractors in {city}?", topic_cluster: "general_contractor", strata: "brand_category" },
  { id: "bc-builder-reviews", template: "Which home builders in {city} have the best reviews?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-new-home-builder", template: "Who should I hire to build a new home in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-custom-home-firm", template: "Best custom home building firms in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-hillside-builder", template: "Which builders in {city} have experience with hillside or sloped lot construction?", topic_cluster: "hillside", strata: "brand_category" },
  { id: "bc-builder-portfolio", template: "Which home builders in {city} have the best project portfolios?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-transparent-builder", template: "Which builders in {city} are known for transparent pricing?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-architect-recommend", template: "Which home builder would an architect recommend in {city}?", topic_cluster: "design_build", strata: "brand_category" },
  { id: "bc-quality-builder", template: "Who builds the highest quality custom homes in {city}?", topic_cluster: "luxury_home_builder", strata: "brand_category" },
  { id: "bc-smart-home-builder", template: "Which builders in {city} integrate smart home technology?", topic_cluster: "smart_home", strata: "brand_category" },
  { id: "bc-boutique-builder", template: "Best boutique home builders in {city}?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-spec-builder", template: "Who are the top spec home builders in {city}?", topic_cluster: "spec_builder", strata: "brand_category" },
  { id: "bc-licensed-builder", template: "Which licensed general contractors in {city} specialize in custom homes?", topic_cluster: "general_contractor", strata: "brand_category" },
  { id: "bc-full-service", template: "Full-service home builders in {city} that handle design through construction?", topic_cluster: "design_build", strata: "brand_category" },
  { id: "bc-builder-on-time", template: "Which home builders in {city} are known for finishing on time and on budget?", topic_cluster: "custom_home_builder", strata: "brand_category" },
  { id: "bc-builder-communicate", template: "Which builders in {city} are best at communicating with homeowners during the build?", topic_cluster: "custom_home_builder", strata: "brand_category" },

  // ═══════════════════════════════════════════════════════════════════
  // GEOGRAPHY (~25)
  // ═══════════════════════════════════════════════════════════════════
  { id: "geo-builder-city", template: "Home builders in {city}", topic_cluster: "custom_home_builder", strata: "geography" },
  { id: "geo-remodel-city", template: "Best remodeling contractors in {city}", topic_cluster: "remodel", strata: "geography" },
  { id: "geo-construction-city", template: "{city} residential construction companies", topic_cluster: "general_contractor", strata: "geography" },
  { id: "geo-new-construction", template: "New home construction in {city}", topic_cluster: "new_construction", strata: "geography" },
  { id: "geo-renovation-city", template: "Home renovation contractors in {city}", topic_cluster: "remodel", strata: "geography" },
  { id: "geo-build-cost", template: "How much does it cost to build a custom home in {city}?", topic_cluster: "cost", strata: "geography" },
  { id: "geo-remodel-cost", template: "How much does a whole home renovation cost in {city}?", topic_cluster: "cost", strata: "geography" },
  { id: "geo-permit-city", template: "What permits do I need to build a house in {city}?", topic_cluster: "permits", strata: "geography" },
  { id: "geo-build-time", template: "How long does it take to build a custom home in {city}?", topic_cluster: "timeline", strata: "geography" },
  { id: "geo-remodel-time", template: "How long does a full home remodel take in {city}?", topic_cluster: "timeline", strata: "geography" },
  { id: "geo-zoning-city", template: "What are the zoning rules for building a new home in {city}?", topic_cluster: "permits", strata: "geography" },
  { id: "geo-adu-city", template: "Can I build an ADU in {city}? What are the rules?", topic_cluster: "adu", strata: "geography" },
  { id: "geo-teardown-city", template: "Should I tear down and rebuild my home in {city} or renovate?", topic_cluster: "teardown", strata: "geography" },
  { id: "geo-lot-city", template: "I have an empty lot in {city}. Which builder should I hire?", topic_cluster: "new_construction", strata: "geography" },
  { id: "geo-neighborhood-build", template: "Best neighborhoods in {city} for building a new home?", topic_cluster: "new_construction", strata: "geography" },
  { id: "geo-luxury-neighborhood", template: "Which areas in {city} are best for luxury home construction?", topic_cluster: "luxury_home_builder", strata: "geography" },
  { id: "geo-historic-renovation", template: "Builders in {city} that specialize in historic home renovation?", topic_cluster: "remodel", strata: "geography" },
  { id: "geo-builder-near-me", template: "Custom home builders near {city}", topic_cluster: "custom_home_builder", strata: "geography" },
  { id: "geo-addition-city", template: "Home addition contractors in {city}", topic_cluster: "adu", strata: "geography" },
  { id: "geo-kitchen-remodel", template: "Best kitchen remodel contractors in {city}?", topic_cluster: "kitchen_bath", strata: "geography" },
  { id: "geo-bath-remodel", template: "Bathroom renovation specialists in {city}?", topic_cluster: "kitchen_bath", strata: "geography" },
  { id: "geo-outdoor-living", template: "Who builds the best outdoor living spaces in {city}?", topic_cluster: "outdoor_living", strata: "geography" },
  { id: "geo-pool-house", template: "Pool house builders in {city}?", topic_cluster: "outdoor_living", strata: "geography" },
  { id: "geo-builder-process", template: "What is the home building process like in {city}?", topic_cluster: "timeline", strata: "geography" },
  { id: "geo-builder-landscape", template: "Home builders in {city} that also do landscaping?", topic_cluster: "custom_home_builder", strata: "geography" },

  // ═══════════════════════════════════════════════════════════════════
  // PROJECT TYPE (~20)
  // ═══════════════════════════════════════════════════════════════════
  { id: "pt-new-construction", template: "Which builders in {city} specialize in {project_type}?", topic_cluster: "project_specialization", strata: "project_type" },
  { id: "pt-remodel-specialist", template: "Who is the best contractor in {city} for a {project_type}?", topic_cluster: "remodel", strata: "project_type" },
  { id: "pt-adu-builder", template: "Best ADU builders in {city}?", topic_cluster: "adu", strata: "project_type" },
  { id: "pt-adu-cost", template: "How much does it cost to build an ADU in {city}?", topic_cluster: "adu", strata: "project_type" },
  { id: "pt-teardown-rebuild", template: "Tear down and rebuild contractors in {city}?", topic_cluster: "teardown", strata: "project_type" },
  { id: "pt-kitchen-contractor", template: "Best contractor for a kitchen remodel in {city}?", topic_cluster: "kitchen_bath", strata: "project_type" },
  { id: "pt-bath-contractor", template: "Who should I hire for a bathroom renovation in {city}?", topic_cluster: "kitchen_bath", strata: "project_type" },
  { id: "pt-whole-home-remodel", template: "Contractors for a whole home remodel in {city}?", topic_cluster: "remodel", strata: "project_type" },
  { id: "pt-addition-contractor", template: "Home addition contractors in {city}?", topic_cluster: "adu", strata: "project_type" },
  { id: "pt-second-story", template: "Who can add a second story to my home in {city}?", topic_cluster: "adu", strata: "project_type" },
  { id: "pt-garage-conversion", template: "Garage conversion contractors in {city}?", topic_cluster: "adu", strata: "project_type" },
  { id: "pt-open-floorplan", template: "Contractors in {city} who specialize in opening up floor plans?", topic_cluster: "remodel", strata: "project_type" },
  { id: "pt-aging-in-place", template: "Builders in {city} for aging-in-place home modifications?", topic_cluster: "accessibility", strata: "project_type" },
  { id: "pt-fire-rebuild", template: "Contractors in {city} experienced with fire damage rebuild?", topic_cluster: "teardown", strata: "project_type" },
  { id: "pt-seismic-retrofit", template: "Seismic retrofit contractors in {city}?", topic_cluster: "technical", strata: "project_type" },
  { id: "pt-basement-finish", template: "Basement finishing contractors in {city}?", topic_cluster: "remodel", strata: "project_type" },
  { id: "pt-exterior-remodel", template: "Exterior remodel specialists in {city}?", topic_cluster: "remodel", strata: "project_type" },
  { id: "pt-multi-unit", template: "Builders in {city} for multi-unit residential projects?", topic_cluster: "commercial_residential", strata: "project_type" },
  { id: "pt-custom-plans", template: "I have architectural plans for a home in {city}. Which builder is best?", topic_cluster: "custom_home_builder", strata: "project_type" },
  { id: "pt-spec-home", template: "Which builders in {city} build spec homes?", topic_cluster: "spec_builder", strata: "project_type" },

  // ═══════════════════════════════════════════════════════════════════
  // LONG TAIL (~12)
  // ═══════════════════════════════════════════════════════════════════
  { id: "lt-budget-1m", template: "Custom home builders in {city} for a $1 million budget?", topic_cluster: "cost", strata: "long_tail" },
  { id: "lt-budget-2m", template: "Who can build a custom home in {city} for around $2 million?", topic_cluster: "cost", strata: "long_tail" },
  { id: "lt-budget-5m", template: "Luxury home builders in {city} for a $5 million+ project?", topic_cluster: "cost", strata: "long_tail" },
  { id: "lt-budget-remodel", template: "How much should I budget for a whole home remodel in {city}?", topic_cluster: "cost", strata: "long_tail" },
  { id: "lt-cost-sqft", template: "What is the cost per square foot to build a home in {city}?", topic_cluster: "cost", strata: "long_tail" },
  { id: "lt-sloped-lot", template: "Builders in {city} experienced with building on steep or sloped lots?", topic_cluster: "hillside", strata: "long_tail" },
  { id: "lt-narrow-lot", template: "Building a custom home on a narrow lot in {city} — who should I hire?", topic_cluster: "custom_home_builder", strata: "long_tail" },
  { id: "lt-timeline-6mo", template: "Can I build a custom home in {city} in 6 months?", topic_cluster: "timeline", strata: "long_tail" },
  { id: "lt-timeline-year", template: "How long does it take to build a 3000 sq ft home in {city}?", topic_cluster: "timeline", strata: "long_tail" },
  { id: "lt-permit-timeline", template: "How long does the permitting process take for new construction in {city}?", topic_cluster: "permits", strata: "long_tail" },
  { id: "lt-builder-insurance", template: "What insurance should a home builder in {city} carry?", topic_cluster: "due_diligence", strata: "long_tail" },
  { id: "lt-builder-questions", template: "What questions should I ask when interviewing home builders in {city}?", topic_cluster: "due_diligence", strata: "long_tail" },

  // ═══════════════════════════════════════════════════════════════════
  // COMPARATIVE (~8)
  // ═══════════════════════════════════════════════════════════════════
  { id: "cmp-vs-competitor", template: "{business} vs {competitor} — which builder is better in {city}?", topic_cluster: "comparison", strata: "comparative" },
  { id: "cmp-top-3", template: "Compare the top 3 home builders in {city}", topic_cluster: "comparison", strata: "comparative" },
  { id: "cmp-design-build-vs-gc", template: "Should I hire a design-build firm or a separate architect and general contractor in {city}?", topic_cluster: "design_build", strata: "comparative" },
  { id: "cmp-remodel-vs-rebuild", template: "In {city}, is it better to remodel or tear down and rebuild?", topic_cluster: "teardown", strata: "comparative" },
  { id: "cmp-adu-vs-addition", template: "ADU vs home addition in {city} — which is a better investment?", topic_cluster: "adu", strata: "comparative" },
  { id: "cmp-custom-vs-spec", template: "Custom build vs buying a spec home in {city}?", topic_cluster: "spec_builder", strata: "comparative" },
  { id: "cmp-national-vs-local", template: "Should I hire a national builder or a local builder in {city}?", topic_cluster: "custom_home_builder", strata: "comparative" },
  { id: "cmp-builder-rankings", template: "Rank the best home builders in {city} from best to worst", topic_cluster: "comparison", strata: "comparative" },
];

// ---------------------------------------------------------------------------
// Convert to PromptDefinition with version + hash
// ---------------------------------------------------------------------------

export const BUILDER_PROMPT_TEMPLATES: PromptDefinition[] = RAW_TEMPLATES.map(
  (raw): PromptDefinition => ({
    id: raw.id,
    version: 1,
    content_hash: hashPromptTemplate(raw.template),
    template: raw.template,
    topic_cluster: raw.topic_cluster,
    strata: raw.strata,
    is_active: true,
  }),
);

// ---------------------------------------------------------------------------
// Strata counts (for validation)
// ---------------------------------------------------------------------------

export function getTemplatesByStrata(): Record<PromptStrata, number> {
  const counts: Record<string, number> = {};
  for (const t of BUILDER_PROMPT_TEMPLATES) {
    counts[t.strata] = (counts[t.strata] ?? 0) + 1;
  }
  return counts as Record<PromptStrata, number>;
}

export function getTemplateCount(): number {
  return BUILDER_PROMPT_TEMPLATES.length;
}
