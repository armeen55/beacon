import { notFound } from "next/navigation";
import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageShell } from "@/components/ui/page-shell";
import { loadReportModel } from "../../reports-data";
import { WinCardView, WinCardEmpty } from "../../win-card";
import { serverNowMs } from "@/lib/server-clock";

/**
 * /reports/win/[id] (P23, v1 233 export-a-win) - one measured win on its own
 * page, as the screenshot-ready export card. Reads the SAME snapshot as
 * /results and /reports (loadReportModel), so its number always agrees. When the
 * id is unknown or has no measured clicks figure yet, it self-hides into the
 * honest empty state rather than a blank page. INTERNAL-only, operator-gated.
 */

export const dynamic = "force-dynamic";

function operatorMode(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

export default async function WinExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!operatorMode()) {
    notFound();
  }
  const { id } = await params;
  const model = await loadReportModel();
  const win = model.wins.find((w) => w.id === id) ?? null;

  return (
    <PageShell
      title="Export a win"
      description="A clean card for one measured result. Screenshot it to share."
    >
      {win ? (
        <WinCardView win={win} computedAt={model.computedAt} nowMs={serverNowMs()} />
      ) : (
        <WinCardEmpty />
      )}
      <Link
        href="/reports"
        className="text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Back to the monthly report
      </Link>
    </PageShell>
  );
}
