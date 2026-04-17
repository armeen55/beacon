import { notFound } from "next/navigation";
import { PageHeader } from "@/components/data/page-header";
import { isEventTruthPreviewEnabled } from "@/lib/flags";
import { readStore } from "@/lib/persistence/json-store";
import type {
  ChangeEvent,
  EventAttribution,
  SiteMovementEvent,
} from "@/domains/events/types";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import { TruthList, type TruthRow } from "./truth-client";

type ImportedChange = {
  id: string;
  timestamp: string;
  url: string | null;
  change_description: string;
  asset_type?: string | null;
  tenant_id: string;
  archived?: boolean;
};

export const metadata = {
  title: "Event-level truth (preview) · Beacon",
};

export default async function ChangesTruthPage() {
  if (!isEventTruthPreviewEnabled()) {
    notFound();
  }

  const events = readStore<ChangeEvent>("change-events");
  const attributions = readStore<EventAttribution>("event-attributions");
  const oldOutcomes = readStore<UrlChangeOutcome>("url-change-outcomes");
  const changelog = readStore<ImportedChange>("imported-changes");
  const movements = readStore<SiteMovementEvent>("site-movement-events");

  const attrByEvent = new Map(attributions.map((a) => [a.event_id, a]));
  const changeById = new Map(changelog.map((c) => [c.id, c]));
  const movementById = new Map(movements.map((m) => [m.id, m]));
  const oldByChangeId = new Map<string, UrlChangeOutcome>();
  for (const o of oldOutcomes) {
    // First write wins — if there are stale duplicates we prefer the first.
    if (!oldByChangeId.has(o.change_id)) oldByChangeId.set(o.change_id, o);
  }

  const rows: TruthRow[] = events.map((event) => {
    const attribution = attrByEvent.get(event.id) ?? null;
    const children = event.child_change_ids
      .map((id) => {
        const change = changeById.get(id);
        const old = oldByChangeId.get(id);
        if (!change) return null;
        return {
          id,
          timestamp: change.timestamp,
          url: change.url,
          description: change.change_description,
          oldVerdict: old?.verdict ?? null,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Dominant old verdict across children — used for divergence detection.
    const oldVerdictCounts: Record<string, number> = {};
    for (const c of children) {
      if (!c.oldVerdict) continue;
      oldVerdictCounts[c.oldVerdict] = (oldVerdictCounts[c.oldVerdict] ?? 0) + 1;
    }
    const oldDominant =
      Object.entries(oldVerdictCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      null;

    const movement = attribution?.site_movement_event_id
      ? movementById.get(attribution.site_movement_event_id) ?? null
      : null;

    return {
      event,
      attribution,
      children,
      oldVerdictCounts,
      oldDominant,
      movement,
    };
  });

  // Newest first.
  rows.sort((a, b) => b.event.started_at.localeCompare(a.event.started_at));

  const lastComputed =
    attributions
      .map((a) => a.recorded_at)
      .sort()
      .at(-1) ?? null;

  const scopeCounts: Record<string, number> = {};
  for (const e of events) scopeCounts[e.scope] = (scopeCounts[e.scope] ?? 0) + 1;

  return (
    <div>
      <PageHeader
        title="Event-level truth"
        description="Preview — read-only comparison of the new event-level model against the existing URL-level verdicts. Nothing here writes to your changelog or the live /changes page."
      />

      <div className="mb-5 rounded-lg border border-accent-primary/30 bg-accent-primary/[0.04] px-4 py-3">
        <p className="text-[12px] font-semibold text-foreground">
          Phase 0 preview · feature-flagged · read-only
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          One verdict per event instead of one per edit. The 23 same-day edits
          that launched <span className="font-mono">/luxury-home-builder-bay-area</span>{" "}
          count as a single event. Post-window days flagged as data-bad (Apr 7–12)
          are excluded from the math. The existing /changes page is unchanged.
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          {events.length} events · {Object.entries(scopeCounts)
            .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
            .join(" · ")}
          {lastComputed && (
            <>
              {" · "}
              Last computed {formatWhen(lastComputed)}. Regenerate with{" "}
              <code className="font-mono text-[10px] bg-surface-inset/50 px-1 py-0.5 rounded">
                npx tsx scripts/validate-ritz-truth.ts
              </code>
              .
            </>
          )}
        </p>
      </div>

      <TruthList rows={rows} />
    </div>
  );
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const ms = now - d.getTime();
    if (ms < 60_000) return "just now";
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
