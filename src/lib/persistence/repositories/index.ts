import "server-only";

import { fileBackend } from "./file-backend";
import { supabaseBackend } from "./supabase-backend";
import type { SeedDataRepository } from "./types";

export type { SeedDataRepository } from "./types";

export function getRepository(): SeedDataRepository {
  return process.env.DATA_SOURCE === "supabase" ? supabaseBackend : fileBackend;
}
