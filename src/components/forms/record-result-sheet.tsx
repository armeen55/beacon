"use client";

import { useState, useTransition, useEffect } from "react";
import { BarChart3 } from "lucide-react";
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
import { createResult } from "@/domains/results/actions";
import {
  METRIC_TYPES,
  METRIC_TYPE_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
} from "@/lib/constants";

type RecordResultButtonProps = {
  attributedChangelogIds: string[];
  defaultTopic?: string | null;
  defaultCity?: string | null;
  defaultUrl?: string | null;
  defaultPlatform?: string | null;
};

export function RecordResultButton({
  attributedChangelogIds,
  defaultTopic,
  defaultCity,
  defaultUrl,
  defaultPlatform,
}: RecordResultButtonProps) {
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
      const result = await createResult(formData);
      if (result.success) {
        setOpen(false);
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  };

  const activePlatforms = PLATFORMS.filter((p) => p !== "all");

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BarChart3 className="h-3.5 w-3.5" data-icon="inline-start" />
        Record Result
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Record Result</SheetTitle>
            <SheetDescription>
              Log a measurement to close the attribution loop.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 px-4 overflow-y-auto">
            <input
              type="hidden"
              name="attributed_changelog_ids"
              value={attributedChangelogIds.join(",")}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Metric" required>
                <FormSelect name="metric_type" required defaultValue="">
                  <option value="" disabled>
                    Select metric
                  </option>
                  {METRIC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {METRIC_TYPE_LABELS[t]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>

              <FormField label="Platform" required>
                <FormSelect
                  name="platform"
                  required
                  defaultValue={defaultPlatform ?? ""}
                >
                  <option value="" disabled>
                    Select
                  </option>
                  {activePlatforms.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Current Value" required>
                <FormInput
                  name="metric_value"
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 3"
                />
              </FormField>

              <FormField label="Previous Value">
                <FormInput
                  name="previous_value"
                  type="number"
                  step="any"
                  placeholder="For delta calc"
                />
              </FormField>
            </div>

            <FormField label="Snapshot Date">
              <FormInput
                name="snapshot_date"
                type="date"
                defaultValue={new Date().toISOString().split("T")[0]}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Topic">
                <FormInput
                  name="topic"
                  defaultValue={defaultTopic ?? ""}
                  placeholder="Topic measured"
                />
              </FormField>

              <FormField label="City">
                <FormInput
                  name="city"
                  defaultValue={defaultCity ?? ""}
                  placeholder="City"
                />
              </FormField>
            </div>

            <FormField label="URL Measured">
              <FormInput
                name="url_measured"
                defaultValue={defaultUrl ?? ""}
                placeholder="/path/measured"
              />
            </FormField>

            <FormField label="Notes">
              <FormTextarea
                name="notes"
                placeholder="Additional context"
                rows={2}
              />
            </FormField>

            {error && (
              <p className="text-[12px] text-status-danger">{error}</p>
            )}

            <SheetFooter className="px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Recording…" : "Record Result"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
