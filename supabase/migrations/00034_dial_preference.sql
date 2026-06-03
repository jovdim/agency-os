-- Salesperson dial preference: how they want phone numbers sent to their cell phone
-- Options: 'qr' (default, scan QR code), 'push' (Supabase Realtime to phone), 'both'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dial_preference TEXT DEFAULT 'push';
