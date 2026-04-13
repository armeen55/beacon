import ResultsPage from "./results-page";

export default function SettingsHistoryPage() {
  return (
    <div>
      <div
        role="note"
        className="mb-6 rounded-lg border border-border/50 bg-surface-inset/30 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground"
      >
        <p>
          <span className="font-medium text-foreground">Imported measurements.</span> This view is
          your row-level visibility results and citation evidence as loaded from imports—the raw
          material behind Today, Changes, and Market. Use it to audit coverage, verify run linkage,
          and track freshness; it does not apply attribution rules or surface recommendations.
        </p>
      </div>
      <ResultsPage />
    </div>
  );
}
