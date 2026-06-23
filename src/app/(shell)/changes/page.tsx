import { redirect } from "next/navigation";

/**
 * /changes — IA consolidation (2026-06-23).
 *
 * The "what changed / is it measuring / did it work" timeline moved INTO the
 * single Results page (/proof) so the product has ONE place for results
 * instead of split Changes + Proof surfaces. The heavy compute that used to
 * live here is now `ResultsTimeline` (./results-timeline), embedded in
 * /proof. This index is a thin permanent redirect; the per-change detail
 * route (/changes/[id]) is unchanged and still reachable.
 */
export const dynamic = "force-dynamic";

export default function ChangesIndexRedirect() {
  redirect("/proof");
}
