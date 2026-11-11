ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS canonical_product_id VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_canonical_product_id_fkey'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_canonical_product_id_fkey
      FOREIGN KEY (canonical_product_id) REFERENCES public.products(id);
  END IF;
END $$;

WITH ranked_products AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY
        lower(btrim(name)),
        lower(btrim(coalesce(brand, ''))),
        package_weight_or_volume,
        lower(btrim(coalesce(package_unit, ''))),
        lower(btrim(coalesce(barcode, '')))
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY
        lower(btrim(name)),
        lower(btrim(coalesce(brand, ''))),
        package_weight_or_volume,
        lower(btrim(coalesce(package_unit, ''))),
        lower(btrim(coalesce(barcode, '')))
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM public.products
  WHERE canonical_product_id IS NULL
)
UPDATE public.products AS product
SET canonical_product_id = ranked.canonical_id
FROM ranked_products AS ranked
WHERE ranked.id = product.id
  AND ranked.duplicate_rank > 1;

CREATE INDEX IF NOT EXISTS products_canonical_product_id_idx
  ON public.products (canonical_product_id)
  WHERE canonical_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_canonical_identity_unique
  ON public.products (
    lower(btrim(name)),
    lower(btrim(coalesce(brand, ''))),
    package_weight_or_volume,
    lower(btrim(coalesce(package_unit, ''))),
    lower(btrim(coalesce(barcode, '')))
  )
  WHERE canonical_product_id IS NULL;

ALTER TABLE public.price_observations
  DROP CONSTRAINT IF EXISTS uq_daily_price_obs;
