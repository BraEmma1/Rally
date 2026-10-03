import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/organizer/SheetDialog'
import { AcceptPartnershipDialog } from '@/components/partner/AcceptPartnershipDialog'
import {
  AcceptedScreen,
  DeclinedScreen,
  InvitationReview,
  UnavailableScreen,
} from '@/components/partner/PartnerInvitationViews'
import { accountHomePath } from '@/lib/routing'
import { invitationAuthSearch } from '@/lib/invitationRouting'
import {
  declinePartnershipInvitation,
  listMyPendingPartnershipInvitations,
  type PendingPartnershipInvitation,
} from '@/lib/partnerInvitations'

// ---------------------------------------------------------------------------
// /partner/invitations?invitation=<id>
//
// Where a partnership invitation email lands. Standalone by design -- the
// recipient is normally an attendee, may be a brand-new Rally user, and
// belongs to none of the app shells.
//
// The id in the URL is a selector, never an authorization.
// my_pending_partnership_invitations returns only invitations whose
// invited_email matches this caller's CONFIRMED email, so an id that is not in
// that list simply is not here -- and the page cannot tell whether it was
// revoked, expired, already answered, or addressed to somebody else. That is
// the backend's deliberate position ("the uuid alone reveals nothing about
// what exists"), so this screen presents one honest combined state rather than
// inventing a reason it has not been given.
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

  // Supabase populates this only once the address has actually been verified,
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

  const home = accountHomePath(account)

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

  if (outcome?.kind === 'accepted') {
    return (
      <AcceptedScreen
        organizationName={outcome.organizationName}
        invitation={outcome.invitation}
        onHome={() => navigate(home)}
      />
    )
  }

  if (outcome?.kind === 'declined') {
    return <DeclinedScreen onHome={() => navigate(home)} />
  }

  if (!invitationId) {
    return (
      <UnavailableScreen
        title="No invitation specified"
        body="Open the link from your invitation email to review a partnership."
        homePath={home}
      />
    )
  }

  if (!emailConfirmed) {
    return (
      <UnavailableScreen
        title="Confirm your email address"
        body="Confirm your email address before reviewing this invitation. Check your inbox for the confirmation link Rally sent when you created your account."
        homePath={home}
      />
    )
  }

  if (invitations === null) return <LoadingState message="Loading your invitation…" />

  if (!invitation) {
    // One state for revoked, expired, already answered, a partnership that has
    // moved on, an archived event, and an invitation addressed to someone else.
    // The backend refuses to distinguish them, and guessing a reason in public
    // is exactly what that refusal exists to prevent.
    return (
      <UnavailableScreen
        title="This invitation is not available"
        body={
          loadError ??
          'It may have expired, been withdrawn, or already been answered — or it may have been sent to a different email address.'
        }
        homePath={home}
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
                navigate(
                  '/login' + invitationAuthSearch({ id: invitationId, kind: 'partnership' }),
                  { replace: true }
                )
              }}
            >
              Sign Out and Use Another Account
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <>
      <InvitationReview
        invitation={invitation}
        signedInEmail={user?.email ?? null}
        actionError={actionError}
        busy={declining || acceptOpen}
        homePath={home}
        onAccept={() => setAcceptOpen(true)}
        onDecline={() => setConfirmDecline(true)}
      />

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
    </>
  )
}
