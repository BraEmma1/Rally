// Unit tests for the workspace switcher's rules (src/lib/workspaces.ts).
// The database decides who belongs to which organization and what they may do in
// it; these check that the interface lists exactly the memberships it was given,
// moves between them predictably, and never keeps one organization's page on
// screen under another's name.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activeOrganizationStorageKey,
  eventIdFromPath,
  isMemberOf,
  lostOrganization,
  organizationWorkspaces,
  pathAfterSwitch,
  personalWorkspace,
  resolveActiveMembership,
  roleLabel,
  workspaceEntries,
  workspaceScopeKey,
} from '../src/lib/workspaces.ts'

const org = (id, name, over = {}) => ({
  id,
  name,
  slug: id,
  description: '',
  logo_url: '',
  website: '',
  org_type: 'organizer',
  approval_status: 'approved',
  archived_at: null,
  created_by: 'u',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...over,
})
const member = (role, o) => ({ role, organization: o })

const A = org('org-a', 'Accra Events')
const B = org('org-b', 'Kente Foods', { logo_url: 'https://cdn.example.test/kente.png', archived_at: '2026-10-01T00:00:00Z' })
const C = org('org-c', 'TechGhana Summit')
const mine = [member('owner', A), member('manager', B)]

const account = (account_type, status = 'active') => ({ account_type, status })

test('lists exactly the memberships it is given, once each, with the caller\'s own role', () => {
  const list = organizationWorkspaces(mine)
  assert.deepEqual(list.map((w) => [w.id, w.role, w.roleLabel]), [
    ['org-a', 'owner', 'Owner'],
    ['org-b', 'manager', 'Event manager'],
  ])
  assert.equal(list.some((w) => w.id === 'org-c'), false, 'an organization the person is not in never appears')
  // The old membership query returned one row per co-member; never show one twice.
  const duplicated = organizationWorkspaces([member('owner', A), member('admin', A), member('manager', B)])
  assert.deepEqual(duplicated.map((w) => w.id), ['org-a', 'org-b'])
  assert.equal(duplicated[0].role, 'owner', 'the first row for an organization wins')
  assert.deepEqual(organizationWorkspaces([]), [])
})

test('logo and archived state come from the membership row', () => {
  const [a, b] = organizationWorkspaces(mine)
  assert.equal(a.logoUrl, null, 'an empty logo is no logo')
  assert.equal(b.logoUrl, 'https://cdn.example.test/kente.png')
  assert.equal(a.archived, false)
  assert.equal(b.archived, true)
})

test('role labels', () => {
  assert.equal(roleLabel('owner'), 'Owner')
  assert.equal(roleLabel('admin'), 'Admin')
  assert.equal(roleLabel('manager'), 'Event manager')
})

test('Personal is offered exactly where the /dashboard route guard admits the account', () => {
  assert.deepEqual(personalWorkspace(account('attendee')), { kind: 'personal', path: '/dashboard' })
  for (const a of [
    account('organizer'),
    account('platform_admin'),
    account('sponsor'),
    account('vendor'),
    account('attendee', 'suspended'),
    account('attendee', 'pending_approval'),
    null,
  ]) {
    assert.equal(personalWorkspace(a), null, JSON.stringify(a))
  }
  const entries = workspaceEntries(mine, account('attendee'))
  assert.deepEqual(entries.map((e) => (e.kind === 'personal' ? 'personal' : e.id)), ['personal', 'org-a', 'org-b'])
  assert.deepEqual(workspaceEntries(mine, account('organizer')).map((e) => e.id), ['org-a', 'org-b'])
})

test('a remembered or requested organization is only used if the person belongs to it', () => {
  assert.equal(resolveActiveMembership(mine, 'org-b').organization.id, 'org-b')
  assert.equal(resolveActiveMembership(mine, 'org-c').organization.id, 'org-a', 'not a member: first real membership')
  assert.equal(resolveActiveMembership(mine, null).organization.id, 'org-a')
  assert.equal(resolveActiveMembership([], 'org-a'), null, 'no membership, nothing selected')
  assert.equal(isMemberOf(mine, 'org-b'), true)
  assert.equal(isMemberOf(mine, 'org-c'), false)
  assert.equal(isMemberOf(mine, null), false)
})

test('losing the organization on screen is reported; losing another one is not', () => {
  assert.deepEqual(lostOrganization(mine, 'org-b', [member('owner', A)]), { id: 'org-b', name: 'Kente Foods' })
  assert.equal(lostOrganization(mine, 'org-a', [member('owner', A)]), null, 'org-b went, but org-a was on screen')
  assert.deepEqual(lostOrganization(mine, 'org-a', []), { id: 'org-a', name: 'Accra Events' }, 'every membership went')
  assert.equal(lostOrganization(mine, 'org-a', mine), null)
  assert.equal(lostOrganization(mine, null, []), null, 'nothing was on screen')
  assert.equal(lostOrganization([], 'org-a', []), null, 'never had it: nothing to report')
})

test('a switch keeps the section, and leaves pages that belong to one event', () => {
  const cases = [
    ['/organizer', '/organizer'],
    ['/organizer/', '/organizer'],
    ['/organizer/events', '/organizer/events'],
    ['/organizer/events?scope=past', '/organizer/events'],
    ['/organizer/people', '/organizer/people'],
    ['/organizer/team', '/organizer/team'],
    ['/organizer/settings', '/organizer/settings'],
    ['/organizer/invitations', '/organizer/invitations'],
    ['/organizer/events/new', '/organizer/events'],
    ['/organizer/events/e-1', '/organizer/events'],
    ['/organizer/events/e-1/edit', '/organizer/events'],
    ['/organizer/events/e-1/partners/p-1', '/organizer/events'],
    ['/organizer/setup', '/organizer'],
    ['/dashboard', '/organizer'],
    ['/events/e-1/home', '/organizer'],
  ]
  for (const [from, to] of cases) assert.equal(pathAfterSwitch(from), to, from)
})

test('event pages are recognised by their path, and "new" is not an event', () => {
  assert.equal(eventIdFromPath('/organizer/events/e-1'), 'e-1')
  assert.equal(eventIdFromPath('/organizer/events/e-1/edit'), 'e-1')
  assert.equal(eventIdFromPath('/organizer/events/e-1/partners/p-9'), 'e-1')
  assert.equal(eventIdFromPath('/organizer/events/new'), null)
  assert.equal(eventIdFromPath('/organizer/events'), null)
  assert.equal(eventIdFromPath('/organizer/events/e-1/other'), null)
  assert.equal(eventIdFromPath('/events/e-1'), null, 'attendee event pages are not organizer event pages')
})

test('organization pages remount on every switch; event pages and My invitations do not', () => {
  for (const path of ['/organizer', '/organizer/events', '/organizer/people', '/organizer/team', '/organizer/settings', '/organizer/events/new']) {
    assert.notEqual(workspaceScopeKey(path, 'org-a'), workspaceScopeKey(path, 'org-b'), path)
    assert.equal(workspaceScopeKey(path, 'org-a'), workspaceScopeKey(path, 'org-a'), path + ' (same organization)')
  }
  // Following an event's organization must not throw the event page away.
  for (const path of ['/organizer/events/e-1', '/organizer/events/e-1/edit', '/organizer/events/e-1/partners/p-1']) {
    assert.equal(workspaceScopeKey(path, 'org-a'), workspaceScopeKey(path, 'org-b'), path)
  }
  assert.notEqual(workspaceScopeKey('/organizer/events/e-1', 'org-a'), workspaceScopeKey('/organizer/events/e-2', 'org-a'))
  // Accepting an invitation switches organization; the page must survive it.
  assert.equal(workspaceScopeKey('/organizer/invitations', 'org-a'), workspaceScopeKey('/organizer/invitations', 'org-b'))
  assert.equal(workspaceScopeKey('/organizer', null), 'organization:none')
})

test('the remembered choice is stored per person', () => {
  assert.notEqual(activeOrganizationStorageKey('user-1'), activeOrganizationStorageKey('user-2'))
  assert.equal(activeOrganizationStorageKey('user-1'), 'rally.organizer.active_org:user-1')
})
