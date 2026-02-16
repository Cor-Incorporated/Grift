create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  roles text[] not null default '{}'::text[],
  active boolean not null default true,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    roles <@ array['admin', 'sales', 'dev']::text[]
  )
);

create index if not exists team_members_active_roles_idx
  on team_members(active);

alter table if exists approval_requests
  add column if not exists required_role text not null default 'admin'
    check (required_role in ('admin', 'sales', 'dev')),
  add column if not exists assigned_to_role text
    check (assigned_to_role in ('admin', 'sales', 'dev')),
  add column if not exists resolved_by_role text
    check (resolved_by_role in ('admin', 'sales', 'dev'));

create index if not exists approval_requests_required_role_status_idx
  on approval_requests(required_role, status, requested_at desc);

insert into team_members (
  clerk_user_id,
  roles,
  active
)
select
  a.clerk_user_id,
  array['admin']::text[],
  true
from admins a
where a.clerk_user_id is not null
on conflict (clerk_user_id) do update
set
  roles = (
    select array_agg(distinct role_item)
    from unnest(coalesce(team_members.roles, '{}'::text[]) || array['admin']::text[]) as role_item
  ),
  active = true,
  updated_at = now();
