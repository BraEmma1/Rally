import { useCallback, useEffect, useState } from 'react'
import { UserPlus, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, Spinner } from '@/components/ui/States'
import { RELATIONSHIP_TYPES } from '@/lib/supabase'
import { connectEventAttendee, listEventDirectory, type EventDirectoryEntry } from '@/lib/checkin'

// Event networking for organizers who are also registered attendees of the
// event. Uses the existing event_attendee_directory RPC (public card only,
// already_connected flag) and connect_with_event_attendee for the connection —
// an ordinary connection carrying event context, not a separate system.
export function EventNetworkingPanel({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [entries, setEntries] = useState<EventDirectoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pendingRelationship, setPendingRelationship] = useState<string>('Other')
  const [connectError, setConnectError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: loadError } = await listEventDirectory(eventId)
    if (loadError) {
      setError(loadError)
      setEntries(null)
      return
    }
    setError(null)
    setEntries(data)
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  async function connect(entry: EventDirectoryEntry, relationship: string) {
    setConnectingId(entry.user_id)
    setConnectError(null)
    const { error: connectFail } = await connectEventAttendee(eventId, entry.user_id, relationship)
    setConnectingId(null)
    if (connectFail) {
      setConnectError(connectFail)
      return
    }
    setPendingId(null)
    await load()
  }

  if (error && entries === null) {
    // The backend raises "You are not registered for this event" for people
    // who are not attending; that is an expected state, not a failure to hide.
    const notRegistered = /not registered/i.test(error)
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title={notRegistered ? 'Networking is for attendees' : 'Could not load networking'}
            description={
              notRegistered
                ? `You are not registered for ${eventName}, so the attendee directory is not available to you. Register from the attendee side to network here.`
                : error
            }
          />
        </CardContent>
      </Card>
    )
  }

  const needle = search.trim().toLowerCase()
  const visible = (entries ?? []).filter(
    (e) =>
      !needle ||
      e.full_name.toLowerCase().includes(needle) ||
      e.company.toLowerCase().includes(needle) ||
      e.industry.toLowerCase().includes(needle)
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          People registered for {eventName}. Connect to keep the event on the relationship.
        </p>
        <div className="relative sm:max-w-xs sm:flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search attendees…"
          />
        </div>
      </div>

      <Card>
        <CardContent className="py-2">
          {entries === null && <Spinner className="mx-auto my-8" />}
          {entries !== null && visible.length === 0 && (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title={entries.length === 0 ? 'Nobody else yet' : 'No matches'}
              description={
                entries.length === 0
                  ? 'Attendees appear here once they register.'
                  : 'Try a different search.'
              }
            />
          )}
          {entries !== null && visible.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {visible.map((e) => {
                const isConnected = e.already_connected
                return (
                  <li key={e.user_id} className="py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={e.full_name || 'Attendee'} src={e.photo_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {e.full_name || 'Rally member'}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {[e.job_title, e.company].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {isConnected ? (
                        <Badge variant="success">Connected</Badge>
                      ) : pendingId === e.user_id ? (
                        <Button size="sm" variant="secondary" onClick={() => setPendingId(null)}>
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => setPendingId(e.user_id)}
                          disabled={connectingId === e.user_id}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Connect
                        </Button>
                      )}
                    </div>
                    {pendingId === e.user_id && (
                      <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-600">
                          This connection will be saved as “Met at {eventName}”.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={pendingRelationship}
                            onChange={(e) => setPendingRelationship(e.target.value)}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-primary-500 focus:outline-none"
                          >
                            {RELATIONSHIP_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            disabled={connectingId === e.user_id}
                            onClick={() => void connect(e, pendingRelationship)}
                          >
                            {connectingId === e.user_id ? 'Connecting…' : 'Confirm connection'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPendingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {connectError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{connectError}</div>
      )}
    </div>
  )
}
