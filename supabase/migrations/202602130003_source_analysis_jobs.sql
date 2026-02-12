create table if not exists source_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_file_id uuid not null references project_files(id) on delete cascade,
  job_kind text not null check (job_kind in ('file_upload', 'repository_url')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists source_analysis_jobs_status_run_after_idx
  on source_analysis_jobs(status, run_after, created_at);

create index if not exists source_analysis_jobs_project_created_at_idx
  on source_analysis_jobs(project_id, created_at desc);

create unique index if not exists source_analysis_jobs_project_file_active_idx
  on source_analysis_jobs(project_file_id)
  where status in ('queued', 'processing');
