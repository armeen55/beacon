"use client";

/** VisibilityTabs (Dream V1 Phase 7) - ONE surface, two tabs. Both panels are rendered on the server
 *  and handed in whole, so a tab switch is a view swap and never a second load, and both answers
 *  ship in the page a stranger receives. Google is first: it is the number that pays today. */
import { useState } from "react";
import { ViewToggle } from "@/components/viz/view-toggle";

const TABS = [{ value: "google" as const, label: "Google" }, { value: "ai" as const, label: "AI answers" }];
export function VisibilityTabs({ google, ai }: { google: React.ReactNode; ai: React.ReactNode }) {
  const [tab, setTab] = useState<"google" | "ai">("google");
  return (
    <div className="space-y-4">
      <ViewToggle options={TABS} value={tab} onChange={setTab} />
      <div hidden={tab !== "google"}>{google}</div>
      <div hidden={tab !== "ai"}>{ai}</div>
    </div>
  );
}
