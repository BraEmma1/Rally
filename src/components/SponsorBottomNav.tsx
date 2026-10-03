import { Grid2X2, Home, Menu, MessageCircle, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

export default function SponsorBottomNav({ onMore }: { onMore: () => void }) {
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-[52px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600',
      isActive ? 'text-primary-600' : 'text-gray-500 hover:text-gray-800'
    )

  return (
    <nav aria-label="Sponsor workspace" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <NavLink to="/sponsor" end className={itemClass} aria-label="Home">
        {({ isActive }) => <><Home className={cn('h-5 w-5', isActive && 'fill-primary-100')} /><span className={isActive ? 'font-semibold' : undefined}>Home</span></>}
      </NavLink>
      <NavLink to="/sponsor/partnerships" className={itemClass} aria-label="Partnerships">
        {({ isActive }) => <><Grid2X2 className={cn('h-5 w-5', isActive && 'fill-primary-100')} /><span className={isActive ? 'font-semibold' : undefined}>Partnerships</span></>}
      </NavLink>
      <button type="button" disabled className={itemClass({ isActive: false })} aria-label="Network, coming soon">
        <Users className="h-5 w-5" /><span>Network</span>
      </button>
      <NavLink to="/messages" className={itemClass} aria-label="Messages">
        <MessageCircle className="h-5 w-5" /><span>Messages</span>
      </NavLink>
      <button type="button" onClick={onMore} className={itemClass({ isActive: false })} aria-label="More menu">
        <Menu className="h-5 w-5" /><span>More</span>
      </button>
    </nav>
  )
}
