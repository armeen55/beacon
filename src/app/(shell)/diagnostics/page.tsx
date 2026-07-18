import { redirect } from "next/navigation";

/**
 * The diagnostics index is not a customer workflow. Historical operator tools
 * remain on their explicit deep routes, while an old link to the index returns
 * the user to Beacon's autonomous Today surface immediately.
 */
export const dynamic = "force-dynamic";

export default function DiagnosticsPage(): never {
  redirect("/");
}
