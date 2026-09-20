import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarRange,
  Clock,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Radio,
  Send,
  Users,
} from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { canManageTeam } from '@/lib/organizer'
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
import { EventActivityPanel } from '@/components/organizer/EventActivityPanel'

type Tab =
  | 'overview'
  | 'registrations'
  | 'checkin'
  | 'attendees'
  | 'networking'
  | 'invitations'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'registrations', label: 'Registrations' },
  { key: 'checkin', label: 'Check-in' },
  { key: 'attendees', label: 'Attendees' },
  { key: 'networking', label: 'Networking' },
  { key: 'invitations', label: 'Invitations' },
]

function formatDateTime(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role, loading: orgLoading } = useOrganizer()

  const [event, setEvent] = useState<OrganizerEvent | null>(null)
  const [attendees, setAttendees] = useState<EventAttendee[]>([])
  const [invitations, setInvitations] = useState<EventInvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')

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

    const [attendeeResult, invitationResult] = await Promise.all([
      listEventAttendees(id),
      listEventInvitations(id),
    ])
    setAttendees(attendeeResult.data)
    setInvitations(invitationResult.data)
    setError(attendeeResult.error ?? invitationResult.error)
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

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/organizer/events"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          All events
        </Link>
      </div>

      {event.image_url && (
        <img src={event.image_url} alt="" className="h-40 w-full rounded-lg object-cover md:h-56" />
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
            <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
            {event.visibility === 'unlisted' && <Badge variant="gray">Unlisted</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="h-4 w-4" />
              {formatEventDate(event)}
            </span>
            {formatEventTime(event) && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {formatEventTime(event)}
              </span>
            )}
            {event.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
          </div>
        </div>

        {manages && !archived && (
          <Link to={`/organizer/events/${event.id}/edit`} className="shrink-0">
            <Button variant="secondary">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {archived && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-warning-700">
              This event is archived. Nothing has been deleted — its registrations and history are
              intact, and restoring it makes it editable again.
            </p>
            {manages && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(() => setEventArchived(event.id, false))}>
                <ArchiveRestore className="h-4 w-4" />
                Restore
              </Button>
            )}
          </CardContent>
        </Card>
      )}

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
          <EventActivityPanel eventId={event.id} />

          {event.description && (
            <Card>
              <CardHeader>
                <CardTitle>About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{event.description}</p>
              </CardContent>
            </Card>
          )}

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
                        <Globe className="h-4 w-4" />
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
                      <Radio className="h-4 w-4" />
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
                    <Archive className="h-4 w-4" />
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
            <Users className="h-4 w-4 text-gray-400" />
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
        <EventNetworkingPanel eventId={event.id} eventName={event.name} />
      )}

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
                    <Send className="h-4 w-4" />
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
              <Mail className="h-4 w-4 text-gray-400" />
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
