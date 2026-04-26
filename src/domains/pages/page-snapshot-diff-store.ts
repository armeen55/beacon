import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { PageSnapshotDiff } from "./types";

export async function getPageSnapshotDiffs(): Promise<PageSnapshotDiff[]> {
  return (await readDotDataJson<PageSnapshotDiff[]>("page-snapshot-diffs")) ?? [];
}
