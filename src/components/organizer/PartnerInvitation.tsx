import { useState } from 'react'
import { Mail, RefreshCw, Send, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/States'
import {
  DELIVERY_BADGE,
  DELIVERY_LABELS,
  INVITATION_STATUS_BADGE,
  INVITATION_STATUS_LABELS,
  currentInvitation,
  invitationDisplayStatus,
  invitePartnershipRepresentative,
  resendPartnershipInvitation,
  revokePartnershipInvitation,
  type Partnership,
  type PartnershipInvitation,
  type PartnershipRole,
} from '@/lib/partnerships'
import { rolesLabel } from './PartnerCommon'
import { ConfirmDialog, SheetDialog } from './SheetDialog'

// ---------------------------------------------------------------------------
// Organizer-side invitation management.
//
// Three backend operations and no local shortcuts: the partnership's move to
// `invited`, the invitation row, the email queue row and the return to `draft`
// on revoke all belong to phase 3A's SECURITY DEFINER functions. Nothing here
// writes a status, and after every mutation the page refetches rather than
// assuming what the server did -- which is also what makes a race with another
// session show up as refreshed state instead of a wrong screen.
//
// Expiry is a derived display state. `list_partnership_invitations` computes
// `is_expired` per row, so nothing is written to the database merely to show
// the word Expired.
// ---------------------------------------------------------------------------

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The confirmation. Sending is a deliberate act with an outside effect, so the
 * header button opens this rather than firing the RPC.
 *
 * It shows who, for whom, for what event and on what terms -- and deliberately
 * not `internal_notes` or the sponsorship value. The first is organizer-only
 * by definition; the second is not what this decision is about.
 */
export function SendInvitationDialog({
  partnership,
  roles,
  eventName,
  email,
  reissue,
  onClose,
  onSent,
}: {
  partnership: Partnership
  roles: PartnershipRole[]
  eventName: string
  email: string
  /** True when an expired invitation is being issued again. */
  reissue?: boolean
  onClose: () => void
  onSent: (message: string) => Promise<void>
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (sending) return
    setSending(true)
    setError(null)
    const { error: sendError } = await invitePartnershipRepresentative(partnership.id, email)
    if (sendError) {
      setError(sendError)
      setSending(false)
      return
    }
    setSending(false)
    await onSent('Invitation sent to ' + email + '.')
  }

  return (
    <SheetDialog
      title={reissue ? 'Send This Invitation Again' : 'Send Partnership Invitation'}
      subtitle={eventName}
      onClose={onClose}
      busy={sending}
    >
      <div className="space-y-4">
        <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
          <Row label="You're about to invite">
            <p className="break-all text-sm font-medium text-gray-900">{email}</p>
          </Row>
          <Row label="To represent">
            <p className="text-sm text-gray-900">{partnership.company_name}</p>
          </Row>
          <Row label="For">
            <p className="text-sm text-gray-900">{eventName}</p>
          </Row>
          <Row label="Partnership">
            {partnership.tier_label && (
              <p className="text-sm font-medium text-gray-900">{partnership.tier_label}</p>
            )}
            {roles.length > 0 && <p className="text-sm text-gray-500">{rolesLabel(roles)}</p>}
            {!partnership.tier_label && roles.length === 0 && (
              <p className="text-sm text-gray-400">No tier or roles recorded</p>
            )}
          </Row>
        </div>

        <p className="text-sm leading-relaxed text-gray-600">
          They will receive an email to review the partnership, and can sign in or create a Rally
          account using this address. Nothing is shared with them until they accept.
        </p>

        {reissue && (
          <p className="text-sm leading-relaxed text-gray-600">
            This replaces the expired invitation with a fresh one, valid for another 30 days.
          </p>
        )}

        {error && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void send()} disabled={sending}>
            <Send className="h-4 w-4" />
            {sending ? 'Sending…' : 'Send Invitation'}
          </Button>
        </div>
      </div>
    </SheetDialog>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 sm:pt-0.5">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * The Invitation section on Partner Detail Overview.
 *
 * Renders only once an invitation exists -- before that the header's Send
 * Invitation action is the whole story, and an empty card would be noise.
 */
export function PartnerInvitationCard({
  partnership,
  roles,
  eventName,
  invitations,
  loading,
  error,
  editable,
  onChanged,
  onEditPartner,
}: {
  partnership: Partnership
  roles: PartnershipRole[]
  eventName: string
  invitations: PartnershipInvitation[]
  loading: boolean
  error: string | null
  editable: boolean
  onChanged: (message?: string) => Promise<void>
  onEditPartner: () => void
}) {
  const [busy, setBusy] = useState<'resend' | 'revoke' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [reissueOpen, setReissueOpen] = useState(false)

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 py-1 text-sm text-gray-500">
            <Spinner size="sm" />
            Loading the invitation…
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void onChanged()}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const latest = currentInvitation(invitations)
  if (!latest) return null

  const display = invitationDisplayStatus(latest)
  const history = invitations.filter((i) => i.id !== latest.id)

  // The `latest &&` guards are for the compiler: these are hoisted function
  // declarations, so narrowing from the early return above does not reach
  // inside them.
  async function resend() {
    if (!latest || busy) return
    setBusy('resend')
    setActionError(null)
    const { error: resendError } = await resendPartnershipInvitation(latest.id)
    setBusy(null)
    if (resendError) {
      setActionError(resendError)
      // The refusal may itself be stale state -- another session may have
      // revoked it -- so the authoritative row is fetched either way.
      await onChanged()
      return
    }
    await onChanged('Invitation re-queued for ' + latest.invited_email + '.')
  }

  async function revoke() {
    if (!latest || busy) return
    setBusy('revoke')
    setActionError(null)
    const { error: revokeError } = await revokePartnershipInvitation(latest.id)
    setBusy(null)
    setConfirmRevoke(false)
    if (revokeError) {
      setActionError(revokeError)
      await onChanged()
      return
    }
    await onChanged('Invitation to ' + latest.invited_email + ' revoked.')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Invitation</CardTitle>
        <Mail className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={INVITATION_STATUS_BADGE[display]}>
            {INVITATION_STATUS_LABELS[display]}
          </Badge>
          <span className="break-all text-sm text-gray-700">{latest.invited_email}</span>
        </div>

        {display === 'declined' && (
          <p className="text-sm leading-relaxed text-gray-600">
            {latest.invited_email} declined the partnership invitation. The partnership and
            everything recorded on it remain saved as a draft.
          </p>
        )}
        {display === 'expired' && (
          <p className="text-sm leading-relaxed text-gray-600">
            This invitation expired before it was accepted. Sending it again issues a fresh one.
          </p>
        )}
        {display === 'revoked' && partnership.status === 'cancelled' && (
          <p className="text-sm leading-relaxed text-gray-600">
            Cancelling the partnership withdrew this invitation.
          </p>
        )}
        {display === 'accepted' && (
          <p className="text-sm leading-relaxed text-gray-600">
            Accepted by {latest.invited_email}
            {latest.responded_at ? ' on ' + formatDate(latest.responded_at) : ''}. The partnership
            is now active.
          </p>
        )}

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Sent" value={formatDate(latest.created_at)} />
          {display === 'pending' && <Field label="Expires" value={formatDate(latest.expires_at)} />}
          {display === 'expired' && <Field label="Expired" value={formatDate(latest.expires_at)} />}
          {(display === 'accepted' || display === 'declined' || display === 'revoked') && (
            <Field
              label={display === 'revoked' ? 'Revoked' : display === 'declined' ? 'Declined' : 'Accepted'}
              value={formatDate(latest.responded_at)}
            />
          )}
          <DeliveryField invitation={latest} live={display === 'pending'} />
        </dl>

        {actionError && (
          <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {actionError}
          </div>
        )}

        {editable && display === 'pending' && (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void resend()}>
              <RefreshCw className={'h-3.5 w-3.5' + (busy === 'resend' ? ' animate-spin' : '')} />
              {busy === 'resend' ? 'Resending…' : 'Resend'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirmRevoke(true)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Revoke
            </Button>
          </div>
        )}

        {editable && display === 'expired' && (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <Button size="sm" disabled={busy !== null} onClick={() => setReissueOpen(true)}>
              <Send className="h-3.5 w-3.5" />
              Send Again
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirmRevoke(true)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Revoke
            </Button>
          </div>
        )}

        {/* Changing who represents the company is a three-step flow on purpose:
            the backend refuses an edit that would disagree with a live
            invitation, so the UI explains the order rather than offering a
            shortcut that would fail. */}
        {editable && display === 'pending' && (
          <p className="text-xs leading-relaxed text-gray-500">
            To invite someone else at {partnership.company_name}, revoke this invitation first, then
            change the representative in{' '}
            <button
              type="button"
              onClick={onEditPartner}
              className="font-medium text-primary-700 underline hover:text-primary-800"
            >
              Edit Partner
            </button>
            .
          </p>
        )}

        {history.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Earlier invitations
            </h4>
            <ul className="mt-2 space-y-1.5">
              {history.map((invitation) => {
                const past = invitationDisplayStatus(invitation)
                return (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center gap-2 text-sm text-gray-600"
                  >
                    <Badge variant={INVITATION_STATUS_BADGE[past]}>
                      {INVITATION_STATUS_LABELS[past]}
                    </Badge>
                    <span className="break-all">{invitation.invited_email}</span>
                    <span className="text-xs text-gray-400">
                      {formatDate(invitation.responded_at ?? invitation.created_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>

      {confirmRevoke && (
        <ConfirmDialog
          busy={busy === 'revoke'}
          title="Revoke Invitation?"
          body={
            latest.invited_email +
            ' will no longer be able to accept this invitation. The partnership and its ' +
            'deliverables, requirements and evidence all remain saved as a draft.'
          }
          action="Revoke Invitation"
          onConfirm={() => void revoke()}
          onClose={() => setConfirmRevoke(false)}
        />
      )}

      {reissueOpen && (
        <SendInvitationDialog
          partnership={partnership}
          roles={roles}
          eventName={eventName}
          email={latest.invited_email}
          reissue
          onClose={() => setReissueOpen(false)}
          onSent={async (message) => {
            setReissueOpen(false)
            await onChanged(message)
          }}
        />
      )}
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  )
}

/**
 * What Rally has done with the email, which is not the same as what the
 * recipient's mail server did. `Sent` means the provider accepted it. The
 * stored provider error is deliberately not rendered -- it is an upstream
 * string, and an organizer can act on "Failed" plus Resend without it.
 */
function DeliveryField({
  invitation,
  live,
}: {
  invitation: PartnershipInvitation
  /**
   * Whether the invitation is still awaiting a reply. A queued email for an
   * invitation that has since been answered or revoked will NOT go out -- the
   * drainer only sends while the invitation is pending -- so promising that it
   * is "waiting to be sent" would be untrue. The badge still reports the queue
   * row as it stands.
   */
  live: boolean
}) {
  const status = invitation.delivery_status
  if (!status) return null

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Delivery</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-2">
        <Badge variant={DELIVERY_BADGE[status]}>{DELIVERY_LABELS[status]}</Badge>
        <span className="text-xs text-gray-500">
          {status === 'queued' && live && 'Waiting to be sent.'}
          {status === 'sent' &&
            invitation.delivery_sent_at &&
            formatDateTime(invitation.delivery_sent_at)}
          {status === 'failed' &&
            'Rally could not send it' +
              (invitation.delivery_attempts
                ? ' after ' +
                  invitation.delivery_attempts +
                  (invitation.delivery_attempts === 1 ? ' attempt' : ' attempts')
                : '') +
              '.'}
        </span>
      </dd>
    </div>
  )
}
