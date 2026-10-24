// Event Mode shell: desktop sidebar, phone bottom nav and More drawer, tablet layout,
// connection detail inside the shell, and signed-out / wrong-account access.
// Runs against a STUBBED API (see the fixtures below). Nothing here reaches a real Supabase
// project, and no credential is used: the session is a fabricated token for a fake user id.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const API = 'http://localhost:54321'
const UID = '11111111-1111-1111-1111-111111111111'
const INVITER = '22222222-2222-2222-2222-222222222222'
fs.mkdirSync(OUT, { recursive: true })

const svg = (c1, c2) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/></svg>`)

// ---- fixtures ----------------------------------------------------------------
const mk = (i, over = {}) => ({
  id: `e-${String(i).padStart(2, '0')}`, name: `Test Event ${String(i).padStart(2, '0')}`,
  description: 'Fixture event used to check pagination and layout.', location: `City ${i}`,
  start_date: `2027-${String(1 + Math.floor(i / 3)).padStart(2, '0')}-${String(10 + (i % 3)).padStart(2, '0')}`,
  end_date: null, start_time: i % 4 === 0 ? '09:00:00' : null, end_time: null,
  image_url: i % 2 ? svg('#0a66c2', '#0b1c30') : '', capacity: i % 5 === 0 ? 500 : null,
  status: 'upcoming', timezone: null, created_at: '2026-06-01', owner_id: null, ...over,
})
const events = [
  mk(0, { id: 'e-past', name: 'Past Founders Mixer', start_date: '2026-09-04', status: 'past', location: 'Lagos' }),
  mk(0, { id: 'e-next', name: 'Registered Next Event', start_date: '2027-03-01', location: 'Accra', image_url: svg('#10b981', '#0b1c30') }),
  ...Array.from({ length: 14 }, (_, i) => mk(i + 1)),
].sort((a, b) => (a.start_date + a.id).localeCompare(b.start_date + b.id))

const sess = (n, over = {}) => ({ id: `s${n}`, event_id: 'e-02', title: `Session ${n}: Keynote on payments`, description: '', start_at: `2027-01-12T${String(7 + n).padStart(2, '0')}:00:00Z`, end_at: `2027-01-12T${String(8 + n).padStart(2, '0')}:00:00Z`, location: `Hall ${n}`, session_type: n === 1 ? 'keynote' : 'session', status: 'scheduled', display_order: n, event_timezone: 'UTC', ...over })
const agendaRows = [sess(1), sess(2), sess(3), sess(4), sess(5), sess(6, { title: 'Hidden cancelled session', status: 'cancelled' }), sess(7)]
const speakerRows = ['Dr. Amina Bello', 'Kwesi Mensah', 'Linda Ncube'].map((n, i) => ({ id: `sp${i}`, event_id: 'e-02', user_id: null, full_name: n, job_title: 'Chair', company: 'AU Commission', bio: '', photo_url: '', linkedin: '', website: '', industry: '', display_order: i, session_count: 1 }))
const exhibitorRows = ['MTN Group', 'Flutterwave'].map((n, i) => ({ id: `x${i}`, event_id: 'e-02', organization_id: null, name: n, description: '', logo_url: '', industry: 'Fintech', booth: `B${i + 1}`, website: '', linkedin: '', display_order: i }))
const profile = { id: UID, full_name: 'Freda Astanga', photo_url: '', job_title: 'Founder', company: 'SheBuilds', industry: 'Technology', location: 'Accra', bio: 'Builder of things.', looking_for: 'Partners', can_offer: 'Mentorship', linkedin: '', website: '', email: 'f@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }
const conns = [1, 2, 3].map((n) => ({ id: `c${n}`, owner_id: UID, connected_user_id: null, full_name: ['Ama Mensah', 'Kwame Asante', 'Efua Boateng'][n - 1], job_title: 'Head of Product', company: 'Zeepay', industry: 'Fintech', location: 'Accra', email: 'a@x.test', phone: '', linkedin: '', website: '', photo_url: '', relationship_type: 'Partner', event_name: 'Test Event 02', event_id: 'e-02', follow_up_date: n === 1 ? '2026-10-20' : null, status: 'Active', created_at: '2026-10-01', updated_at: '2026-10-02' }))
const followUps = [1, 2].map((n) => ({ id: `f${n}`, connection_id: `c${n}`, owner_id: UID, title: n === 1 ? 'Send proposal deck' : 'Share intro', note: 'Mentioned the payments corridor.', due_date: n === 1 ? '2026-10-20' : '2026-11-02', completed: false, completed_at: null, created_at: '2026-10-01' }))
const opps = [1, 2].map((n) => ({ id: `o${n}`, owner_id: UID, connection_id: `c${n}`, title: n === 1 ? 'Payments partnership' : 'Seed investment', description: 'Fixture opportunity.', type: n === 1 ? 'Partnership' : 'Investment', stage: n === 1 ? 'Discussing' : 'Proposal', value: n === 1 ? 25000 : 120000, expected_close_date: '2026-12-15', event_name: 'Test Event 02', event_id: 'e-02', created_at: '2026-10-01', updated_at: '2026-10-05' }))
const notifs = [1, 2, 3].map((n) => ({ id: `n${n}`, user_id: UID, type: 'new_connection', title: 'New connection', message: `You connected with Person ${n}.`, link: '/connections', read: n > 1, created_at: '2026-10-2' + n }))
const convs = [1, 2].map((n) => ({ conversation_id: `cv${n}`, other_user_id: INVITER, other_full_name: ['Kwame Asante', 'Linda Ncube'][n - 1], other_job_title: 'Director', other_company: 'UNDP', other_photo_url: '', event_id: null, event_name: null, last_message_body: 'See you at the summit!', last_message_at: '2026-10-22T10:00:00Z', last_message_sender_id: INVITER, unread_count: n === 1 ? 2 : 0, updated_at: '2026-10-22T10:00:00Z' }))
const msgs = [1, 2, 3].map((n) => ({ id: `m${n}`, sender_id: n % 2 ? INVITER : UID, body: `Fixture message ${n}`, created_at: `2026-10-22T10:0${n}:00Z`, is_mine: n % 2 === 0 }))

// ---- mock state --------------------------------------------------------------
const ctl = { accountType: 'attendee', failUnregister: false, delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false, failRegisterOnlyAfterStatus: false }
let registered, invitations, regCounts, log
function reset() {
  registered = new Set(['e-next'])
  invitations = ['e-02', 'e-04', 'e-06'].map((eid, i) => ({ id: `inv-${i}`, event_id: eid, invited_user_id: UID, invited_by: INVITER, status: 'Pending', created_at: `2026-10-0${i + 1}`, responded_at: null }))
  regCounts = Object.fromEntries(events.map((e) => [e.id, 7]))
  log = []
  Object.assign(ctl, { accountType: 'attendee', failUnregister: false, delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false })
}
reset()

// PostgREST-style: apply col=eq.value filters, and return one object when a single row is requested.
function rows(url, single) {
  let r = rawRows(url)
  if (Array.isArray(r) && r.length) {
    for (const [k, v] of new URL(url).searchParams) if (v.startsWith('eq.') && r.length && k in r[0]) r = r.filter((x) => String(x[k]) === v.slice(3))
  }
  return single ? (Array.isArray(r) ? r[0] ?? null : r) : r
}
function rawRows(url) {
  const p = new URL(url).pathname
  const one = (r) => r
  if (p.endsWith('/profiles')) return one([profile])
  if (p.endsWith('/user_accounts')) return one([{ account_type: ctl.accountType, status: 'active' }])
  if (p.endsWith('/events')) return events
  if (p.endsWith('/event_registrations')) return [...registered].map((id) => ({ event_id: id, id: 'r-' + id, user_id: UID, checked_in_at: null }))
  if (p.endsWith('/event_invitations')) return invitations
  if (p.endsWith('/connections')) return one(conns)
  if (p.endsWith('/follow_ups')) return one(followUps)
  if (p.endsWith('/opportunities')) return one(opps)
  if (p.endsWith('/notifications')) return notifs
  if (p.endsWith('/rpc/get_event_registration_counts')) return events.map((e) => ({ event_id: e.id, registration_count: regCounts[e.id] }))
  if (p.endsWith('/rpc/get_public_profiles')) return [
    { id: INVITER, full_name: 'Kwame Asante', photo_url: '', job_title: 'Director', company: 'UNDP', industry: 'Policy', location: 'Accra', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '' },
    { id: UID, full_name: 'Freda Astanga', photo_url: '', job_title: 'Founder', company: 'SheBuilds', industry: 'Technology', location: 'Accra', bio: '', looking_for: '', can_offer: '', linkedin: '', website: '' },
  ]
  if (p.endsWith('/rpc/get_event_agenda')) return agendaRows
  if (p.endsWith('/rpc/get_event_speakers')) return speakerRows
  if (p.endsWith('/rpc/get_event_exhibitors')) return exhibitorRows
  if (p.endsWith('/rpc/event_attendee_directory')) return [{ user_id: INVITER, full_name: 'Kwame Asante', job_title: 'Director', company: 'UNDP', industry: 'Policy', location: 'Accra', photo_url: '', already_connected: false }]
  if (p.endsWith('/rpc/get_my_saved_session_ids')) return []
  if (p.endsWith('/rpc/get_my_conversations')) return convs
  if (p.endsWith('/rpc/get_conversation_messages')) return msgs
  return []
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const err = (code, message) => ({ code, message, details: null, hint: null })

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (m === 'HEAD') { const n = rows(url).length; return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${n}` } }) }
    if (m === 'GET') return json(200, rows(url, (req.headers()['accept'] || '').includes('pgrst.object')))
    if (m === 'POST' && url.includes('/rpc/')) return json(200, rows(url))
    // writes
    if (ctl.delay) await sleep(ctl.delay)
    const bodyTxt = req.postData() || '{}'
    if (m === 'POST' && url.includes('/event_registrations')) {
      const b = JSON.parse(bodyTxt)
      if (ctl.failRegister) { log.push(['POST reg FAILED', b.event_id]); return json(403, err('42501', 'new row violates row-level security policy for table "event_registrations"')) }
      registered.add(b.event_id); regCounts[b.event_id]++; log.push(['POST reg', b.event_id])
      return route.fulfill({ status: 201, headers: cors, body: '' })
    }
    if (m === 'DELETE' && url.includes('/event_registrations')) {
      const id = new URL(url).searchParams.get('event_id').replace('eq.', '')
      if (ctl.failUnregister) { log.push(['DELETE reg FAILED', id]); return json(403, err('42501', 'permission denied for table event_registrations')) }
      registered.delete(id); regCounts[id]--; log.push(['DELETE reg', id])
      return route.fulfill({ status: 204, headers: cors, body: '' })
    }
    if (m === 'PATCH' && url.includes('/event_invitations')) {
      const b = JSON.parse(bodyTxt); const id = new URL(url).searchParams.get('id').replace('eq.', '')
      const fail = b.status === 'Accepted' ? ctl.failAcceptPatch : ctl.failDeclinePatch
      if (fail) { log.push([`PATCH ${b.status} FAILED`, id]); return json(403, err('42501', 'permission denied for table event_invitations')) }
      invitations.find((i) => i.id === id).status = b.status; log.push([`PATCH ${b.status}`, id])
      return route.fulfill({ status: 204, headers: cors, body: '' })
    }
    return route.fulfill({ status: 201, headers: cors, body: '' })
  })
}

const results = []
let fails = 0
function rec(group, name, pass, detail = '') {
  if (!pass) fails++
  results.push({ group, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? '  -> ' + detail : ''}`)
}


;(async () => {
  const browser = await launchBrowser()
  async function open(w, h, url, { noSession, collapsed } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()) })
    if (!noSession) {
      await ctx.addInitScript(([uid]) => {
        const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'f@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }
        localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
      }, [UID])
    }
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, [role=alert], main, aside', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(250)
    return { page, ctx, errors }
  }
  async function shot(page, w, file) {
    const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, 600))
    await page.setViewportSize({ width: w, height: Math.min(h, 6000) })
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 86 })
  }
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const txt = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim())
  const vis = (page, sel) => page.isVisible(sel)

  // ===================== A. Event Mode shell, desktop =========================
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events/e-next/home')
    rec('shell-desktop', 'sidebar visible, bottom nav hidden', (await vis(page, 'aside')) && !(await vis(page, 'nav[aria-label="Event navigation"]')))
    const labels = await page.$$eval('aside nav a', (a) => a.map((x) => x.textContent.trim()))
    rec('shell-desktop', 'sidebar nav items match existing routes only', JSON.stringify(labels.slice(0, 8)) === JSON.stringify(['Event Details', 'Event Home', 'Attendee Directory', 'Agenda', 'My Schedule', 'Speakers', 'Exhibitors', 'Messages']), labels.join(' | '))
    rec('shell-desktop', 'sidebar shows the real event name', (await txt(page, 'aside')).includes('Registered Next Event'))
    rec('shell-desktop', 'no fake sponsor / meetings / notes / saved entries', !/Meetings|My Notes|Saved|Sponsors|Pro/.test(await txt(page, 'aside')))
    rec('shell-desktop', 'Home: no duplicate top bar (hero carries identity)', (await page.$$('header')).length === 0)
    await shot(page, 1440, 'eventmode-desktop-home.jpg')
    const hrefs = {}
    for (const [label, suffix, extra] of [['Attendee Directory', '/network'], ['Agenda', '/agenda'], ['My Schedule', '/schedule'], ['Speakers', '/speakers'], ['Exhibitors', '/exhibitors'], ['Messages', '/messages'], ['Event Home', '/home']]) {
      await page.click(`aside nav a:has-text("${label}")`)
      await page.waitForURL('**/events/e-next' + suffix)
      await page.waitForTimeout(250)
      const active = await page.$eval(`aside nav a:has-text("${label}")`, (a) => a.getAttribute('aria-current') === 'page')
      const only = await page.$$eval('aside nav a', (a) => a.filter((x) => x.getAttribute('aria-current') === 'page').length)
      rec('shell-desktop', `"${label}" -> ${suffix}, highlighted, and only it`, active && only === 1)
      if (suffix !== '/home') await shot(page, 1440, `eventmode-desktop${suffix.replace('/', '-')}.jpg`)
    }
    // inner page header: no back arrow / More, has bell
    await page.click('aside nav a:has-text("Agenda")')
    await page.waitForURL('**/agenda')
    rec('shell-desktop', 'inner page: header shows event name + bell; back arrow and More hidden', (await vis(page, 'header')) && (await vis(page, 'header a[aria-label^="Notifications"]')) && !(await vis(page, 'header button[aria-label="Back to event home"]')) && !(await vis(page, 'header button[aria-label="More menu"]')))
    rec('shell-desktop', 'content is offset by the sidebar (no overlap)', await page.evaluate(() => document.querySelector('main').getBoundingClientRect().left >= 255))
    rec('shell-desktop', 'no horizontal overflow', (await overflow(page)) === 0)
    // Connect
    await page.click('aside button:has-text("Connect")')
    rec('shell-desktop', 'Connect opens the existing connect sheet', await page.waitForSelector('[role=dialog]', { timeout: 3000 }).then(() => true).catch(() => false))
    await shot(page, 1440, 'eventmode-desktop-connect-sheet.jpg')
    await page.keyboard.press('Escape')
    await page.reload({ waitUntil: 'networkidle' })
    // exits
    await page.click('aside a:has-text("All Events")'); await page.waitForURL('**/events')
    rec('shell-desktop', 'All Events -> /events', true)
    await page.goBack(); await page.waitForURL('**/agenda')
    await page.click('aside a:has-text("Exit Event Mode")'); await page.waitForURL('**/dashboard')
    rec('shell-desktop', 'Exit Event Mode -> /dashboard', true)
    await page.goBack(); await page.waitForURL('**/agenda')
    await page.click('aside a:has-text("Notifications")'); await page.waitForURL('**/notifications')
    rec('shell-desktop', 'Notifications -> /notifications', true)
    await page.goBack(); await page.waitForURL('**/agenda')
    await page.click('aside a:has-text("My Profile")'); await page.waitForURL('**/profile')
    rec('shell-desktop', 'My Profile -> /profile', true)
    // connection page keeps the directory highlighted
    await page.goto(BASE + '/events/e-next/connections/c1', { waitUntil: 'networkidle' })
    rec('shell-desktop', 'connection detail keeps "Attendee Directory" highlighted', await page.$eval('aside nav a:has-text("Attendee Directory")', (a) => a.className.includes('bg-primary-600')))
    rec('shell-desktop', 'console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ===================== B. Event Mode shell, mobile + tablet =================
  for (const [w, h, tag] of [[390, 844, 'mobile'], [320, 700, 'narrow'], [820, 1100, 'tablet']]) {
    reset()
    const { page, ctx, errors } = await open(w, h, '/events/e-next/agenda')
    if (w < 768) {
      rec(`shell-${tag}`, 'bottom nav visible, sidebar hidden', (await vis(page, 'nav[aria-label="Event navigation"]')) && !(await vis(page, 'aside')))
      const items = await page.$$eval('nav[aria-label="Event navigation"] a, nav[aria-label="Event navigation"] button', (e) => e.map((x) => [x.getAttribute('aria-label'), Math.round(x.getBoundingClientRect().width), Math.round(x.getBoundingClientRect().height)]))
      rec(`shell-${tag}`, 'bottom nav: Home, Network, Connect, Messages, More; all >= 44px', items.length === 5 && items.every(([, ww, hh]) => hh >= 44 && ww >= 44), items.map((i) => i.join(':')).join(' '))
      rec(`shell-${tag}`, 'inner header: back arrow + More menu present, bell hidden', (await vis(page, 'header button[aria-label="Back to event home"]')) && (await vis(page, 'header button[aria-label="More menu"]')) && !(await vis(page, 'header a[aria-label^="Notifications"]')))
      await page.click('nav[aria-label="Event navigation"] a[aria-label^="Event network"]')
      await page.waitForURL('**/events/e-next/network')
      rec(`shell-${tag}`, 'bottom nav Network -> /network', true)
      await page.click('nav[aria-label="Event navigation"] a[aria-label^="Messages"]')
      await page.waitForURL('**/events/e-next/messages')
      await page.click('nav[aria-label="Event navigation"] a[aria-label="Event home"]')
      await page.waitForURL('**/events/e-next/home')
      rec(`shell-${tag}`, 'bottom nav Messages and Home work', true)
      await page.click('nav[aria-label="Event navigation"] button[aria-label="Connect"]')
      rec(`shell-${tag}`, 'Connect opens sheet', await page.waitForSelector('[role=dialog]', { timeout: 3000 }).then(() => true).catch(() => false))
      await shot(page, w, `eventmode-${tag}-connect-sheet.jpg`)
      await page.keyboard.press('Escape')
      await page.reload({ waitUntil: 'networkidle' })
      await page.goto(BASE + '/events/e-next/agenda', { waitUntil: 'networkidle' })
      await page.click('header button[aria-label="More menu"]')
      await page.waitForSelector('[role=dialog]')
      const drawer = await page.$$eval('[role=dialog] nav button', (b) => b.map((x) => x.textContent.trim()))
      rec(`shell-${tag}`, 'More drawer lists the existing destinations', drawer.some((d) => /My Schedule/.test(d)) && drawer.some((d) => /Exit to main Rally/.test(d)) && drawer.some((d) => /Notifications/.test(d)), drawer.join(' | '))
      await page.keyboard.press('Escape')
      await page.goto(BASE + '/events/e-next/home', { waitUntil: 'networkidle' })
      await shot(page, w, `eventmode-${tag}-home.jpg`)
      await page.goto(BASE + '/events/e-next/agenda', { waitUntil: 'networkidle' })
      await shot(page, w, `eventmode-${tag}-agenda.jpg`)
      await page.goto(BASE + '/events/e-next/network', { waitUntil: 'networkidle' })
      await shot(page, w, `eventmode-${tag}-network.jpg`)
    } else {
      rec(`shell-${tag}`, '820px uses the sidebar (md breakpoint), no bottom nav', (await vis(page, 'aside')) && !(await vis(page, 'nav[aria-label="Event navigation"]')))
      await shot(page, w, `eventmode-${tag}-agenda.jpg`)
    }
    rec(`shell-${tag}`, `no horizontal overflow at ${w}`, (await overflow(page)) === 0)
    rec(`shell-${tag}`, 'console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // (Event Detail is covered by the dedicated verify_detail suite)

  // ===================== D. Auth + permissions on the new shell ================
  {
    reset()
    const a = await open(1440, 900, '/events/e-02/home', { noSession: true })
    rec('auth', 'signed out: Event Mode route redirects to /login', a.page.url().includes('/login'), a.page.url())
    await a.ctx.close()
    const b = await open(1440, 900, '/events/e-02')
    await b.ctx.close()
    ctl.accountType = 'organizer'
    const c = await open(1440, 900, '/events/e-02/home')
    rec('auth', 'organizer account cannot open Event Mode (redirected away)', !c.page.url().includes('/events/e-02/home'), c.page.url())
    await c.ctx.close()
    const d = await open(1440, 900, '/events/e-02')
    rec('auth', 'organizer account cannot open attendee event detail (redirected away)', !d.page.url().endsWith('/events/e-02'), d.page.url())
    await d.ctx.close()
    ctl.accountType = 'attendee'
  }

  // ===================== E. /events regression =================================
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events')
    rec('regression', '/events still has pagination footer + grid/list toggle', (await vis(page, '[aria-live=polite]')) && (await vis(page, 'button[aria-label="List view"]')))
    rec('regression', '/events: "Showing 1–6 of 14 events"', ((await txt(page, '[aria-live=polite]')) || '').startsWith('Showing 1–6 of 14'))
    await page.click('button[aria-label="Next page"]')
    await page.waitForFunction(() => location.search.includes('page=2'))
    rec('regression', '/events page 2 works', ((await txt(page, '[aria-live=polite]')) || '').startsWith('Showing 7–12'))
    await page.click('article:has-text("Test Event 07") a[aria-label^="View"]')
    await page.waitForURL('**/events/e-07')
    await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {})
    rec('regression', 'event card -> /events/:id detail page', await vis(page, 'h1'))
    rec('regression', 'console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(path.join(OUT, '..', 'results-batch-2.json'), JSON.stringify(results, null, 2))
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - fails}  FAIL ${fails}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
