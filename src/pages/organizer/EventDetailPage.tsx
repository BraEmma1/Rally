import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Globe,
  Link2,
  Mail,
  MapPin,
  Mic,
  Pencil,
  QrCode,
  Radio,
  Send,
  Type,
  Users,
} from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { canManageTeam } from '@/lib/organizer'
import { fetchActivityCounts, type ActivityCounts } from '@/lib/checkin'
import {
  LIFECYCLE_BADGE,
  LIFECYCLE_LABELS,
  eventLifecycle,
  formatEventDate,
  formatEventTime,
  getEvent,
  inviteEventAttendee,
  listEventAttendees,
  listEventInvitations,
  publishEvent,
  setEventArchived,
  setEventTimeStatus,
} from '@/lib/events'
import { cn } from '@/lib/utils'
import type { EventAttendee, EventInvitationRow, OrganizerEvent } from '@/lib/supabase'
import { CheckInPanel } from '@/components/organizer/CheckInPanel'
import { AttendeesPanel } from '@/components/organizer/AttendeesPanel'
import { EventNetworkingPanel } from '@/components/organizer/EventNetworkingPanel'
import { EventNetworkingAnalytics } from '@/components/organizer/EventNetworkingAnalytics'
import { EventAgendaPanel } from '@/components/organizer/EventAgendaPanel'
import { EventSpeakersPanel } from '@/components/organizer/EventSpeakersPanel'
import { EventPartnersPanel } from '@/components/organizer/EventPartnersPanel'

type Tab =
  | 'overview'
  | 'registrations'
  | 'checkin'
  | 'attendees'
  | 'networking'
  | 'agenda'
  | 'speakers'
  | 'partners'
  | 'invitations'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'registrations', label: 'Registrations' },
  { key: 'checkin', label: 'Check-in' },
  { key: 'attendees', label: 'Attendees' },
  { key: 'networking', label: 'Networking' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'speakers', label: 'Speakers' },
  // Private operational relationships. The attendee-facing Exhibitors
  // directory is a different thing on a different table and is untouched.
  { key: 'partners', label: 'Partners' },
  { key: 'invitations', label: 'Invitations' },
]

const TAB_KEYS = new Set<string>(TABS.map((t) => t.key))

/**
 * `?tab=partners` picks the tab this page opens on, and nothing else: clicking
 * a tab still does not touch the URL. It exists so Partner Detail can link
 * back to the list it came from instead of dropping the organizer on Overview.
 */
function initialTab(raw: string | null): Tab {
  return raw && TAB_KEYS.has(raw) ? (raw as Tab) : 'overview'
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Check-in becomes an operational action once the event is visible to
// attendees; a draft has nobody to check in and an archived event is read-only.
function checkInAvailable(lifecycle: ReturnType<typeof eventLifecycle>, archived: boolean): boolean {
  return !archived && (lifecycle === 'published' || lifecycle === 'live' || lifecycle === 'completed')
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  progress,
  loading,
}: {
  icon: ReactNode
  label: string
  value: number
  hint: string
  progress?: number | null
  loading: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          {icon}
        </div>
        <div className="min-w-0">
          {loading ? (
            <div className="h-7 w-10 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="text-2xl font-bold leading-7 tabular-nums text-gray-900">{value.toLocaleString()}</p>
          )}
          <p className="mt-0.5 text-sm font-medium text-gray-700">{label}</p>
          <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>
        </div>
      </div>
      {progress !== null && progress !== undefined && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-success-500 transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
          />
        </div>
      )}
    </div>
  )
}

function QuickAction({
  icon,
  label,
  compact,
  onClick,
}: {
  icon: ReactNode
  label: string
  compact: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white font-medium text-gray-700 transition-colors hover:border-primary-300 hover:bg-primary-50/50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-600',
        compact ? 'flex-col gap-1.5 px-2 py-3 text-xs' : 'flex-col gap-2 px-3 py-4 text-sm'
      )}
    >
      <span className={cn('flex items-center justify-center rounded-lg bg-primary-50 text-primary-600', compact ? 'h-9 w-9' : 'h-10 w-10')}>
        {icon}
      </span>
      {label}
    </button>
  )
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <div className="mt-0.5 text-sm text-gray-900">{children}</div>
      </div>
    </div>
  )
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { role, loading: orgLoading } = useOrganizer()

  const [event, setEvent] = useState<OrganizerEvent | null>(null)
  const [attendees, setAttendees] = useState<EventAttendee[]>([])
  const [invitations, setInvitations] = useState<EventInvitationRow[]>([])
  const [counts, setCounts] = useState<ActivityCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>(() => initialTab(searchParams.get('tab')))

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const manages = canManageTeam(role)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const { data, error: loadError } = await getEvent(id)
    if (loadError || !data) {
      setError(loadError ?? 'That event could not be found.')
      setLoading(false)
      return
    }
    setEvent(data)

    const [attendeeResult, invitationResult, countsResult] = await Promise.all([
      listEventAttendees(id),
      listEventInvitations(id),
      fetchActivityCounts(id),
    ])
    setAttendees(attendeeResult.data)
    setInvitations(invitationResult.data)
    // A counts failure must not take the page down — the metrics section shows
    // the problem while everything else keeps working.
    setError(attendeeResult.error ?? invitationResult.error)
    if (countsResult.error) setError(countsResult.error)
    setCounts(countsResult.data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (orgLoading || loading) return <LoadingState message="Loading event…" />
  if (error && !event) return <ErrorState message={error} onRetry={() => void load()} />
  if (!event) return null

  const lifecycle = eventLifecycle(event)
  const archived = event.archived_at !== null
  const pendingInvites = invitations.filter((i) => i.status === 'Pending')
  const acceptedInvites = invitations.filter((i) => i.status === 'Accepted')
  const declinedInvites = invitations.filter((i) => i.status === 'Declined')
  const canCheckIn = checkInAvailable(lifecycle, archived)
  const countsLoading = counts === null && !error

  const checkedInPercent =
    counts && counts.registrations > 0 ? counts.checked_in / counts.registrations : null

  async function act(fn: () => Promise<{ error: string | null }>) {
    setBusy(true)
    setError(null)
    const { error: actionError } = await fn()
    if (actionError) setError(actionError)
    await load()
    setBusy(false)
  }

  async function handleInvite(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (!id) return
    setInviting(true)
    setInviteError(null)
    setInviteSuccess(null)

    const { error: sendError } = await inviteEventAttendee(id, inviteEmail.trim())
    if (sendError) {
      setInviteError(sendError)
      setInviting(false)
      return
    }
    setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}.`)
    setInviteEmail('')
    setInviting(false)
    await load()
  }

  const metrics = [
    {
      key: 'registrations',
      icon: <Users className="h-5 w-5" aria-hidden="true" />,
      label: 'Registrations',
      value: counts?.registrations ?? 0,
      hint: 'For this event',
      progress: null,
    },
    {
      key: 'checkedin',
      icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
      label: 'Checked in',
      value: counts?.checked_in ?? 0,
      hint:
        counts && counts.registrations > 0
          ? `${Math.round((counts.checked_in / counts.registrations) * 100)}% of registrations`
          : 'At this event',
      progress: checkedInPercent,
    },
    {
      key: 'connections',
      icon: <Link2 className="h-5 w-5" aria-hidden="true" />,
      label: 'Connections',
      value: counts?.connections_made ?? 0,
      hint: 'Made at this event',
      progress: null,
    },
    {
      key: 'invitations',
      icon: <Mail className="h-5 w-5" aria-hidden="true" />,
      label: 'Invitations',
      value: counts?.invitations_pending ?? 0,
      hint: counts ? `${counts.invitations_accepted} accepted` : 'Pending response',
      progress: null,
    },
  ]

  const quickActions = [
    { key: 'registrations', icon: <ClipboardList className="h-5 w-5" aria-hidden="true" />, label: 'Registrations' },
    { key: 'checkin', icon: <QrCode className="h-5 w-5" aria-hidden="true" />, label: 'Check-in' },
    { key: 'agenda', icon: <CalendarRange className="h-5 w-5" aria-hidden="true" />, label: 'Agenda' },
    { key: 'speakers', icon: <Mic className="h-5 w-5" aria-hidden="true" />, label: 'Speakers' },
  ] satisfies { key: Tab; label: string; icon: ReactNode }[]

  const eventPageTo = `/events/${event.id}`

  return (
    <div className="space-y-6">
      {/* Back link + desktop actions. On mobile the actions move below the
          event identity, matching the reference order. */}
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/organizer/events"
          className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back to events
        </Link>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <Link to={eventPageTo}>
            <Button variant="secondary">View event page</Button>
          </Link>
          {manages && !archived && (
            <Link to={`/organizer/events/${event.id}/edit`}>
              <Button>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit event
              </Button>
            </Link>
          )}
        </div>
      </div>

      {archived && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-warning-700">
              This event is archived. Nothing has been deleted — its registrations and history are
              intact, and restoring it makes it editable again.
            </p>
            {manages && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(() => setEventArchived(event.id, false))}>
                <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                Restore
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Event identity — image beside the details on desktop, stacked on
          mobile. This is the single place the event is described. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt=""
            className="h-44 w-full shrink-0 rounded-lg object-cover sm:h-44 sm:w-64"
          />
        ) : (
          <div className="flex h-44 w-full shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-400 sm:w-64">
            <CalendarRange className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{event.name}</h1>
          {event.visibility === 'unlisted' && (
            <p className="mt-1 text-xs text-gray-400">Unlisted — only people with the link can see it.</p>
          )}
          <div className="mt-2 flex flex-col gap-1.5 text-sm text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="h-4 w-4 shrink-0" aria-hidden="true" />
              {formatEventDate(event)}
            </span>
            {formatEventTime(event) && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {formatEventTime(event)}
              </span>
            )}
            {event.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
            <Link
              to={eventPageTo}
              className="inline-flex min-w-0 items-center gap-1.5 text-primary-600 hover:text-primary-700"
            >
              <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Event page</span>
            </Link>
          </div>
          {event.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
              {event.description}
            </p>
          )}

          {/* Mobile actions: lifecycle-appropriate primary action, then the
              secondary actions as a full-width pair. */}
          <div className="mt-4 space-y-2 sm:hidden">
            {canCheckIn && (
              <Button className="w-full" onClick={() => setTab('checkin')}>
                <QrCode className="h-4 w-4" aria-hidden="true" />
                Open check-in
              </Button>
            )}
            <div className="flex gap-2">
              <Link to={eventPageTo} className="flex-1">
                <Button variant="secondary" className="w-full">
                  View event page
                </Button>
              </Link>
              {manages && !archived && (
                <Link to={`/organizer/events/${event.id}/edit`} className="flex-1">
                  <Button variant="secondary" className="w-full">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit event
                  </Button>
                </Link>
              )}
            </div>
            {!canCheckIn && manages && !archived && lifecycle === 'draft' && (
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => void act(() => publishEvent(event.id, 'published'))}
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
                Publish publicly
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max gap-1 border-b border-gray-200 md:w-full">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <section aria-label="Event metrics">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {metrics.map((m) => (
                <MetricCard
                  key={m.key}
                  icon={m.icon}
                  label={m.label}
                  value={m.value}
                  hint={m.hint}
                  progress={m.progress}
                  loading={countsLoading}
                />
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>Event details</CardTitle>
                {manages && !archived && (
                  <Link
                    to={`/organizer/events/${event.id}/edit`}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Edit
                  </Link>
                )}
              </CardHeader>
              <CardContent className="divide-y divide-gray-100">
                <DetailRow icon={<Type className="h-4 w-4" aria-hidden="true" />} label="Name">
                  <span className="font-medium">{event.name}</span>
                </DetailRow>
                <DetailRow icon={<Radio className="h-4 w-4" aria-hidden="true" />} label="Status">
                  <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
                </DetailRow>
                <DetailRow icon={<CalendarRange className="h-4 w-4" aria-hidden="true" />} label="Date">
                  {formatEventDate(event)}
                  {formatEventTime(event) ? ` · ${formatEventTime(event)}` : ''}
                </DetailRow>
                <DetailRow icon={<MapPin className="h-4 w-4" aria-hidden="true" />} label="Location">
                  {event.location || '—'}
                </DetailRow>
                <DetailRow icon={<Link2 className="h-4 w-4" aria-hidden="true" />} label="Event page">
                  <Link to={eventPageTo} className="text-primary-600 hover:text-primary-700">
                    View public event page
                  </Link>
                </DetailRow>
                {event.capacity !== null && (
                  <DetailRow icon={<Users className="h-4 w-4" aria-hidden="true" />} label="Capacity">
                    {event.capacity.toLocaleString()}
                  </DetailRow>
                )}
                {event.description && (
                  <DetailRow icon={<FileText className="h-4 w-4" aria-hidden="true" />} label="Description">
                    <p className="whitespace-pre-wrap text-gray-700">{event.description}</p>
                  </DetailRow>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Quick actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
                    {quickActions.map((action) => (
                      <QuickAction
                        key={action.key}
                        icon={action.icon}
                        label={action.label}
                        compact
                        onClick={() => setTab(action.key)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              {pendingInvites.length > 0 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle>Pending invitations</CardTitle>
                    <button
                      type="button"
                      onClick={() => setTab('invitations')}
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      Manage
                    </button>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-500">
                      {pendingInvites.length}{' '}
                      {pendingInvites.length === 1 ? 'invitation is' : 'invitations are'} waiting for a
                      response.
                    </p>
                    <ul className="mt-3 space-y-2">
                      {pendingInvites.slice(0, 3).map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-900">
                              {i.full_name || i.invited_email || 'Invited user'}
                            </p>
                            <p className="truncate text-xs text-gray-500">
                              Sent {formatDateTime(i.created_at)}
                            </p>
                          </div>
                          <Badge variant="warning">Pending</Badge>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {manages && !archived && (
            <Card>
              <CardHeader>
                <CardTitle>Lifecycle</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">
                  {lifecycle === 'draft'
                    ? 'This event is a draft. Only your team can see it.'
                    : lifecycle === 'published'
                      ? 'Published and open for registration.'
                      : lifecycle === 'live'
                        ? 'Marked as running right now.'
                        : 'Marked as finished.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {lifecycle === 'draft' && (
                    <>
                      <Button disabled={busy} onClick={() => void act(() => publishEvent(event.id, 'published'))}>
                        <Globe className="h-4 w-4" aria-hidden="true" />
                        Publish publicly
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void act(() => publishEvent(event.id, 'unlisted'))}
                      >
                        Publish as unlisted
                      </Button>
                    </>
                  )}
                  {lifecycle === 'published' && (
                    <Button disabled={busy} onClick={() => void act(() => setEventTimeStatus(event.id, 'live'))}>
                      <Radio className="h-4 w-4" aria-hidden="true" />
                      Mark as live
                    </Button>
                  )}
                  {lifecycle === 'live' && (
                    <Button disabled={busy} onClick={() => void act(() => setEventTimeStatus(event.id, 'past'))}>
                      Mark as finished
                    </Button>
                  )}
                  {lifecycle === 'completed' && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void act(() => setEventTimeStatus(event.id, 'live'))}
                    >
                      Reopen as live
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act(() => setEventArchived(event.id, true))}
                  >
                    <Archive className="h-4 w-4" aria-hidden="true" />
                    Archive
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Rally does not delete events. Archiving keeps the registrations and the
                  connections people made there.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === 'registrations' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Registrations</CardTitle>
            <Users className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {attendees.length === 0 ? (
              <EmptyState
                icon={<Users className="h-8 w-8" />}
                title="No registrations yet"
                description={
                  lifecycle === 'draft'
                    ? 'Publish this event so attendees can find and register for it.'
                    : 'Registrations appear here as people sign up.'
                }
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {attendees.map((a) => (
                  <li key={a.user_id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {a.full_name || 'Rally member'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Registered {formatDateTime(a.registered_at)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        a.status === 'cancelled' ? 'gray' : a.status === 'checked_in' ? 'success' : 'default'
                      }
                    >
                      {a.status.replace(/_/g, ' ')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'checkin' && <CheckInPanel eventId={event.id} />}

      {tab === 'attendees' && <AttendeesPanel eventId={event.id} />}

      {tab === 'networking' && (
        <div className="space-y-6">
          <EventNetworkingAnalytics eventId={event.id} eventName={event.name} />
          <div>
            <h2 className="text-lg font-bold text-gray-900">Attendee directory</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Connect with people registered for {event.name}.
            </p>
          </div>
          <EventNetworkingPanel eventId={event.id} eventName={event.name} />
        </div>
      )}

      {tab === 'agenda' && <EventAgendaPanel event={event} manages={manages} />}

      {tab === 'speakers' && <EventSpeakersPanel event={event} manages={manages} />}

      {tab === 'partners' && <EventPartnersPanel event={event} manages={manages} />}

      {tab === 'invitations' && (
        <div className="space-y-4">
          {manages && !archived && lifecycle !== 'draft' && (
            <Card>
              <CardHeader>
                <CardTitle>Invite someone</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleInvite} className="space-y-3">
                  <div>
                    <Label htmlFor="invite">Email address</Label>
                    <Input
                      id="invite"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="attendee@example.com"
                      required
                    />
                  </div>
                  {inviteError && (
                    <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">
                      {inviteError}
                    </div>
                  )}
                  {inviteSuccess && (
                    <div className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700">
                      {inviteSuccess}
                    </div>
                  )}
                  <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {inviting ? 'Sending…' : 'Send invitation'}
                  </Button>
                  <p className="text-xs text-gray-500">
                    They need a Rally attendee account already. Rally does not email people who have
                    not signed up.
                  </p>
                </form>
              </CardContent>
            </Card>
          )}

          {lifecycle === 'draft' && (
            <Card>
              <CardContent>
                <p className="text-sm text-gray-600">
                  Publish this event before inviting people to it.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Invitations</CardTitle>
              <Mail className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {invitations.length === 0 ? (
                <EmptyState
                  icon={<Mail className="h-8 w-8" />}
                  title="No invitations sent"
                  description="Invitations you send appear here with their replies."
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <Badge variant="warning">{pendingInvites.length} pending</Badge>
                    <Badge variant="success">{acceptedInvites.length} accepted</Badge>
                    <Badge variant="gray">{declinedInvites.length} declined</Badge>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {invitations.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {i.full_name || i.invited_email || 'Invited user'}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {i.invited_email && `${i.invited_email} · `}
                            Sent {formatDateTime(i.created_at)}
                          </p>
                        </div>
                        <Badge
                          variant={
                            i.status === 'Accepted' ? 'success' : i.status === 'Declined' ? 'gray' : 'warning'
                          }
                        >
                          {i.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
