export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { loadAskHistoryAction } from "./ask-actions";
import { loadSuggestedQuestions } from "@/domains/ask/suggested-questions";
import { AskChatClient } from "./ask-chat-client";

/**
 * /ask (BEACON_500 item 59) - ask-your-team chat. The operator types a plain question
 * ("why did clicks drop on the cheetah page") and the right specialist answers in first
 * person with real numbers pulled through the existing GSC/Profound/DataForSEO/proof
 * loaders, every claim linked to its source surface. Turns Beacon from a dashboard into
 * a team you can talk to.
 */
export default async function AskPage() {
  const [history, suggestedQuestions] = await Promise.all([
    loadAskHistoryAction().catch(() => []),
    loadSuggestedQuestions().catch(() => []),
  ]);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Ask your team" description="Ask anything about the site. I answer with real numbers and link every claim back to where it came from." />
      <AskChatClient initialHistory={history} suggestedQuestions={suggestedQuestions} />
    </div>
  );
}
