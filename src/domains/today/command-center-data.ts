/**
 * command-center-data — UX.2 (2026-05-07).
 *
 * The Command Center feature (this resolver's brain/manifest readers,
 * `deriveBrainSummaryFromCounts`, and the `CommandCenter` presentation
 * component at `src/components/today/command-center.tsx`) was orphaned
 * by the 2026-06-28 deletion of `today-v2-sections.tsx` (the only host
 * that ever rendered it) and fully deleted 2026-07-02 (UX5 legacy sweep)
 * — zero production callers remained for any of it.
 *
 * `isOperatorMode` survives here: it is a live, actively-used export
 * (5 `/diagnostics/*` pages read it) unrelated to the dead Command
 * Center UI beyond sharing this file historically.
 */

import "server-only";
import { isOperatorModeServer } from "@/lib/operator-mode";

/**
 * Operator-mode flag — used to decide whether to render operator-only
 * links/sections across the app. Independently gated per-caller.
 */
export function isOperatorMode(): boolean {
  return isOperatorModeServer();
}
