import { useEffect, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, Spinner } from '@/components/ui/States'
import { cn } from '@/lib/utils'
import { listCheckInRows, type CheckInRow } from '@/lib/checkin'

// The event attendee directory. Data comes from find_event_attendees — the
// same RPC as check-in — so it can only ever show what the backend permits:
// the public professional card, registration status, and the check-in
// timestamp. No email or phone, because the backend returns none.
type Filter = 'all' | 'checked_in' | 'not_checked_in' | 'registered' | 'cancelled'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'checked_in', label: 'Checked in' },
  { key: 'not_checked_in', label: 'Not checked in' },
  { key: 'registered', label: 'Registered' },
  { key: 'cancelled', label: 'Cancelled' },
]

export function AttendeesPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<CheckInRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  // find_event_attendees already accepts a search term, so the text filter is
  // server-side; the state filters are client-side over the full list.
  async function load() {
    const { data, error: loadError } = await listCheckInRows(eventId)
    if (loadError) {
      setError(loadError)
      setRows(null)
      return
    }
    setError(null)
    setRows(data)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  const visible = (rows ?? []).filter((r) => {
    if (filter === 'checked_in') return r.checked_in_at !== null
    if (filter === 'not_checked_in') return r.checked_in_at === null && r.status !== 'cancelled'
    if (filter === 'registered') return r.status === 'registered'
    if (filter === 'cancelled') return r.status === 'cancelled'
    return true
  })

  const needle = search.trim().toLowerCase()
  const searched = needle
    ? visible.filter(
        (r) =>
          r.full_name.toLowerCase().includes(needle) ||
          r.company.toLowerCase().includes(needle)
      )
    : visible

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or company…"
            className="pl-9"
          />
        </div>
        <p className="text-sm text-gray-500">
          {searched.length} {searched.length === 1 ? 'attendee' : 'attendees'}
        </p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f.key
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              {f.label}
              {f.key === 'checked_in' && rows && (
                <span className="ml-1.5">{rows.filter((r) => r.checked_in_at !== null).length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="py-2">
          {rows === null && !error && <Spinner className="mx-auto my-8" />}
          {error && (
            <EmptyState
              title="Could not load attendees"
              description={error}
              action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}
            />
          )}
          {rows !== null && !error && searched.length === 0 && (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title={rows.length === 0 ? 'No registrations yet' : 'No matching attendees'}
              description={
                rows.length === 0
                  ? 'Attendees appear here as they register.'
                  : 'Try a different search or filter.'
              }
            />
          )}
          {rows !== null && !error && searched.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {searched.map((r) => (
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
