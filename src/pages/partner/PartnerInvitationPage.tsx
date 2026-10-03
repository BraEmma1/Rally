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
import { formatDate } from '@/lib/utils'
import {
  declinePartnershipInvitation,
  getMyPartnershipInvitation,
  getMyPartnershipInvitationObligations,
  type InvitationObligation,
  type PartnershipInvitationReview,
} from '@/lib/partnerInvitations'

// ---------------------------------------------------------------------------
// /partner/invitations?invitation=<id>
//
// Where a partnership invitation email lands. Standalone by design -- the
// recipient is normally an attendee, may be a brand-new Rally user, and
// belongs to none of the app shells.
//
// The id in the URL is a selector, never an authorization. Phase 3B's
// my_partnership_invitation is authorized entirely by the caller's CONFIRMED
// email matching invited_email, and returns zero rows otherwise -- the same
// answer as a uuid that does not exist. So this page can tell the RIGHTFUL
// recipient exactly what became of their invitation (expired, revoked,
// declined, accepted) while telling everyone else nothing at all.
// ---------------------------------------------------------------------------

export default function PartnerInvitationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, account, signOut } = useAuth()

  const invitationId = searchParams.get('invitation')

  const [invitation, setInvitation] = useState<PartnershipInvitationReview | null>(null)
  const [obligations, setObligations] = useState<InvitationObligation[]>([])
  const [loading, setLoading] = useState(true)
  const [termsLoading, setTermsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [acceptOpen, setAcceptOpen] = useState(false)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [acceptedOrganization, setAcceptedOrganization] = useState<string | null>(null)

  // Supabase populates this only once the address has actually been verified,
  // which is the same fact current_user_confirmed_email() reads server-side.
  const emailConfirmed = Boolean(user?.email_confirmed_at)

  const load = useCallback(async () => {
    if (!invitationId || !emailConfirmed) {
      setLoading(false)
      setTermsLoading(false)
      return
    }
    setLoading(true)
    setTermsLoading(true)
    // Both in flight together: the terms are a second narrow projection, and
    // the header should not wait on them.
    const [result, obligationResult] = await Promise.all([
      getMyPartnershipInvitation(invitationId),
      getMyPartnershipInvitationObligations(invitationId),
    ])
    setInvitation(result.data)
    setLoadError(result.error)
    setLoading(false)
    setObligations(obligationResult.data)
    setTermsLoading(false)
  }, [invitationId, emailConfirmed])

  useEffect(() => {
    void load()
  }, [load])

  const deliverables = useMemo(
    () => obligations.filter((o) => o.direction === 'organizer_to_partner'),
    [obligations]
  )
  const requirements = useMemo(
    () => obligations.filter((o) => o.direction === 'partner_to_organizer'),
    [obligations]
  )

  const home = accountHomePath(account)

  async function decline() {
    if (!invitation || declining) return
    setDeclining(true)
    setActionError(null)
    const { error } = await declinePartnershipInvitation(invitation.invitation_id)
    setDeclining(false)
    setConfirmDecline(false)
    if (error) setActionError(error)
    // Either way the authoritative state is refetched: a refusal usually means
    // somebody else got there first, and that is what should be on screen.
    await load()
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

  if (loading) return <LoadingState message="Loading your invitation…" />

  // No row means: not this account's invitation, or no such invitation. The
  // backend answers both identically so that a uuid reveals nothing, and this
  // does not try to tell them apart.
  if (!invitation) {
    return (
      <UnavailableScreen
        title="This invitation is not available"
        body={
          loadError ??
          'It may have been sent to a different email address, or the link may no longer be valid.'
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

  // ---- states the rightful recipient may now be told truthfully -----------

  if (invitation.invitation_status === 'accepted') {
    return (
      <AcceptedScreen
        organizationName={acceptedOrganization}
        invitation={invitation}
        onHome={() => navigate(home)}
      />
    )
  }

  if (invitation.invitation_status === 'declined') {
    return <DeclinedScreen invitation={invitation} onHome={() => navigate(home)} />
  }

  if (invitation.invitation_status === 'revoked') {
    return (
      <UnavailableScreen
        title="Invitation No Longer Available"
        body="This invitation was withdrawn by the event organizer."
        detail={
          invitation.responded_at ? 'Withdrawn on ' + formatDate(invitation.responded_at) : undefined
        }
        homePath={home}
      />
    )
  }

  if (invitation.is_expired) {
    return (
      <UnavailableScreen
        title="Invitation Expired"
        body="This invitation expired before it was accepted. Contact the event organizer for a new one."
        detail={'Expired on ' + formatDate(invitation.expires_at)}
        homePath={home}
      />
    )
  }

  // Still pending, but the partnership or the event has moved on. The backend
  // would refuse the acceptance, so the button is not offered.
  if (invitation.event_archived || invitation.partnership_status !== 'invited') {
    return (
      <UnavailableScreen
        title="This partnership is no longer open"
        body={
          invitation.event_archived
            ? 'The event has been archived, so this invitation can no longer be accepted.'
            : 'The organizer has changed this partnership, so the invitation can no longer be accepted. Contact them if you were expecting to take part.'
        }
        homePath={home}
      />
    )
  }

  return (
    <>
      <InvitationReview
        invitation={invitation}
        deliverables={deliverables}
        requirements={requirements}
        termsLoading={termsLoading}
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
          onAccepted={async (organizationName) => {
            setAcceptOpen(false)
            setAcceptedOrganization(organizationName)
            // The accepted screen renders from the refetched invitation, so
            // what it shows is what the server actually did.
            await load()
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
