-- ============================================================================
-- 001_create_cookie_consents.sql
-- Supabase Migration: Evidență consimțământ cookie-uri (cookie_consents)
-- Cu politici RLS stricte: utilizatorii autentificați văd doar datele proprii.
-- Ordine canonică recomandată în Supabase (alternativă modulară la gdpr_init.sql):
--   1. src/db/migrations/010_receipt_scanner_v2.sql
--   2. src/db/migrations/011_gdpr_and_cookie_consent.sql (include și cookie_consents + gdpr_requests)
--   3. src/lib/migrations/002_create_audit_log.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Creare tabel public.cookie_consents
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

-- 2. Indecși pentru interogări rapide pe utilizator și sesiune vizitator
CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_created_at
  ON public.cookie_consents(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cookie_consents_visitor_created_at
  ON public.cookie_consents(visitor_session_id, created_at DESC);

-- 3. Activare Row Level Security (RLS)
ALTER TABLE public.cookie_consents ENABLE ROW LEVEL SECURITY;

-- 4. Politici RLS
-- Utilizatorii autentificați își pot consulta exclusiv propriile înregistrări
DROP POLICY IF EXISTS cookie_consents_select_own ON public.cookie_consents;
CREATE POLICY cookie_consents_select_own
  ON public.cookie_consents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Utilizatorii autentificați pot insera dovezi de consimțământ doar pentru propriul user_id
DROP POLICY IF EXISTS cookie_consents_insert_own ON public.cookie_consents;
CREATE POLICY cookie_consents_insert_own
  ON public.cookie_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Vizitatorii neautentificați (anon) pot înregistra doar propria dovadă fără user_id
-- și nu au drept de SELECT / UPDATE / DELETE asupra niciunei înregistrări
DROP POLICY IF EXISTS cookie_consents_insert_anon ON public.cookie_consents;
CREATE POLICY cookie_consents_insert_anon
  ON public.cookie_consents
  FOR INSERT
  TO anon
  WITH CHECK (
    user_id IS NULL
    AND length(trim(visitor_session_id)) >= 6
  );

-- Nicio politică UPDATE/DELETE pentru rolurile client (anon / authenticated) ->
-- operațiunile sunt refuzate implicit de RLS.

-- 5. Gardă suplimentară de imutabilitate la nivel de bază de date (append-only pentru clienți)
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

DROP TRIGGER IF EXISTS trg_protect_cookie_consents_immutable ON public.cookie_consents;
CREATE TRIGGER trg_protect_cookie_consents_immutable
  BEFORE UPDATE OR DELETE ON public.cookie_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_immutable_gdpr_record();
