/**
 * serp-provider — `rootDomain`, the URL-normalization helper shared across the
 * evidence readers and the research funnel. The old per-reader SERP snapshot
 * vocabulary left with its reader in Slice 6; the funnel's normalize layer owns
 * SERP parsing now.
 */

import "server-only";

export function rootDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
