import { LayoutGrid, List } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ViewMode = 'grid' | 'list'

interface ViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

// Grid / list switch. Both buttons are always visible and announce which one
// is pressed.
export function ViewToggle({ value, onChange }: ViewToggleProps) {
  const item = (mode: ViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={value === mode}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
        value === mode ? 'bg-white text-primary-700 shadow-card' : 'text-rally-muted hover:text-rally-navy'
      )}
    >
      {icon}
    </button>
  )
  return (
    <div role="group" aria-label="Layout" className="flex items-center gap-1 rounded-xl bg-rally-tint p-1">
      {item('grid', 'Grid view', <LayoutGrid className="h-4 w-4" aria-hidden="true" />)}
      {item('list', 'List view', <List className="h-4 w-4" aria-hidden="true" />)}
    </div>
  )
}
