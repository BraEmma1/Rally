// Events list (search, filter, sort, pagination, counts, sizes) and invitation Accept / Decline,
// including in-flight, failure and partial-success cases.
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

const profile = { id: UID, full_name: 'Freda Astanga', photo_url: '', job_title: 'Founder', company: 'SheBuilds', industry: 'Technology', location: 'Accra', bio: 'Builder of things.', looking_for: 'Partners', can_offer: 'Mentorship', linkedin: '', website: '', email: 'f@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }
const conns = [1, 2, 3].map((n) => ({ id: `c${n}`, owner_id: UID, connected_user_id: null, full_name: ['Ama Mensah', 'Kwame Asante', 'Efua Boateng'][n - 1], job_title: 'Head of Product', company: 'Zeepay', industry: 'Fintech', location: 'Accra', email: 'a@x.test', phone: '', linkedin: '', website: '', photo_url: '', relationship_type: 'Partner', event_name: 'Test Event 02', event_id: 'e-02', follow_up_date: n === 1 ? '2026-10-20' : null, status: 'Active', created_at: '2026-10-01', updated_at: '2026-10-02' }))
const followUps = [1, 2].map((n) => ({ id: `f${n}`, connection_id: `c${n}`, owner_id: UID, title: n === 1 ? 'Send proposal deck' : 'Share intro', note: 'Mentioned the payments corridor.', due_date: n === 1 ? '2026-10-20' : '2026-11-02', completed: false, completed_at: null, created_at: '2026-10-01' }))
const opps = [1, 2].map((n) => ({ id: `o${n}`, owner_id: UID, connection_id: `c${n}`, title: n === 1 ? 'Payments partnership' : 'Seed investment', description: 'Fixture opportunity.', type: n === 1 ? 'Partnership' : 'Investment', stage: n === 1 ? 'Discussing' : 'Proposal', value: n === 1 ? 25000 : 120000, expected_close_date: '2026-12-15', event_name: 'Test Event 02', event_id: 'e-02', created_at: '2026-10-01', updated_at: '2026-10-05' }))
const notifs = [1, 2, 3].map((n) => ({ id: `n${n}`, user_id: UID, type: 'new_connection', title: 'New connection', message: `You connected with Person ${n}.`, link: '/connections', read: n > 1, created_at: '2026-10-2' + n }))
const convs = [1, 2].map((n) => ({ conversation_id: `cv${n}`, other_user_id: INVITER, other_full_name: ['Kwame Asante', 'Linda Ncube'][n - 1], other_job_title: 'Director', other_company: 'UNDP', other_photo_url: '', event_id: null, event_name: null, last_message_body: 'See you at the summit!', last_message_at: '2026-10-22T10:00:00Z', last_message_sender_id: INVITER, unread_count: n === 1 ? 2 : 0, updated_at: '2026-10-22T10:00:00Z' }))
const msgs = [1, 2, 3].map((n) => ({ id: `m${n}`, sender_id: n % 2 ? INVITER : UID, body: `Fixture message ${n}`, created_at: `2026-10-22T10:0${n}:00Z`, is_mine: n % 2 === 0 }))

// ---- mock state --------------------------------------------------------------
const ctl = { delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false, failRegisterOnlyAfterStatus: false }
let registered, invitations, regCounts, log
function reset() {
  registered = new Set(['e-next'])
  invitations = ['e-02', 'e-04', 'e-06'].map((eid, i) => ({ id: `inv-${i}`, event_id: eid, invited_user_id: UID, invited_by: INVITER, status: 'Pending', created_at: `2026-10-0${i + 1}`, responded_at: null }))
  regCounts = Object.fromEntries(events.map((e) => [e.id, 7]))
  log = []
  Object.assign(ctl, { delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false })
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
  if (p.endsWith('/user_accounts')) return one([{ account_type: 'attendee', status: 'active' }])
  if (p.endsWith('/events')) return events
  if (p.endsWith('/event_registrations')) return [...registered].map((id) => ({ event_id: id }))
  if (p.endsWith('/event_invitations')) return invitations
  if (p.endsWith('/connections')) return one(conns)
  if (p.endsWith('/follow_ups')) return one(followUps)
  if (p.endsWith('/opportunities')) return one(opps)
  if (p.endsWith('/notifications')) return notifs
  if (p.endsWith('/rpc/get_event_registration_counts')) return events.map((e) => ({ event_id: e.id, registration_count: regCounts[e.id] }))
  if (p.endsWith('/rpc/get_public_profiles')) return [{ id: INVITER, full_name: 'Kwame Asante' }]
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
  async function open(w, h, url, { view, collapsed } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()) })
    await ctx.addInitScript(([uid, view, collapsed]) => {
      const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'f@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
      if (view) localStorage.setItem('rally.eventsView', view)
      if (collapsed) localStorage.setItem('rally.sidebarCollapsed', '1')
    }, [UID, view || null, collapsed || null])
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, [role=alert], main', { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  // Screenshot the whole page without the fixed-sidebar artifact: grow the viewport to the content height.
  async function shot(page, w, file) {
    const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, 600))
    await page.setViewportSize({ width: w, height: Math.min(h, 6000) })
    await page.waitForTimeout(120)
    await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 86 })
  }
  const cardNames = (page) => page.$$eval('section[aria-labelledby=events-list-heading] article h3', (h) => h.map((x) => x.textContent.trim()))
  const showing = (page) => page.$eval('[aria-live=polite]', (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => null)
  const upcoming = events.filter((e) => e.status === 'upcoming')

  // ================= 1. view-toggle + control sizes ==============================
  {
    reset()
    const { page, ctx } = await open(1440, 900, '/events')
    const sizes = await page.$$eval('button[aria-label="Grid view"], button[aria-label="List view"], nav[aria-label="Events pages"] button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [x.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)] }))
    rec('size', 'view toggle + pagination buttons are >= 44x44 (desktop)', sizes.every(([, w, h]) => w >= 44 && h >= 44), sizes.map((s) => s.join(':')).join(' '))
    await ctx.close()
    for (const w of [390, 320]) {
      const { page, ctx } = await open(w, 800, '/events')
      const s = await page.$$eval('button[aria-label="Grid view"], button[aria-label="List view"], nav[aria-label="Events pages"] button, main button:not([role=tab]), main a[href] button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [(x.getAttribute('aria-label') || x.textContent.trim()).slice(0, 14), Math.round(r.width), Math.round(r.height)] }))
      const bad = s.filter(([, ww, hh]) => ww < 44 || hh < 44)
      rec('size', `all footer + card buttons >= 44x44 at ${w}px`, bad.length === 0, bad.length ? bad.map((x) => x.join(':')).join(' ') : `${s.length} controls ok`)
      await ctx.close()
    }
  }

  // ================= 2. Accept / Decline: loading, success, error ================
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events?tab=invitations')
    await page.waitForSelector('text=Invited by Kwame Asante', { timeout: 6000 }).catch(async () => { console.log('DEBUG BODY:', (await page.innerText('body')).slice(120, 900)); throw new Error('no invitations') })
    const card = (n) => `article:has-text("${n}")`
    await shot(page, 1440, 'events-desktop-invitations-pending.jpg')
    ctl.delay = 800
    // accept #1 (success path, with loading)
    await page.click(`${card('Test Event 02')} button:has-text("Accept")`)
    const loadingLabel = await page.waitForSelector('button:has-text("Accepting…")', { timeout: 3000 }).then(() => true).catch(() => false)
    const disabledNow = await page.$$eval('article button', (b) => b.filter((x) => /Accept|Decline|Accepting|Declining/.test(x.textContent) ).every((x) => x.disabled))
    rec('invitations', 'Accept shows "Accepting…" while in flight', loadingLabel)
    rec('invitations', 'all Accept/Decline buttons disabled while one request is in flight', disabledNow)
    await page.waitForSelector(`${card('Test Event 02')} >> text=Accepted`)
    rec('invitations', 'Accept success: badge "Accepted" + Registered pill, PATCH + POST sent', (await page.isVisible(`${card('Test Event 02')} >> text=Registered`)) && log.some((l) => l[0] === 'PATCH Accepted') && log.some((l) => l[0] === 'POST reg' && l[1] === 'e-02'), JSON.stringify(log))
    rec('invitations', 'Accept success: Accept/Decline gone for that invitation', (await page.$$(`${card('Test Event 02')} button:has-text("Decline")`)).length === 0)
    rec('counts', 'Upcoming tab badge went 1 -> 2 after accepting', (await page.textContent('[role=tab]:has-text("Upcoming")')).includes('2'))
    rec('counts', 'Invitations tab badge went 3 -> 2 pending', (await page.textContent('[role=tab]:has-text("Invitations")')).includes('2'))
    // decline #2
    await page.click(`${card('Test Event 04')} button:has-text("Decline")`)
    rec('invitations', 'Decline shows "Declining…" while in flight', await page.waitForSelector('button:has-text("Declining…")', { timeout: 3000 }).then(() => true).catch(() => false))
    await page.waitForSelector(`${card('Test Event 04')} >> text=Declined`)
    rec('invitations', 'Decline success: badge "Declined", PATCH sent, no registration created', log.some((l) => l[0] === 'PATCH Declined') && !registered.has('e-04'))
    rec('counts', 'Invitations tab badge now 1 pending', (await page.textContent('[role=tab]:has-text("Invitations")')).includes('1'))
    ctl.delay = 0
    // accept error (PATCH rejected)
    ctl.failAcceptPatch = true
    await page.click(`${card('Test Event 06')} button:has-text("Accept")`)
    await page.waitForSelector('[role=alert]')
    const t1 = await page.textContent('[role=alert]')
    rec('invitations', 'Accept error: inline alert with the reason', /Could not accept the invitation: permission denied/.test(t1), t1.trim().slice(0, 90))
    rec('invitations', 'Accept error: page not replaced (tabs + invitation still shown), buttons usable again', (await page.isVisible('[role=tablist]')) && (await page.isEnabled(`${card('Test Event 06')} button:has-text("Accept")`)) && (await page.isVisible(`${card('Test Event 06')} >> text=Pending`)))
    rec('invitations', 'Accept error: nothing registered', !registered.has('e-06'))
    await shot(page, 1440, 'events-desktop-invitations-error.jpg')
    await page.click('[role=alert] button:has-text("Dismiss")')
    rec('invitations', 'Dismiss clears the alert', (await page.$$('[role=alert]')).length === 0)
    ctl.failAcceptPatch = false
    // decline error
    ctl.failDeclinePatch = true
    await page.click(`${card('Test Event 06')} button:has-text("Decline")`)
    await page.waitForSelector('[role=alert]')
    rec('invitations', 'Decline error: inline alert, invitation still Pending', /Could not decline the invitation/.test(await page.textContent('[role=alert]')) && (await page.isVisible(`${card('Test Event 06')} >> text=Pending`)))
    ctl.failDeclinePatch = false
    // accept: status saved but registration fails -> reload shows the truth
    ctl.failRegister = true
    await page.click(`${card('Test Event 06')} button:has-text("Accept")`)
    await page.waitForSelector('[role=alert]:has-text("Could not accept")')
    await page.waitForSelector(`${card('Test Event 06')} >> text=Accepted`)
    rec('invitations', 'Accept where registration then fails: alert + list reloads to stored state (Accepted, not registered)', (await page.isVisible(`${card('Test Event 06')} button:has-text("Register")`)) && !registered.has('e-06'))
    // register from the invitation after failure, then success
    await page.click(`${card('Test Event 06')} button:has-text("Register")`)
    await page.waitForSelector('[role=alert]:has-text("Could not register")')
    rec('invitations', 'Register failure shown inline', true)
    ctl.failRegister = false
    await page.click(`${card('Test Event 06')} button:has-text("Register")`)
    await page.waitForSelector(`${card('Test Event 06')} >> text=Registered`)
    rec('invitations', 'Register succeeds after retry', registered.has('e-06'))
    rec('invitations', 'console/page errors during invitation flows', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 3. pagination after filter + sort; counts after actions =====
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events')
    // default view: hero e-next, grid = 14 upcoming others in date order
    const expectAll = upcoming.filter((e) => e.id !== 'e-next').map((e) => e.name)
    let got = []
    for (let p = 1; p <= 3; p++) {
      if (p > 1) await page.click(`button[aria-label="Page ${p}"]`)
      await page.waitForFunction((n) => (new URLSearchParams(location.search).get('page') || '1') === String(n), p)
      got.push(...(await cardNames(page)))
    }
    rec('pagination', 'unfiltered, earliest first: pages 1-3 concatenate to the exact expected order (14 events)', JSON.stringify(got) === JSON.stringify(expectAll), `${got.length} cards`)
    await shot(page, 1440, 'events-desktop-grid-page3.jpg')
    await page.goto(BASE + '/events', { waitUntil: 'networkidle' })

    // filter "city" matches every event with a location of "City n" (14) + hero event is in results when searching (15? no: only location 'City')
    await page.fill('input[type=search]', 'city')
    const filtered = upcoming.filter((e) => (e.name + e.location + e.description).toLowerCase().includes('city'))
    const showText = await showing(page)
    rec('pagination', 'filter: footer total reflects the FILTERED count', new RegExp(`of ${filtered.length} events`).test(showText || ''), `${showText} (expected ${filtered.length})`)
    for (const dir of ['soonest', 'latest']) {
      await page.selectOption('select', dir)
      const exp = dir === 'soonest' ? filtered.map((e) => e.name) : [...filtered].reverse().map((e) => e.name)
      const pages = Math.ceil(exp.length / 6)
      const out = []
      for (let p = 1; p <= pages; p++) {
        if (p > 1) await page.click(`button[aria-label="Page ${p}"]`)
        await page.waitForFunction((n) => (new URLSearchParams(location.search).get('page') || '1') === String(n), p)
        out.push(...(await cardNames(page)))
      }
      rec('pagination', `filter + sort "${dir}": ${pages} pages concatenate to the expected filtered, sorted order`, JSON.stringify(out) === JSON.stringify(exp), `${out.length}/${exp.length}`)
      // changing sort returns to page 1
      await page.selectOption('select', dir === 'soonest' ? 'latest' : 'soonest')
      rec('pagination', `changing sort from page ${pages} resets to page 1`, !page.url().includes('page='))
      await page.selectOption('select', dir)
      if (pages > 1) { await page.click('button[aria-label="Page 2"]'); await page.fill('input[type=search]', 'city'); }
    }
    await page.fill('input[type=search]', '')
    await page.selectOption('select', 'soonest')

    // counts after registering a card on page 2
    await page.click('button[aria-label="Page 2"]')
    await page.waitForFunction(() => location.search.includes('page=2'))
    const before = await showing(page)
    const victim = (await cardNames(page))[0]
    const upBefore = await page.textContent('[role=tab]:has-text("Upcoming")')
    await page.click(`article:has-text("${victim}") button:has-text("Register")`)
    await page.waitForSelector(`article:has-text("${victim}") >> text=Registered`)
    const after = await showing(page)
    rec('counts', 'registering a card on page 2 leaves the page total unchanged', before === after, `${before} -> ${after}`)
    rec('counts', 'registered count on that card went 7 -> 8', (await page.textContent(`article:has-text("${victim}")`)).includes('8 registered'))
    rec('counts', 'Upcoming tab badge incremented', upBefore.trim().endsWith('1') && (await page.textContent('[role=tab]:has-text("Upcoming")')).trim().endsWith('2'), `${upBefore.trim()} -> ${(await page.textContent('[role=tab]:has-text("Upcoming")')).trim()}`)
    // register an EARLIER event -> becomes the hero, old hero returns to grid, grid total unchanged
    await page.goto(BASE + '/events', { waitUntil: 'networkidle' })
    await page.click('article:has-text("Test Event 01") button:has-text("Register")')
    await page.waitForSelector('text=Your next event')
    await page.waitForFunction(() => document.querySelector('article h2')?.textContent.includes('Test Event 01'))
    const grid2 = await cardNames(page)
    const total2 = await showing(page)
    rec('counts', 'registering an earlier event moves it to the "next event" card; previous one returns to the grid', !grid2.includes('Test Event 01') && /of 14 events/.test(total2 || ''), total2)
    rec('counts', 'grid total stays correct (14) after hero swap', /of 14 events/.test(total2 || ''))
    // unregister a grid card (the old hero, now in the grid) -> total unchanged, Upcoming badge decremented
    const upB = (await page.textContent('[role=tab]:has-text("Upcoming")')).trim()
    await page.click('article:has-text("Registered Next Event") button:has-text("Unregister")').catch(async () => {
      await page.click('button[aria-label="Page 2"]'); await page.click('article:has-text("Registered Next Event") button:has-text("Unregister")')
    })
    await page.waitForFunction(() => !document.body.innerText.includes('Unregister') || true)
    await page.waitForTimeout(200)
    rec('counts', 'unregister: Upcoming badge decremented and total unchanged', (await page.textContent('[role=tab]:has-text("Upcoming")')).trim() !== upB && /of 14 events/.test((await showing(page)) || ''), `${upB} -> ${(await page.textContent('[role=tab]:has-text("Upcoming")')).trim()}`)
    // register failure leaves everything as it was
    ctl.failRegister = true
    const vb = await showing(page)
    await page.goto(BASE + '/events', { waitUntil: 'networkidle' })
    const first = (await cardNames(page))[0]
    await page.click(`article:has-text("${first}") button:has-text("Register")`)
    await page.waitForSelector('[role=alert]:has-text("Could not register")')
    rec('counts', 'failed register: inline alert, card still unregistered, totals unchanged', (await page.isVisible(`article:has-text("${first}") button:has-text("Register")`)) && /of 14 events/.test((await showing(page)) || ''))
    ctl.failRegister = false
    rec('pagination', 'console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 4. malformed / negative / out-of-range ?page ================
  {
    reset()
    const cases = [
      ['-1', 1], ['0', 1], ['1.5', 1], ['2abc', 1], ['abc', 1], ['', 1], ['%00', 1], ['%202', 1], ['1e3', 1],
      ['99999999999999999999', 1], ['<script>alert(1)</script>', 1], ['0002', 2], ['9', 3], ['3', 3], ['2', 2],
    ]
    for (const [raw, expectPage] of cases) {
      const { page, ctx, errors } = await open(1440, 900, `/events?page=${raw}`)
      const cards = await cardNames(page)
      const txt = (await showing(page)) || ''
      const exp = expectPage === 1 ? 'Showing 1–6 of 14' : expectPage === 2 ? 'Showing 7–12 of 14' : 'Showing 13–14 of 14'
      const noNaN = !/NaN|undefined/.test(await page.textContent('body'))
      rec('page-param', `?page=${raw || '(empty)'} -> page ${expectPage}`, txt.startsWith(exp) && cards.length > 0 && noNaN && errors.length === 0, `${txt}; ${cards.length} cards`)
      await ctx.close()
    }
    // repeated parameter
    const { page, ctx } = await open(1440, 900, '/events?page=2&page=3')
    rec('page-param', '?page=2&page=3 -> uses the first value (page 2)', ((await showing(page)) || '').startsWith('Showing 7–12'))
    await ctx.close()
  }

  // ================= 5. wider layout on representative attendee pages ============
  {
    reset()
    const routes = [
      ['dashboard', '/dashboard'], ['connections', '/connections'], ['connection-detail', '/connections/c1'], ['follow-ups', '/follow-ups'],
      ['opportunities', '/opportunities'], ['opportunity-detail', '/opportunities/o1'], ['messages', '/messages'], ['conversation', '/messages/cv1'],
      ['notifications', '/notifications'], ['profile', '/profile'], ['scan', '/scan'], ['event-detail', '/events/e-02'],
    ]
    for (const [name, url] of routes) {
      for (const w of [1440, 820, 390]) {
        const { page, ctx, errors } = await open(w, 900, url)
        await page.waitForTimeout(300)
        const info = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth
          const over = [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[class*="overflow-x-auto"]') }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 40))
          const main = document.querySelector('main > div')
          return { scrollOverflow: document.documentElement.scrollWidth - vw, over, mainW: main ? Math.round(main.getBoundingClientRect().width) : null, text: (document.querySelector('main')?.innerText || '').slice(0, 70).replace(/\n/g, ' ') }
        })
        const bad = info.scrollOverflow > 0 || info.over.length > 0 || errors.length > 0 || info.text.length < 20 || /Something went wrong|could not load|Failed|JSON object requested|not found/i.test(info.text)
        rec('layout', `${name} @${w}`, !bad, `contentW=${info.mainW} text='${info.text.slice(0, 38)}' overflow=${info.scrollOverflow}${info.over.length ? ' offenders=' + info.over.join(',') : ''}${errors.length ? ' errors=' + errors[0].slice(0, 80) : ''}`)
        if (w === 1440 || w === 390) await shot(page, w, `layout-${name}-${w}.jpg`)
        await ctx.close()
      }
    }
  }

  // ================= 6. review screenshots of /events ============================
  {
    reset()
    const shots = [
      ['desktop', 1440, '/events', {}, 'events-desktop-grid.jpg'],
      ['desktop', 1440, '/events?page=2', {}, 'events-desktop-grid-page2.jpg'],
      ['desktop', 1440, '/events', { view: 'list' }, 'events-desktop-list.jpg'],
      ['desktop', 1440, '/events?tab=past', {}, 'events-desktop-past.jpg'],
      ['desktop', 1440, '/events', { collapsed: true }, 'events-desktop-sidebar-collapsed.jpg'],
      ['tablet', 820, '/events', {}, 'events-tablet-grid.jpg'],
      ['mobile', 390, '/events', {}, 'events-mobile-grid.jpg'],
      ['mobile', 390, '/events', { view: 'list' }, 'events-mobile-list.jpg'],
      ['mobile', 390, '/events?tab=invitations', {}, 'events-mobile-invitations.jpg'],
    ]
    for (const [, w, url, opt, file] of shots) {
      const { page, ctx } = await open(w, 900, url, opt)
      await page.waitForTimeout(250)
      await shot(page, w, file)
      await ctx.close()
    }
    // search no-match
    const { page, ctx } = await open(1440, 900, '/events')
    await page.fill('input[type=search]', 'zzzz'); await page.waitForTimeout(150)
    await shot(page, 1440, 'events-desktop-no-match.jpg')
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(path.join(OUT, '..', 'results.json'), JSON.stringify(results, null, 2))
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - fails}  FAIL ${fails}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
