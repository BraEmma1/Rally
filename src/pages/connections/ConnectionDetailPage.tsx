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
  Target,
} from 'lucide-react'
import { supabase, type Connection, type Note, type FollowUp, type Opportunity, RELATIONSHIP_TYPES, OPPORTUNITY_TYPES, OPPORTUNITY_STAGES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate, normalizeUrl, displayUrl } from '@/lib/utils'

export default function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])

  // Relationship type editor
  const [editingRelationship, setEditingRelationship] = useState(false)
  const [savingRelationship, setSavingRelationship] = useState(false)
  const [relationshipType, setRelationshipType] = useState('Other')

  // Note editing
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [savingEditNote, setSavingEditNote] = useState(false)

  const [newFollowUp, setNewFollowUp] = useState({ title: '', due_date: '' })
  const [savingFollowUp, setSavingFollowUp] = useState(false)
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [showOppForm, setShowOppForm] = useState(false)
  const [savingOpp, setSavingOpp] = useState(false)
  const [oppForm, setOppForm] = useState({ title: '', type: 'Sales', value: '', stage: 'New', expected_close_date: '', description: '' })

  async function loadData() {
    if (!id || !user) return
    setLoading(true)
    setError(null)
    try {
      const [connRes, notesRes, followRes, oppRes] = await Promise.all([
        supabase.from('connections').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle(),
        supabase.from('notes').select('*').eq('connection_id', id).eq('owner_id', user.id).order('created_at', { ascending: false }),
        supabase.from('follow_ups').select('*').eq('connection_id', id).eq('owner_id', user.id).order('due_date', { ascending: true }),
        supabase.from('opportunities').select('*').eq('connection_id', id).eq('owner_id', user.id).order('updated_at', { ascending: false }),
      ])
      if (connRes.error) throw connRes.error
      if (notesRes.error) throw notesRes.error
      if (followRes.error) throw followRes.error

      if (!connRes.data) {
        setError('Connection not found.')
        setLoading(false)
        return
      }
      const conn = connRes.data as Connection
      setConnection(conn)
      setRelationshipType(conn.relationship_type || 'Other')
      setNotes(notesRes.data as Note[])
      setFollowUps(followRes.data as FollowUp[])
      setOpportunities((oppRes.data as Opportunity[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connection.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id, user])

  async function handleSaveRelationship(e: FormEvent) {
    e.preventDefault()
    if (!id || !user) return
    setSavingRelationship(true)
    const { error: updateError } = await supabase
      .from('connections')
      .update({ relationship_type: relationshipType, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', user.id)
    if (updateError) {
      setError(updateError.message)
      setSavingRelationship(false)
      return
    }
    setConnection({ ...connection!, relationship_type: relationshipType })
    setSavingRelationship(false)
    setEditingRelationship(false)
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

  function startEditNote(note: Note) {
    setEditingNoteId(note.id)
    setEditNoteContent(note.content)
  }

  async function handleSaveEditNote(e: FormEvent) {
    e.preventDefault()
    if (!user || !editingNoteId) return
    setSavingEditNote(true)
    const { error: noteError } = await supabase
      .from('notes')
      .update({ content: editNoteContent.trim(), updated_at: new Date().toISOString() })
      .eq('id', editingNoteId)
      .eq('owner_id', user.id)
    if (noteError) {
      setError(noteError.message)
      setSavingEditNote(false)
      return
    }
    setNotes(notes.map((n) => n.id === editingNoteId ? { ...n, content: editNoteContent.trim() } : n))
    setEditingNoteId(null)
    setEditNoteContent('')
    setSavingEditNote(false)
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

  async function handleAddOpportunity(e: FormEvent) {
    e.preventDefault()
    if (!id || !user || !oppForm.title.trim()) return
    setSavingOpp(true)
    const { data, error: oppError } = await supabase
      .from('opportunities')
      .insert({
        owner_id: user.id,
        connection_id: id,
        title: oppForm.title.trim(),
        type: oppForm.type,
        description: oppForm.description || '',
        value: oppForm.value ? parseFloat(oppForm.value) : 0,
        stage: oppForm.stage,
        expected_close_date: oppForm.expected_close_date || null,
        event_name: connection?.event_name || '',
        event_id: connection?.event_id ?? null,
      })
      .select()
      .single()
    if (oppError) {
      setError(oppError.message)
      setSavingOpp(false)
      return
    }
    setOpportunities([data as Opportunity, ...opportunities])
    setOppForm({ title: '', type: 'Sales', value: '', stage: 'New', expected_close_date: '', description: '' })
    setShowOppForm(false)
    setSavingOpp(false)
  }

  if (loading) return <LoadingState message="Loading connection…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />
  if (!connection) return <ErrorState message="Connection not found." />

  const linkedinUrl = normalizeUrl(connection.linkedin)
  const websiteUrl = normalizeUrl(connection.website)
  const hasContact = connection.email || connection.phone || linkedinUrl || websiteUrl

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
                  <Badge variant="gray">Connected {formatDate(connection.created_at)}</Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditingRelationship(!editingRelationship)}>
                {editingRelationship ? <><X className="h-4 w-4" /> Cancel</> : <><Pencil className="h-4 w-4" /> Edit relationship</>}
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteConnection}>
                <Trash2 className="h-4 w-4" /> Remove connection
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {editingRelationship && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Edit Relationship Type</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSaveRelationship} className="space-y-4">
              <div>
                <Label>Relationship type</Label>
                <Select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)}>
                  {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <p className="mt-2 text-xs text-gray-400">
                  This is your private label for how you know this person. Their profile information is read-only.
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingRelationship}><Save className="h-4 w-4" /> {savingRelationship ? 'Saving…' : 'Save'}</Button>
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
                  {linkedinUrl && (
                    <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Linkedin className="h-4 w-4 text-gray-400" /> {displayUrl(linkedinUrl)}
                    </a>
                  )}
                  {websiteUrl && (
                    <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                      <Globe className="h-4 w-4 text-gray-400" /> {displayUrl(websiteUrl)}
                    </a>
                  )}
                </>
              ) : (
                <EmptyState title="No contact info" description="This person hasn't added contact details to their profile yet." />
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
                    {editingNoteId === note.id ? (
                      <form onSubmit={handleSaveEditNote} className="space-y-2">
                        <Textarea
                          rows={3}
                          value={editNoteContent}
                          onChange={(e) => setEditNoteContent(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={savingEditNote || !editNoteContent.trim()}>
                            <Save className="h-3.5 w-3.5" /> {savingEditNote ? 'Saving…' : 'Save'}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setEditingNoteId(null)}>
                            <X className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-gray-400">{formatDate(note.created_at)}</span>
                          <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => startEditNote(note)}
                              className="text-gray-300 hover:text-primary-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteNote(note.id)}
                              className="text-gray-300 hover:text-error-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
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

      {/* Opportunities */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Opportunities</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setShowOppForm(!showOppForm)}>
              {showOppForm ? <><X className="h-3.5 w-3.5" /> Cancel</> : <><Plus className="h-3.5 w-3.5" /> Create opportunity</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showOppForm && (
            <form onSubmit={handleAddOpportunity} className="space-y-3 rounded-md border border-gray-200 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Title *</Label>
                  <Input required value={oppForm.title} onChange={(e) => setOppForm({ ...oppForm, title: e.target.value })} placeholder="Enterprise deal" />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={oppForm.type} onChange={(e) => setOppForm({ ...oppForm, type: e.target.value })}>
                    {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Value ($)</Label>
                  <Input type="number" min="0" step="1000" value={oppForm.value} onChange={(e) => setOppForm({ ...oppForm, value: e.target.value })} placeholder="50000" />
                </div>
                <div>
                  <Label>Stage</Label>
                  <Select value={oppForm.stage} onChange={(e) => setOppForm({ ...oppForm, stage: e.target.value })}>
                    {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Expected close date</Label>
                  <Input type="date" value={oppForm.expected_close_date} onChange={(e) => setOppForm({ ...oppForm, expected_close_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea rows={2} value={oppForm.description} onChange={(e) => setOppForm({ ...oppForm, description: e.target.value })} placeholder="Describe this opportunity…" />
              </div>
              <Button type="submit" size="sm" disabled={savingOpp}>
                {savingOpp ? 'Creating…' : 'Create opportunity'}
              </Button>
            </form>
          )}

          {opportunities.length > 0 ? (
            <div className="space-y-2">
              {opportunities.map((opp) => (
                <Link
                  key={opp.id}
                  to={`/opportunities/${opp.id}`}
                  className="flex items-center gap-3 rounded-md border border-gray-200 p-3 transition-colors hover:border-primary-300 hover:bg-primary-50/30"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50">
                    <Target className="h-4 w-4 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{opp.title}</p>
                    <p className="text-xs text-gray-500">{opp.type}{opp.value > 0 ? ` · ${opp.value.toLocaleString()}` : ''}</p>
                  </div>
                  <Badge variant={opp.stage === 'Won' ? 'success' : opp.stage === 'Lost' ? 'error' : 'primary'}>
                    {opp.stage}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : !showOppForm ? (
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              title="No opportunities yet"
              description="Track deals, investments, or partnerships from this connection."
              action={<Button size="sm" variant="secondary" onClick={() => setShowOppForm(true)}><Plus className="h-4 w-4" /> Create opportunity</Button>}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
