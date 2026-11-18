// Unit tests for the organizer attendee list's paging helpers
// (src/lib/attendeePage.ts). The database searches, filters and pages
// (event_attendee_page); these check the page arithmetic and request keys the
// panel builds on.
//   npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTENDEE_FILTERS,
  ATTENDEE_PAGE_SIZE,
  attendeeQueryKey,
  correctedPage,
  normalizeSearch,
  pageCount,
  pageInfo,
  pageOffset,
  parseAttendeePage,
} from '../src/lib/attendeePage.ts'

test('default page size is 20', () => {
  assert.equal(ATTENDEE_PAGE_SIZE, 20)
})

test('the six filters, in order, with the database names', () => {
  assert.deepEqual(
    ATTENDEE_FILTERS.map((f) => f.key),
    ['all', 'confirmed', 'checked_in', 'not_checked_in', 'waitlisted', 'cancelled']
  )
})

test('offsets are page * size and never negative', () => {
  assert.equal(pageOffset(0), 0)
  assert.equal(pageOffset(1), 20)
  assert.equal(pageOffset(3), 60)
  assert.equal(pageOffset(-2), 0)
})

test('page count rounds up and is at least one', () => {
  assert.equal(pageCount(0), 1)
  assert.equal(pageCount(1), 1)
  assert.equal(pageCount(20), 1)
  assert.equal(pageCount(21), 2)
  assert.equal(pageCount(45), 3)
})

test('page info for a middle, last and empty page', () => {
  assert.deepEqual(pageInfo(45, 1), {
    page: 1, pages: 3, first: 21, last: 40, total: 45, hasPrevious: true, hasNext: true,
  })
  assert.deepEqual(pageInfo(45, 2), {
    page: 2, pages: 3, first: 41, last: 45, total: 45, hasPrevious: true, hasNext: false,
  })
  assert.deepEqual(pageInfo(0, 0), {
    page: 0, pages: 1, first: 0, last: 0, total: 0, hasPrevious: false, hasNext: false,
  })
})

test('a page past the end is clamped to the last page', () => {
  assert.equal(pageInfo(45, 9).page, 2)
})

test('search is trimmed before it reaches the server', () => {
  assert.equal(normalizeSearch('  Ada  '), 'Ada')
  assert.equal(normalizeSearch('   '), '')
})

test('request keys change only when the request does', () => {
  const base = { search: 'ada', filter: 'all', page: 0 }
  const k = attendeeQueryKey('e1', base)
  assert.equal(attendeeQueryKey('e1', { ...base, search: ' ada ' }), k)
  assert.notEqual(attendeeQueryKey('e1', { ...base, search: 'adb' }), k)
  assert.notEqual(attendeeQueryKey('e1', { ...base, filter: 'waitlisted' }), k)
  assert.notEqual(attendeeQueryKey('e1', { ...base, page: 1 }), k)
  assert.notEqual(attendeeQueryKey('e2', base), k)
})

// event_attendee_page always returns one row { total_count, attendees }, so the
// total is known even for an empty page.
test('parses a page and its total', () => {
  const data = [{ total_count: '45', attendees: [{ user_id: 'a' }, { user_id: 'b' }] }]
  assert.deepEqual(parseAttendeePage(data), { rows: [{ user_id: 'a' }, { user_id: 'b' }], total: 45 })
})

test('an empty page still carries the total', () => {
  assert.deepEqual(parseAttendeePage([{ total_count: 25, attendees: [] }]), { rows: [], total: 25 })
})

test('an empty search result is total 0 with no rows', () => {
  assert.deepEqual(parseAttendeePage([{ total_count: 0, attendees: [] }]), { rows: [], total: 0 })
})

test('malformed or missing data reads as empty, never throws', () => {
  for (const bad of [null, undefined, [], {}, [{}], [{ total_count: 'x', attendees: 'nope' }]]) {
    assert.deepEqual(parseAttendeePage(bad), { rows: [], total: 0 })
  }
})

test('a valid page needs no correction', () => {
  assert.equal(correctedPage(0, 45), null)
  assert.equal(correctedPage(2, 45), null)
  assert.equal(correctedPage(0, 0), null)
})

test('an out-of-range page moves to the last page with rows', () => {
  assert.equal(correctedPage(3, 45), 2)
  assert.equal(correctedPage(9, 21), 1)
})

test('a page that became invalid after the list shrank moves back', () => {
  // Was on page 2 of 17 (size 10); 8 cancelled, 9 remain: page 2 no longer exists.
  assert.equal(correctedPage(1, 9, 10), 0)
  // Everything gone: back to the first page, which shows the empty state.
  assert.equal(correctedPage(4, 0), 0)
})

test('a corrected page is always valid, so correction cannot loop', () => {
  for (const total of [0, 1, 19, 20, 21, 99]) {
    for (const page of [0, 1, 2, 5, 50]) {
      const fixed = correctedPage(page, total) ?? page
      assert.equal(correctedPage(fixed, total), null)
    }
  }
})
