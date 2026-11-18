-- ============================================================================
-- gdpr_init.sql
-- Consolidated Supabase Migration: GDPR & Cookie Consent Core Tables
-- Tables:
--   1. public.cookie_consents
--   2. public.gdpr_requests
--   3. public.audit_log
-- Security:
--   - Row Level Security (RLS) enabled on all tables.
--   - Authenticated users can only read/insert their own records (auth.uid() = user_id).
--   - Anonymous visitors can record cookie consent without read/update/delete access.
--   - Admins (public.profiles.role = 'admin') can view and manage global GDPR requests.
--   - Immutable append-only protection on consent and audit logs.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Helper Trigger Function: Immutable Consent & Audit History
-- Prevents UPDATE/DELETE from client roles while allowing server service_role
-- cleanup (e.g., account erasure or pseudonymization).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_immutable_gdpr_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Înregistrările de consimțământ și audit nu pot fi modificate sau șterse din client.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1. TABLE: public.cookie_consents
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cookie_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  visitor_session_id VARCHAR(128) NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  banner_version VARCHAR(64) NOT NULL,
  consent_method VARCHAR(40) NOT NULL CHECK (
    consent_method IN (
      'banner_accept_all',
      'banner_reject_optional',
      'custom_preferences',
      'withdrawal'
    )
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

CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_created_at
  ON public.cookie_consents(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cookie_consents_visitor_created_at
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

DROP POLICY IF EXISTS cookie_consents_insert_anon ON public.cookie_consents;
CREATE POLICY cookie_consents_insert_anon
  ON public.cookie_consents
  FOR INSERT
  TO anon
  WITH CHECK (
    user_id IS NULL
    AND length(trim(visitor_session_id)) >= 6
  );

DROP TRIGGER IF EXISTS trg_protect_cookie_consents_immutable ON public.cookie_consents;
CREATE TRIGGER trg_protect_cookie_consents_immutable
  BEFORE UPDATE OR DELETE ON public.cookie_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_immutable_gdpr_record();

-- ============================================================================
-- 2. TABLE: public.gdpr_requests
-- ============================================================================
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
    status IN (
      'noua',
      'in_verificare',
      'procesata',
      'respinsa_justificat'
    )
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

CREATE INDEX IF NOT EXISTS idx_gdpr_requests_user_requested_at
  ON public.gdpr_requests(user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status_requested_at
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

-- Users can only view their own GDPR requests
DROP POLICY IF EXISTS gdpr_requests_select_own ON public.gdpr_requests;
CREATE POLICY gdpr_requests_select_own
  ON public.gdpr_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can submit requests only for themselves without forging admin resolution fields
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

-- Admins can view all global GDPR requests
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

-- Admins can update/manage global GDPR requests (status, admin_response, resolved_at)
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

-- ============================================================================
-- 3. TABLE: public.audit_log (Zero PII canonical schema)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(64) NOT NULL CHECK (
    action IN (
      'account_deleted',
      'data_exported',
      'data_accessed',
      'data_rectified',
      'consent_recorded',
      'consent_withdrawn',
      'restriction_updated',
      'gdpr_request_created',
      'gdpr_request_resolved'
    )
  ),
  actor_hash VARCHAR(64),
  actor_type VARCHAR(24) NOT NULL DEFAULT 'user' CHECK (
    actor_type IN ('user', 'admin', 'anonymous', 'system')
  ),
  resource_type VARCHAR(64),
  status VARCHAR(24) NOT NULL DEFAULT 'success' CHECK (
    status IN ('success', 'partial', 'failed', 'denied')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_audit_log_no_pii_metadata CHECK (
    NOT (
      metadata ?| ARRAY[
        'email',
        'phone',
        'phone_number',
        'first_name',
        'last_name',
        'full_name',
        'display_name',
        'ip',
        'ip_address',
        'user_agent',
        'password',
        'token',
        'cnp'
      ]
    )
  )
);

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS actor_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_created_at
  ON public.audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_hash_created_at
  ON public.audit_log(actor_hash, created_at DESC)
  WHERE actor_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION public.current_actor_sha256()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(digest(auth.uid()::text, 'sha256'), 'hex');
END;
$$;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_insert_own ON public.audit_log;

DROP POLICY IF EXISTS audit_log_select_own ON public.audit_log;
CREATE POLICY audit_log_select_own
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    actor_hash IS NOT NULL
    AND actor_hash = public.current_actor_sha256()
  );

DROP POLICY IF EXISTS audit_log_select_admin ON public.audit_log;
CREATE POLICY audit_log_select_admin
  ON public.audit_log
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

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Înregistrările din audit_log sunt imutabile și nu pot fi modificate sau șterse din client.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_log_immutable ON public.audit_log;
CREATE TRIGGER trg_protect_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_mutation();
