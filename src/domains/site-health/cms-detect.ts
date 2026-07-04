/**
 * cms-detect (BEACON_500 P16 v1 380, 2026-07-03) - read-side platform detection.
 *
 * Names the CMS / site platform Beacon recognizes from deterministic snapshot
 * signals, as a CAPABILITY fact ("You are on Wix. I can push SEO fields here,
 * and draft the rest for you to paste."). Informational, not a Move: it tells
 * the operator what Beacon can and cannot do on this platform.
 *
 * GENERIC, NO tenant hardcoding. Detection is signal-driven, in priority order:
 *   1. generator meta   - the <meta name="generator"> string (most reliable).
 *   2. schema @type     - a platform-specific JSON-LD marker (rare but exact).
 *   3. url marker       - a platform staging host on the page URL
 *                         (e.g. *.wixsite.com, *.myshopify.com).
 *   4. body / asset marker - a platform asset host or class token seen in the
 *                         page's captured body markers (e.g. wixstatic.com,
 *                         cdn.shopify.com, wp-content).
 *
 * PURE / no I/O. Empty-safe: returns null when no signal matches (a custom-coded
 * site, or a platform Beacon does not yet recognize). No em or en dashes.
 *
 * The `capability` line is honest about push reach: Beacon has a real Wix push
 * lane, so Wix reads "push_and_draft"; every other recognized platform reads
 * "draft_only" (Beacon drafts the change for the operator to paste) until a push
 * lane exists for it. Do not claim push for a platform Beacon cannot push to.
 */

import type {
  CmsFact,
  CmsPlatform,
  CmsPushCapability,
} from "./types";

/**
 * The signals the detector reads. All optional so a caller can pass whatever the
 * snapshot actually captured; the detector short-circuits to null when nothing
 * matches. `generatorMeta` is the raw <meta name="generator"> content;
 * `schemaTypes` mirrors PageSnapshot.schema_types; `url` is the page URL;
 * `bodyMarkers` is any captured asset-host / class-token strings (body sample,
 * card texts, internal-link hrefs) the caller wants scanned.
 */
export type CmsDetectInput = {
  generatorMeta?: string | null;
  schemaTypes?: ReadonlyArray<string>;
  url?: string | null;
  bodyMarkers?: ReadonlyArray<string>;
};

/** Platforms Beacon can currently PUSH to (vs draft-only). Wix only, today. */
const PUSH_PLATFORMS: ReadonlySet<CmsPlatform> = new Set<CmsPlatform>(["Wix"]);

/** Case-insensitive substring test that tolerates null. */
function has(hay: string | null | undefined, needle: string): boolean {
  return !!hay && hay.toLowerCase().includes(needle);
}

/** Match a platform from a free-text generator-meta string. */
function fromGenerator(meta: string | null | undefined): CmsPlatform | null {
  if (!meta) return null;
  const m = meta.toLowerCase();
  if (m.includes("wix")) return "Wix";
  if (m.includes("squarespace")) return "Squarespace";
  if (m.includes("shopify")) return "Shopify";
  if (m.includes("wordpress")) return "WordPress";
  if (m.includes("webflow")) return "Webflow";
  if (m.includes("ghost")) return "Ghost";
  if (m.includes("duda")) return "Duda";
  if (m.includes("hubspot")) return "HubSpot";
  if (m.includes("drupal")) return "Drupal";
  if (m.includes("joomla")) return "Joomla";
  return null;
}

/** Match a platform from a JSON-LD @type marker. */
function fromSchema(types: ReadonlyArray<string>): CmsPlatform | null {
  for (const t of types) {
    const lt = t.toLowerCase();
    // Ghost publishes a "ghost" software-application marker on some themes.
    if (lt.includes("ghost")) return "Ghost";
  }
  return null;
}

/** Match a platform from the page URL host (platform staging domains). */
function fromUrl(url: string | null | undefined): CmsPlatform | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes(".wixsite.com") || u.includes(".editorx.io")) return "Wix";
  if (u.includes(".squarespace.com")) return "Squarespace";
  if (u.includes(".myshopify.com")) return "Shopify";
  if (u.includes(".wordpress.com")) return "WordPress";
  if (u.includes(".webflow.io")) return "Webflow";
  if (u.includes(".ghost.io")) return "Ghost";
  if (u.includes(".hubspotpagebuilder.com")) return "HubSpot";
  return null;
}

/** Match a platform from a captured asset-host / class-token body marker. */
function fromBody(markers: ReadonlyArray<string>): CmsPlatform | null {
  for (const raw of markers) {
    const m = raw.toLowerCase();
    if (m.includes("wixstatic.com") || m.includes("static.parastorage.com")) return "Wix";
    if (m.includes("static1.squarespace.com") || m.includes("squarespace-cdn.com")) return "Squarespace";
    if (m.includes("cdn.shopify.com")) return "Shopify";
    if (m.includes("wp-content") || m.includes("wp-includes")) return "WordPress";
    if (m.includes("assets.website-files.com") || m.includes("uploads-ssl.webflow.com")) return "Webflow";
    if (has(m, "drupal")) return "Drupal";
    if (has(m, "joomla")) return "Joomla";
  }
  return null;
}

/** How Beacon can help on this platform: push where a lane exists, else draft. */
function capabilityFor(platform: CmsPlatform): CmsPushCapability {
  return PUSH_PLATFORMS.has(platform) ? "push_and_draft" : "draft_only";
}

/** The capability sentence. First person, concrete, dash-free. */
function headlineFor(platform: CmsPlatform, capability: CmsPushCapability): string {
  if (capability === "push_and_draft") {
    return (
      "You are on " +
      platform +
      ". I can push SEO fields here, and draft the rest for you to paste."
    );
  }
  return (
    "You are on " +
    platform +
    ". I cannot push changes here yet, so I will draft every change for you to paste in."
  );
}

/**
 * Detect the CMS / platform for a site from one representative snapshot's
 * signals. Returns null when no signal matches (custom-coded site or an
 * unrecognized platform). Pure. NO tenant hardcoding.
 */
export function detectCms(input: CmsDetectInput): CmsFact | null {
  const schemaTypes = input.schemaTypes ?? [];
  const bodyMarkers = input.bodyMarkers ?? [];

  let platform: CmsPlatform | null = null;
  let detectedFrom: CmsFact["detectedFrom"] | null = null;

  platform = fromGenerator(input.generatorMeta);
  if (platform) detectedFrom = "generator_meta";

  if (!platform) {
    platform = fromSchema(schemaTypes);
    if (platform) detectedFrom = "schema_type";
  }
  if (!platform) {
    platform = fromUrl(input.url);
    if (platform) detectedFrom = "url_marker";
  }
  if (!platform) {
    platform = fromBody(bodyMarkers);
    if (platform) detectedFrom = "body_marker";
  }

  if (!platform || !detectedFrom) return null;

  const capability = capabilityFor(platform);
  return {
    platform,
    capability,
    detectedFrom,
    headline: headlineFor(platform, capability),
    operatorEvidence:
      "site_health.cms: platform=" +
      platform +
      "; detected_from=" +
      detectedFrom +
      "; capability=" +
      capability +
      "; generator_meta=" +
      (input.generatorMeta ?? "null"),
  };
}
