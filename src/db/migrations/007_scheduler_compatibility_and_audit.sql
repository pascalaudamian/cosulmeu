-- ====================================================================
-- MIGRAȚIE 007: COȘUL MEU – SCHEDULER COMPATIBILITY, GRANULAR AUDIT & RLS
-- ====================================================================

-- 1. Asigurare existență tabelă catalog_publish_schedules cu toate coloanele
CREATE TABLE IF NOT EXISTS catalog_publish_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    retailer_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
    scheduled_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    enabled BOOLEAN NOT NULL DEFAULT true,
    alert_email TEXT,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    last_status TEXT NOT NULL DEFAULT 'idle',
    last_error TEXT,
    schedule_type VARCHAR(32) NOT NULL DEFAULT 'once',
    per_retailer_status JSONB DEFAULT '{}'::jsonb,
    last_published_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Adăugare coloane dacă tabela a fost creată anterior fără ele
ALTER TABLE catalog_publish_schedules
    ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(32) NOT NULL DEFAULT 'once',
    ADD COLUMN IF NOT EXISTS per_retailer_status JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS last_published_count INTEGER NOT NULL DEFAULT 0;

-- 2. Indexuri de performanță pentru cron și scheduler
CREATE INDEX IF NOT EXISTS idx_catalog_sched_enabled ON catalog_publish_schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_catalog_sched_next_run ON catalog_publish_schedules(next_run_at);
CREATE INDEX IF NOT EXISTS idx_catalog_sched_status ON catalog_publish_schedules(last_status);

-- 3. Activare Row Level Security
ALTER TABLE catalog_publish_schedules ENABLE ROW LEVEL SECURITY;

-- 4. Politici RLS pentru administratori și service role
DROP POLICY IF EXISTS catalog_publish_schedules_admin_policy ON catalog_publish_schedules;
DROP POLICY IF EXISTS catalog_publish_schedules_service_role ON catalog_publish_schedules;

-- Service role are acces complet
CREATE POLICY catalog_publish_schedules_service_role ON catalog_publish_schedules
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Doar utilizatorii cu rolul 'admin' pot gestiona programările
CREATE POLICY catalog_publish_schedules_admin_policy ON catalog_publish_schedules
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );
