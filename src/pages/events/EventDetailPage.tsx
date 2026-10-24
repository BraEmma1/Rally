import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Users,
  UserPlus,
  QrCode,
  Search,
  Check,
  AlertCircle,
  ArrowRight,
} from 'lucide-react'
import { supabase, type EventRow, type PublicProfile, type ConnectProfile, type Connection, type EventRegistration, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { CancelRegistrationDialog, RegistrationDialog } from '@/components/events/RegistrationDialog'
import { fetchMyRegistration, isAttending, type RegistrationResult, type RegistrationStatus } from '@/lib/registrations'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import {
  AboutEvent,
  AgendaHighlights,
  EventFaq,
  EventHero,
  ExhibitorsSponsors,
  FeaturedSpeakers,
  RallyAdvantage,
  SecurePass,
  VenueLogistics,
  WhoYouCanMeet,
} from '@/components/events/EventDetailParts'
import { getEventAgenda, getEventHost, type EventHost, type OrganizerSession } from '@/lib/events'
import { listEventSpeakers, type EventSpeaker } from '@/lib/speakers'
import { listEventExhibitors, type EventExhibitor } from '@/lib/exhibitors'
import { QRScanner } from '@/components/ui/QRScanner'
import { normalizeUrl } from '@/lib/utils'

function isEventPast(event: EventRow): boolean {
  if (!event.start_date) return false
  const today = new Date(new Date().toDateString())
  const start = new Date(event.start_date)
  return start < today
}

function extractProfileId(raw: string): string | null {
  const trimmed = raw.trim()
  const urlMatch = trimmed.match(/\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (urlMatch) return urlMatch[1]
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return trimmed
  return null
}

type Tab = 'about' | 'attendees' | 'networking'
type ConnectState = 'idle' | 'profile' | 'context' | 'success' | 'error'

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { refresh: refreshNotifications } = useNotifications()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState<EventRow | null>(null)
  // My registration for this event, or null. A cancelled one counts as none.
  const [regStatus, setRegStatus] = useState<RegistrationStatus | null>(null)
  // Registered or checked in. Waitlisted people do not get the attendee views.
  const isRegistered = isAttending(regStatus)
  const isWaitlisted = regStatus === 'waitlisted'
  const [showRegister, setShowRegister] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [attendeeCount, setAttendeeCount] = useState(0)
  const [attendees, setAttendees] = useState<PublicProfile[]>([])
  const [attendeeLoading, setAttendeeLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('about')
  // A failed register / unregister. Shown as a banner so the page stays on screen;
  // `error` is reserved for the event failing to load.
  const [actionError, setActionError] = useState<string | null>(null)
  // Real rows from the event's public agenda / speaker / exhibitor lists. A list
  // that fails to load is simply not shown.
  const [agenda, setAgenda] = useState<OrganizerSession[]>([])
  const [speakers, setSpeakers] = useState<EventSpeaker[]>([])
  const [exhibitors, setExhibitors] = useState<EventExhibitor[]>([])
  const [host, setHost] = useState<EventHost | null>(null)

  // QR scanning state
  const [showScanner, setShowScanner] = useState(false)

  // Connection flow state
  const [connectState, setConnectState] = useState<ConnectState>('idle')
  const [targetProfile, setTargetProfile] = useState<ConnectProfile | null>(null)
  const [connectError, setConnectError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [context, setContext] = useState({ note: '', relationship_type: 'Other' as string, follow_up_date: '' })

  // My connections from this event
  const [myEventConnections, setMyEventConnections] = useState<Connection[]>([])

  async function loadData() {
    if (!id || !user) return
    setLoading(true)
    setError(null)
    try {
      const [eventRes, regRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', id).maybeSingle(),
        fetchMyRegistration(id),
      ])

      if (eventRes.error) throw eventRes.error
      if (regRes.error) throw regRes.error
      if (!eventRes.data) {
        setError('Event not found.')
        setLoading(false)
        return
      }

      const eventData = eventRes.data as EventRow
      setEvent(eventData)
      setRegStatus(regRes.data && regRes.data.registration_status !== 'cancelled' ? regRes.data.registration_status : null)

      // Aggregate-only RPC: the count stays public while the registration rows
      // behind it are visible to fellow attendees only.
      const { data: countRows } = await supabase.rpc('get_event_registration_counts', {
        event_ids: [id],
      })
      const countRow = (countRows as { event_id: string; registration_count: number }[] | null)?.[0]
      setAttendeeCount(Number(countRow?.registration_count) || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event.')
    } finally {
      setLoading(false)
    }
  }

  async function loadAttendees() {
    if (!id) return
    setAttendeeLoading(true)
    const { data: regs } = await supabase
      .from('event_registrations')
      .select('user_id')
      .eq('event_id', id)
      .in('status', ['registered', 'checked_in'])

    if (!regs || regs.length === 0) {
      setAttendees([])
      setAttendeeLoading(false)
      return
    }

    const userIds = (regs as EventRegistration[]).map((r) => r.user_id)
    const { data: profiles } = await supabase.rpc('get_public_profiles', {
      profile_ids: userIds,
    })

    setAttendees((profiles as PublicProfile[]) || [])
    setAttendeeLoading(false)
  }

  async function loadMyEventConnections() {
    if (!id || !user) return
    const { data } = await supabase
      .from('connections')
      .select('*')
      .eq('owner_id', user.id)
      .eq('event_id', id)
      .order('created_at', { ascending: false })
    setMyEventConnections((data as Connection[]) || [])
  }

  useEffect(() => {
    loadData()
  }, [id, user])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void Promise.all([getEventAgenda(id), listEventSpeakers(id), listEventExhibitors(id), getEventHost(id)]).then(
      ([a, sp, ex, h]) => {
        if (cancelled) return
        setAgenda(a.data)
        setSpeakers(sp.data)
        setExhibitors(ex.data)
        setHost(h)
      }
    )
    return () => {
      cancelled = true
    }
  }, [id])

  // The Attendees / Networking tabs exist only while registered: leaving the
  // event from one of them must not strand the page on an empty tab.
  useEffect(() => {
    if (!isRegistered && tab !== 'about') setTab('about')
  }, [isRegistered, tab])

  useEffect(() => {
    if (isRegistered && tab === 'attendees' && attendees.length === 0) {
      loadAttendees()
    }
    if (isRegistered && tab === 'networking') {
      loadMyEventConnections()
    }
  }, [tab, isRegistered])

  // Registering opens the registration dialog (form, waitlist notice, confirmation);
  // the register / cancel calls themselves live in the dialogs.
  function handleRegister() {
    if (!id || !user || regStatus) return
    setActionError(null)
    setShowRegister(true)
  }

  function handleUnregister() {
    if (!id || !user || !regStatus) return
    setActionError(null)
    setShowCancel(true)
  }

  function onRegistered(result: RegistrationResult) {
    setRegStatus(result.registration_status)
    if (result.registration_status === 'registered') setAttendeeCount((n) => n + 1)
    refreshNotifications()
  }

  function onCancelled(previous: RegistrationStatus | null) {
    setShowCancel(false)
    setRegStatus(null)
    if (isAttending(previous)) setAttendeeCount((n) => Math.max(0, n - 1))
  }

  // --- Connection flow ---

  // Goes through the same lookup as a scan so the attendee path also gets the
  // contact card, the self-check and the duplicate-connection check.
  function startConnect(profile: PublicProfile) {
    loadProfileById(profile.id)
  }

  async function handleScan(data: string) {
    const profileId = extractProfileId(data)
    setShowScanner(false)
    if (!profileId) {
      setConnectError('This QR code is not a valid Rally profile code.')
      setConnectState('error')
      return
    }
    await loadProfileById(profileId)
  }

  async function loadProfileById(profileId: string) {
    setConnectState('idle')
    setConnectError('')
    const { data: profileData, error: profileError } = await supabase
      .rpc('get_connect_profile', { profile_id: profileId })
      .maybeSingle()

    if (profileError) {
      setConnectError(profileError.message)
      setConnectState('error')
      return
    }
    if (!profileData) {
      setConnectError('No profile found for this QR code.')
      setConnectState('error')
      return
    }

    const profile = profileData as ConnectProfile

    if (user && profile.id === user.id) {
      setConnectError("That's your own QR code! You can't connect with yourself.")
      setConnectState('error')
      return
    }

    if (user) {
      const { data: existing } = await supabase
        .from('connections')
        .select('id')
        .eq('owner_id', user.id)
        .eq('connected_user_id', profile.id)
        .maybeSingle()

      if (existing) {
        setConnectError(`You're already connected with ${profile.full_name || 'this person'}.`)
        setConnectState('error')
        return
      }
    }

    setTargetProfile(profile)
    setConnectState('profile')
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    if (!user || !targetProfile || !event) return
    setConnecting(true)
    setConnectError('')

    const { data: connData, error: connError } = await supabase
      .from('connections')
      .insert({
        owner_id: user.id,
        connected_user_id: targetProfile.id,
        full_name: targetProfile.full_name || '',
        job_title: targetProfile.job_title || '',
        company: targetProfile.company || '',
        industry: targetProfile.industry || '',
        location: targetProfile.location || '',
        email: targetProfile.email || '',
        phone: targetProfile.phone || '',
        linkedin: normalizeUrl(targetProfile.linkedin) || '',
        website: normalizeUrl(targetProfile.website) || '',
        photo_url: targetProfile.photo_url || '',
        relationship_type: context.relationship_type,
        event_name: event.name,
        event_id: event.id,
        follow_up_date: context.follow_up_date || null,
      })
      .select()
      .single()

    if (connError) {
      setConnectError(connError.message)
      setConnecting(false)
      return
    }

    if (context.note.trim() && connData) {
      await supabase.from('notes').insert({
        connection_id: connData.id,
        owner_id: user.id,
        content: context.note.trim(),
      })
    }

    // Recipient and wording are derived server-side from the connection row.
    if (connData) {
      await supabase.rpc('notify_new_connection', { connection_id: connData.id })
    }
    refreshNotifications()

    setConnecting(false)
    setConnectState('success')
    loadMyEventConnections()
  }

  function resetConnect() {
    setConnectState('idle')
    setTargetProfile(null)
    setConnectError('')
    setContext({ note: '', relationship_type: 'Other', follow_up_date: '' })
  }

  // --- Render ---

  if (loading) return <LoadingState message="Loading event…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />
  if (!event) return <ErrorState message="Event not found." />

  const past = isEventPast(event)
  const full = !!event.capacity && attendeeCount >= event.capacity
  const filteredAttendees = attendees.filter((a) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.full_name.toLowerCase().includes(q) ||
      a.job_title.toLowerCase().includes(q) ||
      a.company.toLowerCase().includes(q) ||
      a.industry.toLowerCase().includes(q)
    )
  })

  const basePath = `/events/${event.id}`

  // The pass options are for people who have not registered. A registered
  // attendee's pass (badge QR) lives in Event Mode, not on this page.
  const passCard = isRegistered || isWaitlisted ? null : (
    <SecurePass event={event} past={past} full={full} onRegister={handleRegister} />
  )

  return (
    <div className={`space-y-6 ${!isRegistered && !past ? 'pb-24 md:pb-0' : ''}`}>
      {/* Breadcrumb + status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-rally-muted">
          <Link
            to="/events"
            className="inline-flex min-h-[44px] items-center gap-1.5 font-semibold hover:text-rally-navy focus:outline-none focus-visible:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Discover Events
          </Link>
          <span className="hidden text-slate-300 sm:inline" aria-hidden="true">/</span>
          <Link to="/events" className="hidden min-h-[44px] items-center hover:text-rally-navy sm:inline-flex">Events</Link>
          <span className="hidden text-slate-300 sm:inline" aria-hidden="true">/</span>
          <span className="hidden max-w-[18rem] truncate font-semibold text-rally-navy sm:inline">{event.name}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {isRegistered && (
            <span className="inline-flex items-center rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-700">
              Confirmed Attendee
            </span>
          )}
          {isWaitlisted && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              On the waitlist
            </span>
          )}
          {!isRegistered && !isWaitlisted && !past && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-700">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" /> {full ? 'Event full · waitlist open' : 'Registration open'}
            </span>
          )}
          {past && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Past event
            </span>
          )}
        </div>
      </div>

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

      {/* One header for both states. Registered people get Event Mode and a pass;
          everyone else gets Register and the pass options. */}
      <EventHero
        event={event}
        past={past}
        registered={isRegistered}
        waitlisted={isWaitlisted}
        full={full}
        attendeeCount={attendeeCount}
        host={host}
        onRegister={handleRegister}
        onUnregister={handleUnregister}
        onEnter={() => navigate(`${basePath}/home`)}
      />

      {isRegistered && (
        <SegmentedTabs
          label="Event sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'about', label: 'About' },
            { key: 'attendees', label: 'Attendees', count: attendeeCount },
            { key: 'networking', label: 'Networking' },
          ]}
        />
      )}

      {/* About tab */}
      {tab === 'about' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-6 lg:col-span-8">
            {passCard && <div className="lg:hidden">{passCard}</div>}
            <AboutEvent event={event} />
            {!isRegistered && <RallyAdvantage />}
            <AgendaHighlights
              sessions={agenda}
              registered={isRegistered}
              registering={false}
              past={past}
              onUnlock={handleRegister}
              fullAgendaPath={`${basePath}/agenda`}
            />
            <FeaturedSpeakers speakers={speakers} registered={isRegistered} speakersPath={`${basePath}/speakers`} />
            <ExhibitorsSponsors exhibitors={exhibitors} registered={isRegistered} exhibitorsPath={`${basePath}/exhibitors`} />
            {!isRegistered && <EventFaq />}

            {isRegistered && !past && (
              <section className="rounded-2xl border border-rally-line bg-white shadow-card">
                <EmptyState
                  icon={<QrCode className="h-8 w-8" />}
                  title="Ready to network"
                  description="See who's coming, or scan QR codes and connect."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button size="lg" variant="secondary" className="rounded-xl" onClick={() => setTab('attendees')}>
                        View attendees
                      </Button>
                      <Button size="lg" className="rounded-xl" onClick={() => setTab('networking')}>
                        Start networking
                      </Button>
                    </div>
                  }
                />
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-6 lg:col-span-4">
            {passCard && <div className="hidden lg:block">{passCard}</div>}
            <VenueLogistics event={event} />
            <WhoYouCanMeet attendeeCount={attendeeCount} registered={isRegistered} networkPath={`${basePath}/network`} />
          </aside>
        </div>
      )}

      {/* Attendees tab */}
      {tab === 'attendees' && isRegistered && (
        <div>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search attendees by name, title, company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {attendeeLoading ? (
            <LoadingState message="Loading attendees…" />
          ) : filteredAttendees.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Users className="h-10 w-10" />}
                  title={attendees.length === 0 ? 'No other attendees yet' : 'No matching attendees'}
                  description={attendees.length === 0 ? 'Be the first to register and others will appear here.' : 'Try a different search term.'}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredAttendees.map((attendee) => {
                if (user && attendee.id === user.id) {
                  return (
                    <Card key={attendee.id}>
                      <CardContent className="flex items-center gap-3 py-3">
                        <Avatar name={attendee.full_name || '?'} src={attendee.photo_url} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{attendee.full_name || 'You'}</p>
                          <p className="truncate text-xs text-gray-500">
                            {attendee.job_title}{attendee.company ? ` at ${attendee.company}` : ''}
                          </p>
                        </div>
                        <Badge variant="gray">You</Badge>
                      </CardContent>
                    </Card>
                  )
                }
                return (
                  <Card key={attendee.id} className="transition-colors hover:border-primary-300">
                    <CardContent className="flex items-center gap-3 py-3">
                      <Avatar name={attendee.full_name || '?'} src={attendee.photo_url} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{attendee.full_name || 'Professional'}</p>
                        <p className="truncate text-xs text-gray-500">
                          {attendee.job_title}{attendee.company ? ` at ${attendee.company}` : ''}
                        </p>
                        {attendee.industry && <span className="text-xs text-gray-400">{attendee.industry}</span>}
                      </div>
                      <div className="flex gap-2">
                        <Link to={`/p/${attendee.id}`}>
                          <Button size="sm" variant="ghost">View</Button>
                        </Link>
                        <Button size="sm" onClick={() => startConnect(attendee)}>
                          <UserPlus className="h-3.5 w-3.5" /> Connect
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Networking tab */}
      {tab === 'networking' && isRegistered && (
        <div className="space-y-6">
          {/* Scan QR action */}
          <Card>
            <CardHeader><CardTitle>Connect at this event</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-4">Scan another attendee's Rally QR code to instantly connect. The connection will be saved as "Met at {event.name}".</p>
              <Button onClick={() => setShowScanner(true)}>
                <QrCode className="h-4 w-4" /> Scan QR code
              </Button>
            </CardContent>
          </Card>

          {/* My connections from this event */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>My connections from this event</CardTitle>
                {myEventConnections.length > 0 && (
                  <Link to="/connections" className="text-sm font-medium text-primary-600 hover:text-primary-700">
                    View all
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {myEventConnections.length === 0 ? (
                <EmptyState
                  icon={<UserPlus className="h-10 w-10" />}
                  title="No connections yet from this event"
                  description="Scan an attendee's QR code or connect from the Attendees tab to start building your event network."
                />
              ) : (
                <div className="space-y-2">
                  {myEventConnections.map((conn) => (
                    <Link key={conn.id} to={`/connections/${conn.id}`}>
                      <Card className="transition-colors hover:border-primary-300 hover:bg-primary-50/30">
                        <CardContent className="flex items-center gap-3 py-3">
                          <Avatar name={conn.full_name || '?'} src={conn.photo_url} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-900">{conn.full_name}</p>
                            <p className="truncate text-xs text-gray-500">
                              {conn.job_title}{conn.company ? ` at ${conn.company}` : ''}
                            </p>
                          </div>
                          <Badge variant="primary">{conn.relationship_type}</Badge>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* QR Scanner overlay */}
      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}

      {/* Connection flow modal */}
      {connectState !== 'idle' && targetProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={resetConnect}>
          <div className="relative w-full max-w-md rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <button onClick={resetConnect} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              ✕
            </button>

            {connectState === 'profile' && (
              <div>
                <h3 className="text-base font-semibold text-gray-900">Connect with {targetProfile.full_name || 'this person'}</h3>
                <div className="mt-4 flex items-center gap-4 rounded-md bg-gray-50 p-3">
                  <Avatar name={targetProfile.full_name || '?'} src={targetProfile.photo_url} size="lg" />
                  <div>
                    <p className="font-medium text-gray-900">{targetProfile.full_name || 'Professional'}</p>
                    <p className="text-sm text-gray-500">{targetProfile.job_title}{targetProfile.company ? ` at ${targetProfile.company}` : ''}</p>
                    {targetProfile.industry && <Badge variant="primary" className="mt-1">{targetProfile.industry}</Badge>}
                  </div>
                </div>
                {targetProfile.bio && (
                  <p className="mt-3 text-sm text-gray-600">{targetProfile.bio}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => setConnectState('context')} className="flex-1">
                    <UserPlus className="h-4 w-4" /> Connect
                  </Button>
                  <Button variant="secondary" onClick={resetConnect}>Cancel</Button>
                </div>
              </div>
            )}

            {connectState === 'context' && (
              <form onSubmit={handleConnect}>
                <h3 className="text-base font-semibold text-gray-900">Add context</h3>
                <p className="mt-1 text-xs text-gray-500">Connection will be saved as "Met at {event.name}"</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <Label htmlFor="rel">Relationship type</Label>
                    <Select id="rel" value={context.relationship_type} onChange={(e) => setContext({ ...context, relationship_type: e.target.value })}>
                      {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="fud">Follow-up date</Label>
                    <Input id="fud" type="date" value={context.follow_up_date} onChange={(e) => setContext({ ...context, follow_up_date: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="cn">Note</Label>
                    <Textarea id="cn" rows={2} value={context.note} onChange={(e) => setContext({ ...context, note: e.target.value })} placeholder="What did you discuss?" />
                  </div>
                </div>
                {connectError && <div className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{connectError}</div>}
                <div className="mt-4 flex gap-2">
                  <Button type="submit" disabled={connecting} className="flex-1">
                    {connecting ? 'Connecting…' : <>Confirm <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setConnectState('profile')}>Back</Button>
                </div>
              </form>
            )}

            {connectState === 'success' && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-50 text-accent-600">
                  <Check className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">Connection created!</h3>
                <p className="text-sm text-gray-500">You're now connected with {targetProfile.full_name || 'this person'} from {event.name}.</p>
                <div className="mt-2 flex gap-2">
                  <Link to={`/connections`}>
                    <Button size="sm">View connections</Button>
                  </Link>
                  <Button size="sm" variant="secondary" onClick={resetConnect}>Connect another</Button>
                </div>
              </div>
            )}

            {connectState === 'error' && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error-50 text-error-600">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">Couldn't connect</h3>
                <p className="text-sm text-gray-500">{connectError}</p>
                <Button size="sm" variant="secondary" onClick={resetConnect}>Close</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phones: keep the main action in reach while the long page scrolls. */}
      {!isRegistered && !isWaitlisted && !past && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-rally-line bg-white/95 p-3 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-rally-navy">{event.name}</p>
              <p className="text-xs text-rally-muted">{attendeeCount} registered{full ? ' · full' : ''}</p>
            </div>
            <Button size="lg" className="shrink-0 rounded-xl" onClick={handleRegister}>
              {full ? 'Join waitlist' : 'Register Now'}
            </Button>
          </div>
        </div>
      )}

      {showRegister && event && (
        <RegistrationDialog
          event={event}
          full={full}
          onClose={() => setShowRegister(false)}
          onRegistered={onRegistered}
        />
      )}
      {showCancel && event && regStatus && (
        <CancelRegistrationDialog
          event={event}
          status={regStatus}
          onClose={() => setShowCancel(false)}
          onCancelled={onCancelled}
        />
      )}
    </div>
  )
}
