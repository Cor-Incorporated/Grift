create table if not exists data_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  provider text not null,
  source_type text not null default 'search' check (source_type in ('search', 'public_stats', 'internal', 'manual')),
  display_name text not null,
  description text,
  docs_url text,
  terms_url text,
  trust_level numeric not null default 0.7 check (trust_level >= 0 and trust_level <= 1),
  freshness_ttl_hours integer not null default 168,
  update_frequency_minutes integer not null default 1440,
  estimated_cost_per_call numeric not null default 0,
  currency text not null default 'JPY',
  quota_daily integer,
  quota_monthly integer,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists data_sources_active_provider_idx
  on data_sources(active, provider);

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  estimate_id uuid references estimates(id) on delete set null,
  change_request_id uuid references change_requests(id) on delete set null,
  request_type text not null check (request_type in ('floor_breach', 'low_margin', 'manual_override', 'high_risk_change')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  reason text not null,
  context jsonb not null default '{}'::jsonb,
  requested_by_clerk_user_id text not null,
  assigned_to_clerk_user_id text,
  resolved_by_clerk_user_id text,
  resolution_comment text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_requests_project_status_idx
  on approval_requests(project_id, status, requested_at desc);

create index if not exists approval_requests_status_requested_at_idx
  on approval_requests(status, requested_at desc);
