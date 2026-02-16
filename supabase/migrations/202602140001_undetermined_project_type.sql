-- Allow 'undetermined' as a project type for Akinator-style classification flow
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'undetermined';
