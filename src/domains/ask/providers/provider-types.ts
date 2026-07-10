import "server-only";

/**
 * ask/providers/provider-types (W9 slice 1, 2026-07-09) - the shape every fact provider
 * implements. A provider is a thin, tenant-scoped adapter over ONE (or a few) EXISTING
 * durable loaders that already power fact-assembly.ts - never a new query path. The
 * registry (registry.ts) dispatches to every provider registered for a routed question's
 * class and merges their facts; Slice 1 wires exactly one class through that path end to
 * end (site_trend), and the rest exist wrapped and pinned for behavior parity, ready for
 * a future multi-provider planner (Slice 2 - not built here) to route more traffic
 * through them without a rewrite.
 *
 * Locked operator decisions this type encodes:
 *   - own-tenant only: `gather` takes an explicit tenantId, never an ambient global read.
 *   - cached/durable data only: no provider may make a paid lookup or a live connector
 *     call (enforced structurally by providers/denylist.test.ts, not just by convention).
 *   - honest liveness: `prodLive` says whether the underlying source is REAL hosted
 *     (Supabase) data in production, not a file-only local store Ask must never claim
 *     is available on hosted prod.
 */

import type { AskQuestionClass, RoutedQuestion } from "../router";
import type { AskFact } from "../types";


export type AskFactProvider = {
  /** Stable id, e.g. "gsc-daily-totals". Surfaces in AskFact.providerId and in tests -
   *  part of the provenance contract, so it is never renamed casually. */
  id: string;
  /** Which question classes this provider can answer. */
  classes: AskQuestionClass[];
  /** True when the underlying loader reads real hosted (Supabase) data in production;
   *  false for anything that only works locally against a file-only `.data/*.json`
   *  store with no Supabase mirror. */
  prodLive: boolean;
  /** Tenant-scoped fact gather for one routed question. Must thread tenantId through to
   *  every read - never fall back to an ambient/global read that could leak another
   *  tenant's data. Should never throw to the registry (the registry also catches per
   *  provider as defense-in-depth, but a well-behaved provider fails soft itself). */
  gather(tenantId: string, question: RoutedQuestion): Promise<AskFact[]>;
};
