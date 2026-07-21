import { redirect } from "next/navigation";

/**
 * /ai-questions - retired-surface stub. The standalone AI-questions/prompts
 * surface was removed in the surface-collapse campaign (2026-07-21); its
 * intelligence now feeds the canonical Changes queue. Any lingering link or
 * bookmark forwards to /changes so the operator lands on live work.
 */
export default function AiQuestionsAlias() {
  redirect("/changes");
}
