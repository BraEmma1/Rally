/*
# Lock the contact-consent columns properly

## Why this exists
The previous migration tried to hide share_contact / contact_email /
contact_phone with a column-level REVOKE. That does nothing: `authenticated`
held SELECT, INSERT and UPDATE on the whole of event_registrations, and a
column-level REVOKE cannot subtract from a table-wide grant. Verification after
applying it showed the columns were still readable.

The working form is to drop the table-wide grants and re-grant an explicit
column list that omits the consent fields.

## What still works
Every registration query in the app names explicit columns — `event_id`, `id`,
`user_id` — and self-registration inserts only `event_id` and `user_id`, so
nothing in the Professional/Attendee flow is affected. Registration counts come
from `get_event_registration_counts`, which is SECURITY DEFINER and runs as the
owner, so it is unaffected by these grants.

The consent columns stay in place, readable by nobody, until the organizer
attendee-contact access design lands in Phase C.
*/

REVOKE SELECT, INSERT, UPDATE ON public.event_registrations FROM authenticated;

GRANT SELECT (id, event_id, user_id, created_at, status, checked_in_at, cancelled_at)
  ON public.event_registrations TO authenticated;

-- Self-registration supplies only these; the rest come from column defaults.
GRANT INSERT (event_id, user_id)
  ON public.event_registrations TO authenticated;

-- No UPDATE policy exists yet, so this grants nothing today. It keeps the
-- column set correct for organizer check-in in Phase C.
GRANT UPDATE (status, checked_in_at, cancelled_at)
  ON public.event_registrations TO authenticated;
