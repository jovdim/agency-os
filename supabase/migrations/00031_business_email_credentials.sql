-- Business email credentials for salespeople
-- Each salesperson gets a Hostinger business email (e.g. erik@sharkmedia.sk)
-- Stored here so the system can send emails on their behalf automatically

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_email_password TEXT;
