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
  MoreVertical,
  CalendarClock,
  StickyNote,
  Link2,
  Briefcase,
  CalendarCheck,
} from 'lucide-react'
import { supabase, type Connection, type Note, type FollowUp, type Opportunity, RELATIONSHIP_TYPES, OPPORTUNITY_TYPES, OPPORTUNITY_STAGES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate, normalizeUrl, displayUrl, cn } from '@/lib/utils'

// Relationship history timeline, built only from rows that already exist:
// the connection itself, its notes, its follow-ups and its opportunities.
type HistoryItem = {
  key: string
  type: 'Connected' | 'Note' | 'Follow-up' | 'Opportunity'
  title: string
  detail?: string
  when: string
  tone: 'primary' | 'accent' | 'gray' | 'warning'
}

function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildHistory(
  connection: Connection,
  notes: Note[],
  followUps: FollowUp[],
  opportunities: Opportunity[]
): HistoryItem[] {
  const items: HistoryItem[] = []

  items.push({
    key: 'connected',
    type: 'Connected',
    title: connection.event_name ? `Met at ${connection.event_name}` : 'Connection created',
    detail: connection.event_name ? undefined : 'You added this person to your network.',
    when: connection.created_at,
    tone: 'primary',
  })

  for (const note of notes) {
    items.push({
      key: `note-${note.id}`,
      type: 'Note',
      title: note.content.length > 120 ? `${note.content.slice(0, 117)}…` : note.content,
      when: note.created_at,
      tone: 'gray',
    })
  }

  for (const fu of followUps) {
    items.push({
      key: `followup-${fu.id}`,
      type: 'Follow-up',
      title: fu.title,
      detail: fu.completed
        ? `Completed ${fu.completed_at ? formatDate(fu.completed_at) : ''}`.trim()
        : `Due ${formatRelativeDate(fu.due_date)}`,
      when: fu.completed_at ?? fu.created_at,
      tone: fu.completed ? 'accent' : fu.due_date < localDateString(new Date()) ? 'warning' : 'gray',
    })
  }

  for (const opp of opportunities) {
    items.push({
      key: `opportunity-${opp.id}`,
      type: 'Opportunity',
      title: opp.title,
      detail: [opp.stage, opp.value > 0 ? opp.value.toLocaleString() : null].filter(Boolean).join(' · '),
      when: opp.updated_at,
      tone: 'accent',
    })
  }

  return items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
}

const TIMELINE_ICONS = {
  Connected: Link2,
  Note: StickyNote,
  'Follow-up': CalendarClock,
  Opportunity: Target,
} as const

const TIMELINE_DOT_STYLES = {
  primary: 'bg-primary-600',
  accent: 'bg-accent-600',
  gray: 'bg-gray-300',
  warning: 'bg-warning-500',
} as const

type TabKey = 'about' | 'notes' | 'followups' | 'opportunities'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'about', label: 'About' },
  { key: 'notes', label: 'Notes' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'opportunities', label: 'Opportunities' },
]

export default function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])

  const [tab, setTab] = useState<TabKey>('about')
  const [menuOpen, setMenuOpen] = useState(false)

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
  const history = buildHistory(connection, notes, followUps, opportunities)
  const openFollowUps = followUps.filter((f) => !f.completed)
  const nextFollowUp = openFollowUps[0]
  const nextIsOverdue = nextFollowUp && nextFollowUp.due_date < localDateString(new Date())

  return (
    <div className="mx-auto max-w-md pb-10">
      {/* Top bar */}
      <div className="relative flex items-center justify-between py-3">
        <Link to="/connections" aria-label="Back to network" className="rounded-full p-2 -ml-2 text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold text-gray-700">Connection</span>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Connection options"
          className="rounded-full p-2 -mr-2 text-gray-500 hover:text-gray-700"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
            <button
              onClick={() => {
                setEditingRelationship(true)
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="h-4 w-4 text-gray-400" /> Edit relationship
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                void handleDeleteConnection()
              }}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-sm text-error-600 hover:bg-error-50"
            >
              <Trash2 className="h-4 w-4" /> Remove connection
            </button>
          </div>
        )}
      </div>

      {/* Person — compact profile header */}
      <div className="flex items-center gap-3">
        <Avatar name={connection.full_name} src={connection.photo_url} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-gray-900">{connection.full_name}</h1>
          <p className="truncate text-sm text-gray-600">
            {connection.job_title}
            {connection.company ? (connection.job_title ? ` · ${connection.company}` : connection.company) : ''}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-400">
            {connection.event_name ? `Connected at ${connection.event_name}` : `Connected on ${formatDate(connection.created_at)}`}
          </p>
        </div>
      </div>

      {editingRelationship && (
        <Card className="mt-4">
          <CardContent>
            <form onSubmit={handleSaveRelationship} className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Relationship type</Label>
                <button type="button" onClick={() => setEditingRelationship(false)} aria-label="Close editor" className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)}>
                {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              <p className="text-xs text-gray-400">
                Your private label for how you know this person. Their profile information is read-only.
              </p>
              <Button type="submit" size="sm" disabled={savingRelationship} className="w-full">
                <Save className="h-3.5 w-3.5" /> {savingRelationship ? 'Saving…' : 'Save'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Pill tabs */}
      <div className="mt-4 -mx-4 overflow-x-auto px-4">
        <div className="flex w-max gap-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {tab === 'about' && (
          <>
            {/* Profile card */}
            <Card>
              <CardContent className="pt-5">
                <div className="flex flex-col items-center text-center">
                  <Avatar name={connection.full_name} src={connection.photo_url} size="xl" />
                  <h2 className="mt-3 text-base font-bold text-gray-900">{connection.full_name}</h2>
                  <p className="mt-0.5 text-sm text-gray-600">
                    {connection.job_title}
                    {connection.company ? (connection.job_title ? ` · ${connection.company}` : connection.company) : ''}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    {connection.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {connection.location}
                      </span>
                    )}
                    {connection.industry && <span>{connection.industry}</span>}
                    <span>Connected on {formatDate(connection.created_at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <Badge variant="primary">{connection.relationship_type}</Badge>
                    {connection.event_name && (
                      <Badge variant="gray">
                        <Briefcase className="mr-1 inline h-3 w-3" />
                        {connection.event_name}
                      </Badge>
                    )}
                  </div>
                  {(linkedinUrl || websiteUrl) && (
                    <div className="mt-4 flex w-full flex-col gap-2 border-t border-gray-100 pt-4">
                      {linkedinUrl && (
                        <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700">
                          <span className="inline-flex items-center gap-2">
                            <Linkedin className="h-4 w-4 text-primary-600" /> LinkedIn
                          </span>
                          <span className="truncate text-xs text-gray-400">{displayUrl(linkedinUrl)}</span>
                        </a>
                      )}
                      {websiteUrl && (
                        <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700">
                          <span className="inline-flex items-center gap-2">
                            <Globe className="h-4 w-4 text-gray-400" /> Website
                          </span>
                          <span className="truncate text-xs text-gray-400">{displayUrl(websiteUrl)}</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quick contact actions — only channels that exist */}
            {(connection.email || connection.phone) && (
              <div className="grid grid-cols-2 gap-2">
                {connection.email && (
                  <a href={`mailto:${connection.email}`}>
                    <Button variant="secondary" size="sm" className="w-full"><Mail className="h-4 w-4" /> Message</Button>
                  </a>
                )}
                {connection.phone && (
                  <a href={`tel:${connection.phone}`}>
                    <Button variant="secondary" size="sm" className="w-full"><Phone className="h-4 w-4" /> Call</Button>
                  </a>
                )}
              </div>
            )}

            {/* Next Step */}
            <div>
              <h3 className="text-sm font-bold text-gray-900">Next step</h3>
              {nextFollowUp ? (
                <div className={cn('mt-2 rounded-md p-4', nextIsOverdue ? 'bg-warning-50' : 'bg-primary-50')}>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Next step</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{nextFollowUp.title}</p>
                  <p className={cn('mt-1 text-xs', nextIsOverdue ? 'text-warning-700' : 'text-primary-700')}>
                    {nextIsOverdue ? 'Overdue — due ' : 'Due '}
                    {formatRelativeDate(nextFollowUp.due_date)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => void toggleFollowUp(nextFollowUp)}>
                      <CheckCircle2 className="h-4 w-4" /> Complete
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-md bg-gray-50 p-4">
                  <p className="text-sm text-gray-600">No open follow-up scheduled.</p>
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => setTab('followups')}>
                    <Plus className="h-4 w-4" /> Add follow-up
                  </Button>
                </div>
              )}
            </div>

            {/* Relationship history */}
            <Card>
              <CardContent className="py-4">
                <h3 className="text-sm font-bold text-gray-900">Relationship history</h3>
                {history.length === 0 ? (
                  <EmptyState title="No history yet" description="Notes, follow-ups and opportunities will appear here as they happen." />
                ) : (
                  <ol className="relative mt-3 space-y-4 border-l border-gray-200 pl-5">
                    {history.map((item) => {
                      const Icon = TIMELINE_ICONS[item.type]
                      return (
                        <li key={item.key} className="relative">
                          <span
                            className={cn(
                              'absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white',
                              TIMELINE_DOT_STYLES[item.tone]
                            )}
                          >
                            <Icon className="h-2.5 w-2.5 text-white" />
                          </span>
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{item.type}</p>
                          <p className="mt-0.5 text-sm font-medium text-gray-900">{item.title}</p>
                          {item.detail && <p className="mt-0.5 text-xs text-gray-500">{item.detail}</p>}
                          <p className="mt-0.5 text-xs text-gray-400">{formatDate(item.when)}</p>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {tab === 'notes' && (
          <>
            <Card>
              <CardContent>
                <form onSubmit={handleAddNote} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StickyNote className="h-4 w-4 text-gray-400" />
                    <Label>Add a note</Label>
                  </div>
                  <Textarea
                    placeholder="Context about this person, topics discussed…"
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

            {notes.length === 0 ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={<StickyNote className="h-8 w-8" />}
                    title="No notes yet"
                    description="Record context about this person and your interactions."
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <Card key={note.id}>
                    <CardContent>
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
                          <p className="whitespace-pre-wrap text-sm text-gray-700">{note.content}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-gray-400">{formatDate(note.created_at)}</span>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => startEditNote(note)}
                                aria-label="Edit note"
                                className="text-gray-300 hover:text-primary-600"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteNote(note.id)}
                                aria-label="Delete note"
                                className="text-gray-300 hover:text-error-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'followups' && (
          <>
            {/* Next Step block */}
            {nextFollowUp ? (
              <div className={cn('rounded-md p-4', nextIsOverdue ? 'bg-warning-50' : 'bg-primary-50')}>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Next step</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{nextFollowUp.title}</p>
                <p className={cn('mt-1 text-xs', nextIsOverdue ? 'text-warning-700' : 'text-primary-700')}>
                  {nextIsOverdue ? 'Overdue — due ' : 'Due '}
                  {formatRelativeDate(nextFollowUp.due_date)}
                </p>
                <Button size="sm" className="mt-3" onClick={() => void toggleFollowUp(nextFollowUp)}>
                  <CheckCircle2 className="h-4 w-4" /> Complete
                </Button>
              </div>
            ) : (
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-sm text-gray-600">No open follow-up scheduled.</p>
              </div>
            )}

            {followUps.length > 0 && (
              <Card>
                <CardContent className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
                    <CalendarCheck className="h-4 w-4 text-gray-400" /> All follow-ups
                  </h3>
                  {followUps.map((fu) => {
                    const isOverdue = !fu.completed && fu.due_date < localDateString(new Date())
                    return (
                      <div key={fu.id} className="flex items-center gap-3 rounded-md border border-gray-200 p-3">
                        <button onClick={() => toggleFollowUp(fu)} className="flex-shrink-0" aria-label={fu.completed ? 'Mark as open' : 'Mark as completed'}>
                          {fu.completed ? (
                            <CheckCircle2 className="h-5 w-5 text-accent-600" />
                          ) : (
                            <Circle className="h-5 w-5 text-gray-300 hover:text-gray-400" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm font-medium', fu.completed ? 'text-gray-400 line-through' : 'text-gray-900')}>{fu.title}</p>
                          <p className={cn('text-xs', isOverdue ? 'text-error-600' : 'text-gray-500')}>
                            {formatRelativeDate(fu.due_date)}
                          </p>
                        </div>
                        <button onClick={() => deleteFollowUp(fu.id)} aria-label="Delete follow-up" className="text-gray-400 hover:text-error-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <form onSubmit={handleAddFollowUp} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-gray-400" />
                    <Label>Schedule a follow-up</Label>
                  </div>
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
                  <Button type="submit" size="sm" disabled={savingFollowUp} className="w-full">
                    <Plus className="h-4 w-4" /> {savingFollowUp ? 'Adding…' : 'Add follow-up'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        )}

        {tab === 'opportunities' && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setShowOppForm(!showOppForm)} className="w-full">
              {showOppForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Create opportunity</>}
            </Button>

            {showOppForm && (
              <Card>
                <CardContent>
                  <form onSubmit={handleAddOpportunity} className="space-y-3">
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
                    <div>
                      <Label>Description</Label>
                      <Textarea rows={2} value={oppForm.description} onChange={(e) => setOppForm({ ...oppForm, description: e.target.value })} placeholder="Describe this opportunity…" />
                    </div>
                    <Button type="submit" size="sm" disabled={savingOpp} className="w-full">
                      {savingOpp ? 'Creating…' : 'Create opportunity'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {opportunities.length > 0 ? (
              <div className="space-y-2">
                {opportunities.map((opp) => (
                  <Link
                    key={opp.id}
                    to={`/opportunities/${opp.id}`}
                    className="flex items-center gap-3 rounded-md border border-gray-200 bg-white p-3 transition-colors hover:border-primary-300 hover:bg-primary-50/30"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50">
                      <Target className="h-4 w-4 text-primary-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{opp.title}</p>
                      <p className="truncate text-xs text-gray-500">
                        {[opp.type, opp.value > 0 ? opp.value.toLocaleString() : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Badge variant={opp.stage === 'Won' ? 'success' : opp.stage === 'Lost' ? 'error' : 'primary'}>
                      {opp.stage}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : !showOppForm ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={<Target className="h-8 w-8" />}
                    title="No opportunities yet"
                    description="Track deals, investments, or partnerships from this connection."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => setShowOppForm(true)}>
                        <Plus className="h-4 w-4" /> Create opportunity
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
