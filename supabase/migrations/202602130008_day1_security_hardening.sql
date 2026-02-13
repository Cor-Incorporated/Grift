create index if not exists approval_requests_change_request_id_idx
  on approval_requests(change_request_id);

create index if not exists approval_requests_estimate_id_idx
  on approval_requests(estimate_id);

create index if not exists change_requests_billable_rule_id_idx
  on change_requests(billable_rule_id);

create index if not exists estimate_versions_project_id_idx
  on estimate_versions(project_id);

alter table if exists pricing_policies
  enable row level security;

alter table if exists market_evidence
  enable row level security;

alter table if exists change_requests
  enable row level security;

alter table if exists estimate_versions
  enable row level security;

alter table if exists audit_logs
  enable row level security;

alter table if exists data_sources
  enable row level security;

alter table if exists approval_requests
  enable row level security;

alter table if exists source_analysis_jobs
  enable row level security;

alter table if exists api_usage_logs
  enable row level security;

alter table if exists change_request_billable_rules
  enable row level security;

alter table if exists team_members
  enable row level security;
