import { useEffect, useState, type FormEvent } from 'react'
import { Plus, X, Calendar, MapPin, Trash2, Pencil } from 'lucide-react'
import { supabase, type EventRow } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate } from '@/lib/utils'

const EVENT_STATUSES = ['upcoming', 'attending', 'attended'] as const

export default function EventsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    description: '',
    location: '',
    start_date: '',
    end_date: '',
    status: 'upcoming' as string,
  })

  async function loadEvents() {
    if (!user) return
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await supabase
      .from('events')
      .select('*')
      .eq('owner_id', user.id)
      .order('start_date', { ascending: true })
    if (queryError) {
      setError(queryError.message)
    } else {
      setEvents(data as EventRow[])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadEvents()
  }, [user])

  function resetForm() {
    setForm({ name: '', description: '', location: '', start_date: '', end_date: '', status: 'upcoming' })
    setEditingId(null)
    setFormError(null)
  }

  function startEdit(event: EventRow) {
    setForm({
      name: event.name,
      description: event.description || '',
      location: event.location || '',
      start_date: event.start_date || '',
      end_date: event.end_date || '',
      status: event.status,
    })
    setEditingId(event.id)
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    setFormError(null)

    const payload = {
      owner_id: user.id,
      name: form.name,
      description: form.description || '',
      location: form.location || '',
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status,
    }

    if (editingId) {
      const { error: updateError } = await supabase
        .from('events')
        .update(payload)
        .eq('id', editingId)
        .eq('owner_id', user.id)
      if (updateError) {
        setFormError(updateError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: insertError } = await supabase
        .from('events')
        .insert(payload)
      if (insertError) {
        setFormError(insertError.message)
        setSaving(false)
        return
      }
    }

    resetForm()
    setShowForm(false)
    setSaving(false)
    loadEvents()
  }

  async function handleDelete(eventId: string) {
    if (!user) return
    if (!confirm('Delete this event?')) return
    await supabase.from('events').delete().eq('id', eventId).eq('owner_id', user.id)
    setEvents(events.filter((e) => e.id !== eventId))
  }

  if (loading) return <LoadingState message="Loading events…" />
  if (error) return <ErrorState message={error} onRetry={loadEvents} />

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Events</h1>
          <p className="mt-1 text-sm text-gray-500">Track events you're attending or have attended</p>
        </div>
        <Button onClick={() => { setShowForm(!showForm); if (showForm) resetForm() }}>
          {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Add event</>}
        </Button>
      </div>

      {showForm && (
        <Card className="mt-4">
          <CardHeader><CardTitle>{editingId ? 'Edit Event' : 'New Event'}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="name">Event name *</Label>
                  <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="TechConf 2026" />
                </div>
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="San Francisco, CA" />
                </div>
                <div>
                  <Label htmlFor="start_date">Start date</Label>
                  <Input id="start_date" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="end_date">End date</Label>
                  <Input id="end_date" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select id="status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this event about?" />
              </div>
              {formError && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{formError}</div>}
              <div className="flex justify-end gap-3">
                {editingId && <Button variant="secondary" onClick={resetForm}>Cancel edit</Button>}
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update event' : 'Add event'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 space-y-2">
        {events.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Calendar className="h-10 w-10" />}
                title="No events yet"
                description="Add events you're planning to attend so you can prepare your networking."
                action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Add event</Button>}
              />
            </CardContent>
          </Card>
        ) : (
          events.map((event) => (
            <Card key={event.id}>
              <CardContent className="flex items-start gap-4 py-4">
                <div className="flex h-12 w-12 flex-col items-center justify-center rounded-md bg-primary-50 text-primary-700 flex-shrink-0">
                  <span className="text-xs font-medium">
                    {event.start_date ? new Date(event.start_date).toLocaleDateString('en-US', { month: 'short' }) : '?'}
                  </span>
                  <span className="text-lg font-bold leading-none">
                    {event.start_date ? new Date(event.start_date).getDate() : '—'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{event.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatDate(event.start_date)}{event.end_date ? ` – ${formatDate(event.end_date)}` : ''}
                      </p>
                      {event.location && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                          <MapPin className="h-3 w-3" /> {event.location}
                        </p>
                      )}
                      {event.description && (
                        <p className="mt-2 text-sm text-gray-600">{event.description}</p>
                      )}
                    </div>
                    <Badge variant={event.status === 'upcoming' ? 'primary' : event.status === 'attended' ? 'success' : 'gray'}>
                      {event.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(event)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(event.id)} className="text-error-600 hover:bg-error-50">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
