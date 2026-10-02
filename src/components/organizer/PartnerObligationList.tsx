import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import {
  OBLIGATION_STATUSES,
  OBLIGATION_STATUS_LABELS,
  createObligation,
  deleteObligation,
  updateObligation,
  type Evidence,
  type Obligation,
  type ObligationDirection,
  type ObligationStatus,
  type Partnership,
} from '@/lib/partnerships'
import { ObligationStatusBadge, formatDueDate, isOverdue } from './PartnerCommon'
import { AddEvidenceDialog, EvidenceItems } from './PartnerEvidence'
import {
  EMPTY_OBLIGATION_VALUES,
  PartnerObligationDialog,
  obligationInputFrom,
  obligationValuesFrom,
} from './PartnerObligationDialog'
import { ConfirmDialog } from './SheetDialog'

// One component for both directions. `event_partnership_obligations` is one
// table for both too, for the same reason: the shape and the lifecycle are
// identical and only the predicate "who may move it" differs. Two components
// would be two things to keep in step.
//
// Status goes through set_partnership_obligation_status, never a direct UPDATE,
// so completed_at and completed_by are never in a payload this app sends. The
// trigger observes them from server time and auth.uid().

const COPY: Record<
  ObligationDirection,
  { heading: string; support: string; add: string; empty: string; singular: string }
> = {
  organizer_to_partner: {
    heading: 'Deliverables',
    support: 'What your organization has committed to provide.',
    add: 'Add Deliverable',
    empty: 'Nothing has been promised to this partner yet.',
    singular: 'Deliverable',
  },
  partner_to_organizer: {
    heading: 'Requirements',
    support: 'What this partner needs to provide.',
    add: 'Add Requirement',
    empty: 'Nothing has been requested from this partner yet.',
    singular: 'Requirement',
  },
}

export function PartnerObligationList({
  partnership,
  direction,
  obligations,
  evidenceByObligation,
  editable,
  currentUserId,
  onStatus,
  onReorder,
  onReload,
}: {
  partnership: Partnership
  direction: ObligationDirection
  obligations: Obligation[]
  evidenceByObligation: Map<string, Evidence[]>
  editable: boolean
  currentUserId: string | null
  /** Parent applies the change optimistically and rolls back on failure. */
  onStatus: (obligation: Obligation, next: ObligationStatus) => Promise<void>
  onReorder: (orderedIds: string[]) => Promise<void>
  onReload: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Obligation | null>(null)
  const [evidenceFor, setEvidenceFor] = useState<Obligation | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Obligation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const copy = COPY[direction]

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= obligations.length) return
    const next = obligations.map((o) => o.id)
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    await onReorder(next)
  }

  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    const { error: deleteError } = await deleteObligation(confirmDelete.id)
    setDeleting(false)
    setConfirmDelete(null)
    if (deleteError) {
      setError(deleteError)
      return
    }
    setError(null)
    await onReload()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{copy.heading}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{copy.support}</p>
        </div>
        {editable && (
          <Button variant="secondary" onClick={() => setAdding(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            {copy.add}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {error}
        </div>
      )}

      {obligations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center">
          <p className="text-sm text-gray-500">{copy.empty}</p>
          {editable && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)} className="mt-3">
              <Plus className="h-4 w-4" />
              {copy.add}
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {obligations.map((obligation, index) => {
            const evidence = evidenceByObligation.get(obligation.id) ?? []
            const due = formatDueDate(obligation.due_date)
            const overdue = isOverdue(obligation.due_date, obligation.status)
            const completedOn = obligation.completed_at
              ? new Date(obligation.completed_at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : null

            return (
              <li
                key={obligation.id}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-900">{obligation.title}</h4>
                      <ObligationStatusBadge status={obligation.status} />
                      {evidence.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Paperclip className="h-3 w-3" aria-hidden="true" />
                          {evidence.length}
                        </span>
                      )}
                    </div>

                    {obligation.description && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
                        {obligation.description}
                      </p>
                    )}

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      {obligation.category && <span>{obligation.category}</span>}
                      {obligation.quantity !== null && <span>Qty {obligation.quantity}</span>}
                      {due && (
                        <span
                          className={
                            overdue ? 'inline-flex items-center gap-1 font-medium text-error-600' : ''
                          }
                        >
                          {overdue && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                          {overdue ? 'Overdue — due ' + due : 'Due ' + due}
                        </span>
                      )}
                      {completedOn && (
                        <span className="text-accent-700">
                          Completed {completedOn}
                          {obligation.completed_by && obligation.completed_by === currentUserId
                            ? ' by you'
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {editable && (
                    <div className="flex shrink-0 items-center gap-1">
                      {obligations.length > 1 && (
                        <div className="mr-1 hidden flex-col sm:flex">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => void move(index, -1)}
                            aria-label={'Move ' + obligation.title + ' up'}
                            className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === obligations.length - 1}
                            onClick={() => void move(index, 1)}
                            aria-label={'Move ' + obligation.title + ' down'}
                            className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing(obligation)}
                        aria-label={'Edit ' + obligation.title}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDelete(obligation)}
                        aria-label={'Remove ' + obligation.title}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {(evidence.length > 0 || editable) && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <EvidenceItems
                      items={evidence}
                      editable={editable}
                      onRemoved={() => void onReload()}
                    />
                    {editable && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select
                          value={obligation.status}
                          onChange={(e) =>
                            void onStatus(obligation, e.target.value as ObligationStatus)
                          }
                          aria-label={'Status of ' + obligation.title}
                          className="h-8 w-36 py-0 text-xs"
                        >
                          {OBLIGATION_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {OBLIGATION_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEvidenceFor(obligation)}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          Add evidence
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {adding && (
        <PartnerObligationDialog
          title={copy.add}
          subtitle={partnership.company_name}
          direction={direction}
          initial={EMPTY_OBLIGATION_VALUES}
          submitLabel="Add"
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const { error: createError } = await createObligation(
              partnership.id,
              partnership.event_id,
              obligationInputFrom(values, direction),
              obligations.length
            )
            if (createError) return createError
            setAdding(false)
            await onReload()
            return null
          }}
        />
      )}

      {editing && (
        <PartnerObligationDialog
          title={'Edit ' + copy.singular}
          subtitle={partnership.company_name}
          direction={direction}
          initial={obligationValuesFrom(editing)}
          submitLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            const input = obligationInputFrom(values, direction)
            const { error: saveError } = await updateObligation(editing.id, {
              title: input.title,
              description: input.description,
              category: input.category,
              quantity: input.quantity,
              due_date: input.due_date,
            })
            if (saveError) return saveError
            setEditing(null)
            await onReload()
            return null
          }}
        />
      )}

      {evidenceFor && (
        <AddEvidenceDialog
          obligation={evidenceFor}
          onClose={() => setEvidenceFor(null)}
          onSaved={async () => {
            setEvidenceFor(null)
            await onReload()
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          busy={deleting}
          title={'Remove "' + confirmDelete.title + '"?'}
          body="Its evidence is removed with it. This cannot be undone."
          action={'Remove ' + copy.singular}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
