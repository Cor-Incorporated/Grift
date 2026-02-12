create table if not exists api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source_key text not null,
  endpoint text,
  model text,
  request_status text not null default 'success'
    check (request_status in ('success', 'error', 'blocked')),
  request_count integer not null default 1
    check (request_count >= 1),
  input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,
  estimated_cost numeric not null default 0,
  currency text not null default 'USD',
  quota_daily integer,
  quota_monthly integer,
  over_quota boolean not null default false,
  error_message text,
  project_id uuid references projects(id) on delete set null,
  actor_clerk_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_usage_logs_source_key_created_at_idx
  on api_usage_logs(source_key, created_at desc);

create index if not exists api_usage_logs_project_created_at_idx
  on api_usage_logs(project_id, created_at desc);

create index if not exists api_usage_logs_status_created_at_idx
  on api_usage_logs(request_status, created_at desc);

insert into data_sources (
  source_key,
  provider,
  source_type,
  display_name,
  description,
  docs_url,
  terms_url,
  trust_level,
  freshness_ttl_hours,
  update_frequency_minutes,
  estimated_cost_per_call,
  currency,
  quota_daily,
  quota_monthly,
  active,
  metadata,
  created_by_clerk_user_id
)
values
  (
    'xai_responses',
    'xai',
    'search',
    'xAI Responses API',
    'xAI Responses API (web_search / x_search) for market evidence and citations',
    'https://docs.x.ai/docs/api-reference/responses/create-response',
    'https://x.ai/legal/terms-of-service',
    0.8,
    24,
    60,
    0,
    'USD',
    2000,
    30000,
    true,
    jsonb_build_object(
      'input_cost_per_1m_tokens', 0,
      'output_cost_per_1m_tokens', 0,
      'reasoning_cost_per_1m_tokens', 0,
      'note', 'Set pricing config from latest contract terms if cost_in_usd_ticks is unavailable'
    ),
    null
  ),
  (
    'anthropic_messages',
    'anthropic',
    'internal',
    'Anthropic Messages API',
    'Claude Messages API used for requirement interview, summarization, and estimation support',
    'https://docs.anthropic.com/en/api/messages',
    'https://www.anthropic.com/legal/commercial-terms',
    0.8,
    24,
    60,
    0,
    'USD',
    1500,
    20000,
    true,
    jsonb_build_object(
      'input_cost_per_1m_tokens', 0,
      'output_cost_per_1m_tokens', 0,
      'note', 'Set token pricing based on your Anthropic contract'
    ),
    null
  )
on conflict (source_key) do nothing;
