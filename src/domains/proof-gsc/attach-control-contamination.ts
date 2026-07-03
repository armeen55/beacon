import "server-only";

/**
 * attach-control-contamination (BEACON_500 N13, 2026-07-03) - the one read-path
 * call site the /results loader needs: given the tenant's full shipped-change
 * ledger, load each row's comparison-page (control) history ONCE and compute
 * whether any control changed mid-window, per control-contamination.ts's pure
 * classifier. Mirrors attach-seasonal-inflection.ts's shape exactly - a small
 * read-time join keyed by ledger row id, nothing persisted, nothing mutated.
 *
 * PROMOTION, not re-selection (operator correction, 2026-07-03): when a control
 * is contaminated, the substitute comes ONLY from the ship's own FROZEN donor
 * pool (ShippedChangeRecord.controlDonorPool - the full ranked candidate list
 * control-matching.ts computed and auto-record-on-ship.ts persisted at THIS
 * ship's selection time). This module NEVER calls the matcher again and NEVER
 * reads fresh GSC data to rank a replacement - doing so would pick a
 * substitute using information that only exists because of what happened
 * AFTER the ship, biasing the verdict toward whatever outcome the replacement
 * happened to show. It only walks the frozen pool in its original order
 * (control-contamination.ts's promoteFromFrozenPool) and promotes the next
 * eligible donor. When the pool is absent (older rows that predate N13) or
 * exhausted, no substitution happens - the verdict still runs on the original
 * controls (never fewer comparison pages than the stored MIN_CONTROLS floor),
 * capped with an honest caution caveat instead. NEVER mutates the stored ship
 * row - `record.controlPages` and `record.controlDonorPool` on disk are
 * untouched; only the READ-time presentation reflects the promotion.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { measurementWindowOf } from "./measurement-maturity";
import {
  classifyControls,
  summarizeContamination,
  promoteFromFrozenPool,
  buildContaminationNotes,
  type LedgerShipRecord,
  type SnapshotPoint,
  type ContaminationVerdict,
  type FrozenDonor,
} from "./control-contamination";
import type { ShippedChangeRecord } from "./shipped-change-store";

/** PostgREST response cap per page; mirrors auto-record-on-ship.ts's PAGE_SIZE. */
const PAGE_SIZE = 1000;
/** Hard ceiling on total snapshot rows read per attach pass, so a huge site's
 *  scan history can never turn one /results load into an unbounded scan. */
const MAX_SNAPSHOT_ROWS = 10_000;

function pathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

/** Both host variants (www./bare) for a canonical URL, mirroring
 *  auto-record-on-ship.ts's withWwwVariant so a snapshot row keyed on either
 *  raw host form still matches. Kept local (small, leaf-level) rather than
 *  exported cross-file, same posture as that file's own copy. */
function withWwwVariant(url: string): string[] {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith("www.")) {
      const bare = new URL(url);
      bare.hostname = u.hostname.slice(4);
      return [url, bare.toString()];
    }
    const withWww = new URL(url);
    withWww.hostname = `www.${u.hostname}`;
    return [url, withWww.toString()];
  } catch {
    return [url];
  }
}

/**
 * Bounded page_snapshots history read for a set of control URLs, across the
 * union of every window's [start, end) range. Returns content_hash + fetched_at
 * per row, keyed by the CALLER's path form (host-stripped) so classifyControls
 * can look candidates up directly. Fail-soft -> empty map (an attach failure
 * must never crash the Results page; a contamination flag going missing just
 * means today's read stays as honest as it was before this module existed).
 */
async function loadControlSnapshotHistory(
  tenantId: string,
  controlUrls: ReadonlyArray<string>,
  earliestStart: string,
  latestEnd: string,
): Promise<Map<string, SnapshotPoint[]>> {
  const out = new Map<string, SnapshotPoint[]>();
  if (!tenantId || controlUrls.length === 0) return out;

  const pathByVariant = new Map<string, string>();
  const queryUrls: string[] = [];
  for (const u of controlUrls) {
    const path = pathOf(u);
    for (const v of withWwwVariant(u)) {
      pathByVariant.set(v, path);
      queryUrls.push(v);
    }
  }
  const uniqueQueryUrls = [...new Set(queryUrls)];

  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_SNAPSHOT_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("page_snapshots")
        .select("url, fetched_at, content_hash")
        .eq("tenant_id", tenantId)
        .in("url", uniqueQueryUrls)
        .gte("fetched_at", earliestStart)
        .lt("fetched_at", latestEnd)
        .order("fetched_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[control-contamination] snapshot-history read failed (fail-soft)", {
          tenantId,
          error: error.message,
        });
        break;
      }
      const rows = (data ?? []) as Array<{ url: string; fetched_at: string; content_hash: string | null }>;
      for (const r of rows) {
        const path = pathByVariant.get(r.url);
        if (!path || !r.fetched_at || !r.content_hash) continue;
        const arr = out.get(path) ?? [];
        arr.push({ fetchedAt: r.fetched_at, contentHash: r.content_hash });
        out.set(path, arr);
      }
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.warn("[control-contamination] snapshot-history threw (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

export type ContaminationAttachment = {
  verdict: ContaminationVerdict;
  /** Substitute path per contaminated original (host-stripped), or null when
   *  no clean candidate was found. Empty when nothing was contaminated. */
  substitutesByOriginal: Map<string, string | null>;
  /** The ship's controlPages with any promoted substitute swapped in - what
   *  the caller should re-run the diff-in-diff math against. Identical to the
   *  original controlPages when nothing was contaminated or no substitute was
   *  found for anything (never fewer entries than the original list). */
  effectiveControlPages: string[];
  /** Plain-language receipt lines for the "See the math" detail + the N10-bound
   *  flag caveat. Empty when the ship's controls are clean. */
  notes: string[];
};

/**
 * Compute the contamination attachment for ONE ship. Pure read-time join, no
 * GSC I/O, no re-ranking - promotion draws ONLY from record.controlDonorPool
 * (frozen at ship time). Never throws; a missing/exhausted pool simply yields
 * substitutePath: null for every contaminated control (the caution path).
 */
export function computeContaminationForShip(args: {
  record: Pick<
    ShippedChangeRecord,
    "id" | "page" | "path" | "shippedAt" | "windows" | "controlPages" | "controlDonorPool"
  >;
  /** Every OTHER ship in the ledger (paths + ship dates only). */
  otherShips: ReadonlyArray<LedgerShipRecord>;
  /** Pre-loaded snapshot history for this ship's control paths, keyed by
   *  host-stripped path. Callers batch this ACROSS ships (one Supabase read
   *  for the whole ledger) via loadControlSnapshotHistory below. */
  snapshotsByPath: ReadonlyMap<string, ReadonlyArray<SnapshotPoint>>;
}): ContaminationAttachment | null {
  const { record, otherShips, snapshotsByPath } = args;
  const window = measurementWindowOf(record.shippedAt, record.windows ?? []);
  if (!window || record.controlPages.length === 0) return null;

  const controlPaths = record.controlPages.map(pathOf);
  const results = classifyControls({
    controlPaths,
    window,
    ledger: otherShips,
    snapshotsByPath,
  });
  const verdict = summarizeContamination(results);
  if (!verdict.hasContamination) {
    return {
      verdict,
      substitutesByOriginal: new Map(),
      effectiveControlPages: [...record.controlPages],
      notes: [],
    };
  }

  // Promote from the FROZEN pool only - no fresh ranking, no live GSC read.
  // The pool's URLs are the same canonical absolute URLs controlPages uses;
  // promoteFromFrozenPool compares against allControlPaths in that same form
  // so a donor that happens to already be one of this ship's own controls is
  // never re-admitted as its own substitute.
  const frozenPool: FrozenDonor[] | null =
    record.controlDonorPool?.map((d) => ({ url: d.url, verdict: d.verdict })) ?? null;

  const substitutions = promoteFromFrozenPool({
    contaminated: verdict.contaminated.map((c) => ({ path: c.path })),
    allControlPaths: record.controlPages,
    treatedPath: record.page,
    frozenPool,
  });
  // promoteFromFrozenPool matches on the pool's own URL strings against
  // controlPages/treatedPath (both canonical absolute URLs) - but
  // verdict.contaminated is keyed by host-stripped PATH. Re-key the outcome
  // by path so the rest of this function (and the caller) can look it up the
  // same way classifyControls/summarizeContamination already do.
  const substitutesByOriginal = new Map<string, string | null>();
  for (let i = 0; i < verdict.contaminated.length; i++) {
    const c = verdict.contaminated[i]!;
    const outcome = substitutions[i];
    substitutesByOriginal.set(c.path, outcome?.substitutePath ?? null);
  }

  // Rebuild effectiveControlPages: clean originals stay, a contaminated one
  // with a promoted substitute is swapped in (full URL from the frozen pool),
  // a contaminated one with none stays (never DROP a control - the caller
  // already floors on MIN_CONTROLS at selection time; removing one here could
  // push a ship below that floor at read time).
  const substituteUrlByPath = new Map(
    (record.controlDonorPool ?? []).map((d) => [pathOf(d.url), d.url] as const),
  );
  const effectiveControlPages = record.controlPages.map((cp) => {
    const p = pathOf(cp);
    const sub = substitutesByOriginal.get(p);
    if (!sub) return cp;
    return substituteUrlByPath.get(pathOf(sub)) ?? sub;
  });

  const notes = buildContaminationNotes(
    verdict,
    [...substitutesByOriginal.entries()].map(([originalPath, substitutePath]) => ({ originalPath, substitutePath })),
  );

  return { verdict, substitutesByOriginal, effectiveControlPages, notes };
}

/**
 * Batch entry point for the /results loader: one snapshot-history read for the
 * WHOLE ledger's control pages (not one read per row), then per-ship
 * classification + frozen-pool promotion (pure, no further I/O). Fail-soft ->
 * empty map on any upstream failure (the Results page renders with no
 * contamination caveats, exactly the pre-N13 behavior).
 */
export async function attachControlContaminationForLedger(
  tenantId: string,
  records: ReadonlyArray<ShippedChangeRecord>,
): Promise<Map<string, ContaminationAttachment>> {
  const out = new Map<string, ContaminationAttachment>();
  if (!tenantId || records.length === 0) return out;

  const otherShipsByRecord = new Map<string, LedgerShipRecord[]>();
  const allControlUrls = new Set<string>();
  let earliestStart: string | null = null;
  let latestEnd: string | null = null;

  for (const r of records) {
    const window = measurementWindowOf(r.shippedAt, r.windows ?? []);
    if (!window || r.controlPages.length === 0) continue;
    for (const cp of r.controlPages) allControlUrls.add(cp);
    if (earliestStart == null || window.start < earliestStart) earliestStart = window.start;
    if (latestEnd == null || window.end > latestEnd) latestEnd = window.end;
    otherShipsByRecord.set(
      r.id,
      records
        .filter((other) => other.id !== r.id)
        .map((other) => ({ path: other.path, shippedAt: other.shippedAt })),
    );
  }
  if (earliestStart == null || latestEnd == null || allControlUrls.size === 0) return out;

  const snapshotsByPath = await loadControlSnapshotHistory(
    tenantId,
    [...allControlUrls],
    earliestStart,
    latestEnd,
  ).catch(() => new Map<string, SnapshotPoint[]>());

  for (const r of records) {
    const otherShips = otherShipsByRecord.get(r.id);
    if (!otherShips) continue;
    let attachment: ContaminationAttachment | null = null;
    try {
      attachment = computeContaminationForShip({ record: r, otherShips, snapshotsByPath });
    } catch (e) {
      log.warn("[control-contamination] compute failed for one ship (fail-soft)", {
        tenantId,
        shipId: r.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (attachment) out.set(r.id, attachment);
  }

  return out;
}
