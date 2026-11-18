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
  normalizeSearch,
  pageCount,
  pageInfo,
  pageOffset,
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
