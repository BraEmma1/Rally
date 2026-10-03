import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  deletePackage,
  listEventPartnershipPackages,
  reorderPackages,
  setPackageArchived,
  type PartnershipPackage,
} from '@/lib/partnerships'
import { ArchivedNotice, formatMoney } from './PartnerCommon'
import { PackageDialog } from './PackageDialog'
import { ConfirmDialog } from './SheetDialog'

// ---------------------------------------------------------------------------
// Event -> Partners -> Packages
//
// Reusable sponsorship tiers for ONE event, each with the deliverables that
// come with it. They are an accelerator, never a requirement: a partnership
// can still be built by hand, and one created from a package stops being
// connected to it the moment it is created.
// ---------------------------------------------------------------------------

type EventLike = {
  id: string
  name: string
  archived_at: string | null
}

export function PackagesPanel({ event, manages }: { event: EventLike; manages: boolean }) {
  const [packages, setPackages] = useState<PartnershipPackage[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PartnershipPackage | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PartnershipPackage | null>(null)
  const [busy, setBusy] = useState(false)

  const archived = event.archived_at !== null
  const editable = manages && !archived

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await listEventPartnershipPackages(event.id)
    if (loadError) {
      setError(loadError)
      setPackages(null)
    } else {
      setPackages(data)
    }
    setLoading(false)
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  async function move(index: number, delta: -1 | 1) {
    if (!packages) return
    const target = index + delta
    if (target < 0 || target >= packages.length) return
    const next = [...packages]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setPackages(next)
    setActionError(null)
    const { error: reorderError } = await reorderPackages(
      event.id,
      next.map((p) => p.id)
    )
    if (reorderError) {
      setActionError(reorderError)
      await load()
    }
  }

  async function toggleArchive(pkg: PartnershipPackage) {
    setBusy(true)
    setActionError(null)
    const { error: archiveError } = await setPackageArchived(pkg.id, pkg.archived_at === null)
    setBusy(false)
    if (archiveError) {
      setActionError(archiveError)
      return
    }
    await load()
  }

  async function remove() {
    if (!confirmDelete) return
    setBusy(true)
    setActionError(null)
    const { error: deleteError } = await deletePackage(confirmDelete.id)
    setBusy(false)
    setConfirmDelete(null)
    if (deleteError) {
      setActionError(deleteError)
      return
    }
    await load()
  }

  const nextOrder = packages?.length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">Sponsorship packages</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Reusable tiers for this event. Choosing one when you add a partner copies its
            deliverables across.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            Create Package
          </Button>
        )}
      </div>

      {archived && <ArchivedNotice />}

      {actionError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="h-4 w-1/4 animate-pulse rounded bg-gray-100" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && packages !== null && packages.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Layers className="h-10 w-10" />}
              title="Sponsorship packages"
              description="Create reusable sponsorship packages with default deliverables for this event. You can still add a partner without one and define everything by hand."
              action={editable ? <Button onClick={() => setCreating(true)}>Create package</Button> : undefined}
            />
          </CardContent>
        </Card>
      )}

      {!loading && !error && packages !== null && packages.length > 0 && (
        <ul className="space-y-2">
          {packages.map((pkg, index) => {
            const money = formatMoney(pkg.value_amount, pkg.value_currency)
            const isArchived = pkg.archived_at !== null
            const used = pkg.partnership_count > 0
            return (
              <li
                key={pkg.id}
                className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 lg:flex-row lg:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-gray-900">{pkg.name}</h4>
                    {isArchived && <Badge variant="gray">Archived</Badge>}
                  </div>
                  {pkg.description && (
                    <p className="mt-0.5 text-sm text-gray-600">{pkg.description}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {pkg.deliverable_count === 0
                      ? 'No default deliverables'
                      : pkg.deliverable_count +
                        (pkg.deliverable_count === 1
                          ? ' default deliverable'
                          : ' default deliverables')}
                    {used &&
                      ' · used by ' +
                        pkg.partnership_count +
                        (pkg.partnership_count === 1 ? ' partner' : ' partners')}
                  </p>
                </div>

                <div className="shrink-0 lg:w-32 lg:text-right">
                  {money ? (
                    <p className="text-sm font-medium tabular-nums text-gray-900">{money}</p>
                  ) : (
                    <p className="text-sm text-gray-400">No value</p>
                  )}
                </div>

                {editable && (
                  <div className="flex shrink-0 items-center gap-1">
                    {packages.length > 1 && (
                      <div className="mr-1 hidden flex-col sm:flex">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => void move(index, -1)}
                          aria-label={'Move ' + pkg.name + ' up'}
                          className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={index === packages.length - 1}
                          onClick={() => void move(index, 1)}
                          aria-label={'Move ' + pkg.name + ' down'}
                          className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(pkg)}
                      aria-label={'Edit ' + pkg.name}
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="hidden md:inline">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void toggleArchive(pkg)}
                      aria-label={(isArchived ? 'Restore ' : 'Archive ') + pkg.name}
                    >
                      {isArchived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                      <span className="hidden md:inline">{isArchived ? 'Restore' : 'Archive'}</span>
                    </Button>
                    {/* Delete is only offered for a package nobody has used.
                        The database refuses the rest, so the button would be
                        a dead end. */}
                    {!used && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmDelete(pkg)}
                        aria-label={'Delete ' + pkg.name}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden md:inline">Delete</span>
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {(creating || editing) && (
        <PackageDialog
          event={event}
          existing={editing}
          nextOrder={nextOrder}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={load}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          busy={busy}
          title={'Delete the ' + confirmDelete.name + ' package?'}
          body="Its default deliverables go with it. No partnership has used this package, so nothing else is affected."
          action="Delete Package"
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
