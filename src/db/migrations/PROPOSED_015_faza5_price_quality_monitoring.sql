-- =========================================================================
-- PROPOSED MIGRATION 015: FAZA 5 — Price Quality Monitoring & Investigations
-- STATUS: PROPUNERE NEEXECUTATĂ (Așteaptă aprobarea explicită a utilizatorului)
-- =========================================================================
-- Scop:
--   1. Persistența istoricului rulărilor de monitorizare a calității datelor de preț
--      (`price_quality_monitoring_runs`), cu metadate de acoperire și distribuție
--      pe cele 6 statusuri oficiale PriceQualityClassifier.
--   2. Persistența deciziilor și notelor administrative de investigare a anomaliilor
--      (`price_quality_anomaly_investigations`), complet separat și non-distructiv
--      față de `price_observations`, `product_offers`, `promotions` și `products`.
--
-- Impact asupra datelor existente:
--   - ZERO modificări pe `price_observations`, `product_offers`, `promotions`, `products`.
--   - Nu atinge trigger-ul de imutabilitate `trg_protect_price_observations`.
--   - Nu modifică schema alertelor din FAZA 4 (PROPOSED_014).
--   - Aditiv pur: creează doar două tabele noi cu politici RLS stricte pentru admin.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.price_quality_monitoring_runs (
  id VARCHAR(96) PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_by VARCHAR(160) NOT NULL,
  trigger_type VARCHAR(24) NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual', 'snapshot', 'export')),
  interval_days INTEGER NOT NULL DEFAULT 30
    CHECK (interval_days BETWEEN 1 AND 3650),
  analyzed_observations_count INTEGER NOT NULL DEFAULT 0,
  analyzed_offers_count INTEGER NOT NULL DEFAULT 0,
  total_records_analyzed INTEGER NOT NULL DEFAULT 0,
  suspicious_count INTEGER NOT NULL DEFAULT 0,
  suspicious_pct NUMERIC(6, 2) NOT NULL DEFAULT 0,
  expired_offers_count INTEGER NOT NULL DEFAULT 0,
  unverified_count INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  anomalies_detected_count INTEGER NOT NULL DEFAULT 0,
  canonical_issues_count INTEGER NOT NULL DEFAULT 0,
  is_partial_sample BOOLEAN NOT NULL DEFAULT FALSE,
  data_source VARCHAR(32) NOT NULL DEFAULT 'postgresql',
  coverage_note_ro TEXT NOT NULL,
  status_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pq_monitoring_runs_run_at
  ON public.price_quality_monitoring_runs (run_at DESC);

ALTER TABLE public.price_quality_monitoring_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_quality_monitoring_runs'
      AND policyname = 'Admins can select monitoring runs'
  ) THEN
    CREATE POLICY "Admins can select monitoring runs"
      ON public.price_quality_monitoring_runs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_quality_monitoring_runs'
      AND policyname = 'Admins can insert monitoring runs'
  ) THEN
    CREATE POLICY "Admins can insert monitoring runs"
      ON public.price_quality_monitoring_runs
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.price_quality_anomaly_investigations (
  anomaly_key VARCHAR(160) PRIMARY KEY,
  anomaly_id VARCHAR(160) NOT NULL,
  anomaly_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  target_type VARCHAR(24) NOT NULL CHECK (target_type IN ('observation', 'offer', 'product')),
  observation_id VARCHAR(128),
  offer_id VARCHAR(128),
  product_id VARCHAR(128),
  store_id VARCHAR(64),
  source VARCHAR(64),
  investigation_status VARCHAR(32) NOT NULL DEFAULT 'investigated'
    CHECK (investigation_status IN ('open', 'investigated', 'confirmed_anomaly', 'false_positive', 'needs_source_check')),
  admin_note TEXT NOT NULL,
  decision VARCHAR(120),
  investigated_by VARCHAR(160) NOT NULL,
  investigated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pq_anomaly_inv_status
  ON public.price_quality_anomaly_investigations (investigation_status, investigated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pq_anomaly_inv_product
  ON public.price_quality_anomaly_investigations (product_id);

ALTER TABLE public.price_quality_anomaly_investigations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_quality_anomaly_investigations'
      AND policyname = 'Admins can manage quality investigations'
  ) THEN
    CREATE POLICY "Admins can manage quality investigations"
      ON public.price_quality_anomaly_investigations
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
  END IF;
END $$;

-- =========================================================================
-- ROLLBACK (Sigur, fără impact asupra datelor catalogului sau istoricului):
--   DROP TABLE IF EXISTS public.price_quality_anomaly_investigations;
--   DROP TABLE IF EXISTS public.price_quality_monitoring_runs;
-- =========================================================================
