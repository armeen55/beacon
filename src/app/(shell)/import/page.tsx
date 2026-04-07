"use client";

import { useState, useTransition } from "react";
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
} from "@/lib/import/actions";
import { IMPORT_COLUMN_DOCS } from "@/lib/import/types";
import type { ImportEntityType, ImportFormat, ImportPreview, ImportResult, ImportRun } from "@/lib/import/types";

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

export default function ImportPage() {
  const [entityType, setEntityType] = useState<ImportEntityType>("results");
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [source, setSource] = useState("profound");
  const [rawData, setRawData] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [isPending, startTransition] = useTransition();

  const docs = IMPORT_COLUMN_DOCS[entityType];

  const handlePreview = () => {
    if (!rawData.trim()) return;
    setImportResult(null);
    startTransition(async () => {
      const result = await previewImport(rawData, entityType, format, source);
      setPreview(result);
    });
  };

  const handleImport = () => {
    if (!rawData.trim()) return;
    startTransition(async () => {
      const result = await executeImport(rawData, entityType, format, source);
      setImportResult(result);
      setPreview(null);
      const history = await getImportRuns();
      setRuns(history);
    });
  };

  const handleClearImported = () => {
    startTransition(async () => {
      await clearImportedData(entityType);
      setImportResult(null);
    });
  };

  const handleLoadHistory = () => {
    startTransition(async () => {
      const history = await getImportRuns();
      setRuns(history);
    });
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Import Historical Data"
        description="Load real campaign data for attribution truth-testing."
      />

      {/* Configuration */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Entity Type
          </label>
          <select
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value as ImportEntityType);
              setPreview(null);
              setImportResult(null);
            }}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Source
          </label>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. profound, ga4, manual"
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Format
          </label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ImportFormat)}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Column reference */}
      <div className="rounded-md border border-border-subtle bg-surface-inset px-4 py-3 mb-4">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Expected Columns
        </p>
        <p className="text-[12px] text-foreground-secondary">
          <span className="font-medium">Required:</span>{" "}
          <span className="font-mono">{docs.required.join(", ")}</span>
        </p>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          <span className="font-medium">Optional:</span>{" "}
          <span className="font-mono">{docs.optional.join(", ")}</span>
        </p>
      </div>

      {/* Data input */}
      <textarea
        value={rawData}
        onChange={(e) => setRawData(e.target.value)}
        placeholder={`Paste ${format.toUpperCase()} data here...`}
        rows={12}
        className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary resize-y mb-3"
      />

      {/* Actions */}
      <div className="flex items-center gap-2 mb-6">
        <Button variant="outline" size="sm" onClick={handlePreview} disabled={isPending || !rawData.trim()}>
          Preview
        </Button>
        <Button
          size="sm"
          onClick={handleImport}
          disabled={isPending || !rawData.trim()}
        >
          <Upload className="h-3.5 w-3.5" data-icon="inline-start" />
          {isPending ? "Importing…" : "Import"}
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={handleClearImported} disabled={isPending}>
          <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
          Clear Imported {entityType}
        </Button>
      </div>

      {/* Preview */}
      {preview && (
        <div className="rounded-md border border-border p-4 mb-6 space-y-3">
          <div className="flex items-center gap-2">
            {preview.valid ? (
              <CheckCircle2 className="h-4 w-4 text-status-success" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-status-danger" />
            )}
            <span className="text-[13px] font-medium">
              {preview.total_rows} rows parsed, {preview.valid_count} valid
              {preview.total_rows - preview.valid_count > 0 && (
                <span className="text-muted-foreground">
                  {" "}({preview.total_rows - preview.valid_count} skipped)
                </span>
              )}
            </span>
          </div>

          {preview.errors.length > 0 && (
            <div className="space-y-1">
              {preview.errors.map((e, i) => (
                <p key={i} className="text-[12px] text-status-danger">{e}</p>
              ))}
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="space-y-1">
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-[12px] text-status-warning">{w}</p>
              ))}
            </div>
          )}

          {preview.sample.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(preview.sample[0]).map((col) => (
                      <TableHead key={col} className="text-[11px]">{col}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.map((row, i) => (
                    <TableRow key={i}>
                      {Object.values(row).map((val, j) => (
                        <TableCell key={j} className="text-[12px] font-mono max-w-[200px] truncate">
                          {String(val ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div className="rounded-md border border-border p-4 mb-6 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-status-success" />
            <span className="text-[13px] font-medium">
              Imported {importResult.imported_count} rows
              {importResult.skipped_count > 0 && (
                <span className="text-muted-foreground"> ({importResult.skipped_count} skipped)</span>
              )}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground font-mono">
            Batch: {importResult.run_id}
          </p>
          {importResult.errors.length > 0 && (
            <div className="space-y-1 mt-2">
              {importResult.errors.map((e, i) => (
                <p key={i} className="text-[12px] text-status-danger">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import history */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">Import History</h3>
          <Button variant="ghost" size="sm" onClick={handleLoadHistory} disabled={isPending}>
            Refresh
          </Button>
        </div>
        {runs.length > 0 ? (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Batch</TableHead>
                  <TableHead className="text-[11px]">Source</TableHead>
                  <TableHead className="text-[11px]">Entity</TableHead>
                  <TableHead className="text-[11px]">Imported</TableHead>
                  <TableHead className="text-[11px]">Skipped</TableHead>
                  <TableHead className="text-[11px]">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-[12px] font-mono">{run.id.slice(0, 16)}</TableCell>
                    <TableCell className="text-[12px]">{run.source_system}</TableCell>
                    <TableCell className="text-[12px] capitalize">{run.entity_type}</TableCell>
                    <TableCell className="text-[12px] tabular-nums">{run.imported_count}</TableCell>
                    <TableCell className="text-[12px] tabular-nums">{run.skipped_count}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">
                      {new Date(run.started_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No imports yet. Load history or run an import above.
          </p>
        )}
      </div>
    </div>
  );
}
