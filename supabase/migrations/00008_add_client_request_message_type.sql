-- Add 'client_request' to message_type enum
-- Used when sales requests tech admin to create a client account for a contact

ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'client_request';

NOTIFY pgrst, 'reload schema';
