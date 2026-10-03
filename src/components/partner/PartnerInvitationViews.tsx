import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CalendarRange, Check, Handshake, Mail, MapPin, Users, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils'
import {
  partnershipRolesLabel,
  type InvitationObligation,
  type PartnershipInvitationReview,
} from '@/lib/partnerInvitations'

// The screens a partnership invitee can be shown, as presentation only. The
// page owns the data, the decisions and every call; these take props and
// render. Keeping them separable is what makes each state checkable at a given
// width without a signed-in session.

/** A centred reading column: wide enough to read, never the full desktop. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </div>
  )
}

/** The Rally mark and the one-line statement of what this page is. */
export function InvitationHeader({ title }: { title: string }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
        <Handshake className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Rally</p>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      </div>
    </div>
  )
}

/**
 * Reviewing a proposal, not reading a notification: the offer in one sentence,
 * then the event, then the commercial terms, then what each side has
 * undertaken to do. The two obligation lists are the point of phase 3B -- they
 * are what the recipient is actually being asked to agree to.
 */
export function InvitationReview({
  invitation,
  deliverables,
  requirements,
  termsLoading,
  signedInEmail,
  actionError,
  busy,
  homePath,
  onAccept,
  onDecline,
}: {
  invitation: PartnershipInvitationReview
  deliverables: InvitationObligation[]
  requirements: InvitationObligation[]
  termsLoading: boolean
  signedInEmail: string | null
  actionError: string | null
  busy: boolean
  homePath: string
  onAccept: () => void
  onDecline: () => void
}) {
  const roles = partnershipRolesLabel(invitation.roles)
  const money = formatValue(invitation.value_amount, invitation.value_currency)
  const organizer = invitation.organizer_organization_name || 'The event organizer'

  return (
    <Shell>
      <InvitationHeader title="Partnership Invitation" />

      <Card>
        <CardContent className="space-y-6 py-6">
          {/* The offer, stated once. */}
          <div className="space-y-1 text-center">
            <p className="text-base font-semibold text-gray-900">{organizer}</p>
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
                {formatEventDates(invitation.event_start_date, invitation.event_end_date)}
              </Row>
            )}
            {invitation.event_location && (
              <Row icon={<MapPin className="h-4 w-4" />} label="Location">
                {invitation.event_location}
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

          {(invitation.tier_label || money) && (
            <Section title="Partnership">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium text-gray-900">
                  {invitation.tier_label ?? 'Partnership'}
                </p>
                {money && (
                  <p className="text-base font-semibold tabular-nums text-gray-900">{money}</p>
                )}
              </div>
              {roles && <p className="mt-0.5 text-sm text-gray-500">{roles}</p>}
            </Section>
          )}

          {termsLoading ? (
            <p className="text-sm text-gray-500">Loading the partnership terms…</p>
          ) : (
            <>
              <Section title="What you'll receive">
                <ObligationList
                  items={deliverables}
                  empty="The organizer has not listed anything yet."
                />
              </Section>
              <Section title="What we'll need from you">
                <ObligationList
                  items={requirements}
                  empty="Nothing has been requested from you yet."
                />
              </Section>
            </>
          )}

          <p className="text-xs leading-relaxed text-gray-500">
            This invitation expires on {formatDate(invitation.expires_at)}.
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function ObligationList({ items, empty }: { items: InvitationObligation[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">{empty}</p>
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
      {items.map((item) => {
        const meta = [
          item.category,
          item.quantity !== null ? 'Qty ' + item.quantity : null,
          item.due_date ? 'Due ' + formatDate(item.due_date) : null,
        ].filter(Boolean)
        return (
          <li key={item.id} className="px-3 py-2.5">
            <p className="text-sm font-medium text-gray-900">{item.title}</p>
            {item.description && (
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">{item.description}</p>
            )}
            {meta.length > 0 && (
              <p className="mt-0.5 text-xs text-gray-500">{meta.join(' · ')}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function AcceptedScreen({
  organizationName,
  invitation,
  onHome,
}: {
  organizationName: string | null
  invitation: PartnershipInvitationReview
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
            {organizationName ? (
              <>
                You now represent <strong className="font-semibold">{organizationName}</strong> for{' '}
                {invitation.event_name}.
              </>
            ) : (
              <>
                {invitation.company_name} is confirmed as a partner for {invitation.event_name}.
              </>
            )}
          </p>
          {invitation.responded_at && (
            <p className="mt-1 text-xs text-gray-500">
              Accepted on {formatDate(invitation.responded_at)}
            </p>
          )}
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

export function DeclinedScreen({
  invitation,
  onHome,
}: {
  invitation: PartnershipInvitationReview | null
  onHome: () => void
}) {
  return (
    <Shell>
      <Card>
        <CardContent className="py-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <X className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Invitation Declined</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-600">
            {invitation
              ? 'You declined the invitation to partner with ' +
                (invitation.organizer_organization_name || 'the organizer') +
                ' for ' +
                invitation.event_name +
                '. '
              : ''}
            The organizer can update the partnership and send another invitation if needed.
          </p>
          {invitation?.responded_at && (
            <p className="mt-1 text-xs text-gray-500">
              Declined on {formatDate(invitation.responded_at)}
            </p>
          )}
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
  detail,
  footer,
}: {
  title: string
  body: string
  homePath: string
  /** A short factual line under the body, e.g. when it expired. */
  detail?: string
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
            {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
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

/**
 * "GHS 60,000". The currency is printed as the code the organizer recorded,
 * not as a symbol: Rally does not know the locale of a commercial agreement,
 * and guessing one would misrepresent the amount.
 */
function formatValue(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null
  const fractionDigits = Number.isInteger(amount) ? 0 : 2
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
  return currency ? currency + ' ' + formatted : formatted
}

function formatEventDates(start: string, end: string | null): string {
  if (!end || end === start) return formatDate(start)
  return formatDate(start) + ' – ' + formatDate(end)
}
