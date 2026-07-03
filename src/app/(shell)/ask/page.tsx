export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { loadAskHistoryAction } from "./ask-actions";
import { loadSuggestedQuestions } from "@/domains/ask/suggested-questions";
import { AskChatClient } from "./ask-chat-client";
import { valueWithDeadline } from "@/lib/load-with-deadline";

/**
 * /ask (BEACON_500 item 59) - ask-your-team chat. The operator types a plain question
 * ("why did clicks drop on the cheetah page") and the right specialist answers in first
 * person with real numbers pulled through the existing GSC/Profound/DataForSEO/proof
 * loaders, every claim linked to its source surface. Turns Beacon from a dashboard into
 * a team you can talk to.
 */
// W2-A (2026-07-02) - FP1 always-paint floor: the chat box itself is a client component
// and needs nothing from Supabase to render; history and suggested questions are
// enhancements with natural empty defaults. Deadline-bounded so one wedged read (each
// 522 is ~30s) can never hold the whole page stream open; the rejection paths keep
// their existing catch fallbacks.
const ASK_SIDE_DEADLINE_MS = 15_000;

export default async function AskPage() {
  const [history, suggestedQuestions] = await Promise.all([
    valueWithDeadline(loadAskHistoryAction().catch(() => []), [], ASK_SIDE_DEADLINE_MS),
    valueWithDeadline(loadSuggestedQuestions().catch(() => []), [], ASK_SIDE_DEADLINE_MS),
  ]);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Ask your team" description="Ask anything about the site. I answer with real numbers and link every claim back to where it came from." />
      <AskChatClient initialHistory={history} suggestedQuestions={suggestedQuestions} />
    </div>
  );
}
