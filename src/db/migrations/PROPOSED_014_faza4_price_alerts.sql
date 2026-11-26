-- =========================================================================
-- PROPUNERE MIGRARE FAZA 4 — PRICE ALERTS (NU SE EXECUTĂ AUTOMAT)
-- Necesită aprobare explicită înainte de aplicare în Supabase / PostgreSQL.
-- Migrare strict aditivă, idempotentă, non-destructivă (fără DROP TABLE / TRUNCATE).
-- =========================================================================

-- 1. Extindere tabel public.price_alerts pentru product_watch, cooldown, rearming & audit
ALTER TABLE public.price_alerts
  ADD COLUMN IF NOT EXISTS min_drop_percent NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS cooldown_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS rearm_state VARCHAR(32) NOT NULL DEFAULT 'armed',
  ADD COLUMN IF NOT EXISTS trigger_cycle INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_trigger_reason_ro TEXT,
  ADD COLUMN IF NOT EXISTS last_source_offer_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_source_quality_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_rearmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_skipped_reason_ro TEXT,
  ADD COLUMN IF NOT EXISTS trigger_history JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alerts_alert_type_check'
  ) THEN
    ALTER TABLE public.price_alerts DROP CONSTRAINT price_alerts_alert_type_check;
  END IF;

  ALTER TABLE public.price_alerts
    ADD CONSTRAINT price_alerts_alert_type_check
    CHECK (alert_type IN ('below_target', 'any_drop', 'interval_low', 'product_watch'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alerts_rearm_state_check'
  ) THEN
    ALTER TABLE public.price_alerts
      ADD CONSTRAINT price_alerts_rearm_state_check
      CHECK (rearm_state IN ('armed', 'triggered_locked'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alerts_cooldown_hours_check'
  ) THEN
    ALTER TABLE public.price_alerts
      ADD CONSTRAINT price_alerts_cooldown_hours_check
      CHECK (cooldown_hours >= 0 AND cooldown_hours <= 720);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_rearm
  ON public.price_alerts (user_id, is_active, rearm_state, last_triggered_at DESC);

-- 2. Extindere tabel public.price_alert_notifications pentru idempotență și explicabilitate
ALTER TABLE public.price_alert_notifications
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reason_ro TEXT,
  ADD COLUMN IF NOT EXISTS source_offer_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS quality_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS observed_interval_days SMALLINT,
  ADD COLUMN IF NOT EXISTS observed_observations_count INTEGER,
  ADD COLUMN IF NOT EXISTS trigger_cycle INTEGER;

DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.price_alert_notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%alert_type%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.price_alert_notifications DROP CONSTRAINT %I', c_name);
  END IF;

  ALTER TABLE public.price_alert_notifications
    ADD CONSTRAINT price_alert_notifications_alert_type_check
    CHECK (alert_type IN ('below_target', 'any_drop', 'interval_low', 'product_watch'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_price_alert_notif_idempotency
  ON public.price_alert_notifications (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Tabel audit & istoric declanșări / reînarmări per utilizator (RLS strict)
CREATE TABLE IF NOT EXISTS public.price_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL REFERENCES public.price_alerts(id) ON DELETE CASCADE,
  alert_type VARCHAR(32) NOT NULL CHECK (alert_type IN ('below_target', 'any_drop', 'interval_low', 'product_watch')),
  outcome VARCHAR(48) NOT NULL CHECK (
    outcome IN (
      'triggered',
      'rearmed_price_recovered',
      'rearmed_offer_expired',
      'rearmed_manual',
      'skipped_cooldown',
      'skipped_duplicate',
      'skipped_cycle_locked',
      'skipped_price_not_met',
      'skipped_ineligible_price',
      'skipped_canonical_invalid'
    )
  ),
  observed_price NUMERIC(10, 2),
  previous_price NUMERIC(10, 2),
  store_id VARCHAR(64),
  store_name VARCHAR(128),
  source_offer_id VARCHAR(120),
  quality_status VARCHAR(32),
  reason_ro TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alert_events_user_alert
  ON public.price_alert_events (user_id, alert_id, created_at DESC);

ALTER TABLE public.price_alert_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alert_events'
      AND policyname = 'Users can select their own price alert events'
  ) THEN
    CREATE POLICY "Users can select their own price alert events"
      ON public.price_alert_events
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alert_events'
      AND policyname = 'Users can insert their own price alert events'
  ) THEN
    CREATE POLICY "Users can insert their own price alert events"
      ON public.price_alert_events
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- =========================================================================
-- STRATEGIE DE ROLLBACK (exclusiv dacă este necesară revenirea la 012)
-- DROP INDEX IF EXISTS public.uq_user_price_alert_notif_idempotency;
-- DROP INDEX IF EXISTS public.idx_price_alerts_user_rearm;
-- DROP TABLE IF EXISTS public.price_alert_events;
-- ALTER TABLE public.price_alert_notifications
--   DROP COLUMN IF EXISTS idempotency_key,
--   DROP COLUMN IF EXISTS reason_ro,
--   DROP COLUMN IF EXISTS source_offer_id,
--   DROP COLUMN IF EXISTS quality_status,
--   DROP COLUMN IF EXISTS observed_interval_days,
--   DROP COLUMN IF EXISTS observed_observations_count,
--   DROP COLUMN IF EXISTS trigger_cycle;
-- ALTER TABLE public.price_alerts
--   DROP COLUMN IF EXISTS min_drop_percent,
--   DROP COLUMN IF EXISTS cooldown_hours,
--   DROP COLUMN IF EXISTS rearm_state,
--   DROP COLUMN IF EXISTS trigger_cycle,
--   DROP COLUMN IF EXISTS last_trigger_reason_ro,
--   DROP COLUMN IF EXISTS last_source_offer_id,
--   DROP COLUMN IF EXISTS last_source_quality_status,
--   DROP COLUMN IF EXISTS last_rearmed_at,
--   DROP COLUMN IF EXISTS last_skipped_reason_ro,
--   DROP COLUMN IF EXISTS trigger_history;
-- =========================================================================
