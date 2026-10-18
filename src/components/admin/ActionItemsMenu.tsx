import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, RefreshCw } from 'lucide-react'
import { Spinner } from '@/components/ui/States'
import { PersonCell } from '@/components/admin/PersonCell'
import { fetchPendingOrganizers, fetchProfileNames, formatDateTime } from '@/lib/admin'
import type { AdminAccountRow, ProfileName } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Admin "notifications" are derived, not stored: the notifications table is
// strictly per-user, so there is no admin-wide feed to read. This lists what
// needs an admin right now, straight from user_accounts, and refreshes when
// opened or on request. Pending organization reviews join it once an
// admin-readable organization source exists.
const PREVIEW = 5

export function ActionItemsMenu() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<AdminAccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [names, setNames] = useState<Record<string, ProfileName>>({})
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, total: count, error: loadError } = await fetchPendingOrganizers(PREVIEW)
    setError(loadError)
    setPending(data)
    setTotal(count)
    setNames(await fetchProfileNames(data.map((row) => row.user_id)))
    setCheckedAt(new Date().toISOString())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open) return
    void load()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, load])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={total > 0 ? `Action items, ${total} pending` : 'Action items'}
        className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning-600 px-1 text-[10px] font-semibold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Action items"
          className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Action items</p>
              <p className="text-xs text-gray-500">
                {checkedAt ? `Checked ${formatDateTime(checkedAt)}` : 'Live from the database'}
              </p>
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
              Refresh
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto" aria-live="polite">
            {loading && pending.length === 0 ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : error ? (
              <p className="px-4 py-4 text-sm text-error-700">{error}</p>
            ) : total === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">Nothing needs your attention.</p>
            ) : (
              <>
                <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Organizer approvals · {total}
                </p>
                <ul className="divide-y divide-gray-100">
                  {pending.map((row) => (
                    <li key={row.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <PersonCell id={row.user_id} names={names} />
                      <span className="shrink-0 text-xs text-gray-500">{formatDateTime(row.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {total > 0 && (
            <div className="border-t border-gray-200 px-4 py-2.5">
              <Link
                to="/admin/approvals"
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                {total > pending.length ? `View all ${total} in Approvals` : 'Go to Approvals'}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
