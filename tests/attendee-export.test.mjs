// Unit tests for the attendee CSV export (src/lib/attendeeExport.ts): formula
// injection, quoting, column mapping, and reading every chunk.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPORT_HEADERS,
  attendeeCsvRow,
  attendeesCsv,
  collectAttendeeExport,
  csvCell,
  exportFileName,
  exportTimestamp,
  registrationStatusLabel,
} from '../src/lib/attendeeExport.ts'

const base = {
  user_id: 'u1',
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+44 20 7946 0000',
  company: 'Engines',
  job_title: 'Analyst',
  status: 'registered',
  registered_at: '2026-11-01T09:30:00Z',
  checked_in_at: null,
  marketing_consent: false,
  marketing_consent_at: null,
}

test('formula-looking cells are neutralised', () => {
  for (const bad of ['=HYPERLINK("http://x","y")', '+1+2', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
    assert.ok(csvCell(bad).startsWith(`"'`), `${JSON.stringify(bad)} -> ${csvCell(bad)}`)
  }
  assert.equal(csvCell('=1+1'), `"'=1+1"`)
})

test('ordinary cells are only quoted', () => {
  assert.equal(csvCell('Ada'), '"Ada"')
  assert.equal(csvCell(''), '""')
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell('a=b'), '"a=b"')
})

test('quotes, commas and line breaks cannot break a row', () => {
  assert.equal(csvCell('Say "hi", then\nleave'), '"Say ""hi"", then\nleave"')
})

test('a phone starting with + is kept as text, not evaluated', () => {
  assert.equal(csvCell('+44 20 7946 0000'), `"'+44 20 7946 0000"`)
})

test('status uses the shared rules: confirmed holds a seat, arrival is separate', () => {
  assert.equal(registrationStatusLabel('registered'), 'Confirmed')
  assert.equal(registrationStatusLabel('checked_in'), 'Confirmed')
  assert.equal(registrationStatusLabel('waitlisted'), 'Waitlisted')
  assert.equal(registrationStatusLabel('cancelled'), 'Cancelled')
})

test('timestamps are UTC, second precision, and blank when missing', () => {
  assert.equal(exportTimestamp('2026-11-01T09:30:00.123Z'), '2026-11-01 09:30:00')
  assert.equal(exportTimestamp(null), '')
  assert.equal(exportTimestamp('not a date'), '')
})

test('one row per attendee, in header order', () => {
  assert.equal(EXPORT_HEADERS.length, 11)
  const row = attendeeCsvRow({
    ...base,
    status: 'checked_in',
    checked_in_at: '2026-11-02T08:00:00Z',
    marketing_consent: true,
    marketing_consent_at: '2026-11-01T09:31:00Z',
  })
  assert.equal(
    row,
    '"Ada Lovelace","ada@example.com","\'+44 20 7946 0000","Engines","Analyst","Confirmed","2026-11-01 09:30:00","Yes","2026-11-02 08:00:00","Yes","2026-11-01 09:31:00"'
  )
})

test('an undone check-in exports as not arrived; no consent exports as No', () => {
  const row = attendeeCsvRow({ ...base, status: 'checked_in', checked_in_at: null })
  assert.match(row, /"Confirmed","2026-11-01 09:30:00","No","","No",""$/)
})

test('a waitlisted person never shows as checked in', () => {
  const row = attendeeCsvRow({ ...base, status: 'waitlisted', checked_in_at: '2026-11-02T08:00:00Z' })
  assert.match(row, /"Waitlisted","2026-11-01 09:30:00","No",""/)
})

test('missing contact details are empty cells', () => {
  const row = attendeeCsvRow({ ...base, email: null, phone: null })
  assert.ok(row.startsWith('"Ada Lovelace","","",'))
})

test('the file has a BOM, a header row and CRLF line ends', () => {
  const csv = attendeesCsv([base, { ...base, user_id: 'u2', full_name: 'Bob' }])
  assert.ok(csv.startsWith('﻿"Name","Email","Phone"'))
  assert.equal(csv.split('\r\n').length, 4) // header, two rows, trailing empty
})

test('collects every chunk until the total is reached', async () => {
  const all = Array.from({ length: 2345 }, (_, i) => ({ ...base, user_id: `u${i}` }))
  const calls = []
  const progress = []
  const result = await collectAttendeeExport(
    async (offset, size) => {
      calls.push([offset, size])
      return { rows: all.slice(offset, offset + size), total: all.length, error: null }
    },
    (done, total) => progress.push([done, total])
  )
  assert.equal(result.error, null)
  assert.equal(result.rows.length, 2345)
  assert.deepEqual(calls, [[0, 1000], [1000, 1000], [2000, 1000]])
  assert.deepEqual(progress.at(-1), [2345, 2345])
})

test('stops after one call when everything fits', async () => {
  let calls = 0
  const result = await collectAttendeeExport(async () => {
    calls++
    return { rows: [base], total: 1, error: null }
  })
  assert.equal(calls, 1)
  assert.equal(result.rows.length, 1)
})

test('an exact multiple of the chunk size does not request an empty extra chunk', async () => {
  const all = Array.from({ length: 4 }, (_, i) => ({ ...base, user_id: `u${i}` }))
  let calls = 0
  await collectAttendeeExport(async (offset, size) => {
    calls++
    return { rows: all.slice(offset, offset + size), total: 4, error: null }
  }, undefined, 2)
  assert.equal(calls, 2)
})

test('a row that shifts between chunks is written once', async () => {
  const chunks = [
    [{ ...base, user_id: 'a' }, { ...base, user_id: 'b' }],
    [{ ...base, user_id: 'b' }, { ...base, user_id: 'c' }],
    [],
  ]
  const result = await collectAttendeeExport(async (offset, size) => ({
    rows: chunks[offset / size],
    total: 5,
    error: null,
  }), undefined, 2)
  assert.deepEqual(result.rows.map((r) => r.user_id), ['a', 'b', 'c'])
})

test('an error anywhere returns no rows at all', async () => {
  const result = await collectAttendeeExport(async (offset) =>
    offset === 0
      ? { rows: [base], total: 3, error: null }
      : { rows: [], total: 0, error: 'You do not manage this event' }, undefined, 1)
  assert.deepEqual(result, { rows: [], error: 'You do not manage this event' })
})

test('file names are safe and say which filter was exported', () => {
  const day = new Date('2026-11-18T12:00:00Z')
  assert.equal(exportFileName('Big Event: Café 2026!', 'all', day), 'big-event-cafe-2026-attendees-2026-11-18.csv')
  assert.equal(exportFileName('Big Event', 'not_checked_in', day), 'big-event-attendees-not-checked-in-2026-11-18.csv')
  assert.equal(exportFileName('***', 'all', day), 'event-attendees-2026-11-18.csv')
})
