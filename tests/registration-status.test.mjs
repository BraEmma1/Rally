// Unit tests for the shared registration-status rule (src/lib/registrationStatus.ts).
// Confirmed = registered or checked_in; waitlisted and cancelled hold no seat and
// never check in; arrival is read from checked_in_at. The database statuses are
// registered, waitlisted, cancelled, checked_in — there is no "rejected".
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canCheckIn,
  hasCheckedIn,
  isConfirmedRegistration,
  summarizeRegistrations,
} from '../src/lib/registrationStatus.ts'

const AT = '2030-01-01T09:00:00Z'
const registered = { status: 'registered', checked_in_at: null }
const arrived = { status: 'checked_in', checked_in_at: AT }
// Undo clears the timestamp and leaves the status as it was.
const undone = { status: 'checked_in', checked_in_at: null }
const waitlisted = { status: 'waitlisted', checked_in_at: null }
const cancelled = { status: 'cancelled', checked_in_at: null }

test('confirmed means registered or checked in, nothing else', () => {
  assert.equal(isConfirmedRegistration('registered'), true)
  assert.equal(isConfirmedRegistration('checked_in'), true)
  assert.equal(isConfirmedRegistration('waitlisted'), false)
  assert.equal(isConfirmedRegistration('cancelled'), false)
  assert.equal(isConfirmedRegistration('rejected'), false)
  assert.equal(isConfirmedRegistration(''), false)
})

test('only a confirmed registration that has not arrived may check in', () => {
  assert.equal(canCheckIn(registered), true)
  assert.equal(canCheckIn(undone), true)
  assert.equal(canCheckIn(arrived), false)
  assert.equal(canCheckIn(waitlisted), false)
  assert.equal(canCheckIn(cancelled), false)
})

test('arrival comes from checked_in_at, not status', () => {
  assert.equal(hasCheckedIn(arrived), true)
  assert.equal(hasCheckedIn(undone), false)
  assert.equal(hasCheckedIn(registered), false)
})

test('summary counts confirmed separately from waitlisted and cancelled', () => {
  const s = summarizeRegistrations([registered, arrived, undone, waitlisted, waitlisted, cancelled])
  assert.deepEqual(s, { confirmed: 3, checkedIn: 1, notCheckedIn: 2, waitlisted: 2, cancelled: 1 })
})

test('a waitlist-only or cancelled-only event has no confirmed registrations', () => {
  assert.deepEqual(summarizeRegistrations([waitlisted, cancelled]), {
    confirmed: 0,
    checkedIn: 0,
    notCheckedIn: 0,
    waitlisted: 1,
    cancelled: 1,
  })
  assert.deepEqual(summarizeRegistrations([]), {
    confirmed: 0,
    checkedIn: 0,
    notCheckedIn: 0,
    waitlisted: 0,
    cancelled: 0,
  })
})
