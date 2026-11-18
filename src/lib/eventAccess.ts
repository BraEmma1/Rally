import type { OrgRole } from './supabase'

// Whether the signed-in person may manage ONE event, and what that lets the
// organizer screens offer.
//
// The database is the authority. Every organizer write on an event and its
// content — the events UPDATE policy, sessions, speakers, exhibitors,
// partnerships and their obligations, evidence and documents, the registration
// form, attendee invitations, check-in — is guarded by the same pair:
//
//     can_manage_event(event_id) AND account_is_active()
//
// can_manage_event is true for an organization owner or admin, and for a member
// assigned to the event through event_team. It is NOT the organization role:
// a manager's reach is exactly their assignments. This module mirrors that pair
// so the screens offer what the database will accept, and nothing else. It is
// never the enforcement itself.
//
// Pure (no Supabase import) so it can be unit-tested in Node.

export type EventAccess =
  // Not answered yet. Treated exactly like "no": nothing restricted is shown
  // while the question is in flight.
  | { state: 'checking' }
  | { state: 'manage' }
  | { state: 'denied' }
  // The question could not be answered. Also treated like "no" — a dropped
  // request must not unlock controls — but reported, so it can be retried.
  | { state: 'error'; message: string }

export type RpcAnswer = { data: unknown; error: { message?: string } | null }

export const EVENT_ACCESS_ERROR = 'We could not confirm your access to this event.'

// Both answers must be a definite `true`. Anything else — false, null, a
// malformed value — is "no"; either call failing is "could not tell".
export function resolveEventAccess(manage: RpcAnswer, active: RpcAnswer): EventAccess {
  if (manage.error || active.error) return { state: 'error', message: EVENT_ACCESS_ERROR }
  return manage.data === true && active.data === true ? { state: 'manage' } : { state: 'denied' }
}

export function canManage(access: EventAccess): boolean {
  return access.state === 'manage'
}

// Two different kinds of authority meet on an event page:
//
// - EVENT authority (can_manage_event): run the event — edit it, publish it,
//   mark it live or finished, run its content. Owners, admins and the managers
//   assigned to it.
// - ORGANIZATION authority (is_org_admin): put the event away or bring it back.
//   Archiving and restoring belong to owners and admins only; an assigned
//   manager cannot (migration 20261029000000, trigger
//   check_event_archive_authority).
//
// The rest mirrors enforce_event_write_rules, which applies the same data rules
// to everyone who passes the policy:
// - an archived event is frozen; the one permitted write is restoring it
// - publishing needs a name and a start date (the trigger checks; the form
//   collects both)
// - attendee invitations need a published, non-archived event
//   (invite_event_attendee)
// - agenda, speakers, exhibitors, partners and the registration form are
//   locked while archived (the panels apply that themselves from `manage`)
export type EventCapabilities = {
  // The event's organizer data may be loaded and its panels shown.
  manage: boolean
  editDetails: boolean
  // Publish, mark live, mark finished, reopen. Event authority.
  changeLifecycle: boolean
  // Organization authority.
  archive: boolean
  restore: boolean
  inviteAttendees: boolean
}

// Owner or admin of the organization that owns the event — what is_org_admin
// answers. The role comes from the caller's own memberships
// (get_my_organization_access), looked up by the EVENT's organization, not by
// whichever organization the sidebar has selected.
export function hasOrganizationAuthority(role: OrgRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function eventCapabilities(
  access: EventAccess,
  event: { archived_at: string | null; visibility: string },
  roleInEventOrganization: OrgRole | null | undefined
): EventCapabilities {
  const manage = canManage(access)
  const archived = event.archived_at !== null
  // Archiving also needs an active account and the event's own policy to pass,
  // both of which `manage` already carries.
  const orgAuthority = manage && hasOrganizationAuthority(roleInEventOrganization)
  return {
    manage,
    editDetails: manage && !archived,
    changeLifecycle: manage && !archived,
    archive: orgAuthority && !archived,
    restore: orgAuthority && archived,
    inviteAttendees: manage && !archived && event.visibility !== 'draft',
  }
}

// Which of an organization's events its organizer screens list for the caller.
//
// The events SELECT policy lets every organization member read every event of
// the organization (and anyone read a published one), so the policy alone does
// not narrow a manager's list. Owners and admins manage every event; a manager
// manages exactly the events assigned to them through event_team, which is what
// can_manage_event answers per event. Lists, counts and search all derive from
// the one query this scope narrows. Any role other than a known owner/admin —
// including one not loaded yet — gets the narrow scope.
export type EventListScope = 'organization' | 'assigned'

export function eventListScope(role: OrgRole | null | undefined): EventListScope {
  return hasOrganizationAuthority(role) ? 'organization' : 'assigned'
}

// Creating an event is an organization-role act, not an event one: the INSERT
// policy requires is_org_admin (owner or admin). A manager runs the events
// assigned to them but cannot create new ones.
export function canCreateEvents(role: OrgRole | null): boolean {
  return hasOrganizationAuthority(role)
}
