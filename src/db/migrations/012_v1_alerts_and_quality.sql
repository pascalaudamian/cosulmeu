-- =========================================================================
-- Coșul Meu V1 Roadmap Migration: Extended Price Alerts & In-App Notifications
-- Idempotent / Non-destructive additive schema migration
-- Does NOT drop, truncate, or modify existing user/catalog data.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  target_price NUMERIC(10, 2) NOT NULL CHECK (target_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.price_alerts
  ADD COLUMN IF NOT EXISTS alert_type VARCHAR(32) NOT NULL DEFAULT 'below_target',
  ADD COLUMN IF NOT EXISTS interval_days SMALLINT,
  ADD COLUMN IF NOT EXISTS source_list_id UUID,
  ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_triggered_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS last_evaluated_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS last_notified_key VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_alerts_alert_type_check'
  ) THEN
    ALTER TABLE public.price_alerts
      ADD CONSTRAINT price_alerts_alert_type_check
      CHECK (alert_type IN ('below_target', 'any_drop', 'interval_low'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_alerts_interval_days_check'
  ) THEN
    ALTER TABLE public.price_alerts
      ADD CONSTRAINT price_alerts_interval_days_check
      CHECK (interval_days IS NULL OR interval_days IN (30, 90, 180, 365));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_active
  ON public.price_alerts (user_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_product
  ON public.price_alerts (user_id, product_id, alert_type);

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alerts'
      AND policyname = 'Users can select their own price alerts'
  ) THEN
    CREATE POLICY "Users can select their own price alerts"
      ON public.price_alerts
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alerts'
      AND policyname = 'Users can insert their own price alerts'
  ) THEN
    CREATE POLICY "Users can insert their own price alerts"
      ON public.price_alerts
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alerts'
      AND policyname = 'Users can update their own price alerts'
  ) THEN
    CREATE POLICY "Users can update their own price alerts"
      ON public.price_alerts
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alerts'
      AND policyname = 'Users can delete their own price alerts'
  ) THEN
    CREATE POLICY "Users can delete their own price alerts"
      ON public.price_alerts
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.price_alert_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL REFERENCES public.price_alerts(id) ON DELETE CASCADE,
  dedupe_key VARCHAR(255) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name VARCHAR(255) NOT NULL,
  alert_type VARCHAR(32) NOT NULL CHECK (alert_type IN ('below_target', 'any_drop', 'interval_low')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  observed_price NUMERIC(10, 2) NOT NULL,
  previous_price NUMERIC(10, 2),
  target_price NUMERIC(10, 2),
  store_id VARCHAR(64),
  store_name VARCHAR(128),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_price_alert_notification_dedupe UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_price_alert_notifications_user_unread
  ON public.price_alert_notifications (user_id, is_read, triggered_at DESC);

ALTER TABLE public.price_alert_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_alert_notifications'
      AND policyname = 'Users can manage their own alert notifications'
  ) THEN
    CREATE POLICY "Users can manage their own alert notifications"
      ON public.price_alert_notifications
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
