import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronsUpDown, RefreshCw, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOrganizer } from '@/context/OrganizerContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { cn, initials } from '@/lib/utils'
import {
  pathAfterSwitch,
  workspaceEntries,
  type OrganizationWorkspace,
  type WorkspaceEntry,
} from '@/lib/workspaces'

// The workspace switcher: Personal (when the account has a personal space) and
// every organization the person belongs to, from get_my_organization_access.
//
// It changes two things and nothing else: the selected organization in
// OrganizerContext (the one source of truth) and the URL. Whether the person may
// do anything in the workspace they pick is decided by the database on every
// request, exactly as it was before the switcher existed. There is no list of
// organizations here other than the person's own memberships.

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function useWorkspaceSwitcher() {
  const { account, profile, user } = useAuth()
  const {
    memberships,
    organization,
    loading,
    refreshing,
    revalidationError,
    selectOrganization,
    revalidate,
  } = useOrganizer()
  const navigate = useNavigate()
  const location = useLocation()

  const entries = useMemo(() => workspaceEntries(memberships, account), [memberships, account])
  const current = useMemo<OrganizationWorkspace | null>(() => {
    if (!organization) return null
    const match = entries.find((e) => e.kind === 'organization' && e.id === organization.id)
    return (match as OrganizationWorkspace | undefined) ?? null
  }, [entries, organization])

  const select = useCallback(
    (entry: WorkspaceEntry) => {
      if (entry.kind === 'personal') {
        navigate(entry.path)
        return
      }
      if (organization && entry.id === organization.id) return
      // One render: the page for the previous organization unmounts (the
      // organizer area keys its pages by organization) and the new
      // organization's section loads with an empty slate.
      navigate(pathAfterSwitch(location.pathname))
      selectOrganization(entry.id)
    },
    [navigate, location.pathname, organization, selectOrganization]
  )

  return {
    entries,
    current,
    // More than one place to go. A single organization and no personal space
    // is shown as an identity, not as a control that does nothing.
    switchable: entries.length > 1,
    loading,
    checking: refreshing,
    revalidationError,
    revalidate,
    select,
    personName: profile?.full_name || user?.email || 'You',
    personPhoto: profile?.photo_url ?? null,
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const MARK_SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
}

// An organization's logo, or its initials. Square, so organizations never look
// like people (people are round avatars).
export function OrganizationMark({
  name,
  logoUrl,
  size = 'md',
  className,
}: {
  name: string
  logoUrl: string | null
  size?: keyof typeof MARK_SIZES
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [logoUrl])
  if (logoUrl && /^https?:\/\//i.test(logoUrl) && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-md bg-white object-cover ring-1 ring-gray-200', MARK_SIZES[size], className)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-primary-50 font-semibold text-primary-700',
        MARK_SIZES[size],
        className
      )}
    >
      {initials(name)}
    </span>
  )
}

// The selected organization, as the header shows it.
export function WorkspaceIdentity({ className }: { className?: string }) {
  const { current } = useWorkspaceSwitcher()
  if (!current) {
    return <span className={cn('truncate text-sm font-semibold text-gray-900', className)}>Organizer workspace</span>
  }
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} data-testid="workspace-identity">
      <OrganizationMark name={current.name} logoUrl={current.logoUrl} />
      <span className="truncate text-sm font-semibold text-gray-900">{current.name}</span>
      <Badge variant="gray" className="hidden shrink-0 lg:inline-flex">
        {current.roleLabel}
      </Badge>
      {current.archived && (
        <Badge variant="warning" className="shrink-0">
          Archived
        </Badge>
      )}
    </div>
  )
}

type Semantics = 'menu' | 'list'

function EntryRow({
  entry,
  selected,
  semantics,
  personName,
  personPhoto,
  onSelect,
}: {
  entry: WorkspaceEntry
  selected: boolean
  semantics: Semantics
  personName: string
  personPhoto: string | null
  onSelect: (entry: WorkspaceEntry) => void
}) {
  const label =
    entry.kind === 'personal'
      ? `Personal, ${personName}`
      : `${entry.name}, ${entry.roleLabel}${entry.archived ? ', archived' : ''}`
  const a11y =
    semantics === 'menu'
      ? { role: 'menuitemradio', 'aria-checked': selected, tabIndex: -1 }
      : { 'aria-current': selected ? ('true' as const) : undefined }

  return (
    <button
      type="button"
      {...a11y}
      aria-label={label}
      data-workspace={entry.kind === 'personal' ? 'personal' : entry.id}
      onClick={() => onSelect(entry)}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left transition-colors focus:outline-none focus-visible:bg-gray-100',
        selected ? 'bg-primary-50' : 'hover:bg-gray-50'
      )}
    >
      {entry.kind === 'personal' ? (
        <Avatar name={personName} src={personPhoto} size="sm" />
      ) : (
        <OrganizationMark name={entry.name} logoUrl={entry.logoUrl} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', selected ? 'font-semibold text-primary-700' : 'font-medium text-gray-900')}>
          {entry.kind === 'personal' ? 'Personal' : entry.name}
        </span>
        <span className="block truncate text-xs text-gray-500">
          {entry.kind === 'personal' ? personName : entry.roleLabel}
        </span>
      </span>
      {entry.kind === 'organization' && entry.archived && (
        <Badge variant="warning" className="shrink-0">
          Archived
        </Badge>
      )}
      {selected && <Check className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />}
    </button>
  )
}

// The list itself, shared by the desktop menu, the phone sheet and the drawer.
export function WorkspaceOptions({
  semantics = 'list',
  onDone,
  listRef,
  labelledBy,
}: {
  semantics?: Semantics
  onDone?: () => void
  listRef?: RefObject<HTMLDivElement>
  labelledBy?: string
}) {
  const s = useWorkspaceSwitcher()
  const personal = s.entries.filter((e) => e.kind === 'personal')
  const organizations = s.entries.filter((e): e is OrganizationWorkspace => e.kind === 'organization')

  function choose(entry: WorkspaceEntry) {
    onDone?.()
    s.select(entry)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (semantics !== 'menu') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length
    else if (e.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next >= 0) {
      e.preventDefault()
      items[next].focus()
    }
  }

  const row = (entry: WorkspaceEntry) => (
    <EntryRow
      key={entry.kind === 'personal' ? 'personal' : entry.id}
      entry={entry}
      selected={entry.kind === 'organization' && s.current?.id === entry.id}
      semantics={semantics}
      personName={s.personName}
      personPhoto={s.personPhoto}
      onSelect={choose}
    />
  )

  const groupHeading = 'px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400'

  return (
    <div
      ref={listRef}
      role={semantics === 'menu' ? 'menu' : undefined}
      aria-labelledby={semantics === 'menu' ? labelledBy : undefined}
      onKeyDown={onKeyDown}
      className="py-1"
    >
      {personal.length > 0 && (
        <div role={semantics === 'menu' ? 'group' : undefined} aria-label="Personal">
          {personal.map(row)}
        </div>
      )}
      {organizations.length > 0 && (
        <div role={semantics === 'menu' ? 'group' : 'list'} aria-label="Your organizations">
          <p className={groupHeading} aria-hidden="true">
            Organizations
          </p>
          {semantics === 'menu'
            ? organizations.map(row)
            : organizations.map((entry) => (
                <div role="listitem" key={entry.id}>
                  {row(entry)}
                </div>
              ))}
        </div>
      )}
      <SwitcherStatus />
    </div>
  )
}

// What the switcher knows about its own list: being re-checked, or the re-check
// failed and the last known list is shown. Every choice is still authorized by
// the server, so a stale list can at worst offer a place that then refuses.
function SwitcherStatus() {
  const { checking, revalidationError, revalidate } = useWorkspaceSwitcher()
  return (
    <div aria-live="polite" className="px-3">
      {checking && <p className="pb-1 pt-2 text-xs text-gray-400">Checking your organizations…</p>}
      {!checking && revalidationError && (
        <div className="flex items-center gap-2 pb-1 pt-2 text-xs text-warning-700">
          <span className="min-w-0 flex-1">Couldn't confirm your organizations just now.</span>
          <button
            type="button"
            onClick={() => revalidate({ force: true })}
            className="inline-flex items-center gap-1 rounded font-medium text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop: a menu under the organization's name in the sidebar
// ---------------------------------------------------------------------------

export function WorkspaceMenu({ collapsed = false }: { collapsed?: boolean }) {
  const s = useWorkspaceSwitcher()
  const { revalidate } = s
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    // About to be relied on: re-check it (throttled, quiet on failure).
    revalidate()
    const raf = requestAnimationFrame(() => {
      const items = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
      const checked = listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ;(checked ?? items?.[0])?.focus()
    })
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, close, revalidate])

  if (s.loading) {
    return (
      <div role="status" className="h-10 animate-pulse rounded-md bg-gray-100">
        <span className="sr-only">Loading your organizations</span>
      </div>
    )
  }
  if (!s.current) return null

  const identity = (
    <>
      <OrganizationMark name={s.current.name} logoUrl={s.current.logoUrl} />
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">{s.current.name}</span>
          <span className="block truncate text-xs text-gray-500">{s.current.roleLabel}</span>
        </span>
      )}
    </>
  )

  if (!s.switchable) {
    return (
      <div className={cn('flex items-center gap-2 px-2 py-2', collapsed && 'justify-center px-0')} title={collapsed ? s.current.name : undefined}>
        {identity}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch workspace. Current: ${s.current.name}, ${s.current.roleLabel}`}
        title={collapsed ? s.current.name : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
          collapsed && 'justify-center px-0'
        )}
      >
        {identity}
        {!collapsed && <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={panelRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close(true)
            }
            if (e.key === 'Tab') close(false)
          }}
          className={cn(
            'absolute z-40 max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg',
            collapsed ? 'left-full top-0 ml-2 w-72' : 'left-0 right-0 top-full mt-1'
          )}
        >
          <WorkspaceOptions semantics="menu" listRef={listRef} labelledBy={triggerId} onDone={() => close(false)} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phone: the organization in the top bar, opening a bottom sheet
// ---------------------------------------------------------------------------

export function WorkspaceChip({ onOpen }: { onOpen: () => void }) {
  const s = useWorkspaceSwitcher()
  if (!s.current) return null
  const content = (
    <>
      <OrganizationMark name={s.current.name} logoUrl={s.current.logoUrl} size="sm" />
      <span className="min-w-0 truncate text-[15px] font-semibold text-gray-900">{s.current.name}</span>
    </>
  )
  if (!s.switchable) {
    return (
      <div className="flex min-w-0 items-center gap-2" data-testid="workspace-identity">
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Switch workspace. Current: ${s.current.name}, ${s.current.roleLabel}`}
      className="-ml-1 flex min-h-[44px] min-w-0 items-center gap-2 rounded-md px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
    >
      {content}
      <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
    </button>
  )
}

export function WorkspaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { revalidate } = useWorkspaceSwitcher()
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    revalidate()
    document.body.style.overflow = 'hidden'
    const raf = requestAnimationFrame(() => closeRef.current?.focus())
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, revalidate])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-gray-900/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            Switch workspace
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 rounded-full p-2.5 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <WorkspaceOptions semantics="list" onDone={onClose} />
      </div>
    </div>
  )
}
