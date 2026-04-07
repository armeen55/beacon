import Link from "next/link";
import { coverageItems, hasActiveExperiment } from "@/lib/seed-data.server";
import { CoverageClient } from "./coverage-client";

export default function CoveragePage() {
  if (hasActiveExperiment() && coverageItems.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-[16px] font-semibold mb-2">
          Coverage tracking is not active for this experiment
        </h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          Coverage items are not imported from the Ritz workbook.
          Use the Review and Diagnostics surfaces to analyze attribution coverage for the active experiment.
        </p>
        <div className="flex justify-center gap-4">
          <Link
            href="/review"
            className="text-[12px] text-accent-primary hover:underline font-medium"
          >
            Review Events
          </Link>
          <Link
            href="/diagnostics"
            className="text-[12px] text-accent-primary hover:underline font-medium"
          >
            Diagnostics
          </Link>
        </div>
      </div>
    );
  }

  return <CoverageClient coverageItems={coverageItems} />;
}
