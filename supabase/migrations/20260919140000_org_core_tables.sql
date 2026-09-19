/*
# Organizer Phase A (additive) — organization tables

Creates the tables the organizer model is built on. Purely additive: nothing
existing reads or writes these, and no policy on an existing table changes, so
the running Professional/Attendee app is unaffected.

## Why membership tables rather than a role column
Rally authorizes everything today by ownership (`owner_id = auth.uid()`). An
event owned by an organization and run by several people with different powers
cannot be expressed that way, so authority is carried by membership rows
instead. There is no "organizer account": the same Rally user attends events and
runs them, and organizer power is conferred entirely by rows here.

Two levels of grant:
- `organization_members` — authority over every event the organization owns.
- `event_team` — one event only, for a manager with no organization-wide rights.
  This is what lets several people run the same event without handing them the
  organization.

## Invitations
Per the v1 decision, teammates are invited by picking an existing Rally user, so
`organization_invitations` carries `invited_user_id` and there is no email,
token or expiry machinery. Email invitations for people without accounts are
deliberately out of scope.
*/

-- ============================================================================
-- Role enum
-- ============================================================================
DO $$
BEGIN
  CREATE TYPE org_role AS ENUM ('owner', 'admin', 'manager');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ============================================================================
-- organizations
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  description text DEFAULT '',
  logo_url text DEFAULT '',
  website text DEFAULT '',
  -- Audit only. Authority lives in organization_members so ownership can be
  -- transferred without rewriting this row.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT organizations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT organizations_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  -- Same rule the profile links already carry.
  CONSTRAINT organizations_website_safe_url CHECK (
    website IS NULL OR website = '' OR website ~* '^https?://'
  )
);

-- ============================================================================
-- organization_members — the authorization table
-- ============================================================================
CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'manager',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- Every policy check starts from auth.uid(), so lead with user_id.
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);

-- ============================================================================
-- event_team — per-event grant for managers
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_team_user ON event_team(user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_event_team_event ON event_team(event_id);

-- ============================================================================
-- organization_invitations — existing Rally users only (v1 decision)
-- ============================================================================
CREATE TABLE IF NOT EXISTS organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'manager',
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  -- One row per person per organization. Re-inviting someone who declined
  -- updates this row back to pending rather than accumulating history.
  UNIQUE (organization_id, invited_user_id),
  CONSTRAINT organization_invitations_status_allowed CHECK (
    status IN ('pending', 'accepted', 'declined', 'revoked')
  )
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_user ON organization_invitations(invited_user_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(organization_id, status);
