"use client";

/**
 * Trust-budget autopilot card (2026-07-01, item 1) - the operator arms a
 * weekly budget of auto-shipped changes from proven change types.
 *
 * DEFAULT is OFF. Arming is an explicit opt-in on top of one-click
 * publishing: the card explains exactly what will ship (only change types
 * with at least 10 measured results here and 8 in 10 that did not hurt),
 * shows the site's proven change types with their real numbers, and lists
 * the most recent auto-ship receipts. Turning it off is always one click.
 *
 * Sibling of PublishingModeCard; loads its own state on mount so the
 * connectors page render never blocks on it.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  enableTriageSuggestion,
  loadAutopilotSettings,
  setAutopilotEnabled,
  setAutopilotWeeklyCap,
  setLeverPolicyDailyCap,
  setLeverPolicyToReview,
  setPrepareAheadOvernight,
  type AutopilotSettingsView,
} from "./autopilot-actions";
import { loadCircuitBreakerCardView, type CircuitBreakerCardView } from "../../circuit-breaker-actions";
import { CircuitBreakerCard } from "../../circuit-breaker-card";

export function AutopilotCard() {
  const router = useRouter();
  const [view, setView] = useState<AutopilotSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string>("");
  const [pending, startTransition] = useTransition();
  // Item 80: the portfolio circuit breaker's state, loaded alongside the rest
  // of this card so "Autopilot paused itself" shows right where the operator
  // is already looking at autopilot settings. Self-hides when not tripped.
  const [breakerView, setBreakerView] = useState<CircuitBreakerCardView | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await loadAutopilotSettings();
      setView(v);
      setCapDraft(String(v.config.weeklyCap));
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load autopilot status. Refresh to try again.");
    }
    try {
      setBreakerView(await loadCircuitBreakerCardView());
    } catch {
      setBreakerView(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = useCallback(
    (enabled: boolean) => {
      setActionError(null);
      startTransition(async () => {
        const res = await setAutopilotEnabled({ enabled });
        if (res.ok) {
          await refresh();
          router.refresh();
        } else {
          setActionError(res.reason);
        }
      });
    },
    [refresh, router],
  );

  // R20 (D6 dynamic auto-mode): the prepare-ahead-overnight toggle. DISTINCT from the publish
  // autopilot above - this only PREPARES tomorrow's picks (drafts + SERP checks), it never
  // publishes, so it is safe to turn on even without one-click publishing armed.
  const onTogglePrepareAhead = useCallback(
    (enabled: boolean) => {
      setActionError(null);
      startTransition(async () => {
        const res = await setPrepareAheadOvernight({ enabled });
        if (res.ok) {
          await refresh();
          router.refresh();
        } else {
          setActionError(res.reason);
        }
      });
    },
    [refresh, router],
  );

  const onSaveCap = useCallback(() => {
    setActionError(null);
    const parsed = Number(capDraft);
    if (!Number.isFinite(parsed)) {
      setActionError("Enter a number between 1 and 10 for the weekly budget.");
      return;
    }
    startTransition(async () => {
      const res = await setAutopilotWeeklyCap({ weeklyCap: parsed });
      if (res.ok) {
        await refresh();
        router.refresh();
      } else {
        setActionError(res.reason);
      }
    });
  }, [capDraft, refresh, router]);

  const onEnableSuggestion = useCallback(
    (actionType: string, dailyCap: number) => {
      setActionError(null);
      startTransition(async () => {
        const res = await enableTriageSuggestion({ actionType, dailyCap });
        if (res.ok) {
          await refresh();
          router.refresh();
        } else {
          setActionError(res.reason);
        }
      });
    },
    [refresh, router],
  );

  const onSetLeverToReview = useCallback(
    (actionType: string) => {
      setActionError(null);
      startTransition(async () => {
        const res = await setLeverPolicyToReview({ actionType });
        if (res.ok) {
          await refresh();
          router.refresh();
        } else {
          setActionError(res.reason);
        }
      });
    },
    [refresh, router],
  );

  const onSaveLeverCap = useCallback(
    (actionType: string, dailyCap: number) => {
      setActionError(null);
      startTransition(async () => {
        const res = await setLeverPolicyDailyCap({ actionType, dailyCap });
        if (res.ok) {
          await refresh();
          router.refresh();
        } else {
          setActionError(res.reason);
        }
      });
    },
    [refresh, router],
  );

  const on = view?.config.enabled === true;
  const canPublish = view?.canPublish ?? false;
  const provenLevers = (view?.levers ?? []).filter((l) => l.proven);
  const perLeverPolicies = view?.perLeverPolicies ?? [];
  const triageSuggestions = view?.triageSuggestions ?? [];

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface p-5"
      data-autopilot-card="true"
      data-autopilot-enabled={view == null ? "loading" : on ? "on" : "off"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">
            Autopilot for proven changes
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {on
              ? `On. I ship up to ${view?.config.weeklyCap ?? 3} proven changes a week for you, overnight, without waiting for a click.`
              : "Off. Nothing ships without your click. Turn this on and I will ship a small weekly budget of changes from change types that have already proven themselves here."}
          </p>
        </div>
        <span
          className={
            on
              ? "shrink-0 rounded-full bg-status-success/15 px-2.5 py-1 text-[11px] font-semibold text-status-success"
              : "shrink-0 rounded-full bg-surface-inset px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
          }
          data-autopilot-badge={on ? "on" : "off"}
        >
          {on ? "On" : "Off"}
        </span>
      </div>

      {loadError && <p className="mt-4 text-[13px] text-status-danger">{loadError}</p>}

      {/* R20 (D6 dynamic auto-mode): prepare-ahead-overnight. A DISTINCT switch from the publish
          autopilot below - it only PREPARES tomorrow's top picks (drafts + SERP checks) overnight
          so the morning queue is already ready to review. It NEVER publishes; publishing always
          waits for your click (or the publish autopilot below). Safe to turn on even without
          one-click publishing armed. */}
      {view != null && canPublish && (
        <div
          className="mt-4 rounded-md border border-border/50 bg-surface-inset/40 px-3 py-2.5"
          data-prepare-ahead-card="true"
          data-prepare-ahead-enabled={view.prepareAheadOvernight ? "on" : "off"}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">
                Prepare tomorrow&apos;s top picks overnight
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {view.prepareAheadOvernight
                  ? "On. Overnight I draft and fact-check your top picks so your morning queue is already prepared. I never publish anything, you still ship every change yourself."
                  : "Off. Turn this on and overnight I will draft and fact-check your top picks, so your morning queue arrives ready to review. This never publishes, it only prepares."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onTogglePrepareAhead(!view.prepareAheadOvernight)}
              disabled={pending}
              className="shrink-0 rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-surface-inset/60 disabled:opacity-50"
              data-prepare-ahead-action={view.prepareAheadOvernight ? "disable" : "enable"}
            >
              {pending
                ? "Saving…"
                : view.prepareAheadOvernight
                  ? "Turn off"
                  : "Turn on"}
            </button>
          </div>
        </div>
      )}

      {/* Item 80: "I paused myself" - self-hides unless the breaker is tripped. */}
      {breakerView != null && (
        <div className="mt-4">
          <CircuitBreakerCard view={breakerView} />
        </div>
      )}

      {!canPublish && view != null && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          You don&apos;t have permission to change publishing for this site.
        </p>
      )}

      {view != null && canPublish && (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border/50 bg-surface-inset/40 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">How I decide what ships:</p>
            <p className="mt-1">
              I will only ship change types that have already proven themselves here: at
              least {view.config.minVerdicts} measured results and{" "}
              {Math.round(view.config.minNonRegressionRate * 10)} in 10 that did not hurt.
              Everything is reversible and I write down every change I make.
            </p>
          </div>

          {/* Proven change types with real numbers */}
          <div data-autopilot-levers="true">
            <p className="text-[12px] font-semibold text-foreground">
              A change type earns autopilot after {view.config.minVerdicts} measured
              results here. So far: {provenLevers.length} {provenLevers.length === 1 ? "has" : "have"} qualified.
            </p>
            {provenLevers.length === 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                None yet. Keep shipping and measuring to get there.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {provenLevers.map((l) => (
                  <li
                    key={l.actionType}
                    className="flex items-center gap-2 text-[12px] text-muted-foreground"
                    data-autopilot-lever={l.actionType}
                  >
                    <span aria-hidden="true" className="text-status-success">
                      ✓
                    </span>
                    <span>
                      <span className="text-foreground">{l.label}</span>: {l.nonRegression} of{" "}
                      {l.decided} measured results did not hurt ({l.ratePct} percent)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Weekly budget */}
          <div className="flex items-end gap-2">
            <label className="block text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">Weekly budget</span>
              <span className="ml-1">
                (used {view.usedThisWeek} of {view.config.weeklyCap} this week)
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={capDraft}
                onChange={(e) => setCapDraft(e.target.value)}
                className="mt-1 block w-24 rounded-md border border-border/60 bg-surface px-2 py-1.5 text-[13px] text-foreground"
                data-autopilot-cap-input="true"
              />
            </label>
            <button
              type="button"
              onClick={onSaveCap}
              disabled={pending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-surface-inset/40 disabled:opacity-50"
              data-autopilot-action="save-cap"
            >
              Save
            </button>
          </div>

          {/* Item 52: per-lever policies - the operator pre-approves a class of change */}
          <div data-autopilot-lever-policies="true">
            <p className="text-[12px] font-semibold text-foreground">
              Change types I auto-ship on my own
            </p>
            {perLeverPolicies.filter((p) => p.mode === "auto").length === 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                None yet. Enable a suggestion below, or a change type earns this the same way
                the weekly budget does: prove itself first.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {perLeverPolicies
                  .filter((p) => p.mode === "auto")
                  .map((p) => (
                    <li
                      key={p.actionType}
                      className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground"
                      data-autopilot-lever-policy={p.actionType}
                      data-autopilot-lever-policy-mode={p.mode}
                    >
                      <span className="text-foreground">{p.label}</span>
                      <span>
                        (shipped {p.shippedToday} of {p.dailyCap} today)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        defaultValue={p.dailyCap}
                        onBlur={(e) => {
                          const parsed = Number(e.target.value);
                          if (Number.isFinite(parsed) && parsed !== p.dailyCap) {
                            onSaveLeverCap(p.actionType, parsed);
                          }
                        }}
                        className="w-16 rounded-md border border-border/60 bg-surface px-2 py-1 text-[12px] text-foreground"
                        data-autopilot-lever-cap-input={p.actionType}
                        aria-label={`Daily limit for ${p.label}`}
                      />
                      <button
                        type="button"
                        onClick={() => onSetLeverToReview(p.actionType)}
                        disabled={pending}
                        className="rounded-md border border-border/60 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-surface-inset/40 disabled:opacity-50"
                        data-autopilot-lever-action={`review-${p.actionType}`}
                      >
                        Hold for my review instead
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* Item 52: triage-fed suggestions - never auto-enabled, one click to turn on */}
          {triageSuggestions.length > 0 && (
            <div data-autopilot-triage-suggestions="true">
              <p className="text-[12px] font-semibold text-foreground">Suggestions for you</p>
              <ul className="mt-1.5 space-y-2">
                {triageSuggestions.map((s) => (
                  <li
                    key={s.actionType}
                    className="rounded-md border border-border/50 bg-surface-inset/30 px-3 py-2 text-[12px] text-muted-foreground"
                    data-autopilot-suggestion={s.actionType}
                  >
                    <p>{s.evidenceLine}</p>
                    <button
                      type="button"
                      onClick={() => onEnableSuggestion(s.actionType, s.suggestedDailyCap)}
                      disabled={pending}
                      className="mt-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-primary/90 disabled:opacity-50"
                      data-autopilot-suggestion-action={`enable-${s.actionType}`}
                    >
                      {pending ? "Turning on…" : `Yes, auto-ship ${s.label.toLowerCase()}`}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!on ? (
            <div className="space-y-2">
              {!view.publishingArmed && (
                <p className="text-[12px] text-muted-foreground">
                  One-click publishing is off. Turn it on above first; autopilot ships through
                  the same safe publishing path (backup before every change, daily limit, no
                  URL or structure changes).
                </p>
              )}
              <button
                type="button"
                onClick={() => onToggle(true)}
                disabled={pending || view.adviseOnly || !view.publishingArmed}
                className="rounded-md bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-primary/90 disabled:opacity-50"
                data-autopilot-action="enable"
              >
                {pending ? "Turning on…" : "Turn on autopilot"}
              </button>
              {view.adviseOnly && (
                <p className="text-[12px] text-muted-foreground">
                  This site is set up for advice only. Nothing ever publishes automatically
                  here.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => onToggle(false)}
                disabled={pending}
                className="rounded-md border border-border/60 px-3.5 py-2 text-[13px] font-semibold text-foreground hover:bg-surface-inset/40 disabled:opacity-50"
                data-autopilot-action="disable"
              >
                {pending ? "Turning off…" : "Turn off autopilot"}
              </button>
              <p className="text-[12px] text-muted-foreground">
                Every auto-shipped change keeps a backup for one-click undo, gets a receipt
                here and on your results page, and is measured like any other change.
              </p>
            </div>
          )}

          {/* Recent receipts */}
          {view.recentReceipts.length > 0 && (
            <div data-autopilot-receipts="true">
              <p className="text-[12px] font-semibold text-foreground">Latest receipts</p>
              <ul className="mt-1.5 space-y-1">
                {view.recentReceipts.map((r, i) => (
                  <li key={`${r.shippedAt}-${i}`} className="text-[12px] text-muted-foreground">
                    <span className="text-foreground/70">{r.shippedAt.slice(0, 10)}:</span>{" "}
                    {r.line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <p className="mt-3 text-[13px] text-status-danger" data-autopilot-error="true">
          {actionError}
        </p>
      )}
    </section>
  );
}
