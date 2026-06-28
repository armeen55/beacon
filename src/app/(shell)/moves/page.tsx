import { redirect } from "next/navigation";

/** /moves → /worklist (2026-06-28 route consolidation). The canonical ActionPack
 *  worklist now lives at /worklist; this old route redirects so no link breaks. */
export default function MovesPage() {
  redirect("/worklist");
}
