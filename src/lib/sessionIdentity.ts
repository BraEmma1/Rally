// Which person a tab is for, decided from the session that is actually stored.
//
// supabase-js keeps one session in localStorage, shared by every tab, and reads
// it for every request. Auth events are only news about that session, and in a
// second tab the news can be wrong when it is acted on:
//
//   - the cross-tab message for a sign-in can arrive before this tab's view of
//     localStorage has the new session (Chromium propagates the two separately),
//     so requests sent straight away go out with no user token at all;
//   - two tabs signing in close together deliver their messages in either order,
//     so the last message is not necessarily the stored session;
//   - a tab can miss the message entirely (no BroadcastChannel, a frozen or
//     restored tab), and a sign-out that is never announced is never noticed.
//
// So the stored session decides, whenever it can be read. An event is used as it
// is only when it describes the stored session; otherwise the tab follows storage
// and reads the session from the client. Authorization is untouched: every
// request is still decided by the server for whoever the token belongs to. This
// only keeps what the tab SHOWS in step with that token.
//
// Pure: only type imports, so it runs under node --test.

/**
 * Who a stored session belongs to: a user id, `null` when nothing is stored, or
 * `undefined` when the value cannot be read (storage blocked, an unexpected
 * shape). On `undefined` callers fall back to the auth events alone.
 */
export type StoredOwner = string | null | undefined

function base64UrlJson(part: string): unknown {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return JSON.parse(atob(padded))
}

/**
 * The owner of a raw stored supabase-js session. The access token's subject is
 * preferred, because the token is what every request carries; the stored user
 * object is the fallback.
 */
export function sessionOwnerFromStored(raw: string | null): StoredOwner {
  if (raw === null) return null
  try {
    const stored = JSON.parse(raw) as { user?: { id?: unknown } | null; access_token?: unknown } | null
    if (!stored || typeof stored !== 'object') return undefined
    if (typeof stored.access_token === 'string') {
      const payload = stored.access_token.split('.')[1]
      if (payload) {
        const claims = base64UrlJson(payload) as { sub?: unknown } | null
        if (claims && typeof claims.sub === 'string' && claims.sub) return claims.sub
      }
    }
    if (stored.user && typeof stored.user.id === 'string' && stored.user.id) return stored.user.id
    return undefined
  } catch {
    return undefined
  }
}

/**
 * What the auth layer does next.
 *
 *   signed-out — nobody is signed in: forget every private thing.
 *   switch     — a different person from the one shown: clear everything that
 *                belonged to the previous person, then load this one.
 *   same       — the person shown: refresh quietly, reset nothing.
 *
 * `session` says where the new session object comes from: `event` when the
 * event describes the stored session, `read` when the tab must ask the client
 * for it (the event was stale, or there was no event).
 */
export type IdentityStep =
  | { kind: 'signed-out' }
  | { kind: 'switch'; userId: string; session: 'event' | 'read' }
  | { kind: 'same'; userId: string }

/**
 * @param shown   the person the tab currently shows, or null
 * @param event   the user id an auth event carries (null for no session), or
 *                null when this is a check with no event (storage changed, the
 *                tab regained focus)
 * @param stored  who the stored session belongs to
 * @returns the step, or null when there is nothing to do
 */
export function identityStep(shown: string | null, event: { userId: string | null } | null, stored: StoredOwner): IdentityStep | null {
  if (event === null) {
    // A check without an event can only follow storage, and only when it can
    // read it and it disagrees with the tab.
    if (stored === undefined || stored === shown) return null
    return stored === null ? { kind: 'signed-out' } : { kind: 'switch', userId: stored, session: 'read' }
  }
  const target = stored === undefined ? event.userId : stored
  const trusted = event.userId === target
  if (target === null) return { kind: 'signed-out' }
  if (target !== shown) return { kind: 'switch', userId: target, session: trusted ? 'event' : 'read' }
  // The tab already shows the stored person. A stale event about someone else
  // changes nothing; the event about this person is a quiet refresh.
  return trusted ? { kind: 'same', userId: target } : null
}
