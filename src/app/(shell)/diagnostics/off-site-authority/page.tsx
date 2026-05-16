/**
 * Section 7 C7a (2026-05-16) — `/diagnostics/off-site-authority`,
 * operator-only diagnostic surface.
 *
 * Hard rules pinned by architecture invariants:
 *   - force-dynamic so Vercel never statically prerenders the read
 *   - operator gate (`isOperatorModeServer()`) runs BEFORE the loader
 *     invocation; non-operators get a `notFound()`
 *   - this page does NOT import `@/lib/business-config` directly;
 *     brand name and placeholder state flow through the snapshot only
 *   - rendered copy avoids causal/scary/internal vocabulary AND the
 *     "GBP" abbreviation; full "Google Business Profile" required in
 *     visible text
 */

import { notFound } from "next/navigation";

import { PageHeader } from "@/components/data/page-header";
import { isOperatorModeServer } from "@/lib/operator-mode";

import { loadOffSitePresenceSnapshot } from "@/domains/off-site-authority/load-snapshot";
import type {
  OffSitePresenceChannel,
  OffSitePresenceConfidence,
  OffSitePresenceSource,
  OffSiteChannelState,
  OffSitePresenceSnapshot,
} from "@/domains/off-site-authority/types";

export const dynamic = "force-dynamic";

const CHANNEL_LABELS: Record<OffSitePresenceChannel, string> = {
  gbp: "Google Business Profile",
  yelp: "Yelp",
  houzz: "Houzz",
  angi: "Angi",
  bbb: "Better Business Bureau",
  industry_directory: "Industry directory (not yet detected)",
  local_press: "Local press (not yet detected)",
};

const SOURCE_LABELS: Record<OffSitePresenceSource, string> = {
  connector_api: "Connected via API",
  business_config: "From tenant configuration",
  manual_operator: "Operator-entered",
  inferred: "Not yet detected",
};

const CONFIDENCE_LABELS: Record<OffSitePresenceConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

const PLACEHOLDER_NOTE_PREFIX = "business-config is the neutral placeholder";

function describeClaimed(value: boolean | null): string {
  if (value === true) return "Confirmed";
  if (value === false) return "Beacon did not find a confirmed profile";
  return "Not yet detected";
}

function describeNumber(value: number | null, suffix = ""): string {
  if (value == null) return "—";
  return `${value}${suffix}`;
}

function describeRating(value: number | null): string {
  if (value == null) return "—";
  // One decimal point for averages; integers render as-is.
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function describeLastChecked(iso: string): string {
  return iso.slice(0, 10);
}

export default async function OffSiteAuthorityDiagnosticPage() {
  if (!(await isOperatorModeServer())) return notFound();

  const snapshot = await loadOffSitePresenceSnapshot();

  return (
    <div
      className="max-w-4xl space-y-6"
      data-diag-off-site-authority="true"
    >
      <PageHeader
        title="Off-site authority"
        description={
          snapshot.brand_name
            ? `Operator view — ${snapshot.brand_name}`
            : "Operator view"
        }
      />

      <PlaceholderBanner snapshot={snapshot} />

      {snapshot.is_local_service ? (
        <ChannelTable channels={snapshot.channels} />
      ) : (
        <NotLocalServiceNotice />
      )}

      <DataSourcesFooter notes={snapshot.data_sources_note} />
    </div>
  );
}

function PlaceholderBanner({
  snapshot,
}: {
  snapshot: OffSitePresenceSnapshot;
}) {
  const hasPlaceholder = snapshot.data_sources_note.some((n) =>
    n.startsWith(PLACEHOLDER_NOTE_PREFIX),
  );
  if (!hasPlaceholder) return null;
  return (
    <div
      className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-4 py-3"
      data-diag-off-site-authority-placeholder="true"
    >
      <p className="text-[13px] leading-relaxed text-foreground">
        Tenant config not loaded. Off-site authority detection is running
        against the neutral placeholder.
      </p>
    </div>
  );
}

function NotLocalServiceNotice() {
  return (
    <div
      className="rounded-md border border-border/60 bg-surface-inset/40 px-4 py-4"
      data-diag-off-site-authority-not-local-service="true"
    >
      <p className="text-[13px] leading-relaxed text-foreground">
        This tenant is not classified as a local-service business.
        Off-site authority detection is gated by business-config
        industry and locations. Add an industry value and at least one
        location to enable this view.
      </p>
    </div>
  );
}

function ChannelTable({
  channels,
}: {
  channels: ReadonlyArray<OffSiteChannelState>;
}) {
  return (
    <div
      className="overflow-x-auto rounded-md border border-border/60"
      data-diag-off-site-authority-table="true"
    >
      <table className="w-full text-[13px]">
        <thead className="bg-surface-inset/60">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Channel
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Claimed
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Reviews
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Rating
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Source
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Confidence
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Last checked
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((row) => (
            <tr
              key={row.channel}
              className="border-t border-border/40"
              data-diag-off-site-authority-row={row.channel}
            >
              <td className="px-3 py-2 text-foreground">
                {CHANNEL_LABELS[row.channel]}
              </td>
              <td className="px-3 py-2 text-foreground">
                {describeClaimed(row.claimed)}
              </td>
              <td className="px-3 py-2 tabular-nums text-foreground">
                {describeNumber(row.review_count)}
              </td>
              <td className="px-3 py-2 tabular-nums text-foreground">
                {describeRating(row.rating)}
              </td>
              <td className="px-3 py-2 text-foreground">
                {SOURCE_LABELS[row.source]}
              </td>
              <td className="px-3 py-2 text-foreground">
                {CONFIDENCE_LABELS[row.confidence]}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {describeLastChecked(row.last_checked_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataSourcesFooter({
  notes,
}: {
  notes: ReadonlyArray<string>;
}) {
  return (
    <div
      className="rounded-md border border-border/40 bg-surface-inset/30 px-4 py-3"
      data-diag-off-site-authority-data-sources="true"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Data sources
      </p>
      <ul className="mt-2 space-y-1">
        {notes.map((note, i) => (
          <li
            key={i}
            className="text-[12px] leading-relaxed text-muted-foreground"
            data-diag-off-site-authority-data-sources-note={i}
          >
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
