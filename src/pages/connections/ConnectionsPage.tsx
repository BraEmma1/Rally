import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Users, X, CalendarClock, AlertCircle, Clock, Filter } from 'lucide-react'
import { supabase, type Connection, type FollowUp, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { ErrorState, EmptyState } from '@/components/ui/States'
import { normalizeUrl } from '@/lib/utils'
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

const FOLLOW_UP_STYLES: Record<FollowUpState, string> = {
  overdue: 'text-error-600',
  today: 'text-gray-600',
  upcoming: 'text-gray-600',
  none: 'text-gray-400',
}

const STATUS_ICON_STYLES: Record<FollowUpState, string> = {
  overdue: 'text-error-500',
  today: 'text-primary-500',
  upcoming: 'text-primary-500',
  none: 'text-gray-300',
}

function formatDayMonth(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NetworkSkeleton() {
  return (
    <div className="mt-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 px-1 py-4">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-gray-200" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="h-3 w-10 shrink-0 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}

type TabKey = 'all' | 'overdue' | 'upcoming'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
]

const TAB_TINTS: Record<TabKey, { base: string; selected: string }> = {
  all: { base: 'bg-primary-50 text-primary-700', selected: 'ring-1 ring-primary-300' },
  overdue: { base: 'bg-error-50 text-error-600', selected: 'ring-1 ring-error-300' },
  upcoming: { base: 'bg-gray-100 text-gray-600', selected: 'ring-1 ring-gray-300' },
}

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
        'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
        selected ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      )}
    >
      {label}
    </button>
  )
}

export default function ConnectionsPage() {
  const { user } = useAuth()
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
    <div className="mx-auto max-w-xl">
      {/* Compact header */}
      <div className="flex items-center justify-between py-1">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Network</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          aria-label={showAddForm ? 'Cancel adding connection' : 'Add connection'}
          className="flex h-10 w-10 items-center justify-center rounded-full text-primary-600 transition-colors hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          {showAddForm ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </button>
      </div>

      {showAddForm && (
        <Card className="mt-3">
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

      {/* Filter pills + advanced filter, one row */}
      <div className="relative mt-3 flex items-center justify-between gap-1.5 sm:gap-2">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {TABS.map(({ key, label }) => {
            const tint = TAB_TINTS[key]
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                  tint.base,
                  tab === key ? cn(tint.selected, 'font-semibold') : 'opacity-80 hover:opacity-100'
                )}
              >
                {label} ({counts[key]})
              </button>
            )
          })}
        </div>
        <button
          onClick={openFilters}
          aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'}
          className={cn(
            'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
            activeFilterCount ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
            <button
              className="fixed inset-0 z-40 hidden cursor-default md:block"
              aria-hidden="true"
              onClick={() => setShowFilters(false)}
            />
            <div className="absolute right-0 top-full z-50 mt-2 hidden max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-gray-100 bg-white p-4 shadow-lg md:block">
              {filterPanel}
            </div>
          </>
        )}
      </div>

      {showFilters && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={() => setShowFilters(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200" aria-hidden="true" />
            {filterPanel}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search connections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-transparent bg-gray-100 py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-300"
        />
      </div>

      {/* List — sits directly on the page background, no outer card */}
      <div className="mt-2">
        {filtered.length === 0 ? (
          <div className="py-10">
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
          <ul>
            {filtered.map((conn, index) => {
              const nextFollowUp = followUpMap[conn.id]?.[0]
              const state = followUpStateById[conn.id]
              const identity = [conn.job_title, conn.company].filter(Boolean).join(' | ')
              return (
                <li key={conn.id}>
                  {index > 0 && <div className="ml-16 h-px bg-gray-100" aria-hidden="true" />}
                  <Link
                    to={`/connections/${conn.id}`}
                    className="flex items-start gap-4 px-1 py-4 transition-colors hover:bg-gray-50"
                  >
                    <Avatar
                      name={conn.full_name}
                      src={conn.photo_url}
                      size="md"
                      className="h-12 w-12 shrink-0 text-base sm:h-14 sm:w-14 sm:text-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-[15px] font-semibold leading-snug text-gray-900 sm:text-[17px]">
                          {conn.full_name}
                        </p>
                        {nextFollowUp && (
                          <p
                            className={cn(
                              'shrink-0 pt-0.5 text-[13px]',
                              state === 'overdue' ? 'font-medium text-error-600' : 'text-gray-500'
                            )}
                          >
                            {formatDayMonth(nextFollowUp.due_date)}
                          </p>
                        )}
                      </div>
                      {identity && (
                        <p className="mt-0.5 truncate text-[13px] leading-snug text-gray-500 sm:text-sm">
                          {identity}
                        </p>
                      )}
                      <p
                        className={cn(
                          'mt-1 flex items-center gap-1.5 truncate text-[13px] leading-snug',
                          FOLLOW_UP_STYLES[state]
                        )}
                      >
                        {state === 'overdue' ? (
                          <>
                            <AlertCircle className={cn('h-3.5 w-3.5 shrink-0 fill-error-500 text-white', STATUS_ICON_STYLES.overdue)} />
                            <span className="font-medium">Overdue</span>
                            {nextFollowUp?.title && <><span className="text-gray-300">·</span> {nextFollowUp.title}</>}
                          </>
                        ) : state === 'none' ? (
                          <>
                            <Clock className={cn('h-3.5 w-3.5 shrink-0', STATUS_ICON_STYLES.none)} />
                            Follow-up not scheduled
                          </>
                        ) : (
                          <>
                            <Clock className={cn('h-3.5 w-3.5 shrink-0', STATUS_ICON_STYLES[state])} />
                            <span>Follow up{nextFollowUp?.title ? ` · ${nextFollowUp.title}` : ''}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
