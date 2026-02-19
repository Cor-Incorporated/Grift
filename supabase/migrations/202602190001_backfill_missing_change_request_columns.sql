-- Backfill columns that may be missing from change_requests.
-- Root cause: migration 202602130009 was edited after initial application,
-- so columns added later (intake_group_id, source_message_id, etc.) were
-- never created in the production database.
-- All statements use IF NOT EXISTS for idempotency.

-- From 202602130006 (approval_gate_and_billable_rules)
alter table if exists change_requests
  add column if not exists responsibility_type text not null default 'unknown'
    check (responsibility_type in ('our_fault', 'customer_fault', 'third_party', 'unknown')),
  add column if not exists reproducibility text not null default 'unknown'
    check (reproducibility in ('confirmed', 'not_confirmed', 'unknown')),
  add column if not exists billable_rule_id uuid,
  add column if not exists billable_evaluation jsonb not null default '{}'::jsonb;

-- From 202602130009 (intake_structuring) — columns suspected missing
alter table if exists change_requests
  add column if not exists intake_group_id uuid,
  add column if not exists source_message_id text,
  add column if not exists source_thread_id text,
  add column if not exists source_actor_name text,
  add column if not exists source_actor_email text,
  add column if not exists source_event_at timestamptz;

-- Ensure FK for billable_rule_id exists
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'change_requests_billable_rule_id_fkey'
  ) then
    begin
      alter table change_requests
        add constraint change_requests_billable_rule_id_fkey
        foreign key (billable_rule_id)
        references change_request_billable_rules(id)
        on delete set null;
    exception when others then
      raise notice 'Skipping FK creation: %', sqlerrm;
    end;
  end if;
end
$$;

-- Ensure indexes exist
create index if not exists change_requests_project_intake_group_idx
  on change_requests(project_id, intake_group_id, created_at);

create index if not exists change_requests_source_message_idx
  on change_requests(source_channel, source_thread_id, source_message_id);

-- Force PostgREST schema cache reload
notify pgrst, 'reload schema';
