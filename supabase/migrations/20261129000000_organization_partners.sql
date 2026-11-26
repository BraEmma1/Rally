/*
# Organization partners: one partner list per organizer organization

Until now a partner existed only inside one event: every `event_partnerships`
row carries its own copy of the company (name, description, logo, industry,
website, LinkedIn). An organizer who works with the same bank at five events
typed it five times, and a corrected logo or website reached one event at a
time, if at all.

This migration gives each organizer organization a list of the companies it
partners with, `organization_partners`. An event partnership can point at one
of them, and the list is what an organizer picks from when adding a partner to
an event.

## Why the partnership keeps its copy
The six basic columns stay on `event_partnerships`, and the database keeps a
linked partnership's copy equal to its partner's. The copy is not replaced by a
join because it is what the audited read paths already use: the partnership
invitation and its review, the invitation email payload, the sponsor workspace
(`my_sponsor_partnerships()`) and the admin reads. None of them changes. A
correction made on the partner reaches every event's copy, so those readers see
it straight away. A partnership on an archived event keeps the details it had
when the event was archived.

What stays per event is everything agreed there: package and tier label, value,
deliverables, status, internal notes, the representative and the invitation.
`contact_email` on the partner is only a default for the representative email
and is never synced.

## Access

    who (active account)              read   create   edit / archive / restore / delete
    organization owner or admin       yes    yes      yes
    event manager of an event in it   yes    yes      no: an edit reaches every event
    anyone else, and anon             no     no       no

A manager sees who the partners are because they need to pick one. The list
holds no notes, values or deliverables, and the partnership tables still gate
everything agreed at events the manager does not manage. Being an event manager
of an organization is one helper, `is_org_event_manager()`, so no policy
inlines membership logic. A suspended account sees nothing: both helpers
require `account_is_active()`.

## Rules the table enforces
  - Only an organizer organization can keep a partner list.
  - Among active partners, a name is unique per organization, ignoring case
    and spacing ("Kora  payments " is "Kora Payments"). An archived partner
    can be restored only if its name is still free.
  - The organization and the creator are fixed at insert. The creator is the
    signed-in caller; a client cannot choose it.

## Linking a partnership to a partner
`event_partnerships.partner_id` points at the partner. The link fills the copy
and then guards it; the rules are decided from the data alone, with no session
flag, so no caller can switch them off:

    link set or changed     the partner must be active and belong to the
                            event's organization; the six basic columns are
                            copied from it (details sent alongside are replaced)
    link unchanged          the six columns must still equal the partner's
                            ("Edit the partner to change them everywhere")
    link cleared            the copy stays and becomes editable again
    changed or cleared      only while the partnership is a draft, to fix a
                            wrong pick; a first link (NULL to partner) is
                            allowed in any status
    partner deleted         refused while any partnership points at it

An event without an organization cannot take a partner.

## Sections
  1. The directory table, its rules and its access
  2. Linking partnerships to partners
  3. A partner's edit reaches every linked event; archived events catch up on restore
  4. Existing partnerships become partners: a read-only merge preview and a backfill,
     both created here but run separately, as an approved step (see section 4)
*/

-- ============================================================================
-- Section 1: the directory table, its rules and its access
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.organization_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The basic details. Same types, lengths and safe-URL checks as the
  -- partnership columns they are copied into, so a partner's value always
  -- passes the partnership's own checks.
  company_name text NOT NULL,
  description text,
  logo_url text,
  industry text,
  website text,
  linkedin text,

  -- A default for the representative email when the partner is added to an
  -- event. Checked exactly like `event_partnerships.representative_email`.
  contact_email text,

  -- Retire a partner without losing the events it was part of.
  archived_at timestamptz,

  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_partners_company_not_blank CHECK (btrim(company_name) <> ''),
  CONSTRAINT organization_partners_company_length CHECK (length(company_name) <= 200),
  CONSTRAINT organization_partners_industry_length CHECK (industry IS NULL OR length(industry) <= 120),
  CONSTRAINT organization_partners_description_length CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT organization_partners_website_safe_url CHECK (
    website IS NULL OR website = '' OR website ~* '^https?://'
  ),
  CONSTRAINT organization_partners_linkedin_safe_url CHECK (
    linkedin IS NULL OR linkedin = '' OR linkedin ~* '^https?://'
  ),
  CONSTRAINT organization_partners_logo_safe_url CHECK (
    logo_url IS NULL OR logo_url = '' OR logo_url ~* '^https?://'
  ),
  -- Normalized by the trigger; asserted here so no other path can bypass it.
  CONSTRAINT organization_partners_contact_email_normalized CHECK (
    contact_email IS NULL
    OR (contact_email = lower(btrim(contact_email))
        AND contact_email LIKE '%_@_%.__%'
        AND length(contact_email) <= 320)
  )
);

COMMENT ON TABLE public.organization_partners IS
  'An organizer organization''s partner list. Linked event partnerships keep a copy of the basic details, kept equal to the partner''s.';

-- One active partner per name in an organization, ignoring case and spacing.
-- Archived partners are outside it, so a retired name can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS organization_partners_active_name_unique
  ON public.organization_partners (organization_id, lower(btrim(regexp_replace(company_name, '\s+', ' ', 'g'))))
  WHERE archived_at IS NULL;

-- The list includes archived partners, and deleting an organization cascades
-- here; the unique index covers active rows only.
CREATE INDEX IF NOT EXISTS idx_organization_partners_organization
  ON public.organization_partners (organization_id);

-- ============================================================================
-- is_org_event_manager: the caller manages at least one event of the organization
--
-- The same join as the second branch of can_manage_event(): an event_team row
-- counts only while its holder is still a member of the event's organization,
-- so an assignment left behind by someone who has left grants nothing.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_org_event_manager(target_org uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  SELECT public.account_is_active() AND EXISTS (
    SELECT 1
    FROM public.event_team t
    JOIN public.events e ON e.id = t.event_id
    JOIN public.organization_members m
      ON m.organization_id = e.organization_id AND m.user_id = t.user_id
    WHERE e.organization_id = target_org
      AND t.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_org_event_manager(uuid) IS
  'True when the active caller is assigned to at least one event of target_org and is still a member of it. Gives read and create access to the organization''s partner list.';

REVOKE EXECUTE ON FUNCTION public.is_org_event_manager(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_event_manager(uuid) TO authenticated;

-- ============================================================================
-- What a partner write may contain
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_organization_partner_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_type org_type;
BEGIN
  NEW.company_name := btrim(NEW.company_name);

  IF NEW.contact_email IS NOT NULL THEN
    NEW.contact_email := lower(btrim(NEW.contact_email));
    IF NEW.contact_email = '' THEN
      NEW.contact_email := NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The signed-in caller is the creator. With no JWT (a migration's
    -- backfill) the supplied value is kept; the column is NOT NULL either way.
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'A partner cannot be moved to another organization';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a partner cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  -- A signed-in caller who may not create partners in this organization is
  -- left to RLS, so its generic refusal is all they get: answering "not an
  -- organizer organization" first would tell anyone the type of any
  -- organization whose id they hold. UPDATE needs no such step, because only
  -- rows the caller may already edit reach this trigger. With no JWT (a
  -- migration) the check below always runs.
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL
     AND NOT (public.is_org_admin(NEW.organization_id) OR public.is_org_event_manager(NEW.organization_id)) THEN
    RETURN NEW;
  END IF;

  -- A missing organization is left to the foreign key to report.
  SELECT o.org_type INTO v_org_type FROM organizations o WHERE o.id = NEW.organization_id;
  IF FOUND AND v_org_type <> 'organizer' THEN
    RAISE EXCEPTION 'Only an organizer organization can keep a partner list';
  END IF;

  -- Restoring: the unique index would refuse a taken name anyway; this says
  -- which partner is in the way.
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM organization_partners p
      WHERE p.organization_id = NEW.organization_id
        AND p.archived_at IS NULL
        AND p.id <> NEW.id
        AND lower(btrim(regexp_replace(p.company_name, '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(NEW.company_name, '\s+', ' ', 'g')))
    ) THEN
      RAISE EXCEPTION '% already exists. Rename one of them first.', NEW.company_name
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_organization_partner_rules() IS
  'organization_partners: trims the name, normalizes contact_email, records the signed-in creator, fixes organization and creator after insert, allows organizer organizations only (told only to callers RLS would let insert, or with no JWT), and explains a restore whose name is taken.';

REVOKE EXECUTE ON FUNCTION public.enforce_organization_partner_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_organization_partner_rules ON public.organization_partners;
CREATE TRIGGER check_organization_partner_rules
  BEFORE INSERT OR UPDATE ON public.organization_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_partner_rules();

-- ============================================================================
-- RLS and grants -- the access table in the header
--
-- Reading and creating: owners, admins and event managers of the organization.
-- Editing, archiving, restoring and deleting: owners and admins only, because
-- an edit reaches every event the partner is on. Both helpers require an
-- active account. Grants follow the phase 5A packages migration.
-- ============================================================================
ALTER TABLE public.organization_partners ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organization_partners FROM anon;
REVOKE TRUNCATE ON public.organization_partners FROM anon, authenticated;
-- Exactly the four the app uses: no REFERENCES or TRIGGER from the default grants.
REVOKE ALL ON public.organization_partners FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_partners TO authenticated;

DROP POLICY IF EXISTS "read_organization_partners" ON public.organization_partners;
CREATE POLICY "read_organization_partners"
  ON public.organization_partners FOR SELECT TO authenticated
  USING (public.is_org_admin(organization_id) OR public.is_org_event_manager(organization_id));

DROP POLICY IF EXISTS "create_organization_partners" ON public.organization_partners;
CREATE POLICY "create_organization_partners"
  ON public.organization_partners FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id) OR public.is_org_event_manager(organization_id));

DROP POLICY IF EXISTS "update_organization_partners" ON public.organization_partners;
CREATE POLICY "update_organization_partners"
  ON public.organization_partners FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "delete_organization_partners" ON public.organization_partners;
CREATE POLICY "delete_organization_partners"
  ON public.organization_partners FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id));

-- ============================================================================
-- Section 2: linking partnerships to partners
-- ============================================================================

-- Nullable: a partnership typed by hand keeps working until it is linked.
-- NO ACTION, not RESTRICT: the check runs after the statement's cascades, so a
-- deletion that cascades through both events and organizations does not
-- depend on which cascade fires first. The delete guard below is what refuses
-- deleting a linked partner; the foreign key is the backstop.
ALTER TABLE public.event_partnerships
  ADD COLUMN IF NOT EXISTS partner_id uuid
    REFERENCES public.organization_partners(id) ON DELETE NO ACTION;

COMMENT ON COLUMN public.event_partnerships.partner_id IS
  'The organization partner this partnership is for. While set, the six basic company columns equal the partner''s.';

-- The delete guard counts by partner, and so will the sync.
CREATE INDEX IF NOT EXISTS idx_event_partnerships_partner
  ON public.event_partnerships (partner_id);

-- ============================================================================
-- The link fills the copy, and the copy follows the partner
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_partnership_partner_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_old uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.partner_id END;
  v_event_org uuid;
  v_partner organization_partners%ROWTYPE;
BEGIN
  IF NEW.partner_id IS DISTINCT FROM v_old THEN
    -- Changing or clearing a link fixes a wrong pick, which only makes sense
    -- before anyone has been invited. A first link (NULL -> partner) is
    -- allowed in any status: the backfill relies on it.
    IF v_old IS NOT NULL AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'The partner on this partnership can only be changed while it is a draft';
    END IF;

    -- Cleared: the copy stays as it is, and is editable again.
    IF NEW.partner_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- SECURITY DEFINER so the read cannot be hidden by RLS; FOR SHARE so a
    -- concurrent edit, archive or delete of the partner is serialized with
    -- this link. Edit first: this waits, then copies the edited details. Link
    -- first: the edit waits, and its sync then sees this partnership.
    SELECT * INTO v_partner
    FROM organization_partners p
    WHERE p.id = NEW.partner_id
    FOR SHARE;

    SELECT e.organization_id INTO v_event_org FROM events e WHERE e.id = NEW.event_id;

    -- A partner id that does not exist reads as NULL here and gets the same
    -- answer, so the message never tells an id that exists elsewhere from one
    -- that does not. An event with no organization cannot take a partner.
    IF v_event_org IS NULL OR v_partner.organization_id IS DISTINCT FROM v_event_org THEN
      RAISE EXCEPTION 'That partner belongs to another organization';
    END IF;

    IF v_partner.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'That partner is archived. Restore it before adding it to an event.';
    END IF;

    -- The fill wins over anything the client sent for these six.
    NEW.company_name := v_partner.company_name;
    NEW.description  := v_partner.description;
    NEW.logo_url     := v_partner.logo_url;
    NEW.industry     := v_partner.industry;
    NEW.website      := v_partner.website;
    NEW.linkedin     := v_partner.linkedin;
    RETURN NEW;
  END IF;

  -- Not linked, and not being linked: nothing to decide.
  IF NEW.partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The link is unchanged: the copy must still equal the partner. Sending the
  -- same values back (today's Edit Partner dialog) passes; so does the sync,
  -- which sets them equal. IS DISTINCT FROM per column, so NULL equals NULL
  -- while '' and NULL differ. No lock: the row being updated is already
  -- linked, so a concurrent partner edit's sync reaches it after this write.
  SELECT * INTO v_partner FROM organization_partners p WHERE p.id = NEW.partner_id;

  IF FOUND AND (
       NEW.company_name IS DISTINCT FROM v_partner.company_name
    OR NEW.description  IS DISTINCT FROM v_partner.description
    OR NEW.logo_url     IS DISTINCT FROM v_partner.logo_url
    OR NEW.industry     IS DISTINCT FROM v_partner.industry
    OR NEW.website      IS DISTINCT FROM v_partner.website
    OR NEW.linkedin     IS DISTINCT FROM v_partner.linkedin
  ) THEN
    RAISE EXCEPTION 'These details belong to the partner. Edit the partner to change them everywhere.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_partnership_partner_link() IS
  'event_partnerships.partner_id: a link (set or changed) must be to an active partner of the event''s organization and fills the six basic columns from it; an unchanged link refuses any drift from the partner; changing or clearing a link is draft-only. Decided from the data alone, with no session flag.';

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_partner_link() FROM PUBLIC, anon, authenticated;

-- Named to sort after check_event_partnership_rules and
-- check_partnership_package_link, so it sees the row as they leave it (an
-- archived event is refused before any partner is read). No column list: a
-- column list only reacts to the columns named in the UPDATE's SET clause.
DROP TRIGGER IF EXISTS check_partnership_partner_link ON public.event_partnerships;
CREATE TRIGGER check_partnership_partner_link
  BEFORE INSERT OR UPDATE ON public.event_partnerships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_partner_link();

-- ============================================================================
-- A partner on an event is archived, not deleted
--
-- The same guard as the package library's. The row lock a DELETE takes comes
-- before this trigger, and a link holds the partner FOR SHARE, so a link
-- committed concurrently is waited for and counted.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_organization_partner_delete_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_used int;
BEGIN
  -- The organization itself is being deleted and cascades here. Whether that
  -- may happen is not this guard's decision: an organization with events is
  -- refused by the events foreign key (ON DELETE RESTRICT), and linked
  -- partnerships only exist on its events. Letting the cascade through keeps
  -- that outcome the same whichever foreign key fires first.
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO v_used
  FROM event_partnerships ep WHERE ep.partner_id = OLD.id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'This partner has been added to % event partnership(s). Archive it instead of deleting it.', v_used;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.enforce_organization_partner_delete_rules() IS
  'organization_partners: a partner linked to any event partnership cannot be deleted (archive it instead), except as part of deleting its organization.';

REVOKE EXECUTE ON FUNCTION public.enforce_organization_partner_delete_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_organization_partner_delete_rules ON public.organization_partners;
CREATE TRIGGER check_organization_partner_delete_rules
  BEFORE DELETE ON public.organization_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_partner_delete_rules();

-- ============================================================================
-- Section 3: a partner's edit reaches every linked event
--
-- One UPDATE sets the six basic columns of every partnership linked to the
-- partner to the partner's new values. It sets them EQUAL, so the drift rule
-- above lets it through, and every partnership's own trigger still runs (its
-- updated_at moves). SECURITY DEFINER, so every linked event is reached, not
-- only the ones the editor can see: only owners and admins can edit a partner,
-- and they manage every event of the organization anyway.
--
-- A partnership on an archived event is left as it is. Writing to it would be
-- refused (an archived event's partners are frozen), and that refusal would
-- undo the partner edit. Its copy differs from the partner until the event is
-- restored; while it is archived nothing can write to it, and the restore
-- brings it back in line in the same statement (below), so no later write ever
-- meets the difference.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_partner_details_to_partnerships()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE event_partnerships p
     SET company_name = NEW.company_name,
         description  = NEW.description,
         logo_url     = NEW.logo_url,
         industry     = NEW.industry,
         website      = NEW.website,
         linkedin     = NEW.linkedin
   WHERE p.partner_id = NEW.id
     AND NOT EXISTS (
       SELECT 1 FROM events e WHERE e.id = p.event_id AND e.archived_at IS NOT NULL
     );
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_partner_details_to_partnerships() IS
  'Trigger: copies a partner''s six basic columns to every partnership linked to it, except on archived events (they catch up when restored).';

REVOKE EXECUTE ON FUNCTION public.sync_partner_details_to_partnerships() FROM PUBLIC, anon, authenticated;

-- The column list names the six, and WHEN fires only when one of them really
-- changes: an edit of contact_email or archived_at, or a save that sends the
-- same details back, touches no partnership and moves no updated_at. The only
-- BEFORE change to a basic column is trimming company_name, which is stored
-- trimmed already, so no change can arrive outside the SET clause.
DROP TRIGGER IF EXISTS sync_partner_details ON public.organization_partners;
CREATE TRIGGER sync_partner_details
  AFTER UPDATE OF company_name, description, logo_url, industry, website, linkedin
  ON public.organization_partners
  FOR EACH ROW
  WHEN (   OLD.company_name IS DISTINCT FROM NEW.company_name
        OR OLD.description  IS DISTINCT FROM NEW.description
        OR OLD.logo_url     IS DISTINCT FROM NEW.logo_url
        OR OLD.industry     IS DISTINCT FROM NEW.industry
        OR OLD.website      IS DISTINCT FROM NEW.website
        OR OLD.linkedin     IS DISTINCT FROM NEW.linkedin)
  EXECUTE FUNCTION public.sync_partner_details_to_partnerships();

-- ============================================================================
-- A restored event catches up
--
-- AFTER the restore, so check_event_archive_authority (BEFORE) has allowed it
-- and the event row already reads as not archived: the partnerships' own
-- archived-event rule lets these writes through. Only partnerships whose copy
-- differs from their partner are written, so a restore with nothing to catch
-- up moves no updated_at.
--
-- The partners are read FOR SHARE first. A partner edit in flight holds its
-- row, so this waits for it and the UPDATE then reads what it committed. Had
-- the edit skipped this event because it still looked archived, its details
-- arrive here instead.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resync_partner_details_on_event_restore()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
    FROM organization_partners op
   WHERE op.id IN (SELECT p.partner_id FROM event_partnerships p WHERE p.event_id = NEW.id)
   ORDER BY op.id
   FOR SHARE;

  UPDATE event_partnerships p
     SET company_name = op.company_name,
         description  = op.description,
         logo_url     = op.logo_url,
         industry     = op.industry,
         website      = op.website,
         linkedin     = op.linkedin
    FROM organization_partners op
   WHERE p.event_id = NEW.id
     AND op.id = p.partner_id
     AND (   p.company_name IS DISTINCT FROM op.company_name
          OR p.description  IS DISTINCT FROM op.description
          OR p.logo_url     IS DISTINCT FROM op.logo_url
          OR p.industry     IS DISTINCT FROM op.industry
          OR p.website      IS DISTINCT FROM op.website
          OR p.linkedin     IS DISTINCT FROM op.linkedin);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.resync_partner_details_on_event_restore() IS
  'Trigger: when an event is restored, sets each of its linked partnerships to its partner''s current six basic columns (archived events are skipped by the partner sync).';

REVOKE EXECUTE ON FUNCTION public.resync_partner_details_on_event_restore() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resync_partner_details_on_restore ON public.events;
CREATE TRIGGER resync_partner_details_on_restore
  AFTER UPDATE OF archived_at ON public.events
  FOR EACH ROW
  WHEN (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL)
  EXECUTE FUNCTION public.resync_partner_details_on_event_restore();

-- ============================================================================
-- Section 4: existing partnerships become partners
--
-- Every partnership that predates the partner list is unlinked. They are
-- grouped per organization by the same normalized name the unique index uses,
-- so "Kora Payments" and "kora  payments " on two events become one partner.
-- The group's most recently updated partnership supplies the partner's six
-- basic columns, its representative becomes the partner's contact, and its
-- creator becomes the partner's creator. Linking then applies the ordinary
-- fill: every partnership in the group takes the chosen details. That is why
-- the preview reports which of the six differ inside each group.
--
-- Skipped, and counted:
--   - partnerships on archived events (no write reaches them; they link when
--     the event is restored and this is run again);
--   - partnerships on events without an organization (they cannot take a
--     partner at all).
--
-- Neither function is callable by a client, and this migration runs neither.
-- Running the backfill is a separate, approved step, after the preview has been
-- reviewed and after the organizer screens stop sending the six basic columns
-- for linked partnerships: today's Edit Partner form re-sends them normalized
-- (a bare website gains a trailing slash, a blank becomes NULL), so a linked
-- copy holding 'https://x.example' or '' would refuse every save of it. Until
-- then every partnership stays unlinked and behaves exactly as before. The
-- backfill is safe to run again: it only ever touches unlinked partnerships,
-- and an active partner with the group's name is reused.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.preview_organization_partner_merge()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  partner_key text,
  chosen_partnership_id uuid,
  existing_partner_id uuid,
  partnership_ids uuid[],
  event_names text[],
  differing_fields text[],
  chosen_values jsonb,
  differing_values jsonb
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT p.id, p.updated_at, e.organization_id AS org_id, e.name AS event_name,
           p.company_name, p.description, p.logo_url, p.industry, p.website, p.linkedin,
           lower(btrim(regexp_replace(p.company_name, '\s+', ' ', 'g'))) AS name_key
      FROM event_partnerships p
      JOIN events e ON e.id = p.event_id
     WHERE p.partner_id IS NULL
       AND e.organization_id IS NOT NULL
       AND e.archived_at IS NULL
  ), groups AS (
    SELECT c.org_id, c.name_key,
           (array_agg(c.id ORDER BY c.updated_at DESC, c.id))[1] AS chosen,
           array_agg(c.id ORDER BY c.updated_at DESC, c.id) AS ids,
           array_agg(c.event_name ORDER BY c.updated_at DESC, c.id) AS names,
           array_remove(ARRAY[
             CASE WHEN count(DISTINCT coalesce(c.company_name, '<null>')) > 1 THEN 'company_name' END,
             CASE WHEN count(DISTINCT coalesce(c.description,  '<null>')) > 1 THEN 'description' END,
             CASE WHEN count(DISTINCT coalesce(c.logo_url,     '<null>')) > 1 THEN 'logo_url' END,
             CASE WHEN count(DISTINCT coalesce(c.industry,     '<null>')) > 1 THEN 'industry' END,
             CASE WHEN count(DISTINCT coalesce(c.website,      '<null>')) > 1 THEN 'website' END,
             CASE WHEN count(DISTINCT coalesce(c.linkedin,     '<null>')) > 1 THEN 'linkedin' END
           ], NULL) AS differing,
           jsonb_strip_nulls(jsonb_build_object(
             'company_name', CASE WHEN count(DISTINCT coalesce(c.company_name, '<null>')) > 1 THEN to_jsonb(array_agg(DISTINCT c.company_name)) END,
             'description',  CASE WHEN count(DISTINCT coalesce(c.description,  '<null>')) > 1 THEN to_jsonb(array_agg(DISTINCT c.description)) END,
             'logo_url',     CASE WHEN count(DISTINCT coalesce(c.logo_url,     '<null>')) > 1 THEN to_jsonb(array_agg(DISTINCT c.logo_url)) END,
             'industry',     CASE WHEN count(DISTINCT coalesce(c.industry,     '<null>')) > 1 THEN to_jsonb(array_agg(DISTINCT c.industry)) END,
             'website',      CASE WHEN count(DISTINCT coalesce(c.website,      '<null>')) > 1 THEN to_jsonb(array_agg(DISTINCT c.website)) END,
             'linkedin',     CASE WHEN count(DISTINCT coalesce(c.linkedin,     '<null>')) > 1 THEN to_jsonb(array_agg(DISTINCT c.linkedin)) END
           )) AS differing_values
      FROM candidates c
     GROUP BY c.org_id, c.name_key
  )
  SELECT g.org_id, o.name, g.name_key, g.chosen, op.id, g.ids, g.names, g.differing,
         jsonb_build_object('company_name', ch.company_name, 'description', ch.description,
                            'logo_url', ch.logo_url, 'industry', ch.industry,
                            'website', ch.website, 'linkedin', ch.linkedin),
         g.differing_values
    FROM groups g
    JOIN organizations o ON o.id = g.org_id
    JOIN event_partnerships ch ON ch.id = g.chosen
    LEFT JOIN organization_partners op
      ON op.organization_id = g.org_id
     AND op.archived_at IS NULL
     AND lower(btrim(regexp_replace(op.company_name, '\s+', ' ', 'g'))) = g.name_key
   ORDER BY o.name, g.name_key;
$$;

COMMENT ON FUNCTION public.preview_organization_partner_merge() IS
  'Read-only: what backfill_organization_partners() would do. One row per organization and normalized name: the chosen partnership and the six values the partner would take from it, plus every value of each basic column that differs inside the group. Not callable by clients.';

REVOKE EXECUTE ON FUNCTION public.preview_organization_partner_merge() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.backfill_organization_partners()
RETURNS TABLE (
  partners_created int,
  partnerships_linked int,
  skipped_archived_event int,
  skipped_no_organization int
)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public, pg_temp
AS $$
DECLARE
  g record;
  v_partner uuid;
  v_rows int;
  v_created int := 0;
  v_linked int := 0;
  v_archived int;
  v_no_org int;
BEGIN
  FOR g IN SELECT * FROM public.preview_organization_partner_merge() LOOP
    v_partner := g.existing_partner_id;

    IF v_partner IS NULL THEN
      -- With no signed-in user the partner rules keep this created_by.
      INSERT INTO organization_partners
        (organization_id, company_name, description, logo_url, industry, website, linkedin,
         contact_email, created_by)
      SELECT g.organization_id, p.company_name, p.description, p.logo_url, p.industry,
             p.website, p.linkedin, p.representative_email, p.created_by
        FROM event_partnerships p
       WHERE p.id = g.chosen_partnership_id
      RETURNING id INTO v_partner;
      v_created := v_created + 1;
    END IF;

    -- NULL to partner: allowed in any status, and the link fills the copy.
    UPDATE event_partnerships
       SET partner_id = v_partner
     WHERE id = ANY (g.partnership_ids)
       AND partner_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_linked := v_linked + v_rows;
  END LOOP;

  SELECT count(*) FILTER (WHERE e.organization_id IS NOT NULL AND e.archived_at IS NOT NULL)::int,
         count(*) FILTER (WHERE e.organization_id IS NULL)::int
    INTO v_archived, v_no_org
    FROM event_partnerships p
    JOIN events e ON e.id = p.event_id
   WHERE p.partner_id IS NULL;

  RETURN QUERY SELECT v_created, v_linked, v_archived, v_no_org;
END;
$$;

COMMENT ON FUNCTION public.backfill_organization_partners() IS
  'Links every unlinked partnership on a live organization event to a partner, creating partners from the most recently updated partnership of each name group. Idempotent. Returns what it did and what it skipped. Not callable by clients.';

REVOKE EXECUTE ON FUNCTION public.backfill_organization_partners() FROM PUBLIC, anon, authenticated;

