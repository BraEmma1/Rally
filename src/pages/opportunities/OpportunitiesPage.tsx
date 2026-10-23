import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Target,
  Plus,
  X,
  TrendingUp,
  DollarSign,
  ArrowRight,
  Search,
  Calendar,
  Columns3,
  LayoutGrid,
  List as ListIcon,
} from 'lucide-react'
import { supabase, type Opportunity, type Connection, OPPORTUNITY_TYPES, OPPORTUNITY_STAGES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { ComingSoonButton } from '@/components/events/ComingSoon'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { cn, formatDate, formatRelativeDate } from '@/lib/utils'

interface OpportunityWithConnection extends Opportunity {
  connection?: Connection
}

const STAGE_VARIANTS: Record<string, 'primary' | 'warning' | 'success' | 'error' | 'gray'> = {
  New: 'primary',
  Discussing: 'warning',
  Proposal: 'primary',
  Negotiation: 'primary',
  Won: 'success',
  Lost: 'error',
}

const TYPE_FILTERS = ['All', ...OPPORTUNITY_TYPES] as const
const STAGE_FILTERS = ['All', ...OPPORTUNITY_STAGES] as const

function formatCurrency(value: number): string {
  if (!value) return '—'
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

export default function OpportunitiesPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opportunities, setOpportunities] = useState<OpportunityWithConnection[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('All')
  const [stageFilter, setStageFilter] = useState<string>('All')
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState<'board' | 'grid' | 'list'>('board')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '',
    type: 'Sales' as string,
    description: '',
    value: '',
    stage: 'New' as string,
    expected_close_date: '',
    connection_id: '',
  })

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [oppRes, connRes] = await Promise.all([
        supabase.from('opportunities').select('*').eq('owner_id', user.id).order('updated_at', { ascending: false }),
        supabase.from('connections').select('*').eq('owner_id', user.id).order('full_name', { ascending: true }),
      ])

      if (oppRes.error) throw oppRes.error
      if (connRes.error) throw connRes.error

      const connList = connRes.data as Connection[]
      const connMap = new Map<string, Connection>()
      for (const c of connList) connMap.set(c.id, c)

      setConnections(connList)
      setOpportunities((oppRes.data as Opportunity[]).map((o) => ({ ...o, connection: connMap.get(o.connection_id) })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load opportunities.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [user])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!form.connection_id) {
      setFormError('Please select a connection.')
      return
    }
    setSaving(true)
    setFormError(null)

    const conn = connections.find((c) => c.id === form.connection_id)
    const payload = {
      owner_id: user.id,
      connection_id: form.connection_id,
      title: form.title.trim(),
      type: form.type,
      description: form.description || '',
      value: form.value ? parseFloat(form.value) : 0,
      stage: form.stage,
      expected_close_date: form.expected_close_date || null,
      event_name: conn?.event_name || '',
      event_id: conn?.event_id ?? null,
    }

    const { error: insertError } = await supabase.from('opportunities').insert(payload)
    if (insertError) {
      setFormError(insertError.message)
      setSaving(false)
      return
    }

    setForm({ title: '', type: 'Sales', description: '', value: '', stage: 'New', expected_close_date: '', connection_id: '' })
    setShowForm(false)
    setSaving(false)
    loadData()
  }

  if (loading) return <LoadingState message="Loading opportunities…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const active = opportunities.filter((o) => o.stage !== 'Won' && o.stage !== 'Lost')
  const won = opportunities.filter((o) => o.stage === 'Won')

  const totalValue = active.reduce((sum, o) => sum + (o.value || 0), 0)
  const wonValue = won.reduce((sum, o) => sum + (o.value || 0), 0)

  const filtered = opportunities.filter((o) => {
    if (typeFilter !== 'All' && o.type !== typeFilter) return false
    if (view !== 'board' && stageFilter !== 'All' && o.stage !== stageFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const matches =
        o.title.toLowerCase().includes(q) ||
        o.connection?.full_name.toLowerCase().includes(q) ||
        o.connection?.company.toLowerCase().includes(q) ||
        o.type.toLowerCase().includes(q)
      if (!matches) return false
    }
    return true
  })

  const stats = [
    { label: 'Active deals', value: active.length, icon: Target, tone: 'bg-rally-tint text-primary-600' },
    { label: 'Pipeline value', value: formatCurrency(totalValue), icon: DollarSign, tone: 'bg-accent-50 text-accent-600' },
    { label: 'Won', value: won.length, icon: TrendingUp, tone: 'bg-success-50 text-success-600' },
    { label: 'Won value', value: formatCurrency(wonValue), icon: DollarSign, tone: 'bg-success-50 text-success-600' },
  ]

  const field = 'h-11 rounded-xl'

  const oppCard = (opp: OpportunityWithConnection) => (
    <Link
      key={opp.id}
      to={`/opportunities/${opp.id}`}
      className="block rounded-xl border border-rally-line bg-white p-3.5 shadow-card transition-shadow hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold text-rally-navy">{opp.title}</p>
        {opp.value > 0 && <span className="shrink-0 font-display text-sm font-bold text-primary-700">{formatCurrency(opp.value)}</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {opp.connection && <Avatar name={opp.connection.full_name || '?'} src={opp.connection.photo_url} size="xs" />}
        <p className="min-w-0 truncate text-xs text-slate-500">
          {opp.connection?.full_name || 'Unknown'}
          {opp.connection?.company ? ` · ${opp.connection.company}` : ''}
        </p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span className="rounded-full bg-rally-tint px-2 py-0.5 font-semibold text-primary-700">{opp.type}</span>
        {opp.expected_close_date && (
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" aria-hidden="true" /> {formatDate(opp.expected_close_date)}</span>
        )}
      </div>
    </Link>
  )

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader
        title="Opportunities"
        description="Turn the connections you made at events into deals, partnerships and introductions."
        actions={
          <>
            <ComingSoonButton size="lg" variant="secondary" className="hidden md:inline-flex">
              Export pipeline
            </ComingSoonButton>
            <Button size="lg" className="rounded-xl" onClick={() => setShowForm(!showForm)}>
              {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> New opportunity</>}
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card">
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
              <stat.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-2xl font-bold leading-none text-rally-navy">{stat.value}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <section className="mt-6 rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6" aria-label="New opportunity">
          <h2 className="mb-4 font-display text-lg font-semibold text-rally-navy">New opportunity</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="title">Title *</Label>
                <Input id="title" required className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Enterprise deal with Acme" />
              </div>
              <div>
                <Label htmlFor="connection_id">Connection *</Label>
                <Select id="connection_id" required className={field} value={form.connection_id} onChange={(e) => setForm({ ...form, connection_id: e.target.value })}>
                  <option value="">Select a connection…</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}{c.company ? ` — ${c.company}` : ''}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="type">Type</Label>
                <Select id="type" className={field} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="stage">Stage</Label>
                <Select id="stage" className={field} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  {OPPORTUNITY_STAGES.map((st) => <option key={st} value={st}>{st}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="value">Value ($)</Label>
                <Input id="value" type="number" min="0" step="1000" className={field} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="50000" />
              </div>
              <div>
                <Label htmlFor="expected_close_date">Expected close date</Label>
                <Input id="expected_close_date" type="date" className={field} value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe this opportunity…" />
            </div>
            {formError && <div role="alert" className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{formError}</div>}
            <div className="flex justify-end gap-3">
              <Button type="submit" size="lg" className="rounded-xl" disabled={saving}>
                {saving ? 'Creating…' : 'Create opportunity'}
              </Button>
            </div>
          </form>
        </section>
      )}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SegmentedTabs
          label="Pipeline view"
          value={view}
          onChange={setView}
          tabs={[
            { key: 'board', label: 'Board', icon: <Columns3 className="h-4 w-4" aria-hidden="true" /> },
            { key: 'grid', label: 'Grid', icon: <LayoutGrid className="h-4 w-4" aria-hidden="true" /> },
            { key: 'list', label: 'List', icon: <ListIcon className="h-4 w-4" aria-hidden="true" /> },
          ]}
        />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Input aria-label="Search opportunities" placeholder="Search opportunities…" value={search} onChange={(e) => setSearch(e.target.value)} className={cn(field, 'pl-9')} />
        </div>
        <Select aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={cn(field, 'lg:w-40')}>
          {TYPE_FILTERS.map((t) => <option key={t} value={t}>{t === 'All' ? 'All types' : t}</option>)}
        </Select>
        {view !== 'board' && (
          <Select aria-label="Filter by stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className={cn(field, 'lg:w-40')}>
            {STAGE_FILTERS.map((st) => <option key={st} value={st}>{st === 'All' ? 'All stages' : st}</option>)}
          </Select>
        )}
      </div>

      <div className="mt-4">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-rally-line bg-white p-6 shadow-card">
            <EmptyState
              icon={<Target className="h-10 w-10" />}
              title={opportunities.length === 0 ? 'No opportunities yet' : 'No matching opportunities'}
              description={opportunities.length === 0 ? 'Create an opportunity from one of your connections to start tracking deals and partnerships.' : 'Try adjusting your filters.'}
              action={opportunities.length === 0 ? <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> New opportunity</Button> : undefined}
            />
          </div>
        ) : view === 'board' ? (
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0">
            {OPPORTUNITY_STAGES.map((stage) => {
              const items = filtered.filter((o) => o.stage === stage)
              const sum = items.reduce((t, o) => t + (o.value || 0), 0)
              return (
                <section key={stage} aria-label={`${stage} stage`} className="w-72 shrink-0 snap-start rounded-2xl bg-rally-tint/60 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-sm font-semibold text-rally-navy">{stage}</h2>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-primary-700">{items.length}</span>
                    </div>
                    {sum > 0 && <span className="text-xs font-semibold text-slate-500">{formatCurrency(sum)}</span>}
                  </div>
                  <div className="space-y-2.5">
                    {items.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">No deals here</p>
                    ) : (
                      items.map(oppCard)
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((opp) => (
              <div key={opp.id} className="relative">
                {oppCard(opp)}
                <Badge variant={STAGE_VARIANTS[opp.stage] || 'gray'} className="pointer-events-none absolute bottom-3.5 right-3.5">{opp.stage}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((opp) => (
              <Link
                key={opp.id}
                to={`/opportunities/${opp.id}`}
                className="flex items-center gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card transition-colors hover:border-primary-300 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                {opp.connection && <Avatar name={opp.connection.full_name || '?'} src={opp.connection.photo_url} size="md" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-rally-navy">{opp.title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {opp.connection?.full_name || 'Unknown'}
                    {opp.connection?.company ? ` · ${opp.connection.company}` : ''}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{opp.type}</span>
                    {opp.value > 0 && <span>· {formatCurrency(opp.value)}</span>}
                    {opp.expected_close_date && (
                      <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" aria-hidden="true" /> {formatDate(opp.expected_close_date)}</span>
                    )}
                    {opp.event_name && <span>· Met at {opp.event_name}</span>}
                    <span>· Updated {formatRelativeDate(opp.updated_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={STAGE_VARIANTS[opp.stage] || 'gray'}>{opp.stage}</Badge>
                  <ArrowRight className="h-4 w-4 text-gray-300" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
