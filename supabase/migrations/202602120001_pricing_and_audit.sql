create extension if not exists pgcrypto;

alter table if exists admins
  add column if not exists clerk_user_id text;

create unique index if not exists admins_clerk_user_id_key
  on admins(clerk_user_id)
  where clerk_user_id is not null;

create table if not exists pricing_policies (
  id uuid primary key default gen_random_uuid(),
  project_type text not null check (project_type in ('new_project', 'bug_report', 'fix_request', 'feature_addition')),
  name text not null,
  coefficient_min numeric not null check (coefficient_min > 0),
  coefficient_max numeric not null check (coefficient_max >= coefficient_min),
  default_coefficient numeric not null,
  minimum_project_fee numeric not null default 0,
  minimum_margin_percent numeric not null default 20,
  avg_internal_cost_per_member_month numeric not null default 2000000,
  default_team_size integer not null default 6,
  default_duration_months numeric not null default 6,
  active boolean not null default true,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pricing_policies_active_project_type_idx
  on pricing_policies(project_type)
  where active = true;

create table if not exists market_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  project_type text not null,
  source text not null default 'xai',
  query text not null,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  confidence_score numeric,
  usage jsonb not null default '{}'::jsonb,
  created_by_clerk_user_id text,
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null check (category in ('bug_report', 'fix_request', 'feature_addition', 'scope_change', 'other')),
  status text not null default 'draft' check (status in ('draft', 'triaged', 'estimated', 'approved', 'rejected', 'implemented')),
  impact_level text not null default 'medium' check (impact_level in ('low', 'medium', 'high', 'critical')),
  is_billable boolean,
  billable_reason text,
  requested_by_name text,
  requested_by_email text,
  base_estimate_id uuid,
  latest_estimate_id uuid,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists estimates
  add column if not exists change_request_id uuid,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists risk_flags jsonb,
  add column if not exists market_evidence_id uuid;

create table if not exists estimate_versions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  change_request_id uuid,
  version integer not null,
  version_type text not null check (version_type in ('initial', 'revised', 'change_order')),
  snapshot jsonb not null,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  unique (estimate_id, version)
);

create table if not exists audit_logs (
  id bigserial primary key,
  actor_clerk_user_id text not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  project_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_project_id_created_at_idx
  on audit_logs(project_id, created_at desc);

create index if not exists change_requests_project_id_created_at_idx
  on change_requests(project_id, created_at desc);

create index if not exists market_evidence_project_id_retrieved_at_idx
  on market_evidence(project_id, retrieved_at desc);
