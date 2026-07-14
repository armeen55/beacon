import "server-only";

import { autonomousResearchStatusLine } from "@/domains/ops/autonomous-research-status";
import { readLastWarmReceipt } from "@/domains/ops/warm-receipt-store";

export { autonomousResearchStatusLine } from "@/domains/ops/autonomous-research-status";

export async function AutonomousResearchStatus({ tenantId }: { tenantId: string }) {
  const receipt = await readLastWarmReceipt(tenantId, "visit");
  return (
    <p className="-mt-4 text-xs text-muted-foreground" data-testid="autonomous-research-status">
      {autonomousResearchStatusLine(receipt)}
    </p>
  );
}
