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
} from 'lucide-react'
import { supabase, type Opportunity, type Connection, OPPORTUNITY_TYPES, OPPORTUNITY_STAGES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate } from '@/lib/utils'

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
    if (stageFilter !== 'All' && o.stage !== stageFilter) return false
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
    { label: 'Active', value: active.length, icon: Target, color: 'text-primary-600', bg: 'bg-primary-50' },
    { label: 'Pipeline Value', value: formatCurrency(totalValue), icon: DollarSign, color: 'text-accent-600', bg: 'bg-accent-50' },
    { label: 'Won', value: won.length, icon: TrendingUp, color: 'text-success-600', bg: 'bg-success-50' },
    { label: 'Won Value', value: formatCurrency(wonValue), icon: DollarSign, color: 'text-success-600', bg: 'bg-success-50' },
  ]

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Opportunities</h1>
          <p className="mt-1 text-sm text-gray-500">Track business opportunities from your network</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> New opportunity</>}
        </Button>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-md ${stat.bg}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="mt-6">
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input id="title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Enterprise deal with Acme" />
                </div>
                <div>
                  <Label htmlFor="connection_id">Connection *</Label>
                  <Select id="connection_id" required value={form.connection_id} onChange={(e) => setForm({ ...form, connection_id: e.target.value })}>
                    <option value="">Select a connection…</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>{c.full_name}{c.company ? ` — ${c.company}` : ''}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="type">Type</Label>
                  <Select id="type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="stage">Stage</Label>
                  <Select id="stage" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                    {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="value">Value ($)</Label>
                  <Input id="value" type="number" min="0" step="1000" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="50000" />
                </div>
                <div>
                  <Label htmlFor="expected_close_date">Expected close date</Label>
                  <Input id="expected_close_date" type="date" value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe this opportunity…" />
              </div>
              {formError && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{formError}</div>}
              <div className="flex justify-end gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Creating…' : 'Create opportunity'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search opportunities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="sm:w-40">
          {TYPE_FILTERS.map((t) => <option key={t} value={t}>{t === 'All' ? 'All types' : t}</option>)}
        </Select>
        <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="sm:w-40">
          {STAGE_FILTERS.map((s) => <option key={s} value={s}>{s === 'All' ? 'All stages' : s}</option>)}
        </Select>
      </div>

      {/* List */}
      <div className="mt-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Target className="h-10 w-10" />}
                title={opportunities.length === 0 ? 'No opportunities yet' : 'No matching opportunities'}
                description={opportunities.length === 0 ? 'Create an opportunity from one of your connections to start tracking deals and partnerships.' : 'Try adjusting your filters.'}
                action={opportunities.length === 0 ? <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> New opportunity</Button> : undefined}
              />
            </CardContent>
          </Card>
        ) : (
          filtered.map((opp) => (
            <Link key={opp.id} to={`/opportunities/${opp.id}`}>
              <Card className="mb-3 transition-colors hover:border-primary-300 hover:bg-primary-50/30">
                <CardContent className="flex items-center gap-3 py-3">
                  {opp.connection && (
                    <Avatar name={opp.connection.full_name || '?'} src={opp.connection.photo_url} size="md" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{opp.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      {opp.connection?.full_name || 'Unknown'}
                      {opp.connection?.company ? ` · ${opp.connection.company}` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      <span>{opp.type}</span>
                      {opp.value > 0 && <span>· {formatCurrency(opp.value)}</span>}
                      {opp.expected_close_date && (
                        <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" /> {formatDate(opp.expected_close_date)}</span>
                      )}
                      {opp.event_name && <span>· Met at {opp.event_name}</span>}
                      <span>· Updated {formatRelativeDate(opp.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <Badge variant={STAGE_VARIANTS[opp.stage] || 'gray'}>{opp.stage}</Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
