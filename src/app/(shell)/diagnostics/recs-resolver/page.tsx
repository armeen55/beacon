import "server-only";

/**
 * Recommendations resolver diagnostic — operator-only.
 *
 * Runs the EXACT same data path as the v2 /recommendations list +
 * /recommendations/[id] detail page, then prints a row-by-row table:
 *
 *   • the row.id the builder emitted
 *   • the encoded href the v2 card / working rail link to
 *   • the decoded id Next.js would hand to /recommendations/[id]
 *   • the resolver verdict (exact / redirect_via_edit_id /
 *     redirect_via_rec_stable_key / miss)
 *   • metadata: actionType, targetUrl, status, sourceRecommendationId,
 *     sourceEditId
 *
 * Operator scope: visit `/diagnostics/recs-resolver` signed in.
 * Read-only. No mutations. No paid APIs. No LLM calls. Tenant-scoped.
 *
 * If every row's verdict is "exact", the list/detail contract is
 * sound and the bug must live in route param transport / RSC delivery
 * outside this seam. If anything is NOT "exact", we've found the
 * production-data shape that the resolver can't recover.
 */

export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { currentTenantId } from "@/lib/tenant-context";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { loadPersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import {
  buildRecommendationDetailHref,
  decodeRecommendationRouteId,
  encodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function isAccessAllowed(): boolean {
  // Mirror /diagnostics — single source of truth for the operator gate.
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

export default async function RecsResolverDiagnosticPage() {
  if (!isAccessAllowed()) {
    notFound();
  }

  const tenantId = await currentTenantId();
  const persisted = await loadPersistedRecommendationQueueForPage({
    tenantId,
  });
  const promptTextById: Record<string, string> = {};
  for (const p of persisted.trackedPrompts) {
    promptTextById[p.id] = p.text;
  }
  const allRows = buildRecommendationActionRows({
    queue: persisted.queue,
    promptTextById,
  });

  type Audit = {
    title: string;
    rowId: string;
    encoded: string;
    decoded: string | null;
    verdict:
      | "exact"
      | "redirect_via_edit_id"
      | "redirect_via_rec_stable_key"
      | "miss"
      | "decode_returned_null";
    canonicalId: string | null;
    actionType: string;
    status: string;
    targetUrl: string | null;
    sourceRecommendationId: string;
    sourceEditId: string | null;
  };

  const audit: Audit[] = allRows.map((row) => {
    const encoded = encodeRecommendationRouteId(row.id);
    // Simulate Next.js path-segment decoding.
    const nextSegment = decodeURIComponent(encoded);
    const decoded = decodeRecommendationRouteId(nextSegment);
    if (decoded === null) {
      return {
        title: row.title,
        rowId: row.id,
        encoded,
        decoded: null,
        verdict: "decode_returned_null",
        canonicalId: null,
        actionType: row.actionType,
        status: row.status,
        targetUrl: row.targetUrl,
        sourceRecommendationId: row.sourceRecommendationId,
        sourceEditId: row.sourceEditId,
      };
    }
    const result = resolveRecommendationDetail(allRows, decoded);
    let verdict: Audit["verdict"];
    let canonicalId: string | null = null;
    if (result.kind === "exact") {
      verdict = "exact";
      canonicalId = result.row.id;
    } else if (result.kind === "redirect") {
      verdict =
        result.via === "edit_id"
          ? "redirect_via_edit_id"
          : "redirect_via_rec_stable_key";
      canonicalId = result.row.id;
    } else {
      verdict = "miss";
    }
    return {
      title: row.title,
      rowId: row.id,
      encoded,
      decoded,
      verdict,
      canonicalId,
      actionType: row.actionType,
      status: row.status,
      targetUrl: row.targetUrl,
      sourceRecommendationId: row.sourceRecommendationId,
      sourceEditId: row.sourceEditId,
    };
  });

  const exactCount = audit.filter((a) => a.verdict === "exact").length;
  const redirectCount = audit.filter(
    (a) =>
      a.verdict === "redirect_via_edit_id" ||
      a.verdict === "redirect_via_rec_stable_key",
  ).length;
  const missCount = audit.filter(
    (a) => a.verdict === "miss" || a.verdict === "decode_returned_null",
  ).length;

  const missesFirst = audit
    .slice()
    .sort((a, b) => {
      // misses first, then redirects, then exact
      const order = (v: Audit["verdict"]) =>
        v === "miss" || v === "decode_returned_null"
          ? 0
          : v === "redirect_via_edit_id" || v === "redirect_via_rec_stable_key"
            ? 1
            : 2;
      return order(a.verdict) - order(b.verdict);
    });

  return (
    <div className="max-w-7xl">
      <Link
        href="/diagnostics"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        ← Diagnostics
      </Link>

      <h1 className="mt-4 text-[18px] font-semibold text-foreground">
        Recommendations resolver diagnostic
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed max-w-2xl">
        Runs the same persisted loader + row builder + detail resolver
        the v2 list and detail pages use. Each row below shows the
        href the v2 card would generate, the decoded id Next.js would
        hand to <code className="font-mono">/recommendations/[id]</code>,
        and the resolver verdict for that decoded id. Read-only.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3 max-w-2xl">
        <SummaryCard label="Total rows" value={audit.length.toString()} />
        <SummaryCard
          label="Exact matches"
          value={`${exactCount} / ${audit.length}`}
          tone={
            audit.length > 0 && exactCount === audit.length
              ? "ok"
              : exactCount === 0
                ? "bad"
                : "warn"
          }
        />
        <SummaryCard
          label="Redirects + misses"
          value={`${redirectCount + missCount}`}
          tone={missCount > 0 ? "bad" : redirectCount > 0 ? "warn" : "ok"}
        />
      </div>

      <div className="mt-6 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>row.id</TableHead>
              <TableHead>Encoded href</TableHead>
              <TableHead>Decoded id</TableHead>
              <TableHead>Canonical id (if redirect)</TableHead>
              <TableHead>sourceEditId</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {missesFirst.map((a, i) => (
              <TableRow key={`${a.rowId}-${i}`}>
                <TableCell className="font-mono text-[11px]">{i + 1}</TableCell>
                <TableCell>
                  <VerdictPill verdict={a.verdict} />
                </TableCell>
                <TableCell className="text-[11px]">{a.status}</TableCell>
                <TableCell className="text-[11px]">{a.actionType}</TableCell>
                <TableCell className="text-[11px] max-w-xs truncate" title={a.title}>
                  {a.title}
                </TableCell>
                <TableCell className="font-mono text-[10px] max-w-xs truncate" title={a.rowId}>
                  {a.rowId}
                </TableCell>
                <TableCell className="font-mono text-[10px] max-w-xs truncate" title={a.encoded}>
                  /recommendations/{a.encoded}
                </TableCell>
                <TableCell className="font-mono text-[10px] max-w-xs truncate" title={a.decoded ?? "(null)"}>
                  {a.decoded ?? "(null)"}
                </TableCell>
                <TableCell className="font-mono text-[10px] max-w-xs truncate" title={a.canonicalId ?? ""}>
                  {a.canonicalId ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-[10px] max-w-xs truncate" title={a.sourceEditId ?? ""}>
                  {a.sourceEditId ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <details className="mt-6">
        <summary className="text-[12px] text-muted-foreground cursor-pointer">
          Raw audit (JSON)
        </summary>
        <pre className="mt-2 text-[10px] font-mono text-muted-foreground/85 overflow-x-auto bg-surface-inset/30 p-3 rounded border border-border/40 max-h-96 overflow-y-auto">
          {JSON.stringify(
            {
              tenantId,
              totalRows: audit.length,
              exact: exactCount,
              redirect: redirectCount,
              miss: missCount,
              firstTenMisses: audit
                .filter((a) => a.verdict !== "exact")
                .slice(0, 10),
            },
            null,
            2,
          )}
        </pre>
      </details>

      <p className="mt-6 text-[11px] text-muted-foreground/80 italic">
        This page is read-only. No data is modified. Anchor your bug
        analysis on the verdict column.
      </p>
    </div>
  );
}

function SummaryCard({
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
        : "border-border/60 bg-surface-inset/30 text-foreground";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function VerdictPill({
  verdict,
}: {
  verdict:
    | "exact"
    | "redirect_via_edit_id"
    | "redirect_via_rec_stable_key"
    | "miss"
    | "decode_returned_null";
}) {
  const config: Record<
    typeof verdict,
    { tone: string; label: string }
  > = {
    exact: {
      tone: "bg-status-success/10 text-status-success",
      label: "EXACT",
    },
    redirect_via_edit_id: {
      tone: "bg-status-warning/10 text-status-warning",
      label: "REDIRECT (edit_id)",
    },
    redirect_via_rec_stable_key: {
      tone: "bg-status-warning/10 text-status-warning",
      label: "REDIRECT (rec_key)",
    },
    miss: {
      tone: "bg-status-danger/10 text-status-danger",
      label: "MISS",
    },
    decode_returned_null: {
      tone: "bg-status-danger/10 text-status-danger",
      label: "DECODE NULL",
    },
  };
  const c = config[verdict];
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${c.tone}`}
    >
      {c.label}
    </span>
  );
}

// Pin the centralized href builder is what the v2 surface uses.
// Imported only so it's tree-shake-safe; surfaces a build-time check
// that the helper exists (used elsewhere in the v2 stack).
void buildRecommendationDetailHref;
