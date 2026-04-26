import { PageHeader } from "@/components/data/page-header";
import { readExitGates } from "@/lib/exit-gates-store";
import { ExitGatesClient } from "./exit-gates-client";

export const dynamic = "force-dynamic";

export default async function ExitGatesPage() {
  const gates = await readExitGates();

  return (
    <div>
      <PageHeader
        title="Internal sign-off"
        description="Readiness review for Daily Ritual, Replication, and the Local layer (Tracks 1.2, 1.3, 1.4). This records operator judgment only — it does not affect underlying metrics, scores, findings, freshness states, or proof logic."
      />
      <ExitGatesClient initialGates={gates} />
    </div>
  );
}
