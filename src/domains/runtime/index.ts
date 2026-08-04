/**
 * Runtime kernel - public facade.
 *
 * Owns operational plumbing: the daily Research Run (scheduled + visit-resumed, durable
 * status), source refresh recording, the refresh-runs store, and free-surface
 * cache warming. This index is the ONLY surface `src/app` and `src/components`
 * may import for VALUE imports. Internal files stay private.
 */

// The Research Run, through its two doors: the global daily scheduler (the guarded /api/cron/scheduler
// endpoint calls runDueAccounts) and the visit, which recovers and resumes what the scheduler left.
export { ensureResearchRunOnVisit, continueResearch } from "./ops/on-visit-refresh";
export { researchRunStatus, researchStatusLine, type ResearchRunStatusView } from "./research-run";
export { runDueAccounts, type SchedulerReceipt } from "./ops/scheduler";

// The operator's own off switch for the daily run. Pausing research never suspends the account, and a
// resume never backfills the days that passed while it was off.
export { isResearchPaused, setResearchPaused } from "./ops/due-work";

// Source refresh recording
export { recordSourceRefresh } from "./ops/record-source-refresh";

// Refresh-runs store (connector-sync history)
export {
  listRecentRefreshRuns,
  latestRefreshBySource,
  type RefreshRunRow,
  type RefreshSource,
} from "./ops/refresh-runs-store";

// Cache warming (used by the connectors "Update data" action + the publish phase)
export { warmFreeSurfaces } from "./ops/warm-caches";

// The daily AI-answer plan: one canonical reading per question, per engine, per
// Pacific reporting day. "Update data" asks the extra-sample gate for a verdict.
export { requestExtraSample } from "./ops/daily-observations";

// Onboarding facade (Slice 5) - the seven-step /onboard flow's command surface.
export {
  loadOnboardingState,
  submitWebsite,
  inferProfile,
  saveProfileEdits,
  confirmProfile,
  proposeProfilePatch,
  applyConfirmedPatch,
  saveGoal,
  generatePromptCandidates,
  approvePrompts,
  activateAccount,
  setupGap,
  type OnboardingState,
  type OnboardingGoal,
  type ProfileEdits,
  type ProfilePatch,
  type PromptSelection,
  type OnboardingDeps,
  type OnboardingStore,
  type TrackedPromptRow,
} from "./onboarding";

// The tracked-question set (Settings + Today + the funnel read the SAME rules).
export {
  PROMPT_TAGS,
  LIMITS as PROMPT_LIMITS,
  projectTrackedQuestions,
  applyTrackedSelection,
  readTrackedQuestions,
  countTrackedQuestions,
  saveTrackedQuestions,
} from "./prompt-set";
