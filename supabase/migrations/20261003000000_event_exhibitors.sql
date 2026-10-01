/*
# Event exhibitors

One table, one bucket, two functions. An exhibitor is **event content**, not
an authorization role: nothing here writes to `organization_members`,
`user_accounts`, `event_team` or `event_registrations`, and no policy anywhere
consults an exhibitor record.

## What already existed
Checked first: no exhibitor, booth, stand or partner concept anywhere in the
schema or the codebase -- the only mentions are a Coming Soon route.
`organizations.org_type` accepts `vendor` and `sponsor`, but there is no table
associating an organization with an event in any capacity, so it is not a
foundation to build on.

## Why organizations is NOT the exhibitor model
`organizations` is readable only by its own members:

    SELECT policy on organizations = is_org_member(id)

So an organizer at one organization cannot see another organization at all.
There is no public organization directory and no discovery mechanism. Making
exhibitors depend on `organizations` would mean MTN Ghana has to sign up,
create a Rally organization and add the event's organizer to it before it can
appear in a directory -- which is not how an exhibitor list gets built.

Exhibitors are therefore an event-scoped snapshot, like `event_speakers`, and
a Rally organization is an optional identity link rather than a prerequisite.

## The organization link is real but deliberately narrow
`organization_id` exists, nullable, `ON DELETE SET NULL` -- an organization
going away must not erase an event's historical exhibitor list.

It may only be set by someone who is an **admin of that organization**,
enforced in the trigger. That is the only form of linking that can be verified
today: you may claim an organization you control, and nothing else. Because
foreign keys do not consult RLS, without this check an organizer who learned
any organization's uuid could assert "this exhibitor is MTN Ghana on Rally"
with nothing to back it.

Linking an organization the organizer does *not* control needs a verified
claim flow and a safe way to find organizations in the first place. Both are
product decisions, and neither is needed to ship: an unlinked exhibitor is
simply an external one. Deferred, not weakened.

## Snapshot, for the same reasons as speakers
The event's own `name`, `description`, `logo_url`, `industry`, `booth`,
`website` and `linkedin` are authoritative for everything attendees see. A
company exhibiting as "Acme AI Labs" at this event should not be relabelled
"Acme Technologies Ltd" because someone renamed the Rally organization
afterwards, and an external exhibitor has no organization to read from anyway.

## Privacy
No contact columns -- no email, no phone, no representative. There is no
exhibitor-contact feature in V1 to consume them, and the linked organization's
members, admins and internal state are never reachable through an exhibitor
read: the only organization datum stored is the id.

## Extension points left open, built now: none
`UNIQUE (id, event_id)` is declared so a future
`event_exhibitor_representatives` or `event_exhibitor_leads` can use the same
composite-foreign-key trick that keeps `event_session_speakers` honest -- a
representative or a lead can then be pinned to one event across both parents,
declaratively. Lead data stays out of this table.
*/

-- ============================================================================
-- Storage: event-assets
--
-- Speaker photos currently go to the `avatars` bucket. For a company logo that
-- is the wrong home -- `avatars` is a person's own picture, keyed by their
-- user id -- so event content gets its own bucket rather than borrowing one.
-- Policies are copied exactly from `event-banners`: public read, and writes
-- confined to a folder named after the uploader.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-assets', 'event-assets', true, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read event assets" ON storage.objects;
CREATE POLICY "Public read event assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-assets');

DROP POLICY IF EXISTS "Users can upload own event assets" ON storage.objects;
CREATE POLICY "Users can upload own event assets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can update own event assets" ON storage.objects;
CREATE POLICY "Users can update own event assets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'event-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'event-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can delete own event assets" ON storage.objects;
CREATE POLICY "Users can delete own event assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ============================================================================
-- event_exhibitors
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_exhibitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Optional, and only settable by an admin of that organization. SET NULL,
  -- never CASCADE: the event's exhibitor list outlives the organization.
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  -- The event-specific snapshot. Authoritative for everything attendees see.
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  -- Same convention as profiles.industry and event_speakers.industry, so
  -- "fintech exhibitors" is a query rather than a text search over prose.
  industry text NOT NULL DEFAULT '',
  -- Free text covering "Booth A12", "Stand 14", "Exhibition Hall B",
  -- "Innovation Zone - Booth 6". There is no venue or map model in Rally yet;
  -- when one arrives it can resolve this rather than replace it.
  booth text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  linkedin text NOT NULL DEFAULT '',

  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_exhibitors_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT event_exhibitors_name_length CHECK (length(name) <= 200),
  CONSTRAINT event_exhibitors_description_length CHECK (length(description) <= 4000),
  CONSTRAINT event_exhibitors_booth_length CHECK (length(booth) <= 120),
  -- For future (id, event_id) composite references; see the header.
  CONSTRAINT event_exhibitors_id_event_unique UNIQUE (id, event_id)
);

-- The directory is always read for one event, in display order.
CREATE INDEX IF NOT EXISTS idx_event_exhibitors_event_order
  ON event_exhibitors (event_id, display_order, name);

-- One organization cannot be linked twice to the same event. Partial, because
-- external exhibitors have no organization_id and any number is legitimate.
-- There is deliberately NO uniqueness on name: two businesses can share one,
-- and the database must not reject the second. The UI may warn.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_exhibitors_event_org
  ON event_exhibitors (event_id, organization_id) WHERE organization_id IS NOT NULL;

-- ============================================================================
-- RLS -- visibility inherits the event's, exactly as sessions and speakers do
-- ============================================================================
ALTER TABLE event_exhibitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_exhibitors FROM anon;
GRANT SELECT ON public.event_exhibitors TO anon;

-- A subquery in a policy is subject to the referenced table's policies, so
-- this resolves through the three existing event SELECT policies. An exhibitor
-- is visible exactly when its event is, and any future change to event
-- visibility applies here on its own.
DROP POLICY IF EXISTS "read_visible_event_exhibitors" ON event_exhibitors;
CREATE POLICY "read_visible_event_exhibitors"
  ON event_exhibitors FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_exhibitors.event_id));

DROP POLICY IF EXISTS "insert_event_exhibitors_as_manager" ON event_exhibitors;
CREATE POLICY "insert_event_exhibitors_as_manager"
  ON event_exhibitors FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "update_event_exhibitors_as_manager" ON event_exhibitors;
CREATE POLICY "update_event_exhibitors_as_manager"
  ON event_exhibitors FOR UPDATE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "delete_event_exhibitors_as_manager" ON event_exhibitors;
CREATE POLICY "delete_event_exhibitors_as_manager"
  ON event_exhibitors FOR DELETE TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active());

-- ============================================================================
-- What a write may contain
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_exhibitor_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Observed, never accepted from the caller.
    NEW.created_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'An exhibitor cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of an exhibitor record cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  -- A foreign key does not consult RLS, so without this an organizer who knew
  -- any organization's id could assert a link to it. You may claim an
  -- organization you administer, and nothing else.
  IF NEW.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.organization_id END)
     AND NOT public.is_org_admin(NEW.organization_id) THEN
    RAISE EXCEPTION 'You can only link an organization you administer';
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its exhibitors.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_exhibitor_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_exhibitor_rules ON event_exhibitors;
CREATE TRIGGER check_event_exhibitor_rules
  BEFORE INSERT OR UPDATE ON event_exhibitors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_exhibitor_rules();

CREATE OR REPLACE FUNCTION public.enforce_event_exhibitor_delete_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = OLD.event_id;
  -- The event itself being deleted cascades here; that is not an edit.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its exhibitors.';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_exhibitor_delete_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_exhibitor_delete_rules ON event_exhibitors;
CREATE TRIGGER check_event_exhibitor_delete_rules
  BEFORE DELETE ON event_exhibitors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_exhibitor_delete_rules();

-- ============================================================================
-- Read
--
-- One function, not two. It returns every column the detail screen needs, so
-- a separate get-one RPC would be ceremony; a caller wanting a single
-- exhibitor selects it by id and RLS filters that exactly the same way.
--
-- SECURITY INVOKER: the policy above already says who may see this.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_exhibitors(target_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  organization_id uuid,
  name text,
  description text,
  logo_url text,
  industry text,
  booth text,
  website text,
  linkedin text,
  display_order integer
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    x.id, x.event_id, x.organization_id, x.name, x.description, x.logo_url,
    x.industry, x.booth, x.website, x.linkedin, x.display_order
  FROM event_exhibitors x
  WHERE x.event_id = target_event_id
  ORDER BY x.display_order, x.name;
$$;

-- ============================================================================
-- Reorder, in one statement -- the same contract as reorder_event_speakers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reorder_event_exhibitors(
  target_event_id uuid,
  exhibitor_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  v_count int;
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = target_event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its exhibitors.';
  END IF;

  -- Every id must belong to this event, or a caller could renumber an
  -- exhibitor on another event they also manage.
  SELECT count(*) INTO v_count
  FROM unnest(exhibitor_ids) AS xid
  WHERE NOT EXISTS (
    SELECT 1 FROM event_exhibitors x WHERE x.id = xid AND x.event_id = target_event_id
  );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Those exhibitors do not all belong to this event';
  END IF;

  UPDATE event_exhibitors x
  SET display_order = ordered.ord
  FROM (SELECT xid, (ordinality - 1)::int AS ord
        FROM unnest(exhibitor_ids) WITH ORDINALITY AS t(xid, ordinality)) ordered
  WHERE x.id = ordered.xid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_exhibitors(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reorder_event_exhibitors(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- The exhibitors of a published event are public, like the event, its agenda
-- and its speakers.
GRANT EXECUTE ON FUNCTION public.get_event_exhibitors(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_event_exhibitors(uuid, uuid[]) TO authenticated;

/*
## Deliberately NOT built

- **Sponsor tiers.** `organizations.org_type` already carries `vendor` and
  `sponsor`, but with no event association and no product requirement behind
  them, a tier column here would be invention. When tiers are specified they
  are one nullable text column with a CHECK, additive and cheap.
- **Representatives and lead capture.** `UNIQUE (id, event_id)` above is the
  hook; neither table is created.
- **Realtime.** `event_exhibitors` is not added to `supabase_realtime`,
  matching `event_sessions` and `event_speakers`. The attendee directory needs
  a refresh to see organizer changes, as the Agenda does today.
- **Organization discovery or a verified claim flow.** See the header.
*/
