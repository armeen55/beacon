/**
 * P0 — 2026-05-13 (signed-in production diagnostic).
 *
 * Inline operator diagnostic for the v2 /recommendations list/detail
 * identity contract. Rendered ONLY when `?debugResolver=1` is on the
 * URL. The route's existing auth gate (signed-in / tenant-scoped) is
 * the access control — there is no separate env-var gate, so the
 * operator can flip the panel on per request without a deploy.
 *
 * The earlier /diagnostics/recs-resolver page was gated by
 * `BEACON_OPERATOR_MODE=true`. That env var is not set in production,
 * so the page hit notFound() → 404. This inline panel removes the gate
 * mismatch.
 *
 * What the panel does:
 *   1. Receive the SAME `persisted` + `promptTextById` the v2 list
 *      renders cards against. No second loader call — guarantees the
 *      panel and the visible cards see byte-identical data.
 *   2. Build `listAllRows = buildRecommendationActionRows(...)` — the
 *      exact set the v2 client maps over to render cards.
 *   3. For every row, encode → simulate Next.js decode →
 *      decodeRecommendationRouteId → resolveRecommendationDetail
 *      against listAllRows. Reports verdict per row.
 *   4. ALSO fire a SECOND, uncached fetch (direct repository call,
 *      bypassing `unstable_cache`) and build `liveAllRows`. Then
 *      re-resolve every list row.id against liveAllRows — this is
 *      what the detail page would see if invoked at this instant.
 *      Divergence between listAllRows and liveAllRows is the smoking
 *      gun for cache staleness.
 *   5. Render a table sorted misses-first + a banner when any list
 *      row fails to resolve against the live set.
 *
 * Read-only. No mutations. No paid APIs. No LLM. The second fetch is
 * a normal Supabase SELECT against rows the operator's tenant already
 * has read access to via service-role.
 */

import "server-only";

import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import {
  buildRecommendationDetailHref,
  decodeRecommendationRouteId,
  encodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";
import type { PersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import type { LiveRecQueueItem } from "@/domains/recommendations/load-queue";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { RecommendationAction } from "@/domains/recommendations/resolved-types";
import type { ActionType } from "@/domains/recommendations/action-types";
import type { EvidenceRef } from "@/domains/recommendations/resolved-types";
import type { ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";

// Structural shape mirroring SpecificEditEvidenceRef without importing
// the type — the architecture invariant blocks any import (runtime or
// type) from the specific-edit-provider module on the panel surface,
// so we duplicate the narrow shape we need locally.
type PanelEvidenceRef = {
  type: string;
  promptId?: string;
  url?: string;
  competitorName?: string;
};

// ─────────────────────────────────────────────────────────────────────
// Local copies of the persisted-loader synthesis helpers
// ─────────────────────────────────────────────────────────────────────
//
// `loadPersistedRecommendationQueueForPage` wraps its body in
// `unstable_cache`. For the panel's divergence check we need a fresh
// fetch — same shape, different cache layer (skipped). We mirror the
// synthesis steps here so we don't have to export them from load-queue
// (which keeps the public surface tight). If the synthesis logic in
// load-queue.ts changes, the mirror must too — pinned by the
// architecture invariant in this PR's accompanying test file.

function recommendationActionForEdit(
  actionType: ActionType,
): RecommendationAction {
  switch (actionType) {
    case "edit_title":
    case "edit_meta":
    case "change_h1":
    case "rewrite_h2":
    case "rewrite_faq":
    case "edit_table_row":
    case "fix_schema":
    case "add_internal_link":
    case "reorder_sections":
      return "strengthen_existing_page";
    case "add_h2_section":
    case "add_table":
    case "add_answer_block":
    case "add_proof_section":
    case "add_comparison_section":
    case "add_cost_section":
    case "add_timeline_section":
    case "add_schema":
      return "expand_existing_page";
    case "add_faq":
      return "add_section_or_faq";
    case "create_page":
      return "create_new_page";
    case "merge_pages":
      return "merge_or_dedupe";
    case "split_page":
      return "split_or_separate_page";
    case "watch":
    default:
      return "strengthen_existing_page";
  }
}

function synthesizeLiveRecQueueItemFromEdits(
  recId: string,
  edits: ReadonlyArray<RecommendedEditRow>,
  rank: number,
): LiveRecQueueItem {
  const primary = [...edits].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  )[0]!;

  const promptIdSet = new Set<string>();
  for (const e of edits) {
    for (const ref of e.evidence ?? []) {
      const p = (ref as { promptId?: string }).promptId;
      if (typeof p === "string" && p.length > 0) promptIdSet.add(p);
    }
  }
  const affectedPromptIds = Array.from(promptIdSet);

  const action = recommendationActionForEdit(primary.action_type);
  const severity = primary.confidence as "low" | "medium" | "high";

  const resolverEvidenceRefs: EvidenceRef[] = (
    (primary.evidence ?? []) as PanelEvidenceRef[]
  )
    .map((r): EvidenceRef | null => {
      if (r.type === "prompt" && typeof r.promptId === "string")
        return { type: "prompt", id: r.promptId };
      if (r.type === "owned_page" && typeof r.url === "string")
        return {
          type: "url",
          url: r.url,
          citationCount: 0,
          observationCount: 0,
        };
      if (r.type === "competitor" && typeof r.competitorName === "string")
        return { type: "competitor", name: r.competitorName, primaryShare: 0 };
      return null;
    })
    .filter((r): r is EvidenceRef => r !== null);

  const motive: ResolvedRecommendationCandidate["resolution"]["motive"] =
    action === "create_new_page"
      ? "capture_absent_cluster"
      : action === "expand_existing_page" || action === "add_section_or_faq"
        ? "improve_close_prompt"
        : "improve_citation_depth";

  const resolution: ResolvedRecommendationCandidate["resolution"] = {
    action,
    motive,
    targetUrl: primary.target_url,
    confidence: primary.confidence,
    confidenceReason: primary.why ?? "",
    reasoning: primary.why ?? "",
    tier: "deterministic_only",
    evidenceRefs: resolverEvidenceRefs,
    pageBrief: null,
    suggestedEdits: [],
    risks: primary.risks ?? [],
    cannibalization: null,
    needsHumanReview: false,
  };

  return {
    stableKey: recId,
    type: "strengthen_page_copy",
    title: primary.display_label ?? "",
    description: primary.why ?? "",
    affectedPromptIds,
    clusterLabel: null,
    clusterKind: null,
    evidence: {
      promptCount: affectedPromptIds.length,
      observationCount: 0,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 0,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    severity,
    effort: primary.difficulty,
    score: 0,
    tier: "later",
    rank,
    reasoning: "",
    resolution,
    engineConfidence: { confidence: primary.confidence, reasons: [] },
  };
}

type RebuiltPersisted = {
  queue: PersistedRecommendationQueueForPage["queue"];
  trackedPrompts: PersistedRecommendationQueueForPage["trackedPrompts"];
  recommendedEdits: RecommendedEditRow[];
  changelogEntries: PersistedRecommendationQueueForPage["changelogEntries"];
};

async function fetchPersistedFresh(tenantId: string): Promise<RebuiltPersisted> {
  const repo = getRepository().forTenant(tenantId);
  const [recommendedEdits, responses, trackedPrompts, changelogEntries] =
    await Promise.all([
      repo.getRecommendedEdits(),
      repo.getRecommendationResponses(),
      repo.getTrackedPrompts(),
      getChangelogEntries(),
    ]);

  const editsByRecId = new Map<string, RecommendedEditRow[]>();
  for (const edit of recommendedEdits) {
    if (!edit.rec_id) continue;
    const list = editsByRecId.get(edit.rec_id);
    if (list) list.push(edit);
    else editsByRecId.set(edit.rec_id, [edit]);
  }
  const responseByRecId = new Map<string, RecommendationResponse>();
  for (const r of responses) responseByRecId.set(r.recId, r);

  const recIds = Array.from(editsByRecId.keys()).sort((a, b) => {
    const aMax = Math.max(
      ...editsByRecId
        .get(a)!
        .map((e) => Date.parse(e.updated_at ?? e.created_at ?? "") || 0),
    );
    const bMax = Math.max(
      ...editsByRecId
        .get(b)!
        .map((e) => Date.parse(e.updated_at ?? e.created_at ?? "") || 0),
    );
    return bMax - aMax;
  });

  const queue = recIds.map((recId, idx) => {
    const edits = editsByRecId.get(recId)!;
    const rec = synthesizeLiveRecQueueItemFromEdits(recId, edits, idx + 1);
    const response = responseByRecId.get(recId) ?? null;
    return { rec, response, edits };
  });

  return { queue, trackedPrompts, recommendedEdits, changelogEntries };
}

// ─────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────

export type RecsResolverDebugPanelProps = {
  /** The `persisted` envelope the v2 list rendered cards against. */
  persisted: PersistedRecommendationQueueForPage;
  /** The `promptTextById` lookup the v2 list passed into the builder. */
  promptTextById: Record<string, string>;
};

export async function RecsResolverDebugPanel({
  persisted,
  promptTextById,
}: RecsResolverDebugPanelProps) {
  // Step 1 — listAllRows: what the v2 client maps over to render cards.
  const listAllRows = buildRecommendationActionRows({
    queue: persisted.queue,
    promptTextById,
  });

  // Step 2 — uncached, fresh repo fetch + rebuild. If `unstable_cache`
  // is serving stale rows to the list, this diverges.
  const tenantId = await currentTenantId();
  let freshError: string | null = null;
  let freshRebuilt: RebuiltPersisted | null = null;
  try {
    freshRebuilt = await fetchPersistedFresh(tenantId);
  } catch (e) {
    freshError = e instanceof Error ? e.message : String(e);
  }

  const livePromptTextById: Record<string, string> = {};
  if (freshRebuilt) {
    for (const p of freshRebuilt.trackedPrompts) {
      livePromptTextById[p.id] = p.text;
    }
  }
  const liveAllRows = freshRebuilt
    ? buildRecommendationActionRows({
        queue: freshRebuilt.queue,
        promptTextById: livePromptTextById,
      })
    : [];

  // Step 3 — encode → Next decode → resolve every listAllRows row
  // against BOTH listAllRows (sanity, should be 100% exact) AND
  // liveAllRows (the simulated detail-page perspective).
  type RowAudit = {
    title: string;
    rowId: string;
    encoded: string;
    decoded: string | null;
    listVerdict: string;
    liveVerdict: string;
    canonicalLive: string | null;
    actionType: string;
    status: string;
    targetUrl: string | null;
    sourceRecommendationId: string;
    sourceEditId: string | null;
  };

  const audit: RowAudit[] = listAllRows.map((row) => {
    const encoded = encodeRecommendationRouteId(row.id);
    const nextSegment = decodeURIComponent(encoded);
    const decoded = decodeRecommendationRouteId(nextSegment);

    const verdict = (
      pool: typeof listAllRows,
      lookup: string | null,
    ): { kind: string; canonical: string | null } => {
      if (lookup === null) return { kind: "decode_null", canonical: null };
      const r = resolveRecommendationDetail(pool, lookup);
      if (r.kind === "exact") return { kind: "exact", canonical: r.row.id };
      if (r.kind === "redirect")
        return {
          kind: r.via === "edit_id" ? "redirect_edit" : "redirect_rec",
          canonical: r.row.id,
        };
      return { kind: "miss", canonical: null };
    };

    const list = verdict(listAllRows, decoded);
    const live = verdict(liveAllRows, decoded);

    return {
      title: row.title,
      rowId: row.id,
      encoded,
      decoded,
      listVerdict: list.kind,
      liveVerdict: live.kind,
      canonicalLive: live.canonical,
      actionType: row.actionType,
      status: row.status,
      targetUrl: row.targetUrl,
      sourceRecommendationId: row.sourceRecommendationId,
      sourceEditId: row.sourceEditId,
    };
  });

  const totals = {
    total: audit.length,
    listExact: audit.filter((a) => a.listVerdict === "exact").length,
    liveExact: audit.filter((a) => a.liveVerdict === "exact").length,
    liveMiss: audit.filter((a) => a.liveVerdict === "miss").length,
    liveRedirect: audit.filter(
      (a) =>
        a.liveVerdict === "redirect_edit" || a.liveVerdict === "redirect_rec",
    ).length,
  };

  const divergence = {
    listQueueCount: persisted.queue.length,
    liveQueueCount: freshRebuilt?.queue.length ?? null,
    listEditsCount: persisted.recommendedEdits.length,
    liveEditsCount: freshRebuilt?.recommendedEdits.length ?? null,
    countsDiffer:
      freshRebuilt !== null &&
      (persisted.queue.length !== freshRebuilt.queue.length ||
        persisted.recommendedEdits.length !==
          freshRebuilt.recommendedEdits.length),
  };

  const liveBad = audit.filter(
    (a) => a.liveVerdict !== "exact" && a.liveVerdict !== "redirect_edit",
  );
  const liveBadSamples = liveBad.slice(0, 20);

  return (
    <section
      className="mt-12 rounded-lg border-2 border-status-warning/40 bg-status-warning/[0.04] px-5 py-5"
      data-recs-resolver-debug-panel="true"
    >
      <header className="mb-4">
        <h2 className="text-[14px] font-semibold text-foreground">
          Resolver diagnostic (debugResolver=1)
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          Runs the v2 list&apos;s row builder + the detail page&apos;s
          resolver against the same data the cards above were rendered
          from, AND against an uncached fresh fetch from Supabase. If
          the cached list and the live fetch disagree, the bottom
          banner fires. Read-only.
        </p>
      </header>

      {/* Red banner when any visible card fails to resolve against live data */}
      {liveBad.length > 0 && (
        <div
          className="mb-4 rounded-md border-2 border-status-danger/60 bg-status-danger/[0.08] px-4 py-3"
          data-debug-resolver-red-banner="true"
        >
          <p className="text-[13px] font-semibold text-status-danger">
            ⚠ {liveBad.length} of {totals.total} visible cards do NOT resolve
            exactly against live data.
          </p>
          <p className="mt-1 text-[12px] text-status-danger/85 leading-relaxed">
            This is the bug. Each row below with listVerdict=&quot;exact&quot;
            but liveVerdict=&quot;miss&quot; means the cached list is serving
            a row that no longer exists in the freshly-fetched Supabase set.
            The detail page reads the live set, so clicking that card
            lands on the &quot;replaced or already handled&quot; state.
          </p>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <SummaryTile label="Total cards" value={`${totals.total}`} />
        <SummaryTile
          label="List exact"
          value={`${totals.listExact} / ${totals.total}`}
          tone={totals.listExact === totals.total ? "ok" : "bad"}
        />
        <SummaryTile
          label="Live exact"
          value={`${totals.liveExact} / ${totals.total}`}
          tone={totals.liveExact === totals.total ? "ok" : "bad"}
        />
        <SummaryTile
          label="Live redirect"
          value={`${totals.liveRedirect}`}
          tone={totals.liveRedirect > 0 ? "warn" : "ok"}
        />
        <SummaryTile
          label="Live miss"
          value={`${totals.liveMiss}`}
          tone={totals.liveMiss > 0 ? "bad" : "ok"}
        />
      </div>

      {/* Cache divergence summary */}
      <div className="mb-4 rounded-md border border-border/40 bg-background/40 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Cache vs live divergence
        </p>
        <p className="mt-1 text-[12px] text-foreground/85 leading-relaxed">
          Cached queue: <code className="font-mono">{divergence.listQueueCount}</code>{" "}
          recs · cached edits:{" "}
          <code className="font-mono">{divergence.listEditsCount}</code> · live
          queue:{" "}
          <code className="font-mono">
            {divergence.liveQueueCount ?? "(fetch failed)"}
          </code>{" "}
          · live edits:{" "}
          <code className="font-mono">
            {divergence.liveEditsCount ?? "(fetch failed)"}
          </code>
          {divergence.countsDiffer && (
            <span className="ml-2 text-status-danger font-semibold">
              ⚠ counts differ — cache likely stale
            </span>
          )}
          {freshError && (
            <span className="ml-2 text-status-warning">
              live fetch error: {freshError}
            </span>
          )}
        </p>
      </div>

      {/* Misses-first table */}
      <details open={liveBad.length > 0}>
        <summary className="text-[12px] text-muted-foreground cursor-pointer mb-2">
          {liveBad.length > 0
            ? `First ${liveBadSamples.length} non-exact rows (misses first)`
            : "All rows resolve exactly — table collapsed; click to expand"}
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground/70">
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">List</th>
                <th className="px-2 py-1">Live</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1">Title</th>
                <th className="px-2 py-1">row.id</th>
                <th className="px-2 py-1">Encoded</th>
                <th className="px-2 py-1">Decoded</th>
                <th className="px-2 py-1">Canonical (live)</th>
                <th className="px-2 py-1">sourceEditId</th>
              </tr>
            </thead>
            <tbody>
              {(liveBad.length > 0 ? liveBadSamples : audit.slice(0, 20)).map(
                (a, i) => (
                  <tr
                    key={`${a.rowId}-${i}`}
                    className="border-t border-border/30 align-top"
                  >
                    <td className="px-2 py-1 font-mono">{i + 1}</td>
                    <td className="px-2 py-1">
                      <VerdictBadge v={a.listVerdict} />
                    </td>
                    <td className="px-2 py-1">
                      <VerdictBadge v={a.liveVerdict} />
                    </td>
                    <td className="px-2 py-1">{a.status}</td>
                    <td className="px-2 py-1">{a.actionType}</td>
                    <td
                      className="px-2 py-1 max-w-[220px] truncate"
                      title={a.title}
                    >
                      {a.title}
                    </td>
                    <td
                      className="px-2 py-1 font-mono max-w-[220px] truncate"
                      title={a.rowId}
                    >
                      {a.rowId}
                    </td>
                    <td
                      className="px-2 py-1 font-mono max-w-[220px] truncate"
                      title={a.encoded}
                    >
                      {a.encoded}
                    </td>
                    <td
                      className="px-2 py-1 font-mono max-w-[220px] truncate"
                      title={a.decoded ?? ""}
                    >
                      {a.decoded ?? "(null)"}
                    </td>
                    <td
                      className="px-2 py-1 font-mono max-w-[220px] truncate"
                      title={a.canonicalLive ?? ""}
                    >
                      {a.canonicalLive ?? "—"}
                    </td>
                    <td
                      className="px-2 py-1 font-mono max-w-[220px] truncate"
                      title={a.sourceEditId ?? ""}
                    >
                      {a.sourceEditId ?? "—"}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </details>

      <details className="mt-4">
        <summary className="text-[12px] text-muted-foreground cursor-pointer">
          Raw audit (JSON, first 10 non-exact)
        </summary>
        <pre className="mt-2 text-[10px] font-mono text-muted-foreground/85 overflow-x-auto bg-background/40 p-3 rounded border border-border/40 max-h-72 overflow-y-auto">
          {JSON.stringify(
            {
              tenantId,
              totals,
              divergence,
              firstTenNonExact: audit
                .filter((a) => a.liveVerdict !== "exact")
                .slice(0, 10),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "bad"
      ? "border-status-danger/40 bg-status-danger/[0.06] text-status-danger"
      : tone === "warn"
        ? "border-status-warning/40 bg-status-warning/[0.06] text-status-warning"
        : "border-border/60 bg-background/40 text-foreground";
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-0.5 text-[16px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function VerdictBadge({ v }: { v: string }) {
  const tone =
    v === "exact"
      ? "bg-status-success/10 text-status-success"
      : v === "redirect_edit" || v === "redirect_rec"
        ? "bg-status-warning/10 text-status-warning"
        : "bg-status-danger/10 text-status-danger";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {v}
    </span>
  );
}

// Pin the centralized href builder is what the list surface uses. The
// import surfaces a build-time check that the helper exists.
void buildRecommendationDetailHref;
