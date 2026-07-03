/**
 * Entity + author (E-E-A-T) triggers (BEACON 500 P10, 2026-07-03) - the ONE
 * trigger file for the three E-E-A-T Moves. Three PURE predicate functions over
 * pre-assembled inputs (all I/O lives in
 * `src/domains/entity/load-eeat-signals.ts`), pinned by
 * `recommendation-trigger-predicates-purity`:
 *
 *   1. entity_link_gap: a content page names an entity Google already knows in
 *      its Knowledge Graph but the page carries no schema linking to it. Emits
 *      `add_schema` with a ready-to-paste `about` + `sameAs` block.
 *   2. author_byline_gap: a guide-shaped content page has no named author.
 *      Emits `add_answer_block` (a non-pushable directive: Beacon never invents
 *      a real person's name; the owner adds the real byline + Person schema).
 *   3. brand_presence_gap: the tenant's own site does not clearly establish the
 *      brand as an entity (no Organization schema, or no sameAs links). Emits
 *      `add_schema` anchored on the site root, with a ready-to-paste
 *      Organization + WebSite block.
 *
 * All three are empty-safe: no gaps -> no rows.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import {
  entityLinkGapCopy,
  authorBylineGapCopy,
  brandPresenceGapCopy,
} from "../customer-copy-templates";
import type {
  EntityLinkGap,
  AuthorGap,
  BrandPresenceGap,
} from "@/domains/entity/eeat-types";
import { composeEntityAboutScript } from "@/domains/entity/eeat-entity-link";

// ── (1) Sitewide entity + sameAs ────────────────────────────────────────────

export type EntityLinkGapInput = {
  tenantId: string;
  gaps: ReadonlyArray<EntityLinkGap>;
  signalAt: string;
};

/**
 * One `add_schema` card per content page that names an unlinked Knowledge-Graph
 * entity. Page-anchored on the page's own URL (each gap carries it). Confidence
 * "medium": the entity was resolved to a real Wikidata QID and the page's own
 * text names it, so the join is grounded, not guessed. Empty in -> empty out.
 */
export function entityLinkGap(
  input: EntityLinkGapInput,
): RecommendationCandidateRow[] {
  const { tenantId, gaps, signalAt } = input;
  if (gaps.length === 0) return [];

  const actionType = "add_schema" as const;
  const topicClusterLabel = "Structured data";

  return gaps.map((gap) => {
    const targetUrl = gap.url;
    const first = gap.entities[0]!;
    const script = composeEntityAboutScript(gap);
    const names = gap.entities.map((e) => e.name);

    return {
      tenant_id: tenantId,
      trigger_signal: "entity_link_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "entity_link_gap named_entities=" +
            names.join(", ") +
            "; qids=" +
            gap.entities.map((e) => e.qid).join(", ") +
            "; schema_types=[" +
            gap.schemaTypes.join(", ") +
            "]",
        },
      ],
      confidence: "medium",
      impact_estimate: "medium",
      customer_copy: entityLinkGapCopy(first.name, gap.entities.length),
      operator_evidence:
        "signal=entity_link_gap; url=" +
        targetUrl +
        "; entities=" +
        names.join(" | ") +
        "; qids=" +
        gap.entities.map((e) => e.qid).join(",") +
        "; schema_types=[" +
        gap.schemaTypes.join(", ") +
        "]; paste_ready=" +
        (script ? "yes" : "no"),
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: gap.fetchedAt || signalAt,
      safety_flags: [],
    };
  });
}

// ── (2) Author / reviewer Person byline ─────────────────────────────────────

export type AuthorBylineGapInput = {
  tenantId: string;
  gaps: ReadonlyArray<AuthorGap>;
  signalAt: string;
};

/**
 * One `add_answer_block` DIRECTIVE per guide-shaped content page with no named
 * author. Non-pushable on purpose: Beacon never fabricates a real person's name;
 * the owner adds the real byline + Person schema. Page-anchored. Confidence
 * "medium". Empty in -> empty out (a site that already credits its writers gets
 * nothing).
 */
export function authorBylineGap(
  input: AuthorBylineGapInput,
): RecommendationCandidateRow[] {
  const { tenantId, gaps, signalAt } = input;
  if (gaps.length === 0) return [];

  const actionType = "add_answer_block" as const;
  const topicClusterLabel = "Author trust";

  return gaps.map((gap) => {
    const targetUrl = gap.url;
    return {
      tenant_id: tenantId,
      trigger_signal: "author_byline_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "author_byline_gap url=" +
            targetUrl +
            "; no Person schema and no visible byline on a guide-shaped page",
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: authorBylineGapCopy(),
      operator_evidence:
        "signal=author_byline_gap; url=" +
        targetUrl +
        "; guide_shaped=true; has_author_signal=false; play=add_named_author_and_person_schema",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: gap.fetchedAt || signalAt,
      safety_flags: [],
    };
  });
}

// ── (3) Knowledge-Graph / brand presence ────────────────────────────────────

export type BrandPresenceGapInput = {
  tenantId: string;
  gap: BrandPresenceGap | null;
  signalAt: string;
};

/**
 * At most ONE `add_schema` card for the whole tenant when the site does not
 * clearly establish the brand as an entity. Site-root-anchored (the gap carries
 * the site-root URL). Confidence "medium". Null gap (well represented, or no
 * usable config) -> empty (self-hiding).
 *
 * @no-classifier-required: brand identity is tenant-level, not page-scoped. The
 * unit is the whole site, so emission anchors to the always-HTML site root;
 * neither classifyPageType nor isNonHtmlAsset applies. Same sanctioned opt-out
 * connector-failure-streak.ts / aeo-zero-source-opening.ts use.
 */
export function brandPresenceGap(
  input: BrandPresenceGapInput,
): RecommendationCandidateRow[] {
  const { tenantId, gap, signalAt } = input;
  if (gap == null) return [];
  if (!gap.siteRootUrl) return [];

  const actionType = "add_schema" as const;
  const targetUrl = gap.siteRootUrl;
  const topicClusterLabel = "Structured data";

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "brand_presence_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "brand_presence_gap brand=" +
            gap.brandName +
            "; gap=" +
            gap.gap,
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: brandPresenceGapCopy(gap.brandName, gap.gap),
      operator_evidence:
        "signal=brand_presence_gap; brand=" +
        gap.brandName +
        "; site_root=" +
        gap.siteRootUrl +
        "; gap=" +
        gap.gap +
        "; play=add_organization_schema_with_sameas",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: gap.fetchedAt || signalAt,
      safety_flags: [],
    },
  ];
}
