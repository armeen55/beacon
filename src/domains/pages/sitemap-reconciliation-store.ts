import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { SitemapReconciliation } from "./types";

export async function getSitemapReconciliation(): Promise<SitemapReconciliation | null> {
  return await readDotDataJson<SitemapReconciliation>("sitemap-reconciliation");
}
