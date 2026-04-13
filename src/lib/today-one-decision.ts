import type { CoverageState } from "@/lib/coverage-state";
import type { CoverageTone } from "@/lib/today-proof-context";
import type { FindingPriority } from "@/domains/scanning/types";
import type { RecResponseStatus } from "@/lib/today-ritual";
import {
  isTodayTruthBlocked,
  isVisibilityCoverageStaleTruth,
} from "@/lib/today-next-line";

export type TodayOneDecisionInput = {
  isDemoMode: boolean;
  scanPhaseFailed: boolean;
  hasImportedVisibility: boolean;
  crawlStale: boolean;
  visibilityStaleVsCrawl: boolean;
  coverageState: CoverageState;
  coverageTone: CoverageTone;
  localUrgentStrip: { title: string; body: string; href: string } | null;
  localAttentionStrip: { headline: string; href: string } | null;
  primaryAction: {
    headline: string;
    href: string;
    responseStatus?: RecResponseStatus;
  } | null;
  pendingFindings: { priority: FindingPriority }[];
  allClear: boolean;
};

export type TodayOneDecisionTone = "neutral" | "warning" | "go";

export type TodayOneDecision = {
  /** The single move Beacon is asking for */
  title: string;
  shouldAct: boolean;
  why: string;
  /** Under ~5 minutes; null when shouldAct is false */
  firstStep: string | null;
  href: string | null;
  /** When shouldAct is false — what would need to change */
  whatWouldChangeThis: string | null;
  tone: TodayOneDecisionTone;
};

function primaryHandled(
  p: TodayOneDecisionInput["primaryAction"],
): boolean {
  if (!p) return true;
  const s = p.responseStatus;
  return s === "accepted" || s === "dismissed";
}

/**
 * One operator-facing decision for Today — same precedence as `deriveTodayNextLine`,
 * written as yes/no + first step (no new scoring).
 */
export function deriveTodayOneDecision(
  i: TodayOneDecisionInput,
): TodayOneDecision {
  if (i.isDemoMode) {
    return {
      title: "Load your own data",
      shouldAct: true,
      why:
        "You are still looking at sample rows. Nothing below is your business yet, so any ‘fix’ would be theater.",
      firstStep:
        "Open Settings → Import and drop your latest .xlsx visibility export once.",
      href: "/settings/import",
      whatWouldChangeThis: null,
      tone: "warning",
    };
  }

  if (i.scanPhaseFailed) {
    return {
      title: "Get a clean crawl finished",
      shouldAct: true,
      why:
        "The last scan did not finish. Until it does, Beacon is guessing from old HTML — the list below is not trustworthy.",
      firstStep:
        "Open Pages, start a crawl from there, and stay on the page until the status shows done.",
      href: "/pages",
      whatWouldChangeThis: null,
      tone: "warning",
    };
  }

  const truthBlocked = isTodayTruthBlocked({
    scanPhaseFailed: i.scanPhaseFailed,
    crawlStale: i.crawlStale,
    visibilityStaleVsCrawl: i.visibilityStaleVsCrawl,
    coverageState: i.coverageState,
    coverageTone: i.coverageTone,
  });

  if (truthBlocked) {
    const holdPrimary =
      Boolean(i.primaryAction) && !primaryHandled(i.primaryAction);
    const primaryWait =
      holdPrimary ? " The card at the top should wait until this is fixed." : "";

    const visCovStale = isVisibilityCoverageStaleTruth({
      isDemoMode: i.isDemoMode,
      scanPhaseFailed: i.scanPhaseFailed,
      visibilityStaleVsCrawl: i.visibilityStaleVsCrawl,
      coverageState: i.coverageState,
      coverageTone: i.coverageTone,
    });

    if (visCovStale && i.hasImportedVisibility) {
      return {
        title: "Upload your latest visibility export",
        shouldAct: true,
        why:
          "Your crawl and your saved visibility numbers are out of date compared with each other. Acting on the headline suggestion now would be guessing." +
          primaryWait,
        firstStep:
          "Open Settings → Import and drop the newest .xlsx export from your visibility tool. One successful upload is enough to re-check Today.",
        href: "/settings/import",
        whatWouldChangeThis: null,
        tone: "warning",
      };
    }

    if (i.coverageState === "critical") {
      const href = i.hasImportedVisibility ? "/settings/import" : "/pages";
      return {
        title: i.hasImportedVisibility
          ? "Refresh your export or crawl"
          : "Run a fresh crawl first",
        shouldAct: true,
        why:
          "Beacon is missing a solid anchor for how your site looks right now. The green bits on this page do not fix that gap." +
          primaryWait,
        firstStep:
          i.hasImportedVisibility
            ? "Open Settings → Import and upload the latest .xlsx, or open Pages and run a crawl if the site itself has changed a lot."
            : "Open Pages and run a full crawl. Come back here after you see a finished time stamp.",
        href,
        whatWouldChangeThis: null,
        tone: "warning",
      };
    }

    if (i.coverageState === "stale") {
      return {
        title: "Refresh crawl or visibility data",
        shouldAct: true,
        why:
          "Coverage is flagged stale. That is separate from ‘no diffs’ — the queue can be quiet while the numbers behind it are old." +
          primaryWait,
        firstStep:
          "Open Pages and run a crawl. If you track visibility with files, upload the latest .xlsx under Settings → Import next.",
        href: "/pages",
        whatWouldChangeThis: null,
        tone: "warning",
      };
    }

    if (i.crawlStale) {
      return {
        title: "Run a fresh site crawl",
        shouldAct: true,
        why:
          "Your stored HTML is old. Local notes and headline ideas sit on top of that snapshot — refreshing it is the honest next move." +
          primaryWait,
        firstStep:
          "Open Pages from the nav, start a crawl, and wait until it completes. That is the whole job for now.",
        href: "/pages",
        whatWouldChangeThis: null,
        tone: "warning",
      };
    }

    return {
      title: "Refresh what Beacon has on file",
      shouldAct: true,
      why:
        "Something in the crawl or visibility layer is thin or mismatched. Until that clears, treat everything else as background reading." +
        primaryWait,
      firstStep:
        "Open Pages, run a crawl, then if you use file-based visibility, open Settings → Import and drop the latest .xlsx once. Check the bottom of Today after.",
      href: "/pages",
      whatWouldChangeThis: null,
      tone: "warning",
    };
  }

  if (i.localUrgentStrip) {
    return {
      title: i.localUrgentStrip.title,
      shouldAct: true,
      why:
        "This one is flagged urgent on purpose — listings or reviews are far enough off that it can hurt trust or calls.",
      firstStep:
        "Open Local from the nav, read the yellow strip, and fix or confirm one item. You can stop after that if nothing is wrong.",
      href: i.localUrgentStrip.href,
      whatWouldChangeThis: null,
      tone: "go",
    };
  }

  if (i.localAttentionStrip) {
    return {
      title: i.localAttentionStrip.headline,
      shouldAct: true,
      why:
        "Your listing or review snapshot is not in the ‘all good’ band. It is not an emergency, but it is the next honest chore.",
      firstStep:
        "Open Local, skim the two fact lines, and either sync reviews or correct one wrong field. Five minutes max.",
      href: i.localAttentionStrip.href,
      whatWouldChangeThis: null,
      tone: "go",
    };
  }

  if (i.primaryAction && !primaryHandled(i.primaryAction)) {
    return {
      title: i.primaryAction.headline,
      shouldAct: true,
      why:
        "Data is fresh enough that this suggestion is the next thing Beacon would do itself — it is tied to a real change, not a generic checklist.",
      firstStep:
        "Open the linked card below, read the short ‘why’ block, and either accept or dismiss it. One decision ends the loop.",
      href: i.primaryAction.href,
      whatWouldChangeThis: null,
      tone: "go",
    };
  }

  const hasCritical = i.pendingFindings.some(
    (f) => f.priority === "critical",
  );
  if (hasCritical) {
    return {
      title: "Handle one red finding in the queue",
      shouldAct: true,
      why:
        "There is at least one critical diff between scans. Leaving it unread means you might ship on top of a real break.",
      firstStep:
        "Scroll to the queue below, click the first red row, read one sentence, and mark it handled or snooze it.",
      href: "/#today-findings",
      whatWouldChangeThis: null,
      tone: "go",
    };
  }

  if (i.pendingFindings.length > 0) {
    return {
      title: "Clear one item from the findings queue",
      shouldAct: true,
      why:
        "Nothing is on fire, but the queue is not empty — letting it sit turns Today into wallpaper.",
      firstStep:
        "Open the queue below and resolve or snooze a single row. Stop after one if time is tight.",
      href: "/#today-findings",
      whatWouldChangeThis: null,
      tone: "go",
    };
  }

  if (i.allClear) {
    return {
      title: "Do nothing in Beacon today",
      shouldAct: false,
      why:
        "Nothing here beats leaving well enough alone: scan is current, queue is quiet, and local is not pulling you in.",
      firstStep: null,
      href: null,
      whatWouldChangeThis:
        "New crawl diffs, a fresh visibility export upload, a local slip, or a new headline suggestion from Beacon would give you a real yes again.",
      tone: "neutral",
    };
  }

  return {
    title: "Skim Today once, then close it",
    shouldAct: false,
    why:
      "No single task is gated — you are caught up on what Beacon knows right now.",
    firstStep: null,
    href: null,
    whatWouldChangeThis:
      "If this still feels empty, upload a real visibility export; otherwise wait for the next crawl or export pass to surface work.",
    tone: "neutral",
  };
}
