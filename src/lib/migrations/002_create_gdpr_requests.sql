-- ============================================================================
-- 002_create_gdpr_requests.sql
-- Supabase Migration: Solicitări exercitare drepturi GDPR (gdpr_requests)
-- Cu politici RLS stricte: utilizatorii autentificați văd doar datele proprii.
-- Notă: Creează exclusiv public.gdpr_requests; fără coliziune funcțională cu
-- 002_create_audit_log.sql (care creează public.audit_log) — execută după 001 și înainte de 002_create_audit_log.sql.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Creare tabel public.gdpr_requests
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

-- 2. Indecși pentru filtrare rapidă per utilizator și status
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_user_requested_at
  ON public.gdpr_requests(user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status_requested_at
  ON public.gdpr_requests(status, requested_at DESC);

-- 3. Trigger automat pentru actualizarea coloanei updated_at
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

-- 4. Activare Row Level Security (RLS)
ALTER TABLE public.gdpr_requests ENABLE ROW LEVEL SECURITY;

-- 5. Politici RLS
-- Utilizatorii autentificați își pot vedea exclusiv propriile solicitări GDPR
DROP POLICY IF EXISTS gdpr_requests_select_own ON public.gdpr_requests;
CREATE POLICY gdpr_requests_select_own
  ON public.gdpr_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Politică separată pentru rolul 'admin': permite vizualizarea tuturor solicitărilor GDPR
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

-- Politică separată pentru rolul 'admin': permite actualizarea statusului și răspunsului GDPR
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

-- Utilizatorii autentificați pot depune solicitări doar în numele propriului cont,
-- fără a putea falsifica statusul administrativ sau răspunsul operatorului
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

-- Nicio politică DELETE pentru anon sau authenticated ->
-- ștergerea solicitărilor se face exclusiv server-side prin service_role (ex. ștergere cont).
