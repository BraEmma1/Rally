import type { UserAccount } from '@/lib/supabase'

// Where a signed-in user belongs. Account type is authoritative and the types
// are mutually exclusive, so this is a total function over the account — there
// is no "switch to my other role", because there is no other role.
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
