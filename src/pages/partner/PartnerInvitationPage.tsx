import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, CalendarRange, Check, Handshake, Mail, Users, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/organizer/SheetDialog'
import { AcceptPartnershipDialog } from '@/components/partner/AcceptPartnershipDialog'
import { accountHomePath } from '@/lib/routing'
import { formatDate } from '@/lib/utils'
import { invitationAuthSearch } from '@/lib/invitationRouting'
import {
  declinePartnershipInvitation,
  listMyPendingPartnershipInvitations,
  partnershipRolesLabel,
  type PendingPartnershipInvitation,
} from '@/lib/partnerInvitations'

// ---------------------------------------------------------------------------
// /partner/invitations?invitation=<id>
//
// Where a partnership invitation email lands. Standalone by design -- the
// recipient may be a brand-new Rally user with no account type that belongs to
// any of the app shells, and an attendee with a matching confirmed email is a
// perfectly valid visitor.
//
// The id in the URL is a selector, never an authorization.
// my_pending_partnership_invitations returns only invitations whose
// invited_email matches this caller's CONFIRMED email, so an id that is not
// in that list simply is not here -- and the page cannot tell whether it was
// revoked, expired, already answered or addressed to somebody else. That is
// the backend's deliberate position ("the uuid alone reveals nothing about
// what exists"), so this screen presents one honest combined state rather than
// guessing a reason it has not been told.
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: 'accepted'; organizationName: string; invitation: PendingPartnershipInvitation }
  | { kind: 'declined' }

export default function PartnerInvitationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, account, signOut } = useAuth()

  const invitationId = searchParams.get('invitation')

  const [invitations, setInvitations] = useState<PendingPartnershipInvitation[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // Supabase only populates this once the address has actually been verified,
  // which is the same fact current_user_confirmed_email() reads server-side.
  const emailConfirmed = Boolean(user?.email_confirmed_at)

  const load = useCallback(async () => {
    if (!emailConfirmed) {
      setInvitations([])
      return
    }
    const { data, error } = await listMyPendingPartnershipInvitations()
    setInvitations(data)
    setLoadError(error)
  }, [emailConfirmed])

  useEffect(() => {
    void load()
  }, [load])

  const invitation = useMemo(
    () => invitations?.find((i) => i.invitation_id === invitationId) ?? null,
    [invitations, invitationId]
  )

  async function decline() {
    if (!invitation || declining) return
    setDeclining(true)
    setActionError(null)
    const { error } = await declinePartnershipInvitation(invitation.invitation_id)
    setDeclining(false)
    setConfirmDecline(false)
    if (error) {
      setActionError(error)
      // The refusal may itself be stale state -- another tab, or the organizer
      // revoking it -- so the authoritative list is refetched either way.
      await load()
      return
    }
    setOutcome({ kind: 'declined' })
  }

  const home = accountHomePath(account)

  // ---- outcome screens ----------------------------------------------------

  if (outcome?.kind === 'accepted') {
    const { organizationName, invitation: accepted } = outcome
    return (
      <Shell>
        <Card>
          <CardContent className="py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-50 text-accent-700">
              <Check className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">Partnership Accepted</h1>
            {/* Not "your account is now a Sponsor": the account type is
                unchanged, and authority comes from organization membership. */}
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
              You now represent <strong className="font-semibold">{organizationName}</strong> for{' '}
              {accepted.event_name}.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {accepted.tier_label && <Badge variant="primary">{accepted.tier_label}</Badge>}
              {accepted.roles.length > 0 && (
                <Badge variant="gray">{partnershipRolesLabel(accepted.roles)}</Badge>
              )}
            </div>
            <div className="mt-6">
              <Button onClick={() => navigate(home)}>Back to Rally</Button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    )
  }

  if (outcome?.kind === 'declined') {
    return (
      <Shell>
        <Card>
          <CardContent className="py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <X className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">Invitation Declined</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
              The organizer can update the partnership and send another invitation if needed.
            </p>
            <div className="mt-6">
              <Button variant="secondary" onClick={() => navigate(home)}>
                Back to Rally
              </Button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    )
  }

  // ---- gates --------------------------------------------------------------

  if (!invitationId) {
    return (
      <Unavailable
        title="No invitation specified"
        body="Open the link from your invitation email to review a partnership."
        home={home}
      />
    )
  }

  if (!emailConfirmed) {
    return (
      <Unavailable
        title="Confirm your email address"
        body="Confirm your email address before reviewing this invitation. Check your inbox for the confirmation link Rally sent when you created your account."
        home={home}
      />
    )
  }

  if (invitations === null) return <LoadingState message="Loading your invitation…" />

  if (!invitation) {
    // One state for revoked, expired, already answered, a partnership that has
    // moved on, an archived event and an invitation addressed to a different
    // person. The backend refuses to distinguish them, and inferring a reason
    // it has not given would be guessing in public.
    return (
      <Unavailable
        title="This invitation is not available"
        body={
          loadError ??
          'It may have expired, been withdrawn, or already been answered — or it may have been sent to a different email address.'
        }
        home={home}
        footer={
          <div className="mt-5 space-y-3">
            <p className="text-sm text-gray-600">
              You are signed in as{' '}
              <strong className="font-medium text-gray-900">{user?.email}</strong>. An invitation
              can only be opened by the address it was sent to.
            </p>
            <Button
              variant="secondary"
              onClick={async () => {
                await signOut()
                navigate('/login' + invitationAuthSearch({ id: invitationId, kind: 'partnership' }), {
                  replace: true,
                })
              }}
            >
              Sign Out and Use Another Account
            </Button>
          </div>
        }
      />
    )
  }

  // ---- review -------------------------------------------------------------

  const roles = partnershipRolesLabel(invitation.roles)

  return (
    <Shell>
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
          <Handshake className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Rally</p>
          <h1 className="text-xl font-bold text-gray-900">Partnership Invitation</h1>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5 py-6">
          {/* Who, whom, what, as what -- the shape of the offer in one block. */}
          <div className="space-y-1 text-center">
            <p className="text-base font-semibold text-gray-900">
              {invitation.organizer_organization_name}
            </p>
            <p className="text-sm text-gray-500">has invited</p>
            <p className="text-lg font-bold text-gray-900">{invitation.company_name}</p>
            <p className="text-sm text-gray-500">to participate in</p>
            <p className="text-base font-semibold text-gray-900">{invitation.event_name}</p>
            {(invitation.tier_label || roles) && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {invitation.tier_label && (
                  <Badge variant="primary">{invitation.tier_label}</Badge>
                )}
                {roles && <Badge variant="gray">{roles}</Badge>}
              </div>
            )}
          </div>

          <dl className="divide-y divide-gray-100 border-y border-gray-100">
            {invitation.event_start_date && (
              <Row icon={<CalendarRange className="h-4 w-4" />} label="Event date">
                {formatDate(invitation.event_start_date)}
              </Row>
            )}
            <Row icon={<Building2 className="h-4 w-4" />} label="Organizer">
              {invitation.organizer_organization_name || 'The event organizer'}
            </Row>
            {invitation.invited_by_name && (
              <Row icon={<Users className="h-4 w-4" />} label="Invited by">
                {invitation.invited_by_name}
              </Row>
            )}
            <Row icon={<Mail className="h-4 w-4" />} label="Sent to">
              {user?.email}
            </Row>
          </dl>

          <p className="text-xs leading-relaxed text-gray-500">
            This invitation expires on {formatDate(invitation.expires_at)}. The full deliverables
            and requirements for this partnership become available to you once you accept.
          </p>

          {actionError && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {actionError}
            </div>
          )}

          {/* Nothing is accepted by arriving here or by signing in. */}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={declining || acceptOpen}
              onClick={() => setConfirmDecline(true)}
            >
              Decline
            </Button>
            <Button disabled={declining || acceptOpen} onClick={() => setAcceptOpen(true)}>
              Accept Partnership
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-xs text-gray-500">
        Accepting links your organization to this partnership. It does not change your Rally
        account type.{' '}
        <Link to={home} className="font-medium text-primary-700 hover:text-primary-800">
          Back to Rally
        </Link>
      </p>

      {acceptOpen && (
        <AcceptPartnershipDialog
          invitation={invitation}
          onClose={() => setAcceptOpen(false)}
          onAccepted={(organizationName) => {
            setAcceptOpen(false)
            setOutcome({ kind: 'accepted', organizationName, invitation })
          }}
        />
      )}

      {confirmDecline && (
        <ConfirmDialog
          busy={declining}
          title="Decline Partnership?"
          body="You will not join this partnership. The organizer sees your decision through the partnership status and can send another invitation if needed."
          action="Decline Partnership"
          onConfirm={() => void decline()}
          onClose={() => setConfirmDecline(false)}
        />
      )}
    </Shell>
  )
}

/** A centred reading column: wide enough to read, never the full desktop. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </div>
  )
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
      <dt className="flex items-center gap-2 text-sm text-gray-500">
        <span className="text-gray-400" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="ml-auto min-w-0 break-words text-right text-sm font-medium text-gray-900">
        {children}
      </dd>
    </div>
  )
}

function Unavailable({
  title,
  body,
  home,
  footer,
}: {
  title: string
  body: string
  home: string
  footer?: ReactNode
}) {
  return (
    <Shell>
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <Mail className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">{title}</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">{body}</p>
          </div>
          {footer}
          <div className="mt-6 text-center">
            <Link to={home}>
              <Button variant="secondary">Back to Rally</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </Shell>
  )
}
