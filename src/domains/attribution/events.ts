import type { Result } from "@/domains/results/types";
import type { Platform } from "@/lib/constants";

export type OutcomeEventType =
  | "first_appearance"
  | "visibility_regained"
  | "mention_surge";

export type OutcomeEvent = {
  id: string;
  type: OutcomeEventType;
  topic: string;
  platform: Platform;
  trigger_date: string;
  anchor_result_id: string;
  result_ids: string[];
  description: string;
  context: {
    mentions_before: number;
    mentions_after: number;
    cited: boolean;
    gap_days: number;
  };
};

type DaySnapshot = {
  date: string;
  result_id: string;
  mentions: number;
  cited: number;
  total: number;
};

const SURGE_MIN_MENTIONS = 3;
const SURGE_PREV_MAX = 1;
const REGAINED_GAP_MIN_DAYS = 2;

/**
 * Detect meaningful outcome events from attribution-mode results.
 *
 * Groups results by (topic × platform) into time series, then scans for:
 * - first_appearance: first time Ritz was mentioned/cited in this series
 * - visibility_regained: mentions resume after 2+ days of zero mentions
 * - mention_surge: sharp increase from ≤1 to ≥3 mentions in one day
 */
export function detectOutcomeEvents(results: Result[]): OutcomeEvent[] {
  const seriesMap = buildSeriesMap(results);
  const events: OutcomeEvent[] = [];

  for (const [key, days] of seriesMap) {
    const [topic, platform] = key.split("|");
    const sorted = days.sort((a, b) => a.date.localeCompare(b.date));

    let sawFirstMention = false;
    let lastMentionDayIdx = -1;

    for (let i = 0; i < sorted.length; i++) {
      const day = sorted[i];
      const prevDay = i > 0 ? sorted[i - 1] : null;
      const prevMentions = prevDay ? prevDay.mentions : 0;

      if (day.mentions > 0 && !sawFirstMention) {
        sawFirstMention = true;
        lastMentionDayIdx = i;

        const desc = day.cited > 0
          ? `First mentioned and cited on ${platformLabel(platform)} for ${topic}`
          : `First mentioned on ${platformLabel(platform)} for ${topic}`;

        events.push({
          id: `ev-first-${slugify(topic)}-${platform}`,
          type: "first_appearance",
          topic,
          platform: platform as Platform,
          trigger_date: day.date,
          anchor_result_id: day.result_id,
          result_ids: [day.result_id],
          description: `${desc} — ${day.mentions}/${day.total} prompts`,
          context: {
            mentions_before: 0,
            mentions_after: day.mentions,
            cited: day.cited > 0,
            gap_days: 0,
          },
        });
        continue;
      }

      if (day.mentions > 0 && sawFirstMention) {
        const gapDays = lastMentionDayIdx >= 0
          ? daysBetween(sorted[lastMentionDayIdx].date, day.date) - 1
          : 0;

        if (prevMentions === 0 && gapDays >= REGAINED_GAP_MIN_DAYS) {
          events.push({
            id: `ev-regain-${slugify(topic)}-${platform}-${day.date}`,
            type: "visibility_regained",
            topic,
            platform: platform as Platform,
            trigger_date: day.date,
            anchor_result_id: day.result_id,
            result_ids: [day.result_id],
            description: `Visibility regained on ${platformLabel(platform)} for ${topic} after ${gapDays}-day gap — ${day.mentions}/${day.total} prompts`,
            context: {
              mentions_before: 0,
              mentions_after: day.mentions,
              cited: day.cited > 0,
              gap_days: gapDays,
            },
          });
          lastMentionDayIdx = i;
          continue;
        }

        if (
          day.mentions >= SURGE_MIN_MENTIONS &&
          prevMentions <= SURGE_PREV_MAX
        ) {
          events.push({
            id: `ev-surge-${slugify(topic)}-${platform}-${day.date}`,
            type: "mention_surge",
            topic,
            platform: platform as Platform,
            trigger_date: day.date,
            anchor_result_id: day.result_id,
            result_ids: [day.result_id],
            description: `Mention surge on ${platformLabel(platform)} for ${topic} — ${prevMentions}→${day.mentions} mentions`,
            context: {
              mentions_before: prevMentions,
              mentions_after: day.mentions,
              cited: day.cited > 0,
              gap_days: 0,
            },
          });
        }

        lastMentionDayIdx = i;
      }
    }
  }

  return events.sort((a, b) => a.trigger_date.localeCompare(b.trigger_date));
}

function buildSeriesMap(
  results: Result[]
): Map<string, DaySnapshot[]> {
  const map = new Map<string, DaySnapshot[]>();

  for (const r of results) {
    if (!r.topic) continue;
    const key = `${r.topic}|${r.platform}`;
    if (!map.has(key)) map.set(key, []);

    const mentionMatch = r.notes?.match(/^(\d+)\/(\d+) mentioned/);
    const citedMatch = r.notes?.match(/(\d+)\/\d+ cited/);
    const mentions = mentionMatch ? parseInt(mentionMatch[1]) : r.metric_value;
    const total = mentionMatch ? parseInt(mentionMatch[2]) : r.metric_value;
    const cited = citedMatch ? parseInt(citedMatch[1]) : 0;

    map.get(key)!.push({
      date: r.snapshot_date,
      result_id: r.id,
      mentions,
      cited,
      total,
    });
  }

  return map;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

function platformLabel(p: string): string {
  const labels: Record<string, string> = {
    chatgpt: "ChatGPT",
    google_aio: "Google AI Overviews",
    perplexity: "Perplexity",
  };
  return labels[p] ?? p;
}
