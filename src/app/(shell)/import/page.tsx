"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { Upload, Trash2, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
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
  importWorkbook,
  resetExperiment,
  getDataCoverage,
} from "@/lib/import/actions";
import { importProfoundData } from "@/adapters/profound/actions";
import type { ProfoundImportResult } from "@/adapters/profound/import-orchestrator";
import { IMPORT_COLUMN_DOCS } from "@/lib/import/types";
import type { ImportEntityType, ImportFormat, ImportPreview, ImportResult, ImportRun, WorkbookImportResult } from "@/lib/import/types";
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
];

const FORMAT_OPTIONS: { value: ImportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
];

function friendlyImportSource(raw: string | undefined): string {
  if (!raw) return "Import";
  if (raw === "beacon-workbook" || raw === "ritz-workbook") return "Workbook (.xlsx)";
  return raw;
}

export default function ImportPage() {
  const [coverage, setCoverage] = useState<DataCoverage | null>(null);
  const [isPending, startTransition] = useTransition();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Primary upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [wbResult, setWbResult] = useState<WorkbookImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Advanced: Profound
  const [profoundResult, setProfoundResult] = useState<ProfoundImportResult | null>(null);

  // Advanced: Manual
  const [entityType, setEntityType] = useState<ImportEntityType>("results");
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [source, setSource] = useState("profound");
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

  const handleFileDrop = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) return;
    doWorkbookImport(file);
  };

  const doWorkbookImport = (file: File) => {
    setWbResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const result = await importWorkbook(fd);
      setWbResult(result);
      const [newCoverage, history] = await Promise.all([
        getDataCoverage(),
        getImportRuns(),
      ]);
      setCoverage(newCoverage);
      setRuns(history);
    });
  };

  const handleWorkbookImport = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    doWorkbookImport(file);
  };

  const freshnessDays = (() => {
    if (!coverage?.latestDate) return null;
    return Math.floor((new Date().getTime() - new Date(coverage.latestDate).getTime()) / 86_400_000);
  })();

  const docs = IMPORT_COLUMN_DOCS[entityType];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Import"
        description="Bring new visibility exports into Beacon — merges safely with what you already have. The measurement timeline lives in History."
      />

      <p className="text-sm text-muted-foreground mb-6">
        After a successful import, check{" "}
        <Link href="/results" className="text-accent-primary font-medium hover:underline">
          History
        </Link>{" "}
        for how samples line up over time, then return to Today for what changed.
      </p>

      {/* ── 1. Coverage strip ── */}
      {coverage && (
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
            <Link href="/results" className="text-accent-primary font-medium hover:underline ml-auto">
              Open History →
            </Link>
          </div>
        </div>
      )}

      {/* ── 2. Primary upload ── */}
      <div
        className={cn(
          "rounded-lg border border-dashed p-8 mb-6 text-center transition-colors",
          dragOver ? "border-accent-primary bg-accent-primary/5" : "border-border/80 hover:border-accent-primary/35",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileDrop(e.dataTransfer.files); }}
      >
        <FileSpreadsheet className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-[14px] font-semibold mb-1">
          {dragOver ? "Drop your export here" : "Drop your Profound export (.xlsx)"}
        </p>
        <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed max-w-md mx-auto">
          Beacon merges with your existing sample: new rows append, overlapping keys update. Nothing is silently duplicated.
        </p>
        <div className="flex items-center justify-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleWorkbookImport}
            className="text-[12px] file:mr-3 file:rounded file:border-0 file:bg-accent-primary file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-white hover:file:bg-accent-primary/90 file:cursor-pointer"
          />
        </div>
        {isPending && !wbResult && (
          <p className="text-[12px] text-accent-primary font-medium mt-3 animate-pulse">
            Processing import…
          </p>
        )}
      </div>

      {/* ── 3. Import result ── */}
      {wbResult && (
        <div className={cn(
          "rounded-lg border p-5 mb-6 space-y-4",
          wbResult.success ? "border-status-success/35 bg-status-success/[0.06]" : "border-status-danger/35 bg-status-danger/[0.06]",
        )}>
          <div className="flex items-center gap-2">
            {wbResult.success ? (
              <CheckCircle2 className="h-5 w-5 text-status-success" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-status-danger" />
            )}
            <span className="text-[15px] font-semibold">
              {wbResult.success ? "Import complete" : "Import failed"}
            </span>
          </div>

          {wbResult.success && wbResult.delta && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded border border-border bg-background px-3 py-2 text-center">
                  <p className="text-[18px] font-bold tabular-nums text-status-success">{wbResult.delta.results_new}</p>
                  <p className="text-[10px] text-muted-foreground">New results</p>
                </div>
                <div className="rounded border border-border bg-background px-3 py-2 text-center">
                  <p className="text-[18px] font-bold tabular-nums">{wbResult.delta.results_updated}</p>
                  <p className="text-[10px] text-muted-foreground">Updated</p>
                </div>
                <div className="rounded border border-border bg-background px-3 py-2 text-center">
                  <p className="text-[18px] font-bold tabular-nums text-status-success">{wbResult.delta.changes_new}</p>
                  <p className="text-[10px] text-muted-foreground">New changes</p>
                </div>
                <div className="rounded border border-border bg-background px-3 py-2 text-center">
                  <p className="text-[18px] font-bold tabular-nums">{wbResult.delta.changes_updated}</p>
                  <p className="text-[10px] text-muted-foreground">Updated</p>
                </div>
              </div>

              {wbResult.delta.date_range_after && (
                <p className="text-[11px] text-muted-foreground">
                  Data now covers <span className="font-medium text-foreground">{wbResult.delta.date_range_after.from}</span> to <span className="font-medium text-foreground">{wbResult.delta.date_range_after.to}</span>
                </p>
              )}
            </div>
          )}

          {wbResult.warnings.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {wbResult.warnings.length} warnings
              </summary>
              <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {wbResult.warnings.slice(0, 50).map((w, i) => (
                  <p key={i} className="text-status-warning">{w}</p>
                ))}
              </div>
            </details>
          )}

          {wbResult.errors.length > 0 && (
            <div className="space-y-1">
              {wbResult.errors.map((e, i) => (
                <p key={i} className="text-[12px] text-status-danger">{e}</p>
              ))}
            </div>
          )}

          {wbResult.success && (
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[12px] font-semibold text-background hover:opacity-90 transition-opacity"
                >
                  Back to Today <span className="opacity-60">→</span>
                </Link>
                <Link
                  href="/results"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-[12px] font-medium text-foreground hover:bg-surface-inset transition-colors"
                >
                  View History <span className="text-muted-foreground">→</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setWbResult(null)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dismiss
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Today and Opportunities refresh from this evidence; History shows the dated timeline.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 4. Advanced (collapsed) ── */}
      <div className="border-t border-border/60 pt-6 mt-8">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
        >
          <span className={cn("transition-transform text-[9px] text-muted-foreground/50", advancedOpen ? "rotate-90" : "")}>
            ▶
          </span>
          Advanced paths (CSV, manual paste, reset, import log)
        </button>

        {advancedOpen && (
          <div className="space-y-8 mt-6">
            {/* Profound CSV Import */}
            <div className="rounded-md border border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/20 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Upload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-[14px] font-semibold">Profound CSV import</h3>
              </div>
              <p className="text-[12px] text-muted-foreground mb-4">
                Import from Profound CSV exports in <code className="text-[11px] bg-muted px-1 rounded">.data/</code> directory.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setProfoundResult(null);
                  startTransition(async () => {
                    const result = await importProfoundData();
                    setProfoundResult(result);
                    const [newCoverage, history] = await Promise.all([
                      getDataCoverage(),
                      getImportRuns(),
                    ]);
                    setCoverage(newCoverage);
                    setRuns(history);
                  });
                }}
                disabled={isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isPending ? "Importing…" : "Import Profound CSVs"}
              </Button>

              {profoundResult && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {profoundResult.success ? (
                      <CheckCircle2 className="h-4 w-4 text-status-success" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-status-danger" />
                    )}
                    <span className="text-[13px] font-semibold">
                      {profoundResult.success ? "Complete" : "Failed"}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">{profoundResult.elapsed_ms}ms</span>
                  </div>

                  {profoundResult.success && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        { label: "Results", value: profoundResult.counts.bridgedResults },
                        { label: "Changes", value: profoundResult.counts.bridgedChanges },
                        { label: "Citations", value: profoundResult.counts.citations },
                        { label: "Pages", value: profoundResult.counts.pagesDiscovered },
                      ].map((s) => (
                        <div key={s.label} className="rounded border border-border bg-background px-3 py-2 text-center">
                          <p className="text-lg font-semibold tabular-nums">{s.value.toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground">{s.label}</p>
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

                  {profoundResult.success && (
                    <div className="flex flex-wrap gap-2">
                      <Link href="/" className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-[11px] font-semibold text-background hover:opacity-90 transition-opacity">
                        Today <span className="opacity-60">→</span>
                      </Link>
                      <Link href="/results" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-[11px] font-medium hover:bg-surface-inset transition-colors">
                        History <span className="text-muted-foreground">→</span>
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

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
                  <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. profound" className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Format</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)} className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary">
                    {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

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
                <div className="rounded-md border border-border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-status-success" />
                    <span className="text-[13px] font-medium">Imported {importResult.imported_count} rows{importResult.skipped_count > 0 && <span className="text-muted-foreground"> ({importResult.skipped_count} skipped)</span>}</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link href="/" className="inline-flex items-center gap-2 text-[11px] text-accent-primary hover:underline font-medium">Today →</Link>
                    <Link href="/results" className="inline-flex items-center gap-2 text-[11px] text-accent-primary hover:underline font-medium">History →</Link>
                  </div>
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
                  <Button variant="outline" size="sm" onClick={() => { if (!confirm(preserveLabels ? "Reset all imported data? Review decisions will be preserved." : "Reset ALL data including review decisions? Cannot be undone.")) return; setResetDone(null); setWbResult(null); startTransition(async () => { const r = await resetExperiment({ preserveTruthLabels: preserveLabels }); setResetDone(r); const c = await getDataCoverage(); setCoverage(c); setRuns([]); }); }} disabled={isPending} className="text-status-danger border-status-danger/30 hover:bg-status-danger/10">
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
                File runs on this workspace. For dated visibility rows across platforms, use{" "}
                <Link href="/results" className="text-accent-primary font-medium hover:underline">
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
    </div>
  );
}
