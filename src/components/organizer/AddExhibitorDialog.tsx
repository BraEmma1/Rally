import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { EventPhotoUpload } from '@/components/ui/EventPhotoUpload'
import { createExhibitor, type ExhibitorInput } from '@/lib/exhibitors'
import { SheetDialog } from './SheetDialog'

type EventLike = {
  id: string
  name: string
}

export type ExhibitorFormValues = {
  name: string
  industry: string
  booth: string
  description: string
  logo_url: string
  website: string
  linkedin: string
}

export const EMPTY_EXHIBITOR_VALUES: ExhibitorFormValues = {
  name: '',
  industry: '',
  booth: '',
  description: '',
  logo_url: '',
  website: '',
  linkedin: '',
}

// Logo uploads happen the moment the organizer picks a file (fresh unique
// object in event-assets/exhibitors), but the exhibitor row is only inserted
// on submit — an upload failure never leaves a broken record behind.
export function AddExhibitorDialog({
  event,
  onClose,
  onSaved,
}: {
  event: EventLike
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <SheetDialog title="Add Exhibitor" subtitle={event.name} onClose={onClose}>
      <ExhibitorFields eventId={event.id} initial={EMPTY_EXHIBITOR_VALUES} onSaved={onSaved} />
    </SheetDialog>
  )
}

export function ExhibitorFields({
  eventId,
  initial,
  onSaved,
}: {
  eventId: string
  initial: ExhibitorFormValues
  onSaved: (saved: ExhibitorFormValues) => void
}) {
  const [values, setValues] = useState<ExhibitorFormValues>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof ExhibitorFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function isProbablyValidUrl(value: string): boolean {
    if (!value) return true
    return /^https?:\/\/\S+\.\S+/i.test(value)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!values.name.trim()) {
      setError('Give the exhibitor a company or organization name.')
      return
    }
    if (!isProbablyValidUrl(values.website.trim())) {
      setError('The website must be a full URL starting with https://')
      return
    }
    if (!isProbablyValidUrl(values.linkedin.trim())) {
      setError('The LinkedIn link must be a full URL starting with https://')
      return
    }
    setSaving(true)
    const payload: ExhibitorInput = {
      name: values.name.trim(),
      industry: values.industry.trim(),
      booth: values.booth.trim(),
      description: values.description.trim(),
      logo_url: values.logo_url.trim(),
      website: values.website.trim(),
      linkedin: values.linkedin.trim(),
    }
    const { error: err } = await createExhibitor(eventId, payload)
    if (err) {
      setError(err)
      setSaving(false)
      return
    }
    onSaved(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <EventPhotoUpload
        folder="exhibitors"
        fullName={values.name || 'Exhibitor'}
        currentPhotoUrl={values.logo_url || null}
        onUploaded={(url) => set('logo_url', url)}
        hint="Click to upload a company logo"
      />
      <div>
        <Label htmlFor="ex-name">Company / Organization Name *</Label>
        <Input
          id="ex-name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ex-industry">Industry</Label>
          <Input
            id="ex-industry"
            value={values.industry}
            onChange={(e) => set('industry', e.target.value)}
            maxLength={120}
            placeholder="Fintech"
          />
        </div>
        <div>
          <Label htmlFor="ex-booth">Booth / Location</Label>
          <Input
            id="ex-booth"
            value={values.booth}
            onChange={(e) => set('booth', e.target.value)}
            maxLength={120}
            placeholder="Booth A12"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ex-description">Description</Label>
        <Textarea
          id="ex-description"
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
          maxLength={4000}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ex-website">Website</Label>
          <Input
            id="ex-website"
            type="url"
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://…"
          />
        </div>
        <div>
          <Label htmlFor="ex-linkedin">LinkedIn</Label>
          <Input
            id="ex-linkedin"
            type="url"
            value={values.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
            placeholder="https://linkedin.com/company/…"
          />
        </div>
      </div>
      {error && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
        <Button type="submit" disabled={saving || !values.name.trim()}>
          {saving ? 'Saving…' : 'Save exhibitor'}
        </Button>
      </div>
    </form>
  )
}
