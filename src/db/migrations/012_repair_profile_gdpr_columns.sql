-- Repair schema drift exposed by profile loading requests.
-- The GDPR migration columns were missing from the live database, causing
-- PostgREST to reject profile and user_preferences selects with HTTP 400.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS restriction_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS restriction_reason TEXT,
  ADD COLUMN IF NOT EXISTS restriction_updated_at TIMESTAMPTZ;

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS optional_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_consent_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_withdrawn_at TIMESTAMPTZ;

COMMIT;
