import type { NativeIntelReport } from "@/domains/ai-visibility/native-intel";
import { ENGINE_PLAIN_NAME, type EngineId } from "@/domains/ai-visibility/engine-types";

/**
 * Native intel view (2026-07-02, master plan item D1) - "Who AI keeps
 * recommending", built ONLY from Beacon's own 4-engine poll
 * (prompt_answer_observations). This is the NATIVE twin of the
 * Profound-powered AiQuestionsView above it on this page, not a
 * replacement - Profound stays wired (see run-engine-poll.ts header notes;
 * a staged cutover, not a delete, is the D1-followup). Self-hiding: renders
 * nothing when there are no native poll rows yet.
 */
function engineLabel(engine: string): string {
  return ENGINE_PLAIN_NAME[engine as EngineId] ?? engine;
}

function engineList(engines: readonly string[]): string {
  const names = engines.map(engineLabel);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function NativeIntelView({ report }: { report: NativeIntelReport }) {
  if (report.rowsScanned === 0) return null;

  const { recurringDomains, recurringPages, presence, nativeQuestions, enginesSeen } = report;

  return (
    <section className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm space-y-5">
      <div>
        <h2 className="text-[14px] font-semibold text-gray-900">Who AI keeps recommending</h2>
        <p className="mt-1 text-[11px] text-gray-500">
          From my own checks of the AI engines ({engineList(enginesSeen)}), not from Profound. I asked{" "}
          {presence.totals.promptsChecked} real question{presence.totals.promptsChecked === 1 ? "" : "s"} directly and
          read what came back.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="block text-lg font-semibold text-gray-900">{presence.totals.present}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-500">You showed up</span>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="block text-lg font-semibold text-amber-600">{presence.totals.absent}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-500">You were absent</span>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="block text-lg font-semibold text-violet-600">{recurringDomains.length}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Sites that keep coming up</span>
        </div>
      </div>

      {recurringDomains.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-semibold text-gray-800">Sites AI keeps pointing to</h3>
          <ul className="mt-2 space-y-1.5">
            {recurringDomains.slice(0, 8).map((d) => (
              <li key={d.domain} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="font-medium text-gray-800">{d.domain}</span>
                <span className="text-[11px] text-gray-500">
                  {d.distinctPrompts} question{d.distinctPrompts === 1 ? "" : "s"} · {engineList(d.engines)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recurringPages.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-semibold text-gray-800">Exact pages AI cites more than once</h3>
          <ul className="mt-2 space-y-1.5">
            {recurringPages.slice(0, 6).map((p) => (
              <li key={p.url} className="text-[12px]">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-primary hover:underline break-all"
                >
                  {p.url}
                </a>
                <span className="ml-2 text-[11px] text-gray-500">
                  {p.distinctPrompts} question{p.distinctPrompts === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {presence.rows.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-semibold text-gray-800">Where you are and are not, by engine</h3>
          <ul className="mt-2 space-y-2">
            {presence.rows.slice(0, 8).map((row) => (
              <li key={row.promptId} className="rounded-lg border border-gray-100 px-3 py-2">
                <p className="text-[12px] font-medium text-gray-800">{row.promptText}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {row.byEngine.map((cell) => (
                    <span
                      key={cell.engine}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                        cell.mentioned || cell.cited
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-gray-50 text-gray-500 ring-gray-200"
                      }`}
                    >
                      {engineLabel(cell.engine)}: {cell.mentioned || cell.cited ? "mentions you" : "does not"}
                    </span>
                  ))}
                </div>
                {row.byEngine.some((c) => c.answerSentence) ? (
                  <p className="mt-1.5 text-[11px] italic text-gray-500">
                    &ldquo;{row.byEngine.find((c) => c.answerSentence)?.answerSentence}&rdquo;
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {nativeQuestions.length > 0 ? (
        <div>
          <h3 className="text-[12px] font-semibold text-gray-800">Follow-up questions AI raised on its own</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Pulled straight out of the answers, not guessed. {nativeQuestions.length} distinct question
            {nativeQuestions.length === 1 ? "" : "s"} found so far.
          </p>
          <ul className="mt-2 space-y-1">
            {nativeQuestions.slice(0, 8).map((q) => (
              <li key={q.text} className="text-[12px] text-gray-700">
                {q.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
