import "server-only";

/**
 * finish-setup (BEACON_500 T0b, 2026-07-03) - loads the real, persisted
 * status behind every [G] operator-gated setup item and turns each unfinished
 * one into a recovery action via the shared map (recovery-actions.ts). Feeds
 * the ONE "Finish setting up" checklist card on /settings, which self-hides
 * the moment every item is done.
 *
 * Every status check reads what already exists (env presence by NAME ONLY,
 * a row count, a config presence check) - no new tables, no new writes, and
 * secrets are never read or logged, only whether the name is set.
 *
 * Fail-soft throughout: a read error on any ONE item counts that item as
 * "not done yet" (shows the checklist item) rather than crashing the whole
 * card - an honest, actionable state beats a broken settings page.
 */

import { getConnectorInfo } from "@/lib/connector-store";
import { getWixUrlMap } from "@/lib/connectors/wix/url-map";
import { getIndexNowConfig } from "@/lib/connectors/indexnow/config-store";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { loadGscReadiness } from "@/lib/connectors/gsc/readiness";
import { readBackfillProgress } from "@/lib/connectors/gsc/deep-backfill";
import { currentTenantId } from "@/lib/tenant-context";
import {
  recoveryForSetupItem,
  type RecoveryAction,
  type SetupItemKind,
} from "./recovery-actions";

export type FinishSetupItem = RecoveryAction & { kind: SetupItemKind };

async function wixPageMappingDone(): Promise<boolean> {
  try {
    const wix = await getConnectorInfo("wix");
    if (wix.status !== "connected") return true; // nothing to map until Wix is connected
    const map = await getWixUrlMap();
    return map.length > 0;
  } catch {
    return false;
  }
}

/** Names-only presence check - never reads the secret values themselves. */
function digestEmailDone(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BEACON_DIGEST_TO?.trim()) && Boolean(env.RESEND_API_KEY?.trim());
}

async function indexNowKeyDone(): Promise<boolean> {
  try {
    const cfg = await getIndexNowConfig();
    return cfg != null;
  } catch {
    return false;
  }
}

async function gscFullBackfillDone(): Promise<boolean> {
  try {
    const tenantId = await currentTenantId();
    const readiness = await loadGscReadiness(tenantId);
    if (readiness.property == null) return true; // nothing to backfill until GSC has a resolved property
    const progress = await readBackfillProgress(tenantId, readiness.property);
    return progress != null && progress.status === "complete";
  } catch {
    return false;
  }
}

async function revenueModelDone(): Promise<boolean> {
  try {
    const cfg = await getBusinessConfigForCurrentTenant();
    return cfg.revenueModel != null;
  } catch {
    return false;
  }
}

/**
 * Build the checklist: one entry per NOT-YET-DONE setup item, in the same
 * order the master plan lists them. Empty array = every item done, the
 * card self-hides entirely.
 */
export async function loadFinishSetupChecklist(): Promise<FinishSetupItem[]> {
  const [wixDone, digestDone, indexNowDone, backfillDone, revenueDone] = await Promise.all([
    wixPageMappingDone(),
    Promise.resolve(digestEmailDone()),
    indexNowKeyDone(),
    gscFullBackfillDone(),
    revenueModelDone(),
  ]);

  const statuses: Array<{ kind: SetupItemKind; done: boolean }> = [
    { kind: "wix_page_mapping", done: wixDone },
    { kind: "digest_email", done: digestDone },
    { kind: "indexnow_key", done: indexNowDone },
    { kind: "gsc_full_backfill", done: backfillDone },
    { kind: "revenue_model", done: revenueDone },
  ];

  const items: FinishSetupItem[] = [];
  for (const s of statuses) {
    const action = recoveryForSetupItem(s);
    if (action != null) items.push({ ...action, kind: s.kind });
  }
  return items;
}
