// The workspace switcher (frontend phase 1): a person in several organizations
// switches between them without signing out, and no organization's private data
// is ever shown under another organization's name.
//
// Covers: the list is exactly the memberships the API returns; selecting opens
// that organization's workspace and data; a slow response from the previous
// organization cannot land after a switch; sections are kept, event pages are
// left; direct links follow the event's organization (also when the membership
// was granted after the list loaded); refresh keeps the choice (per person); a
// revoked membership is detected on return to the tab or on moving between
// pages, and leaves the workspace; losing every membership; a failed or
// expired-session check; a second tab (switching, signing out, another person's
// session arriving); Personal for an attendee account; every existing organizer
// route; keyboard; phone (390 and 320px) with the top-bar sheet, the drawer and
// the bottom nav.
//
// Runs against a STUBBED API, like every suite here. Nothing reaches a real
// Supabase project and no credential is used: the session is a fabricated token
// for a fake user id. The database half of the contract (the list is the
// caller's own memberships; non-members get nothing private) is proven against
// the real migrations by tests/sql/workspace-memberships.test.mjs.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const UID = '22222222-2222-2222-2222-222222222222'
const UID2 = '33333333-3333-3333-3333-333333333333' // a different person, for account changes
const API = 'http://localhost:54321'
const STORE = 'rally.organizer.active_org:' + UID
fs.mkdirSync(OUT, { recursive: true })

// ---- fixtures ----------------------------------------------------------------
const ORGS = {
  'org-a': { name: 'Accra Events', logo: '' },
  'org-b': { name: 'Kente Foods', logo: '' },
  'org-c': { name: 'TechGhana Summit', logo: '' },
  'org-v': { name: 'Volta Ventures', logo: '' }, // the second person's organization
}
const ev = (id, org, name, over = {}) => ({
  id, name, description: '', location: 'Accra', start_date: '2030-03-01', end_date: null, start_time: null, end_time: null,
  image_url: '', capacity: null, status: 'upcoming', timezone: 'Africa/Accra', created_at: '2026-06-01', owner_id: null,
  created_by: UID, organization_id: org, visibility: 'published', archived_at: null, published_at: '2026-06-01', ...over,
})
const EVENTS = [
  ev('e-a1', 'org-a', 'Accra Launch Night', { visibility: 'draft', published_at: null }),
  ev('e-a2', 'org-a', 'Accra Founders Summit', { start_date: '2030-04-01' }),
  ev('e-b1', 'org-b', 'Kente Harvest Expo'),
  ev('e-b2', 'org-b', 'Kente Supplier Day', { visibility: 'draft', published_at: null }),
  ev('e-c1', 'org-c', 'TechGhana Hidden Draft', { visibility: 'draft', published_at: null }),
  ev('e-v1', 'org-v', 'Volta Night Market', { visibility: 'draft', published_at: null }),
]
const PRIVATE = {
  'org-a': ['Accra Launch Night', 'Accra Founders Summit', 'Kofi Accra-Teammate'],
  'org-b': ['Kente Harvest Expo', 'Kente Supplier Day', 'Esi Kente-Teammate'],
  'org-c': ['TechGhana Hidden Draft', 'Yaw Tech-Teammate'],
  'org-v': ['Volta Night Market', 'Kwame Volta-Teammate'],
}
const TEAMMATE = { 'org-a': 'Kofi Accra-Teammate', 'org-b': 'Esi Kente-Teammate', 'org-c': 'Yaw Tech-Teammate', 'org-v': 'Kwame Volta-Teammate' }
// Everything that identifies the first person's workspace.
const FIRST_PERSON_TEXT = ['Accra Events', 'Kente Foods', ...PRIVATE['org-a'], ...PRIVATE['org-b']]
const member = (org, uid, name, role, self = false) => ({ user_id: uid, role, created_at: '2026-01-01', full_name: name, job_title: 'Lead', company: ORGS[org].name, photo_url: '', is_self: self })

// ---- mock state --------------------------------------------------------------
const ctl = {}
let log
function reset(over = {}) {
  Object.assign(ctl, {
    accountType: 'organizer',
    memberships: [['org-a', 'owner'], ['org-b', 'manager']],
    memberships2: [['org-v', 'owner']], // the second person's
    assigned: ['e-b1'], // the caller's event_team rows (manager in B)
    accessFailNext: 0, // fail the next N get_my_organization_access calls
    accessFailing: false, // fail every call until cleared
    accessStatus: 500,
    eventsDelay: {}, // org -> ms, for the events list request
    pendingInvitations: [],
    expired: false,
  }, over)
  log = { access: 0, orgReads: [], writes: [] }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const err = (code, message) => ({ code, message, details: null, hint: null })
// Who is calling: the stub reads the person from the bearer token, so each
// person only ever gets their own memberships, as the real function does.
function callerOf(req) {
  const auth = req.headers()['authorization'] || ''
  try { return JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64').toString()).sub } catch { return null }
}
const membershipsOf = (uid) => (uid === UID2 ? ctl.memberships2 : uid === UID ? ctl.memberships : [])
const isMember = (org, uid = UID) => membershipsOf(uid).some(([o]) => o === org)
const roleIn = (org, uid = UID) => (membershipsOf(uid).find(([o]) => o === org) || [])[1]

function accessRows(uid = UID) {
  return membershipsOf(uid).map(([org, role]) => ({
    organization_id: org, organization_name: ORGS[org].name, organization_slug: org, organization_description: '',
    organization_logo_url: ORGS[org].logo, organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: role, joined_at: '2026-01-01T00:00:00Z',
    event_assignments: [],
  })).sort((x, y) => x.organization_name.localeCompare(y.organization_name))
}

function rawRows(url, uid = UID) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [{ id: uid, full_name: uid === UID2 ? 'Kojo Asante' : 'Abena Mensah', photo_url: '', job_title: 'Producer', company: 'Freelance', industry: '', location: '', bio: 'Runs events.', looking_for: '', can_offer: '', linkedin: '', website: '', email: 'abena@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) return [{ account_type: ctl.accountType, status: 'active' }]
  if (p.endsWith('/events')) return EVENTS.filter((e) => isMember(e.organization_id, uid) || e.visibility === 'published')
  if (p.endsWith('/event_team')) return ctl.assigned.map((event_id) => ({ event_id, user_id: UID }))
  return []
}
function rows(url, single, uid = UID) {
  let r = rawRows(url, uid)
  if (Array.isArray(r) && r.length) {
    for (const [k, v] of new URL(url).searchParams) {
      if (!(k in r[0])) continue
      if (v.startsWith('eq.')) r = r.filter((x) => String(x[k]) === v.slice(3))
      if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((s) => s.replace(/"/g, '')); r = r.filter((x) => set.includes(String(x[k]))) }
    }
  }
  return single ? (Array.isArray(r) ? r[0] ?? null : r) : r
}

function sessionFor(uid, email, exp = 4102444800) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
  return {
    access_token: b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ sub: uid, exp, role: 'authenticated' }) + '.fake',
    refresh_token: 'r-' + uid, token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
  }
}

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = new URL(url).pathname
    const caller = callerOf(req)
    if (p.endsWith('/auth/v1/token')) {
      // Signing in with a password (another tab, later) signs in the SECOND person.
      if (new URL(url).searchParams.get('grant_type') === 'password') return json(200, sessionFor(UID2, 'kojo@example.test'))
      // An expired session whose refresh token is no longer accepted.
      return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' })
    }
    if (p.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors })
    if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${rows(url, false, caller).length}` } })
    if (m === 'GET') {
      const org = new URL(url).searchParams.get('organization_id')
      if (p.endsWith('/events') && org) {
        const id = org.slice(3)
        log.orgReads.push({ what: 'events', org: id, caller })
        if (ctl.eventsDelay[id]) await sleep(ctl.eventsDelay[id])
      }
      return json(200, rows(url, (req.headers()['accept'] || '').includes('pgrst.object'), caller))
    }
    if (m === 'POST' && url.includes('/rpc/')) {
      const body = JSON.parse(req.postData() || '{}')
      const name = p.split('/rpc/')[1]
      if (name === 'get_my_organization_access') {
        log.access++
        if (ctl.accessFailing || ctl.accessFailNext > 0) {
          if (ctl.accessFailNext > 0) ctl.accessFailNext--
          return json(ctl.accessStatus, ctl.accessStatus === 401 ? { code: 'PGRST301', message: 'JWT expired' } : err('XX000', 'Could not load your organizations.'))
        }
        return json(200, accessRows(caller))
      }
      if (body.org_id) {
        log.orgReads.push({ what: name, org: body.org_id, caller })
        if (!isMember(body.org_id, caller)) return json(403, err('42501', 'You are not a member of this organization'))
        if (name === 'organization_member_directory') return json(200, [member(body.org_id, caller, caller === UID2 ? 'Kojo Asante' : 'Abena Mensah', roleIn(body.org_id, caller), true), member(body.org_id, 'u-' + body.org_id, TEAMMATE[body.org_id], 'admin')])
        if (name === 'organization_people') return json(200, [])
        return json(200, [])
      }
      if (name === 'can_manage_event') {
        const e = EVENTS.find((x) => x.id === body.target_event_id)
        const role = e && roleIn(e.organization_id, caller)
        return json(200, Boolean(role && (role !== 'manager' || ctl.assigned.includes(e.id))))
      }
      if (name === 'account_is_active') return json(200, true)
      if (name === 'my_pending_organization_invitations') return json(200, ctl.pendingInvitations)
      if (name === 'accept_organization_invitation') {
        const inv = ctl.pendingInvitations.find((i) => i.id === body.invitation_id)
        if (inv) { ctl.memberships.push([inv.organization_id, inv.role]); ctl.pendingInvitations = ctl.pendingInvitations.filter((i) => i !== inv) }
        return route.fulfill({ status: 204, headers: cors, body: '' })
      }
      if (name === 'event_activity_counts') return json(200, [{ registrations: 0, checked_in: 0, cancelled: 0, connections_made: 0, invitations_pending: 0, invitations_accepted: 0 }])
      return json(200, [])
    }
    log.writes.push({ m, url })
    return route.fulfill({ status: 204, headers: cors, body: '' })
  })
}

// Records, across navigations of one tab, every screen that shows the second
// person's organization together with anything of the first person's workspace.
function watchForMixing(first) {
  const start = () => {
    if (!document.body || window.__watching) return
    window.__watching = true
    new MutationObserver(() => {
      const text = document.body.innerText
      if (!text.includes('Volta')) return
      const seen = first.filter((x) => text.includes(x))
      if (seen.length) sessionStorage.setItem('__mixed', JSON.stringify([...JSON.parse(sessionStorage.getItem('__mixed') || '[]'), seen]))
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start)
}
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
  async function open(url, { w = 1440, h = 900, stored = undefined, expired = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 768 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|net::ERR|status of 4\d\d|status of 5\d\d/.test(msg.text())) errors.push(msg.text()) })
    await ctx.addInitScript(([uid, store, storedOrg, isExpired]) => {
      const exp = isExpired ? 1700000000 : 4102444800
      const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'abena@example.test', app_metadata: {}, user_metadata: {} } }
      if (!localStorage.getItem('__seeded')) {
        localStorage.setItem('__seeded', '1')
        localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
        if (storedOrg) localStorage.setItem(store, storedOrg)
      }
      // A controllable clock offset for Date.now() only, so a test can step past
      // the switcher's 15 s re-check interval without waiting for it.
      const realNow = Date.now.bind(Date)
      window.__clockOffset = 0
      Date.now = () => realNow() + window.__clockOffset
    }, [UID, STORE, stored ?? null, expired])
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, [role=alert], main', { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  const main = (page) => page.locator('main').innerText().catch(() => '')
  const shows = async (page, org) => { const t = await main(page); return PRIVATE[org].some((s) => t.includes(s)) }
  const showsOnly = async (page, org) => {
    const t = await main(page)
    const others = Object.keys(PRIVATE).filter((o) => o !== org)
    return { own: PRIVATE[org].filter((s) => !s.includes('Teammate')).some((s) => t.includes(s)), leaked: others.flatMap((o) => PRIVATE[o]).filter((s) => t.includes(s)) }
  }
  const settle = async (page, ms = 400) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) }
  const trigger = (page) => page.getByRole('button', { name: /^Switch workspace/ }).first()
  const desktopTrigger = (page) => page.locator('aside').getByRole('button', { name: /^Switch workspace/ })
  const headerName = (page) => page.locator('header [data-testid="workspace-identity"]').innerText().catch(() => '')
  const returnToTab = (page) => page.evaluate(() => { window.__clockOffset += 60_000; window.dispatchEvent(new Event('focus')) })
  async function pick(page, name) {
    await desktopTrigger(page).click()
    await page.getByRole('menuitemradio', { name: new RegExp('^' + name) }).click()
    await settle(page)
  }

  // ---- 1. the list is the person's memberships ------------------------------------
  {
    reset()
    const { page, ctx, errors } = await open('/organizer')
    rec('list', 'the selected organization is shown in the desktop header', (await headerName(page)).includes('Accra Events'), await headerName(page))
    rec('list', 'the sidebar trigger names the organization and the person\'s role', (await desktopTrigger(page).getAttribute('aria-label')) === 'Switch workspace. Current: Accra Events, Owner')
    const callsBeforeOpen = log.access
    await desktopTrigger(page).click()
    const items = await page.getByRole('menuitemradio').allInnerTexts()
    rec('list', 'the menu lists exactly the two memberships, no other organization', items.length === 2 && items[0].includes('Accra Events') && items[1].includes('Kente Foods') && !items.join(' ').includes('TechGhana'), JSON.stringify(items))
    rec('list', 'each shows the person\'s own role', items[0].includes('Owner') && items[1].includes('Event manager'))
    rec('list', 'the current one is checked', (await page.getByRole('menuitemradio', { name: /^Accra Events/ }).getAttribute('aria-checked')) === 'true' && (await page.getByRole('menuitemradio', { name: /^Kente Foods/ }).getAttribute('aria-checked')) === 'false')
    rec('list', 'an organizer account is offered no Personal workspace (its guard would refuse)', (await page.getByRole('menuitemradio', { name: /^Personal/ }).count()) === 0)
    rec('list', 'opening the menu right after the page loaded does not re-ask (one check per interval)', log.access === callsBeforeOpen, `${callsBeforeOpen} -> ${log.access}`)
    await page.keyboard.press('Escape')
    const focusBack = await page.waitForFunction(() => document.activeElement?.getAttribute('aria-haspopup') === 'menu', null, { timeout: 2000 }).then(() => true, () => false)
    rec('keyboard', 'Escape closes the menu and returns focus to the trigger', (await page.getByRole('menu').count()) === 0 && focusBack)
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio', null, { timeout: 2000 }).catch(() => {})
    const focused1 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    await page.keyboard.press('ArrowDown')
    const focused2 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    rec('keyboard', 'ArrowDown opens it on the current organization, and moves to the next', /^Accra Events/.test(focused1 || '') && /^Kente Foods/.test(focused2 || ''), `${focused1} -> ${focused2}`)
    await page.keyboard.press('Enter')
    await settle(page)
    rec('keyboard', 'Enter selects', (await headerName(page)).includes('Kente Foods'))
    rec('list', 'no console or page errors', errors.length === 0, errors.join(' | '))
    await page.screenshot({ path: path.join(OUT, 'workspace-desktop-menu.png') })
    await ctx.close()
  }

  // ---- 2. selecting opens the organization's workspace and data -----------------------
  {
    reset()
    const { page, ctx, errors } = await open('/organizer')
    let s = await showsOnly(page, 'org-a')
    rec('switch', 'A\'s dashboard shows A\'s events', s.own && s.leaked.length === 0, JSON.stringify(s))
    await pick(page, 'Kente Foods')
    s = await showsOnly(page, 'org-b')
    rec('switch', 'selecting B opens B\'s dashboard with B\'s events', page.url().endsWith('/organizer') && s.own, page.url())
    rec('switch', '...and nothing of A remains on screen', s.leaked.length === 0, JSON.stringify(s.leaked))
    rec('switch', 'the header and the dashboard title both say Kente Foods', (await headerName(page)).includes('Kente Foods') && (await page.locator('main h1').first().innerText()).includes('Kente Foods'))
    rec('switch', 'B\'s data was requested for B', log.orgReads.some((r) => r.org === 'org-b'))
    rec('switch', 'no data was ever requested for an organization the person is not in', !log.orgReads.some((r) => r.org === 'org-c'))
    await page.goto(BASE + '/organizer/team', { waitUntil: 'networkidle' })
    await settle(page)
    rec('switch', 'the Team page shows B\'s teammate, not A\'s', (await main(page)).includes('Esi Kente-Teammate') && !(await main(page)).includes('Kofi Accra-Teammate'))
    await pick(page, 'Accra Events')
    rec('switch', 'switching on Team stays on Team, for the new organization', page.url().endsWith('/organizer/team') && (await main(page)).includes('Kofi Accra-Teammate') && !(await main(page)).includes('Esi Kente-Teammate'))
    rec('switch', 'the choice is remembered per person', (await page.evaluate((k) => localStorage.getItem(k), STORE)) === 'org-a' && (await page.evaluate(() => localStorage.getItem('rally.organizer.active_org'))) === null)
    rec('switch', 'no console or page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---- 3. a slow response from the previous organization cannot land after a switch ----
  {
    reset({ eventsDelay: { 'org-a': 2500 } })
    const { page, ctx } = await open('/organizer', { stored: 'org-a' })
    // A's events are still in flight. Switch now.
    await pick(page, 'Kente Foods')
    await page.waitForTimeout(3200) // well past A's delayed answer
    const s = await showsOnly(page, 'org-b')
    rec('isolation', 'A\'s late answer never appears on B\'s dashboard', s.own && s.leaked.length === 0, JSON.stringify(s))
    rec('isolation', 'the header still says Kente Foods', (await headerName(page)).includes('Kente Foods'))
    await ctx.close()
  }

  // ---- 4. direct links, refresh and event pages ---------------------------------------
  {
    reset()
    const { page, ctx } = await open('/organizer/events/e-b1', { stored: 'org-a' })
    await settle(page)
    rec('links', 'a direct link to B\'s event opens it although A was selected', (await main(page)).includes('Kente Harvest Expo'))
    rec('links', '...and the workspace follows the event to Kente Foods', (await headerName(page)).includes('Kente Foods'))
    await page.reload({ waitUntil: 'networkidle' })
    await settle(page)
    rec('links', 'a refresh keeps the event page and its organization', (await main(page)).includes('Kente Harvest Expo') && (await headerName(page)).includes('Kente Foods'))
    await pick(page, 'Accra Events')
    rec('links', 'switching from an event page opens the new organization\'s Events list', page.url().endsWith('/organizer/events') && (await shows(page, 'org-a')) && !(await main(page)).includes('Kente Harvest Expo'), page.url())
    await page.reload({ waitUntil: 'networkidle' })
    await settle(page)
    rec('links', 'a refresh after switching stays in Accra Events', (await headerName(page)).includes('Accra Events') && page.url().endsWith('/organizer/events'))
    await page.goto(BASE + '/organizer/events/e-b2', { waitUntil: 'networkidle' })
    await settle(page)
    rec('links', 'an unassigned B event is still refused to an event manager (event authorization unchanged)', !(await main(page)).includes('Kente Supplier Day') && (await headerName(page)).includes('Accra Events'), (await main(page)).slice(0, 200))
    await page.goto(BASE + '/organizer/events/e-c1', { waitUntil: 'networkidle' })
    await settle(page)
    rec('links', 'a link to another organization\'s event shows nothing of it and changes no workspace', !(await main(page)).includes('TechGhana') && (await headerName(page)).includes('Accra Events'))
    await ctx.close()

    // Added to B after this tab loaded its list, then following a link to B's event.
    reset({ memberships: [['org-a', 'owner']] })
    const late = await open('/organizer', { stored: 'org-a' })
    ctl.memberships = [['org-a', 'owner'], ['org-b', 'manager']]
    const before = log.access
    await late.page.evaluate(() => { history.pushState({}, '', '/organizer/events/e-b1'); dispatchEvent(new PopStateEvent('popstate')) })
    await settle(late.page, 800)
    rec('links', 'a link to an event of an organization joined after the list loaded: shown, and the header follows once the list is re-checked',
      (await main(late.page)).includes('Kente Harvest Expo') && (await headerName(late.page)).includes('Kente Foods') && log.access > before, `access calls ${before} -> ${log.access}`)
    await late.ctx.close()
  }

  // ---- 5. every existing organizer route still works -----------------------------------
  {
    reset()
    const routes = ['/organizer', '/organizer/events', '/organizer/events/new', '/organizer/events/e-a1', '/organizer/events/e-a1/edit', '/organizer/people', '/organizer/team', '/organizer/settings', '/organizer/invitations']
    const { page, ctx, errors } = await open('/organizer', { stored: 'org-a' })
    const bad = []
    for (const r of routes) {
      await page.goto(BASE + r, { waitUntil: 'networkidle' })
      await settle(page, 200)
      const h1 = await page.locator('main h1').first().innerText().catch(() => '')
      if (!page.url().endsWith(r) || !h1) bad.push(`${r} -> ${page.url()} [${h1}]`)
    }
    rec('routes', 'all 9 organizer routes open on a direct link, each with a page heading', bad.length === 0, bad.join('; '))
    rec('routes', 'no console or page errors on any of them', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---- 6. a revoked membership invalidates the selected workspace ----------------------
  {
    reset()
    const { page, ctx } = await open('/organizer', { stored: 'org-b' })
    rec('revoked', 'B is selected', (await headerName(page)).includes('Kente Foods'))
    ctl.memberships = [['org-a', 'owner']] // B removed the person while the tab was in the background
    await returnToTab(page)
    await settle(page, 600)
    const notice = await page.getByRole('alert').innerText().catch(() => '')
    rec('revoked', 'returning to the tab re-checks memberships and says access to B ended', /no longer have access to Kente Foods/.test(notice), notice)
    const s = await showsOnly(page, 'org-a')
    rec('revoked', 'the workspace moves to A and nothing of B stays on screen', (await headerName(page)).includes('Accra Events') && s.leaked.length === 0, JSON.stringify(s))
    await desktopTrigger(page).count().then(async (n) => rec('revoked', 'one organization left: no switch control, just the identity', n === 0))
    await page.reload({ waitUntil: 'networkidle' })
    rec('revoked', 'after a refresh the stale choice is replaced', (await page.evaluate((k) => localStorage.getItem(k), STORE)) === 'org-a' && (await headerName(page)).includes('Accra Events'))
    await ctx.close()

    reset()
    const nav = await open('/organizer', { stored: 'org-b' })
    ctl.memberships = [['org-a', 'owner']]
    await nav.page.evaluate(() => { window.__clockOffset += 60_000 }) // past the interval; no focus event
    await nav.page.locator('aside').getByRole('link', { name: 'Events' }).click()
    await settle(nav.page, 700)
    rec('revoked', 'moving to another page re-checks too: B is gone, the Events page shown is A\'s',
      /no longer have access to Kente Foods/.test(await nav.page.getByRole('alert').innerText().catch(() => '')) && (await headerName(nav.page)).includes('Accra Events') && nav.page.url().endsWith('/organizer/events') && !(await shows(nav.page, 'org-b')))
    await nav.ctx.close()

    reset()
    const second = await open('/organizer/events/e-b1', { stored: 'org-b' })
    await settle(second.page)
    ctl.memberships = [['org-a', 'owner']]
    await returnToTab(second.page)
    await settle(second.page, 700)
    rec('revoked', 'on one of B\'s event pages, losing B leaves the page for A\'s Events list', second.page.url().endsWith('/organizer/events') && !(await main(second.page)).includes('Kente Harvest Expo'), second.page.url())
    await second.ctx.close()

    reset()
    const third = await open('/organizer', { stored: 'org-a' })
    ctl.memberships = []
    await returnToTab(third.page)
    await settle(third.page, 700)
    rec('revoked', 'losing every membership sends an organizer account to setup, with no organization data left', third.page.url().endsWith('/organizer/setup') && !(await third.page.locator('body').innerText()).includes('Accra Founders Summit'), third.page.url())
    await third.ctx.close()
  }

  // ---- 7. failed checks and an expired session -----------------------------------------
  {
    reset()
    const { page, ctx } = await open('/organizer', { stored: 'org-a' })
    ctl.accessFailNext = 1
    await returnToTab(page)
    await settle(page)
    rec('failure', 'a failed background re-check never blanks the dashboard', (await shows(page, 'org-a')) && (await page.getByRole('alert').count()) === 0)
    await desktopTrigger(page).click()
    await page.waitForTimeout(200)
    const menuText = await page.getByRole('menu').innerText()
    rec('failure', 'the switcher says it could not confirm the list, and still offers it', /Couldn't confirm your organizations/.test(menuText) && (await page.getByRole('menuitemradio').count()) === 2, menuText)
    await page.getByRole('button', { name: 'Retry' }).click()
    await settle(page)
    rec('failure', 'Retry re-checks at once and clears the warning', !/Couldn't confirm/.test(await page.getByRole('menu').innerText().catch(() => '')))
    await ctx.close()

    reset({ accessFailing: true })
    const first = await open('/organizer', { stored: 'org-a' })
    const body = await first.page.locator('body').innerText()
    rec('failure', 'a failed first load reports the error with a retry, stays put, and shows no organization', /Could not load your organizations/.test(body) && !body.includes('Accra') && !body.includes('Kente') && first.page.url().endsWith('/organizer'), body.slice(0, 160))
    ctl.accessFailing = false
    await first.page.getByRole('button', { name: /try again|retry/i }).first().click().catch(() => {})
    await settle(first.page)
    rec('failure', '...and retrying loads the workspace', (await headerName(first.page)).includes('Accra Events'))
    await first.ctx.close()

    reset()
    const jwt = await open('/organizer', { stored: 'org-a' })
    ctl.accessFailNext = 1
    ctl.accessStatus = 401
    await returnToTab(jwt.page)
    await settle(jwt.page)
    await desktopTrigger(jwt.page).click()
    await jwt.page.waitForTimeout(200)
    rec('session', 'a token the API rejects on a background re-check keeps the page and warns in the switcher',
      (await shows(jwt.page, 'org-a')) && /Couldn't confirm your organizations/.test(await jwt.page.getByRole('menu').innerText().catch(() => '')))
    await jwt.ctx.close()

    reset()
    const expired = await open('/organizer', { stored: 'org-a', expired: true })
    await settle(expired.page, 800)
    const t = await expired.page.locator('body').innerText()
    rec('session', 'an expired session that cannot be refreshed lands on sign-in, with no organization shown', expired.page.url().includes('/login') && !t.includes('Accra Events') && !t.includes('Kente Foods'), expired.page.url())
    rec('session', '...and no organization data was requested', log.orgReads.length === 0, JSON.stringify(log.orgReads))
    await expired.ctx.close()
  }

  // ---- 7a. a quiet re-check that finds nothing new changes nothing ------------------------
  {
    reset()
    const { page, ctx } = await open('/organizer/settings', { stored: 'org-a' })
    await page.fill('#name', 'Accra Events (unsaved edit)')
    const readsBefore = log.orgReads.length
    await returnToTab(page)
    await settle(page)
    rec('quiet', 'an unsaved Settings edit survives a re-check that finds the same memberships', (await page.inputValue('#name')) === 'Accra Events (unsaved edit)', await page.inputValue('#name'))
    await page.goto(BASE + '/organizer', { waitUntil: 'networkidle' })
    await settle(page)
    const dashReads = log.orgReads.length
    await returnToTab(page)
    await settle(page)
    rec('quiet', '...and makes the dashboard reload nothing', log.orgReads.length === dashReads, `${dashReads} -> ${log.orgReads.length}`)
    rec('quiet', '...while the re-check itself did happen', log.access >= 3 && readsBefore >= 0)
    await ctx.close()
  }

  // ---- 7b. a second tab, signing out, and a different person ----------------------------
  {
    reset()
    const t = await open('/organizer', { stored: 'org-a' })
    const tab2 = await t.ctx.newPage()
    await tab2.goto(BASE + '/organizer', { waitUntil: 'networkidle' })
    await settle(tab2)
    rec('tabs', 'a second tab opens in the remembered organization', (await headerName(tab2)).includes('Accra Events'))
    await pick(tab2, 'Kente Foods')
    rec('tabs', 'switching in one tab leaves the other tab\'s page and data as they were (no mixing)',
      (await headerName(t.page)).includes('Accra Events') && (await shows(t.page, 'org-a')) && !(await shows(t.page, 'org-b')))
    await returnToTab(t.page)
    await settle(t.page)
    rec('tabs', 'returning to that tab after a while re-checks quietly and keeps its workspace and page',
      (await headerName(t.page)).includes('Accra Events') && t.page.url().endsWith('/organizer') && (await t.page.getByRole('alert').count()) === 0)
    await t.page.reload({ waitUntil: 'networkidle' })
    await settle(t.page)
    rec('tabs', 'a reload opens the organization chosen last, in either tab', (await headerName(t.page)).includes('Kente Foods'))
    const later = await t.ctx.newPage()
    await later.goto(BASE + '/organizer/events', { waitUntil: 'networkidle' })
    await settle(later)
    rec('tabs', 'a tab opened later restores the session and the workspace', (await headerName(later)).includes('Kente Foods') && (await shows(later, 'org-b')))
    await later.close()

    await tab2.locator('aside').getByRole('button', { name: 'Sign out' }).click()
    await t.page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {})
    await settle(t.page)
    const bodyOut = await t.page.locator('body').innerText()
    rec('sign-out', 'signing out in one tab signs the other out too, with nothing of the workspace left',
      t.page.url().includes('/login') && !FIRST_PERSON_TEXT.some((x) => bodyOut.includes(x)), t.page.url())

    // A different person signs in, in the other tab. Watch the first tab: from the
    // moment the new person's workspace appears, nothing of the first may appear.
    await t.page.addInitScript(watchForMixing, FIRST_PERSON_TEXT)
    await t.page.evaluate(watchForMixing, FIRST_PERSON_TEXT)
    await tab2.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {})
    await tab2.fill('#email', 'kojo@example.test')
    await tab2.fill('#password', 'not-a-real-password')
    await tab2.getByRole('button', { name: 'Sign in' }).click()
    await tab2.waitForURL(/\/organizer/, { timeout: 8000 }).catch(() => {})
    await settle(tab2, 600)
    rec('account', 'the second person lands in their own organization', (await headerName(tab2)).includes('Volta Ventures'), tab2.url())
    // The first tab follows the sign-in by itself (supabase-js tells other tabs);
    // if it has not within a few seconds, open the app again in it.
    await t.page.waitForURL(/\/organizer/, { timeout: 5000 }).catch(() => t.page.goto(BASE + '/organizer', { waitUntil: 'networkidle' }))
    await settle(t.page, 600)
    const bodyY = await t.page.locator('body').innerText()
    rec('account', 'the first tab now shows only the second person\'s workspace', (await headerName(t.page)).includes('Volta Ventures') && !FIRST_PERSON_TEXT.some((x) => bodyY.includes(x)))
    rec('account', 'no screen showed the second person\'s workspace with anything of the first', (await mixed(t.page)).length === 0, JSON.stringify((await mixed(t.page)).slice(0, 3)))
    rec('account', 'nothing was requested for the first person\'s organizations with the second person\'s session',
      !log.orgReads.some((r) => r.caller === UID2 && (r.org === 'org-a' || r.org === 'org-b')) && log.orgReads.some((r) => r.caller === UID2 && r.org === 'org-v'))
    const stores = await t.page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [STORE, 'rally.organizer.active_org:' + UID2])
    rec('account', 'each person\'s choice is kept apart in storage', stores[0] === 'org-b' && stores[1] === 'org-v', JSON.stringify(stores))
    await t.ctx.close()

    // The same person's tab picks up a different person's session without a
    // sign-out in between (another tab signed in over it).
    reset()
    const d = await open('/organizer', { stored: 'org-b' })
    await d.page.addInitScript(watchForMixing, FIRST_PERSON_TEXT)
    await d.page.evaluate(watchForMixing, FIRST_PERSON_TEXT)
    await d.page.evaluate((sess) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(sess)), sessionFor(UID2, 'kojo@example.test'))
    await d.page.evaluate(() => { window.__clockOffset += 60_000; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
    await settle(d.page, 1000)
    // supabase-js adopts the new token from storage with no auth event, so the app
    // still believes the first person is signed in. The workspace must not show
    // the first person's organizations to the new token, nor file the new
    // person's organizations under the first.
    const bodyD = await d.page.locator('body').innerText()
    rec('account', 'a different person\'s session arriving without a sign-out: the organizer area shows neither workspace, only a reload notice',
      /sign-in changed in another tab/i.test(bodyD) && !FIRST_PERSON_TEXT.some((x) => bodyD.includes(x)) && !bodyD.includes('Volta'), bodyD.slice(0, 200))
    rec('account', '...no false "lost access", and the first person\'s remembered choice is untouched',
      !/no longer have access/.test(bodyD) && (await d.page.evaluate((k) => localStorage.getItem(k), STORE)) === 'org-b')
    await d.page.getByRole('button', { name: 'Reload' }).click()
    await d.page.waitForLoadState('networkidle')
    await settle(d.page, 800)
    const bodyD2 = await d.page.locator('body').innerText()
    rec('account', '...and Reload opens the new person\'s own workspace, with nothing of the first',
      (await headerName(d.page)).includes('Volta Ventures') && !FIRST_PERSON_TEXT.some((x) => bodyD2.includes(x)), await headerName(d.page))
    rec('account', '...and no screen at any point mixed the two', (await mixed(d.page)).length === 0, JSON.stringify((await mixed(d.page)).slice(0, 3)))
    rec('account', '...and nothing of the first person\'s organizations was requested with the second person\'s session', !log.orgReads.some((r) => r.caller === UID2 && (r.org === 'org-a' || r.org === 'org-b')), JSON.stringify(log.orgReads.filter((r) => r.caller === UID2)))
    await d.ctx.close()
  }

  // ---- 8. accepting an invitation switches to the new organization ----------------------
  {
    reset({
      pendingInvitations: [{ id: 'inv-c', organization_id: 'org-c', organization_name: 'TechGhana Summit', organization_type: 'organizer', role: 'admin', created_at: '2026-11-01', expires_at: null, invited_by_name: 'Yaw' }],
    })
    const { page, ctx } = await open('/organizer/invitations', { stored: 'org-a' })
    await page.getByRole('button', { name: /accept/i }).first().click()
    await settle(page, 600)
    rec('invite', 'after accepting, the new organization is the selected workspace (it used to stay on the old one)', (await headerName(page)).includes('TechGhana Summit'), await headerName(page))
    await desktopTrigger(page).click()
    rec('invite', '...and the switcher now lists all three', (await page.getByRole('menuitemradio').count()) === 3)
    await ctx.close()
  }

  // ---- 9. Personal, for an account that has one -----------------------------------------
  {
    reset({ accountType: 'attendee', memberships: [['org-a', 'manager']] })
    const { page, ctx } = await open('/organizer', { stored: 'org-a' })
    rec('personal', 'the existing "Back to My Rally" action is still there', (await page.locator('aside').getByRole('button', { name: 'Back to My Rally' }).count()) === 1)
    await desktopTrigger(page).click()
    const personal = page.getByRole('menuitemradio', { name: /^Personal/ })
    rec('personal', 'an attendee on one team gets Personal and the organization', (await personal.count()) === 1 && (await page.getByRole('menuitemradio').count()) === 2)
    await personal.click()
    await settle(page)
    rec('personal', 'Personal opens the attendee home', page.url().endsWith('/dashboard'), page.url())
    await ctx.close()
  }

  // ---- 10. phone ------------------------------------------------------------------------
  for (const w of [390, 320]) {
    reset()
    const { page, ctx, errors } = await open('/organizer', { w, h: 844, stored: 'org-a' })
    const chip = page.getByRole('button', { name: /^Switch workspace/ }).first()
    rec(`phone ${w}`, 'the top bar shows the selected organization', (await chip.isVisible()) && (await chip.innerText()).includes('Accra Events'))
    const box = await chip.boundingBox()
    rec(`phone ${w}`, 'the control is at least 44px tall', box && box.height >= 44, JSON.stringify(box))
    // The top bar is what this change touches. (The dashboard body is 339px wide
    // at a 320px viewport when events are listed, on development too: unrelated.)
    const bar = await page.evaluate(() => {
      const chipEl = Array.from(document.querySelectorAll('button[aria-label^="Switch workspace"]')).find((el) => el.offsetParent !== null)
      const barEl = chipEl && chipEl.closest('.sticky')
      const search = barEl && barEl.querySelector('button[aria-label="Search"]')
      return barEl && search ? { fits: barEl.scrollWidth <= barEl.clientWidth, gap: Math.round(search.getBoundingClientRect().left - chipEl.getBoundingClientRect().right) } : null
    })
    rec(`phone ${w}`, 'the top bar fits: the organization name truncates before the actions', bar && bar.fits && bar.gap >= 0, JSON.stringify(bar))
    await chip.click()
    const sheet = page.getByRole('dialog', { name: 'Switch workspace' })
    rec(`phone ${w}`, 'it opens a sheet listing both organizations', (await sheet.isVisible()) && (await sheet.getByRole('button', { name: /^(Accra Events|Kente Foods),/ }).count()) === 2)
    const rowBox = await sheet.getByRole('button', { name: /^Kente Foods/ }).boundingBox()
    rec(`phone ${w}`, 'rows are at least 44px tall', rowBox && rowBox.height >= 44, JSON.stringify(rowBox))
    await page.screenshot({ path: path.join(OUT, `workspace-phone-${w}-sheet.png`) })
    await sheet.getByRole('button', { name: /^Kente Foods/ }).click()
    await settle(page)
    const s = await showsOnly(page, 'org-b')
    rec(`phone ${w}`, 'choosing B closes the sheet and shows B, with nothing of A', (await sheet.count()) === 0 && (await chip.innerText()).includes('Kente Foods') && s.own && s.leaked.length === 0, JSON.stringify(s))
    const nav = page.getByRole('navigation', { name: 'Organizer' })
    await nav.getByRole('link', { name: 'Events' }).click()
    await settle(page)
    rec(`phone ${w}`, 'the bottom navigation still works, in the selected organization', page.url().endsWith('/organizer/events') && (await shows(page, 'org-b')))
    await nav.getByRole('button', { name: 'More menu' }).click()
    await page.waitForTimeout(400)
    const drawer = page.getByRole('dialog', { name: 'Organizer menu' })
    const group = drawer.getByRole('group', { name: 'Workspaces' })
    rec(`phone ${w}`, 'the More drawer has the same Workspaces list', (await group.getByRole('button', { name: /^(Accra Events|Kente Foods),/ }).count()) === 2)
    await group.getByRole('button', { name: /^Accra Events/ }).click()
    await settle(page)
    rec(`phone ${w}`, 'switching from the drawer closes it and stays on Events, for A', page.url().endsWith('/organizer/events') && (await chip.innerText()).includes('Accra Events') && (await shows(page, 'org-a')) && !(await shows(page, 'org-b')))
    await chip.click()
    await page.keyboard.press('Escape')
    rec(`phone ${w}`, 'Escape closes the sheet', (await page.getByRole('dialog', { name: 'Switch workspace' }).count()) === 0)
    rec(`phone ${w}`, 'no console or page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${results.filter((r) => r.pass).length} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
