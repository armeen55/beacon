import { redirect } from "next/navigation";

/** /ai-questions - alias so the URL matches the nav label "AI questions" (item 100). */
export default function AiQuestionsAlias() {
  redirect("/prompts");
}
