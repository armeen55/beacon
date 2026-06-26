"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanImageAltAction } from "./image-alt-actions";

/**
 * ImageAltScanButton (2026-06-25, Sprint 6) — operator-only. One click politely
 * fetches the top owned pages ($0) + analyzes image alt text, then refreshes. No
 * publish, no CMS write.
 */
export function ImageAltScanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await scanImageAltAction({ max: 6 });
        setMsg(r.ok ? `Scanned ${r.pagesScanned} pages · ${r.imagesFlagged} images to fix` : r.reason);
        if (r.ok) router.refresh();
      } catch {
        setMsg("Scan failed — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
      >
        {pending ? "Scanning…" : "🔍 Scan my pages"}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
