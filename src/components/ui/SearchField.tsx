import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  className?: string
}

// 44px search input used in filter panels.
export function SearchField({ value, onChange, placeholder, label, className }: SearchFieldProps) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-rally-tint"
      />
    </label>
  )
}
