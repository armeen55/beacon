"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { togglePromptActive, createPrompt } from "./actions";

/**
 * Client component for /settings/prompts. Renders list + toggle + add-form.
 * Minimum viable:
 *   - One row per prompt (active first)
 *   - Active toggle calls togglePromptActive
 *   - Add form: text + topic_id + optional location_scope + platforms
 *     checkboxes; calls createPrompt
 *   - Inline feedback on action success/failure
 */

export type PromptRow = {
  id: string;
  text: string;
  topic_id: string | null;
  location_scope: string | null;
  platforms: string[];
  is_active: boolean;
};

export function SettingsPromptsClient({ rows }: { rows: PromptRow[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Add-form state.
  const [showForm, setShowForm] = useState(false);
  const [formText, setFormText] = useState("");
  const [formTopic, setFormTopic] = useState("");
  const [formGeo, setFormGeo] = useState("");
  const [formPlatforms, setFormPlatforms] = useState<Record<string, boolean>>({
    perplexity: true,
    chatgpt: true,
  });

  function onToggle(prompt: PromptRow) {
    setMessage(null);
    startTransition(async () => {
      const res = await togglePromptActive(prompt.id, !prompt.is_active);
      if (!res.success) {
        setMessage(`Toggle failed: ${res.error ?? "unknown error"}`);
      } else {
        setMessage(
          `${prompt.is_active ? "Deactivated" : "Activated"}: ${prompt.text.slice(0, 60)}${prompt.text.length > 60 ? "…" : ""}`,
        );
      }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const platforms = Object.entries(formPlatforms)
      .filter(([, v]) => v)
      .map(([k]) => k);
    startTransition(async () => {
      const res = await createPrompt({
        text: formText,
        topic_id: formTopic,
        location_scope: formGeo || null,
        platforms,
      });
      if (!res.success) {
        setMessage(`Add failed: ${res.error}`);
      } else {
        setMessage(`Added prompt.`);
        setFormText("");
        setFormTopic("");
        setFormGeo("");
        setShowForm(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      {message && (
        <p
          className={cn(
            "text-[12px] rounded-md px-3 py-2 border",
            message.startsWith("Add failed") || message.startsWith("Toggle failed")
              ? "text-status-danger border-status-danger/30 bg-status-danger/[0.04]"
              : "text-status-success border-status-success/30 bg-status-success/[0.04]",
          )}
          role="status"
        >
          {message}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border/60 hover:bg-surface-inset/40"
        >
          {showForm ? "Close" : "+ Add prompt"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="rounded-md border border-border/60 bg-surface-raised/30 p-4 space-y-3"
        >
          <div>
            <label className="block text-[11px] font-medium text-foreground mb-1">
              Prompt text
            </label>
            <textarea
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              rows={3}
              required
              placeholder="e.g. Who are the best [your service] in [your city]?"
              className="w-full text-[13px] rounded-md border border-border/60 bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent-primary/40"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-medium text-foreground mb-1">
                Topic id
              </label>
              <input
                type="text"
                value={formTopic}
                onChange={(e) => setFormTopic(e.target.value)}
                required
                placeholder="e.g. [city] [service]"
                className="w-full text-[13px] rounded-md border border-border/60 bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent-primary/40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-foreground mb-1">
                Location (optional)
              </label>
              <input
                type="text"
                value={formGeo}
                onChange={(e) => setFormGeo(e.target.value)}
                placeholder="e.g. Palo Alto"
                className="w-full text-[13px] rounded-md border border-border/60 bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent-primary/40"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-foreground mb-1">
              Platforms
            </label>
            <div className="flex gap-3 text-[12px]">
              {Object.entries(formPlatforms).map(([key, val]) => (
                <label key={key} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) =>
                      setFormPlatforms((s) => ({
                        ...s,
                        [key]: e.target.checked,
                      }))
                    }
                  />
                  <span className="text-foreground">{platformLabel(key)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="text-[12px] font-medium px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add prompt"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border/60 hover:bg-surface-inset/40"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-2">
        {rows.map((p) => (
          <li
            key={p.id}
            className={cn(
              "rounded-md border px-3 py-2.5 bg-background flex items-start justify-between gap-3",
              p.is_active ? "border-border/60" : "border-border/30 bg-surface-inset/20",
            )}
          >
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-[13px] leading-snug",
                  p.is_active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {p.text}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {p.topic_id && (
                  <li className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">
                    <span className="font-medium text-foreground/80">topic</span>
                    <span className="mx-0.5">·</span>
                    <span>{p.topic_id}</span>
                  </li>
                )}
                {p.location_scope && (
                  <li className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">
                    <span className="font-medium text-foreground/80">geo</span>
                    <span className="mx-0.5">·</span>
                    <span>{p.location_scope}</span>
                  </li>
                )}
                {p.platforms.length > 0 && (
                  <li className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">
                    {p.platforms.map(platformLabel).join(" · ")}
                  </li>
                )}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => onToggle(p)}
              disabled={pending}
              className={cn(
                "shrink-0 text-[11px] font-medium px-2 py-1 rounded-md border disabled:opacity-50",
                p.is_active
                  ? "border-status-warning/40 text-status-warning hover:bg-status-warning/[0.05]"
                  : "border-status-success/40 text-status-success hover:bg-status-success/[0.05]",
              )}
              aria-label={p.is_active ? "Deactivate prompt" : "Activate prompt"}
            >
              {p.is_active ? "Deactivate" : "Activate"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  google_aio: "Google AI",
};
function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p;
}
