import { NextResponse } from "next/server";

import { csvResponseHeaders } from "@/lib/csv";
import { buildActivityCsv } from "@/domains/activity/activity-csv";
import { loadActivityEvents } from "../activity-data";

/**
 * GET /activity/export (R14b, P1 trust receipts) - "Download as spreadsheet"
 * for the unified activity stream. Reads the SAME deadline-bounded composed
 * stream the /activity page loads (activity-data.ts), so downloading never
 * adds a new data source. text/csv, attachment, no store.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const events = await loadActivityEvents().catch(() => []);
  return new NextResponse(buildActivityCsv(events), {
    headers: csvResponseHeaders("beacon-activity.csv"),
  });
}
