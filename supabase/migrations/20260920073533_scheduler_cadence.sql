-- The durable admission clock decides when work is due. The one pg_cron job
-- only needs to wake the dispatcher often enough to honor that clock; a
-- ten-minute fleet wake bought three times the Vercel CPU and log volume with
-- no additional work. Keep the one approved scheduler and restore 30 minutes.

do $scheduler_cadence$
declare
  v_job_id bigint;
  v_jobs integer;
begin
  select count(*)::integer, min(jobid)
    into v_jobs, v_job_id
    from cron.job
   where command like '%/api/cron/scheduler%';

  if v_jobs <> 1 or v_job_id is null then
    raise exception 'expected exactly one Beacon scheduler job, found %', v_jobs;
  end if;

  perform cron.alter_job(
    job_id => v_job_id,
    schedule => '*/30 * * * *',
    active => true
  );

  if not exists (
    select 1
      from cron.job
     where jobid = v_job_id
       and schedule = '*/30 * * * *'
       and active = true
       and command like '%/api/cron/scheduler%'
  ) then
    raise exception 'Beacon scheduler cadence did not land';
  end if;
end;
$scheduler_cadence$;
;
