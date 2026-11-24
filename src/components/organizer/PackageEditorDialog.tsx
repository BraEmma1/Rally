import { useCallback, useEffect, useState } from 'react'
import { Archive, ChevronDown, ChevronUp, Info, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/States'
import {
  createPackage,
  createPackageDeliverable,
  deletePackage,
  deletePackageDeliverable,
  listPackageDeliverables,
  reorderPackageDeliverables,
  setPackageArchived,
  updatePackage,
  updatePackageDeliverable,
  type PackageDeliverable,
  type PackageDeliverableInput,
  type PartnershipPackage,
} from '@/lib/partnershipPackages'
import {
  EMPTY_PACKAGE_VALUES,
  PACKAGE_DESCRIPTION_MAX,
  PACKAGE_NAME_MAX,
  movedIds,
  nextDisplayOrder,
  packageCanBeDeleted,
  packageFormChanged,
  packageInputFrom,
  packageUsageLabel,
  packageValuesFrom,
  validatePackage,
  type PackageFormValues,
} from '@/lib/packageForm'
import { formatDueDate, formatMoney } from './PartnerCommon'
import {
  EMPTY_OBLIGATION_VALUES,
  PartnerObligationDialog,
  obligationInputFrom,
  obligationValuesFrom,
  type ObligationFormValues,
} from './PartnerObligationDialog'
import { ConfirmDialog, SheetDialog } from './SheetDialog'

// ---------------------------------------------------------------------------
// One package: its details, its template deliverables, and its lifecycle.
//
// The two halves save differently, and the screen says which is which:
//
//   * Details (name, description, suggested value) are a form with a Save
//     button, because they are edited together and checked together.
//   * Deliverables save one at a time, as they are added, edited, removed or
//     moved -- the same as a partner's deliverables on Partner Detail. One row
//     per statement means there is no multi-step save that can half-apply.
//
// A new package is created from the details first. Its deliverables can be
// added the moment it exists, in the same sheet.
//
// The deliverable form is PartnerObligationDialog, the one Add Partner and
// Partner Detail already use. A template row has the same fields as an
// obligation (minus status and direction), so a second form would only drift.
// ---------------------------------------------------------------------------

type Confirm = 'discard' | 'delete' | { removeItem: PackageDeliverable } | null

function deliverableInputFrom(values: ObligationFormValues): PackageDeliverableInput {
  const { title, description, category, quantity, due_date } = obligationInputFrom(
    values,
    'organizer_to_partner'
  )
  return { title, description, category, quantity, due_date }
}

export function PackageEditorDialog({
  event,
  initial,
  nextOrder,
  editable,
  onClose,
  onChanged,
}: {
  event: { id: string; name: string }
  /** The package to open, or null to create one. */
  initial: PartnershipPackage | null
  /** display_order for a package created here. */
  nextOrder: number
  editable: boolean
  onClose: () => void
  /** Something was saved; the list behind this sheet should reload. */
  onChanged: () => void
}) {
  const [pkg, setPkg] = useState<PartnershipPackage | null>(initial)
  const [saved, setSaved] = useState<PackageFormValues>(
    initial ? packageValuesFrom(initial) : EMPTY_PACKAGE_VALUES
  )
  const [values, setValues] = useState<PackageFormValues>(saved)
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [deliverables, setDeliverables] = useState<PackageDeliverable[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PackageDeliverable | null>(null)

  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)

  const packageId = pkg?.id ?? null
  const dirty = packageFormChanged(saved, values)

  const loadDeliverables = useCallback(async () => {
    if (!packageId) return
    setLoadError(null)
    const { data, error } = await listPackageDeliverables(event.id, packageId)
    if (error) {
      setLoadError(error)
      return
    }
    setDeliverables(data)
  }, [event.id, packageId])

  useEffect(() => {
    void loadDeliverables()
  }, [loadDeliverables])

  // Escape, the backdrop and the close button all come here. An open
  // confirmation is dismissed first, and unsaved details are not dropped
  // without asking.
  function requestClose() {
    if (savingDetails || busy) return
    if (confirm) {
      setConfirm(null)
      return
    }
    if (editable && dirty) {
      setConfirm('discard')
      return
    }
    onClose()
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    if (savingDetails) return
    const invalid = validatePackage(values)
    if (invalid) {
      setDetailsError(invalid)
      return
    }
    setDetailsError(null)
    setNotice(null)
    setSavingDetails(true)
    const input = packageInputFrom(values)

    if (!pkg) {
      const { data, error } = await createPackage(event.id, input, nextOrder)
      setSavingDetails(false)
      if (error || !data) {
        setDetailsError(error ?? 'Unable to create this package.')
        return
      }
      setPkg(data)
      setSaved(packageValuesFrom(data))
      setValues(packageValuesFrom(data))
      setDeliverables([])
      setNotice('Package created. Now add the deliverables it includes.')
      onChanged()
      return
    }

    const { error } = await updatePackage(pkg.id, input)
    setSavingDetails(false)
    if (error) {
      setDetailsError(error)
      return
    }
    const next = { ...pkg, ...input }
    setPkg(next)
    setSaved(packageValuesFrom(next))
    setValues(packageValuesFrom(next))
    setNotice('Package details saved.')
    onChanged()
  }

  async function move(index: number, delta: -1 | 1) {
    if (!pkg || !deliverables) return
    const ids = movedIds(
      deliverables.map((d) => d.id),
      index,
      delta
    )
    if (!ids) return
    const before = deliverables
    const byId = new Map(deliverables.map((d) => [d.id, d]))
    setDeliverables(ids.map((id) => byId.get(id) as PackageDeliverable))
    const { error } = await reorderPackageDeliverables(pkg.id, ids)
    if (error) {
      setDeliverables(before)
      setItemError(error)
      return
    }
    setItemError(null)
  }

  async function removeItem(item: PackageDeliverable) {
    setBusy(true)
    const { error } = await deletePackageDeliverable(item.id)
    setBusy(false)
    setConfirm(null)
    if (error) {
      setItemError(error)
      return
    }
    setItemError(null)
    await loadDeliverables()
    onChanged()
  }

  async function setArchived(archived: boolean) {
    if (!pkg || busy) return
    setBusy(true)
    setLifecycleError(null)
    setNotice(null)
    const { error } = await setPackageArchived(pkg.id, archived)
    setBusy(false)
    if (error) {
      setLifecycleError(error)
      return
    }
    setPkg({ ...pkg, archived_at: archived ? new Date().toISOString() : null })
    setNotice(archived ? 'Package archived.' : 'Package restored.')
    onChanged()
  }

  async function remove() {
    if (!pkg) return
    setBusy(true)
    const { error } = await deletePackage(pkg.id)
    setBusy(false)
    setConfirm(null)
    if (error) {
      setLifecycleError(error)
      return
    }
    onChanged()
    onClose()
  }

  const money = pkg ? formatMoney(pkg.value_amount, pkg.value_currency) : null

  // The nested dialogs are siblings of the sheet, not children: on desktop the
  // sheet is positioned with a transform, which would otherwise become the
  // containing block of their `fixed` overlay and clip them to the sheet.
  return (
    <>
      <SheetDialog
        title={pkg ? pkg.name : 'New Package'}
        subtitle={event.name}
        onClose={requestClose}
        busy={savingDetails || busy}
        wide
      >
        <div className="space-y-6">
          {pkg && pkg.archived_at && (
            <div
              className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              role="status"
            >
              <Archive className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <span>
                This package is archived. It is kept with its deliverables, but is not offered for new
                partners.
              </span>
            </div>
          )}

          {pkg && pkg.partnership_count > 0 && (
            <div
              className="flex items-start gap-2 rounded-md border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800"
              role="note"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {packageUsageLabel(pkg.partnership_count)}. Each of them keeps the deliverables and
                value it was created with, so changes here only apply to partners added from now on.
              </span>
            </div>
          )}

          {notice && (
            <div className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700" role="status">
              {notice}
            </div>
          )}

          {/* ---- Details ---------------------------------------------------- */}
          {editable ? (
            <form onSubmit={saveDetails} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="pkg-name">Package Name *</Label>
                <Input
                  id="pkg-name"
                  value={values.name}
                  onChange={(e) => setValues({ ...values, name: e.target.value })}
                  maxLength={PACKAGE_NAME_MAX}
                  placeholder="Gold"
                  required
                  autoFocus={!pkg}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Your own wording: Gold, Headline Sponsor, Media Partner Package.
                </p>
              </div>
              <div>
                <Label htmlFor="pkg-description">Description</Label>
                <Textarea
                  id="pkg-description"
                  value={values.description}
                  onChange={(e) => setValues({ ...values, description: e.target.value })}
                  rows={3}
                  maxLength={PACKAGE_DESCRIPTION_MAX}
                  placeholder="What this package offers a partner."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <div>
                  <Label htmlFor="pkg-value">Suggested Value</Label>
                  <Input
                    id="pkg-value"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={values.value_amount}
                    onChange={(e) => setValues({ ...values, value_amount: e.target.value })}
                    placeholder="50000"
                  />
                </div>
                <div>
                  <Label htmlFor="pkg-currency">Currency</Label>
                  <Input
                    id="pkg-currency"
                    value={values.value_currency}
                    onChange={(e) =>
                      setValues({ ...values, value_currency: e.target.value.toUpperCase() })
                    }
                    maxLength={3}
                    placeholder="GHS"
                    className="uppercase"
                  />
                </div>
              </div>
              <p className="-mt-2 text-xs text-gray-500">
                Optional. Packages are private to your team, but the value a partner ends up with is
                shown to them in their invitation. Rally does not invoice or take payment.
              </p>

              {detailsError && (
                <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
                  {detailsError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {!pkg && (
                  <Button type="button" variant="secondary" onClick={requestClose} disabled={savingDetails}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={savingDetails || (pkg !== null && !dirty)}>
                  {savingDetails ? 'Saving…' : pkg ? 'Save details' : 'Create package'}
                </Button>
              </div>
            </form>
          ) : (
            pkg && (
              <dl className="divide-y divide-gray-100 rounded-md border border-gray-200">
                <ReadOnlyRow label="Name">{pkg.name}</ReadOnlyRow>
                <ReadOnlyRow label="Description">
                  {pkg.description ? (
                    <span className="whitespace-pre-wrap">{pkg.description}</span>
                  ) : (
                    <span className="text-gray-400">None</span>
                  )}
                </ReadOnlyRow>
                <ReadOnlyRow label="Suggested value">
                  {money ?? <span className="text-gray-400">Not set</span>}
                </ReadOnlyRow>
              </dl>
            )
          )}

          {/* ---- Deliverables ----------------------------------------------- */}
          {pkg && (
            <section aria-labelledby="pkg-deliverables" className="space-y-3 border-t border-gray-200 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="pkg-deliverables" className="text-sm font-semibold text-gray-900">
                    Deliverables
                  </h3>
                  <p className="mt-0.5 text-sm text-gray-500">
                    What your organization provides with this package.
                    {editable && ' Each change saves as you make it.'}
                  </p>
                </div>
                {editable && (
                  <Button variant="secondary" onClick={() => setAdding(true)} className="shrink-0">
                    <Plus className="h-4 w-4" />
                    Add Deliverable
                  </Button>
                )}
              </div>

              {itemError && (
                <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
                  {itemError}
                </div>
              )}

              {loadError ? (
                <div className="rounded-md border border-error-200 bg-error-50 px-3 py-3 text-sm text-error-700" role="alert">
                  <p>{loadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadDeliverables()}
                    className="mt-1 font-medium underline"
                  >
                    Try again
                  </button>
                </div>
              ) : deliverables === null ? (
                <div className="flex justify-center py-6" aria-label="Loading deliverables">
                  <Spinner />
                </div>
              ) : deliverables.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center">
                  <p className="text-sm text-gray-500">No deliverables in this package yet.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Logo placement · Social promotion · Exhibition booth · VIP passes
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                  {deliverables.map((item, index) => {
                    const due = formatDueDate(item.due_date)
                    const meta = [
                      item.category || null,
                      item.quantity !== null ? 'Qty ' + item.quantity : null,
                      due ? 'Due ' + due : null,
                    ].filter(Boolean)
                    return (
                      <li key={item.id} className="flex items-start gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium text-gray-900">{item.title}</p>
                          {item.description && (
                            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-600">
                              {item.description}
                            </p>
                          )}
                          {meta.length > 0 && (
                            <p className="mt-0.5 text-xs text-gray-500">{meta.join(' · ')}</p>
                          )}
                        </div>
                        {editable && (
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
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditing(item)}
                              aria-label={'Edit ' + item.title}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setConfirm({ removeItem: item })}
                              aria-label={'Remove ' + item.title}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {/* ---- Lifecycle -------------------------------------------------- */}
          {pkg && editable && (
            <section aria-label="Package status" className="space-y-3 border-t border-gray-200 pt-5">
              {lifecycleError && (
                <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
                  {lifecycleError}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {pkg.archived_at ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setArchived(false)}>
                    <RotateCcw className="h-4 w-4" />
                    Restore package
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setArchived(true)}>
                    <Archive className="h-4 w-4" />
                    Archive package
                  </Button>
                )}
                {packageCanBeDeleted(pkg) && (
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirm('delete')}>
                    <Trash2 className="h-4 w-4" />
                    Delete package
                  </Button>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {packageCanBeDeleted(pkg)
                  ? 'No partner was created from this package, so it can be deleted outright. Archiving keeps it for later.'
                  : packageUsageLabel(pkg.partnership_count) +
                    ', so it can be archived but not deleted. Archiving never changes those partners.'}
              </p>
            </section>
          )}
        </div>
      </SheetDialog>

      {adding && pkg && deliverables && (
        <PartnerObligationDialog
          title="Add Deliverable"
          subtitle={pkg.name}
          direction="organizer_to_partner"
          initial={EMPTY_OBLIGATION_VALUES}
          submitLabel="Add"
          onClose={() => setAdding(false)}
          onSubmit={async (next) => {
            const { error } = await createPackageDeliverable(
              pkg,
              deliverableInputFrom(next),
              nextDisplayOrder(deliverables)
            )
            if (error) return error
            setAdding(false)
            setItemError(null)
            await loadDeliverables()
            onChanged()
            return null
          }}
        />
      )}

      {editing && (
        <PartnerObligationDialog
          title="Edit Deliverable"
          subtitle={pkg?.name}
          direction="organizer_to_partner"
          initial={obligationValuesFrom(editing)}
          submitLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={async (next) => {
            const { error } = await updatePackageDeliverable(editing.id, deliverableInputFrom(next))
            if (error) return error
            setEditing(null)
            setItemError(null)
            await loadDeliverables()
            return null
          }}
        />
      )}

      {confirm === 'discard' && (
        <ConfirmDialog
          busy={false}
          title="Discard your changes?"
          body="The package details you edited have not been saved."
          action="Discard"
          onConfirm={() => {
            setConfirm(null)
            onClose()
          }}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === 'delete' && pkg && (
        <ConfirmDialog
          busy={busy}
          title={'Delete "' + pkg.name + '"?'}
          body={
            'The package and ' +
            (deliverables?.length === 1
              ? 'its deliverable are'
              : 'its ' + (deliverables?.length ?? 0) + ' deliverables are') +
            ' removed. No partner uses it. This cannot be undone.'
          }
          action="Delete package"
          onConfirm={() => void remove()}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm && typeof confirm === 'object' && (
        <ConfirmDialog
          busy={busy}
          title={'Remove "' + confirm.removeItem.title + '"?'}
          body="It is removed from this package only. Partners already created from the package keep their own copy."
          action="Remove"
          onConfirm={() => void removeItem(confirm.removeItem)}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-gray-900">{children}</dd>
    </div>
  )
}
