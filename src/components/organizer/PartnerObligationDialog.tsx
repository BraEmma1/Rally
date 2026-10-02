import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import type { ObligationDirection, ObligationInput } from '@/lib/partnerships'
import { SheetDialog } from './SheetDialog'

// One form for both directions and for both lifecycles.
//
// The Add Partner wizard uses it to edit a draft item that has not been saved
// anywhere yet; Partner Detail uses it to create or edit a real row. The only
// difference is what `onSubmit` does, so the dialog takes it as a function
// returning an error message or null and never talks to the database itself.
// That is also what keeps the two paths from drifting: there is one set of
// fields and one set of validation rules.

export type ObligationFormValues = {
  title: string
  description: string
  category: string
  quantity: string
  due_date: string
}

export const EMPTY_OBLIGATION_VALUES: ObligationFormValues = {
  title: '',
  description: '',
  category: '',
  quantity: '',
  due_date: '',
}

export function obligationValuesFrom(row: {
  title: string
  description: string | null
  category: string | null
  quantity: number | null
  due_date: string | null
}): ObligationFormValues {
  return {
    title: row.title,
    description: row.description ?? '',
    category: row.category ?? '',
    quantity: row.quantity === null ? '' : String(row.quantity),
    due_date: row.due_date ?? '',
  }
}

/** Form values to the shape the obligations table takes. Blanks become NULL. */
export function obligationInputFrom(
  values: ObligationFormValues,
  direction: ObligationDirection
): ObligationInput {
  const quantity = values.quantity.trim()
  return {
    direction,
    title: values.title.trim(),
    description: values.description.trim() || null,
    category: values.category.trim() || null,
    quantity: quantity ? Number(quantity) : null,
    due_date: values.due_date || null,
  }
}

export function validateObligation(values: ObligationFormValues): string | null {
  if (!values.title.trim()) return 'Give this item a title.'
  const quantity = values.quantity.trim()
  if (quantity) {
    const parsed = Number(quantity)
    if (!Number.isInteger(parsed) || parsed < 1) {
      return 'Quantity must be a whole number above zero.'
    }
  }
  return null
}

const COPY: Record<ObligationDirection, { noun: string; placeholder: string }> = {
  organizer_to_partner: { noun: 'deliverable', placeholder: 'Logo on event backdrop' },
  partner_to_organizer: { noun: 'requirement', placeholder: 'High-resolution company logo' },
}

export function PartnerObligationDialog({
  title,
  subtitle,
  direction,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string
  subtitle?: string
  direction: ObligationDirection
  initial: ObligationFormValues
  submitLabel: string
  /** Returns an error message, or null when it succeeded. */
  onSubmit: (values: ObligationFormValues) => Promise<string | null>
  onClose: () => void
}) {
  const [values, setValues] = useState<ObligationFormValues>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof ObligationFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const invalid = validateObligation(values)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setSaving(true)
    const failure = await onSubmit(values)
    if (failure) {
      setError(failure)
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const copy = COPY[direction]

  return (
    <SheetDialog title={title} subtitle={subtitle} onClose={onClose} busy={saving}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="ob-title">Title *</Label>
          <Input
            id="ob-title"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={200}
            placeholder={copy.placeholder}
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="ob-description">Description</Label>
          <Textarea
            id="ob-description"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={'What this ' + copy.noun + ' involves.'}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="ob-category">Category</Label>
            <Input
              id="ob-category"
              value={values.category}
              onChange={(e) => set('category', e.target.value)}
              maxLength={80}
              placeholder="Branding"
            />
          </div>
          <div>
            <Label htmlFor="ob-quantity">Quantity</Label>
            <Input
              id="ob-quantity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={values.quantity}
              onChange={(e) => set('quantity', e.target.value)}
              placeholder="2"
            />
          </div>
          <div>
            <Label htmlFor="ob-due">Due date</Label>
            <Input
              id="ob-due"
              type="date"
              value={values.due_date}
              onChange={(e) => set('due_date', e.target.value)}
            />
          </div>
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
          <Button type="submit" disabled={saving || !values.title.trim()}>
            {saving ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </SheetDialog>
  )
}
