// Unit tests for what the organizer event screens offer (src/lib/eventAccess.ts).
// The database is the authority: every organizer write on an event is guarded by
// can_manage_event(event) AND account_is_active(). These check that the screens
// read those two answers the same way, and fail closed.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canCreateEvents,
  canManage,
  eventCapabilities,
  eventListScope,
  resolveEventAccess,
} from '../src/lib/eventAccess.ts'

const yes = { data: true, error: null }
const no = { data: false, error: null }
const failed = { data: null, error: { message: 'network' } }

// can_manage_event is true for an owner, an admin, and a manager assigned to the
// event; false for a manager who is not. account_is_active is false when suspended.
const ownerOrAdmin = resolveEventAccess(yes, yes)
const assignedManager = resolveEventAccess(yes, yes)
const unassignedManager = resolveEventAccess(no, yes)
const suspended = resolveEventAccess(yes, no)
const checkFailed = resolveEventAccess(failed, yes)

const live = { archived_at: null, visibility: 'published' }
const draft = { archived_at: null, visibility: 'draft' }
const archived = { archived_at: '2026-11-01T00:00:00Z', visibility: 'published' }

const NOTHING = { manage: false, editDetails: false, changeLifecycle: false, archive: false, restore: false, inviteAttendees: false }

test('owner and admin manage a live event fully, including archiving', () => {
  for (const role of ['owner', 'admin']) {
    assert.equal(ownerOrAdmin.state, 'manage')
    assert.deepEqual(eventCapabilities(ownerOrAdmin, live, role), {
      manage: true, editDetails: true, changeLifecycle: true, archive: true, restore: false, inviteAttendees: true,
    })
  }
})

test('an assigned manager runs the event but cannot archive it', () => {
  assert.equal(assignedManager.state, 'manage')
  assert.deepEqual(eventCapabilities(assignedManager, live, 'manager'), {
    manage: true, editDetails: true, changeLifecycle: true, archive: false, restore: false, inviteAttendees: true,
  })
})

test('archive authority needs a known owner/admin role in the event organization', () => {
  // No membership found for the event's organization: no organization authority.
  assert.equal(eventCapabilities(ownerOrAdmin, live, null).archive, false)
  assert.equal(eventCapabilities(ownerOrAdmin, live, undefined).archive, false)
  assert.equal(eventCapabilities(ownerOrAdmin, archived, null).restore, false)
})

test('an unassigned manager is denied and offered nothing', () => {
  assert.deepEqual(unassignedManager, { state: 'denied' })
  assert.equal(canManage(unassignedManager), false)
  assert.deepEqual(eventCapabilities(unassignedManager, live, 'manager'), NOTHING)
})

test('a suspended account is denied even as an owner or assigned manager', () => {
  assert.deepEqual(suspended, { state: 'denied' })
  assert.deepEqual(eventCapabilities(suspended, live, 'manager'), NOTHING)
  // The role alone never grants archive: the database said no.
  assert.deepEqual(eventCapabilities(suspended, live, 'owner'), NOTHING)
  assert.deepEqual(eventCapabilities(suspended, archived, 'owner'), NOTHING)
})

test('a failed check is an error, never access', () => {
  assert.equal(checkFailed.state, 'error')
  assert.equal(resolveEventAccess(yes, failed).state, 'error')
  assert.equal(canManage(checkFailed), false)
  assert.deepEqual(eventCapabilities(checkFailed, live, 'owner'), NOTHING)
})

test('a check still in flight offers nothing', () => {
  assert.deepEqual(eventCapabilities({ state: 'checking' }, live, 'owner'), NOTHING)
})

test('only a literal true counts as yes', () => {
  for (const data of [null, undefined, 'true', 1, [true], { can_manage_event: true }]) {
    assert.equal(resolveEventAccess({ data, error: null }, yes).state, 'denied', JSON.stringify(data))
    assert.equal(resolveEventAccess(yes, { data, error: null }).state, 'denied', JSON.stringify(data))
  }
})

test('an archived event is frozen: owner/admin may only restore it', () => {
  for (const role of ['owner', 'admin']) {
    assert.deepEqual(eventCapabilities(ownerOrAdmin, archived, role), {
      manage: true, editDetails: false, changeLifecycle: false, archive: false, restore: true, inviteAttendees: false,
    })
  }
})

test('an archived event offers its assigned manager nothing to change', () => {
  assert.deepEqual(eventCapabilities(assignedManager, archived, 'manager'), {
    manage: true, editDetails: false, changeLifecycle: false, archive: false, restore: false, inviteAttendees: false,
  })
  assert.equal(eventCapabilities(unassignedManager, archived, 'manager').restore, false)
})

test('a draft can be edited and published by its manager but not invited to', () => {
  const can = eventCapabilities(assignedManager, draft, 'manager')
  assert.equal(can.editDetails, true)
  assert.equal(can.changeLifecycle, true)
  assert.equal(can.inviteAttendees, false)
})

test('creating events stays an owner/admin act', () => {
  assert.equal(canCreateEvents('owner'), true)
  assert.equal(canCreateEvents('admin'), true)
  assert.equal(canCreateEvents('manager'), false)
  assert.equal(canCreateEvents(null), false)
})

// The events SELECT policy lets any organization member read every event, so the
// list query itself must narrow a manager to their assignments.
test('owners and admins list every organization event; everyone else only their assignments', () => {
  assert.equal(eventListScope('owner'), 'organization')
  assert.equal(eventListScope('admin'), 'organization')
  assert.equal(eventListScope('manager'), 'assigned')
  assert.equal(eventListScope(null), 'assigned')
  assert.equal(eventListScope(undefined), 'assigned')
})
