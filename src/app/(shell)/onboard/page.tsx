/**
 * /onboard - the seven-step setup (Slice 5, 2026-07-24).
 *
 * Server component: resolves the pending account, reads the durable onboarding
 * state, computes the first incomplete step, and renders the wizard. The ?step
 * query may show an EARLIER completed step (or step 7 once connections are
 * reached); every mutation re-checks its own prerequisites server-side, so a
 * URL cannot skip ahead. An active account is redirected to the dashboard by the
 * gate. The legacy URL-first scorecard flow was retired with this slice.
 */

import { requireOnboardingTenant } from "@/domains/account";
import { loadOnboardingState } from "@/domains/runtime";
import { OnboardWizard, type FirstFindings } from "./onboard-wizard";

export const dynamic = "force-dynamic";

function clampStep(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOnboardingTenant();
  const state = await loadOnboardingState(tenantId);

  const requested = clampStep((await searchParams).step);
  const current = state.currentStep;
  let rendered = current;
  if (requested !== null) {
    if (requested <= current) rendered = requested as typeof current;
    else if (current === 6 && requested === 7) rendered = 7;
  }

  // First findings for step 7: the real crawl-derived preview, composed behind
  // the Runtime facade so this page never imports the scanner directly.
  const firstFindings: FirstFindings = {
    pagesRead: state.website.crawl.pagesRead,
    firstWin: state.findings.firstWin,
  };

  // RESUME. An account whose lifecycle state is still incomplete is sent here by the one account
  // gate, and the state machine above already resolves its REAL step. Landing on that step without
  // asking for it IS a resume, so the screen says so rather than looking like a restart.
  const resumed = requested === null && current > 1;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <OnboardWizard state={state} step={rendered} firstFindings={firstFindings} resumed={resumed} />
    </div>
  );
}
