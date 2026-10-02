import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Link2,
  MapPin,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { canManageTeam, fetchOrganizationEventCounts, type OrgEventCounts } from '@/lib/organizer'
import {
  LIFECYCLE_BADGE,
  LIFECYCLE_LABELS,
  eventLifecycle,
  formatEventDate,
  listOrganizationEvents,
  type EventLifecycle,
} from '@/lib/events'
import { cn } from '@/lib/utils'
import type { OrganizerEvent } from '@/lib/supabase'

// The status filter uses the derived lifecycle (plus an "upcoming" alias for
// published events, which is how the organizer thinks of them) — no stored
// status values are invented here.
type StatusFilter = EventLifecycle | 'upcoming' | 'all'
type DateFilter = 'all' | 'upcoming' | 'past'
type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All statuses' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'draft', label: 'Draft' },
  { key: 'live', label: 'Live' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
]

const DATE_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: 'all', label: 'All dates' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date-desc', label: 'Date (newest)' },
  { key: 'date-asc', label: 'Date (oldest)' },
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
]

function matchesStatus(event: OrganizerEvent, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  const lifecycle = eventLifecycle(event)
  if (filter === 'upcoming') return lifecycle === 'published'
  return lifecycle === filter
}

function matchesDate(event: OrganizerEvent, filter: DateFilter): boolean {
  if (filter === 'all') return true
  const raw = event.end_date ?? event.start_date
  if (!raw) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(`${raw}T00:00:00`)
  if (filter === 'upcoming') return end.getTime() >= today.getTime()
  return end.getTime() < today.getTime()
}

// Check-in and networking only exist once an event is running or done; before
// that a zero would read as "nobody showed up" rather than "not started yet".
function activityVisible(lifecycle: EventLifecycle): boolean {
  return lifecycle === 'live' || lifecycle === 'completed'
}

function EventThumb({ event, className }: { event: OrganizerEvent; className?: string }) {
  if (event.image_url) {
    return (
      <img
        src={event.image_url}
        alt=""
        className={cn('shrink-0 rounded-md object-cover bg-gray-100', className)}
      />
    )
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-400',
        className
      )}
      aria-hidden="true"
    >
      <CalendarRange className="h-4 w-4" />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
  iconClassName,
  loading,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  iconClassName: string
  loading: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', iconClassName)}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-7 w-14 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="text-2xl font-bold leading-7 tabular-nums text-gray-900">{value}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>
        </div>
      </div>
    </div>
  )
}

const selectClass =
  'h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-600'

function ToolbarSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { key: string; label: string }[]
  onChange: (key: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectClass}
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function ActivityDots({ event, count }: { event: OrganizerEvent; count?: OrgEventCounts }) {
  const lifecycle = eventLifecycle(event)
  const show = activityVisible(lifecycle)
  return (
    <div className="mt-1.5 flex items-center gap-4 text-xs text-gray-600">
      <span className="inline-flex items-center gap-1">
        <Users className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
        {count ? count.registrations.toLocaleString() : '—'}
      </span>
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
        {show && count ? count.checked_in.toLocaleString() : '—'}
      </span>
      <span className="inline-flex items-center gap-1">
        <Link2 className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
        {show && count ? count.connections_made.toLocaleString() : '—'}
      </span>
    </div>
  )
}

export default function EventsListPage() {
  const { organization, role, loading: orgLoading } = useOrganizer()
  const [events, setEvents] = useState<OrganizerEvent[]>([])
  const [counts, setCounts] = useState<Record<string, OrgEventCounts>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sort, setSort] = useState<SortKey>('date-desc')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const orgId = organization?.id ?? null
  const canCreate = canManageTeam(role)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)

    const result = await listOrganizationEvents(orgId)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    setEvents(result.data)

    // Same failure-tolerant counts layer as the dashboard: the event list
    // stays usable even if activity numbers cannot be loaded.
    const countsResult = await fetchOrganizationEventCounts(orgId)
    if (countsResult.error) setError(countsResult.error)
    setCounts(countsResult.data)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = events.filter((event) => {
      if (!matchesStatus(event, status)) return false
      if (!matchesDate(event, dateFilter)) return false
      if (!query) return true
      return (
        event.name.toLowerCase().includes(query) ||
        event.location.toLowerCase().includes(query)
      )
    })
    const byStart = (e: OrganizerEvent) => e.start_date ?? ''
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'date-asc':
          return byStart(a).localeCompare(byStart(b))
        case 'name-asc':
          return a.name.localeCompare(b.name)
        case 'name-desc':
          return b.name.localeCompare(a.name)
        default:
          return byStart(b).localeCompare(byStart(a))
      }
    })
  }, [events, search, status, dateFilter, sort])

  const totals = useMemo(() => {
    const byLifecycle: Record<EventLifecycle, number> = {
      draft: 0,
      published: 0,
      live: 0,
      completed: 0,
      archived: 0,
    }
    for (const event of events) byLifecycle[eventLifecycle(event)] += 1
    const upcomingParts: string[] = []
    if (byLifecycle.published > 0) upcomingParts.push(`${byLifecycle.published} upcoming`)
    if (byLifecycle.live > 0) upcomingParts.push(`${byLifecycle.live} live`)
    return {
      total: events.length,
      published: byLifecycle.published,
      draft: byLifecycle.draft,
      completed: byLifecycle.completed,
      totalHint: upcomingParts.length > 0 ? upcomingParts.join(' · ') : 'None upcoming',
    }
  }, [events])

  if (orgLoading) return <LoadingState message="Loading events…" />
  if (!organization) return null

  const filtersActive = search.trim() !== '' || status !== 'all' || dateFilter !== 'all' || sort !== 'date-desc'
  const resetFilters = () => {
    setSearch('')
    setStatus('all')
    setDateFilter('all')
    setSort('date-desc')
  }

  const hasEvents = events.length > 0

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Events</h1>
          <p className="mt-0.5 text-sm text-gray-500">Create and manage your events.</p>
        </div>
        {canCreate && (
          <Link to="/organizer/events/new" className="shrink-0">
            <Button>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Create event
            </Button>
          </Link>
        )}
      </div>

      {error && (
        <ErrorState message={error} onRetry={() => void load()} />
      )}

      {!hasEvents && !loading ? (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <CalendarRange className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Create your first event</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Bring people together, build meaningful connections and start measuring the
            opportunities your events create.
          </p>
          {canCreate && (
            <div className="mt-5 flex justify-center">
              <Link to="/organizer/events/new">
                <Button>
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                  Create event
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <section aria-label="Event summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard
                label="Total events"
                value={String(totals.total)}
                hint={totals.totalHint}
                loading={loading}
                icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-primary-50 text-primary-600"
              />
              <SummaryCard
                label="Published"
                value={String(totals.published)}
                hint="Live and upcoming"
                loading={loading}
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-success-50 text-success-600"
              />
              <SummaryCard
                label="Draft"
                value={String(totals.draft)}
                hint="Not published"
                loading={loading}
                icon={<CalendarRange className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-violet-50 text-violet-600"
              />
              <SummaryCard
                label="Completed"
                value={String(totals.completed)}
                hint="Finished events"
                loading={loading}
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                iconClassName="bg-gray-100 text-gray-500"
              />
            </div>
          </section>

          {/* Toolbar: search always visible; on mobile the status/date/sort
              controls fold behind a filter button to avoid cramped dropdowns. */}
          <section aria-label="Search and filter events">
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events..."
                    aria-label="Search events"
                    className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  aria-label="Show filters"
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors md:hidden',
                    filtersOpen
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="hidden shrink-0 text-sm font-medium text-primary-600 hover:text-primary-700 md:inline-flex"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div
                className={cn(
                  'mt-3 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
                  filtersOpen ? 'flex' : 'hidden md:flex'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ToolbarSelect
                    label="Filter by status"
                    value={status}
                    options={STATUS_OPTIONS}
                    onChange={(key) => setStatus(key as StatusFilter)}
                  />
                  <ToolbarSelect
                    label="Filter by date"
                    value={dateFilter}
                    options={DATE_OPTIONS}
                    onChange={(key) => setDateFilter(key as DateFilter)}
                  />
                  {filtersActive && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700 md:hidden"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="events-sort" className="text-sm text-gray-500">
                    Sort by
                  </label>
                  <ToolbarSelect
                    label="Sort events"
                    value={sort}
                    options={SORT_OPTIONS}
                    onChange={(key) => setSort(key as SortKey)}
                  />
                </div>
              </div>
            </div>
          </section>

          {loading ? (
            <ul className="space-y-2">
              {[0, 1, 2].map((i) => (
                <li key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-14 animate-pulse rounded-md bg-gray-100" />
                    <div className="flex-1">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
                      <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-gray-100" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white">
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title={filtersActive ? 'No events match your filters' : 'No events here yet'}
                description={
                  filtersActive
                    ? 'Try a different search, status or date range.'
                    : 'Create an event and publish it when you are ready for attendees to see it.'
                }
                action={
                  filtersActive ? (
                    <Button size="sm" variant="secondary" onClick={resetFilters}>
                      Reset filters
                    </Button>
                  ) : canCreate ? (
                    <Link to="/organizer/events/new">
                      <Button size="sm">
                        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                        Create event
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              {/* Desktop — table */}
              <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <th scope="col" className="px-4 py-2.5 font-semibold">Event</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Date</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Registrations</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Checked in</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Connections</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((event) => {
                      const lifecycle = eventLifecycle(event)
                      const count = counts[event.id]
                      const show = activityVisible(lifecycle)
                      return (
                        <tr key={event.id} className="border-t border-gray-100 first:border-t-0 hover:bg-gray-50/60">
                          <td className="px-4 py-2.5">
                            <Link to={'/organizer/events/' + event.id} className="flex items-center gap-3">
                              <EventThumb event={event} className="h-10 w-14" />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-gray-900 hover:text-primary-700">
                                  {event.name}
                                </span>
                                {event.location && (
                                  <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{event.location}</span>
                                  </span>
                                )}
                              </span>
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                            {formatEventDate(event)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                            {event.visibility === 'unlisted' && lifecycle !== 'draft' && (
                              <span className="ml-1.5 inline-block align-middle text-xs text-gray-400">Unlisted</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                            {count ? count.registrations.toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                            {show && count ? count.checked_in.toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                            {show && count ? count.connections_made.toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link to={'/organizer/events/' + event.id}>
                              <Button variant="secondary" size="sm">
                                Manage
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile — compact rows */}
              <ul className="space-y-2 md:hidden">
                {filtered.map((event) => {
                  const lifecycle = eventLifecycle(event)
                  return (
                    <li key={event.id}>
                      <Link
                        to={'/organizer/events/' + event.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300"
                      >
                        <EventThumb event={event} className="h-12 w-16" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-gray-900">{event.name}</p>
                            <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-gray-500">
                            {formatEventDate(event)}
                            {event.location ? ` · ${event.location}` : ''}
                          </p>
                          <ActivityDots event={event} count={counts[event.id]} />
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                      </Link>
                    </li>
                  )
                })}
              </ul>

              <p className="text-sm text-gray-500" aria-live="polite">
                Showing {filtered.length} of {events.length} events
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
