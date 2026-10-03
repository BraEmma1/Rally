import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Building2,
  CircleDashed,
  ClipboardList,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Linkedin,
  ListChecks,
  Mail,
  MoreHorizontal,
  Paperclip,
  Pencil,
} from 'lucide-react'
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
  listPartnershipEvidence,
  listPartnershipObligations,
  listPartnershipRoles,
  reorderObligations,
  setObligationStatus,
  setPartnershipStatus,
  type Evidence,
  type Obligation,
  type ObligationStatus,
  type Partnership,
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
  safeWebUrl,
} from '@/components/organizer/PartnerCommon'
import { EditPartnerDialog } from '@/components/organizer/EditPartnerDialog'
import { PartnerObligationList } from '@/components/organizer/PartnerObligationList'
import { EvidenceItems } from '@/components/organizer/PartnerEvidence'
import { PartnershipDocumentsPanel } from '@/components/organizer/PartnershipDocumentsPanel'
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

type Tab = 'overview' | 'deliverables' | 'requirements' | 'documents' | 'evidence'

function PartnershipMetricCard({
  icon,
  iconClassName,
  value,
  suffix,
  label,
  hint,
  progress,
}: {
  icon: ReactNode
  iconClassName: string
  value: number
  suffix?: string
  label: string
  hint: string
  progress: number
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            iconClassName
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-7 tabular-nums text-gray-900">
            {value.toLocaleString()}
            {suffix && <span className="ml-1 text-sm font-semibold text-gray-500">{suffix}</span>}
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-700">{label}</p>
          <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>
        </div>
      </div>
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-valuenow={Math.min(100, Math.round(progress * 100))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label + ': ' + Math.round(progress * 100) + '% complete'}
      >
        <div
          className="h-full rounded-full bg-success-500 transition-[width] duration-500"
          style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
        />
      </div>
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

  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
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
  const canDeleteDraft = editable && partnership.status === 'draft'
  const hasOverflowActions = (editable && transitions.length > 0) || canDeleteDraft
  const TABS: { key: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutGrid className="h-4 w-4" aria-hidden="true" /> },
    {
      key: 'deliverables',
      label: 'Deliverables',
      icon: <ClipboardList className="h-4 w-4" aria-hidden="true" />,
      count: owed.length,
    },
    {
      key: 'requirements',
      label: 'Requirements',
      icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
      count: required.length,
    },
    { key: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" aria-hidden="true" /> },
    {
      key: 'evidence',
      label: 'Evidence',
      icon: <ImageIcon className="h-4 w-4" aria-hidden="true" />,
      count: evidence.length,
    },
  ]

  const owedCompleted = owed.filter((o) => o.status === 'completed').length
  const requiredCompleted = required.filter((o) => o.status === 'completed').length
  const openItems = obligations.length - owedCompleted - requiredCompleted

  const metrics = [
    {
      key: 'deliverables',
      icon: <ClipboardList className="h-5 w-5" aria-hidden="true" />,
      iconClassName: 'bg-primary-50 text-primary-600',
      value: owedCompleted,
      suffix: owed.length > 0 ? 'of ' + owed.length : undefined,
      label: 'Deliverables',
      hint: 'What we promised this partner',
      progress: owed.length > 0 ? owedCompleted / owed.length : 0,
    },
    {
      key: 'requirements',
      icon: <ListChecks className="h-5 w-5" aria-hidden="true" />,
      iconClassName: 'bg-accent-50 text-accent-600',
      value: requiredCompleted,
      suffix: required.length > 0 ? 'of ' + required.length : undefined,
      label: 'Requirements',
      hint: 'What this partner provides',
      progress: required.length > 0 ? requiredCompleted / required.length : 0,
    },
    {
      key: 'evidence',
      icon: <Paperclip className="h-5 w-5" aria-hidden="true" />,
      iconClassName: 'bg-violet-50 text-violet-600',
      value: evidence.length,
      label: 'Evidence',
      hint: evidence.length === 1 ? 'Item attached' : 'Items attached',
      progress: 0,
    },
    {
      key: 'open',
      icon: <CircleDashed className="h-5 w-5" aria-hidden="true" />,
      iconClassName: 'bg-warning-50 text-warning-600',
      value: openItems,
      label: 'Open items',
      hint: 'Not yet completed',
      progress: 0,
    },
  ]

  const quickActions = [
    { key: 'edit' as const, label: 'Edit partnership', icon: <Pencil className="h-5 w-5" aria-hidden="true" />, disabled: !editable },
    { key: 'deliverables' as const, label: 'Deliverables', icon: <ClipboardList className="h-5 w-5" aria-hidden="true" />, disabled: false },
    { key: 'requirements' as const, label: 'Requirements', icon: <ListChecks className="h-5 w-5" aria-hidden="true" />, disabled: false },
    { key: 'evidence' as const, label: 'Evidence', icon: <Paperclip className="h-5 w-5" aria-hidden="true" />, disabled: false },
  ]

  function runQuickAction(key: 'edit' | Tab) {
    if (key === 'edit') {
      if (editable) setEditOpen(true)
      return
    }
    setTab(key)
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb uses real data and existing routes only. */}
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1.5 text-sm text-gray-500"
      >
        <Link to="/organizer/events" className="hover:text-gray-700">
          Events
        </Link>
        <span aria-hidden="true" className="text-gray-300">
          /
        </span>
        <Link to={'/organizer/events/' + eventId} className="hover:text-gray-700">
          {event.name}
        </Link>
        <span aria-hidden="true" className="text-gray-300">
          /
        </span>
        <Link to={partnersPath} className="hover:text-gray-700">
          Partners
        </Link>
        <span aria-hidden="true" className="text-gray-300">
          /
        </span>
        <span className="min-w-0 truncate font-medium text-gray-900">
          {partnership.company_name}
        </span>
      </nav>

      {/* Identity: logo beside the partnership facts on desktop, stacked on
          mobile. The single place this partnership is described. Open
          page-header layout, deliberately not a card. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <PartnerLogo name={partnership.company_name} logoUrl={partnership.logo_url} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-bold text-gray-900">{partnership.company_name}</h1>
              {partnership.tier_label && (
                <span className="rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-semibold text-warning-700 ring-1 ring-inset ring-warning-200">
                  {partnership.tier_label}
                </span>
              )}
              {partnership.status === 'active' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-success-500"
                  />
                  {STATUS_LABELS[partnership.status]}
                </span>
              ) : (
                <PartnerStatusBadge status={partnership.status} />
              )}
            </div>
            {/* Only metadata the data model actually carries is shown; a
                missing field is omitted rather than placeholder-rendered. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              {partnership.industry && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  {partnership.industry}
                </span>
              )}
              {partnership.website && safeWebUrl(partnership.website) && (
                <a
                  href={safeWebUrl(partnership.website)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary-700 hover:text-primary-800"
                >
                  <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {displayUrl(partnership.website)}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Desktop actions. There is no global partner profile in Rally, so
            there is no "View partner profile" button: the only real
            destination from here is the edit flow. */}
        {editable && (
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit partner
            </Button>
            {hasOverflowActions && (
              <PartnerOverflowMenu
                transitions={editable ? transitions : []}
                canDelete={canDeleteDraft}
                busy={busy}
                disabled={busy}
                onAction={(action) => setConfirm(action)}
              />
            )}
          </div>
        )}
      </div>

      {/* Mobile primary action. */}
      {editable && (
        <div className="flex items-center gap-2 sm:hidden">
          <Button variant="outline" className="flex-1" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit partner
          </Button>
          {hasOverflowActions && (
            <PartnerOverflowMenu
              transitions={editable ? transitions : []}
              canDelete={canDeleteDraft}
              busy={busy}
              disabled={busy}
              onAction={(action) => setConfirm(action)}
            />
          )}
        </div>
      )}

      {archived && <ArchivedNotice />}

      {notice && (
        <div
          className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
          role="alert"
        >
          {notice}
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
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t.icon}
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="text-xs text-gray-400">{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <section aria-label="Partnership metrics">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {metrics.map((m) => (
                <PartnershipMetricCard
                  key={m.key}
                  icon={m.icon}
                  iconClassName={m.iconClassName}
                  value={m.value}
                  suffix={m.suffix}
                  label={m.label}
                  hint={m.hint}
                  progress={m.progress}
                />
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>Partnership information</CardTitle>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setEditOpen(true)}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      Edit
                    </button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <DetailRow label="Partner" value={partnership.company_name} />
                  <DetailRow label="Event">
                    <Link
                      to={partnersPath}
                      className="text-sm font-medium text-primary-700 hover:text-primary-800"
                    >
                      {event.name}
                    </Link>
                  </DetailRow>
                  <DetailRow label="Partnership status">
                    <PartnerStatusBadge status={partnership.status} />
                  </DetailRow>
                  <DetailRow label="Tier" value={partnership.tier_label} />
                  <DetailRow label="Roles" value={roles.length > 0 ? rolesLabel(roles) : null} />
                  <DetailRow label="Commercial value" value={money} />
                  <DetailRow
                    label="Representative"
                    value={partnership.representative_email}
                  >
                    {partnership.representative_email && (
                      <a
                        href={'mailto:' + partnership.representative_email}
                        className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:text-primary-800"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        {partnership.representative_email}
                      </a>
                    )}
                  </DetailRow>
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
                  <DetailRow label="Industry" value={partnership.industry} />
                  {partnership.description && (
                    <DetailRow label="Description">
                      <p className="whitespace-pre-wrap text-sm text-gray-700">
                        {partnership.description}
                      </p>
                    </DetailRow>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Progress</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ProgressMeter label="Deliverables" completed={owedCompleted} total={owed.length} />
                  <ProgressMeter
                    label="Requirements"
                    completed={requiredCompleted}
                    total={required.length}
                  />
                  <p className="text-xs text-gray-500">
                    Counts what is marked completed right now. Rally does not keep a history of
                    reopened items.
                  </p>
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
                  <CardTitle>Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {quickActions.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        disabled={action.disabled}
                        onClick={() => runQuickAction(action.key)}
                        className={cn(
                          'flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-sm font-medium text-gray-700 transition-colors',
                          action.disabled
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:border-primary-300 hover:bg-primary-50/50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-600'
                        )}
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                          {action.icon}
                        </span>
                        {action.label}
                      </button>
                    ))}
                  </div>
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
                          {transitionLabel(next)}
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

      {tab === 'documents' && (
        <PartnershipDocumentsPanel
          partnershipId={partnership.id}
          eventId={event.id}
          editable={editable}
          archived={archived}
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
            setNotice(warning)
            await load()
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

/** Same wording the Overview status card has always used. */
function transitionLabel(next: PartnershipStatus): string {
  if (next === 'cancelled') return 'Cancel Partnership'
  if (next === 'completed') return 'Mark Completed'
  if (next === 'active') return 'Reopen as Active'
  return 'Restore to Draft'
}

/**
 * The existing partner lifecycle actions, kept out of the way behind the
 * three-dot button. Nothing new is offered here: every item routes into the
 * same confirm dialog the Overview card has always driven. Destructive
 * deletion sits below a divider, last.
 */
function PartnerOverflowMenu({
  transitions,
  canDelete,
  busy,
  disabled,
  onAction,
}: {
  transitions: PartnershipStatus[]
  canDelete: boolean
  busy: boolean
  disabled: boolean
  onAction: (action: 'delete' | PartnershipStatus) => void
}) {
  const [open, setOpen] = useState(false)
  if (transitions.length === 0 && !canDelete) return null

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More partner actions"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          >
            {transitions.map((next) => (
              <button
                key={next}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onAction(next)
                }}
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {transitionLabel(next)}
              </button>
            ))}
            {canDelete && (
              <>
                {transitions.length > 0 && (
                  <div aria-hidden="true" className="my-1 border-t border-gray-100" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false)
                    onAction('delete')
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-error-700 hover:bg-error-50 disabled:opacity-50"
                >
                  Delete Partner
                </button>
              </>
            )}
          </div>
        </>
      )}
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
