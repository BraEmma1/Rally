import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Calendar, MapPin, Clock, ArrowRight, CalendarCheck, MailOpen, Check, X, SearchX } from 'lucide-react'
import { supabase, type EventRow, type EventInvitation } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { SearchField } from '@/components/ui/SearchField'
import { Pagination } from '@/components/ui/Pagination'
import { ViewToggle, type ViewMode } from '@/components/ui/ViewToggle'
import { EventCard, NextEventCard, RegisteredPill, WaitlistPill } from '@/components/events/EventCard'
import { CancelRegistrationDialog, RegistrationDialog } from '@/components/events/RegistrationDialog'
import {
  fetchMyRegistrationStatuses,
  isAttending,
  type RegistrationResult,
  type RegistrationStatus,
} from '@/lib/registrations'
import { formatClock, formatDateRange } from '@/lib/utils'

const PAGE_SIZE = 6

// Supabase errors are objects with a `message`; not all of them are Error instances.
function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return 'Please try again.'
}

// Only a plain positive integer is a page number. Anything else (negative,
// decimal, trailing text, empty) means page 1; a number past the end means the
// last page. Never NaN, never an out-of-range slice.
function parsePage(raw: string | null, pageCount: number): number {
  if (!raw || !/^[0-9]{1,9}$/.test(raw)) return 1
  const n = Number.parseInt(raw, 10)
  return Math.min(Math.max(n, 1), pageCount)
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
  const { user } = useAuth()
  const { refresh: refreshNotifications } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // A failed register / unregister / accept / decline. Shown as a banner above the
  // content so the list the person was working in stays on screen; `error` is
  // reserved for the initial load failing.
  const [actionError, setActionError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  // My registration status per event (cancelled ones are not kept). Waitlisted is
  // not attending: no seat yet.
  const [registrations, setRegistrations] = useState<Map<string, RegistrationStatus>>(new Map())
  const attending = (eventId: string) => isAttending(registrations.get(eventId))
  const waitlistedFor = (eventId: string) => registrations.get(eventId) === 'waitlisted'
  const isFull = (e: EventRow) => !!e.capacity && (registrationCounts[e.id] || 0) >= e.capacity
  // The event whose registration / cancel dialog is open.
  const [registerEventId, setRegisterEventId] = useState<string | null>(null)
  const [cancelEventId, setCancelEventId] = useState<string | null>(null)
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({})
  const [invitations, setInvitations] = useState<InvitationWithEvent[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTabState] = useState<'upcoming' | 'past' | 'invitations'>(() => {
    const tab = searchParams.get('tab')
    return tab === 'invitations' || tab === 'past' ? tab : 'upcoming'
  })

  // Keep the active tab in the URL so drawer links like /events?tab=invitations
  // land directly on the right section, even when the page is already open.
  useEffect(() => {
    const tab = searchParams.get('tab')
    setActiveTabState(tab === 'invitations' || tab === 'past' ? tab : 'upcoming')
  }, [searchParams])

  function switchTab(tab: 'upcoming' | 'past' | 'invitations') {
    setActiveTabState(tab)
    const next = new URLSearchParams(searchParams)
    if (tab === 'upcoming') next.delete('tab')
    else next.set('tab', tab)
    next.delete('page')
    setSearchParams(next, { replace: true })
  }

  // The page number lives in the URL (?page=2) so Back and shared links work.
  function goToPage(n: number) {
    const next = new URLSearchParams(searchParams)
    if (n <= 1) next.delete('page')
    else next.set('page', String(n))
    setSearchParams(next)
    document.getElementById('events-list-heading')?.scrollIntoView({ block: 'start' })
  }

  // A new search or sort starts again from the first page.
  function resetPage() {
    if (!searchParams.has('page')) return
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    setSearchParams(next, { replace: true })
  }
  // The invitation being accepted or declined, and which of the two.
  const [responding, setResponding] = useState<{ id: string; kind: 'accept' | 'decline' } | null>(null)
  const [query, setQueryState] = useState('')
  const [sort, setSortState] = useState<'soonest' | 'latest'>('soonest')
  function setQuery(value: string) {
    setQueryState(value)
    resetPage()
  }
  function setSort(value: 'soonest' | 'latest') {
    setSortState(value)
    resetPage()
  }
  // Grid or list is a per-person preference; storage can be unavailable
  // (private windows), in which case it simply is not remembered.
  const [view, setViewState] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem('rally.eventsView') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  function setView(mode: ViewMode) {
    setViewState(mode)
    try {
      localStorage.setItem('rally.eventsView', mode)
    } catch {
      /* not remembered */
    }
  }

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [eventsRes, regRes, inviteRes] = await Promise.all([
        supabase.from('events').select('*').order('start_date', { ascending: true }),
        fetchMyRegistrationStatuses(user.id),
        supabase.from('event_invitations').select('*').eq('invited_user_id', user.id).order('created_at', { ascending: false }),
      ])

      if (eventsRes.error) throw eventsRes.error
      if (regRes.error) throw regRes.error
      if (inviteRes.error) throw inviteRes.error

      const eventList = eventsRes.data as EventRow[]
      setEvents(eventList)
      setRegistrations(regRes.data)

      // Aggregate counts come from an RPC: registration rows are now visible
      // only to fellow attendees, and this is one call instead of one per event.
      const counts: Record<string, number> = {}
      if (eventList.length > 0) {
        const { data: countRows } = await supabase.rpc('get_event_registration_counts', {
          event_ids: eventList.map((e) => e.id),
        })
        for (const row of (countRows as { event_id: string; registration_count: number }[]) || []) {
          counts[row.event_id] = Number(row.registration_count) || 0
        }
      }
      setRegistrationCounts(counts)

      // Enrich invitations with event + inviter data
      const inviteList = inviteRes.data as EventInvitation[]
      if (inviteList.length > 0) {
        const eventMap = new Map<string, EventRow>()
        for (const e of eventList) eventMap.set(e.id, e)

        const inviterIds = [...new Set(inviteList.map((i) => i.invited_by))]
        const { data: inviterProfiles } = await supabase.rpc('get_public_profiles', {
          profile_ids: inviterIds,
        })
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

  // Registering opens the dialog (registration form, waitlist notice, confirmation);
  // the register / cancel calls themselves live in the dialogs.
  function handleRegister(eventId: string) {
    if (!user || registrations.has(eventId)) return
    setActionError(null)
    setRegisterEventId(eventId)
  }

  function handleUnregister(eventId: string) {
    if (!user || !registrations.has(eventId)) return
    setActionError(null)
    setCancelEventId(eventId)
  }

  function onRegistered(eventId: string, result: RegistrationResult) {
    setRegistrations((prev) => new Map(prev).set(eventId, result.registration_status))
    if (result.registration_status === 'registered') {
      setRegistrationCounts((prev) => ({ ...prev, [eventId]: (prev[eventId] || 0) + 1 }))
    }
    refreshNotifications()
  }

  function onCancelled(eventId: string, previous: RegistrationStatus | null) {
    setCancelEventId(null)
    setRegistrations((prev) => {
      const next = new Map(prev)
      next.delete(eventId)
      return next
    })
    if (isAttending(previous)) {
      setRegistrationCounts((prev) => ({ ...prev, [eventId]: Math.max(0, (prev[eventId] || 0) - 1) }))
    }
  }

  async function handleAccept(inv: InvitationWithEvent) {
    if (!user || responding) return
    setActionError(null)
    setResponding({ id: inv.id, kind: 'accept' })
    // True once the invitation row itself is Accepted in the database. If a later
    // step fails, the list is reloaded so the screen shows what is actually stored.
    let statusSaved = false
    try {
      // Update invitation status
      const { error: updateError } = await supabase
        .from('event_invitations')
        .update({ status: 'Accepted', responded_at: new Date().toISOString() })
        .eq('id', inv.id)
        .eq('invited_user_id', user.id)
      if (updateError) throw updateError
      statusSaved = true

      // Server reads the invitation's status and composes the message for the inviter.
      await supabase.rpc('notify_invitation_response', { invitation_id: inv.id })
      refreshNotifications()

      // Accepting an invitation is not a registration: registering has a form and
      // may land on the waitlist, so hand over to the same dialog everyone else uses.
      if (!registrations.has(inv.event_id)) setRegisterEventId(inv.event_id)

      setInvitations((prev) =>
        prev.map((i) => (i.id === inv.id ? { ...i, status: 'Accepted', responded_at: new Date().toISOString() } : i))
      )
    } catch (err) {
      setActionError(`Could not accept the invitation: ${errorMessage(err)}`)
      if (statusSaved) void loadData()
    } finally {
      setResponding(null)
    }
  }

  async function handleDecline(inv: InvitationWithEvent) {
    if (!user || responding) return
    setActionError(null)
    setResponding({ id: inv.id, kind: 'decline' })
    try {
      const { error: updateError } = await supabase
        .from('event_invitations')
        .update({ status: 'Declined', responded_at: new Date().toISOString() })
        .eq('id', inv.id)
        .eq('invited_user_id', user.id)
      if (updateError) throw updateError

      // Notify the inviter that their invitation was declined
      await supabase.rpc('notify_invitation_response', { invitation_id: inv.id })
      refreshNotifications()
      setInvitations((prev) =>
        prev.map((i) => (i.id === inv.id ? { ...i, status: 'Declined', responded_at: new Date().toISOString() } : i))
      )
    } catch (err) {
      setActionError(`Could not decline the invitation: ${errorMessage(err)}`)
    } finally {
      setResponding(null)
    }
  }

  if (loading) return <LoadingState message="Loading events…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const upcomingEvents = events.filter((e) => !isEventPast(e))
  const pastEvents = events.filter((e) => isEventPast(e))
  const myUpcomingCount = upcomingEvents.filter((e) => attending(e.id)).length
  const pendingInvites = invitations.filter((i) => i.status === 'Pending').length

  // Search is name / location / description. Events arrive soonest-first from
  // the query; "latest" simply reverses that order.
  const needle = query.trim().toLowerCase()
  const matches = (e: EventRow) =>
    !needle ||
    e.name.toLowerCase().includes(needle) ||
    (e.location || '').toLowerCase().includes(needle) ||
    (e.description || '').toLowerCase().includes(needle)
  const source = activeTab === 'past' ? pastEvents : upcomingEvents
  const filtered = source.filter(matches)
  const ordered = sort === 'soonest' ? filtered : [...filtered].reverse()

  // The earliest upcoming event the person is registered for, shown as a wide
  // card above the grid. Only on the unfiltered upcoming list.
  const nextEvent =
    activeTab === 'upcoming' && !needle ? upcomingEvents.find((e) => attending(e.id)) : undefined
  const gridEvents = nextEvent ? ordered.filter((e) => e.id !== nextEvent.id) : ordered

  // Six per page, as in the design. A ?page= past the end lands on the last page.
  const pageCount = Math.max(1, Math.ceil(gridEvents.length / PAGE_SIZE))
  const page = parsePage(searchParams.get('page'), pageCount)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageEvents = gridEvents.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover Events"
        description="Discover and register for professional networking events."
      />

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-error-200 bg-error-50 p-4 text-sm text-error-800"
        >
          <p className="min-w-0">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 rounded-md px-2 py-1 font-semibold text-error-700 hover:bg-error-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-error-600"
          >
            Dismiss
          </button>
        </div>
      )}

      <SegmentedTabs
        label="Event views"
        value={activeTab}
        onChange={switchTab}
        tabs={[
          { key: 'upcoming', label: 'Upcoming', icon: <Calendar className="h-4 w-4" aria-hidden="true" />, count: myUpcomingCount },
          { key: 'past', label: 'Past', icon: <CalendarCheck className="h-4 w-4" aria-hidden="true" /> },
          { key: 'invitations', label: 'Invitations', icon: <MailOpen className="h-4 w-4" aria-hidden="true" />, count: pendingInvites, countTone: 'alert' },
        ]}
      />

      {activeTab !== 'invitations' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card sm:flex-row sm:items-center">
          <SearchField
            className="flex-1"
            label="Search events"
            placeholder="Search by name or location…"
            value={query}
            onChange={setQuery}
          />
          <label className="flex items-center gap-2 text-sm text-rally-muted">
            <span className="shrink-0">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'soonest' | 'latest')}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-primary-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint sm:w-52"
            >
              <option value="soonest">Date: earliest first</option>
              <option value="latest">Date: latest first</option>
            </select>
          </label>
        </div>
      )}

      {activeTab === 'invitations' ? (
        invitations.length === 0 ? (
          <div className="rounded-2xl border border-rally-line bg-white shadow-card">
            <EmptyState
              icon={<MailOpen className="h-10 w-10" />}
              title="No invitations"
              description="Event invitations from organizers will appear here."
            />
          </div>
        ) : (
          <div className="space-y-4">
            {invitations.map((inv) => {
              const event = inv.event
              if (!event) return null
              const isPending = inv.status === 'Pending'
              const isAccepted = inv.status === 'Accepted'
              const isDeclined = inv.status === 'Declined'
              const isRegistered = attending(event.id)
              const isWaitlisted = waitlistedFor(event.id)

              return (
                <article
                  key={inv.id}
                  className="flex flex-col overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card sm:flex-row"
                >
                  {event.image_url && (
                    <div className="h-36 flex-shrink-0 sm:h-auto sm:w-48">
                      <img src={event.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between md:p-5">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-lg font-semibold tracking-tight text-rally-navy">{event.name}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-rally-muted">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-4 w-4 text-primary-600" aria-hidden="true" />
                          {formatDateRange(event.start_date, event.end_date)}
                        </span>
                        {event.start_time && (
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-primary-600" aria-hidden="true" />
                            {formatClock(event.start_time)}
                            {event.end_time ? ` – ${formatClock(event.end_time)}` : ''}
                          </span>
                        )}
                      </div>
                      {event.location && (
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-rally-muted">
                          <MapPin className="h-4 w-4 text-primary-600" aria-hidden="true" /> {event.location}
                        </p>
                      )}
                      {event.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{event.description}</p>}
                      {inv.inviter_name && (
                        <div className="mt-3 flex items-center gap-1.5">
                          <Avatar name={inv.inviter_name} size="xs" />
                          <span className="text-sm text-rally-muted">Invited by {inv.inviter_name}</span>
                        </div>
                      )}
                      <div className="mt-3">
                        {isPending && <Badge variant="warning">Pending</Badge>}
                        {isAccepted && <Badge variant="success">Accepted</Badge>}
                        {isDeclined && <Badge variant="error">Declined</Badge>}
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 flex-col gap-2 sm:items-end">
                      <Link to={`/events/${event.id}`}>
                        <Button size="lg" variant="secondary" className="w-full rounded-xl sm:w-auto">
                          View <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </Link>
                      {isPending && (
                        <div className="flex gap-2">
                          <Button
                            size="lg"
                            onClick={() => handleAccept(inv)}
                            disabled={responding !== null}
                            className="rounded-xl bg-success-600 text-white hover:bg-success-700"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            {responding?.id === inv.id && responding.kind === 'accept' ? 'Accepting…' : 'Accept'}
                          </Button>
                          <Button
                            size="lg"
                            variant="secondary"
                            onClick={() => handleDecline(inv)}
                            disabled={responding !== null}
                            className="rounded-xl text-error-600 hover:bg-error-50"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            {responding?.id === inv.id && responding.kind === 'decline' ? 'Declining…' : 'Decline'}
                          </Button>
                        </div>
                      )}
                      {isAccepted && isRegistered && <RegisteredPill />}
                      {isAccepted && isWaitlisted && <WaitlistPill />}
                      {isAccepted && !isRegistered && !isWaitlisted && (
                        <Button size="lg" className="rounded-xl" onClick={() => handleRegister(event.id)}>
                          {isFull(event) ? 'Join waitlist' : 'Register'}
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )
      ) : source.length === 0 ? (
        <div className="rounded-2xl border border-rally-line bg-white shadow-card">
          <EmptyState
            icon={<Calendar className="h-10 w-10" />}
            title={activeTab === 'upcoming' ? 'No upcoming events' : 'No past events'}
            description={
              activeTab === 'upcoming'
                ? 'Check back soon for new networking events.'
                : 'Events you attend will appear here after they end.'
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-rally-line bg-white shadow-card">
          <EmptyState
            icon={<SearchX className="h-10 w-10" />}
            title="No events match your search"
            description="Try a different name or location."
            action={
              <Button variant="secondary" className="rounded-xl" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {nextEvent && <NextEventCard event={nextEvent} registeredCount={registrationCounts[nextEvent.id] || 0} />}

          {gridEvents.length > 0 && (
            <section aria-labelledby="events-list-heading">
              <div className="mb-4 flex items-center gap-3">
                <h2 id="events-list-heading" className="font-display text-xl font-semibold tracking-tight text-rally-navy">
                  {activeTab === 'upcoming' ? 'Upcoming events' : 'Past events'}
                </h2>
                <span className="rounded-full bg-rally-tint px-2.5 py-0.5 text-xs font-semibold text-primary-700">
                  {gridEvents.length} listed
                </span>
              </div>
              <div className={view === 'list' ? 'flex flex-col gap-4' : 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3'}>
                {pageEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    layout={view}
                    registered={attending(event.id)}
                    waitlisted={waitlistedFor(event.id)}
                    full={isFull(event)}
                    registeredCount={registrationCounts[event.id] || 0}
                    past={activeTab === 'past'}
                    busy={false}
                    onRegister={() => handleRegister(event.id)}
                    onUnregister={() => handleUnregister(event.id)}
                  />
                ))}
              </div>

              <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-rally-line bg-white p-4 shadow-card md:flex-row md:justify-between">
                <p className="text-sm text-rally-muted" aria-live="polite">
                  Showing{' '}
                  <span className="font-semibold text-rally-navy">
                    {pageStart + 1}–{pageStart + pageEvents.length}
                  </span>{' '}
                  of <span className="font-semibold text-rally-navy">{gridEvents.length}</span>{' '}
                  {gridEvents.length === 1 ? 'event' : 'events'}
                </p>
                <Pagination page={page} pageCount={pageCount} onChange={goToPage} label="Events pages" />
                <div className="flex items-center gap-2 text-sm text-rally-muted">
                  <span>View</span>
                  <ViewToggle value={view} onChange={setView} />
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {registerEventId &&
        (() => {
          const target = events.find((e) => e.id === registerEventId)
          return target ? (
            <RegistrationDialog
              event={target}
              full={isFull(target)}
              onClose={() => setRegisterEventId(null)}
              onRegistered={(result) => onRegistered(target.id, result)}
            />
          ) : null
        })()}
      {cancelEventId &&
        (() => {
          const target = events.find((e) => e.id === cancelEventId)
          const status = registrations.get(cancelEventId)
          return target && status ? (
            <CancelRegistrationDialog
              event={target}
              status={status}
              onClose={() => setCancelEventId(null)}
              onCancelled={(previous) => onCancelled(target.id, previous)}
            />
          ) : null
        })()}
    </div>
  )
}
