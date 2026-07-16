/**
 * Playbook Engine — pattern mining + brief generation + rollout queue.
 *
 * Mines repeatable patterns from validated changes and page scanner facts,
 * then generates execution-ready briefs and prioritized rollout suggestions.
 */

import type { PageSnapshot } from "./types";
import type { ScorecardRow } from "@/domains/attribution/scorecard";
import type { RolloutExecution, PatternEvidenceRecord } from "./issues";

// ── Types ──

export type PatternType =
  | "faq_schema_package"
  | "multi_schema_package"
  | "city_page_module"
  | "service_page_module"
  | "content_depth"
  | "internal_linking"
  | "structure_repair";

export type PatternStrength = "validated" | "probable" | "speculative";

export type ExecutionConfidence =
  | "execution_validated"
  | "execution_mixed"
  | "execution_weak"
  | "structurally_observed";

export type OutcomeMaturity =
  | "too_early"
  | "no_clear_impact"
  | "positive_signal"
  | "not_applicable";

export type PatternEvidence = {
  executionsTotal: number;
  executionsShipped: number;
  executionsVerified: number;
  executionsFailed: number;
  executionConfidence: ExecutionConfidence;
  outcomeMaturity: OutcomeMaturity;
  latestOutcome: string | null;
  latestVerifiedAt: string | null;
  evidenceSummary: string;
  trustBasis: string;
};

export type MinedPattern = {
  id: string;
  type: PatternType;
  name: string;
  description: string;
  strength: PatternStrength;
  sourcePages: { url: string; path: string; citations: number; faqCount: number; schemaTypes: string[] }[];
  avgCitations: number;
  avgFaqCount: number;
  components: string[];
  evidence: PatternEvidence;
};

function computePatternEvidence(
  patternId: string,
  executions: RolloutExecution[],
  evidenceRecords: PatternEvidenceRecord[] = []
): PatternEvidence {
  const records = evidenceRecords.filter((e) => e.sourcePatternId === patternId);
  const execs = executions.filter((e) => e.sourcePatternId === patternId);

  const useRecords = records.length > 0;
  const total = useRecords ? records.length : execs.length;
  const shipped = useRecords
    ? records.filter((r) => r.shippedAt).length
    : execs.filter((e) => e.shippedAt).length;
  const verified = useRecords
    ? records.filter((r) => r.outcomeStatus !== "shipped_not_verified" && r.outcomeStatus !== "verification_failed").length
    : execs.filter((e) => e.verifiedAt && e.verificationResult?.includes("resolved")).length;
  const failed = useRecords
    ? records.filter((r) => r.outcomeStatus === "verification_failed").length
    : execs.filter((e) => e.verifiedAt && !e.verificationResult?.includes("resolved")).length;

  let executionConfidence: ExecutionConfidence;
  if (verified >= 2) executionConfidence = "execution_validated";
  else if (verified >= 1 && failed === 0) executionConfidence = "execution_validated";
  else if (verified >= 1 && failed >= 1) executionConfidence = "execution_mixed";
  else if (shipped >= 1) executionConfidence = "execution_weak";
  else executionConfidence = "structurally_observed";

  let outcomeMaturity: OutcomeMaturity = "not_applicable";
  if (useRecords && records.some((r) => r.outcomeStatus === "structurally_verified_with_positive_signal")) {
    outcomeMaturity = "positive_signal";
  } else if (useRecords && records.some((r) => r.outcomeStatus === "structurally_verified_no_clear_impact_yet")) {
    outcomeMaturity = "no_clear_impact";
  } else if (useRecords && records.some((r) => r.outcomeStatus === "structurally_verified_outcome_too_early")) {
    outcomeMaturity = "too_early";
  } else if (verified > 0) {
    outcomeMaturity = "too_early";
  }

  const latestRecord = records.sort((a, b) => (b.verifiedAt ?? b.createdAt).localeCompare(a.verifiedAt ?? a.createdAt))[0];
  const latestExec = execs.sort((a, b) => (b.verifiedAt ?? b.createdAt).localeCompare(a.verifiedAt ?? a.createdAt))[0];

  let evidenceSummary: string;
  let trustBasis: string;

  if (total === 0) {
    evidenceSummary = "Structurally observed — no rollout executions yet";
    trustBasis = "Trust basis: structurally observed only";
  } else if (executionConfidence === "execution_validated") {
    const maturityNote = outcomeMaturity === "positive_signal"
      ? "; early positive citation signal"
      : outcomeMaturity === "no_clear_impact"
        ? "; visibility impact not yet clear"
        : "; visibility impact too early to judge";
    evidenceSummary = `${verified} verified rollout${verified !== 1 ? "s" : ""} across ${shipped} shipped${maturityNote}`;
    trustBasis = `Trust basis: structurally verified on ${verified} shipped rollout${verified !== 1 ? "s" : ""}${maturityNote}`;
  } else if (executionConfidence === "execution_mixed") {
    evidenceSummary = `Mixed: ${verified} verified, ${failed} failed out of ${shipped} shipped`;
    trustBasis = `Trust basis: mixed results — ${verified} verified, ${failed} not fixed`;
  } else if (executionConfidence === "execution_weak") {
    evidenceSummary = `${shipped} shipped, verification pending`;
    trustBasis = `Trust basis: ${shipped} shipped, structural verification pending`;
  } else {
    evidenceSummary = "Structurally observed — no rollout executions yet";
    trustBasis = "Trust basis: structurally observed only";
  }

  return {
    executionsTotal: total,
    executionsShipped: shipped,
    executionsVerified: verified,
    executionsFailed: failed,
    executionConfidence,
    outcomeMaturity,
    latestOutcome: latestRecord?.structuralVerificationResult ?? latestExec?.verificationResult ?? null,
    latestVerifiedAt: latestRecord?.verifiedAt ?? latestExec?.verifiedAt ?? null,
    evidenceSummary,
    trustBasis,
  };
}

export type BriefType = "fix" | "growth";

export type RolloutSpec = {
  componentType: PatternType;
  targetPage: string;
  requiredElements: string[];
  schemaPackage: string[];
  faqCountTarget: number;
  wordCountTarget: number | null;
  internalLinkTarget: number | null;
};

export type PlaybookBrief = {
  id: string;
  type: BriefType;
  title: string;
  pageUrl: string;
  pagePath: string;
  patternId: string;
  patternName: string;
  rationale: string;
  evidence: string[];
  recommendations: string[];
  verificationChecklist: string[];
  priority: number;
  citationOpportunity: number;
  structureGap: number;
  spec: RolloutSpec;
  sourcePages: { path: string; citations: number }[];
  gapTrigger: string;
  patternEvidence: PatternEvidence;
};

// ── Pattern Mining ──

export function minePatterns(
  snapshots: PageSnapshot[],
  citationsByUrl: Map<string, number>,
  scorecardRows: ScorecardRow[],
  executions: RolloutExecution[] = [],
  evidenceRecords: PatternEvidenceRecord[] = []
): MinedPattern[] {
  const patterns: MinedPattern[] = [];

  const pagesWithFaqSchema = snapshots.filter(
    (s) => s.faqs.length >= 6 && s.schema_types.includes("FAQPage")
  );
  const pagesWithMultiSchema = snapshots.filter(
    (s) => s.schema_types.length >= 3
  );

  const cityPages = snapshots.filter((s) => s.url.includes("/locations/"));
  const servicePages = snapshots.filter((s) => s.url.includes("/services/"));

  const toSource = (s: PageSnapshot) => ({
    url: s.url,
    path: s.url.replace(/^https?:\/\/[^/]+/, ""),
    citations: citationsByUrl.get(s.url.replace(/\/+$/, "").toLowerCase()) ?? 0,
    faqCount: s.faqs.length,
    schemaTypes: s.schema_types,
  });

  // FAQ + FAQPage schema package
  if (pagesWithFaqSchema.length >= 2) {
    const sources = pagesWithFaqSchema.map(toSource);
    const citedSources = sources.filter((s) => s.citations > 0);
    patterns.push({
      id: "pattern-faq-schema",
      type: "faq_schema_package",
      name: "FAQ + FAQPage Schema Package",
      description: "Add FAQ content block with FAQPage JSON-LD structured data. Validated across multiple pages with citation evidence.",
      strength: citedSources.length >= 2 ? "validated" : "probable",
      sourcePages: sources.sort((a, b) => b.citations - a.citations).slice(0, 5),
      avgCitations: sources.length > 0 ? Math.round(sources.reduce((s, p) => s + p.citations, 0) / sources.length) : 0,
      avgFaqCount: Math.round(sources.reduce((s, p) => s + p.faqCount, 0) / sources.length),
      components: [
        "FAQ content section with 6–12 relevant questions",
        "FAQPage JSON-LD schema block",
        "Questions targeting topic-specific search intent",
        "Answers with entity/location/service mentions",
      ],
      evidence: computePatternEvidence("pattern-faq-schema", executions, evidenceRecords),
    });
  }

  // Multi-schema package
  if (pagesWithMultiSchema.length >= 1) {
    const sources = pagesWithMultiSchema.map(toSource);
    patterns.push({
      id: "pattern-multi-schema",
      type: "multi_schema_package",
      name: "Multi-Schema Authority Package",
      description: "Add Article + FAQPage + Review + Service structured data. Strongest correlation with high citation counts.",
      strength: sources.some((s) => s.citations >= 100) ? "validated" : "probable",
      sourcePages: sources,
      avgCitations: Math.round(sources.reduce((s, p) => s + p.citations, 0) / sources.length),
      avgFaqCount: Math.round(sources.reduce((s, p) => s + p.faqCount, 0) / sources.length),
      components: [
        "Article JSON-LD for primary page content",
        "FAQPage JSON-LD for FAQ section",
        "Review JSON-LD for testimonials/ratings",
        "Service JSON-LD for service description",
      ],
      evidence: computePatternEvidence("pattern-multi-schema", executions, evidenceRecords),
    });
  }

  // City page module
  const strongCityPages = cityPages.filter(
    (s) => s.faqs.length >= 6 && s.schema_types.length > 0 && s.word_count >= 1500
  );
  if (strongCityPages.length >= 2) {
    const sources = strongCityPages.map(toSource);
    patterns.push({
      id: "pattern-city-page",
      type: "city_page_module",
      name: "City Page Structural Module",
      description: "Full city page structure: 1500+ words, FAQ block, FAQPage schema, location-specific content, internal linking.",
      strength: sources.filter((s) => s.citations >= 50).length >= 2 ? "validated" : "probable",
      sourcePages: sources.sort((a, b) => b.citations - a.citations).slice(0, 5),
      avgCitations: Math.round(sources.reduce((s, p) => s + p.citations, 0) / sources.length),
      avgFaqCount: Math.round(sources.reduce((s, p) => s + p.faqCount, 0) / sources.length),
      components: [
        "Hero with city-specific H1 and description",
        "Service/capability sections with local context",
        "FAQ block with 6+ city-specific questions",
        "FAQPage JSON-LD schema",
        "Internal links to related city/service pages",
        "1500+ words of location-relevant content",
      ],
      evidence: computePatternEvidence("pattern-city-page", executions, evidenceRecords),
    });
  }

  // Service page module
  const strongServicePages = servicePages.filter(
    (s) => s.faqs.length >= 6 && s.schema_types.length > 0
  );
  if (strongServicePages.length >= 2) {
    const sources = strongServicePages.map(toSource);
    patterns.push({
      id: "pattern-service-page",
      type: "service_page_module",
      name: "Service Page Structural Module",
      description: "Full service page structure: FAQ block, FAQPage schema, service-specific content, process sections.",
      strength: "probable",
      sourcePages: sources.sort((a, b) => b.citations - a.citations).slice(0, 5),
      avgCitations: Math.round(sources.reduce((s, p) => s + p.citations, 0) / sources.length),
      avgFaqCount: Math.round(sources.reduce((s, p) => s + p.faqCount, 0) / sources.length),
      components: [
        "Service-specific H1 and meta description",
        "Process/approach section",
        "FAQ block with 6+ service questions",
        "FAQPage JSON-LD schema",
        "Internal links to related services and locations",
      ],
      evidence: computePatternEvidence("pattern-service-page", executions, evidenceRecords),
    });
  }

  // Structure repair pattern (from pages that have high citations but weak structure)
  const weakHighCitation = snapshots.filter((s) => {
    const cit = citationsByUrl.get(s.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
    return cit >= 50 && s.faqs.length === 0 && s.schema_types.length === 0;
  });
  if (weakHighCitation.length > 0) {
    patterns.push({
      id: "pattern-structure-repair",
      type: "structure_repair",
      name: "Structure Repair for High-Citation Pages",
      description: "Pages with strong AI platform citations but zero structured data. Adding FAQ + schema will directly strengthen citation quality.",
      strength: "validated",
      sourcePages: weakHighCitation.map(toSource).sort((a, b) => b.citations - a.citations),
      avgCitations: Math.round(weakHighCitation.map(toSource).reduce((s, p) => s + p.citations, 0) / weakHighCitation.length),
      avgFaqCount: 0,
      components: [
        "FAQPage JSON-LD schema",
        "FAQ content section with 8–12 topic-relevant questions",
        "Verify JSON-LD survives client-side rendering",
        "Re-scan after deployment to confirm structure",
      ],
      evidence: computePatternEvidence("pattern-structure-repair", executions, evidenceRecords),
    });
  }

  return patterns.sort((a, b) => b.avgCitations - a.avgCitations);
}

// ── Brief Generation ──

function executionBoost(ev: PatternEvidence): number {
  let base: number;
  switch (ev.executionConfidence) {
    case "execution_validated": base = 100; break;
    case "execution_mixed": base = 30; break;
    case "execution_weak": base = 10; break;
    default: return 0;
  }
  if (ev.outcomeMaturity === "positive_signal") base += 80;
  else if (ev.outcomeMaturity === "too_early") base += 20;
  return base;
}

export function generateBriefs(
  snapshots: PageSnapshot[],
  citationsByUrl: Map<string, number>,
  patterns: MinedPattern[]
): PlaybookBrief[] {
  const briefs: PlaybookBrief[] = [];
  let nextId = 1;

  const faqPattern = patterns.find((p) => p.type === "faq_schema_package");
  const multiPattern = patterns.find((p) => p.type === "multi_schema_package");
  const cityPattern = patterns.find((p) => p.type === "city_page_module");
  const repairPattern = patterns.find((p) => p.type === "structure_repair");

  for (const snap of snapshots) {
    const url = snap.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const cit = citationsByUrl.get(url.replace(/\/+$/, "").toLowerCase()) ?? 0;
    const hasFaq = snap.faqs.length > 0;
    const hasSchema = snap.schema_types.length > 0;
    const isCity = url.includes("/locations/");
    const isService = url.includes("/services/");

    // Fix briefs: pages with weak structure + citations
    if (cit >= 10 && !hasFaq && !hasSchema && repairPattern) {
      briefs.push({
        id: `brief-fix-${nextId++}`,
        type: "fix",
        title: `Add FAQ + schema to ${path || "/"}`,
        pageUrl: url,
        pagePath: path,
        patternId: repairPattern.id,
        patternName: repairPattern.name,
        rationale: `${cit} citations with zero structured data. Adding FAQ + FAQPage schema is the highest-leverage fix.`,
        evidence: [
          `${cit} AI platform citations — page is actively referenced`,
          `0 FAQs, no JSON-LD schema detected`,
          `Pattern validated: pages with FAQ+schema avg ${faqPattern?.avgCitations ?? 0} citations`,
          repairPattern.evidence.executionsTotal > 0
            ? `Execution track record: ${repairPattern.evidence.evidenceSummary}`
            : `Trust basis: structurally observed — no rollout executions yet`,
        ],
        recommendations: [
          "Add 8–12 topic-relevant FAQ questions as an HTML section",
          "Add FAQPage JSON-LD schema matching the FAQ content",
          "Verify JSON-LD renders in both server HTML and client DOM",
          `Model after ${repairPattern.sourcePages.filter((s) => s.faqCount > 0)[0]?.path ?? "existing validated pages"}`,
        ],
        verificationChecklist: [
          "Page source contains <script type=\"application/ld+json\"> with FAQPage",
          "Browser DevTools Elements panel shows JSON-LD preserved after hydration",
          "Beacon page scanner shows FAQ count > 0 and schema present",
          "Beacon render check passes (raw = rendered)",
        ],
        priority: 1000 + cit + executionBoost(repairPattern.evidence),
        citationOpportunity: cit,
        structureGap: 1,
        spec: {
          componentType: "structure_repair",
          targetPage: url,
          requiredElements: ["FAQ HTML section", "FAQPage JSON-LD"],
          schemaPackage: ["FAQPage"],
          faqCountTarget: 10,
          wordCountTarget: null,
          internalLinkTarget: null,
        },
        sourcePages: repairPattern.sourcePages.filter((s) => s.faqCount > 0).slice(0, 3).map((s) => ({ path: s.path, citations: s.citations })),
        gapTrigger: `${cit} citations, 0 FAQ, 0 schema`,
        patternEvidence: repairPattern.evidence,
      });
    }

    // Fix briefs: pages with FAQ in HTML but missing schema
    if (hasFaq && !hasSchema && cit >= 5) {
      briefs.push({
        id: `brief-fix-${nextId++}`,
        type: "fix",
        title: `Add JSON-LD schema to ${path}`,
        pageUrl: url,
        pagePath: path,
        patternId: faqPattern?.id ?? "pattern-faq-schema",
        patternName: "FAQ Schema Addition",
        rationale: `Page has ${snap.faqs.length} FAQs but no structured data. Adding FAQPage JSON-LD will make existing content machine-readable.`,
        evidence: [
          `${snap.faqs.length} FAQ questions already exist in HTML`,
          `${cit} citations — AI platforms already reference this page`,
          `JSON-LD schema is missing — FAQ content is invisible to structured data consumers`,
          (faqPattern?.evidence.trustBasis ?? "Trust basis: structurally observed only"),
        ],
        recommendations: [
          "Add FAQPage JSON-LD matching existing FAQ HTML content",
          "Ensure JSON-LD questions/answers match visible FAQ section",
        ],
        verificationChecklist: [
          "Page source contains FAQPage JSON-LD",
          "JSON-LD question count matches visible FAQ count",
          "Beacon scanner confirms schema present",
        ],
        priority: 800 + cit + executionBoost(faqPattern?.evidence ?? { executionConfidence: "structurally_observed", executionsTotal: 0, executionsShipped: 0, executionsVerified: 0, executionsFailed: 0, outcomeMaturity: "not_applicable", latestOutcome: null, latestVerifiedAt: null, evidenceSummary: "", trustBasis: "Trust basis: structurally observed only" }),
        citationOpportunity: cit,
        structureGap: 0.5,
        spec: {
          componentType: "faq_schema_package",
          targetPage: url,
          requiredElements: ["FAQPage JSON-LD matching existing FAQ HTML"],
          schemaPackage: ["FAQPage"],
          faqCountTarget: snap.faqs.length,
          wordCountTarget: null,
          internalLinkTarget: null,
        },
        sourcePages: (faqPattern?.sourcePages ?? []).slice(0, 3).map((s) => ({ path: s.path, citations: s.citations })),
        gapTrigger: `${snap.faqs.length} FAQ in HTML, 0 schema`,
        patternEvidence: faqPattern?.evidence ?? { executionConfidence: "structurally_observed" as const, executionsTotal: 0, executionsShipped: 0, executionsVerified: 0, executionsFailed: 0, outcomeMaturity: "not_applicable" as const, latestOutcome: null, latestVerifiedAt: null, evidenceSummary: "Structurally observed", trustBasis: "Trust basis: structurally observed only" },
      });
    }

    // Growth briefs: replicate validated city page pattern to weak city pages
    if (isCity && cityPattern && !hasFaq && !hasSchema) {
      const bestCitySource = cityPattern.sourcePages[0];
      briefs.push({
        id: `brief-growth-${nextId++}`,
        type: "growth",
        title: `Apply city page pattern to ${path}`,
        pageUrl: url,
        pagePath: path,
        patternId: cityPattern.id,
        patternName: cityPattern.name,
        rationale: `Validated city page pattern (avg ${cityPattern.avgCitations} citations) can be applied here. This city page is currently missing FAQ and schema.`,
        evidence: [
          `City page pattern validated across ${cityPattern.sourcePages.length} pages`,
          `Best source: ${bestCitySource?.path} (${bestCitySource?.citations} citations, ${bestCitySource?.faqCount} FAQs)`,
          `This page: ${snap.word_count} words, ${snap.faqs.length} FAQs, no schema`,
          cityPattern.evidence.trustBasis,
        ],
        recommendations: cityPattern.components,
        verificationChecklist: [
          "FAQ section with 6+ city-specific questions added",
          "FAQPage JSON-LD schema present and correct",
          "Word count 1500+",
          "Internal links to related city/service pages present",
          "Beacon scanner confirms structure improvement",
        ],
        priority: 600 + cit + (snap.word_count < 1500 ? 100 : 0) + executionBoost(cityPattern.evidence),
        citationOpportunity: cit,
        structureGap: (hasFaq ? 0 : 0.5) + (hasSchema ? 0 : 0.5),
        spec: {
          componentType: "city_page_module",
          targetPage: url,
          requiredElements: ["City-specific hero", "FAQ section", "FAQPage JSON-LD", "Internal links"],
          schemaPackage: ["FAQPage"],
          faqCountTarget: cityPattern.avgFaqCount,
          wordCountTarget: 1500,
          internalLinkTarget: 30,
        },
        sourcePages: cityPattern.sourcePages.slice(0, 3).map((s) => ({ path: s.path, citations: s.citations })),
        gapTrigger: `City page missing ${!hasFaq ? "FAQ" : ""}${!hasFaq && !hasSchema ? " + " : ""}${!hasSchema ? "schema" : ""}`,
        patternEvidence: cityPattern.evidence,
      });
    }

    // Growth briefs: replicate multi-schema to high-citation pages with only basic schema
    if (multiPattern && cit >= 50 && hasSchema && snap.schema_types.length < 3) {
      briefs.push({
        id: `brief-growth-${nextId++}`,
        type: "growth",
        title: `Upgrade to multi-schema on ${path}`,
        pageUrl: url,
        pagePath: path,
        patternId: multiPattern.id,
        patternName: multiPattern.name,
        rationale: `Page has ${cit} citations and basic schema. Adding Article + Review + Service schema could strengthen AI platform understanding.`,
        evidence: [
          `Current schema: ${snap.schema_types.join(", ")}`,
          `Multi-schema pattern source: ${multiPattern.sourcePages[0]?.path} has ${multiPattern.sourcePages[0]?.schemaTypes.join(", ")} and ${multiPattern.sourcePages[0]?.citations} citations`,
          multiPattern.evidence.trustBasis,
        ],
        recommendations: multiPattern.components.filter(
          (c) => !snap.schema_types.some((t) => c.toLowerCase().includes(t.toLowerCase()))
        ),
        verificationChecklist: [
          "Multiple JSON-LD blocks present in page source",
          "Each schema type validates in Google Rich Results Test",
          "Beacon scanner shows updated schema types",
        ],
        priority: 400 + cit + executionBoost(multiPattern.evidence),
        citationOpportunity: cit,
        structureGap: 0.3,
        spec: {
          componentType: "multi_schema_package",
          targetPage: url,
          requiredElements: multiPattern.components.filter(
            (c) => !snap.schema_types.some((t) => c.toLowerCase().includes(t.toLowerCase()))
          ),
          schemaPackage: ["Article", "FAQPage", "Review", "Service"].filter(
            (t) => !snap.schema_types.includes(t)
          ),
          faqCountTarget: snap.faqs.length,
          wordCountTarget: null,
          internalLinkTarget: null,
        },
        sourcePages: multiPattern.sourcePages.slice(0, 3).map((s) => ({ path: s.path, citations: s.citations })),
        gapTrigger: `Has ${snap.schema_types.join(",")} but missing ${["Article", "FAQPage", "Review", "Service"].filter((t) => !snap.schema_types.includes(t)).join(", ")}`,
        patternEvidence: multiPattern.evidence,
      });
    }
  }

  return briefs.sort((a, b) => b.priority - a.priority);
}
