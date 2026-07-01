import { redirect } from "next/navigation";

/** /results - alias so the URL matches the nav label "Results" (item 100). */
export default function ResultsAlias() {
  redirect("/proof");
}
