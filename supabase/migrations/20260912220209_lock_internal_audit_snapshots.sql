-- Internal audit snapshots are privileged operational history, not customer API tables.
-- TRUNCATE must be revoked explicitly: row policies do not protect it.
-- Preserve contents and existing service/admin grants; handle environments without these snapshots.
DO $migration$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['_fable_ready_snapshot', '_bundlefix_snapshot'] LOOP
    IF to_regclass(format('public.%I', target)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', target);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    END IF;
  END LOOP;
END
$migration$;
