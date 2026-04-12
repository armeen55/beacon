import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { PageSnapshotDiff } from "./types";

export function getPageSnapshotDiffs(): PageSnapshotDiff[] {
  return readDotDataJson<PageSnapshotDiff[]>("page-snapshot-diffs") ?? [];
}
