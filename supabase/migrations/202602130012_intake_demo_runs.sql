create table if not exists intake_demo_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  demo_case_id text not null,
  parser text not null,
  intake_group_id uuid,
  created_count integer not null default 0,
  created_change_request_ids jsonb not null default '[]'::jsonb,
  actor_clerk_user_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists intake_demo_runs_project_created_at_idx
  on intake_demo_runs(project_id, created_at desc);

create index if not exists intake_demo_runs_case_created_at_idx
  on intake_demo_runs(demo_case_id, created_at desc);
