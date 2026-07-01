import { redirect } from "next/navigation";

/**
 * /connections - IA consolidation (2026-07-01, FINAL PREMIUM PLAN item 99).
 * Two nav entries pointed at two different "connect your data" surfaces; the product
 * now has ONE: /settings/connectors (connect + sync + status). Source freshness also
 * lives on Today's sources strip. Thin permanent redirect.
 */
export default function ConnectionsRedirect() {
  redirect("/settings/connectors");
}
