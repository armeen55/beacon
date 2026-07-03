/**
 * snippet-promise (2026-07-03, BEACON_500 R8 / N18 - the search-snippet
 * promise audit).
 *
 * PURE / no I/O / no LLM. A page's title + meta description are the promise
 * its search snippet makes; the first ~200 words are where that promise must
 * be kept. For owned pages with real Google impressions, this module compares
 * the promise tokens against the page's early body text (page_snapshots
 * body_paragraph_sample) and flags the pages that promise something specific
 * ("cost", "top 10", "how to", "when is") without delivering it early.
 *
 * DELIBERATELY NARROW: only four promise kinds, each with a concrete,
 * checkable fulfillment signal - so a flag is always defensible in one plain
 * sentence ("The title promises the cost, but the first 200 words never give
 * a number."). A page with no early text stored is NEVER flagged (missing
 * data is not evidence of a broken promise).
 *
 * Fed through the existing deterministic trigger pipeline
 * (load-trigger-candidates-for-tenant.ts) as `snippet_promise_gap` ->
 * `update_intro` candidates, capped at MAX_SNIPPET_PROMISE_CANDIDATES per run
 * (highest-impressions pages first - fix the promise the most people see).
 */

import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import { dedupeKey } from "@/domains/recommendation-intelligence/emitter/dedupe-key";
import { cooldownKey } from "@/domains/recommendation-intelligence/emitter/cooldown-key";
import { snippetPromiseCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";

export type PromiseKind = "cost" | "count_list" | "how_to" | "date";

export const MAX_SNIPPET_PROMISE_CANDIDATES = 5;
/** The page needs a real audience before its broken promise matters. */
export const MIN_IMPRESSIONS_FOR_PROMISE_AUDIT = 100;
/** "Early" = the first N words of stored body text. */
export const EARLY_WORD_WINDOW = 200;

export type SnippetPromiseInput = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  /** Stored early body text (body_paragraph_sample joined); null/empty means
   *  the audit honestly abstains for this page. */
  earlyText: string | null;
  /** 90-day GSC impressions for this page (0 when GSC has no data). */
  impressions: number;
  httpStatus?: number;
  /** ISO timestamp of the snapshot backing earlyText. */
  fetchedAt?: string | null;
};

export type SnippetPromiseGap = {
  url: string;
  promise: PromiseKind;
  /** The literal promise phrase matched in the title/meta. */
  promisedText: string;
  impressions: number;
  /** One plain sentence naming the honest gap. */
  sentence: string;
};

const PROMISE_LABEL: Record<PromiseKind, string> = {
  cost: "the cost",
  count_list: "a specific number of items",
  how_to: "the steps",
  date: "the date",
};

const MISSING_SIGNAL: Record<PromiseKind, string> = {
  cost: "never give a number",
  count_list: "never show a count",
  how_to: "never start the steps",
  date: "never name the date",
};

const MONTHS =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|farvardin|ordibehesht|khordad|tir|mordad|shahrivar|mehr|aban|azar|dey|bahman|esfand)\b/i;

type PromiseRule = {
  kind: PromiseKind;
  /** Fires on the title/meta (the snippet promise). */
  promise: RegExp;
  /** Counts as fulfilled when found in the first EARLY_WORD_WINDOW words. */
  fulfilled: (early: string) => boolean;
};

const RULES: readonly PromiseRule[] = [
  {
    kind: "cost",
    promise: /\b(cost|costs|price|prices|pricing|how much)\b/i,
    fulfilled: (early) => /\d/.test(early) || /\bfree\b/i.test(early),
  },
  {
    kind: "count_list",
    promise: /\btop\s+\d+\b|\b\d+\s+(best|top|essential|famous|popular|common|beautiful|easy|ideas|names|examples|ways|facts|foods|places|words|phrases|traditions|recipes)\b|\b\d{2,}\s*\+/i,
    fulfilled: (early) => /\d/.test(early) || /\blist\b/i.test(early),
  },
  {
    kind: "how_to",
    promise: /\bhow to\b|\bstep[- ]by[- ]step\b/i,
    fulfilled: (early) => /\b(step|steps|first|start|begin|need)\b/i.test(early),
  },
  {
    kind: "date",
    promise: /\bwhen is\b|\bdates?\b/i,
    fulfilled: (early) => MONTHS.test(early) || /\b\d{4}\b/.test(early) || /\b\d{1,2}(st|nd|rd|th)\b/i.test(early),
  },
];

function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(" ");
}

/** Does this title/meta make one of the four checkable promises at all?
 *  Used by the loader to pre-select which pages are worth a (bounded, scoped)
 *  early-body-text read - the egress-lean snapshot projections omit body
 *  text, so the loader only fetches it for pages this returns true for. */
export function hasSnippetPromise(title: string | null | undefined, metaDescription: string | null | undefined): boolean {
  const snippet = [title ?? "", metaDescription ?? ""].join(" ").trim();
  if (!snippet) return false;
  return RULES.some((r) => r.promise.test(snippet));
}

/**
 * Audit ONE page's snippet promise. Returns the gap, or null when the page
 * keeps its promise, promises nothing specific, or has no early text stored
 * (never fake a check off missing data).
 */
export function findSnippetPromiseGap(input: SnippetPromiseInput): SnippetPromiseGap | null {
  if ((input.httpStatus ?? 200) >= 400) return null;
  if (input.impressions < MIN_IMPRESSIONS_FOR_PROMISE_AUDIT) return null;
  const snippet = [input.title ?? "", input.metaDescription ?? ""].join(" ").trim();
  if (!snippet) return null;
  const early = firstWords(input.earlyText ?? "", EARLY_WORD_WINDOW);
  if (!early) return null; // no stored body text -> honestly unchecked

  for (const rule of RULES) {
    const match = snippet.match(rule.promise);
    if (!match) continue;
    if (rule.fulfilled(early)) return null; // the first matched promise is kept
    return {
      url: input.url,
      promise: rule.kind,
      promisedText: match[0]!,
      impressions: input.impressions,
      sentence: `The title promises ${PROMISE_LABEL[rule.kind]} but the first ${EARLY_WORD_WINDOW} words ${MISSING_SIGNAL[rule.kind]}.`,
    };
  }
  return null;
}

/**
 * The deterministic trigger: audit every eligible page, keep the top
 * MAX_SNIPPET_PROMISE_CANDIDATES gaps by impressions (fix the promise the
 * most searchers see first), and shape them as candidate rows for the
 * existing trigger pipeline. `update_intro` is the play: deliver the promised
 * answer in the opening lines. Pure over pre-loaded inputs.
 */
export function snippetPromiseCandidates(args: {
  tenantId: string;
  pages: readonly SnippetPromiseInput[];
  signalAt: string;
  maxCandidates?: number;
}): RecommendationCandidateRow[] {
  const max = args.maxCandidates ?? MAX_SNIPPET_PROMISE_CANDIDATES;
  const gaps: Array<{ gap: SnippetPromiseGap; fetchedAt: string | null }> = [];
  for (const page of args.pages) {
    const gap = findSnippetPromiseGap(page);
    if (gap) gaps.push({ gap, fetchedAt: page.fetchedAt ?? null });
  }
  gaps.sort((a, b) => b.gap.impressions - a.gap.impressions);

  const actionType = "update_intro" as const;
  return gaps.slice(0, max).map(({ gap, fetchedAt }) => {
    const topicClusterLabel = `snippet_promise:${gap.promise}`;
    return {
      tenant_id: args.tenantId,
      trigger_signal: "snippet_promise_gap",
      action_type: actionType,
      generator_kind: "deterministic" as const,
      target_url: gap.url,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot" as const,
          ref: gap.url,
          detail:
            "snippet_promise promise=" +
            gap.promise +
            "; promised_text=" +
            gap.promisedText +
            "; impressions_90d=" +
            gap.impressions +
            "; early_window_words=" +
            EARLY_WORD_WINDOW +
            "; fulfilled=false",
        },
      ],
      confidence: "medium" as const,
      impact_estimate: "medium" as const,
      customer_copy: snippetPromiseCopy(PROMISE_LABEL[gap.promise], MISSING_SIGNAL[gap.promise], gap.impressions),
      operator_evidence:
        "signal=snippet_promise_gap; promise=" +
        gap.promise +
        "; promised_text=" +
        gap.promisedText +
        "; impressions_90d=" +
        gap.impressions +
        "; early_window_words=" +
        EARLY_WORD_WINDOW,
      dedupe_key: dedupeKey({ tenantId: args.tenantId, actionType, targetUrl: gap.url, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId: args.tenantId, actionType, targetUrl: gap.url }),
      created_from_signal_at: fetchedAt ?? args.signalAt,
      safety_flags: [],
    };
  });
}
