import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Plus, Users, X, CalendarClock, AlertCircle, Clock, Filter, MessageSquare } from 'lucide-react'
import { supabase, type Connection, type FollowUp, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { ErrorState, EmptyState } from '@/components/ui/States'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import ConnectionRequestsPanel from '@/components/connections/ConnectionRequestsPanel'
import {
  cancelConnectionRequest,
  fetchMyConnectionRequests,
  friendlyRequestError,
  respondToConnectionRequest,
  type ConnectionRequest,
} from '@/lib/connectionRequests'
import { normalizeUrl } from '@/lib/utils'
import { cn } from '@/lib/utils'

type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'none'

const PAGE_SIZE = 9

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

function formatDayMonth(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NetworkSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl" aria-hidden="true">
      <div className="h-10 w-48 animate-pulse rounded bg-slate-100" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3 rounded-2xl border border-rally-line bg-white p-5">
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
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

type FollowUpFilter = 'all' | 'none' | 'scheduled' | 'overdue'

type AdvancedFilters = {
  relationshipType: string
  event: string
  followUp: FollowUpFilter
}

const DEFAULT_FILTERS: AdvancedFilters = { relationshipType: 'all', event: 'all', followUp: 'all' }

const FOLLOW_UP_FILTER_OPTIONS: { value: FollowUpFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'none', label: 'No follow-up' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'overdue', label: 'Overdue' },
]

function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterOptionPill({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'min-h-[40px] rounded-xl px-3.5 text-[13px] font-semibold transition-colors',
        selected ? 'bg-primary-600 text-white' : 'bg-rally-canvas text-rally-muted ring-1 ring-rally-line hover:bg-rally-tint'
      )}
    >
      {label}
    </button>
  )
}

export default function ConnectionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [messagingId, setMessagingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [followUpMap, setFollowUpMap] = useState<Record<string, FollowUp[]>>({})
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TabKey>('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [filters, setFilters] = useState<AdvancedFilters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState<AdvancedFilters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

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

  // Open connection requests, both directions. If they cannot be read (for example
  // before the backend feature is installed) the page simply shows none.
  const [requests, setRequests] = useState<ConnectionRequest[]>([])
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)

  async function loadRequests() {
    const { data, error: reqError } = await fetchMyConnectionRequests()
    setRequests(reqError ? [] : data)
  }

  async function handleRespond(request: ConnectionRequest, accept: boolean) {
    setBusyRequestId(request.id)
    setRequestError(null)
    const { error: respondError } = await respondToConnectionRequest(request.id, accept)
    setBusyRequestId(null)
    if (respondError) setRequestError(friendlyRequestError(respondError, 'Could not answer the request. Please try again.'))
    await Promise.all([loadRequests(), loadConnections()])
  }

  async function handleCancelRequest(request: ConnectionRequest) {
    setBusyRequestId(request.id)
    setRequestError(null)
    const { error: cancelError } = await cancelConnectionRequest(request.id)
    setBusyRequestId(null)
    if (cancelError) setRequestError(friendlyRequestError(cancelError, 'Could not withdraw the request. Please try again.'))
    await loadRequests()
  }

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
    void loadRequests()
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
  function openFilters() {
    setDraftFilters(filters)
    setShowFilters(true)
  }

  function applyFilters() {
    setFilters(draftFilters)
    setShowFilters(false)
  }

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

  const eventNames = useMemo(
    () => [...new Set(connections.map((c) => c.event_name).filter(Boolean))].sort(),
    [connections]
  )

  const activeFilterCount = useMemo(
    () =>
      (filters.relationshipType !== 'all' ? 1 : 0) +
      (filters.event !== 'all' ? 1 : 0) +
      (filters.followUp !== 'all' ? 1 : 0),
    [filters]
  )

  const filtered = connections.filter((conn) => {
    const matchesSearch =
      !search ||
      conn.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (conn.company || '').toLowerCase().includes(search.toLowerCase()) ||
      (conn.job_title || '').toLowerCase().includes(search.toLowerCase())
    const state = followUpStateById[conn.id]
    const matchesTab =
      tab === 'all' || (tab === 'overdue' ? state === 'overdue' : state === 'upcoming' || state === 'today')
    const matchesFilters =
      (filters.relationshipType === 'all' || conn.relationship_type === filters.relationshipType) &&
      (filters.event === 'all' || conn.event_name === filters.event) &&
      (filters.followUp === 'all' ||
        (filters.followUp === 'none' && state === 'none') ||
        (filters.followUp === 'scheduled' && (state === 'upcoming' || state === 'today')) ||
        (filters.followUp === 'overdue' && state === 'overdue'))
    return matchesSearch && matchesTab && matchesFilters
  })

  const totalCount = connections.length
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // Opens (or creates) the direct conversation. Only people who are on Rally have
  // a connected_user_id, so only they get a Message button.
  async function openConversation(conn: Connection) {
    if (!conn.connected_user_id) return
    setMessagingId(conn.id)
    setActionError(null)
    const { data, error: rpcError } = await supabase.rpc('create_direct_conversation', {
      other_user_id: conn.connected_user_id,
      event_id: conn.event_id,
    })
    setMessagingId(null)
    if (rpcError || !data) {
      setActionError(rpcError?.message || 'Could not open that conversation. Please try again.')
      return
    }
    navigate(`/messages/${data}`)
  }

  if (loading) return <NetworkSkeleton />
  if (error) return <ErrorState message={error} onRetry={loadConnections} />

  const filterPanel = (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-gray-900">Filter</p>
      <FilterSection label="Relationship type">
        <FilterOptionPill label="All" selected={draftFilters.relationshipType === 'all'} onClick={() => setDraftFilters({ ...draftFilters, relationshipType: 'all' })} />
        {RELATIONSHIP_TYPES.map((t) => (
          <FilterOptionPill key={t} label={t} selected={draftFilters.relationshipType === t} onClick={() => setDraftFilters({ ...draftFilters, relationshipType: t })} />
        ))}
      </FilterSection>
      <FilterSection label="Event">
        <FilterOptionPill label="All events" selected={draftFilters.event === 'all'} onClick={() => setDraftFilters({ ...draftFilters, event: 'all' })} />
        {eventNames.map((name) => (
          <FilterOptionPill key={name} label={name} selected={draftFilters.event === name} onClick={() => setDraftFilters({ ...draftFilters, event: name })} />
        ))}
      </FilterSection>
      <FilterSection label="Follow-up">
        {FOLLOW_UP_FILTER_OPTIONS.map(({ value, label }) => (
          <FilterOptionPill key={value} label={label} selected={draftFilters.followUp === value} onClick={() => setDraftFilters({ ...draftFilters, followUp: value })} />
        ))}
      </FilterSection>
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <button
          onClick={() => setDraftFilters(DEFAULT_FILTERS)}
          className="text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          Clear all
        </button>
        <Button size="sm" onClick={applyFilters}>Apply</Button>
      </div>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="My Network"
        description={
          totalCount > 0
            ? `${totalCount} relationship${totalCount === 1 ? '' : 's'} across ${eventNames.length || 'your'} event${eventNames.length === 1 ? '' : 's'}. Track follow-ups and keep every connection moving.`
            : 'The people you meet at events, and what happens next.'
        }
        actions={
          <Button size="lg" className="rounded-xl" onClick={() => setShowAddForm(!showAddForm)} aria-label={showAddForm ? 'Cancel adding connection' : 'Add connection'}>
            {showAddForm ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {showAddForm ? 'Cancel' : 'Add connection'}
          </Button>
        }
      />

      {requests.length > 0 && (
        <section id="requests" className="mt-5 scroll-mt-20" aria-label="Connection requests">
          {requestError && (
            <p role="alert" className="mb-3 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700">
              {requestError}
            </p>
          )}
          <ConnectionRequestsPanel requests={requests} busyId={busyRequestId} onRespond={(r, a) => void handleRespond(r, a)} onCancel={(r) => void handleCancelRequest(r)} />
        </section>
      )}

      {/* Real counts only */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total network', value: counts.all, hint: 'connections', icon: Users, tone: 'bg-rally-tint text-primary-600' },
          { label: 'Overdue', value: counts.overdue, hint: counts.overdue > 0 ? 'need a follow-up' : 'all caught up', icon: AlertCircle, tone: counts.overdue > 0 ? 'bg-error-50 text-error-600' : 'bg-accent-50 text-accent-600' },
          { label: 'Upcoming', value: counts.upcoming, hint: 'follow-ups scheduled', icon: CalendarClock, tone: 'bg-warning-50 text-warning-600' },
          { label: 'Events', value: eventNames.length, hint: 'where you connected', icon: Clock, tone: 'bg-slate-100 text-slate-600' },
        ].map((s) => (
          <div key={s.label} className="flex items-start justify-between gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500 md:text-sm">{s.label}</p>
              <p className="mt-1 font-display text-3xl font-bold text-rally-navy">{s.value}</p>
              <p className={cn('text-xs', s.label === 'Overdue' && counts.overdue > 0 ? 'font-semibold text-error-600' : 'text-slate-500')}>{s.hint}</p>
            </div>
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', s.tone)}>
              <s.icon className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        ))}
      </div>

      {showAddForm && (
        <Card className="mt-5 rounded-2xl shadow-card">
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

      {/* Search, tabs and the advanced filter */}
      <div className="mt-5 space-y-3">
        <label className="relative block">
          <span className="sr-only">Search connections</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search connections by name, company or job title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
          />
        </label>

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Follow-up status">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => {
                  setTab(key)
                  setPage(1)
                }}
                className={cn(
                  'min-h-[44px] shrink-0 rounded-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                  tab === key ? 'border-primary-600 bg-primary-600 text-white' : 'border-rally-line bg-white text-rally-muted hover:border-primary-300 hover:text-rally-navy'
                )}
              >
                {label} <span className={tab === key ? 'text-white/80' : 'text-slate-400'}>({counts[key]})</span>
              </button>
            ))}
          </div>
          <button
            onClick={openFilters}
            aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'}
            className={cn(
              'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
              activeFilterCount ? 'border-primary-600 bg-rally-tint text-primary-700' : 'border-rally-line bg-white text-slate-600 hover:border-primary-300'
            )}
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {showFilters && (
            <>
              <button className="fixed inset-0 z-40 hidden cursor-default md:block" aria-hidden="true" tabIndex={-1} onClick={() => setShowFilters(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 hidden max-h-[70vh] w-80 overflow-y-auto rounded-2xl border border-rally-line bg-white p-4 shadow-float md:block">
                {filterPanel}
              </div>
            </>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-rally-ink/50" aria-hidden="true" tabIndex={-1} onClick={() => setShowFilters(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden="true" />
            {filterPanel}
          </div>
        </div>
      )}

      {actionError && <p className="mt-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">{actionError}</p>}

      <p className="mt-4 text-sm text-rally-muted" aria-live="polite">
        Showing {filtered.length} of {connections.length}
      </p>

      <div className="mt-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-rally-line bg-white py-10 shadow-card">
            {connections.length === 0 ? (
              <EmptyState
                icon={<Users className="h-10 w-10" />}
                title="Your network is empty"
                description="Connect with people at events to start building your professional network."
              />
            ) : tab !== 'all' && !search && activeFilterCount === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-10 w-10" />}
                title={EMPTY_PER_TAB[tab].title}
                description={EMPTY_PER_TAB[tab].description}
              />
            ) : (
              <EmptyState
                icon={<Search className="h-10 w-10" />}
                title="No connections found"
                description="Try a different search term or filter."
              />
            )}
          </div>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((conn) => {
                const nextFollowUp = followUpMap[conn.id]?.[0]
                const state = followUpStateById[conn.id]
                return (
                  <li key={conn.id} className="flex flex-col gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card sm:p-5">
                    <Link to={`/connections/${conn.id}`} className="flex items-start gap-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                      <Avatar name={conn.full_name} src={conn.photo_url} size="lg" />
                      <div className="min-w-0 flex-1">
                        <h2 className="font-display text-base font-semibold leading-snug text-rally-navy">{conn.full_name}</h2>
                        {conn.job_title && <p className="text-sm text-rally-muted">{conn.job_title}</p>}
                        {conn.company && <p className="truncate text-sm text-slate-500">{conn.company}</p>}
                      </div>
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      {conn.relationship_type && (
                        <span className="rounded-md bg-rally-tint px-2 py-0.5 text-[11px] font-semibold text-primary-700">{conn.relationship_type}</span>
                      )}
                      {conn.event_name && (
                        <span className="min-w-0 truncate text-xs text-slate-500">Met at {conn.event_name} · {formatDayMonth(conn.created_at)}</span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'flex items-start gap-2.5 rounded-xl border p-3 text-sm',
                        state === 'overdue' ? 'border-error-200 bg-error-50' : state === 'none' ? 'border-dashed border-slate-300 bg-slate-50/70' : 'border-rally-line bg-rally-canvas'
                      )}
                    >
                      {state === 'overdue' ? (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error-600" aria-hidden="true" />
                      ) : (
                        <Clock className={cn('mt-0.5 h-4 w-4 shrink-0', state === 'none' ? 'text-slate-300' : 'text-primary-600')} aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        {state === 'none' ? (
                          <p className="text-slate-500">Follow-up not scheduled</p>
                        ) : (
                          <>
                            <p className={cn('font-semibold', state === 'overdue' ? 'text-error-700' : 'text-rally-navy')}>
                              {state === 'overdue' ? 'Overdue' : state === 'today' ? 'Due today' : 'Follow-up scheduled'}
                              {nextFollowUp && <span className="font-normal text-slate-500"> · {formatDayMonth(nextFollowUp.due_date)}</span>}
                            </p>
                            {nextFollowUp?.title && <p className="truncate text-slate-600">{nextFollowUp.title}</p>}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-auto flex gap-2 pt-1">
                      <Link
                        to={`/connections/${conn.id}`}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-rally-tint px-4 text-sm font-semibold text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                      >
                        View profile
                      </Link>
                      {conn.connected_user_id && (
                        <Button size="lg" className="flex-1 rounded-xl" disabled={messagingId === conn.id} onClick={() => void openConversation(conn)}>
                          <MessageSquare className="h-4 w-4" aria-hidden="true" /> {messagingId === conn.id ? 'Opening…' : 'Message'}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            {pageCount > 1 && (
              <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card md:flex-row md:justify-between">
                <p className="text-sm text-rally-muted">
                  Showing <span className="font-semibold text-rally-navy">{(currentPage - 1) * PAGE_SIZE + 1}–{(currentPage - 1) * PAGE_SIZE + pageItems.length}</span> of{' '}
                  <span className="font-semibold text-rally-navy">{filtered.length}</span>
                </p>
                <Pagination page={currentPage} pageCount={pageCount} onChange={(n) => { setPage(n); window.scrollTo({ top: 0 }) }} label="Connection pages" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
