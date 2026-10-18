import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { AccountStatusBadge, AccountTypeBadge } from '@/components/admin/AdminBadges'
import { changeTitle, describeChange, formatDateTime } from '@/lib/admin'
import type { AccountChange, AdminAccountRow, ProfileName, PublicProfile } from '@/lib/supabase'
import { displayUrl, normalizeUrl } from '@/lib/utils'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-gray-900 sm:col-span-2">{children}</dd>
    </div>
  )
}

const notProvided = <span className="text-gray-400">Not provided</span>

function text(value: string | null | undefined): ReactNode {
  return value?.trim() ? value.trim() : notProvided
}

function link(value: string | null | undefined): ReactNode {
  const url = normalizeUrl(value)
  if (!url) return notProvided
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700">
      {displayUrl(url)}
    </a>
  )
}

export function displayNameFor(profile: Pick<PublicProfile, 'full_name'> | undefined): string {
  return profile?.full_name?.trim() || 'Unnamed account'
}

// The header of an account: who it is, as far as the public card says.
export function AccountIdentity({ account, profile }: { account: AdminAccountRow; profile?: PublicProfile }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={displayNameFor(profile)} src={profile?.photo_url || undefined} size="lg" className="shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold text-gray-900">{displayNameFor(profile)}</p>
        <p className="truncate font-mono text-xs text-gray-400">{account.user_id}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <AccountTypeBadge type={account.account_type} />
          <AccountStatusBadge status={account.status} />
        </div>
      </div>
    </div>
  )
}

// Account facts from user_accounts. Approval information is shown only when it
// exists; an approver of NULL with a date means operator SQL, not a person.
export function AccountFacts({ account, names }: { account: AdminAccountRow; names: Record<string, ProfileName> }) {
  const approver = account.approved_by
    ? names[account.approved_by]?.full_name?.trim() || account.approved_by.slice(0, 8)
    : account.approved_at
      ? 'Operator (direct SQL)'
      : null
  return (
    <dl className="divide-y divide-gray-100">
      <Field label="Registered">{formatDateTime(account.created_at)}</Field>
      <Field label="Last account change">{formatDateTime(account.updated_at)}</Field>
      <Field label="Approved">{account.approved_at ? formatDateTime(account.approved_at) : <span className="text-gray-400">Not approved</span>}</Field>
      {approver && <Field label="Approved by">{approver}</Field>}
    </dl>
  )
}

// The public card fields. Email and phone are not part of it and are not
// readable by administrators.
export function PublicProfileFields({ profile }: { profile?: PublicProfile }) {
  if (!profile) {
    return <p className="text-sm text-gray-500">This account has no public profile card.</p>
  }
  return (
    <dl className="divide-y divide-gray-100">
      <Field label="Job title">{text(profile.job_title)}</Field>
      <Field label="Company">{text(profile.company)}</Field>
      <Field label="Industry">{text(profile.industry)}</Field>
      <Field label="Location">{text(profile.location)}</Field>
      <Field label="About">{text(profile.bio)}</Field>
      <Field label="Website">{link(profile.website)}</Field>
      <Field label="LinkedIn">{link(profile.linkedin)}</Field>
    </dl>
  )
}

export function AccountHistory({
  changes,
  names,
  emptyText,
  showTarget,
}: {
  changes: AccountChange[]
  names: Record<string, ProfileName>
  emptyText: string
  showTarget?: boolean
}) {
  if (changes.length === 0) return <p className="text-sm text-gray-500">{emptyText}</p>
  return (
    <ol className="space-y-3">
      {changes.map((change) => (
        <li key={change.id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-gray-900">{changeTitle(change)}</p>
            <span className="text-xs text-gray-500">{formatDateTime(change.created_at)}</span>
          </div>
          <p className="mt-0.5 text-sm text-gray-700">{describeChange(change)}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {showTarget && <>Account: {names[change.user_id]?.full_name?.trim() || change.user_id.slice(0, 8)} · </>}
            By{' '}
            {change.changed_by
              ? names[change.changed_by]?.full_name?.trim() || change.changed_by.slice(0, 8)
              : 'operator (direct SQL)'}
            {change.reason?.trim() ? ` · “${change.reason.trim()}”` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
