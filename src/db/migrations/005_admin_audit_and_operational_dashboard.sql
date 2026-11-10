-- ====================================================================
-- MIGRAȚIE 005: COȘUL MEU – ADMIN AUDIT LOGS & OPERATIONAL DASHBOARD
-- Tabele: admin_audit_logs
-- Indexuri: idx_admin_audit_created, idx_admin_audit_action, idx_admin_audit_user
-- ====================================================================

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    user_id VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user ON admin_audit_logs(user_email);

-- Indexuri opționale pe catalog_import_runs și catalog_import_errors pentru viteza dashboard-ului
CREATE INDEX IF NOT EXISTS idx_catalog_runs_status ON catalog_import_runs(status);
CREATE INDEX IF NOT EXISTS idx_catalog_runs_started ON catalog_import_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_errors_created ON catalog_import_errors(created_at DESC);
