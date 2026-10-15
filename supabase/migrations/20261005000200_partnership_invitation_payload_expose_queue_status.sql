-- ===========================================================================
-- Recovered 2026-10-15. Applied to production on 2026-10-02 as version
-- 20261002133909 but never committed. The SQL below is the executed statement,
-- recovered verbatim from supabase_migrations.schema_migrations.
--
-- Placed at 20261005000200, immediately after the view it replaces. See
-- supabase/migrations/README.md for the full version mapping.
-- ===========================================================================

-- The view omitted the queue row's own status, so the drainer had nothing to
-- filter on and would have re-sent an already-sent row on every run until it
-- hit the attempts ceiling. The organization pass filters status=eq.queued;
-- this exposes the same column so the partnership pass can do likewise.
--
-- Appended last rather than placed next to the other status: CREATE OR REPLACE
-- VIEW can only add columns at the end.
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
  )                     AS role_label,
  q.status              AS queue_status
FROM partnership_invitation_emails q
JOIN event_partnership_invitations i ON i.id = q.invitation_id
JOIN event_partnerships p ON p.id = i.partnership_id
JOIN events e ON e.id = p.event_id
LEFT JOIN organizations o ON o.id = e.organization_id;

REVOKE ALL ON public.partnership_invitation_email_payload FROM anon, authenticated;
GRANT SELECT ON public.partnership_invitation_email_payload TO service_role;
