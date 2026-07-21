"use client";

import { useState, useTransition } from "react";
import { draftAeoBriefAction, type DraftAeoBriefInput, type DraftAeoBriefResult } from "./aeo-brief-actions";

/** Tiny copy-to-clipboard button (per-field, per operator spec). */
function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="ml-2 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-100"
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Per-opportunity "Draft AEO brief" button. Calls the capped LLM action on
 *  click and renders the structured brief inline. No auto-spend. */
export function BriefButton({ input }: { input: DraftAeoBriefInput }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DraftAeoBriefResult | null>(null);

  function run() {
    startTransition(async () => {
      setResult(await draftAeoBriefAction(input));
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Drafting…" : result?.ok ? "Re-draft AEO brief" : "Draft AEO brief"}
      </button>

      {result && !result.ok && (
        <p className="mt-1 text-xs text-rose-600">{result.reason}</p>
      )}

      {result && result.ok && (
        <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
          <div className="flex justify-end">
            <CopyBtn text={JSON.stringify(result.brief, null, 2)} label="Copy brief JSON" />
          </div>
          <div>
            <span className="font-semibold text-gray-700">Direct answer (40-80 words):</span>
            <CopyBtn text={result.brief.direct_answer_40_80_words} />
            <p className="mt-0.5 text-gray-800">{result.brief.direct_answer_40_80_words}</p>
          </div>
          {result.brief.fanout_sections.length > 0 && (
            <div>
              <span className="font-semibold text-gray-700">Sections to cover:</span>
              <CopyBtn text={result.brief.fanout_sections.map((s) => `${s.question} - ${s.answer_goal}`).join("\n")} />
              <ul className="mt-0.5 list-disc pl-4 text-gray-800">
                {result.brief.fanout_sections.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.question}</span> - {s.answer_goal}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-700">
            <span><span className="font-semibold">Schema:</span> {result.brief.schema_recommendation}</span>
            {result.brief.entities_to_include.length > 0 && (
              <span><span className="font-semibold">Entities:</span> {result.brief.entities_to_include.join(", ")}</span>
            )}
          </div>
          {result.brief.facts_to_verify.length > 0 && (
            <div>
              <span className="font-semibold text-amber-700">Verify before publishing:</span>{" "}
              <span className="text-gray-800">{result.brief.facts_to_verify.join("; ")}</span>
            </div>
          )}
          {result.brief.competitor_pages_to_beat.length > 0 && (
            <div className="text-gray-700">
              <span className="font-semibold">Beat:</span> {result.brief.competitor_pages_to_beat.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
