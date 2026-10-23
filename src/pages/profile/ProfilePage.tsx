import { useState, useEffect, type FormEvent } from 'react'
import { QrCode, Share2, Pencil, Save, X, Globe, Linkedin, Mail, Phone, MapPin, Download, Maximize2, Link2 } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth } from '@/context/AuthContext'
import { supabase, type Profile } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Label, Select } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { PageHeader } from '@/components/ui/PageHeader'
import { ComingSoonButton } from '@/components/events/ComingSoon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { PhotoUpload } from '@/components/ui/PhotoUpload'
import { INDUSTRIES, getCompletionPercentage, getCompletionCount, isFieldFilled, ALL_PROFILE_FIELDS, FIELD_LABELS } from '@/lib/profile'
import { normalizeUrl, displayUrl } from '@/lib/utils'

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [shareCopied, setShareCopied] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)

  const [form, setForm] = useState<Partial<Profile>>({})

  useEffect(() => {
    if (profile) setForm(profile)
  }, [profile])

  const shareUrl = profile ? `${window.location.origin}/p/${profile.id}` : ''

  useEffect(() => {
    if (shareUrl) {
      QRCode.toDataURL(shareUrl, { width: 256, margin: 2, color: { dark: '#0A66C2', light: '#ffffff' } })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''))
    }
  }, [shareUrl])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)

    const linkedinUrl = form.linkedin?.trim() ? normalizeUrl(form.linkedin) : ''
    if (linkedinUrl === null) {
      setError('LinkedIn must be a valid http(s) link.')
      return
    }
    const websiteUrl = form.website?.trim() ? normalizeUrl(form.website) : ''
    if (websiteUrl === null) {
      setError('Website must be a valid http(s) link.')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name || '',
        photo_url: form.photo_url || '',
        job_title: form.job_title || '',
        company: form.company || '',
        industry: form.industry || '',
        location: form.location || '',
        bio: form.bio || '',
        looking_for: form.looking_for || '',
        can_offer: form.can_offer || '',
        linkedin: linkedinUrl,
        website: websiteUrl,
        email: form.email || '',
        phone: form.phone || '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    await refreshProfile()
    setSaving(false)
    setEditing(false)
  }

  async function handleShare() {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl)
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      } catch {
        // fallback: select text
      }
    }
  }

  function handleDownloadQR() {
    if (!qrDataUrl) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `rally-qr-${profile?.id || 'profile'}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (!profile && !user) return <LoadingState />
  if (!profile) return <ErrorState message="Could not load your profile." />

  const completion = getCompletionPercentage(profile)
  const { filled, total } = getCompletionCount(profile)

  const displayName = profile.full_name || 'Your Name'
  const displayTitle = profile.job_title || 'Add your job title'
  const displayCompany = profile.company || 'Add your company'

  if (editing) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy">Edit Profile</h1>
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setForm(profile) }}>
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <PhotoUpload
                userId={user!.id}
                fullName={form.full_name || ''}
                currentPhotoUrl={form.photo_url || null}
                onUploaded={(url) => setForm({ ...form, photo_url: url })}
                size="lg"
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="full_name">Full name</Label>
                  <Input id="full_name" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Jane Smith" />
                </div>
                <div>
                  <Label htmlFor="job_title">Job title</Label>
                  <Input id="job_title" value={form.job_title || ''} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Product Manager" />
                </div>
                <div>
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc." />
                </div>
                <div>
                  <Label htmlFor="industry">Industry</Label>
                  <Select id="industry" value={form.industry || ''} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                    <option value="">Select an industry</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="San Francisco, CA" />
                </div>
              </div>
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea id="bio" rows={3} value={form.bio || ''} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="A short professional summary…" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Networking</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="looking_for">What I'm looking for</Label>
                <Textarea id="looking_for" rows={2} value={form.looking_for || ''} onChange={(e) => setForm({ ...form, looking_for: e.target.value })} placeholder="Investors, co-founders, design partners…" />
              </div>
              <div>
                <Label htmlFor="can_offer">What I can offer</Label>
                <Textarea id="can_offer" rows={2} value={form.can_offer || ''} onChange={(e) => setForm({ ...form, can_offer: e.target.value })} placeholder="Product strategy, intros to VCs, B2B SaaS expertise…" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Contact & Links</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone / WhatsApp</Label>
                  <Input id="phone" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
                <div>
                  <Label htmlFor="linkedin">LinkedIn URL</Label>
                  <Input id="linkedin" value={form.linkedin || ''} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input id="website" value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
                </div>
              </div>
            </CardContent>
          </Card>

          {error && <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setEditing(false); setForm(profile) }}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  const linkedinUrl = normalizeUrl(profile.linkedin)
  const websiteUrl = normalizeUrl(profile.website)
  const hasContact = profile.email || profile.phone || linkedinUrl || websiteUrl
  const hasNetworking = profile.looking_for || profile.can_offer

  const section = 'rounded-2xl border border-rally-line bg-white p-5 shadow-card md:p-6'
  const contactTile =
    'flex min-h-[64px] items-center gap-3 rounded-xl border border-rally-line bg-rally-canvas p-3 text-left transition-colors hover:border-primary-300 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600'
  const tileIcon = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-primary-600 shadow-card'

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="My Profile"
        description="Your professional card and QR code. This is what people see when they scan or open your link."
        actions={
          <>
            <ComingSoonButton size="lg" variant="secondary" className="hidden md:inline-flex">
              Export contact (.vcf)
            </ComingSoonButton>
            <Button size="lg" variant="secondary" className="rounded-xl" onClick={handleShare}>
              <Link2 className="h-4 w-4" aria-hidden="true" /> {shareCopied ? 'Link copied' : 'Copy link'}
            </Button>
            <Button size="lg" className="rounded-xl" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit profile
            </Button>
          </>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {/* The digital card: who you are on the left, your QR on the right */}
          <section className="overflow-hidden rounded-2xl border border-rally-line bg-white shadow-card">
            <div className="h-2 bg-gradient-to-r from-primary-700 to-primary-500" aria-hidden="true" />
            <div className="grid gap-6 p-5 md:p-7 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex min-w-0 items-start gap-4">
                <Avatar name={displayName} src={profile.photo_url} size="xl" className="h-20 w-20 shrink-0 text-xl md:h-24 md:w-24" />
                <div className="min-w-0">
                  {profile.industry && <p className="text-xs font-semibold uppercase tracking-wider text-primary-700">{profile.industry}</p>}
                  <h2 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-rally-navy md:text-3xl">{displayName}</h2>
                  <p className="mt-1 text-base text-rally-muted">
                    {displayTitle}
                    {displayCompany !== 'Add your company' ? ` · ${displayCompany}` : ''}
                  </p>
                  {profile.location && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500">
                      <MapPin className="h-4 w-4 text-primary-600" aria-hidden="true" /> {profile.location}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 sm:items-end">
                {qrDataUrl ? (
                  <button
                    type="button"
                    onClick={() => setShowQRModal(true)}
                    aria-label="Enlarge your QR code"
                    className="rounded-2xl border border-rally-line bg-white p-2 shadow-card transition-shadow hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    <img src={qrDataUrl} alt="Your Rally QR code" className="h-40 w-40 md:h-44 md:w-44" />
                  </button>
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-slate-300">
                    <QrCode className="h-10 w-10" aria-hidden="true" />
                  </div>
                )}
                <p className="text-xs text-slate-500">Scan to view your public profile</p>
              </div>
            </div>
            {profile.bio && <p className="border-t border-rally-line px-5 py-4 text-sm leading-relaxed text-slate-700 md:px-7 md:text-base">{profile.bio}</p>}
          </section>

          {/* Contact: shown to you here; others only see your public card */}
          {hasContact ? (
            <section className={section}>
              <h2 className="mb-4 font-display text-lg font-semibold text-rally-navy">Contact &amp; links</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {profile.email && (
                  <a href={`mailto:${profile.email}`} className={contactTile}>
                    <span className={tileIcon}><Mail className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</span><span className="block truncate text-sm font-semibold text-rally-navy">{profile.email}</span></span>
                  </a>
                )}
                {profile.phone && (
                  <a href={`tel:${profile.phone}`} className={contactTile}>
                    <span className={tileIcon}><Phone className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Phone</span><span className="block truncate text-sm font-semibold text-rally-navy">{profile.phone}</span></span>
                  </a>
                )}
                {linkedinUrl && (
                  <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className={contactTile}>
                    <span className={tileIcon}><Linkedin className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">LinkedIn</span><span className="block truncate text-sm font-semibold text-rally-navy">{displayUrl(linkedinUrl)}</span></span>
                  </a>
                )}
                {websiteUrl && (
                  <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className={contactTile}>
                    <span className={tileIcon}><Globe className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Website</span><span className="block truncate text-sm font-semibold text-rally-navy">{displayUrl(websiteUrl)}</span></span>
                  </a>
                )}
              </div>
            </section>
          ) : (
            <section className={section}>
              <EmptyState
                title="Add your contact details"
                description="Let people reach you via email, phone, LinkedIn, or your website."
                action={<Button variant="outline" className="rounded-xl" onClick={() => setEditing(true)}>Edit profile</Button>}
              />
            </section>
          )}

          {hasNetworking ? (
            <section className={section}>
              <h2 className="mb-4 font-display text-lg font-semibold text-rally-navy">Networking</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {profile.looking_for && (
                  <div className="rounded-xl bg-rally-canvas p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-700">Looking for</p>
                    <p className="mt-1.5 text-sm text-slate-700">{profile.looking_for}</p>
                  </div>
                )}
                {profile.can_offer && (
                  <div className="rounded-xl bg-rally-canvas p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-700">Can offer</p>
                    <p className="mt-1.5 text-sm text-slate-700">{profile.can_offer}</p>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className={section}>
              <EmptyState
                title="Add your networking details"
                description="Tell people what you're looking for and what you can offer."
                action={<Button variant="outline" className="rounded-xl" onClick={() => setEditing(true)}>Edit profile</Button>}
              />
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <section className={section}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-rally-navy">Profile completion</h2>
              <span className="font-display text-2xl font-bold text-primary-600">{completion}%</span>
            </div>
            <p className="text-sm text-slate-500">{filled} of {total} fields filled</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
              <div className="h-full rounded-full bg-primary-600 transition-all duration-500" style={{ width: `${completion}%` }} />
            </div>
            {completion < 100 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ALL_PROFILE_FIELDS.filter((f) => !isFieldFilled(profile, f)).map((field) => (
                  <span key={field} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    {FIELD_LABELS[field]}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className={section}>
            <h2 className="font-display text-lg font-semibold text-rally-navy">Your web pass link</h2>
            <p className="mt-1 text-sm text-slate-500">Send this link in chats, messages or at events.</p>
            <div className="mt-3 flex items-center gap-2">
              <Input readOnly value={shareUrl} aria-label="Your profile link" className="h-11 rounded-xl text-xs" />
              <Button variant="secondary" className="h-11 shrink-0 rounded-xl" onClick={handleShare}>
                {shareCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={() => setShowQRModal(true)} disabled={!qrDataUrl}>
                <Maximize2 className="h-4 w-4" aria-hidden="true" /> View QR
              </Button>
              <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={handleDownloadQR} disabled={!qrDataUrl}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download
              </Button>
            </div>
          </section>
        </aside>
      </div>

      {/* QR modal */}
      {showQRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-rally-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Your Rally QR" onClick={() => setShowQRModal(false)}>
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowQRModal(false)}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-rally-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex flex-col items-center gap-4">
              <h3 className="font-display text-lg font-semibold text-rally-navy">Your Rally QR</h3>
              {qrDataUrl && <img src={qrDataUrl} alt="Your Rally QR code" className="w-full max-w-[18rem] rounded-xl border border-rally-line" />}
              <p className="text-center text-sm text-slate-500">Have someone scan this to instantly connect with you on Rally.</p>
              <div className="flex w-full gap-2">
                <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={handleDownloadQR}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Download
                </Button>
                <Button className="h-11 flex-1 rounded-xl" onClick={handleShare}>
                  <Share2 className="h-4 w-4" aria-hidden="true" /> {shareCopied ? 'Copied!' : 'Share link'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
