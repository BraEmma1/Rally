import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Label, Textarea } from '@/components/ui/Input'
import {
  setPartnershipRoles,
  updatePartnership,
  type Partnership,
  type PartnershipRole,
} from '@/lib/partnerships'
import {
  CompanyFields,
  PartnershipFields,
  partnershipInputFrom,
  validateCompanyStep,
  validatePartnershipStep,
  type PartnerFormValues,
} from './AddPartnerDialog'
import { SheetDialog } from './SheetDialog'

// Edit renders the same two field groups the wizard does, on one scrolling
// panel rather than in steps -- an edit is a correction, not a walkthrough.
//
// Two rules come from the backend rather than from this screen:
//
//   * The representative of record and a live invitation must not disagree, so
//     while a partnership is `invited` that field is read-only and says why.
//     The trigger would refuse the write anyway; disabling it means the person
//     finds out before typing an address rather than after.
//   * status, sponsor_organization_id and acknowledged_at are not on this form
//     and are not in the payload. Those belong to the lifecycle and to
//     invitation acceptance.

function valuesFrom(partnership: Partnership, roles: PartnershipRole[]): PartnerFormValues {
  return {
    company_name: partnership.company_name,
    logo_url: partnership.logo_url ?? '',
    industry: partnership.industry ?? '',
    website: partnership.website ?? '',
    linkedin: partnership.linkedin ?? '',
    description: partnership.description ?? '',
    representative_email: partnership.representative_email ?? '',
    roles,
    tier_label: partnership.tier_label ?? '',
    value_amount: partnership.value_amount === null ? '' : String(partnership.value_amount),
    value_currency: partnership.value_currency ?? '',
    internal_notes: partnership.internal_notes ?? '',
  }
}

export function EditPartnerDialog({
  partnership,
  roles,
  onClose,
  onSaved,
}: {
  partnership: Partnership
  roles: PartnershipRole[]
  onClose: () => void
  onSaved: (warning: string | null) => void
}) {
  const [values, setValues] = useState<PartnerFormValues>(valuesFrom(partnership, roles))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const representativeLocked =
    partnership.status === 'invited'
      ? 'An invitation is out to this address. Revoke it before changing the representative.'
      : undefined

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const invalid = validateCompanyStep(values) ?? validatePartnershipStep(values)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setSaving(true)

    const input = partnershipInputFrom(values)
    // A locked field must not be sent at all, even unchanged: the guard
    // compares values, and sending the same address is pointless traffic.
    const patch = representativeLocked
      ? { ...input, representative_email: partnership.representative_email }
      : input

    const { error: saveError } = await updatePartnership(partnership.id, patch)
    if (saveError) {
      setError(saveError)
      setSaving(false)
      return
    }

    const rolesChanged =
      values.roles.length !== roles.length || values.roles.some((r) => !roles.includes(r))

    if (rolesChanged) {
      const { error: rolesError } = await setPartnershipRoles(partnership.id, values.roles)
      if (rolesError) {
        // Partnerships and roles are separate tables with no combined RPC, so
        // this really can half-apply. Say which half landed rather than
        // reporting a clean failure and leaving the two out of step silently.
        setSaving(false)
        onSaved('The company details were saved, but the roles were not. ' + rolesError)
        return
      }
    }

    setSaving(false)
    onSaved(null)
  }

  return (
    <SheetDialog
      title="Edit Partner"
      subtitle={partnership.company_name}
      onClose={onClose}
      busy={saving}
      wide
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <CompanyFields
          values={values}
          onChange={setValues}
          lockRepresentativeEmail={representativeLocked}
        />

        <div className="border-t border-gray-200 pt-5">
          <PartnershipFields values={values} onChange={setValues} />
        </div>

        <div className="border-t border-gray-200 pt-5">
          <Label htmlFor="pt-notes">Internal notes</Label>
          <Textarea
            id="pt-notes"
            value={values.internal_notes}
            onChange={(e) => setValues({ ...values, internal_notes: e.target.value })}
            rows={4}
            maxLength={8000}
            placeholder="Anything your team should know. Never shown to the partner."
          />
          <p className="mt-1 text-xs text-gray-500">
            Private to people who manage this event.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !values.company_name.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}
