/*
# Organization access rules

Binds the organization model to the account type model.

## What was wrong
Phase A's `insert_own_organization` allowed ANY authenticated user to create an
organization and become its owner. That was written under the old "one identity,
additive capability" premise and directly contradicts the requirement that
attendees cannot create organizations and that organizers need admin approval
before receiving organization authority.

## What replaces it
Only an active organizer may create an organization, and only an organizer-type
one. Vendor and sponsor organizations are not created by a client insert at all —
they come from an organizer's invitation, through a definer function, which is
why no client INSERT path for them exists here.

Two triggers enforce the rest at the database level rather than in the UI:
- a member's account type must suit the organization they are joining, which is
  what keeps attendees out of organization_members entirely;
- an event may only belong to an organizer organization.
*/

-- ============================================================================
-- organizations: type and approval
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE org_type AS ENUM ('organizer', 'vendor', 'sponsor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE org_approval_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS org_type org_type NOT NULL DEFAULT 'organizer',
  ADD COLUMN IF NOT EXISTS approval_status org_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_organizations_type_status ON organizations(org_type, approval_status);

-- ============================================================================
-- Only active organizers may create organizations
-- ============================================================================
DROP POLICY IF EXISTS "insert_own_organization" ON organizations;

DROP POLICY IF EXISTS "insert_organization_as_organizer" ON organizations;
CREATE POLICY "insert_organization_as_organizer"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND org_type = 'organizer'
    AND public.current_account_type() = 'organizer'
    AND public.account_is_active()
  );

-- ============================================================================
-- Membership must suit the organization
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_member_account_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_account account_type;
  v_org org_type;
BEGIN
  SELECT a.account_type INTO v_account FROM user_accounts a WHERE a.user_id = NEW.user_id;
  SELECT o.org_type INTO v_org FROM organizations o WHERE o.id = NEW.organization_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'User has no account record and cannot join an organization';
  END IF;

  -- Attendees and platform admins never hold organization membership. An
  -- attendee with a membership row would be an organizer in all but name.
  IF v_account IN ('attendee', 'platform_admin') THEN
    RAISE EXCEPTION 'An % account cannot be a member of an organization', v_account;
  END IF;

  IF v_org IS NOT NULL AND v_account::text <> v_org::text THEN
    RAISE EXCEPTION 'A % account cannot join a % organization', v_account, v_org;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_member_account_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_member_account_type ON organization_members;
CREATE TRIGGER check_member_account_type
  BEFORE INSERT OR UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_account_type();

-- ============================================================================
-- Events belong only to organizer organizations
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_owner_org_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org org_type;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;  -- still permitted until Phase C makes the column NOT NULL
  END IF;

  SELECT o.org_type INTO v_org FROM organizations o WHERE o.id = NEW.organization_id;

  IF v_org IS DISTINCT FROM 'organizer' THEN
    RAISE EXCEPTION 'Events may only be owned by an organizer organization';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_owner_org_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_owner_org_type ON events;
CREATE TRIGGER check_event_owner_org_type
  BEFORE INSERT OR UPDATE OF organization_id ON events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_owner_org_type();

-- ============================================================================
-- Creating an organization must name its creator
--
-- The Phase A trigger used COALESCE(NEW.created_by, auth.uid()); in a migration
-- both are NULL, which surfaced as an opaque NOT NULL violation. Fail loudly
-- instead, so Phase B is told what it has to supply.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
BEGIN
  v_owner := COALESCE(NEW.created_by, auth.uid());

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'organizations.created_by must be set when creating an organization outside a user session';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (NEW.id, v_owner, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_organization() FROM PUBLIC, anon, authenticated;
