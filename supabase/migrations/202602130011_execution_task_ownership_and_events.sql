alter table if exists execution_tasks
  add column if not exists owner_clerk_user_id text,
  add column if not exists owner_role text
    check (owner_role in ('admin', 'sales', 'dev'));

create index if not exists execution_tasks_owner_status_due_idx
  on execution_tasks(owner_clerk_user_id, status, due_at);

create table if not exists execution_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references execution_tasks(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  change_request_id uuid not null references change_requests(id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'status_changed', 'owner_assigned', 'note_added')),
  actor_clerk_user_id text,
  from_status text,
  to_status text,
  owner_clerk_user_id text,
  owner_role text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists execution_task_events_task_created_at_idx
  on execution_task_events(task_id, created_at desc);

create index if not exists execution_task_events_project_created_at_idx
  on execution_task_events(project_id, created_at desc);
