-- ===========================================================================
-- Recovered 2026-10-15. Applied to production on 2026-10-02 as version
-- 20261002131805 but never committed, so no fresh environment could build the
-- partnership invitation email path. The SQL below is the executed statement,
-- recovered verbatim from supabase_migrations.schema_migrations.
--
-- Placed at 20261005000100 rather than its production version because this
-- repository renumbered the partnership phases: phase 3A, which creates
-- partnership_invitation_emails and event_partnership_invitations, is
-- 20261005000000 here and 20261002131727 in production. At the production
-- version this view would be created before the tables it selects from.
-- See supabase/migrations/README.md for the full version mapping.
-- ===========================================================================

-- Everything the invitation email needs, flattened into one row.
--
-- The Edge Function could in principle embed four levels through PostgREST,
-- but event_partnership_invitations references its parent through a COMPOSITE
-- foreign key, and relying on that being auto-detected for embedding is a
-- gamble the delivery path does not need to take. A view is deterministic.
--
-- SECURITY INVOKER is deliberately NOT set, so the view runs as its owner and
-- service_role can read it. There is no grant to anon or authenticated, so
-- nothing else can: this exposes recipient addresses and is for the drainer
-- only.
CREATE OR REPLACE VIEW public.partnership_invitation_email_payload AS
SELECT
  q.id                  AS queue_id,
  q.invitation_id,
  q.recipient_email,
  q.attempts,
  i.status              AS invitation_status,
  i.expires_at,
  p.company_name,
  p.tier_label,
  e.name                AS event_name,
  COALESCE(o.name, 'a Rally organizer') AS organizer_name,
  COALESCE(
    (SELECT string_agg(initcap(replace(r.role, '_', ' ')), ' + ' ORDER BY r.role)
     FROM event_partnership_roles r WHERE r.partnership_id = p.id),
    'Partner'
  )                     AS role_label
FROM partnership_invitation_emails q
JOIN event_partnership_invitations i ON i.id = q.invitation_id
JOIN event_partnerships p ON p.id = i.partnership_id
JOIN events e ON e.id = p.event_id
LEFT JOIN organizations o ON o.id = e.organization_id;

REVOKE ALL ON public.partnership_invitation_email_payload FROM anon, authenticated;
GRANT SELECT ON public.partnership_invitation_email_payload TO service_role;
