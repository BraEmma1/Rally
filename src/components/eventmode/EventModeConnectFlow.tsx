import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, UserPlus, AlertCircle, ArrowRight, MessageSquare, CalendarClock, User as UserIcon, StickyNote, ScanLine } from 'lucide-react'
import { supabase, type EventRow, type ConnectProfile, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { normalizeUrl, extractProfileId } from '@/lib/utils'
import { QRScanner } from '@/components/ui/QRScanner'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'

// Event Mode's connect flow. Reuses the existing building blocks — QRScanner,
// the get_connect_profile lookup with its self/duplicate checks, the notes
// table and the server-side notification RPC — but inserts the connection with
// the event context (event_id/event_name) so "Met at <event>" persists.
type Step = 'scan' | 'loading' | 'profile' | 'context' | 'success' | 'error'

export default function EventModeConnectFlow({
  event,
  open,
  onClose,
  initialProfileId,
  userId,
}: {
  event: EventRow
  open: boolean
  onClose: () => void
  initialProfileId?: string | null
  userId: string
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('scan')
  const [targetProfile, setTargetProfile] = useState<ConnectProfile | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [quickNote, setQuickNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleSaved, setScheduleSaved] = useState(false)
  const [context, setContext] = useState({
    note: '',
    relationship_type: 'Other' as string,
    follow_up_date: '',
  })

  // Opened straight onto a person (e.g. from the event directory): skip the
  // camera and go to the same lookup the scanner feeds.
  useEffect(() => {
    if (open && initialProfileId) {
      loadProfile(initialProfileId)
    }
    if (!open) {
      setStep('scan')
      setTargetProfile(null)
      setConnectionId(null)
      setErrorMsg('')
      setQuickNote('')
      setNoteSaved(false)
      setScheduleDate('')
      setScheduleSaved(false)
      setContext({ note: '', relationship_type: 'Other', follow_up_date: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProfileId])

  async function loadProfile(profileId: string) {
    setStep('loading')
    setErrorMsg('')
    const { data, error } = await supabase
      .rpc('get_connect_profile', { profile_id: profileId })
      .maybeSingle()

    if (error) {
      setErrorMsg(error.message)
      setStep('error')
      return
    }
    if (!data) {
      setErrorMsg('No profile found for this QR code. The link may be invalid.')
      setStep('error')
      return
    }

    const profile = data as ConnectProfile

    if (profile.id === userId) {
      setErrorMsg("That's your own QR code! You can't connect with yourself.")
      setStep('error')
      return
    }

    const { data: existing } = await supabase
      .from('connections')
      .select('id')
      .eq('owner_id', userId)
      .eq('connected_user_id', profile.id)
      .maybeSingle()

    if (existing) {
      setErrorMsg(`You're already connected with ${profile.full_name || 'this person'}.`)
      setStep('error')
      return
    }

    setTargetProfile(profile)
    setStep('profile')
  }

  function handleScan(data: string) {
    const id = extractProfileId(data)
    if (!id) {
      setErrorMsg('This QR code is not a valid Rally profile code.')
      setStep('error')
      return
    }
    loadProfile(id)
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    if (!targetProfile) return
    setConnecting(true)
    setErrorMsg('')

    const { data: connData, error: connError } = await supabase
      .from('connections')
      .insert({
        owner_id: userId,
        connected_user_id: targetProfile.id,
        full_name: targetProfile.full_name || '',
        job_title: targetProfile.job_title || '',
        company: targetProfile.company || '',
        industry: targetProfile.industry || '',
        location: targetProfile.location || '',
        email: targetProfile.email || '',
        phone: targetProfile.phone || '',
        linkedin: normalizeUrl(targetProfile.linkedin) || '',
        website: normalizeUrl(targetProfile.website) || '',
        photo_url: targetProfile.photo_url || '',
        relationship_type: context.relationship_type,
        event_name: event.name,
        event_id: event.id,
        follow_up_date: context.follow_up_date || null,
      })
      .select()
      .single()

    if (connError) {
      setErrorMsg(connError.message)
      setConnecting(false)
      return
    }

    if (context.note.trim() && connData) {
      await supabase.from('notes').insert({
        connection_id: connData.id,
        owner_id: userId,
        content: context.note.trim(),
      })
    }

    if (connData) {
      await supabase.rpc('notify_new_connection', { connection_id: connData.id })
    }

    setConnectionId(connData?.id ?? null)
    setConnecting(false)
    setStep('success')
  }

  async function saveQuickNote() {
    if (!connectionId || !quickNote.trim() || noteSaved) return
    const { error } = await supabase.from('notes').insert({
      connection_id: connectionId,
      owner_id: userId,
      content: quickNote.trim(),
    })
    if (!error) setNoteSaved(true)
  }

  async function saveSchedule() {
    if (!connectionId || !scheduleDate || scheduleSaved) return
    const { error } = await supabase
      .from('connections')
      .update({ follow_up_date: scheduleDate })
      .eq('id', connectionId)
      .eq('owner_id', userId)
    if (!error) setScheduleSaved(true)
  }

  async function openConversation() {
    if (!targetProfile) return
    const { data } = await supabase.rpc('create_direct_conversation', {
      other_user_id: targetProfile.id,
      event_id: event.id,
    })
    onClose()
    if (data) navigate(`/messages/${data}`)
    else navigate('/messages')
  }

  if (!open) return null

  if (step === 'scan') {
    return <QRScanner onScan={handleScan} onClose={onClose} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 md:p-8" role="dialog" aria-modal="true">
      <div className="fixed inset-0 overflow-y-auto bg-white md:relative md:h-auto md:max-h-[90vh] md:w-[28rem] md:rounded-xl md:shadow-xl">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          {step === 'loading' && <p className="text-center text-sm text-gray-500">Loading profile…</p>}

          {step === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error-50 text-error-600">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Couldn't connect</h2>
              <p className="text-sm text-gray-500">{errorMsg}</p>
              <div className="mt-2 flex flex-col gap-2">
                <Button variant="secondary" onClick={() => setStep('scan')}>Scan again</Button>
                <Button variant="ghost" onClick={onClose}>Close</Button>
              </div>
            </div>
          )}

          {step === 'profile' && targetProfile && (
            <div>
              <h2 className="text-lg font-bold text-gray-900">Connect at {event.name}</h2>
              <div className="mt-4 flex items-center gap-4 rounded-lg bg-gray-50 p-3">
                <Avatar name={targetProfile.full_name || '?'} src={targetProfile.photo_url} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{targetProfile.full_name || 'Professional'}</p>
                  <p className="truncate text-sm text-gray-500">
                    {targetProfile.job_title}{targetProfile.company ? ` at ${targetProfile.company}` : ''}
                  </p>
                  {targetProfile.industry && <Badge variant="primary" className="mt-1">{targetProfile.industry}</Badge>}
                </div>
              </div>
              {targetProfile.bio && <p className="mt-3 text-sm leading-relaxed text-gray-700">{targetProfile.bio}</p>}
              <div className="mt-5 flex gap-2">
                <Button onClick={() => setStep('context')} className="flex-1">
                  <UserPlus className="h-4 w-4" /> Connect
                </Button>
                <Button variant="secondary" onClick={() => setStep('scan')}>Back</Button>
              </div>
            </div>
          )}

          {step === 'context' && targetProfile && (
            <form onSubmit={handleConnect}>
              <h2 className="text-lg font-bold text-gray-900">Add context</h2>
              <p className="mt-1 text-sm text-gray-500">Saved as "Met at {event.name}"</p>
              <div className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="em-rel">Relationship type</Label>
                  <Select id="em-rel" value={context.relationship_type} onChange={(e) => setContext({ ...context, relationship_type: e.target.value })}>
                    {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="em-fud">Follow-up date</Label>
                  <Input id="em-fud" type="date" value={context.follow_up_date} onChange={(e) => setContext({ ...context, follow_up_date: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="em-note">Note</Label>
                  <Textarea id="em-note" rows={2} value={context.note} onChange={(e) => setContext({ ...context, note: e.target.value })} placeholder="What did you discuss?" />
                </div>
              </div>
              {errorMsg && <div className="mt-3 rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{errorMsg}</div>}
              <div className="mt-4 flex gap-2">
                <Button type="submit" disabled={connecting} className="flex-1">
                  {connecting ? 'Connecting…' : <>Confirm <ArrowRight className="h-4 w-4" /></>}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setStep('profile')}>Back</Button>
              </div>
            </form>
          )}

          {step === 'success' && targetProfile && (
            <div className="text-center">
              <div className="flex flex-col items-center gap-3 pt-2">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-50 text-accent-600">
                  <Check className="h-7 w-7" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Connected</h2>
                <Avatar name={targetProfile.full_name || '?'} src={targetProfile.photo_url} size="lg" />
                <div>
                  <p className="font-semibold text-gray-900">{targetProfile.full_name || 'Professional'}</p>
                  <p className="text-sm text-gray-500">
                    {targetProfile.job_title}{targetProfile.company ? ` at ${targetProfile.company}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">Met at {event.name}</p>
                </div>
              </div>

              <div className="mt-5 space-y-2 text-left">
                <Button className="w-full" onClick={openConversation}>
                  <MessageSquare className="h-4 w-4" /> Message
                </Button>

                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <CalendarClock className="h-4 w-4 text-gray-400" /> Schedule follow-up
                  </p>
                  {scheduleSaved ? (
                    <p className="mt-2 text-sm text-accent-600">Follow-up scheduled.</p>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} aria-label="Follow-up date" />
                      <Button size="sm" variant="secondary" onClick={saveSchedule} disabled={!scheduleDate}>Save</Button>
                    </div>
                  )}
                </div>

                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    onClose()
                    if (connectionId) navigate(`/connections/${connectionId}`)
                  }}
                >
                  <UserIcon className="h-4 w-4" /> View profile
                </Button>

                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <StickyNote className="h-4 w-4 text-gray-400" /> Add quick note
                  </p>
                  {noteSaved ? (
                    <p className="mt-2 text-sm text-accent-600">Note saved.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <Textarea rows={2} value={quickNote} onChange={(e) => setQuickNote(e.target.value)} placeholder="Something to remember…" aria-label="Quick note" />
                      <Button size="sm" variant="secondary" onClick={saveQuickNote} disabled={!quickNote.trim()}>Save note</Button>
                    </div>
                  )}
                </div>
              </div>

              <Button variant="ghost" className="mt-4 w-full" onClick={() => { setStep('scan'); setTargetProfile(null) }}>
                <ScanLine className="h-4 w-4" /> Scan another person
              </Button>
              <Button variant="ghost" className="mt-1 w-full" onClick={onClose}>Done</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
