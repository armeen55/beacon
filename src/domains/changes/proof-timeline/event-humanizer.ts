/**
 * /changes/[id] proof-brief — plain-English outcome-event humanizer.
 *
 * Bundle (2026-05-11) — /changes/[id] 5-act narrative redesign per
 * the maximum-depth UI audit
 * (`~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Customer-vocabulary contract:
 *   • Raw event-type enums (`first_appearance`, `visibility_regained`,
 *     `mention_surge`, `visibility_lost`, `mention_decline`) NEVER
 *     appear in customer-facing copy.
 *   • Every event renders as a plain-English label + one-sentence
 *     plain-English explanation + a tone hint that drives the row's
 *     color (success / danger / muted).
 *   • Platform names render as branded labels ("ChatGPT" / "Google
 *     AI Overviews" / "Perplexity").
 *
 * Pure module — no I/O, no DOM, no React. Lives alongside the rest of
 * the proof-timeline helpers so Node-only tests can pin the contract.
 */
import type {
  OutcomeEvent,
  OutcomeEventType,
} from "@/domains/attribution/events";

export type EventTone = "success" | "danger" | "muted";

export type HumanizedEvent = {
  /** Plain-English title (e.g., "First time cited"). */
  label: string;
  /** Plain-English one-sentence explanation referencing topic +
   *  platform when present. */
  summary: string;
  /** Date for the row (ISO YYYY-MM-DD slice). */
  date: string;
  /** Customer-friendly platform label. */
  platformLabel: string;
  /** Color signal. */
  tone: EventTone;
  /** Stable kind for data-attrs + sort. Always one of the
   *  customer-safe label keys (NOT the raw enum). */
  kind: HumanizedEventKind;
};

export type HumanizedEventKind =
  | "first_cited"
  | "back_in_rankings"
  | "mentions_jumped"
  | "dropped_from_rankings"
  | "mentions_slowed";

const KIND_BY_TYPE: Record<OutcomeEventType, HumanizedEventKind> = {
  first_appearance: "first_cited",
  visibility_regained: "back_in_rankings",
  mention_surge: "mentions_jumped",
  visibility_lost: "dropped_from_rankings",
  mention_decline: "mentions_slowed",
};

const LABEL_BY_KIND: Record<HumanizedEventKind, string> = {
  first_cited: "First time cited",
  back_in_rankings: "Back in the rankings",
  mentions_jumped: "Mentions jumped",
  dropped_from_rankings: "Dropped from the rankings",
  mentions_slowed: "Mentions slowed down",
};

const TONE_BY_KIND: Record<HumanizedEventKind, EventTone> = {
  first_cited: "success",
  back_in_rankings: "success",
  mentions_jumped: "success",
  dropped_from_rankings: "danger",
  mentions_slowed: "danger",
};

export const PLATFORM_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "Google AI Overviews",
  perplexity: "Perplexity",
};

/**
 * Customer-friendly label for a tracked platform key. Falls through
 * to the raw key only for unknown platforms (which would already be
 * gated upstream).
 */
export function platformLabel(key: string): string {
  return PLATFORM_LABEL[key] ?? key;
}

/**
 * Convert one outcome event into the customer-facing projection used
 * by the v2 detail page's Act 4.
 *
 * Pure; safe to call from server and from tests. Never references the
 * raw enum value in output strings.
 */
export function humanizeOutcomeEvent(event: OutcomeEvent): HumanizedEvent {
  const kind = KIND_BY_TYPE[event.type];
  const label = LABEL_BY_KIND[kind];
  const platform = platformLabel(event.platform);
  const tone = TONE_BY_KIND[kind];

  let summary: string;
  switch (kind) {
    case "first_cited":
      summary = `Beacon saw ${platform} cite you for "${event.topic}" for the first time.`;
      break;
    case "back_in_rankings":
      summary = `${platform} started mentioning you again for "${event.topic}" after a quiet stretch.`;
      break;
    case "mentions_jumped":
      summary = `${platform} mentions for "${event.topic}" climbed from ${event.context.mentions_before ?? 0} to ${event.context.mentions_after} in a single check.`;
      break;
    case "dropped_from_rankings":
      summary = `${platform} stopped citing you for "${event.topic}".`;
      break;
    case "mentions_slowed":
      summary = `${platform} mentions for "${event.topic}" slowed to ${event.context.mentions_after} after sitting at ${event.context.mentions_before ?? 0}.`;
      break;
  }

  return {
    label,
    summary,
    date: event.trigger_date.slice(0, 10),
    platformLabel: platform,
    tone,
    kind,
  };
}
