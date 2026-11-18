import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, Spinner } from '@/components/ui/States'
import { cn } from '@/lib/utils'
import { fetchAttendeePage, type CheckInRow } from '@/lib/checkin'
import {
  ATTENDEE_FILTERS,
  ATTENDEE_SEARCH_DEBOUNCE_MS,
  attendeeQueryKey,
  normalizeSearch,
  pageInfo,
  type AttendeeFilter,
} from '@/lib/attendeePage'

// The event attendee directory. One page at a time from event_attendee_page,
// which searches (name or company), filters by registration status and pages on
// the server, behind the same gate as check-in: can_manage_event and an active
// account. It returns only the public professional card, registration status
// and check-in time. No email or phone, because the backend returns none.
//
// Filters use the shared registration rules (registrationStatus.ts):
// "Confirmed" is registered or checked in; "Not checked in" is confirmed and
// still to arrive, so waitlisted and cancelled people are not in it.

type Loaded = { key: string; rows: CheckInRow[]; total: number }

export function AttendeesPanel({ eventId }: { eventId: string }) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AttendeeFilter>('all')
  const [page, setPage] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [retries, setRetries] = useState(0)
  const seq = useRef(0)

  // Debounce typing. A new search term starts again at the first page; a pause
  // that settles on the same term changes nothing and so fetches nothing.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = normalizeSearch(searchInput)
      if (next !== search) {
        setSearch(next)
        setPage(0)
      }
    }, ATTENDEE_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, search])

  const key = attendeeQueryKey(eventId, { search, filter, page })

  // Fetch only when the request itself changes (or on an explicit retry). A late
  // answer for a request the panel has moved past is dropped.
  useEffect(() => {
    const mine = ++seq.current
    setError(null)
    void fetchAttendeePage(eventId, { search, filter, page }).then((result) => {
      if (mine !== seq.current) return
      if (result.error) {
        setError({ key, message: result.error })
        return
      }
      // The list shrank under us (e.g. a cancellation) and this page is now past
      // the end: go back to the first page rather than show an empty one.
      if (result.rows.length === 0 && page > 0) {
        setPage(0)
        return
      }
      setLoaded({ key, rows: result.rows, total: result.total })
    })
    // key captures eventId, search, filter and page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retries])

  function chooseFilter(next: AttendeeFilter) {
    if (next === filter) return
    setFilter(next)
    setPage(0)
  }

  const current = loaded?.key === key ? loaded : null
  const loading = current === null && error === null
  // While the next page loads, keep the previous one on screen (dimmed).
  const rows = loaded?.rows ?? []
  const total = loaded?.total ?? 0
  const info = pageInfo(total, page)
  const filtering = search !== '' || filter !== 'all'

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or company…"
            aria-label="Search attendees by name or company"
            className="pl-9"
          />
        </div>
        {current && (
          <p className="text-sm text-gray-500" aria-live="polite">
            {total.toLocaleString()} {total === 1 ? 'attendee' : 'attendees'}
          </p>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex gap-2" role="group" aria-label="Filter attendees by status">
          {ATTENDEE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => chooseFilter(f.key)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f.key
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="py-2">
          {error ? (
            <EmptyState
              title="Could not load attendees"
              description={error.message}
              action={
                <Button variant="secondary" onClick={() => setRetries((n) => n + 1)}>
                  Try again
                </Button>
              }
            />
          ) : loaded === null ? (
            <Spinner className="mx-auto my-8" />
          ) : current && rows.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title={filtering ? 'No matching attendees' : 'No registrations yet'}
              description={
                filtering ? 'Try a different search or filter.' : 'Attendees appear here as they register.'
              }
            />
          ) : (
            <ul
              className={cn('divide-y divide-gray-100 transition-opacity', loading && 'opacity-60')}
              aria-busy={loading}
            >
              {rows.map((r) => (
                <li key={r.user_id} className="flex items-center gap-3 py-3">
                  <Avatar name={r.full_name || 'Attendee'} src={r.photo_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {r.full_name || 'Rally member'}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {[r.job_title, r.company].filter(Boolean).join(' · ') || 'No title set'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge
                      variant={
                        r.status === 'cancelled'
                          ? 'gray'
                          : r.checked_in_at
                            ? 'success'
                            : r.status === 'waitlisted'
                              ? 'warning'
                              : 'default'
                      }
                    >
                      {r.checked_in_at ? 'Checked in' : r.status === 'cancelled' ? 'Cancelled' : r.status === 'waitlisted' ? 'Waitlisted' : 'Not checked in'}
                    </Badge>
                    {r.checked_in_at && (
                      <span className="text-xs text-gray-400">
                        {formatTime(r.checked_in_at)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!error && current && total > 0 && (
        <nav
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Attendee pages"
        >
          <p className="text-sm text-gray-500">
            Page {info.page + 1} of {info.pages} · Showing {info.first.toLocaleString()}–
            {info.last.toLocaleString()} of {info.total.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!info.hasPrevious || loading}
              onClick={() => setPage(info.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!info.hasNext || loading}
              onClick={() => setPage(info.page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}

      <p className="text-xs text-gray-500">
        Rally does not show you attendees' email addresses or phone numbers. Attendees choose when
        to share those, and none have through this event so far.
      </p>
    </div>
  )
}

function formatTime(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
