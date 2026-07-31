/**
 * Runtime kernel - public facade.
 *
 * Owns operational plumbing: the visit-driven Research Run (schedule + durable
 * status), source refresh recording, the refresh-runs store, and free-surface
 * cache warming. This index is the ONLY surface `src/app` and `src/components`
 * may import for VALUE imports. Internal files stay private.
 */

// Visit-driven Research Run - schedule on visit + the durable Today status.
export { ensureResearchRunOnVisit } from "./ops/on-visit-refresh";
export { researchRunStatus, researchStatusLine, type ResearchRunStatusView } from "./research-run";

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
// UTC day. The "Update data" action asks the extra-sample gate for a verdict.
export { requestExtraSample, utcReportingDay } from "./ops/daily-observations";

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
