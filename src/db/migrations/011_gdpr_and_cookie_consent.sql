-- ============================================================================
-- 011_gdpr_and_cookie_consent.sql
-- Implementare GDPR & Cookie Consent:
-- - Extindere profiles (prenume, nume, restricționare prelucrare)
-- - Extindere user_preferences (comunicări separate, consimțământ marketing, preferințe cookie)
-- - Evidență imutabilă cookie_consents (RLS strict)
-- - Evidență imutabilă communication_consents (RLS strict)
-- - Flux solicitări gdpr_requests (RLS izolat per utilizator)
-- - Jurnal gdpr_operation_logs fără PII în clar (exclusiv server-side / service_role)
-- ============================================================================

-- 1. Extindere public.profiles pentru nume, prenume și restricționarea prelucrării
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS restriction_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS restriction_reason TEXT,
  ADD COLUMN IF NOT EXISTS restriction_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Asigurare și extindere public.user_preferences
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme VARCHAR(16) NOT NULL DEFAULT 'light',
  notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  price_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  language VARCHAR(16) NOT NULL DEFAULT 'ro',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS optional_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_consent_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cookie_consent_version TEXT,
  ADD COLUMN IF NOT EXISTS cookie_preferences JSONB NOT NULL DEFAULT '{"necessary":true,"preferences":false,"analytics":false,"marketing":false}'::jsonb;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_select_own ON public.user_preferences;
CREATE POLICY user_preferences_select_own
  ON public.user_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_preferences_insert_own ON public.user_preferences;
CREATE POLICY user_preferences_insert_own
  ON public.user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_preferences_update_own ON public.user_preferences;
CREATE POLICY user_preferences_update_own
  ON public.user_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_preferences_delete_own ON public.user_preferences;
CREATE POLICY user_preferences_delete_own
  ON public.user_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Tabel evidență istorică consimțământ cookie-uri (append-only / imutabil pentru clienți)
CREATE TABLE IF NOT EXISTS public.cookie_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  visitor_session_id VARCHAR(128) NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  banner_version VARCHAR(64) NOT NULL,
  consent_method VARCHAR(40) NOT NULL CHECK (
    consent_method IN ('banner_accept_all', 'banner_reject_optional', 'custom_preferences', 'withdrawal')
  ),
  categories JSONB NOT NULL DEFAULT '{"necessary":true,"preferences":false,"analytics":false,"marketing":false}'::jsonb,
  consent_given BOOLEAN NOT NULL DEFAULT TRUE,
  user_agent_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_cookie_consents_necessary_always_true
    CHECK (COALESCE((categories ->> 'necessary')::boolean, FALSE) = TRUE),
  CONSTRAINT chk_cookie_consents_visitor_nonempty
    CHECK (length(trim(visitor_session_id)) >= 6)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cookie_consents_necessary_always_true'
      AND conrelid = 'public.cookie_consents'::regclass
  ) THEN
    ALTER TABLE public.cookie_consents
      ADD CONSTRAINT chk_cookie_consents_necessary_always_true
      CHECK (COALESCE((categories ->> 'necessary')::boolean, FALSE) = TRUE);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cookie_consents_visitor_nonempty'
      AND conrelid = 'public.cookie_consents'::regclass
  ) THEN
    ALTER TABLE public.cookie_consents
      ADD CONSTRAINT chk_cookie_consents_visitor_nonempty
      CHECK (length(trim(visitor_session_id)) >= 6);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_date
  ON public.cookie_consents(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cookie_consents_visitor_date
  ON public.cookie_consents(visitor_session_id, created_at DESC);

ALTER TABLE public.cookie_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cookie_consents_select_own ON public.cookie_consents;
CREATE POLICY cookie_consents_select_own
  ON public.cookie_consents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS cookie_consents_insert_own ON public.cookie_consents;
CREATE POLICY cookie_consents_insert_own
  ON public.cookie_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Permite înregistrarea dovezii de consimțământ pentru vizitatori anonimi fără drept de citire/modificare
DROP POLICY IF EXISTS cookie_consents_insert_anon ON public.cookie_consents;
CREATE POLICY cookie_consents_insert_anon
  ON public.cookie_consents
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL AND length(trim(visitor_session_id)) >= 6);

CREATE OR REPLACE FUNCTION public.prevent_consent_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Evidențele istorice de consimțământ nu pot fi modificate sau șterse de utilizator.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_cookie_consents_immutable ON public.cookie_consents;
CREATE TRIGGER trg_protect_cookie_consents_immutable
  BEFORE UPDATE OR DELETE ON public.cookie_consents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_consent_history_mutation();

-- 4. Tabel evidență consimțământ comunicări (append-only)
CREATE TABLE IF NOT EXISTS public.communication_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel VARCHAR(40) NOT NULL CHECK (
    channel IN ('email_marketing', 'optional_notifications', 'price_alerts', 'essential_account')
  ),
  is_granted BOOLEAN NOT NULL,
  consent_text_version VARCHAR(64) NOT NULL,
  source VARCHAR(32) NOT NULL CHECK (
    source IN ('signup', 'profile', 'gdpr_center', 'withdrawal')
  ),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_consents_user_channel
  ON public.communication_consents(user_id, channel, recorded_at DESC);

ALTER TABLE public.communication_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communication_consents_select_own ON public.communication_consents;
CREATE POLICY communication_consents_select_own
  ON public.communication_consents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS communication_consents_insert_own ON public.communication_consents;
CREATE POLICY communication_consents_insert_own
  ON public.communication_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_protect_comm_consents_immutable ON public.communication_consents;
CREATE TRIGGER trg_protect_comm_consents_immutable
  BEFORE UPDATE OR DELETE ON public.communication_consents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_consent_history_mutation();

-- 5. Tabel solicitări GDPR (gdpr_requests)
CREATE TABLE IF NOT EXISTS public.gdpr_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type VARCHAR(40) NOT NULL CHECK (
    request_type IN (
      'access_data',
      'export_data',
      'rectification',
      'erasure_account',
      'erasure_optional_data',
      'restriction_processing',
      'objection',
      'withdraw_consent',
      'other'
    )
  ),
  status VARCHAR(32) NOT NULL DEFAULT 'noua' CHECK (
    status IN ('noua', 'in_verificare', 'procesata', 'respinsa_justificat')
  ),
  details TEXT,
  requested_format VARCHAR(16) CHECK (
    requested_format IS NULL OR requested_format IN ('json', 'csv')
  ),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  admin_response TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_requests_user_date
  ON public.gdpr_requests(user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status_date
  ON public.gdpr_requests(status, requested_at DESC);

CREATE OR REPLACE FUNCTION public.set_gdpr_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gdpr_requests_updated_at ON public.gdpr_requests;
CREATE TRIGGER trg_gdpr_requests_updated_at
  BEFORE UPDATE ON public.gdpr_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_gdpr_requests_updated_at();

ALTER TABLE public.gdpr_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gdpr_requests_select_own ON public.gdpr_requests;
CREATE POLICY gdpr_requests_select_own
  ON public.gdpr_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gdpr_requests_select_admin ON public.gdpr_requests;
CREATE POLICY gdpr_requests_select_admin
  ON public.gdpr_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS gdpr_requests_update_admin ON public.gdpr_requests;
CREATE POLICY gdpr_requests_update_admin
  ON public.gdpr_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS gdpr_requests_insert_own ON public.gdpr_requests;
CREATE POLICY gdpr_requests_insert_own
  ON public.gdpr_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      (status = 'noua' AND resolved_at IS NULL AND admin_response IS NULL)
      OR request_type = 'export_data'
    )
  );

-- 6. Tabel jurnal operațiuni GDPR (fără PII în clar, exclusiv server-side / service_role)
CREATE TABLE IF NOT EXISTS public.gdpr_operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type VARCHAR(64) NOT NULL,
  user_id_hash VARCHAR(64),
  actor_type VARCHAR(32) NOT NULL CHECK (actor_type IN ('user', 'admin', 'anonymous', 'system')),
  status VARCHAR(24) NOT NULL DEFAULT 'success',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_operation_logs_hash_date
  ON public.gdpr_operation_logs(user_id_hash, created_at DESC);

ALTER TABLE public.gdpr_operation_logs ENABLE ROW LEVEL SECURITY;
-- Fără politici pentru anon/authenticated: citirea și scrierea sunt permise exclusiv server-side (service_role).

-- 7. Actualizare trigger handle_new_user_profile pentru a separa comunicările (opționale dezactivate implicit)
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger AS $$
DECLARE
  initial_role VARCHAR(16) := 'user';
  initial_username TEXT;
  marketing_opt_in BOOLEAN := COALESCE((new.raw_user_meta_data ->> 'marketing_consent')::boolean, FALSE);
BEGIN
  IF new.email = 'pascalau.stefan@gmail.com' OR (new.raw_user_meta_data ->> 'is_admin')::boolean = true THEN
    initial_role := 'admin';
  END IF;

  initial_username := COALESCE(
    new.raw_user_meta_data ->> 'username',
    split_part(new.email, '@', 1) || '_' || substr(md5(random()::text), 1, 4)
  );

  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    display_name,
    username,
    avatar_url,
    role,
    phone,
    phone_number,
    city,
    preferred_language,
    preferences
  ) VALUES (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    COALESCE(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    initial_username,
    new.raw_user_meta_data ->> 'avatar_url',
    initial_role,
    new.raw_user_meta_data ->> 'phone',
    COALESCE(new.raw_user_meta_data ->> 'phone_number', new.raw_user_meta_data ->> 'phone'),
    COALESCE(new.raw_user_meta_data ->> 'city', 'București'),
    COALESCE(new.raw_user_meta_data ->> 'preferred_language', 'ro'),
    '{}'::jsonb
  ) ON CONFLICT (id) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
    first_name = COALESCE(profiles.first_name, EXCLUDED.first_name),
    last_name = COALESCE(profiles.last_name, EXCLUDED.last_name),
    username = COALESCE(profiles.username, EXCLUDED.username),
    role = CASE WHEN profiles.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
    updated_at = NOW();

  INSERT INTO public.user_preferences (
    user_id,
    language,
    notifications_enabled,
    price_alerts_enabled,
    optional_notifications_enabled,
    marketing_consent,
    marketing_consent_updated_at
  )
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'preferred_language', 'ro'),
    FALSE,
    FALSE,
    FALSE,
    marketing_opt_in,
    CASE WHEN marketing_opt_in THEN NOW() ELSE NULL END
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
