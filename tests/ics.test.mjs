// Unit tests for the calendar export (src/lib/ics.ts). No dependencies: run with
//   npm run test:unit
// (uses Node's built-in test runner and TypeScript type stripping, Node 22+).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEventIcs, buildSessionsIcs } from '../src/lib/ics.ts'

const base = { id: 'e1', name: 'Summit', description: '', location: '', start_date: '2027-03-18', end_date: null, start_time: null, end_time: null }
const lines = (ics) => ics.split('\r\n').filter(Boolean)

test('returns null when the event has no usable start date', () => {
  assert.equal(buildEventIcs({ ...base, start_date: null }), null)
  assert.equal(buildEventIcs({ ...base, start_date: 'soon' }), null)
})

test('timed event is written as floating local time and CRLF terminated', () => {
  const ics = buildEventIcs({ ...base, start_time: '09:30:00', end_time: '17:00:00' })
  assert.ok(ics.endsWith('\r\n'))
  assert.ok(lines(ics).includes('DTSTART:20270318T093000'))
  assert.ok(lines(ics).includes('DTEND:20270318T170000'))
  assert.ok(lines(ics).includes('UID:e1@rally'))
})

test('timed event without an end time ends when it starts', () => {
  const ics = buildEventIcs({ ...base, start_time: '09:30:00' })
  assert.ok(lines(ics).includes('DTEND:20270318T093000'))
})

test('all-day event uses an exclusive end date, across month and year boundaries', () => {
  assert.ok(lines(buildEventIcs({ ...base, start_date: '2027-03-30', end_date: '2027-03-31' })).includes('DTEND;VALUE=DATE:20270401'))
  assert.ok(lines(buildEventIcs({ ...base, start_date: '2027-12-30', end_date: '2027-12-31' })).includes('DTEND;VALUE=DATE:20280101'))
  const single = lines(buildEventIcs(base))
  assert.ok(single.includes('DTSTART;VALUE=DATE:20270318'))
  assert.ok(single.includes('DTEND;VALUE=DATE:20270319'))
})

test('text values escape commas, semicolons, backslashes and newlines', () => {
  const ics = buildEventIcs({ ...base, name: 'A, B; C\\D', location: 'Hall 1\nLevel 2' })
  assert.ok(lines(ics).includes('SUMMARY:A\\, B\\; C\\\\D'))
  assert.ok(lines(ics).includes('LOCATION:Hall 1\\nLevel 2'))
})

test('long lines are folded so no physical line exceeds 75 characters', () => {
  const ics = buildEventIcs({ ...base, description: 'x'.repeat(900) })
  for (const l of ics.split('\r\n')) assert.ok(l.length <= 75, `line of ${l.length}`)
  assert.equal(ics.replace(/\r\n /g, '').match(/DESCRIPTION:(x+)/)[1].length, 900)
})

test('session calendar: null when empty, one UTC VEVENT per session otherwise', () => {
  assert.equal(buildSessionsIcs('My schedule', []), null)
  const ics = buildSessionsIcs('My, schedule', [
    { id: 's1', title: 'Keynote', description: '', location: 'Hall', start_at: '2027-03-18T09:00:00Z', end_at: '2027-03-18T10:00:00Z' },
    { id: 's2', title: 'Panel', description: '', location: '', start_at: '2027-03-18T11:00:00Z', end_at: null },
  ])
  assert.equal(lines(ics).filter((l) => l === 'BEGIN:VEVENT').length, 2)
  assert.ok(lines(ics).includes('X-WR-CALNAME:My\\, schedule'))
  assert.ok(lines(ics).includes('DTSTART:20270318T090000Z'))
  assert.ok(lines(ics).includes('DTEND:20270318T100000Z'))
  assert.ok(lines(ics).includes('DTEND:20270318T110000Z'), 'a session with no end ends when it starts')
})
