import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, ArrowRight, Check } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { supabase, type Profile } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Label, Select } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { PhotoUpload } from '@/components/ui/PhotoUpload'
import { LoadingState, ErrorState } from '@/components/ui/States'
import { INDUSTRIES, getCompletionPercentage, isFieldFilled, ALL_PROFILE_FIELDS, FIELD_LABELS } from '@/lib/profile'

export default function OnboardingPage() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState<Partial<Profile>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (profile) {
      setForm(profile)
      setLoading(false)
    } else if (user) {
      supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          setForm(data as Partial<Profile> || {})
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [profile, user])

  function setField<K extends keyof Profile>(field: K, value: Profile[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const completion = getCompletionPercentage(form)
  const filledCount = ALL_PROFILE_FIELDS.filter((f) => isFieldFilled(form, f)).length

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)

    if (!form.full_name?.trim()) {
      setError('Full name is required.')
      return
    }
    if (!form.job_title?.trim()) {
      setError('Job title is required.')
      return
    }
    if (!form.company?.trim()) {
      setError('Company is required.')
      return
    }
    if (!form.bio?.trim()) {
      setError('A short bio is required.')
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
    setSuccess(true)
    navigate('/dashboard')
  }

  if (loading) return <LoadingState message="Loading your profile…" />
  if (!user) return <ErrorState message="You must be signed in to complete your profile." />

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Top bar */}
      <div className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-600 text-white">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Complete your profile</h1>
            <p className="text-sm text-gray-500">Let's set up your professional profile</p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {/* Completion indicator */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Profile completion</p>
                <p className="text-xs text-gray-500">{filledCount} of {ALL_PROFILE_FIELDS.length} fields filled</p>
              </div>
              <span className="text-2xl font-bold text-primary-600">{completion}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-primary-600 transition-all duration-500"
                style={{ width: `${completion}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ALL_PROFILE_FIELDS.map((field) => (
                <span
                  key={field}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    isFieldFilled(form, field)
                      ? 'bg-accent-50 text-accent-700'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {isFieldFilled(form, field) && <Check className="h-3 w-3" />}
                  {FIELD_LABELS[field]}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Photo + Basic Info */}
          <Card>
            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <PhotoUpload
                  userId={user.id}
                  fullName={form.full_name || ''}
                  currentPhotoUrl={form.photo_url || null}
                  onUploaded={(url) => setField('photo_url', url)}
                />
                <div className="flex-1 space-y-4">
                  <div>
                    <Label htmlFor="full_name">Full name *</Label>
                    <Input
                      id="full_name"
                      value={form.full_name || ''}
                      onChange={(e) => setField('full_name', e.target.value)}
                      placeholder="Jane Smith"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="job_title">Job title *</Label>
                      <Input
                        id="job_title"
                        value={form.job_title || ''}
                        onChange={(e) => setField('job_title', e.target.value)}
                        placeholder="Product Manager"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="company">Company *</Label>
                      <Input
                        id="company"
                        value={form.company || ''}
                        onChange={(e) => setField('company', e.target.value)}
                        placeholder="Acme Inc."
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="industry">Industry</Label>
                  <Select
                    id="industry"
                    value={form.industry || ''}
                    onChange={(e) => setField('industry', e.target.value)}
                  >
                    <option value="">Select an industry</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={form.location || ''}
                    onChange={(e) => setField('location', e.target.value)}
                    placeholder="San Francisco, CA"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="bio">Bio *</Label>
                <Textarea
                  id="bio"
                  rows={3}
                  value={form.bio || ''}
                  onChange={(e) => setField('bio', e.target.value)}
                  placeholder="A short professional summary about who you are and what you do…"
                  required
                />
              </div>
            </CardContent>
          </Card>

          {/* Networking */}
          <Card>
            <CardHeader><CardTitle>Networking Goals</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="looking_for">What I'm looking for</Label>
                <Textarea
                  id="looking_for"
                  rows={2}
                  value={form.looking_for || ''}
                  onChange={(e) => setField('looking_for', e.target.value)}
                  placeholder="Investors, co-founders, design partners…"
                />
              </div>
              <div>
                <Label htmlFor="can_offer">What I can offer</Label>
                <Textarea
                  id="can_offer"
                  rows={2}
                  value={form.can_offer || ''}
                  onChange={(e) => setField('can_offer', e.target.value)}
                  placeholder="Product strategy, intros to VCs, B2B SaaS expertise…"
                />
              </div>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader><CardTitle>Contact & Links</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email || ''}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="jane@company.com"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone / WhatsApp</Label>
                  <Input
                    id="phone"
                    value={form.phone || ''}
                    onChange={(e) => setField('phone', e.target.value)}
                    placeholder="+1 555 000 0000"
                  />
                </div>
                <div>
                  <Label htmlFor="linkedin">LinkedIn URL</Label>
                  <Input
                    id="linkedin"
                    value={form.linkedin || ''}
                    onChange={(e) => setField('linkedin', e.target.value)}
                    placeholder="https://linkedin.com/in/…"
                  />
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={form.website || ''}
                    onChange={(e) => setField('website', e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
          )}

          {success && (
            <div className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700">
              Profile saved successfully!
            </div>
          )}

          <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-gray-200 bg-white py-4">
            <Button type="submit" disabled={saving} size="lg">
              {saving ? (
                <>Saving…</>
              ) : (
                <>Save & continue <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
