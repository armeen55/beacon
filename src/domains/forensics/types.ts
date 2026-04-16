/**
 * Spike Forensics — internal intelligence for understanding what drove
 * a major shift in visibility, citations, or mentions.
 *
 * Design principle: NO fake certainty. Every output uses directional
 * language. We never claim a change "caused" a spike — only that it is
 * a likely trigger, likely amplifier, or weak contributor.
 */

export type SpikeMetric = "citations" | "mentions" | "visibility";

export type SpikePlatform = "google_aio" | "chatgpt" | "perplexity" | "all";

/** A detected spike event — merged peak of consecutive spike days. */
export type Spike = {
  id: string;
  metric: SpikeMetric;
  platform: SpikePlatform;
  scopeId: string; // topic or entity id from daily_metric_snapshots.scope_id
  /** Start of the spike event (first day that crossed threshold). */
  startDate: string;
  /** Peak day — day with the highest value in the spike window. */
  peakDate: string;
  /** Value at peak. */
  peakValue: number;
  /** Trailing 7-day median baseline prior to spike start. */
  baseline: number;
  /** Absolute delta (peakValue - baseline). */
  absoluteDelta: number;
  /** Relative jump (peakValue / baseline). Infinity if baseline is 0. */
  relativeRatio: number;
  /** Number of consecutive spike days merged into this event. */
  dayCount: number;
  /** Whether baseline was effectively zero (emerging signal). */
  isEmerging: boolean;
};

/**
 * A change cluster label — groups changelog entries into meaningful families
 * that map to observed platform behavior.
 */
export type ChangeClusterLabel =
  | "faq_schema"
  | "content_structure"
  | "technical_rendering"
  | "internal_links"
  | "page_launch"
  | "metadata"
  | "citations_listings"
  | "reviews"
  | "other";

export type ChangeClusterLabelDisplay = Record<ChangeClusterLabel, string>;

/** A single changelog entry attributed to a spike window, with cluster label. */
export type WindowedChange = {
  changeId: string;
  timestamp: string;
  daysBeforeSpike: number;
  cluster: ChangeClusterLabel;
  signalType: string;
  assetType: string;
  url: string | null;
  description: string;
  topicTargeted: string;
};

/** Aggregated counts per cluster within a window. */
export type ClusterBurst = {
  cluster: ChangeClusterLabel;
  changeCount: number;
  firstChange: string; // ISO timestamp
  lastChange: string;  // ISO timestamp
  /** Sample descriptions — up to 3 representative strings. */
  sampleDescriptions: string[];
};

/** Attribution verdict for a spike — rigorous, directional. */
export type AttributionVerdict =
  | "isolated"       // single dominant cluster in closest window, others absent
  | "multi_trigger"  // 2+ clusters with significant activity in same window
  | "snowball"       // gradual buildup across multiple windows, no single trigger
  | "insufficient";  // not enough data to classify

export type AttributionRole =
  | "likely_primary_trigger"
  | "likely_amplifier"
  | "weak_contributor";

export type ClusterAttribution = {
  cluster: ChangeClusterLabel;
  role: AttributionRole;
  changeCount: number;
  /** Window this cluster primarily occurred in (1, 3, 7, or 14 days). */
  primaryWindowDays: number;
  /** Short explanation — directional, not causal. */
  rationale: string;
};

/** Platform-specific interpretation style. */
export type PlatformInterpretation =
  | "gradual_compounding"   // Google AIO — slow ramp
  | "stepwise_threshold"    // ChatGPT — sudden jumps
  | "sparse_source"         // Perplexity — source-style, low-confidence
  | "mixed";                // cross-platform spike

/** The full forensics report for a single spike. */
export type SpikeForensics = {
  spike: Spike;
  /** Changes collected in 1/3/7/14 day windows. */
  windows: {
    oneDay: WindowedChange[];
    threeDays: WindowedChange[];
    sevenDays: WindowedChange[];
    fourteenDays: WindowedChange[];
  };
  /** Cluster bursts — each window has per-cluster aggregates. */
  clusterBursts: {
    windowDays: number;
    clusters: ClusterBurst[];
  }[];
  /** Attribution by cluster — who was primary, who was amplifier, who was weak. */
  attributions: ClusterAttribution[];
  /** Overall spike classification. */
  verdict: AttributionVerdict;
  /** Platform-specific interpretation. */
  interpretation: PlatformInterpretation;
  /** Confidence tier for the whole forensics read. */
  confidence: "strong" | "moderate" | "weak" | "insufficient";
  /** Human-readable summary — directional language only. */
  explanation: string;
};

/** Display labels for cluster families. */
export const CLUSTER_LABELS: ChangeClusterLabelDisplay = {
  faq_schema: "FAQ / Schema",
  content_structure: "Content structure",
  technical_rendering: "Technical / rendering",
  internal_links: "Internal links",
  page_launch: "Page launch / rebuild",
  metadata: "Metadata",
  citations_listings: "Citations / listings",
  reviews: "Reviews",
  other: "Other",
};
