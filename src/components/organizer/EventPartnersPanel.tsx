import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Handshake, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  PARTNERSHIP_ROLES,
  PARTNERSHIP_STATUSES,
  ROLE_LABELS,
  STATUS_LABELS,
  listEventPartnerships,
  type PartnershipRole,
  type PartnershipStatus,
  type PartnershipSummary,
} from '@/lib/partnerships'
import { AddPartnerDialog } from './AddPartnerDialog'
import {
  ArchivedNotice,
  PartnerLogo,
  PartnerStatusBadge,
  ProgressMeter,
  formatMoney,
  rolesLabel,
} from './PartnerCommon'

// ---------------------------------------------------------------------------
// The organizer's Partners workspace: sponsors, exhibitors, media and
// supporting partners, with what each side owes the other.
//
// This is NOT the attendee Exhibitors directory. `event_exhibitors` is public
// and inherits event visibility; everything here is private operational
// information -- representative email, internal notes, commercial value,
// obligations, evidence -- behind can_manage_event. Nothing on this screen is
// reachable from Event Mode, and no component here is shared with it.
//
// One RPC backs the list. get_event_partnership_summary already aggregates
// roles and counts obligations per direction for every partnership, so the
// list is one round trip no matter how many partners an event has.
// ---------------------------------------------------------------------------

type EventLike = {
  id: string
  name: string
  archived_at: string | null
}

type StatusFilter = 'all' | PartnershipStatus
type RoleFilter = 'all' | PartnershipRole

export function EventPartnersPanel({ event, manages }: { event: EventLike; manages: boolean }) {
  const [partners, setPartners] = useState<PartnershipSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [role, setRole] = useState<RoleFilter>('all')

  const archived = event.archived_at !== null
  const editable = manages && !archived

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await listEventPartnerships(event.id)
    if (loadError) {
      setError(loadError)
      setPartners(null)
    } else {
      setPartners(data)
    }
    setLoading(false)
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  const needle = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!partners) return []
    return partners.filter((p) => {
      if (status !== 'all' && p.status !== status) return false
      if (role !== 'all' && !p.roles.includes(role)) return false
      if (!needle) return true
      return (
        p.company_name.toLowerCase().includes(needle) ||
        (p.industry ?? '').toLowerCase().includes(needle) ||
        (p.tier_label ?? '').toLowerCase().includes(needle)
      )
    })
  }, [partners, needle, status, role])

  const filtering = needle !== '' || status !== 'all' || role !== 'all'

  function clearFilters() {
    setSearch('')
    setStatus('all')
    setRole('all')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Partners</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage sponsors, exhibitors and other event partners.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            Add Partner
          </Button>
        )}
      </div>

      {archived && <ArchivedNotice />}

      {notice && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
          role="alert"
        >
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-xs font-medium text-warning-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && <PartnersSkeleton />}

      {!loading && !error && partners !== null && partners.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Handshake className="h-10 w-10" />}
              title="No partners yet"
              description="Add sponsors, exhibitors and other partners, then track what each side has agreed to deliver."
              action={editable ? <Button onClick={() => setAddOpen(true)}>Add Partner</Button> : undefined}
            />
          </CardContent>
        </Card>
      )}

      {!loading && !error && partners !== null && partners.length > 0 && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:max-w-xs sm:flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, industry or tier…"
                aria-label="Search partners"
                className="pl-9"
              />
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              aria-label="Filter by status"
              className="sm:w-40"
            >
              <option value="all">All statuses</option>
              {PARTNERSHIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleFilter)}
              aria-label="Filter by role"
              className="sm:w-48"
            >
              <option value="all">All roles</option>
              {PARTNERSHIP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>

          {visible.length === 0 ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-600">No partners match these filters.</p>
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <PartnersList eventId={event.id} partners={visible} />
          )}

          {filtering && visible.length > 0 && (
            <p className="text-xs text-gray-500">
              Showing {visible.length} of {partners.length}{' '}
              {partners.length === 1 ? 'partner' : 'partners'}.
            </p>
          )}
        </>
      )}

      {addOpen && (
        <AddPartnerDialog
          event={event}
          onClose={() => setAddOpen(false)}
          onSaved={async (warning) => {
            setAddOpen(false)
            setNotice(warning)
            await load()
          }}
        />
      )}
    </div>
  )
}

/**
 * A management list, not a wall of cards: on desktop the rows line up into
 * columns under one header so a value or a progress count can be read straight
 * down. Below `md` the same row restacks -- a table squeezed onto a phone is
 * unreadable, and a horizontal scroller hides the numbers that matter most.
 */
function PartnersList({
  eventId,
  partners,
}: {
  eventId: string
  partners: PartnershipSummary[]
}) {
  // Below `md` the row is a stacked card and the blocks are ordered by what
  // matters on a phone -- company, tier and roles, status, then the numbers.
  // At `md` every `order-*` is reset and the same markup lines up into columns.
  const columns =
    'flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_10.5rem_minmax(0,1fr)_8.5rem] lg:items-center lg:gap-4'

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div
        className={
          columns + ' hidden border-b border-gray-200 bg-gray-50 px-4 py-2'
        }
        aria-hidden="true"
      >
        <HeaderCell>Partner</HeaderCell>
        <HeaderCell>Tier &amp; roles</HeaderCell>
        <HeaderCell>Progress</HeaderCell>
        <HeaderCell>Value</HeaderCell>
        <HeaderCell>Status</HeaderCell>
      </div>

      <ul className="divide-y divide-gray-100">
        {partners.map((partner) => {
          const money = formatMoney(partner.value_amount, partner.value_currency)
          const roles = rolesLabel(partner.roles)
          return (
            <li key={partner.id}>
              <Link
                to={'/organizer/events/' + eventId + '/partners/' + partner.id}
                className={
                  columns +
                  ' block px-4 py-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-primary-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600'
                }
              >
                {/* Company */}
                <div className="order-1 flex min-w-0 items-center gap-3 lg:order-none">
                  <PartnerLogo name={partner.company_name} logoUrl={partner.logo_url} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {partner.company_name}
                    </p>
                    {partner.industry && (
                      <p className="truncate text-xs text-gray-500">{partner.industry}</p>
                    )}
                  </div>
                </div>

                {/* Tier and roles */}
                <div className="order-2 min-w-0 lg:order-none">
                  {partner.tier_label ? (
                    <p className="truncate text-sm text-gray-900">{partner.tier_label}</p>
                  ) : (
                    <p className="text-sm text-gray-400">No tier</p>
                  )}
                  {roles && <p className="truncate text-xs text-gray-500">{roles}</p>}
                </div>

                {/* Progress */}
                <div className="order-4 space-y-1.5 lg:order-none">
                  <ProgressMeter
                    label="Deliverables"
                    completed={partner.owed_completed}
                    total={partner.owed_total}
                  />
                  <ProgressMeter
                    label="Requirements"
                    completed={partner.required_completed}
                    total={partner.required_total}
                  />
                </div>

                {/* Value */}
                <div className="order-5 lg:order-none">
                  {money ? (
                    <p className="truncate text-sm font-medium tabular-nums text-gray-900">
                      {money}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400">—</p>
                  )}
                </div>

                {/* Status, with the affordance that this row opens something */}
                <div className="order-3 flex items-center justify-between gap-2 lg:order-none">
                  <PartnerStatusBadge status={partner.status} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{children}</span>
  )
}

function PartnersSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-md bg-gray-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="hidden w-24 animate-pulse self-center rounded bg-gray-100 py-2 md:block" />
        </div>
      ))}
    </div>
  )
}
