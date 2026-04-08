import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import {
  changelogEntries,
  opportunities,
  results,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import {
  computeChangeVerdict,
} from "@/domains/attribution/compute";
import {
  computeChangeLearning,
  computeEventAwareChangeVerdict,
} from "@/domains/attribution/event-resolution";
import { candidateLinks } from "@/domains/attribution/store";
import { SIGNAL_TYPE_LABELS } from "@/lib/constants";
import { computeFullActionQueue } from "@/domains/actions/compute";
import { actionStates } from "@/domains/actions/store";

type EvidenceState = "evidence" | "awaiting" | "no_signal";

function getEvidenceState(
  entry: (typeof changelogEntries)[0],
  changeLearning: ReturnType<typeof computeChangeLearning>
): EvidenceState {
  const learning = changeLearning.find((cl) => cl.change_id === entry.id);
  if (learning && learning.events_attributed > 0) return "evidence";
  const hasCandidate = candidateLinks.some((cl) => cl.change_id === entry.id);
  if (hasCandidate) return "awaiting";
  return "no_signal";
}

const EVIDENCE_LABELS: Record<EvidenceState, string> = {
  evidence: "Showing up in results",
  awaiting: "Waiting for a match",
  no_signal: "Not tied to a move yet",
};

const EVIDENCE_COLORS: Record<EvidenceState, string> = {
  evidence: "text-status-success",
  awaiting: "text-status-warning",
  no_signal: "text-muted-foreground",
};

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filterEvidence = typeof params.evidence === "string" ? params.evidence as EvidenceState : null;
  const filterType = typeof params.type === "string" ? params.type : null;

  const experimentActive = hasActiveExperiment();

  let changeLearning: ReturnType<typeof computeChangeLearning> = [];
  const actionFollowUpIndex = new Set<string>();

  if (experimentActive) {
    const { actions, clusters, resolvedEvents } = computeFullActionQueue(
      results,
      changelogEntries,
      opportunities,
      candidateLinks
    );
    changeLearning = computeChangeLearning(resolvedEvents);

    for (const state of actionStates) {
      for (const cid of state.linkedFollowUpChangeIds) {
        actionFollowUpIndex.add(cid);
      }
    }
  }

  const sorted = [...changelogEntries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Compute evidence states
  const withEvidence = sorted.map((entry) => ({
    entry,
    evidenceState: experimentActive
      ? getEvidenceState(entry, changeLearning)
      : "no_signal" as EvidenceState,
    learning: changeLearning.find((cl) => cl.change_id === entry.id) ?? null,
  }));

  // Apply filters
  const filtered = withEvidence.filter((row) => {
    if (filterEvidence && row.evidenceState !== filterEvidence) return false;
    if (filterType && row.entry.signal_type !== filterType) return false;
    return true;
  });

  // Stats
  const evidenceCount = withEvidence.filter((r) => r.evidenceState === "evidence").length;
  const awaitingCount = withEvidence.filter((r) => r.evidenceState === "awaiting").length;
  const noSignalCount = withEvidence.filter((r) => r.evidenceState === "no_signal").length;

  // Signal types for filter
  const signalTypes = [...new Set(changelogEntries.map((e) => e.signal_type))];

  return (
    <div>
      <PageHeader
        title="Changelog"
        description={`${changelogEntries.length} things you shipped. ${evidenceCount} showing up in results, ${awaitingCount} waiting for a match, ${noSignalCount} not tied to a move yet.`}
      />

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap text-[11px]">
        <span className="text-muted-foreground font-medium">Filter:</span>
        <FilterLink href="/changes" label="All" active={!filterEvidence && !filterType} count={sorted.length} />
        <FilterLink href="/changes?evidence=evidence" label="Evidence found" active={filterEvidence === "evidence"} count={evidenceCount} />
        <FilterLink href="/changes?evidence=awaiting" label="Awaiting attribution" active={filterEvidence === "awaiting"} count={awaitingCount} />
        <FilterLink href="/changes?evidence=no_signal" label="No signal" active={filterEvidence === "no_signal"} count={noSignalCount} />
        {filterType && (
          <span className="text-muted-foreground">
            · Type: {SIGNAL_TYPE_LABELS[filterType as keyof typeof SIGNAL_TYPE_LABELS] ?? filterType}{" "}
            <Link href="/changes" className="text-accent-primary hover:underline">clear</Link>
          </span>
        )}
      </div>

      {/* Signal type filters */}
      {!filterType && signalTypes.length > 1 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap text-[10px]">
          <span className="text-muted-foreground">By type:</span>
          {signalTypes.map((st) => (
            <Link
              key={st}
              href={`/changes?type=${encodeURIComponent(st)}${filterEvidence ? `&evidence=${filterEvidence}` : ""}`}
              className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-inset transition-colors"
            >
              {SIGNAL_TYPE_LABELS[st as keyof typeof SIGNAL_TYPE_LABELS] ?? st}
            </Link>
          ))}
        </div>
      )}

      {/* Change list */}
      <div className="space-y-1.5">
        {filtered.map(({ entry, evidenceState, learning }) => {
          const verdict =
            experimentActive && changeLearning.length > 0
              ? computeEventAwareChangeVerdict(entry, changeLearning)
              : computeChangeVerdict(entry, results, opportunities);
          const isFollowUp = actionFollowUpIndex.has(entry.id);

          return (
            <Link
              key={entry.id}
              href={`/changes/${entry.id}`}
              className="block rounded-md border border-border px-4 py-3 hover:bg-surface-inset transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium truncate">
                      {entry.asset_name}
                    </p>
                    {isFollowUp && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">
                        Action Follow-up
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">
                    {entry.change_description}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{SIGNAL_TYPE_LABELS[entry.signal_type]}</span>
                    <span>·</span>
                    <span>{new Date(entry.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    {entry.url && (
                      <>
                        <span>·</span>
                        <span className="font-mono truncate max-w-[200px]">{entry.url}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ChangeVerdictBadge verdict={verdict.verdict} />
                  <span className={`text-[10px] font-medium ${EVIDENCE_COLORS[evidenceState]}`}>
                    {EVIDENCE_LABELS[evidenceState]}
                  </span>
                  {learning && learning.events_attributed > 0 && (
                    <span className="text-[10px] text-status-success tabular-nums">
                      {learning.events_attributed} event{learning.events_attributed !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">No changes match this filter</p>
          <Link href="/changes" className="text-[12px] text-accent-primary hover:underline mt-1 inline-block">
            Clear filters
          </Link>
        </div>
      )}
    </div>
  );
}

function FilterLink({
  href,
  label,
  active,
  count,
}: {
  href: string;
  label: string;
  active: boolean;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-0.5 transition-colors ${
        active
          ? "border-accent-primary bg-accent-primary/10 text-accent-primary font-medium"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-surface-inset"
      }`}
    >
      {label} <span className="tabular-nums">{count}</span>
    </Link>
  );
}
