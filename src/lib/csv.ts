/**
 * csv (R14b, P1 trust receipts, 2026-07-03) - the ONE tiny CSV encoder behind
 * every "Download as spreadsheet" action. PURE, RFC-4180 shaped: values with a
 * comma, quote, or newline are quoted; quotes double; rows join with CRLF so
 * Excel and Numbers both open it cleanly. No deps, no I/O.
 */

export function toCsvValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + data rows -> one CSV string. Every row is padded/truncated to
 *  the header width so a ragged row can never shift columns. */
export function buildCsv(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const width = headers.length;
  const line = (cells: ReadonlyArray<string | number | null | undefined>): string =>
    Array.from({ length: width }, (_, i) => toCsvValue(cells[i])).join(",");
  return [line(headers), ...rows.map(line)].join("\r\n") + "\r\n";
}

/** Standard headers for a CSV download response. */
export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
