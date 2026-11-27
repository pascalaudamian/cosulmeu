-- ============================================================================
-- PROPUNERE MIGRARE FAZA 7.1 — SECURITY CLOSURE AUDIT & RLS HARDENING
-- STATUS: NEEXECUTATĂ AUTOMAT. Necesită revizie și aplicare manuală în Supabase.
-- ============================================================================
-- Obiective:
--   1. Verificări pre-migrare (precondiții și audit de stare fără mutații).
--   2. Eliminarea escaladării admin din handle_new_user_profile() și întărirea
--      protect_profile_role() pe BEFORE INSERT OR UPDATE cu SET search_path = public.
--   3. Întărirea politicii profiles_insert_policy (role = 'user' pentru clienți).
--   4. Activarea RLS strictă (zero acces anon/authenticated, exclusiv service_role)
--      pe app_users, app_sessions, receipt_products și tabelele operaționale/admin.
--   5. Activarea RLS pe tabelele catalogului cu citire publică justificată
--      EXCLUSIV pe stores, products și product_offers (verificate și neanomalii),
--      blocând orice scriere (INSERT/UPDATE/DELETE) din anon/authenticated.
--   6. Securizarea view-ului public.retailers (security_invoker = true).
--   7. Verificări post-migrare (assert RLS, politici și search_path).
--   8. Bloc de rollback sigur (nu redeschide escaladarea is_admin).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PAS 1: VERIFICĂRI PRE-MIGRARE (READ-ONLY DIAGNOSTICS)
-- ============================================================================
DO $$
DECLARE
  v_missing_rls_count INTEGER := 0;
  v_admin_count INTEGER := 0;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Pre-check eșuat: tabela public.profiles nu există.';
  END IF;

  SELECT count(*) INTO v_admin_count
  FROM public.profiles
  WHERE role = 'admin';

  SELECT count(*) INTO v_missing_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'app_users', 'app_sessions', 'receipt_products',
      'stores', 'products', 'product_offers', 'price_observations', 'promotions',
      'data_sources', 'product_match_candidates', 'source_sync_runs',
      'retailer_collectors', 'indexing_locks', 'retailer_products',
      'product_matches', 'indexing_jobs', 'indexing_runs',
      'quality_anomalies', 'quality_recollection_queue', 'daily_quality_reports',
      'catalog_sources', 'catalog_documents', 'catalog_import_runs',
      'catalog_extracted_offers', 'catalog_import_errors'
    )
    AND c.relrowsecurity = false;

  RAISE NOTICE '[PRE-CHECK] Profiluri admin existente: %, Tabele țintă fără RLS activ: %', v_admin_count, v_missing_rls_count;
END $$;

-- ============================================================================
-- PAS 2: SECURIZAREA TRIGGERELOR ȘI POLITICILOR PENTRU PROFILES / ADMIN
-- ============================================================================
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean := (
    current_user IN ('service_role', 'postgres', 'supabase_admin')
    OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_privileged THEN
      NEW.role := 'user';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_privileged THEN
      NEW.role := OLD.role;
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  initial_role VARCHAR(16) := 'user';
  initial_username TEXT;
  marketing_opt_in BOOLEAN := COALESCE((new.raw_user_meta_data ->> 'marketing_consent')::boolean, FALSE);
BEGIN
  -- Rolul inițial este ÎNTOTDEAUNA 'user'. Nicio cheie din raw_user_meta_data nu poate acorda 'admin'.
  initial_username := COALESCE(
    new.raw_user_meta_data ->> 'username',
    split_part(new.email, '@', 1) || '_' || substr(md5(random()::text), 1, 4)
  );

  INSERT INTO public.profiles (
    id, first_name, last_name, display_name, username, avatar_url,
    role, phone, phone_number, city, preferred_language, preferences
  ) VALUES (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    COALESCE(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    initial_username,
    new.raw_user_meta_data ->> 'avatar_url',
    initial_role,
    new.raw_user_meta_data ->> 'phone',
    COALESCE(new.raw_user_meta_data ->> 'phone_number', new.raw_user_meta_data ->> 'phone'),
    COALESCE(new.raw_user_meta_data ->> 'city', 'București'),
    COALESCE(new.raw_user_meta_data ->> 'preferred_language', 'ro'),
    '{}'::jsonb
  ) ON CONFLICT (id) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
    first_name = COALESCE(profiles.first_name, EXCLUDED.first_name),
    last_name = COALESCE(profiles.last_name, EXCLUDED.last_name),
    username = COALESCE(profiles.username, EXCLUDED.username),
    role = profiles.role,
    updated_at = NOW();

  INSERT INTO public.user_preferences (
    user_id, language, notifications_enabled, price_alerts_enabled,
    optional_notifications_enabled, marketing_consent, marketing_consent_updated_at
  ) VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'preferred_language', 'ro'),
    FALSE, FALSE, FALSE,
    marketing_opt_in,
    CASE WHEN marketing_opt_in THEN NOW() ELSE NULL END
  ) ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT
  USING (auth.uid() = id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS profiles_insert_policy ON public.profiles;
CREATE POLICY profiles_insert_policy ON public.profiles
  FOR INSERT
  WITH CHECK (
    (auth.uid() = id AND COALESCE(role, 'user') = 'user')
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id OR auth.role() = 'service_role')
  WITH CHECK (auth.uid() = id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS profiles_delete_policy ON public.profiles;
CREATE POLICY profiles_delete_policy ON public.profiles
  FOR DELETE
  USING (auth.uid() = id OR auth.role() = 'service_role');

-- ============================================================================
-- PAS 3: IZOLARE STRICTĂ AUTENTIFICARE INTERNĂ & BONURI SCRAPING
-- (Fără politici anon/authenticated; acces permis exclusiv service_role / PG owner)
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['app_users', 'app_sessions', 'receipt_products']
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_service_role_all', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl || '_service_role_all',
        tbl
      );
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- PAS 4: CATALOG PUBLIC — CITIRE PUBLICĂ NUMAI UNDE ESTE JUSTIFICATĂ REAL
-- (`stores`, `products`, `product_offers` verificate; ZERO scriere anon/authenticated)
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.stores') IS NOT NULL THEN
    ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS stores_public_read ON public.stores;
    CREATE POLICY stores_public_read ON public.stores
      FOR SELECT TO anon, authenticated USING (true);
    DROP POLICY IF EXISTS stores_service_role_all ON public.stores;
    CREATE POLICY stores_service_role_all ON public.stores
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.stores FROM anon, authenticated;
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS products_public_read ON public.products;
    CREATE POLICY products_public_read ON public.products
      FOR SELECT TO anon, authenticated USING (true);
    DROP POLICY IF EXISTS products_service_role_all ON public.products;
    CREATE POLICY products_service_role_all ON public.products
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.products FROM anon, authenticated;
  END IF;

  IF to_regclass('public.product_offers') IS NOT NULL THEN
    ALTER TABLE public.product_offers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS product_offers_public_read ON public.product_offers;
    CREATE POLICY product_offers_public_read ON public.product_offers
      FOR SELECT TO anon, authenticated
      USING (verification_status = 'verified' AND is_flagged_anomaly = false);
    DROP POLICY IF EXISTS product_offers_service_role_all ON public.product_offers;
    CREATE POLICY product_offers_service_role_all ON public.product_offers
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.product_offers FROM anon, authenticated;
  END IF;
END $$;

-- View-ul public.retailers respectă RLS-ul tabelei stores (PostgreSQL 15+)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'retailers'
  ) THEN
    EXECUTE 'ALTER VIEW public.retailers SET (security_invoker = true)';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'View public.retailers security_invoker skip: %', SQLERRM;
END $$;

-- ============================================================================
-- PAS 5: IZOLAREA TABELELOR OPERAȚIONALE, ISTORIC INTERN & STAGING
-- (`price_observations`, `promotions` și toate tabelele de indexare/calitate/import)
-- Citirea de către clienți se face exclusiv prin API-ul backend (/api/catalog/*).
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'price_observations', 'promotions',
    'data_sources', 'product_match_candidates', 'source_sync_runs',
    'retailer_collectors', 'indexing_locks', 'retailer_products',
    'product_matches', 'indexing_jobs', 'indexing_runs',
    'quality_anomalies', 'quality_recollection_queue', 'daily_quality_reports',
    'catalog_sources', 'catalog_documents', 'catalog_import_runs',
    'catalog_extracted_offers', 'catalog_import_errors'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_public_read', tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_service_role_all', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl || '_service_role_all',
        tbl
      );
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- PAS 6: VERIFICĂRI POST-MIGRARE (ASSERT INTEGRITATE RLS & TRIGGER)
-- ============================================================================
DO $$
DECLARE
  v_unprotected TEXT[];
  v_unsafe_policies INTEGER := 0;
  v_bad_funcs INTEGER := 0;
BEGIN
  SELECT array_agg(c.relname) INTO v_unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'profiles', 'app_users', 'app_sessions', 'receipt_products',
      'stores', 'products', 'product_offers', 'price_observations', 'promotions',
      'data_sources', 'product_match_candidates', 'source_sync_runs',
      'retailer_collectors', 'indexing_locks', 'retailer_products',
      'product_matches', 'indexing_jobs', 'indexing_runs',
      'quality_anomalies', 'quality_recollection_queue', 'daily_quality_reports',
      'catalog_sources', 'catalog_documents', 'catalog_import_runs',
      'catalog_extracted_offers', 'catalog_import_errors'
    )
    AND c.relrowsecurity = false;

  IF v_unprotected IS NOT NULL AND array_length(v_unprotected, 1) > 0 THEN
    RAISE EXCEPTION 'Post-check eșuat: tabele fără RLS activ: %', v_unprotected;
  END IF;

  SELECT count(*) INTO v_unsafe_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'app_users', 'app_sessions', 'receipt_products',
      'stores', 'products', 'product_offers', 'price_observations', 'promotions',
      'data_sources', 'product_match_candidates', 'source_sync_runs',
      'retailer_collectors', 'indexing_locks', 'retailer_products',
      'product_matches', 'indexing_jobs', 'indexing_runs',
      'quality_anomalies', 'quality_recollection_queue', 'daily_quality_reports',
      'catalog_sources', 'catalog_documents', 'catalog_import_runs',
      'catalog_extracted_offers', 'catalog_import_errors'
    )
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles) OR 'public' = ANY(roles));

  IF v_unsafe_policies > 0 THEN
    RAISE EXCEPTION 'Post-check eșuat: există % politici de scriere expuse spre anon/authenticated.', v_unsafe_policies;
  END IF;

  SELECT count(*) INTO v_bad_funcs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('handle_new_user_profile', 'protect_profile_role')
    AND (p.prosecdef IS NOT TRUE OR p.proconfig IS NULL OR NOT ('search_path=public' = ANY(p.proconfig)));

  IF v_bad_funcs > 0 THEN
    RAISE EXCEPTION 'Post-check eșuat: funcțiile de profil nu au SECURITY DEFINER + search_path=public.';
  END IF;

  RAISE NOTICE '[POST-CHECK] Toate verificările RLS, politici și trigger admin au trecut cu succes.';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK SIGUR (exclusiv manual, dacă o compatibilitate neașteptată o cere)
-- NOTĂ DE SECURITATE: Rollback-ul NU redeschide escaladarea is_admin în trigger,
-- NU elimină RLS de pe app_users / app_sessions / profiles / receipt_products
-- și NU acordă privilegii de scriere către anon/authenticated.
-- Dacă o funcționalitate specifică necesită citire temporară pe price_observations
-- sau promotions pentru authenticated, se acordă exclusiv SELECT read-only:
--
-- BEGIN;
--   GRANT SELECT ON TABLE public.price_observations TO authenticated;
--   DROP POLICY IF EXISTS price_observations_authenticated_read ON public.price_observations;
--   CREATE POLICY price_observations_authenticated_read ON public.price_observations
--     FOR SELECT TO authenticated USING (true);
--
--   GRANT SELECT ON TABLE public.promotions TO authenticated;
--   DROP POLICY IF EXISTS promotions_authenticated_read ON public.promotions;
--   CREATE POLICY promotions_authenticated_read ON public.promotions
--     FOR SELECT TO authenticated USING (ends_at IS NULL OR ends_at >= CURRENT_DATE);
-- COMMIT;
-- ============================================================================
