-- ===========================================================================
-- Phase 6A -- Sponsor partnership workspace: the safe read model.
--
-- After a partnership invitation is accepted, the people at the sponsoring
-- company need to see the partnership they just agreed to: what the organizer
-- owes them, what they owe the organizer, how far along it all is, and the
-- documents the organizer chose to share.
--
-- This migration adds NO table and NO column. It adds the read contracts that
-- make that workspace possible, and -- more importantly -- it closes the two
-- places where "member of the linked sponsor organization" already granted
-- more than this product intends.
--
-- The authority chain, which nothing here changes:
--
--   authenticated user
--     -> organization_members row
--       -> the organization a partnership was LINKED to on acceptance
--         -> that one partnership
--
-- Not account_type. A professional who accepts a sponsorship invitation stays
-- account_type = 'attendee' and becomes an owner of the sponsor organization;
-- that is the shipped behaviour of phase 3A and the workspace reads from the
-- membership, never from the account type.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The rule, written once.
--
-- Every sponsor-side contract below is gated on this set, so there is exactly
-- one definition of "a partnership I may read as a sponsor" to audit, and no
-- second copy to drift out of step with it.
--
-- Four conditions, and each one is load-bearing:
--
--   sponsor_organization_id IS NOT NULL
--     The link only exists after acceptance. enforce_event_partnership_rules
--     refuses to set it except from inside finish_partnership_acceptance, so
--     this cannot be forged by an organizer or by a client.
--
--   acknowledged_at IS NOT NULL
--     Proof that a human accepted. Also written only by that same function,
--     and restored from OLD on every ordinary update.
--
--   status IN ('active', 'completed', 'cancelled')
--     'draft' and 'invited' are the organizer still deciding, and the sponsor
--     must not discover either through this workspace. This is not theoretical
--     tidiness: the status machine allows cancelled -> draft, and the link can
--     never be removed once set, so an accepted-then-cancelled-then-re-drafted
--     partnership really is a linked row with status 'draft'. While it sits
--     there it is organizer-private again. Phase 3B's invitation review remains
--     the one and only pre-acceptance window.
--
--   account_is_active()
--     A suspended account keeps its memberships; it does not keep its access.
--
-- Returning a set of ids rather than a boolean is what lets the list contract
-- filter with a single join instead of a per-row function call.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_sponsor_partnership_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM event_partnerships p
  WHERE p.sponsor_organization_id IS NOT NULL
    AND p.acknowledged_at IS NOT NULL
    AND p.status IN ('active', 'completed', 'cancelled')
    AND public.account_is_active()
    AND public.is_org_member(p.sponsor_organization_id);
$$;

REVOKE EXECUTE ON FUNCTION public.my_sponsor_partnership_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_sponsor_partnership_ids() TO authenticated;

-- The same rule as a predicate. SECURITY INVOKER on purpose: the privileged
-- read happens inside the function above, so this one needs no privileges of
-- its own and is safe to call from anywhere.
CREATE OR REPLACE FUNCTION public.is_my_sponsor_partnership(target_partnership_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.my_sponsor_partnership_ids() i
    WHERE i = target_partnership_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_my_sponsor_partnership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_sponsor_partnership(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2. Evidence goes back to being organizer-side only.
--
-- A FOUND DEFECT, not a design change.
--
-- Phase 1 gave the three partnership child tables a SELECT policy of
-- can_read_partnership(partnership_id), which is "can manage the event OR is a
-- member of the linked sponsor organization". The parent table has no such
-- policy -- event_partnerships is organizer-only -- so a sponsor could read
-- rows belonging to a partnership whose own row they cannot see.
--
-- For roles and obligations that extra read is harmless in intent but still
-- wrong in detail: it hands out created_by and completed_by user ids, and it
-- ignores the lifecycle rule above, so a re-drafted partnership's obligations
-- would stay readable after the partnership itself stopped being visible.
--
-- For obligation EVIDENCE it is a genuine exposure. Evidence is the organizer's
-- operational proof that they did something -- a file, a link, an internal note
-- -- and it was built with no sponsor-facing visibility model at all, unlike
-- partnership documents, which have one (internal / shared). Phase 6A is the
-- first phase in which a sponsor actually signs in and looks, so this is the
-- moment to close it rather than the moment to inherit it. Sponsor-visible
-- evidence, if it is ever wanted, needs a deliberate visibility model of its
-- own; it should not arrive by accident.
--
-- So all three SELECT policies become plain can_manage_event(event_id), which
-- is byte-for-byte what an organizer already had, and sponsors read through the
-- purpose-built contracts further down instead. Nothing in the shipped product
-- loses access: every organizer path goes through can_manage_event, the
-- phase 3B invitee functions are SECURITY DEFINER and bypass RLS entirely, and
-- there is no sponsor UI yet -- which is the whole point of this phase.
--
-- Partnership DOCUMENTS are deliberately untouched: their read policy keeps the
-- sponsor branch, because 'shared' is an explicit, organizer-controlled
-- decision and the storage layer needs that row-level read to sign a URL.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS read_event_partnership_roles ON public.event_partnership_roles;
CREATE POLICY read_event_partnership_roles
  ON public.event_partnership_roles
  FOR SELECT TO authenticated
  USING (public.can_manage_event(event_id));

DROP POLICY IF EXISTS read_event_partnership_obligations ON public.event_partnership_obligations;
CREATE POLICY read_event_partnership_obligations
  ON public.event_partnership_obligations
  FOR SELECT TO authenticated
  USING (public.can_manage_event(event_id));

DROP POLICY IF EXISTS read_event_partnership_evidence ON public.event_partnership_obligation_evidence;
CREATE POLICY read_event_partnership_evidence
  ON public.event_partnership_obligation_evidence
  FOR SELECT TO authenticated
  USING (public.can_manage_event(event_id));

-- And the same correction one layer down. Supabase requires SELECT on a storage
-- object before it will sign a URL for it, so this policy IS the authorization
-- check for every evidence file; leaving it on can_read_partnership would have
-- kept handing sponsors signed URLs for the organizer's proof files even after
-- the rows above stopped being readable. The policy name already claimed
-- "for managed events" -- now it is true.
DROP POLICY IF EXISTS "Read partnership assets for managed events" ON storage.objects;
CREATE POLICY "Read partnership assets for managed events"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'partnership-assets'
    AND EXISTS (
      SELECT 1
      FROM public.event_partnership_obligation_evidence ev
      WHERE ev.file_path = name
        AND public.can_manage_event(ev.event_id)
    )
  );

-- can_read_partnership() is now referenced by no policy and no function. It is
-- left in place rather than dropped -- phase 1 created it and dropping it buys
-- nothing -- but it no longer describes how anything is authorized, and a later
-- phase that reaches for it as "the partnership read rule" would silently
-- re-open what the policies above just closed. Say so where it will be seen.
COMMENT ON FUNCTION public.can_read_partnership(uuid) IS
  'Superseded (phase 6A) and unreferenced. Organizer access is can_manage_event(event_id); sponsor-side access is my_sponsor_partnership_ids() / is_my_sponsor_partnership(). Do not reintroduce this as a SELECT policy: it ignores the partnership lifecycle and the account status.';


-- ---------------------------------------------------------------------------
-- 3. My Partnerships.
--
-- Replaces the phase 1 function of the same name. That version was written
-- before there was anything to point at it -- nothing in the application has
-- ever called it -- and it had three problems this one fixes: it ignored
-- account status, it returned organizer drafts whenever a link happened to
-- exist, and it could not name the organizer, which is the one party the
-- sponsor cannot look up for themselves (organizations is readable only to its
-- own members, and events only when published or when you are involved).
--
-- DROP then CREATE because the result columns change, which CREATE OR REPLACE
-- cannot do.
--
-- What a sponsor may see here is their own side of their own agreement:
--
--   the event, enough to recognise it and place it in time
--   the organizer's public identity
--   which of their organizations the partnership belongs to
--   the commercial terms THEY agreed -- value_amount and value_currency off
--     the partnership row, never a package's suggested figure
--   tier_label, which is the partnership's own snapshot of a tier name and not
--     a live pointer into the organizer's package library
--   the roles attached to this partnership
--   progress, counted by the server
--
-- What it does not return, deliberately: internal_notes (organizer-private
-- commentary), representative_email and any other contact detail, created_by
-- and every other internal user id, package_id and anything else that would
-- lead into the organizer's package library, and any field belonging to another
-- partnership. The column list is the whole exposure -- there is no row shape
-- here from which more could be derived.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.my_sponsor_partnerships();

CREATE FUNCTION public.my_sponsor_partnerships()
RETURNS TABLE (
  partnership_id uuid,
  event_id uuid,
  event_name text,
  event_start_date date,
  event_end_date date,
  event_location text,
  event_status text,
  event_archived boolean,
  organizer_organization_id uuid,
  organizer_organization_name text,
  organizer_organization_logo_url text,
  sponsor_organization_id uuid,
  sponsor_organization_name text,
  company_name text,
  tier_label text,
  status text,
  acknowledged_at timestamptz,
  created_at timestamptz,
  value_amount numeric,
  value_currency text,
  roles text[],
  deliverables_total bigint,
  deliverables_completed bigint,
  requirements_total bigint,
  requirements_completed bigint,
  overall_total bigint,
  overall_completed bigint,
  overall_percent integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.event_id,
    e.name,
    e.start_date,
    e.end_date,
    e.location,
    e.status,
    (e.archived_at IS NOT NULL),
    og.id,
    og.name,
    og.logo_url,
    p.sponsor_organization_id,
    sg.name,
    p.company_name,
    p.tier_label,
    p.status,
    p.acknowledged_at,
    p.created_at,
    p.value_amount,
    p.value_currency,
    COALESCE((SELECT array_agg(r.role ORDER BY r.role)
                FROM event_partnership_roles r
               WHERE r.partnership_id = p.id),
             ARRAY[]::text[]),
    COALESCE(o.deliverables_total, 0),
    COALESCE(o.deliverables_completed, 0),
    COALESCE(o.requirements_total, 0),
    COALESCE(o.requirements_completed, 0),
    COALESCE(o.deliverables_total, 0) + COALESCE(o.requirements_total, 0),
    COALESCE(o.deliverables_completed, 0) + COALESCE(o.requirements_completed, 0),
    -- NULL, not 0 and not 100, when there is nothing to be a fraction of. A
    -- partnership with no obligations yet has no progress -- saying "0%" would
    -- read as "nothing done" and "100%" as "all done", and both are claims the
    -- data does not support. One server-side figure also keeps every client
    -- from reinventing the divide-by-zero check.
    CASE
      WHEN COALESCE(o.deliverables_total, 0) + COALESCE(o.requirements_total, 0) = 0 THEN NULL
      ELSE round(
             100.0
             * (COALESCE(o.deliverables_completed, 0) + COALESCE(o.requirements_completed, 0))
             / (COALESCE(o.deliverables_total, 0) + COALESCE(o.requirements_total, 0))
           )::int
    END
  FROM event_partnerships p
  JOIN events e ON e.id = p.event_id
  LEFT JOIN organizations og ON og.id = e.organization_id
  LEFT JOIN organizations sg ON sg.id = p.sponsor_organization_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE ob.direction = 'organizer_to_partner') AS deliverables_total,
      count(*) FILTER (WHERE ob.direction = 'organizer_to_partner'
                         AND ob.status = 'completed')               AS deliverables_completed,
      count(*) FILTER (WHERE ob.direction = 'partner_to_organizer') AS requirements_total,
      count(*) FILTER (WHERE ob.direction = 'partner_to_organizer'
                         AND ob.status = 'completed')               AS requirements_completed
    FROM event_partnership_obligations ob
    WHERE ob.partnership_id = p.id
  ) o ON true
  -- Archived events are NOT excluded: a partnership that happened is still a
  -- partnership that happened, and the sponsor's own history should not vanish
  -- because the organizer tidied up. event_archived says so instead.
  WHERE p.id IN (SELECT public.my_sponsor_partnership_ids())
  ORDER BY e.start_date DESC NULLS LAST, e.name, p.company_name;
$$;

REVOKE EXECUTE ON FUNCTION public.my_sponsor_partnerships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_sponsor_partnerships() TO authenticated;


-- ---------------------------------------------------------------------------
-- 4. One partnership.
--
-- Knowing a partnership id is not authorization, so this does not trust the
-- argument for anything except filtering: it selects FROM the list contract
-- above, which means the authorization, the lifecycle rule and the exposed
-- column list are all literally the same code. A detail view cannot drift from
-- the list view, and cannot return a field the list would not.
--
-- An id the caller may not read is not an error -- it returns no rows, exactly
-- like an id that does not exist. Nothing distinguishes "not yours" from "no
-- such thing", which is what keeps this from being an enumeration oracle.
--
-- SECURITY INVOKER: the function it reads from is the privileged one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_sponsor_partnership(target_partnership_id uuid)
RETURNS TABLE (
  partnership_id uuid,
  event_id uuid,
  event_name text,
  event_start_date date,
  event_end_date date,
  event_location text,
  event_status text,
  event_archived boolean,
  organizer_organization_id uuid,
  organizer_organization_name text,
  organizer_organization_logo_url text,
  sponsor_organization_id uuid,
  sponsor_organization_name text,
  company_name text,
  tier_label text,
  status text,
  acknowledged_at timestamptz,
  created_at timestamptz,
  value_amount numeric,
  value_currency text,
  roles text[],
  deliverables_total bigint,
  deliverables_completed bigint,
  requirements_total bigint,
  requirements_completed bigint,
  overall_total bigint,
  overall_completed bigint,
  overall_percent integer
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.my_sponsor_partnerships() r
  WHERE r.partnership_id = target_partnership_id;
$$;

REVOKE EXECUTE ON FUNCTION public.my_sponsor_partnership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_sponsor_partnership(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. Deliverables and requirements.
--
-- Both directions in one call, because they are two halves of one agreement and
-- the frontend should not have to make two round trips to show two lists:
--
--   direction = 'organizer_to_partner'  what the organizer owes the partner
--                                       -> "Deliverables" (logo placement,
--                                          booth, stage mention, passes)
--   direction = 'partner_to_organizer'  what the partner owes the organizer
--                                       -> "Requirements" (logo file, company
--                                          profile, artwork, rep details)
--
-- These are the partnership's ACTUAL obligations. Package default deliverables
-- are a template that was copied once at creation time, by phase 5A, and are
-- never read here: if the organizer has since edited, added or removed an
-- obligation, this returns what the partnership says today.
--
-- Sponsor-safe fields were chosen one at a time, not by taking the row:
--
--   id            needed to key a list, and useless on its own
--   direction     the only thing that splits the two lists
--   title,
--   description,
--   category,
--   quantity      the substance of the commitment
--   due_date      nullable, and a date the sponsor is entitled to know
--   status        pending / in_progress / completed, the organizer's own words
--   completed_at  when, which is the part that is actually informative
--   display_order so both sides read it in the order the organizer arranged
--
-- Left out: created_by and completed_by, which are raw user ids of organizer
-- staff. WHO on the organizing team ticked a box is internal operational
-- detail; the sponsor needs to know that it is done and when. No evidence is
-- returned either -- not a row, not a note, not a file path -- and after the
-- policy change above there is no table-level route to it either.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_sponsor_partnership_obligations(target_partnership_id uuid)
RETURNS TABLE (
  id uuid,
  direction text,
  title text,
  description text,
  category text,
  quantity integer,
  due_date date,
  status text,
  completed_at timestamptz,
  display_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ob.id,
    ob.direction,
    ob.title,
    ob.description,
    ob.category,
    ob.quantity,
    ob.due_date,
    ob.status,
    ob.completed_at,
    ob.display_order
  FROM event_partnership_obligations ob
  WHERE ob.partnership_id = target_partnership_id
    AND public.is_my_sponsor_partnership(target_partnership_id)
  -- 'organizer_to_partner' sorts before 'partner_to_organizer', so deliverables
  -- come first, which is the order the workspace reads in.
  ORDER BY ob.direction, ob.display_order, ob.created_at, ob.id;
$$;

REVOKE EXECUTE ON FUNCTION public.my_sponsor_partnership_obligations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_sponsor_partnership_obligations(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- 6. A suspended account loses the sponsor side too.
--
-- The second found defect, and a small one. is_partnership_sponsor_member() is
-- phase 5B's sponsor predicate, and it asks only about membership -- so a
-- suspended account kept its shared partnership documents, both the rows and
-- the signed URLs, while losing everything else in Rally.
--
-- account_is_active() already gates every write in the product and now gates
-- this read, which is what makes "an inactive account does not get a sponsor
-- workspace" true across the whole sponsor surface rather than only in the
-- contracts above. Adding the one term here reaches the documents table policy
-- and can_read_partnership_document_object() at the same time, because both go
-- through this function.
--
-- The partnership LIFECYCLE is deliberately not folded in here. Suspension is
-- platform-level: the account loses access to everything. Which partnerships a
-- sponsor may see is a per-partnership question, and documents already have
-- their own answer to it -- 'internal' versus 'shared', which the organizer
-- controls directly. The signature and every other term are unchanged, so the
-- phase 5B policies keep working exactly as they were probed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_partnership_sponsor_member(target_partnership_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_partnerships p
    WHERE p.id = target_partnership_id
      AND p.sponsor_organization_id IS NOT NULL
      AND public.account_is_active()
      AND public.is_org_member(p.sponsor_organization_id)
  );
$$;


-- ===========================================================================
-- Deliberately NOT in this migration
-- ===========================================================================
--
-- A documents contract. Phase 5B's get_partnership_documents already returns
-- exactly the sponsor-safe set -- 'shared' rows only, for a partnership whose
-- linked organization the caller belongs to -- and the private bucket plus the
-- 60-second signed URL is unchanged. A second projection would have been a
-- second thing to keep correct for no gain.
--
-- A progress contract. The counts and overall_percent ride along on the
-- partnership row in both contracts above, so the workspace gets them without
-- an extra round trip and cannot compute them differently from the server.
--
-- Any write. No sponsor may edit value, tier, roles, deliverables or
-- requirements, complete an obligation, upload evidence or a document, change a
-- document's visibility, or cancel a partnership. The write policies on every
-- one of those tables remain can_manage_event(event_id) AND account_is_active(),
-- untouched by this migration.
--
-- Requirement submissions (phase 6B), sponsor-visible evidence, messaging,
-- meetings and anything AI. Phase 6A exposes requirements so the sponsor can
-- READ what is expected of them; sending it is a separate design.
-- ===========================================================================
