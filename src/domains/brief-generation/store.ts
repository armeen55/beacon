import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { PersistedBriefState } from "./types";

export const briefStates: PersistedBriefState[] = readStore<PersistedBriefState>(
  "brief-states",
  []
);

export async function persistBriefStates(): Promise<void> {
  await writeStore("brief-states", briefStates);
}
