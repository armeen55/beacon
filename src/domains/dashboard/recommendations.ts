import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { ResolvedEvent, ChangeLearning } from "@/domains/attribution/event-resolution";

export type RecommendationCategory =
  | "review"
  | "double_down"
  | "fix_metadata"
  | "deprioritize"
  | "investigate";

export type Recommendation = {
  id: string;
  category: RecommendationCategory;
  title: string;
  detail: string;
  href: string | null;
  priority: number;
};

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  review: "Review",
  double_down: "Double Down",
  fix_metadata: "Fix Data",
  deprioritize: "Deprioritize",
  investigate: "Investigate",
};

export { CATEGORY_LABELS };

/**
 * Generate evidence-backed next-best-action recommendations
 * from event resolution state and entity data.
 */
export function computeRecommendations(
  resolved: ResolvedEvent[],
  changeLearning: ChangeLearning[],
  allChanges: ChangelogEntry[],
  allResults: Result[],
  allOpportunities: Opportunity[]
): Recommendation[] {
  const recs: Recommendation[] = [];

  const pending = resolved.filter((r) => r.status === "pending");
  if (pending.length > 0) {
    const topicCounts = new Map<string, number>();
    for (const r of pending) {
      topicCounts.set(r.event.topic, (topicCounts.get(r.event.topic) ?? 0) + 1);
    }
    const topCluster = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    recs.push({
      id: "rec-review-pending",
      category: "review",
      title: `Review ${pending.length} unresolved event${pending.length !== 1 ? "s" : ""}`,
      detail:
        topCluster[1] > 1
          ? `Largest cluster: "${topCluster[0]}" (${topCluster[1]} events). Start there for maximum resolution.`
          : `${pending.length} events across different topics need attribution decisions.`,
      href: "/review",
      priority: 100,
    });
  }

  const validated = changeLearning.filter((cl) => cl.events_attributed >= 2);
  if (validated.length > 0) {
    const topChange = validated[0];
    const change = allChanges.find((c) => c.id === topChange.change_id);
    recs.push({
      id: "rec-double-down",
      category: "double_down",
      title: `Replicate "${change?.asset_name ?? topChange.change_id}"`,
      detail: `Confirmed across ${topChange.events_attributed} events (${topChange.event_types.map((t) => t.replace(/_/g, " ")).join(", ")}). This workstream has strong evidence — repeat or extend it.`,
      href: change ? `/changes/${change.id}` : null,
      priority: 90,
    });
  }

  const noCandidateEvents = resolved.filter(
    (r) => r.status === "no_candidates"
  );
  if (noCandidateEvents.length > 0) {
    const pct =
      resolved.length > 0
        ? Math.round((noCandidateEvents.length / resolved.length) * 100)
        : 0;
    recs.push({
      id: "rec-fix-metadata",
      category: "fix_metadata",
      title: `${noCandidateEvents.length} events have no candidate causes`,
      detail: `${pct}% of events can't be attributed because no changes match their topic/platform/timing. Improve changelog topic coverage or check that changes were logged.`,
      href: "/diagnostics",
      priority: 70,
    });
  }

  const noCauseEvents = resolved.filter((r) => r.status === "no_cause");
  if (noCauseEvents.length > 2) {
    recs.push({
      id: "rec-investigate-nocause",
      category: "investigate",
      title: `${noCauseEvents.length} events had all candidates rejected`,
      detail:
        "These outcomes happened but no logged change explains them. Either external factors are at play or the changelog is incomplete.",
      href: "/review",
      priority: 50,
    });
  }

  const changesWithNoEvents = allChanges.filter(
    (c) => !changeLearning.some((cl) => cl.change_id === c.id)
  );
  if (changesWithNoEvents.length > allChanges.length * 0.5 && allChanges.length > 3) {
    recs.push({
      id: "rec-deprioritize-unlinked",
      category: "deprioritize",
      title: `${changesWithNoEvents.length} changes have no event evidence`,
      detail:
        "These changes produced no detectable outcome events. Review whether they targeted the right topics/platforms or whether measurement gaps exist.",
      href: "/changes",
      priority: 40,
    });
  }

  const oppTopics = new Set(allOpportunities.map((o) => o.topic));
  const eventTopics = new Set(resolved.map((r) => r.event.topic));
  const uncoveredTopics = [...eventTopics].filter(
    (t) => ![...oppTopics].some((ot) => ot.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(ot.toLowerCase()))
  );
  if (uncoveredTopics.length > 0 && allOpportunities.length > 0) {
    recs.push({
      id: "rec-investigate-uncovered",
      category: "investigate",
      title: `${uncoveredTopics.length} event topics lack matching opportunities`,
      detail: `Topics like "${uncoveredTopics.slice(0, 2).join('", "')}" generated outcome events but have no tracked opportunity. Consider creating opportunities or linking existing ones.`,
      href: "/opportunities",
      priority: 35,
    });
  }

  if (resolved.length === 0 && allResults.length > 0) {
    recs.push({
      id: "rec-review-start",
      category: "review",
      title: "Start reviewing outcome events",
      detail: `${allResults.length} results imported but no events have been reviewed yet. Go to the review queue to begin attribution.`,
      href: "/review",
      priority: 100,
    });
  }

  return recs.sort((a, b) => b.priority - a.priority);
}
