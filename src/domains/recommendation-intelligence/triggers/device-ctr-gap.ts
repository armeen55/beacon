/**
 * Device click-gap trigger (BEACON_500 R17b / P2 slice 2, v1 item 268) -
 * predicate `gsc_device_ctr_gap`.
 *
 * THE GAP: phones carry most of the site's Google demand, yet mobile
 * searchers click FAR less often than desktop searchers do at comparable
 * rankings. That pattern points at the mobile presentation (how titles and
 * descriptions read and truncate on a phone), not at rankings, and it is
 * invisible on every blended-device surface.
 *
 * THE RULE (all four must hold, over one weekly device snapshot):
 *   - volume floors: mobile >= 1,000 and desktop >= 500 impressions that week
 *     (a click-rate comparison over less is noise);
 *   - phones are the MAJORITY of impressions (the copy says "most of your
 *     traffic" and must be literally true);
 *   - rankings are comparable: mobile average position no more than 3 spots
 *     worse than desktop (otherwise the gap is a ranking story, not a
 *     presentation story - never blame the listing for a rank difference);
 *   - the shortfall is big: mobile click rate BELOW 60 percent of desktop's
 *     (a 40 percent relative gap; exactly 60 percent does NOT fire).
 *
 * CAPPED AT 1 by construction: the input is one property-level weekly
 * aggregate, so at most one candidate ever emits.
 *
 * @no-classifier-required: tenant-level device split, not page-scoped. The
 * unit is the property's weekly device aggregate, so emission anchors to the
 * always-HTML site root - same sanctioned opt-out connector-failure-streak.ts
 * / sov-drop-alert.ts use.
 *
 * PURE FUNCTION over the pre-loaded weekly signal
 * (domains/gsc/load-weekly-dimensions.ts does the I/O).
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { deviceCtrGapCopy } from "../customer-copy-templates";
import type { DeviceCtrGapSignal } from "@/domains/gsc/weekly-dimensions";

export const DEVICE_GAP_MIN_MOBILE_IMPRESSIONS = 1_000;
export const DEVICE_GAP_MIN_DESKTOP_IMPRESSIONS = 500;
/** Mobile must click below (1 - this) of desktop's rate to fire. */
export const DEVICE_GAP_RELATIVE_SHORTFALL = 0.4;
/** Mobile may rank at most this many spots worse than desktop. */
export const DEVICE_GAP_POSITION_SLACK = 3;

export type DeviceCtrGapInput = {
  tenantId: string;
  /** Pre-loaded weekly device signal, or null when no weekly snapshot exists
   *  (or a device row is missing) - the predicate then abstains. */
  signal: DeviceCtrGapSignal | null;
  /** Site-root URL to anchor the card on; null = abstain (queue rules
   *  require a URL). */
  siteRootUrl: string | null;
  signalAt: string;
};

/** Clicks per 100 appearances, one decimal, as a plain string ("1.4"). */
function per100(ctr: number): string {
  return (ctr * 100).toFixed(1);
}

export function deviceCtrGap(input: DeviceCtrGapInput): RecommendationCandidateRow[] {
  const { tenantId, signal, siteRootUrl, signalAt } = input;
  if (signal == null) return [];
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];

  const {
    mobileImpressions,
    desktopImpressions,
    mobileCtr,
    desktopCtr,
    mobilePosition,
    desktopPosition,
  } = signal;

  if (mobileImpressions < DEVICE_GAP_MIN_MOBILE_IMPRESSIONS) return [];
  if (desktopImpressions < DEVICE_GAP_MIN_DESKTOP_IMPRESSIONS) return [];
  // "Phones make up most of your traffic" must be literally true.
  if (mobileImpressions <= desktopImpressions) return [];
  // Comparable rankings only - a big rank gap explains the click gap.
  if (mobilePosition > desktopPosition + DEVICE_GAP_POSITION_SLACK) return [];
  if (desktopCtr <= 0) return [];
  // Strict inequality: exactly the 60 percent boundary does NOT fire.
  if (mobileCtr >= desktopCtr * (1 - DEVICE_GAP_RELATIVE_SHORTFALL)) return [];

  const actionType = "watch" as const;
  const targetUrl = siteRootUrl;
  const topicClusterLabel = "gsc_device_ctr_gap";
  // Weekly clicks lost if mobile clicked at desktop's rate, scaled to the
  // 90-day convention the queue's priority math expects.
  const weeklyGapClicks = Math.max(0, (desktopCtr - mobileCtr) * mobileImpressions);
  const upside90d = Math.round(weeklyGapClicks * (90 / 7));

  return [
    {
      tenant_id: tenantId,
      trigger_signal: "gsc_device_ctr_gap",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "business_config",
          ref: "gsc_device_ctr_gap:" + signal.weekEnd,
          detail:
            "gsc_weekly_device week=" +
            signal.weekStart +
            ".." +
            signal.weekEnd +
            "; mobile_impressions=" +
            mobileImpressions +
            "; mobile_ctr=" +
            (mobileCtr * 100).toFixed(2) +
            "%; mobile_position=" +
            mobilePosition.toFixed(1) +
            "; desktop_impressions=" +
            desktopImpressions +
            "; desktop_ctr=" +
            (desktopCtr * 100).toFixed(2) +
            "%; desktop_position=" +
            desktopPosition.toFixed(1),
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      upside_clicks_90d: upside90d,
      customer_copy: deviceCtrGapCopy(per100(mobileCtr), per100(desktopCtr)),
      operator_evidence:
        "signal=gsc_device_ctr_gap; week=" +
        signal.weekStart +
        ".." +
        signal.weekEnd +
        "; mobile ctr " +
        (mobileCtr * 100).toFixed(2) +
        "% on " +
        mobileImpressions +
        " impr (pos " +
        mobilePosition.toFixed(1) +
        ") vs desktop ctr " +
        (desktopCtr * 100).toFixed(2) +
        "% on " +
        desktopImpressions +
        " impr (pos " +
        desktopPosition.toFixed(1) +
        "); shortfall_gate=" +
        DEVICE_GAP_RELATIVE_SHORTFALL,
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    },
  ];
}
