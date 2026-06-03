-- Add 'archived' to proposal_status enum
-- Used when: salesperson archives unresponsive/cold proposals
ALTER TYPE public.proposal_status ADD VALUE IF NOT EXISTS 'archived';
