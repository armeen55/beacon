import { getRepository } from "@/lib/persistence/repositories";
import type { CitationEvidenceIndex } from "./types";

const repo = getRepository();

export const citationEvidenceIndex: CitationEvidenceIndex | null =
  await repo.getCitationEvidenceIndex();
