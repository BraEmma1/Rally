/*
# Event partnerships phase 5A: sponsorship packages and default deliverables

Two tables, one nullable column on `event_partnerships`, and six functions.

## Templates, not bindings
A package's deliverables are a STARTING POINT that is copied into a
partnership once, at the moment the organizer applies it. After that the two
have nothing to do with each other:

  - editing a partnership's obligation does not touch the template;
  - editing the template does not touch any partnership already created;
  - applying the same package to a second partner copies whatever the template
    says THEN, not what it said before.

Nothing in this migration ever reads a package to decide what a partnership
owes. `event_partnership_obligations` stays the only source of truth for that,
which is also what keeps phase 3B's invitation review honest -- the invitee
reviews the negotiated partnership, never the generic package.

## Package name vs `tier_label`
Rally already had a partnership tier: `event_partnerships.tier_label`, free
text in the organizer's own words, and the label the Partners list, Partner
Detail, the invitation email and phase 3B's review all display.

These are kept as two different things:

    package     a reusable template belonging to one event
    tier_label  this partnership's own label, copied once and then its own

Applying a package fills `tier_label` from the package name WHEN the
partnership has none, and never overwrites one. So renaming "Gold" to "Gold
Sponsorship 2027", or archiving it, cannot change what an existing partnership
says it is -- the snapshot is already in `tier_label`. No existing read path
changes, and phase 3B needs no modification at all.

## Event-scoped, declaratively
A package belongs to one event. Rather than trusting a check, the chain is
pinned by composite foreign keys, as it is everywhere else in this feature:

    package deliverables (package_id, event_id) -> packages     (id, event_id)
    partnerships         (package_id, event_id) -> packages     (id, event_id)

So a partnership cannot reference a package from another event, and a
template deliverable cannot belong to a package from another event. The
database cannot represent it, so there is no validation to forget.

## Not built here
No organization-wide package library, no requirement templates, no documents,
no AI extraction, no package switching after creation. See the notes at the
end for why the last one is deferred rather than shipped.
*/

-- ============================================================================
-- event_partnership_packages
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- The organizer's own word for it: "Gold", "Headline Sponsor", "Media
  -- Partner Package". Rally keeps no vocabulary of its own. Matched to
  -- tier_label's 80 characters, because applying a package copies one into
  -- the other and a package that could not be copied would be a trap.
  name text NOT NULL,
  description text,

  -- A suggested price, not a charge. Rally does not invoice.
  value_amount numeric,
  value_currency text,

  display_order integer NOT NULL DEFAULT 0,

  -- Archival rather than is_active: `archived_at` is how events and
  -- organizations already retire, and a second convention for the same idea
  -- would be one too many.
  archived_at timestamptz,

  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_partnership_packages_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT event_partnership_packages_name_length CHECK (length(name) <= 80),
  CONSTRAINT event_partnership_packages_description_length
    CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT event_partnership_packages_value_non_negative
    CHECK (value_amount IS NULL OR value_amount >= 0),
  CONSTRAINT event_partnership_packages_currency_shape
    CHECK (value_currency IS NULL OR value_currency ~ '^[A-Z]{3}$'),

  -- Composite-FK target for both deliverables and partnerships.
  CONSTRAINT event_partnership_packages_id_event_unique UNIQUE (id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_partnership_packages_event_order
  ON event_partnership_packages (event_id, display_order, name);

-- ============================================================================
-- event_partnership_package_deliverables
--
-- The same shape as an obligation minus everything that only makes sense once
-- a real partner is attached: no direction (a package describes what the
-- ORGANIZER provides, so every row is organizer_to_partner by construction),
-- no status, no completion, no evidence.
--
-- due_date is kept and is nullable. A package belongs to ONE event, so "booth
-- artwork due 15 September" is a well-defined date for every sponsor of that
-- event -- it is only sponsor-specific timing that a template cannot know,
-- and leaving it NULL says exactly that.
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_partnership_package_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  event_id uuid NOT NULL,

  title text NOT NULL,
  description text,
  category text,
  quantity integer,
  due_date date,
  display_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT package_deliverables_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT package_deliverables_title_length CHECK (length(title) <= 200),
  CONSTRAINT package_deliverables_description_length
    CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT package_deliverables_category_length
    CHECK (category IS NULL OR length(category) <= 80),
  CONSTRAINT package_deliverables_quantity_positive
    CHECK (quantity IS NULL OR quantity > 0),

  CONSTRAINT package_deliverables_package_fk
    FOREIGN KEY (package_id, event_id)
    REFERENCES event_partnership_packages (id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_package_deliverables_package
  ON event_partnership_package_deliverables (package_id, display_order, created_at);

-- ============================================================================
-- The partnership's provenance
--
-- Nullable, and it stays nullable: every partnership that exists today has no
-- package and must keep working exactly as it does. This records WHERE a
-- partnership started, and is never consulted to decide what it owes.
--
-- ON DELETE SET NULL names the column explicitly (PostgreSQL 15+), because
-- the other half of this composite key is `event_id`, which is NOT NULL --
-- a bare SET NULL would try to blank it too. In practice the delete trigger
-- below refuses to remove a package any partnership points at, so this is the
-- behaviour for the one case that can still reach it: the event itself being
-- deleted, which cascades both sides anyway.
-- ============================================================================
ALTER TABLE event_partnerships
  ADD COLUMN IF NOT EXISTS package_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_partnerships_package_fk'
  ) THEN
    ALTER TABLE event_partnerships
      ADD CONSTRAINT event_partnerships_package_fk
      FOREIGN KEY (package_id, event_id)
      REFERENCES event_partnership_packages (id, event_id)
      ON DELETE SET NULL (package_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_partnerships_package
  ON event_partnerships (package_id) WHERE package_id IS NOT NULL;

-- ============================================================================
-- RLS -- organizer-only, exactly like the rest of the partnership feature
--
-- A package is operational and commercial: what the organizer is willing to
-- sell and for how much. There is no attendee or sponsor read for it at this
-- phase, so there is no reason to widen beyond can_manage_event. Phase 3B's
-- invitee projection does not touch these tables.
-- ============================================================================
ALTER TABLE event_partnership_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_partnership_package_deliverables ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_partnership_packages FROM anon;
REVOKE ALL ON public.event_partnership_package_deliverables FROM anon;
REVOKE TRUNCATE ON public.event_partnership_packages FROM anon, authenticated;
REVOKE TRUNCATE ON public.event_partnership_package_deliverables FROM anon, authenticated;

DROP POLICY IF EXISTS "manage_event_partnership_packages" ON event_partnership_packages;
CREATE POLICY "manage_event_partnership_packages"
  ON event_partnership_packages FOR ALL TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

-- The child derives authority from its own event_id, which the composite key
-- has already pinned to the parent's.
DROP POLICY IF EXISTS "manage_package_deliverables" ON event_partnership_package_deliverables;
CREATE POLICY "manage_package_deliverables"
  ON event_partnership_package_deliverables FOR ALL TO authenticated
  USING (public.can_manage_event(event_id) AND public.account_is_active())
  WITH CHECK (public.can_manage_event(event_id) AND public.account_is_active());

-- ============================================================================
-- What a package write may contain
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_partnership_package_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  NEW.name := btrim(NEW.name);

  IF NEW.value_currency IS NOT NULL THEN
    NEW.value_currency := upper(btrim(NEW.value_currency));
    IF NEW.value_currency = '' THEN
      NEW.value_currency := NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A package cannot be moved to another event';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'The creator of a package cannot be changed';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_package_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_partnership_package_rules ON event_partnership_packages;
CREATE TRIGGER check_partnership_package_rules
  BEFORE INSERT OR UPDATE ON event_partnership_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_package_rules();

-- ============================================================================
-- Deletion: an unused package may be discarded, a used one is archived
--
-- The same shape as the partnership delete rule. A package somebody has
-- already sold against is part of how an existing partnership came to be, so
-- it is retired rather than erased -- and `archived_at` already is the
-- soft-delete.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_partnership_package_delete_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
  v_used int;
BEGIN
  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = OLD.event_id;
  -- The event itself being deleted cascades here; that is not an edit.
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  SELECT count(*) INTO v_used
  FROM event_partnerships p WHERE p.package_id = OLD.id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'This package has been used by % partnership(s). Archive it instead of deleting it.', v_used;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_partnership_package_delete_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_partnership_package_delete_rules ON event_partnership_packages;
CREATE TRIGGER check_partnership_package_delete_rules
  BEFORE DELETE ON event_partnership_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_package_delete_rules();

-- ============================================================================
-- Template deliverables: updated_at, and the archive freeze
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_package_deliverable_rules()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.package_id IS DISTINCT FROM OLD.package_id
       OR NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'A default deliverable cannot be moved to another package';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;

  SELECT e.archived_at INTO v_archived FROM events e WHERE e.id = NEW.event_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This event is archived. Restore it before changing its partners.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_package_deliverable_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_package_deliverable_rules ON event_partnership_package_deliverables;
CREATE TRIGGER check_package_deliverable_rules
  BEFORE INSERT OR UPDATE ON event_partnership_package_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.enforce_package_deliverable_rules();

-- Deleting a template deliverable on an archived event is a write too. Phase
-- 1's shared helper already does exactly this check from OLD.event_id.
DROP TRIGGER IF EXISTS check_package_deliverable_delete_archive
  ON event_partnership_package_deliverables;
CREATE TRIGGER check_package_deliverable_delete_archive
  BEFORE DELETE ON event_partnership_package_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partnership_child_not_archived();

-- ============================================================================
-- Read contract
--
-- Deliverables are a plain SELECT under the policy above. The package LIST is
-- the one thing a single query cannot do in one round trip, because it needs
-- the template count and the usage count per package -- and usage is what the
-- UI needs to know whether Delete may be offered at all.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_partnership_packages(target_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name text,
  description text,
  value_amount numeric,
  value_currency text,
  display_order integer,
  archived_at timestamptz,
  deliverable_count bigint,
  partnership_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT
    k.id, k.event_id, k.name, k.description,
    k.value_amount, k.value_currency, k.display_order, k.archived_at,
    COALESCE(d.n, 0),
    COALESCE(u.n, 0),
    k.created_at, k.updated_at
  FROM event_partnership_packages k
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM event_partnership_package_deliverables pd
    WHERE pd.package_id = k.id
  ) d ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM event_partnerships p WHERE p.package_id = k.id
  ) u ON true
  WHERE k.event_id = target_event_id
  ORDER BY k.display_order, k.name;
$$;

-- ============================================================================
-- Ordering
--
-- Same shape as reorder_event_sessions / _speakers / _exhibitors /
-- partnership_obligations: one atomic statement, every id checked against the
-- parent first so a caller cannot renumber another event's packages.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reorder_event_partnership_packages(
  target_event_id uuid,
  package_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.can_manage_event(target_event_id) OR NOT public.account_is_active() THEN
    RAISE EXCEPTION 'You do not manage this event';
  END IF;

  SELECT count(*) INTO v_count
  FROM unnest(package_ids) AS pid
  WHERE NOT EXISTS (
    SELECT 1 FROM event_partnership_packages k
    WHERE k.id = pid AND k.event_id = target_event_id
  );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Those packages do not all belong to this event';
  END IF;

  UPDATE event_partnership_packages k
  SET display_order = ordered.ord
  FROM (SELECT pid, (ordinality - 1)::int AS ord
        FROM unnest(package_ids) WITH ORDINALITY AS t(pid, ordinality)) ordered
  WHERE k.id = ordered.pid;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_package_deliverables(
  target_package_id uuid,
  deliverable_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_count int;
BEGIN
  -- RLS decides whether this package is visible; no row means no authority.
  SELECT k.event_id INTO v_event
  FROM event_partnership_packages k WHERE k.id = target_package_id;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'That package is not available to change';
  END IF;

  SELECT count(*) INTO v_count
  FROM unnest(deliverable_ids) AS did
  WHERE NOT EXISTS (
    SELECT 1 FROM event_partnership_package_deliverables pd
    WHERE pd.id = did AND pd.package_id = target_package_id
  );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Those deliverables do not all belong to this package';
  END IF;

  UPDATE event_partnership_package_deliverables pd
  SET display_order = ordered.ord
  FROM (SELECT did, (ordinality - 1)::int AS ord
        FROM unnest(deliverable_ids) WITH ORDINALITY AS t(did, ordinality)) ordered
  WHERE pd.id = ordered.did;
END;
$$;

-- ============================================================================
-- apply_partnership_package -- the one that matters
--
-- Copies a package's default deliverables into a partnership as real
-- obligations, records where they came from, and optionally takes the
-- package's suggested value and name as a starting point.
--
-- It is SECURITY INVOKER: every row it writes goes through the ordinary
-- policies, so the authority question is answered by the same predicate as
-- every other partnership write rather than by a second copy of it.
--
-- IDEMPOTENCY. The whole operation is refused unless `package_id IS NULL`,
-- and setting `package_id` is part of the same statement-sequence inside one
-- transaction. So a double-clicked button, a retried request and two tabs all
-- end the same way: the first call wins and the rest raise. There is no
-- partial state to clean up, because a failure rolls the whole call back.
--
-- Cross-event application cannot even be attempted: both the package and the
-- partnership are looked up by (id, event_id) against the SAME event_id, and
-- the composite foreign key would reject the link regardless.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_partnership_package(
  target_partnership_id uuid,
  target_package_id uuid,
  copy_value boolean DEFAULT true,
  copy_name_to_tier boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid;
  v_existing_package uuid;
  v_pkg record;
  v_offset int;
  v_copied int;
BEGIN
  SELECT p.event_id, p.package_id
    INTO v_event, v_existing_package
  FROM event_partnerships p
  WHERE p.id = target_partnership_id
  FOR UPDATE;

  -- No row means RLS hid it, which means no authority over it.
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'That partnership is not available to change';
  END IF;

  IF v_existing_package IS NOT NULL THEN
    RAISE EXCEPTION 'This partnership already has a package applied';
  END IF;

  -- Same event, asked for explicitly as well as enforced by the key.
  SELECT k.* INTO v_pkg
  FROM event_partnership_packages k
  WHERE k.id = target_package_id AND k.event_id = v_event;

  IF v_pkg.id IS NULL THEN
    RAISE EXCEPTION 'That package does not belong to this event';
  END IF;

  IF v_pkg.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'That package is archived. Restore it before using it.';
  END IF;

  -- Copied deliverables go after anything the partnership already has, so
  -- applying a package to a partnership with custom obligations adds to it
  -- rather than reshuffling it.
  SELECT COALESCE(max(ob.display_order) + 1, 0) INTO v_offset
  FROM event_partnership_obligations ob
  WHERE ob.partnership_id = target_partnership_id
    AND ob.direction = 'organizer_to_partner';

  INSERT INTO event_partnership_obligations
    (partnership_id, event_id, direction, title, description, category, quantity,
     due_date, display_order)
  SELECT
    target_partnership_id, v_event, 'organizer_to_partner',
    pd.title, pd.description, pd.category, pd.quantity, pd.due_date,
    v_offset + (row_number() OVER (ORDER BY pd.display_order, pd.created_at))::int - 1
  FROM event_partnership_package_deliverables pd
  WHERE pd.package_id = target_package_id;

  GET DIAGNOSTICS v_copied = ROW_COUNT;

  -- The provenance, and the two prefills. Neither prefill overwrites
  -- something the organizer has already decided: a package is a starting
  -- point, and a value or a tier already on the partnership is a negotiation.
  UPDATE event_partnerships
     SET package_id = target_package_id,
         tier_label = CASE
           WHEN copy_name_to_tier AND COALESCE(btrim(tier_label), '') = ''
             THEN v_pkg.name
           ELSE tier_label
         END,
         value_amount = CASE
           WHEN copy_value AND value_amount IS NULL THEN v_pkg.value_amount
           ELSE value_amount
         END,
         value_currency = CASE
           WHEN copy_value AND value_amount IS NULL THEN v_pkg.value_currency
           ELSE value_currency
         END
   WHERE id = target_partnership_id;

  RETURN v_copied;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_partnership_packages(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reorder_event_partnership_packages(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reorder_package_deliverables(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_partnership_package(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_partnership_packages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_event_partnership_packages(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_package_deliverables(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_partnership_package(uuid, uuid, boolean, boolean) TO authenticated;

/*
## Deferred, deliberately

- **Changing a package after creation.** `apply_partnership_package` refuses
  when one is already set, and there is no "swap package" operation. Swapping
  would have to decide what happens to obligations the organizer has since
  edited, completed or attached evidence to, and every automatic answer to
  that is wrong for somebody. Revisit with a UI that shows exactly what it is
  about to change.
- **Requirement templates.** Packages describe what the organizer provides.
  What a partner must supply is still partnership-specific.
- **An organization-wide package library**, and copying packages between
  events. Packages are event-scoped, which is the smaller claim; widening
  later is additive.
- **Documents and AI extraction.** No columns here anticipate them.
*/
