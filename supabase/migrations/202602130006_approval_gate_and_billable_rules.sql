alter table if exists estimates
  add column if not exists approval_required boolean not null default false,
  add column if not exists approval_status text not null default 'not_required'
    check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  add column if not exists approval_block_reason text;

create index if not exists estimates_approval_status_created_at_idx
  on estimates(approval_status, created_at desc);

create table if not exists change_request_billable_rules (
  id uuid primary key default gen_random_uuid(),
  rule_name text not null unique,
  active boolean not null default true,
  priority integer not null default 100,
  applies_to_categories text[] not null default '{}'::text[],
  max_warranty_days integer,
  responsibility_required text[] not null default '{}'::text[],
  reproducibility_required text[] not null default '{}'::text[],
  result_is_billable boolean not null,
  reason_template text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists change_request_billable_rules_active_priority_idx
  on change_request_billable_rules(active, priority asc);

alter table if exists change_requests
  add column if not exists responsibility_type text not null default 'unknown'
    check (responsibility_type in ('our_fault', 'customer_fault', 'third_party', 'unknown')),
  add column if not exists reproducibility text not null default 'unknown'
    check (reproducibility in ('confirmed', 'not_confirmed', 'unknown')),
  add column if not exists billable_rule_id uuid references change_request_billable_rules(id) on delete set null,
  add column if not exists billable_evaluation jsonb not null default '{}'::jsonb;

insert into change_request_billable_rules (
  rule_name,
  active,
  priority,
  applies_to_categories,
  max_warranty_days,
  responsibility_required,
  reproducibility_required,
  result_is_billable,
  reason_template,
  metadata
)
values
  (
    'bug_in_warranty_our_fault_confirmed_non_billable',
    true,
    10,
    array['bug_report']::text[],
    30,
    array['our_fault']::text[],
    array['confirmed']::text[],
    false,
    '保証期間内かつ当社責任の再現可能な不具合のため無償対応',
    jsonb_build_object('category', 'bug_report', 'policy', 'warranty')
  ),
  (
    'bug_customer_or_third_party_billable',
    true,
    20,
    array['bug_report']::text[],
    null,
    array['customer_fault', 'third_party']::text[],
    array[]::text[],
    true,
    '責任区分が当社外のため有償対応',
    jsonb_build_object('category', 'bug_report', 'policy', 'responsibility')
  ),
  (
    'bug_out_of_warranty_billable',
    true,
    30,
    array['bug_report']::text[],
    null,
    array[]::text[],
    array['confirmed', 'not_confirmed', 'unknown']::text[],
    true,
    '保証期間外のため有償対応',
    jsonb_build_object('category', 'bug_report', 'policy', 'warranty_expired')
  ),
  (
    'feature_scope_fix_billable_default',
    true,
    100,
    array['fix_request', 'feature_addition', 'scope_change', 'other']::text[],
    null,
    array[]::text[],
    array[]::text[],
    true,
    '仕様追加・修正要求として有償対応',
    jsonb_build_object('category', 'default')
  )
on conflict (rule_name) do nothing;
