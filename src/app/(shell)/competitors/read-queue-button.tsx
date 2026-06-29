"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sharpenMovesWithTeardownAction } from "../today-moves-actions";

/**
 * ReadQueueButton (2026-06-28) — one click reads the top competitor pages in the
 * queue (polite fetch + deterministic teardown, robots-respected, cached by URL).
 * Persisted teardown facts flow back into "what wins" + the "Competitors read"
 * checklist on Worklist/Drafts cards. Operator-gated server-side; no Wix, no
 * mutations to the tenant's own site.
 */
export function ReadQueueButton({ unread }: { unread: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await sharpenMovesWithTeardownAction({ limit: 20 });
        if (r.status !== "ok") {
          setMsg(r.status === "off" ? "Operator only." : "Read failed — try again.");
          return;
        }
        const read = r.audited - r.cached;
        setMsg(`Read ${read} new page${read === 1 ? "" : "s"} (${r.cached} cached) of ${r.targets}.`);
        router.refresh();
      } catch {
        setMsg("Read failed — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Read the top competitor pages (polite fetch + teardown of their title, sections, schema, answer shape). Cached by URL, so re-runs are cheap. Never touches your site."
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
            Reading…
          </>
        ) : (
          <>✦ Read top {Math.min(unread, 20)} now</>
        )}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
