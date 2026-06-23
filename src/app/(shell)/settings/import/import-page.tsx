"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { isOperatorModeClient } from "@/lib/operator-mode";

/**
 * 2026-05-06 demo-path Phase 3-bis fix 5 — gate the "Advanced" import
 * disclosure entirely behind operator mode. Pre-fix the disclosure
 * was always reachable: opening it surfaced "Internal tooling — drop
 * CSV exports on the server filesystem", "Run batch import" buttons,
 * and merge-semantics jargon. None of that is appropriate for a
 * customer-mode demo. Operator mode (NEXT_PUBLIC_OPERATOR_MODE) keeps
 * the historical workflow intact.
 */
const OPERATOR_MODE: boolean = isOperatorModeClient();
import { Upload, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/data/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  previewImport,
  executeImport,
  clearImportedData,
  getImportRuns,
  resetExperiment,
  getDataCoverage,
  postImportSetup,
} from "@/lib/import/actions";
import { importProfoundData } from "@/adapters/profound/actions";
import type { ProfoundImportResult } from "@/adapters/profound/import-orchestrator";
import { IMPORT_COLUMN_DOCS } from "@/lib/import/types";
import type { ImportEntityType, ImportFormat, ImportPreview, ImportResult, ImportRun } from "@/lib/import/types";
import { cn } from "@/lib/utils";

type DataCoverage = {
  resultCount: number;
  changeCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  platforms: string[];
  lastImportAt: string | null;
};

const ENTITY_OPTIONS: { value: ImportEntityType; label: string }[] = [
  { value: "results", label: "Results" },
  { value: "changes", label: "Changes" },
  { value: "opportunities", label: "Opportunities" },
  { value: "competitors", label: "Competitors" },
  { value: "reviews", label: "Local reviews (manual)" },
];

const FORMAT_OPTIONS: { value: ImportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
];

function friendlyImportSource(raw: string | undefined): string {
  if (!raw) return "Import";
  if (raw === "beacon-workbook" || raw === "ritz-workbook") return "Legacy workbook (removed)";
  // 2026-05-06 demo-path Phase 3-bis fix 6 — historical Profound CSV
  // imports show up in the import log. Customer-mode label hides the
  // vendor name; operator-mode log retains the raw source via the
  // run details page.
  if (raw === "profound") return "Historical CSV";
  return raw;
}

export default function ImportPage() {
  const [coverage, setCoverage] = useState<DataCoverage | null>(null);
  const [isPending, startTransition] = useTransition();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Advanced: Profound
  const [profoundResult, setProfoundResult] = useState<ProfoundImportResult | null>(null);

  // Advanced: Manual
  const [entityType, setEntityType] = useState<ImportEntityType>("results");
  const [format, setFormat] = useState<ImportFormat>("csv");
  // 2026-05-06 demo-path fix: empty default (was "profound"). The Source
  // field is operator-set; pre-filling a vendor name leaks the
  // historical Profound dependency to any non-Ritz tenant who opens
  // the advanced importer.
  const [source, setSource] = useState("");
  const [rawData, setRawData] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Advanced: Reset
  const [resetDone, setResetDone] = useState<{ cleared: Record<string, number> } | null>(null);
  const [preserveLabels, setPreserveLabels] = useState(true);

  // Advanced: History
  const [runs, setRuns] = useState<ImportRun[]>([]);

  useEffect(() => {
    getDataCoverage().then(setCoverage);
    getImportRuns().then(setRuns);
  }, []);

  const [setupResult, setSetupResult] = useState<{
    success: boolean;
    registryBuilt?: boolean;
    scanRun?: boolean;
    pagesRegistered?: number;
    pagesScanned?: number;
    error?: string;
  } | null>(null);

  const freshnessDays = (() => {
    if (!coverage?.latestDate) return null;
    return Math.floor((new Date().getTime() - new Date(coverage.latestDate).getTime()) / 86_400_000);
  })();

  const docs = IMPORT_COLUMN_DOCS[entityType];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Import past data"
        description="Beacon collects new data each time you refresh your connected accounts. You only need this page if you have older data from before you connected, and you want to load it in."
      />

      <p className="text-sm text-muted-foreground mb-6">
        Most accounts never need to use this page. New AI-answer data lands when you refresh your connected data. If you have a historical export you'd like to bring in,{" "}
        <a href="mailto:aminarmeen@gmail.com" className="text-accent-primary font-medium hover:underline">
          contact support
        </a>{" "}
        or enable advanced mode below.
      </p>

      {/* ── 1. Coverage strip ── */}
      {/* Only show the "At a glance" summary once something has actually been
          imported — a fresh tenant should not see a box of bold 0s under copy
          that says most accounts never need this page. */}
      {coverage && (coverage.resultCount > 0 || coverage.changeCount > 0) && (
        <div className="rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4 mb-6">
          <p className="text-xs font-medium text-muted-foreground mb-2">At a glance</p>
          <div className="flex items-baseline gap-4 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-bold tabular-nums">{coverage.resultCount.toLocaleString()}</span>
              <span className="text-[11px] text-muted-foreground">results</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-bold tabular-nums">{coverage.changeCount}</span>
              <span className="text-[11px] text-muted-foreground">changes</span>
            </div>
            {coverage.earliestDate && coverage.latestDate && (
              <span className="text-[11px] text-muted-foreground">
                {coverage.earliestDate} to {coverage.latestDate}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
            {coverage.platforms.length > 0 && (
              <span>
                {coverage.platforms.length} platform{coverage.platforms.length !== 1 ? "s" : ""} in sample
              </span>
            )}
            {freshnessDays !== null && (
              <span className={cn(
                "font-medium",
                freshnessDays > 7 ? "text-status-warning" : freshnessDays > 3 ? "text-muted-foreground" : "text-status-success",
              )}>
                {freshnessDays === 0 ? "Newest sample: today" : freshnessDays === 1 ? "Newest sample: yesterday" : `Newest sample: ${freshnessDays}d ago`}
              </span>
            )}
            {coverage.lastImportAt && (
              <span className="text-muted-foreground/80 text-[10px] tabular-nums">
                Last import {new Date(coverage.lastImportAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <Link href="/settings/history" className="text-accent-primary font-medium hover:underline ml-auto">
              Open History →
            </Link>
          </div>
        </div>
      )}

      {/* ── 2. Customer-safe default surface ── */}
      <div className="rounded-lg border border-border/60 bg-surface-raised/30 p-6 mb-6 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">Bring in past data</h2>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          For most accounts there's nothing to do here. Beacon picks up new data each time you refresh your connected accounts. If you have an older export you want to add, the importer is below under Advanced, or reach out to support and we'll help.
        </p>
      </div>

      {/* ── 3. Legacy / advanced importer (collapsed by default) ──
          D2 (operator audit, 2026-05-05) — the Profound batch importer
          and other internal tooling now live below the disclosure. The
          default page no longer mentions Profound, `.data/`, or
          internal copy ("bridged results", etc.). Operators with a
          legacy export can still reach the controls; new customers
          never see the internal scaffolding. */}
      {/* 2026-05-06 demo-path fix 5: the entire Advanced disclosure
          (CSV batch importer, manual paste, reset, import log) is now
          operator-only. Customer mode renders nothing here. The
          historical workflow is preserved when NEXT_PUBLIC_OPERATOR_MODE
          is set or under test. */}
      {OPERATOR_MODE && (
        <div className="border-t border-border/60 pt-6 mt-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
          >
            <span className={cn("transition-transform text-[9px] text-muted-foreground/50", advancedOpen ? "rotate-90" : "")}>
              ▶
            </span>
            Advanced: import a spreadsheet, paste data, reset, or view the import log
          </button>
          {!advancedOpen && (
            <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
              For loading data from a spreadsheet, pasting it in by hand, clearing your data, and seeing past imports.
            </p>
          )}
        </div>
      )}

      {OPERATOR_MODE && advancedOpen && (
      <div className="rounded-lg border-2 border-border/70 bg-surface-raised/30 p-6 mt-6 mb-6 space-y-4">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-accent-primary" />
          <h2 className="text-[15px] font-semibold">Import from a spreadsheet</h2>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Internal tooling — drop CSV exports on the server filesystem and the importer detects file type from headers. Multiple files of the same type are merged. Newer files win on duplicate keys (mtime order).
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-5 leading-relaxed">
          <li>Required kinds: <span className="font-mono text-foreground/90">prompts</span>, <span className="font-mono text-foreground/90">raw executions</span>, <span className="font-mono text-foreground/90">citations</span>.</li>
          <li>Optional: benchmark/summarized export, changelog.</li>
          <li>Unrecognized CSVs are skipped; check import result warnings for <span className="font-medium text-foreground">Unclassified CSV</span>.</li>
        </ul>
        <div className="rounded-md border border-border/50 bg-surface-inset/20 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">How merging works:</span> new data is added to what you already have, not swapped in. Nothing existing is deleted, and Beacon recalculates its numbers from the combined set. So you can safely add a partial export without losing older data.
        </div>
        <Button
          type="button"
          onClick={() => {
            setProfoundResult(null);
            setSetupResult(null);
            startTransition(async () => {
              const result = await importProfoundData();
              setProfoundResult(result);
              const [newCoverage, history] = await Promise.all([
                getDataCoverage(),
                getImportRuns(),
              ]);
              setCoverage(newCoverage);
              setRuns(history);
              if (result.success) {
                const setup = await postImportSetup();
                setSetupResult(setup);
              }
            });
          }}
          disabled={isPending}
          className="bg-accent-primary text-accent-primary-foreground hover:opacity-90"
        >
          {isPending ? "Importing…" : "Import these files"}
        </Button>
        {isPending && !profoundResult && (
          <p className="text-[12px] text-accent-primary font-medium animate-pulse">Running importer…</p>
        )}

        {profoundResult && (
          <div className={cn(
            "rounded-lg border p-4 space-y-3",
            profoundResult.success ? "border-status-success/35 bg-status-success/[0.05]" : "border-status-danger/35 bg-status-danger/[0.05]",
          )}>
            <div className="flex items-center gap-2">
              {profoundResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-status-success" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-status-danger" />
              )}
              <span className="text-[14px] font-semibold">
                {profoundResult.success ? "Batch complete" : "Batch failed"}
              </span>
            </div>

            {profoundResult.success && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Bridged results", value: profoundResult.counts.bridgedResults },
                  { label: "Bridged changes", value: profoundResult.counts.bridgedChanges },
                  { label: "Citations written", value: profoundResult.counts.citations },
                  { label: "Observations", value: profoundResult.counts.observations },
                ].map((s) => (
                  <div key={s.label} className="rounded border border-border bg-background px-2 py-2 text-center">
                    <p className="text-[16px] font-bold tabular-nums">{s.value.toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground leading-tight">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {profoundResult.errors.length > 0 && (
              <div className="space-y-1">
                {profoundResult.errors.map((e, i) => (
                  <p key={i} className="text-[12px] text-status-danger">{e}</p>
                ))}
              </div>
            )}

            {profoundResult.warnings.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">{profoundResult.warnings.length} warnings</summary>
                <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                  {profoundResult.warnings.slice(0, 40).map((w, i) => (
                    <p key={i} className="text-status-warning">{w}</p>
                  ))}
                </div>
              </details>
            )}

            {setupResult && profoundResult.success && (
              <div className="rounded border border-border/60 bg-background px-3 py-2 space-y-1">
                <p className="text-[10px] font-semibold text-foreground">Post-import setup</p>
                <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span className={setupResult.registryBuilt ? "text-status-success" : ""}>
                    {setupResult.registryBuilt ? `Registry (${setupResult.pagesRegistered ?? 0} pages)` : "Registry skipped"}
                  </span>
                  <span className={setupResult.scanRun ? "text-status-success" : ""}>
                    {setupResult.scanRun ? `Scan (${setupResult.pagesScanned ?? 0} pages)` : "Scan skipped"}
                  </span>
                </div>
                {setupResult.error && <p className="text-[10px] text-status-warning">{setupResult.error}</p>}
              </div>
            )}

            {profoundResult.success && (
              <div className="space-y-2 pt-1">
                <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/5 px-3 py-2">
                  <p className="text-[11px] font-medium text-accent-primary">
                    Data imported — scan your site to detect what changed
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Go to Today and run a scan. Beacon will compare your site now vs your last scan and surface any changes for you to confirm.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/" className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-[11px] font-semibold text-background hover:opacity-90">
                    Today — scan &amp; review →
                  </Link>
                  <Link href="/settings/history" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-[11px] font-medium hover:bg-surface-inset">
                    History →
                  </Link>
                  <button
                    type="button"
                    onClick={() => { setProfoundResult(null); setSetupResult(null); }}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {advancedOpen && (
        <div className="space-y-8 mt-6">
            {/* Manual Import */}
            <div className="space-y-4">
              <div>
                <h3 className="text-[13px] font-semibold mb-1">Manual import</h3>
                <p className="text-[12px] text-muted-foreground">Paste CSV or JSON data for individual entity types.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Entity</label>
                  <select value={entityType} onChange={(e) => { setEntityType(e.target.value as ImportEntityType); setPreview(null); setImportResult(null); }} className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary">
                    {ENTITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Source</label>
                  <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. csv" className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Format</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)} className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary">
                    {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {entityType === "reviews" && (
                <div className="rounded-md border border-border/60 bg-surface-raised/40 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Local reviews</span> — paste CSV or JSON you exported
                  yourself (e.g. from Google Business Profile or Yelp). Separate from the historical-citation batch section above. Required: <span className="font-mono">id, source, rating, created_at</span>.
                </div>
              )}

              <div className="rounded-md border border-border-subtle bg-surface-inset px-4 py-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Expected columns</p>
                <p className="text-[12px]"><span className="font-medium">Required:</span> <span className="font-mono">{docs.required.join(", ")}</span></p>
                <p className="text-[12px] text-muted-foreground mt-0.5"><span className="font-medium">Optional:</span> <span className="font-mono">{docs.optional.join(", ")}</span></p>
              </div>

              <textarea value={rawData} onChange={(e) => setRawData(e.target.value)} placeholder={`Paste ${format.toUpperCase()} data here...`} rows={8} className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary resize-y" />

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setImportResult(null); startTransition(async () => { const r = await previewImport(rawData, entityType, format, source); setPreview(r); }); }} disabled={isPending || !rawData.trim()}>Preview</Button>
                <Button size="sm" onClick={() => { startTransition(async () => { const r = await executeImport(rawData, entityType, format, source); setImportResult(r); setPreview(null); const [c, h] = await Promise.all([getDataCoverage(), getImportRuns()]); setCoverage(c); setRuns(h); }); }} disabled={isPending || !rawData.trim()}>
                  <Upload className="h-3.5 w-3.5" data-icon="inline-start" />
                  {isPending ? "Importing…" : "Import"}
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { await clearImportedData(entityType); setImportResult(null); })} disabled={isPending}>
                  <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
                  Clear {entityType}
                </Button>
              </div>

              {preview && (
                <div className="rounded-md border border-border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {preview.valid ? <CheckCircle2 className="h-4 w-4 text-status-success" /> : <AlertTriangle className="h-4 w-4 text-status-danger" />}
                    <span className="text-[13px] font-medium">{preview.total_rows} rows, {preview.valid_count} valid</span>
                  </div>
                  {preview.errors.length > 0 && <div className="space-y-1">{preview.errors.map((e, i) => <p key={i} className="text-[12px] text-status-danger">{e}</p>)}</div>}
                  {preview.sample.length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>{Object.keys(preview.sample[0]).map((col) => <TableHead key={col} className="text-[11px]">{col}</TableHead>)}</TableRow></TableHeader>
                        <TableBody>{preview.sample.map((row, i) => <TableRow key={i}>{Object.values(row).map((val, j) => <TableCell key={j} className="text-[12px] font-mono max-w-[200px] truncate">{String(val ?? "")}</TableCell>)}</TableRow>)}</TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {importResult && (
                <div
                  className={cn(
                    "rounded-md border p-4 space-y-2",
                    importResult.success
                      ? "border-status-success/30 bg-status-success/[0.04]"
                      : "border-status-danger/30 bg-status-danger/[0.04]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {importResult.success ? (
                      <CheckCircle2 className="h-4 w-4 text-status-success" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-status-danger" />
                    )}
                    <span className="text-[13px] font-medium">
                      {importResult.success
                        ? `Imported ${importResult.imported_count} row${importResult.imported_count !== 1 ? "s" : ""}`
                        : "Import did not complete"}
                      {importResult.success && importResult.skipped_count > 0 && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          ({importResult.skipped_count} skipped)
                        </span>
                      )}
                    </span>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="space-y-1">
                      {importResult.errors.map((e, i) => (
                        <p key={i} className="text-[12px] text-status-danger">
                          {e}
                        </p>
                      ))}
                    </div>
                  )}
                  {importResult.success && (
                    <div className="space-y-2">
                      {entityType === "results" && (
                        <p className="text-[10px] text-accent-primary">
                          Scan your site from Today to detect changes since your last scan.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3">
                        {entityType === "reviews" && (
                          <Link
                            href="/local"
                            className="inline-flex items-center gap-2 text-[11px] text-accent-primary hover:underline font-medium"
                          >
                            Local presence →
                          </Link>
                        )}
                        <Link href="/" className="inline-flex items-center gap-2 text-[11px] text-accent-primary hover:underline font-medium">Today →</Link>
                        <Link href="/settings/history" className="inline-flex items-center gap-2 text-[11px] text-accent-primary hover:underline font-medium">History →</Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reset */}
            <div className="rounded-md border border-status-danger/20 bg-status-danger/5 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[14px] font-semibold">Reset all data</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">Clear all imported data to start fresh.</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <input type="checkbox" checked={preserveLabels} onChange={(e) => setPreserveLabels(e.target.checked)} className="rounded" />
                    Keep review decisions
                  </label>
                  <Button variant="outline" size="sm" onClick={() => { if (!confirm(preserveLabels ? "Reset all imported data? Review decisions will be preserved." : "Reset ALL data including review decisions? Cannot be undone.")) return; setResetDone(null); setProfoundResult(null); setImportResult(null); setPreview(null); setSetupResult(null); startTransition(async () => { const r = await resetExperiment({ preserveTruthLabels: preserveLabels }); setResetDone(r); const c = await getDataCoverage(); setCoverage(c); setRuns([]); }); }} disabled={isPending} className="text-status-danger border-status-danger/30 hover:bg-status-danger/10">
                    <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
                    {isPending ? "Resetting…" : "Reset"}
                  </Button>
                </div>
              </div>
              {resetDone && (
                <p className="text-[12px] text-status-success font-medium mt-3">
                  Reset complete. Cleared: {resetDone.cleared.results} results, {resetDone.cleared.changes} changes.
                </p>
              )}
            </div>

            {/* Import history */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[13px] font-semibold">Import log</h3>
                <Button variant="ghost" size="sm" onClick={() => startTransition(async () => setRuns(await getImportRuns()))} disabled={isPending}>Refresh</Button>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                A list of your past uploads. For your day-by-day results, go to{" "}
                <Link href="/settings/history" className="text-accent-primary font-medium hover:underline">
                  History
                </Link>
                .
              </p>
              {runs.length > 0 ? (
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px]">Source</TableHead>
                        <TableHead className="text-[11px]">Imported</TableHead>
                        <TableHead className="text-[11px]">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.slice(0, 10).map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-[12px]">{friendlyImportSource(run.source_system)}</TableCell>
                          <TableCell className="text-[12px] tabular-nums">{run.imported_count}</TableCell>
                          <TableCell className="text-[12px] text-muted-foreground">{new Date(run.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">No imports yet.</p>
              )}
            </div>
        </div>
      )}
    </div>
  );
}
