import { ACCOUNT_STATUS_LABELS, ACCOUNT_TYPE_LABELS, supabase } from '@/lib/supabase'
import type { AccountChange, AdminAccountRow, ProfileName } from '@/lib/supabase'

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

export async function fetchOwnAccount(userId: string): Promise<{ data: AdminAccountRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { data: null, error: readableError(error, 'Could not load your account.') }
  return { data: (data as AdminAccountRow | null) ?? null, error: null }
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
