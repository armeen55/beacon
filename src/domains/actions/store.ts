import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PersistedActionState } from "./types";

const repo = getRepository();

export const actionStates: PersistedActionState[] =
  await repo.getActionStates();

export async function persistActionStates(): Promise<void> {
  await writeStore("action-states", actionStates);
}
