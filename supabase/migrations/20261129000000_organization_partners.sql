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
