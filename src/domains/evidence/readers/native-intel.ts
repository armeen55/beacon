/**
 * native-intel - all that is left of the legacy projection reader: how to tell a raw
 * prompt_answer_observations row's RETRIEVAL MODE from its metadata. The report it used to build (recurring
 * domains and pages, the presence matrix, the questions inside answers) is gone, because it was a second and
 * weaker AI truth: it read a capped projection with no fan-outs and no analyses beside the canonical record
 * the account already paid for. The snapshot now derives all of that from ai_observations itself.
 *
 * PURE (no I/O, no server-only). One live consumer: product/url-citation-history.ts.
 */

import type { ObservationMode } from "@/domains/evidence/funnel/research-evidence";

