import { ACCOUNT_STATUS_LABELS, ACCOUNT_TYPE_LABELS, supabase } from '@/lib/supabase'
import type {
  AccountChange,
  AccountStatus,
  AccountType,
  AdminAccountRow,
  ProfileName,
  PublicProfile,
} from '@/lib/supabase'

// Read access for the platform admin workspace.
//
// Everything here is authorized by RLS, not by this file. An active platform
// admin may read every user_accounts row (select_own_account) and every
// account_type_changes row (select_account_changes_as_admin); for anyone else
// the same queries return their own row or nothing. Names come from
// get_public_profiles, which returns the public card only — never email or
// phone. No table outside those two is read here, because no other table has a
// policy that lets an admin see it: querying one would return an empty result
// that looks like "no data" when the truth is "no access".

const ACCOUNT_COLUMNS = 'user_id, account_type, status, approved_by, approved_at, created_at, updated_at'
const CHANGE_COLUMNS =
  'id, user_id, changed_by, previous_type, new_type, previous_status, new_status, reason, created_at'

function readableError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message?.trim()
  if (!message) return fallback
  if (/^(permission denied|new row violates|duplicate key|null value|invalid input)/i.test(message)) {
    return fallback
  }
  return message
}

export type AccountMetrics = {
  totalAccounts: number
  activeAttendees: number
  organizers: number
  pendingOrganizers: number
}

// Exact counts, computed by the database (head requests return no rows).
export async function fetchAccountMetrics(): Promise<{ data: AccountMetrics | null; error: string | null }> {
  const count = () => supabase.from('user_accounts').select('user_id', { count: 'exact', head: true })
  const [total, attendees, organizers, pending] = await Promise.all([
    count(),
    count().eq('account_type', 'attendee').eq('status', 'active'),
    count().eq('account_type', 'organizer'),
    count().eq('account_type', 'organizer').eq('status', 'pending_approval'),
  ])
  const failed = [total, attendees, organizers, pending].find((r) => r.error)
  if (failed) return { data: null, error: readableError(failed.error, 'Could not load account metrics.') }
  return {
    data: {
      totalAccounts: total.count ?? 0,
      activeAttendees: attendees.count ?? 0,
      organizers: organizers.count ?? 0,
      pendingOrganizers: pending.count ?? 0,
    },
    error: null,
  }
}

export async function fetchRecentAccounts(limit: number): Promise<{ data: AdminAccountRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select(ACCOUNT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { data: [], error: readableError(error, 'Could not load recent registrations.') }
  return { data: (data ?? []) as AdminAccountRow[], error: null }
}

// Organizer accounts waiting for an admin, oldest first: the queue order.
export async function fetchPendingOrganizers(
  limit: number
): Promise<{ data: AdminAccountRow[]; total: number; error: string | null }> {
  const { data, error, count } = await supabase
    .from('user_accounts')
    .select(ACCOUNT_COLUMNS, { count: 'exact' })
    .eq('account_type', 'organizer')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) return { data: [], total: 0, error: readableError(error, 'Could not load pending approvals.') }
  return { data: (data ?? []) as AdminAccountRow[], total: count ?? 0, error: null }
}

// Newest first, paginated by the database.
export async function fetchAccountChanges(
  page: number,
  pageSize: number
): Promise<{ data: AccountChange[]; total: number; error: string | null }> {
  const from = page * pageSize
  const { data, error, count } = await supabase
    .from('account_type_changes')
    .select(CHANGE_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)
  if (error) return { data: [], total: 0, error: readableError(error, 'Could not load the audit log.') }
  return { data: (data ?? []) as AccountChange[], total: count ?? 0, error: null }
}

export type AccountSort = 'newest' | 'oldest' | 'recently_updated'

export type AccountQuery = {
  type?: AccountType | 'all'
  status?: AccountStatus | 'all'
  sort?: AccountSort
  page: number
  pageSize: number
}

// The user directory, filtered, sorted and paginated by the database so the
// cost stays constant as the account table grows. Names are not searchable
// here: they live in profiles, which an admin can only resolve by id through
// get_public_profiles, so name search runs over the loaded page (see callers).
export async function fetchAccounts(
  query: AccountQuery
): Promise<{ data: AdminAccountRow[]; total: number; error: string | null }> {
  const from = query.page * query.pageSize
  let request = supabase.from('user_accounts').select(ACCOUNT_COLUMNS, { count: 'exact' })
  if (query.type && query.type !== 'all') request = request.eq('account_type', query.type)
  if (query.status && query.status !== 'all') request = request.eq('status', query.status)
  const sort = query.sort ?? 'newest'
  request =
    sort === 'recently_updated'
      ? request.order('updated_at', { ascending: false, nullsFirst: false })
      : request.order('created_at', { ascending: sort === 'oldest' })
  // A stable tiebreaker, so rows do not swap between pages when timestamps tie.
  request = request.order('user_id', { ascending: true })
  const { data, error, count } = await request.range(from, from + query.pageSize - 1)
  if (error) return { data: [], total: 0, error: readableError(error, 'Could not load accounts.') }
  return { data: (data ?? []) as AdminAccountRow[], total: count ?? 0, error: null }
}

export async function fetchAccount(userId: string): Promise<{ data: AdminAccountRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { data: null, error: readableError(error, 'Could not load this account.') }
  return { data: (data as AdminAccountRow | null) ?? null, error: null }
}

// Changes made TO an account, and changes made BY it (non-empty only for an
// administrator), newest first.
export async function fetchAccountHistory(
  userId: string
): Promise<{ about: AccountChange[]; by: AccountChange[]; error: string | null }> {
  const [about, by] = await Promise.all([
    supabase
      .from('account_type_changes')
      .select(CHANGE_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('account_type_changes')
      .select(CHANGE_COLUMNS)
      .eq('changed_by', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  const failed = about.error ?? by.error
  if (failed) return { about: [], by: [], error: readableError(failed, 'Could not load account history.') }
  return { about: (about.data ?? []) as AccountChange[], by: (by.data ?? []) as AccountChange[], error: null }
}

// The full public card for each account: the fields every signed-in user may
// already see on a profile page. Never email or phone.
export async function fetchPublicProfiles(
  ids: (string | null | undefined)[]
): Promise<Record<string, PublicProfile>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))))
  if (unique.length === 0) return {}
  const { data, error } = await supabase.rpc('get_public_profiles', { profile_ids: unique })
  if (error || !data) return {}
  const profiles: Record<string, PublicProfile> = {}
  for (const row of data as PublicProfile[]) profiles[row.id] = row
  return profiles
}

// ---------------------------------------------------------------------------
// Account status changes
// ---------------------------------------------------------------------------
export type StatusAction = 'approve' | 'reactivate' | 'suspend'

export const STATUS_ACTION_TARGET: Record<StatusAction, AccountStatus> = {
  approve: 'active',
  reactivate: 'active',
  suspend: 'suspended',
}

// Which status action the interface may offer for an account. The database is
// the authority — set_account_status refuses non-admins and self-changes — but
// the interface must not offer an action that would be wrong even if allowed:
// "approve" exists only for a pending organizer, and nothing is offered on the
// admin's own account.
export function availableStatusActions(account: AdminAccountRow, selfId: string | undefined): StatusAction[] {
  if (!selfId || account.user_id === selfId) return []
  if (account.status === 'pending_approval') return account.account_type === 'organizer' ? ['approve'] : []
  if (account.status === 'active') return ['suspend']
  if (account.status === 'suspended') return ['reactivate']
  return []
}

// Applies a status change through the existing administrator function.
//
// set_account_status does not check the account's current state, so the row is
// re-read first: if another administrator changed it since this screen loaded,
// the change is refused here rather than applied to a state nobody reviewed.
// That check narrows the window; it does not replace the database's own
// authorization, which runs again inside the function.
export async function changeAccountStatus(
  account: AdminAccountRow,
  action: StatusAction,
  reason: string
): Promise<{ error: string | null }> {
  const { data: current, error: readError } = await fetchAccount(account.user_id)
  if (readError) return { error: readError }
  if (!current) return { error: 'This account no longer exists.' }
  if (current.account_type !== account.account_type || current.status !== account.status) {
    return { error: 'This account changed since you opened it. Refresh and review it again.' }
  }
  if (action === 'approve' && !(current.account_type === 'organizer' && current.status === 'pending_approval')) {
    return { error: 'Only a pending organizer can be approved.' }
  }

  const { error } = await supabase.rpc('set_account_status', {
    target_user_id: account.user_id,
    new_status: STATUS_ACTION_TARGET[action],
    reason: reason.trim(),
  })
  if (error) return { error: readableError(error, 'The account could not be updated.') }
  notifyAccountsChanged()
  return { error: null }
}

// Lets the action-items menu and other open views refresh after a change made
// elsewhere in the workspace, without a global store.
export const ACCOUNTS_CHANGED_EVENT = 'rally:admin-accounts-changed'

export function notifyAccountsChanged() {
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED_EVENT))
}

// Resolves display names for a set of accounts. A missing entry means the
// account has no profile card; callers show a neutral placeholder.
export async function fetchProfileNames(ids: (string | null | undefined)[]): Promise<Record<string, ProfileName>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))))
  if (unique.length === 0) return {}
  const { data, error } = await supabase.rpc('get_public_profiles', { profile_ids: unique })
  if (error || !data) return {}
  const names: Record<string, ProfileName> = {}
  for (const row of data as ProfileName[]) names[row.id] = row
  return names
}

export type ChangeKind = 'type' | 'status' | 'type_and_status' | 'none'

export function changeKind(change: AccountChange): ChangeKind {
  const typeChanged = change.previous_type !== change.new_type
  const statusChanged = change.previous_status !== change.new_status
  if (typeChanged && statusChanged) return 'type_and_status'
  if (typeChanged) return 'type'
  if (statusChanged) return 'status'
  return 'none'
}

export function changeTitle(change: AccountChange): string {
  const kind = changeKind(change)
  if (kind === 'type') return 'Account type changed'
  if (kind === 'status') {
    if (change.new_status === 'active') {
      return change.previous_status === 'pending_approval' ? 'Account approved' : 'Account reactivated'
    }
    return change.new_status === 'suspended' ? 'Account suspended' : 'Account status changed'
  }
  if (kind === 'type_and_status') return 'Type and status changed'
  return 'Recorded without a change'
}

export function describeChange(change: AccountChange): string {
  const kind = changeKind(change)
  const type = (t: AccountChange['new_type']) => (t ? ACCOUNT_TYPE_LABELS[t] : '—')
  const status = (s: AccountChange['new_status']) => (s ? ACCOUNT_STATUS_LABELS[s] : '—')
  if (kind === 'type') return `Type: ${type(change.previous_type)} → ${type(change.new_type)}`
  if (kind === 'status') return `Status: ${status(change.previous_status)} → ${status(change.new_status)}`
  if (kind === 'type_and_status') {
    return `Type ${type(change.previous_type)} → ${type(change.new_type)}; status ${status(change.previous_status)} → ${status(change.new_status)}`
  }
  return 'No type or status change recorded'
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
