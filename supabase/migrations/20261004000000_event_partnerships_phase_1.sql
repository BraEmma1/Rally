/*
# Event partnerships, phase 1: the private foundation

Four tables, one private storage bucket, five functions. Organizer-only, and
deliberately invisible to everyone else.

## The one rule this migration exists to protect
`event_exhibitors` is public: it carries `GRANT SELECT TO anon` and a policy
that inherits *event* visibility, so a published event makes its exhibitors
world-readable. Partnerships carry the opposite of that -- representative
email, internal notes, sponsorship value, obligations, evidence -- so they get
the opposite model:

  - no `anon` grant on any of the four tables;
  - no policy anywhere that mentions event visibility;
  - read authority is `can_manage_event(event_id)` and nothing else.

Nothing in `event_exhibitors` is touched. The two systems are unrelated in
phase 1, by design.

## Cross-event integrity is declared, not checked
The chain is pinned by composite foreign keys rather than triggers, the same
technique that keeps `event_session_speakers` honest:

    roles      (partnership_id, event_id)                -> partnerships (id, event_id)
    obligations(partnership_id, event_id)                -> partnerships (id, event_id)
    evidence   (obligation_id, partnership_id, event_id) -> obligations  (id, partnership_id, event_id)

So an obligation cannot belong to one event while its partnership belongs to
another, and a piece of evidence cannot be attached to an obligation from a
different partnership or a different event. The database cannot represent it,
so there is no validation to forget and no trigger to get wrong. The
denormalized `event_id` on each child is not a second source of truth -- the
keys make it provably equal to the parent's.

## Phase boundaries honoured here
No invitations, no sponsor organizations, no packages, no
`event_exhibitors.partnership_id`, no account-type or signup changes, no
frontend. `sponsor_organization_id` exists but cannot yet be set -- see below.
*/

-- ============================================================================
-- event_partnerships
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Nullable and, in phase 1, unsettable: the trigger below rejects any
  -- non-NULL value. A foreign key does not consult RLS, so without that an
  -- organizer who learned any organization's uuid could assert a commercial
  -- relationship with it. Controlled linking arrives with invitation
  -- acceptance in phase 3; until then a partnership runs entirely on its own
  -- company snapshot, which is why none of the snapshot columns depend on it.
  sponsor_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  -- Company snapshot. Authoritative for the whole partnership.
  company_name text NOT NULL,
  description text,
  logo_url text,
  industry text,
  website text,
  linkedin text,

  -- The organizer's own words. Not a global Rally vocabulary: "Gold",
  -- "Title Sponsor" and "Headline Partner" are all equally valid.
  tier_label text,

  status text NOT NULL DEFAULT 'draft',
  -- Set only by a future phase-3 RPC; frozen against client writes below.
  acknowledged_at timestamptz,

  -- Private commercial history. No invoicing, no payment state, no tax.
  value_amount numeric,
  value_currency text,

  internal_notes text,
  representative_email text,

  display_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_partnerships_company_not_blank CHECK (btrim(company_name) <> ''),
  CONSTRAINT event_partnerships_company_length CHECK (length(company_name) <= 200),
  CONSTRAINT event_partnerships_tier_length CHECK (tier_label IS NULL OR length(tier_label) <= 80),
  CONSTRAINT event_partnerships_industry_length CHECK (industry IS NULL OR length(industry) <= 120),
  CONSTRAINT event_partnerships_description_length CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT event_partnerships_notes_length CHECK (internal_notes IS NULL OR length(internal_notes) <= 8000),
  CONSTRAINT event_partnerships_status_allowed CHECK (
    status IN ('draft', 'invited', 'active', 'completed', 'cancelled')
  ),
  CONSTRAINT event_partnerships_value_non_negative CHECK (value_amount IS NULL OR value_amount >= 0),
  -- ISO-4217 shape only. Deliberately not a lookup table or an enum: this is
  -- historical information, not a billing system.
  CONSTRAINT event_partnerships_currency_shape CHECK (
    value_currency IS NULL OR value_currency ~ '^[A-Z]{3}$'
  ),
  -- Matches organizations_website_safe_url and profiles_website_safe_url.
  CONSTRAINT event_partnerships_website_safe_url CHECK (
    website IS NULL OR website = '' OR website ~* '^https?://'
  ),
  CONSTRAINT event_partnerships_linkedin_safe_url CHECK (
    linkedin IS NULL OR linkedin = '' OR linkedin ~* '^https?://'
  ),
  CONSTRAINT event_partnerships_logo_safe_url CHECK (
    logo_url IS NULL OR logo_url = '' OR logo_url ~* '^https?://'
  ),
  -- Normalized by the trigger; asserted here so no other path can bypass it.
  CONSTRAINT event_partnerships_rep_email_normalized CHECK (
    representative_email IS NULL
    OR (representative_email = lower(btrim(representative_email))
        AND representative_email LIKE '%_@_%.__%'
        AND length(representative_email) <= 320)
  ),

  -- Composite-FK target for roles and obligations.
  CONSTRAINT event_partnerships_id_event_unique UNIQUE (id, event_id)
);

-- The organizer list is always one event, in display order.
CREATE INDEX IF NOT EXISTS idx_event_partnerships_event_order
  ON event_partnerships (event_id, display_order, company_name);
-- The Partners workspace filters by status (All / Draft / Active / ...).
CREATE INDEX IF NOT EXISTS idx_event_partnerships_event_status
  ON event_partnerships (event_id, status);

-- ============================================================================
-- event_partnership_roles
--
-- A partnership may be a sponsor AND an exhibitor. A single column on
-- event_partnerships could not say that, which is why this is a junction
-- rather than an enum.
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_roles (
  partnership_id uuid NOT NULL,
  event_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (partnership_id, role),

  CONSTRAINT event_partnership_roles_allowed CHECK (
    role IN ('sponsor', 'exhibitor', 'media_partner', 'supporting_partner', 'other')
  ),
  CONSTRAINT event_partnership_roles_partnership_fk
    FOREIGN KEY (partnership_id, event_id)
    REFERENCES event_partnerships (id, event_id) ON DELETE CASCADE
);

-- "Every sponsor at this event" without touching the partnerships table.
-- Not redundant with the primary key, whose leading column is partnership_id.
CREATE INDEX IF NOT EXISTS idx_event_partnership_roles_event_role
  ON event_partnership_roles (event_id, role);

-- ============================================================================
-- event_partnership_obligations
--
-- One table for both directions. The two sides have the same shape (title,
-- description, status, due date, evidence, completion metadata) and the same
-- lifecycle; the only difference is who may move them, which is a predicate
-- rather than a schema. Two tables would mean two policy sets, two function
-- families, and every later feature -- reminders, counts, activity -- built
-- twice and free to drift.
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id uuid NOT NULL,
  event_id uuid NOT NULL,

  -- organizer_to_partner  = what the organizer owes the partner
  -- partner_to_organizer  = what the partner must supply to the organizer
  direction text NOT NULL,

  title text NOT NULL,
  description text,
  category text,
  quantity integer,

  status text NOT NULL DEFAULT 'pending',
  due_date date,
  display_order integer NOT NULL DEFAULT 0,

  -- Observed, never accepted from the caller. See the trigger.
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_partnership_obligations_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT event_partnership_obligations_title_length CHECK (length(title) <= 200),
  CONSTRAINT event_partnership_obligations_description_length
    CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT event_partnership_obligations_category_length
    CHECK (category IS NULL OR length(category) <= 80),
  CONSTRAINT event_partnership_obligations_direction_allowed CHECK (
    direction IN ('organizer_to_partner', 'partner_to_organizer')
  ),
  CONSTRAINT event_partnership_obligations_status_allowed CHECK (
    status IN ('pending', 'in_progress', 'completed')
  ),
  CONSTRAINT event_partnership_obligations_quantity_positive
    CHECK (quantity IS NULL OR quantity > 0),
  -- Completion metadata and status cannot disagree. The trigger maintains
  -- both; this makes a disagreement unrepresentable even so.
  CONSTRAINT event_partnership_obligations_completion_consistent CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL AND completed_by IS NULL)
  ),

  -- Composite-FK target for evidence: pins obligation, partnership and event
  -- together in one key.
  CONSTRAINT event_partnership_obligations_id_parent_unique
    UNIQUE (id, partnership_id, event_id),
  CONSTRAINT event_partnership_obligations_partnership_fk
    FOREIGN KEY (partnership_id, event_id)
    REFERENCES event_partnerships (id, event_id) ON DELETE CASCADE
);

-- The detail screen reads one partnership, split by direction, in order.
CREATE INDEX IF NOT EXISTS idx_event_partnership_obligations_partnership
  ON event_partnership_obligations (partnership_id, direction, display_order);
-- Event-wide progress counts without walking partnerships first.
CREATE INDEX IF NOT EXISTS idx_event_partnership_obligations_event
  ON event_partnership_obligations (event_id);

-- ============================================================================
-- event_partnership_obligation_evidence
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_obligation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL,
  partnership_id uuid NOT NULL,
  event_id uuid NOT NULL,

  kind text NOT NULL,
  -- For kind='file' this is the OBJECT PATH inside the private
  -- partnership-assets bucket, never a signed URL: a signed URL expires, and
  -- storing one would bake an access grant into the row.
  file_path text,
  external_url text,
  note text,

  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_partnership_evidence_kind_allowed CHECK (kind IN ('file', 'url', 'note')),
  -- Evidence has to actually carry what its kind promises, and nothing else.
  -- This is what stops a row that claims to be evidence and holds nothing.
  CONSTRAINT event_partnership_evidence_shape CHECK (
    (kind = 'file' AND btrim(COALESCE(file_path, '')) <> ''
       AND external_url IS NULL AND note IS NULL)
    OR (kind = 'url' AND btrim(COALESCE(external_url, '')) <> ''
       AND file_path IS NULL AND note IS NULL)
    OR (kind = 'note' AND btrim(COALESCE(note, '')) <> ''
       AND file_path IS NULL AND external_url IS NULL)
  ),
  CONSTRAINT event_partnership_evidence_url_safe CHECK (
    external_url IS NULL OR external_url ~* '^https?://'
  ),
  CONSTRAINT event_partnership_evidence_note_length CHECK (note IS NULL OR length(note) <= 4000),
  CONSTRAINT event_partnership_evidence_path_length
    CHECK (file_path IS NULL OR length(file_path) <= 1024),

  -- One key pinning all three ancestors at once.
  CONSTRAINT event_partnership_evidence_obligation_fk
    FOREIGN KEY (obligation_id, partnership_id, event_id)
    REFERENCES event_partnership_obligations (id, partnership_id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_partnership_evidence_obligation
  ON event_partnership_obligation_evidence (obligation_id, created_at);
-- The storage SELECT policy looks an object path up here on every read.
CREATE INDEX IF NOT EXISTS idx_event_partnership_evidence_file_path
  ON event_partnership_obligation_evidence (file_path) WHERE file_path IS NOT NULL;

-- ============================================================================
-- RLS -- organizer-only, and NOT inherited from event visibility
--
-- Compare event_sessions / event_speakers / event_exhibitors, whose SELECT
-- policy is `EXISTS (SELECT 1 FROM events ...)` so that visibility follows the
-- event. That is right for an agenda and wrong for a contract. These four
-- tables ask can_manage_event instead, which is the same predicate that
-- governs editing the event itself.
-- ============================================================================
ALTER TABLE event_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_partnership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_partnership_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_partnership_obligation_evidence ENABLE ROW LEVEL SECURITY;

-- No anon access of any kind, and no TRUNCATE for either client role.
-- ALTER DEFAULT PRIVILEGES already withdraws TRUNCATE from new tables; this is
-- belt and braces, because the earlier audit found it granted schema-wide.
REVOKE ALL ON public.event_partnerships FROM anon;
REVOKE ALL ON public.event_partnership_roles FROM anon;
REVOKE ALL ON public.event_partnership_obligations FROM anon;
REVOKE ALL ON public.event_partnership_obligation_evidence FROM anon;
REVOKE TRUNCATE ON public.event_partnerships FROM anon, authenticated;
REVOKE TRUNCATE ON public.event_partnership_roles FROM anon, authenticated;
REVOKE TRUNCATE ON public.event_partnership_obligations FROM anon, authenticated;
REVOKE TRUNCATE ON public.event_partnership_obligation_evidence FROM anon, authenticated;

DROP POLICY IF EXISTS "manage_event_partnerships" ON event_partnerships;
CREATE POLICY "manage_event_partnerships"
  ON event_partnerships FOR ALL TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

-- Children derive authority from their own event_id, which the composite keys
-- have already pinned to the parent's. A client cannot gain anything by
-- supplying a different one: the foreign key rejects it before the policy is
-- even consulted.
DROP POLICY IF EXISTS "manage_event_partnership_roles" ON event_partnership_roles;
CREATE POLICY "manage_event_partnership_roles"
  ON event_partnership_roles FOR ALL TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "manage_event_partnership_obligations" ON event_partnership_obligations;
CREATE POLICY "manage_event_partnership_obligations"
  ON event_partnership_obligations FOR ALL TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

DROP POLICY IF EXISTS "manage_event_partnership_evidence" ON event_partnership_obligation_evidence;
CREATE POLICY "manage_event_partnership_evidence"
  ON event_partnership_obligation_evidence FOR ALL TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

-- ============================================================================
-- What a partnership write may contain
--
-- The policy decides who; this decides what. updated_at is maintained here
-- rather than by a generic helper, matching event_sessions, event_speakers,
-- event_exhibitors and organizations -- there is no shared updated_at trigger
-- in this project and adding one now would be a second convention.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_partnership_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  -- Phase 1: there is no safe way to establish this link yet. A foreign key
  -- does not consult RLS, and no sponsor organization can even be created
  -- through the client today, so any value here would be an unverifiable
  -- claim. Phase 3 relaxes exactly this branch, inside invitation acceptance.
  IF NEW.sponsor_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'Linking a sponsor organization is not available yet';
  END IF;

  IF NEW.representative_email IS NOT NULL THEN
    NEW.representative_email := lower(btrim(NEW.representative_email));
    IF NEW.representative_email = '' THEN
      NEW.representative_email := NULL;
    END IF;
  END IF;

  IF NEW.value_currency IS NOT NULL THEN
    NEW.value_currency := upper(btrim(NEW.value_currency));
    IF NEW.value_currency = '' THEN
      NEW.value_currency := NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    -- A partnership is born a draft; nothing else is reachable on creation.
    NEW.status := 'draft';
    -- Only phase 3 may set this, so it cannot arrive from a client.
    NEW.acknowledged_at := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A partnership cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a partnership cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    -- Frozen until phase 3 owns it.
    NEW.acknowledged_at := OLD.acknowledged_at;
    NEW.updated_at := now();

    -- The transition map is written for the full lifecycle so phase 3 extends
    -- it by doing nothing. In phase 1 only draft <-> cancelled is reachable,
    -- because nothing sends an invitation; the rest is declared, not exercised.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
           (OLD.status = 'draft'     AND NEW.status IN ('invited', 'cancelled'))
        OR (OLD.status = 'invited'   AND NEW.status IN ('active', 'draft', 'cancelled'))
        OR (OLD.status = 'active'    AND NEW.status IN ('completed', 'cancelled'))
        OR (OLD.status = 'completed' AND NEW.status IN ('active'))
        OR (OLD.status = 'cancelled' AND NEW.status IN ('draft'))
      ) THEN
        RAISE EXCEPTION 'A partnership cannot go from % to %', OLD.status, NEW.status;
      END IF;
    END IF;
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_partnership_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_partnership_rules ON event_partnerships;
CREATE TRIGGER check_event_partnership_rules
  BEFORE INSERT OR UPDATE ON event_partnerships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_partnership_rules();

-- ============================================================================
-- Deletion: a draft may be discarded, an operational partnership may not
--
-- These are commercial records. Once a partnership has left draft it carries
-- history somebody may need to answer for, so it is cancelled rather than
-- erased. No soft-delete column is introduced -- `cancelled` already is one.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_partnership_delete_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = OLD.event_id;
  -- The event itself being deleted cascades here; that is not an edit.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft partnership can be deleted. Cancel this one instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_event_partnership_delete_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_event_partnership_delete_rules ON event_partnerships;
CREATE TRIGGER check_event_partnership_delete_rules
  BEFORE DELETE ON event_partnerships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_partnership_delete_rules();

-- ============================================================================
-- Obligations: the completion contract
--
-- status is the only thing a client sets. completed_at and completed_by are
-- observed here from server time and auth.uid(), so "who marked this done and
-- when" cannot be dictated, and reopening clears both rather than leaving a
-- stale pair behind.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_partnership_obligation_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
       OR NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'An obligation cannot be moved to another partnership';
    END IF;
    IF NEW.direction IS DISTINCT FROM OLD.direction THEN
      RAISE EXCEPTION 'An obligation cannot change direction';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of an obligation cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'completed' THEN
      -- Newly completed: stamp it, whatever the client sent.
      NEW.completed_at := now();
      NEW.completed_by := auth.uid();
    ELSE
      -- Already completed and still completed: keep the original record
      -- rather than re-stamping it on an unrelated edit.
      NEW.completed_at := OLD.completed_at;
      NEW.completed_by := OLD.completed_by;
    END IF;
  ELSE
    -- Reopened, or never completed.
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_obligation_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_partnership_obligation_rules ON event_partnership_obligations;
CREATE TRIGGER check_partnership_obligation_rules
  BEFORE INSERT OR UPDATE ON event_partnership_obligations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_obligation_rules();

-- ============================================================================
-- Archived events freeze the children too
--
-- One shared trigger function for roles, obligations and evidence on DELETE,
-- and for roles and evidence on INSERT -- those two have no rules of their own
-- beyond the archive freeze, so they do not need a function each.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_partnership_child_not_archived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_archived timestamptz;
BEGIN
  v_event := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = v_event;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_child_not_archived() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_partnership_role_archive ON event_partnership_roles;
CREATE TRIGGER check_partnership_role_archive
  BEFORE INSERT OR UPDATE OR DELETE ON event_partnership_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_child_not_archived();

DROP TRIGGER IF EXISTS check_partnership_obligation_delete_archive ON event_partnership_obligations;
CREATE TRIGGER check_partnership_obligation_delete_archive
  BEFORE DELETE ON event_partnership_obligations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_child_not_archived();

DROP TRIGGER IF EXISTS check_partnership_evidence_archive ON event_partnership_obligation_evidence;
CREATE TRIGGER check_partnership_evidence_archive
  BEFORE INSERT OR UPDATE OR DELETE ON event_partnership_obligation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_child_not_archived();

-- Evidence authorship is observed too.
CREATE OR REPLACE FUNCTION public.enforce_partnership_evidence_author()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.uploaded_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_evidence_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_partnership_evidence_author ON event_partnership_obligation_evidence;
CREATE TRIGGER check_partnership_evidence_author
  BEFORE INSERT ON event_partnership_obligation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_evidence_author();

-- ============================================================================
-- Private storage: partnership-assets
--
-- event-assets is public-read, which is correct for a speaker photo and wrong
-- for a signed contract photograph, so evidence files get their own bucket
-- with public = false.
--
-- The read policy is the interesting one. Writes are confined to the caller's
-- own folder, as in every other Rally bucket -- but the person who uploaded a
-- file is not necessarily the person who needs to see it, so a
-- "your folder only" read rule would make evidence invisible to the rest of
-- the event team. Instead SELECT is granted when an evidence row points at
-- this object and the caller can manage that evidence's event. Supabase
-- requires SELECT on an object before it will sign a URL for it, so this is
-- also exactly what authorizes createSignedUrl -- no Edge Function, no
-- service-role key anywhere near the client, and nothing broader than the one
-- object exposed.
--
-- Phase 4 adds `OR is_org_member(p.sponsor_organization_id)` to that policy
-- and sponsor access works without touching anything else.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partnership-assets', 'partnership-assets', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Read partnership assets for managed events" ON storage.objects;
CREATE POLICY "Read partnership assets for managed events"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'partnership-assets'
    AND EXISTS (
      SELECT 1
      FROM public.event_partnership_obligation_evidence ev
      WHERE ev.file_path = storage.objects.name
        AND public.can_manage_event(ev.event_id)
    )
  );

DROP POLICY IF EXISTS "Upload own partnership assets" ON storage.objects;
CREATE POLICY "Upload own partnership assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'partnership-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "Update own partnership assets" ON storage.objects;
CREATE POLICY "Update own partnership assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'partnership-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'partnership-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "Delete own partnership assets" ON storage.objects;
CREATE POLICY "Delete own partnership assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'partnership-assets'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ============================================================================
-- Read contract
--
-- Roles, obligations and evidence are plain SELECTs under the policies above;
-- an RPC per table would be ceremony. The one thing a query cannot do in a
-- single round trip is the Partners list, which needs roles aggregated and
-- obligations counted per direction for every partnership at once -- so that
-- is the only read function here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_partnership_summary(target_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  sponsor_organization_id uuid,
  company_name text,
  logo_url text,
  industry text,
  tier_label text,
  status text,
  acknowledged_at timestamptz,
  representative_email text,
  value_amount numeric,
  value_currency text,
  display_order integer,
  roles text[],
  owed_total bigint,
  owed_completed bigint,
  required_total bigint,
  required_completed bigint,
  updated_at timestamptz
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    p.id, p.event_id, p.sponsor_organization_id, p.company_name, p.logo_url,
    p.industry, p.tier_label, p.status, p.acknowledged_at,
    p.representative_email, p.value_amount, p.value_currency, p.display_order,
    COALESCE(r.roles, ARRAY[]::text[]),
    COALESCE(o.owed_total, 0),
    COALESCE(o.owed_completed, 0),
    COALESCE(o.required_total, 0),
    COALESCE(o.required_completed, 0),
    p.updated_at
  FROM event_partnerships p
  LEFT JOIN LATERAL (
    SELECT array_agg(pr.role ORDER BY pr.role) AS roles
    FROM event_partnership_roles pr
    WHERE pr.partnership_id = p.id
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE ob.direction = 'organizer_to_partner') AS owed_total,
      count(*) FILTER (WHERE ob.direction = 'organizer_to_partner'
                         AND ob.status = 'completed')               AS owed_completed,
      count(*) FILTER (WHERE ob.direction = 'partner_to_organizer') AS required_total,
      count(*) FILTER (WHERE ob.direction = 'partner_to_organizer'
                         AND ob.status = 'completed')               AS required_completed
    FROM event_partnership_obligations ob
    WHERE ob.partnership_id = p.id
  ) o ON true
  WHERE p.event_id = target_event_id
  ORDER BY p.display_order, p.company_name;
$$;

-- ============================================================================
-- Write contract
--
-- Creating and editing a partnership, an obligation or a piece of evidence is
-- a plain INSERT/UPDATE: the policies decide who, and the triggers already own
-- every field a client must not dictate. Only the three operations that need a
-- server-side invariant get a function, and all three are SECURITY INVOKER so
-- RLS still applies -- a definer function here would replace the policy with a
-- second copy of it.
-- ============================================================================

-- Status plus its metadata, in one call. The trigger would do the right thing
-- with a direct UPDATE too; this exists so the UI has one obvious, named path
-- and cannot accidentally send completed_at alongside.
CREATE OR REPLACE FUNCTION public.set_partnership_obligation_status(
  obligation_id uuid,
  new_status text
)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF new_status NOT IN ('pending', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'Unknown obligation status: %', new_status;
  END IF;

  UPDATE event_partnership_obligations ob
  SET status = new_status
  WHERE ob.id = set_partnership_obligation_status.obligation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That obligation is not available to change';
  END IF;
END;
$$;

-- Replace the whole role set atomically. Add-one/remove-one through the table
-- works, but a UI editing checkboxes wants to state the final set and not
-- leave a half-applied pair behind if one statement fails.
CREATE OR REPLACE FUNCTION public.set_event_partnership_roles(
  target_partnership_id uuid,
  new_roles text[]
)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
BEGIN
  -- RLS decides whether this row is visible; no row means no authority.
  SELECT p.event_id INTO v_event
  FROM event_partnerships p WHERE p.id = target_partnership_id;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'That partnership is not available to change';
  END IF;

  DELETE FROM event_partnership_roles pr
  WHERE pr.partnership_id = target_partnership_id
    AND NOT (pr.role = ANY (COALESCE(new_roles, ARRAY[]::text[])));

  INSERT INTO event_partnership_roles (partnership_id, event_id, role)
  SELECT target_partnership_id, v_event, r
  FROM unnest(COALESCE(new_roles, ARRAY[]::text[])) AS r
  ON CONFLICT (partnership_id, role) DO NOTHING;
END;
$$;

-- The same shape as reorder_event_sessions / _speakers / _exhibitors: one
-- atomic statement, and every id checked against the parent first so a caller
-- cannot renumber another partnership's obligations.
CREATE OR REPLACE FUNCTION public.reorder_partnership_obligations(
  target_partnership_id uuid,
  obligation_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_count int;
BEGIN
  SELECT p.event_id INTO v_event
  FROM event_partnerships p WHERE p.id = target_partnership_id;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'That partnership is not available to change';
  END IF;

  SELECT count(*) INTO v_count
  FROM unnest(obligation_ids) AS oid
  WHERE NOT EXISTS (
    SELECT 1 FROM event_partnership_obligations ob
    WHERE ob.id = oid AND ob.partnership_id = target_partnership_id
  );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Those obligations do not all belong to this partnership';
  END IF;

  UPDATE event_partnership_obligations ob
  SET display_order = ordered.ord
  FROM (SELECT oid, (ordinality - 1)::int AS ord
        FROM unnest(obligation_ids) WITH ORDINALITY AS t(oid, ordinality)) ordered
  WHERE ob.id = ordered.oid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_partnership_summary(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_partnership_obligation_status(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_event_partnership_roles(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reorder_partnership_obligations(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- Signed-in only, and never anon: none of this has a public meaning.
GRANT EXECUTE ON FUNCTION public.get_event_partnership_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_partnership_obligation_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_partnership_roles(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_partnership_obligations(uuid, uuid[]) TO authenticated;

/*
## Deferred, deliberately

- **Invitations** (`event_partnership_invitations`), sponsor organization
  creation and linking, and anything touching `organization_invitations`, the
  invitation Edge Function, signup or account types. Phase 3.
- **`event_exhibitors.partnership_id`** and any automatic exhibitor row when
  `role = 'exhibitor'`. Phase 5. The two systems do not know about each other
  yet.
- **Packages and templates.** Obligations are already partnership-specific
  rows, so a template later becomes a row generator rather than a
  restructuring.
- **An activity/history table.** `completed_at` and `completed_by` answer who
  and when; the one thing not recorded is that an obligation was previously
  completed and reopened. Noted rather than built.
- **Sponsor-side read access.** The storage SELECT policy and the four table
  policies each need one additional `OR is_org_member(...)` clause in phase 4,
  and nothing else.
*/
