import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Pencil,
  Trash2,
  Save,
  X,
  AlertCircle,
  CalendarDays,
} from 'lucide-react'
import { supabase, type FollowUp, type Connection } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { ComingSoonButton } from '@/components/events/ComingSoon'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { cn, formatDate, formatRelativeDate } from '@/lib/utils'

interface FollowUpWithConnection extends FollowUp {
  connection?: Connection
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date(new Date().toDateString())
  return d.toDateString() === today.toDateString()
}

function isOverdue(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date(new Date().toDateString())
  return d < today
}

function isUpcoming(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date(new Date().toDateString())
  return d > today
}

export default function FollowUpsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpWithConnection[]>([])
  const [showCompleted, setShowCompleted] = useState(false)

  // Edit modal state
  const [editing, setEditing] = useState<FollowUpWithConnection | null>(null)
  const [editForm, setEditForm] = useState({ title: '', note: '', due_date: '' })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const { data: fuData, error: fuError } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('owner_id', user.id)
        .order('due_date', { ascending: true })

      if (fuError) throw fuError

      const fuList = (fuData as FollowUp[]) || []
      if (fuList.length === 0) {
        setFollowUps([])
        setLoading(false)
        return
      }

      // Fetch related connections
      const connIds = [...new Set(fuList.map((f) => f.connection_id))]
      const { data: connData } = await supabase
        .from('connections')
        .select('*')
        .eq('owner_id', user.id)
        .in('id', connIds)

      const connMap = new Map<string, Connection>()
      for (const c of (connData as Connection[]) || []) {
        connMap.set(c.id, c)
      }

      setFollowUps(fuList.map((f) => ({ ...f, connection: connMap.get(f.connection_id) })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [user])

  async function handleComplete(fu: FollowUpWithConnection) {
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('follow_ups')
      .update({ completed: true, completed_at: now })
      .eq('id', fu.id)
      .eq('owner_id', user!.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setFollowUps(followUps.map((f) => f.id === fu.id ? { ...f, completed: true, completed_at: now } : f))
  }

  async function handleUncomplete(fu: FollowUpWithConnection) {
    const { error: updateError } = await supabase
      .from('follow_ups')
      .update({ completed: false, completed_at: null })
      .eq('id', fu.id)
      .eq('owner_id', user!.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setFollowUps(followUps.map((f) => f.id === fu.id ? { ...f, completed: false, completed_at: null } : f))
  }

  async function handleReschedule(fu: FollowUpWithConnection, newDate: string) {
    if (!newDate) return
    const { error: updateError } = await supabase
      .from('follow_ups')
      .update({ due_date: newDate, completed: false, completed_at: null })
      .eq('id', fu.id)
      .eq('owner_id', user!.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setFollowUps(followUps.map((f) => f.id === fu.id ? { ...f, due_date: newDate, completed: false, completed_at: null } : f))
  }

  function startEdit(fu: FollowUpWithConnection) {
    setEditing(fu)
    setEditForm({ title: fu.title, note: fu.note || '', due_date: fu.due_date })
    setEditError(null)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    setEditError(null)
    const { error: updateError } = await supabase
      .from('follow_ups')
      .update({
        title: editForm.title,
        note: editForm.note,
        due_date: editForm.due_date,
      })
      .eq('id', editing.id)
      .eq('owner_id', user!.id)
    if (updateError) {
      setEditError(updateError.message)
      setSaving(false)
      return
    }
    setFollowUps(followUps.map((f) => f.id === editing.id ? { ...f, title: editForm.title, note: editForm.note, due_date: editForm.due_date } : f))
    setSaving(false)
    setEditing(null)
  }

  async function handleDelete(fu: FollowUpWithConnection) {
    if (!confirm('Delete this follow-up?')) return
    const { error: deleteError } = await supabase
      .from('follow_ups')
      .delete()
      .eq('id', fu.id)
      .eq('owner_id', user!.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setFollowUps(followUps.filter((f) => f.id !== fu.id))
  }

  if (loading) return <LoadingState message="Loading follow-ups…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />

  const pending = followUps.filter((f) => !f.completed)
  const completed = followUps.filter((f) => f.completed)

  const overdue = pending.filter((f) => isOverdue(f.due_date))
  const today = pending.filter((f) => isToday(f.due_date))
  const upcoming = pending.filter((f) => isUpcoming(f.due_date))

  const displayList = showCompleted ? completed : [...overdue, ...today, ...upcoming]

  function renderFollowUp(fu: FollowUpWithConnection) {
    const conn = fu.connection
    const overdueFlag = !fu.completed && isOverdue(fu.due_date)
    const todayFlag = !fu.completed && isToday(fu.due_date)
    const accent = fu.completed ? 'bg-slate-300' : overdueFlag ? 'bg-error-600' : todayFlag ? 'bg-warning-600' : 'bg-primary-600'
    const actionBtn = 'min-h-[40px] rounded-xl'

    return (
      <article key={fu.id} className={cn('relative overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card', fu.completed && 'opacity-70')}>
        <span className={cn('absolute inset-y-0 left-0 w-1.5', accent)} aria-hidden="true" />
        <div className="flex items-start gap-3 p-4 pl-5 md:p-5 md:pl-6">
          <button
            onClick={() => (fu.completed ? handleUncomplete(fu) : handleComplete(fu))}
            aria-label={fu.completed ? `Mark "${fu.title}" as not done` : `Mark "${fu.title}" as done`}
            className="-ml-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            {fu.completed ? <CheckCircle2 className="h-6 w-6 text-accent-600" /> : <Circle className="h-6 w-6 text-slate-300 hover:text-primary-600" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className={cn('font-display text-base font-semibold', fu.completed ? 'text-slate-400 line-through' : 'text-rally-navy')}>{fu.title}</p>
                {fu.note && <p className="mt-1 text-sm text-rally-muted">{fu.note}</p>}
              </div>
              <div className="shrink-0">
                {fu.completed ? (
                  <Badge variant="success">Completed {fu.completed_at ? formatDate(fu.completed_at) : ''}</Badge>
                ) : overdueFlag ? (
                  <Badge variant="error">Overdue · {formatRelativeDate(fu.due_date)}</Badge>
                ) : todayFlag ? (
                  <Badge variant="warning">Due today</Badge>
                ) : (
                  <Badge variant="primary">{formatRelativeDate(fu.due_date)}</Badge>
                )}
              </div>
            </div>

            {conn && (
              <Link
                to={`/connections/${conn.id}`}
                className="mt-3 flex min-h-[56px] items-center gap-3 rounded-xl border border-rally-line bg-rally-canvas p-2.5 transition-colors hover:border-primary-300 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                <Avatar name={conn.full_name || '?'} src={conn.photo_url} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-rally-navy">{conn.full_name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {[conn.job_title, conn.company].filter(Boolean).join(' · ') || conn.relationship_type}
                    {conn.event_name ? ` · Met at ${conn.event_name}` : ''}
                  </span>
                </span>
                <Badge variant="gray">{conn.relationship_type}</Badge>
              </Link>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!fu.completed && (
                <>
                  <Button size="sm" variant="secondary" className={actionBtn} onClick={() => handleComplete(fu)}>
                    <CheckCircle2 className="h-4 w-4" /> Mark complete
                  </Button>
                  <label className="relative inline-flex">
                    <span className="sr-only">Reschedule this follow-up</span>
                    <Input
                      type="date"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleReschedule(fu, e.target.value)
                        e.target.value = ''
                      }}
                    />
                    <span className="pointer-events-none inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600">
                      <CalendarClock className="h-4 w-4" /> Reschedule
                    </span>
                  </label>
                </>
              )}
              <Button size="sm" variant="ghost" className={actionBtn} onClick={() => startEdit(fu)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button size="sm" variant="ghost" className={cn(actionBtn, 'text-error-600 hover:bg-error-50')} onClick={() => handleDelete(fu)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          </div>
        </div>
      </article>
    )
  }

  function renderSection(title: string, items: FollowUpWithConnection[], icon: React.ReactNode) {
    if (items.length === 0) return null
    return (
      <section className="mb-8" aria-label={title}>
        <div className="mb-3 flex items-center gap-2">
          {icon}
          <h2 className="font-display text-lg font-semibold text-rally-navy">{title}</h2>
          <span className="rounded-full bg-rally-tint px-2 py-0.5 text-xs font-semibold text-primary-700">{items.length}</span>
        </div>
        <div className="space-y-3">{items.map(renderFollowUp)}</div>
      </section>
    )
  }

  const stat = (label: string, value: number, tone: string, icon: React.ReactNode) => (
    <div className="flex items-center gap-3 rounded-2xl border border-rally-line bg-white p-4 shadow-card">
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tone)}>{icon}</span>
      <div>
        <p className="font-display text-2xl font-bold leading-none text-rally-navy">{value}</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      </div>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Follow-ups"
        description="Stay on top of the people you promised to get back to. Keep the momentum from every event."
        actions={
          <ComingSoonButton size="lg" variant="secondary">
            Sync calendar
          </ComingSoonButton>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat('Overdue', overdue.length, 'bg-error-50 text-error-600', <AlertCircle className="h-5 w-5" aria-hidden="true" />)}
        {stat('Due today', today.length, 'bg-warning-50 text-warning-600', <CalendarDays className="h-5 w-5" aria-hidden="true" />)}
        {stat('Upcoming', upcoming.length, 'bg-rally-tint text-primary-600', <CalendarClock className="h-5 w-5" aria-hidden="true" />)}
        {stat('Completed', completed.length, 'bg-accent-50 text-accent-600', <CheckCircle2 className="h-5 w-5" aria-hidden="true" />)}
      </div>

      <SegmentedTabs
        className="mt-6 w-fit"
        label="Follow-up status"
        value={showCompleted ? 'completed' : 'active'}
        onChange={(k) => setShowCompleted(k === 'completed')}
        tabs={[
          { key: 'active', label: 'Active', count: pending.length },
          { key: 'completed', label: 'Completed', count: completed.length },
        ]}
      />

      <div className="mt-6">
        {displayList.length === 0 ? (
          <div className="rounded-2xl border border-rally-line bg-white p-6 shadow-card">
            <EmptyState
              icon={showCompleted ? <CheckCircle2 className="h-10 w-10" /> : <CalendarClock className="h-10 w-10" />}
              title={showCompleted ? 'No completed follow-ups' : 'No active follow-ups'}
              description={
                showCompleted
                  ? 'Completed follow-ups will appear here once you start marking them done.'
                  : pending.length === 0 && completed.length > 0
                    ? 'All your follow-ups are completed. Great work!'
                    : "Schedule follow-ups from a connection's detail page to stay in touch with your network."
              }
            />
          </div>
        ) : showCompleted ? (
          <div className="space-y-3">{displayList.map(renderFollowUp)}</div>
        ) : (
          <>
            {renderSection('Overdue', overdue, <AlertCircle className="h-5 w-5 text-error-600" />)}
            {renderSection('Due today', today, <CalendarDays className="h-5 w-5 text-warning-600" />)}
            {renderSection('Upcoming', upcoming, <CalendarClock className="h-5 w-5 text-primary-600" />)}
          </>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-float" role="dialog" aria-modal="true" aria-label="Edit follow-up" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-rally-navy">Edit Follow-up</h3>
              <button onClick={() => setEditing(null)} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:bg-rally-tint hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <Label htmlFor="edit_title">Title</Label>
                <Input id="edit_title" required value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="edit_note">Note</Label>
                <Textarea id="edit_note" rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} placeholder="Add context about this follow-up…" />
              </div>
              <div>
                <Label htmlFor="edit_due">Due date</Label>
                <Input id="edit_due" type="date" required value={editForm.due_date} onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} />
              </div>
              {editError && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{editError}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" disabled={saving}>
                  <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
