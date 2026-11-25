import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Layers, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  listEventPackages,
  reorderPackages,
  type PartnershipPackage,
} from '@/lib/partnershipPackages'
import {
  deliverableCountLabel,
  movedIds,
  nextDisplayOrder,
  packageUsageLabel,
  splitPackages,
} from '@/lib/packageForm'
import { formatMoney } from './PartnerCommon'
import { MoveButton } from './MoveButton'
import { PackageEditorDialog } from './PackageEditorDialog'

// ---------------------------------------------------------------------------
// An event's partnership packages: Gold, Silver, Bronze or whatever the
// organizer calls them, each with a suggested value and the deliverables it
// includes.
//
// Packages belong to ONE event. This list asks get_event_partnership_packages
// for this event only, and the schema pins every package and deliverable to
// its event, so another event's packages cannot appear here. Like the rest of
// the partners workspace it is organizer-only: sponsors and attendees have no
// read path to these tables at all.
//
// Archived packages are kept (a partner may have been created from one) and
// listed separately, collapsed, so the working set stays short.
// ---------------------------------------------------------------------------

type EventLike = { id: string; name: string }

type Editor = { pkg: PartnershipPackage | null } | null

export function EventPackagesPanel({ event, editable }: { event: EventLike; editable: boolean }) {
  const [packages, setPackages] = useState<PartnershipPackage[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      setError(null)
      const { data, error: loadError } = await listEventPackages(event.id)
      if (loadError) {
        // A background refresh that fails keeps what is on screen rather than
        // blanking the list behind an open sheet.
        if (!quiet) {
          setError(loadError)
          setPackages(null)
        }
      } else {
        setPackages(data)
      }
      setLoading(false)
    },
    [event.id]
  )

  useEffect(() => {
    void load()
  }, [load])

  const { active, archived } = useMemo(() => splitPackages(packages ?? []), [packages])

  // One move at a time. A second tap while the first is saving is ignored
  // rather than queued: if the first save then failed, restoring "the order
  // before" would silently undo the second move too.
  const moving = useRef(false)
  const [announcement, setAnnouncement] = useState('')

  async function move(index: number, delta: -1 | 1) {
    if (!packages || moving.current) return
    // Only ACTIVE packages are moved. movedIds refuses a move off either end
    // (the first item up, the last item down) by returning null.
    const ids = movedIds(
      active.map((p) => p.id),
      index,
      delta
    )
    if (!ids) return
    // Archived packages keep their place after the active ones, so a later
    // restore lands at the end rather than somewhere surprising, and an
    // archived package is never shuffled in among the active order.
    const ordered = [...ids, ...archived.map((p) => p.id)]
    const before = packages
    const byId = new Map(packages.map((p) => [p.id, p]))
    const name = active[index].name
    moving.current = true
    setPackages(ordered.map((id, i) => ({ ...(byId.get(id) as PartnershipPackage), display_order: i })))
    let reorderError: string | null
    try {
      reorderError = (await reorderPackages(event.id, ordered)).error
    } catch {
      reorderError = 'Unable to save the new order.'
    } finally {
      moving.current = false
    }
    if (reorderError) {
      setPackages(before)
      setOrderError(reorderError)
      setAnnouncement(name + ' was not moved.')
      return
    }
    setOrderError(null)
    setAnnouncement(name + ' moved to position ' + (index + delta + 1) + ' of ' + ids.length + '.')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h3 className="text-base font-semibold text-gray-900">Partnership packages</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Reusable packages for this event, such as Gold or Silver. A partner gets its own copy of a
            package's deliverables, so changing a package never changes an agreement already made.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setEditor({ pkg: null })} className="shrink-0">
            <Plus className="h-4 w-4" />
            New Package
          </Button>
        )}
      </div>

      {orderError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {orderError}
        </div>
      )}

      <p className="sr-only" aria-live="polite" data-testid="package-order-status">
        {announcement}
      </p>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && <PackagesSkeleton />}

      {!loading && !error && packages !== null && packages.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Layers className="h-10 w-10" />}
              title="No packages yet"
              description="Set up packages such as Gold, Silver or Bronze, each with a suggested value and the deliverables it includes."
              action={
                editable ? (
                  <Button onClick={() => setEditor({ pkg: null })}>New Package</Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      {!loading && !error && active.length > 0 && (
        <PackageList
          label="Packages"
          packages={active}
          reorderable={editable && active.length > 1}
          onOpen={(pkg) => setEditor({ pkg })}
          onMove={(index, delta) => void move(index, delta)}
        />
      )}

      {!loading && !error && packages !== null && packages.length > 0 && active.length === 0 && (
        <p className="text-sm text-gray-500">Every package of this event is archived.</p>
      )}

      {!loading && !error && archived.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            {showArchived ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
            Archived packages ({archived.length})
          </button>
          {showArchived && (
            <PackageList
              label="Archived packages"
              packages={archived}
              reorderable={false}
              onOpen={(pkg) => setEditor({ pkg })}
              onMove={() => undefined}
            />
          )}
        </div>
      )}

      {editor && (
        <PackageEditorDialog
          event={event}
          initial={editor.pkg}
          nextOrder={nextDisplayOrder(packages ?? [])}
          editable={editable}
          onClose={() => setEditor(null)}
          onChanged={() => void load(true)}
        />
      )}
    </div>
  )
}

function PackageList({
  label,
  packages,
  reorderable,
  onOpen,
  onMove,
}: {
  label: string
  packages: PartnershipPackage[]
  reorderable: boolean
  onOpen: (pkg: PartnershipPackage) => void
  onMove: (index: number, delta: -1 | 1) => void
}) {
  return (
    <ul
      aria-label={label}
      className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white"
    >
      {packages.map((pkg, index) => {
        const money = formatMoney(pkg.value_amount, pkg.value_currency)
        return (
          <li key={pkg.id} className="flex items-stretch">
            {reorderable && (
              // Shown at every width: on a phone these are the only way to
              // reorder. Each button is a 44px square, stacked, so the column
              // costs 44px of row width and the row stays one tap target wide.
              <div className="flex shrink-0 flex-col justify-center border-r border-gray-100">
                <MoveButton
                  label={'Move ' + pkg.name + ' up'}
                  atEdge={index === 0}
                  onMove={() => onMove(index, -1)}
                >
                  <ChevronUp className="h-5 w-5" aria-hidden="true" />
                </MoveButton>
                <MoveButton
                  label={'Move ' + pkg.name + ' down'}
                  atEdge={index === packages.length - 1}
                  onMove={() => onMove(index, 1)}
                >
                  <ChevronDown className="h-5 w-5" aria-hidden="true" />
                </MoveButton>
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpen(pkg)}
              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-primary-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                    <span className="break-words">{pkg.name}</span>
                    {pkg.archived_at && <Badge variant="gray">Archived</Badge>}
                  </p>
                  {money ? (
                    <p className="text-sm font-medium tabular-nums text-gray-900">{money}</p>
                  ) : (
                    <p className="text-sm text-gray-400">No suggested value</p>
                  )}
                </div>
                {pkg.description && (
                  <p className="mt-0.5 line-clamp-2 break-words text-sm text-gray-500">
                    {pkg.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {deliverableCountLabel(pkg.deliverable_count)} ·{' '}
                  {packageUsageLabel(pkg.partnership_count)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PackagesSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
          <div className="h-4 w-1/4 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}
