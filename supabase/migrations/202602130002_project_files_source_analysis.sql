alter table if exists project_files
  add column if not exists source_kind text not null default 'file_upload'
    check (source_kind in ('file_upload', 'repository_url')),
  add column if not exists source_url text,
  add column if not exists analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'processing', 'completed', 'failed')),
  add column if not exists analysis_error text,
  add column if not exists analyzed_at timestamptz,
  add column if not exists analysis_model text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists project_files_project_analysis_status_idx
  on project_files(project_id, analysis_status, created_at desc);

update project_files
set
  analysis_status = 'completed',
  analyzed_at = coalesce(analyzed_at, created_at),
  updated_at = now()
where analysis_result is not null
  and analysis_status = 'pending';
