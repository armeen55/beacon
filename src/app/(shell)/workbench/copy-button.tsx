"use client";

import { useState } from "react";

/**
 * Copy a drafted value (title / meta / JSON-LD / answer block / FAQ / links) to
 * the clipboard so the operator can paste it straight into the CMS. READ-ONLY:
 * copying never publishes anything. Used on the Workbench SEO action matrix to
 * turn a read-only draft into a one-click "ship faster" affordance.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked, the proposed text is shown right here to copy by hand */
        }
      }}
      className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
      title="Copy this drafted value to paste into your CMS. Copying never publishes anything."
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
