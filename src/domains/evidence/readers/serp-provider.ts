/**
 * serp-provider — the shared SERP evidence VOCABULARY (types + a URL helper).
 *
 * DataForSEO is Beacon's ONE external research boundary (Product Truth), so the
 * old pluggable BEACON_SERP_PROVIDER selection layer (Noop vs DataForSEO
 * provider classes + getSerpProvider) is gone. There is nothing to select
 * between: when credentials are present the single canonical client
 * (../dataforseo/client) performs the call through `runSerpQuery`; when they are
 * absent that same gauntlet returns "not_configured" and no live call happens.
 *
 * This module now holds only the snapshot types every SERP consumer shares and
 * `rootDomain`, the URL-normalization helper used across the evidence readers.
 */

import "server-only";

export type SerpFeature =
  | "ai_overview"
  | "featured_snippet"
  | "people_also_ask"
  | "image_pack"
  | "video"
  | "knowledge_panel";

export type SerpResult = {
  rank: number;
  url: string;
  title: string;
  domain: string;
};

export type SerpSnapshot = {
  query: string;
  results: SerpResult[];
  features: SerpFeature[];
  source: "dataforseo" | "none";
  fetchedAt: string | null;
};

export function rootDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
