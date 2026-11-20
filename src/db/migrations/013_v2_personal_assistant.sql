-- =========================================================================
-- Coșul Meu V2 Migration: Personal Assistant (Budget, Shared Lists, Barcode Suggestions)
-- Idempotent / Non-destructive additive schema migration
-- Does NOT drop, truncate, or delete existing V1 user or catalog data.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================================
-- 1. Personal Budget columns on public.user_preferences
-- =========================================================================
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS weekly_budget NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS budget_alert_threshold_pct SMALLINT NOT NULL DEFAULT 80;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_monthly_budget_check'
      AND conrelid = 'public.user_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_monthly_budget_check
      CHECK (monthly_budget IS NULL OR monthly_budget >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_weekly_budget_check'
      AND conrelid = 'public.user_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_weekly_budget_check
      CHECK (weekly_budget IS NULL OR weekly_budget >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_budget_threshold_check'
      AND conrelid = 'public.user_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_budget_threshold_check
      CHECK (budget_alert_threshold_pct BETWEEN 10 AND 100);
  END IF;
END $$;

-- =========================================================================
-- 2. Shared Shopping Lists: Members, Invites, Activity Log & Realtime RLS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.shopping_list_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.shopping_lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  display_name TEXT,
  email_masked TEXT,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shopping_list_member UNIQUE (list_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_members_user
  ON public.shopping_list_members (user_id, list_id);

CREATE INDEX IF NOT EXISTS idx_shopping_list_members_list_role
  ON public.shopping_list_members (list_id, role);

CREATE TABLE IF NOT EXISTS public.shopping_list_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.shopping_lists(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  invited_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses SMALLINT NOT NULL DEFAULT 5 CHECK (max_uses >= 1 AND max_uses <= 50),
  uses_count SMALLINT NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_invites_list
  ON public.shopping_list_invites (list_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.shopping_list_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.shopping_lists(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT 'Utilizator',
  action_type VARCHAR(40) NOT NULL CHECK (
    action_type IN (
      'list_shared',
      'member_joined',
      'member_role_changed',
      'member_revoked',
      'item_added',
      'item_updated',
      'item_checked',
      'item_unchecked',
      'item_removed',
      'list_renamed'
    )
  ),
  target_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_activity_list_date
  ON public.shopping_list_activity (list_id, created_at DESC);

-- =========================================================================
-- 3. Recursion-free SECURITY DEFINER RLS helpers for Shared Lists
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_shopping_list_owner(p_list_id UUID, p_uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shopping_lists sl
    WHERE sl.id = p_list_id
      AND sl.user_id = COALESCE(p_uid, auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.shopping_list_members slm
    WHERE slm.list_id = p_list_id
      AND slm.user_id = COALESCE(p_uid, auth.uid())
      AND slm.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_shopping_list(p_list_id UUID, p_uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_shopping_list_owner(p_list_id, p_uid)
  OR EXISTS (
    SELECT 1
    FROM public.shopping_list_members slm
    WHERE slm.list_id = p_list_id
      AND slm.user_id = COALESCE(p_uid, auth.uid())
      AND slm.role IN ('owner', 'editor', 'viewer')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_shopping_list(p_list_id UUID, p_uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_shopping_list_owner(p_list_id, p_uid)
  OR EXISTS (
    SELECT 1
    FROM public.shopping_list_members slm
    WHERE slm.list_id = p_list_id
      AND slm.user_id = COALESCE(p_uid, auth.uid())
      AND slm.role IN ('owner', 'editor')
  );
$$;

REVOKE ALL ON FUNCTION public.is_shopping_list_owner(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_shopping_list(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_shopping_list(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shopping_list_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_shopping_list(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_shopping_list(UUID, UUID) TO authenticated;

-- Enable RLS on existing shopping list tables + new collaboration tables
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_activity ENABLE ROW LEVEL SECURITY;

-- Shared SELECT policy on shopping_lists (members can view shared lists)
DROP POLICY IF EXISTS shopping_lists_shared_select ON public.shopping_lists;
CREATE POLICY shopping_lists_shared_select
  ON public.shopping_lists
  FOR SELECT
  TO authenticated
  USING (public.can_access_shopping_list(id, auth.uid()));

-- Owner full management on shopping_lists
DROP POLICY IF EXISTS shopping_lists_owner_insert ON public.shopping_lists;
CREATE POLICY shopping_lists_owner_insert
  ON public.shopping_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS shopping_lists_owner_update ON public.shopping_lists;
CREATE POLICY shopping_lists_owner_update
  ON public.shopping_lists
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS shopping_lists_owner_delete ON public.shopping_lists;
CREATE POLICY shopping_lists_owner_delete
  ON public.shopping_lists
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Shared policies on shopping_list_items: viewers read, editors & owners read/write
DROP POLICY IF EXISTS shopping_list_items_shared_select ON public.shopping_list_items;
CREATE POLICY shopping_list_items_shared_select
  ON public.shopping_list_items
  FOR SELECT
  TO authenticated
  USING (public.can_access_shopping_list(list_id, auth.uid()));

DROP POLICY IF EXISTS shopping_list_items_shared_insert ON public.shopping_list_items;
CREATE POLICY shopping_list_items_shared_insert
  ON public.shopping_list_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_shopping_list(list_id, auth.uid()));

DROP POLICY IF EXISTS shopping_list_items_shared_update ON public.shopping_list_items;
CREATE POLICY shopping_list_items_shared_update
  ON public.shopping_list_items
  FOR UPDATE
  TO authenticated
  USING (public.can_edit_shopping_list(list_id, auth.uid()))
  WITH CHECK (public.can_edit_shopping_list(list_id, auth.uid()));

DROP POLICY IF EXISTS shopping_list_items_shared_delete ON public.shopping_list_items;
CREATE POLICY shopping_list_items_shared_delete
  ON public.shopping_list_items
  FOR DELETE
  TO authenticated
  USING (public.can_edit_shopping_list(list_id, auth.uid()));

-- Policies on shopping_list_members
DROP POLICY IF EXISTS shopping_list_members_select ON public.shopping_list_members;
CREATE POLICY shopping_list_members_select
  ON public.shopping_list_members
  FOR SELECT
  TO authenticated
  USING (public.can_access_shopping_list(list_id, auth.uid()));

DROP POLICY IF EXISTS shopping_list_members_owner_manage ON public.shopping_list_members;
CREATE POLICY shopping_list_members_owner_manage
  ON public.shopping_list_members
  FOR ALL
  TO authenticated
  USING (public.is_shopping_list_owner(list_id, auth.uid()))
  WITH CHECK (public.is_shopping_list_owner(list_id, auth.uid()));

DROP POLICY IF EXISTS shopping_list_members_self_leave ON public.shopping_list_members;
CREATE POLICY shopping_list_members_self_leave
  ON public.shopping_list_members
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND role <> 'owner');

-- Policies on shopping_list_invites (strictly owner-managed; invite tokens accepted via server API)
DROP POLICY IF EXISTS shopping_list_invites_owner_manage ON public.shopping_list_invites;
CREATE POLICY shopping_list_invites_owner_manage
  ON public.shopping_list_invites
  FOR ALL
  TO authenticated
  USING (public.is_shopping_list_owner(list_id, auth.uid()))
  WITH CHECK (public.is_shopping_list_owner(list_id, auth.uid()));

-- Policies on shopping_list_activity (members can read; editors/owners can log item changes)
DROP POLICY IF EXISTS shopping_list_activity_select ON public.shopping_list_activity;
CREATE POLICY shopping_list_activity_select
  ON public.shopping_list_activity
  FOR SELECT
  TO authenticated
  USING (public.can_access_shopping_list(list_id, auth.uid()));

DROP POLICY IF EXISTS shopping_list_activity_insert ON public.shopping_list_activity;
CREATE POLICY shopping_list_activity_insert
  ON public.shopping_list_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_edit_shopping_list(list_id, auth.uid())
    AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
  );

-- Enable Supabase Realtime on shared list tables (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_lists;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_list_items;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_list_members;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_list_activity;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- =========================================================================
-- 4. Barcode Product Suggestions Staging Table (moderation-first, NEVER auto-publishes)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.product_barcode_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  barcode VARCHAR(32) NOT NULL,
  proposed_name VARCHAR(255) NOT NULL,
  proposed_brand VARCHAR(128),
  category VARCHAR(64) NOT NULL DEFAULT 'Alte produse',
  package_weight_or_volume NUMERIC(10, 3),
  package_unit VARCHAR(16),
  observed_store_id VARCHAR(64) REFERENCES public.stores(id) ON DELETE SET NULL,
  observed_price NUMERIC(10, 2) CHECK (observed_price IS NULL OR observed_price > 0),
  notes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_barcode_suggestions_barcode
  ON public.product_barcode_suggestions (barcode, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barcode_suggestions_user
  ON public.product_barcode_suggestions (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.product_barcode_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barcode_suggestions_insert_own ON public.product_barcode_suggestions;
CREATE POLICY barcode_suggestions_insert_own
  ON public.product_barcode_suggestions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS barcode_suggestions_select_own ON public.product_barcode_suggestions;
CREATE POLICY barcode_suggestions_select_own
  ON public.product_barcode_suggestions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
