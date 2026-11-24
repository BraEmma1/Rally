// Q-33: every open Rally tab follows the session that is actually stored, so no
// tab shows one person while its requests go out as another.
//
// supabase-js keeps the session in localStorage, shared by every tab, and reads
// it for every request. It tells other tabs about sign-ins and sign-outs over a
// BroadcastChannel, but a tab can miss that message (no BroadcastChannel, a
// frozen or restored tab) or get it out of order (two tabs signing in close
// together). These checks cover, across the personal, organizer and admin areas:
//
//   - a sign-out or a different person signing in elsewhere, with and without
//     the cross-tab message reaching this tab;
//   - a stale cross-tab message that no longer matches the stored session;
//   - rapid switching between people while a previous person's responses are
//     still slow to arrive (they must never appear for the next person);
//   - a token refresh or a return to the tab for the SAME person (nothing is
//     reset: not the page, not an unsaved form);
//   - an expired session, at start and while the tab is open;
//   - the remembered organization never crossing from one person to another.
//
// Runs against a STUBBED API, like every suite here: fabricated tokens for fake
// user ids, no real Supabase project, no credential. The stub applies the same
// row ownership the database enforces (each person reads only their own account
// and notifications), so a request sent with the wrong person's token gets that
// person's answer, as it would for real.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const API = 'http://localhost:54321'
const STORAGE_KEY = 'sb-localhost-auth-token'
fs.mkdirSync(OUT, { recursive: true })

// ---- people --------------------------------------------------------------------
const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`
const PEOPLE = {
  abena: { id: id(1), email: 'abena@example.test', name: 'Abena Mensah', type: 'attendee', secret: 'Abena private reminder' },
  kojo: { id: id(2), email: 'kojo@example.test', name: 'Kojo Asante', type: 'attendee', secret: 'Kojo private reminder' },
  esi: { id: id(3), email: 'esi@example.test', name: 'Esi Owusu', type: 'attendee', secret: 'Esi private reminder' },
  ama: { id: id(4), email: 'ama@example.test', name: 'Ama Boateng', type: 'organizer', secret: 'Ama private reminder', orgs: [['org-a', 'owner']], remembered: 'org-a' },
  yaw: { id: id(5), email: 'yaw@example.test', name: 'Yaw Darko', type: 'organizer', secret: 'Yaw private reminder', orgs: [['org-a', 'admin'], ['org-v', 'owner']], remembered: 'org-v' },
  pat: { id: id(6), email: 'pat@example.test', name: 'Pat Admin', type: 'platform_admin', secret: 'Pat private reminder' },
}
const byId = (uid) => Object.values(PEOPLE).find((p) => p.id === uid) || null
const byEmail = (email) => Object.values(PEOPLE).find((p) => p.email === email) || null
const ORGS = { 'org-a': 'Accra Events', 'org-v': 'Volta Ventures' }
const EVENTS = [
  { id: 'e-a1', organization_id: 'org-a', name: 'Accra Launch Night' },
  { id: 'e-v1', organization_id: 'org-v', name: 'Volta Night Market' },
].map((e) => ({
  description: '', location: 'Accra', start_date: '2030-03-01', end_date: null, start_time: null, end_time: null, image_url: '', capacity: null,
  status: 'upcoming', timezone: 'Africa/Accra', created_at: '2026-06-01', owner_id: null, created_by: null, visibility: 'draft', archived_at: null,
  published_at: null, ...e,
}))

function sessionFor(p, exp = 4102444800) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return {
    access_token: b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ sub: p.id, exp, role: 'authenticated', email: p.email }) + '.fake',
    refresh_token: 'r-' + p.id, token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: {}, user_metadata: {} },
  }
}
const profileOf = (p) => ({
  id: p.id, full_name: p.name, photo_url: '', job_title: 'Producer', company: 'Freelance', industry: '', location: '', bio: 'Runs events.',
  looking_for: '', can_offer: '', linkedin: '', website: '', email: p.email, phone: '', created_at: '2026-01-01', updated_at: '2026-01-01',
})
const accountOf = (p) => ({ user_id: p.id, account_type: p.type, status: 'active', approved_by: null, approved_at: null, created_at: '2026-01-01', updated_at: '2026-01-01' })

// ---- stub ----------------------------------------------------------------------
const ctl = {}
let log
function reset(over = {}) {
  Object.assign(ctl, { refreshFails: false, slow: null }, over) // slow: { page, uid, ms }
  log = { reads: [] }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function callerOf(req) {
  const auth = req.headers()['authorization'] || ''
  try { return JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub } catch { return null }
}
function filterRows(rows, url) {
  let r = rows
  for (const [k, v] of new URL(url).searchParams) {
    if (!r.length || !(k in r[0])) continue
    if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === v.slice(3))
    if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((s) => s.replace(/"/g, '')); r = r.filter((x) => set.includes(String(x[k]))) }
  }
  return r
}

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method(); const p = new URL(url).pathname
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const caller = byId(callerOf(req))
    let page = null
    try { page = req.frame().page() } catch { /* service worker or detached */ }

    if (p.endsWith('/auth/v1/token')) {
      const grant = new URL(url).searchParams.get('grant_type')
      const body = JSON.parse(req.postData() || '{}')
      if (grant === 'password') {
        const who = byEmail(body.email)
        return who ? json(200, sessionFor(who)) : json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      }
      const who = byId(String(body.refresh_token || '').replace(/^r-/, ''))
      if (ctl.refreshFails || !who) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' })
      return json(200, sessionFor(who))
    }
    if (p.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors })
    if (p.endsWith('/auth/v1/user')) return caller ? json(200, sessionFor(caller).user) : json(401, { message: 'invalid JWT' })

    const single = (req.headers()['accept'] || '').includes('pgrst.object')
    const answer = async (rows) => {
      log.reads.push({ path: p.split('/').pop(), caller: caller?.id ?? null, q: new URL(url).search, page })
      if (ctl.slow && ctl.slow.page === page && caller?.id === ctl.slow.uid) await sleep(ctl.slow.ms)
      const r = filterRows(rows, url)
      return json(200, single ? r[0] ?? null : r)
    }
    if (m === 'GET' || m === 'HEAD') {
      // Row ownership, as the policies enforce it.
      if (p.endsWith('/profiles')) return answer(Object.values(PEOPLE).map(profileOf))
      if (p.endsWith('/user_accounts')) return answer(!caller ? [] : caller.type === 'platform_admin' ? Object.values(PEOPLE).map(accountOf) : [accountOf(caller)])
      if (p.endsWith('/notifications')) {
        return answer(caller ? [{ id: 'n-' + caller.id, user_id: caller.id, type: 'system', title: caller.secret, message: 'Only for ' + caller.name, link: '', read: false, created_at: '2026-11-01T00:00:00Z' }] : [])
      }
      if (p.endsWith('/events')) return answer(EVENTS.filter((e) => (caller?.orgs || []).some(([o]) => o === e.organization_id)))
      return answer([])
    }
    if (m === 'POST' && url.includes('/rpc/')) {
      const name = p.split('/rpc/')[1]
      const body = JSON.parse(req.postData() || '{}')
      log.reads.push({ path: 'rpc/' + name, caller: caller?.id ?? null, q: JSON.stringify(body), page })
      if (ctl.slow && ctl.slow.page === page && caller?.id === ctl.slow.uid) await sleep(ctl.slow.ms)
      if (name === 'get_my_organization_access') {
        return json(200, (caller?.orgs || []).map(([org, role]) => ({
          organization_id: org, organization_name: ORGS[org], organization_slug: org, organization_description: '', organization_logo_url: '',
          organization_website: '', organization_type: 'organizer', approval_status: 'approved', archived_at: null, organization_created_by: caller.id,
          organization_created_at: '2026-01-01T00:00:00Z', organization_updated_at: '2026-01-01T00:00:00Z', organization_role: role,
          joined_at: '2026-01-01T00:00:00Z', event_assignments: [],
        })).sort((a, b) => a.organization_name.localeCompare(b.organization_name)))
      }
      if (name.startsWith('admin_')) {
        if (caller?.type !== 'platform_admin') return json(403, { code: '42501', message: 'Platform administrators only', details: null, hint: null })
        if (name === 'admin_platform_overview') return json(200, { partnerships: { total: 3, active: 1, completed: 1, cancelled: 1 } })
        return json(200, [])
      }
      if (name === 'get_public_profiles') return json(200, Object.values(PEOPLE).map((x) => ({ id: x.id, full_name: x.name, photo_url: '', job_title: '', company: '' })))
      if (name === 'can_manage_event') {
        const e = EVENTS.find((x) => x.id === body.target_event_id)
        return json(200, Boolean(e && (caller?.orgs || []).some(([o]) => o === e.organization_id)))
      }
      if (name === 'account_is_active') return json(200, Boolean(caller))
      if (name === 'event_activity_counts') return json(200, [{ registrations: 0, checked_in: 0, cancelled: 0, connections_made: 0, invitations_pending: 0, invitations_accepted: 0 }])
      return json(200, [])
    }
    return route.fulfill({ status: 204, headers: cors, body: '' })
  })
}

// Who a screen belongs to: the name in the layout's own chrome (sidebar and
// header: directories and admin lists in the page body legitimately name other
// people), and the private notification text only that person can read.
function peopleOnScreen(people) {
  const chrome = Array.from(document.querySelectorAll('aside, header')).map((n) => n.innerText).join('\n')
  const all = document.body ? document.body.innerText : ''
  return people.filter((p) => chrome.includes(p.name) || all.includes(p.secret)).map((p) => p.key)
}
// Records every screen, across navigations of a tab, that shows more than one
// person at once.
function watchForMixing([people, seeSrc]) {
  // eslint-disable-next-line no-new-func
  const see = new Function('people', 'return (' + seeSrc + ')(people)')
  const start = () => {
    if (!document.body || window.__watching) return
    window.__watching = true
    new MutationObserver(() => {
      const seen = see(people)
      if (seen.length > 1) sessionStorage.setItem('__mixed', JSON.stringify([...JSON.parse(sessionStorage.getItem('__mixed') || '[]'), seen]))
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start)
}
const WATCHED = Object.entries(PEOPLE).map(([key, p]) => ({ key, name: p.name, secret: p.secret }))
const mixed = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__mixed') || '[]'))

const results = []
let fails = 0
function rec(group, name, pass, detail = '') {
  if (!pass) fails++
  results.push({ group, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? '  -> ' + detail : ''}`)
}

;(async () => {
  const browser = await launchBrowser()
  const errors = []

  // One browser profile (shared storage, like real tabs), seeded with a person's
  // session and every person's remembered organization.
  async function profile(person, { expired = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const seeded = sessionFor(person, expired ? 1700000000 : 4102444800)
    const remembered = Object.values(PEOPLE).filter((p) => p.remembered).map((p) => ['rally.organizer.active_org:' + p.id, p.remembered])
    await ctx.addInitScript(([key, sess, mem]) => {
      if (!localStorage.getItem('__seeded')) {
        localStorage.setItem('__seeded', '1')
        localStorage.setItem(key, JSON.stringify(sess))
        for (const [k, v] of mem) localStorage.setItem(k, v)
      }
      const realNow = Date.now.bind(Date)
      window.__clockOffset = 0
      Date.now = () => realNow() + window.__clockOffset
    }, [STORAGE_KEY, seeded, remembered])
    await ctx.addInitScript(watchForMixing, [WATCHED, peopleOnScreen.toString()])
    await wire(ctx)
    return ctx
  }
  // A tab in that profile. `noBroadcast` takes BroadcastChannel away, so the tab
  // never hears the other tabs' sign-in and sign-out messages.
  async function tab(ctx, url, { noBroadcast = false } = {}) {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|net::ERR|status of 4\d\d|status of 5\d\d|Error loading|AuthApiError|Invalid Refresh Token/.test(msg.text())) errors.push(msg.text()) })
    if (noBroadcast) await page.addInitScript(() => { delete window.BroadcastChannel })
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, [role=alert], main, form', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(300)
    return page
  }
  const body = (page) => page.locator('body').innerText().catch(() => '')
  const whoShows = (page) => page.evaluate(peopleOnScreen, WATCHED).catch(() => [])
  const settle = async (page, ms = 400) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
  const signOutIn = (page) => page.locator('aside').getByRole('button', { name: 'Sign out' }).first().click()
  async function signIn(page, person) {
    await page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {})
    await page.fill('#email', person.email)
    await page.fill('#password', 'not-a-real-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8000 }).catch(() => {})
  }
  // Wait (up to `ms`) for a tab to show `key` and only `key`.
  async function becomes(page, key, ms = 4000) {
    const until = Date.now() + ms
    let seen = []
    while (Date.now() < until) {
      seen = await whoShows(page)
      if (seen.length === 1 && seen[0] === key) return seen
      await page.waitForTimeout(150)
    }
    return seen
  }
  // Requests that asked for one person's own rows while carrying another's token.
  const crossed = (page) => log.reads.filter((r) => r.page === page && r.caller &&
    Object.values(PEOPLE).some((p) => p.id !== r.caller && r.q.includes(p.id)) && !r.path.startsWith('rpc/get_public_profiles') && r.path !== 'profiles')
  const startEditing = async (page) => { await page.getByRole('button', { name: /Edit profile/ }).first().click(); await page.fill('#job_title', 'Typed but not saved') }
  const signedOutView = async (page) => { const t = await body(page); return page.url().includes('/login') && Object.values(PEOPLE).every((p) => !t.includes(p.name) && !t.includes(p.secret)) }

  // ---- 1. personal area: a tab that misses the cross-tab messages ----------------
  {
    reset()
    const ctx = await profile(PEOPLE.abena)
    const t1 = await tab(ctx, '/notifications', { noBroadcast: true })
    const t3 = await tab(ctx, '/dashboard')
    const t2 = await tab(ctx, '/dashboard')
    rec('personal', 'three tabs open on the same person', (await whoShows(t1)).join() === 'abena' && (await whoShows(t3)).join() === 'abena')
    await signOutIn(t2)
    await t2.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {})
    await settle(t1, 900)
    rec('personal', 'signing out in another tab clears a tab that never got the message (no interaction)', await signedOutView(t1), `${t1.url()} ${(await whoShows(t1)).join()}`)
    rec('personal', '...and a tab that did get it', await signedOutView(t3), t3.url())
    await signIn(t2, PEOPLE.kojo)
    const seen1 = await becomes(t1, 'kojo')
    rec('personal', 'a different person signing in elsewhere: the tab that missed the message shows only them', seen1.join() === 'kojo', `${t1.url()} ${seen1.join()}`)
    const seen3 = await becomes(t3, 'kojo')
    rec('personal', '...as does the tab that got it', seen3.join() === 'kojo', `${t3.url()} ${seen3.join()}`)
    rec('personal', '...and it opens their home, not the previous person\'s page', new URL(t1.url()).pathname === '/dashboard', t1.url())
    rec('personal', 'no tab ever showed two people at once', (await mixed(t1)).length === 0 && (await mixed(t3)).length === 0, JSON.stringify(await mixed(t1)))
    rec('personal', 'no request asked for the first person\'s own rows with the second person\'s token', crossed(t1).length === 0 && crossed(t3).length === 0, JSON.stringify(crossed(t1).slice(0, 2).map((r) => r.path + r.q)))
    await ctx.close()
  }

  // ---- 2. a stale cross-tab message --------------------------------------------
  {
    reset()
    const ctx = await profile(PEOPLE.kojo)
    const t1 = await tab(ctx, '/profile')
    const t2 = await tab(ctx, '/dashboard')
    await startEditing(t1)
    const readsBefore = log.reads.filter((r) => r.page === t1).length
    // An earlier sign-in's message arrives late: storage already holds Kojo.
    await t2.evaluate(([key, sess]) => new BroadcastChannel(key).postMessage({ event: 'SIGNED_IN', session: sess }), [STORAGE_KEY, sessionFor(PEOPLE.abena)])
    await settle(t1, 900)
    rec('stale', 'a late "signed in" message for someone else, while storage holds this person: the tab stays as it is',
      (await whoShows(t1)).join() === 'kojo' && new URL(t1.url()).pathname === '/profile' && (await t1.inputValue('#job_title').catch(() => '')) === 'Typed but not saved', `${t1.url()} ${(await whoShows(t1)).join()}`)
    rec('stale', '...and nothing was requested for the other person with this person\'s token', crossed(t1).length === 0, JSON.stringify(crossed(t1).slice(0, 2).map((r) => r.path + r.q)))
    await t2.evaluate((key) => new BroadcastChannel(key).postMessage({ event: 'SIGNED_OUT', session: null }), STORAGE_KEY)
    await settle(t1, 900)
    rec('stale', 'a late "signed out" message while storage still holds a session: the tab follows storage, not the message',
      (await whoShows(t1)).join() === 'kojo' && (await t1.inputValue('#job_title').catch(() => '')) === 'Typed but not saved', `${t1.url()}`)
    rec('stale', '...without reloading this person\'s identity from scratch', log.reads.filter((r) => r.page === t1 && r.path === 'user_accounts').length - log.reads.filter((r, i) => i < readsBefore && r.page === t1 && r.path === 'user_accounts').length <= 2)
    await ctx.close()
  }

  // ---- 3. rapid switching while a previous person's answers are slow --------------
  {
    reset()
    const ctx = await profile(PEOPLE.abena)
    const t1 = await tab(ctx, '/notifications')
    const t2 = await tab(ctx, '/dashboard')
    ctl.slow = { page: t1, uid: PEOPLE.kojo.id, ms: 2500 }
    await signOutIn(t2)
    await signIn(t2, PEOPLE.kojo)
    await settle(t2, 200)
    await t1.waitForTimeout(300) // the first tab is now loading Kojo, slowly
    await signOutIn(t2)
    await signIn(t2, PEOPLE.esi)
    const seen = await becomes(t1, 'esi', 3000)
    rec('rapid', 'switching people quickly ends on the last person only', seen.join() === 'esi', seen.join())
    // Back to the notifications in the same page (no reload), where a late list
    // for Kojo would show, then let his slow answers arrive.
    await t1.evaluate(() => { history.pushState({}, '', '/notifications'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await t1.waitForTimeout(3000)
    const late = await whoShows(t1)
    rec('rapid', 'the previous person\'s slow answers, arriving afterwards, never appear', late.join() === 'esi', late.join())
    const bodyText = await body(t1)
    rec('rapid', '...not in the notifications either (they belong to the person whose list it is)', bodyText.includes(PEOPLE.esi.secret) && !bodyText.includes(PEOPLE.kojo.secret) && !bodyText.includes(PEOPLE.abena.secret))
    rec('rapid', 'no screen showed two people at once', (await mixed(t1)).length === 0, JSON.stringify(await mixed(t1)))
    ctl.slow = null
    await ctx.close()
  }

  // ---- 4. same person: token refresh in another tab, return to the tab ------------
  {
    reset()
    const ctx = await profile(PEOPLE.abena)
    const t1 = await tab(ctx, '/profile')
    const t2 = await tab(ctx, '/dashboard')
    await startEditing(t1)
    const bootReads = log.reads.filter((r) => r.page === t1 && r.path === 'user_accounts').length
    // What supabase-js in another tab does when it rotates the token.
    await t2.evaluate(([key, sess]) => { localStorage.setItem(key, JSON.stringify(sess)); new BroadcastChannel(key).postMessage({ event: 'TOKEN_REFRESHED', session: sess }) }, [STORAGE_KEY, sessionFor(PEOPLE.abena, 4102444900)])
    await settle(t1, 700)
    await t1.evaluate(() => { document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); window.dispatchEvent(new Event('focus')) })
    await settle(t1, 700)
    rec('same', 'a token refresh elsewhere and a return to the tab keep the page and an unsaved edit',
      new URL(t1.url()).pathname === '/profile' && (await t1.inputValue('#job_title').catch(() => '')) === 'Typed but not saved' && (await whoShows(t1)).join() === 'abena')
    rec('same', '...and never block the screen or reload the identity from scratch',
      (await t1.locator('[role=status], .animate-spin').count()) === 0 && log.reads.filter((r) => r.page === t1 && r.path === 'user_accounts').length - bootReads <= 2)
    await ctx.close()
  }

  // ---- 5. expired sessions --------------------------------------------------------
  {
    reset({ refreshFails: true })
    const ctx = await profile(PEOPLE.abena, { expired: true })
    const t1 = await tab(ctx, '/notifications')
    await settle(t1, 600)
    rec('expired', 'an expired session that cannot be refreshed opens the sign-in screen with nothing private', await signedOutView(t1), t1.url())
    await ctx.close()

    reset()
    const ctx2 = await profile(PEOPLE.abena)
    const a = await tab(ctx2, '/notifications')
    const b = await tab(ctx2, '/dashboard', { noBroadcast: true })
    ctl.refreshFails = true
    await a.evaluate(() => { window.__clockOffset = 5 * 365 * 24 * 3600 * 1000 * 20; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })) })
    await settle(a, 1200)
    rec('expired', 'a session that expires while open and cannot be refreshed signs the tab out, with nothing private left', await signedOutView(a), a.url())
    await settle(b, 600)
    rec('expired', '...and the other tab too, even without the cross-tab message', await signedOutView(b), `${b.url()} ${(await whoShows(b)).join()}`)
    await ctx2.close()
  }

  // ---- 6. organizer area ----------------------------------------------------------
  {
    reset()
    const ctx = await profile(PEOPLE.ama)
    const t1 = await tab(ctx, '/organizer/events/e-a1', { noBroadcast: true })
    const t2 = await tab(ctx, '/organizer')
    // The organizer layout names the organization, not the person, so who the tab
    // belongs to is read from the workspace it opens and the token it uses.
    rec('organizer', 'the first organizer is on their event, in their remembered organization', (await body(t1)).includes('Accra Events') && (await body(t1)).includes('Accra Launch Night'))
    const switchAt = log.reads.length
    await signOutIn(t2)
    await signIn(t2, PEOPLE.yaw)
    const until = Date.now() + 4000
    while (Date.now() < until && !((await body(t1)).includes('Volta Ventures') && new URL(t1.url()).pathname === '/organizer')) await t1.waitForTimeout(150)
    await settle(t1, 500)
    const after = log.reads.slice(switchAt).filter((r) => r.page === t1)
    rec('organizer', 'a different organizer signing in elsewhere: the tab opens THEIR remembered organization, not the previous person\'s',
      (await body(t1)).includes('Volta Ventures') && new URL(t1.url()).pathname === '/organizer', `${t1.url()}`)
    rec('organizer', '...leaving the previous person\'s event page', !(await body(t1)).includes('Accra Launch Night'))
    rec('organizer', '...and everything it asked for afterwards went out as the new person', after.length > 0 && after.every((r) => r.caller === PEOPLE.yaw.id || r.caller === null), JSON.stringify([...new Set(after.map((r) => r.caller))]))
    const stored = await t1.evaluate(([a, y]) => [localStorage.getItem(a), localStorage.getItem(y)], ['rally.organizer.active_org:' + PEOPLE.ama.id, 'rally.organizer.active_org:' + PEOPLE.yaw.id])
    rec('organizer', '...and each person\'s remembered organization is kept apart', stored[0] === 'org-a' && stored[1] === 'org-v', JSON.stringify(stored))
    rec('organizer', 'no request asked for the first person\'s rows with the second person\'s token', crossed(t1).length === 0, JSON.stringify(crossed(t1).slice(0, 2).map((r) => r.path + r.q)))
    await ctx.close()
  }

  // ---- 7. admin area ---------------------------------------------------------------
  {
    reset()
    const ctx = await profile(PEOPLE.pat)
    const t1 = await tab(ctx, '/admin', { noBroadcast: true })
    const t2 = await tab(ctx, '/admin')
    rec('admin', 'the administrator\'s console is open', new URL(t1.url()).pathname.startsWith('/admin') && (await whoShows(t1)).includes('pat'))
    await signOutIn(t2)
    await settle(t1, 900)
    rec('admin', 'signing out elsewhere closes the console in a tab that missed the message', await signedOutView(t1), t1.url())
    await signIn(t2, PEOPLE.abena)
    const seen = await becomes(t1, 'abena')
    rec('admin', 'an attendee signing in elsewhere: the tab shows only the attendee, on their own home', seen.join() === 'abena' && new URL(t1.url()).pathname === '/dashboard', `${t1.url()} ${seen.join()}`)
    rec('admin', '...with no administrator request sent with the attendee\'s token', !log.reads.some((r) => r.page === t1 && r.caller === PEOPLE.abena.id && r.path.startsWith('rpc/admin_')))
    rec('admin', 'no screen showed two people at once', (await mixed(t1)).length === 0, JSON.stringify(await mixed(t1)))

    // The reverse, while the tab still has the cross-tab message: an attendee's
    // tab picks up an administrator's sign-in.
    await signOutIn(t2)
    await signIn(t2, PEOPLE.pat)
    const back = await becomes(t1, 'pat')
    rec('admin', 'an administrator signing in elsewhere: the tab opens the console for them', back.join() === 'pat' && new URL(t1.url()).pathname.startsWith('/admin'), `${t1.url()} ${back.join()}`)
    await ctx.close()
  }

  // ---- 8. the message-delivered path still works (regression) -----------------------
  {
    reset()
    const ctx = await profile(PEOPLE.abena)
    const t1 = await tab(ctx, '/dashboard')
    const t2 = await tab(ctx, '/dashboard')
    await signOutIn(t2)
    await settle(t1, 600)
    rec('regression', 'with the cross-tab message, signing out elsewhere signs this tab out', await signedOutView(t1), t1.url())
    await signIn(t1, PEOPLE.kojo)
    await settle(t1, 400)
    rec('regression', 'signing in again in this tab works as before', (await whoShows(t1)).join() === 'kojo' && new URL(t1.url()).pathname === '/dashboard', t1.url())
    const seen2 = await becomes(t2, 'kojo')
    rec('regression', '...and the other tab follows', seen2.join() === 'kojo', `${t2.url()} ${seen2.join()}`)
    if (process.env.DEBUG_SYNC) console.log(JSON.stringify(log.reads.filter((r) => r.page === t2).map((r) => [r.path, r.caller && byId(r.caller).email, r.q.slice(0, 60)]), null, 0))
    await ctx.close()
  }

  rec('errors', 'no unexpected console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'auth-session-sync.json'), JSON.stringify(results, null, 2))
  console.log(`\n${results.length - fails} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
