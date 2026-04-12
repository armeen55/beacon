"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TrustSource } from "@/domains/attribution/scorecard";
import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { ChangeVerdict, AttributionConfidence, ImpactConfidence } from "@/domains/attribution/types";
import type { EvidenceTier } from "@/domains/pages/types";
import { ChangeVerdictBadge, changeVerdictLabel } from "@/components/display/change-verdict-badge";

export type ChangeIntelEntry = {
  beaconRecommended: boolean;
  matchConfidence?: "likely" | "possible";
  patternName?: string;
  replicationCount: number;
};

type SortField =
  | "date"
  | "verdict"
  | "score"
  | "events"
  | "tier"
  | "impact";

type SortDir = "asc" | "desc";

const VERDICT_ORDER: Record<ChangeVerdict, number> = {
  validated: 0,
  partial: 1,
  inconclusive: 2,
  pending: 3,
  too_early: 4,
  no_impact: 5,
  negative: 6,
};

const CONFIDENCE_LABEL: Record<ImpactConfidence, string> = {
  high: "High",
  medium: "Med",
  low: "Low",
};

const CONFIDENCE_COLOR: Record<ImpactConfidence, string> = {
  high: "text-status-success",
  medium: "text-status-warning",
  low: "text-muted-foreground",
};

const TIER_ORDER: Record<EvidenceTier, number> = {
  exact: 0,
  probable: 1,
  weak: 2,
  inferred: 3,
};

const TIER_LABELS: Record<EvidenceTier, string> = {
  exact: "Exact",
  probable: "Probable",
  weak: "Weak",
  inferred: "Inferred",
};

const TIER_COLORS: Record<EvidenceTier, string> = {
  exact: "text-status-success",
  probable: "text-foreground-secondary",
  weak: "text-muted-foreground",
  inferred: "text-muted-foreground",
};

const CONF_LABELS: Record<AttributionConfidence, string> = {
  high: "High",
  medium: "Med",
  low: "Low",
  uncertain: "—",
};

const PLATFORM_SHORT: Record<string, string> = {
  chatgpt: "GPT",
  google_aio: "AIO",
  perplexity: "Pplx",
};

const ROLE_DOT: Record<string, string> = {
  primary: "bg-status-success",
  contributing: "bg-status-warning",
  candidate: "bg-muted-foreground/50",
};

const TRUST_DOT: Record<TrustSource, string> = {
  operator_confirmed: "bg-status-success",
  auto_cleared: "bg-accent-primary",
  system_primary: "bg-accent-primary",
  contributing: "bg-status-warning",
  candidate: "bg-muted-foreground/50",
  operator_rejected: "bg-status-danger",
};

const TRUST_SHORT: Record<TrustSource, string> = {
  operator_confirmed: "Confirmed",
  auto_cleared: "Auto",
  system_primary: "System",
  contributing: "Contributing",
  candidate: "Candidate",
  operator_rejected: "Rejected",
};

export function ScorecardTable({
  rows,
  allTopics,
  allPlatforms,
  changeIntel = {},
}: {
  rows: ScorecardRowWithImpact[];
  allTopics: string[];
  allPlatforms: string[];
  changeIntel?: Record<string, ChangeIntelEntry>;
}) {
  type OutcomeCategory = "all" | "winners" | "mixed" | "no_lift" | "too_early";
  const OUTCOME_VERDICTS: Record<OutcomeCategory, ChangeVerdict[]> = {
    all: [],
    winners: ["validated"],
    mixed: ["partial", "inconclusive"],
    no_lift: ["no_impact", "negative"],
    too_early: ["too_early"],
  };
  const [outcomeCategory, setOutcomeCategory] = useState<OutcomeCategory>("all");

  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [verdictFilter, setVerdictFilter] = useState<ChangeVerdict | "all" | "actionable">(() => {
    const actionableCount = rows.filter(r => r.verdict !== "too_early").length;
    return actionableCount < rows.length ? "actionable" : "all";
  });
  const [tierFilter, setTierFilter] = useState<EvidenceTier | "all">("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [beaconFilter, setBeaconFilter] = useState(false);

  const hasAnyIntel = Object.values(changeIntel).some(
    (e) => e.beaconRecommended || e.replicationCount > 0,
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (outcomeCategory !== "all") {
        const allowed = OUTCOME_VERDICTS[outcomeCategory];
        if (!allowed.includes(r.verdict)) return false;
      }
      if (verdictFilter === "actionable" && r.verdict === "too_early") return false;
      else if (verdictFilter !== "all" && verdictFilter !== "actionable" && r.verdict !== verdictFilter) return false;
      if (tierFilter !== "all" && r.evidenceTier !== tierFilter) return false;
      if (topicFilter !== "all" && !r.topics.includes(topicFilter)) return false;
      if (platformFilter !== "all" && !r.platforms.includes(platformFilter))
        return false;
      if (beaconFilter && !changeIntel[r.change.id]?.beaconRecommended) return false;
      return true;
    });
  }, [rows, outcomeCategory, verdictFilter, tierFilter, topicFilter, platformFilter, beaconFilter, changeIntel]);

  const IMPACT_CONF_ORDER: Record<ImpactConfidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "date":
          return (
            dir *
            (new Date(a.change.timestamp).getTime() -
              new Date(b.change.timestamp).getTime())
          );
        case "verdict":
          return dir * (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]);
        case "score":
          return dir * ((a.topScore ?? -1) - (b.topScore ?? -1));
        case "events":
          return dir * (a.totalEventsLinked - b.totalEventsLinked);
        case "tier":
          return (
            dir *
            (TIER_ORDER[a.evidenceTier] - TIER_ORDER[b.evidenceTier])
          );
        case "impact":
          return (
            dir *
            (IMPACT_CONF_ORDER[a.impact.confidence] -
              IMPACT_CONF_ORDER[b.impact.confidence])
          );
        default:
          return 0;
      }
    });
  }, [filtered, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "date" ? "desc" : "desc");
    }
  }

  const verdictCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
    return c;
  }, [rows]);

  const operatorConfirmedCount = useMemo(
    () => rows.filter((r) => r.operatorConfirmedCount > 0).length,
    [rows]
  );

  const winnerCount = rows.filter(r => r.verdict === "validated").length;
  const mixedCount = rows.filter(r => r.verdict === "partial" || r.verdict === "inconclusive").length;
  const noLiftCount = rows.filter(r => r.verdict === "no_impact" || r.verdict === "negative").length;
  const tooEarlyCount = rows.filter(r => r.verdict === "too_early").length;

  return (
    <div>
      {/* Outcome category tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border/40 pb-2 overflow-x-auto">
        {([
          { key: "all" as OutcomeCategory, label: "All changes", count: rows.length },
          { key: "winners" as OutcomeCategory, label: "Proven winners", count: winnerCount },
          { key: "mixed" as OutcomeCategory, label: "Mixed signals", count: mixedCount },
          { key: "no_lift" as OutcomeCategory, label: "No measurable impact", count: noLiftCount },
          { key: "too_early" as OutcomeCategory, label: "Too early", count: tooEarlyCount },
        ] as const).filter(t => t.count > 0 || t.key === "all").map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setOutcomeCategory(tab.key); if (tab.key !== "all") setVerdictFilter("all"); }}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
              outcomeCategory === tab.key
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-[10px] opacity-60 tabular-nums">{tab.count}</span>
          </button>
        ))}
      </div>

      <details className="group/mix mb-4 rounded-md border border-border/50 bg-surface-inset/20 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="inline-block text-[9px] text-muted-foreground/50 transition-transform group-open/mix:rotate-90">▶</span>
          Outcome mix
          <span className="text-[10px] font-normal text-muted-foreground/80 tabular-nums">
            ({rows.length} total{operatorConfirmedCount > 0 ? ` · ${operatorConfirmedCount} confirmed in Review` : ""})
          </span>
        </summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] pt-1 border-t border-border/40">
          <StatPill label={changeVerdictLabel("validated")} count={verdictCounts.validated ?? 0} color="text-status-success" />
          <StatPill label={changeVerdictLabel("partial")} count={verdictCounts.partial ?? 0} color="text-status-warning" />
          <StatPill label={changeVerdictLabel("inconclusive")} count={verdictCounts.inconclusive ?? 0} color="text-muted-foreground" />
          <StatPill label={changeVerdictLabel("no_impact")} count={verdictCounts.no_impact ?? 0} color="text-status-danger" />
          {(verdictCounts.negative ?? 0) > 0 && (
            <StatPill label={changeVerdictLabel("negative")} count={verdictCounts.negative ?? 0} color="text-status-danger" />
          )}
          <StatPill label={changeVerdictLabel("too_early")} count={verdictCounts.too_early ?? 0} color="text-muted-foreground" />
        </div>
      </details>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3 text-[11px] flex-wrap">
        <span className="text-muted-foreground font-medium">Refine</span>
        <FilterSelect
          value={verdictFilter}
          onChange={(v) => setVerdictFilter(v as ChangeVerdict | "all" | "actionable")}
          options={[
            { value: "actionable", label: "Actionable" },
            { value: "all", label: "All outcomes" },
            { value: "validated", label: changeVerdictLabel("validated") },
            { value: "partial", label: changeVerdictLabel("partial") },
            { value: "inconclusive", label: changeVerdictLabel("inconclusive") },
            { value: "no_impact", label: changeVerdictLabel("no_impact") },
            { value: "negative", label: changeVerdictLabel("negative") },
            { value: "too_early", label: changeVerdictLabel("too_early") },
          ]}
        />
        <FilterSelect
          value={tierFilter}
          onChange={(v) => setTierFilter(v as EvidenceTier | "all")}
          options={[
            { value: "all", label: "All evidence" },
            { value: "exact", label: "Exact" },
            { value: "probable", label: "Probable" },
            { value: "weak", label: "Weak" },
          ]}
        />
        <FilterSelect
          value={topicFilter}
          onChange={(v) => setTopicFilter(v)}
          options={[
            { value: "all", label: "All topics" },
            ...allTopics.map((t) => ({
              value: t,
              label: t.length > 30 ? t.slice(0, 28) + "…" : t,
            })),
          ]}
        />
        <FilterSelect
          value={platformFilter}
          onChange={(v) => setPlatformFilter(v)}
          options={[
            { value: "all", label: "All platforms" },
            ...allPlatforms.map((p) => ({
              value: p,
              label: PLATFORM_SHORT[p] ?? p,
            })),
          ]}
        />
        {hasAnyIntel && (
          <button
            onClick={() => setBeaconFilter((v) => !v)}
            className={`px-2 py-0.5 rounded border text-[10px] font-medium transition-colors ${
              beaconFilter
                ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                : "border-border text-muted-foreground hover:border-accent-primary/40"
            }`}
          >
            Beacon picks only
          </button>
        )}
        <span className="text-muted-foreground ml-auto tabular-nums">
          {sorted.length}/{rows.length} changes
        </span>
      </div>

      {/* Table */}
      <div className="border border-border/70 rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-inset text-[10px] text-muted-foreground">
              <SortHeader field="date" current={sortField} dir={sortDir} onClick={handleSort}>
                When
              </SortHeader>
              <th className="text-left px-2.5 py-1.5 font-medium">Work</th>
              <SortHeader field="verdict" current={sortField} dir={sortDir} onClick={handleSort}>
                Outcome
              </SortHeader>
              <SortHeader field="score" current={sortField} dir={sortDir} onClick={handleSort}>
                Score
              </SortHeader>
              <SortHeader field="events" current={sortField} dir={sortDir} onClick={handleSort}>
                Events
              </SortHeader>
              <th className="text-left px-2.5 py-1.5 font-medium">Linked</th>
              <SortHeader field="tier" current={sortField} dir={sortDir} onClick={handleSort}>
                Match
              </SortHeader>
              <SortHeader field="impact" current={sortField} dir={sortDir} onClick={handleSort}>
                Lift
              </SortHeader>
              <th className="text-left px-2.5 py-1.5 font-medium">Next step</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <ScorecardRowUI key={row.change.id} row={row} intel={changeIntel[row.change.id]} />
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-8 text-[13px] text-muted-foreground">
          No changes match the current filters.
        </div>
      )}
    </div>
  );
}

function ScorecardRowUI({ row, intel }: { row: ScorecardRowWithImpact; intel?: ChangeIntelEntry }) {
  const ch = row.change;
  const dateStr = new Date(ch.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <tr className={`border-b border-border last:border-b-0 hover:bg-surface-inset/50 transition-colors ${row.operatorConfirmedCount > 0 ? "bg-status-success/[0.03]" : ""}`}>
      <td className="px-2.5 py-2 text-muted-foreground tabular-nums whitespace-nowrap align-top text-[11px]">
        {dateStr}
      </td>
      <td className="px-2.5 py-2 align-top max-w-[300px]">
        <Link
          href={`/changes/${ch.id}`}
          className="hover:text-accent-primary transition-colors"
        >
          <p className="font-medium text-[12px] leading-snug line-clamp-2">{ch.asset_name}</p>
          <ChangeDescriptionPreview text={ch.change_description} />
          {ch.url && (
            <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 truncate max-w-[260px]">
              {ch.url}
            </p>
          )}
        </Link>
        {intel?.beaconRecommended && (
          <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border border-accent-primary/30 bg-accent-primary/8 text-[9px] font-semibold text-accent-primary">
            <span className="h-1 w-1 rounded-full bg-accent-primary" />
            Beacon
            {intel.matchConfidence === "likely" ? "" : " (possible)"}
          </span>
        )}
        {intel && intel.replicationCount > 0 && (
          <span className="inline-flex items-center gap-1 mt-1 ml-1 px-1.5 py-0.5 rounded border border-status-success/30 bg-status-success/8 text-[9px] font-semibold text-status-success">
            {intel.replicationCount} replicable
          </span>
        )}
      </td>
      <td className="px-2.5 py-2 align-top whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <ChangeVerdictBadge verdict={row.verdict} />
          </div>
          {row.topTrust && (
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${TRUST_DOT[row.topTrust]}`} />
              <span className="text-[9px] text-muted-foreground">
                {TRUST_SHORT[row.topTrust]}
              </span>
            </span>
          )}
        </div>
      </td>
      <td className="px-2.5 py-2 align-top tabular-nums whitespace-nowrap">
        {row.topScore != null ? (
          <span className="font-medium">{Math.round(row.topScore)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {row.topConfidence && row.topConfidence !== "uncertain" && (
          <span className="text-muted-foreground text-[10px] ml-1">
            {CONF_LABELS[row.topConfidence]}
          </span>
        )}
      </td>
      <td className="px-2.5 py-2 align-top tabular-nums whitespace-nowrap">
        {row.totalEventsLinked > 0 ? (
          <span>{row.totalEventsLinked}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>
      <td className="px-2.5 py-2 align-top">
        {row.eventAttributions.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {row.eventAttributions.slice(0, 3).map((ea, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/80 px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ROLE_DOT[ea.role] ?? ROLE_DOT.candidate}`} />
                  {ea.role === "primary"
                    ? "Primary"
                    : ea.role === "contributing"
                    ? "Also"
                    : "Maybe"}
                </span>
                {ea.trustSource === "operator_confirmed" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-status-success shrink-0" title="You confirmed in Review" />
                )}
                <span className="text-[10px] text-muted-foreground">
                  {PLATFORM_SHORT[ea.event.platform] ?? ea.event.platform}
                </span>
                <span className="text-[10px] truncate max-w-[140px]">
                  {ea.event.topic}
                </span>
              </div>
            ))}
            {row.eventAttributions.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{row.eventAttributions.length - 3} more
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {row.verdict === "too_early" ? "Waiting" : "—"}
          </span>
        )}
      </td>
      <td className="px-2.5 py-2 align-top whitespace-nowrap">
        <span className={`text-[10px] font-medium ${TIER_COLORS[row.evidenceTier]}`}>
          {TIER_LABELS[row.evidenceTier]}
        </span>
      </td>
      <td className="px-2.5 py-2 align-top whitespace-nowrap">
        <ConfidenceBadge confidence={row.impact.confidence} />
      </td>
      <td className="px-2.5 py-2 align-top max-w-[200px]">
        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-snug">
          {row.impact.nextAction}
        </p>
      </td>
    </tr>
  );
}

function SortHeader({
  field,
  current,
  dir,
  onClick,
  children,
}: {
  field: SortField;
  current: SortField;
  dir: SortDir;
  onClick: (f: SortField) => void;
  children: React.ReactNode;
}) {
  const active = current === field;
  return (
    <th
      className="text-left px-2.5 py-1.5 font-medium cursor-pointer hover:text-foreground transition-colors whitespace-nowrap select-none"
      onClick={() => onClick(field)}
    >
      {children}
      {active && (
        <span className="ml-0.5 text-[8px]">{dir === "asc" ? "▲" : "▼"}</span>
      )}
    </th>
  );
}

function StatPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`font-semibold tabular-nums ${color}`}>{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ChangeDescriptionPreview({ text }: { text: string }) {
  const t = text?.trim() ?? "";
  if (!t) return null;
  const long = t.length > 96 || t.split(/\s+/).length > 14;
  if (!long) {
    return (
      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">{t}</p>
    );
  }
  return (
    <details className="group/desc mt-0.5 max-w-full">
      <summary className="cursor-pointer list-none text-left [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] text-muted-foreground line-clamp-2 leading-snug group-open/desc:hidden">{t}</span>
        <span className="hidden text-[10px] text-muted-foreground leading-snug group-open/desc:block whitespace-pre-wrap break-words">{t}</span>
        <span className="mt-0.5 block text-[9px] text-accent-primary/90 group-open/desc:hidden">Full description</span>
        <span className="mt-0.5 hidden text-[9px] text-muted-foreground group-open/desc:block">Tap to collapse</span>
      </summary>
    </details>
  );
}

function ConfidenceBadge({ confidence }: { confidence: ImpactConfidence }) {
  return (
    <span className={`text-[9px] font-semibold ${CONFIDENCE_COLOR[confidence]}`}>
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
