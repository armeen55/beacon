# UI primitives (FP6a)

- **PageShell** wraps every route: one h1 title row, one content width (max-w-5xl), sections stacked gap-6.
- **SectionHeader** for every section title: h2 (16px) for sections, h3 (14px) for subsections. Never a hand-rolled heading size.
- **Card** for every boxed container: `default` for content, `quiet` for supporting info, `alert` for broken/hurting. Padding: none/sm/md/lg.
- **Pill** for every status chip: intents `live`, `waiting`, `measuring`, `won`, `attention`, plus `neutral` for verdict-free labels. No new status words.
- **EmptyState** whenever a list or box would render empty: say what is empty and what makes it non-empty. Never a bare zero.
- **Button** (existing) for all actions; do not restyle links as buttons.
- Type scale is five sizes only: text-meta 12 / text-body 13 / text-sub 14 / text-section 16 / text-page 20 (defined in globals.css).
- Colors come from tokens only (`bg-card`, `text-muted-foreground`, `status-*`). Avoid raw palette classes.
