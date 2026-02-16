alter table if exists change_requests
  add column if not exists intake_status text
    check (intake_status in ('needs_info', 'ready_to_start')),
  add column if not exists requirement_completeness integer
    check (requirement_completeness >= 0 and requirement_completeness <= 100),
  add column if not exists missing_fields jsonb,
  add column if not exists source_channel text,
  add column if not exists source_message_id text,
  add column if not exists source_thread_id text,
  add column if not exists source_actor_name text,
  add column if not exists source_actor_email text,
  add column if not exists source_event_at timestamptz,
  add column if not exists intake_group_id uuid,
  add column if not exists intake_intent text;

update change_requests
set
  intake_status = coalesce(intake_status, 'needs_info'),
  requirement_completeness = coalesce(requirement_completeness, 0),
  missing_fields = coalesce(missing_fields, '[]'::jsonb),
  source_channel = coalesce(source_channel, 'web_app');

alter table if exists change_requests
  alter column intake_status set default 'needs_info',
  alter column intake_status set not null,
  alter column requirement_completeness set default 0,
  alter column requirement_completeness set not null,
  alter column missing_fields set default '[]'::jsonb,
  alter column missing_fields set not null,
  alter column source_channel set default 'web_app';

create index if not exists change_requests_intake_status_created_at_idx
  on change_requests(intake_status, created_at desc);

create index if not exists change_requests_project_intake_group_idx
  on change_requests(project_id, intake_group_id, created_at);

create index if not exists change_requests_source_message_idx
  on change_requests(source_channel, source_thread_id, source_message_id);
