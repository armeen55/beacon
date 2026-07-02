"use server";

/**
 * answer-alignment-actions (BEACON 500 item 71) - the CLIENT-callable server
 * action wrapper around ./answer-alignment-store.ts. A Next.js "use server" module
 * may only export async functions, so this file stays a thin shim: it resolves the
 * current tenant itself (a client component must never be trusted to supply its
 * own tenantId) and forwards to the real implementation.
 *
 * The worklist Move card (today-moves-card.tsx, a client component) calls
 * `getCompetitorAnswerAlignmentForClient` to lazily fetch "the words that beat
 * you" once per card render. Server components (the /proof ledger card) already
 * hold a server-resolved tenantId and can import answer-alignment-store.ts
 * directly instead of going through this file.
 */

import { currentTenantId } from "@/lib/tenant-context";
import {
  getCompetitorAnswerAlignment,
  type PersistedAnswerAlignment,
} from "./answer-alignment-store";

export type { PersistedAnswerAlignment } from "./answer-alignment-store";

/**
 * Client-safe competitor alignment lookup for one Move card: "the words that beat
 * you." Resolves the tenant server-side, then delegates to the real (cached,
 * fail-soft, deterministic) implementation. Never throws.
 */
export async function getCompetitorAnswerAlignmentForClient(
  recId: string,
  competitorDomain: string,
  topic: string,
): Promise<PersistedAnswerAlignment | null> {
  const tenantId = await currentTenantId();
  return getCompetitorAnswerAlignment(tenantId, recId, competitorDomain, topic);
}
