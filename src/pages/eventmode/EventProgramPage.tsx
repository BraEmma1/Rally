import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { BookmarkCheck, CalendarRange } from 'lucide-react'
import { useEventModeOutlet } from '@/components/eventmode/EventModeLayout'
import { getEventAgenda } from '@/lib/events'
import { listMySavedSessionIds } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import EventAgendaPage from '@/pages/eventmode/EventAgendaPage'
import EventMySchedulePage from '@/pages/eventmode/EventMySchedulePage'

// Agenda and Schedule are two views of one page: the switch changes the content
// in place, with no navigation. /agenda opens on Agenda and /schedule opens on
// Schedule, so every existing link still lands where it did.

export type ProgramView = 'agenda' | 'schedule'
export type ProgramCounts = { agenda?: number; saved?: number }

function Switcher({ view, onChange, counts }: { view: ProgramView; onChange: (v: ProgramView) => void; counts: ProgramCounts }) {
  const item = (v: ProgramView, label: string, icon: ReactNode, count: number | undefined) => {
    const on = view === v
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => onChange(v)}
        className={cn(
          'flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
          on ? 'bg-white text-primary-700 shadow-card ring-1 ring-rally-line' : 'text-rally-muted hover:bg-white/70 hover:text-rally-navy'
        )}
      >
        {icon} {label}
        {count !== undefined && <span className="rounded-full bg-rally-tint px-2 py-0.5 text-xs text-primary-700">{count}</span>}
      </button>
    )
  }
  return (
    <div role="tablist" aria-label="Agenda or schedule" className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-rally-canvas p-1 ring-1 ring-rally-line">
      {item('agenda', 'Agenda', <CalendarRange className="h-4 w-4" aria-hidden="true" />, counts.agenda)}
      {item('schedule', 'Schedule', <BookmarkCheck className="h-4 w-4" aria-hidden="true" />, counts.saved)}
    </div>
  )
}

export default function EventProgramPage() {
  const { event } = useEventModeOutlet()
  const { pathname } = useLocation()
  const [view, setView] = useState<ProgramView>(pathname.endsWith('/schedule') ? 'schedule' : 'agenda')
  const [counts, setCounts] = useState<ProgramCounts>({})

  // Counts for both labels up front; the visible view keeps them current.
  useEffect(() => {
    let cancelled = false
    void Promise.all([getEventAgenda(event.id), listMySavedSessionIds(event.id)]).then(([a, s]) => {
      if (cancelled) return
      setCounts((c) => ({ agenda: a.error ? c.agenda : a.data.length, saved: s.error ? c.saved : s.data.size }))
    })
    return () => {
      cancelled = true
    }
  }, [event.id])

  // Stable identity, and no state change when nothing differs, so the views'
  // reporting effects cannot loop.
  const report = useCallback((c: ProgramCounts) => {
    setCounts((prev) => {
      const next = { agenda: c.agenda ?? prev.agenda, saved: c.saved ?? prev.saved }
      return next.agenda === prev.agenda && next.saved === prev.saved ? prev : next
    })
  }, [])
  const switcher = <Switcher view={view} onChange={setView} counts={counts} />

  return view === 'agenda' ? (
    <EventAgendaPage switcher={switcher} onCounts={report} />
  ) : (
    <EventMySchedulePage switcher={switcher} onCounts={report} onBrowseAgenda={() => setView('agenda')} />
  )
}
