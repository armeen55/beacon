import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * FP6a - teach tailwind-merge the five-size type scale defined in
 * globals.css. Without this, twMerge assumes an unknown `text-*` class is a
 * text COLOR, so `cn("text-meta", "text-status-success")` silently dropped
 * the font size. Registering them in the font-size group makes them merge
 * against text-sm/text-xs (correct) instead of against colors (wrong).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-meta",
        "text-body",
        "text-sub",
        "text-section",
        "text-page",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
