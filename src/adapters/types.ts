import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { Change } from "@/domains/changes/types";

export type AdapterImportResult = {
  tracked_prompts: TrackedPrompt[];
  tracked_entities: TrackedEntity[];
  observation_runs: ProfoundImportRun[];
  prompt_answers: PromptAnswerObservation[];
  citations: CitationObservation[];
  changes: Change[];
  warnings: string[];
};

export interface ImportAdapter {
  name: string;
  accepts: (file: File) => boolean;
  parse: (buffer: ArrayBuffer, accountId: string, batchId: string) => AdapterImportResult;
}
