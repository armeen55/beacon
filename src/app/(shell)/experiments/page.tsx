import { redirect } from "next/navigation";

/**
 * Legacy "Ready to ship" list → the canonical Changes Ready view (2026-07-01, Move 5 /
 * Move 1 consolidation). This was a duplicate list of the prepared/ready moves the
 * canonical Changes list already shows (same MoveCard + Ship action on expand), so it now
 * redirects to /worklist?status=ready. No inbound links depended on this route.
 */
export default function ExperimentsRedirect() {
  redirect("/worklist?status=ready");
}
