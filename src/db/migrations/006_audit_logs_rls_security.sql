-- ====================================================================
-- MIGRAȚIE 006: COȘUL MEU – ACTIVARE RLS ȘI SECURIZARE ADMIN AUDIT LOGS
-- ====================================================================

-- 1. Activare Row Level Security pe tabela admin_audit_logs
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- 2. Ștergere politici preexistente dacă există
DROP POLICY IF EXISTS admin_audit_logs_select_policy ON admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_logs_insert_policy ON admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_logs_update_policy ON admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_logs_delete_policy ON admin_audit_logs;

-- 3. Politică SELECT: Doar utilizatorii autentificați cu rolul 'admin' pot citi jurnalele de audit
CREATE POLICY admin_audit_logs_select_policy ON admin_audit_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- 4. Politică INSERT: Doar administratorii sau serviciul backend pot insera jurnale de audit
CREATE POLICY admin_audit_logs_insert_policy ON admin_audit_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- 5. BLOCARE STRICTĂ UPDATE & DELETE: Niciun utilizator (nici măcar admin) nu poate modifica sau șterge înregistrările de audit
-- (Fără politici de UPDATE/DELETE pe roluri client -> operațiunile sunt refuzate implicit de RLS)
