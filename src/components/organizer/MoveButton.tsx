import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// A 44px up/down button for a reorderable list, used by the package list and a
// package's deliverables, at every screen width.
//
// The first item cannot move up and the last cannot move down. That is marked
// with aria-disabled rather than the disabled attribute on purpose: moving an
// item to the top makes its own "up" button the edge one, and a natively
// disabled button drops keyboard focus to the page. aria-disabled keeps focus
// where it was, is still announced as unavailable, and the press does nothing.
// ---------------------------------------------------------------------------
export function MoveButton({
  label,
  atEdge,
  onMove,
  children,
}: {
  label: string
  atEdge: boolean
  onMove: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={atEdge || undefined}
      onClick={() => {
        if (!atEdge) onMove()
      }}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600 aria-disabled:cursor-default aria-disabled:text-gray-300 aria-disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
