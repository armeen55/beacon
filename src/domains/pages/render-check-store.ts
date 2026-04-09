import { getRepository } from "@/lib/persistence/repositories";
import type { RenderCheckResult } from "./render-check";

const repo = getRepository();

export const renderCheckResults: RenderCheckResult[] =
  await repo.getRenderChecks();
