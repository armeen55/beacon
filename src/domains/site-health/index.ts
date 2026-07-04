/**
 * site-health (BEACON_500 P16, 2026-07-03) - the onboarding-intelligence read
 * layer. Three generic, deterministic, empty-safe site-health facts Beacon can
 * state for ANY tenant from data it already has ($0):
 *   - detectAiCrawlerBlock : which AI assistants / Google's crawler are blocked.
 *   - detectJsShellFact    : a page whose content only appears after JavaScript.
 *   - detectCms            : the CMS / platform, as a capability fact.
 *
 * PURE / no I/O. Barrel re-exports only.
 */

export * from "./types";
export { detectAiCrawlerBlock } from "./ai-crawler-block";
export { detectJsShellFact } from "./js-shell-fact";
export { detectCms, type CmsDetectInput } from "./cms-detect";
