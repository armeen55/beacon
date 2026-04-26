import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PersistedActionState } from "./types";

let _state: PersistedActionState[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await getRepository().getActionStates();
});

export const getActionStates = cache(
  async (): Promise<PersistedActionState[]> => {
    await ensureLoaded();
    return _state!;
  },
);

export async function persistActionStates(): Promise<void> {
  await writeStore("action-states", await getActionStates());
}

export function _resetActionStatesForTests(): void {
  _state = null;
}
