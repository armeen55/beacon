import type { BusinessConfig } from "@/lib/business-config";
import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type {
  LocalChangesHook,
  LocalOperatorImport,
  LocalOperatorSurface,
  LocalPresenceSignal,
  LocalReviewTask,
  LocalTodayUrgentStrip,
} from "./types";

const IMPORT_FILE = "local-operator-surface";

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export async function loadLocalOperatorImport(): Promise<LocalOperatorImport | null> {
  return await readDotDataJson<LocalOperatorImport>(IMPORT_FILE);
}

export type ComputeLocalSurfaceContext = {
  business: BusinessConfig;
  importRow: LocalOperatorImport | null;
  /** Strongest geo gap from Market-style coverage (optional). */
  geoGap: {
    city: string;
    competitor_pages: number;
    owned_pages: number;
  } | null;
  /** Meaningful citation decay rows (ties reviews hook to visibility outcomes). */
  meaningfulDecayCount: number;
};

/**
 * Builds compact local-presence + review task lists with explicit proof buckets.
 * Vertical-agnostic: uses directory list from business config + optional import file.
 */
export function computeLocalOperatorSurface(
  ctx: ComputeLocalSurfaceContext,
): LocalOperatorSurface {
  const { business, importRow, geoGap, meaningfulDecayCount } = ctx;
  const imp = importRow ?? {};
  const presenceSignals: LocalPresenceSignal[] = [];
  const reviewTasks: LocalReviewTask[] = [];

  const brand = business.name;
  const stalenessReviews = daysSince(imp.reviews_last_import_at ?? null);
  const stalenessListings = daysSince(imp.listing_import_at ?? null);

  const dataGapsBase: string[] = [
    "This checklist layer does not call Google/Yelp APIs by itself — review rows in Beacon come from Settings → Import and/or Connectors; optional `.data/local-operator-surface.json` augments operator notes.",
  ];

  if (geoGap) {
    presenceSignals.push({
      id: "geo-footprint-gap",
      headline: `Local AI footprint looks thin in ${geoGap.city}`,
      detail: `Registry + citation sample: ${geoGap.competitor_pages} competitor-associated pages vs ${geoGap.owned_pages} owned pages for this market label.`,
      severity: geoGap.owned_pages === 0 ? "urgent" : "watch",
      proof: {
        observed: [
          `Geo coverage table: ${geoGap.competitor_pages} vs ${geoGap.owned_pages} pages tagged for “${geoGap.city}”.`,
        ],
        inferred: [
          "Market label is keyword-derived from prompts/pages — not a census of real-world storefronts.",
        ],
        dataGaps: [
          ...dataGapsBase,
          "No separate listings NAP audit unless you add flags to the import file.",
        ],
        stalenessNote: null,
      },
    });
  }

  const dirSample = business.directoryDomains.slice(0, 4).join(", ");
  presenceSignals.push({
    id: "major-profiles-checklist",
    headline: "Major profiles & listings (manual check)",
    detail: `For ${brand}, spot-check NAP consistency on priority directories (${dirSample}${business.directoryDomains.length > 4 ? ", …" : ""}).`,
    severity: "info",
    proof: {
      observed: [
        `Business config lists ${business.directoryDomains.length} directory/social domains to treat as “off-site presence” context.`,
      ],
      inferred: [
        "Which profiles are “must-have” for your category is inferred from common local SEO practice, not from Beacon crawl data.",
      ],
      dataGaps: [
        ...dataGapsBase,
        "Add `nap_drift_flags` to the import file when you have a real audit.",
      ],
      stalenessNote:
        stalenessListings !== null && stalenessListings > 30
          ? `Listing snapshot on file is ~${stalenessListings}d old.`
          : null,
    },
  });

  if (imp.nap_drift_flags && imp.nap_drift_flags.length > 0) {
    presenceSignals.push({
      id: "nap-drift",
      headline: "Listing consistency / drift flagged",
      detail: imp.nap_drift_flags.slice(0, 3).join(" · "),
      severity: "urgent",
      proof: {
        observed: imp.nap_drift_flags.map((f) => `Flag: ${f}`),
        inferred: [],
        dataGaps: [
          "Drift list is only what you (or a future connector) put in `local-operator-surface.json`.",
        ],
        stalenessNote: null,
      },
    });
  }

  const unresp = imp.unresponded_reviews_estimate ?? 0;
  reviewTasks.push({
    id: "review-response-loop",
    headline:
      unresp > 0
        ? `Clear or schedule ${unresp} overdue review response${unresp !== 1 ? "s" : ""}`
        : "Weekly: scan new reviews & respond",
    cadence: unresp >= 3 ? "daily" : "weekly",
    detail:
      unresp > 0
        ? "High-signal local trust work — unanswered public reviews compound fast for service businesses."
        : "Keep a lightweight loop: check Google/Yelp weekly, respond within your SLA, log exceptions.",
    proof: {
      observed:
        unresp > 0
          ? [`Import field unresponded_reviews_estimate = ${unresp}.`]
          : ["No unresponded count on file — defaulting to a weekly habit task."],
      inferred:
        unresp > 0
          ? [
              "Estimate is whatever your review tool or CSV supplied — Beacon does not verify it against platform APIs from this field alone.",
            ]
          : [],
      dataGaps: [
        ...dataGapsBase,
        "Add `reviews_last_import_at` and `review_velocity_vs_prior` when you have feeds.",
      ],
      stalenessNote:
        stalenessReviews !== null && stalenessReviews > 14
          ? `Review import is ~${stalenessReviews}d old — velocity may be stale.`
          : null,
    },
  });

  if (imp.review_velocity_vs_prior === "down") {
    reviewTasks.push({
      id: "review-velocity-down",
      headline: "Review velocity cooled vs prior period",
      detail:
        "If acquisition depends on reviews, treat this like a weekly ops check — not an automatic churn prediction.",
      cadence: "weekly",
      proof: {
        observed: ["Import marks review_velocity_vs_prior = down."],
        inferred: [
          "Direction is only as trustworthy as the upstream export; Beacon does not model seasonality.",
        ],
        dataGaps: [...dataGapsBase],
        stalenessNote:
          stalenessReviews !== null && stalenessReviews > 14
            ? `Review metrics ~${stalenessReviews}d old.`
            : null,
      },
    });
  }

  let todayUrgentStrip: LocalTodayUrgentStrip | null = null;
  if (unresp >= 3) {
    todayUrgentStrip = {
      title: "Local reviews need attention today",
      body: `${unresp} unresponded review(s) on file — public trust risk for local service businesses.`,
      href: "/competitors#local-ops",
    };
  } else if (imp.nap_drift_flags && imp.nap_drift_flags.length > 0) {
    todayUrgentStrip = {
      title: "Listing consistency issue flagged",
      body: imp.nap_drift_flags[0] ?? "NAP drift on file",
      href: "/competitors#local-ops",
    };
  } else if (
    imp.review_velocity_vs_prior === "down" &&
    meaningfulDecayCount >= 1
  ) {
    todayUrgentStrip = {
      title: "Reputation + visibility both softening",
      body: `Review velocity marked down while ${meaningfulDecayCount} page(s) show meaningful citation decay — worth a coordinated check this week.`,
      href: "/competitors#local-ops",
    };
  }

  let changesOutcomesHook: LocalChangesHook | null = null;
  if (imp.review_velocity_vs_prior === "down" && meaningfulDecayCount >= 1) {
    changesOutcomesHook = {
      text: "Review velocity is down on file while citation decay is elevated — see Local & reviews on Market for the combined task view.",
      href: "/competitors#local-ops",
    };
  } else if (unresp >= 5) {
    changesOutcomesHook = {
      text: "High overdue review volume on file — outcomes work should assume reputation pressure in parallel.",
      href: "/competitors#local-ops",
    };
  }

  const dataSourceNote = importRow
    ? "Mixed: geo + config are observed in Beacon; review/listing fields come from `local-operator-surface.json`."
    : "Mostly structural: geo + business config are in-app; listings/review metrics are placeholders until you add `local-operator-surface.json`.";

  return {
    presenceSignals,
    reviewTasks,
    dataSourceNote,
    todayUrgentStrip,
    changesOutcomesHook,
  };
}
