-- Add ON DELETE CASCADE to foreign keys referencing projects(id)
-- This ensures that when a project is deleted, all related records are automatically removed

-- conversations
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_project_id_fkey,
  ADD CONSTRAINT conversations_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- estimates
ALTER TABLE estimates
  DROP CONSTRAINT IF EXISTS estimates_project_id_fkey,
  ADD CONSTRAINT estimates_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- project_files
ALTER TABLE project_files
  DROP CONSTRAINT IF EXISTS project_files_project_id_fkey,
  ADD CONSTRAINT project_files_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
