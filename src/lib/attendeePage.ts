// The organizer attendee list's filters and paging, shared by AttendeesPanel and
// its tests. The database does the work (event_attendee_page, migration
// 20261031000000): search and filter first, then one page. This module only
// names the filters and does the page arithmetic.
//
// Filter meanings are the shared registration rules (registrationStatus.ts):
// confirmed = registered or checked_in, arrival = checked_in_at.
//
// Pure (no Supabase import) so it can be unit-tested in Node.

export type AttendeeFilter =
  | 'all'
  | 'confirmed'
  | 'checked_in'
  | 'not_checked_in'
  | 'waitlisted'
  | 'cancelled'

export const ATTENDEE_FILTERS: { key: AttendeeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'checked_in', label: 'Checked in' },
  { key: 'not_checked_in', label: 'Not checked in' },
  { key: 'waitlisted', label: 'Waitlisted' },
  { key: 'cancelled', label: 'Cancelled' },
]

export const ATTENDEE_PAGE_SIZE = 20

// Wait this long after the last keystroke before searching.
export const ATTENDEE_SEARCH_DEBOUNCE_MS = 300

export type AttendeeQuery = {
  search: string
  filter: AttendeeFilter
  page: number // zero-based
}

// The search term as the server will see it. Requests are keyed on this, so
// typing a trailing space or changing only case of nothing does not refetch.
export function normalizeSearch(search: string): string {
  return search.trim()
}

export function pageOffset(page: number, size = ATTENDEE_PAGE_SIZE): number {
  return Math.max(0, Math.floor(page)) * size
}

export function pageCount(total: number, size = ATTENDEE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size))
}

export type PageInfo = {
  page: number // zero-based
  pages: number
  first: number // 1-based index of the first row shown; 0 when empty
  last: number
  total: number
  hasPrevious: boolean
  hasNext: boolean
}

export function pageInfo(total: number, page: number, size = ATTENDEE_PAGE_SIZE): PageInfo {
  const pages = pageCount(total, size)
  const current = Math.min(Math.max(0, Math.floor(page)), pages - 1)
  const first = total === 0 ? 0 : current * size + 1
  const last = Math.min(total, (current + 1) * size)
  return {
    page: current,
    pages,
    first,
    last,
    total,
    hasPrevious: current > 0,
    hasNext: current < pages - 1,
  }
}

// The page to show instead, when the requested one is past the end: the last
// page that has rows, or the first page when nothing matches. null when the
// requested page is valid. This happens when the list shrinks between requests
// (a cancellation, a check-in leaving a filter), since the total is always known.
export function correctedPage(page: number, total: number, size = ATTENDEE_PAGE_SIZE): number | null {
  const last = pageCount(total, size) - 1
  const requested = Math.max(0, Math.floor(page))
  return requested > last ? last : null
}

// event_attendee_page returns exactly one row: { total_count, attendees }. The
// total is present even when the page itself is empty. Anything malformed reads
// as an empty result rather than a crash.
export function parseAttendeePage<Row>(data: unknown): { rows: Row[]; total: number } {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { total_count?: number | string | null; attendees?: unknown }
    | null
    | undefined
  const total = Number(row?.total_count ?? 0)
  return {
    rows: Array.isArray(row?.attendees) ? (row.attendees as Row[]) : [],
    total: Number.isFinite(total) && total > 0 ? total : 0,
  }
}

// One key per distinct request. The panel fetches only when this changes, so a
// re-render, or a debounce that settles on the same text, never re-requests.
export function attendeeQueryKey(eventId: string, q: AttendeeQuery): string {
  return JSON.stringify([eventId, normalizeSearch(q.search), q.filter, Math.max(0, Math.floor(q.page))])
}
