import type { UserAccount } from '@/lib/supabase'

// Where a signed-in user belongs. Account type is authoritative for the
// primary experience — attendee, organizer or platform admin — and the types
// are mutually exclusive.
//
// Separately from the account type, a person of any type may hold active
// organization memberships (an attendee on a team, most commonly). That grants
// access to the organization area without changing where their account points,
// so membership-based gating lives in the route guards, not here.
//
// Anything that is not an active attendee, organizer or platform admin lands on
// /account, which explains the specific situation: awaiting approval, suspended,
// or a type whose experience Rally has not built yet.
export function accountHomePath(account: UserAccount | null): string {
  if (!account) return '/account'
  if (account.status !== 'active') return '/account'
  switch (account.account_type) {
    case 'attendee':
      return '/dashboard'
    case 'organizer':
      return '/organizer'
    case 'platform_admin':
      return '/admin'
    default:
      return '/account'
  }
}

export function isActiveOrganizer(account: UserAccount | null): boolean {
  return account?.account_type === 'organizer' && account.status === 'active'
}

export function isActiveAttendee(account: UserAccount | null): boolean {
  return account?.account_type === 'attendee' && account.status === 'active'
}

export function isActivePlatformAdmin(account: UserAccount | null): boolean {
  return account?.account_type === 'platform_admin' && account.status === 'active'
}
