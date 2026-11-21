// Unit tests for src/lib/registrationWindow.ts: reading get_event_registration_states
// rows, what attendees and organizers are told for each state, the date fallback when
// the state is unknown, the deadline <-> wall-clock conversion, and eventEndsAt, the
// form-side mirror of event_ends_at (migration 20261104000000).
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_TIMEZONE,
  attendeeClosedMessage,
  attendeeDeadlineNote,
  deadlineFromInputs,
  deadlineInputs,
  eventEndsAt,
  formatInstant,
  organizerStatus,
  parseRegistrationWindows,
  registrationView,
  shortClosedLabel,
  usableTimeZone,
  wallClockToUtc,
} from '../src/lib/registrationWindow.ts'

const row = (over = {}) => ({
  event_id: 'e-1',
  registration_state: 'open',
  registration_closed_at: null,
  registration_deadline: null,
  ends_at: '2027-03-02T00:00:00+00:00',
  closes_at: '2027-03-02T00:00:00+00:00',
  timezone_fallback: false,
  ...over,
})
const one = (over) => parseRegistrationWindows([row(over)]).get('e-1')
const published = { visibility: 'published', archived_at: null, timezone: 'Africa/Accra' }

// ---- parsing ------------------------------------------------------------------
test('rows are keyed by event and keep their fields', () => {
  const map = parseRegistrationWindows([row(), row({ event_id: 'e-2', registration_state: 'closed', registration_closed_at: '2027-01-01T10:00:00+00:00' })])
  assert.equal(map.size, 2)
  assert.equal(map.get('e-2').registration_state, 'closed')
  assert.equal(map.get('e-2').registration_closed_at, '2027-01-01T10:00:00+00:00')
  assert.equal(map.get('e-1').timezone_fallback, false)
})

test('an unknown state or malformed row is dropped, never read as open', () => {
  const map = parseRegistrationWindows([row({ registration_state: 'paused' }), null, 'x', { event_id: 3 }, row({ event_id: 'ok' })])
  assert.deepEqual([...map.keys()], ['ok'])
  assert.equal(parseRegistrationWindows(null).size, 0)
  assert.equal(parseRegistrationWindows({ event_id: 'e-1' }).size, 0)
})

test('timezone_fallback is true only when the server says true', () => {
  assert.equal(one({ timezone_fallback: true }).timezone_fallback, true)
  assert.equal(one({ timezone_fallback: 'true' }).timezone_fallback, false)
})

// ---- the page's view ------------------------------------------------------------
test('with no server state, the page keeps its date rule', () => {
  assert.deepEqual(registrationView(undefined, false), { ended: false, open: true, closedReason: null })
  assert.deepEqual(registrationView(undefined, true), { ended: true, open: false, closedReason: null })
})

test('the server state overrides the date rule both ways', () => {
  // Day two of a multi-day event: the start-date rule says past, the server says open.
  assert.deepEqual(registrationView(one({}), true), { ended: false, open: true, closedReason: null })
  // Ended by its end time today, still marked upcoming.
  assert.deepEqual(registrationView(one({ registration_state: 'ended' }), false), { ended: true, open: false, closedReason: null })
})

test('closed and deadline_passed are closed but not over', () => {
  assert.deepEqual(registrationView(one({ registration_state: 'closed' }), false), { ended: false, open: false, closedReason: 'closed' })
  assert.deepEqual(registrationView(one({ registration_state: 'deadline_passed' }), false), { ended: false, open: false, closedReason: 'deadline_passed' })
  assert.deepEqual(registrationView(one({ registration_state: 'unavailable' }), false), { ended: false, open: false, closedReason: null })
})

// ---- attendee wording -----------------------------------------------------------
test('attendees are told why registration is closed', () => {
  assert.equal(attendeeClosedMessage(one({ registration_state: 'closed' }), 'Africa/Accra'), 'Registration for this event is closed.')
  assert.equal(
    attendeeClosedMessage(one({ registration_state: 'deadline_passed', registration_deadline: '2027-02-20T17:00:00+00:00' }), 'Africa/Accra'),
    'Registration closed on Feb 20, 2027, 5:00 PM (Africa/Accra).'
  )
  assert.equal(attendeeClosedMessage(one({ registration_state: 'ended' }), null), 'This event has ended, so registration is closed.')
  assert.equal(attendeeClosedMessage(one({}), 'Africa/Accra'), null)
  assert.equal(attendeeClosedMessage(undefined, 'Africa/Accra'), null)
})

test('a deadline before the end is announced; the end alone is not', () => {
  const withDeadline = one({ registration_deadline: '2027-02-20T17:00:00+00:00', closes_at: '2027-02-20T17:00:00+00:00' })
  assert.equal(attendeeDeadlineNote(withDeadline, 'Africa/Accra'), 'Registration closes Feb 20, 2027, 5:00 PM (Africa/Accra).')
  assert.equal(attendeeDeadlineNote(one({}), 'Africa/Accra'), null)
  // A deadline after the end does not apply: the end closes it first.
  assert.equal(attendeeDeadlineNote(one({ registration_deadline: '2027-04-01T00:00:00+00:00' }), 'Africa/Accra'), null)
  assert.equal(attendeeDeadlineNote(one({ registration_state: 'closed', registration_deadline: '2027-02-20T17:00:00+00:00' }), 'Africa/Accra'), null)
})

test('cards get a short label', () => {
  assert.equal(shortClosedLabel(one({ registration_state: 'closed' })), 'Registration closed')
  assert.equal(shortClosedLabel(one({ registration_state: 'deadline_passed' })), 'Registration closed')
  assert.equal(shortClosedLabel(one({ registration_state: 'ended' })), 'Event ended')
  assert.equal(shortClosedLabel(one({})), null)
  assert.equal(shortClosedLabel(undefined), null)
})

// ---- organizer wording ----------------------------------------------------------
test('organizer status: open until the end or the deadline, whichever comes first', () => {
  const s = organizerStatus(one({ closes_at: '2027-03-01T18:00:00+00:00', ends_at: '2027-03-01T18:00:00+00:00' }), published, 'u-1')
  assert.equal(s.label, 'Open')
  assert.equal(s.detail, 'Open until the event ends, Mar 1, 2027, 6:00 PM (Africa/Accra).')
  const d = organizerStatus(
    one({ registration_deadline: '2027-02-20T17:00:00+00:00', closes_at: '2027-02-20T17:00:00+00:00' }),
    published,
    'u-1'
  )
  assert.equal(d.detail, 'Open until the registration deadline, Feb 20, 2027, 5:00 PM (Africa/Accra).')
})

test('organizer status: who closed it is "you" or "a member of your team", never an id', () => {
  const w = one({ registration_state: 'closed', registration_closed_at: '2027-01-05T09:30:00+00:00' })
  assert.equal(organizerStatus(w, { ...published, registration_closed_by: 'u-1' }, 'u-1').detail, 'Closed by you on Jan 5, 2027, 9:30 AM (Africa/Accra).')
  assert.equal(
    organizerStatus(w, { ...published, registration_closed_by: 'u-2' }, 'u-1').detail,
    'Closed by a member of your team on Jan 5, 2027, 9:30 AM (Africa/Accra).'
  )
  assert.equal(organizerStatus(w, { ...published, registration_closed_by: null }, 'u-1').detail, 'Closed on Jan 5, 2027, 9:30 AM (Africa/Accra).')
})

test('organizer status: deadline and end explain what reopening would take', () => {
  const dl = organizerStatus(one({ registration_state: 'deadline_passed', registration_deadline: '2027-02-20T17:00:00+00:00' }), published, null)
  assert.equal(dl.label, 'Closed')
  assert.equal(dl.hint, 'Move or remove the deadline to open registration again.')
  const ended = organizerStatus(one({ registration_state: 'ended' }), published, null)
  assert.equal(ended.detail, 'The event has ended.')
  assert.match(ended.hint, /cannot reopen after an event ends/)
})

test('organizer status: a draft opens on publishing, or stays closed if closed', () => {
  const draft = { ...published, visibility: 'draft' }
  assert.equal(organizerStatus(one({ registration_state: 'unavailable' }), draft, null).label, 'Opens on publishing')
  const closedDraft = organizerStatus(one({ registration_state: 'unavailable', registration_closed_at: '2027-01-01T00:00:00+00:00' }), draft, null)
  assert.equal(closedDraft.label, 'Closed')
  assert.match(closedDraft.detail, /stays closed when you publish/)
})

// ---- time ---------------------------------------------------------------------------
test('usableTimeZone accepts IANA names and refuses offsets and junk', () => {
  assert.equal(usableTimeZone('Africa/Accra'), 'Africa/Accra')
  assert.equal(usableTimeZone('  Europe/London '), 'Europe/London')
  assert.equal(usableTimeZone('africa/accra'), 'Africa/Accra')
  assert.equal(usableTimeZone('UTC'), 'UTC')
  assert.equal(usableTimeZone(FALLBACK_TIMEZONE), 'Etc/GMT+12')
  for (const bad of ['', '   ', null, undefined, '+05:00', 'Not/AZone', 'UTC-5 hours']) assert.equal(usableTimeZone(bad), null, String(bad))
})

test('formatInstant names the zone, or says it is the viewer\'s time', () => {
  assert.equal(formatInstant('2027-03-01T17:00:00Z', 'Asia/Tokyo'), 'Mar 2, 2027, 2:00 AM (Asia/Tokyo)')
  assert.match(formatInstant('2027-03-01T17:00:00Z', null), /\(your time\)$/)
  assert.match(formatInstant('2027-03-01T17:00:00Z', 'garbage'), /\(your time\)$/)
})

const ev = (over = {}) => ({ start_date: '2027-03-01', end_date: null, start_time: null, end_time: null, timezone: 'Africa/Accra', ...over })
const iso = (d) => d?.toISOString() ?? null

test('eventEndsAt: no end time means midnight after the last day', () => {
  assert.equal(iso(eventEndsAt(ev())), '2027-03-02T00:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ timezone: 'Asia/Tokyo' }))), '2027-03-01T15:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ end_date: '2027-03-03' }))), '2027-03-04T00:00:00.000Z')
})

test('eventEndsAt: the end time on the last day, in the event zone (summer and winter)', () => {
  assert.equal(iso(eventEndsAt(ev({ start_time: '09:00:00', end_time: '17:00:00', timezone: 'America/New_York' }))), '2027-03-01T22:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ start_date: '2027-07-01', start_time: '09:00', end_time: '17:00', timezone: 'America/New_York' }))), '2027-07-01T21:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ end_date: '2027-03-03', end_time: '12:30:00' }))), '2027-03-03T12:30:00.000Z')
})

test('eventEndsAt: a one-day event ending at or before its start runs overnight', () => {
  assert.equal(iso(eventEndsAt(ev({ start_time: '22:00:00', end_time: '02:00:00' }))), '2027-03-02T02:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ start_time: '22:00', end_time: '22:00' }))), '2027-03-02T22:00:00.000Z')
  // With an explicit end date the end time is taken as written (the database does the same).
  assert.equal(iso(eventEndsAt(ev({ end_date: '2027-03-01', start_time: '22:00', end_time: '02:00' }))), '2027-03-01T02:00:00.000Z')
})

test('eventEndsAt: backwards dates use the start date; no start date has no end', () => {
  assert.equal(iso(eventEndsAt(ev({ end_date: '2027-02-27' }))), '2027-03-02T00:00:00.000Z')
  assert.equal(eventEndsAt(ev({ start_date: null })), null)
})

test('eventEndsAt: no usable timezone falls back to UTC-12, as the database does', () => {
  assert.equal(iso(eventEndsAt(ev({ timezone: null }))), '2027-03-02T12:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ timezone: 'UTC-5' }))), '2027-03-02T12:00:00.000Z')
})

test('deadline inputs show the instant in the event zone and convert back', () => {
  assert.deepEqual(deadlineInputs('2027-02-20T17:00:00+00:00', 'Africa/Accra'), { date: '2027-02-20', time: '17:00' })
  assert.deepEqual(deadlineInputs('2027-02-20T17:00:00+00:00', 'Asia/Tokyo'), { date: '2027-02-21', time: '02:00' })
  assert.equal(deadlineFromInputs('2027-02-21', '02:00', 'Asia/Tokyo'), '2027-02-20T17:00:00.000Z')
  assert.equal(deadlineFromInputs('2027-07-01', '09:00', 'America/New_York'), '2027-07-01T13:00:00.000Z')
  assert.equal(deadlineFromInputs('', '09:00', 'Africa/Accra'), null)
})

// Checked against Postgres (`timestamp AT TIME ZONE`) on PGlite: 3,000 random events
// around the US, EU, Australian and Chilean clock changes, zero differences.
test('wallClockToUtc reads times near a clock change as Postgres does', () => {
  // New York falls back at 02:00 EDT on 2027-11-07; 02:00 then happens once, in EST.
  assert.equal(wallClockToUtc('2027-11-07', '02:00', 'America/New_York'), '2027-11-07T07:00:00.000Z')
  assert.equal(iso(eventEndsAt(ev({ start_date: '2027-11-07', start_time: '22:00', end_time: '02:00', timezone: 'America/New_York', end_date: '2027-07-01' }))), '2027-11-07T07:00:00.000Z')
  // The day after it springs forward is an ordinary EDT day.
  assert.equal(wallClockToUtc('2027-03-15', '00:00', 'America/New_York'), '2027-03-15T04:00:00.000Z')
  assert.equal(wallClockToUtc('2027-03-28', '03:00', 'Europe/London'), '2027-03-28T02:00:00.000Z')
  assert.equal(wallClockToUtc('2027-07-01', '17:00', 'Africa/Accra'), '2027-07-01T17:00:00.000Z')
})

test('deadline inputs are empty without a deadline or a usable zone', () => {
  assert.deepEqual(deadlineInputs(null, 'Africa/Accra'), { date: '', time: '' })
  assert.deepEqual(deadlineInputs('2027-02-20T17:00:00Z', null), { date: '', time: '' })
})
