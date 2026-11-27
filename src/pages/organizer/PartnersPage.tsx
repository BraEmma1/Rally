import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Handshake, Plus } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchField } from '@/components/ui/SearchField'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { PartnerLogo } from '@/components/organizer/PartnerCommon'
import { PartnerDetailsDialog } from '@/components/organizer/PartnerDetailsDialog'
import { LIFECYCLE_BADGE, LIFECYCLE_LABELS } from '@/lib/events'
import { listOrganizationPartners, listPartnerEventLinks } from '@/lib/partners'
import {
  buildDirectoryRows,
  type DirectoryPartner,
  type DirectoryRow,
  type PartnerEventLink,
} from '@/lib/partnerDirectory'

// The organization's partners: every company it has worked with, each with the
// events it was on. Anyone who can add partners to an event sees the whole list,
// because they choose from it; what each sees of the EVENTS is only what they
// manage (event_partnerships RLS), so a manager's tags are their own events.

function eventsLabel(n: number): string {
  return n === 1 ? '1 event' : n + ' events'
}

export default function PartnersPage() {
  const { organization, role } = useOrganizer()
  const orgId = organization?.id ?? null
  const [partners, setPartners] = useState<DirectoryPartner[] | null>(null)
  const [links, setLinks] = useState<PartnerEventLink[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setError(null)
    setPartners(null)
    const [p, l] = await Promise.all([listOrganizationPartners(orgId), listPartnerEventLinks(orgId)])
    if (p.error || l.error) {
      setError(p.error ?? l.error)
      setPartners([])
      return
    }
    setPartners(p.data)
    setLinks(l.data)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () => (partners ? buildDirectoryRows(partners, links, { query, showArchived }) : []),
    [partners, links, query, showArchived]
  )
  const hasArchived = (partners ?? []).some((p) => p.archived_at !== null)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Partners</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            The companies your organization works with, and the events they were part of.
          </p>
        </div>
        {orgId && (
          <Button type="button" className="shrink-0" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New partner
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : partners === null ? (
        <LoadingState message="Loading partners…" />
      ) : partners.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white">
          <EmptyState
            icon={<Handshake className="h-10 w-10" aria-hidden="true" />}
            title="No partners yet"
            description="Partners you add to events appear here, so you can choose them again for your next event."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField
              className="sm:max-w-sm sm:flex-1"
              value={query}
              onChange={setQuery}
              label="Search partners"
              placeholder="Search by name or industry"
            />
            {hasArchived && (
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
                />
                Show archived
              </label>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
              No partners match your search.
            </p>
          ) : (
            <ul aria-label="Partners" className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {rows.map((row) => (
                <PartnerRow key={row.partner.id} row={row} isManager={role === 'manager'} />
              ))}
            </ul>
          )}
        </>
      )}

      {creating && orgId && (
        <PartnerDetailsDialog
          mode="create"
          organizationId={orgId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function PartnerRow({ row, isManager }: { row: DirectoryRow; isManager: boolean }) {
  const { partner, events } = row
  const eventCount = new Set(events.map((e) => e.event_id)).size
  return (
    <li>
      <Link
        to={'/organizer/partners/' + partner.id}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
      >
        <PartnerLogo name={partner.company_name} logoUrl={partner.logo_url} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span data-testid="partner-name" className="truncate font-medium text-gray-900">
              {partner.company_name}
            </span>
            {partner.archived_at && <Badge variant="gray">Archived</Badge>}
            {partner.industry && <span className="text-sm text-gray-500">{partner.industry}</span>}
          </div>
          {events.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">{isManager ? 'No events you manage' : 'No events yet'}</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {events.map((e) => (
                <span
                  key={e.partnership_id}
                  data-testid="partner-tag"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
                >
                  <span className="truncate">{e.event_name}</span>
                  <Badge variant={LIFECYCLE_BADGE[e.event_lifecycle]} className="px-1.5 py-0 text-[10px]">
                    {LIFECYCLE_LABELS[e.event_lifecycle]}
                  </Badge>
                </span>
              ))}
            </div>
          )}
        </div>
        {events.length > 0 && (
          <span className="shrink-0 whitespace-nowrap text-sm text-gray-500">{eventsLabel(eventCount)}</span>
        )}
      </Link>
    </li>
  )
}
