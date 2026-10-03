import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/States'
import {
  createPackage,
  createPackageDeliverable,
  deletePackageDeliverable,
  listPackageDeliverables,
  reorderPackageDeliverables,
  updatePackage,
  updatePackageDeliverable,
  type PackageDeliverable,
  type PartnershipPackage,
} from '@/lib/partnerships'
import { formatDueDate } from './PartnerCommon'
import { SheetDialog } from './SheetDialog'
import {
  EMPTY_OBLIGATION_VALUES,
  PartnerObligationDialog,
  obligationInputFrom,
  obligationValuesFrom,
} from './PartnerObligationDialog'

// Create or edit one sponsorship package.
//
// A new package is saved first and its deliverables are edited afterwards,
// rather than collected in form state and written in a batch. A package is
// not a transaction the way a partnership is -- it is a list the organizer
// will come back to -- and saving it immediately means the deliverable editor
// is the same code whether the package is new or ten months old.

export function PackageDialog({
  event,
  existing,
  nextOrder,
  onClose,
  onSaved,
}: {
  event: { id: string; name: string }
  existing: PartnershipPackage | null
  /** Where a new package lands in the list. */
  nextOrder: number
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [valueAmount, setValueAmount] = useState(
    existing?.value_amount === null || existing?.value_amount === undefined
      ? ''
      : String(existing.value_amount)
  )
  const [valueCurrency, setValueCurrency] = useState(existing?.value_currency ?? '')

  const [packageId, setPackageId] = useState<string | null>(existing?.id ?? null)
  const [deliverables, setDeliverables] = useState<PackageDeliverable[]>([])
  const [loadingDeliverables, setLoadingDeliverables] = useState(Boolean(existing))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PackageDeliverable | null>(null)

  const loadDeliverables = useCallback(async () => {
    if (!packageId) return
    setLoadingDeliverables(true)
    const { data, error: listError } = await listPackageDeliverables(packageId)
    setDeliverables(data)
    if (listError) setError(listError)
    setLoadingDeliverables(false)
  }, [packageId])

  useEffect(() => {
    void loadDeliverables()
  }, [loadDeliverables])

  function validate(): string | null {
    if (!name.trim()) return 'Give this package a name.'
    if (name.trim().length > 80) return 'That package name is too long.'
    const amount = valueAmount.trim()
    const currency = valueCurrency.trim()
    if (amount) {
      const parsed = Number(amount)
      if (!Number.isFinite(parsed) || parsed < 0) {
        return 'The suggested value must be a number that is not negative.'
      }
      // The same rule the partnership form uses: an amount with no currency
      // is not information, and Rally does not pick one for you.
      if (!currency) return 'Add the currency for this value, such as GHS or USD.'
    }
    if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
      return 'Use a three-letter currency code, such as GHS, USD, EUR or GBP.'
    }
    if (currency && !amount) return 'Add the amount this currency applies to.'
    return null
  }

  async function saveDetails(): Promise<string | null> {
    const invalid = validate()
    if (invalid) return invalid

    const amount = valueAmount.trim()
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      value_amount: amount ? Number(amount) : null,
      value_currency: valueCurrency.trim().toUpperCase() || null,
    }

    if (packageId) {
      const { error: saveError } = await updatePackage(packageId, input)
      return saveError
    }
    const { id, error: createError } = await createPackage(event.id, input, nextOrder)
    if (createError || !id) return createError ?? 'Unable to save this package.'
    setPackageId(id)
    return null
  }

  async function handleSaveAndClose() {
    if (saving) return
    setSaving(true)
    setError(null)
    const failure = await saveDetails()
    setSaving(false)
    if (failure) {
      setError(failure)
      return
    }
    await onSaved()
    onClose()
  }

  /** The deliverable editor needs a saved package to attach rows to. */
  async function ensureSaved(): Promise<string | null> {
    if (packageId) return null
    setSaving(true)
    const failure = await saveDetails()
    setSaving(false)
    return failure
  }

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (!packageId || target < 0 || target >= deliverables.length) return
    const next = [...deliverables]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setDeliverables(next)
    const { error: reorderError } = await reorderPackageDeliverables(
      packageId,
      next.map((d) => d.id)
    )
    if (reorderError) {
      setError(reorderError)
      await loadDeliverables()
    }
  }

  async function remove(deliverable: PackageDeliverable) {
    const { error: removeError } = await deletePackageDeliverable(deliverable.id)
    if (removeError) {
      setError(removeError)
      return
    }
    await loadDeliverables()
  }

  return (
    <SheetDialog
      title={existing ? 'Edit Package' : 'New Sponsorship Package'}
      subtitle={event.name}
      onClose={onClose}
      busy={saving}
      wide
    >
      <div className="space-y-5">
        <div>
          <Label htmlFor="pk-name">Package Name *</Label>
          <Input
            id="pk-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Gold"
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-500">
            Your own wording — “Gold”, “Headline Sponsor”, “Media Partner Package”.
          </p>
        </div>

        <div>
          <Label htmlFor="pk-description">Description</Label>
          <Textarea
            id="pk-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={4000}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div>
            <Label htmlFor="pk-value">Suggested Value</Label>
            <Input
              id="pk-value"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={valueAmount}
              onChange={(e) => setValueAmount(e.target.value)}
              placeholder="60000"
            />
          </div>
          <div>
            <Label htmlFor="pk-currency">Currency</Label>
            <Input
              id="pk-currency"
              value={valueCurrency}
              onChange={(e) => setValueCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="GHS"
              className="uppercase"
            />
          </div>
        </div>
        <p className="-mt-3 text-xs text-gray-500">
          Optional. A starting point for negotiation — each partnership keeps its own figure.
        </p>

        <div className="border-t border-gray-200 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Default deliverables</h3>
              <p className="mt-0.5 text-sm text-gray-500">
                Copied into a partnership when this package is chosen. Editing them later never
                changes a partnership that already exists.
              </p>
            </div>
          </div>

          {loadingDeliverables ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
              <Spinner size="sm" />
              Loading…
            </div>
          ) : deliverables.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed border-gray-300 px-4 py-5 text-center">
              <p className="text-sm text-gray-500">No default deliverables</p>
              <p className="mt-1 text-xs text-gray-400">
                A package without any is still usable — it just fills in the name and value.
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200">
              {deliverables.map((item, index) => {
                const meta = [
                  item.category,
                  item.quantity !== null ? 'Qty ' + item.quantity : null,
                  item.due_date ? 'Due ' + formatDueDate(item.due_date) : null,
                ].filter(Boolean)
                return (
                  <li key={item.id} className="flex items-start gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                      {item.description && (
                        <p className="mt-0.5 text-sm text-gray-600">{item.description}</p>
                      )}
                      {meta.length > 0 && (
                        <p className="mt-0.5 text-xs text-gray-500">{meta.join(' · ')}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center">
                      {deliverables.length > 1 && (
                        <div className="mr-1 hidden flex-col sm:flex">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => void move(index, -1)}
                            aria-label={'Move ' + item.title + ' up'}
                            className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === deliverables.length - 1}
                            onClick={() => void move(index, 1)}
                            aria-label={'Move ' + item.title + ' down'}
                            className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing(item)}
                        aria-label={'Edit ' + item.title}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void remove(item)}
                        aria-label={'Remove ' + item.title}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <Button
            variant="secondary"
            className="mt-3"
            disabled={saving || !name.trim()}
            onClick={async () => {
              const failure = await ensureSaved()
              if (failure) {
                setError(failure)
                return
              }
              setError(null)
              setAdding(true)
            }}
          >
            <Plus className="h-4 w-4" />
            Add Deliverable
          </Button>
          {!packageId && (
            <p className="mt-1 text-xs text-gray-500">
              Name the package first — adding a deliverable saves it.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {packageId ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => void handleSaveAndClose()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save Package'}
          </Button>
        </div>
      </div>

      {/* The same editor the partnership obligations use. A template has no
          direction of its own -- a package describes what the organizer
          provides -- so it borrows the deliverable wording. */}
      {adding && packageId && (
        <PartnerObligationDialog
          title="Add Default Deliverable"
          subtitle={name.trim()}
          direction="organizer_to_partner"
          initial={EMPTY_OBLIGATION_VALUES}
          submitLabel="Add"
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const input = obligationInputFrom(values, 'organizer_to_partner')
            const { error: addError } = await createPackageDeliverable(
              packageId,
              event.id,
              {
                title: input.title,
                description: input.description,
                category: input.category,
                quantity: input.quantity,
                due_date: input.due_date,
              },
              deliverables.length
            )
            if (addError) return addError
            setAdding(false)
            await loadDeliverables()
            return null
          }}
        />
      )}

      {editing && (
        <PartnerObligationDialog
          title="Edit Default Deliverable"
          subtitle={name.trim()}
          direction="organizer_to_partner"
          initial={obligationValuesFrom(editing)}
          submitLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const input = obligationInputFrom(values, 'organizer_to_partner')
            const { error: saveError } = await updatePackageDeliverable(editing.id, {
              title: input.title,
              description: input.description,
              category: input.category,
              quantity: input.quantity,
              due_date: input.due_date,
            })
            if (saveError) return saveError
            setEditing(null)
            await loadDeliverables()
            return null
          }}
        />
      )}
    </SheetDialog>
  )
}
