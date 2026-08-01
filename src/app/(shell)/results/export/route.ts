import { NextResponse } from "next/server";

import { csvResponseHeaders } from "@/lib/csv";
import { loadResultsLedgerSurface } from "../results-ledger-data";
import { buildResultsCsv } from "../results-csv";

/**
 * GET /results/export (R14b, P1 trust receipts) - "Download as spreadsheet"
 * for the measured-outcomes ledger. Reads the SAME snapshot-served surface the
 * /results page reads (results-ledger-data.ts's SWR cache), so downloading
 * never triggers a fresh measure pass or any new data source. text/csv,
 * attachment, no store.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const surface = await loadResultsLedgerSurface().catch(() => null);
  const csv = buildResultsCsv((surface?.shipments ?? []).map((s) => s.read));
  return new NextResponse(csv, { headers: csvResponseHeaders("beacon-results.csv") });
}
