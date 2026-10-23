import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { QrCode, Keyboard, ArrowRight, Check, Link2, AlertCircle, UserPlus } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { supabase, type Connection, type ConnectProfile, RELATIONSHIP_TYPES } from '@/lib/supabase'
import { normalizeUrl, extractProfileId, formatRelativeDate } from '@/lib/utils'
import { QRScanner } from '@/components/ui/QRScanner'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select, Textarea } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState, ErrorState } from '@/components/ui/States'

type Step = 'choose' | 'scan' | 'manual' | 'loading' | 'profile' | 'context' | 'success' | 'error'

export default function ScanQRPage() {
  const [recent, setRecent] = useState<Connection[] | null>(null)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [step, setStep] = useState<Step>('choose')
  const [targetProfile, setTargetProfile] = useState<ConnectProfile | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const [manualInput, setManualInput] = useState('')

  // Your five most recent connections, for the start screen. A failed read just
  // shows the empty message.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    void supabase
      .from('connections')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!cancelled) setRecent((data as Connection[]) || [])
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const [context, setContext] = useState({
    note: '',
    relationship_type: 'Other' as string,
    follow_up_date: '',
  })
  const [connecting, setConnecting] = useState(false)

  // The Connect sheet's "Scan someone" action deep-links straight into the
  // camera step (?open=scan) so the scanner opens immediately instead of
  // showing the intermediate choose screen.
  const openParam = searchParams.get('open')
  useEffect(() => {
    if (openParam === 'scan') {
      setSearchParams({}, { replace: true })
      setStep('scan')
    }
  }, [openParam, setSearchParams])

  // A scanned QR payload can be handed to this page via ?code=<profile id>,
  // letting the bottom-nav Connect button, drawer, and share links reuse the
  // validation and connection flow that lives here.
  const codeParam = searchParams.get('code')
  useEffect(() => {
    if (!codeParam || !user) return
    setSearchParams({}, { replace: true })
    loadProfile(codeParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam, user])

  async function loadProfile(profileId: string) {
    setStep('loading')
    setErrorMsg('')
    // Scanning someone's code is the deliberate contact exchange, so this RPC
    // returns their card including email/phone. It only ever resolves the one
    // id handed to it — the profiles table itself is not readable.
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

    // Self-scan check
    if (user && profile.id === user.id) {
      setErrorMsg("That's your own QR code! You can't connect with yourself.")
      setStep('error')
      return
    }

    // Duplicate check
    if (user) {
      const { data: existing } = await supabase
        .from('connections')
        .select('id')
        .eq('owner_id', user.id)
        .eq('connected_user_id', profile.id)
        .maybeSingle()

      if (existing) {
        setErrorMsg(`You're already connected with ${profile.full_name || 'this person'}.`)
        setStep('error')
        return
      }
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

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    const id = extractProfileId(manualInput)
    if (!id) {
      setErrorMsg('Enter a valid Rally profile link or profile ID.')
      setStep('error')
      return
    }
    loadProfile(id)
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    if (!user || !targetProfile) return
    setConnecting(true)
    setErrorMsg('')

    const { data: connData, error: connError } = await supabase
      .from('connections')
      .insert({
        owner_id: user.id,
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
        follow_up_date: context.follow_up_date || null,
      })
      .select()
      .single()

    if (connError) {
      setErrorMsg(connError.message)
      setConnecting(false)
      return
    }

    // The server derives recipient and wording from the connection row itself;
    // clients can no longer address notifications to other users directly.
    if (connData) {
      await supabase.rpc('notify_new_connection', { connection_id: connData.id })
    }

    if (context.note.trim() && connData) {
      await supabase.from('notes').insert({
        connection_id: connData.id,
        owner_id: user.id,
        content: context.note.trim(),
      })
    }

    setConnecting(false)
    setStep('success')
  }

  // --- Render ---

  if (step === 'scan') {
    return <QRScanner onScan={handleScan} onClose={() => setStep('choose')} />
  }

  if (step === 'loading') {
    return <LoadingState message="Loading profile…" />
  }

  if (step === 'error') {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-error-600" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy">Couldn't connect</h1>
        </div>
        <Card className="rounded-2xl shadow-card">
          <CardContent>
            <ErrorState message={errorMsg} />
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="secondary" onClick={() => setStep('choose')}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => navigate('/connections')}>
                Back to connections
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (step === 'success' && targetProfile) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center gap-3 py-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-50 text-accent-600">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy">Connection created!</h1>
          <p className="text-sm text-gray-500">
            You're now connected with {targetProfile.full_name || 'this contact'}.
          </p>
        </div>

        <Card className="rounded-2xl shadow-card">
          <CardContent>
            <div className="flex items-center gap-4 py-2">
              <Avatar name={targetProfile.full_name || '?'} src={targetProfile.photo_url} size="lg" />
              <div>
                <p className="font-semibold text-rally-navy">{targetProfile.full_name || 'Professional'}</p>
                <p className="text-sm text-gray-500">
                  {targetProfile.job_title}{targetProfile.company ? ` at ${targetProfile.company}` : ''}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={() => navigate('/connections')}>
            View all connections
          </Button>
          <Button variant="ghost" onClick={() => { setStep('choose'); setTargetProfile(null) }}>
            Scan another code
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'profile' && targetProfile) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy">Profile Preview</h1>
        <p className="mt-1 text-sm text-gray-500">Review this person's profile before connecting</p>

        <Card className="rounded-2xl shadow-card mt-6">
          <CardContent className="pt-6">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Avatar name={targetProfile.full_name || '?'} src={targetProfile.photo_url} size="xl" />
              <div>
                <h2 className="font-display text-xl font-bold text-rally-navy">{targetProfile.full_name || 'Professional'}</h2>
                {targetProfile.job_title && (
                  <p className="text-sm text-gray-600">{targetProfile.job_title}{targetProfile.company ? ` at ${targetProfile.company}` : ''}</p>
                )}
                {targetProfile.location && (
                  <p className="mt-0.5 text-sm text-gray-500">{targetProfile.location}</p>
                )}
                {targetProfile.industry && <Badge variant="primary" className="mt-2">{targetProfile.industry}</Badge>}
              </div>
            </div>
            {targetProfile.bio && (
              <p className="mt-4 text-sm leading-relaxed text-gray-700">{targetProfile.bio}</p>
            )}
          </CardContent>
        </Card>

        {(targetProfile.looking_for || targetProfile.can_offer) && (
          <Card className="rounded-2xl shadow-card mt-4">
            <CardContent className="space-y-3 pt-5">
              {targetProfile.looking_for && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Looking for</p>
                  <p className="mt-1 text-sm text-gray-700">{targetProfile.looking_for}</p>
                </div>
              )}
              {targetProfile.can_offer && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Can offer</p>
                  <p className="mt-1 text-sm text-gray-700">{targetProfile.can_offer}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => setStep('context')} size="lg" className="flex-1">
            <UserPlus className="h-4 w-4" /> Connect
          </Button>
          <Button variant="secondary" size="lg" onClick={() => { setStep('choose'); setTargetProfile(null) }}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'context' && targetProfile) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy">Add Context</h1>
        <p className="mt-1 text-sm text-gray-500">Optional details about your new connection with {targetProfile.full_name || 'this person'}</p>

        <form onSubmit={handleConnect} className="mt-6 space-y-4">
          <Card className="rounded-2xl shadow-card">
            <CardContent className="space-y-4 pt-5">
              <div>
                <Label htmlFor="relationship_type">Relationship type</Label>
                <Select
                  id="relationship_type"
                  value={context.relationship_type}
                  onChange={(e) => setContext({ ...context, relationship_type: e.target.value })}
                >
                  {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="follow_up_date">Follow-up date</Label>
                <Input
                  id="follow_up_date"
                  type="date"
                  value={context.follow_up_date}
                  onChange={(e) => setContext({ ...context, follow_up_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="note">Note</Label>
                <Textarea
                  id="note"
                  rows={3}
                  value={context.note}
                  onChange={(e) => setContext({ ...context, note: e.target.value })}
                  placeholder="How you met, what you discussed, anything to remember…"
                />
              </div>
            </CardContent>
          </Card>

          {errorMsg && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{errorMsg}</div>}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" disabled={connecting} size="lg" className="flex-1">
              {connecting ? 'Connecting…' : <>Confirm connection <ArrowRight className="h-4 w-4" /></>}
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={() => setStep('profile')}>
              Back
            </Button>
          </div>
        </form>
      </div>
    )
  }

  if (step === 'manual') {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy">Enter Profile Link</h1>
        <p className="mt-1 text-sm text-gray-500">Paste a Rally profile link or ID to connect</p>

        <form onSubmit={handleManualSubmit} className="mt-6">
          <Card className="rounded-2xl shadow-card">
            <CardContent className="space-y-4 pt-5">
              <div>
                <Label htmlFor="manual">Profile link or ID</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="manual"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="https://yourapp.com/p/… or profile ID"
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              {errorMsg && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{errorMsg}</div>}
              <Button type="submit" className="w-full">
                Find profile <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
          <Button variant="ghost" className="mt-4" onClick={() => setStep('choose')}>
            Back
          </Button>
        </form>
      </div>
    )
  }

  // Default: choose
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Scan QR" description="Connect with someone by scanning their Rally QR code, or enter their profile link." />

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <button
            onClick={() => setStep('scan')}
            className="flex w-full items-center gap-5 rounded-2xl bg-gradient-to-br from-primary-700 to-rally-ink p-6 text-left text-white shadow-card transition-shadow hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 md:p-8"
          >
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <QrCode className="h-8 w-8" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display text-xl font-bold">Scan with camera</span>
              <span className="mt-1 block text-sm text-white/80">Point your camera at a Rally QR code to connect instantly.</span>
            </span>
          </button>

          <button
            onClick={() => setStep('manual')}
            className="flex w-full items-center gap-4 rounded-2xl border border-rally-line bg-white p-5 text-left shadow-card transition-colors hover:border-primary-300 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rally-tint text-primary-600">
              <Keyboard className="h-6 w-6" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-rally-navy">Enter manually</span>
              <span className="mt-0.5 block text-sm text-rally-muted">Paste a profile link or ID if the code will not scan.</span>
            </span>
          </button>

          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-slate-600">How it works</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Scan another person&apos;s Rally QR code to view their profile, then add them to your connections with a note and a follow-up date.
              </p>
            </div>
          </div>
        </div>

        <aside className="lg:col-span-5">
          <section className="rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-rally-navy">Recently connected</h2>
              <Link to="/connections" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus-visible:underline">
                View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            {recent === null ? (
              <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />
            ) : recent.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500">
                People you connect with will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-rally-line">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link to={`/connections/${c.id}`} className="flex min-h-[56px] items-center gap-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                      <Avatar name={c.full_name || '?'} src={c.photo_url} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-rally-navy">{c.full_name}</p>
                        <p className="truncate text-xs text-slate-500">{[c.job_title, c.company].filter(Boolean).join(' · ') || c.relationship_type}</p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{formatRelativeDate(c.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
