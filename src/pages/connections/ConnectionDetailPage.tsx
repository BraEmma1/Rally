import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  MoreVertical,
  Linkedin,
  MapPin,
  MessageCircle,
  CalendarPlus,
  Share2,
  Check,
  Circle,
  Trash2,
  Pencil,
  Save,
  X,
  Plus,
  StickyNote,
  Target,
  CalendarClock,
  Link2,
  ChevronRight,
} from 'lucide-react'
import {
  supabase,
  type Connection,
  type Note,
  type FollowUp,
  type Opportunity,
  RELATIONSHIP_TYPES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_STAGES,
} from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate, normalizeUrl, cn } from '@/lib/utils'

type TabKey = 'overview' | 'notes' | 'meetings' | 'history'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'notes', label: 'Notes' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'history', label: 'History' },
]

type HistoryItem = {
  key: string
  type: 'Connected' | 'Note' | 'Follow-up' | 'Opportunity'
  title: string
  detail?: string
  when: string
  tone: 'primary' | 'accent' | 'gray' | 'warning'
}

function todayString(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function buildHistory(
  connection: Connection,
  notes: Note[],
  followUps: FollowUp[],
  opportunities: Opportunity[]
): HistoryItem[] {
  const items: HistoryItem[] = [
    {
      key: 'connected',
      type: 'Connected',
      title: connection.event_name ? `Met at ${connection.event_name}` : 'Connection created',
      when: connection.created_at,
      tone: 'primary',
    },
    ...notes.map((n) => ({
      key: `note-${n.id}`,
      type: 'Note' as const,
      title: n.content.length > 100 ? `${n.content.slice(0, 97)}…` : n.content,
      when: n.created_at,
      tone: 'gray' as const,
    })),
    ...followUps.map((f) => ({
      key: `followup-${f.id}`,
      type: 'Follow-up' as const,
      title: f.title,
      detail: f.completed ? 'Completed' : `Due ${formatRelativeDate(f.due_date)}`,
      when: f.completed_at ?? f.created_at,
      tone: f.completed ? ('accent' as const) : f.due_date < todayString() ? ('warning' as const) : ('gray' as const),
    })),
    ...opportunities.map((o) => ({
      key: `opportunity-${o.id}`,
      type: 'Opportunity' as const,
      title: o.title,
      detail: [o.stage, o.value > 0 ? o.value.toLocaleString() : null].filter(Boolean).join(' · '),
      when: o.updated_at,
      tone: 'accent' as const,
    })),
  ]
  return items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
}

const TIMELINE_ICONS = { Connected: Link2, Note: StickyNote, 'Follow-up': CalendarClock, Opportunity: Target } as const
const TIMELINE_DOTS = { primary: 'bg-primary-600', accent: 'bg-accent-600', gray: 'bg-gray-300', warning: 'bg-warning-500' } as const

export default function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])

  const [tab, setTab] = useState<TabKey>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [stepMenuOpen, setStepMenuOpen] = useState(false)
  const [showAllNotes, setShowAllNotes] = useState(false)

  // Existing functionality, kept: relationship edit, note CRUD, follow-up add/toggle/delete,
  // opportunity create — all surfaced from the reference's header/action rows.
  const [editingRelationship, setEditingRelationship] = useState(false)
  const [relationshipType, setRelationshipType] = useState('Other')
  const [savingRelationship, setSavingRelationship] = useState(false)

  const [noteFormOpen, setNoteFormOpen] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [savingEditNote, setSavingEditNote] = useState(false)

  const [followUpFormOpen, setFollowUpFormOpen] = useState(false)
  const [newFollowUp, setNewFollowUp] = useState({ title: '', due_date: '' })
  const [savingFollowUp, setSavingFollowUp] = useState(false)

  const [oppFormOpen, setOppFormOpen] = useState(false)
  const [savingOpp, setSavingOpp] = useState(false)
  const [oppForm, setOppForm] = useState({ title: '', type: 'Sales', value: '', stage: 'New', expected_close_date: '', description: '' })

  const [shareState, setShareState] = useState<'idle' | 'shared' | 'copied'>('idle')

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
        return
      }
      setConnection(connRes.data as Connection)
      setRelationshipType((connRes.data as Connection).relationship_type || 'Other')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  async function handleSaveRelationship(e: FormEvent) {
    e.preventDefault()
    if (!id || !user) return
    setSavingRelationship(true)
    const { error: updateError } = await supabase
      .from('connections')
      .update({ relationship_type: relationshipType, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', user.id)
    setSavingRelationship(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setConnection({ ...connection!, relationship_type: relationshipType })
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
    setSavingNote(false)
    if (noteError) {
      setError(noteError.message)
      return
    }
    setNotes([data as Note, ...notes])
    setNewNote('')
    setNoteFormOpen(false)
  }

  async function handleDeleteNote(noteId: string) {
    if (!user) return
    await supabase.from('notes').delete().eq('id', noteId).eq('owner_id', user.id)
    setNotes(notes.filter((n) => n.id !== noteId))
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
    setSavingEditNote(false)
    if (noteError) {
      setError(noteError.message)
      return
    }
    setNotes(notes.map((n) => (n.id === editingNoteId ? { ...n, content: editNoteContent.trim() } : n)))
    setEditingNoteId(null)
  }

  async function handleAddFollowUp(e: FormEvent) {
    e.preventDefault()
    if (!id || !user || !newFollowUp.title.trim() || !newFollowUp.due_date) return
    setSavingFollowUp(true)
    const { data, error: fuError } = await supabase
      .from('follow_ups')
      .insert({ connection_id: id, owner_id: user.id, title: newFollowUp.title.trim(), due_date: newFollowUp.due_date })
      .select()
      .single()
    setSavingFollowUp(false)
    if (fuError) {
      setError(fuError.message)
      return
    }
    setFollowUps([...followUps, data as FollowUp].sort((a, b) => a.due_date.localeCompare(b.due_date)))
    setNewFollowUp({ title: '', due_date: '' })
    setFollowUpFormOpen(false)
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
    setFollowUps(followUps.map((f) => (f.id === fu.id ? { ...f, completed, completed_at: completed ? new Date().toISOString() : null } : f)))
  }

  async function deleteFollowUp(fuId: string) {
    if (!user) return
    await supabase.from('follow_ups').delete().eq('id', fuId).eq('owner_id', user.id)
    setFollowUps(followUps.filter((f) => f.id !== fuId))
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
    setSavingOpp(false)
    if (oppError) {
      setError(oppError.message)
      return
    }
    setOpportunities([data as Opportunity, ...opportunities])
    setOppForm({ title: '', type: 'Sales', value: '', stage: 'New', expected_close_date: '', description: '' })
    setOppFormOpen(false)
  }

  async function handleDeleteConnection() {
    if (!id || !user) return
    if (!confirm('Delete this connection and all its notes and follow-ups?')) return
    await supabase.from('connections').delete().eq('id', id).eq('owner_id', user.id)
    navigate('/connections')
  }

  async function handleShareContact() {
    if (!connection) return
    const text = [
      connection.full_name,
      [connection.job_title, connection.company].filter(Boolean).join(' | '),
      connection.email,
      connection.phone,
      normalizeUrl(connection.linkedin),
    ]
      .filter(Boolean)
      .join('\n')
    try {
      if (navigator.share) {
        await navigator.share({ title: connection.full_name, text })
        setShareState('shared')
      } else {
        await navigator.clipboard.writeText(text)
        setShareState('copied')
      }
    } catch {
      /* user cancelled the share sheet */
    }
    setTimeout(() => setShareState('idle'), 2000)
  }

  if (loading) return <LoadingState message="Loading connection…" />
  if (error) return <ErrorState message={error} onRetry={loadData} />
  if (!connection) return <ErrorState message="Connection not found." />

  const linkedinUrl = normalizeUrl(connection.linkedin)
  const history = buildHistory(connection, notes, followUps, opportunities)
  const nextStep = followUps.filter((f) => !f.completed)[0]
  const nextOverdue = nextStep && nextStep.due_date < todayString()
  const visibleNotes = showAllNotes ? notes : notes.slice(0, 3)

  const actionButtons = [
    {
      label: shareState === 'shared' ? 'Shared' : shareState === 'copied' ? 'Copied' : 'Share Contact',
      icon: Share2,
      onClick: handleShareContact,
      disabled: false,
    },
  ]

  return (
    <div className="mx-auto max-w-md pb-10 md:max-w-2xl md:pb-0">
      {/* 1. Top header */}
      <div className="relative flex items-center justify-between border-b border-gray-100 py-2.5">
        <button onClick={() => navigate('/connections')} aria-label="Back to network" className="-ml-2 rounded-full p-2 text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="max-w-[55%] truncate text-base font-semibold text-gray-900 md:text-lg">{connection.full_name}</span>
        <div ref={menuRef} className="relative -mr-2">
          <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Connection options" className="rounded-full p-2 text-gray-500 hover:text-gray-700">
            <MoreVertical className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-lg">
              <button
                onClick={() => { setEditingRelationship(!editingRelationship); setMenuOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="h-4 w-4 text-gray-400" /> Edit relationship
              </button>
              <button
                onClick={() => { setOppFormOpen(!oppFormOpen); setTab('overview'); setMenuOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Target className="h-4 w-4 text-gray-400" /> Create opportunity
              </button>
              <button
                onClick={() => { setMenuOpen(false); void handleDeleteConnection() }}
                className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-sm text-error-600 hover:bg-error-50"
              >
                <Trash2 className="h-4 w-4" /> Remove connection
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'relative flex-1 px-2 py-2.5 text-sm font-medium transition-colors md:text-[15px]',
              tab === key ? 'text-primary-600' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {label}
            {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-600" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="pt-3">
          {/* 3. Compact profile row */}
          <div className="flex items-center gap-3">
            <Avatar name={connection.full_name} src={connection.photo_url} size="xl" className="h-20 w-20" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold text-gray-900 md:text-[22px]">{connection.full_name}</h1>
              {connection.job_title && <p className="truncate text-[15px] text-gray-600 md:text-base">{connection.job_title}</p>}
              {connection.company && <p className="truncate text-[15px] text-gray-600 md:text-base">{connection.company}</p>}
              {connection.location && (
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-gray-500 md:text-[15px]">
                  <MapPin className="h-4 w-4 flex-shrink-0 text-gray-400" /> {connection.location}
                </p>
              )}
            </div>
            {linkedinUrl && (
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${connection.full_name} on LinkedIn`}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700"
              >
                <Linkedin className="h-4 w-4" />
              </a>
            )}
          </div>

          {editingRelationship && (
            <form onSubmit={handleSaveRelationship} className="mt-3 space-y-2 rounded-md border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Relationship type</span>
                <button type="button" onClick={() => setEditingRelationship(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <select
                value={relationshipType}
                onChange={(e) => setRelationshipType(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-600 focus:outline-none"
              >
                {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <p className="text-xs text-gray-400 md:text-[13px]">Your private label for how you know this person.</p>
              <button
                type="submit"
                disabled={savingRelationship}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> {savingRelationship ? 'Saving…' : 'Save'}
              </button>
            </form>
          )}

          {oppFormOpen && (
            <form onSubmit={handleAddOpportunity} className="mt-3 space-y-2 rounded-md border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">New opportunity</span>
                <button type="button" onClick={() => setOppFormOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                required
                value={oppForm.title}
                onChange={(e) => setOppForm({ ...oppForm, title: e.target.value })}
                placeholder="Opportunity title"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={oppForm.type}
                  onChange={(e) => setOppForm({ ...oppForm, type: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
                >
                  {OPPORTUNITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={oppForm.stage}
                  onChange={(e) => setOppForm({ ...oppForm, stage: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
                >
                  {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <input
                type="number"
                min="0"
                step="1000"
                value={oppForm.value}
                onChange={(e) => setOppForm({ ...oppForm, value: e.target.value })}
                placeholder="Value ($)"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingOpp}
                className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {savingOpp ? 'Creating…' : 'Create opportunity'}
              </button>
            </form>
          )}

          {/* 4. Action row */}
          <div className="mt-3 grid grid-cols-4 gap-2">
            {connection.email ? (
              <a href={`mailto:${connection.email}`} className="flex flex-col items-center gap-1 rounded-md border border-gray-200 py-2 text-gray-700 transition-colors hover:border-primary-300 hover:bg-primary-50">
                <MessageCircle className="h-4 w-4 text-primary-600" />
                <span className="text-[13px] font-medium leading-tight md:text-sm">Message</span>
              </a>
            ) : (
              <div className="flex flex-col items-center gap-1 rounded-md border border-gray-200 py-2 text-gray-300" title="No email on file">
                <MessageCircle className="h-4 w-4" />
                <span className="text-[13px] font-medium leading-tight md:text-sm">Message</span>
              </div>
            )}
            <button
              onClick={() => setFollowUpFormOpen(!followUpFormOpen)}
              className="flex flex-col items-center gap-1 rounded-md border border-gray-200 py-2 text-gray-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
            >
              <CalendarPlus className="h-4 w-4 text-primary-600" />
              <span className="text-[13px] font-medium leading-tight md:text-sm">Schedule</span>
            </button>
            {actionButtons.map(({ label, icon: Icon, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="flex flex-col items-center gap-1 rounded-md border border-gray-200 py-2 text-gray-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
              >
                <Icon className="h-4 w-4 text-primary-600" />
                <span className="text-[13px] font-medium leading-tight md:text-sm">{label}</span>
              </button>
            ))}
            <button
              onClick={() => setMenuOpen(true)}
              className="flex flex-col items-center gap-1 rounded-md border border-gray-200 py-2 text-gray-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
            >
              <MoreVertical className="h-4 w-4 text-primary-600" />
              <span className="text-[13px] font-medium leading-tight md:text-sm">More</span>
            </button>
          </div>

          {followUpFormOpen && (
            <form onSubmit={handleAddFollowUp} className="mt-3 space-y-2 rounded-md border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Schedule follow-up</span>
                <button type="button" onClick={() => setFollowUpFormOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                required
                value={newFollowUp.title}
                onChange={(e) => setNewFollowUp({ ...newFollowUp, title: e.target.value })}
                placeholder="What's the next step?"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
              />
              <input
                type="date"
                required
                value={newFollowUp.due_date}
                onChange={(e) => setNewFollowUp({ ...newFollowUp, due_date: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingFollowUp}
                className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {savingFollowUp ? 'Adding…' : 'Add follow-up'}
              </button>
            </form>
          )}

          {/* 5. Your Notes */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900 md:text-[17px]">Your Notes</h2>
              <button
                onClick={() => setNoteFormOpen(!noteFormOpen)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 md:text-sm hover:text-primary-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add Note
              </button>
            </div>

            {noteFormOpen && (
              <form onSubmit={handleAddNote} className="mt-2 space-y-2 rounded-md border border-gray-200 p-3">
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Write a note…"
                  autoFocus
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={savingNote || !newNote.trim()}
                    className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {savingNote ? 'Saving…' : 'Save note'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteFormOpen(false)}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {notes.length === 0 && !noteFormOpen ? (
              <p className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400 md:text-[13px]">
                No notes yet. Use “Add Note” to record context from your conversations.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-gray-100">
                {visibleNotes.map((note) => (
                  <li key={note.id} className="py-2.5">
                    {editingNoteId === note.id ? (
                      <form onSubmit={handleSaveEditNote} className="space-y-2">
                        <textarea
                          rows={3}
                          value={editNoteContent}
                          onChange={(e) => setEditNoteContent(e.target.value)}
                          autoFocus
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button type="submit" disabled={savingEditNote || !editNoteContent.trim()} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary-600 px-3 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                            <Save className="h-3 w-3" /> {savingEditNote ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" onClick={() => setEditingNoteId(null)} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50">
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex gap-2.5">
                        <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent-600" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-400 md:text-[13px]">{formatDate(note.created_at)}</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 md:text-[15px]">{note.content}</p>
                        </div>
                        <div className="flex flex-shrink-0 items-start gap-2">
                          <button onClick={() => { setEditingNoteId(note.id); setEditNoteContent(note.content) }} aria-label="Edit note" className="text-gray-300 hover:text-primary-600">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDeleteNote(note.id)} aria-label="Delete note" className="text-gray-300 hover:text-error-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {notes.length > 3 && (
              <button
                onClick={() => setShowAllNotes(!showAllNotes)}
                className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary-600 md:text-sm hover:text-primary-700"
              >
                {showAllNotes ? 'Show fewer notes' : `Show all notes (${notes.length})`}
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showAllNotes && 'rotate-90')} />
              </button>
            )}
          </div>

          {/* 6. Next Step */}
          <div className="mt-4">
            <h2 className="text-base font-bold text-gray-900 md:text-[17px]">Next Step</h2>
            {nextStep ? (
              <div className={cn('relative mt-2 flex items-center gap-2.5 rounded-md border p-3', nextOverdue ? 'border-warning-300 bg-warning-50' : 'border-gray-200 bg-white')}>
                <button onClick={() => toggleFollowUp(nextStep)} aria-label="Mark as completed" className="flex-shrink-0">
                  <Circle className="h-5 w-5 text-primary-600 hover:text-primary-700" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 md:text-[15px]">{nextStep.title}</p>
                  <p className={cn('mt-0.5 text-xs md:text-[13px]', nextOverdue ? 'text-warning-700' : 'text-gray-500')}>
                    {formatDate(nextStep.due_date)}
                  </p>
                </div>
                <button onClick={() => setStepMenuOpen(!stepMenuOpen)} aria-label="Step options" className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600">
                  <MoreVertical className="h-4 w-4" />
                </button>
                {stepMenuOpen && (
                  <div className="absolute right-2 top-10 z-10 w-40 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                    <button
                      onClick={() => { setFollowUpFormOpen(true); setStepMenuOpen(false) }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Plus className="h-3.5 w-3.5 text-gray-400" /> Add another step
                    </button>
                    <button
                      onClick={() => { deleteFollowUp(nextStep.id); setStepMenuOpen(false) }}
                      className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-sm text-error-600 hover:bg-error-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete step
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between rounded-md border border-dashed border-gray-200 px-3 py-3">
                <p className="text-xs text-gray-500 md:text-[13px]">No next step scheduled.</p>
                <button
                  onClick={() => setFollowUpFormOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 md:text-sm hover:text-primary-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Schedule
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <div className="pt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 md:text-[17px]">All Notes</h2>
            <button onClick={() => setNoteFormOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 md:text-sm hover:text-primary-700">
              <Plus className="h-3.5 w-3.5" /> Add Note
            </button>
          </div>
          {noteFormOpen && (
            <form onSubmit={handleAddNote} className="mt-2 space-y-2 rounded-md border border-gray-200 p-3">
              <textarea
                rows={3}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Write a note…"
                autoFocus
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={savingNote || !newNote.trim()} className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                  {savingNote ? 'Saving…' : 'Save note'}
                </button>
                <button type="button" onClick={() => setNoteFormOpen(false)} className="inline-flex h-8 items-center justify-center rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
          {notes.length === 0 ? (
            <EmptyState
              icon={<StickyNote className="h-8 w-8" />}
              title="No notes yet"
              description="Record context about this person and your conversations."
            />
          ) : (
            <ul className="mt-1 divide-y divide-gray-100">
              {notes.map((note) => (
                <li key={note.id} className="py-2.5">
                  {editingNoteId === note.id ? (
                    <form onSubmit={handleSaveEditNote} className="space-y-2">
                      <textarea
                        rows={3}
                        value={editNoteContent}
                        onChange={(e) => setEditNoteContent(e.target.value)}
                        autoFocus
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button type="submit" disabled={savingEditNote || !editNoteContent.trim()} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary-600 px-3 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                          <Save className="h-3 w-3" /> {savingEditNote ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" onClick={() => setEditingNoteId(null)} className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex gap-2.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-400 md:text-[13px]">{formatDate(note.created_at)}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 md:text-[15px]">{note.content}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-start gap-2">
                        <button onClick={() => { setEditingNoteId(note.id); setEditNoteContent(note.content) }} aria-label="Edit note" className="text-gray-300 hover:text-primary-600">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDeleteNote(note.id)} aria-label="Delete note" className="text-gray-300 hover:text-error-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'meetings' && (
        <div className="pt-3">
          <EmptyState
            icon={<CalendarClock className="h-8 w-8" />}
            title="No meetings tracked"
            description="Meetings you schedule with this connection will appear here."
            action={
              <button
                onClick={() => setFollowUpFormOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Plus className="h-4 w-4" /> Schedule follow-up
              </button>
            }
          />
          {followUpFormOpen && (
            <form onSubmit={handleAddFollowUp} className="mt-2 space-y-2 rounded-md border border-gray-200 p-3">
              <input
                required
                value={newFollowUp.title}
                onChange={(e) => setNewFollowUp({ ...newFollowUp, title: e.target.value })}
                placeholder="What's the next step?"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-600 focus:outline-none"
              />
              <input
                type="date"
                required
                value={newFollowUp.due_date}
                onChange={(e) => setNewFollowUp({ ...newFollowUp, due_date: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-600 focus:outline-none"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={savingFollowUp} className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-primary-600 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                  {savingFollowUp ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={() => setFollowUpFormOpen(false)} className="inline-flex h-8 items-center justify-center rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
          {followUps.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100">
              {followUps.map((fu) => (
                <li key={fu.id} className="flex items-center gap-2.5 py-2.5">
                  <button onClick={() => toggleFollowUp(fu)} aria-label={fu.completed ? 'Mark as open' : 'Mark as completed'} className="flex-shrink-0">
                    {fu.completed ? <Check className="h-4 w-4 text-accent-600" /> : <Circle className="h-4 w-4 text-gray-300 hover:text-gray-400" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium md:text-[15px]', fu.completed ? 'text-gray-400 line-through' : 'text-gray-900')}>{fu.title}</p>
                    <p className="text-xs text-gray-500 md:text-[13px]">{formatDate(fu.due_date)}</p>
                  </div>
                  <button onClick={() => deleteFollowUp(fu.id)} aria-label="Delete" className="flex-shrink-0 text-gray-300 hover:text-error-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="pt-3">
          <h2 className="text-base font-bold text-gray-900 md:text-[17px]">History</h2>
          {history.length === 0 ? (
            <EmptyState title="No history yet" description="Notes, follow-ups and opportunities will appear here." />
          ) : (
            <ol className="relative mt-3 space-y-4 border-l border-gray-200 pl-5">
              {history.map((item) => {
                const Icon = TIMELINE_ICONS[item.type]
                return (
                  <li key={item.key} className="relative">
                    <span className={cn('absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white', TIMELINE_DOTS[item.tone])}>
                      <Icon className="h-2.5 w-2.5 text-white" />
                    </span>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 md:text-xs">{item.type}</p>
                    <p className="mt-0.5 text-sm font-medium text-gray-900 md:text-[15px]">{item.title}</p>
                    {item.detail && <p className="mt-0.5 text-xs text-gray-500 md:text-[13px]">{item.detail}</p>}
                    <p className="mt-0.5 text-xs text-gray-400 md:text-[13px]">{formatDate(item.when)}</p>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
