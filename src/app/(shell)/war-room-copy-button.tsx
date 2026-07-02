"use client";

/** Tiny copy-to-clipboard button for war-room rows (item 47): intelligence without a button is
 *  trivia. Copies a ready-to-act instruction; confirms inline; no layout shift. */
import { useState } from "react";

export function WarRoomCopyButton({ text, label = "Copy the fix" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`ml-auto shrink-0 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200${done ? " beacon-pop text-emerald-700 border-emerald-200" : ""}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          })
          .catch(() => {});
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
