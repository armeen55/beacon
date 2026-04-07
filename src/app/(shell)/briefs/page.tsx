import Link from "next/link";
import { briefs, hasActiveExperiment } from "@/lib/seed-data.server";
import { BriefsClient } from "./briefs-client";

export default function BriefsPage() {
  if (hasActiveExperiment() && briefs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-[16px] font-semibold mb-2">
          No execution briefs yet
        </h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          Briefs are execution plans generated from actions and promoted opportunities.
          Accept proposed briefs to create execution plans.
        </p>
        <Link
          href="/briefs/proposed"
          className="text-[12px] text-accent-primary hover:underline font-medium"
        >
          View Proposed Briefs
        </Link>
      </div>
    );
  }

  return <BriefsClient briefs={briefs} />;
}
