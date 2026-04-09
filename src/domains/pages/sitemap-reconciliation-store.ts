import { getRepository } from "@/lib/persistence/repositories";
import type { SitemapReconciliation } from "./types";

const repo = getRepository();

export const sitemapReconciliation: SitemapReconciliation | null =
  await repo.getSitemapReconciliation();
