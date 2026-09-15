-- 2026-09-14: observed source markup for one owned page capture (operator-approved 2026-09-14).
-- Nullable JSONB { version: 1, mainHtml, jsonLd[], complete }. Absent on captures older than this
-- release, which is exactly what marks them as flat-text captures. Never publication copy.
alter table public.page_snapshots add column if not exists content_capture jsonb;
comment on column public.page_snapshots.content_capture is
  'Observed main-content markup and JSON-LD for this capture: {version:1, mainHtml, jsonLd[], complete}. Null on pre-2026-09-14 captures.';
