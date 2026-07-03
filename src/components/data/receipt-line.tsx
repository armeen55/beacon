/**
 * receipt-line (R14b, P1 trust receipts, 2026-07-03) - THE one-line receipt
 * convention for every assertion on a main surface: when a number was computed
 * and from what source, in one muted line.
 *
 *   "From your Search Console data through Jul 2, checked just now."
 *
 * PURE (no I/O, deterministic for a fixed nowMs) so both server and client
 * components can build the same line, and tests can pin the copy directly.
 * Beacon voice: first person source phrases, no lab words, no em or en dashes.
 */

export type ReceiptParts = {
  /** Plain source phrase, e.g. "your Search Console data". */
  source: string;
  /** ISO date or timestamp the data runs THROUGH (data recency). Optional. */
  through?: string | null;
  /** ISO timestamp this number was computed or checked. Optional. */
  checkedAt?: string | null;
  /** Verb for the checked clause ("checked", "planned", "assembled"). */
  verb?: string;
  /** Optional trailing plain sentence ("Google reports a few days behind."). */
  note?: string | null;
  /** Clock for the relative label. */
  nowMs: number;
};

/** "Jul 2" from an ISO date or timestamp; null when unparseable. */
export function monthDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Relative "just now / N minutes ago / N hours ago / yesterday / N days ago". */
export function checkedAgoLabel(checkedAtIso: string | null | undefined, nowMs: number): string | null {
  if (!checkedAtIso) return null;
  const t = Date.parse(checkedAtIso);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - t) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * The one-line receipt. Null when neither a through date nor a checked
 * timestamp parses (an undated receipt would just be decoration).
 */
export function buildReceiptLine(parts: ReceiptParts): string | null {
  const through = monthDayLabel(parts.through);
  const ago = checkedAgoLabel(parts.checkedAt, parts.nowMs);
  if (!through && !ago) return null;
  const verb = parts.verb ?? "checked";
  let line = `From ${parts.source}`;
  if (through) line += ` through ${through}`;
  if (ago) line += `, ${verb} ${ago}`;
  line += ".";
  if (parts.note) line += ` ${parts.note}`;
  return line;
}

/**
 * The one muted line, tokens only (design-system-guard). Renders nothing for a
 * null line so callers can pass buildReceiptLine's result straight through.
 */
export function ReceiptLine({ line, className }: { line: string | null; className?: string }) {
  if (!line) return null;
  return (
    <p data-receipt-line="true" className={`text-meta text-muted-foreground ${className ?? ""}`.trim()}>
      {line}
    </p>
  );
}
