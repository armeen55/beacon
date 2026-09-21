-- Preserve operational snapshot rows and privileged access.
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
;
