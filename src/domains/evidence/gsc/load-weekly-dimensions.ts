/**
 * load-weekly-dimensions (R17b / P2 slice 2) - the read edge for the weekly
 * GSC dimension snapshots (searchAppearance + device).
 *
 * Reads the "gsc-weekly-dimensions" json-store the weekly pass writes
 * (src/lib/connectors/gsc/weekly-dimensions-sync.ts) and hands surfaces the
 * pure lens (weekly-dimensions.ts). $0 - never calls the GSC API itself.
 *
 * ONE NUMBER RULE: the scoreboard expander lines and the device click-gap
 * trigger both read THIS loader, so the same week's numbers can never differ
 * between the two. Request-deduped via react cache. Fail-soft null - the
 * expander self-hides, the trigger abstains.
 */

import "server-only";

import { cache } from "react";

import { readStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import { GSC_WEEKLY_DIMENSIONS_STORE } from "@/lib/connectors/gsc/weekly-dimensions-sync";
import {
  buildWeeklyLens,
  deviceCtrGapSignalOf,
  type DeviceCtrGapSignal,
  type GscWeeklyDimensionsSnapshot,
  type GscWeeklyLens,
} from "./weekly-dimensions";

/** Newest-first snapshots for one tenant. Fail-soft to []. */
const loadSnapshots = cache(
  async (tenantId: string): Promise<GscWeeklyDimensionsSnapshot[]> => {
    if (!tenantId) return [];
    try {
      const all = await readStore<GscWeeklyDimensionsSnapshot>(
        GSC_WEEKLY_DIMENSIONS_STORE,
        [],
      );
      return all
        .filter((r) => r.tenant_id === tenantId)
        .sort((a, b) => (a.weekEnd > b.weekEnd ? -1 : 1));
    } catch (e) {
      log.warn("[gsc-weekly-dimensions] read failed (fail-soft to empty)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  },
);

/** The scoreboard expander's lens (device + styling lines). Null self-hides. */
export const loadGscWeeklyLens = cache(
  async (tenantId: string): Promise<GscWeeklyLens | null> => {
    const rows = await loadSnapshots(tenantId);
    return buildWeeklyLens(rows[0] ?? null, rows[1] ?? null);
  },
);

/** The device click-gap trigger's pure input. Null = predicate abstains. */
export const loadGscDeviceCtrGapSignal = cache(
  async (tenantId: string): Promise<DeviceCtrGapSignal | null> => {
    const rows = await loadSnapshots(tenantId);
    const newest = rows[0];
    return newest ? deviceCtrGapSignalOf(newest) : null;
  },
);
