import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { RenderCheckResult } from "./render-check";

export function getRenderCheckResults(): RenderCheckResult[] {
  return readDotDataJson<RenderCheckResult[]>("render-checks") ?? [];
}
