-- github_references に (org_name, repo_name) の UNIQUE 制約を追加
-- upsert の ON CONFLICT (org_name, repo_name) に必要
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_github_references_org_repo'
  ) then
    alter table github_references
      add constraint uq_github_references_org_repo unique (org_name, repo_name);
  end if;
end
$$;
