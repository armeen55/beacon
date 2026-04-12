import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { SitemapReconciliation } from "./types";

export function getSitemapReconciliation(): SitemapReconciliation | null {
  return readDotDataJson<SitemapReconciliation>("sitemap-reconciliation");
}
