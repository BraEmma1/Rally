import {
  BarChart3,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Handshake,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
} from 'lucide-react'

export type AdminNavItem = {
  to: string
  label: string
  icon: typeof Users
  end?: boolean
  // false = the page exists but its functionality has not shipped yet; the
  // sidebar marks it so nobody mistakes an informational page for a live one.
  available: boolean
}

export const ADMIN_NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, available: true },
  { to: '/admin/approvals', label: 'Approvals', icon: ClipboardCheck, available: true },
  { to: '/admin/users', label: 'Users', icon: Users, available: true },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2, available: false },
  { to: '/admin/events', label: 'Events', icon: CalendarRange, available: false },
  { to: '/admin/partnerships', label: 'Partnerships', icon: Handshake, available: false },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, available: false },
  { to: '/admin/audit-logs', label: 'Audit logs', icon: ScrollText, available: true },
  { to: '/admin/settings', label: 'Settings', icon: Settings, available: true },
]

export function adminPageTitle(pathname: string): string {
  const match = ADMIN_NAV.filter((item) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)
  ).sort((a, b) => b.to.length - a.to.length)[0]
  return match?.label ?? 'Administration'
}
