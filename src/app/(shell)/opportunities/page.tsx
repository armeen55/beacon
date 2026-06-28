import { redirect } from "next/navigation";

/** /opportunities → /worklist (2026-06-28 route consolidation). The old fused
 *  opportunity map is superseded by the canonical ActionPack worklist. */
export default function OpportunitiesPage() {
  redirect("/worklist");
}
