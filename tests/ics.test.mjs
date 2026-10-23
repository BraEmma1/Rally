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

const octets = (s) => Buffer.byteLength(s, 'utf8')

test('long ASCII lines are folded so no physical line exceeds 75 octets', () => {
  const ics = buildEventIcs({ ...base, description: 'x'.repeat(900) })
  for (const l of ics.split('\r\n')) assert.ok(octets(l) <= 75, `line of ${octets(l)} octets`)
  assert.equal(ics.replace(/\r\n /g, '').match(/DESCRIPTION:(x+)/)[1].length, 900)
})

// Regression: folding used to count UTF-16 characters, so Japanese (3 octets a
// character) or emoji (4) produced physical lines of up to ~220 octets, and a
// slice could land between the two halves of a surrogate pair.
for (const [label, text] of [
  ['Japanese', 'アフリカ技術革新サミット'.repeat(20)],
  ['accented Latin', 'Conférence internationale sur l’innovation à Accra — édition spéciale '.repeat(8)],
  ['emoji', '🚀🌍🎤'.repeat(60)],
  ['mixed scripts', 'Summit 峰会 Саммит قمة 🌍 '.repeat(25)],
]) {
  test(`non-English text is folded within 75 octets and round-trips: ${label}`, () => {
    const ics = buildEventIcs({ ...base, name: text, description: text, location: text })
    for (const l of ics.split('\r\n')) assert.ok(octets(l) <= 75, `${label}: line of ${octets(l)} octets`)
    // every physical line is valid UTF-8 on its own: no character was cut in half
    for (const l of ics.split('\r\n')) assert.equal(Buffer.from(l, 'utf8').toString('utf8'), l)
    assert.ok(!/[\ud800-\udfff]/.test(ics.replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')), 'no lone surrogate')
    // unfolding gives back the original text exactly (escaped as the format requires)
    const unfolded = ics.replace(/\r\n /g, '')
    const escaped = text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    assert.ok(unfolded.includes('SUMMARY:' + escaped))
    assert.ok(unfolded.includes('DESCRIPTION:' + escaped.slice(0, 1000)))
    assert.ok(unfolded.includes('LOCATION:' + escaped))
  })
}

test('session calendar folds non-English titles within 75 octets too', () => {
  const title = '基調講演：アフリカのデジタル基盤をつなぐ'.repeat(6)
  const ics = buildSessionsIcs('日本語のスケジュール', [{ id: 's1', title, description: '', location: '', start_at: '2027-03-18T09:00:00Z', end_at: null }])
  for (const l of ics.split('\r\n')) assert.ok(octets(l) <= 75, `line of ${octets(l)} octets`)
  assert.ok(ics.replace(/\r\n /g, '').includes('SUMMARY:' + title))
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

test('a long description is cut on a character boundary, never inside an emoji', () => {
  const ics = buildEventIcs({ ...base, description: 'a' + '🚀'.repeat(1500) })
  const unfolded = ics.replace(/\r\n /g, '')
  const body = unfolded.match(/DESCRIPTION:(.*)\r\n/)[1]
  assert.equal(Array.from(body).length, 1000)
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(body), 'no lone surrogate')
})
