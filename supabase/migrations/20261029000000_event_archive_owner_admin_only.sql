/*
# Archiving and restoring an event is an owner/admin act

## Policy (approved by the repository owner)
Only an organization owner or admin may archive or restore an event. An event
manager assigned to the event keeps every other right on it — editing its
details, publishing it, marking it live or finished, and running its content —
but may not put it away or bring it back.

## What exists before this
- An event is archived by setting events.archived_at (a timestamp) and restored
  by setting it back to NULL. Nothing else changes it: no RPC archives events,
  set_organization_archived() touches only organizations, and platform admins
  have no UPDATE path on events. The app's only call is setEventArchived() in
  src/lib/events.ts, a plain UPDATE through PostgREST.
- That UPDATE is authorized by the policy update_organization_event:
      can_manage_event(id) AND account_is_active()
  can_manage_event is true for an owner or admin AND for an assigned manager,
  so today a manager can archive and restore.
- enforce_event_write_rules() (BEFORE INSERT OR UPDATE) decides what a write may
  contain: an archived event is frozen, and the only permitted write on it is
  restoring it as the sole change. It has no role check.

## What this adds
A separate BEFORE UPDATE trigger, check_event_archive_authority, that fires only
when archived_at actually changes (archive, restore, or re-stamping) and refuses
the change unless the caller is an active owner or admin of the event's
organization:
      is_org_admin(OLD.organization_id) AND account_is_active()
These are the same helpers the INSERT policy for events already uses.

Why a trigger and not a narrower UPDATE policy: a policy cannot compare OLD and
NEW, so it cannot tell "archive" from "edit the description". The trigger sits
on the table itself, so every client path — the app, a hand-made PostgREST
request, an RPC added later — passes through it.

## What does not change
- update_organization_event and every other policy are untouched. A manager's
  ordinary edits, publishing and live/finished moves still pass.
- enforce_event_write_rules is not redefined. Its archived-event rules still
  apply after this check (an owner or admin restoring an event must still make
  that the only change in the statement).
- INSERT is unaffected: a new event is always created unarchived by the existing
  trigger.

## Who is checked, and who is exempt
How Supabase identifies a caller (definitions read from the project):
- auth.uid() is request.jwt.claim.sub, else request.jwt.claims ->> 'sub'.
- auth.jwt() is request.jwt.claim, else request.jwt.claims; NULL when unset.
- API requests arrive through PostgREST, which logs in as `authenticator` and
  switches to the role named in the verified JWT (anon, authenticated or
  service_role), publishing the claims in request.jwt.claims.
- A direct database session (SQL editor, migrations, pg_cron, psql) logs in as
  a database role such as postgres and carries no JWT claims at all.

The decision, in order:
1. A JWT that names a user (auth.uid() is set) is checked — whatever its role,
   including a service-role token minted for a user, and service-role code that
   forwards the user's own token.
2. A service-role JWT with no user is exempt. The service role is fully trusted
   (it bypasses RLS); code holding that key must authorize its own callers.
3. No JWT claims at all is exempt ONLY outside the API: when the session did not
   log in as `authenticator`. That is a trusted administrative session.
4. Anything else is refused: anonymous tokens, authenticated tokens without a
   user, and an API session with missing claims — including inside any
   SECURITY DEFINER function those callers might reach in future, and when RLS
   is bypassed.
Anonymous API requests are, separately, already stopped by RLS: no UPDATE
policy on events applies to anon.

## Existing data
No rows are read or changed. Events that are archived today stay archived;
restoring one now needs an owner or admin.

## Reversal
Forward-only. To retire:
    DROP TRIGGER IF EXISTS check_event_archive_authority ON public.events;
    DROP FUNCTION IF EXISTS public.enforce_event_archive_authority();
*/

CREATE OR REPLACE FUNCTION public.enforce_event_archive_authority()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_role   text  := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                             v_claims ->> 'role', '');
BEGIN
  -- See "Who is checked, and who is exempt" above.
  IF auth.uid() IS NULL THEN
    -- A service-role request with no end user: trusted server code.
    IF v_role = 'service_role' THEN
      RETURN NEW;
    END IF;
    -- No JWT at all, outside the API login: an administrative session. An
    -- empty object counts as no claims. session_user is the login role and is
    -- not changed by SET ROLE or SECURITY DEFINER.
    IF v_role = '' AND coalesce(v_claims, '{}'::jsonb) = '{}'::jsonb
       AND session_user <> 'authenticator' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only an organization owner or admin can archive or restore an event'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (public.account_is_active() AND public.is_org_admin(OLD.organization_id)) THEN
    RAISE EXCEPTION 'Only an organization owner or admin can archive or restore an event'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_archive_authority() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_event_archive_authority() IS
  'Trigger: archiving or restoring an event (any change to events.archived_at) requires an active owner or admin of its organization. Assigned event managers keep every other right on the event.';

DROP TRIGGER IF EXISTS check_event_archive_authority ON public.events;
CREATE TRIGGER check_event_archive_authority
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  WHEN (OLD.archived_at IS DISTINCT FROM NEW.archived_at)
  EXECUTE FUNCTION public.enforce_event_archive_authority();
