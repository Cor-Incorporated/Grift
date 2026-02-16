alter table if exists change_requests
  add column if not exists requested_deadline text,
  add column if not exists requested_deadline_at timestamptz,
  add column if not exists latest_execution_task_id uuid;

create table if not exists estimate_batch_runs (
  id uuid primary key default gen_random_uuid(),
  actor_clerk_user_id text not null,
  scope text not null default 'intake_queue',
  request_params jsonb not null default '{}'::jsonb,
  target_change_request_ids jsonb not null default '[]'::jsonb,
  succeeded_change_request_ids jsonb not null default '[]'::jsonb,
  failed_items jsonb not null default '[]'::jsonb,
  requested_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists estimate_batch_runs_created_at_idx
  on estimate_batch_runs(created_at desc);

create index if not exists estimate_batch_runs_actor_created_at_idx
  on estimate_batch_runs(actor_clerk_user_id, created_at desc);

create table if not exists execution_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  change_request_id uuid not null references change_requests(id) on delete cascade,
  title text not null,
  summary text not null default '',
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done', 'blocked')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  due_at timestamptz,
  created_by_clerk_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists execution_tasks_active_change_request_idx
  on execution_tasks(change_request_id)
  where status in ('todo', 'in_progress', 'blocked');

create index if not exists execution_tasks_project_status_due_idx
  on execution_tasks(project_id, status, due_at);

create index if not exists change_requests_deadline_intake_idx
  on change_requests(intake_status, requested_deadline_at asc nulls last, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'change_requests_latest_execution_task_id_fkey'
  ) then
    alter table change_requests
      add constraint change_requests_latest_execution_task_id_fkey
      foreign key (latest_execution_task_id)
      references execution_tasks(id)
      on delete set null;
  end if;
end
$$;
