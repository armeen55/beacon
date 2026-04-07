import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { SignalEffectivenessTable } from "@/components/data/signal-effectiveness-table";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  changelogEntries,
  briefs,
  opportunities,
  results,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import {
  computeSignalEffectiveness,
  computeChangeVerdict,
} from "@/domains/attribution/compute";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import {
  resolveEvents,
  computeChangeLearning,
  computeEventAwareChangeVerdict,
} from "@/domains/attribution/event-resolution";
import { candidateLinks } from "@/domains/attribution/store";
import { SIGNAL_TYPE_LABELS } from "@/lib/constants";

function formatDateGroup(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getAttribution(entry: (typeof changelogEntries)[0]) {
  const brief = entry.brief_id ? briefs.find((b) => b.id === entry.brief_id) : null;
  const opp = entry.opportunity_id ? opportunities.find((o) => o.id === entry.opportunity_id) : null;
  return { brief, opp };
}

export default function ChangelogPage() {
  const experimentActive = hasActiveExperiment();

  let changeLearning: ReturnType<typeof computeChangeLearning> = [];
  if (experimentActive) {
    const { attribution } = partitionResultsByMode(results);
    const events = detectOutcomeEvents(attribution);
    const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
    const candCountMap = new Map<string, number>();
    for (const ev of events) {
      const anchor = results.find((r) => r.id === ev.anchor_result_id);
      if (!anchor) continue;
      const cands = discoverCandidates(anchor, changelogEntries, opportunities);
      candCountMap.set(ev.anchor_result_id, cands.length);
      triageMap.set(ev.anchor_result_id, triageCandidates(cands));
    }
    const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
    changeLearning = computeChangeLearning(resolved);
  }

  const effectiveness = computeSignalEffectiveness(
    changelogEntries,
    results,
    opportunities
  );

  const sorted = [...changelogEntries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const groups: { date: string; entries: typeof sorted }[] = [];
  for (const entry of sorted) {
    const dateKey = new Date(entry.timestamp).toISOString().split("T")[0];
    const existing = groups.find((g) => g.date === dateKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.push({ date: dateKey, entries: [entry] });
    }
  }

  return (
    <div>
      <PageHeader
        title="Changelog"
        description="Every change made, tracked with hypothesis and attribution."
      />

      {effectiveness.length > 0 && (
        <SignalEffectivenessTable data={effectiveness} className="mb-6" />
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.date}>
            <p className="text-[12px] font-medium text-muted-foreground mb-2">
              {formatDateGroup(group.date)}
            </p>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-raised hover:bg-surface-raised">
                    <TableHead className="text-[11px] font-medium">Asset</TableHead>
                    <TableHead className="text-[11px] font-medium">Change</TableHead>
                    <TableHead className="text-[11px] font-medium">Type</TableHead>
                    <TableHead className="text-[11px] font-medium">Topic</TableHead>
                    <TableHead className="text-[11px] font-medium">Verdict</TableHead>
                    <TableHead className="text-[11px] font-medium">Attribution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.entries.map((entry) => {
                    const { brief, opp } = getAttribution(entry);
                    const verdict =
                      experimentActive && changeLearning.length > 0
                        ? computeEventAwareChangeVerdict(entry, changeLearning)
                        : computeChangeVerdict(entry, results, opportunities);
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="text-[13px] font-medium">
                          <Link
                            href={`/changes/${entry.id}`}
                            className="hover:text-accent-primary transition-colors"
                          >
                            {entry.asset_name}
                          </Link>
                          {entry.url && (
                            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              {entry.url}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-[12px] text-foreground-secondary max-w-xs">
                          <p className="line-clamp-2">{entry.change_description}</p>
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                          {SIGNAL_TYPE_LABELS[entry.signal_type]}
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {entry.topic_targeted}
                          {entry.city_targeted && (
                            <span className="block text-[11px]">{entry.city_targeted}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ChangeVerdictBadge verdict={verdict.verdict} />
                        </TableCell>
                        <TableCell className="text-[12px]">
                          {brief ? (
                            <Link
                              href={`/briefs/${brief.id}`}
                              className="text-accent-primary hover:underline"
                            >
                              {brief.title.length > 40
                                ? brief.title.substring(0, 40) + "…"
                                : brief.title}
                            </Link>
                          ) : opp ? (
                            <Link
                              href={`/opportunities/${opp.id}`}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {opp.title.length > 40
                                ? opp.title.substring(0, 40) + "…"
                                : opp.title}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
