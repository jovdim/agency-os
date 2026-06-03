-- Add account_created message type for tech admin to notify sales that client account is created
ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'account_created';

NOTIFY pgrst, 'reload schema';
