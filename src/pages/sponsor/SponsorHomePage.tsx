import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock3, Handshake, MapPin, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { listMySponsorPartnerships, type SponsorPartnership } from '@/lib/sponsorWorkspace'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'

function formatDate(start: string | null, end: string | null) {
  if (!start) return 'Date to be confirmed'
  const first = new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  if (!end || end === start) return first
  const last = new Date(`${end}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${first} – ${last}`
}

function daysUntil(date: string | null) {
  if (!date) return null
  return Math.ceil((new Date(`${date}T12:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
}

function organizationName(partnership: SponsorPartnership) {
  return partnership.sponsor_organization_name || partnership.company_name || 'Sponsor organization'
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SO'
}

function SectionHeading({ title, action }: { title: string; action?: string }) {
  return <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>{action && <a href="#partnerships" className="text-sm font-semibold text-primary-600 hover:text-primary-700">{action}</a>}</div>
}

function MetricCard({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: number; label: string; tone: 'blue' | 'green' | 'amber' | 'red' }) {
  const colors = { blue: 'bg-primary-50 text-primary-600', green: 'bg-success-50 text-success-600', amber: 'bg-warning-50 text-warning-600', red: 'bg-error-50 text-error-600' }
  return <Card className="flex min-w-0 items-center gap-3 p-4 sm:gap-4 sm:p-5"><div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', colors[tone])}><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="text-2xl font-bold leading-none text-slate-900">{value}</p><p className="mt-1 truncate text-xs text-slate-500 sm:text-sm">{label}</p></div></Card>
}

function PartnershipCard({ partnership }: { partnership: SponsorPartnership }) {
  const hasProgress = partnership.overall_total > 0 && partnership.overall_percent !== null
  return <article className="group block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-primary-200 hover:shadow-sm sm:p-5"><div className="flex gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-lg font-bold text-primary-700">{initials(partnership.event_name)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate font-semibold text-slate-900 group-hover:text-primary-700">{partnership.event_name}</h3><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDate(partnership.event_start_date, partnership.event_end_date)}</span>{partnership.event_location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{partnership.event_location}</span>}</div></div><Badge variant={partnership.status === 'active' ? 'success' : partnership.status === 'completed' ? 'gray' : 'error'}>{partnership.status}</Badge></div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs font-medium text-slate-600">{partnership.tier_label || 'Partnership'}</span>{hasProgress ? <span className="text-xs font-semibold text-slate-600">{partnership.overall_completed}/{partnership.overall_total} · {partnership.overall_percent}%</span> : <span className="text-xs text-slate-500">No obligations agreed yet</span>}</div>{hasProgress && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary-600" style={{ width: `${Math.min(100, Math.max(0, partnership.overall_percent ?? 0))}%` }} /></div>}</div><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" /></div></article>
}

function Skeleton() {
  return <div className="space-y-6 animate-pulse"><div className="h-24 rounded-xl bg-slate-200" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-20 rounded-xl bg-slate-200" />)}</div><div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]"><div className="h-64 rounded-xl bg-slate-200" /><div className="h-64 rounded-xl bg-slate-200" /></div></div>
}

export default function SponsorHomePage() {
  const { profile } = useAuth()
  const [partnerships, setPartnerships] = useState<SponsorPartnership[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    const result = await listMySponsorPartnerships()
    if (result.error) {
      setError(result.error)
    } else {
      setPartnerships(result.data)
      setError(null)
    }
    setLoading(false)
    setRefreshing(false)
  }, [] )

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load(true)
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || 'there'
  const organizations = useMemo(() => Array.from(new Map(partnerships.map((item) => [item.sponsor_organization_id, organizationName(item)]))).map(([id, name]) => ({ id, name })), [partnerships])
  const activePartnerships = partnerships.filter((item) => item.status === 'active')
  const upcoming = partnerships.filter((item) => item.event_status === 'upcoming' && !item.event_archived).sort((a, b) => (a.event_start_date ?? '9999-12-31').localeCompare(b.event_start_date ?? '9999-12-31'))
  const outstandingRequirements = partnerships.reduce((sum, item) => sum + Math.max(0, item.requirements_total - item.requirements_completed), 0)
  const attention = partnerships.flatMap((item) => {
    const outstanding = Math.max(0, item.requirements_total - item.requirements_completed)
    const days = daysUntil(item.event_start_date)
    const items: Array<{ icon: LucideIcon; title: string; detail: string; tone: 'warning' | 'blue' }> = outstanding > 0 ? [{ icon: ClipboardList, title: `${outstanding} requirement${outstanding === 1 ? '' : 's'} outstanding`, detail: item.event_name, tone: 'warning' }] : []
    if (days !== null && days >= 0 && days <= 14 && item.status === 'active') items.push({ icon: Clock3, title: days === 0 ? 'Event starts today' : `Event starts in ${days} day${days === 1 ? '' : 's'}`, detail: item.event_name, tone: 'blue' })
    return items
  }).slice(0, 4)
  const relevant = [...activePartnerships.filter((item) => item.event_status !== 'past'), ...partnerships.filter((item) => item.status !== 'cancelled')].find(Boolean)
  const visiblePartnerships = partnerships.filter((item) => item.status !== 'cancelled').slice(0, 4)

  if (loading && partnerships.length === 0) return <Skeleton />

  return <div className="space-y-6 sm:space-y-7">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">Sponsor dashboard</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Welcome back, {firstName}</h1><p className="mt-2 text-sm text-slate-600 sm:text-base">Here&apos;s what&apos;s happening with your sponsorship partnerships.</p></div>{organizations.length > 0 && <div className="rounded-xl border border-primary-100 bg-primary-50/70 p-4 sm:min-w-64"><p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Sponsor organization{organizations.length > 1 ? 's' : ''}</p><div className="mt-2 flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 font-bold text-white">{initials(organizations[0].name)}</div><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{organizations[0].name}</p>{organizations.length > 1 && <p className="text-xs text-slate-600">+ {organizations.length - 1} more sponsor organization{organizations.length > 2 ? 's' : ''}</p>}<p className="text-xs text-slate-600">Sponsor Organization</p></div></div></div>}</div>
    {error && <div className="flex items-center justify-between gap-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-800"><span>{error}</span><button type="button" onClick={() => void load()} className="inline-flex shrink-0 items-center gap-2 font-semibold text-error-700 hover:text-error-900"><RefreshCw className="h-4 w-4" />Try again</button></div>}
    {partnerships.length === 0 ? <Card className="p-8 text-center sm:p-12"><Handshake className="mx-auto h-10 w-10 text-primary-400" /><h2 className="mt-4 text-lg font-semibold text-slate-900">No partnerships yet</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">When your organization accepts an event partnership, it will appear here.</p></Card> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard icon={Handshake} value={partnerships.length} label="Total Partnerships" tone="blue" /><MetricCard icon={CheckCircle2} value={activePartnerships.length} label="Active Partnerships" tone="green" /><MetricCard icon={CalendarDays} value={upcoming.length} label="Upcoming Events" tone="amber" /><MetricCard icon={AlertCircle} value={outstandingRequirements} label="Outstanding Requirements" tone="red" /></div>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]"><Card className="p-5 sm:p-6"><SectionHeading title="Needs Attention" action={attention.length ? 'View all' : undefined} />{attention.length ? <div className="divide-y divide-slate-100">{attention.map((item, index) => <div key={`${item.detail}-${item.title}-${index}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', item.tone === 'warning' ? 'bg-warning-50 text-warning-600' : 'bg-primary-50 text-primary-600')}><item.icon className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{item.title}</p><p className="truncate text-xs text-slate-500">{item.detail}</p></div><ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" /></div>)}</div> : <div className="flex items-center gap-3 rounded-lg bg-success-50 p-4 text-sm text-success-800"><CheckCircle2 className="h-5 w-5 shrink-0" /><div><p className="font-semibold">You&apos;re all caught up</p><p className="mt-0.5 text-xs text-success-700">There are no outstanding partnership requirements at the moment.</p></div></div>}</Card><div id="partnerships"><Card className="p-5 sm:p-6"><SectionHeading title="Active & Upcoming Partnerships" action={partnerships.length > 4 ? 'View all' : undefined} /><div className="space-y-3">{visiblePartnerships.map((item) => <PartnershipCard key={item.partnership_id} partnership={item} />)}</div></Card></div></div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]"><Card className="p-5 sm:p-6">{relevant ? <><SectionHeading title="Partnership Progress" /><p className="text-sm font-semibold text-slate-900">{relevant.event_name}</p>{relevant.overall_total > 0 && relevant.overall_percent !== null ? <><div className="mt-5 flex items-center gap-5"><div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#0A66C2 ${relevant.overall_percent}%, #e8eef5 0)` }}><div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-lg font-bold text-slate-900">{relevant.overall_percent}%</div></div><div><p className="font-semibold text-slate-900">{relevant.overall_completed} of {relevant.overall_total} completed</p><div className="mt-2 space-y-1 text-xs text-slate-600"><p>Deliverables <span className="float-right ml-8 font-semibold">{relevant.deliverables_completed}/{relevant.deliverables_total}</span></p><p>Requirements <span className="float-right ml-8 font-semibold">{relevant.requirements_completed}/{relevant.requirements_total}</span></p></div></div></div></> : <p className="mt-5 text-sm text-slate-500">No obligations agreed yet.</p>}</> : <div className="py-5"><SectionHeading title="Partnership Progress" /><p className="text-sm text-slate-500">Progress will appear when an active partnership is available.</p></div>}</Card><Card className="p-5 sm:p-6"><SectionHeading title="Upcoming Events" />{upcoming.length ? <div className="divide-y divide-slate-100">{upcoming.slice(0, 4).map((item) => <div key={item.partnership_id} className="flex items-center gap-3 py-3 first:pt-0"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><CalendarDays className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{item.event_name}</p><p className="truncate text-xs text-slate-500">{formatDate(item.event_start_date, item.event_end_date)}{item.event_location ? ` · ${item.event_location}` : ''}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></div>)}</div> : <p className="text-sm text-slate-500">No upcoming partnership events.</p>}</Card></div>
      <Card className="p-5 sm:p-6"><SectionHeading title="Quick Actions" /><div className="grid gap-3 sm:grid-cols-2"><a href="#partnerships" className="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:border-primary-200 hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"><span className="inline-flex items-center gap-3"><Handshake className="h-5 w-5 text-primary-600" />View My Partnerships</span><ArrowRight className="h-4 w-4 text-slate-400" /></a><a href="#partnerships" className="flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:border-primary-200 hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"><span className="inline-flex items-center gap-3"><ClipboardList className="h-5 w-5 text-primary-600" />Review Outstanding Partnership</span><ArrowRight className="h-4 w-4 text-slate-400" /></a></div></Card>
    </>}
    {refreshing && <p className="text-right text-xs text-slate-400">Refreshing partnership data…</p>}
  </div>
}
