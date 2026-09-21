alter table change_proposals drop constraint change_proposals_disposition_check;
alter table change_proposals add constraint change_proposals_disposition_check
  check (terminal_disposition is null or terminal_disposition in ('dismissed', 'withdrawn', 'superseded', 'settled'));;
