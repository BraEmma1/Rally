import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, ExternalLink, Mail } from 'lucide-react'
import { useFollowOrganization, useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { ArchivedNotice, PartnerLogo, PartnerStatusBadge, safeWebUrl } from '@/components/organizer/PartnerCommon'
import { PartnerDetailsDialog } from '@/components/organizer/PartnerDetailsDialog'
import { LIFECYCLE_BADGE, LIFECYCLE_LABELS } from '@/lib/events'
import {
  getOrganizationPartner,
  listPartnerEventLinks,
  setOrganizationPartnerArchived,
} from '@/lib/partners'
import {
  buildDirectoryRows,
  canEditPartners,
  deliveredLabel,
  type DirectoryPartner,
  type PartnerEventLink,
} from '@/lib/partnerDirectory'
import { displayUrl } from '@/lib/utils'

// One partner: who they are, and their history with the organization -- every
// event they were part of that the viewer manages, each opening that event's
// partnership with its deliverables and how each was delivered.
//
// Editing and archiving are for owners and admins, because an edit reaches every
// event the partner is on. The page follows the partner's organization, the way
// an event page follows its event's.

export default function OrganizationPartnerPage() {
  const { partnerId } = useParams<{ partnerId: string }>()
  const { organization, role } = useOrganizer()
  const [partner, setPartner] = useState<DirectoryPartner | null>(null)
  const [links, setLinks] = useState<PartnerEventLink[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  useFollowOrganization(partner?.organization_id)

  const load = useCallback(async () => {
    if (!partnerId) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    const result = await getOrganizationPartner(partnerId)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    // Not there, or not readable by this person: the same answer either way.
    if (!result.data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setPartner(result.data)
    const history = await listPartnerEventLinks(result.data.organization_id, result.data.id)
    setLinks(history.data)
    setError(history.error)
    setLoading(false)
  }, [partnerId])

  useEffect(() => {
    void load()
  }, [load])

  const events = useMemo(
    () => (partner ? buildDirectoryRows([partner], links, { query: '', showArchived: true })[0]?.events ?? [] : []),
    [partner, links]
  )

  // The role is the selected organization's. Until the page has followed the
  // partner's organization it says nothing about this partner.
  const inPartnerOrg = partner !== null && organization?.id === partner.organization_id
  const canEdit = inPartnerOrg && canEditPartners(role)
  const isManager = inPartnerOrg && role === 'manager'

  async function setArchived(archived: boolean) {
    if (!partner || busy) return
    setBusy(true)
    setActionError(null)
    const { error: archiveError } = await setOrganizationPartnerArchived(partner.id, archived)
    setBusy(false)
    if (archiveError) {
      setActionError(archiveError)
      return
    }
    setPartner({ ...partner, archived_at: archived ? new Date().toISOString() : null })
  }

  const back = (
    <Link
      to="/organizer/partners"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to Partners
    </Link>
  )

  if (loading && !partner) return <LoadingState message="Loading partner…" />
  if (notFound) {
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-600">
          This partner could not be found.
        </p>
      </div>
    )
  }
  if (!partner) return <ErrorState message={error ?? 'Unable to load this partner.'} onRetry={() => void load()} />

  const website = partner.website ? safeWebUrl(partner.website) : null
  const archivedEventCount = links.filter((l) => l.event_archived).length

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {back}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <PartnerLogo name={partner.company_name} logoUrl={partner.logo_url} size="xl" />
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-gray-900">{partner.company_name}</h1>
            <p data-testid="partner-identity" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
              {partner.industry && <span>{partner.industry}</span>}
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-primary-700 hover:text-primary-800"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{displayUrl(partner.website!)}</span>
                </a>
              )}
              {partner.contact_email && (
                <a
                  href={'mailto:' + partner.contact_email}
                  className="inline-flex min-w-0 items-center gap-1 text-primary-700 hover:text-primary-800"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{partner.contact_email}</span>
                </a>
              )}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
            {partner.archived_at ? (
              <Button type="button" variant="secondary" onClick={() => void setArchived(false)} disabled={busy}>
                Restore
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => void setArchived(true)} disabled={busy}>
                Archive
              </Button>
            )}
          </div>
        )}
      </div>

      {partner.archived_at && (
        <ArchivedNotice>This partner is archived. It is not offered when adding partners to events.</ArchivedNotice>
      )}
      {actionError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </div>
      )}
      {partner.description && (
        <p className="whitespace-pre-wrap text-sm text-gray-700">{partner.description}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Events with {partner.company_name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isManager && <p className="text-sm text-gray-500">Only events you manage are listed.</p>}
          {error && <p className="text-sm text-error-700" role="alert">{error}</p>}
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">{isManager ? 'No events you manage' : 'No events yet'}</p>
          ) : (
            <ul aria-label={'Events with ' + partner.company_name} className="-mx-2 divide-y divide-gray-100">
              {events.map((e) => (
                <li key={e.partnership_id}>
                  <Link
                    to={'/organizer/events/' + e.event_id + '/partners/' + e.partnership_id}
                    className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{e.event_name}</span>
                        <Badge variant={LIFECYCLE_BADGE[e.event_lifecycle]}>{LIFECYCLE_LABELS[e.event_lifecycle]}</Badge>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                        {e.tier_label && <span>{e.tier_label}</span>}
                        <PartnerStatusBadge status={e.status} />
                        <span>{deliveredLabel(e.owed_completed, e.owed_total) ?? 'No deliverables'}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing && (
        <PartnerDetailsDialog
          mode="edit"
          organizationId={partner.organization_id}
          partner={partner}
          archivedEventCount={archivedEventCount}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false)
            setPartner(saved)
          }}
        />
      )}
    </div>
  )
}
