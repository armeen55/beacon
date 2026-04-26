import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { RenderCheckResult } from "./render-check";

export async function getRenderCheckResults(): Promise<RenderCheckResult[]> {
  return (await readDotDataJson<RenderCheckResult[]>("render-checks")) ?? [];
}
