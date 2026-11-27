import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import {
  createOrganizationPartner,
  updateOrganizationPartner,
  type PartnerDetailsInput,
} from '@/lib/partners'
import type { DirectoryPartner } from '@/lib/partnerDirectory'
import { EMAIL_SHAPE } from './AddPartnerDialog'
import { safeWebUrl } from './PartnerCommon'
import { PartnerIdentityFields, type PartnerIdentityValues } from './PartnerIdentityFields'
import { SheetDialog } from './SheetDialog'

// Create or edit one of the organization's partners. An edit reaches every event
// the partner is on -- the database copies it to each linked partnership in the
// same transaction -- so the form says so before anyone saves.

type Values = PartnerIdentityValues & { contact_email: string }

function valuesFrom(partner: DirectoryPartner | undefined): Values {
  return {
    company_name: partner?.company_name ?? '',
    logo_url: partner?.logo_url ?? '',
    industry: partner?.industry ?? '',
    website: partner?.website ?? '',
    linkedin: partner?.linkedin ?? '',
    description: partner?.description ?? '',
    contact_email: partner?.contact_email ?? '',
  }
}

/** Blanks become NULL; the URL and email are stored the way the database checks them. */
export function partnerDetailsInputFrom(values: Values): PartnerDetailsInput {
  return {
    company_name: values.company_name.trim(),
    description: values.description.trim() || null,
    logo_url: values.logo_url.trim() || null,
    industry: values.industry.trim() || null,
    website: safeWebUrl(values.website),
    linkedin: safeWebUrl(values.linkedin),
    contact_email: values.contact_email.trim().toLowerCase() || null,
  }
}

export function validatePartnerDetails(values: Values): string | null {
  if (!values.company_name.trim()) return 'Give this partner a company name.'
  if (values.website.trim() && !safeWebUrl(values.website)) {
    return 'The website must be a full URL, such as https://acme.com'
  }
  if (values.linkedin.trim() && !safeWebUrl(values.linkedin)) {
    return 'The LinkedIn link must be a full URL, such as https://linkedin.com/company/acme'
  }
  const email = values.contact_email.trim()
  if (email && !EMAIL_SHAPE.test(email)) return 'Enter a valid contact email address, or leave it blank.'
  return null
}

export function PartnerDetailsDialog({
  mode,
  organizationId,
  partner,
  archivedEventCount = 0,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  organizationId: string
  /** The partner being edited (edit mode). */
  partner?: DirectoryPartner
  /** Linked events that are archived: they keep their details until restored. */
  archivedEventCount?: number
  onClose: () => void
  onSaved: (partner: DirectoryPartner) => void
}) {
  const [values, setValues] = useState<Values>(() => valuesFrom(partner))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const invalid = validatePartnerDetails(values)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setSaving(true)
    const input = partnerDetailsInputFrom(values)
    if (mode === 'create') {
      const result = await createOrganizationPartner(organizationId, input)
      setSaving(false)
      if (result.error || !result.data) {
        setError(result.error ?? 'Unable to add this partner.')
        return
      }
      onSaved(result.data)
      return
    }
    if (!partner) return
    const result = await updateOrganizationPartner(partner.id, input)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onSaved({ ...partner, ...input })
  }

  return (
    <SheetDialog
      title={mode === 'create' ? 'New partner' : 'Edit partner'}
      subtitle={mode === 'edit' ? partner?.company_name : undefined}
      onClose={onClose}
      busy={saving}
      wide
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {mode === 'edit' && (
          <div className="rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-800">
            <p>Changes apply to this partner at every event, including what the partner sees.</p>
            {archivedEventCount > 0 && <p className="mt-1">Archived events keep their details until restored.</p>}
          </div>
        )}

        <PartnerIdentityFields
          values={values}
          onChange={setValues}
          emailSlot={
            <>
              <Label htmlFor="pt-contact">Contact email</Label>
              <Input
                id="pt-contact"
                type="email"
                value={values.contact_email}
                onChange={(e) => setValues({ ...values, contact_email: e.target.value })}
                placeholder="partnerships@acme.com"
                aria-describedby="pt-contact-hint"
              />
              <p id="pt-contact-hint" className="mt-1 text-xs text-gray-500">
                Fills in the representative when this partner is added to an event.
              </p>
            </>
          }
        />

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Save partner' : 'Save changes'}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}
