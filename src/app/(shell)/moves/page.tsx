import { redirect } from "next/navigation";

/** /moves → /changes (2026-06-28 route consolidation). The canonical ActionPack
 *  worklist now lives at /changes; this old route redirects so no link breaks. */
export default function MovesPage() {
  redirect("/changes");
}
