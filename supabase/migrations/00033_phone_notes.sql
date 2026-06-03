-- Store notes per phone number (e.g. "Owner", "Assistant", "not working")
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS phone_notes JSONB DEFAULT '{}';
