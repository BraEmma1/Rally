// ---------------------------------------------------------------------------
// Where an invitation link goes, and how it survives the sign-in round trip.
//
// Rally now has two kinds of invitation email -- organization and partnership
// -- and both carry `?invitation=<id>`. The id alone cannot say which screen
// to open, so a second parameter names the kind. This is deliberately ONE
// mechanism with one destination table rather than a second auth path:
// LoginPage, SignUpPage and AuthCallbackPage all read the target through
// `readInvitationTarget` and route it through `invitationDestination`.
//
// The destination is never taken from the URL. `invitation_type` selects from
// a closed set of known internal paths, so a crafted link cannot redirect
// anywhere -- inside Rally or outside it. Omitting the parameter means
// `organization`, which is exactly how every link that exists today behaves.
// ---------------------------------------------------------------------------

export const INVITATION_PARAM = 'invitation'
export const INVITATION_TYPE_PARAM = 'invitation_type'

export type InvitationKind = 'organization' | 'partnership'

export type InvitationTarget = {
  id: string
  kind: InvitationKind
}

/** The only paths an invitation link may ever reach. Not data from the URL. */
const DESTINATIONS: Record<InvitationKind, string> = {
  organization: '/organizer/invitations',
  partnership: '/partner/invitations',
}

function asKind(raw: string | null): InvitationKind {
  return raw === 'partnership' ? 'partnership' : 'organization'
}

/** The invitation a URL is about, or null when it is an ordinary visit. */
export function readInvitationTarget(search: string): InvitationTarget | null {
  const params = new URLSearchParams(search)
  const id = params.get(INVITATION_PARAM)
  if (!id) return null
  return { id, kind: asKind(params.get(INVITATION_TYPE_PARAM)) }
}

/**
 * The query string to carry through the auth screens. An organization
 * invitation keeps exactly the shape it has always had, so existing links and
 * any already-sent email continue to work unchanged.
 */
export function invitationAuthSearch(target: InvitationTarget): string {
  const params = new URLSearchParams()
  params.set(INVITATION_PARAM, target.id)
  if (target.kind !== 'organization') params.set(INVITATION_TYPE_PARAM, target.kind)
  return '?' + params.toString()
}

/** Where to send the user once they are signed in. */
export function invitationDestination(target: InvitationTarget): string {
  return DESTINATIONS[target.kind] + invitationAuthSearch(target)
}

/**
 * The query string to hand the login screen when a guard bounces someone off
 * an invitation page.
 *
 * This exists because the invitation emails do NOT carry `invitation_type`:
 * the partnership link is `/partner/invitations?invitation=<id>` and the
 * organization link is `/organizer/invitations?invitation=<id>`. The *path* is
 * what says which kind it is, and the path is exactly what a redirect to
 * /login throws away -- so without this, a signed-out partnership recipient
 * signs in and lands on the organization invitations screen.
 *
 * An explicit `invitation_type` in the URL still wins; the path is only
 * consulted when there is none. A URL with no invitation at all comes back
 * untouched, so ordinary protected routes behave exactly as before.
 */
export function loginSearchForInvitationPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  const id = params.get(INVITATION_PARAM)
  if (!id) return search

  const explicit = params.get(INVITATION_TYPE_PARAM)
  const kind = explicit
    ? asKind(explicit)
    : ((Object.keys(DESTINATIONS) as InvitationKind[]).find(
        (candidate) => DESTINATIONS[candidate] === pathname
      ) ?? 'organization')

  return invitationAuthSearch({ id, kind })
}

// ---------------------------------------------------------------------------
// OAuth carrier
//
// Google and LinkedIn sign-in leave Rally entirely and come back to a fixed
// redirect URL, so the query string cannot carry the invitation across. The
// redirect URL itself is deliberately NOT changed: it is allow-listed in the
// project's auth settings, and widening it to take parameters is a change to
// authentication configuration that this does not need.
//
// Instead the target is parked in sessionStorage for the one hop. It is this
// tab only, it is read once and deleted, and it expires -- so an abandoned
// OAuth attempt cannot quietly redirect an ordinary sign-in later.
// ---------------------------------------------------------------------------

const OAUTH_KEY = 'rally.pendingInvitation'
const OAUTH_TTL_MS = 15 * 60 * 1000

export function rememberInvitationTarget(target: InvitationTarget | null): void {
  try {
    if (!target) {
      sessionStorage.removeItem(OAUTH_KEY)
      return
    }
    sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ ...target, at: Date.now() }))
  } catch {
    // Private mode, blocked storage: the round trip simply lands on the user's
    // home instead of the invitation. Never a reason to fail a sign-in.
  }
}

/** Reads and clears the parked target. Returns null once it has expired. */
export function consumeInvitationTarget(): InvitationTarget | null {
  try {
    const raw = sessionStorage.getItem(OAUTH_KEY)
    sessionStorage.removeItem(OAUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { id?: unknown; kind?: unknown; at?: unknown }
    if (typeof parsed.id !== 'string' || !parsed.id) return null
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > OAUTH_TTL_MS) return null
    return { id: parsed.id, kind: asKind(typeof parsed.kind === 'string' ? parsed.kind : null) }
  } catch {
    return null
  }
}
