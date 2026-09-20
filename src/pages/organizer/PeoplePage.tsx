import { useCallback, useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { listOrganizationPeople } from '@/lib/events'
import type { OrganizationPerson } from '@/lib/supabase'

// Everyone who has registered for any event this organization owns. The same
// public professional card shown everywhere else — no contact details, because
// attendees have not agreed to share them.
export default function PeoplePage() {
  const { organization, loading: orgLoading } = useOrganizer()
  const [people, setPeople] = useState<OrganizationPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const orgId = organization?.id ?? null

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: loadError } = await listOrganizationPeople(orgId)
    setPeople(data)
    setError(loadError)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  if (orgLoading) return <LoadingState message="Loading people…" />
  if (!organization) return null

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? people.filter(
        (p) =>
          p.full_name.toLowerCase().includes(needle) || p.company.toLowerCase().includes(needle)
      )
    : people

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">People</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everyone who has registered for an event run by {organization.name}.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>
            {people.length} {people.length === 1 ? 'person' : 'people'}
          </CardTitle>
          <Users className="h-4 w-4 text-gray-400" />
        </CardHeader>
        <CardContent className="space-y-4">
          {people.length > 0 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or company"
              aria-label="Search people"
            />
          )}

          {loading ? (
            <LoadingState message="Loading people…" />
          ) : people.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="Nobody yet"
              description="Once people register for your events, they appear here."
            />
          ) : visible.length === 0 ? (
            <EmptyState title="No matches" description="Try a different name or company." />
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {visible.map((p) => (
                  <li key={p.user_id} className="flex items-center gap-3 py-3">
                    <Avatar name={p.full_name || 'Attendee'} src={p.photo_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {p.full_name || 'Rally member'}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {[p.job_title, p.company].filter(Boolean).join(' · ') || 'No title set'}
                      </p>
                    </div>
                    <Badge variant={p.events_registered > 1 ? 'primary' : 'default'}>
                      {p.events_registered} {p.events_registered === 1 ? 'event' : 'events'}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500">
                Email addresses and phone numbers are not shown. Attendees decide when to share
                those, and Rally does not reveal them to organizers by default.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
