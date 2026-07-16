/**
 * Training Data Pipeline — scaffold for content ingestion awareness.
 *
 * Assesses which channels Beacon knows about for getting content into
 * AI model training data / crawl layers. Does NOT claim to know what
 * models have actually ingested.
 */

import "server-only";

import type { PageSnapshot } from "@/domains/pages/types";
import type {
  ChannelReadiness,
  TrainingDataReadiness,
} from "./training-data-types";

/**
 * Assess training data / ingestion readiness from current page data.
 */
export function assessTrainingDataReadiness(
  snapshots: PageSnapshot[],
  hasLlmsTxt: boolean,
  hasSitemap: boolean,
): TrainingDataReadiness {
  const channels: ChannelReadiness[] = [];

  // Website pages
  const ownedPages = snapshots.length;
  channels.push({
    channel: "website_page",
    label: "Website pages",
    status: ownedPages >= 5 ? "active" : ownedPages > 0 ? "partial" : "missing",
    detail: ownedPages > 0
      ? `${ownedPages} owned page snapshot${ownedPages !== 1 ? "s" : ""} on file.`
      : "No owned page snapshots. Run a website scan.",
  });

  // Structured data (schema)
  const withSchema = snapshots.filter((s) => s.schema_types.length > 0).length;
  channels.push({
    channel: "structured_data",
    label: "Structured data (schema)",
    status: withSchema >= 3 ? "active" : withSchema > 0 ? "partial" : "missing",
    detail: withSchema > 0
      ? `${withSchema}/${ownedPages} pages have structured data.`
      : "No pages with structured data detected.",
  });

  // llms.txt
  channels.push({
    channel: "llms_txt",
    label: "llms.txt",
    status: hasLlmsTxt ? "active" : "missing",
    detail: hasLlmsTxt
      ? "llms.txt is deployed."
      : "No llms.txt detected. Beacon can generate a draft — see extractability analysis.",
  });

  // Sitemap
  channels.push({
    channel: "sitemap",
    label: "Sitemap",
    status: hasSitemap ? "active" : "unknown",
    detail: hasSitemap
      ? "Sitemap verified."
      : "Sitemap status unknown — Beacon does not currently verify sitemap presence.",
  });

  // Social profiles
  channels.push({
    channel: "social_profile",
    label: "Social profiles",
    status: "unknown",
    detail: "Social profile tracking not yet implemented.",
  });

  // Directory listings
  channels.push({
    channel: "directory_listing",
    label: "Directory listings",
    status: "unknown",
    detail: "Directory listing tracking not yet implemented.",
  });

  const active = channels.filter((c) => c.status === "active").length;
  const total = channels.length;

  let overall: TrainingDataReadiness["overall_status"];
  let assessment: string;

  if (active >= 3) {
    overall = "good";
    assessment = `${active}/${total} content visibility channels are active. Good foundation for AI model ingestion.`;
  } else if (active >= 1) {
    overall = "partial";
    assessment = `${active}/${total} channels active. Expanding structured data, llms.txt, and sitemap coverage would improve AI discoverability.`;
  } else {
    overall = "weak";
    assessment = "No confirmed content visibility channels. Website scanning and structured data are the first steps.";
  }

  return {
    computed_at: new Date().toISOString(),
    channels,
    active_count: active,
    total_channels: total,
    overall_status: overall,
    assessment,
  };
}
