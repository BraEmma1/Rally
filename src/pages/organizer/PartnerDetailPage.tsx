import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Linkedin, Mail, Pencil, Send } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { canManageTeam } from '@/lib/organizer'
import { getEvent } from '@/lib/events'
import { cn, displayUrl } from '@/lib/utils'
import {
  STATUS_LABELS,
  allowedStatusTransitions,
  deletePartnership,
  getEventPartnership,
  currentInvitation,
  invitationDisplayStatus,
  listPartnershipEvidence,
  listPartnershipInvitations,
  listPartnershipObligations,
  listPartnershipRoles,
  reorderObligations,
  setObligationStatus,
  setPartnershipStatus,
  type Evidence,
  type Obligation,
  type ObligationStatus,
  type Partnership,
  type PartnershipInvitation,
  type PartnershipRole,
  type PartnershipStatus,
} from '@/lib/partnerships'
import type { OrganizerEvent } from '@/lib/supabase'
import {
  ArchivedNotice,
  ObligationStatusBadge,
  PartnerLogo,
  PartnerStatusBadge,
  ProgressMeter,
  formatMoney,
  rolesLabel,
} from '@/components/organizer/PartnerCommon'
import { EditPartnerDialog } from '@/components/organizer/EditPartnerDialog'
import {
  PartnerInvitationCard,
  SendInvitationDialog,
} from '@/components/organizer/PartnerInvitation'
import { PartnerObligationList } from '@/components/organizer/PartnerObligationList'
import { EvidenceItems } from '@/components/organizer/PartnerEvidence'
import { ConfirmDialog } from '@/components/organizer/SheetDialog'

// ---------------------------------------------------------------------------
// One partner's private workspace: who they are, what was agreed, and how much
// of it is done.
//
// Authorization is not implemented in React. The partnership is fetched with
// BOTH its id and the event id from the URL, and RLS authorizes the row on top
// of that:
//
//   * RLS alone is not enough -- an organizer who manages two events may
//     legitimately read either, so /organizer/events/<A>/partners/<B's partner>
//     would render B's partner inside A's shell. That is the exhibitor-detail
//     bug; the event filter in getEventPartnership is what prevents it.
//   * The event filter alone is not enough either -- it is a URL, and anyone
//     can type one. can_manage_event decides, in the database.
//
// Knowing a uuid therefore grants nothing.
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'deliverables' | 'requirements' | 'evidence'

export default function PartnerDetailPage() {
  const { id: eventId, partnershipId } = useParams<{ id: string; partnershipId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { role, loading: orgLoading } = useOrganizer()

  const [event, setEvent] = useState<OrganizerEvent | null>(null)
  const [partnership, setPartnership] = useState<Partnership | null>(null)
  const [roles, setRoles] = useState<PartnershipRole[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The same banner carries two different kinds of news -- "invitation sent"
  // and "the roles did not save" -- and they must not look alike.
  const [noticeTone, setNoticeTone] = useState<'success' | 'warning'>('success')

  // Invitation state is separate on purpose: Deliverables, Requirements and
  // Evidence must not wait on it, and a failure to read the invitation must
  // not take the whole page down.
  const [invitations, setInvitations] = useState<PartnershipInvitation[]>([])
  const [invitationsLoading, setInvitationsLoading] = useState(true)
  const [invitationsError, setInvitationsError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | PartnershipStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const partnersPath = '/organizer/events/' + (eventId ?? '') + '?tab=partners'

  const load = useCallback(async () => {
    if (!eventId || !partnershipId) return
    setLoading(true)
    setError(null)
    setNotFound(false)

    const [eventResult, partnershipResult] = await Promise.all([
      getEvent(eventId),
      getEventPartnership(eventId, partnershipId),
    ])

    if (eventResult.error || !eventResult.data) {
      setError(eventResult.error ?? 'That event could not be found.')
      setLoading(false)
      return
    }
    setEvent(eventResult.data)

    if (partnershipResult.error) {
      setError(partnershipResult.error)
      setLoading(false)
      return
    }
    // No row means either no such partnership, or one that belongs to another
    // event, or one this user may not read. The UI does not distinguish: all
    // three are "not here", and saying which would confirm it exists.
    if (!partnershipResult.data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setPartnership(partnershipResult.data)

    const [rolesResult, obligationsResult, evidenceResult] = await Promise.all([
      listPartnershipRoles(partnershipId),
      listPartnershipObligations(partnershipId),
      listPartnershipEvidence(partnershipId),
    ])
    setRoles(rolesResult.data)
    setObligations(obligationsResult.data)
    setEvidence(evidenceResult.data)
    setError(rolesResult.error ?? obligationsResult.error ?? evidenceResult.error)
    setLoading(false)
  }, [eventId, partnershipId])

  useEffect(() => {
    void load()
  }, [load])

  /** Its own fetch, so the rest of the page renders while this is in flight. */
  const loadInvitations = useCallback(async () => {
    if (!partnershipId) return
    setInvitationsLoading(true)
    const { data, error: invitationError } = await listPartnershipInvitations(partnershipId)
    setInvitations(data)
    setInvitationsError(invitationError)
    setInvitationsLoading(false)
  }, [partnershipId])

  useEffect(() => {
    void loadInvitations()
  }, [loadInvitations])

  /**
   * After any invitation operation, refetch BOTH the invitation and the
   * partnership: sending moves the partnership to `invited` and revoking moves
   * it back to `draft`, and neither transition is this page's to assume. If
   * another session changed things first, this is what surfaces their state
   * rather than ours.
   */
  const refreshAfterInvitation = useCallback(
    async (message?: string) => {
      if (!eventId || !partnershipId) return
      const [partnershipResult] = await Promise.all([
        getEventPartnership(eventId, partnershipId),
        loadInvitations(),
      ])
      if (partnershipResult.data) setPartnership(partnershipResult.data)
      setNoticeTone('success')
      setNotice(message ?? null)
    },
    [eventId, partnershipId, loadInvitations]
  )

  /** Reload only the partnership's contents, keeping the current tab. */
  const reloadContents = useCallback(async () => {
    if (!partnershipId || !eventId) return
    const [partnershipResult, obligationsResult, evidenceResult] = await Promise.all([
      getEventPartnership(eventId, partnershipId),
      listPartnershipObligations(partnershipId),
      listPartnershipEvidence(partnershipId),
    ])
    if (partnershipResult.data) setPartnership(partnershipResult.data)
    setObligations(obligationsResult.data)
    setEvidence(evidenceResult.data)
  }, [eventId, partnershipId])

  const archived = event?.archived_at !== null && event?.archived_at !== undefined
  const editable = canManageTeam(role) && !archived

  const owed = useMemo(
    () => obligations.filter((o) => o.direction === 'organizer_to_partner'),
    [obligations]
  )
  const required = useMemo(
    () => obligations.filter((o) => o.direction === 'partner_to_organizer'),
    [obligations]
  )
  const evidenceByObligation = useMemo(() => {
    const map = new Map<string, Evidence[]>()
    for (const item of evidence) {
      const list = map.get(item.obligation_id)
      if (list) list.push(item)
      else map.set(item.obligation_id, [item])
    }
    return map
  }, [evidence])

  // Optimistic: one field, and the rollback is putting the old value back.
  async function handleStatus(obligation: Obligation, next: ObligationStatus) {
    if (next === obligation.status) return
    const previous = obligations
    setActionError(null)
    setObligations((rows) =>
      rows.map((row) => (row.id === obligation.id ? { ...row, status: next } : row))
    )
    const { error: statusError } = await setObligationStatus(obligation.id, next)
    if (statusError) {
      setObligations(previous)
      setActionError(statusError)
      return
    }
    // completed_at / completed_by are decided by the trigger, so the row is
    // read back rather than guessed at.
    await reloadContents()
  }

  async function handleReorder(orderedIds: string[]) {
    if (!partnershipId) return
    const previous = obligations
    setActionError(null)
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    setObligations((rows) =>
      [...rows].sort((a, b) => {
        const left = position.get(a.id)
        const right = position.get(b.id)
        if (left === undefined || right === undefined) return 0
        return left - right
      })
    )
    const { error: reorderError } = await reorderObligations(partnershipId, orderedIds)
    if (reorderError) {
      setObligations(previous)
      setActionError(reorderError)
    }
  }

  async function handleLifecycle(action: 'delete' | PartnershipStatus) {
    if (!partnership) return
    setBusy(true)
    setActionError(null)
    if (action === 'delete') {
      const { error: deleteError } = await deletePartnership(partnership.id)
      setBusy(false)
      setConfirm(null)
      if (deleteError) {
        setActionError(deleteError)
        return
      }
      navigate(partnersPath, { replace: true })
      return
    }
    const { error: statusError } = await setPartnershipStatus(partnership.id, action)
    setBusy(false)
    setConfirm(null)
    if (statusError) {
      setActionError(statusError)
      return
    }
    await load()
  }

  if (orgLoading || loading) return <LoadingState message="Loading partner…" />

  if (notFound) {
    return (
      <ErrorState
        message="That partner could not be found in this event."
        retryLabel="Back to Partners"
        onRetry={() => navigate(partnersPath, { replace: true })}
      />
    )
  }

  if (error && !partnership) {
    return <ErrorState message={error} onRetry={() => void load()} />
  }
  if (!partnership || !event) return null

  const money = formatMoney(partnership.value_amount, partnership.value_currency)
  const transitions = allowedStatusTransitions(partnership.status)

  // What the header may offer. Every one of these is also decided again in the
  // database -- invite_partnership_representative re-checks authority, the
  // archive freeze and the partnership status itself. This only avoids showing
  // a button whose sole outcome would be an error.
  const latestInvitation = currentInvitation(invitations)
  const latestDisplay = latestInvitation ? invitationDisplayStatus(latestInvitation) : null
  const hasRepresentative = Boolean(partnership.representative_email)
  const canSend =
    partnership.status === 'draft' && hasRepresentative && !invitationsLoading
  const needsRepresentative = partnership.status === 'draft' && !hasRepresentative
  const headerInvitationLabel =
    partnership.status === 'invited' && latestDisplay === 'pending'
      ? 'Invitation Pending'
      : partnership.status === 'invited' && latestDisplay === 'expired'
        ? 'Invitation Expired'
        : null

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'deliverables', label: 'Deliverables', count: owed.length },
    { key: 'requirements', label: 'Requirements', count: required.length },
    { key: 'evidence', label: 'Evidence', count: evidence.length },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={partnersPath}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Partners
        </Link>
        <p className="mt-1 truncate text-xs text-gray-400">{event.name}</p>
      </div>

      {/* Header. Once a partnership is live the relationship matters more than
          how it began, so the invitation shrinks to a status chip here and its
          management lives in Overview. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <PartnerLogo name={partnership.company_name} logoUrl={partnership.logo_url} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{partnership.company_name}</h1>
              <PartnerStatusBadge status={partnership.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
              {partnership.tier_label && (
                <span className="font-medium text-gray-700">{partnership.tier_label}</span>
              )}
              {roles.length > 0 && <span>{rolesLabel(roles)}</span>}
              {money && <span className="tabular-nums">{money}</span>}
            </div>
            {partnership.representative_email && (
              <a
                href={'mailto:' + partnership.representative_email}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary-700 hover:text-primary-800"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {partnership.representative_email}
              </a>
            )}
          </div>
        </div>

        {editable && (
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit Partner
              </Button>

              {/* Draft with a representative: the one deliberate outward act
                  on this page. It opens a confirmation rather than firing. */}
              {canSend && (
                <Button onClick={() => setSendOpen(true)}>
                  <Send className="h-4 w-4" />
                  Send Invitation
                </Button>
              )}

              {/* Draft without one: an enabled Send here would only fail in
                  the database, so the action points at the fix instead. */}
              {needsRepresentative && (
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Mail className="h-4 w-4" />
                  Add Representative Email
                </Button>
              )}

              {/* Sent already: a status, not a button. Resend and Revoke are
                  in the Invitation section below. */}
              {headerInvitationLabel && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-600"
                  role="status"
                >
                  <Mail className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  {headerInvitationLabel}
                </span>
              )}
            </div>

            {needsRepresentative && (
              <p className="text-xs text-gray-500 sm:text-right">
                Add a representative email before sending an invitation.
              </p>
            )}
          </div>
        )}
      </div>

      {archived && <ArchivedNotice />}

      {notice && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm',
            noticeTone === 'success'
              ? 'border-accent-200 bg-accent-50 text-accent-700'
              : 'border-warning-200 bg-warning-50 text-warning-700'
          )}
          role="status"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
          {actionError}
        </div>
      )}

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max gap-1 border-b border-gray-200 md:w-full">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 text-xs text-gray-400">{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Partnership</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="Tier" value={partnership.tier_label} />
                <DetailRow label="Roles" value={roles.length > 0 ? rolesLabel(roles) : null} />
                <DetailRow label="Status">
                  <div className="flex flex-wrap items-center gap-2">
                    <PartnerStatusBadge status={partnership.status} />
                    {partnership.acknowledged_at && (
                      <span className="text-xs text-gray-500">
                        Accepted{' '}
                        {new Date(partnership.acknowledged_at).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                  </div>
                </DetailRow>
                <DetailRow label="Commercial value" value={money} />
                <DetailRow label="Representative" value={partnership.representative_email} />
              </CardContent>
            </Card>

            {/* Renders only once an invitation exists. The partnership status
                above and the invitation status here are different fields and
                are shown as such: a partnership is Invited while its
                invitation is Pending. */}
            <PartnerInvitationCard
              partnership={partnership}
              roles={roles}
              eventName={event.name}
              invitations={invitations}
              loading={invitationsLoading}
              error={invitationsError}
              editable={editable}
              onChanged={refreshAfterInvitation}
              onEditPartner={() => setEditOpen(true)}
            />

            <Card>
              <CardHeader>
                <CardTitle>Company</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="Name" value={partnership.company_name} />
                <DetailRow label="Industry" value={partnership.industry} />
                {partnership.website && (
                  <DetailRow label="Website">
                    <a
                      href={partnership.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:text-primary-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      {displayUrl(partnership.website)}
                    </a>
                  </DetailRow>
                )}
                {partnership.linkedin && (
                  <DetailRow label="LinkedIn">
                    <a
                      href={partnership.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:text-primary-800"
                    >
                      <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />
                      {displayUrl(partnership.linkedin)}
                    </a>
                  </DetailRow>
                )}
                {partnership.description && (
                  <DetailRow label="About">
                    <p className="whitespace-pre-wrap text-sm text-gray-700">
                      {partnership.description}
                    </p>
                  </DetailRow>
                )}
              </CardContent>
            </Card>

            {/* Organizer-only. Shown as what it is -- a private note -- and
                never as company information. Nothing routes internal_notes
                anywhere outside this page. */}
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent>
                {partnership.internal_notes ? (
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {partnership.internal_notes}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    Nothing recorded. Private to people who manage this event.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProgressMeter
                  label="Deliverables"
                  completed={owed.filter((o) => o.status === 'completed').length}
                  total={owed.length}
                />
                <ProgressMeter
                  label="Requirements"
                  completed={required.filter((o) => o.status === 'completed').length}
                  total={required.length}
                />
                <p className="text-xs text-gray-500">
                  Counts what is marked completed right now. Rally does not keep a history of
                  reopened items.
                </p>
              </CardContent>
            </Card>

            {editable && (transitions.length > 0 || partnership.status === 'draft') && (
              <Card>
                <CardHeader>
                  <CardTitle>Partnership status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {transitions.map((next) => (
                      <Button
                        key={next}
                        variant={next === 'cancelled' ? 'secondary' : 'primary'}
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirm(next)}
                      >
                        {next === 'cancelled'
                          ? 'Cancel Partnership'
                          : next === 'completed'
                            ? 'Mark Completed'
                            : next === 'active'
                              ? 'Reopen as Active'
                              : 'Restore to Draft'}
                      </Button>
                    ))}
                  </div>

                  {/* A draft may be discarded; anything past draft is a
                      commercial record and is cancelled instead. The database
                      refuses the other case, so the button is not offered. */}
                  {partnership.status === 'draft' ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirm('delete')}
                      >
                        Delete Partner
                      </Button>
                      <p className="text-xs text-gray-500">
                        This partner is still a draft, so it can be deleted outright.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">
                      Past draft, a partnership is a commercial record: it is cancelled rather than
                      deleted, and stays readable.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
        <PartnerObligationList
          partnership={partnership}
          direction="organizer_to_partner"
          obligations={owed}
          evidenceByObligation={evidenceByObligation}
          editable={editable}
          currentUserId={user?.id ?? null}
          onStatus={handleStatus}
          onReorder={handleReorder}
          onReload={reloadContents}
        />
      )}

      {tab === 'requirements' && (
        <PartnerObligationList
          partnership={partnership}
          direction="partner_to_organizer"
          obligations={required}
          evidenceByObligation={evidenceByObligation}
          editable={editable}
          currentUserId={user?.id ?? null}
          onStatus={handleStatus}
          onReorder={handleReorder}
          onReload={reloadContents}
        />
      )}

      {tab === 'evidence' && (
        <EvidenceTab
          obligations={obligations}
          evidenceByObligation={evidenceByObligation}
          editable={editable}
          onReload={reloadContents}
        />
      )}

      {editOpen && (
        <EditPartnerDialog
          partnership={partnership}
          roles={roles}
          onClose={() => setEditOpen(false)}
          onSaved={async (warning) => {
            setEditOpen(false)
            setNoticeTone('warning')
            setNotice(warning)
            await load()
            // The representative may have changed, which decides whether Send
            // Invitation is offered at all.
            await loadInvitations()
          }}
        />
      )}

      {sendOpen && partnership.representative_email && (
        <SendInvitationDialog
          partnership={partnership}
          roles={roles}
          eventName={event.name}
          email={partnership.representative_email}
          onClose={() => setSendOpen(false)}
          onSent={async (message) => {
            setSendOpen(false)
            await refreshAfterInvitation(message)
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          busy={busy}
          title={
            confirm === 'delete'
              ? 'Delete this draft partner?'
              : confirm === 'cancelled'
                ? 'Cancel this partnership?'
                : confirm === 'completed'
                  ? 'Mark this partnership completed?'
                  : confirm === 'active'
                    ? 'Reopen this partnership?'
                    : 'Restore this partnership to draft?'
          }
          body={
            confirm === 'delete'
              ? 'The company details, deliverables, requirements and evidence are all removed. This cannot be undone.'
              : confirm === 'cancelled'
                ? 'Everything recorded here is kept and stays readable. Any pending invitation is withdrawn.'
                : 'The status changes to ' + STATUS_LABELS[confirm] + '. Nothing recorded here is lost.'
          }
          action={confirm === 'delete' ? 'Delete Partner' : 'Confirm'}
          onConfirm={() => void handleLifecycle(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  children,
}: {
  label: string
  value?: string | null
  children?: React.ReactNode
}) {
  if (!children && !value) {
    return (
      <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 sm:pt-0.5">
          {label}
        </p>
        <p className="text-sm text-gray-400">Not recorded</p>
      </div>
    )
  }
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 sm:pt-0.5">{label}</p>
      <div className="min-w-0">
        {children ?? <p className="break-words text-sm text-gray-900">{value}</p>}
      </div>
    </div>
  )
}

/**
 * The aggregate view. Grouped by obligation, because the obligation is the
 * context that makes a file mean anything -- a backdrop photo proves "logo on
 * event backdrop" was done, and on its own it is just a photo. Not a file
 * manager.
 */
function EvidenceTab({
  obligations,
  evidenceByObligation,
  editable,
  onReload,
}: {
  obligations: Obligation[]
  evidenceByObligation: Map<string, Evidence[]>
  editable: boolean
  onReload: () => Promise<void>
}) {
  const withEvidence = obligations.filter(
    (o) => (evidenceByObligation.get(o.id) ?? []).length > 0
  )

  if (withEvidence.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-gray-900">No evidence yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Add files, links or notes from a deliverable or a requirement, and everything attached
              to this partnership collects here.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {withEvidence.map((obligation) => {
        const items = evidenceByObligation.get(obligation.id) ?? []
        return (
          <Card key={obligation.id}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Badge variant="gray">
                  {obligation.direction === 'organizer_to_partner' ? 'Deliverable' : 'Requirement'}
                </Badge>
                <CardTitle className="mt-1.5">{obligation.title}</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <ObligationStatusBadge status={obligation.status} />
                <span className="text-xs text-gray-500">
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <EvidenceItems
                items={items}
                editable={editable}
                onRemoved={() => void onReload()}
              />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
