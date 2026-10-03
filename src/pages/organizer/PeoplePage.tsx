import { useCallback, useEffect, useMemo, useState } from 'react'
import { Handshake, Search, UserCheck, Users } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { listOrganizationPeople } from '@/lib/events'
import { fetchOrganizationEventCounts } from '@/lib/organizer'
import type { OrganizationPerson } from '@/lib/supabase'
import { cn, formatRelativeDate } from '@/lib/utils'

type SortKey = 'name' | 'recent' | 'newest'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'recent', label: 'Last activity' },
  { value: 'newest', label: 'Newest' },
]

function identityLine(p: OrganizationPerson): string {
  return [p.job_title, p.company].filter(Boolean).join(' · ')
}

// Org-level activity totals from the same contract the dashboard uses. No
// per-person fan-out: a person's own connections are never shown to organizers.
function useActivityTotals(orgId: string | null) {
  const [totals, setTotals] = useState<{ checkIns: number; connections: number } | null>(null)

  useEffect(() => {
    setTotals(null)
    if (!orgId) return
    let cancelled = false
    void (async () => {
      const { data, error } = await fetchOrganizationEventCounts(orgId)
      if (cancelled) return
      if (error) return
      let checkIns = 0
      let connections = 0
      for (const c of Object.values(data)) {
        checkIns += c.checked_in
        connections += c.connections_made
      }
      setTotals({ checkIns, connections })
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  return totals
}

function SummaryCard({
  icon,
  iconClass,
  value,
  label,
  hint,
}: {
  icon: React.ReactNode
  iconClass: string
  value: number | null
  label: string
  hint: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconClass)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight text-gray-900">
          {value === null ? '—' : value.toLocaleString()}
        </p>
        <p className="truncate text-sm font-medium text-gray-700">{label}</p>
        <p className="truncate text-xs text-gray-500">{hint}</p>
      </div>
    </div>
  )
}

function RowSkeleton({ mobile }: { mobile?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3', mobile ? 'py-3' : 'py-3.5')} aria-hidden="true">
      <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-gray-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-32 animate-pulse rounded bg-gray-100" />
        <div className="h-3 w-44 max-w-full animate-pulse rounded bg-gray-100" />
      </div>
      {!mobile && <div className="h-3.5 w-24 animate-pulse rounded bg-gray-100" />}
      <div className="h-5 w-16 shrink-0 animate-pulse rounded-full bg-gray-100" />
    </div>
  )
}

export default function PeoplePage() {
  const { organization, loading: orgLoading } = useOrganizer()
  const [people, setPeople] = useState<OrganizationPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')

  const orgId = organization?.id ?? null
  const activity = useActivityTotals(orgId)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: loadError } = await listOrganizationPeople(orgId)
    setPeople(data)
    setError(loadError)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? people.filter(
          (p) =>
            p.full_name.toLowerCase().includes(needle) ||
            p.company.toLowerCase().includes(needle) ||
            p.job_title.toLowerCase().includes(needle)
        )
      : people
    const sorted = [...filtered]
    if (sort === 'name') sorted.sort((a, b) => a.full_name.localeCompare(b.full_name))
    if (sort === 'recent') sorted.sort((a, b) => b.last_seen.localeCompare(a.last_seen))
    if (sort === 'newest') sorted.sort((a, b) => b.first_seen.localeCompare(a.first_seen))
    return sorted
  }, [people, query, sort])

  const hasQuery = query.trim().length > 0

  if (orgLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-7 w-32 animate-pulse rounded bg-gray-100" />
          <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-gray-100" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[86px] animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }
  if (!organization) return null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">People</h1>
        <p className="mt-1 text-sm text-gray-500">
          View and manage everyone who has registered for your events.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-primary-50 text-primary-600"
          value={loading ? null : people.length}
          label="Total people"
          hint="Across your events"
        />
        <SummaryCard
          icon={<UserCheck className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-accent-50 text-accent-600"
          value={activity ? activity.checkIns : null}
          label="Check-ins"
          hint="At your events"
        />
        <SummaryCard
          icon={<Handshake className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-warning-50 text-warning-600"
          value={activity ? activity.connections : null}
          label="Connections"
          hint="Made at your events"
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people by name, company, or role…"
                aria-label="Search people"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 sm:shrink-0">
              <label htmlFor="people-sort" className="hidden text-sm text-gray-500 sm:block">
                Sort by
              </label>
              <Select
                id="people-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="sm:w-44"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {loading ? (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          ) : people.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white">
              <EmptyState
                icon={<Users className="h-8 w-8" />}
                title="No people yet"
                description="People who register for or participate in your events will appear here."
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white">
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title="No people match your search"
                description="Try a different name, company, or role."
                action={
                  <button
                    onClick={() => setQuery('')}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Clear search
                  </button>
                }
              />
            </div>
          ) : (
            <>
              {/* Desktop / tablet: operational table */}
              <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th scope="col" className="px-4 py-2.5 font-medium">Person</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Company</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Events</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Last activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visible.map((p) => (
                      <tr key={p.user_id} className="transition-colors hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={p.full_name || 'Attendee'} src={p.photo_url} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">
                                {p.full_name || 'Rally member'}
                              </p>
                              <p className="truncate text-xs text-gray-500">{identityLine(p) || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block max-w-[16rem] truncate text-gray-700">
                            {p.company || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={p.events_registered > 1 ? 'primary' : 'default'}>
                            {p.events_registered} {p.events_registered === 1 ? 'event' : 'events'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {formatRelativeDate(p.last_seen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: scannable person rows */}
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white px-4 md:hidden">
                {visible.map((p) => (
                  <li key={p.user_id} className="flex items-center gap-3 py-3">
                    <Avatar name={p.full_name || 'Attendee'} src={p.photo_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {p.full_name || 'Rally member'}
                      </p>
                      <p className="truncate text-xs text-gray-500">{identityLine(p) || '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {p.events_registered}{' '}
                        {p.events_registered === 1 ? 'event' : 'events'} · active{' '}
                        {formatRelativeDate(p.last_seen).toLowerCase()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-gray-500">
                {hasQuery && (
                  <span className="mr-2">
                    Showing {visible.length} of {people.length} people.
                  </span>
                )}
                Email addresses and phone numbers are not shown. Attendees decide when to share
                those, and Rally does not reveal them to organizers by default.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
