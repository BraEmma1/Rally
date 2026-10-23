import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarRange, Lock, RefreshCw } from 'lucide-react'
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
import { formatDateTime } from '@/lib/admin'
import { formatEventDates, formatEventTimes, getEvent } from '@/lib/adminEvents'
import type { AdminEventDetail } from '@/lib/supabase'
import { cn, normalizeUrl } from '@/lib/utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-gray-900 sm:col-span-2">{children}</dd>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

const notSet = <span className="text-gray-400">Not set</span>

// Where the admin came from: the event directory (with its filters) or an
// organization's page. Anything else falls back to the directory.
function backTarget(from: string | undefined): { to: string; label: string } {
  if (from?.startsWith('/admin/organizations/')) return { to: from, label: 'Back to organization' }
  if (from?.startsWith('/admin/events')) return { to: from, label: 'Back to events' }
  return { to: '/admin/events', label: 'Back to events' }
}

export default function AdminEventDetailPage() {
  const { eventId = '' } = useParams()
  const location = useLocation()
  const back = backTarget((location.state as { from?: string } | null)?.from)
  const validId = UUID_RE.test(eventId)

  const [detail, setDetail] = useState<AdminEventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!validId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: loadError } = await getEvent(eventId)
    setDetail(data)
    setError(loadError)
    setLoading(false)
  }, [eventId, validId])

  useEffect(() => {
    void load()
  }, [load])

  const backLink = (
    <Link
      to={back.to}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {back.label}
    </Link>
  )

  if (loading && !detail) {
    return (
      <div>
        {backLink}
        <LoadingState message="Loading event…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {backLink}
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      </div>
    )
  }

  if (!validId || !detail) {
    return (
      <div>
        {backLink}
        <Card>
          <EmptyState
            icon={<CalendarRange className="h-8 w-8" />}
            title="Event not found"
            description="There is no event with this id."
          />
        </Card>
      </div>
    )
  }

  const ev = detail.event
  const reg = detail.registrations
  const image = normalizeUrl(ev.image_url)
  const time = formatEventTimes(ev.start_time, ev.end_time, null)

  return (
    <div>
      {backLink}

      <Card className="mb-6 overflow-hidden">
        {image && <img src={image} alt="" aria-hidden="true" className="h-40 w-full object-cover sm:h-52" />}
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{ev.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {formatEventDates(ev.start_date, ev.end_date)}
              {time ? ` · ${time}` : ''}
              {ev.location ? ` · ${ev.location}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <EventVisibilityBadge visibility={ev.visibility} />
              <EventStatusBadge status={ev.status} />
              {ev.archived_at && <ArchivedBadge />}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="event-registrations" className="mb-6">
        <h2 id="event-registrations" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Registrations
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Active"
            value={reg.active}
            hint={ev.capacity ? `of ${ev.capacity} capacity` : 'No capacity set'}
          />
          <Stat label="Checked in" value={reg.checked_in} />
          <Stat label="Waitlisted" value={reg.waitlisted} />
          <Stat label="Cancelled" value={reg.cancelled} />
          <Stat label="All records" value={reg.total} />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Counts only. Attendee identities and registration contact details are not available to administrators.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Event</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-gray-100">
                <Field label="Description">
                  {ev.description?.trim() ? (
                    <span className="whitespace-pre-line">{ev.description.trim()}</span>
                  ) : (
                    <span className="text-gray-400">Not provided</span>
                  )}
                </Field>
                <Field label="Starts">{ev.start_date ? formatEventDates(ev.start_date, null) : notSet}</Field>
                <Field label="Ends">{ev.end_date ? formatEventDates(ev.end_date, null) : notSet}</Field>
                <Field label="Time">{time ?? notSet}</Field>
                <Field label="Time zone">{ev.timezone || notSet}</Field>
                <Field label="Location">{ev.location || notSet}</Field>
                <Field label="Capacity">{ev.capacity ?? notSet}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Programme</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Team" value={detail.team_size} hint="Assigned managers" />
                <Stat label="Sessions" value={detail.sessions} />
                <Stat label="Speakers" value={detail.speakers} />
                <Stat label="Exhibitors" value={detail.exhibitors} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.organization ? (
                <div className="space-y-2">
                  <Link
                    to={`/admin/organizations/${detail.organization.id}`}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    {detail.organization.name}
                  </Link>
                  <div className="flex flex-wrap gap-1.5">
                    <OrgTypeBadge type={detail.organization.org_type} />
                    <OrgApprovalBadge status={detail.organization.approval_status} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  This event is not owned by an organization. It predates organization-owned events.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Publication</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-gray-100">
                <Field label="Visibility">
                  <EventVisibilityBadge visibility={ev.visibility} />
                </Field>
                <Field label="Published">
                  {ev.published_at ? formatDateTime(ev.published_at) : <span className="text-gray-400">Never</span>}
                </Field>
                <Field label="Archived">
                  {ev.archived_at ? formatDateTime(ev.archived_at) : <span className="text-gray-400">No</span>}
                </Field>
                <Field label="Created">{formatDateTime(ev.created_at)}</Field>
                <Field label="Created by">
                  {ev.created_by ? (
                    <Link to={`/admin/users/${ev.created_by}`} className="text-primary-600 hover:text-primary-700">
                      {ev.created_by_name || 'Unnamed account'}
                    </Link>
                  ) : (
                    <span className="text-gray-400">Unknown</span>
                  )}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <p className="flex gap-2 text-xs text-gray-500">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Read-only. Editing, publishing and archiving belong to the event&apos;s organization.
          </p>
        </div>
      </div>
    </div>
  )
}
