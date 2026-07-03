import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveObservationById } from "@/domains/observations/resolve";
import {
  visibilityRunUniverseSummaryLine,
  websiteRunUniverseSummaryLine,
} from "@/domains/competitors/universe-drift-copy";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";

export default async function ObservationRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const resolved = await resolveObservationById(id);
  if (!resolved) notFound();

  if (resolved.kind === "visibility") {
    const v = resolved.run;
    const currentU = await loadCompetitorUniverseRuntime();
    return (
      <div className="max-w-2xl space-y-5">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1">
            Visibility observation run
          </p>
          <h2 className="text-[13px] font-semibold tracking-tight font-mono break-all">
            {v.run_id}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">{v.scope_label}</p>
          {v.is_synthetic_wrapper && (
            <p className="text-[10px] text-status-warning mt-2 font-medium">
              This summary was assembled by Beacon from your existing data — it
              is not a separate import or export.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-raised/30 p-3 text-[10px] space-y-1">
          <p className="font-semibold text-foreground">Competitor universe</p>
          <p className="text-muted-foreground">{visibilityRunUniverseSummaryLine(v)}</p>
          <p className="text-muted-foreground font-mono">
            Current workspace: v{currentU.pin.universe_version ?? "—"} ·{" "}
            {currentU.pin.universe_fingerprint?.slice(0, 14) ?? "—"}… (
            {currentU.origin})
          </p>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] rounded-lg border border-border bg-surface-raised/40 p-4">
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="font-medium">{v.run_type.replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-medium">
              {v.is_synthetic_wrapper
                ? "Demo data shipped with Beacon"
                : v.source}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium">{v.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Parser</dt>
            <dd className="font-medium">{v.parser_version ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Completed</dt>
            <dd className="font-mono tabular-nums text-[10px]">{v.completed_at}</dd>
          </div>
          {v.citation_index_built_at && (
            <div>
              <dt className="text-muted-foreground">Index built at</dt>
              <dd className="font-mono tabular-nums text-[10px]">{v.citation_index_built_at}</dd>
            </div>
          )}
        </dl>

        <div className="rounded-lg border border-border p-4 text-[11px] space-y-2">
          <p className="font-semibold text-foreground">Counts (rollup)</p>
          <ul className="text-muted-foreground space-y-1">
            {v.is_synthetic_wrapper ? (
              <li>No rollup data for this run yet.</li>
            ) : (
              <>
                <li>Topic buckets: {v.counts.topic_buckets}</li>
                <li>Page × topic rows: {v.counts.page_topic_rollup_rows}</li>
                <li>
                  Total citations processed: {v.counts.total_citations_accounted}
                </li>
                <li>
                  Distinct external domains (sample):{" "}
                  {v.counts.distinct_external_domains_sampled}
                </li>
                <li>Owned rollup rows: {v.counts.owned_rollup_rows}</li>
              </>
            )}
            {v.sample_result_row_count != null && v.sample_result_row_count > 0 && (
              <li className="text-foreground font-medium">
                Declared Result rows at import: {v.sample_result_row_count} (verify with{" "}
                <Link href="/settings/history" className="text-accent-primary hover:underline">
                  History
                </Link>{" "}
                <code className="text-[10px] bg-surface-inset px-1 rounded">
                  visibility_observation_run_id
                </code>
                ).
              </li>
            )}
          </ul>
        </div>

        {v.linked_citation_index_run_id && (
          <p className="text-[11px] text-muted-foreground">
            Linked citation rollup run:{" "}
            <Link
              href={`/observations/${encodeURIComponent(v.linked_citation_index_run_id)}`}
              className="text-accent-primary hover:underline font-mono text-[10px] break-all"
            >
              {v.linked_citation_index_run_id}
            </Link>
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          Fine-grained citation observations (per answer / URL) may live in sharded <code className="text-[10px] bg-surface-inset px-1 rounded">.data</code>{" "}
          stores used to build the citation index — this screen shows the visibility run envelope, not every observation row.
        </p>

        <Link href="/settings/history" className="inline-block text-[11px] text-accent-primary hover:underline">
          History →
        </Link>
        <Link href="/" className="inline-block text-[11px] text-accent-primary hover:underline ml-4">
          ← Today
        </Link>
      </div>
    );
  }

  const run = resolved.run;
  const isVerify = run.run_type === "website_verify";
  const currentU = await loadCompetitorUniverseRuntime();
  const webUni = websiteRunUniverseSummaryLine(run);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground mb-1">
          {isVerify ? "Website verify pass" : "Website observation run"}
        </p>
        <h2 className="text-[13px] font-semibold tracking-tight font-mono break-all">
          {run.run_id}
        </h2>
        <p className="text-[11px] text-muted-foreground mt-1">{run.scope_label}</p>
      </div>

      <div className="rounded-lg border border-border bg-surface-raised/30 p-3 text-[10px] space-y-1">
        <p className="font-semibold text-foreground">Competitor universe (crawl era)</p>
        <p className="text-muted-foreground">{webUni}</p>
        <p className="text-muted-foreground font-mono">
          Current workspace: v{currentU.pin.universe_version ?? "—"} ·{" "}
          {currentU.pin.universe_fingerprint?.slice(0, 14) ?? "—"}…
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] rounded-lg border border-border bg-surface-raised/40 p-4">
        <div>
          <dt className="text-muted-foreground">Type</dt>
          <dd className="font-medium">{run.run_type.replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-medium">{run.source}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">{run.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Parser</dt>
          <dd className="font-medium">{run.parser_version ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Started</dt>
          <dd className="font-mono tabular-nums text-[10px]">{run.started_at}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Completed</dt>
          <dd className="font-mono tabular-nums text-[10px]">{run.completed_at}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Baseline run</dt>
          <dd className="font-mono text-[10px] break-all">
            {run.baseline_run_id ? (
              <Link
                href={`/observations/${encodeURIComponent(run.baseline_run_id)}`}
                className="text-accent-primary hover:underline"
              >
                {run.baseline_run_id}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-border p-4 text-[11px] space-y-2">
        <p className="font-semibold text-foreground">Artifact counts</p>
        <ul className="text-muted-foreground space-y-1">
          <li>Pages scanned: {run.pages_scanned}</li>
          <li>Pages changed (vs baseline snapshots): {run.pages_changed}</li>
          <li>Fetch errors: {run.pages_with_errors}</li>
          <li>Guardrail alerts: {run.guardrail_alerts}</li>
          <li>Critical / regression / improvement: {run.critical_count} /{" "}
            {run.regression_count} / {run.improvement_count}</li>
        </ul>
      </div>

      <div className="text-[11px] text-muted-foreground space-y-2">
        {isVerify ? (
          <p>
            This pass is a <span className="font-medium text-foreground">live HTML fetch</span>{" "}
            from ship verification. The snapshot and guardrails for this URL are stamped with this
            run id. Baseline (if any) is the crawl snapshot on disk before the fetch.
          </p>
        ) : (
          <p>
            Snapshots and guardrails from bulk crawl reference{" "}
            <code className="text-[10px] bg-surface-inset px-1 rounded">observation_run_id</code> when
            written by the scanner.
          </p>
        )}
        <p>
          Open{" "}
          <Link href="/changes" className="text-accent-primary hover:underline">
            Changes
          </Link>{" "}
          for per-URL drill-down.
        </p>
      </div>

      <Link
        href="/"
        className="inline-block text-[11px] text-accent-primary hover:underline"
      >
        ← Today
      </Link>
    </div>
  );
}
