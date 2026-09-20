import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Users, X, QrCode, CalendarClock } from 'lucide-react'
import { supabase, type Connection, type FollowUp, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { formatDate, formatRelativeDate, normalizeUrl } from '@/lib/utils'


export default function ConnectionsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [followUpMap, setFollowUpMap] = useState<Record<string, FollowUp[]>>({})
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [newConn, setNewConn] = useState({
    full_name: '',
    job_title: '',
    company: '',
    industry: '',
    email: '',
    phone: '',
    linkedin: '',
    relationship_type: 'Other',
    event_name: '',
    follow_up_date: '',
    notes: '',
  })

  async function loadConnections() {
    if (!user) return
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await supabase
      .from('connections')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
    if (queryError) {
      setError(queryError.message)
    } else {
      setConnections(data as Connection[])
      // Load pending follow-ups for all connections
      const { data: followData } = await supabase
        .from('follow_ups')
        .select('*')
        .eq('owner_id', user.id)
        .eq('completed', false)
        .order('due_date', { ascending: true })
      if (followData) {
        const map: Record<string, FollowUp[]> = {}
        for (const fu of followData as FollowUp[]) {
          if (!map[fu.connection_id]) map[fu.connection_id] = []
          map[fu.connection_id].push(fu)
        }
        setFollowUpMap(map)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    loadConnections()
  }, [user])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setFormError(null)

    const linkedinUrl = newConn.linkedin.trim() ? normalizeUrl(newConn.linkedin) : ''
    if (linkedinUrl === null) {
      setFormError('LinkedIn must be a valid http(s) link.')
      return
    }

    setSaving(true)

    const { data: connData, error: connError } = await supabase
      .from('connections')
      .insert({
        owner_id: user.id,
        full_name: newConn.full_name,
        job_title: newConn.job_title || null,
        company: newConn.company || null,
        industry: newConn.industry || null,
        email: newConn.email || null,
        phone: newConn.phone || null,
        linkedin: linkedinUrl,
        relationship_type: newConn.relationship_type,
        event_name: newConn.event_name || null,
        follow_up_date: newConn.follow_up_date || null,
      })
      .select()
      .single()

    if (connError) {
      setFormError(connError.message)
      setSaving(false)
      return
    }

    if (newConn.notes && connData) {
      await supabase.from('notes').insert({
        connection_id: connData.id,
        owner_id: user.id,
        content: newConn.notes,
      })
    }

    setNewConn({
      full_name: '', job_title: '', company: '', industry: '',
      email: '', phone: '', linkedin: '', relationship_type: 'Other',
      event_name: '', follow_up_date: '', notes: '',
    })
    setShowAddForm(false)
    setSaving(false)
    loadConnections()
  }

  const filtered = connections.filter((c) => {
    const matchesSearch =
      !search ||
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (c.company || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.job_title || '').toLowerCase().includes(search.toLowerCase())
    const matchesType = filterType === 'all' || c.relationship_type === filterType
    return matchesSearch && matchesType
  })

  if (loading) return <LoadingState message="Loading connections…" />
  if (error) return <ErrorState message={error} onRetry={loadConnections} />

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Connections</h1>
          <p className="mt-1 text-sm text-gray-500">{connections.length} {connections.length === 1 ? 'person' : 'people'} in your network</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Add connection</>}
        </Button>
        <Link to="/scan">
          <Button variant="outline">
            <QrCode className="h-4 w-4" /> Scan QR
          </Button>
        </Link>
      </div>

      {showAddForm && (
        <Card className="mt-4">
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="full_name">Full name *</Label>
                  <Input id="full_name" required value={newConn.full_name} onChange={(e) => setNewConn({ ...newConn, full_name: e.target.value })} placeholder="John Doe" />
                </div>
                <div>
                  <Label htmlFor="job_title">Job title</Label>
                  <Input id="job_title" value={newConn.job_title} onChange={(e) => setNewConn({ ...newConn, job_title: e.target.value })} placeholder="VP of Sales" />
                </div>
                <div>
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" value={newConn.company} onChange={(e) => setNewConn({ ...newConn, company: e.target.value })} placeholder="Acme Inc." />
                </div>
                <div>
                  <Label htmlFor="industry">Industry</Label>
                  <Input id="industry" value={newConn.industry} onChange={(e) => setNewConn({ ...newConn, industry: e.target.value })} placeholder="FinTech" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={newConn.email} onChange={(e) => setNewConn({ ...newConn, email: e.target.value })} placeholder="john@acme.com" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone / WhatsApp</Label>
                  <Input id="phone" value={newConn.phone} onChange={(e) => setNewConn({ ...newConn, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div>
                  <Label htmlFor="linkedin">LinkedIn URL</Label>
                  <Input id="linkedin" value={newConn.linkedin} onChange={(e) => setNewConn({ ...newConn, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
                </div>
                <div>
                  <Label htmlFor="relationship_type">Relationship type</Label>
                  <Select id="relationship_type" value={newConn.relationship_type} onChange={(e) => setNewConn({ ...newConn, relationship_type: e.target.value })}>
                    {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="event_name">Met at event</Label>
                  <Input id="event_name" value={newConn.event_name} onChange={(e) => setNewConn({ ...newConn, event_name: e.target.value })} placeholder="TechConf 2026" />
                </div>
                <div>
                  <Label htmlFor="follow_up_date">Follow-up date</Label>
                  <Input id="follow_up_date" type="date" value={newConn.follow_up_date} onChange={(e) => setNewConn({ ...newConn, follow_up_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">Initial notes</Label>
                <Textarea id="notes" rows={2} value={newConn.notes} onChange={(e) => setNewConn({ ...newConn, notes: e.target.value })} placeholder="Context about how you met, topics discussed…" />
              </div>
              {formError && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{formError}</div>}
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search + filter */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search by name, company, or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="sm:w-44">
          <option value="all">All types</option>
          {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      {/* Connections list */}
      <div className="mt-4">
        {filtered.length === 0 ? (
          connections.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Users className="h-10 w-10" />}
                  title="No connections yet"
                  description="Add people you meet at events to keep track of your network."
                  action={<Button size="sm" onClick={() => setShowAddForm(true)}><Plus className="h-4 w-4" /> Add connection</Button>}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Search className="h-10 w-10" />}
                  title="No matching connections"
                  description="Try a different search term or filter."
                />
              </CardContent>
            </Card>
          )
        ) : (
          <div>
            {filtered.map((conn) => {
              const upcomingFollowUps = followUpMap[conn.id] || []
              const nextFollowUp = upcomingFollowUps[0]
              const isOverdue = nextFollowUp && new Date(nextFollowUp.due_date) < new Date(new Date().toDateString())
              return (
                <Link key={conn.id} to={`/connections/${conn.id}`}>
                  <Card className="mb-3 transition-colors hover:border-primary-300 hover:bg-primary-50/30">
                    <CardContent className="flex items-center gap-3 py-3">
                      <Avatar name={conn.full_name} src={conn.photo_url} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{conn.full_name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {conn.job_title}{conn.company ? ` at ${conn.company}` : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">Connected {formatDate(conn.created_at)}</p>
                      </div>
                      <div className="hidden flex-col items-end gap-1 sm:flex">
                        <Badge variant="primary">{conn.relationship_type}</Badge>
                        {nextFollowUp && (
                          <span className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-error-600' : 'text-gray-500'}`}>
                            <CalendarClock className="h-3 w-3" />
                            {isOverdue ? 'Overdue' : formatRelativeDate(nextFollowUp.due_date)}
                          </span>
                        )}
                        {conn.event_name && <span className="text-xs text-gray-400">{conn.event_name}</span>}
                      </div>
                      <Badge variant="gray" className="sm:hidden">{conn.relationship_type}</Badge>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
