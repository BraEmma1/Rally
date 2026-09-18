import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  CalendarClock,
  Target,
  Calendar,

  ArrowRight,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { supabase, type Connection, type FollowUp, type EventRow } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatRelativeDate, formatDate } from '@/lib/utils'

export default function DashboardPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [totalConnections, setTotalConnections] = useState(0)
  const [pendingFollowUps, setPendingFollowUps] = useState(0)
  const [opportunities, setOpportunities] = useState(0)

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [connRes, followRes, eventRes, oppRes] = await Promise.all([
        supabase
          .from('connections')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('follow_ups')
          .select('*')
          .eq('owner_id', user.id)
          .eq('completed', false)
          .order('due_date', { ascending: true })
          .limit(5),
        supabase
          .from('events')
          .select('*')
          .eq('owner_id', user.id)
          .order('start_date', { ascending: true })
          .limit(3),
        supabase
          .from('connections')
          .select('id')
          .eq('owner_id', user.id)
          .eq('relationship_type', 'Prospect'),
      ])

      if (connRes.error) throw connRes.error
      if (followRes.error) throw followRes.error
      if (eventRes.error) throw eventRes.error
      if (oppRes.error) throw oppRes.error

      setConnections(connRes.data as Connection[])
      setFollowUps(followRes.data as FollowUp[])
      setEvents(eventRes.data as EventRow[])

      const countRes = await supabase
        .from('connections')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
      setTotalConnections(countRes.count ?? 0)

      const followCountRes = await supabase
        .from('follow_ups')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .eq('completed', false)
      setPendingFollowUps(followCountRes.count ?? 0)

      setOpportunities(oppRes.data?.length ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [user])

  if (loading) return <LoadingState message="Loading your dashboard…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const stats = [
    {
      label: 'Total Connections',
      value: totalConnections,
      icon: Users,
      color: 'text-primary-600',
      bg: 'bg-primary-50',
    },
    {
      label: 'Pending Follow-ups',
      value: pendingFollowUps,
      icon: CalendarClock,
      color: 'text-warning-600',
      bg: 'bg-warning-50',
    },
    {
      label: 'Open Opportunities',
      value: opportunities,
      icon: Target,
      color: 'text-accent-600',
      bg: 'bg-accent-50',
    },
    {
      label: 'Upcoming Events',
      value: events.filter((e) => e.status === 'upcoming').length,
      icon: Calendar,
      color: 'text-gray-600',
      bg: 'bg-gray-100',
    },
  ]

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Your networking overview at a glance</p>

      {/* Stats grid */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-md ${stat.bg}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent connections */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Connections</CardTitle>
              <Link to="/connections" className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <EmptyState
                icon={<Users className="h-10 w-10" />}
                title="No connections yet"
                description="Add people you meet at events to start building your network."
                action={<Link to="/connections"><span className="text-sm font-medium text-primary-600 hover:text-primary-700">Add your first connection</span></Link>}
              />
            ) : (
              <div className="space-y-3">
                {connections.map((conn) => (
                  <Link
                    key={conn.id}
                    to={`/connections/${conn.id}`}
                    className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-gray-50"
                  >
                    <Avatar name={conn.full_name} src={conn.photo_url} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{conn.full_name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {conn.job_title}{conn.company ? ` at ${conn.company}` : ''}
                      </p>
                    </div>
                    <Badge variant="gray">{conn.relationship_type}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Follow-ups */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Upcoming Follow-ups</CardTitle>
              <Link to="/connections" className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {followUps.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-10 w-10" />}
                title="No pending follow-ups"
                description="Schedule follow-ups with your connections to stay in touch."
              />
            ) : (
              <div className="space-y-3">
                {followUps.map((fu) => {
                  const dueDate = new Date(fu.due_date)
                  const isOverdue = dueDate < new Date(new Date().toDateString())
                  const conn = connections.find((c) => c.id === fu.connection_id)
                  return (
                    <div key={fu.id} className="flex items-center gap-3 rounded-md p-2">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-md ${isOverdue ? 'bg-error-50' : 'bg-warning-50'}`}>
                        <Clock className={`h-4 w-4 ${isOverdue ? 'text-error-600' : 'text-warning-600'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{fu.title}</p>
                        <p className="truncate text-xs text-gray-500">
                          {conn?.full_name || 'Unknown'} · {formatRelativeDate(fu.due_date)}
                        </p>
                      </div>
                      {isOverdue && <Badge variant="error">Overdue</Badge>}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Events */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Events</CardTitle>
            <Link to="/events" className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState
              icon={<Calendar className="h-10 w-10" />}
              title="No events yet"
              description="Track events you're attending to plan your networking."
              action={<Link to="/events"><span className="text-sm font-medium text-primary-600 hover:text-primary-700">Add an event</span></Link>}
            />
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="flex items-center gap-3 rounded-md p-2">
                  <div className="flex h-10 w-10 flex-col items-center justify-center rounded-md bg-primary-50 text-primary-700">
                    <span className="text-xs font-medium">
                      {event.start_date ? new Date(event.start_date).toLocaleDateString('en-US', { month: 'short' }) : '?'}
                    </span>
                    <span className="text-sm font-bold leading-none">
                      {event.start_date ? new Date(event.start_date).getDate() : '—'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{event.name}</p>
                    <p className="truncate text-xs text-gray-500">
                      {formatDate(event.start_date)}{event.location ? ` · ${event.location}` : ''}
                    </p>
                  </div>
                  <Badge variant={event.status === 'upcoming' ? 'primary' : event.status === 'attended' ? 'success' : 'gray'}>
                    {event.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
