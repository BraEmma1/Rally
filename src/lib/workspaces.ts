// Workspaces: which places a signed-in person can switch between, and what a
// switch does to the URL and to the page on screen.
//
// Nothing here grants anything. The list comes from get_my_organization_access,
// which returns the caller's OWN memberships and nothing for a suspended account,
// and every read and write inside a workspace is authorized again by the database
// (RLS, can_manage_event, require_org_authority). These rules only decide what the
// interface offers and how it moves between places.
//
// Pure (type imports only) so it can be unit-tested in Node.
import type { OrganizationMembership, OrgRole, UserAccount } from './supabase'
import { isActiveAttendee } from './routing.ts'

export type OrganizationWorkspace = {
  kind: 'organization'
  id: string
  name: string
  logoUrl: string | null
  role: OrgRole
  roleLabel: string
  archived: boolean
}

export type PersonalWorkspace = {
  kind: 'personal'
  path: string
}

export type WorkspaceEntry = PersonalWorkspace | OrganizationWorkspace

export function roleLabel(role: OrgRole): string {
  switch (role) {
    case 'owner':
      return 'Owner'
    case 'admin':
      return 'Admin'
    case 'manager':
      return 'Event manager'
  }
}

// One entry per organization, in the order the server returned them (by name).
// Duplicates are dropped defensively: an earlier version of the membership query
// returned one row per co-member, and the switcher must never show an
// organization twice whatever the server does.
export function organizationWorkspaces(memberships: OrganizationMembership[]): OrganizationWorkspace[] {
  const seen = new Set<string>()
  const out: OrganizationWorkspace[] = []
  for (const m of memberships) {
    if (seen.has(m.organization.id)) continue
    seen.add(m.organization.id)
    out.push({
      kind: 'organization',
      id: m.organization.id,
      name: m.organization.name,
      logoUrl: m.organization.logo_url ? m.organization.logo_url : null,
      role: m.role,
      roleLabel: roleLabel(m.role),
      archived: m.organization.archived_at !== null,
    })
  }
  return out
}

// The personal workspace (attending, networking, messaging). Today it exists only
// for active attendee accounts: /dashboard is guarded by isActiveAttendee, and an
// organizer account has no personal home to open (CLAUDE.md §3, account types are
// mutually exclusive). This uses the SAME predicate as that route guard, so the
// switcher can never offer a place the guard would bounce.
//
// Identity PR-9a/9b give every active, non-admin account a personal space. When
// they land, this is the one function to widen; the switcher already renders the
// entry whenever it is returned.
export function personalWorkspace(account: UserAccount | null): PersonalWorkspace | null {
  if (isActiveAttendee(account)) return { kind: 'personal', path: '/dashboard' }
  return null
}

export function workspaceEntries(
  memberships: OrganizationMembership[],
  account: UserAccount | null
): WorkspaceEntry[] {
  const personal = personalWorkspace(account)
  const organizations = organizationWorkspaces(memberships)
  return personal ? [personal, ...organizations] : organizations
}

export function isMemberOf(memberships: OrganizationMembership[], organizationId: string | null | undefined): boolean {
  if (!organizationId) return false
  return memberships.some((m) => m.organization.id === organizationId)
}

// A remembered or requested id is only a hint. It may name an organization the
// person has since left or been removed from: fall back to the first real
// membership rather than an empty shell, and to nothing when there is none.
export function resolveActiveMembership(
  memberships: OrganizationMembership[],
  requestedId: string | null
): OrganizationMembership | null {
  return memberships.find((m) => m.organization.id === requestedId) ?? memberships[0] ?? null
}

// After a SUCCESSFUL reload: was the organization on screen taken away? Returns
// what to tell the person, or null. A failed reload never reaches this; it is not
// evidence that anything changed.
export function lostOrganization(
  previous: OrganizationMembership[],
  previousActiveId: string | null,
  next: OrganizationMembership[]
): { id: string; name: string } | null {
  if (!previousActiveId) return null
  if (isMemberOf(next, previousActiveId)) return null
  const before = previous.find((m) => m.organization.id === previousActiveId)
  if (!before) return null
  return { id: previousActiveId, name: before.organization.name }
}

// A re-check usually answers exactly what we already had. Hand back the SAME
// objects for every membership that did not change (and the same array when
// nothing changed), so a quiet re-check re-renders nothing and resets nothing:
// pages that depend on the organization object (Settings fills its form from it)
// would otherwise reload or lose unsaved edits on every return to the tab.
export function reuseUnchanged(
  previous: OrganizationMembership[],
  next: OrganizationMembership[]
): OrganizationMembership[] {
  const before = new Map(previous.map((m) => [m.organization.id, m]))
  const merged = next.map((m) => {
    const old = before.get(m.organization.id)
    return old && JSON.stringify(old) === JSON.stringify(m) ? old : m
  })
  const same = merged.length === previous.length && merged.every((m, i) => m === previous[i])
  return same ? previous : merged
}

function normalize(pathname: string): string {
  const p = pathname.split(/[?#]/)[0]
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

// Organization-level sections. Switching keeps you in the same section of the
// new organization: the Events list of one becomes the Events list of the other.
const SECTIONS = new Set([
  '/organizer',
  '/organizer/events',
  '/organizer/people',
  '/organizer/team',
  '/organizer/settings',
  '/organizer/invitations',
])

// Where a switch lands. A page about one EVENT (detail, edit, a partnership) or a
// half-filled "new event" form belongs to the organization being left, so those
// go to the new organization's Events list. Anything else opens its dashboard.
export function pathAfterSwitch(pathname: string): string {
  const p = normalize(pathname)
  if (SECTIONS.has(p)) return p
  if (p.startsWith('/organizer/events/')) return '/organizer/events'
  return '/organizer'
}

// The routes inside the organizer area that are about one event. They authorize
// against the event (can_manage_event), not against the selected organization.
const EVENT_ROUTE = /^\/organizer\/events\/(?!new$)([^/]+)(?:\/(edit|partners\/([^/]+)))?$/

export function eventIdFromPath(pathname: string): string | null {
  const m = EVENT_ROUTE.exec(normalize(pathname))
  return m ? m[1] : null
}

// The key the organizer area mounts its page under.
//
// Organization pages are keyed by the organization, so a switch UNMOUNTS the page
// that showed the previous organization: its members, invitations, events and
// counts go with it, and a slow response it was still waiting for can no longer
// land on the new organization's screen (React drops state updates from an
// unmounted component). The new page starts empty and loads for the new id.
//
// Event pages are keyed by the event, because the event decides their access and
// their organization. Following the event's organization in the header must not
// throw away the page that is showing it.
//
// "My invitations" is about the person, not an organization, and accepting one
// switches organization; it must survive that.
export function workspaceScopeKey(pathname: string, activeOrganizationId: string | null): string {
  const p = normalize(pathname)
  const eventId = eventIdFromPath(p)
  if (eventId) return 'event:' + p
  if (p === '/organizer/invitations') return 'person'
  return 'organization:' + (activeOrganizationId ?? 'none')
}

// Where the choice is remembered. Per person, so one browser shared by two
// people never carries one person's organization into the other's session.
export const LEGACY_ACTIVE_ORG_KEY = 'rally.organizer.active_org'
export function activeOrganizationStorageKey(userId: string): string {
  return LEGACY_ACTIVE_ORG_KEY + ':' + userId
}
