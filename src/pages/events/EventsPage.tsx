import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, MapPin, Clock, Users, ArrowRight, CalendarCheck } from 'lucide-react'
import { supabase, type EventRow, type EventRegistration } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
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

export default function EventsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [registrations, setRegistrations] = useState<Set<string>>(new Set())
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming')

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [eventsRes, regRes] = await Promise.all([
        supabase.from('events').select('*').order('start_date', { ascending: true }),
        supabase.from('event_registrations').select('event_id').eq('user_id', user.id),
      ])

      if (eventsRes.error) throw eventsRes.error
      if (regRes.error) throw regRes.error

      setEvents(eventsRes.data as EventRow[])
      setRegistrations(new Set((regRes.data as EventRegistration[]).map((r) => r.event_id)))

      // Get registration counts for all events
      const counts: Record<string, number> = {}
      for (const event of eventsRes.data as EventRow[]) {
        const { count } = await supabase
          .from('event_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', event.id)
        counts[event.id] = count ?? 0
      }
      setRegistrationCounts(counts)
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

  if (loading) return <LoadingState message="Loading events…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const upcomingEvents = events.filter((e) => !isEventPast(e))
  const pastEvents = events.filter((e) => isEventPast(e))
  const displayEvents = activeTab === 'upcoming' ? upcomingEvents : pastEvents
  const myUpcomingCount = upcomingEvents.filter((e) => registrations.has(e.id)).length

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
      </div>

      {/* Events list */}
      <div className="mt-4 space-y-4">
        {displayEvents.length === 0 ? (
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
