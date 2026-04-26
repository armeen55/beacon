import "server-only";

import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PersistedBriefState } from "./types";

let _state: PersistedBriefState[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await getRepository().getBriefStates();
});

export const getBriefStates = cache(
  async (): Promise<PersistedBriefState[]> => {
    await ensureLoaded();
    return _state!;
  },
);

export async function persistBriefStates(): Promise<void> {
  await writeStore("brief-states", await getBriefStates());
}

export function _resetBriefStatesForTests(): void {
  _state = null;
}
