import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, CalendarRange, MapPin, Users } from 'lucide-react'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { canManageTeam } from '@/lib/organizer'
import {
  LIFECYCLE_BADGE,
  LIFECYCLE_LABELS,
  eventLifecycle,
  formatEventDate,
  listOrganizationEvents,
  type EventLifecycle,
} from '@/lib/events'
import { cn } from '@/lib/utils'
import type { OrganizerEvent } from '@/lib/supabase'

const TABS: { key: EventLifecycle | 'upcoming'; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'draft', label: 'Drafts' },
  { key: 'live', label: 'Live' },
  { key: 'completed', label: 'Past' },
  { key: 'archived', label: 'Archived' },
]

function EventCard({ event, count }: { event: OrganizerEvent; count: number }) {
  const lifecycle = eventLifecycle(event)
  const capacityLabel = event.capacity ? `${count} / ${event.capacity}` : `${count}`
  const full = event.capacity !== null && count >= event.capacity

  return (
    <Link to={`/organizer/events/${event.id}`} className="block">
      <Card className="transition-colors hover:border-primary-300">
        <CardContent className="flex gap-4">
          {event.image_url ? (
            <img
              src={event.image_url}
              alt=""
              className="hidden h-20 w-28 shrink-0 rounded-md object-cover sm:block"
            />
          ) : (
            <div className="hidden h-20 w-28 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-300 sm:flex">
              <CalendarRange className="h-6 w-6" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-gray-900">{event.name}</h3>
              <Badge variant={LIFECYCLE_BADGE[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
              {event.visibility === 'unlisted' && <Badge variant="gray">Unlisted</Badge>}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5" />
                {formatEventDate(event)}
              </span>
              {event.location && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{event.location}</span>
                </span>
              )}
              <span className={cn('inline-flex items-center gap-1.5', full && 'font-medium text-warning-700')}>
                <Users className="h-3.5 w-3.5" />
                {capacityLabel} registered{full ? ' · full' : ''}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function EventsListPage() {
  const { organization, role, loading: orgLoading } = useOrganizer()
  const [events, setEvents] = useState<OrganizerEvent[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('upcoming')

  const orgId = organization?.id ?? null
  const canCreate = canManageTeam(role)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const result = await listOrganizationEvents(orgId)
    setEvents(result.data)
    setCounts(result.counts)
    setError(result.error)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const byTab: Record<string, OrganizerEvent[]> = {
      upcoming: [],
      draft: [],
      live: [],
      completed: [],
      archived: [],
    }
    for (const event of events) {
      const lifecycle = eventLifecycle(event)
      if (lifecycle === 'published') byTab.upcoming.push(event)
      else byTab[lifecycle]?.push(event)
    }
    return byTab
  }, [events])

  if (orgLoading) return <LoadingState message="Loading events…" />
  if (!organization) return null

  const visible = grouped[tab] ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Events</h1>
          <p className="mt-1 text-sm text-gray-500">Events run by {organization.name}.</p>
        </div>
        {canCreate && (
          <Link to="/organizer/events/new" className="shrink-0">
            <Button>
              <CalendarPlus className="h-4 w-4" />
              New event
            </Button>
          </Link>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {/* Horizontally scrollable on narrow screens rather than wrapping into a
          second row that pushes the list down. */}
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max gap-1 border-b border-gray-200 md:w-full">
          {TABS.map((t) => {
            const n = grouped[t.key]?.length ?? 0
            return (
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
                {n > 0 && <span className="ml-1.5 text-xs text-gray-400">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading events…" />
      ) : visible.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CalendarRange className="h-8 w-8" />}
              title={
                tab === 'draft'
                  ? 'No drafts'
                  : tab === 'live'
                    ? 'Nothing running right now'
                    : tab === 'completed'
                      ? 'No past events yet'
                      : tab === 'archived'
                        ? 'Nothing archived'
                        : 'No upcoming events'
              }
              description={
                tab === 'draft'
                  ? 'Events you are still working on appear here until you publish them.'
                  : tab === 'live'
                    ? 'Mark an event live from its page when it starts, so your team can see what is running.'
                    : tab === 'completed'
                      ? 'Events show up here once you mark them finished.'
                      : tab === 'archived'
                        ? 'Archiving puts an event away without deleting it. Nothing is ever destroyed.'
                        : 'Create an event and publish it when you are ready for attendees to see it.'
              }
              action={
                canCreate && tab !== 'archived' && tab !== 'completed' ? (
                  <Link to="/organizer/events/new">
                    <Button size="sm">
                      <CalendarPlus className="h-4 w-4" />
                      New event
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((event) => (
            <EventCard key={event.id} event={event} count={counts[event.id] ?? 0} />
          ))}
        </div>
      )}
    </div>
  )
}
