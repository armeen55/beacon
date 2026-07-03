/**
 * activity-csv (R14b, P1 trust receipts, 2026-07-03) - the PURE row builder
 * behind /activity "Download as spreadsheet": the same composed stream the page
 * renders (already plain-English), one row per event. No new reads - the route
 * feeds it the events the page loader already assembles.
 */

import { buildCsv } from "@/lib/csv";
import type { ActivityEvent } from "./activity-stream";

export const ACTIVITY_CSV_HEADERS = ["When", "What", "Details", "Where to look"] as const;

export function buildActivityCsv(events: ReadonlyArray<ActivityEvent>): string {
  return buildCsv(
    ACTIVITY_CSV_HEADERS,
    events.map((e) => [e.at, e.title, e.sentence, e.href]),
  );
}
