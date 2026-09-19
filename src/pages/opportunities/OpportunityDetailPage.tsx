import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Trash2,
  Trophy,
  XCircle,
  Target,
  DollarSign,
  Calendar,
  User,
  Building2,
  CalendarDays,
} from 'lucide-react'
import { supabase, type Opportunity, type Connection, OPPORTUNITY_TYPES, OPPORTUNITY_STAGES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState } from '@/components/ui/States'
import { formatDate, formatRelativeDate } from '@/lib/utils'

const STAGE_VARIANTS: Record<string, 'primary' | 'warning' | 'success' | 'error' | 'gray'> = {
  New: 'primary',
  Discussing: 'warning',
  Proposal: 'primary',
  Negotiation: 'primary',
  Won: 'success',
  Lost: 'error',
}

function formatCurrency(value: number): string {
  if (!value) return '—'
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

const ACTIVE_STAGES = ['New', 'Discussing', 'Proposal', 'Negotiation']

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    type: 'Sales',
    description: '',
    value: '',
    stage: 'New',
    expected_close_date: '',
  })

  async function loadData() {
    if (!id || !user) return
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await supabase
      .from('opportunities')
      .select('*')
      .eq('id', id)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      return
    }
    if (!data) {
      setError('Opportunity not found.')
      setLoading(false)
      return
    }

    const opp = data as Opportunity
    setOpportunity(opp)
    setForm({
      title: opp.title,
      type: opp.type,
      description: opp.description || '',
      value: opp.value ? String(opp.value) : '',
      stage: opp.stage,
      expected_close_date: opp.expected_close_date || '',
    })

    const { data: connData } = await supabase
      .from('connections')
      .select('*')
      .eq('id', opp.connection_id)
      .eq('owner_id', user.id)
      .maybeSingle()
    setConnection(connData as Connection | null)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [id, user])

  async function updateStage(stage: string) {
    if (!opportunity || !user) return
    const { error: updateError } = await supabase
      .from('opportunities')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', opportunity.id)
      .eq('owner_id', user.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setOpportunity({ ...opportunity, stage, updated_at: new Date().toISOString() })
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!opportunity || !user) return
    setSaving(true)
    const { error: updateError } = await supabase
      .from('opportunities')
      .update({
        title: form.title.trim(),
        type: form.type,
        description: form.description,
        value: form.value ? parseFloat(form.value) : 0,
        stage: form.stage,
        expected_close_date: form.expected_close_date || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opportunity.id)
      .eq('owner_id', user.id)
    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    setOpportunity({
      ...opportunity,
      title: form.title.trim(),
      type: form.type,
      description: form.description,
      value: form.value ? parseFloat(form.value) : 0,
      stage: form.stage,
      expected_close_date: form.expected_close_date || null,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    if (!opportunity || !user) return
    if (!confirm('Delete this opportunity? This cannot be undone.')) return
    const { error: deleteError } = await supabase
      .from('opportunities')
      .delete()
      .eq('id', opportunity.id)
      .eq('owner_id', user.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    window.history.back()
  }

  if (loading) return <LoadingState message="Loading opportunity…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />
  if (!opportunity) return <ErrorState message="Opportunity not found." />

  const isActive = ACTIVE_STAGES.includes(opportunity.stage)

  return (
    <div>
      <Link to="/opportunities" className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to opportunities
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{opportunity.title}</h1>
            <Badge variant={STAGE_VARIANTS[opportunity.stage] || 'gray'}>{opportunity.stage}</Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {opportunity.type} · Updated {formatRelativeDate(opportunity.updated_at)}
          </p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-error-600 hover:bg-error-50" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Won/Lost banner */}
      {(opportunity.stage === 'Won' || opportunity.stage === 'Lost') && (
        <Card className={`mt-4 ${opportunity.stage === 'Won' ? 'border-success-200 bg-success-50/50' : 'border-error-200 bg-error-50/50'}`}>
          <CardContent className="flex items-center gap-3 py-3">
            {opportunity.stage === 'Won' ? (
              <Trophy className="h-5 w-5 text-success-600" />
            ) : (
              <XCircle className="h-5 w-5 text-error-600" />
            )}
            <p className={`text-sm font-medium ${opportunity.stage === 'Won' ? 'text-success-700' : 'text-error-700'}`}>
              {opportunity.stage === 'Won' ? 'This opportunity was won!' : 'This opportunity was lost.'}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {editing ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Edit Opportunity</CardTitle>
                  <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <Label htmlFor="edit_title">Title</Label>
                    <Input id="edit_title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="edit_type">Type</Label>
                      <Select id="edit_type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="edit_stage">Stage</Label>
                      <Select id="edit_stage" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                        {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="edit_value">Value ($)</Label>
                      <Input id="edit_value" type="number" min="0" step="1000" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="edit_close">Expected close date</Label>
                      <Input id="edit_close" type="date" value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="edit_desc">Description</Label>
                    <Textarea id="edit_desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button type="submit" disabled={saving}>
                      <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <>
              {opportunity.description && (
                <Card>
                  <CardHeader><CardTitle>Description</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-gray-700">{opportunity.description}</p>
                  </CardContent>
                </Card>
              )}

              {/* Stage changer */}
              {isActive && (
                <Card>
                  <CardHeader><CardTitle>Change Stage</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {ACTIVE_STAGES.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={opportunity.stage === s ? 'primary' : 'outline'}
                          onClick={() => updateStage(s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                    <div className="mt-4 flex gap-2 border-t border-gray-100 pt-4">
                      <Button size="sm" variant="secondary" className="bg-success-50 text-success-700 hover:bg-success-100" onClick={() => updateStage('Won')}>
                        <Trophy className="h-3.5 w-3.5" /> Mark Won
                      </Button>
                      <Button size="sm" variant="secondary" className="bg-error-50 text-error-700 hover:bg-error-100" onClick={() => updateStage('Lost')}>
                        <XCircle className="h-3.5 w-3.5" /> Mark Lost
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(opportunity.stage === 'Won' || opportunity.stage === 'Lost') && (
                <Card>
                  <CardContent>
                    <Button size="sm" variant="secondary" onClick={() => updateStage('New')}>
                      Reopen as active
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Key details */}
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Target className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Type</p>
                  <p className="text-sm font-medium text-gray-900">{opportunity.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <DollarSign className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Value</p>
                  <p className="text-sm font-medium text-gray-900">{formatCurrency(opportunity.value)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Expected close</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(opportunity.expected_close_date)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Created</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(opportunity.created_at)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Related connection */}
          {connection && (
            <Card>
              <CardHeader><CardTitle>Related Connection</CardTitle></CardHeader>
              <CardContent>
                <Link to={`/connections/${connection.id}`} className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-gray-50">
                  <Avatar name={connection.full_name || '?'} src={connection.photo_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{connection.full_name}</p>
                    <p className="truncate text-xs text-gray-500">
                      {connection.job_title}{connection.company ? ` at ${connection.company}` : ''}
                    </p>
                  </div>
                </Link>
                <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                  {connection.company && (
                    <p className="flex items-center gap-2 text-xs text-gray-500">
                      <Building2 className="h-3.5 w-3.5" /> {connection.company}
                    </p>
                  )}
                  {opportunity.event_name && (
                    <p className="flex items-center gap-2 text-xs text-gray-500">
                      <CalendarDays className="h-3.5 w-3.5" /> Met at {opportunity.event_name}
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="h-3.5 w-3.5" /> {connection.relationship_type}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
