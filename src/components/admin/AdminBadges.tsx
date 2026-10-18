import { Badge } from '@/components/ui/Badge'
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  ORG_APPROVAL_LABELS,
  ORG_TYPE_LABELS,
  type AccountStatus,
  type AccountType,
  type AdminOrganizationEvent,
  type OrgApprovalStatus,
  type OrgType,
} from '@/lib/supabase'

const STATUS_VARIANT: Record<AccountStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  pending_approval: 'warning',
  suspended: 'error',
}

export function AccountStatusBadge({ status }: { status: AccountStatus | null }) {
  if (!status) return <span className="text-gray-400">—</span>
  return <Badge variant={STATUS_VARIANT[status]}>{ACCOUNT_STATUS_LABELS[status]}</Badge>
}

export function AccountTypeBadge({ type }: { type: AccountType | null }) {
  if (!type) return <span className="text-gray-400">—</span>
  return <Badge variant={type === 'platform_admin' ? 'primary' : 'default'}>{ACCOUNT_TYPE_LABELS[type]}</Badge>
}

const APPROVAL_VARIANT: Record<OrgApprovalStatus, 'success' | 'warning' | 'error' | 'gray'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  suspended: 'error',
}

export function OrgApprovalBadge({ status }: { status: OrgApprovalStatus | null }) {
  if (!status) return <span className="text-gray-400">—</span>
  return <Badge variant={APPROVAL_VARIANT[status]}>{ORG_APPROVAL_LABELS[status]}</Badge>
}

export function OrgTypeBadge({ type }: { type: OrgType | null }) {
  if (!type) return <span className="text-gray-400">—</span>
  return <Badge variant={type === 'organizer' ? 'primary' : 'default'}>{ORG_TYPE_LABELS[type]}</Badge>
}

const VISIBILITY_SHORT: Record<AdminOrganizationEvent['visibility'], string> = {
  draft: 'Draft',
  published: 'Published',
  unlisted: 'Unlisted',
}

const EVENT_STATUS_SHORT: Record<AdminOrganizationEvent['status'], string> = {
  upcoming: 'Upcoming',
  live: 'Live',
  past: 'Past',
}

export function EventVisibilityBadge({ visibility }: { visibility: AdminOrganizationEvent['visibility'] }) {
  return (
    <Badge variant={visibility === 'published' ? 'success' : visibility === 'draft' ? 'gray' : 'default'}>
      {VISIBILITY_SHORT[visibility] ?? visibility}
    </Badge>
  )
}

export function EventStatusBadge({ status }: { status: AdminOrganizationEvent['status'] }) {
  return (
    <Badge variant={status === 'live' ? 'primary' : status === 'past' ? 'gray' : 'default'}>
      {EVENT_STATUS_SHORT[status] ?? status}
    </Badge>
  )
}

export function ArchivedBadge() {
  return <Badge variant="gray">Archived</Badge>
}
