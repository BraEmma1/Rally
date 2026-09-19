import { useState, useEffect, type FormEvent } from 'react'
import { QrCode, Share2, Pencil, Save, X, Globe, Linkedin, Mail, Phone, MapPin } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth } from '@/context/AuthContext'
import { supabase, type Profile } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Label, Select } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States'
import { PhotoUpload } from '@/components/ui/PhotoUpload'
import { INDUSTRIES, getCompletionPercentage, getCompletionCount, isFieldFilled, ALL_PROFILE_FIELDS, FIELD_LABELS } from '@/lib/profile'

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [shareCopied, setShareCopied] = useState(false)

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
    setSaving(true)
    setError(null)
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
        linkedin: form.linkedin || '',
        website: form.website || '',
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

  if (!profile && !user) return <LoadingState />
  if (!profile) return <ErrorState message="Could not load your profile." />

  const completion = getCompletionPercentage(profile)
  const { filled, total } = getCompletionCount(profile)

  const displayName = profile.full_name || 'Your Name'
  const displayTitle = profile.job_title || 'Add your job title'
  const displayCompany = profile.company || 'Add your company'

  if (editing) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Edit Profile</h1>
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

  const hasContact = profile.email || profile.phone || profile.linkedin || profile.website
  const hasNetworking = profile.looking_for || profile.can_offer

  return (
    <div>
      {/* Completion indicator */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Profile completion</p>
              <p className="text-xs text-gray-500">{filled} of {total} fields filled</p>
            </div>
            <span className="text-2xl font-bold text-primary-600">{completion}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-primary-600 transition-all duration-500"
              style={{ width: `${completion}%` }}
            />
          </div>
          {completion < 100 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ALL_PROFILE_FIELDS
                .filter((f) => !isFieldFilled(profile, f))
                .map((field) => (
                  <span
                    key={field}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400"
                  >
                    {FIELD_LABELS[field]}
                  </span>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profile header */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Avatar name={displayName} src={profile.photo_url} size="xl" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{displayName}</h1>
                <p className="mt-0.5 text-sm text-gray-600">
                  {displayTitle}{displayCompany !== 'Add your company' ? ` at ${displayCompany}` : ''}
                </p>
                {profile.location && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" /> {profile.location}
                  </p>
                )}
                {profile.industry && <Badge variant="primary" className="mt-2">{profile.industry}</Badge>}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit profile
            </Button>
          </div>

          {profile.bio && (
            <p className="mt-4 text-sm leading-relaxed text-gray-700">{profile.bio}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: networking + contact */}
        <div className="space-y-6 lg:col-span-2">
          {hasNetworking ? (
            <Card>
              <CardHeader><CardTitle>Networking</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {profile.looking_for && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Looking for</p>
                    <p className="mt-1 text-sm text-gray-700">{profile.looking_for}</p>
                  </div>
                )}
                {profile.can_offer && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Can offer</p>
                    <p className="mt-1 text-sm text-gray-700">{profile.can_offer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  title="Add your networking details"
                  description="Tell people what you're looking for and what you can offer."
                  action={<Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit profile</Button>}
                />
              </CardContent>
            </Card>
          )}

          {hasContact ? (
            <Card>
              <CardHeader><CardTitle>Contact & Links</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {profile.email && (
                  <a href={`mailto:${profile.email}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                    <Mail className="h-4 w-4 text-gray-400" /> {profile.email}
                  </a>
                )}
                {profile.phone && (
                  <a href={`tel:${profile.phone}`} className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                    <Phone className="h-4 w-4 text-gray-400" /> {profile.phone}
                  </a>
                )}
                {profile.linkedin && (
                  <a href={profile.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                    <Linkedin className="h-4 w-4 text-gray-400" /> {profile.linkedin.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {profile.website && (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-gray-700 hover:text-primary-600">
                    <Globe className="h-4 w-4 text-gray-400" /> {profile.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  title="Add your contact details"
                  description="Let people reach you via email, phone, LinkedIn, or your website."
                  action={<Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit profile</Button>}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: QR + share */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-gray-400" />
                <CardTitle>QR Code</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {qrDataUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <img src={qrDataUrl} alt="Profile QR code" className="rounded-md border border-gray-200" />
                  <p className="text-center text-xs text-gray-500">
                    Scan to view your public profile
                  </p>
                </div>
              ) : (
                <EmptyState title="QR code unavailable" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-gray-400" />
                <CardTitle>Share Profile</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-500">Share your profile link with new contacts:</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={shareUrl} className="text-xs" />
                <Button size="sm" variant="secondary" onClick={handleShare} className="flex-shrink-0">
                  {shareCopied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
