-- ===========================================================================
-- Phase 6A, second part -- a suspended account loses the sponsor side too.
--
-- Separate from 20261009000000 because production applied it separately: the
-- live database records these as two migrations, 20261003091251 (the sponsor
-- read model) and 20261003091919 (this one). Keeping that split here means a
-- fresh environment reaches the same end state by the same two steps.
--
-- The defect: is_partnership_sponsor_member() is phase 5B's sponsor predicate,
-- and it asked only about membership -- so a suspended account kept its shared
-- partnership documents, both the rows and the signed URLs, while losing
-- everything else in Rally.
--
-- account_is_active() already gates every write in the product and now gates
-- this read, which is what makes "an inactive account does not get a sponsor
-- workspace" true across the whole sponsor surface rather than only in the
-- phase 6A contracts. Adding the one term here reaches the documents table
-- policy and can_read_partnership_document_object() at the same time, because
-- both go through this function.
--
-- The partnership LIFECYCLE is deliberately not folded in. Suspension is
-- platform-level: the account loses access to everything. Which partnerships a
-- sponsor may see is a per-partnership question, and documents already have
-- their own answer to it -- 'internal' versus 'shared', which the organizer
-- controls directly.
--
-- The signature and every other term are unchanged, so the phase 5B policies
-- keep working exactly as they were probed.
-- ===========================================================================

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
