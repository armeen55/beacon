import { redirect } from "next/navigation";

/**
 * /activity - retired (Phase 4B Lane 1, 2026-07-21). Its two customer-facing
 * value props (the latest per-source refresh receipt + a short recent-refresh
 * history) folded into /settings/connectors "Recent activity" section, sourced
 * from the same @/domains/ops/refresh-runs-store ledger (see ./settings/
 * connectors/recent-upkeep.tsx). The cron-run / error-ledger / spend rows this
 * page also rendered were operator-ops noise, never a customer-facing surface,
 * and were dropped rather than folded. Thin permanent redirect so no bookmark
 * or muscle-memory link breaks.
 */
export default function ActivityRedirect() {
  redirect("/settings/connectors");
}
