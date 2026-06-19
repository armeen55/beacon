import { listPageSurgeonReview } from "../actions";
import { PageSurgeonReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

/**
 * Page Surgeon — VISUAL REVIEW (operator-only). The "operator draft I approve"
 * surface: each top GSC-demand page becomes a FINISHED artifact bundle (literal
 * title/meta/answer-block/FAQ/JSON-LD/internal-links, before/after SERP snippet,
 * rollback, measurement) that the auto-QA gate has already vetted — only
 * QA-passed drafts are shown for approval; the rest are listed as "rejected by
 * QA" with reasons. No OpenAI on load (drafts run on an explicit click, cached
 * by evidence hash). Publishing is disabled here — Approve/Reject/Needs-edit
 * record intent only; nothing is pushed live.
 */
export default async function PageSurgeonReview() {
  const { rows } = await listPageSurgeonReview();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold tracking-tight">Page Surgeon — review &amp; approve</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Operator-draft, not advice. Each page below is a finished change you can
        ship as-is: the literal new title/meta/answer-block/FAQ/JSON-LD with a
        before/after Google preview, char-limit checks, evidence, risk, and a
        one-click rollback. An automatic QA gate vets every draft first — only
        QA-passed ones appear for approval; anything that fails is held back with
        the reason. Decide yes/no by eye. Publishing is disabled — nothing pushes.
      </p>
      <div className="mt-6">
        <PageSurgeonReviewClient rows={rows} />
      </div>
    </div>
  );
}
