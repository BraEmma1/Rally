import { useState } from 'react'
import { Bell, Building2, CalendarDays, ChevronDown, CircleHelp, Grid2X2, Home, LogOut, Menu, MessageCircle, Search, Settings, Users, X } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { Avatar } from '@/components/ui/Avatar'
import SponsorBottomNav from '@/components/SponsorBottomNav'
import { cn } from '@/lib/utils'

const primaryItems = [
  { label: 'Home', icon: Home, active: true },
  { label: 'Partnerships', icon: Grid2X2 },
  { label: 'Network', icon: Users },
  { label: 'Messages', icon: MessageCircle, to: '/messages' },
  { label: 'Meetings', icon: CalendarDays },
]

export default function SponsorLayout() {
  const { profile, user, account, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const displayName = profile?.full_name || user?.email || 'Rally member'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#f7faff] text-slate-900">
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200 bg-white transition-[width] duration-200 md:flex md:flex-col', sidebarCollapsed ? 'w-16' : 'w-60')}>
        <div className={cn('flex h-16 shrink-0 items-center border-b border-slate-200', sidebarCollapsed ? 'justify-center' : 'gap-2 px-5')}>
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
          {!sidebarCollapsed && <><span className="text-xl font-bold tracking-tight text-slate-900">Rally</span><span className="rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">Sponsor</span></>}
        </div>
        <nav aria-label="Sponsor workspace" className={cn('flex-1 space-y-1 py-5', sidebarCollapsed ? 'px-2' : 'px-3')}>
          {primaryItems.map((item) => item.to ? (
            <NavLink key={item.label} to={item.to} className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium', sidebarCollapsed && 'justify-center px-0', isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')} title={sidebarCollapsed ? item.label : undefined}>
              <item.icon className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'sr-only' : undefined}>{item.label}</span>
            </NavLink>
          ) : (
            <button key={item.label} type="button" disabled={!item.active} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium', sidebarCollapsed && 'justify-center px-0', item.active ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-slate-50', !item.active && 'cursor-default')} title={sidebarCollapsed ? item.label : undefined}>
              <item.icon className="h-4 w-4 shrink-0" /><span className={sidebarCollapsed ? 'sr-only' : undefined}>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className={cn('border-t border-slate-200 p-3', sidebarCollapsed && 'px-2')}>
          {!sidebarCollapsed && <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workspace</p>}
          {[['Organization', Building2], ['Settings', Settings], ['Support', CircleHelp]].map(([label, Icon]) => <button key={String(label)} type="button" disabled className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-500', sidebarCollapsed && 'justify-center px-0')} title={sidebarCollapsed ? String(label) : undefined}><Icon className="h-4 w-4" /><span className={sidebarCollapsed ? 'sr-only' : undefined}>{String(label)}</span></button>)}
          <button type="button" onClick={() => void handleSignOut()} className={cn('mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900', sidebarCollapsed && 'justify-center px-0')}><LogOut className="h-4 w-4" /><span className={sidebarCollapsed ? 'sr-only' : undefined}>Sign out</span></button>
        </div>
      </aside>

      <header className={cn('sticky top-0 z-20 hidden h-16 items-center border-b border-slate-200 bg-white px-6 md:flex', sidebarCollapsed ? 'md:pl-20' : 'md:pl-64')}>
        <div className="flex flex-1 justify-center"><div className="flex h-10 w-full max-w-xl items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm text-slate-400"><Search className="h-4 w-4" />Search events, partnerships…</div></div>
        <button type="button" onClick={() => navigate('/notifications')} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} className="relative ml-6 rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"><Bell className="h-5 w-5" />{unreadCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-error-600" />}</button>
        <div className="ml-4 flex items-center gap-2 border-l border-slate-200 pl-4"><Avatar name={displayName} src={profile?.photo_url} size="sm" /><div className="max-w-36"><p className="truncate text-sm font-semibold text-slate-800">{displayName}</p><p className="text-xs text-slate-500">Sponsor</p></div><ChevronDown className="h-4 w-4 text-slate-400" /></div>
        <button type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} className="ml-3 rounded-md p-2 text-slate-500 hover:bg-slate-100"><Menu className="h-4 w-4" /></button>
      </header>

      <div className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <div className="flex min-w-0 items-center"><img src="/favicon.svg" alt="" aria-hidden="true" className="h-8 w-8" /><span className="ml-2 text-[19px] font-bold text-slate-900">Rally</span><span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">Sponsor</span></div>
        <div className="flex items-center"><button type="button" onClick={() => navigate('/notifications')} aria-label="Notifications" className="rounded-full p-2.5 text-slate-600 hover:bg-slate-100"><Bell className="h-5 w-5" />{unreadCount > 0 && <span className="absolute" />}</button><Avatar name={displayName} src={profile?.photo_url} size="sm" className="ml-1 h-9 w-9" /></div>
      </div>

      <main className={cn('pb-20 md:pb-0', sidebarCollapsed ? 'md:pl-16' : 'md:pl-60')}><div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 md:px-8 md:py-8"><Outlet /></div></main>
      <SponsorBottomNav onMore={() => setMoreOpen(true)} />
      {moreOpen && <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More sponsor options"><button type="button" onClick={() => setMoreOpen(false)} className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" /><div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"><div className="mb-4 flex items-center justify-between"><p className="font-semibold text-slate-900">More</p><button type="button" onClick={() => setMoreOpen(false)} aria-label="Close more menu" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>{account?.account_type === 'attendee' && <button type="button" onClick={() => { setMoreOpen(false); navigate('/dashboard') }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">Back to My Rally</button>}<button type="button" onClick={() => void handleSignOut()} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"><LogOut className="h-4 w-4" />Sign out</button></div></div>}
    </div>
  )
}
