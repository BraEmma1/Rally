import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, MapPin, Clock, Users, ArrowRight, CalendarCheck, MailOpen, Check, X } from 'lucide-react'
import { supabase, type EventRow, type EventRegistration, type EventInvitation } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate } from '@/lib/utils'

function formatTime(time: string | null): string {
  if (!time) return ''
  try {
    const [h, m] = time.split(':').map(Number)
    const date = new Date()
    date.setHours(h, m, 0, 0)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return time
  }
}

function isEventPast(event: EventRow): boolean {
  if (!event.start_date) return false
  const today = new Date(new Date().toDateString())
  const start = new Date(event.start_date)
  return start < today
}

interface InvitationWithEvent extends EventInvitation {
  event?: EventRow
  inviter_name?: string
}

export default function EventsPage() {
  const { user, profile } = useAuth()
  const { refresh: refreshNotifications } = useNotifications()
  const profileName = profile?.full_name || 'Someone'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [registrations, setRegistrations] = useState<Set<string>>(new Set())
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({})
  const [invitations, setInvitations] = useState<InvitationWithEvent[]>([])
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past' | 'invitations'>('upcoming')
  const [responding, setResponding] = useState<string | null>(null)

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [eventsRes, regRes, inviteRes] = await Promise.all([
        supabase.from('events').select('*').order('start_date', { ascending: true }),
        supabase.from('event_registrations').select('event_id').eq('user_id', user.id),
        supabase.from('event_invitations').select('*').eq('invited_user_id', user.id).order('created_at', { ascending: false }),
      ])

      if (eventsRes.error) throw eventsRes.error
      if (regRes.error) throw regRes.error
      if (inviteRes.error) throw inviteRes.error

      const eventList = eventsRes.data as EventRow[]
      setEvents(eventList)
      setRegistrations(new Set((regRes.data as EventRegistration[]).map((r) => r.event_id)))

      // Get registration counts for all events
      const counts: Record<string, number> = {}
      for (const event of eventList) {
        const { count } = await supabase
          .from('event_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', event.id)
        counts[event.id] = count ?? 0
      }
      setRegistrationCounts(counts)

      // Enrich invitations with event + inviter data
      const inviteList = inviteRes.data as EventInvitation[]
      if (inviteList.length > 0) {
        const eventMap = new Map<string, EventRow>()
        for (const e of eventList) eventMap.set(e.id, e)

        const inviterIds = [...new Set(inviteList.map((i) => i.invited_by))]
        const { data: inviterProfiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', inviterIds)
        const inviterMap = new Map<string, string>()
        for (const p of (inviterProfiles as { id: string; full_name: string }[]) || []) {
          inviterMap.set(p.id, p.full_name)
        }

        setInvitations(inviteList.map((inv) => ({
          ...inv,
          event: eventMap.get(inv.event_id),
          inviter_name: inviterMap.get(inv.invited_by),
        })))
      } else {
        setInvitations([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [user])

  async function handleRegister(eventId: string) {
    if (!user) return
    const { error: regError } = await supabase
      .from('event_registrations')
      .insert({ event_id: eventId, user_id: user.id })
    if (regError) {
      setError(regError.message)
      return
    }
    setRegistrations(new Set([...registrations, eventId]))
    setRegistrationCounts({ ...registrationCounts, [eventId]: (registrationCounts[eventId] || 0) + 1 })

    // Notify self: registration confirmation
    const event = events.find((e) => e.id === eventId)
    await supabase.from('notifications').insert({
      user_id: user.id,
      type: 'event_registration',
      title: 'Registration confirmed',
      message: `You are registered for ${event?.name || 'the event'}.`,
      link: `/events/${eventId}`,
    })
    refreshNotifications()
  }

  async function handleUnregister(eventId: string) {
    if (!user) return
    const { error: unregError } = await supabase
      .from('event_registrations')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', user.id)
    if (unregError) {
      setError(unregError.message)
      return
    }
    const newRegs = new Set(registrations)
    newRegs.delete(eventId)
    setRegistrations(newRegs)
    setRegistrationCounts({ ...registrationCounts, [eventId]: Math.max(0, (registrationCounts[eventId] || 0) - 1) })
  }

  async function handleAccept(inv: InvitationWithEvent) {
    if (!user) return
    setResponding(inv.id)
    try {
      // Update invitation status
      const { error: updateError } = await supabase
        .from('event_invitations')
        .update({ status: 'Accepted', responded_at: new Date().toISOString() })
        .eq('id', inv.id)
        .eq('invited_user_id', user.id)
      if (updateError) throw updateError

      // Notify the inviter that their invitation was accepted
      await supabase.from('notifications').insert({
        user_id: inv.invited_by,
        type: 'invitation_accepted',
        title: 'Invitation accepted',
        message: `${profileName} accepted your invitation to ${inv.event?.name || 'your event'}.`,
        link: `/events/${inv.event_id}`,
      })
      refreshNotifications()

      // Register for event (prevent duplicate)
      if (!registrations.has(inv.event_id)) {
        const { error: regError } = await supabase
          .from('event_registrations')
          .insert({ event_id: inv.event_id, user_id: user.id })
        if (regError && !regError.message.includes('duplicate')) throw regError
        setRegistrations(new Set([...registrations, inv.event_id]))
        setRegistrationCounts({ ...registrationCounts, [inv.event_id]: (registrationCounts[inv.event_id] || 0) + 1 })
      }

      setInvitations(invitations.map((i) => i.id === inv.id ? { ...i, status: 'Accepted', responded_at: new Date().toISOString() } : i))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation.')
    } finally {
      setResponding(null)
    }
  }

  async function handleDecline(inv: InvitationWithEvent) {
    if (!user) return
    setResponding(inv.id)
    try {
      const { error: updateError } = await supabase
        .from('event_invitations')
        .update({ status: 'Declined', responded_at: new Date().toISOString() })
        .eq('id', inv.id)
        .eq('invited_user_id', user.id)
      if (updateError) throw updateError

      // Notify the inviter that their invitation was declined
      await supabase.from('notifications').insert({
        user_id: inv.invited_by,
        type: 'invitation_declined',
        title: 'Invitation declined',
        message: `${profileName} declined your invitation to ${inv.event?.name || 'your event'}.`,
        link: `/events/${inv.event_id}`,
      })
      refreshNotifications()
      setInvitations(invitations.map((i) => i.id === inv.id ? { ...i, status: 'Declined', responded_at: new Date().toISOString() } : i))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline invitation.')
    } finally {
      setResponding(null)
    }
  }

  if (loading) return <LoadingState message="Loading events…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const upcomingEvents = events.filter((e) => !isEventPast(e))
  const pastEvents = events.filter((e) => isEventPast(e))
  const displayEvents = activeTab === 'upcoming' ? upcomingEvents : pastEvents
  const myUpcomingCount = upcomingEvents.filter((e) => registrations.has(e.id)).length
  const pendingInvites = invitations.filter((i) => i.status === 'Pending').length

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">Events</h1>
      <p className="mt-1 text-sm text-gray-500">Discover and register for professional networking events</p>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'upcoming'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Calendar className="h-4 w-4" />
          Upcoming
          {myUpcomingCount > 0 && (
            <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700">
              {myUpcomingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'past'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <CalendarCheck className="h-4 w-4" />
          Past
        </button>
        <button
          onClick={() => setActiveTab('invitations')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'invitations'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <MailOpen className="h-4 w-4" />
          Invitations
          {pendingInvites > 0 && (
            <span className="rounded-full bg-error-100 px-1.5 py-0.5 text-xs font-medium text-error-700">
              {pendingInvites}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="mt-4 space-y-4">
        {activeTab === 'invitations' ? (
          invitations.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<MailOpen className="h-10 w-10" />}
                  title="No invitations"
                  description="Event invitations from organizers will appear here."
                />
              </CardContent>
            </Card>
          ) : (
            invitations.map((inv) => {
              const event = inv.event
              if (!event) return null
              const isPending = inv.status === 'Pending'
              const isAccepted = inv.status === 'Accepted'
              const isDeclined = inv.status === 'Declined'
              const isRegistered = registrations.has(event.id)

              return (
                <Card key={inv.id} className="overflow-hidden">
                  <div className="flex flex-col sm:flex-row">
                    {/* Event image */}
                    {event.image_url && (
                      <div className="h-32 flex-shrink-0 sm:h-auto sm:w-40">
                        <img
                          src={event.image_url}
                          alt={event.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}

                    <CardContent className="flex-1 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-gray-900">{event.name}</h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" /> {formatDate(event.start_date)}
                              {event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ''}
                            </span>
                            {event.start_time && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {formatTime(event.start_time)}
                                {event.end_time ? ` – ${formatTime(event.end_time)}` : ''}
                              </span>
                            )}
                          </div>
                          {event.location && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                              <MapPin className="h-3 w-3" /> {event.location}
                            </p>
                          )}
                          {event.description && (
                            <p className="mt-2 line-clamp-2 text-xs text-gray-600">{event.description}</p>
                          )}

                          {/* Organizer */}
                          <div className="mt-2 flex items-center gap-2">
                            {inv.inviter_name && (
                              <div className="flex items-center gap-1.5">
                                <Avatar name={inv.inviter_name} size="xs" />
                                <span className="text-xs text-gray-500">Invited by {inv.inviter_name}</span>
                              </div>
                            )}
                          </div>

                          {/* Status badge */}
                          <div className="mt-2">
                            {isPending && <Badge variant="warning">Pending</Badge>}
                            {isAccepted && <Badge variant="success">Accepted</Badge>}
                            {isDeclined && <Badge variant="error">Declined</Badge>}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-shrink-0 flex-col gap-2 sm:items-end">
                          <Link to={`/events/${event.id}`}>
                            <Button size="sm" variant="secondary" className="w-full sm:w-auto">
                              View <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          {isPending && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleAccept(inv)}
                                disabled={responding === inv.id}
                                className="bg-success-600 text-white hover:bg-success-700"
                              >
                                <Check className="h-3.5 w-3.5" /> Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleDecline(inv)}
                                disabled={responding === inv.id}
                                className="text-error-600 hover:bg-error-50"
                              >
                                <X className="h-3.5 w-3.5" /> Decline
                              </Button>
                            </div>
                          )}
                          {isAccepted && isRegistered && (
                            <Badge variant="success">Registered</Badge>
                          )}
                          {isAccepted && !isRegistered && (
                            <Button size="sm" onClick={() => handleRegister(event.id)}>
                              Register
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </div>
                </Card>
              )
            })
          )
        ) : displayEvents.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Calendar className="h-10 w-10" />}
                title={activeTab === 'upcoming' ? 'No upcoming events' : 'No past events'}
                description={activeTab === 'upcoming' ? 'Check back soon for new networking events.' : 'Events you attend will appear here after they end.'}
              />
            </CardContent>
          </Card>
        ) : (
          displayEvents.map((event) => {
            const isRegistered = registrations.has(event.id)
            const count = registrationCounts[event.id] || 0
            return (
              <Card key={event.id} className="overflow-hidden">
                <div className="flex flex-col sm:flex-row">
                  {/* Event image */}
                  {event.image_url && (
                    <div className="h-32 flex-shrink-0 sm:h-auto sm:w-40">
                      <img
                        src={event.image_url}
                        alt={event.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}

                  <CardContent className="flex-1 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-gray-900">{event.name}</h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" /> {formatDate(event.start_date)}
                            {event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ''}
                          </span>
                          {event.start_time && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {formatTime(event.start_time)}
                              {event.end_time ? ` – ${formatTime(event.end_time)}` : ''}
                            </span>
                          )}
                        </div>
                        {event.location && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                            <MapPin className="h-3 w-3" /> {event.location}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-3">
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Users className="h-3 w-3" /> {count}{event.capacity ? ` / ${event.capacity}` : ''} registered
                          </span>
                          {isRegistered && <Badge variant="success">Registered</Badge>}
                        </div>
                      </div>

                      <div className="flex flex-shrink-0 gap-2">
                        <Link to={`/events/${event.id}`}>
                          <Button size="sm" variant="secondary">
                            View <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        {activeTab === 'upcoming' && (
                          isRegistered ? (
                            <Button size="sm" variant="outline" onClick={() => handleUnregister(event.id)}>
                              Unregister
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => handleRegister(event.id)}>
                              Register
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
