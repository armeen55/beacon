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

import { loadOffSiteRecommendationPreview } from "@/domains/off-site-authority/load-recommendation-candidates";
import type {
  OffSitePresenceChannel,
  OffSitePresenceConfidence,
  OffSitePresenceSource,
  OffSiteChannelState,
  OffSitePresenceSnapshot,
} from "@/domains/off-site-authority/types";
import type {
  OffSiteCandidateAction,
  OffSiteCandidateConfidence,
  OffSiteCandidateSilenceReason,
  OffSiteChannelDecision,
  OffSiteRecommendationCandidates,
} from "@/domains/off-site-authority/recommendation-rules";

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

/**
 * Section 7 C7g v1 (2026-05-16) — source-aware Claimed display.
 *
 * Operator-entered profile URLs (source: "business_config") are
 * NOT HTTP-verified in v1; Beacon trusts the operator's input but
 * cannot independently confirm the listing is live/complete.
 * Rendering "Configured" (not "Confirmed") keeps the trust level
 * honest. Higher-trust connector-API rows (Google / Yelp tokens)
 * continue to display "Confirmed".
 */
function describeClaimed(
  value: boolean | null,
  source: OffSitePresenceSource,
): string {
  if (value === true) {
    return source === "business_config" ? "Configured" : "Confirmed";
  }
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

  const { snapshot, recommendationCandidates } =
    await loadOffSiteRecommendationPreview();

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

      <CandidatesSection candidates={recommendationCandidates} />

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
                {row.profile_url ? (
                  <span
                    className="block max-w-[280px] truncate text-[11px] text-muted-foreground"
                    title={row.profile_url}
                    data-diag-off-site-authority-row-profile-url="true"
                  >
                    {row.profile_url}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-foreground">
                {describeClaimed(row.claimed, row.source)}
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

// ─────────────────────────────────────────────────────────────────────
// Section 7 C7c (2026-05-16) — Candidate actions operator preview.
//
// Operator-only preview of the off-site recommendation rules. No
// persistence path; no customer surface. Section copy uses safe
// observation framing (no causal claims about AI citation, ranking,
// revenue, or visibility).
// ─────────────────────────────────────────────────────────────────────

const SILENCE_REASON_LABELS: Record<OffSiteCandidateSilenceReason, string> = {
  not_local_service:
    "Off-site authority recommendations are gated by local-service classification.",
  detection_not_implemented:
    "Detection for this channel is not implemented yet. No recommendation is shown.",
  insufficient_signal: "Signal is too thin to make a confident recommendation.",
  channel_healthy: "Channel is healthy. No action recommended.",
  policy_risk_manual_only:
    "Manual review required before any recommendation is shown.",
};

const CANDIDATE_CONFIDENCE_LABELS: Record<OffSiteCandidateConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function CandidatesSection({
  candidates,
}: {
  candidates: OffSiteRecommendationCandidates;
}) {
  return (
    <div
      className="rounded-md border border-border/60"
      data-diag-off-site-authority-candidates="true"
    >
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
          Candidate actions (operator preview)
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Operator preview only. No customer-facing recommendation has been
          created. Customer surfaces remain blocked until the multi-tenant
          store prerequisite lands.
        </p>
      </div>
      <ul className="divide-y divide-border/40">
        {candidates.decisions.map((decision, i) => (
          <li
            key={`${decision.channel}-${i}`}
            className="px-4 py-3"
            data-diag-off-site-authority-candidate-row={decision.channel}
            data-diag-off-site-authority-candidate-kind={decision.kind}
          >
            <CandidateRow decision={decision} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateRow({ decision }: { decision: OffSiteChannelDecision }) {
  if (decision.kind === "silent") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[12.5px] font-medium text-muted-foreground">
          {CHANNEL_LABELS[decision.channel]}
        </p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {SILENCE_REASON_LABELS[decision.reason]}
        </p>
      </div>
    );
  }
  return <CandidateActionRow candidate={decision.candidate} />;
}

function CandidateActionRow({
  candidate,
}: {
  candidate: OffSiteCandidateAction;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">
          {CHANNEL_LABELS[candidate.channel]}
        </p>
        <span
          className="inline-flex items-center rounded-md border border-border/60 bg-surface-inset/40 px-1.5 py-0.5 text-[10.5px] font-medium text-foreground"
          data-diag-off-site-authority-candidate-confidence={candidate.confidence}
        >
          {CANDIDATE_CONFIDENCE_LABELS[candidate.confidence]} confidence
        </span>
        {candidate.policy_risk ? (
          <span
            className="inline-flex items-center rounded-md border border-status-warning/40 bg-status-warning/[0.08] px-1.5 py-0.5 text-[10.5px] font-medium text-status-warning"
            data-diag-off-site-authority-candidate-policy-risk="true"
          >
            Policy: manual follow-up only
          </span>
        ) : null}
      </div>
      <p
        className="text-[13px] font-semibold text-foreground"
        data-diag-off-site-authority-candidate-title="true"
      >
        {candidate.title}
      </p>
      <p
        className="text-[12px] leading-relaxed text-foreground/85"
        data-diag-off-site-authority-candidate-rationale="true"
      >
        {candidate.rationale}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {candidate.source_note}
      </p>
    </div>
  );
}
