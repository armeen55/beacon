import { readExitGates } from "@/lib/exit-gates-store";
import { ExitGatesSettingsHintClient } from "./exit-gates-settings-hint-client";

/**
 * T-CustomerNav (2026-05-08) — operator-only gate.
 *
 * Pre-patch: this hint rendered for any user whose exit-gates had
 * any non-`passed` status. The "Internal sign-off" link points at
 * `/settings/exit-gates` (a non-customer surface, hidden from
 * settings tabs since 2026-04-17). The gate was data-conditional,
 * not operator-conditional; once any gate gets touched, the hint
 * + link become visible to every visitor of /settings/* including
 * customer dogfeed sessions.
 *
 * Post-patch: the entire hint is gated behind `BEACON_OPERATOR_MODE`
 * (server-side; this file is a server component). When the flag
 * is off (default), the hint never renders regardless of gate
 * data state. Direct URL access to /settings/exit-gates still
 * works for operator use; that's intentional.
 *
 * Mirror's the gate posture used by /diagnostics/* routes
 * (BEACON_OPERATOR_MODE for server-side gates). NEXT_PUBLIC_OPERATOR_MODE
 * is the client-side debug-pill gate; both are still in use today
 * (intentional split — Next.js can't expose non-NEXT_PUBLIC_ env
 * vars to the client bundle, so debug surfaces that gate themselves
 * client-side need a different var). Unifying the two flags into
 * one is a separate cleanup, not part of this bundle.
 */
function isOperatorMode(): boolean {
  return process.env.BEACON_OPERATOR_MODE === "true";
}

export async function ExitGatesSettingsHint() {
  if (!isOperatorMode()) return null;
  const gates = await readExitGates();
  if (gates.every((g) => g.status === "passed")) return null;
  return <ExitGatesSettingsHintClient gates={gates} />;
}
