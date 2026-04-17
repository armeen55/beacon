/**
 * Phase 0 Day 5 — Primary acceptance artifact.
 *
 * Orchestrates the full Phase 0 pipeline against Ritz data and prints a
 * seven-section human-readable report. The report is the gate: Phase 0 is
 * complete iff all seven sections print correctly.
 *
 * Pipeline:
 *   data-quality → site-citation-timeline → events → attributions
 *
 * Supporting outputs written to disk:
 *   .data/data-quality-flags.json
 *   .data/site-citation-timeline.json
 *   .data/site-movement-events.json
 *   .data/change-events.json
 *   .data/event-attributions.json
 *
 * Usage:
 *   npx tsx scripts/validate-ritz-truth.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  detectDataQualityFlags,
  buildDataQualityDateSet,
  type RawCitation,
} from "../src/domains/truth/data-quality";
import {
  buildSiteCitationTimeline,
  detectSiteMovements,
  rankMovementsByMagnitude,
} from "../src/domains/truth/site-citation-timeline";
import {
  assembleEvents,
  pathOnly,
  type ChangelogRow,
} from "../src/domains/events/assembler";
import {
  attributeEvents,
  type UrlDailySeries,
} from "../src/domains/attribution/event-attributor";
import type {
  ChangeEvent,
  EventAttribution,
  SiteMovementEvent,
} from "../src/domains/events/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), ".data");
const SHARD_DIR = join(DATA_DIR, "citations-by-date");
const TENANT_ID = "tenant-ritz-founder";
const OWNED_DOMAIN = "ritzbuilders.com";
const TARGET_SPIKES = ["2026-03-10", "2026-03-13", "2026-03-26", "2026-04-13"];
const DAY_MS = 24 * 3600 * 1000;
const KEY_URLS = ["/luxury-home-builder-bay-area", "/locations/menlo-park", "/"];

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

type ImportedChange = {
  id: string;
  timestamp: string;
  url: string | null;
  change_description: string;
  asset_type?: string | null;
  tenant_id: string;
  archived?: boolean;
};

function loadShards(): Record<string, RawCitation[]> {
  const out: Record<string, RawCitation[]> = {};
  const files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files.sort()) {
    const date = file.replace(/\.json$/, "");
    out[date] = JSON.parse(readFileSync(join(SHARD_DIR, file), "utf8")) as RawCitation[];
  }
  return out;
}

function loadChangelog(): { full: ImportedChange[]; rows: ChangelogRow[] } {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "imported-changes.json"), "utf8"),
  ) as ImportedChange[];
  const full = raw.filter((r) => !r.archived && r.tenant_id === TENANT_ID);
  const rows = full.map<ChangelogRow>((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    url: r.url,
    change_description: r.change_description,
    asset_type: r.asset_type ?? null,
    tenant_id: r.tenant_id,
  }));
  return { full, rows };
}

type OldOutcome = { url: string; verdict: string };

function loadOldOutcomes(): OldOutcome[] {
  try {
    return JSON.parse(
      readFileSync(join(DATA_DIR, "url-change-outcomes.json"), "utf8"),
    ) as OldOutcome[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-URL daily series from citation shards
// ---------------------------------------------------------------------------

function buildUrlSeries(
  citationsByDate: Record<string, RawCitation[]>,
  dates: string[],
): Record<string, UrlDailySeries> {
  const byUrl: Record<string, Map<string, number>> = {};
  for (const [date, rows] of Object.entries(citationsByDate)) {
    for (const r of rows) {
      if (r.domain !== OWNED_DOMAIN) continue;
      if (r.source_category !== "owned") continue;
      const path = pathOnly((r as unknown as { url?: string }).url ?? null);
      if (!path) continue;
      if (!byUrl[path]) byUrl[path] = new Map();
      byUrl[path].set(date, (byUrl[path].get(date) ?? 0) + 1);
    }
  }

  const out: Record<string, UrlDailySeries> = {};
  const sortedDates = dates.slice().sort();
  for (const [url, counts] of Object.entries(byUrl)) {
    const daily = sortedDates.map((d) => ({
      date: d,
      count: counts.get(d) ?? 0,
    }));
    out[url] = { url, daily };
  }
  return out;
}

function firstCitationDatesFromSeries(
  urlSeries: Record<string, UrlDailySeries>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, s] of Object.entries(urlSeries)) {
    const first = s.daily.find((p) => p.count > 0);
    if (first) out[url] = first.date;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers for the report
// ---------------------------------------------------------------------------

function withinOneDay(a: string, b: string): boolean {
  return Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) <= DAY_MS;
}

function dominantAssetType(event: ChangeEvent, byId: Map<string, ImportedChange>): string {
  const counts: Record<string, number> = {};
  for (const id of event.child_change_ids) {
    const row = byId.get(id);
    const at = row?.asset_type ?? "unknown";
    counts[at] = (counts[at] ?? 0) + 1;
  }
  let best = "unknown";
  let bestN = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best;
}

function pct(n: number | null): string {
  return n == null ? "—" : (n * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const citationsByDate = loadShards();
  const allDates = Object.keys(citationsByDate).sort();
  const { full: fullChanges, rows: changelog } = loadChangelog();
  const rowById = new Map(fullChanges.map((r) => [r.id, r]));
  const oldOutcomes = loadOldOutcomes();

  // ---- Step 1: data-quality gate --------------------------------------
  const flags = detectDataQualityFlags({
    ownedDomain: OWNED_DOMAIN,
    citationsByDate,
  });
  const badDateSet = buildDataQualityDateSet(flags);
  writeFileSync(
    join(DATA_DIR, "data-quality-flags.json"),
    JSON.stringify(flags, null, 2) + "\n",
  );

  // ---- Step 2: site timeline + movement detection ---------------------
  const timeline = buildSiteCitationTimeline({
    tenant_id: TENANT_ID,
    domain: OWNED_DOMAIN,
    citationsByDate,
    dataQualityFlags: flags,
  });
  const movements = detectSiteMovements(timeline);
  writeFileSync(
    join(DATA_DIR, "site-citation-timeline.json"),
    JSON.stringify(timeline, null, 2) + "\n",
  );
  writeFileSync(
    join(DATA_DIR, "site-movement-events.json"),
    JSON.stringify(movements, null, 2) + "\n",
  );
  const rankedMovements = rankMovementsByMagnitude(movements);

  // ---- Step 3: per-URL series + event assembly ------------------------
  const urlSeries = buildUrlSeries(citationsByDate, allDates);
  const firstCitationDateByUrl = firstCitationDatesFromSeries(urlSeries);
  const events = assembleEvents({
    changelog,
    firstCitationDateByUrl,
    tenant_id: TENANT_ID,
  });
  writeFileSync(
    join(DATA_DIR, "change-events.json"),
    JSON.stringify(events, null, 2) + "\n",
  );

  // ---- Step 4: attribution --------------------------------------------
  const attributions = attributeEvents({
    events,
    siteMovements: movements,
    urlSeriesByUrl: urlSeries,
    dataQualityBadDates: badDateSet,
    asOfDate: allDates[allDates.length - 1],
  });
  writeFileSync(
    join(DATA_DIR, "event-attributions.json"),
    JSON.stringify(attributions, null, 2) + "\n",
  );
  const attrByEvent = new Map(attributions.map((a) => [a.event_id, a]));

  // =====================================================================
  // PHASE 0 REPORT
  // =====================================================================
  console.log("");
  console.log("==============================================================");
  console.log("  PHASE 0 — RITZ TRUTH VALIDATION REPORT");
  console.log(`  Tenant: ${TENANT_ID}    Domain: ${OWNED_DOMAIN}`);
  console.log(`  As-of: ${allDates[allDates.length - 1]}`);
  console.log("==============================================================");

  // -----------------------------------------------------------------
  // Section 1 — Data quality
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 1 — Data-quality gate ────────────────────────────");
  console.log(`Shards scanned: ${allDates.length} (${allDates[0]} → ${allDates[allDates.length - 1]})`);
  console.log(`Flagged data_bad days: ${flags.length}`);
  for (const f of flags) {
    console.log(`  [FLAG] ${f.date}  ${f.narrative}`);
  }

  // -----------------------------------------------------------------
  // Section 2 — Site movement windows
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 2 — Site movement windows ────────────────────────");
  console.log(`Detected: ${movements.length}`);
  console.log("rank  date         prev→curr    Δ_abs   Δ_pct    target match");
  console.log("----  -----------  -----------  ------  -------  -------------");
  rankedMovements.forEach((m, i) => {
    const target = TARGET_SPIKES.find((t) => withinOneDay(m.date, t));
    const match = target ? `${target}` : "— unexplained";
    const pctStr = `${(m.delta_pct * 100).toFixed(0)}%`;
    console.log(
      `${String(i + 1).padStart(4)}  ${m.date}  ${String(m.prev_count).padStart(4)}→${String(m.count).padStart(4)}     ${String(m.delta_abs).padStart(6)}  ${pctStr.padStart(7)}  ${match}`,
    );
  });
  const hitTargets = TARGET_SPIKES.filter((t) =>
    movements.some((m) => withinOneDay(m.date, t)),
  );
  console.log("");
  console.log(`Target match: ${hitTargets.length}/${TARGET_SPIKES.length} (${hitTargets.join(", ")})`);

  // -----------------------------------------------------------------
  // Section 3 — Event assembly coverage
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 3 — Event assembly coverage ──────────────────────");
  const assigned = new Set<string>();
  let doubleAssign = 0;
  for (const e of events) {
    for (const c of e.child_change_ids) {
      if (assigned.has(c)) doubleAssign += 1;
      assigned.add(c);
    }
  }
  const orphan = changelog.filter((r) => !assigned.has(r.id)).length;
  console.log(
    `coverage: ${assigned.size} of ${changelog.length} active changelog rows assigned, ${orphan} orphan, ${doubleAssign} double-assign`,
  );
  const byScope: Record<string, number> = {};
  const byScopeType: Record<string, Record<string, number>> = {};
  for (const e of events) {
    byScope[e.scope] = (byScope[e.scope] ?? 0) + 1;
    if (!byScopeType[e.scope]) byScopeType[e.scope] = {};
    byScopeType[e.scope][e.event_type] =
      (byScopeType[e.scope][e.event_type] ?? 0) + 1;
  }
  console.log(`Total events: ${events.length}`);
  for (const [scope, subtypes] of Object.entries(byScopeType)) {
    console.log(`  ${scope}: ${byScope[scope]}`);
    for (const [t, n] of Object.entries(subtypes)) {
      console.log(`    - ${t}: ${n}`);
    }
  }

  // -----------------------------------------------------------------
  // Section 4 — Event verdicts per spike window
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 4 — Event verdicts per spike window ──────────────");
  for (const target of TARGET_SPIKES) {
    console.log("");
    console.log(`  Spike ${target}:`);
    const related = events.filter(
      (e) =>
        withinOneDay(e.ended_at, target) ||
        withinOneDay(e.started_at, target) ||
        (e.started_at <= target && target <= e.ended_at),
    );
    // Also include any event whose attribution anchors on a nearby movement.
    const nearbyByMovement = events.filter((e) => {
      const a = attrByEvent.get(e.id);
      if (!a?.site_movement_event_id) return false;
      const m = movements.find((mm) => mm.id === a.site_movement_event_id);
      return m ? withinOneDay(m.date, target) : false;
    });
    const union = [...new Set([...related, ...nearbyByMovement])];
    if (union.length === 0) {
      console.log("    (no candidate events)");
      continue;
    }
    for (const e of union) {
      const a = attrByEvent.get(e.id);
      if (!a) continue;
      const urlInfo =
        e.scope === "compound_launch"
          ? e.created_url ?? "—"
          : e.target_urls === null
            ? "sitewide"
            : e.target_urls.length === 1
              ? e.target_urls[0]
              : `${e.target_urls.length} URLs`;
      console.log(
        `    - ${e.id}`,
      );
      console.log(
        `        scope=${e.scope.padEnd(17)}  type=${e.event_type.padEnd(22)}  target=${urlInfo}`,
      );
      console.log(
        `        verdict=${a.verdict.padEnd(18)} conf=${a.confidence.toFixed(2)}  source=${a.evidence.confidence_source}`,
      );
      console.log(`        narrative: ${a.evidence.narrative}`);
    }
  }

  // -----------------------------------------------------------------
  // Section 5 — Pattern-sample-integrity check
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 5 — Pattern-sample-integrity check ───────────────");
  console.log(
    "If we counted pattern samples from EVENTS (one sample per event, not per row):",
  );
  const buckets = new Map<string, { count: number; sampleEventId: string; sampleRows: number }>();
  for (const e of events) {
    const at = dominantAssetType(e, rowById);
    const key = `${e.event_type} × ${at}`;
    const b = buckets.get(key) ?? { count: 0, sampleEventId: e.id, sampleRows: 0 };
    b.count += 1;
    if (e.child_change_ids.length > b.sampleRows) {
      b.sampleEventId = e.id;
      b.sampleRows = e.child_change_ids.length;
    }
    buckets.set(key, b);
  }
  console.log("  (event_type × asset_type)                   events   largest-event rows");
  console.log("  ------------------------------------------   ------   -----------------");
  [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([k, v]) => {
      console.log(
        `  ${k.padEnd(42)}   ${String(v.count).padStart(6)}   ${String(v.sampleRows).padStart(17)}`,
      );
    });
  // Callout for the luxury launch
  const luxEvent = events.find(
    (e) =>
      e.scope === "compound_launch" &&
      e.created_url === "/luxury-home-builder-bay-area",
  );
  if (luxEvent) {
    console.log("");
    console.log(
      `  /luxury-home-builder-bay-area launch:  ${luxEvent.child_change_ids.length} rows → 1 sample (page_created × service_page)`,
    );
  }

  // -----------------------------------------------------------------
  // Section 6 — Comparison: old URL-level store vs new event-level
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 6 — URL-level vs event-level comparison ──────────");
  console.log("(old store is NOT overwritten; shown for parity only)");
  for (const keyUrl of KEY_URLS) {
    console.log("");
    console.log(`  URL: ${keyUrl}`);
    // Old store verdicts for this URL (may be multiple rows).
    const oldRows = oldOutcomes.filter((o) => o.url === keyUrl);
    if (oldRows.length === 0) {
      console.log("    old: (no rows in url-change-outcomes.json)");
    } else {
      const oldDist: Record<string, number> = {};
      for (const r of oldRows) oldDist[r.verdict] = (oldDist[r.verdict] ?? 0) + 1;
      console.log(
        `    old: ${oldRows.length} row(s) — ${Object.entries(oldDist).map(([k, v]) => `${k}×${v}`).join(", ")}`,
      );
    }
    // New events touching this URL
    const newEvents = events.filter((e) => {
      if (e.created_url === keyUrl) return true;
      return (e.target_urls ?? []).includes(keyUrl);
    });
    if (newEvents.length === 0) {
      console.log("    new: (no events touching this URL directly)");
    } else {
      for (const e of newEvents) {
        const a = attrByEvent.get(e.id);
        if (!a) continue;
        console.log(
          `    new: ${e.scope} / ${e.event_type} → ${a.verdict} (${a.evidence.confidence_source}, conf=${a.confidence.toFixed(2)})`,
        );
      }
    }
  }

  // -----------------------------------------------------------------
  // Section 7 — Acceptance summary
  // -----------------------------------------------------------------
  console.log("");
  console.log("── Section 7 — Acceptance summary ───────────────────────────");

  const acceptance = {
    dataQualityCorrect:
      flags.map((f) => f.date).sort().join(",") ===
      ["2026-04-07","2026-04-08","2026-04-09","2026-04-10","2026-04-11","2026-04-12"].join(","),
    movementTargetsHit: hitTargets.length === TARGET_SPIKES.length,
    coverageInvariant:
      orphan === 0 && doubleAssign === 0 && assigned.size === changelog.length,
    luxuryCompoundLaunch: luxEvent != null,
    luxuryVerdictLandedFast:
      luxEvent != null &&
      attrByEvent.get(luxEvent.id)?.verdict === "landed_fast",
    menloParkNotHurting: (() => {
      const menlo = events.find(
        (e) => e.scope === "page_level" && e.target_urls?.[0] === "/locations/menlo-park",
      );
      if (!menlo) return true; // absence is acceptable (may not be page_level)
      const v = attrByEvent.get(menlo.id)?.verdict;
      return v !== "hurting";
    })(),
    performanceBatchApr10: events.some(
      (e) =>
        e.event_type === "performance_batch" &&
        withinOneDay(e.ended_at, "2026-04-10"),
    ),
    metadataPublicationApr2: events.some(
      (e) =>
        e.event_type === "metadata_publication" &&
        e.started_at <= "2026-04-04" &&
        e.ended_at >= "2026-04-02",
    ),
  };

  for (const [k, v] of Object.entries(acceptance)) {
    console.log(`  ${v ? "✓" : "✗"} ${k}`);
  }
  console.log("");
  const allOk = Object.values(acceptance).every(Boolean);
  console.log(allOk ? "✓ PHASE 0 ACCEPTANCE: PASS" : "✗ PHASE 0 ACCEPTANCE: FAIL");
  console.log("==============================================================");
  if (!allOk) process.exitCode = 1;
}

main();
