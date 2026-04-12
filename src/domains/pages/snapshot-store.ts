import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { PageSnapshot } from "./types";

/** Always reads `.data/page-snapshots.json` from disk (no import-time cache). */
export function getPageSnapshots(): PageSnapshot[] {
  return readDotDataJson<PageSnapshot[]>("page-snapshots") ?? [];
}
