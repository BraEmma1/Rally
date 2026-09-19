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
  ArrowRight,
  AlertCircle,
  CalendarDays,
} from 'lucide-react'
import { supabase, type FollowUp, type Connection } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate } from '@/lib/utils'

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

    return (
      <Card key={fu.id} className={fu.completed ? 'opacity-60' : ''}>
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            {/* Complete toggle */}
            <button
              onClick={() => fu.completed ? handleUncomplete(fu) : handleComplete(fu)}
              className="mt-0.5 flex-shrink-0"
            >
              {fu.completed ? (
                <CheckCircle2 className="h-5 w-5 text-accent-600" />
              ) : (
                <Circle className="h-5 w-5 text-gray-300 hover:text-gray-400" />
              )}
            </button>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${fu.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {fu.title}
                  </p>
                  {fu.note && (
                    <p className="mt-0.5 text-sm text-gray-600">{fu.note}</p>
                  )}

                  {/* Connection info */}
                  {conn && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Link
                        to={`/connections/${conn.id}`}
                        className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1 text-xs hover:bg-gray-100"
                      >
                        <Avatar name={conn.full_name || '?'} src={conn.photo_url} size="xs" />
                        <span className="font-medium text-gray-700">{conn.full_name}</span>
                        {conn.company && <span className="text-gray-400">· {conn.company}</span>}
                      </Link>
                      <Badge variant="gray">{conn.relationship_type}</Badge>
                      {conn.event_name && (
                        <span className="text-xs text-gray-400">Met at {conn.event_name}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Date badge */}
                <div className="flex-shrink-0">
                  {fu.completed ? (
                    <Badge variant="success">Completed {fu.completed_at ? formatDate(fu.completed_at) : ''}</Badge>
                  ) : overdueFlag ? (
                    <Badge variant="error">Overdue · {formatRelativeDate(fu.due_date)}</Badge>
                  ) : todayFlag ? (
                    <Badge variant="warning">Today</Badge>
                  ) : (
                    <Badge variant="primary">{formatRelativeDate(fu.due_date)}</Badge>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!fu.completed && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => handleComplete(fu)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                    </Button>
                    <div className="relative inline-flex">
                      <Input
                        type="date"
                        className="h-8 w-auto text-xs"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) handleReschedule(fu, e.target.value)
                          e.target.value = ''
                        }}
                      />
                      <Button size="sm" variant="ghost" className="pointer-events-none">
                        <CalendarClock className="h-3.5 w-3.5" /> Reschedule
                      </Button>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(fu)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  </>
                )}
                {fu.completed && (
                  <Button size="sm" variant="ghost" onClick={() => startEdit(fu)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-error-600 hover:bg-error-50" onClick={() => handleDelete(fu)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                {conn && (
                  <Link to={`/connections/${conn.id}`}>
                    <Button size="sm" variant="ghost">
                      Open connection <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  function renderSection(title: string, items: FollowUpWithConnection[], icon: React.ReactNode) {
    if (items.length === 0) return null
    return (
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{items.length}</span>
        </div>
        <div className="space-y-2">{items.map(renderFollowUp)}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Follow-ups</h1>
          <p className="mt-1 text-sm text-gray-500">Stay on top of your networking tasks</p>
        </div>
        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => setShowCompleted(false)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              !showCompleted ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Active ({pending.length})
          </button>
          <button
            onClick={() => setShowCompleted(true)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              showCompleted ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Completed ({completed.length})
          </button>
        </div>
      </div>

      <div className="mt-6">
        {displayList.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={showCompleted ? <CheckCircle2 className="h-10 w-10" /> : <CalendarClock className="h-10 w-10" />}
                title={showCompleted ? 'No completed follow-ups' : 'No active follow-ups'}
                description={
                  showCompleted
                    ? 'Completed follow-ups will appear here once you start marking them done.'
                    : pending.length === 0 && completed.length > 0
                      ? 'All your follow-ups are completed. Great work!'
                      : 'Schedule follow-ups from a connection\'s detail page to stay in touch with your network.'
                }
              />
            </CardContent>
          </Card>
        ) : showCompleted ? (
          <div className="space-y-2">{displayList.map(renderFollowUp)}</div>
        ) : (
          <>
            {renderSection('Overdue', overdue, <AlertCircle className="h-4 w-4 text-error-600" />)}
            {renderSection('Today', today, <CalendarDays className="h-4 w-4 text-warning-600" />)}
            {renderSection('Upcoming', upcoming, <CalendarClock className="h-4 w-4 text-primary-600" />)}
            {overdue.length === 0 && today.length === 0 && upcoming.length === 0 && (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={<CheckCircle2 className="h-10 w-10" />}
                    title="All caught up!"
                    description="You have no pending follow-ups. Schedule new ones from your connections."
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <div className="relative w-full max-w-md rounded-lg bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Edit Follow-up</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
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
                <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
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
