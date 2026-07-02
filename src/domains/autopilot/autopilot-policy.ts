/**
 * Trust-budget autopilot policy (2026-07-01, BEACON 500 item 1).
 *
 * PURE decision layer. Given the operator's armed budget, the per-lever
 * verdict history from the proof ledger, and the changes that are ready to
 * ship, decide which changes ship automatically tonight - with a reason and
 * an operator-readable receipt line per pick. No I/O here; the runner
 * (run-autopilot.ts) gathers inputs and executes picks through the existing
 * push path (executePush keeps every structural rail: the Ritz hard-refuse,
 * the daily cap, the pre-push snapshot, the non-destructive merge).
 *
 * Policy in operator words: "I only ship change types that have already
 * proven themselves on this site - at least 10 measured results with 8 in 10
 * that did not hurt - never more than the weekly budget, everything
 * reversible, every change written down."
 *
 * Default is OFF. The operator arms it per site in settings.
 *
 * Pinned by tests/domains/autopilot/autopilot-policy.test.ts.
 */

/**
 * Kept aligned with RITZ_TENANT_ID in src/domains/push/push-service.ts
 * (duplicated as a plain string so this module stays pure and light).
 * Even if this constant drifted, executePush would still hard-refuse Ritz -
 * this check just refuses earlier with a clear reason.
 */
export const AUTOPILOT_RITZ_TENANT_ID = "tenant-ritz-founder";

export type AutopilotConfig = {
  /** Master switch. Default OFF - the operator arms it per site. */
  enabled: boolean;
  /** Max auto-shipped changes per rolling 7 days. Operator-settable. */
  weeklyCap: number;
  /** Minimum decided verdicts a lever needs before it is proven. */
  minVerdicts: number;
  /** Minimum share of decided verdicts that did not hurt (0..1). */
  minNonRegressionRate: number;
  /** Optional allowlist of lever action types. Null/empty = every proven lever. */
  leverAllowlist?: string[] | null;
};

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  enabled: false,
  weeklyCap: 3,
  minVerdicts: 10,
  minNonRegressionRate: 0.8,
  leverAllowlist: null,
};

/** Hard bounds so a bad write can never arm an unbounded budget. */
export const WEEKLY_CAP_MIN = 1;
export const WEEKLY_CAP_MAX = 10;

/** Clamp arbitrary persisted/user input into a safe, well-formed config. */
export function normalizeAutopilotConfig(
  raw: Partial<AutopilotConfig> | null | undefined,
): AutopilotConfig {
  const d = DEFAULT_AUTOPILOT_CONFIG;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const weeklyCap = Math.min(
    WEEKLY_CAP_MAX,
    Math.max(WEEKLY_CAP_MIN, Math.round(num(raw?.weeklyCap, d.weeklyCap))),
  );
  const minVerdicts = Math.max(1, Math.round(num(raw?.minVerdicts, d.minVerdicts)));
  const minNonRegressionRate = Math.min(
    1,
    Math.max(0, num(raw?.minNonRegressionRate, d.minNonRegressionRate)),
  );
  const allow = Array.isArray(raw?.leverAllowlist)
    ? raw!.leverAllowlist!.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : null;
  return {
    enabled: raw?.enabled === true,
    weeklyCap,
    minVerdicts,
    minNonRegressionRate,
    leverAllowlist: allow && allow.length > 0 ? allow : null,
  };
}

// ---------------------------------------------------------------------------
// Per-lever verdict history (computed from proof-ledger records)
// ---------------------------------------------------------------------------

/** The minimal slice of a proof-ledger record the policy needs. */
export type LeverVerdictInput = {
  actionType: string;
  /** Persisted proof verdict: measuring | won | lost | inconclusive | insufficient_data. */
  verdict: string;
};

export type LeverRecord = {
  actionType: string;
  /** Verdicts that settled to won / lost / inconclusive. */
  decided: number;
  /** Decided verdicts that did not hurt: won or inconclusive. */
  nonRegression: number;
};

const DECIDED_VERDICTS = new Set(["won", "lost", "inconclusive"]);
const NON_REGRESSION_VERDICTS = new Set(["won", "inconclusive"]);

/**
 * Fold proof-ledger records into one record per lever (action type).
 * "Decided" excludes measuring and insufficient_data - a lever earns trust
 * only from verdicts that actually settled.
 */
export function computeLeverRecords(records: LeverVerdictInput[]): LeverRecord[] {
  const byLever = new Map<string, LeverRecord>();
  for (const r of records) {
    const actionType = (r.actionType ?? "").trim();
    if (actionType === "") continue;
    if (!DECIDED_VERDICTS.has(r.verdict)) continue;
    const rec = byLever.get(actionType) ?? { actionType, decided: 0, nonRegression: 0 };
    rec.decided += 1;
    if (NON_REGRESSION_VERDICTS.has(r.verdict)) rec.nonRegression += 1;
    byLever.set(actionType, rec);
  }
  return [...byLever.values()].sort((a, b) => b.decided - a.decided);
}

/** Is this lever proven under the config's thresholds? */
export function leverIsProven(record: LeverRecord | undefined, config: AutopilotConfig): boolean {
  if (record == null) return false;
  if (record.decided < config.minVerdicts) return false;
  return record.nonRegression / record.decided >= config.minNonRegressionRate;
}

// ---------------------------------------------------------------------------
// Plain-language lever labels (operator-facing copy - no code words)
// ---------------------------------------------------------------------------

const LEVER_LABELS: Record<string, string> = {
  edit_title: "Page title updates",
  edit_meta: "Search description updates",
  improve_meta: "Search description rewrites",
  change_h1: "Main headline updates",
  add_h2_section: "New page sections",
  rewrite_h2: "Section headline rewrites",
  add_faq: "FAQ additions",
  rewrite_faq: "FAQ rewrites",
  add_table: "Comparison table additions",
  edit_table_row: "Table updates",
  add_answer_block: "Direct answer sections",
  add_proof_section: "Proof sections",
  add_comparison_section: "Comparison sections",
  add_cost_section: "Cost sections",
  add_timeline_section: "Timeline sections",
  add_internal_link: "Internal link additions",
  add_schema: "Structured data additions",
  fix_schema: "Structured data fixes",
  update_intro: "Intro rewrites",
  improve_copy: "Copy improvements",
};

/** Operator-readable name for a lever. Falls back to a de-coded phrase. */
export function leverLabel(actionType: string): string {
  const label = LEVER_LABELS[actionType];
  if (label) return label;
  const words = actionType.replace(/[_-]+/g, " ").trim();
  return words === "" ? "Page changes" : words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// The nightly decision
// ---------------------------------------------------------------------------

/** One change that is ready to ship (already QA-approved and CMS-pushable). */
export type AutopilotCandidate = {
  /** The pushable edit's id (executePush ships this exact edit). */
  editId: string;
  /** Source recommendation stable key (for the acceptance record). Null for orphans. */
  recId: string | null;
  /** Absolute target page URL. */
  url: string;
  /** The lever (edit action_type, e.g. edit_title). */
  actionType: string;
  /** Operator-readable one-line title of the change. */
  title: string;
};

export type AutopilotPick = {
  candidate: AutopilotCandidate;
  /** Why this candidate qualified, with the concrete numbers. */
  reason: string;
  /** The visible receipt line written on the shipped-change record. */
  receiptLine: string;
};

export type AutopilotSkip = {
  candidate: AutopilotCandidate;
  reason: string;
};

export type AutopilotDecision = {
  /**
   * off      - the budget is not armed (config absent or disabled),
   * blocked  - armed but this tenant may never auto-publish (Ritz),
   * active   - the budget applies; see picks/skips.
   */
  mode: "off" | "blocked" | "active";
  picks: AutopilotPick[];
  skips: AutopilotSkip[];
  /** Auto-ship slots left this week after these picks. */
  remainingBudget: number;
};

export type AutopilotDecisionInput = {
  tenantId: string;
  config: AutopilotConfig | null | undefined;
  /** Per-lever settled history for THIS tenant (computeLeverRecords output). */
  leverRecords: LeverRecord[];
  /** How many changes autopilot already shipped in the last 7 days. */
  autoShippedThisWeek: number;
  /** Ready-to-ship changes, best first (the runner preserves queue rank). */
  candidates: AutopilotCandidate[];
};

function pct(nonRegression: number, decided: number): number {
  if (decided <= 0) return 0;
  return Math.round((nonRegression / decided) * 100);
}

/**
 * The pure nightly decision. Most-conservative-gate-wins, in order:
 * disarmed, Ritz, allowlist, proven-lever thresholds, one change per page
 * per night, then the weekly budget. Deterministic given its inputs.
 */
export function decideAutopilotShips(input: AutopilotDecisionInput): AutopilotDecision {
  const config = input.config == null ? null : normalizeAutopilotConfig(input.config);

  if (config == null || !config.enabled) {
    return { mode: "off", picks: [], skips: [], remainingBudget: 0 };
  }

  if (input.tenantId === AUTOPILOT_RITZ_TENANT_ID) {
    // Ritz is advise-only everywhere; executePush refuses it structurally too.
    return { mode: "blocked", picks: [], skips: [], remainingBudget: 0 };
  }

  const already = Math.max(0, Math.round(input.autoShippedThisWeek));
  let budget = Math.max(0, config.weeklyCap - already);

  const recordByLever = new Map(input.leverRecords.map((r) => [r.actionType, r]));
  const allow = config.leverAllowlist;
  const seenUrls = new Set<string>();

  const picks: AutopilotPick[] = [];
  const skips: AutopilotSkip[] = [];

  for (const candidate of input.candidates) {
    const label = leverLabel(candidate.actionType);
    const record = recordByLever.get(candidate.actionType);

    if (allow != null && !allow.includes(candidate.actionType)) {
      skips.push({
        candidate,
        reason: `${label} is not on your allowed list, so I left it for you.`,
      });
      continue;
    }

    if (record == null || record.decided < config.minVerdicts) {
      const decided = record?.decided ?? 0;
      skips.push({
        candidate,
        reason: `${label} is not proven here yet: ${decided} measured result${decided === 1 ? "" : "s"} so far, and I need ${config.minVerdicts} before I ship one on my own.`,
      });
      continue;
    }

    if (!leverIsProven(record, config)) {
      skips.push({
        candidate,
        reason: `${label} has ${record.decided} measured results but only ${record.nonRegression} did not hurt (${pct(record.nonRegression, record.decided)} percent). I need ${Math.round(config.minNonRegressionRate * 100)} percent before I ship one on my own.`,
      });
      continue;
    }

    const urlKey = candidate.url.trim().replace(/\/+$/, "").toLowerCase();
    if (seenUrls.has(urlKey)) {
      skips.push({
        candidate,
        reason: "I already picked a change for this page tonight, so I left this one for you.",
      });
      continue;
    }

    if (budget <= 0) {
      skips.push({
        candidate,
        reason: `Your weekly budget of ${config.weeklyCap} auto-shipped change${config.weeklyCap === 1 ? "" : "s"} is used up, so I left this for you.`,
      });
      continue;
    }

    budget -= 1;
    seenUrls.add(urlKey);
    const shipNumber = already + picks.length + 1;
    picks.push({
      candidate,
      reason: `${label} is a proven change type here: ${record.decided} measured results, ${record.nonRegression} of ${record.decided} did not hurt (${pct(record.nonRegression, record.decided)} percent). This is auto-shipped change ${shipNumber} of ${config.weeklyCap} this week.`,
      receiptLine: `I shipped this automatically under your proven-change budget. ${label} earned it: ${record.nonRegression} of ${record.decided} measured results here did not hurt. This change is reversible and I am measuring it now.`,
    });
  }

  return { mode: "active", picks, skips, remainingBudget: budget };
}
