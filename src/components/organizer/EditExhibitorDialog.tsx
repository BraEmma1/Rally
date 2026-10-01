import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { EventPhotoUpload } from '@/components/ui/EventPhotoUpload'
import { updateExhibitor } from '@/lib/exhibitors'
import { deleteOwnEventAsset } from '@/lib/uploads'
import { SheetDialog } from './SheetDialog'
import { EMPTY_EXHIBITOR_VALUES, type ExhibitorFormValues } from './AddExhibitorDialog'

type EventLike = {
  id: string
  name: string
}

// Replace-safe logo behavior: the new logo is already a fresh object when the
// file was picked. The database row is updated first; only after that succeeds
// is the previous asset deleted — and only if it is an event-assets object the
// current user owns (deleteOwnEventAsset no-ops on anything else, so legacy or
// foreign URLs are never touched).
export function EditExhibitorDialog({
  event,
  exhibitor,
  onClose,
  onSaved,
}: {
  event: EventLike
  exhibitor: {
    id: string
    name: string
    industry: string
    booth: string
    description: string
    logo_url: string
    website: string
    linkedin: string
  }
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<ExhibitorFormValues>({
    ...EMPTY_EXHIBITOR_VALUES,
    name: exhibitor.name,
    industry: exhibitor.industry,
    booth: exhibitor.booth,
    description: exhibitor.description,
    logo_url: exhibitor.logo_url,
    website: exhibitor.website,
    linkedin: exhibitor.linkedin,
  })
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
    const previousLogo = exhibitor.logo_url
    const { error: err } = await updateExhibitor(exhibitor.id, {
      name: values.name.trim(),
      industry: values.industry.trim(),
      booth: values.booth.trim(),
      description: values.description.trim(),
      logo_url: values.logo_url.trim(),
      website: values.website.trim(),
      linkedin: values.linkedin.trim(),
    })
    if (err) {
      setError(err)
      setSaving(false)
      return
    }
    if (values.logo_url.trim() && values.logo_url.trim() !== previousLogo) {
      void deleteOwnEventAsset(previousLogo)
    }
    onSaved()
  }

  return (
    <SheetDialog title="Edit exhibitor" subtitle={event.name} onClose={onClose}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
        className="space-y-4"
      >
        <EventPhotoUpload
          folder="exhibitors"
          fullName={values.name || exhibitor.name}
          currentPhotoUrl={values.logo_url || null}
          onUploaded={(url) => set('logo_url', url)}
          hint="Click to replace the company logo"
        />
        <div>
          <Label htmlFor="eex-name">Company / Organization Name *</Label>
          <Input
            id="eex-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="eex-industry">Industry</Label>
            <Input
              id="eex-industry"
              value={values.industry}
              onChange={(e) => set('industry', e.target.value)}
              maxLength={120}
              placeholder="Fintech"
            />
          </div>
          <div>
            <Label htmlFor="eex-booth">Booth / Location</Label>
            <Input
              id="eex-booth"
              value={values.booth}
              onChange={(e) => set('booth', e.target.value)}
              maxLength={120}
              placeholder="Booth A12"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="eex-description">Description</Label>
          <Textarea
            id="eex-description"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            rows={4}
            maxLength={4000}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="eex-website">Website</Label>
            <Input
              id="eex-website"
              type="url"
              value={values.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div>
            <Label htmlFor="eex-linkedin">LinkedIn</Label>
            <Input
              id="eex-linkedin"
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
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button type="submit" disabled={saving || !values.name.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}
