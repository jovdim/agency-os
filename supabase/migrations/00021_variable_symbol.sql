-- Migration: Store variable symbol on proposals for payment matching
-- The variable symbol is the numeric identifier on bank transfers (VS)
-- that links incoming payments to specific proposals.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS variable_symbol TEXT;
CREATE INDEX IF NOT EXISTS idx_proposals_variable_symbol ON proposals(variable_symbol);
