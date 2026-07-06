/**
 * persist-tenant-profile — write the derived profile without clobbering the
 * operator (2026-07-06).
 *
 * The self-heal writer: takes a `TenantProfile` (from deriveTenantProfile) and
 * folds it into the tenant's BusinessConfig + segment, obeying ONE hard rule —
 *
 *   OPERATOR OVERRIDES ARE PINNED. Re-derivation only fills genuinely EMPTY
 *   holes; it never overwrites a field the operator (or a prior derivation)
 *   already set. `businessType` and `serviceAreas` are recorded when absent/
 *   empty; a business that later adds pages/markets grows its service-area list
 *   by UNION (new markets added, existing ones kept), never by replacement.
 *
 * This makes the writer additive + byte-identical for an already-configured
 * tenant: a content site stays content, a hand-edited service list stays as the
 * operator typed it, and only truly-missing fields get filled.
 *
 * Fail-soft: any write error is swallowed and reported, never thrown — a
 * profile refresh must never break a nightly run or a launch.
 */

import "server-only";

import {
  getBusinessConfig,
  saveBusinessConfig,
  type BusinessConfig,
} from "@/lib/business-config";
import { log } from "@/lib/logger";
import type { TenantProfile } from "./tenant-profile";

export type PersistTenantProfileResult = {
  /** Config field names this pass actually changed. */
  changedFields: string[];
  /** The businessType now recorded (existing or newly filled). */
  businessType: BusinessConfig["businessType"];
  /** True when a new segment should ride the tenant UPDATE (caller applies). */
  segmentChanged: boolean;
  /** The segment to set, when segmentChanged. */
  segment: "local_service" | "content_publisher" | null;
};

/** Case-insensitive union that preserves the existing order first. */
function unionPreserveOrder(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((v) => v.trim().toLowerCase()));
  const out = [...existing];
  for (const v of incoming) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * Persist the derived profile, PINNING operator overrides. Returns the fields
 * changed + whether the caller should update the tenant segment.
 *
 * @param currentSegment the tenant's current segment (so we only suggest a
 *   change when the derived one genuinely differs and the tenant is not on a
 *   self-declared builder segment, which always wins).
 */
export function persistTenantProfile(args: {
  tenantId: string;
  profile: TenantProfile;
  currentSegment?: string | null;
}): PersistTenantProfileResult {
  const { tenantId, profile } = args;
  const current = getBusinessConfig(tenantId);
  const patch: Partial<BusinessConfig> = {};
  const changed: string[] = [];

  // businessType: record only when absent (operator/prior value is PINNED).
  if (!current.businessType && profile.businessType) {
    patch.businessType = profile.businessType;
    changed.push("businessType");
  }

  // industry: fill only when the config has none (never overwrite).
  if (!current.industry?.trim() && profile.industry.trim()) {
    patch.industry = profile.industry.trim();
    changed.push("industry");
  }

  // services: fill only when the config has none. If the operator already has a
  // list, it is PINNED (we do not append — a hand-curated list is intentional).
  if ((current.services ?? []).length === 0 && profile.services.length > 0) {
    patch.services = profile.services;
    changed.push("services");
  }

  // serviceAreas → config.locations. A local business's markets grow over time,
  // so we UNION new markets onto the existing list (keeping operator entries),
  // rather than replace. Only for local_service — a non-local type contributes
  // no service areas, so a content site's locations are never touched here.
  if (profile.businessType === "local_service" && profile.serviceAreas.length > 0) {
    const merged = unionPreserveOrder(current.locations ?? [], profile.serviceAreas);
    if (merged.length !== (current.locations ?? []).length) {
      patch.locations = merged;
      changed.push("locations");
    }
  }

  // contentSiteMode: a content publisher's pages must classify as content. Set
  // it when the type is content_publisher and it is not already on. Never turn
  // it OFF here (that is an operator decision).
  if (profile.businessType === "content_publisher" && !current.contentSiteMode) {
    patch.contentSiteMode = true;
    changed.push("contentSiteMode");
  }

  if (changed.length > 0) {
    try {
      saveBusinessConfig(tenantId, patch);
    } catch (e) {
      log.warn("[persist-tenant-profile] config save failed", {
        tenantId,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      return {
        changedFields: [],
        businessType: current.businessType,
        segmentChanged: false,
        segment: null,
      };
    }
  }

  // Segment self-heal: suggest a change only when the derived segment differs
  // from the current one AND the tenant is not on the self-declared builder
  // segment (a human picking builder tags always wins — never demote them).
  const builderSelfDeclared =
    args.currentSegment === "local_residential_builder";
  const segmentChanged =
    !builderSelfDeclared &&
    profile.suggestedSegment !== null &&
    profile.suggestedSegment !== args.currentSegment;

  return {
    changedFields: changed,
    businessType: patch.businessType ?? current.businessType,
    segmentChanged,
    segment: segmentChanged ? profile.suggestedSegment : null,
  };
}
