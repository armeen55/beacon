/**
 * tenant-profile — the works-for-ANY-business profile engine (2026-07-06).
 *
 * The one place that answers "what kind of business is this, and what markets +
 * services does it have?" for ANY tenant, from the tenant's OWN data, with ZERO
 * manual config and ZERO tenant hardcoding:
 *
 *   {industry, businessType, services[], serviceAreas[], confidence, evidence}
 *
 * It FUSES three already-persisted, $0 substrates (no live crawl, no paid API):
 *   1. page_snapshots — the site's real pages (schema types, nav/service terms,
 *      headings, address/area locations) captured by the crawler.
 *   2. GSC top queries — the place names + intent people actually type.
 *   3. the current BusinessConfig — the site-derived profile from launch, plus
 *      any operator overrides (which are PINNED — never clobbered).
 *
 * The pure classifiers do the thinking (business-type.ts, detect-service-
 * areas.ts); this module is the fail-soft I/O wrapper that assembles their
 * inputs from the substrates and hands back a verdict the launch flow, the
 * settings screen, and the nightly refresh all consume.
 *
 * Empty-safe: a tenant with no snapshots and no GSC still returns a verdict
 * built from config alone (or an honest "other" when there is nothing). A
 * content site yields businessType=content_publisher + empty serviceAreas, so
 * the local engine no-ops — byte-identical to a world without this module.
 */

import "server-only";

import { getBusinessConfig, type BusinessConfig } from "@/lib/business-config";
import { getRepository } from "@/lib/persistence/repositories";
import type { PageSnapshot } from "@/domains/pages/types";
import type { DerivedBusinessProfile } from "./derive-business-profile";
import {
  classifyBusinessType,
  segmentForBusinessType,
  type BusinessType,
  type BusinessTypeConfidence,
  type QuerySignal,
} from "./business-type";
import {
  detectServiceAreas,
  type ServiceAreaSignal,
} from "./detect-service-areas";

export type TenantProfile = {
  industry: string;
  businessType: BusinessType;
  services: string[];
  serviceAreas: string[];
  confidence: BusinessTypeConfidence;
  /** Plain-English reasons, ready to show the operator. */
  evidence: string[];
  /** The segment this type implies (null when ambiguous → keep default). */
  suggestedSegment: "local_service" | "content_publisher" | null;
};

/** Optional injectable LLM classifier — capped + fail-soft. The DEFAULT is a
 *  no-op that returns null, so the deterministic heuristic is the real engine
 *  and tests never touch the network. A live wiring can pass one later. */
export type BusinessTypeLlm = (input: {
  industry: string | null;
  schemaTypes: string[];
  services: string[];
  topQueries: string[];
}) => Promise<{ businessType: BusinessType; confidence: BusinessTypeConfidence } | null>;

const NO_LLM: BusinessTypeLlm = async () => null;

export type DeriveTenantProfileArgs = {
  tenantId: string;
  /** The launch-time site-derived profile, when available (launch path). The
   *  nightly path omits it and rebuilds signals from persisted snapshots. */
  profile?: DerivedBusinessProfile | null;
  /** Injected for tests. Defaults to the real substrate readers. */
  loadSnapshots?: (tenantId: string) => Promise<PageSnapshot[]>;
  loadTopQueries?: (tenantId: string) => Promise<QuerySignal[]>;
  /** Injected LLM classifier (capped, fail-soft). Default: no-op → heuristic. */
  llm?: BusinessTypeLlm;
};

async function defaultLoadSnapshots(tenantId: string): Promise<PageSnapshot[]> {
  try {
    return await getRepository().forTenant(tenantId).getPageSnapshots();
  } catch {
    return [];
  }
}

async function defaultLoadTopQueries(tenantId: string): Promise<QuerySignal[]> {
  try {
    const { loadGscPageSignalsForTenant } = await import(
      "@/domains/recommendation-intelligence/gsc-page-signals"
    );
    const signals = await loadGscPageSignalsForTenant(tenantId);
    // Flatten the per-page top queries into one impressions-ranked list, deduping
    // by query text (sum impressions across pages the query appears on).
    const byQuery = new Map<string, number>();
    for (const sig of signals.values()) {
      for (const q of sig.topQueries ?? []) {
        const key = q.query.trim().toLowerCase();
        if (!key) continue;
        byQuery.set(key, (byQuery.get(key) ?? 0) + (Number.isFinite(q.impressions) ? q.impressions : 0));
      }
    }
    return [...byQuery.entries()]
      .map(([query, impressions]) => ({ query, impressions }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 200);
  } catch {
    return [];
  }
}

/**
 * Build a DerivedBusinessProfile-shaped signal bundle from persisted page
 * snapshots + the current config, for the nightly path where no launch profile
 * exists. Pure over its inputs. Fuses schema types, service/nav vocabulary, and
 * physical-presence signals from the config (address/phone) so the classifier
 * has the same shape it gets at launch.
 */
export function profileFromSnapshotsAndConfig(
  snapshots: ReadonlyArray<PageSnapshot>,
  config: BusinessConfig,
): DerivedBusinessProfile {
  const schemaTypes = new Set<string>();
  const services = new Set<string>();
  const locations = new Set<string>();
  let sawContentSchema = false;
  const editorialUrls = new Set<string>();

  const CONTENT = new Set([
    "Article", "NewsArticle", "BlogPosting", "Blog", "ScholarlyArticle", "TechArticle", "Report",
  ]);

  for (const s of snapshots) {
    for (const t of s.schema_types ?? []) {
      schemaTypes.add(t);
      if (CONTENT.has(t)) sawContentSchema = true;
    }
    for (const term of s.service_terms ?? []) {
      const v = term.trim().toLowerCase();
      if (v) services.add(v);
    }
    for (const term of s.location_terms ?? []) {
      const v = term.trim().toLowerCase();
      if (v) locations.add(v);
    }
    for (const name of s.schema_entity_names ?? []) {
      const v = name.trim().toLowerCase();
      if (v && v.length <= 60) services.add(v);
    }
    // Cold-start fallback for publishers that need schema precisely because
    // they do not have it yet. Require a portfolio of substantial, structured
    // pages with no local-service/location signal; this cannot be triggered by
    // one incidental company blog post.
    if (
      (s.word_count ?? 0) >= 500 &&
      (s.h2_list ?? []).length >= 2 &&
      (s.service_terms ?? []).length === 0 &&
      (s.location_terms ?? []).length === 0
    ) {
      editorialUrls.add(s.url);
    }
  }

  // Config-declared services/locations fold in (operator ground truth).
  for (const s of config.services ?? []) {
    const v = s.trim().toLowerCase();
    if (v) services.add(v);
  }
  for (const l of config.locations ?? []) {
    const v = l.trim().toLowerCase();
    if (v) locations.add(v);
  }

  const address = (config.address ?? "").trim() || null;
  const phone = (config.phone ?? "").trim() || null;

  return {
    name: config.name || null,
    nameSource: null,
    description: null,
    industry: config.industry || null,
    schemaTypes: [...schemaTypes],
    phone,
    address,
    locations: [...locations],
    services: [...services].slice(0, 40),
    keyPages: config.keyPages ?? [],
    socialProfiles: [],
    // A content-schema site OR a strong five-page editorial portfolio is only a
    // content publisher when it has no physical presence. Five pages keeps the
    // post-crawl inference conservative for generic service/product tenants.
    contentSiteSignal:
      (sawContentSchema || editorialUrls.size >= 5) &&
      address === null &&
      phone === null,
  };
}

/**
 * Derive the complete, generic tenant profile. Fail-soft: any substrate read
 * failure degrades to config-only signals rather than throwing. The optional
 * LLM refines ONLY the businessType (capped, fail-soft) and never overrides a
 * high-confidence deterministic verdict.
 */
export async function deriveTenantProfile(
  args: DeriveTenantProfileArgs,
): Promise<TenantProfile> {
  const { tenantId } = args;
  const loadSnapshots = args.loadSnapshots ?? defaultLoadSnapshots;
  const loadTopQueries = args.loadTopQueries ?? defaultLoadTopQueries;
  const llm = args.llm ?? NO_LLM;

  const config = getBusinessConfig(tenantId);

  let snapshots: PageSnapshot[] = [];
  let topQueries: QuerySignal[] = [];
  try {
    [snapshots, topQueries] = await Promise.all([
      loadSnapshots(tenantId),
      loadTopQueries(tenantId),
    ]);
  } catch {
    snapshots = [];
    topQueries = [];
  }

  // The classifier's profile: prefer the launch-time site profile, else rebuild
  // it from persisted snapshots + config (the nightly path).
  const profile =
    args.profile ?? profileFromSnapshotsAndConfig(snapshots, config);

  // Service-area detection fuses the site's declared places (from the profile /
  // config) with the place names GSC queries expose.
  const configuredPlaces = new Set<string>([
    ...(profile.locations ?? []),
    ...(config.locations ?? []).map((l) => l.trim().toLowerCase()),
  ]);
  const querySignals: ServiceAreaSignal[] = topQueries.map((q) => ({
    query: q.query,
    impressions: q.impressions,
  }));
  const detectedAreas = detectServiceAreas({
    configuredPlaces: [...configuredPlaces],
    queries: querySignals,
  });

  // Deterministic type verdict first (grounded + explained).
  const verdict = classifyBusinessType({
    profile,
    topQueries,
    detectedPlaces: detectedAreas.map((a) => a.place),
  });

  // Optional LLM refinement — only when the deterministic verdict is weak, and
  // only capped + fail-soft. Never overrides a high-confidence heuristic.
  let businessType = verdict.businessType;
  let confidence = verdict.confidence;
  const evidence = [...verdict.evidence];
  if (verdict.confidence !== "high") {
    try {
      const refined = await llm({
        industry: profile.industry,
        schemaTypes: profile.schemaTypes,
        services: profile.services,
        topQueries: topQueries.slice(0, 30).map((q) => q.query),
      });
      if (refined && refined.businessType !== businessType) {
        businessType = refined.businessType;
        confidence = refined.confidence;
        evidence.push("I double-checked this against how people search for you.");
      }
    } catch {
      // Fail-soft: keep the deterministic verdict.
    }
  }

  // A content/online property has NO service areas — the local engine no-ops.
  // Only a local_service type carries serviceAreas.
  const serviceAreas =
    businessType === "local_service"
      ? detectedAreas.map((a) => a.place)
      : [];

  // Services: prefer the profile's (site + snapshot) services, capped + tidy.
  const services = dedupePreserveOrder(
    (profile.services ?? []).map((s) => s.trim()).filter(Boolean),
  ).slice(0, 24);

  return {
    industry: profile.industry ?? config.industry ?? "",
    businessType,
    services,
    serviceAreas,
    confidence,
    evidence,
    suggestedSegment: segmentForBusinessType(businessType),
  };
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
