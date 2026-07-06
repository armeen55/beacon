/**
 * refresh-tenant-profile — the nightly self-heal (2026-07-06).
 *
 * Re-derives a tenant's business profile from its NOW-current substrates
 * (persisted page snapshots + synced GSC + config) and folds the result back
 * in, so a business that adds pages or opens new markets updates its profile
 * automatically — without a human ever opening the config screen, and without
 * clobbering anything the operator DID edit (persistTenantProfile pins
 * overrides).
 *
 * $0 + FREE: reads only already-persisted snapshots + already-synced GSC (no
 * live crawl, no paid API, no LLM by default). Fail-soft: any error returns a
 * no-op result rather than throwing, so it can never break the nightly run.
 *
 * The caller (cron-sync) applies the segment change via updateTenant — this
 * module returns whether one is needed so the store write stays at the caller's
 * seam (matching every other nightly phase).
 */

import "server-only";

import { log } from "@/lib/logger";
import { deriveTenantProfile } from "./tenant-profile";
import { persistTenantProfile } from "./persist-tenant-profile";
import type { BusinessType } from "./business-type";

export type RefreshTenantProfileResult = {
  ran: boolean;
  businessType: BusinessType | null;
  changedFields: string[];
  segmentChanged: boolean;
  segment: "local_service" | "content_publisher" | null;
  detail?: string;
};

const NOOP: RefreshTenantProfileResult = {
  ran: false,
  businessType: null,
  changedFields: [],
  segmentChanged: false,
  segment: null,
};

/**
 * Refresh + self-heal one tenant's profile. Returns the segment-change decision
 * for the caller to apply (via updateTenant). Fail-soft.
 */
export async function refreshTenantProfile(args: {
  tenantId: string;
  currentSegment?: string | null;
}): Promise<RefreshTenantProfileResult> {
  try {
    const profile = await deriveTenantProfile({ tenantId: args.tenantId });
    const persisted = persistTenantProfile({
      tenantId: args.tenantId,
      profile,
      currentSegment: args.currentSegment,
    });
    if (persisted.changedFields.length > 0) {
      log.info("[refresh-tenant-profile] filled config holes", {
        tenantId: args.tenantId,
        businessType: profile.businessType,
        changed: persisted.changedFields.join(", "),
      });
    }
    return {
      ran: true,
      businessType: profile.businessType,
      changedFields: persisted.changedFields,
      segmentChanged: persisted.segmentChanged,
      segment: persisted.segment,
    };
  } catch (e) {
    return {
      ...NOOP,
      detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
    };
  }
}
