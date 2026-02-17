-- github_references に (org_name, repo_name) の UNIQUE 制約を追加
-- upsert の ON CONFLICT (org_name, repo_name) に必要
ALTER TABLE github_references
  ADD CONSTRAINT uq_github_references_org_repo UNIQUE (org_name, repo_name);
