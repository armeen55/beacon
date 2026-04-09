import "server-only";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PersistedBriefState } from "./types";

const repo = getRepository();

export const briefStates: PersistedBriefState[] = await repo.getBriefStates();

export async function persistBriefStates(): Promise<void> {
  await writeStore("brief-states", briefStates);
}
