/*
# REVERT of migration 20261129000000_organization_partners.sql

Removes everything that migration created: the organization partner list, the
`event_partnerships.partner_id` link, their rules, the partner-to-partnership
sync, the restore catch-up, the manager-visibility helper, the merge preview and
the backfill.

**This discards data.** Every partner in `organization_partners` is deleted,
and every partnership loses its link to a partner. Run it only with the
repository owner's explicit approval, and only to undo that migration.

## What stays
Each event partnership keeps the company details (name, description, logo,
industry, website, LinkedIn) it held when this runs, which is what the partner
list last synced to it. A partnership on an event that was archived when its
partner was last edited keeps the older details it had then. Those details are
editable again per partnership, as they were before the migration.

## How to run
- As `postgres` (the Supabase SQL editor's role), in one transaction.
- This directory is not a migration directory: the Supabase CLI never applies
  it, and running it records nothing in migration history.
- It does **not** remove the migration's row from
  `supabase_migrations.schema_migrations`. Editing migration history needs
  separate approval (CLAUDE.md rule 1). Re-applying the migration later is
  safe: it recreates the list empty; linking needs the backfill to be run
  again, as its own approved step.

Tested by `tests/sql/organization-partners.test.mjs`: after the migration and
this script, the catalog (functions, triggers, constraints, policies, grants)
is identical to a replay that stops before the migration, and the migration
then re-applies to the same catalog.
*/

BEGIN;

-- Triggers first, then the functions they call.
DROP TRIGGER IF EXISTS resync_partner_details_on_restore ON public.events;
DROP TRIGGER IF EXISTS check_partnership_partner_link ON public.event_partnerships;
DROP TRIGGER IF EXISTS sync_partner_details ON public.organization_partners;
DROP TRIGGER IF EXISTS check_organization_partner_delete_rules ON public.organization_partners;
DROP TRIGGER IF EXISTS check_organization_partner_rules ON public.organization_partners;

DROP FUNCTION IF EXISTS public.resync_partner_details_on_event_restore();
DROP FUNCTION IF EXISTS public.sync_partner_details_to_partnerships();
DROP FUNCTION IF EXISTS public.enforce_partnership_partner_link();
DROP FUNCTION IF EXISTS public.enforce_organization_partner_delete_rules();
DROP FUNCTION IF EXISTS public.enforce_organization_partner_rules();

-- The backfill calls the preview, so it goes first.
DROP FUNCTION IF EXISTS public.backfill_organization_partners();
DROP FUNCTION IF EXISTS public.preview_organization_partner_merge();

-- The link: its index, then the column (which takes its foreign key with it).
DROP INDEX IF EXISTS public.idx_event_partnerships_partner;
ALTER TABLE public.event_partnerships DROP COLUMN IF EXISTS partner_id;

-- The list: its policies, then the table (which takes its indexes, constraints
-- and grants with it). The helper goes last, after the policies that call it.
DROP POLICY IF EXISTS "read_organization_partners" ON public.organization_partners;
DROP POLICY IF EXISTS "create_organization_partners" ON public.organization_partners;
DROP POLICY IF EXISTS "update_organization_partners" ON public.organization_partners;
DROP POLICY IF EXISTS "delete_organization_partners" ON public.organization_partners;
DROP TABLE IF EXISTS public.organization_partners;

DROP FUNCTION IF EXISTS public.is_org_event_manager(uuid);

COMMIT;
