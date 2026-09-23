import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, MessageSquare, Search, UserPlus, Users } from 'lucide-react'
import { supabase, type Connection } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import EventModeConnectFlow from '@/components/eventmode/EventModeConnectFlow'
import { listEventDirectory, type EventDirectoryEntry } from '@/lib/checkin'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/States'

// Event Mode Network: networking inside ONE event, not the global Rally
// network. Two tabs — connections made at this event, and the event's attendee
// directory (public cards only, via the event_attendee_directory RPC). Connect
// from the list reuses the existing event connect flow so the connection keeps
// the current event_id.
type Tab = 'attendees' | 'connections'

function SkeletonRows() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="h-7 w-20 animate-pulse rounded-md bg-gray-100" />
        </div>
      ))}
    </div>
  )
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h2>
  )
}

function matchQuery(q: string, fields: (string | null | undefined)[]) {
  return fields.some((f) => (f || '').toLowerCase().includes(q))
}

export default function EventNetworkPage() {
  const eventId = useEventModeId()
  const { event } = useEventModeOutlet()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('attendees')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myConnections, setMyConnections] = useState<Connection[]>([])
  const [directory, setDirectory] = useState<EventDirectoryEntry[]>([])
  const [search, setSearch] = useState('')
  const [connectTarget, setConnectTarget] = useState<string | null>(null)
  const [messagingId, setMessagingId] = useState<string | null>(null)

  const load = useCallback(async () => {
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

    if (connRes.error) setError(connRes.error.message)
    else setMyConnections((connRes.data as Connection[]) || [])
    // The directory is attendees-only; someone unregistered just gets an
    // empty list rather than an error.
    if (!dirRes.error) setDirectory(dirRes.data)
    setLoading(false)
  }, [eventId, user])

  useEffect(() => {
    void load()
  }, [load])

  const filteredDirectory = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return directory
    return directory.filter((d) => matchQuery(q, [d.full_name, d.job_title, d.company]))
  }, [directory, search])

  const filteredConnections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return myConnections
    return myConnections.filter((c) => matchQuery(q, [c.full_name, c.job_title, c.company]))
  }, [myConnections, search])

  async function openConversation(otherUserId: string) {
    setMessagingId(otherUserId)
    const { data } = await supabase.rpc('create_direct_conversation', {
      other_user_id: otherUserId,
      event_id: eventId,
    })
    setMessagingId(null)
    if (data) navigate(`/messages/${data}`)
    else navigate('/messages')
  }

  const noResults = search.trim().length > 0

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4">
      <EventModeConnectFlow
        event={event}
        open={connectTarget !== null}
        onClose={() => {
          setConnectTarget(null)
          void load()
        }}
        initialProfileId={connectTarget}
        userId={user?.id ?? ''}
      />

      <h1 className="text-xl font-bold text-gray-900">Network</h1>
      <p className="mt-0.5 text-sm text-gray-500">People you're connecting with at {event.name}</p>

      {/* Quick filters */}
      <div className="mt-4 flex rounded-full bg-gray-100 p-1" role="tablist" aria-label="Network filters">
        {(
          [
            ['connections', 'My Connections'],
            ['attendees', 'All Attendees'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              'flex-1 rounded-full px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ' +
              (tab === value
                ? 'bg-white font-semibold text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="search"
          placeholder="Search attendees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          aria-label="Search attendees"
        />
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</p>
      )}

      {loading ? (
        <div className="mt-4">
          <SkeletonRows />
        </div>
      ) : tab === 'connections' ? (
        <section className="mt-4">
          <SectionHeading>My Connections</SectionHeading>
          {filteredConnections.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="h-10 w-10" />}
              title={noResults ? 'No people match your search.' : 'No connections yet'}
              description={
                noResults
                  ? undefined
                  : 'Connect with people at this event to start building your network.'
              }
            />
          ) : (
            <div className="space-y-2">
              {filteredConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
                >
                  <Avatar name={conn.full_name || '?'} src={conn.photo_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{conn.full_name}</p>
                    <p className="truncate text-xs text-gray-500">
                      {conn.job_title}
                      {conn.company ? ` | ${conn.company}` : ''}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                      <Check className="h-3 w-3" aria-hidden="true" /> Connected
                      <span className="font-normal text-gray-400">· Met at {event.name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={messagingId === conn.connected_user_id}
                      onClick={() => {
                        if (conn.connected_user_id) void openConversation(conn.connected_user_id)
                      }}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Message
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/connections/${conn.id}`)}>
                      View Profile
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="mt-4">
          <SectionHeading>All Attendees</SectionHeading>
          {filteredDirectory.length === 0 ? (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title={noResults ? 'No people match your search.' : 'No attendees found.'}
              description={
                noResults ? undefined : 'When other attendees register, they will appear here.'
              }
            />
          ) : (
            <div className="space-y-2">
              {filteredDirectory.map((person) => {
                const isSelf = person.user_id === user?.id
                return (
                  <div
                    key={person.user_id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
                  >
                    <Avatar name={person.full_name || '?'} src={person.photo_url} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {person.full_name || 'Professional'}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {person.job_title}
                        {person.company ? ` | ${person.company}` : ''}
                      </p>
                      {person.already_connected && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                          <Check className="h-3 w-3" aria-hidden="true" /> Connected
                        </p>
                      )}
                    </div>
                    {isSelf ? (
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                        You
                      </span>
                    ) : person.already_connected ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={messagingId === person.user_id}
                        onClick={() => openConversation(person.user_id)}
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Message
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setConnectTarget(person.user_id)}>
                        <UserPlus className="h-3.5 w-3.5" /> Connect
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
