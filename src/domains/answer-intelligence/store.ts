import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import type { AnswerIntelligenceIndex } from "./types";

const repo = getRepository();

/**
 * Module-level load of the answer intelligence index.
 * Null if the index hasn't been built yet (pre-import state).
 */
export const answerIntelligenceIndex: AnswerIntelligenceIndex | null =
  await repo.getAnswerIntelligenceIndex();
