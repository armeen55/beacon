"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ViewToggle } from "./view-toggle";

export function VizSection({
  title,
  subtitle,
  children,
  actions,
  defaultOpen = false,
  collapsible = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-start justify-between gap-3 w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-[9px] text-muted-foreground/40 transition-transform duration-200",
            open && "rotate-90",
          )}>▶</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight group-hover:text-accent-primary transition-colors">
              {title}
            </h3>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions && open && (
          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </button>
      {open && <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">{children}</div>}
    </section>
  );
}

export function ChartTableSection({
  title,
  subtitle,
  chart,
  table,
  defaultView = "chart",
  extraActions,
}: {
  title: string;
  subtitle?: string;
  chart: ReactNode;
  table: ReactNode;
  defaultView?: "chart" | "table";
  extraActions?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">(defaultView);

  return (
    <VizSection
      title={title}
      subtitle={subtitle}
      defaultOpen
      collapsible={false}
      actions={
        <div className="flex items-center gap-2">
          {extraActions}
          <ViewToggle
            options={[{ value: "chart" as const, label: "Chart" }, { value: "table" as const, label: "Table" }]}
            value={view}
            onChange={setView}
            size="sm"
          />
        </div>
      }
    >
      {view === "chart" ? chart : table}
    </VizSection>
  );
}
