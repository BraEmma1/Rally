import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CalendarRange, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input, Label, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminPagination } from '@/components/admin/AdminPagination'
import { ArchivedBadge, EventStatusBadge, EventVisibilityBadge } from '@/components/admin/AdminBadges'
import { formatDateTime } from '@/lib/admin'
import {
  ISO_DATE_RE,
  formatEventDates,
  formatEventTimes,
  listEvents,
  type EventSort,
} from '@/lib/adminEvents'
import { listOrganizations } from '@/lib/adminOrganizations'
import type { AdminEventRow, AdminEventStatus, AdminEventVisibility } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 350
const SEARCH_MAX = 100
const ORG_OPTIONS_LIMIT = 100
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VISIBILITIES: { value: AdminEventVisibility; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'draft', label: 'Draft' },
]
const STATUSES: { value: AdminEventStatus; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'live', label: 'Live' },
  { value: 'past', label: 'Past' },
]
const SORTS: { value: EventSort; label: string }[] = [
  { value: 'start_desc', label: 'Latest start date' },
  { value: 'start_asc', label: 'Earliest start date' },
  { value: 'newest', label: 'Recently created' },
  { value: 'name', label: 'Name A–Z' },
]

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function Registrations({ row }: { row: AdminEventRow }) {
  const active = row.registrations?.active ?? 0
  return (
    <span className="tabular-nums">
      {active}
      {row.capacity ? <span className="text-gray-400"> / {row.capacity}</span> : null}
    </span>
  )
}

function OrganizationCell({ row }: { row: AdminEventRow }) {
  if (!row.organization_id) return <span className="text-sm text-gray-400">No organization</span>
  return (
    <Link to={`/admin/organizations/${row.organization_id}`} className="text-sm text-primary-600 hover:text-primary-700">
      {row.organization_name || 'Unnamed organization'}
    </Link>
  )
}

export default function AdminEventsPage() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').slice(0, SEARCH_MAX)
  const visibility = pick(params.get('visibility'), ['all', ...VISIBILITIES.map((v) => v.value)] as const, 'all')
  const status = pick(params.get('status'), ['all', ...STATUSES.map((s) => s.value)] as const, 'all')
  const orgParam = params.get('org') ?? ''
  const organizationId = UUID_RE.test(orgParam) ? orgParam : ''
  const fromParam = params.get('from') ?? ''
  const toParam = params.get('to') ?? ''
  const from = ISO_DATE_RE.test(fromParam) ? fromParam : ''
  const to = ISO_DATE_RE.test(toParam) ? toParam : ''
  const includeArchived = params.get('archived') === '1'
  const sort = pick(params.get('sort'), SORTS.map((s) => s.value), 'start_desc')
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)
  const rangeInvalid = Boolean(from && to && from > to)

  const [searchInput, setSearchInput] = useState(q)
  const [rows, setRows] = useState<AdminEventRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgOptions, setOrgOptions] = useState<{ id: string; name: string }[]>([])
  const [orgOptionsTotal, setOrgOptionsTotal] = useState(0)

  const update = useCallback(
    (next: Record<string, string>) => {
      setParams(
        (current) => {
          const merged = new URLSearchParams(current)
          for (const [key, value] of Object.entries(next)) {
            const isDefault =
              value === '' ||
              value === 'all' ||
              (key === 'sort' && value === 'start_desc') ||
              (key === 'page' && value === '0') ||
              (key === 'archived' && value === '0')
            if (isDefault) merged.delete(key)
            else merged.set(key, value)
          }
          return merged
        },
        { replace: true }
      )
    },
    [setParams]
  )

  useEffect(() => {
    setSearchInput(q)
  }, [q])

  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === q.trim()) return
    const timer = setTimeout(() => update({ q: trimmed, page: '0' }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput, q, update])

  // Organization filter options, through the same admin read function the
  // organization directory uses. Archived organizations are included because
  // their events still exist.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await listOrganizations({
        includeArchived: true,
        sort: 'name',
        page: 0,
        pageSize: ORG_OPTIONS_LIMIT,
      })
      if (cancelled || !data) return
      setOrgOptions(data.rows.map((o) => ({ id: o.id, name: o.name })))
      setOrgOptionsTotal(data.total)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    if (rangeInvalid) {
      setRows([])
      setTotal(0)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: loadError } = await listEvents({
      search: q,
      visibility,
      status,
      organizationId: organizationId || null,
      from: from || null,
      to: to || null,
      includeArchived,
      sort,
      page,
      pageSize: PAGE_SIZE,
    })
    setError(loadError)
    setRows(data?.rows ?? [])
    setTotal(data?.total ?? 0)
    setLoading(false)
  }, [q, visibility, status, organizationId, from, to, includeArchived, sort, page, rangeInvalid])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!loading && !error && rows.length === 0 && total > 0 && page > 0) {
      update({ page: String(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)) })
    }
  }, [loading, error, rows.length, total, page, update])

  const detailState = { from: `${location.pathname}${location.search}` }
  const filtered = Boolean(
    q || visibility !== 'all' || status !== 'all' || organizationId || from || to || includeArchived
  )
  // A filter set from a link (?org=) may point at an organization outside the
  // first page of options; keep it selectable rather than silently dropping it.
  const selectedOrgMissing = organizationId && !orgOptions.some((o) => o.id === organizationId)
  const selectedOrgName = rows.find((r) => r.organization_id === organizationId)?.organization_name

  return (
    <div>
      <AdminPageHeader
        title="Events"
        description="Every event on Rally, including drafts and unlisted events. Read-only: events are managed by their organizations."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="events-search">Search name or location</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="events-search"
                type="search"
                value={searchInput}
                maxLength={SEARCH_MAX}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') update({ q: searchInput.trim(), page: '0' })
                }}
                placeholder="Search events"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="events-visibility">Visibility</Label>
            <Select
              id="events-visibility"
              value={visibility}
              onChange={(e) => update({ visibility: e.target.value, page: '0' })}
            >
              <option value="all">All visibility</option>
              {VISIBILITIES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="events-status">Status</Label>
            <Select id="events-status" value={status} onChange={(e) => update({ status: e.target.value, page: '0' })}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="events-org">Organization</Label>
            <Select id="events-org" value={organizationId} onChange={(e) => update({ org: e.target.value, page: '0' })}>
              <option value="">All organizations</option>
              {selectedOrgMissing && (
                <option value={organizationId}>{selectedOrgName || 'Selected organization'}</option>
              )}
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            {orgOptionsTotal > orgOptions.length && (
              <p className="mt-1 text-xs text-gray-500">
                Showing the first {orgOptions.length} of {orgOptionsTotal} organizations. Open an organization to see
                all of its events.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="events-from">Starts on or after</Label>
            <Input
              id="events-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => update({ from: e.target.value, page: '0' })}
            />
          </div>
          <div>
            <Label htmlFor="events-to">Starts on or before</Label>
            <Input
              id="events-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => update({ to: e.target.value, page: '0' })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => update({ archived: e.target.checked ? '1' : '0', page: '0' })}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
              />
              Include archived events
            </label>
            <div className="flex items-center gap-2">
              <Label htmlFor="events-sort" className="mb-0">
                Sort
              </Label>
              <Select
                id="events-sort"
                value={sort}
                onChange={(e) => update({ sort: e.target.value, page: '0' })}
                className="w-auto"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        {rangeInvalid ? (
          <EmptyState
            icon={<CalendarRange className="h-8 w-8" />}
            title="That date range is reversed"
            description="The start of the range is after its end. Adjust one of the dates."
          />
        ) : loading && rows.length === 0 ? (
          <LoadingState message="Loading events…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarRange className="h-8 w-8" />}
            title={filtered ? 'No events match these filters' : 'No events yet'}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full divide-y divide-gray-200 text-left">
                <caption className="sr-only">Events, page {page + 1}</caption>
                <thead className="bg-gray-50">
                  <tr>
                    {['Event', 'Organization', 'When', 'Visibility', 'Status', 'Registrations', 'Created', ''].map((h, i) => (
                      <th
                        key={h || i}
                        scope="col"
                        className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
                      >
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row) => {
                    const time = formatEventTimes(row.start_time, row.end_time, row.timezone)
                    return (
                      <tr key={row.id} className="align-top hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{row.name}</p>
                          {row.location && <p className="text-xs text-gray-500">{row.location}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <OrganizationCell row={row} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                          {formatEventDates(row.start_date, row.end_date)}
                          {time && <span className="block text-xs text-gray-500">{time}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <EventVisibilityBadge visibility={row.visibility} />
                            {row.archived_at && <ArchivedBadge />}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <EventStatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <Registrations row={row} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDateTime(row.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/admin/events/${row.id}`}
                            state={detailState}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                            aria-label={`View ${row.name}`}
                          >
                            View <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-gray-100 lg:hidden">
              {rows.map((row) => {
                const time = formatEventTimes(row.start_time, row.end_time, row.timezone)
                return (
                  <li key={row.id}>
                    <Link
                      to={`/admin/events/${row.id}`}
                      state={detailState}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="truncate text-sm font-medium text-gray-900">{row.name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {row.organization_name || 'No organization'} · {formatEventDates(row.start_date, row.end_date)}
                          {time ? ` · ${time}` : ''}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <EventVisibilityBadge visibility={row.visibility} />
                          <EventStatusBadge status={row.status} />
                          {row.archived_at && <ArchivedBadge />}
                          <span className="text-xs text-gray-500">
                            <Registrations row={row} /> registered
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        {total > 0 && !error && !rangeInvalid && (
          <AdminPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            label="Event pages"
            onPageChange={(next) => update({ page: String(next) })}
          />
        )}
      </Card>
      <p className="mt-3 text-xs text-gray-500">
        Registrations count active sign-ups (not cancelled or waitlisted), shown against capacity where one is set.
        Dates filter on the event&apos;s start date.
      </p>
    </div>
  )
}
