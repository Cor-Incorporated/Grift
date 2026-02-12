alter table if exists estimates
  add column if not exists estimate_status text not null default 'draft'
    check (estimate_status in ('draft', 'ready')),
  add column if not exists evidence_requirement_met boolean not null default true,
  add column if not exists evidence_source_count integer,
  add column if not exists evidence_appendix jsonb,
  add column if not exists evidence_block_reason text;

create index if not exists estimates_status_created_at_idx
  on estimates(estimate_status, created_at desc);
