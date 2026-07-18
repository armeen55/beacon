"use client";

/**
 * AskChatClient (BEACON_500 item 59) - the /ask input + chat thread. A plain client
 * component over the askQuestionAction server action (no streaming infra needed - the
 * whole answer composes in one bounded call, matching every other action in this app).
 * Each answer renders as a teammate chat bubble: an identity chip (color/name from
 * team/identity.ts, same convention as team-standup.tsx) + the first-person answer +
 * its cited facts underneath as links back to the source surface.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Send, Loader2 } from "lucide-react";
import { teammateOf } from "@/domains/team/identity";
import { surfaceNameFor } from "@/lib/navigation";
import { askQuestionAction } from "./ask-actions";
import type { AskAnswer, AskHistoryEntry } from "@/domains/ask/types";

type Turn = { id: string; question: string; answer: AskAnswer; askedAt: string };

function turnFromHistory(h: AskHistoryEntry): Turn {
  return { id: h.id, question: h.question, answer: h.answer, askedAt: h.askedAt };
}

/**
 * FP4 (2026-07-03) - citation chips. The audit found seven identical "/proof"
 * chips under one answer: raw hrefs as labels, one chip per fact. Chips now
 * (1) collapse to ONE chip per destination and (2) render the surface's human
 * name from the nav registry ("Results", "Changes", "AI questions"), never a
 * URL path. The tooltip keeps the underlying facts so nothing is lost.
 */
function citationChips(citedFacts: readonly { href: string; fact: string }[]) {
  const byHref = new Map<string, { href: string; label: string; facts: string[] }>();
  for (const c of citedFacts) {
    const existing = byHref.get(c.href);
    if (existing) existing.facts.push(c.fact);
    else byHref.set(c.href, { href: c.href, label: surfaceNameFor(c.href), facts: [c.fact] });
  }
  return [...byHref.values()];
}

function AnswerBubble({ turn }: { turn: Turn }) {
  const t = teammateOf(turn.answer.speaker);
  const chips = citationChips(turn.answer.citedFacts);
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-foreground">{turn.question}</p>
      <div
        className="rounded-2xl border p-4"
        style={{ background: t.bg, borderColor: `${t.color}33` }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
          <span className="text-[12px] font-semibold" style={{ color: t.text }}>
            {t.name}
          </span>
        </div>
        <p className="text-[13.5px] leading-relaxed" style={{ color: t.text }}>
          {turn.answer.answer}
        </p>
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2" style={{ borderColor: `${t.color}22` }}>
            <span className="text-[11px]" style={{ color: t.text, opacity: 0.75 }}>
              From:
            </span>
            {chips.map((chip) => (
              <Link
                key={chip.href}
                href={chip.href}
                className="rounded-full border px-2 py-1 text-[11px] font-medium underline-offset-2 hover:underline"
                style={{ borderColor: `${t.color}44`, color: t.text }}
                title={chip.facts.join("\n")}
              >
                {chip.label}
              </Link>
            ))}
          </div>
        )}
        {/* W9 slice 2 - a multi-specialist answer credits each specialist by human name
            (never a provider slug) and owns the gap when one came back empty. */}
        {turn.answer.providersUsed && turn.answer.providersUsed.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: t.text }}>
            <span style={{ opacity: 0.7 }}>Specialists:</span>
            {turn.answer.providersUsed.map((p) => (
              <span key={p.label} className="rounded-full px-2 py-0.5" style={{ background: `${t.color}14` }}>
                {p.label}
                {p.freshnessIso ? ` (through ${p.freshnessIso.slice(0, 10)})` : ""}
              </span>
            ))}
          </div>
        )}
        {turn.answer.providersUnavailable && turn.answer.providersUnavailable.length > 0 && (
          <p className="mt-1.5 text-[11px]" style={{ color: t.text, opacity: 0.7 }}>
            I checked {turn.answer.providersUnavailable.map((p) => p.label).join(", ")} too but found nothing there yet.
          </p>
        )}
      </div>
    </div>
  );
}

export function AskChatClient({
  initialHistory,
  suggestedQuestions,
}: {
  initialHistory: AskHistoryEntry[];
  suggestedQuestions: string[];
}) {
  const [turns, setTurns] = useState<Turn[]>(() => initialHistory.map(turnFromHistory));
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function ask(question: string) {
    const q = question.trim();
    if (!q || isPending) return;
    setError(null);
    setInput("");
    startTransition(async () => {
      try {
        const result = await askQuestionAction(q);
        setTurns((prev) => [
          { id: `local_${Date.now()}`, question: result.question, answer: result.answer, askedAt: new Date().toISOString() },
          ...prev,
        ]);
      } catch {
        setError("I could not answer that just now. Try again in a moment.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your team anything about the site..."
          className="flex-1 rounded-xl border border-border/60 bg-surface px-4 py-2.5 text-[13.5px] outline-none focus:border-foreground/30"
          disabled={isPending}
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background disabled:opacity-40"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Ask
        </button>
      </form>

      <p className="text-[12px] text-muted-foreground">
        I can read your Google numbers, your changes and their results, your competitors, and the AI answers I collect.
      </p>

      {turns.length === 0 && initialHistory.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground">Recent questions</p>
          <div className="flex flex-wrap gap-2">
            {initialHistory.slice(0, 5).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => ask(h.question)}
                className="rounded-full border border-border/60 bg-surface-inset/40 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              >
                {h.question}
              </button>
            ))}
          </div>
        </div>
      )}

      {turns.length === 0 && suggestedQuestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground">Suggested questions</p>
          <div className="flex flex-wrap gap-2">
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => ask(q)}
                className="rounded-full border border-border/60 bg-surface-inset/40 px-3 py-1.5 text-[12.5px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[12.5px] text-red-600">{error}</p>}

      <div className="space-y-4">
        {turns.map((turn) => (
          <AnswerBubble key={turn.id} turn={turn} />
        ))}
      </div>

      {turns.length === 0 && !isPending && (
        <p className="rounded-2xl border border-dashed border-border/60 bg-surface-inset/40 p-8 text-center text-[13px] text-muted-foreground">
          Ask about a page, a trend, an AI answer, a shipped change, a competitor, or today's plan on Today. I will answer with real numbers and link every claim back to its source.
        </p>
      )}
    </div>
  );
}
