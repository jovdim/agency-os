-- Add missing contact_status enum values used by sales dashboard
ALTER TYPE public.contact_status ADD VALUE IF NOT EXISTS 'archived';
ALTER TYPE public.contact_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE public.contact_status ADD VALUE IF NOT EXISTS 'client';
