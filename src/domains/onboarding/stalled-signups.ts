/**
 * stalled-signups (2026-07-03, BEACON_500 R12 / T0e) - rescue the signup
 * that went quiet.
 *
 * A tenant row stuck in pending_onboarding with a created config but zero
 * scan progress after 24 hours is a stranger who typed their URL and got
 * nothing. This module classifies every pending tenant into an honest
 * stage + ONE recovery action (the recovery-actions map pattern: plain
 * problem, exact fix naming the click, deep link), for the operator
 * /diagnostics surface.
 *
 * PURE classification + one thin loader. No status flips, no writes.
 */

import type { BeaconTenant } from "@/domains/tenants/types";
import type { RecoveryAction } from "@/domains/ops/recovery-actions";
import type { CrawlFrontierState } from "@/domains/scanning/crawl-frontier";
import { listTenants } from "@/domains/tenants/store";
import { loadAllCrawlFrontiers } from "@/domains/scanning/crawl-frontier";

/** How long a pending signup may sit quiet before it surfaces as stalled. */
export const STALLED_AFTER_MS = 24 * 60 * 60 * 1000;

export type StalledStage = "no_site_url" | "no_scan" | "scan_stalled" | "site_unreachable";

export type StalledSignup = {
  tenantId: string;
  businessName: string;
  domain: string;
  signedUpAt: string;
  /** Hours since the signup (floored, for honest display). */
  stalledHours: number;
  stage: StalledStage;
  pagesRead: number;
  recovery: RecoveryAction & {
    /** Present when the row can be resumed right from /diagnostics (the
     *  resume form posts this tenant's id to the crawl actions). */
    resume?: { kind: "start_first_look" | "continue_crawl"; tenantId: string };
  };
};

const STAGE_RECOVERY: Record<StalledStage, { plainProblem: string; exactFix: string; href: string }> = {
  no_site_url: {
    plainProblem: "They signed up but never gave a site address, so I have nothing to read.",
    exactFix: "Open the signup start page and enter the site address for them, or nudge them to finish it.",
    href: "/onboard",
  },
  no_scan: {
    plainProblem: "They gave a site address but the first read never ran, so their first look is empty.",
    exactFix: "Click Run the first read here. It reads a bounded batch of their pages right now.",
    href: "/diagnostics",
  },
  scan_stalled: {
    plainProblem: "The first read started but has not moved in over a day.",
    exactFix: "Click Continue reading here. Each click reads one more bounded batch, and normal Beacon use keeps it moving in the background.",
    href: "/diagnostics",
  },
  site_unreachable: {
    plainProblem: "Their site did not answer when I tried to read it.",
    exactFix: "Confirm the address is right and the site loads in a browser, then click Try the first read again here.",
    href: "/diagnostics",
  },
};

/**
 * PURE: classify pending signups against their crawl state. `now` injected
 * for tests. Only rows older than STALLED_AFTER_MS surface; a signup from an
 * hour ago is not stalled, it is in progress.
 */
export function classifyStalledSignups(
  tenants: readonly Pick<BeaconTenant, "id" | "status" | "business_name" | "domain" | "created_at">[],
  frontiers: readonly Pick<
    CrawlFrontierState,
    "tenant_id" | "status" | "pages_crawled" | "last_batch_at" | "updated_at"
  >[],
  now: Date = new Date(),
): StalledSignup[] {
  const byTenant = new Map(frontiers.map((f) => [f.tenant_id, f]));
  const out: StalledSignup[] = [];
  for (const t of tenants) {
    if (t.status !== "pending_onboarding") continue;
    const createdMs = Date.parse(t.created_at);
    if (!Number.isFinite(createdMs)) continue;
    const ageMs = now.getTime() - createdMs;
    if (ageMs < STALLED_AFTER_MS) continue;

    const frontier = byTenant.get(t.id) ?? null;
    const domain = (t.domain ?? "").trim();

    let stage: StalledStage;
    let pagesRead = 0;
    if (!domain) {
      stage = "no_site_url";
    } else if (!frontier) {
      stage = "no_scan";
    } else if (frontier.status === "unreachable") {
      stage = "site_unreachable";
    } else if (frontier.status === "complete") {
      continue; // their first look finished; nothing stalled about the scan
    } else {
      pagesRead = frontier.pages_crawled;
      const lastMoveMs = Date.parse(frontier.last_batch_at ?? frontier.updated_at);
      const quietMs = now.getTime() - (Number.isFinite(lastMoveMs) ? lastMoveMs : createdMs);
      if (pagesRead === 0 || quietMs >= STALLED_AFTER_MS) {
        stage = "scan_stalled";
      } else {
        continue; // moving along fine
      }
    }

    const base = STAGE_RECOVERY[stage];
    out.push({
      tenantId: t.id,
      businessName: t.business_name,
      domain,
      signedUpAt: t.created_at,
      stalledHours: Math.floor(ageMs / (60 * 60 * 1000)),
      stage,
      pagesRead,
      recovery: {
        ...base,
        resume:
          stage === "no_scan" || stage === "site_unreachable"
            ? { kind: "start_first_look", tenantId: t.id }
            : stage === "scan_stalled"
              ? { kind: "continue_crawl", tenantId: t.id }
              : undefined,
      },
    });
  }
  // Oldest first: the longest-stalled signup is the most embarrassing one.
  return out.sort((a, b) => Date.parse(a.signedUpAt) - Date.parse(b.signedUpAt));
}

/** Loader for /diagnostics. Fail-soft to [] - a read error must never take
 *  the operator page down. */
export async function loadStalledSignups(now: Date = new Date()): Promise<StalledSignup[]> {
  try {
    const [tenants, frontiers] = await Promise.all([listTenants(), loadAllCrawlFrontiers()]);
    return classifyStalledSignups(tenants, frontiers, now);
  } catch {
    return [];
  }
}
