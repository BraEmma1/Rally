/*
# Account type foundation

Introduces the fixed primary account type that determines a user's dashboard and
onboarding. Additive: every existing user becomes an attendee with exactly the
access they have today, and no existing policy changes.

## Why this is not a column on profiles
`profiles` carries `update_own_profile`, which lets a user update any column of
their own row. An `account_type` there would be self-assignable — any user could
PATCH themselves to platform_admin. The authoritative value therefore lives in a
table with no client write path at all, the same shape as organization_members.

## Why signup metadata is not trusted
`handle_new_user` reads `raw_user_meta_data`, which is populated from
`options.data` in the client's signUp() call and is therefore attacker
controlled. The trigger whitelists what it will accept:

  requested            -> result
  (nothing)/attendee   -> attendee, active
  organizer            -> organizer, pending_approval
  vendor / sponsor     -> attendee  (these require an organizer's invitation)
  platform_admin       -> attendee  (never self-serve, under any circumstances)

Organizers land pending_approval and gain no organization authority until a
platform admin activates them.
*/

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM ('platform_admin', 'organizer', 'attendee', 'vendor', 'sponsor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('pending_approval', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- user_accounts — authoritative account type
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_type account_type NOT NULL DEFAULT 'attendee',
  status account_status NOT NULL DEFAULT 'active',
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_type_status ON user_accounts(account_type, status);

-- Audit trail. Promotion to platform_admin leaves no other trace in the schema.
CREATE TABLE IF NOT EXISTS account_type_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_type account_type,
  new_type account_type,
  previous_status account_status,
  new_status account_status,
  reason text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_type_changes_user ON account_type_changes(user_id, created_at DESC);

-- ============================================================================
-- Backfill: every existing user keeps exactly the access they have today
-- ============================================================================
INSERT INTO user_accounts (user_id, account_type, status)
SELECT u.id, 'attendee', 'active'
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- Helpers. pg_temp is pinned: Postgres searches the temp schema first for
-- relation names unless it is listed explicitly, which would let a session that
-- can create temp tables shadow the tables these definer functions read.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_account_type()
RETURNS account_type
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT a.account_type FROM user_accounts a WHERE a.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_accounts a
    WHERE a.user_id = auth.uid()
      AND a.account_type = 'platform_admin'
      AND a.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.account_is_active()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_accounts a
    WHERE a.user_id = auth.uid() AND a.status = 'active'
  );
$$;

-- ============================================================================
-- RLS: readable by the owner and by platform admins. No client write path.
-- ============================================================================
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_type_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_account" ON user_accounts;
CREATE POLICY "select_own_account"
  ON user_accounts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS "select_account_changes_as_admin" ON account_type_changes;
CREATE POLICY "select_account_changes_as_admin"
  ON account_type_changes FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

REVOKE ALL ON public.user_accounts FROM anon;
REVOKE ALL ON public.account_type_changes FROM anon;

REVOKE EXECUTE ON FUNCTION public.current_account_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.account_is_active() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_account_type() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_is_active() TO authenticated;

-- ============================================================================
-- Signup: provision the profile and the account, trusting nothing from metadata
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested text;
  v_type account_type;
  v_status account_status;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;

  v_requested := lower(btrim(COALESCE(NEW.raw_user_meta_data->>'account_type', '')));

  -- Only attendee and organizer are self-serve. vendor and sponsor require an
  -- organizer's invitation; platform_admin is never reachable from signup.
  IF v_requested = 'organizer' THEN
    v_type := 'organizer';
    v_status := 'pending_approval';
  ELSE
    v_type := 'attendee';
    v_status := 'active';
  END IF;

  INSERT INTO public.user_accounts (user_id, account_type, status)
  VALUES (NEW.id, v_type, v_status)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
