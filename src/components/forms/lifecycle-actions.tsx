"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Clock, X } from "lucide-react";
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
import {
  captureOpportunity,
  deferOpportunity,
  closeOpportunity,
} from "@/domains/opportunities/actions";
import {
  CLOSE_REASONS,
  CLOSE_REASON_LABELS,
} from "@/lib/constants";

export function CaptureOpportunityAction({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const notes = (formData.get("notes") as string) || undefined;
    startTransition(async () => {
      const result = await captureOpportunity(opportunityId, notes);
      if (result.success) setOpen(false);
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-3.5 w-3.5 text-status-success" data-icon="inline-start" />
        Mark Captured
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Mark as Captured</SheetTitle>
            <SheetDescription>
              Record that this opportunity has been won.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 px-4">
            <FormField label="Notes">
              <FormTextarea
                name="notes"
                placeholder="What evidence supports this capture?"
                rows={3}
              />
            </FormField>
            <SheetFooter className="px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Confirm Capture"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function DeferOpportunityAction({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const until = (formData.get("deferred_until") as string) || undefined;
    const notes = (formData.get("notes") as string) || undefined;
    startTransition(async () => {
      const result = await deferOpportunity(opportunityId, until, notes);
      if (result.success) setOpen(false);
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Clock className="h-3.5 w-3.5 text-status-warning" data-icon="inline-start" />
        Defer
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Defer Opportunity</SheetTitle>
            <SheetDescription>
              Pause work and revisit later.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 px-4">
            <FormField label="Revisit After">
              <FormInput name="deferred_until" type="date" />
            </FormField>
            <FormField label="Reason">
              <FormTextarea
                name="notes"
                placeholder="Why is this being deferred?"
                rows={2}
              />
            </FormField>
            <SheetFooter className="px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Defer"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function CloseOpportunityAction({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const reason = formData.get("close_reason") as string;
    if (!reason) {
      setError("Select a close reason.");
      return;
    }
    const notes = (formData.get("notes") as string) || undefined;
    startTransition(async () => {
      const result = await closeOpportunity(
        opportunityId,
        reason as (typeof CLOSE_REASONS)[number],
        notes
      );
      if (result.success) setOpen(false);
    });
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <X className="h-3.5 w-3.5 text-muted-foreground" data-icon="inline-start" />
        Close
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setError(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Close Opportunity</SheetTitle>
            <SheetDescription>
              Mark this opportunity as no longer active.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 px-4">
            <FormField label="Reason" required>
              <FormSelect name="close_reason" required defaultValue="">
                <option value="" disabled>
                  Select reason
                </option>
                {CLOSE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CLOSE_REASON_LABELS[r]}
                  </option>
                ))}
              </FormSelect>
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
                {isPending ? "Closing…" : "Close Opportunity"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
