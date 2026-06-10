export type CompetitorType = "direct" | "directory" | "editorial" | "forum" | "other";

const EDITORIAL_PATTERNS = [
  "nytimes.com", "wsj.com", "forbes.com", "bloomberg.com",
  "sfchronicle.com", "mercurynews.com", "businessinsider.com",
  "architecturaldigest.com", "dwell.com", "curbed.com",
  "thespruce.com", "bobvila.com", "thisoldhouse.com",
  "hgtv.com", "realtor.com", "zillow.com",
];

const DIRECTORY_PATTERNS = [
  "houzz.com", "yelp.com", "angi.com", "homeadvisor.com",
  "thumbtack.com", "bbb.org", "buildzoom.com", "diamondcertified.org",
  "google.com/maps", "facebook.com", "instagram.com",
  "linkedin.com", "nextdoor.com", "manta.com", "chamberofcommerce.com",
  "porch.com", "bark.com", "expertise.com",
];

const FORUM_PATTERNS = [
  "reddit.com", "quora.com", "stackexchange.com",
  "city-data.com",
];

/**
 * MT-3B (2026-05-22) — `directoryDomains` is injected by the caller
 * (from the tenant's resolved BusinessConfig) instead of read via the
 * deprecated no-arg `getBusinessConfig()`. Keeps this a pure function.
 */
export function classifyCompetitorType(
  domain: string,
  directoryDomains: ReadonlyArray<string>,
): CompetitorType {
  const norm = domain.toLowerCase().replace(/^www\./, "");

  if (directoryDomains.some((d) => norm === d || norm.endsWith(`.${d}`))) {
    return "directory";
  }

  if (DIRECTORY_PATTERNS.some((p) => norm === p || norm.endsWith(`.${p.split(".").slice(-2).join(".")}`))) {
    return "directory";
  }

  if (FORUM_PATTERNS.some((p) => norm === p || norm.endsWith(`.${p}`))) {
    return "forum";
  }

  if (EDITORIAL_PATTERNS.some((p) => norm === p || norm.endsWith(`.${p.split(".").slice(-2).join(".")}`))) {
    return "editorial";
  }

  return "direct";
}

export const COMPETITOR_TYPE_LABELS: Record<CompetitorType, string> = {
  direct: "Direct competitor",
  directory: "Directory / listing",
  editorial: "Editorial / media",
  forum: "Forum / community",
  other: "Other",
};

export const COMPETITOR_TYPE_COLORS: Record<CompetitorType, string> = {
  direct: "text-status-danger bg-status-danger/10 border-status-danger/20",
  directory: "text-muted-foreground bg-surface-inset/60 border-border/40",
  editorial: "text-accent-primary bg-accent-primary/10 border-accent-primary/20",
  forum: "text-status-warning bg-status-warning/10 border-status-warning/20",
  other: "text-muted-foreground bg-surface-inset/40 border-border/30",
};
