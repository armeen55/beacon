import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import {
  competitors,
  competitorSnapshots,
  opportunities,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { normalizeCompetitorDomain } from "@/domains/competitors/universe-normalize";
import { CompetitorsManageClient } from "./competitors-manage-client";

export default function CompetitorsPage() {
  const hasSnapshots = competitorSnapshots.length > 0;
  const universe = loadCompetitorUniverseRuntime();
  const activeUniverse = universe.entries.filter((e) => e.status === "active");

  return (
    <div>
      <PageHeader
        title="Competitors"
        description={
          hasSnapshots
            ? "Workspace competitor universe plus entity rows; snapshots when available."
            : "Configure who you track in `.data/competitor-universe.json`. Imported rows are separate entity records — they are not automatically your tracked set."
        }
      />

      <div className="rounded-md border border-border bg-surface-raised/30 px-4 py-3 mb-4 text-[11px] text-muted-foreground space-y-2">
        <p>
          <span className="font-semibold text-foreground">Configured universe: </span>
          {universe.origin === "empty_import_mode" && activeUniverse.length === 0
            ? "None — add `.data/competitor-universe.json` to declare who you track. Citation samples will stay “uncategorized external” until then."
            : universe.origin === "demo_defaults_explicit"
              ? `${activeUniverse.length} active (explicit demo defaults — not inferred from imports).`
              : `${activeUniverse.length} active from workspace file.`}
        </p>
        {activeUniverse.length > 0 && (
          <ul className="list-disc pl-4 space-y-0.5">
            {activeUniverse.map((e) => (
              <li key={e.id}>
                <span className="text-foreground font-medium">{e.display_name}</span>
                <span className="font-mono text-[10px] ml-1">({e.domain})</span>
                {e.tags?.length ? (
                  <span className="text-[10px] ml-1 opacity-80">
                    [{e.tags.join(", ")}]
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/50">
          Universe pin: v{universe.pin.universe_version ?? "—"} ·{" "}
          {universe.pin.universe_fingerprint?.slice(0, 18) ?? "—"}…
          {universe.pin.legacy_unversioned_file ? " · legacy inferred v1" : ""}
          {universe.pin.fingerprint_mismatch ? " · fingerprint drift vs JSON" : ""}
        </p>
      </div>

      <CompetitorsManageClient
        initialEntries={universe.entries.map((e) => ({ ...e }))}
        universeVersion={universe.pin.universe_version}
        universeFingerprint={universe.pin.universe_fingerprint}
      />

      {!hasSnapshots && hasActiveExperiment() && (
        <div className="rounded-md border border-status-warning/20 bg-status-warning/5 px-4 py-3 mb-4">
          <p className="text-[12px] text-status-warning font-medium mb-0.5">
            Secondary analysis — limited data
          </p>
          <p className="text-[11px] text-muted-foreground">
            Competitor domains were imported but no visibility snapshots exist.
            Threat levels, citation share, and share-of-voice cannot be computed without snapshot data.
            Use Review and Diagnostics for attribution-grade decisions.
          </p>
        </div>
      )}

      <h3 className="text-[12px] font-semibold text-foreground mb-2">
        Competitor entity rows (import / seed)
      </h3>
      <p className="text-[11px] text-muted-foreground mb-3">
        These back Opportunities and lookups. Match hostnames to the configured universe above —
        only the universe file defines your intentional tracked competitor set.
      </p>

      {competitors.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">No competitor entity rows</p>
          <Link href="/import" className="text-[12px] text-accent-primary hover:underline mt-1 inline-block">
            Import data
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          {competitors.map((comp) => {
            const contestedCount = opportunities.filter((o) =>
              o.competitor_ids.includes(comp.id)
            ).length;
            const dom = normalizeCompetitorDomain(comp.domain);
            const inUniverse = !!universe.domainToLabel[dom];
            const src =
              comp.source_of_truth === "imported_entity"
                ? "Imported entity"
                : comp.source_of_truth === "demo_seed"
                  ? "Demo seed"
                  : "Entity row";

            return (
              <div
                key={comp.id}
                className="rounded-md border border-border px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{comp.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {comp.domain}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {src}
                      {inUniverse ? " · matches configured universe hostname" : " · not in configured universe file"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-shrink-0">
                    {contestedCount > 0 && (
                      <span>{contestedCount} contested opportunit{contestedCount !== 1 ? "ies" : "y"}</span>
                    )}
                    {!hasSnapshots && (
                      <span className="text-[10px] text-status-warning">No snapshots</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
