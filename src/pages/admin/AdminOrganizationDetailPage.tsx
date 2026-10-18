import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, CalendarRange, History, Mail, RefreshCw, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import {
  ArchivedBadge,
  EventStatusBadge,
  EventVisibilityBadge,
  OrgApprovalBadge,
  OrgTypeBadge,
} from '@/components/admin/AdminBadges'
import { ApprovalControlsNotice, OrgLogo } from '@/components/admin/OrganizationParts'
import { formatDateTime } from '@/lib/admin'
import { getOrganization } from '@/lib/adminOrganizations'
import { ORG_ROLE_LABELS, type AdminOrganizationDetail } from '@/lib/supabase'
import { cn, displayUrl, formatDate, normalizeUrl } from '@/lib/utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-gray-900 sm:col-span-2">{children}</dd>
    </div>
  )
}

const none = <span className="text-gray-400">Not provided</span>

function eventDates(start: string | null, end: string | null): string {
  if (!start) return 'No date set'
  if (!end || end === start) return formatDate(start)
  return `${formatDate(start)} – ${formatDate(end)}`
}

export default function AdminOrganizationDetailPage() {
  const { organizationId = '' } = useParams()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const backTo = from?.startsWith('/admin/organizations') ? from : '/admin/organizations'
  const validId = UUID_RE.test(organizationId)

  const [detail, setDetail] = useState<AdminOrganizationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!validId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: loadError } = await getOrganization(organizationId)
    setDetail(data)
    setError(loadError)
    setLoading(false)
  }, [organizationId, validId])

  useEffect(() => {
    void load()
  }, [load])

  const back = (
    <Link
      to={backTo}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to organizations
    </Link>
  )

  if (loading && !detail) {
    return (
      <div>
        {back}
        <LoadingState message="Loading organization…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {back}
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      </div>
    )
  }

  if (!validId || !detail) {
    return (
      <div>
        {back}
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="Organization not found"
            description="There is no organization with this id."
          />
        </Card>
      </div>
    )
  }

  const org = detail.organization
  const website = normalizeUrl(org.website)
  const membersShown = detail.members.length
  const eventsShown = detail.events.length

  return (
    <div>
      {back}

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <OrgLogo name={org.name} src={org.logo_url} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-gray-900">{org.name}</h1>
              {org.slug && <p className="truncate font-mono text-xs text-gray-400">{org.slug}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <OrgTypeBadge type={org.org_type} />
                <OrgApprovalBadge status={org.approval_status} />
                {org.archived_at && <ArchivedBadge />}
              </div>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-gray-100">
                <Field label="Description">
                  {org.description?.trim() ? <span className="whitespace-pre-line">{org.description.trim()}</span> : none}
                </Field>
                <Field label="Website">
                  {website ? (
                    <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700">
                      {displayUrl(website)}
                    </a>
                  ) : (
                    none
                  )}
                </Field>
                <Field label="Created">{formatDateTime(org.created_at)}</Field>
                <Field label="Created by">
                  {org.created_by ? (
                    <Link to={`/admin/users/${org.created_by}`} className="text-primary-600 hover:text-primary-700">
                      {org.created_by_name || 'Unnamed account'}
                    </Link>
                  ) : (
                    <span className="text-gray-400">Unknown</span>
                  )}
                </Field>
                <Field label="Last updated">{formatDateTime(org.updated_at)}</Field>
                {org.archived_at && <Field label="Archived">{formatDateTime(org.archived_at)}</Field>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Members</CardTitle>
              <span className="text-sm text-gray-500">{detail.member_count}</span>
            </CardHeader>
            <CardContent>
              {membersShown === 0 ? (
                <EmptyState icon={<Users className="h-8 w-8" />} title="No members" />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {detail.members.map((m) => (
                    <li key={m.user_id}>
                      <Link
                        to={`/admin/users/${m.user_id}`}
                        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                      >
                        <Avatar name={m.full_name || '?'} src={m.photo_url} size="sm" className="shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{m.full_name || 'Unnamed account'}</p>
                          <p className="text-xs text-gray-500">Joined {formatDateTime(m.joined_at)}</p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-gray-600">{ORG_ROLE_LABELS[m.role] ?? m.role}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {detail.member_count > membersShown && (
                <p className="mt-2 text-xs text-gray-500">
                  Showing the first {membersShown} of {detail.member_count} members.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Events</CardTitle>
              <span className="text-sm text-gray-500">{detail.event_count}</span>
            </CardHeader>
            <CardContent>
              {eventsShown === 0 ? (
                <EmptyState icon={<CalendarRange className="h-8 w-8" />} title="No events" />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {detail.events.map((e) => (
                    <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{e.name}</p>
                        <p className="text-xs text-gray-500">{eventDates(e.start_date, e.end_date)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EventVisibilityBadge visibility={e.visibility} />
                        <EventStatusBadge status={e.status} />
                        {e.archived_at && <ArchivedBadge />}
                        <span className="text-xs text-gray-500">
                          {e.active_registrations} {e.active_registrations === 1 ? 'registration' : 'registrations'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {detail.event_count > eventsShown && (
                <p className="mt-2 text-xs text-gray-500">
                  Showing the {eventsShown} latest of {detail.event_count} events.
                </p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Registrations exclude cancelled and waitlisted. Event pages for administrators arrive with event
                management.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Approval</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="divide-y divide-gray-100">
                <Field label="Status">
                  <OrgApprovalBadge status={org.approval_status} />
                </Field>
                <Field label="Decided">
                  {org.approved_at ? formatDateTime(org.approved_at) : <span className="text-gray-400">No decision recorded</span>}
                </Field>
                {org.approved_at && (
                  <Field label="By">
                    {org.approved_by ? (
                      <Link to={`/admin/users/${org.approved_by}`} className="text-primary-600 hover:text-primary-700">
                        {org.approved_by_name || 'Unnamed account'}
                      </Link>
                    ) : (
                      <span className="text-gray-500">Not recorded</span>
                    )}
                  </Field>
                )}
              </dl>
              <ApprovalControlsNotice />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval history</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <History className="h-6 w-6 text-gray-300" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-900">No approval history recorded</p>
                <p className="text-xs text-gray-500">
                  Rally does not record organization approval decisions yet. A history appears here once the approval
                  backend, with its own audit trail, is in place.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-gray-100">
                <Field label="Pending invitations">
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                    {detail.pending_invitations}
                  </span>
                </Field>
              </dl>
              <p className="mt-2 text-xs text-gray-500">
                Invitee addresses are private and not shown. Partnership details belong to the organizations
                involved and are not available to administrators.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
