"use client";

/**
 * The seven-step /onboard wizard (Slice 5). One primary action per step, calm
 * progressive disclosure, desktop + mobile responsive. All logic lives in the
 * Runtime facade behind the server actions; this component only renders state
 * and calls one action per interaction.
 */

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { OnboardingState, OnboardingGoal, ProfilePatch } from "@/domains/runtime";
import { PromptsBody } from "./onboard-prompts";
import {
  submitWebsiteAction, inferProfileAction, saveProfileEditsAction, confirmProfileAction,
  proposeProfilePatchAction, applyPatchAction, saveGoalAction, activateAction,
} from "./actions";

export type FirstFindings = {
  pagesRead: number;
  firstWin: { action: string; plainWhy: string; exactFix: string; url: string } | null;
};

const BTN = "rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const GHOST = "rounded-md border border-border/60 px-4 py-2 text-[13px] font-medium hover:border-foreground/30";
const FIELD = "w-full rounded-md border border-border/60 bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground/40";

const TITLES: Record<number, { title: string; description: string }> = {
  1: { title: "Your website", description: "Give me one address. I read your pages, then work out the rest from what I find." },
  2: { title: "What I read on your site", description: "I read your pages and drafted a picture of your business. Check it in a second." },
  3: { title: "Confirm your business", description: "This is what I understood. Fix anything, or tell me in plain words what to change." },
  4: { title: "Your goal", description: "This shapes which questions I recommend. You can change it later." },
  5: { title: "Topics and questions", description: "The questions I will track across AI assistants. Approve them a topic at a time, or pick your own." },
  6: { title: "Connect your data", description: "Each connection sharpens my work. Search Console is the one I strongly recommend. Every one is optional, and I never publish without your say." },
  7: { title: "Your first findings", description: "Here is what I found so far. Start Beacon and I begin the full research." },
};

export function OnboardWizard({ state, step, firstFindings, resumed = false }: { state: OnboardingState; step: number; firstFindings: FirstFindings; resumed?: boolean }) {
  const meta = TITLES[step] ?? TITLES[1];
  return (
    <div className="space-y-6">
      {resumed ? (
        <p className="rounded-lg border border-border/60 bg-surface px-4 py-3 text-[13px]">
          You stopped partway through setting up. I kept everything you had already done, so you are picking up
          at step {step} of 7 rather than starting again.
        </p>
      ) : null}
      <div>
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Step {step} of 7</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{meta.title}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground leading-relaxed">{meta.description}</p>
      </div>
      <Body state={state} step={step} firstFindings={firstFindings} />
    </div>
  );
}

function Body({ state, step, firstFindings }: { state: OnboardingState; step: number; firstFindings: FirstFindings }) {
  if (step === 1) return <WebsiteStep domain={state.website.domain} />;
  if (step === 2) return <UnderstandStep state={state} />;
  if (step === 3) return <ConfirmStep state={state} />;
  if (step === 4) return <GoalStep goal={state.goal} />;
  if (step === 5) return <PromptsBody prompts={state.prompts} />;
  if (step === 6) return <ConnectionsStep state={state} />;
  return <FindingsStep findings={firstFindings} />;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string } | { ok: true }>, onOk: () => void) => {
    setError(null);
    start(async () => {
      const r = (await fn()) as { ok: boolean; error?: string };
      if (!r.ok) setError(r.error ?? "Something went wrong. Try again.");
      else onOk();
    });
  };
  return { router, pending, error, setError, run };
}

// ── Step 1: website ─────────────────────────────────────────────────────────
function WebsiteStep({ domain }: { domain: string }) {
  const { router, pending, error, run } = useRun();
  const [url, setUrl] = useState(domain);
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => submitWebsiteAction(url), () => router.push("/onboard?step=2")); }} className="space-y-4" noValidate>
      <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="acme.com" inputMode="url" className={FIELD} />
      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : <p className="text-[12px] text-muted-foreground">Just the address is enough. I work out the rest from your site.</p>}
      <button type="submit" disabled={pending} className={BTN}>{pending ? "Reading your site. This takes about half a minute." : "Read my site"}</button>
    </form>
  );
}

// ── Step 2: automatic understanding ─────────────────────────────────────────
function UnderstandStep({ state }: { state: OnboardingState }) {
  const { router, pending, error, run } = useRun();
  const pages = state.website.crawl.pagesRead;
  if (!state.profile.hasInference) {
    return (
      <div className="space-y-4">
        <p className="text-[14px]">I read <strong>{pages}</strong> {pages === 1 ? "page" : "pages"} on {state.website.domain}. Let me turn that into a first picture of your business.</p>
        {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
        <button type="button" disabled={pending} onClick={() => run(() => inferProfileAction().then((r) => r.status === "empty" ? { ok: false, error: "I have not read any pages yet. Go back and add your site." } : { ok: true }), () => router.refresh())} className={BTN}>
          {pending ? "Reading your business" : "Understand my site"}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted-foreground">I read <strong className="text-foreground">{pages}</strong> {pages === 1 ? "page" : "pages"} and drafted this from your site.</p>
      <ProfileSummary state={state} />
      <button type="button" onClick={() => router.push("/onboard?step=3")} className={BTN}>This looks right, continue</button>
    </div>
  );
}

function ProfileSummary({ state }: { state: OnboardingState }) {
  const p = state.profile;
  const rows: Array<[string, string]> = [
    ["Business", p.name || "(none yet)"],
    ["What you offer", p.offerings.join(", ") || "(none yet)"],
    ["Who you help", p.audiences.join(", ") || "(none yet)"],
    ["Topics to own", p.topicsToOwn.slice(0, 8).join(", ") || "(none yet)"],
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-surface divide-y divide-border/60">
      {rows.map(([k, v]) => (
        <div key={k} className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
          <p className="text-[14px]">{v}</p>
        </div>
      ))}
      <p className="px-4 py-2 text-[12px] text-muted-foreground">{p.source === "you" ? "Confirmed by you." : "Read from your site. Nothing here is guessed beyond your pages."}</p>
    </div>
  );
}

// ── Step 3: confirm ─────────────────────────────────────────────────────────
function ConfirmStep({ state }: { state: OnboardingState }) {
  const { router, pending, error, setError, run } = useRun();
  const [name, setName] = useState(state.profile.name);
  const [offerings, setOfferings] = useState(state.profile.offerings.join(", "));
  const [audiences, setAudiences] = useState(state.profile.audiences.join(", "));
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<{ patch: ProfilePatch; diff: Array<{ field: string; before: string; after: string }>; summary: string } | null>(null);
  const [busy, startBusy] = useTransition();

  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  function saveEdits(after: () => void) {
    run(() => saveProfileEditsAction({ name, offerings: list(offerings), audiences: list(audiences) }), after);
  }
  function propose() {
    setError(null);
    startBusy(async () => {
      const r = await proposeProfilePatchAction(instruction);
      if (!r.ok) setError(r.error);
      else setProposal({ patch: r.patch, diff: r.diff, summary: r.summary });
    });
  }
  function applyPatch() {
    if (!proposal) return;
    run(() => applyPatchAction(proposal.patch), () => { setProposal(null); setInstruction(""); router.refresh(); });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Labeled label="Business name"><input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} /></Labeled>
        <Labeled label="What you offer (comma separated)"><input value={offerings} onChange={(e) => setOfferings(e.target.value)} className={FIELD} /></Labeled>
        <Labeled label="Who you help (comma separated)"><input value={audiences} onChange={(e) => setAudiences(e.target.value)} className={FIELD} /></Labeled>
        <button type="button" onClick={() => saveEdits(() => router.refresh())} disabled={pending} className={GHOST}>Save changes</button>
      </div>

      <AlsoConfirming state={state} />

      <div className="rounded-lg border border-border/60 bg-surface-inset/30 p-4 space-y-3">
        <p className="text-[13px] font-medium">Or tell me in plain words</p>
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} placeholder="e.g. We also serve small law firms, and drop the plumbing mention." className={FIELD} />
        <button type="button" onClick={propose} disabled={busy || !instruction.trim()} className={GHOST}>{busy ? "Working out the change" : "Preview the change"}</button>
        {proposal ? (
          <div className="rounded-md border border-border/60 bg-surface p-3 space-y-2">
            <p className="text-[13px]">{proposal.summary}</p>
            {proposal.diff.map((d) => (
              <p key={d.field} className="text-[12px]"><span className="text-muted-foreground">{d.field}: </span><span className="line-through text-muted-foreground">{d.before || "(empty)"}</span> {" -> "} <span className="font-medium">{d.after || "(empty)"}</span></p>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={applyPatch} disabled={pending} className={GHOST}>Confirm this change</button>
              <button type="button" onClick={() => setProposal(null)} className="text-[12px] underline text-muted-foreground">Discard</button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
      <button type="button" onClick={() => saveEdits(() => run(() => confirmProfileAction(), () => router.push("/onboard?step=4")))} disabled={pending} className={BTN}>Confirm and continue</button>
    </div>
  );
}

/** THE REST OF WHAT "CONFIRM" MEANS. Six more facts I read off the site steer the research: what I search for,
 *  the questions I ask an assistant, the pages I read and the subjects I leave alone. They used to be stamped
 *  as the operator's own word without ever appearing, so the button claimed more than the screen showed. Read
 *  them here, correct any of them in plain words below, and pressing confirm speaks for all of them. Only
 *  what I actually hold is listed: an empty line is not a fact, and nothing empty takes a confirmation. */
function AlsoConfirming({ state }: { state: OnboardingState }) {
  const p = state.profile;
  const rows: Array<[string, string]> = ([
    ["Kind of business", p.businessType ?? ""], ["Kind of site", p.siteArchetype ?? ""],
    ["Problems you solve", p.customerProblems.join(", ")], ["Where you work", p.geographicScope.join(", ")],
    ["Topics to own", p.topicsToOwn.join(", ")], ["Topics to leave alone", p.topicsToExclude.join(", ")],
  ] as Array<[string, string]>).filter(([, v]) => v.trim().length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-surface divide-y divide-border/60">
      <p className="px-4 py-3 text-[13px] font-medium">Confirming also covers these {rows.length}, which decide what I research</p>
      {rows.map(([k, v]) => (
        <div key={k} className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
          <p className="text-[14px]">{v}</p>
        </div>
      ))}
      <p className="px-4 py-2 text-[12px] text-muted-foreground">Anything wrong here, change it in plain words below before you confirm.</p>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="block text-[13px] font-medium">{label}</span>{children}</label>;
}

// ── Step 4: goal ────────────────────────────────────────────────────────────
const GOALS: Array<{ key: OnboardingGoal; copy: string }> = [
  { key: "recover", copy: "Recover lost visibility." },
  { key: "grow", copy: "Grow into new demand." },
  { key: "balanced", copy: "Balance recovery and growth." },
];
function GoalStep({ goal }: { goal: OnboardingGoal | null }) {
  const { router, pending, error, run } = useRun();
  const [selected, setSelected] = useState<OnboardingGoal | null>(goal);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {GOALS.map((g) => (
          <button key={g.key} type="button" onClick={() => setSelected(g.key)}
            className={"rounded-lg border p-4 text-left transition-colors " + (selected === g.key ? "border-foreground bg-foreground/5" : "border-border/60 hover:border-foreground/30")}>
            <span className="block text-[14px] font-medium">{g.copy}</span>
            {g.key === "balanced" ? <span className="mt-1 block text-[12px] text-muted-foreground">Recommended: with no trend history yet, splitting effort is the safest start.</span> : null}
          </button>
        ))}
      </div>
      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
      <button type="button" disabled={pending || !selected} onClick={() => selected && run(() => saveGoalAction(selected), () => router.push("/onboard?step=5"))} className={BTN}>Continue</button>
    </div>
  );
}

// ── Step 6: connections ─────────────────────────────────────────────────────
const CONN: Record<string, { label: string; blurb: string }> = {
  google_gsc: { label: "Search Console", blurb: "Your real Google searches, clicks, impressions, and ranking movement. Strongly recommended." },
  google_ga4: { label: "Analytics", blurb: "Visits and engagement, so I can weigh which traffic is worth the most." },
  clarity: { label: "Clarity", blurb: "Where visitors struggle on your pages, so fixes target real friction." },
};
function ConnectionsStep({ state }: { state: OnboardingState }) {
  const router = useRouter();
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {state.connections.map((c) => {
          const meta = CONN[c.kind] ?? { label: c.kind, blurb: "" };
          return (
            <div key={c.kind} className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-surface px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold">{meta.label}{c.connected ? <span className="ml-2 text-[11px] font-normal text-emerald-600">Connected</span> : null}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed">{meta.blurb}</p>
              </div>
              {!c.connected ? <a href="/settings/connectors" className={GHOST + " whitespace-nowrap"}>Connect</a> : null}
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Skip any of these, including Search Console. With none of them connected I still research your public site
        and bring you real changes, and Today tells you plainly what I am working on while I do.
      </p>
      <button type="button" onClick={() => router.push("/onboard?step=7")} className={BTN}>Continue</button>
    </div>
  );
}

// ── Step 7: first findings + activate ───────────────────────────────────────
function FindingsStep({ findings }: { findings: FirstFindings }) {
  const { pending, error, run } = useRun();
  const [tos, setTos] = useState(false);
  return (
    <div className="space-y-5">
      <p className="text-[14px]">I read <strong>{findings.pagesRead}</strong> {findings.pagesRead === 1 ? "page" : "pages"} on your site so far.</p>
      {findings.firstWin ? (
        <div className="rounded-lg border border-foreground/25 p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your first win</p>
          <p className="text-[15px] font-semibold">{findings.firstWin.action}</p>
          <p className="text-[13px] text-muted-foreground">{findings.firstWin.plainWhy}</p>
          <p className="text-[13px]">{findings.firstWin.exactFix}</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Your pages look structurally sound so far. I will have a sharper first recommendation once I finish reading your site and start the full research.</p>
      )}
      <label className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-3 text-[13px] cursor-pointer">
        <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} className="mt-0.5 accent-foreground" />
        <span>Start tracking my site. I can edit or pause anything anytime.</span>
      </label>
      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
      <button type="button" disabled={pending || !tos} onClick={() => run(() => activateAction(tos), () => {})} className={BTN}>{pending ? "Starting Beacon" : "Start Beacon"}</button>
    </div>
  );
}
