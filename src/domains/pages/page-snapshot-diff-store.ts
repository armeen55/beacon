import { getRepository } from "@/lib/persistence/repositories";
import type { PageSnapshotDiff } from "./types";

const repo = getRepository();

export const pageSnapshotDiffs: PageSnapshotDiff[] =
  await repo.getPageSnapshotDiffs();
