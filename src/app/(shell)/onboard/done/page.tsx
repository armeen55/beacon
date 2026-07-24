/**
 * /onboard/done - compatibility redirect (Slice 5, 2026-07-24).
 *
 * The old URL-first scorecard lived here; the seven-step setup replaced it. Any
 * bookmarked or in-flight link to /onboard/done now lands on /onboard, which
 * resolves the current step from durable state.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OnboardDoneRedirect() {
  redirect("/onboard");
}
