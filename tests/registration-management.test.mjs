// Unit tests for the organizer registration dialog's wording and rules
// (src/lib/registrationManagement.ts). The database decides; these check that the
// screen says why an action is missing and never words one wrongly.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelConfirmCopy,
  cancelResultMessage,
  cancelUnavailableReason,
  detailStatusLabel,
  promoteUnavailableReason,
  seatsLine,
} from '../src/lib/registrationManagement.ts'

const base = {
  registration_id: 'r1',
  user_id: 'u1',
  full_name: 'Ada',
  status: 'registered',
  registered_at: '2026-11-01T09:00:00Z',
  checked_in_at: null,
  cancelled_at: null,
  cancelled_by_organizer: false,
  waitlist_position: null,
  waitlist_length: 0,
  capacity: 10,
  seats_taken: 5,
  event_open: true,
  can_cancel: true,
  can_promote: false,
  answers: [],
}

test('status labels follow the shared rules, with waitlist position', () => {
  assert.equal(detailStatusLabel(base), 'Confirmed')
  assert.equal(detailStatusLabel({ ...base, status: 'checked_in', checked_in_at: '2026-11-02T08:00:00Z' }), 'Confirmed · checked in')
  assert.equal(detailStatusLabel({ ...base, status: 'checked_in', checked_in_at: null }), 'Confirmed') // undone check-in
  assert.equal(detailStatusLabel({ ...base, status: 'waitlisted', waitlist_position: 3 }), 'Waitlisted · #3')
  assert.equal(detailStatusLabel({ ...base, status: 'cancelled' }), 'Cancelled')
})

test('seats line with and without a capacity', () => {
  assert.equal(seatsLine({ capacity: 10, seats_taken: 10, waitlist_length: 2 }), '10 of 10 places taken · 2 waiting')
  assert.equal(seatsLine({ capacity: null, seats_taken: 4, waitlist_length: 0 }), '4 confirmed (no capacity limit)')
})

test('a missing Cancel button is always explained', () => {
  assert.equal(cancelUnavailableReason(base), null)
  assert.match(cancelUnavailableReason({ ...base, can_cancel: false, checked_in_at: '2026-11-02T08:00:00Z', status: 'checked_in' }), /Undo the check-in/)
  assert.match(cancelUnavailableReason({ ...base, can_cancel: false, event_open: false }), /finished or archived/)
  assert.equal(cancelUnavailableReason({ ...base, can_cancel: false, status: 'cancelled' }), null)
})

test('a missing Promote button is explained only for waitlisted people', () => {
  const w = { ...base, status: 'waitlisted', waitlist_position: 1, waitlist_length: 2 }
  assert.equal(promoteUnavailableReason(base), null)
  assert.equal(promoteUnavailableReason({ ...w, can_promote: true }), null)
  assert.match(promoteUnavailableReason({ ...w, seats_taken: 10 }), /full.*automatically/)
  assert.match(promoteUnavailableReason({ ...w, waitlist_position: 2 }), /in order/)
  assert.match(promoteUnavailableReason({ ...w, event_open: false }), /finished or archived/)
})

test('confirmation says what happens, for a place and for a waitlist spot', () => {
  const c = cancelConfirmCopy(base)
  assert.equal(c.action, 'Cancel registration')
  assert.match(c.body, /notified/)
  assert.match(c.body, /record is kept/)
  assert.equal(cancelConfirmCopy({ ...base, status: 'waitlisted' }).action, 'Remove from waitlist')
})

test('result messages report automatic promotion', () => {
  assert.equal(cancelResultMessage('Ada', 'registered', 0), "Ada's registration was cancelled.")
  assert.equal(cancelResultMessage('Ada', 'registered', 1), "Ada's registration was cancelled. The next person on the waitlist got the place.")
  assert.equal(cancelResultMessage('Ada', 'waitlisted', 0), 'Ada was removed from the waitlist.')
})
