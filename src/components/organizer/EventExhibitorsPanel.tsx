import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Search, Store, Trash2, Plus } from 'lucide-react'
import { initials } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/States'
import {
  deleteExhibitor,
  listEventExhibitors,
  reorderEventExhibitors,
  type EventExhibitor,
} from '@/lib/exhibitors'
import { AddExhibitorDialog } from './AddExhibitorDialog'
import { EditExhibitorDialog } from './EditExhibitorDialog'
import { ConfirmDialog } from './SheetDialog'

type EventLike = {
  id: string
  name: string
  archived_at: string | null
}

export function EventExhibitorsPanel({ event, manages }: { event: EventLike; manages: boolean }) {
  const [exhibitors, setExhibitors] = useState<EventExhibitor[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<EventExhibitor | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<EventExhibitor | null>(null)
  const [removing, setRemoving] = useState(false)
  const [busyMove, setBusyMove] = useState(false)

  const [search, setSearch] = useState('')

  const archived = event.archived_at !== null
  const editable = manages && !archived

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await listEventExhibitors(event.id)
    if (err) {
      setError(err)
      setExhibitors(null)
    } else {
      setExhibitors(data)
    }
    setLoading(false)
  }, [event.id])

  useEffect(() => {
    void load()
  }, [load])

  const needle = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!exhibitors) return []
    if (!needle) return exhibitors
    return exhibitors.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        e.industry.toLowerCase().includes(needle) ||
        e.booth.toLowerCase().includes(needle)
    )
  }, [exhibitors, needle])

  async function moveExhibitor(exhibitor: EventExhibitor, direction: -1 | 1) {
    if (!exhibitors || !editable || busyMove) return
    const idx = exhibitors.findIndex((e) => e.id === exhibitor.id)
    const swap = idx + direction
    if (idx < 0 || swap < 0 || swap >= exhibitors.length) return
    const next = [...exhibitors]
    const [moved] = next.splice(idx, 1)
    next.splice(swap, 0, moved)
    setExhibitors(next)
    setBusyMove(true)
    setActionError(null)
    const { error: err } = await reorderEventExhibitors(
      event.id,
      next.map((e) => e.id)
    )
    setBusyMove(false)
    if (err) {
      setActionError(err)
      void load()
    }
  }

  async function handleRemove() {
    if (!confirmRemove) return
    setRemoving(true)
    setActionError(null)
    const { error: err } = await deleteExhibitor(confirmRemove.id)
    setRemoving(false)
    if (err) {
      setActionError(err)
      setConfirmRemove(null)
      return
    }
    const removed = confirmRemove
    setConfirmRemove(null)
    setExhibitors((prev) => (prev ? prev.filter((e) => e.id !== removed.id) : prev))
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="h-12 w-12 shrink-0 animate-pulse rounded bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Exhibitors</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage the companies and organizations exhibiting at this event.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            Add Exhibitor
          </Button>
        )}
      </div>

      {archived && manages && (
        <Card className="border-warning-200 bg-warning-50">
          <CardContent>
            <p className="text-sm text-warning-700">
              This event is archived. Restore it before changing its exhibitors.
            </p>
          </CardContent>
        </Card>
      )}

      {actionError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </div>
      )}

      {exhibitors !== null && exhibitors.length > 4 && editable && (
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exhibitors…"
            className="pl-9"
          />
        </div>
      )}

      {exhibitors && exhibitors.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Store className="h-10 w-10" />}
              title="No exhibitors have been added yet."
              description="Add the companies and organizations attendees can discover at this event."
              action={
                editable ? (
                  <Button onClick={() => setAddOpen(true)}>+ Add First Exhibitor</Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((exhibitor, idx) => (
            <li
              key={exhibitor.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4"
            >
              <ExhibitorLogo name={exhibitor.name} logoUrl={exhibitor.logo_url} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-gray-900">{exhibitor.name}</h3>
                  {exhibitor.industry && <Badge variant="gray">{exhibitor.industry}</Badge>}
                </div>
                {exhibitor.booth && (
                  <p className="truncate text-xs text-gray-500">Booth: {exhibitor.booth}</p>
                )}
                <div className="mt-1 flex items-center gap-3">
                  {exhibitor.website && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      Website
                    </span>
                  )}
                  {exhibitor.linkedin && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      LinkedIn
                    </span>
                  )}
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  {exhibitors !== null && exhibitors.length > 1 && (
                    <div className="mr-1 hidden flex-col sm:flex">
                      <button
                        type="button"
                        disabled={idx === 0 || busyMove}
                        onClick={() => void moveExhibitor(exhibitor, -1)}
                        className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        aria-label={`Move ${exhibitor.name} up in the exhibitor order`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === exhibitors.length - 1 || busyMove}
                        onClick={() => void moveExhibitor(exhibitor, 1)}
                        className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        aria-label={`Move ${exhibitor.name} down in the exhibitor order`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(exhibitor)}
                    aria-label={`Edit ${exhibitor.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="hidden md:inline">Edit</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removing}
                    onClick={() => setConfirmRemove(exhibitor)}
                    aria-label={`Remove ${exhibitor.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden md:inline">Remove</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {addOpen && (
        <AddExhibitorDialog
          event={event}
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false)
            await load()
          }}
        />
      )}

      {editing && (
        <EditExhibitorDialog
          event={event}
          exhibitor={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          busy={removing}
          title="Remove this exhibitor from the event?"
          body="This removes the exhibitor from this event only."
          action="Remove Exhibitor"
          onConfirm={() => void handleRemove()}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}

export function ExhibitorLogo({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string
  logoUrl: string | null | undefined
  size?: 'md' | 'lg'
}) {
  const box = size === 'lg' ? 'h-14 w-14' : 'h-12 w-12'
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={box + ' shrink-0 rounded-lg border border-gray-200 bg-white object-contain'}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={
        box +
        ' flex shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-semibold text-primary-700'
      }
    >
      {initials(name)}
    </div>
  )
}
