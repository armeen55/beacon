/**
 * Standardized chart prop interfaces.
 *
 * All viz components conform to these interfaces so that the
 * underlying implementation (inline SVG, Visx, Recharts, etc.)
 * can be swapped without touching consumers.
 *
 * Domain view-models produce these shapes. Routes pass them through.
 * Charts render from them. Nobody else touches the internals.
 */

// ── Primitives ──

export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartSeries = {
  key: string;
  label: string;
  data: number[];
  color?: string;
};

// ── Bar charts ──

export type BarChartProps = {
  entries: {
    label: string;
    value: number;
    secondaryValue?: number;
    color?: string;
    meta?: string;
  }[];
  title?: string;
  subtitle?: string;
  maxValue?: number;
};

// ── Area / line charts ──

export type AreaChartProps = {
  series: ChartSeries[];
  labels: string[];
  stacked?: boolean;
};

// ── Donut / ring ──

export type DonutChartProps = {
  segments: {
    label: string;
    value: number;
    color: string;
  }[];
  centerValue?: string | number;
  centerLabel?: string;
};

// ── Score visualizations ──

export type ScoreDimensionProps = {
  label: string;
  value: number | null;
  max: number;
  status: "sufficient" | "partial" | "insufficient";
};

export type ScoreViewProps = {
  dimensions: ScoreDimensionProps[];
  composite: number | null;
  compositeStatus: "stable" | "partial" | "unavailable";
};

// ── Comparison ──

export type ComparisonProps = {
  entries: {
    label: string;
    ownedValue: number;
    competitorValue: number;
    meta?: string;
  }[];
  ownedLabel?: string;
  competitorLabel?: string;
};

// ── KPI ──

export type KpiProps = {
  label: string;
  value: string | number;
  suffix?: string;
  delta?: number | null;
  deltaSuffix?: string;
  trend?: "up" | "down" | "flat";
  sparklineData?: ChartPoint[];
  meta?: string;
};

// ── Coverage / trellis ──

export type CoverageStatus = "strong" | "moderate" | "weak" | "absent";

export type CoverageCell = {
  label: string;
  status: CoverageStatus;
  value?: number;
  meta?: string;
};

// ── Rank ──

export type RankEntryProps = {
  label: string;
  value: number;
  badge?: string;
  badgeColor?: string;
  isOwned?: boolean;
  meta?: string;
};

// ── Heat map ──

export type HeatCellProps = {
  row: string;
  col: string;
  value: number;
  label?: string;
};

// ── Threat ──

export type ThreatLevel = "high" | "moderate" | "low";

// ── Confidence ──

export type ConfidenceLevel =
  | "high" | "medium" | "low"
  | "grounded" | "inferred"
  | "insufficient" | "partial" | "sufficient";
