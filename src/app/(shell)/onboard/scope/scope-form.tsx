"use client";

/**
 * scope-form — Gap C.2 (2026-05-07).
 *
 * Step 2 of the onboarding wizard: cities served + services / project mix.
 *
 * Cities: multi-line textarea. Newline preferred (preserves "City, ST"
 * pairs); flat comma list also accepted.
 *
 * Project mix: visual checkbox grid of the six ProjectMixTag values.
 *
 * On submit, calls saveScopeProfile server action which redirects to
 * /onboard/competitors. Per-field errors render inline.
 */

import { useState, useTransition } from "react";
import {
  PROJECT_MIX_LABELS,
  PROJECT_MIX_TAGS,
} from "@/domains/onboarding/scope-validation";
import type { ProjectMixTag } from "@/domains/tenants/types";
import { saveScopeProfile } from "./actions";

type FieldErrors = { cities?: string; projectMix?: string };

export function ScopeForm({
  initialCities,
  initialProjectMix,
}: {
  initialCities: string[];
  initialProjectMix: ProjectMixTag[];
}) {
  const [citiesText, setCitiesText] = useState<string>(
    initialCities.join("\n"),
  );
  const [selectedTags, setSelectedTags] = useState<Set<ProjectMixTag>>(
    new Set(initialProjectMix),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleTag(tag: ProjectMixTag) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setTopError(null);
    startTransition(async () => {
      try {
        const r = await saveScopeProfile({
          cities: citiesText,
          projectMix: Array.from(selectedTags),
        });
        if (!r.ok) {
          if (r.fieldErrors) setFieldErrors(r.fieldErrors);
          setTopError(humanizeError(r.error));
        }
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "digest" in err &&
          typeof (err as { digest?: unknown }).digest === "string" &&
          (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
        ) {
          throw err;
        }
        setTopError("Something went wrong saving. Try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="space-y-2">
        <label htmlFor="cities" className="block text-[13px] font-medium">
          Cities you serve{" "}
          <span className="font-normal text-muted-foreground">
            (skip if location doesn&apos;t apply)
          </span>
        </label>
        <textarea
          id="cities"
          name="cities"
          rows={4}
          value={citiesText}
          onChange={(e) => setCitiesText(e.target.value)}
          placeholder={"One city per line"}
          aria-invalid={Boolean(fieldErrors.cities)}
          aria-describedby={
            fieldErrors.cities ? "cities-error" : "cities-hint"
          }
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground/40 font-mono"
        />
        {fieldErrors.cities ? (
          <p id="cities-error" className="text-[12px] text-rose-600" role="alert">
            {fieldErrors.cities}
          </p>
        ) : (
          <p id="cities-hint" className="text-[12px] text-muted-foreground">
            One city per line — or comma-separated. To include a state,
            add a comma: <span className="font-mono">Atherton, CA</span>.
          </p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="block text-[13px] font-medium">
          What kind of work do you take on?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <p className="text-[12px] text-muted-foreground">
          Pick everything that applies — or none, if these don&apos;t describe
          your business. Beacon also reads your services from your site.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-2">
          {PROJECT_MIX_TAGS.map((tag) => {
            const checked = selectedTags.has(tag);
            return (
              <label
                key={tag}
                className={
                  "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] cursor-pointer transition-colors " +
                  (checked
                    ? "border-foreground bg-foreground/5"
                    : "border-foreground/15 hover:border-foreground/30")
                }
              >
                <input
                  type="checkbox"
                  name="projectMix"
                  value={tag}
                  checked={checked}
                  onChange={() => toggleTag(tag)}
                  className="mt-1 accent-foreground"
                />
                <span>{PROJECT_MIX_LABELS[tag]}</span>
              </label>
            );
          })}
        </div>
        {fieldErrors.projectMix ? (
          <p className="text-[12px] text-rose-600 pt-1" role="alert">
            {fieldErrors.projectMix}
          </p>
        ) : null}
      </fieldset>

      {topError ? (
        <p className="text-[13px] text-rose-600" role="alert">
          {topError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-foreground text-background px-4 py-2 text-[14px] font-medium disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case "validation_failed":
      return "Please fix the highlighted fields.";
    case "not_authenticated":
      return "Your session expired. Sign in again to continue.";
    case "no_tenant":
      return "We couldn't find your account. Try signing in again.";
    case "already_launched":
      return "Your account has already launched — heading to your dashboard.";
    case "membership_lookup_failed":
    case "update_failed":
      return "We hit a temporary issue saving. Try again in a moment.";
    default:
      return "Something went wrong. Try again.";
  }
}
