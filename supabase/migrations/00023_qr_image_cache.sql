-- Cache BySquare QR image on proposals to avoid regenerating on every page load
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS qr_image_cache TEXT;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS qr_cached_amount NUMERIC;
