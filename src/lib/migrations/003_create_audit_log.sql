-- ============================================================================
-- 003_create_audit_log.sql
-- Supabase Migration: Tabel canonic audit_log fără date cu caracter personal (Zero PII)
-- NOTĂ DE AUDIT: Aliniat 100% cu 002_create_audit_log.sql (fără user_id/ip_hash/user_agent,
-- cu actor_hash SHA-256, chk_audit_log_no_pii_metadata și scriere exclusiv service_role).
-- Ordine canonică recomandată în Supabase:
--   1. src/db/migrations/010_receipt_scanner_v2.sql
--   2. src/db/migrations/011_gdpr_and_cookie_consent.sql
--   3. src/lib/migrations/002_create_audit_log.sql (sau acest fișier)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Creare tabel public.audit_log (strict fără PII)
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

-- 2. Indecși pentru consultare per acțiune, actor pseudonimizat și cronologie
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created_at
  ON public.audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_hash_created_at
  ON public.audit_log(actor_hash, created_at DESC)
  WHERE actor_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log(created_at DESC);

-- 3. Funcție helper compatibilă Supabase pentru calculul SHA-256 al auth.uid()
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

-- 4. Activare Row Level Security (RLS)
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 5. Politici RLS stricte (doar citire pentru propriul actor_hash sau admin; fără INSERT din client)
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

-- 6. Trigger idempotent de imutabilitate (blochează UPDATE / DELETE din client)
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
