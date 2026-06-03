-- Migration 00006: Remove AI features + add proposal build workflow
--
-- Changes:
-- 1. Remove AI-specific columns from proposals
-- 2. Add new workflow columns (requirements, feedback, built_by)
-- 3. Remove deployment_id from sites (deployments still reference proposals directly)
-- 4. Drop flagged index
-- 5. Update proposal status options for new workflow

-- ============================================================
-- 1. Remove AI columns from proposals
-- ============================================================

ALTER TABLE proposals DROP COLUMN IF EXISTS generation_method;
ALTER TABLE proposals DROP COLUMN IF EXISTS ai_generated_html;
ALTER TABLE proposals DROP COLUMN IF EXISTS ai_generation_status;
ALTER TABLE proposals DROP COLUMN IF EXISTS ai_generation_error;
ALTER TABLE proposals DROP COLUMN IF EXISTS flagged_for_review;
ALTER TABLE proposals DROP COLUMN IF EXISTS flagged_at;

-- Drop the flagged index
DROP INDEX IF EXISTS idx_proposals_flagged;

-- ============================================================
-- 2. Add new workflow columns to proposals
-- ============================================================

-- Requirements: sales person describes what the client wants
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS requirements TEXT;

-- Feedback: sales person's revision notes when requesting changes
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS feedback TEXT;

-- Built by: tech admin who built the website
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS built_by UUID REFERENCES profiles(id);

-- Index for tech admin build queue (proposals waiting to be built)
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_built_by ON proposals(built_by);

-- ============================================================
-- 3. Remove deployment_id from sites
-- ============================================================
-- Deployments table stays (tracks GitHub + Cloudflare deploy status)
-- but sites no longer have a direct FK to deployments.
-- Deployments reference proposals via proposal_id instead.

ALTER TABLE sites DROP COLUMN IF EXISTS deployment_id;

-- ============================================================
-- 4. Create proposals storage bucket (for tech admin file uploads)
-- ============================================================
-- Tech admin uploads HTML/CSS/JS/content.json here before deploying

INSERT INTO storage.buckets (id, name, public)
VALUES ('proposals', 'proposals', true)
ON CONFLICT (id) DO NOTHING;

-- Allow tech_admin, administrator, super_admin to upload proposal files
CREATE POLICY "Tech roles can upload proposal files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'proposals'
    AND (SELECT get_my_role()) IN ('tech_admin', 'administrator', 'super_admin')
  );

CREATE POLICY "Tech roles can update proposal files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'proposals'
    AND (SELECT get_my_role()) IN ('tech_admin', 'administrator', 'super_admin')
  );

CREATE POLICY "Tech roles can delete proposal files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'proposals'
    AND (SELECT get_my_role()) IN ('tech_admin', 'administrator', 'super_admin')
  );

-- Anyone authenticated can read proposal files (for previews)
CREATE POLICY "Authenticated users can read proposal files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'proposals');

-- ============================================================
-- 5. Update proposal_status enum for new workflow
-- ============================================================
-- Original enum: draft, sent, viewed, accepted, declined
-- New statuses: submitted, building, review, revision

ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'submitted' AFTER 'draft';
ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'building' AFTER 'submitted';
ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'review' AFTER 'building';
ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'revision' AFTER 'review';

-- Change default from 'draft' to 'submitted'
ALTER TABLE proposals ALTER COLUMN status SET DEFAULT 'submitted';

-- ============================================================
-- 6. Update RLS policies for proposals (tech admin access)
-- ============================================================
-- Tech admin needs to read proposals (build queue) and update status

-- Allow tech_admin to read all proposals
CREATE POLICY "Tech admin can read proposals"
  ON proposals FOR SELECT
  TO authenticated
  USING ((SELECT get_my_role()) = 'tech_admin');

-- Allow tech_admin to update proposals (status, built_by, etc.)
CREATE POLICY "Tech admin can update proposals"
  ON proposals FOR UPDATE
  TO authenticated
  USING ((SELECT get_my_role()) = 'tech_admin')
  WITH CHECK ((SELECT get_my_role()) = 'tech_admin');
