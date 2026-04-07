import Link from "next/link";
import { briefs, hasActiveExperiment } from "@/lib/seed-data.server";
import { BriefsClient } from "./briefs-client";

export default function BriefsPage() {
  if (hasActiveExperiment() && briefs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-[16px] font-semibold mb-2">
          Briefs are not part of the active experiment
        </h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          The current Ritz workbook import does not include briefs.
          Briefs are execution plans created within Beacon, not imported from external data.
        </p>
        <Link
          href="/"
          className="text-[12px] text-accent-primary hover:underline font-medium"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return <BriefsClient briefs={briefs} />;
}
