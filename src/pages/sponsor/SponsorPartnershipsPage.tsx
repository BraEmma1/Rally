import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, CheckCircle2, Handshake, MapPin, RefreshCw, Search, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { listMySponsorPartnerships, type SponsorPartnership } from '@/lib/sponsorWorkspace'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'active' | 'completed' | 'cancelled'

type Metric = {
  icon: LucideIcon
  label: string
  value: number
  tone: 'blue' | 'green' | 'slate' | 'red'
}

function formatDate(start: string | null, end: string | null) {
  if (!start) return 'Date to be confirmed'
  const first = new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  if (!end || end === start) return first
  const last = new Date(`${end}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${first} – ${last}`
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'EV'
}

function organizationName(partnership: SponsorPartnership) {
  return partnership.sponsor_organization_name || partnership.company_name || 'Sponsor organization'
}

function statusVariant(status: SponsorPartnership['status']) {
  if (status === 'active') return 'success' as const
  if (status === 'cancelled') return 'error' as const
  return 'primary' as const
}

function formatValue(amount: number | null, currency: string | null) {
  if (amount === null || !currency?.trim()) return null
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency.toUpperCase()} ${amount.toLocaleString()}`
  }
}

function sortPartnerships(items: SponsorPartnership[]) {
  const eventPriority: Record<string, number> = { live: 0, upcoming: 1, past: 2 }
  const statusPriority: Record<string, number> = { active: 0, completed: 1, cancelled: 2 }
  return [...items].sort((a, b) => {
    const statusDifference = (statusPriority[a.status] ?? 3) - (statusPriority[b.status] ?? 3)
    if (statusDifference) return statusDifference
    if (a.status === 'active' && b.status === 'active') {
      const eventDifference = (eventPriority[a.event_status ?? 'past'] ?? 3) - (eventPriority[b.event_status ?? 'past'] ?? 3)
      if (eventDifference) return eventDifference
    }
    return (a.event_start_date ?? '9999-12-31').localeCompare(b.event_start_date ?? '9999-12-31')
  })
}

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon
  const toneClasses = {
    blue: 'bg-primary-50 text-primary-600',
    green: 'bg-success-50 text-success-600',
    slate: 'bg-slate-100 text-slate-500',
    red: 'bg-error-50 text-error-600',
  }
  return (
    <Card className="flex min-w-0 items-center gap-3 p-4 sm:gap-4 sm:p-5">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', toneClasses[metric.tone])}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0"><p className="text-2xl font-bold leading-none text-slate-900">{metric.value}</p><p className="mt-1 truncate text-xs text-slate-500 sm:text-sm">{metric.label}</p></div>
    </Card>
  )
}

function Progress({ partnership }: { partnership: SponsorPartnership }) {
  if (partnership.overall_total === 0 && partnership.overall_percent === null) return <p className="text-xs text-slate-500">No obligations agreed yet</p>
  const percent = Math.min(100, Math.max(0, partnership.overall_percent ?? 0))
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700"><span>{partnership.overall_completed}/{partnership.overall_total} completed</span><span>{percent}%</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-success-600 transition-[width] duration-500" style={{ width: `${percent}%` }} /></div>
    </div>
  )
}

function PartnershipDetails({ partnership }: { partnership: SponsorPartnership }) {
  const value = formatValue(partnership.value_amount, partnership.value_currency)
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {partnership.tier_label?.trim() && <Badge variant="warning">{partnership.tier_label}</Badge>}
        {partnership.roles.filter(Boolean).map((role) => <Badge key={role} variant="gray">{role}</Badge>)}
      </div>
      {value && <p className="mt-3 text-sm font-semibold text-slate-800">{value}<span className="ml-1 text-xs font-normal text-slate-500">Partnership value</span></p>}
    </>
  )
}

function PartnershipRow({ partnership }: { partnership: SponsorPartnership }) {
  const organizer = partnership.organizer_organization_name || 'Organizer organization'
  return (
    <Link to={`/sponsor/partnerships/${partnership.partnership_id}`} className="group block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-primary-200 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(150px,0.8fr)_minmax(190px,0.9fr)_20px] lg:items-center">
        <div className="flex min-w-0 gap-4">
          {partnership.organizer_organization_logo_url ? <img src={partnership.organizer_organization_logo_url} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-slate-100 object-cover" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-lg font-bold text-primary-700">{initials(partnership.event_name)}</div>}
          <div className="min-w-0"><div className="flex flex-wrap items-start gap-2"><h2 className="min-w-0 break-words font-semibold text-slate-900 group-hover:text-primary-700">{partnership.event_name}</h2>{partnership.event_archived && <Badge variant="gray">Archived</Badge>}</div><p className="mt-1 truncate text-sm text-slate-600">{organizer}</p><div className="mt-2 space-y-1 text-xs text-slate-500"><p className="flex items-start gap-1.5"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" />{formatDate(partnership.event_start_date, partnership.event_end_date)}</p>{partnership.event_location && <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{partnership.event_location}</p>}</div></div>
        </div>
        <div className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-4"><PartnershipDetails partnership={partnership} /></div>
        <div className="grid gap-3 sm:grid-cols-[auto_minmax(150px,1fr)] sm:items-center lg:block"><Badge variant={statusVariant(partnership.status)}>{partnership.status}</Badge><div className="mt-2"><Progress partnership={partnership} /></div></div>
        <ArrowRight className="hidden h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary-600 lg:block" />
      </div>
    </Link>
  )
}

function Skeleton() {
  return <div className="space-y-6 animate-pulse"><div className="h-24 rounded-xl bg-slate-200" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-20 rounded-xl bg-slate-200" />)}</div><div className="h-12 rounded-xl bg-slate-200" /><div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-36 rounded-xl bg-slate-200" />)}</div></div>
}

export default function SponsorPartnershipsPage() {
  const [partnerships, setPartnerships] = useState<SponsorPartnership[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    const result = await listMySponsorPartnerships()
    if (result.error) setError(true)
    else { setPartnerships(result.data); setError(false) }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load(true)
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  const organizationId = partnerships[0]?.sponsor_organization_id
  const visiblePartnerships = useMemo(() => sortPartnerships(organizationId ? partnerships.filter((item) => item.sponsor_organization_id === organizationId) : partnerships), [organizationId, partnerships])
  const organization = visiblePartnerships[0]
  const counts = useMemo(() => ({ all: visiblePartnerships.length, active: visiblePartnerships.filter((item) => item.status === 'active').length, completed: visiblePartnerships.filter((item) => item.status === 'completed').length, cancelled: visiblePartnerships.filter((item) => item.status === 'cancelled').length }), [visiblePartnerships])
  const filteredPartnerships = useMemo(() => {
    const query = search.trim().toLowerCase()
    return visiblePartnerships.filter((partnership) => {
      const matchesStatus = filter === 'all' || partnership.status === filter
      const searchFields = [partnership.event_name, partnership.organizer_organization_name, partnership.company_name, partnership.tier_label, partnership.event_location, ...partnership.roles].filter(Boolean).join(' ').toLowerCase()
      return matchesStatus && (!query || searchFields.includes(query))
    })
  }, [filter, search, visiblePartnerships])
  const metrics: Metric[] = [{ icon: Handshake, label: 'Total Partnerships', value: counts.all, tone: 'blue' }, { icon: CalendarDays, label: 'Active', value: counts.active, tone: 'green' }, { icon: CheckCircle2, label: 'Completed', value: counts.completed, tone: 'slate' }, { icon: XCircle, label: 'Cancelled', value: counts.cancelled, tone: 'red' }]

  if (loading && partnerships.length === 0) return <Skeleton />

  return <div className="space-y-6 sm:space-y-7">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">My partnerships</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">My Partnerships</h1><p className="mt-2 text-sm text-slate-600 sm:text-base">All your event partnerships and collaboration workspace.</p></div>{organization && <div className="rounded-xl border border-primary-100 bg-primary-50/70 p-4 sm:min-w-64"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 font-bold text-white">{initials(organizationName(organization))}</div><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{organizationName(organization)}</p><p className="text-xs text-slate-600">Sponsor Organization</p></div></div></div>}</div>
    {error && <div className="flex items-center justify-between gap-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-800"><span>We couldn&apos;t load your partnerships.</span><button type="button" onClick={() => void load()} className="inline-flex shrink-0 items-center gap-2 font-semibold text-error-700 hover:text-error-900"><RefreshCw className="h-4 w-4" />Try again</button></div>}
    {visiblePartnerships.length === 0 ? <Card className="p-8 text-center sm:p-12"><Handshake className="mx-auto h-10 w-10 text-primary-400" /><h2 className="mt-4 text-lg font-semibold text-slate-900">No partnerships yet</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">When your organization accepts an event partnership, it will appear here.</p></Card> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Partnership status filters">{(['all', 'active', 'completed', 'cancelled'] as StatusFilter[]).map((status) => <button key={status} type="button" role="tab" aria-selected={filter === status} onClick={() => setFilter(status)} className={cn('shrink-0 rounded-lg px-4 py-2 text-xs font-semibold capitalize transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 sm:text-sm', filter === status ? 'bg-primary-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>{status === 'all' ? 'All' : status} ({counts[status]})</button>)}</div><div className="relative w-full lg:max-w-[300px]"><label htmlFor="partnership-search" className="sr-only">Search partnerships</label><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="partnership-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search partnerships…" className="h-10 pl-9 pr-9" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear partnership search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XCircle className="h-4 w-4" /></button>}</div></div>
      {filteredPartnerships.length > 0 ? <div className="space-y-3">{filteredPartnerships.map((partnership) => <PartnershipRow key={partnership.partnership_id} partnership={partnership} />)}</div> : <Card className="p-8 text-center sm:p-12"><Search className="mx-auto h-9 w-9 text-slate-400" /><h2 className="mt-4 text-lg font-semibold text-slate-900">{search ? 'No partnerships found' : `No ${filter} partnerships`}</h2><p className="mt-2 text-sm text-slate-600">{search ? 'Try adjusting your search or filters.' : 'There are no partnerships in this status yet.'}</p><button type="button" onClick={() => { setSearch(''); setFilter('all') }} className="mt-4 text-sm font-semibold text-primary-700 hover:text-primary-800">Clear filters</button></Card>}
    </>}
    {refreshing && <p className="text-right text-xs text-slate-400">Refreshing partnership data…</p>}
  </div>
}
