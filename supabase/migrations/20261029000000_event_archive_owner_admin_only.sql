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

## Who is exempt
A statement with no signed-in user (auth.uid() IS NULL) — a migration, the SQL
editor, or the service role — is not an end-user request and is not checked.
Anonymous API requests also have no auth.uid(), but cannot reach this trigger:
no UPDATE policy on events applies to anon, so their update matches no rows.

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
BEGIN
  -- Server-side work (migrations, the SQL editor, the service role) carries no
  -- end user and is not an organization act.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
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
