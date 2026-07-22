import Link from "next/link";
import { Check, CornerUpLeft } from "lucide-react";

import { dossierHref } from "@/lib/page-dossier-link";
import { serverNowMs } from "@/lib/server-clock";
import {
  isMatureOutcome,
  type MeasurementPresentation,
} from "@/domains/proof-gsc/measurement-maturity";
import { UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE } from "@/domains/proof-gsc/verdict-calibration";
import type { VerdictReliabilityResult } from "@/domains/proof-gsc/verdict-reliability";
import { Sparkline, type SparkPoint } from "@/components/data/sparkline";
import type { ProofLink } from "@/domains/action-pack/proof-linker";
import {
  addDays,
  formatWindowLift,
  pickProofMetric,
  proofOutcomeSentence,
  type GscProofVerdict,
  type ProofMetric,
} from "@/domains/proof-gsc/measure";
import { citationLineFor } from "@/domains/proof-gsc/citation-outcome";
import { shouldShowChangeDollarLine } from "@/domains/proof-gsc/change-dollar-value";
import type { PersistedAnswerAlignment } from "@/domains/ai-visibility/answer-alignment-store";
import { permutationSentenceFromCounts, selectHeadlineSentence } from "@/domains/proof-gsc/reliability-extras";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  isUncalibratedDecidedRecord,
  proofBadgeLabel,
  proofBadgeLabelFromVerdict,
  proofBadgeMaturesOn,
} from "./proof-badge";
import { plainSearchHeadline } from "./proof-plain-search-line";
import {
  reconciliationSentence,
  searchAndTrafficDisagree,
} from "./proof-reconciliation";
import {
  ExcludeFromLearningButton,
  RecrawlButton,
  RollbackCopyButton,
} from "./proof-ledger-client";
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { buildVerdictRevisionLines } from "@/domains/proof-gsc/verdict-revisions";
import {
  controlsLegendLine,
  LEGACY_MEASUREMENT_CAVEAT,
  liveContradictionLine,
  prepSpendLine,
  verifyGaveUpLine,
} from "./trust-receipts";
import {
  buildReceiptLine,
  ReceiptLine,
} from "@/components/data/receipt-line";
import { behaviorHasContent } from "@/domains/proof-gsc/behavior-outcome";
import type { CompoundActionGroup } from "@/domains/proof-gsc/compound-actions";

/** Move 2 / FP8 - the badge is a Pill primitive colored by MATURITY tone, never by
 *  the raw verdict. Red/green appear only at a mature result; an early signal reads
 *  as the blue "measuring" intent, waiting-for-data as amber "waiting". */
const TONE_PILL_INTENT: Record<MeasurementPresentation["tone"], PillIntent> = {
  positive: "won",
  negative: "attention",
  neutral: "neutral",
  progress: "measuring",
  waiting: "waiting",
};
/** Legacy fallback (no presentation available): same maturity-honest posture -
 *  a pre-28-day won/lost never earns the final red/green treatment. */
function verdictPillIntent(verdict: GscProofVerdict, basisDay: number | null): PillIntent {
  if (verdict === "won") return basisDay === 28 ? "won" : "measuring";
  if (verdict === "lost") return basisDay === 28 ? "attention" : "measuring";
  if (verdict === "measuring" || verdict === "insufficient_data") return "waiting";
  return "neutral";
}

/** N32 (R21b) - the render dedupe rule for the external-event caveat: show it ONLY when the
 *  ledger produced a caveat AND that caveat is not the SAME sentence the weather guard already
 *  renders on this row. eventCaveatForWindow reuses weatherCaveatSentence verbatim for a shock, so
 *  when a window overlaps a shock this returns false (the weather line already said it) and a
 *  connector-outage / own-site-cluster caveat (a distinct sentence) returns true. Null self-hides.
 *  PURE; exported for a direct test pin. */
export function shouldRenderEventCaveat(
  eventCaveat: string | null | undefined,
  weatherCaveat: string | null | undefined,
): boolean {
  return !!eventCaveat && eventCaveat !== (weatherCaveat ?? null);
}

/** One verdict-reliability grade (master plan N10): a neutral gray scale, never
 *  red/green, so it never competes with the badge's own maturity color above -
 *  this chip answers "how much should I trust this specific read", not "did it
 *  win", and those two questions should never fight for the same color. */
const GRADE_STYLE: Record<VerdictReliabilityResult["grade"], string> = {
  solid: "border-emerald-200 bg-emerald-50/60 text-emerald-700/90",
  decent: "border-border bg-muted/30 text-muted-foreground",
  shaky: "border-amber-200 bg-amber-50/60 text-amber-700/90",
  "too early": "border-border bg-muted/20 text-muted-foreground/80",
};

function metricsLine(rec: ShippedChangeRecord): string {
  // Per-field guards: a legacy record could carry an undefined metric, which would
  // render NaN/NaN% - coalesce each to 0 so the line is always well-formed.
  const raw = rec.baseline;
  const clicks = Number(raw?.clicks) || 0;
  const impressions = Number(raw?.impressions) || 0;
  const ctr = Number(raw?.ctr) || 0;
  const position = Number(raw?.position) || 0;
  // No impressions = no Search data in the baseline window; "pos 0.0" is an
  // impossible rank, so say so honestly instead of rendering zeros.
  if (impressions <= 0) return "No Google data yet for the period before this change.";
  return `${clicks.toLocaleString()} visits from Google, shown ${impressions.toLocaleString()} times, ${(ctr * 100).toFixed(2)}% click rate, ranked about #${position.toFixed(1)}`;
}

const LINK_LABEL: Record<string, string> = {
  exact: "from your changes",
  strong: "from your changes",
  weak: "likely from your changes",
  none: "manual or legacy change",
};
const SOURCE_LABEL: Record<string, string> = {
  gsc: "Google Search", ga4: "Analytics", clarity: "Clarity UX",
  profound: "AI citations", dataforseo: "Live Google check",
  competitor_teardown: "Competitor teardown", rank_revenue: "Demand graph",
};

/** Item 72 - plain-business words for the change type in the lesson line. */
const PLAIN_ACTION: Record<string, string> = {
  edit_meta: "description change",
  edit_title: "title change",
  add_answer_block: "direct answer",
  add_internal_link: "internal link",
  add_schema: "structured data",
};
export function plainAction(actionType: string): string {
  return PLAIN_ACTION[actionType] ?? actionType.replace(/_/g, " ");
}
/** Item 72 - the judged metric in plain words. */
const PLAIN_METRIC: Record<ProofMetric, string> = {
  ctr: "the click rate",
  position: "the ranking",
  clicks: "clicks",
};

type LedgerBand = "win" | "learning" | "inflight";

/**
 * Item C8 - a ledger band (Wins / What we learned / In flight) used to render
 * every row in one flat list, so a "Manual or legacy change, not traced to a
 * ranked move" disclaimer sat directly under a Beacon-recommended card with
 * evidence chips, reading as if both were the same kind of thing. Split the
 * list visually instead: Beacon's own recommended changes first, then the
 * operator's own manual changes under their own header (Beacon is still
 * watching and measuring those, so it says so instead of just disclaiming).
 */
export function LedgerRowGroup({
  rows,
  band,
  linkByRowId,
  presById,
  compoundById,
  gradeById,
  eventCaveatById,
  sparkByPath,
  controlSparkByPath,
  ownedAlignmentByRecId,
}: {
  rows: ShippedChangeRecord[];
  band: LedgerBand;
  linkByRowId: Map<string, ProofLink>;
  presById: Map<string, MeasurementPresentation>;
  compoundById: Map<string, CompoundActionGroup>;
  gradeById?: Map<string, VerdictReliabilityResult>;
  /** N32 (R21b) - per-row external-event caveat (already deduped against the weather caveat). */
  eventCaveatById?: Map<string, string | null>;
  sparkByPath: Map<string, SparkPoint[]>;
  /** R14b (named controls) - comparison pages' own daily-clicks series. */
  controlSparkByPath?: Map<string, SparkPoint[]>;
  /** W2-B (2026-07-10) - batched "AI quoted this line" alignments, keyed by rec id,
   *  resolved once on the page (READ-ONLY on the GET) instead of per-card async reads. */
  ownedAlignmentByRecId?: Map<string, PersistedAnswerAlignment | null>;
}) {
  const recommended = rows.filter((rec) => linkByRowId.get(rec.id)?.actionPack);
  const manual = rows.filter((rec) => !linkByRowId.get(rec.id)?.actionPack);

  const card = (rec: ShippedChangeRecord) => {
    // R14b - up to 2 named comparison series for THIS row's chart (the same cap
    // the loader used). Only pages whose series actually loaded are named.
    const controlSparks = (rec.controlPages ?? [])
      .slice(0, 2)
      .map((p) => ({ path: p, points: controlSparkByPath?.get(p) ?? [] }))
      .filter((c) => c.points.length >= 5);
    return (
      <LedgerCard
        key={rec.id}
        rec={rec}
        band={band}
        link={linkByRowId.get(rec.id) ?? null}
        pres={presById.get(rec.id) ?? null}
        compound={compoundById.get(rec.id) ?? null}
        grade={gradeById?.get(rec.id) ?? null}
        eventCaveat={eventCaveatById?.get(rec.id) ?? null}
        spark={sparkByPath.get(rec.path)}
        controlSparks={controlSparks}
        ownedAlignment={ownedAlignmentByRecId?.get(rec.id) ?? null}
      />
    );
  };

  return (
    <>
      {recommended.length > 0 ? (
        <div className="mt-2">
          {manual.length > 0 ? (
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700/70">
              Changes Beacon recommended
            </div>
          ) : null}
          <div className="space-y-2.5">{recommended.map(card)}</div>
        </div>
      ) : null}
      {manual.length > 0 ? (
        <div className="mt-3">
          {recommended.length > 0 ? (
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Changes you made yourself (I am watching them too)
            </div>
          ) : null}
          <div className="space-y-2.5">{manual.map(card)}</div>
        </div>
      ) : null}
    </>
  );
}

function LedgerCard({ rec, link, pres, compound, grade, eventCaveat, spark, controlSparks, band, ownedAlignment }: { rec: ShippedChangeRecord; link?: ProofLink | null; pres?: MeasurementPresentation | null; compound?: CompoundActionGroup | null; grade?: VerdictReliabilityResult | null; eventCaveat?: string | null; spark?: SparkPoint[]; controlSparks?: Array<{ path: string; points: SparkPoint[] }>; band?: LedgerBand; ownedAlignment?: PersistedAnswerAlignment | null }) {
  // Judge a meta/title test on CTR, a content test on position, else clicks, so
  // every line on this card reads in the unit that actually moved.
  const metric = pickProofMetric(rec.actionType);
  const basis = rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const mature = pres ? isMatureOutcome(pres.maturity) : false;
  // Fail-closed calibration quarantine, review fix 1 (2026-07-11): every
  // verdict-worded line on this card is built from the calibration-aware
  // verdict, so an uncalibrated won/lost reads exactly like a mature
  // inconclusive row (never "This helped." / "Likely helping"). The approved
  // honest sentence renders ONCE per quarantined card, below the header.
  const quarantined = isUncalibratedDecidedRecord(rec);
  const cardVerdict = quarantined ? "inconclusive" : rec.verdict;
  // Move 2 - the headline Search line: at a MATURE result, the lift-bearing sentence;
  // before that, the honest maturity language (no "Likely hurting (high confidence)"
  // off a 7-day read). Falls back to the legacy sentence when no presentation.
  const floorSentence =
    pres && !mature
      ? `${pres.headline}. ${pres.explanation}`
      : proofOutcomeSentence({ verdict: cardVerdict, confidence: pres?.confidence ?? rec.confidence, basis, metric });
  // Item 67 - the Bayesian read is an honest quantification layer, NOT a second
  // decision path: the stored verdict (floors + permutation) still decides
  // won/lost above. The headline sentence only upgrades to the Bayesian
  // "X percent sure, likely N to M extra clicks a month" wording when a read
  // exists AND agrees in direction with that same floor verdict - it can add
  // confidence to a floor call, never contradict or replace one.
  // Review fix 1: the Bayesian "X percent sure, likely N to M extra clicks"
  // upgrade never fires on a quarantined verdict (its read derives from the
  // same failed thresholds' basis window).
  const sentence = selectHeadlineSentence(cardVerdict, quarantined ? null : rec.bayesianRead, floorSentence);
  // Item C2 - secondary "matures on X" text under the collapsed badge, for any
  // pre-verdict state. Null once a final verdict exists.
  const badgeMaturesOn = pres ? proofBadgeMaturesOn(pres) : null;
  // Item C4 - the PRIMARY Search line is a short plain call; the percent-sure
  // figure and click range (still real, still computed the same way) move one
  // click deeper into "See the math" below instead of leading the card.
  const plainHeadline = plainSearchHeadline(pres?.direction ?? "unknown", mature);
  // Report the controls actually used in the basis window; fall back to assigned
  // count only before any window has run (measuring state).
  const controlsCount = basis?.controlsUsed ?? rec.controlPages.length;
  // Item C3 - when the Search read and the site-visits read point opposite
  // ways, say so in one sentence instead of leaving the contradiction sitting
  // there. Both signs are already computed above/on the record; this never
  // recomputes either one, only compares the two signs.
  const trafficDisagrees =
    !!pres &&
    rec.trafficOutcome?.ran === true &&
    searchAndTrafficDisagree(pres.direction, rec.trafficOutcome?.adjustedSessionsPct);
  // FP8 - the collapsed summary's single most important number: the measured basis
  // window lift for a settled row (in the unit the verdict was judged on), the
  // countdown to the next read for an in-flight one. Never invented - a settled row
  // without a basis window shows no number at all.
  const keyNumber = (() => {
    if (band === "win" || band === "learning") {
      return basis ? `${formatWindowLift(metric, basis)} over ${basis.day} days` : null;
    }
    const next = rec.windows.filter((w) => !w.ran).sort((a, b) => a.day - b.day)[0];
    if (next) {
      const anyRead = rec.windows.some((w) => w.ran);
      const daysLeft = Math.ceil((Date.parse(addDays(rec.shippedAt, next.day)) - serverNowMs()) / 86_400_000);
      return daysLeft <= 0
        ? "verdict due any day now"
        : `${anyRead ? "next" : "first"} read in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    }
    return badgeMaturesOn;
  })();
  // W5 stop-ship F6: honest terminal copy when the crawl-verify pass gave up.
  const verifyGaveUp = verifyGaveUpLine(rec.verifyState, rec.verifiedLive);
  // Trust-audit fix (2026-07-18): a row latched verified_live whose LATEST crawl
  // could not find the edit - say so instead of showing a lone green badge.
  const liveContradiction = liveContradictionLine(rec.verifyState, rec.verifiedLive);
  // Legacy-row honesty: rows shipped before the up-front measurement plan
  // (no predeclaredAt) were judged by the older method - name it once.
  const legacyMeasurement = rec.predeclaredAt == null;
  return (
    // R14a - the stable per-record anchor so the /activity stream and the
    // "We got this wrong" recap can deep-link straight to this card.
    <Card padding="md" id={`proof-${rec.id}`} className={band === "win" ? "beacon-win-glow" : undefined}>
      {/* FP8 - ONE scannable summary line per card: the page, what changed, the
          verdict-or-maturity word, and the single most important number. The full
          chip grid (evidence, caveats, math, comparison detail, actions) moves
          behind "Show the full read" below - all still reachable, none shouting.
          Item C2's six-word badge and Move 2's maturity-tone rule are unchanged:
          the Pill intent comes from pres.tone, so red/green still never appear
          before a mature result. */}
      <div className="flex flex-wrap items-center gap-2">
        {(() => {
          const href = dossierHref(rec.path);
          return href ? (
            <Link href={href} className="text-sub font-semibold text-foreground underline underline-offset-2 hover:text-foreground/80">{rec.path}</Link>
          ) : (
            <span className="text-sub font-semibold text-foreground">{rec.path}</span>
          );
        })()}
        {/* Fail-closed calibration quarantine (2026-07-11): an uncalibrated won/lost
            renders as the neutral "No clear change" badge (never Helped/Did not
            help) with a neutral pill tone (never red/green), matching its In-flight
            band placement (splitLedgerLifecycle). A calibrated read is unchanged. */}
        <Pill intent={quarantined ? "neutral" : pres ? TONE_PILL_INTENT[pres.tone] : verdictPillIntent(rec.verdict, basis?.day ?? null)}>
          {quarantined ? "No clear change" : pres ? proofBadgeLabel(pres) : proofBadgeLabelFromVerdict(rec.verdict, basis?.day ?? null)}
        </Pill>
        {keyNumber ? (
          <span
            className={
              band === "win"
                ? "text-meta font-semibold text-status-success tabular-nums"
                : "text-meta text-muted-foreground tabular-nums"
            }
          >
            {keyNumber}
          </span>
        ) : null}
        <span className="text-meta text-muted-foreground">
          {plainAction(rec.actionType)} · shipped {rec.shippedAt.slice(0, 10)}
        </span>
      </div>

      {/* Review fix 1: the one approved honest sentence, exactly once per
          quarantined card, visible without expanding the full read. */}
      {quarantined ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">{UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE}</p>
      ) : null}
      {compound ? (
        <p className="mt-1.5 rounded-md bg-indigo-50/70 px-2.5 py-1.5 text-[11px] text-indigo-800">
          Measured as one {compound.changeCount}-change package: {compound.label}. This page-level result belongs to the combination; Beacon will not credit either edit alone.
        </p>
      ) : null}

      {/* Trust-audit fix (2026-07-18): the LIVE-CONTRADICTION line. When a row is
          latched verified_live but the latest crawl could not find the edit, this
          amber line renders on the card itself (not hidden behind the full read),
          so a stale green badge never stands alone. */}
      {liveContradiction ? (
        <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] font-medium text-amber-800">
          {liveContradiction}
        </p>
      ) : null}

      {/* Legacy-row honesty caveat (2026-07-18): rows shipped before the up-front
          measurement plan (no predeclaredAt) carry the older method's directional
          read - name it once near the verdict, verdict text itself unchanged. */}
      {legacyMeasurement ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">{LEGACY_MEASUREMENT_CAVEAT}</p>
      ) : null}

      <details className="mt-2">
      <summary className="cursor-pointer text-meta text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
        Show the full read
      </summary>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {pres && badgeMaturesOn ? (
          <span className="text-[10px] text-muted-foreground">{badgeMaturesOn}</span>
        ) : null}
        {/* One verdict-reliability grade (master plan N10): a single word for how
            much to trust this specific read, combining recrawl, window
            completeness, contamination, comparison quality, shock/seasonal
            overlap, and sample strength. The full reasons render inside "See the
            math" below - this chip is just the scan-it-in-one-glance summary. */}
        {grade ? (
          <span
            className={
              "rounded-full border px-1.5 py-0.5 text-[10px] font-medium " + GRADE_STYLE[grade.grade]
            }
            title={grade.sentence}
          >
            {grade.grade}
          </span>
        ) : null}
        {rec.verifiedLive ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            verified live
          </span>
        ) : verifyGaveUp ? (
          // W5 stop-ship F6: the DS-token Pill (waiting = soft amber), never raw
          // palette classes, so the honest "gave up" state stays on-system.
          <Pill intent="waiting" title={verifyGaveUp}>
            not verified
          </Pill>
        ) : null}
      </div>

      {/* Item 5 - the before/after evidence itself: daily clicks with the ship date
          marked (dot) and the after-period tinted. A verdict you can SEE. When the change
          is newer than the last finalized Search day, say so instead of promising a dot. */}
      {spark && spark.length >= 5 ? (() => {
        const shipDay = rec.shippedAt.slice(0, 10);
        const lastDataDay = spark[spark.length - 1]!.date;
        const markerVisible = lastDataDay >= shipDay;
        // Item 70 - the chart is the centerpiece on a settled row (win/learning),
        // so it renders slightly larger there; numbers are supporting cast.
        const settled = band === "win" || band === "learning";
        // R14b (named controls) - the comparison pages ride the SAME chart as
        // dashed lines, named in the legend below, so "beat its comparison
        // pages" is something you can see, not a phrase you must trust.
        const namedControls = (controlSparks ?? []).slice(0, 2);
        const legend = controlsLegendLine(namedControls.map((c) => c.path));
        return (
          <div className="mt-1.5">
            <div className="flex items-center gap-2">
              <Sparkline
                points={spark}
                markerDate={shipDay}
                width={settled ? 240 : 200}
                height={settled ? 40 : 34}
                comparisons={namedControls.map((c) => ({ points: c.points }))}
              />
              <span className="text-[10px] text-muted-foreground">
                {markerVisible
                  ? `daily clicks, ${spark.length} days · dot = when this shipped, tinted = after`
                  : `daily clicks through ${lastDataDay} · this change is newer than the latest Search data (Google reports a few days behind)`}
              </span>
            </div>
            {legend && namedControls.length > 0 ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {legend} They are the dashed lines.
              </p>
            ) : null}
          </div>
        );
      })() : null}

      {/* Source move (Phase 4 - deterministic ActionPack↔proof linker, no migration).
          Closes the loop visibly: this shipped change traces back to the Move that
          recommended it. Item C8 - a card with no link sits in the "Changes you
          made yourself" group above (the group header already says this is a
          manual change), so it no longer repeats a disclaimer on every card. */}
      {link && link.actionPack ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 ring-1 ring-indigo-100">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {LINK_LABEL[link.confidence]}: {link.actionPack.label}
          </span>
          {link.actionPack.evidenceSources.map((s) => (
            <span key={s} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
              {SOURCE_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      ) : null}

      {/* R14b (spend-to-outcome) - what preparing this change cost in paid checks,
          from the linked move's own cached live-Google verdict spend. Absent at $0:
          a free change never grows a cost line. */}
      {(() => {
        const spend = prepSpendLine(link?.actionPack?.dataforseoValidation?.costUsd);
        return spend ? <p className="mt-1 text-[11px] text-muted-foreground">{spend}</p> : null;
      })()}

      {/* Item 71 - a win leads with the number: the lift, the page, the date. */}
      {band === "win" && basis ? (
        <p className="mt-1.5 text-[14px] font-semibold text-emerald-700">
          {`${formatWindowLift(metric, basis)} on ${rec.path} since ${rec.shippedAt.slice(0, 10)}`}
        </p>
      ) : null}

      {/* Distinct-query growth (P4 R10b, v1 151): name WHICH KIND of win this
          is - reach (more distinct searches ranking) or depth (the same
          searches clicking more). Win rows only; the raw before/after counts
          live in "See the math" for every row. */}
      {band === "win" && rec.queryBreadth?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.queryBreadth.sentence}</p>
      ) : null}

      {/* Many-measurements caution (P4 R10b, v1 291): this win cleared its own
          bar but sits too close to the line where one of many simultaneous
          measurements looks good by chance - hold the champagne. */}
      {rec.fdrRead?.sentence ? (
        <p className="mt-1 text-[12px] text-amber-700">{rec.fdrRead.sentence}</p>
      ) : null}

      {/* Item 72 - a settled non-win reads as a lesson: what we tried, what it did
          not move, and that the next pick on pages like this uses a different lever. */}
      {band === "learning" ? (
        <p className="mt-1.5 text-[12px] text-foreground/80">
          {`A ${plainAction(rec.actionType)} on this page did not move ${PLAIN_METRIC[metric]} in the full window. The team now tries a different lever on pages like this.`}
        </p>
      ) : null}

      {/* Equivalence read (P4 R10b, v1 289): the plausible effect range is
          proven too small to matter - "genuinely did nothing" is a reliable
          lesson, which is different from not knowing. Never renders on a win
          (the read is only computed for non-wins). */}
      {rec.equivalence?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.equivalence.sentence}</p>
      ) : null}

      {/* Item C4 - the PRIMARY line is a short plain call ("This probably hurt." /
          "This helped."), never the percent-sure statistics headline. The full
          sentence (with the percent and the click range) is one click away in
          "See the math" below - the honest numbers are not gone, just not shouting. */}
      <p className="mt-1.5 text-[12px] text-foreground/80">
        <span className="font-medium text-foreground/60">Search:</span> {plainHeadline}
      </p>

      {/* Item C3 - when the Search read and the site-visits read below disagree in
          direction, say so plainly instead of leaving two contradicting lines on
          the card with no reconciliation between them. */}
      {trafficDisagrees ? (
        <p className="mt-1 text-[12px] text-amber-700">{reconciliationSentence()}</p>
      ) : null}

      {/* R14a - the append-only verdict revision trail: when a later read changed an
          earlier call on THIS record, say so on the card instead of silently
          rewriting history ("I first called this a win; the 28-day read on
          2026-07-19 revised it to no clear effect."). Absent on the vast majority
          of rows - a verdict that never flipped renders nothing here. */}
      {rec.verdictRevisions && rec.verdictRevisions.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {buildVerdictRevisionLines(rec.verdictRevisions).map((line) => (
            <p key={line} className="text-[12px] text-foreground/80">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* Fixed query panel (P4 R10a, v1 150): the exact searches this change
          aimed at, measured as one panel, disagree in direction with the
          page-level read above - say so plainly instead of leaving the two
          numbers to quietly contradict each other. The always-available panel
          totals live in "See the math" below. */}
      {rec.panelOutcome?.sentence ? (
        <p className="mt-1 text-[12px] text-amber-700">{rec.panelOutcome.sentence}</p>
      ) : null}

      {/* Adaptive-window read (P4 R10a, v1 288): the movement is already
          unmistakable (or already clearly meaningless) before the full window.
          Presentation only - the 7/14/28 clock and the final verdict are
          untouched, and the sentence itself says the clock keeps running. */}
      {rec.earlySignal?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.earlySignal.sentence}</p>
      ) : null}

      {/* Novelty-decay flag (P4 R10a, v1 378): the first-week jump faded back
          toward baseline by week 4 - an honest caution so a novelty spike is
          never quietly read as a lasting win. */}
      {rec.noveltyDecay?.sentence ? (
        <p className="mt-1 text-[12px] text-amber-700">{rec.noveltyDecay.sentence}</p>
      ) : null}

      {/* Day-of-week baselines (P4 R10a, v1 285): when the weekday-aligned
          number and the raw day-sum number differ by more than 20 percent,
          lead with the aligned one and name why in one sentence. */}
      {rec.weekdayAdjustedLift?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.weekdayAdjustedLift.sentence}</p>
      ) : null}

      {/* Item C5 - the untouched-pages comparison used to lead with the raw "Out of
          60, 60 moved as much" trap sentence, which reads like proof when it is
          actually the honest opposite (normal noise, not evidence). The plain line
          says that outright; the raw counts move into "See the math" below. */}
      {rec.permutationRead && rec.permutationRead.nTotal > 0 ? (
        <p className="mt-1 text-[12px] text-foreground/80">
          {rec.permutationRead.nGreater / rec.permutationRead.nTotal <= 0.05
            ? `Pages I did not touch rarely moved this much on their own, so this is a real signal.`
            : `Pages I did not touch moved this much on their own, so this is normal noise, not proof yet.`}
        </p>
      ) : null}

      {/* Item C4/C5 - "See the math": the exact percent-sure figure, click range,
          and untouched-page counts, one click away from the plain primary lines
          above. Nothing here is new data - it is the same sentence/counts the
          product already computed, just moved out of the headline position. */}
      {sentence !== plainHeadline || (rec.permutationRead && rec.permutationRead.nTotal > 0) || pres?.seasonalInflectionCaveat || pres?.controlContaminationCaveat || pres?.controlPoolHealthLine || rec.panelOutcome || rec.queryBreadth || grade ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
            See the math
          </summary>
          <div className="mt-1 space-y-1 rounded-md border border-border/40 bg-surface-inset/30 p-2 text-[11px] text-foreground/70">
            {/* One verdict-reliability grade (master plan N10): the one-sentence
                summary of how much to trust this read, first in the list since
                it frames everything else in this panel. */}
            {grade ? <p className="font-medium text-foreground/80">{grade.sentence}</p> : null}
            <p>{sentence}</p>
            {rec.permutationRead && rec.permutationRead.nTotal > 0 ? (
              <p>{permutationSentenceFromCounts(rec.permutationRead.nGreater, rec.permutationRead.nTotal)}</p>
            ) : null}
            {/* Fixed query panel (P4 R10a, v1 150): the frozen target-query
                panel's own before/after totals, always available here even
                when it agrees with the page-level read. */}
            {rec.panelOutcome ? <p>{rec.panelOutcome.panelLine}</p> : null}
            {/* Distinct-query growth (P4 R10b, v1 151): the raw before/after
                distinct-search counts behind the reach/depth call, always
                available here even when the headline stayed quiet. */}
            {rec.queryBreadth ? <p>{rec.queryBreadth.breadthLine}</p> : null}
            {pres?.seasonalInflectionCaveat ? <p>{pres.seasonalInflectionCaveat}</p> : null}
            {/* Control-contamination guard (master plan N13): the full receipt -
                which comparison page changed, when, and whether a clean
                substitute was swapped in. The short caution line already shows
                on the card itself below; this is the detailed "why". */}
            {pres?.controlContaminationCaveat ? <p>{pres.controlContaminationCaveat}</p> : null}
            {/* Sustainable control pool (master plan N16): how healthy this open
                measurement's comparison pool still is, including the spare bench
                from the pre-ship list. Self-hiding once the measurement settles. */}
            {pres?.controlPoolHealthLine ? <p>{pres.controlPoolHealthLine}</p> : null}
          </div>
        </details>
      ) : null}

      {/* Target-query read (master plan item 68): the page-level verdict above can
          be diluted by a page's whole query mix; this names the EXACT search the
          change aimed at, straight from gsc_daily_rows, honestly silent when the
          data is missing or thin (< 50 impressions either window). */}
      {rec.targetQueryRead && rec.targetQueryRead.length > 0
        ? rec.targetQueryRead
            .filter((tq) => tq.sentence)
            .slice(0, 2)
            .map((tq) => (
              <p key={tq.query} className="mt-1 text-[12px] text-foreground/80">
                {tq.sentence}
              </p>
            ))
        : null}

      {/* Recrawl-gated SEARCH clock (master plan N11): Google's index does not
          show the new version of this page yet, so the SEARCH clock has not
          started. Names the split honestly - the GA4 traffic line above/below
          keeps its live_at clock and keeps reading. Same visible-caveat seam
          as the weather guard directly below. */}
      {pres?.recrawlPendingCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.recrawlPendingCaveat}</p>
      ) : null}

      {/* Algorithm-weather guard (master plan item 32): this row's measurement window
          overlapped a confirmed Google update or a sitewide shift I detected, so I am
          flagging the read as cautious instead of quietly treating it as clean evidence. */}
      {pres?.weatherCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.weatherCaveat}</p>
      ) : null}

      {/* N32 (R21b, external-event ledger): this row's measurement window overlapped a recorded
          connector outage or a many-edits-in-one-day cluster, so the read carries an honest caveat.
          DEDUPE: eventCaveatForWindow returns the SAME weather sentence when the window overlaps a
          shock, so we render this line ONLY when it differs from the weather caveat already shown
          above - a shock never prints twice. Self-hides when the ledger is empty (eventCaveat null). */}
      {shouldRenderEventCaveat(eventCaveat, pres?.weatherCaveat) ? (
        <p className="mt-1 text-[12px] text-amber-700">{eventCaveat}</p>
      ) : null}

      {/* Clean-window salvage (P4 R10b, v1 152): the caveat above stays named,
          but when 10 or more clean days exist outside the shock this reads the
          change on those days alone, so a partially-muddied window is salvaged
          instead of written off wholesale. Verdict untouched. */}
      {pres?.weatherCaveat && rec.cleanWindowLift?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.cleanWindowLift.sentence}</p>
      ) : null}

      {/* Parallel-trends veto (master plan item 33): this row's comparison pages
          were not moving like this page before the change, so I am flagging the
          read as cautious the same way an algorithm-weather overlap is flagged above. */}
      {pres?.weakComparisonCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.weakComparisonCaveat}</p>
      ) : null}

      {/* Control-contamination guard (master plan N13): a comparison page changed
          mid-measurement (I treated it myself, or its content edited between
          scans). When a clean substitute was found this names the swap; when
          none existed this is the honest caution line. The full receipt with
          dates lives in "See the math" above. */}
      {pres?.controlContaminationCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.controlContaminationCaveat}</p>
      ) : null}

      {/* Item C7 - the seasonal-overlap caveat used to repeat its full paragraph on
          every affected card (the section-level line above already says it once
          for the whole page). Each card just gets a small chip; the full sentence
          still lives in "See the math" so it is one click away, not gone. */}
      {pres?.seasonalInflectionCaveat ? (
        <span
          className="mt-1 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
          title={pres.seasonalInflectionCaveat}
        >
          seasonal swing overlaps
        </span>
      ) : null}

      {/* Dollar-ROI proof (gap #1): the GA4 traffic + conversion outcome next to
          the Search verdict. Revenue is honestly absent for this property, so the
          label never implies money (see the header note). */}
      {rec.trafficOutcome ? (() => {
        const t = rec.trafficOutcome!;
        const searchSettled = mature; // only a 28-day mature result is "settled"
        // "−93% on 1 baseline visit" must not read like a verdict - caution on thin volume.
        const lowVolume = t.ran && t.treated.sessionsPre > 0 && t.treated.sessionsPre < 5;
        return (
          <div className="mt-1 space-y-0.5">
            <p className="text-[12px] text-foreground/80">
              {!searchSettled ? (
                <span className="font-medium text-sky-700">Early directional traffic (not the Search verdict yet): </span>
              ) : null}
              {t.label}
            </p>
            {lowVolume ? (
              <p className="text-[11px] text-amber-700">
                Low volume, only {t.treated.sessionsPre} prior visit{t.treated.sessionsPre === 1 ? "" : "s"}, so the
                percent change is not reliable yet.
              </p>
            ) : null}
          </div>
        );
      })() : null}

      {/* Behavior lane (N4 + N17, 2026-07-03) - how visitors behaved since the
          change, grouped right after the traffic line it extends: engagement,
          frustrated clicks, bounce-backs, and whether people appear to find
          what they came for. Runs on the live_at clock like the traffic line
          above (never gated on Google recrawl). Self-hiding when every metric
          sits below its sample floor - no verdict from 12 sessions, ever.
          Corroboration only: the Search verdict above is never moved by this
          block (N10 may hold a win at decent when behavior worsened; the
          grade sentence in "See the math" names that reason). */}
      {behaviorHasContent(rec.behaviorOutcome) ? (() => {
        const b = rec.behaviorOutcome!;
        return (
          <div className="mt-1.5 space-y-0.5 rounded-md border border-border/40 bg-surface-inset/30 p-2">
            <p className="text-[11px] font-medium text-foreground/60">How visitors behaved</p>
            {b.sentence ? <p className="text-[12px] text-foreground/80">{b.sentence}</p> : null}
            {b.taskCompletionLine ? (
              <p className="text-[12px] text-foreground/80">{b.taskCompletionLine}</p>
            ) : null}
            {b.answerDeltaLine ? (
              <p className="text-[12px] text-foreground/80">{b.answerDeltaLine}</p>
            ) : null}
            <ReceiptLine
              line={buildReceiptLine({
                source: "your site analytics and Clarity behavior data",
                through: b.dataThrough,
                nowMs: serverNowMs(),
              })}
            />
          </div>
        );
      })() : null}

      {/* Dollar attribution for THIS change (item 22): only on a mature Win, only
          when the operator has a revenue model set and the lift is positive - a
          measuring row never shows a projected dollar figure, and a rate-less
          tenant never sees a number it can't back with real settings. The
          sentence itself always names the basis (your rate x the extra visitors
          this change earned), never "measured".
          operator spec 2026-07-09 E-38: also gated on real GA4 revenue being
          connected (trafficOutcome.hasRevenue) - until that is wired for this
          tenant, a rate-based dollar figure reads like proof it isn't yet. */}
      {shouldShowChangeDollarLine({ band, dollarValue: rec.dollarValue, hasRevenue: rec.trafficOutcome?.hasRevenue }) ? (
        <p className="mt-1 text-[13px] font-semibold text-emerald-700">{rec.dollarValue!.basisSentence}</p>
      ) : null}

      {/* AI-citation lane (item 5): one line when AI answers moved on a change
          built to win them, silence when there is nothing solid to say. */}
      {(() => {
        const aiLine = citationLineFor(rec.citationOutcome);
        return aiLine ? (
          <p className="mt-1 text-[12px] text-foreground/80">
            <span className="font-medium text-foreground/60">AI answers:</span> {aiLine}
          </p>
        ) : null;
      })()}

      {/* BEACON 500 item 71: "AI quoted this line" - the literal words the citing
          answer shares with our own page, once we know AI actually cited it post-ship.
          Silent when the page was never cited or there's no usable overlap. W2-B: the
          alignment is resolved once on the page (batched, READ-ONLY on the GET) and
          passed in, so this is now a pure sync component - no per-card read or write. */}
      <AiQuotedReceipt alignment={ownedAlignment ?? null} />

      {/* Live-SERP rank re-check (item 19): the literal Google position at ship
          vs the freshest read, for whichever window last came due. Silence when
          there is nothing honest to say (no target query, no re-check has fired
          yet, or the page fell out of the tracked results). This is the strongest
          single trust line the product can produce, so it gets its own row. */}
      {rec.rankOutcome?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">
          <span className="font-medium text-foreground/60">Google rank:</span> {rec.rankOutcome.sentence}
        </p>
      ) : null}

      {/* What actually changed (before → after). */}
      {rec.before || rec.after ? (
        <div className="mt-2.5 space-y-1.5 rounded-md border border-border/40 bg-surface-inset/30 p-2.5">
          {rec.before ? (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/70">Before:</span> {rec.before}
            </p>
          ) : null}
          {rec.after ? (
            rec.after.trim().startsWith("{") || rec.after.includes('"@context"') ? (
              <div className="text-[11px] text-foreground/85">
                <span className="font-medium text-foreground/70">What changed:</span>{" "}
                Added structured data that helps Google and AI understand this page.
                <details className="mt-1">
                  <summary className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                    View technical code
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-inset/50 p-2 text-[10px] leading-snug text-muted-foreground">
                    {rec.after}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-[11px] text-foreground/85">
                <span className="font-medium text-foreground/70">After:</span> {rec.after}
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {/* Target queries we expect this to move. */}
      {rec.targetQueries.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Target queries
          </span>
          {rec.targetQueries.slice(0, 6).map((q) => (
            <span
              key={q}
              className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] text-foreground/70"
            >
              {q}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Before the change (28 days prior): {metricsLine(rec)}
      </p>

      {/* Per-window diff-in-diff vs controls, with the check-in dates. */}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {rec.windows.map((w) => (
          <span
            key={w.day}
            className={w.ran ? "text-foreground/80" : "text-muted-foreground/60"}
          >
            <span className="font-medium">{w.day}d</span>{" "}
            {w.ran ? (
              <>
                lift {formatWindowLift(metric, w)} ({w.controlsUsed} comparison page
                {w.controlsUsed === 1 ? "" : "s"})
              </>
            ) : (
              <>opens {w.checkOn}</>
            )}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {`Compared against ${controlsCount} similar page${controlsCount === 1 ? "" : "s"} you did not change on the same site.`}{" "}
        A strong directional read, not a lab-perfect test.
      </p>

      {rec.notes ? (
        <p className="mt-2 text-[11px] text-foreground/70">
          <span className="font-medium text-foreground/60">Notes:</span> {rec.notes}
        </p>
      ) : null}

      {/* Operator: mark a manual Search Console recrawl request (speeds re-indexing). */}
      <div className="mt-2.5">
        <RecrawlButton recordId={rec.id} requestedAt={rec.recrawlRequestedAt} />
      </div>

      {/* Operator: exclude a MATURE (settled) result from learning so a mis-attributed
          win/loss stops skewing future ranking. Early/interim reads don't train, so the
          control only appears once a result is mature (or already excluded). */}
      {mature || rec.operatorVerdictOverride === "inconclusive" ? (
        <div className="mt-1.5">
          <ExcludeFromLearningButton
            recordId={rec.id}
            excluded={rec.operatorVerdictOverride === "inconclusive"}
          />
        </div>
      ) : null}

      {/* Roll back by hand: publishing and reverting stay explicit and manual, so
          a row with saved before-copy offers the one-click copy of the old text
          for the operator to paste back into their CMS. */}
      {rec.before ? (
        <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5">
          <RollbackCopyButton before={rec.before} />
          <span className="text-[10px] text-muted-foreground">
            To roll back by hand, paste this into your CMS.
          </span>
        </div>
      ) : null}
      </details>
    </Card>
  );
}

/**
 * AiQuotedReceipt (BEACON 500 item 71) - "AI quoted this line." The literal shared
 * wording between a citing AI answer and the page's own body text, one compact line.
 * W2-B (2026-07-10): the alignment is now resolved ONCE for the whole ledger by the
 * batched, READ-ONLY getOwnedAnswerAlignmentsBatch on the page (persist deferred to
 * after()), so this is a pure synchronous component that just renders what it was
 * handed - no per-card DB read, no GET-path saveMoveDraft. Silent on a null
 * alignment (no citation gain, no cached answer excerpt, or no real overlap).
 */
function AiQuotedReceipt({ alignment }: { alignment: PersistedAnswerAlignment | null }) {
  const top = alignment?.passages[0];
  if (!top) return null;

  return (
    <p className="mt-1 rounded-md border border-border/40 bg-surface-inset/30 px-2.5 py-2 text-[12px] text-foreground/80">
      <span className="font-medium text-foreground/60">AI quoted this line: </span>
      &quot;{top.pageSentence}&quot;
      {alignment?.engine ? <span className="text-muted-foreground"> ({alignment.engine})</span> : null}
    </p>
  );
}
