import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CalendarRange, Check, Handshake, Mail, Users, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils'
import {
  partnershipRolesLabel,
  type PendingPartnershipInvitation,
} from '@/lib/partnerInvitations'

// The screens a partnership invitee can be shown, as presentation only. The
// page itself owns the data, the decisions and every call; these take props and
// render. Keeping them separable is what makes each state checkable at a given
// width without a signed-in session.

/** A centred reading column: wide enough to read, never the full desktop. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </div>
  )
}

export function InvitationReview({
  invitation,
  signedInEmail,
  actionError,
  busy,
  homePath,
  onAccept,
  onDecline,
}: {
  invitation: PendingPartnershipInvitation
  signedInEmail: string | null
  actionError: string | null
  busy: boolean
  homePath: string
  onAccept: () => void
  onDecline: () => void
}) {
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
              {invitation.organizer_organization_name || 'The event organizer'}
            </p>
            <p className="text-sm text-gray-500">has invited</p>
            <p className="text-lg font-bold text-gray-900">{invitation.company_name}</p>
            <p className="text-sm text-gray-500">to participate in</p>
            <p className="text-base font-semibold text-gray-900">{invitation.event_name}</p>
            {(invitation.tier_label || roles) && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {invitation.tier_label && <Badge variant="primary">{invitation.tier_label}</Badge>}
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
            {invitation.organizer_organization_name && (
              <Row icon={<Building2 className="h-4 w-4" />} label="Organizer">
                {invitation.organizer_organization_name}
              </Row>
            )}
            {invitation.invited_by_name && (
              <Row icon={<Users className="h-4 w-4" />} label="Invited by">
                {invitation.invited_by_name}
              </Row>
            )}
            {signedInEmail && (
              <Row icon={<Mail className="h-4 w-4" />} label="Sent to">
                {signedInEmail}
              </Row>
            )}
          </dl>

          {/* Said plainly rather than left as a gap: phase 3A withholds the
              obligations and the commercial terms until acceptance. */}
          <p className="text-xs leading-relaxed text-gray-500">
            This invitation expires on {formatDate(invitation.expires_at)}. The deliverables and
            requirements agreed for this partnership become available to you once you accept.
          </p>

          {actionError && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {actionError}
            </div>
          )}

          {/* Nothing is accepted by arriving here or by signing in. */}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={busy} onClick={onDecline}>
              Decline
            </Button>
            <Button disabled={busy} onClick={onAccept}>
              Accept Partnership
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-xs text-gray-500">
        Accepting links your organization to this partnership. It does not change your Rally
        account type.{' '}
        <Link to={homePath} className="font-medium text-primary-700 hover:text-primary-800">
          Back to Rally
        </Link>
      </p>
    </Shell>
  )
}

export function AcceptedScreen({
  organizationName,
  invitation,
  onHome,
}: {
  organizationName: string
  invitation: PendingPartnershipInvitation
  onHome: () => void
}) {
  return (
    <Shell>
      <Card>
        <CardContent className="py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-50 text-accent-700">
            <Check className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Partnership Accepted</h1>
          {/* Not "your account is now a Sponsor": the account type is unchanged,
              and the authority comes from organization membership. */}
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
            You now represent <strong className="font-semibold">{organizationName}</strong> for{' '}
            {invitation.event_name}.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {invitation.tier_label && <Badge variant="primary">{invitation.tier_label}</Badge>}
            {invitation.roles.length > 0 && (
              <Badge variant="gray">{partnershipRolesLabel(invitation.roles)}</Badge>
            )}
          </div>
          <div className="mt-6">
            <Button onClick={onHome}>Back to Rally</Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  )
}

export function DeclinedScreen({ onHome }: { onHome: () => void }) {
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
            <Button variant="secondary" onClick={onHome}>
              Back to Rally
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  )
}

export function UnavailableScreen({
  title,
  body,
  homePath,
  footer,
}: {
  title: string
  body: string
  homePath: string
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
            <Link to={homePath}>
              <Button variant="secondary">Back to Rally</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </Shell>
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
