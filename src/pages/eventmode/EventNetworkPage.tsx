import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Check, Clock, MapPin, MessageSquare, ScanLine, Search, UserPlus, Users, X } from 'lucide-react'
import { supabase, type Connection } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useEventModeId } from '@/context/EventModeContext'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import EventModeConnectFlow from '@/components/eventmode/EventModeConnectFlow'
import ConnectChoiceSheet from '@/components/eventmode/ConnectChoiceSheet'
import ConnectionRequestsPanel from '@/components/connections/ConnectionRequestsPanel'
import { listEventDirectory, type EventDirectoryEntry } from '@/lib/checkin'
import {
  cancelConnectionRequest,
  fetchMyConnectionRequests,
  friendlyRequestError,
  respondToConnectionRequest,
  sendConnectionRequest,
  type ConnectionRequest,
} from '@/lib/connectionRequests'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/States'
import { cn } from '@/lib/utils'

// Event Mode attendee directory: networking inside ONE event, not the global
// Rally network. "All attendees" is the event's directory (public cards only, via
// the event_attendee_directory RPC); "My connections" is who you connected with
// here; "Requests" are open connection requests in both directions. Connect asks
// how: scan their QR code (the existing event connect flow, so the connection keeps
// the current event_id) or send a request they can accept. The design's match scores, check-in counts and saved
// views have no data behind them and are not shown.
type Scope = 'attendees' | 'connections' | 'requests'
const PAGE_SIZE = 9

// One card shape for both lists.
type Person = {
  key: string
  userId: string | null
  connectionId: string | null
  name: string
  jobTitle: string
  company: string
  industry: string
  location: string
  photo: string
  connected: boolean
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-rally-line bg-white p-4">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function EventNetworkPage() {
  const eventId = useEventModeId()
  const { event, eventBasePath, openScan } = useEventModeOutlet()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [scope, setScope] = useState<Scope>('attendees')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myConnections, setMyConnections] = useState<Connection[]>([])
  const [directory, setDirectory] = useState<EventDirectoryEntry[]>([])
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('all')
  const [location, setLocation] = useState('all')
  const [page, setPage] = useState(1)
  const [connectTarget, setConnectTarget] = useState<string | null>(null)
  const [messagingId, setMessagingId] = useState<string | null>(null)
  const [requests, setRequests] = useState<ConnectionRequest[]>([])
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [choiceTarget, setChoiceTarget] = useState<Person | null>(null)
  const [choiceSending, setChoiceSending] = useState(false)
  const [choiceError, setChoiceError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const [connRes, dirRes, reqRes] = await Promise.all([
      supabase
        .from('connections')
        .select('*')
        .eq('owner_id', user.id)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),
      listEventDirectory(eventId),
      fetchMyConnectionRequests(),
    ])

    if (connRes.error) setError('Could not load your connections for this event. Please try again.')
    else setMyConnections((connRes.data as Connection[]) || [])
    // The directory is attendees-only; someone unregistered just gets an
    // empty list rather than an error.
    if (!dirRes.error) setDirectory(dirRes.data)
    // Requests are an add-on: if they cannot be read, the directory still works.
    setRequests(reqRes.error ? [] : reqRes.data)
    setLoading(false)
  }, [eventId, user])

  useEffect(() => {
    void load()
  }, [load])

  const requestByUser = useMemo(() => {
    const map = new Map<string, ConnectionRequest>()
    for (const r of requests) map.set(r.other_user_id, r)
    return map
  }, [requests])

  const people: Person[] = useMemo(() => {
    if (scope === 'requests') return []
    if (scope === 'connections') {
      return myConnections.map((c) => ({
        key: c.id,
        userId: c.connected_user_id,
        connectionId: c.id,
        name: c.full_name,
        jobTitle: c.job_title,
        company: c.company,
        industry: c.industry,
        location: c.location,
        photo: c.photo_url,
        connected: true,
      }))
    }
    return directory.map((d) => ({
      key: d.user_id,
      userId: d.user_id,
      connectionId: null,
      name: d.full_name,
      jobTitle: d.job_title,
      company: d.company,
      industry: d.industry,
      location: d.location,
      photo: d.photo_url,
      connected: d.already_connected,
    }))
  }, [scope, myConnections, directory])

  const options = (pick: (p: Person) => string) => {
    const counts = new Map<string, number>()
    for (const p of people) {
      const v = pick(p).trim()
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }
  const industries = useMemo(() => options((p) => p.industry), [people])
  const locations = useMemo(() => options((p) => p.location), [people])

  const needle = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      people
        .filter(
          (p) =>
            (industry === 'all' || p.industry.trim() === industry) &&
            (location === 'all' || p.location.trim() === location) &&
            (!needle || `${p.name} ${p.jobTitle} ${p.company} ${p.industry} ${p.location}`.toLowerCase().includes(needle))
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people, needle, industry, location]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const filtering = needle !== '' || industry !== 'all' || location !== 'all'

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setPage(1)
    }
  }

  function switchScope(next: Scope) {
    setScope(next)
    setIndustry('all')
    setLocation('all')
    setPage(1)
  }

  async function handleSendRequest() {
    if (!choiceTarget?.userId) return
    setChoiceSending(true)
    setChoiceError(null)
    const { error: sendError } = await sendConnectionRequest(eventId, choiceTarget.userId)
    setChoiceSending(false)
    if (sendError) {
      setChoiceError(friendlyRequestError(sendError, 'Could not send the request. Please try again.'))
      return
    }
    setChoiceTarget(null)
    await load()
  }

  async function handleRespond(request: ConnectionRequest, accept: boolean) {
    setBusyRequestId(request.id)
    setActionError(null)
    const { error: respondError } = await respondToConnectionRequest(request.id, accept)
    setBusyRequestId(null)
    if (respondError) setActionError(friendlyRequestError(respondError, 'Could not answer the request. Please try again.'))
    await load()
  }

  async function handleCancel(request: ConnectionRequest) {
    setBusyRequestId(request.id)
    setActionError(null)
    const { error: cancelError } = await cancelConnectionRequest(request.id)
    setBusyRequestId(null)
    if (cancelError) setActionError(friendlyRequestError(cancelError, 'Could not withdraw the request. Please try again.'))
    await load()
  }

  async function openConversation(otherUserId: string) {
    setMessagingId(otherUserId)
    const { data } = await supabase.rpc('create_direct_conversation', {
      other_user_id: otherUserId,
      event_id: eventId,
    })
    setMessagingId(null)
    if (data) navigate(`${eventBasePath}/messages/${data}`)
    else navigate(`${eventBasePath}/messages`)
  }

  const selectClass =
    'h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint sm:w-52'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
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

      <ConnectChoiceSheet
        open={choiceTarget !== null}
        name={choiceTarget?.name ?? ''}
        photo={choiceTarget?.photo ?? ''}
        sending={choiceSending}
        error={choiceError}
        onClose={() => {
          setChoiceTarget(null)
          setChoiceError(null)
        }}
        onScan={() => {
          const target = choiceTarget?.userId ?? null
          setChoiceTarget(null)
          setChoiceError(null)
          setConnectTarget(target)
        }}
        onSendRequest={() => void handleSendRequest()}
      />

      <PageHeader
        title="Attendee Directory"
        description={`Meet the people attending ${event.name}.`}
        actions={
          <Button size="lg" variant="secondary" className="rounded-xl" onClick={openScan}>
            <ScanLine className="h-4 w-4" aria-hidden="true" /> Scan Badge
          </Button>
        }
      />

      <div className="mt-5 space-y-3">
        {scope !== 'requests' && (
        <label className="relative block">
          <span className="sr-only">Search attendees</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            placeholder="Search by name, job title, company or industry…"
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
          />
        </label>
        )}

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Directory scope">
          {(
            [
              ['attendees', 'All attendees', directory.length],
              ['connections', 'My connections', myConnections.length],
              ['requests', 'Requests', requests.length],
            ] as [Scope, string, number][]
          ).map(([value, label, n]) => (
            <button
              key={value}
              role="tab"
              aria-selected={scope === value}
              onClick={() => switchScope(value)}
              className={cn(
                'min-h-[44px] rounded-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
                scope === value ? 'border-primary-600 bg-primary-600 text-white' : 'border-rally-line bg-white text-rally-muted hover:border-primary-300 hover:text-rally-navy'
              )}
            >
              {label} <span className={scope === value ? 'text-white/80' : 'text-slate-400'}>({loading ? '…' : n})</span>
            </button>
          ))}
        </div>

        {scope !== 'requests' && (industries.length > 0 || locations.length > 0) && (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {industries.length > 0 && (
              <label className="block">
                <span className="sr-only">Filter by industry</span>
                <select value={industry} onChange={(e) => reset(setIndustry)(e.target.value)} className={selectClass}>
                  <option value="all">Industry: all</option>
                  {industries.map(([v, n]) => (
                    <option key={v} value={v}>
                      {v} ({n})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {locations.length > 0 && (
              <label className="block">
                <span className="sr-only">Filter by location</span>
                <select value={location} onChange={(e) => reset(setLocation)(e.target.value)} className={selectClass}>
                  <option value="all">Location: all</option>
                  {locations.map(([v, n]) => (
                    <option key={v} value={v}>
                      {v} ({n})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">{error}</p>}
      {actionError && (
        <p className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="shrink-0 font-semibold">
            Dismiss
          </button>
        </p>
      )}

      <div className="mt-5">
        {loading ? (
          <SkeletonCards />
        ) : scope === 'requests' ? (
          <ConnectionRequestsPanel requests={requests} busyId={busyRequestId} onRespond={(r, a) => void handleRespond(r, a)} onCancel={(r) => void handleCancel(r)} />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-rally-line bg-white shadow-card">
            <EmptyState
              icon={scope === 'connections' ? <UserPlus className="h-10 w-10" /> : <Users className="h-10 w-10" />}
              title={
                filtering
                  ? 'No people match your search'
                  : scope === 'connections'
                    ? 'No connections yet'
                    : 'No attendees found'
              }
              description={
                filtering
                  ? 'Try a different search or filter.'
                  : scope === 'connections'
                    ? 'Connect with people at this event to start building your network.'
                    : 'When other attendees register, they will appear here.'
              }
              action={
                filtering ? (
                  <Button variant="secondary" className="rounded-xl" onClick={() => { setSearch(''); setIndustry('all'); setLocation('all'); setPage(1) }}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => {
                const isSelf = p.userId === user?.id
                const request = p.userId ? requestByUser.get(p.userId) : undefined
                return (
                  <li key={p.key} className="flex flex-col gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card sm:p-5">
                    <div className="flex items-start gap-4">
                      <Avatar name={p.name || '?'} src={p.photo} size="lg" />
                      <div className="min-w-0 flex-1">
                        <h2 className="font-display text-base font-semibold leading-snug text-rally-navy">{p.name || 'Professional'}</h2>
                        {p.jobTitle && <p className="text-sm text-rally-muted">{p.jobTitle}</p>}
                        {p.company && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{p.company}</span>
                          </p>
                        )}
                        {p.location && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{p.location}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {p.industry && <span className="rounded-md bg-rally-tint px-2 py-0.5 text-[11px] font-semibold text-primary-700">{p.industry}</span>}
                      {p.connected && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-[11px] font-semibold text-accent-700">
                          <Check className="h-3 w-3" aria-hidden="true" /> Connected
                        </span>
                      )}
                    </div>
                    <div className="mt-auto flex gap-2 pt-1">
                      {isSelf ? (
                        <span className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-500">You</span>
                      ) : p.connected ? (
                        <>
                          {p.userId && (
                            <Button size="lg" variant="secondary" className="flex-1 rounded-xl" disabled={messagingId === p.userId} onClick={() => void openConversation(p.userId!)}>
                              <MessageSquare className="h-4 w-4" aria-hidden="true" /> Message
                            </Button>
                          )}
                          {p.connectionId && (
                            <Button size="lg" variant="ghost" className="flex-1 rounded-xl" onClick={() => navigate(`${eventBasePath}/connections/${p.connectionId}`)}>
                              View profile
                            </Button>
                          )}
                        </>
                      ) : request?.direction === 'incoming' ? (
                        <>
                          <Button size="lg" className="flex-1 rounded-xl" disabled={busyRequestId === request.id} onClick={() => void handleRespond(request, true)}>
                            <Check className="h-4 w-4" aria-hidden="true" /> Accept
                          </Button>
                          <Button size="lg" variant="secondary" className="flex-1 rounded-xl" disabled={busyRequestId === request.id} onClick={() => void handleRespond(request, false)}>
                            <X className="h-4 w-4" aria-hidden="true" /> Decline
                          </Button>
                        </>
                      ) : request?.direction === 'outgoing' ? (
                        <>
                          <span className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-sm font-semibold text-slate-600">
                            <Clock className="h-4 w-4" aria-hidden="true" /> Request sent
                          </span>
                          <Button size="lg" variant="ghost" className="rounded-xl" disabled={busyRequestId === request.id} onClick={() => void handleCancel(request)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="lg" className="flex-1 rounded-xl" onClick={() => { setChoiceError(null); setChoiceTarget(p) }}>
                          <UserPlus className="h-4 w-4" aria-hidden="true" /> Connect
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card md:flex-row md:justify-between">
              <p className="text-sm text-rally-muted" aria-live="polite">
                Showing <span className="font-semibold text-rally-navy">{(current - 1) * PAGE_SIZE + 1}–{(current - 1) * PAGE_SIZE + shown.length}</span> of{' '}
                <span className="font-semibold text-rally-navy">{filtered.length}</span>
              </p>
              <Pagination page={current} pageCount={pageCount} onChange={(n) => { setPage(n); window.scrollTo({ top: 0 }) }} label="Directory pages" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
