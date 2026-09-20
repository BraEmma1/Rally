/*
# Organizer Phase B — organization lifecycle and field protection

Extends the Phase A organization model with what the organizer UI needs, and
closes two gaps that only become reachable once that UI exists.

## 1. No deletion, archive instead
Phase A shipped `delete_organization_as_owner`. Deleting an organization
cascades to its members, its invitations and — once Phase C assigns them — its
events, which is not a button any product should hand a user. The policy is
dropped and `archived_at` takes its place. Archiving is reversible and leaves
the audit trail intact.

## 2. Client updates must not rewrite authority fields
`update_organization_as_admin` checks *who* is updating but not *what*. An admin
could therefore flip `org_type` to 'vendor', set `approval_status` to
'approved', or rewrite `created_by` — self-approval and a way around the rule
that only organizer organizations own events. The columns that decide authority
are now frozen against any client write; they change only through a definer
function or direct operator SQL.

## 3. Invitations record the address they were sent to
Invitations still target an existing Rally user (the v1 decision stands), but
the organizer types an email address to find that user. Storing it lets the
team screen show what was sent without a second lookup, and keeps the record
honest if the invitee later changes their address.

## Note on approval_status
Organization approval is not enforced anywhere in Phase B: no admin UI exists to
grant it, so gating the dashboard on it would make every organization unusable.
The column is populated and displayed, and enforcement lands with the Platform
Admin experience.
*/

-- ============================================================================
-- 1. Archive replaces delete
-- ============================================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DROP POLICY IF EXISTS "delete_organization_as_owner" ON organizations;

-- Belt and braces: no DELETE policy exists now, but a table-level revoke means
-- a future policy written without thinking cannot resurrect the capability.
REVOKE DELETE ON public.organizations FROM authenticated;

-- ============================================================================
-- 2. Freeze the fields that carry authority
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_organization_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Freezing is unconditional rather than role-conditional. Checking
  -- current_user would not work: inside a SECURITY DEFINER function it reports
  -- the function owner, not the `authenticated` role PostgREST switches to, so
  -- the guard would never fire for the one caller it is meant to stop.
  --
  -- The escape hatch is explicit instead. A future platform-admin approval RPC
  -- sets this GUC for the duration of its own transaction; nothing reachable
  -- through PostgREST can set it, because SET is not exposed there.
  IF COALESCE(current_setting('rally.allow_org_authority_write', true), 'off') = 'on' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.org_type IS DISTINCT FROM OLD.org_type THEN
    RAISE EXCEPTION 'An organization type cannot be changed';
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    RAISE EXCEPTION 'Only a platform administrator may change approval status';
  END IF;

  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'Approval details are not client-writable';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'The creator of an organization cannot be changed';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_organization_immutable_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_organization_immutable_fields ON organizations;
CREATE TRIGGER check_organization_immutable_fields
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_immutable_fields();

-- ============================================================================
-- 3. Invitations carry the address they were addressed to
-- ============================================================================
ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS invited_email text;

-- ============================================================================
-- 4. user_accounts is readable by its owner and writable by nobody
--
-- RLS already denies writes (the table has only a SELECT policy), but the
-- default table grants remain. Removing them means account_type and status
-- cannot be reached by a client even if a policy is added carelessly later.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.user_accounts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.account_type_changes FROM authenticated;
