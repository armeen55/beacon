import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { PersistedActionState } from "./types";

export const actionStates: PersistedActionState[] =
  readStore<PersistedActionState>("action-states");

export async function persistActionStates(): Promise<void> {
  await writeStore("action-states", actionStates);
}
