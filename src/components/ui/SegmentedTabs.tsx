import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedTab<K extends string> {
  key: K
  label: string
  icon?: ReactNode
  // Only pass a count that is real. A zero is hidden rather than shown.
  count?: number
  countTone?: 'primary' | 'alert'
}

interface SegmentedTabsProps<K extends string> {
  tabs: SegmentedTab<K>[]
  value: K
  onChange: (key: K) => void
  label: string
  className?: string
}

// Pill-style tab strip. Scrolls sideways instead of wrapping on narrow
// screens so every tab stays a 44px-high touch target.
export function SegmentedTabs<K extends string>({ tabs, value, onChange, label, className }: SegmentedTabsProps<K>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex max-w-full gap-1 overflow-x-auto rounded-xl border border-rally-line bg-white p-1 shadow-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm sm:gap-2 sm:px-4 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
              selected ? 'bg-primary-600 text-white' : 'text-rally-muted hover:bg-rally-tint hover:text-rally-navy'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none',
                  tab.countTone === 'alert'
                    ? 'bg-error-600 text-white'
                    : selected
                      ? 'bg-white/20 text-white'
                      : 'bg-rally-tint text-primary-700'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
