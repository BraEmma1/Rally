import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Users, X, QrCode, ChevronRight, CalendarClock, AlertCircle, Clock } from 'lucide-react'
import { supabase, type Connection, type FollowUp, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, normalizeUrl } from '@/lib/utils'
import { cn } from '@/lib/utils'

type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'none'

function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Follow-up state comes only from real follow_ups rows — the soonest open one
// decides. Nothing is invented for people without a follow-up.
function classifyFollowUp(next: FollowUp | undefined): FollowUpState {
  if (!next) return 'none'
  const today = localDateString(new Date())
  if (next.due_date < today) return 'overdue'
  if (next.due_date === today) return 'today'
  return 'upcoming'
}

function followUpLabel(state: FollowUpState, dueDate: string): string {
  switch (state) {
    case 'overdue': {
      const days = Math.max(
        1,
        Math.round((new Date(localDateString(new Date())).getTime() - new Date(dueDate).getTime()) / 86400000)
      )
      return days === 1 ? 'Follow up yesterday' : `Follow up ${days} days ago`
    }
    case 'today':
      return 'Follow up today'
    case 'upcoming': {
      const days = Math.round(
        (new Date(dueDate).getTime() - new Date(localDateString(new Date())).getTime()) / 86400000
      )
      if (days === 1) return 'Follow up tomorrow'
      if (days <= 7) return `Follow up in ${days} days`
      return `Follow up ${formatDate(dueDate)}`
    }
    default:
      return 'No follow-up scheduled'
  }
}

const FOLLOW_UP_STYLES: Record<FollowUpState, string> = {
  overdue: 'text-error-600',
  today: 'text-primary-600 font-medium',
  upcoming: 'text-gray-500',
  none: 'text-gray-400',
}

function formatDayMonth(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NetworkSkeleton() {
  return (
    <Card>
      <CardContent className="divide-y divide-gray-100 py-0" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-gray-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-3 w-10 shrink-0 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

type TabKey = 'all' | 'overdue' | 'upcoming'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
]

const EMPTY_PER_TAB: Record<Exclude<TabKey, 'all'>, { title: string; description: string }> = {
  overdue: {
    title: 'No overdue follow-ups',
    description: 'You are all caught up — nothing is past its due date.',
  },
  upcoming: {
    title: 'No upcoming follow-ups',
    description: 'Schedule a follow-up from a connection to see it here.',
  },
}

export default function ConnectionsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [followUpMap, setFollowUpMap] = useState<Record<string, FollowUp[]>>({})
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [tab, setTab] = useState<TabKey>('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [newConn, setNewConn] = useState({
    full_name: '',
    job_title: '',
    company: '',
    industry: '',
    email: '',
    phone: '',
    linkedin: '',
    relationship_type: 'Other',
    event_name: '',
    follow_up_date: '',
    notes: '',
  })

  async function loadConnections() {
    if (!user) return
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await supabase
      .from('connections')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
    if (queryError) {
      setError(queryError.message)
    } else {
      setConnections(data as Connection[])
      // Load pending follow-ups for all connections
      const { data: followData } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('owner_id', user.id)
        .eq('completed', false)
        .order('due_date', { ascending: true })
      if (followData) {
        const map: Record<string, FollowUp[]> = {}
        for (const fu of followData as FollowUp[]) {
          if (!map[fu.connection_id]) map[fu.connection_id] = []
          map[fu.connection_id].push(fu)
        }
        setFollowUpMap(map)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    loadConnections()
  }, [user])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const linkedinUrl = newConn.linkedin.trim() ? normalizeUrl(newConn.linkedin) : ''
    if (linkedinUrl === null) {
      setFormError('LinkedIn must be a valid http(s) link.')
      return
    }

    setSaving(true)

    const { data: connData, error: connError } = await supabase
      .from('connections')
      .insert({
        owner_id: user.id,
        full_name: newConn.full_name,
        job_title: newConn.job_title || null,
        company: newConn.company || null,
        industry: newConn.industry || null,
        email: newConn.email || null,
        phone: newConn.phone || null,
        linkedin: linkedinUrl,
        relationship_type: newConn.relationship_type,
        event_name: newConn.event_name || null,
        follow_up_date: newConn.follow_up_date || null,
      })
      .select()
      .single()

    if (connError) {
      setFormError(connError.message)
      setSaving(false)
      return
    }

    if (newConn.notes && connData) {
      await supabase.from('notes').insert({
        connection_id: connData.id,
        owner_id: user.id,
        content: newConn.notes,
      })
    }

    setNewConn({
      full_name: '', job_title: '', company: '', industry: '',
      email: '', phone: '', linkedin: '', relationship_type: 'Other',
      event_name: '', follow_up_date: '', notes: '',
    })
    setShowAddForm(false)
    setSaving(false)
    loadConnections()
  }

  // Follow-up state per connection, computed once for tabs and rows.
  const followUpStateById = useMemo(() => {
    const map: Record<string, FollowUpState> = {}
    for (const conn of connections) {
      map[conn.id] = classifyFollowUp(followUpMap[conn.id]?.[0])
    }
    return map
  }, [connections, followUpMap])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: connections.length, overdue: 0, upcoming: 0 }
    for (const conn of connections) {
      const state = followUpStateById[conn.id]
      if (state === 'overdue') c.overdue += 1
      else if (state === 'upcoming' || state === 'today') c.upcoming += 1
    }
    return c
  }, [connections, followUpStateById])

  const filtered = connections.filter((conn) => {
    const matchesSearch =
      !search ||
      conn.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (conn.company || '').toLowerCase().includes(search.toLowerCase()) ||
      (conn.job_title || '').toLowerCase().includes(search.toLowerCase())
    const matchesType = filterType === 'all' || conn.relationship_type === filterType
    const state = followUpStateById[conn.id]
    const matchesTab =
      tab === 'all' || (tab === 'overdue' ? state === 'overdue' : state === 'upcoming' || state === 'today')
    return matchesSearch && matchesType && matchesTab
  })

  if (loading) return <NetworkSkeleton />
  if (error) return <ErrorState message={error} onRetry={loadConnections} />

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Network</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your professional relationships and follow-ups.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/scan">
            <Button variant="outline">
              <QrCode className="h-4 w-4" /> Scan QR
            </Button>
          </Link>
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Add connection</>}
          </Button>
        </div>
      </div>

      {showAddForm && (
        <Card className="mt-4">
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="full_name">Full name *</Label>
                  <Input id="full_name" required value={newConn.full_name} onChange={(e) => setNewConn({ ...newConn, full_name: e.target.value })} placeholder="John Doe" />
                </div>
                <div>
                  <Label htmlFor="job_title">Job title</Label>
                  <Input id="job_title" value={newConn.job_title} onChange={(e) => setNewConn({ ...newConn, job_title: e.target.value })} placeholder="VP of Sales" />
                </div>
                <div>
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" value={newConn.company} onChange={(e) => setNewConn({ ...newConn, company: e.target.value })} placeholder="Acme Inc." />
                </div>
                <div>
                  <Label htmlFor="industry">Industry</Label>
                  <Input id="industry" value={newConn.industry} onChange={(e) => setNewConn({ ...newConn, industry: e.target.value })} placeholder="FinTech" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={newConn.email} onChange={(e) => setNewConn({ ...newConn, email: e.target.value })} placeholder="john@acme.com" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone / WhatsApp</Label>
                  <Input id="phone" value={newConn.phone} onChange={(e) => setNewConn({ ...newConn, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div>
                  <Label htmlFor="linkedin">LinkedIn URL</Label>
                  <Input id="linkedin" value={newConn.linkedin} onChange={(e) => setNewConn({ ...newConn, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
                </div>
                <div>
                  <Label htmlFor="relationship_type">Relationship type</Label>
                  <Select id="relationship_type" value={newConn.relationship_type} onChange={(e) => setNewConn({ ...newConn, relationship_type: e.target.value })}>
                    {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="event_name">Met at event</Label>
                  <Input id="event_name" value={newConn.event_name} onChange={(e) => setNewConn({ ...newConn, event_name: e.target.value })} placeholder="TechConf 2026" />
                </div>
                <div>
                  <Label htmlFor="follow_up_date">Follow-up date</Label>
                  <Input id="follow_up_date" type="date" value={newConn.follow_up_date} onChange={(e) => setNewConn({ ...newConn, follow_up_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">Initial notes</Label>
                <Textarea id="notes" rows={2} value={newConn.notes} onChange={(e) => setNewConn({ ...newConn, notes: e.target.value })} placeholder="Context about how you met, topics discussed…" />
              </div>
              {formError && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{formError}</div>}
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search + relationship type filter */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search by name, company, or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="sm:w-44">
          <option value="all">All types</option>
          {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      {/* Follow-up tabs */}
      <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-full sm:flex-wrap">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === key
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
              )}
            >
              {label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  tab === key
                    ? 'bg-white/20 text-white'
                    : key === 'overdue' && counts.overdue > 0
                      ? 'bg-error-50 text-error-600'
                      : 'bg-gray-100 text-gray-500'
                )}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="mt-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent>
              {connections.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-10 w-10" />}
                  title="No connections yet"
                  description="Add people you meet at events to keep track of your network."
                  action={
                    <Button size="sm" onClick={() => setShowAddForm(true)}>
                      <Plus className="h-4 w-4" /> Add connection
                    </Button>
                  }
                />
              ) : tab !== 'all' && !search && filterType === 'all' ? (
                <EmptyState
                  icon={<CalendarClock className="h-10 w-10" />}
                  title={EMPTY_PER_TAB[tab].title}
                  description={EMPTY_PER_TAB[tab].description}
                />
              ) : (
                <EmptyState
                  icon={<Search className="h-10 w-10" />}
                  title="No matching connections"
                  description="Try a different search term, type, or tab."
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-gray-100 py-0">
              {filtered.map((conn) => {
                const nextFollowUp = followUpMap[conn.id]?.[0]
                const state = followUpStateById[conn.id]
                const identity = [conn.job_title, conn.company].filter(Boolean).join(' | ')
                return (
                  <Link
                    key={conn.id}
                    to={`/connections/${conn.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50"
                  >
                    <Avatar name={conn.full_name} src={conn.photo_url} size="md" className="h-11 w-11 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold leading-tight text-gray-900 sm:text-base">
                        {conn.full_name}
                      </p>
                      {identity && (
                        <p className="mt-0.5 truncate text-[13px] leading-tight text-gray-500 sm:text-sm">
                          {identity}
                        </p>
                      )}
                      <p
                        className={cn(
                          'mt-0.5 flex items-center gap-1 truncate text-[13px] leading-tight',
                          FOLLOW_UP_STYLES[state]
                        )}
                      >
                        {state === 'overdue' ? (
                          <>
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            <span className="font-medium">Overdue</span>
                            {nextFollowUp?.title && <> · {nextFollowUp.title}</>}
                          </>
                        ) : state === 'none' ? (
                          'No follow-up scheduled'
                        ) : (
                          <>
                            <Clock className="h-3 w-3 shrink-0" />
                            <span>Follow up · {nextFollowUp?.title || followUpLabel(state, nextFollowUp!.due_date)}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {nextFollowUp && (
                        <p
                          className={cn(
                            'text-[13px]',
                            state === 'overdue' ? 'font-medium text-error-600' : 'text-gray-500'
                          )}
                        >
                          {formatDayMonth(nextFollowUp.due_date)}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                  </Link>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
