import type { ReactNode } from 'react'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { EventPhotoUpload } from '@/components/ui/EventPhotoUpload'

// A company's basic details: logo, name, industry, website, LinkedIn and
// description. The same inputs serve an event partnership (Add Partner, Edit
// Partner) and an organization partner (the Partners page), because those are
// the six details a linked partnership takes from its partner. One copy, so
// the two can never ask for them differently.
//
// The email beside Industry differs -- a partnership's representative, a
// partner's default contact -- so the caller renders it into `emailSlot`.

export type PartnerIdentityValues = {
  company_name: string
  logo_url: string
  industry: string
  website: string
  linkedin: string
  description: string
}

export function PartnerIdentityFields<V extends PartnerIdentityValues>({
  values,
  onChange,
  emailSlot,
}: {
  values: V
  onChange: (next: V) => void
  emailSlot?: ReactNode
}) {
  function set<K extends keyof PartnerIdentityValues>(key: K, value: string) {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="space-y-4">
      <EventPhotoUpload
        folder="partners"
        fullName={values.company_name || 'Partner'}
        currentPhotoUrl={values.logo_url || null}
        onUploaded={(url) => set('logo_url', url)}
        size="lg"
        hint="Click to upload a company logo"
      />
      <div>
        <Label htmlFor="pt-company">Company Name *</Label>
        <Input
          id="pt-company"
          value={values.company_name}
          onChange={(e) => set('company_name', e.target.value)}
          maxLength={200}
          placeholder="Acme Bank"
          required
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pt-industry">Industry</Label>
          <Input
            id="pt-industry"
            value={values.industry}
            onChange={(e) => set('industry', e.target.value)}
            maxLength={120}
            placeholder="Financial Services"
          />
        </div>
        {emailSlot && <div>{emailSlot}</div>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pt-website">Website</Label>
          <Input
            id="pt-website"
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://acme.com"
          />
        </div>
        <div>
          <Label htmlFor="pt-linkedin">LinkedIn</Label>
          <Input
            id="pt-linkedin"
            value={values.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
            placeholder="https://linkedin.com/company/acme"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="pt-description">Description</Label>
        <Textarea
          id="pt-description"
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          maxLength={4000}
        />
      </div>
    </div>
  )
}
