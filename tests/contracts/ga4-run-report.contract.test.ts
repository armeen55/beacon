/** Saved GA4 response through the actual traffic parser. */
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { narrowRunReportRows } from "@/lib/connectors/ga4/data-api";
it("keeps valid traffic rows and refuses malformed or absent rows", () => {
  const body = JSON.parse(readFileSync(resolve(__dirname, "fixtures/ga4-run-report.json"), "utf-8"));
  const rows = narrowRunReportRows(body);
  expect([rows.length, rows[0], rows[1]?.url]).toEqual([2, { date: "2026-07-01", url: "/koobideh-kabob", sessions: 31, engaged_sessions: 24, conversions: 2 }, "/persian-cat"]);
  expect(narrowRunReportRows(null)).toEqual([]);
});
