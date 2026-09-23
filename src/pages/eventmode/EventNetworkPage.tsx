import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, UserPlus, Users, ScanLine } from 'lucide-react'
import { supabase, type Connection } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import EventModeConnectFlow from '@/components/eventmode/EventModeConnectFlow'
import { listEventDirectory, type EventDirectoryEntry } from '@/lib/checkin'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'

// Event Mode Network: people connected to / participating in THIS event. Two
// scoped groups — my connections made at the event, and the event's attendee
// directory (public cards only, via the existing event_attendee_directory RPC).
// Deliberately not the global Rally network.
export default function EventNetworkPage() {
  const eventId = useEventModeId()
  const { event, openScan } = useEventModeOutlet()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myConnections, setMyConnections] = useState<Connection[]>([])
  const [directory, setDirectory] = useState<EventDirectoryEntry[]>([])
  const [search, setSearch] = useState('')
  const [connectTarget, setConnectTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!user) return
      setLoading(true)
      setError(null)

      const [connRes, dirRes] = await Promise.all([
        supabase
          .from('connections')
          .select('*')
          .eq('owner_id', user.id)
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        listEventDirectory(eventId),
      ])

      if (cancelled) return
      if (connRes.error) setError(connRes.error.message)
      else setMyConnections((connRes.data as Connection[]) || [])

      if (dirRes.error) {
        // The directory is attendees-only; someone unregistered gets a clean
        // empty list rather than an error.
        setDirectory([])
      } else {
        setDirectory(dirRes.data.filter((d) => d.user_id !== user.id))
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId, user])

  const filteredDirectory = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return directory
    return directory.filter(
      (d) =>
        d.full_name.toLowerCase().includes(q) ||
        d.job_title.toLowerCase().includes(q) ||
        d.company.toLowerCase().includes(q)
    )
  }, [directory, search])

  const filteredConnections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return myConnections
    return myConnections.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.job_title.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q)
    )
  }, [myConnections, search])

  async function openConversation(otherUserId: string) {
    const { data } = await supabase.rpc('create_direct_conversation', {
      other_user_id: otherUserId,
      event_id: eventId,
    })
    if (data) navigate(`/messages/${data}`)
    else navigate('/messages')
  }

  if (loading) return <LoadingState message="Loading event network…" />
  if (error) return <ErrorState message={error} />

  return (
    <div className="space-y-6">
      <EventModeConnectFlow
        event={event}
        open={connectTarget !== null}
        onClose={() => setConnectTarget(null)}
        initialProfileId={connectTarget}
        userId={user?.id ?? ''}
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Search people at this event…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* People I've connected with at this event */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">People I've connected with</h2>
        {filteredConnections.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<UserPlus className="h-10 w-10" />}
                title={myConnections.length === 0 ? 'No connections at this event yet' : 'No matching connections'}
                description={
                  myConnections.length === 0
                    ? `Tap CONNECT to scan someone's QR code and meet them at ${event.name}.`
                    : 'Try a different search term.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredConnections.map((conn) => (
              <Link key={conn.id} to={`/connections/${conn.id}`}>
                <Card className="transition-colors hover:border-primary-300 hover:bg-primary-50/30">
                  <CardContent className="flex items-center gap-3 py-3">
                    <Avatar name={conn.full_name || '?'} src={conn.photo_url} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{conn.full_name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {conn.job_title}{conn.company ? ` at ${conn.company}` : ''}
                      </p>
                      <p className="text-xs text-gray-400">Met at {event.name}</p>
                    </div>
                    <Badge variant="primary">{conn.relationship_type}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Attendees at this event (directory) */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Attendees</h2>
          <Button size="sm" variant="secondary" onClick={openScan}>
            <ScanLine className="h-4 w-4" /> Scan QR
          </Button>
        </div>
        {filteredDirectory.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Users className="h-10 w-10" />}
                title={directory.length === 0 ? 'No attendees to show' : 'No matching attendees'}
                description={
                  directory.length === 0
                    ? 'When other attendees register, they will appear here.'
                    : 'Try a different search term.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredDirectory.map((person) => (
              <Card key={person.user_id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <Avatar name={person.full_name || '?'} src={person.photo_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{person.full_name || 'Professional'}</p>
                    <p className="truncate text-xs text-gray-500">
                      {person.job_title}{person.company ? ` at ${person.company}` : ''}
                    </p>
                  </div>
                  {person.already_connected ? (
                    <Button size="sm" variant="secondary" onClick={() => openConversation(person.user_id)}>
                      Message
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setConnectTarget(person.user_id)}>
                      <UserPlus className="h-3.5 w-3.5" /> Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
