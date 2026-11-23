/*
# Identity and organization architecture, stage S1: expand

Approach C (RALLY_IDENTITY_ORG_ARCHITECTURE.md, approved as decision D-26)
separates "what a person may do on the platform" and "what an organization may
do" from the mutually exclusive account_type and org_type columns. S1 adds the
new model **alongside** the old one. Nothing reads it yet.

## What this adds
- `platform_roles`: platform privileges, separate from ordinary accounts. One row
  per grant. A revocation sets revoked_at/revoked_by rather than deleting, so
  grant history survives; a partial unique index allows at most one *active*
  grant per (user, role).
- `organization_capabilities`: what an organization may do (`organize_events`,
  `sponsor`, `exhibit`, `supply`), each with a status (`pending`, `active`,
  `suspended`, `revoked`). One row per (organization, capability). An
  organization can hold several; today each holds exactly one.
- `organization_capability_changes`: append-only history of every capability
  status change.
- `org_has_capability(org, capability)`: true only for an *active* capability.
  The helper S2 will build on.
- Two sync triggers that keep the new tables consistent with the old columns
  while the old columns remain authoritative:
    - `user_accounts.account_type` → `platform_roles`
    - `organizations.org_type` / `approval_status` → `organization_capabilities`
- An idempotent backfill of every existing account and organization.
- `identity_s1_drift()`: lists any disagreement between the old columns and the
  new tables (expected: none). For verifying rally-dev after this is applied.

## What this deliberately does NOT do (S2 to S5)
- No existing function, policy, trigger or grant changes. `is_platform_admin()`
  still reads account_type; `enforce_event_owner_org_type` still reads org_type;
  organization membership rules are unchanged. Authorization behaviour is
  identical before and after this migration (the existing SQL suites prove it).
- No client can read or write the new tables or call the new functions. They are
  function-only, like the four existing function-only tables. S2 and S3 add read
  paths, each with its own tests.
- No approval RPC. Approving `organize_events` (decision D-28) arrives with S4.

## Mapping (old columns → new tables)
| account_type   | platform_roles                         |
|----------------|----------------------------------------|
| platform_admin | one active `platform_admin` grant      |
| anything else  | no active grant                        |

| org_type  | capability        |   | approval_status | capability status |
|-----------|-------------------|---|-----------------|-------------------|
| organizer | `organize_events` |   | approved        | active            |
| sponsor   | `sponsor`         |   | pending         | pending           |
| vendor    | `supply`          |   | rejected        | revoked           |
|           |                   |   | suspended       | suspended         |

The status mirrors approval_status literally for every organization type, so a
suspended sponsor organization gets a *suspended* sponsor capability, not an
active one.

A platform_admin account keeps its grant while suspended: account status stays
the gate (`account_is_active()`), as it is for every other permission.

## Data safety
Additive only: three tables, three enum types, five functions, two triggers. No
existing row is updated or deleted; every UUID is preserved. The triggers are
created *before* the backfill, inside this migration's transaction, so a write
racing the migration is either blocked by the trigger's lock or mirrored by the
trigger; the backfill's ON CONFLICT covers both orders. Safe to re-run.

Rollback (if ever needed, separately approved): disable the two sync triggers.
Nothing reads the tables, so leaving them in place is harmless.
*/

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.platform_role AS ENUM ('platform_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.org_capability AS ENUM ('organize_events', 'sponsor', 'exhibit', 'supply');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.org_capability_status AS ENUM ('pending', 'active', 'suspended', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          public.platform_role NOT NULL,
  granted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  grant_reason  text NOT NULL,
  revoked_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoke_reason text,
  CONSTRAINT platform_roles_revocation_complete
    CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT platform_roles_revoked_after_granted
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_roles_one_active_grant
  ON public.platform_roles (user_id, role) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.platform_roles IS
  'Platform privileges, one row per grant (Approach C, stage S1). A revocation sets revoked_at; rows are never deleted. Mirrored from user_accounts.account_type by sync_platform_role() until stage S2 makes this table authoritative. No client access.';

CREATE TABLE IF NOT EXISTS public.organization_capabilities (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability      public.org_capability NOT NULL,
  status          public.org_capability_status NOT NULL,
  requested_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, capability)
);

COMMENT ON TABLE public.organization_capabilities IS
  'What an organization may do (Approach C, stage S1). Mirrored from organizations.org_type and approval_status by sync_organization_capability() until stage S2 makes this table authoritative. No client access.';

CREATE TABLE IF NOT EXISTS public.organization_capability_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Strict order of changes. Timestamps alone cannot order two changes made in
  -- the same instant (an organization type change revokes one capability and
  -- creates another in the same statement).
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability      public.org_capability NOT NULL,
  previous_status public.org_capability_status,   -- NULL: the capability was created
  new_status      public.org_capability_status NOT NULL,
  changed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT organization_capability_changes_is_a_change
    CHECK (previous_status IS DISTINCT FROM new_status)
);

CREATE INDEX IF NOT EXISTS organization_capability_changes_by_org
  ON public.organization_capability_changes (organization_id, seq);

COMMENT ON TABLE public.organization_capability_changes IS
  'Append-only history of organization capability status changes (Approach C, stage S1). No client access.';

-- Function-only tables: RLS on, no policies, no client privileges.
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_capability_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_capabilities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_capability_changes FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mapping helpers (internal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capability_for_org_type(t public.org_type)
RETURNS public.org_capability
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE t
    WHEN 'organizer' THEN 'organize_events'::public.org_capability
    WHEN 'sponsor'   THEN 'sponsor'::public.org_capability
    WHEN 'vendor'    THEN 'supply'::public.org_capability
  END;
$$;

CREATE OR REPLACE FUNCTION public.capability_status_for_approval(s public.org_approval_status)
RETURNS public.org_capability_status
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE s
    WHEN 'approved'  THEN 'active'::public.org_capability_status
    WHEN 'pending'   THEN 'pending'::public.org_capability_status
    WHEN 'rejected'  THEN 'revoked'::public.org_capability_status
    WHEN 'suspended' THEN 'suspended'::public.org_capability_status
  END;
$$;

-- ---------------------------------------------------------------------------
-- org_has_capability: the helper stage S2 will build on. Internal in S1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_has_capability(org_id uuid, cap public.org_capability)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_capabilities c
    WHERE c.organization_id = org_id
      AND c.capability = cap
      AND c.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.org_has_capability(uuid, public.org_capability) IS
  'True only when the organization holds the capability with status active. Stage S1: defined but not yet used by any policy or function, and not client-callable.';

-- ---------------------------------------------------------------------------
-- Sync: user_accounts.account_type -> platform_roles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_platform_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.account_type = 'platform_admin'
     AND (TG_OP = 'INSERT' OR OLD.account_type IS DISTINCT FROM 'platform_admin') THEN
    INSERT INTO public.platform_roles (user_id, role, granted_by, grant_reason)
    VALUES (NEW.user_id, 'platform_admin', auth.uid(), 'mirrored from user_accounts.account_type')
    ON CONFLICT (user_id, role) WHERE revoked_at IS NULL DO NOTHING;

  ELSIF TG_OP = 'UPDATE'
     AND OLD.account_type = 'platform_admin'
     AND NEW.account_type IS DISTINCT FROM 'platform_admin' THEN
    UPDATE public.platform_roles
       SET revoked_at = now(),
           revoked_by = auth.uid(),
           revoke_reason = 'mirrored from user_accounts.account_type'
     WHERE user_id = NEW.user_id
       AND role = 'platform_admin'
       AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER sync_platform_role
  AFTER INSERT OR UPDATE OF account_type ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_platform_role();

-- ---------------------------------------------------------------------------
-- Sync: organizations.org_type / approval_status -> organization_capabilities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_organization_capability()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap    public.org_capability := public.capability_for_org_type(NEW.org_type);
  v_status public.org_capability_status := public.capability_status_for_approval(NEW.approval_status);
  v_old_cap public.org_capability;
  v_prev   public.org_capability_status;
BEGIN
  -- An organization type can only change through the platform's own escape
  -- hatch (enforce_organization_immutable_fields). Retire the old capability.
  IF TG_OP = 'UPDATE' AND NEW.org_type IS DISTINCT FROM OLD.org_type THEN
    v_old_cap := public.capability_for_org_type(OLD.org_type);
    SELECT c.status INTO v_prev FROM public.organization_capabilities c
     WHERE c.organization_id = NEW.id AND c.capability = v_old_cap
     FOR UPDATE;
    IF FOUND AND v_prev <> 'revoked' THEN
      UPDATE public.organization_capabilities
         SET status = 'revoked', decided_by = auth.uid(), decided_at = now(), updated_at = now()
       WHERE organization_id = NEW.id AND capability = v_old_cap;
      INSERT INTO public.organization_capability_changes
        (organization_id, capability, previous_status, new_status, changed_by, reason)
      VALUES (NEW.id, v_old_cap, v_prev, 'revoked', auth.uid(), 'mirrored from organizations.org_type');
    END IF;
  END IF;

  SELECT c.status INTO v_prev FROM public.organization_capabilities c
   WHERE c.organization_id = NEW.id AND c.capability = v_cap
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.organization_capabilities
      (organization_id, capability, status, requested_by, decided_by, decided_at)
    VALUES (
      NEW.id, v_cap, v_status, NEW.created_by,
      -- Who decided is whoever the organization records as approver (NULL
      -- for a sponsor organization created by accepting an invitation); never
      -- the caller, which would record self-approval.
      CASE WHEN v_status <> 'pending' THEN NEW.approved_by END,
      CASE WHEN v_status <> 'pending' THEN COALESCE(NEW.approved_at, now()) END
    );
    INSERT INTO public.organization_capability_changes
      (organization_id, capability, previous_status, new_status, changed_by, reason)
    VALUES (NEW.id, v_cap, NULL, v_status, auth.uid(), 'mirrored from organizations (org_type, approval_status)');

  ELSIF v_prev IS DISTINCT FROM v_status THEN
    UPDATE public.organization_capabilities
       SET status = v_status,
           decided_by = COALESCE(auth.uid(), NEW.approved_by),
           decided_at = now(),
           updated_at = now()
     WHERE organization_id = NEW.id AND capability = v_cap;
    INSERT INTO public.organization_capability_changes
      (organization_id, capability, previous_status, new_status, changed_by, reason)
    VALUES (NEW.id, v_cap, v_prev, v_status, auth.uid(), 'mirrored from organizations.approval_status');
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER sync_organization_capability
  AFTER INSERT OR UPDATE OF org_type, approval_status ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.sync_organization_capability();

-- ---------------------------------------------------------------------------
-- Backfill (after the triggers exist, so nothing written meanwhile is missed)
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_roles (user_id, role, granted_by, granted_at, grant_reason)
SELECT a.user_id,
       'platform_admin',
       a.approved_by,
       COALESCE(a.approved_at, a.created_at, now()),
       'S1 backfill from user_accounts.account_type'
FROM public.user_accounts a
WHERE a.account_type = 'platform_admin'
ON CONFLICT (user_id, role) WHERE revoked_at IS NULL DO NOTHING;

WITH created AS (
  INSERT INTO public.organization_capabilities
    (organization_id, capability, status, requested_by, decided_by, decided_at, created_at, updated_at)
  SELECT o.id,
         public.capability_for_org_type(o.org_type),
         public.capability_status_for_approval(o.approval_status),
         o.created_by,
         CASE WHEN o.approval_status <> 'pending' THEN o.approved_by END,
         CASE WHEN o.approval_status <> 'pending' THEN COALESCE(o.approved_at, o.updated_at, o.created_at) END,
         o.created_at,
         now()
  FROM public.organizations o
  ON CONFLICT (organization_id, capability) DO NOTHING
  RETURNING organization_id, capability, status
)
INSERT INTO public.organization_capability_changes
  (organization_id, capability, previous_status, new_status, changed_by, reason)
SELECT organization_id, capability, NULL, status, NULL,
       'S1 backfill from organizations (org_type, approval_status)'
FROM created;

-- ---------------------------------------------------------------------------
-- identity_s1_drift: every disagreement between the old columns and the new
-- tables. Empty means consistent. Internal (run as the database owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.identity_s1_drift()
RETURNS TABLE (kind text, subject_id uuid, detail text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- A platform_admin account without exactly one active grant.
  SELECT 'platform_admin without one active grant', a.user_id,
         'active grants: ' || (SELECT count(*) FROM public.platform_roles r
                               WHERE r.user_id = a.user_id AND r.role = 'platform_admin' AND r.revoked_at IS NULL)
  FROM public.user_accounts a
  WHERE a.account_type = 'platform_admin'
    AND (SELECT count(*) FROM public.platform_roles r
         WHERE r.user_id = a.user_id AND r.role = 'platform_admin' AND r.revoked_at IS NULL) <> 1
  UNION ALL
  -- An active grant for an account that is not platform_admin (or has no account).
  SELECT 'active grant without platform_admin account', r.user_id,
         'account_type: ' || COALESCE((SELECT a.account_type::text FROM public.user_accounts a WHERE a.user_id = r.user_id), 'none')
  FROM public.platform_roles r
  WHERE r.revoked_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.user_accounts a
                    WHERE a.user_id = r.user_id AND a.account_type = 'platform_admin')
  UNION ALL
  -- An organization whose mirrored capability is missing or has the wrong status.
  SELECT 'organization capability missing or wrong status', o.id,
         'expected ' || public.capability_for_org_type(o.org_type) || '=' || public.capability_status_for_approval(o.approval_status)
         || ', found ' || COALESCE((SELECT c.status::text FROM public.organization_capabilities c
                                    WHERE c.organization_id = o.id AND c.capability = public.capability_for_org_type(o.org_type)), 'none')
  FROM public.organizations o
  WHERE NOT EXISTS (SELECT 1 FROM public.organization_capabilities c
                    WHERE c.organization_id = o.id
                      AND c.capability = public.capability_for_org_type(o.org_type)
                      AND c.status = public.capability_status_for_approval(o.approval_status))
  UNION ALL
  -- In S1 every organization holds only its mirrored capability; anything else
  -- that is not revoked has no source in the old columns.
  SELECT 'unmirrored capability', c.organization_id, c.capability || '=' || c.status
  FROM public.organization_capabilities c
  JOIN public.organizations o ON o.id = c.organization_id
  WHERE c.capability <> public.capability_for_org_type(o.org_type)
    AND c.status <> 'revoked';
$$;

COMMENT ON FUNCTION public.identity_s1_drift() IS
  'Stage S1 consistency check: rows where account_type/org_type/approval_status and platform_roles/organization_capabilities disagree. Expected to be empty. Not client-callable.';

-- ---------------------------------------------------------------------------
-- No client may execute any of the new functions (the default privileges in
-- Supabase grant EXECUTE on new functions to anon and authenticated).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.capability_for_org_type(public.org_type) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capability_status_for_approval(public.org_approval_status) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.org_has_capability(uuid, public.org_capability) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_platform_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_organization_capability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.identity_s1_drift() FROM PUBLIC, anon, authenticated;
