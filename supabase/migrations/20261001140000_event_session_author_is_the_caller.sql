/*
# event_sessions.created_by is set by the server, not the client

## The gap
`created_by` had no default and nothing set it on INSERT. The existing trigger
only protects it on UPDATE ("The creator of a session cannot be changed"), so
on the way in it was simply whatever the client sent:

  - omit it and the row is created with `created_by = NULL`, losing attribution;
  - send somebody else's id and it is stored verbatim, so a session can be
    made to look as though another member of the organization wrote it.

Probed on this database before writing: a legitimate organization owner
inserted a session carrying an *attendee's* id as `created_by`, and it was
accepted.

This is not an authorization hole — who may write is decided by
`can_manage_event` in the RLS policies and that is unchanged and verified. It
is an integrity one: the column is supposed to record who did it.

## The fix
One line in the trigger that already runs BEFORE INSERT OR UPDATE on this
table. On INSERT the author is taken from `auth.uid()` and any client-supplied
value is discarded; on UPDATE the existing immutability check still applies, so
it cannot be rewritten afterwards either.

`auth.uid()` reads the request's JWT claims rather than the database role, so
it returns the calling user even though this trigger is SECURITY DEFINER. A
server-side insert with no JWT still yields NULL, exactly as today.

## Not changed
No policy, grant, column, index or constraint. All 9 existing sessions already
carry an author, so there is nothing to backfill.

## Deliberately NOT added here
Sessions are still not required to fall within their event's start/end dates.
That is a product rule, not a bug, and it is reported rather than introduced
unilaterally.
*/

CREATE OR REPLACE FUNCTION public.enforce_event_session_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The author is observed, never accepted from the caller.
    NEW.created_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A session cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a session cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its agenda.';
  END IF;

  RETURN NEW;
END;
$$;
