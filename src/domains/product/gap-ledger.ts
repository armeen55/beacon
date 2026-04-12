/**
 * Gap ledger — typed evidence classes for Opportunities / topic gaps.
 * Every row must map to exactly one class (no generic “recommendation” without a class).
 */

import type { CompetitorUniverseOrigin } from "@/domains/competitors/universe-types";
import { normalizeCompetitorDomain } from "@/domains/competitors/universe-normalize";

export type GapEvidenceClass =
  | "observed_page_gap"
  | "competitor_asset_gap"
  | "coverage_gap"
  | "technical_gap"
  | "inferred_draft_idea";

export const GAP_EVIDENCE_LABELS: Record<
  GapEvidenceClass,
  { short: string; description: string }
> = {
  observed_page_gap: {
    short: "Observed page gap",
    description:
      "Scanner or citation pattern vs what your HTML actually shows on owned URLs.",
  },
  competitor_asset_gap: {
    short: "Competitor asset gap",
    description:
      "External domains or page types win citations in the imported sample more than your equivalent assets.",
  },
  coverage_gap: {
    short: "Coverage gap",
    description:
      "No suitable owned URL appears for this theme in inventory — new or redirected page may be warranted.",
  },
  technical_gap: {
    short: "Technical gap",
    description:
      "Crawl/render/index signals (canonical, noindex, render mismatch) may block extractability.",
  },
  inferred_draft_idea: {
    short: "Inferred draft",
    description:
      "Heuristic from imported shifts or scorecard — weaker than a scanner-observed gap.",
  },
};

export type GapLedgerAction = {
  label: string;
  href: string;
};

type FrontierShape = {
  frontierType: string;
  recommendedMove: string;
  structuralOpportunity: number;
  pagesToRepairCount: number;
  pagesToCreateCount: number;
  ownedEquivalentExists: boolean;
};

/** Workspace configured competitor universe (from `.data/competitor-universe.json` or explicit demo defaults). */
export type GapLedgerCompetitorUniverseContext = {
  origin: CompetitorUniverseOrigin;
  activeConfiguredCount: number;
  configuredDomainToLabel: Record<string, string>;
  universe_version: number | null;
  universe_fingerprint: string | null;
  legacy_unversioned_file: boolean;
  fingerprint_mismatch?: boolean;
  visibilityRunUniverse_pin_status?: string | null;
  visibilityRunUniverse_version?: number | null;
  visibilityRunUniverse_fingerprint?: string | null;
};

/** Observation / import context shared across all gap rows (list + detail). */
export type GapLedgerObservationContext = {
  websiteCrawlRunId: string | null;
  citationIndexLoaded: boolean;
  visibilityObservationRunId: string | null;
  /** Citation index older than latest crawl — competitor/coverage lines are more directional. */
  visibilitySampleStaleVsCrawl: boolean;
  /** When omitted, competitor gap copy stays legacy-generic. */
  competitorUniverse?: GapLedgerCompetitorUniverseContext | null;
};

type GapLedgerCore = {
  evidenceClass: GapEvidenceClass;
  evidenceLine: string;
  action: GapLedgerAction;
};

function competitorAssetGapEvidenceSuffix(
  ctx: GapLedgerObservationContext,
  frontierCitationDomains: string[] | undefined
): string {
  const cu = ctx.competitorUniverse;
  if (!cu) return "";
  if (cu.origin === "empty_import_mode" && cu.activeConfiguredCount === 0) {
    return " — sample-only external domains (no configured competitor universe).";
  }
  if (!frontierCitationDomains?.length) {
    return cu.activeConfiguredCount > 0
      ? " — open detail to see which cited domains match your configured universe vs uncategorized sample."
      : "";
  }
  const configuredLabels: string[] = [];
  const uncategorized: string[] = [];
  for (const raw of frontierCitationDomains) {
    const k = normalizeCompetitorDomain(raw);
    if (!k) continue;
    const label = cu.configuredDomainToLabel[k];
    if (label) configuredLabels.push(label);
    else uncategorized.push(k);
  }
  if (configuredLabels.length > 0 && uncategorized.length > 0) {
    return ` — mix of configured competitors (${configuredLabels.slice(0, 3).join(", ")}${configuredLabels.length > 3 ? ", …" : ""}) and uncategorized external sample domains.`;
  }
  if (configuredLabels.length > 0) {
    return ` — cited pressure includes configured competitors (${configuredLabels.slice(0, 4).join(", ")}${configuredLabels.length > 4 ? ", …" : ""}).`;
  }
  if (uncategorized.length > 0 && cu.activeConfiguredCount > 0) {
    return " — top external domains in this frontier are not in your configured universe (uncategorized sample).";
  }
  return "";
}

function buildGapProvenance(
  core: GapLedgerCore,
  f: FrontierShape | null,
  ctx: GapLedgerObservationContext,
  frontierCitationDomains?: string[]
): {
  provenanceLines: string[];
  observationRunHref: string | null;
  visibilityObservationRunHref: string | null;
  evidenceDimensionsLine: string;
} {
  const observationRunHref = ctx.websiteCrawlRunId
    ? `/observations/${encodeURIComponent(ctx.websiteCrawlRunId)}`
    : null;
  const visibilityObservationRunHref = ctx.visibilityObservationRunId
    ? `/observations/${encodeURIComponent(ctx.visibilityObservationRunId)}`
    : null;

  const lines: string[] = [];
  if (ctx.websiteCrawlRunId) {
    lines.push(
      `Crawl: latest website ObservationRun on file (${ctx.websiteCrawlRunId}).`
    );
  } else {
    lines.push(
      "Crawl: no ObservationRun on file — page-scan evidence is not established until you run a crawl."
    );
  }
  if (ctx.visibilityObservationRunId) {
    lines.push(
      `Visibility: ObservationRun ${ctx.visibilityObservationRunId} (import/rollup wrapper — see run detail for honesty flags).`
    );
  } else if (ctx.citationIndexLoaded) {
    lines.push(
      "Visibility: citation index present but no visibility run id resolved — treat rollup as ambient import."
    );
  } else {
    lines.push(
      "Visibility: no citation index — this row has no visibility-sample backbone in Beacon."
    );
  }
  if (ctx.citationIndexLoaded) {
    lines.push(
      "Citations: citation-evidence-index loaded (sample — directional vs live prompts unless you record a run)."
    );
  } else {
    lines.push(
      "Citations: index not loaded — competitor and coverage signals for this row are missing or weak."
    );
  }
  if (ctx.visibilitySampleStaleVsCrawl) {
    lines.push(
      "Stale note: visibility sample may lag latest crawl (index built before last website pass)."
    );
  }
  if (!f) {
    lines.push(
      "Frontier: no compiled package for this topic — row is Review/scorecard bookkeeping, not a full gap compile."
    );
  } else if (core.evidenceClass === "inferred_draft_idea") {
    lines.push(
      "Frontier move is exploratory — confirm against Website issues and citation rows before shipping."
    );
  }
  if (core.evidenceClass === "competitor_asset_gap" && !ctx.citationIndexLoaded) {
    lines.push(
      "Competitor gap class is not fully grounded without a loaded citation index."
    );
  }
  if (core.evidenceClass === "competitor_asset_gap") {
    const cu = ctx.competitorUniverse;
    if (cu) {
      if (cu.origin === "empty_import_mode" && cu.activeConfiguredCount === 0) {
        lines.push(
          "Competitor universe: none configured — treat cited external domains as uncategorized visibility sample, not an intentional tracked set."
        );
      } else if (cu.origin === "demo_defaults_explicit") {
        lines.push(
          `Competitor universe: ${cu.activeConfiguredCount} active (explicit demo defaults in code — same hostnames as walkthrough seed, not inferred from citations).`
        );
      } else {
        lines.push(
          `Competitor universe: ${cu.activeConfiguredCount} active hostnames from workspace file — classify cited domains against this set in detail.`
        );
      }
      if (cu.universe_fingerprint) {
        lines.push(
          `Workspace universe pin: v${cu.universe_version ?? "—"} · ${cu.universe_fingerprint.slice(0, 14)}…`
        );
      }
      if (cu.legacy_unversioned_file) {
        lines.push(
          "Universe file was legacy (version inferred) — save from Competitors to stamp explicit `file_schema` 2 rows."
        );
      }
      if (cu.fingerprint_mismatch) {
        lines.push(
          "Universe JSON fingerprint does not match recomputed competitor set — save from Competitors to reconcile."
        );
      }
      const vPin = cu.visibilityRunUniverse_pin_status;
      if (
        vPin === "synthetic_unpinned" ||
        vPin === "legacy_unpinned" ||
        vPin == null
      ) {
        lines.push(
          "Primary visibility run: competitor universe unpinned — gap competitor labels use current workspace universe at render time (historical drift possible)."
        );
      } else if (
        vPin === "pinned" &&
        cu.visibilityRunUniverse_fingerprint &&
        cu.universe_fingerprint &&
        cu.visibilityRunUniverse_fingerprint !== cu.universe_fingerprint
      ) {
        lines.push(
          `Primary visibility run pinned ${cu.visibilityRunUniverse_fingerprint.slice(0, 14)}… (v${cu.visibilityRunUniverse_version ?? "—"}) vs current workspace ${cu.universe_fingerprint.slice(0, 14)}… — UI uses current workspace for live classification.`
        );
      }
      if (frontierCitationDomains?.length) {
        const hits: string[] = [];
        const miss: string[] = [];
        for (const raw of frontierCitationDomains) {
          const k = normalizeCompetitorDomain(raw);
          if (!k) continue;
          const lab = cu.configuredDomainToLabel[k];
          if (lab) hits.push(`${lab} (${k})`);
          else miss.push(k);
        }
        if (hits.length)
          lines.push(
            `This frontier sample includes configured competitors: ${hits.slice(0, 5).join("; ")}${hits.length > 5 ? " …" : ""}.`
          );
        if (miss.length)
          lines.push(
            `Uncategorized external (sample) domains in this frontier include: ${miss.slice(0, 5).join(", ")}${miss.length > 5 ? " …" : ""}.`
          );
      }
    }
    if (ctx.visibilityObservationRunId) {
      lines.push(
        `Visibility run ${ctx.visibilityObservationRunId} scopes the import/rollup era for this sample — citation domains are still sample observations, not live prompt truth.`
      );
    } else if (ctx.citationIndexLoaded) {
      lines.push(
        "Visibility run id unresolved — competitor lines remain citation-sample directional."
      );
    }
  }

  const crawlBacked = !!ctx.websiteCrawlRunId;
  const visBacked =
    !!ctx.visibilityObservationRunId || ctx.citationIndexLoaded;
  const competitorBacked =
    ctx.citationIndexLoaded && core.evidenceClass === "competitor_asset_gap";
  const dims: string[] = [];
  if (crawlBacked) dims.push("crawl");
  if (visBacked) dims.push("visibility sample");
  if (competitorBacked) dims.push("competitor sample");
  if (
    competitorBacked &&
    ctx.competitorUniverse &&
    ctx.competitorUniverse.activeConfiguredCount > 0
  ) {
    dims.push("configured competitor universe");
  }
  if (
    core.evidenceClass === "inferred_draft_idea" &&
    !crawlBacked &&
    !visBacked
  ) {
    dims.push("heuristic only");
  }
  const evidenceDimensionsLine = `Evidence dimensions: ${dims.length ? dims.join(" · ") : "none declared"}.`;

  return {
    provenanceLines: lines,
    observationRunHref,
    visibilityObservationRunHref,
    evidenceDimensionsLine,
  };
}

/**
 * Derive evidence class + one-line basis + primary CTA (list and detail must use the same).
 */
export function deriveGapLedgerFields(
  f: FrontierShape | null,
  ctx: GapLedgerObservationContext = {
    websiteCrawlRunId: null,
    citationIndexLoaded: false,
    visibilityObservationRunId: null,
    visibilitySampleStaleVsCrawl: false,
    competitorUniverse: null,
  },
  frontierCitationDomains?: string[]
): {
  evidenceClass: GapEvidenceClass;
  evidenceLine: string;
  action: GapLedgerAction;
  provenanceLines: string[];
  observationRunHref: string | null;
  visibilityObservationRunHref: string | null;
  evidenceDimensionsLine: string;
} {
  let core: GapLedgerCore;
  if (!f) {
    core = {
      evidenceClass: "inferred_draft_idea",
      evidenceLine:
        "No citation-frontier package for this topic yet — only imported visibility/changelog signals.",
      action: { label: "Open Review queue", href: "/changes?tab=attribution" },
    };
    const {
      provenanceLines,
      observationRunHref,
      visibilityObservationRunHref,
      evidenceDimensionsLine,
    } = buildGapProvenance(core, f, ctx, frontierCitationDomains);
    return {
      ...core,
      provenanceLines,
      observationRunHref,
      visibilityObservationRunHref,
      evidenceDimensionsLine,
    };
  }

  const move = f.recommendedMove;
  const repair = f.pagesToRepairCount > 0;
  const create = f.pagesToCreateCount > 0;

  if (f.frontierType === "competitor_pressure_frontier") {
    const base =
      "Competitor URLs or asset types dominate citations in the imported evidence index for this theme.";
    core = {
      evidenceClass: "competitor_asset_gap",
      evidenceLine: base + competitorAssetGapEvidenceSuffix(ctx, frontierCitationDomains),
      action: { label: "Review gap detail", href: "/competitors#opportunities" },
    };
  } else if (
    move === "create_missing_page" ||
    (create && !repair && f.frontierType === "page_gap_frontier")
  ) {
    if (f.ownedEquivalentExists) {
      core = {
        evidenceClass: "observed_page_gap",
        evidenceLine:
          "Owned URLs already exist — treat as page quality, extractability, or intent mismatch, not “missing site page.”",
        action: { label: "Open Website workbench", href: "/pages" },
      };
    } else {
      core = {
        evidenceClass: "coverage_gap",
        evidenceLine:
          "Inventory + citation sample suggest no strong owned URL for this theme vs what competitors cite.",
        action: { label: "Plan coverage in detail →", href: "/competitors#opportunities" },
      };
    }
  } else if (
    move === "repair_existing_pages" ||
    repair ||
    f.structuralOpportunity > 55
  ) {
    core = {
      evidenceClass:
        f.structuralOpportunity > 60 ? "technical_gap" : "observed_page_gap",
      evidenceLine: repair
        ? "Specific owned URLs are flagged for repair in the compiled package."
        : "Structural or content-pattern gap from scanner + citation rollup.",
      action: { label: "Fix pages in workbench", href: "/pages" },
    };
  } else {
    core = {
      evidenceClass: "inferred_draft_idea",
      evidenceLine:
        "Package move is exploratory — confirm against scanner and citation rows before shipping.",
      action: { label: "Inspect gap detail →", href: "/competitors#opportunities" },
    };
  }

  const {
    provenanceLines,
    observationRunHref,
    visibilityObservationRunHref,
    evidenceDimensionsLine,
  } = buildGapProvenance(core, f, ctx, frontierCitationDomains);
  return {
    ...core,
    provenanceLines,
    observationRunHref,
    visibilityObservationRunHref,
    evidenceDimensionsLine,
  };
}
