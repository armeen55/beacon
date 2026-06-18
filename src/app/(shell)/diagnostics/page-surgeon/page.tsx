import { listPageSurgeonBriefs } from "./actions";
import { PageSurgeonClient } from "./page-surgeon-client";

export const dynamic = "force-dynamic";

/**
 * Page Surgeon diagnostic (operator-only). Lists the top GSC-demand pages with
 * their real evidence; the LLM judge runs ONLY on an explicit "Run" click and
 * is cached by evidence hash. No OpenAI on load; no publish; no queue regen.
 */
export default async function PageSurgeonDiagnostic() {
  const { rows } = await listPageSurgeonBriefs();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold tracking-tight">Page Surgeon (diagnostic)</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        The evidence-based atomic-change evaluator. For each top page, the LLM
        judge decides the single highest-leverage move (title, meta, answer block,
        section, internal link, schema, UX, or a new page) from the real evidence
        packet — not a fixed title rule. Deterministic gates decide confidence and
        publishability; the LLM can never publish. Runs only when you click, and
        is cached by evidence hash so a re-run with unchanged data spends nothing.
      </p>
      <div className="mt-6">
        <PageSurgeonClient rows={rows} />
      </div>
    </div>
  );
}
