/**
 * Phase 0 — Event assembler.
 *
 * Converts a list of changelog rows into `ChangeEvent` parents by applying
 * three precedence rules (A > B > C). First match claims a row; subsequent
 * rules only see unclaimed rows.
 *
 *   Rule A — `compound_launch` (primary signal: page-creation semantics +
 *            URL's first-citation-data appearance). Children = all same-URL
 *            rows within [F−3, F+3].
 *
 *   Rule B — `sitewide_rollout`:
 *            B1 = explicit sitewide rows (url null, or url is a non-page
 *                 label like `llms.txt`, `sitemap.xml`, `All Pages`, …).
 *            B2 = multi-page clustered rollout: ≥5 rows, ≥3 distinct URLs,
 *                 sharing a semantic family token within a 10-day window.
 *            Family-merger: events with the same `event_type` within 10 days
 *                 AND ≥50% URL overlap merge into one.
 *
 *   Rule C — `page_level` fallback: every unclaimed row becomes its own
 *            single-child event.
 *
 * Guaranteed invariants:
 *   - Every input row is assigned to exactly ONE output event.
 *   - No row appears in `child_change_ids` of two events.
 *   - Output events are sorted ascending by `started_at`.
 */

import type {
  ChangeEvent,
  EventType,
} from "@/domains/events/types";

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/**
 * Minimum fields the assembler needs from a changelog row. Callers map their
 * richer record types down to this shape.
 */
export type ChangelogRow = {
  id: string;
  /** ISO 8601 with TZ, e.g. "2026-03-10T08:00:00+00:00". */
  timestamp: string;
  /** Path-only ("/about-us"), full URL, null, or a non-path label. */
  url: string | null;
  change_description: string;
  asset_type?: string | null;
  tenant_id: string;
};

export type AssembleEventsInput = {
  changelog: ChangelogRow[];
  /**
   * YYYY-MM-DD of each owned URL's first appearance in citation data. Keys
   * are normalized paths (output of `pathOnly()`). URLs that never cite are
   * omitted (fall through to Rule C).
   */
  firstCitationDateByUrl: Record<string, string>;
  tenant_id: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_CREATION_KEYWORDS =
  /\b(created|published|launched|rebuilt|new page|new standalone|page reconstruction|complete page reconstruction)\b/i;

/**
 * Semantic token map used by both B1 classification and B2 clustering.
 * Matched in descending specificity: the first family whose regex fires wins.
 */
type FamilyDef = { type: EventType; tokens: RegExp };

const EVENT_TYPE_FAMILIES: FamilyDef[] = [
  {
    type: "metadata_publication",
    tokens:
      /\b(llms\.txt|machine[- ]readable firm summary|bing places|bing webmaster|\bgbp\b|google business profile)\b/i,
  },
  {
    type: "crawlability_fix",
    tokens:
      /\b(canonical|sitemap|robots\.txt|hreflang|og tags unified|schema urls unified|internal links unified|trailing[- ]slash)\b/i,
  },
  {
    type: "performance_batch",
    tokens:
      /\b(lazy|loading=['"]?lazy['"]?|\blcp\b|\bcls\b|\btbt\b|hubspot|\bgtm\b|web vitals|render|script defer|preload|critical rendering path|pagespeed|lighthouse)\b/i,
  },
  {
    type: "schema_rollout",
    tokens:
      /\b(schema|json-?ld|breadcrumblist|faqpage|professionalservice|singlefamilyresidence|\barticle\b|review schema|aeo[- ]optimized)\b/i,
  },
  {
    type: "content_rollout",
    tokens:
      /\b(comparison table|global component|reusable component|multi-page|rollout|site-?wide|all pages)\b/i,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function assembleEvents(input: AssembleEventsInput): ChangeEvent[] {
  const rows = [...input.changelog].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const claimed = new Set<string>();
  const events: ChangeEvent[] = [];

  // Rule A — compound_launch
  for (const ev of ruleA_compoundLaunch(rows, claimed, input)) events.push(ev);

  // Rule B — sitewide_rollout (B1 + B2 + family-merge)
  for (const ev of ruleB_sitewide(rows, claimed, input)) events.push(ev);

  // Rule C — page_level fallback
  for (const ev of ruleC_pageLevel(rows, claimed, input)) events.push(ev);

  // Sort output events by started_at (secondary: id for stable output)
  events.sort((a, b) => {
    const c = a.started_at.localeCompare(b.started_at);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
  return events;
}

// ---------------------------------------------------------------------------
// Rule A — compound_launch
// ---------------------------------------------------------------------------

function ruleA_compoundLaunch(
  rows: ChangelogRow[],
  claimed: Set<string>,
  input: AssembleEventsInput,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const urlsSeen = new Set<string>();

  for (const row of rows) {
    if (claimed.has(row.id)) continue;
    const path = pathOnly(row.url);
    if (!path) continue;
    if (urlsSeen.has(path)) continue;
    const firstF = input.firstCitationDateByUrl[path];
    if (!firstF) continue;

    // Qualifying signal: at least one row on THIS url with timestamp in
    // [F-1, F+1] that matches page-creation keywords.
    const qualifying = rows.some((r) => {
      if (pathOnly(r.url) !== path) return false;
      const d = dateOf(r.timestamp);
      return (
        daysBetween(d, firstF) <= 1 &&
        PAGE_CREATION_KEYWORDS.test(r.change_description)
      );
    });
    if (!qualifying) continue;

    // Collect children: any row on this URL within [F-3, F+3].
    const children = rows.filter(
      (r) => pathOnly(r.url) === path && daysBetween(dateOf(r.timestamp), firstF) <= 3,
    );
    if (children.length === 0) continue;

    for (const c of children) claimed.add(c.id);
    urlsSeen.add(path);

    const dates = children.map((c) => dateOf(c.timestamp)).sort();
    events.push({
      id: `evt-compound_launch-${slug(path)}-${dates[0].replaceAll("-", "")}`,
      scope: "compound_launch",
      event_type: "page_created",
      label: `New page launched: ${path}`,
      started_at: dates[0],
      ended_at: dates[dates.length - 1],
      target_urls: [path],
      child_change_ids: children.map((c) => c.id),
      created_url: path,
      tenant_id: input.tenant_id,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Rule B — sitewide_rollout
// ---------------------------------------------------------------------------

function ruleB_sitewide(
  rows: ChangelogRow[],
  claimed: Set<string>,
  input: AssembleEventsInput,
): ChangeEvent[] {
  // B1: explicit sitewide rows
  const b1Raw: ChangeEvent[] = [];
  for (const row of rows) {
    if (claimed.has(row.id)) continue;
    if (!isSitewideUrl(row.url)) continue;
    const t = classifyEventType(row.change_description) ?? "content_rollout";
    const d = dateOf(row.timestamp);
    b1Raw.push({
      id: `evt-sitewide_rollout-${t}-${d.replaceAll("-", "")}-${row.id}`,
      scope: "sitewide_rollout",
      event_type: t,
      label: labelForSitewide(t, row),
      started_at: d,
      ended_at: d,
      target_urls: null,
      child_change_ids: [row.id],
      created_url: null,
      tenant_id: input.tenant_id,
    });
    claimed.add(row.id);
  }

  // B2: multi-page clustered rollouts — build per-family candidate pools
  const unclaimedWithFamily = rows
    .filter((r) => !claimed.has(r.id))
    .map((r) => ({ row: r, family: classifyEventType(r.change_description) }))
    .filter(
      (x): x is { row: ChangelogRow; family: EventType } => x.family != null,
    );

  const byFamily = new Map<EventType, typeof unclaimedWithFamily>();
  for (const x of unclaimedWithFamily) {
    if (!byFamily.has(x.family)) byFamily.set(x.family, []);
    byFamily.get(x.family)!.push(x);
  }

  const b2Raw: ChangeEvent[] = [];
  for (const [family, pool] of byFamily.entries()) {
    pool.sort((a, b) => a.row.timestamp.localeCompare(b.row.timestamp));
    // Greedy 10-day clustering: start at each unclaimed row, extend forward.
    const localClaimed = new Set<string>();
    for (const seed of pool) {
      if (localClaimed.has(seed.row.id)) continue;
      const windowStart = dateOf(seed.row.timestamp);
      const group = pool.filter(
        (x) =>
          !localClaimed.has(x.row.id) &&
          daysBetween(dateOf(x.row.timestamp), windowStart) <= 9 &&
          dateOf(x.row.timestamp) >= windowStart,
      );
      const distinctUrls = new Set(
        group
          .map((x) => pathOnly(x.row.url))
          .filter((p): p is string => p !== null),
      );
      if (group.length < 5 || distinctUrls.size < 3) continue;

      for (const x of group) {
        localClaimed.add(x.row.id);
        claimed.add(x.row.id);
      }
      const dates = group.map((x) => dateOf(x.row.timestamp)).sort();
      const targetUrls = [...distinctUrls].sort();
      b2Raw.push({
        id: `evt-sitewide_rollout-${family}-${dates[0].replaceAll("-", "")}-b2`,
        scope: "sitewide_rollout",
        event_type: family,
        label: `${humanFamily(family)} rollout across ${distinctUrls.size} URLs`,
        started_at: dates[0],
        ended_at: dates[dates.length - 1],
        target_urls: targetUrls,
        child_change_ids: group.map((x) => x.row.id),
        created_url: null,
        tenant_id: input.tenant_id,
      });
    }
  }

  // Family merger — same event_type within 10 days + ≥50% URL overlap OR
  // one event has no URL set (B1 has target_urls=null).
  const merged = mergeFamilies([...b1Raw, ...b2Raw], input.tenant_id);
  return merged;
}

function mergeFamilies(
  events: ChangeEvent[],
  tenant_id: string,
): ChangeEvent[] {
  const working = events
    .slice()
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const merged: ChangeEvent[] = [];
  const absorbed = new Set<string>();

  for (let i = 0; i < working.length; i++) {
    if (absorbed.has(working[i].id)) continue;
    let a = working[i];
    for (let j = i + 1; j < working.length; j++) {
      if (absorbed.has(working[j].id)) continue;
      const b = working[j];
      if (a.event_type !== b.event_type) continue;
      if (daysBetween(a.started_at, b.started_at) > 9 && daysBetween(a.ended_at, b.ended_at) > 9) continue;
      if (!urlOverlapQualifies(a, b)) continue;

      // Merge b into a
      a = mergeTwo(a, b, tenant_id);
      absorbed.add(b.id);
    }
    merged.push(a);
  }
  return merged;
}

function urlOverlapQualifies(a: ChangeEvent, b: ChangeEvent): boolean {
  // B1 events have target_urls=null (truly sitewide) → always qualify for
  // same-family merge in their 10-day window.
  if (a.target_urls === null || b.target_urls === null) return true;
  const A = new Set(a.target_urls);
  const B = new Set(b.target_urls);
  let overlap = 0;
  for (const u of A) if (B.has(u)) overlap++;
  const minSize = Math.min(A.size, B.size);
  return minSize > 0 && overlap / minSize >= 0.5;
}

function mergeTwo(a: ChangeEvent, b: ChangeEvent, tenant_id: string): ChangeEvent {
  const children = Array.from(new Set([...a.child_change_ids, ...b.child_change_ids]));
  const targets =
    a.target_urls === null || b.target_urls === null
      ? null
      : Array.from(new Set([...a.target_urls, ...b.target_urls])).sort();
  const started = a.started_at < b.started_at ? a.started_at : b.started_at;
  const ended = a.ended_at > b.ended_at ? a.ended_at : b.ended_at;
  return {
    id: `evt-sitewide_rollout-${a.event_type}-${started.replaceAll("-", "")}-merged`,
    scope: "sitewide_rollout",
    event_type: a.event_type,
    label: `${humanFamily(a.event_type)} rollout (${children.length} edits)`,
    started_at: started,
    ended_at: ended,
    target_urls: targets,
    child_change_ids: children,
    created_url: null,
    tenant_id,
  };
}

// ---------------------------------------------------------------------------
// Rule C — page_level fallback
// ---------------------------------------------------------------------------

function ruleC_pageLevel(
  rows: ChangelogRow[],
  claimed: Set<string>,
  input: AssembleEventsInput,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  for (const row of rows) {
    if (claimed.has(row.id)) continue;
    const path = pathOnly(row.url);
    const d = dateOf(row.timestamp);
    // Phase 0.6 (2026-04-17) — detect page_created signals that Rule A missed
    // (no matching citation data, keyword-timing mismatch, or new URLs that
    // weren't yet in firstCitationDateByUrl at assembly time). Routes these
    // to the landing-verdict path in attributePageLevel so new pages with
    // post-launch citations don't silently fall into "not_enough_data".
    const isPageCreation = PAGE_CREATION_KEYWORDS.test(row.change_description);
    const eventType: EventType = isPageCreation ? "page_created" : "content_edit";
    events.push({
      id: `evt-page_level-${slug(path ?? "unknown")}-${d.replaceAll("-", "")}-${row.id}`,
      scope: "page_level",
      event_type: eventType,
      label: isPageCreation
        ? `Page created${path ? `: ${path}` : ""}`
        : `Page edit${path ? `: ${path}` : ""}`,
      started_at: d,
      ended_at: d,
      target_urls: path ? [path] : null,
      child_change_ids: [row.id],
      created_url: path,
      tenant_id: input.tenant_id,
    });
    claimed.add(row.id);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Path-only normalization that tolerates full URLs, absolute paths, and
 * garbage labels. Returns null when the input does not look like a real URL.
 */
export function pathOnly(u: string | null | undefined): string | null {
  if (!u) return null;
  const raw = u.trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      return (new URL(raw).pathname.replace(/\/+$/, "") || "/").toLowerCase();
    } catch {
      return null;
    }
  }
  if (raw.startsWith("/")) {
    return (raw.replace(/\/+$/, "") || "/").toLowerCase();
  }
  return null;
}

/**
 * Returns true when the row's `url` value represents sitewide infra or a
 * non-page label — the rows Rule B1 claims.
 */
export function isSitewideUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const raw = url.trim();
  if (!raw) return true;
  // Infra filenames
  if (/\.(txt|xml)(\b|$)/i.test(raw)) return true;
  // Non-path labels (no leading slash, no http scheme)
  if (!raw.startsWith("/") && !/^https?:\/\//i.test(raw)) return true;
  return false;
}

export function classifyEventType(text: string): EventType | null {
  for (const fam of EVENT_TYPE_FAMILIES) {
    if (fam.tokens.test(text)) return fam.type;
  }
  return null;
}

function humanFamily(t: EventType): string {
  switch (t) {
    case "metadata_publication":
      return "Metadata publication";
    case "crawlability_fix":
      return "Crawlability fix";
    case "schema_rollout":
      return "Schema";
    case "performance_batch":
      return "Performance";
    case "content_rollout":
      return "Content";
    case "page_created":
      return "Page launch";
    case "content_edit":
      return "Content edit";
  }
}

function labelForSitewide(t: EventType, row: ChangelogRow): string {
  const trimmed = row.change_description.slice(0, 70);
  return `${humanFamily(t)}: ${trimmed}${row.change_description.length > 70 ? "…" : ""}`;
}

export function dateOf(ts: string): string {
  // Accepts full ISO or YYYY-MM-DD; truncates to YYYY-MM-DD.
  return ts.slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + (a.length === 10 ? "T00:00:00Z" : ""));
  const db = Date.parse(b + (b.length === 10 ? "T00:00:00Z" : ""));
  return Math.abs(Math.round((da - db) / (24 * 3600 * 1000)));
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "root";
}
