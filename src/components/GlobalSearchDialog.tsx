import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, User, Building2, CalendarDays, Users } from 'lucide-react'
import { supabase, type Connection, type EventRow } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

interface SearchResults {
  people: Connection[]
  companies: string[]
  events: EventRow[]
}

const EMPTY: SearchResults = { people: [], companies: [], events: [] }

export default function GlobalSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(EMPTY)
      setError(null)
      inputRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Body scroll lock
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const trimmed = query.trim()

  // Global search runs against data the signed-in user is already allowed to
  // read: their own connections (people + companies) and visible events. The
  // profiles table itself is not searchable by design (RLS revokes broad
  // reads), so discovery of new people is limited to events for now.
  useEffect(() => {
    if (!open || !user) return
    if (trimmed.length < 2) {
      setResults(EMPTY)
      setError(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      const like = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`
      const [peopleRes, eventsRes] = await Promise.all([
        supabase
          .from('connections')
          .select('*')
          .or(`full_name.ilike.${like},company.ilike.${like}`)
          .limit(8),
        supabase
          .from('events')
          .select('*')
          .ilike('name', like)
          .limit(5),
      ])
      if (cancelled) return
      setLoading(false)
      if (peopleRes.error || eventsRes.error) {
        setError('Search is unavailable right now. Please try again.')
        return
      }
      const people = (peopleRes.data as Connection[]) ?? []
      const events = (eventsRes.data as EventRow[]) ?? []
      const companySet = new Set<string>()
      people.forEach((p) => {
        const c = p.company?.trim()
        if (c && c.toLowerCase().includes(trimmed.toLowerCase())) companySet.add(c)
      })
      setResults({ people, companies: [...companySet].slice(0, 4), events })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [trimmed, open, user])

  const hasResults = useMemo(
    () => results.people.length > 0 || results.companies.length > 0 || results.events.length > 0,
    [results]
  )

  if (!open) return null

  function go(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search Rally">
      <div className="absolute inset-0 bg-gray-900/50" onClick={onClose} aria-hidden="true" />
      <div
        className={cn(
          'relative mx-auto flex max-h-[85vh] w-full flex-col bg-white shadow-xl',
          'md:mt-20 md:max-w-xl md:rounded-lg'
        )}
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connections, companies, events…"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400"
            aria-label="Search query"
          />
          <button
            onClick={onClose}
            aria-label="Close search"
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-6 text-center text-sm text-gray-500">Searching…</p>}

          {!loading && error && (
            <p className="px-4 py-6 text-center text-sm text-error-600">{error}</p>
          )}

          {!loading && !error && trimmed.length < 2 && (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              Type at least two characters to search your network and events.
            </p>
          )}

          {!loading && !error && trimmed.length >= 2 && !hasResults && (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              No matches for “{trimmed}”.
            </p>
          )}

          {!loading && results.people.length > 0 && (
            <div role="group" aria-label="People">
              <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                My Connections
              </p>
              {results.people.map((p) => (
                <button
                  key={p.id}
                  onClick={() => go(`/connections/${p.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-primary-50"
                >
                  <Avatar name={p.full_name || '?'} src={p.photo_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{p.full_name || 'Unknown'}</p>
                    <p className="truncate text-xs text-gray-500">
                      {[p.job_title, p.company].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <User className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          {!loading && results.companies.length > 0 && (
            <div role="group" aria-label="Companies">
              <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Companies
              </p>
              {results.companies.map((c) => (
                <button
                  key={c}
                  onClick={() => go('/connections')}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-primary-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{c}</span>
                </button>
              ))}
            </div>
          )}

          {!loading && results.events.length > 0 && (
            <div role="group" aria-label="Events">
              <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Events
              </p>
              {results.events.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => go(`/events/${ev.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-primary-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{ev.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-2 text-xs text-gray-400">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          Searching your connections and events
        </div>
      </div>
    </div>
  )
}
