"use client";

import { useState, useTransition, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
} from "@/components/forms/form-controls";
import { createChangelogEntry } from "@/domains/changelog/actions";
import {
  SIGNAL_TYPES,
  SIGNAL_TYPE_LABELS,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
} from "@/lib/constants";

const IMPACT_WINDOW_OPTIONS = [
  { value: "1-2 Days", label: "1–2 Days" },
  { value: "3-5 Days", label: "3–5 Days" },
  { value: "1 Week", label: "1 Week" },
  { value: "2 Weeks", label: "2 Weeks" },
  { value: "1 Month", label: "1 Month" },
];

type LogChangeButtonProps = {
  briefId?: string | null;
  opportunityId?: string | null;
  defaultTopic?: string | null;
  defaultCity?: string | null;
  defaultUrl?: string | null;
};

export function LogChangeButton({
  briefId,
  opportunityId,
  defaultTopic,
  defaultCity,
  defaultUrl,
}: LogChangeButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createChangelogEntry(formData);
      if (result.success) {
        setOpen(false);
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" data-icon="inline-start" />
        Log Change
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Log Change</SheetTitle>
            <SheetDescription>
              Record a change for tracking and attribution.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 px-4 overflow-y-auto">
            {briefId && (
              <input type="hidden" name="brief_id" value={briefId} />
            )}
            {opportunityId && (
              <input type="hidden" name="opportunity_id" value={opportunityId} />
            )}

            <FormField label="Asset Name" required>
              <FormInput
                name="asset_name"
                required
                placeholder="e.g. Palo Alto City Page"
              />
            </FormField>

            <FormField label="Description" required>
              <FormTextarea
                name="change_description"
                required
                placeholder="What was changed"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Signal Type" required>
                <FormSelect name="signal_type" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  {SIGNAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SIGNAL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>

              <FormField label="Asset Type" required>
                <FormSelect name="asset_type" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ASSET_TYPE_LABELS[t]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            </div>

            <FormField label="URL">
              <FormInput
                name="url"
                defaultValue={defaultUrl ?? ""}
                placeholder="/path/to/page"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Topic" required>
                <FormInput
                  name="topic_targeted"
                  required
                  defaultValue={defaultTopic ?? ""}
                  placeholder="Target topic"
                />
              </FormField>

              <FormField label="City">
                <FormInput
                  name="city_targeted"
                  defaultValue={defaultCity ?? ""}
                  placeholder="Target city"
                />
              </FormField>
            </div>

            <FormField label="Hypothesis">
              <FormTextarea
                name="hypothesis"
                placeholder="Why this change should work"
                rows={2}
              />
            </FormField>

            <FormField label="Expected Impact Window">
              <FormSelect name="expected_impact_window" defaultValue="">
                <option value="">Not specified</option>
                {IMPACT_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </FormSelect>
            </FormField>

            {error && (
              <p className="text-[12px] text-status-danger">{error}</p>
            )}

            <SheetFooter className="px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Logging…" : "Log Change"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
