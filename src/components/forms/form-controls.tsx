"use client";

import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared form primitives used by every modal sheet (create-brief,
 * log-change, record-result, lifecycle-actions).
 *
 * a11y #168 (UX_TEARDOWN 2026-06-15): the <label> used to be a bare
 * element with no `htmlFor`, and FormInput/Select/Textarea carried no
 * `id`, so the label↔control association was structurally impossible —
 * every sheet shipped orphaned labels. FormField now mints a stable id
 * via useId() and shares it through context; each control reads the id
 * (unless the caller supplied its own) and wires `htmlFor`/`id`. The
 * required marker is no longer color-only: an `aria-required` flag plus
 * visually-hidden "(required)" text accompanies the red asterisk.
 */

type FormFieldContextValue = {
  /** Stable id the labelled control should adopt. */
  controlId: string;
  /** Whether the field is required (drives aria-required on the control). */
  required: boolean;
};

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Reads the surrounding FormField's id + required state. When inside a
 * FormField the field OWNS the association, so the context id is
 * authoritative — otherwise the <label htmlFor> (which renders before the
 * control and can't see a caller-supplied id) would point at the wrong
 * element. Standalone controls (no FormField) keep their own id.
 */
function useFormFieldControlProps(
  ownId: string | undefined,
  ownRequired: boolean | undefined,
): { id: string | undefined; "aria-required": boolean | undefined } {
  const ctx = useContext(FormFieldContext);
  const id = ctx?.controlId ?? ownId;
  const required = ownRequired ?? ctx?.required;
  return {
    id,
    "aria-required": required ? true : undefined,
  };
}

export function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  const controlId = useId();
  return (
    <FormFieldContext.Provider
      value={{ controlId, required: Boolean(required) }}
    >
      <div className="space-y-1.5">
        <label
          htmlFor={controlId}
          className="text-xs font-medium text-muted-foreground"
        >
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="text-status-danger ml-0.5">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
        {children}
        {error && <p className="text-[11px] text-status-danger">{error}</p>}
      </div>
    </FormFieldContext.Provider>
  );
}

export function FormInput({
  className,
  id: ownId,
  required: ownRequired,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const a11y = useFormFieldControlProps(ownId, ownRequired);
  return (
    <input
      {...a11y}
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-[13px]",
        "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary/40",
        "transition-colors",
        className
      )}
      {...props}
    />
  );
}

export function FormSelect({
  className,
  children,
  id: ownId,
  required: ownRequired,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const a11y = useFormFieldControlProps(ownId, ownRequired);
  return (
    <select
      {...a11y}
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-[13px]",
        "focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary/40",
        "transition-colors cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormTextarea({
  className,
  id: ownId,
  required: ownRequired,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const a11y = useFormFieldControlProps(ownId, ownRequired);
  return (
    <textarea
      {...a11y}
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-[13px] leading-relaxed",
        "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary/40",
        "transition-colors resize-none",
        className
      )}
      rows={3}
      {...props}
    />
  );
}
