import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Clock,
  Users,
  UserPlus,
  QrCode,
  Search,
  Check,
  AlertCircle,
  ArrowRight,
} from 'lucide-react'
import { supabase, type EventRow, type Profile, type Connection, type EventRegistration, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { QRScanner } from '@/components/ui/QRScanner'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState<EventRow | null>(null)
  const [isRegistered, setIsRegistered] = useState(false)
  const [attendeeCount, setAttendeeCount] = useState(0)
  const [attendees, setAttendees] = useState<Profile[]>([])
  const [attendeeLoading, setAttendeeLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('about')
  const [registering, setRegistering] = useState(false)

  // QR scanning state
  const [showScanner, setShowScanner] = useState(false)

  // Connection flow state
  const [connectState, setConnectState] = useState<ConnectState>('idle')
  const [targetProfile, setTargetProfile] = useState<Profile | null>(null)
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
        supabase.from('event_registrations').select('id').eq('event_id', id).eq('user_id', user.id).maybeSingle(),
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
      setIsRegistered(!!regRes.data)

      // Attendee count
      const { count } = await supabase
        .from('event_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', id)
      setAttendeeCount(count ?? 0)
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

    if (!regs || regs.length === 0) {
      setAttendees([])
      setAttendeeLoading(false)
      return
    }

    const userIds = (regs as EventRegistration[]).map((r) => r.user_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', userIds)

    setAttendees((profiles as Profile[]) || [])
    setAttendeeLoading(false)
  }

  async function loadMyEventConnections() {
    if (!id || !user || !event) return
    const { data } = await supabase
      .from('connections')
      .select('*')
      .eq('owner_id', user.id)
      .eq('event_name', event.name)
      .order('created_at', { ascending: false })
    setMyEventConnections((data as Connection[]) || [])
  }

  useEffect(() => {
    loadData()
  }, [id, user])

  useEffect(() => {
    if (isRegistered && tab === 'attendees' && attendees.length === 0) {
      loadAttendees()
    }
    if (isRegistered && tab === 'networking') {
      loadMyEventConnections()
    }
  }, [tab, isRegistered])

  async function handleRegister() {
    if (!id || !user) return
    setRegistering(true)
    const { error: regError } = await supabase
      .from('event_registrations')
      .insert({ event_id: id, user_id: user.id })
    if (regError) {
      setError(regError.message)
      setRegistering(false)
      return
    }
    setIsRegistered(true)
    setAttendeeCount(attendeeCount + 1)
    setRegistering(false)
  }

  async function handleUnregister() {
    if (!id || !user) return
    setRegistering(true)
    const { error: unregError } = await supabase
      .from('event_registrations')
      .delete()
      .eq('event_id', id)
      .eq('user_id', user.id)
    if (unregError) {
      setError(unregError.message)
      setRegistering(false)
      return
    }
    setIsRegistered(false)
    setAttendeeCount(Math.max(0, attendeeCount - 1))
    setRegistering(false)
  }

  // --- Connection flow ---

  function startConnect(profile: Profile) {
    setTargetProfile(profile)
    setConnectState('profile')
    setConnectError('')
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
      .from('profiles')
      .select('*')
      .eq('id', profileId)
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

    const profile = profileData as Profile

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
        linkedin: targetProfile.linkedin || '',
        website: targetProfile.website || '',
        photo_url: targetProfile.photo_url || '',
        relationship_type: context.relationship_type,
        event_name: event.name,
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

  return (
    <div>
      <Link to="/events" className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      {/* Event header */}
      <Card className="mb-6 overflow-hidden">
        {event.image_url && (
          <div className="h-40 w-full sm:h-56">
            <img src={event.image_url} alt={event.name} className="h-full w-full object-cover" />
          </div>
        )}
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> {formatDate(event.start_date)}
                  {event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ''}
                </span>
                {event.start_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {formatTime(event.start_time)}
                    {event.end_time ? ` – ${formatTime(event.end_time)}` : ''}
                  </span>
                )}
              </div>
              {event.location && (
                <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                  <MapPin className="h-3.5 w-3.5" /> {event.location}
                </p>
              )}
              <div className="mt-3 flex items-center gap-3">
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Users className="h-4 w-4" /> {attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} registered
                </span>
                {isRegistered && <Badge variant="success">You're registered</Badge>}
                {past && !isRegistered && <Badge variant="gray">Past event</Badge>}
              </div>
            </div>
            {!past && (
              isRegistered ? (
                <Button variant="outline" size="sm" onClick={handleUnregister} disabled={registering}>
                  {registering ? '…' : 'Unregister'}
                </Button>
              ) : (
                <Button size="sm" onClick={handleRegister} disabled={registering}>
                  {registering ? 'Registering…' : 'Register'}
                </Button>
              )
            )}
          </div>
          {event.description && (
            <p className="mt-4 text-sm leading-relaxed text-gray-700">{event.description}</p>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('about')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'about' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          About
        </button>
        {isRegistered && (
          <button
            onClick={() => setTab('attendees')}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'attendees' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Attendees ({attendeeCount})
          </button>
        )}
        {isRegistered && (
          <button
            onClick={() => setTab('networking')}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'networking' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Networking
          </button>
        )}
      </div>

      {/* About tab */}
      {tab === 'about' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Event Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatDate(event.start_date)}{event.end_date && event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ''}</p>
                  {event.start_time && (
                    <p className="text-xs text-gray-500">{formatTime(event.start_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ''}</p>
                  )}
                </div>
              </div>
              {event.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <p className="text-sm text-gray-900">{event.location}</p>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Users className="h-4 w-4 text-gray-400" />
                <p className="text-sm text-gray-900">{attendeeCount}{event.capacity ? ` / ${event.capacity}` : ''} registered</p>
              </div>
            </CardContent>
          </Card>

          {!isRegistered && !past && (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Users className="h-8 w-8" />}
                  title="Register to network"
                  description="Register for this event to see who's attending and start making connections."
                  action={<Button size="sm" onClick={handleRegister} disabled={registering}>{registering ? 'Registering…' : 'Register now'}</Button>}
                />
              </CardContent>
            </Card>
          )}
          {isRegistered && !past && (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<QrCode className="h-8 w-8" />}
                  title="Ready to network"
                  description="Check the Attendees tab to see who's coming, or the Networking tab to scan QR codes and connect."
                  action={
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setTab('attendees')}>View attendees</Button>
                      <Button size="sm" onClick={() => setTab('networking')}>Start networking</Button>
                    </div>
                  }
                />
              </CardContent>
            </Card>
          )}
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
    </div>
  )
}
