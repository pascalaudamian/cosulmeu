-- ============================================================================
-- 010_receipt_scanner_v2.sql
-- Receipt Scanner 2.0: Extensii structurate, validare matematică, scoruri de încredere,
-- observații personale de preț izolate per utilizator, bucket privat și RLS strict.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Extindere tabel existent public.receipts (păstrând compatibilitatea)
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sgr_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupons_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_total NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS printed_total NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS calculated_total NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS discrepancy_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_status VARCHAR(24) NOT NULL DEFAULT 'VALID',
  ADD COLUMN IF NOT EXISTS validation_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS original_extracted_data JSONB,
  ADD COLUMN IF NOT EXISTS user_corrections JSONB,
  ADD COLUMN IF NOT EXISTS image_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(120),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_receipts_user_fingerprint
  ON public.receipts(user_id, content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_user_purchased
  ON public.receipts(user_id, purchased_at DESC);

-- 2. Tabel linii de bon (receipt_items) - strict izolat per utilizator
CREATE TABLE IF NOT EXISTS public.receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id VARCHAR(64) REFERENCES public.products(id) ON DELETE SET NULL,
  raw_name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255),
  ean_code VARCHAR(32),
  internal_code VARCHAR(64),
  quantity NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(16) NOT NULL DEFAULT 'buc',
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total_price NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
  discount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_rate NUMERIC(5,2),
  is_weighted BOOLEAN NOT NULL DEFAULT FALSE,
  is_sgr BOOLEAN NOT NULL DEFAULT FALSE,
  confidence_score NUMERIC(5,2),
  confidence_details JSONB,
  math_valid BOOLEAN NOT NULL DEFAULT TRUE,
  match_status VARCHAR(24) NOT NULL DEFAULT 'unmatched',
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_line_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_user_receipt
  ON public.receipt_items(user_id, receipt_id);

CREATE INDEX IF NOT EXISTS idx_receipt_items_product
  ON public.receipt_items(user_id, product_id)
  WHERE product_id IS NOT NULL;

-- 3. Tabel observații personale de preț (user_price_observations)
-- Stochează exclusiv istoricul privat al utilizatorului; NU afectează catalogul public!
CREATE TABLE IF NOT EXISTS public.user_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  receipt_item_id UUID REFERENCES public.receipt_items(id) ON DELETE CASCADE,
  product_id VARCHAR(64) REFERENCES public.products(id) ON DELETE SET NULL,
  product_name VARCHAR(255) NOT NULL,
  store_id VARCHAR(64) REFERENCES public.stores(id) ON DELETE SET NULL,
  store_name VARCHAR(128) NOT NULL,
  purchase_date DATE NOT NULL,
  quantity NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(16) NOT NULL DEFAULT 'buc',
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  discount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  effective_paid_unit_price NUMERIC(10,2) NOT NULL CHECK (effective_paid_unit_price >= 0),
  total_paid NUMERIC(10,2) NOT NULL CHECK (total_paid >= 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'RON',
  source_receipt_label VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_price_obs_user_date
  ON public.user_price_observations(user_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_user_price_obs_user_product
  ON public.user_price_observations(user_id, product_id, purchase_date DESC)
  WHERE product_id IS NOT NULL;

-- 4. Row Level Security (RLS) strict pe tabelele personale
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_price_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipts_owner_all ON public.receipts;
CREATE POLICY receipts_owner_all
  ON public.receipts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS receipt_items_owner_all ON public.receipt_items;
CREATE POLICY receipt_items_owner_all
  ON public.receipt_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_price_observations_owner_all ON public.user_price_observations;
CREATE POLICY user_price_observations_owner_all
  ON public.user_price_observations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Bucket privat Storage pentru imagini bonuri fiscale (public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipt-images',
  'receipt-images',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS receipt_images_owner_select ON storage.objects;
CREATE POLICY receipt_images_owner_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipt-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS receipt_images_owner_insert ON storage.objects;
CREATE POLICY receipt_images_owner_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipt-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS receipt_images_owner_delete ON storage.objects;
CREATE POLICY receipt_images_owner_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'receipt-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6. Funcție tranzacțională atomică save_receipt_v2
CREATE OR REPLACE FUNCTION public.save_receipt_v2(
  p_receipt JSONB,
  p_items JSONB,
  p_observations JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_receipt_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autentificare necesară pentru salvarea bonului.';
  END IF;

  v_receipt_id := COALESCE((p_receipt->>'id')::UUID, gen_random_uuid());

  INSERT INTO public.receipts (
    id, user_id, store_id, image_path, merchant_name, purchased_at,
    total_amount, currency, extracted_data, status,
    receipt_number, payment_method, sgr_total, coupons_total, vat_total,
    printed_total, calculated_total, discrepancy_amount, validation_status,
    validation_reasons, confidence_scores, raw_ocr_text,
    original_extracted_data, user_corrections, image_paths,
    content_fingerprint, processed_at
  )
  VALUES (
    v_receipt_id,
    v_uid,
    NULLIF(p_receipt->>'store_id', ''),
    NULLIF(p_receipt->>'image_path', ''),
    COALESCE(p_receipt->>'merchant_name', 'Magazin'),
    COALESCE((p_receipt->>'purchased_at')::TIMESTAMPTZ, NOW()),
    COALESCE((p_receipt->>'total_amount')::NUMERIC, 0),
    COALESCE(p_receipt->>'currency', 'RON'),
    COALESCE(p_receipt->'extracted_data', '{}'::jsonb),
    COALESCE(p_receipt->>'status', 'processed'),
    NULLIF(p_receipt->>'receipt_number', ''),
    NULLIF(p_receipt->>'payment_method', ''),
    COALESCE((p_receipt->>'sgr_total')::NUMERIC, 0),
    COALESCE((p_receipt->>'coupons_total')::NUMERIC, 0),
    NULLIF(p_receipt->>'vat_total', '')::NUMERIC,
    NULLIF(p_receipt->>'printed_total', '')::NUMERIC,
    NULLIF(p_receipt->>'calculated_total', '')::NUMERIC,
    COALESCE((p_receipt->>'discrepancy_amount')::NUMERIC, 0),
    COALESCE(p_receipt->>'validation_status', 'VALID'),
    COALESCE(p_receipt->'validation_reasons', '[]'::jsonb),
    COALESCE(p_receipt->'confidence_scores', '{}'::jsonb),
    NULLIF(p_receipt->>'raw_ocr_text', ''),
    p_receipt->'original_extracted_data',
    p_receipt->'user_corrections',
    COALESCE(p_receipt->'image_paths', '[]'::jsonb),
    NULLIF(p_receipt->>'content_fingerprint', ''),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    store_id = EXCLUDED.store_id,
    image_path = COALESCE(EXCLUDED.image_path, public.receipts.image_path),
    merchant_name = EXCLUDED.merchant_name,
    purchased_at = EXCLUDED.purchased_at,
    total_amount = EXCLUDED.total_amount,
    extracted_data = EXCLUDED.extracted_data,
    status = EXCLUDED.status,
    receipt_number = EXCLUDED.receipt_number,
    payment_method = EXCLUDED.payment_method,
    sgr_total = EXCLUDED.sgr_total,
    coupons_total = EXCLUDED.coupons_total,
    vat_total = EXCLUDED.vat_total,
    printed_total = EXCLUDED.printed_total,
    calculated_total = EXCLUDED.calculated_total,
    discrepancy_amount = EXCLUDED.discrepancy_amount,
    validation_status = EXCLUDED.validation_status,
    validation_reasons = EXCLUDED.validation_reasons,
    confidence_scores = EXCLUDED.confidence_scores,
    raw_ocr_text = EXCLUDED.raw_ocr_text,
    original_extracted_data = EXCLUDED.original_extracted_data,
    user_corrections = EXCLUDED.user_corrections,
    image_paths = EXCLUDED.image_paths,
    content_fingerprint = EXCLUDED.content_fingerprint,
    processed_at = NOW()
  WHERE public.receipts.user_id = v_uid;

  DELETE FROM public.receipt_items
  WHERE receipt_id = v_receipt_id AND user_id = v_uid;

  INSERT INTO public.receipt_items (
    receipt_id, user_id, product_id, raw_name, normalized_name,
    ean_code, internal_code, quantity, unit, unit_price, total_price,
    discount, vat_rate, is_weighted, is_sgr, confidence_score,
    confidence_details, math_valid, match_status, provenance, raw_line_text
  )
  SELECT
    v_receipt_id,
    v_uid,
    NULLIF(item->>'product_id', ''),
    COALESCE(item->>'raw_name', 'Produs'),
    NULLIF(item->>'normalized_name', ''),
    NULLIF(item->>'ean_code', ''),
    NULLIF(item->>'internal_code', ''),
    COALESCE((item->>'quantity')::NUMERIC, 1),
    COALESCE(item->>'unit', 'buc'),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'total_price')::NUMERIC, 0),
    COALESCE((item->>'discount')::NUMERIC, 0),
    NULLIF(item->>'vat_rate', '')::NUMERIC,
    COALESCE((item->>'is_weighted')::BOOLEAN, FALSE),
    COALESCE((item->>'is_sgr')::BOOLEAN, FALSE),
    NULLIF(item->>'confidence_score', '')::NUMERIC,
    item->'confidence_details',
    COALESCE((item->>'math_valid')::BOOLEAN, TRUE),
    COALESCE(item->>'match_status', 'unmatched'),
    COALESCE(item->'provenance', '{}'::jsonb),
    NULLIF(item->>'raw_line_text', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item;

  DELETE FROM public.user_price_observations
  WHERE receipt_id = v_receipt_id AND user_id = v_uid;

  INSERT INTO public.user_price_observations (
    user_id, receipt_id, product_id, product_name, store_id, store_name,
    purchase_date, quantity, unit, unit_price, discount,
    effective_paid_unit_price, total_paid, currency, source_receipt_label
  )
  SELECT
    v_uid,
    v_receipt_id,
    NULLIF(obs->>'product_id', ''),
    COALESCE(obs->>'product_name', 'Produs'),
    NULLIF(obs->>'store_id', ''),
    COALESCE(obs->>'store_name', 'Magazin'),
    COALESCE((obs->>'purchase_date')::DATE, CURRENT_DATE),
    COALESCE((obs->>'quantity')::NUMERIC, 1),
    COALESCE(obs->>'unit', 'buc'),
    COALESCE((obs->>'unit_price')::NUMERIC, 0),
    COALESCE((obs->>'discount')::NUMERIC, 0),
    COALESCE((obs->>'effective_paid_unit_price')::NUMERIC, 0),
    COALESCE((obs->>'total_paid')::NUMERIC, 0),
    'RON',
    NULLIF(obs->>'source_receipt_label', '')
  FROM jsonb_array_elements(COALESCE(p_observations, '[]'::jsonb)) AS obs;

  RETURN v_receipt_id;
END;
$$;
