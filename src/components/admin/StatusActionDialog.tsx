import { useState } from 'react'
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog'
import { changeAccountStatus, type StatusAction } from '@/lib/admin'
import { ACCOUNT_TYPE_LABELS, type AdminAccountRow } from '@/lib/supabase'

export const STATUS_ACTION_LABELS: Record<StatusAction, string> = {
  approve: 'Approve organizer',
  reactivate: 'Reactivate account',
  suspend: 'Suspend account',
}

const DONE_MESSAGES: Record<StatusAction, string> = {
  approve: 'approved',
  reactivate: 'reactivated',
  suspend: 'suspended',
}

// What happens, stated before it happens. Consequences come from how the
// backend actually behaves: account_is_active() gates almost every policy, so a
// status change takes effect on the account's next request.
function Consequences({ action, account }: { action: StatusAction; account: AdminAccountRow }) {
  if (action === 'approve') {
    return (
      <>
        <p>
          This organizer will become <strong>active</strong>. They can create an organization and use organizer
          features straight away.
        </p>
        <p>The approval, your name and the reason are recorded in the audit log.</p>
      </>
    )
  }
  if (action === 'suspend') {
    return (
      <>
        <p>
          This {ACCOUNT_TYPE_LABELS[account.account_type].toLowerCase()} account will be <strong>suspended</strong>.
          They lose access across Rally on their next request. Nothing is deleted, and it can be reactivated later.
        </p>
        {account.account_type === 'platform_admin' && (
          <p className="font-medium text-error-700">
            This is a platform administrator. They will lose all administrative access.
          </p>
        )}
        <p>The change is recorded in the audit log.</p>
      </>
    )
  }
  return (
    <>
      <p>
        This account will be <strong>active</strong> again, with the access its account type allows.
      </p>
      {account.account_type === 'organizer' && !account.approved_at && (
        <p className="font-medium text-warning-700">
          This organizer was never approved. Reactivating also gives them organizer access.
        </p>
      )}
      <p>The change is recorded in the audit log.</p>
    </>
  )
}

export function StatusActionDialog({
  account,
  action,
  displayName,
  onCancel,
  onDone,
}: {
  account: AdminAccountRow
  action: StatusAction
  displayName: string
  onCancel: () => void
  onDone: (message: string) => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    const { error: changeError } = await changeAccountStatus(account, action, reason)
    if (changeError) {
      setError(changeError)
      setBusy(false)
      return
    }
    onDone(`${displayName} was ${DONE_MESSAGES[action]}.`)
  }

  return (
    <AdminConfirmDialog
      title={`${STATUS_ACTION_LABELS[action]}: ${displayName}`}
      confirmLabel={STATUS_ACTION_LABELS[action]}
      tone={action === 'suspend' ? 'danger' : 'primary'}
      reason={reason}
      onReasonChange={setReason}
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    >
      <Consequences action={action} account={account} />
    </AdminConfirmDialog>
  )
}
