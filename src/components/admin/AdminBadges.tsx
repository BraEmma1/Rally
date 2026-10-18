import { Badge } from '@/components/ui/Badge'
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  type AccountStatus,
  type AccountType,
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
