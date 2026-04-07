import { PLATFORM_LABELS } from "@/lib/constants";
import type { Platform } from "@/lib/constants";

export function formatPlatforms(platforms: Platform[]): string {
  if (platforms.length === 0) return "—";
  if (platforms.includes("all")) return PLATFORM_LABELS.all;
  return platforms.map((p) => PLATFORM_LABELS[p]).join(", ");
}
