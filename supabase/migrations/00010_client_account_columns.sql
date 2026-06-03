-- Link contact to their client user account
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES profiles(id);
