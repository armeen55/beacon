"use client";

import { useState, useTransition } from "react";
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
import { createBrief } from "@/domains/briefs/actions";
import {
  BRIEF_TYPES,
  BRIEF_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  EFFORT_LEVELS,
  EFFORT_LEVEL_LABELS,
} from "@/lib/constants";
import type { Priority } from "@/lib/constants";

type CreateBriefButtonProps = {
  opportunityId?: string;
  defaultTitle?: string;
  defaultPriority?: Priority;
  defaultTargetUrl?: string | null;
  defaultCity?: string | null;
  defaultTopic?: string | null;
};

export function CreateBriefButton({
  opportunityId,
  defaultTitle,
  defaultPriority,
  defaultTargetUrl,
  defaultCity,
  defaultTopic,
}: CreateBriefButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createBrief(formData);
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
        Create Brief
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setError(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Create Brief</SheetTitle>
            <SheetDescription>
              {opportunityId
                ? "Plan execution for this opportunity."
                : "Create a new execution brief."}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 px-4 overflow-y-auto">
            {opportunityId && (
              <input type="hidden" name="opportunity_id" value={opportunityId} />
            )}

            <FormField label="Title" required>
              <FormInput
                name="title"
                required
                defaultValue={defaultTitle}
                placeholder="Brief title"
              />
            </FormField>

            <FormField label="Objective" required>
              <FormTextarea
                name="objective"
                required
                placeholder="What this brief achieves"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Type" required>
                <FormSelect name="brief_type" required defaultValue="">
                  <option value="" disabled>
                    Select type
                  </option>
                  {BRIEF_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BRIEF_TYPE_LABELS[t]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>

              <FormField label="Priority">
                <FormSelect
                  name="priority"
                  defaultValue={defaultPriority ?? "medium"}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Effort">
                <FormSelect name="effort" defaultValue="medium">
                  {EFFORT_LEVELS.map((e) => (
                    <option key={e} value={e}>
                      {EFFORT_LEVEL_LABELS[e]}
                    </option>
                  ))}
                </FormSelect>
              </FormField>

              <FormField label="Due Date">
                <FormInput name="due_date" type="date" />
              </FormField>
            </div>

            <FormField label="Target URL">
              <FormInput
                name="target_url"
                defaultValue={defaultTargetUrl ?? ""}
                placeholder="/path/to/page"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="City">
                <FormInput
                  name="target_city"
                  defaultValue={defaultCity ?? ""}
                  placeholder="City"
                />
              </FormField>

              <FormField label="Topic">
                <FormInput
                  name="target_topic"
                  defaultValue={defaultTopic ?? ""}
                  placeholder="Topic"
                />
              </FormField>
            </div>

            {error && (
              <p className="text-[12px] text-status-danger">{error}</p>
            )}

            <SheetFooter className="px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create Brief"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
