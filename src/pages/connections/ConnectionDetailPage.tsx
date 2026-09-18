import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Mail,
  Phone,
  Linkedin,
  Globe,
  MapPin,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Pencil,
  Save,
  X,
} from 'lucide-react'
import { supabase, type Connection, type Note, type FollowUp, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate } from '@/lib/utils'

export default function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Connection>>({})

  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [newFollowUp, setNewFollowUp] = useState({ title: '', due_date: '' })
  const [savingFollowUp, setSavingFollowUp] = useState(false)

  async function loadData() {
    if (!id || !user) return
    setLoading(true)
    setError(null)
    try {
      const [connRes, notesRes, followRes] = await Promise.all([
        supabase.from('connections').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle(),
        supabase.from('notes').select('*').eq('connection_id', id).eq('owner_id', user.id).order('created_at', { ascending: false }),
        supabase.from('follow_ups').select('*').eq('connection_id', id).eq('owner_id', user.id).order('due_date', { ascending: true }),
      ])
      if (connRes.error) throw connRes.error
      if (notesRes.error) throw notesRes.error
      if (followRes.error) throw followRes.error

      if (!connRes.data) {
        setError('Connection not found.')
        setLoading(false)
        return
      }
      setConnection(connRes.data as Connection)
      setEditForm(connRes.data as Connection)
      setNotes(notesRes.data as Note[])
      setFollowUps(followRes.data as FollowUp[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connection.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id, user])

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!id || !user) return
    setSaving(true)
    const { error: updateError } = await supabase
      .from('connections')
      .update({
        full_name: editForm.full_name,
        job_title: editForm.job_title || '',
        company: editForm.company || '',
        industry: editForm.industry || '',
        location: editForm.location || '',
        email: editForm.email || '',
        phone: editForm.phone || '',
        linkedin: editForm.linkedin || '',
        website: editForm.website || '',
        relationship_type: editForm.relationship_type || 'Other',
        event_name: editForm.event_name || '',
        follow_up_date: editForm.follow_up_date || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_id', user.id)
    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    setSaving(false)
    setEditing(false)
    loadData()
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault()
    if (!id || !user || !newNote.trim()) return
    setSavingNote(true)
    const { data, error: noteError } = await supabase
      .from('notes')
      .insert({ connection_id: id, owner_id: user.id, content: newNote.trim() })
      .select()
      .single()
    if (noteError) {
      setError(noteError.message)
      setSavingNote(false)
      return
    }
    setNotes([data as Note, ...notes])
    setNewNote('')
    setSavingNote(false)
  }

  async function handleDeleteNote(noteId: string) {
    if (!user) return
    await supabase.from('notes').delete().eq('id', noteId).eq('owner_id', user.id)
    setNotes(notes.filter((n) => n.id !== noteId))
  }

  async function handleAddFollowUp(e: FormEvent) {
    e.preventDefault()
    if (!id || !user || !newFollowUp.title.trim() || !newFollowUp.due_date) return
    setSavingFollowUp(true)
    const { data, error: fuError } = await supabase
      .from('follow_ups')
      .insert({
        connection_id: id,
        owner_id: user.id,
        title: newFollowUp.title.trim(),
        due_date: newFollowUp.due_date,
      })
      .select()
      .single()
    if (fuError) {
      setError(fuError.message)
      setSavingFollowUp(false)
      return
    }
    setFollowUps([...followUps, data as FollowUp].sort((a, b) => a.due_date.localeCompare(b.due_date)))
    setNewFollowUp({ title: '', due_date: '' })
    setSavingFollowUp(false)
  }

  async function toggleFollowUp(fu: FollowUp) {
    if (!user) return
    const completed = !fu.completed
    const { error: updateError } = await supabase
      .from('follow_ups')
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq('id', fu.id)
      .eq('owner_id', user.id)
    if (updateError) return
    setFollowUps(followUps.map((f) => f.id === fu.id ? { ...f, completed, completed_at: completed ? new Date().toISOString() : null } : f))
  }

  async function deleteFollowUp(fuId: string) {
    if (!user) return
    await supabase.from('follow_ups').delete().eq('id', fuId).eq('owner_id', user.id)
    setFollowUps(followUps.filter((f) => f.id !== fuId))
  }

  async function handleDeleteConnection() {
    if (!id || !user) return
    if (!confirm('Delete this connection and all its notes and follow-ups?')) return
    await supabase.from('connections').delete().eq('id', id).eq('owner_id', user.id)
    navigate('/connections')
  }

  if (loading) return <LoadingState message="Loading connection…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />
  if (!connection) return <ErrorState message="Connection not found." />

  const hasContact = connection.email || connection.phone || connection.linkedin || connection.website

  return (
    <div>
      <Link to="/connections" className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to connections
      </Link>

      {/* Connection header */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Avatar name={connection.full_name} src={connection.photo_url} size="xl" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{connection.full_name}</h1>
                <p className="mt-0.5 text-sm text-gray-600">
                  {connection.job_title}{connection.company ? ` at ${connection.company}` : ''}
                </p>
                {connection.location && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" /> {connection.location}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="primary">{connection.relationship_type}</Badge>
                  {connection.event_name && <Badge variant="gray">{connection.event_name}</Badge>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(!editing)}>
                {editing ? <><X className="h-4 w-4" /> Cancel</> : <><Pencil className="h-4 w-4" /> Edit</>}
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteConnection}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Edit Connection</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Full name *</Label>
                  <Input required value={editForm.full_name || ''} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
                </div>
                <div>
                  <Label>Job title</Label>
                  <Input value={editForm.job_title || ''} onChange={(e) => setEditForm({ ...editForm, job_title: e.target.value })} />
                </div>
                <div>
                  <Label>Company</Label>
                  <Input value={editForm.company || ''} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })} />
                </div>
                <div>
                  <Label>Industry</Label>
                  <Input value={editForm.industry || ''} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input value={editForm.location || ''} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
                </div>
                <div>
                  <Label>Relationship type</Label>
                  <Select value={editForm.relationship_type || 'Other'} onChange={(e) => setEditForm({ ...editForm, relationship_type: e.target.value })}>
                    {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </div>
                <div>
                  <Label>Phone / WhatsApp</Label>
                  <Input value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>
                <div>
                  <Label>LinkedIn URL</Label>
                  <Input value={editForm.linkedin || ''} onChange={(e) => setEditForm({ ...editForm, linkedin: e.target.value })} />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input value={editForm.website || ''} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
                </div>
                <div>
                  <Label>Met at event</Label>
                  <Input value={editForm.event_name || ''} onChange={(e) => setEditForm({ ...editForm, event_name: e.target.value })} />
                </div>
                <div>
                  <Label>Follow-up date</Label>
                  <Input type="date" value={editForm.follow_up_date || ''} onChange={(e) => setEditForm({ ...editForm, follow_up_date: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Contact info */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contact Information</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {hasContact ? (
                <>
                  {connection.email && (
                    <a href={`mailto:${connection.email}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Mail className="h-4 w-4 text-gray-400" /> {connection.email}
                    </a>
                  )}
                  {connection.phone && (
                    <a href={`tel:${connection.phone}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Phone className="h-4 w-4 text-gray-400" /> {connection.phone}
                    </a>
                  )}
                  {connection.linkedin && (
                    <a href={connection.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Linkedin className="h-4 w-4 text-gray-400" /> {connection.linkedin.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {connection.website && (
                    <a href={connection.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Globe className="h-4 w-4 text-gray-400" /> {connection.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </>
              ) : (
                <EmptyState title="No contact info" description="Edit this connection to add contact details." />
              )}
            </CardContent>
          </Card>

          {/* Follow-ups */}
          <Card>
            <CardHeader><CardTitle>Follow-ups</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {followUps.length > 0 && (
                <div className="space-y-2">
                  {followUps.map((fu) => {
                    const isOverdue = !fu.completed && new Date(fu.due_date) < new Date(new Date().toDateString())
                    return (
                      <div key={fu.id} className="flex items-center gap-3 rounded-md border border-gray-200 p-3">
                        <button onClick={() => toggleFollowUp(fu)} className="flex-shrink-0">
                          {fu.completed ? (
                            <CheckCircle2 className="h-5 w-5 text-accent-600" />
                          ) : (
                            <Circle className="h-5 w-5 text-gray-300 hover:text-gray-400" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium ${fu.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{fu.title}</p>
                          <p className={`text-xs ${isOverdue ? 'text-error-600' : 'text-gray-500'}`}>
                            {formatRelativeDate(fu.due_date)}
                          </p>
                        </div>
                        <button onClick={() => deleteFollowUp(fu.id)} className="text-gray-400 hover:text-error-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              <form onSubmit={handleAddFollowUp} className="space-y-3 border-t border-gray-100 pt-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <Input
                    placeholder="Follow-up title…"
                    value={newFollowUp.title}
                    onChange={(e) => setNewFollowUp({ ...newFollowUp, title: e.target.value })}
                    required
                  />
                  <Input
                    type="date"
                    value={newFollowUp.due_date}
                    onChange={(e) => setNewFollowUp({ ...newFollowUp, due_date: e.target.value })}
                    required
                  />
                </div>
                <Button type="submit" size="sm" variant="secondary" disabled={savingFollowUp} className="w-full">
                  <Plus className="h-4 w-4" /> {savingFollowUp ? 'Adding…' : 'Add follow-up'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Notes */}
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {notes.length > 0 && (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="group rounded-md border border-gray-200 p-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-400">{formatDate(note.created_at)}</span>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-gray-300 opacity-0 transition-opacity hover:text-error-600 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {notes.length === 0 && (
              <EmptyState title="No notes yet" description="Record context about this person and your interactions." />
            )}

            <form onSubmit={handleAddNote} className="space-y-3 border-t border-gray-100 pt-3">
              <Textarea
                placeholder="Add a note about this person…"
                rows={3}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={savingNote || !newNote.trim()} className="w-full">
                {savingNote ? 'Saving…' : 'Add note'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
