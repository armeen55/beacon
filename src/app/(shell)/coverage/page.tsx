import { coverageItems } from "@/lib/seed-data.server";
import { CoverageClient } from "./coverage-client";

export default function CoveragePage() {
  return <CoverageClient coverageItems={coverageItems} />;
}
