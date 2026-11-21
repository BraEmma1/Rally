// Registration open/close controls in the interface (migration 20261104000000).
// Attendees: Register controls follow get_event_registration_states (closed by the
// organizer, deadline passed, ended by date, open on day two of a multi-day event),
// the fallback when that state cannot be read, the cancel warning while closed, the
// Events list. Organizers: the Registration card (status, Close with confirmation,
// Reopen, exact PATCH bodies, deadline / end / legacy-timezone guidance, assigned
// managers), publishing needs a timezone, and the Edit form's timezone and deadline
// rules (exact instants sent, nothing sent when untouched). Phone layout.
// Runs against a STUBBED API. Nothing here reaches a real Supabase project, and no
// credential is used: the session is a fabricated token for a fake user id.
// Run all suites with: npm run test:browser
const { launchBrowser } = require('./launch.cjs')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || process.argv[2]
const OUT = process.env.SHOTS_DIR || process.argv[3] || path.join(require('os').tmpdir(), 'rally-browser-shots')
const API = 'http://localhost:54321'
const UID = '11111111-1111-1111-1111-111111111111'
const ORG = 'org-1'
fs.mkdirSync(OUT, { recursive: true })

// Local calendar dates, as the page's own date rule reads them.
const day = (offset) => {
  const x = new Date()
  x.setDate(x.getDate() + offset)
  return x.toLocaleDateString('en-CA')
}

// ---- fixtures ----------------------------------------------------------------
const ev = (id, name, over = {}) => ({
  id, name, description: 'Fixture event.', location: 'Accra', start_date: '2027-03-01', end_date: null,
  start_time: null, end_time: null, image_url: '', capacity: null, status: 'upcoming', timezone: 'Africa/Accra',
  created_at: '2026-06-01', owner_id: null, created_by: UID, organization_id: ORG, visibility: 'published',
  archived_at: null, published_at: '2026-06-01', registration_closed_at: null, registration_closed_by: null,
  registration_deadline: null, ...over,
})
const DEADLINE = '2027-02-20T17:00:00+00:00'
let events
// What get_event_registration_states answers, per event.
let states
const state = (s, over = {}) => ({
  registration_state: s, registration_closed_at: null, registration_deadline: null,
  ends_at: '2027-03-02T00:00:00+00:00', closes_at: '2027-03-02T00:00:00+00:00', timezone_fallback: false, ...over,
})

const ctl = {}
let regs, log
function reset(over = {}) {
  events = [
    // attendee side
    ev('e-open', 'Open Event', { registration_deadline: DEADLINE }),
    ev('e-closed', 'Closed Event'),
    ev('e-deadline', 'Deadline Event', { registration_deadline: DEADLINE }),
    ev('e-ended', 'Ended Today Event', { start_date: day(0), start_time: '08:00:00', end_time: '09:00:00' }),
    ev('e-day2', 'Multi Day Event', { start_date: day(-1), end_date: day(1) }),
    ev('e-mine', 'My Closed Event'),
    ev('e-mine-open', 'My Open Event'),
    // organizer side
    ev('o-open', 'Org Open'),
    ev('o-closed', 'Org Closed', { registration_closed_at: '2027-01-05T09:30:00+00:00', registration_closed_by: UID }),
    ev('o-deadline', 'Org Deadline', { registration_deadline: DEADLINE }),
    ev('o-ended', 'Org Ended'),
    ev('o-fallback', 'Org Legacy', { timezone: null }),
    ev('o-tokyo', 'Org Tokyo', { timezone: 'Asia/Tokyo', registration_deadline: DEADLINE }),
    ev('o-draft', 'Org Draft', { visibility: 'draft', published_at: null, timezone: null }),
  ]
  states = {
    'e-open': state('open', { registration_deadline: DEADLINE, closes_at: DEADLINE }),
    'e-closed': state('closed', { registration_closed_at: '2027-01-05T09:30:00+00:00' }),
    'e-deadline': state('deadline_passed', { registration_deadline: DEADLINE, closes_at: DEADLINE }),
    'e-ended': state('ended'),
    'e-day2': state('open'),
    'e-mine': state('closed', { registration_closed_at: '2027-01-05T09:30:00+00:00' }),
    'e-mine-open': state('open'),
    'o-open': state('open'),
    'o-closed': state('closed', { registration_closed_at: '2027-01-05T09:30:00+00:00' }),
    'o-deadline': state('deadline_passed', { registration_deadline: DEADLINE, closes_at: DEADLINE }),
    'o-ended': state('ended'),
    'o-fallback': state('open', { ends_at: '2027-03-02T12:00:00+00:00', closes_at: '2027-03-02T12:00:00+00:00', timezone_fallback: true }),
    'o-tokyo': state('open', { registration_deadline: DEADLINE, closes_at: DEADLINE }),
    'o-draft': state('unavailable', { ends_at: null, closes_at: null }),
  }
  regs = new Map([['e-mine', 'registered'], ['e-mine-open', 'registered']])
  Object.assign(ctl, { persona: 'attendee', role: 'owner', statesError: false }, over)
  log = { states: [], patches: [], register: [] }
}
reset()
const err = (code, message) => ({ code, message, details: null, hint: null })

function access() {
  return [{
    organization_id: ORG, organization_name: 'Test Org', organization_slug: 'test-org', organization_description: '',
    organization_logo_url: '', organization_website: '', organization_type: 'organizer', approval_status: 'approved',
    archived_at: null, organization_created_by: UID, organization_created_at: '2026-01-01T00:00:00Z',
    organization_updated_at: '2026-01-01T00:00:00Z', organization_role: ctl.role, joined_at: '2026-01-01T00:00:00Z',
    event_assignments: [],
  }]
}
const waitlister = (n) => ({ user_id: `w-${n}`, full_name: `Waiting ${n}`, job_title: '', company: '', photo_url: '', registered_at: '2026-10-01T00:00:00Z', status: 'waitlisted', checked_in_at: null })

function rawRows(url) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [{ id: UID, full_name: 'Freda Astanga', photo_url: '', job_title: 'Founder', company: 'SheBuilds', industry: 'Technology', location: 'Accra', bio: 'Builder of things.', looking_for: 'Partners', can_offer: 'Mentorship', linkedin: '', website: '', email: 'f@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }]
  if (p.endsWith('/user_accounts')) return [{ account_type: ctl.persona === 'organizer' ? 'organizer' : 'attendee', status: 'active' }]
  if (p.endsWith('/events')) return events.filter((e) => (ctl.persona === 'organizer' ? e.id.startsWith('o-') : e.id.startsWith('e-')))
  if (p.endsWith('/event_registrations')) return [...regs].map(([event_id, status]) => ({ event_id, status, id: 'r-' + event_id, user_id: UID, checked_in_at: null }))
  if (p.endsWith('/rpc/get_my_organization_access')) return ctl.persona === 'organizer' ? access() : []
  if (p.endsWith('/rpc/event_activity_counts')) return [{ registrations: 12, checked_in: 0, cancelled: 0, connections_made: 0, invitations_pending: 0, invitations_accepted: 0 }]
  if (p.endsWith('/rpc/event_attendee_list')) return [waitlister(1), waitlister(2)]
  return []
}
function rows(url, single) {
  let r = rawRows(url)
  if (Array.isArray(r) && r.length) {
    for (const [k, v] of new URL(url).searchParams) if (v.startsWith('eq.') && k in r[0]) r = r.filter((x) => String(x[k]) === v.slice(3))
  }
  return single ? (Array.isArray(r) ? r[0] ?? null : r) : r
}

async function wire(ctx) {
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(); const url = req.url(); const m = req.method()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
    const json = (status, b) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${rows(url).length}` } })
    if (m === 'GET') return json(200, rows(url, (req.headers()['accept'] || '').includes('pgrst.object')))
    if (m === 'POST' && url.includes('/rpc/')) {
      const body = JSON.parse(req.postData() || '{}')
      const name = new URL(url).pathname.split('/rpc/')[1]
      const id = body.p_event_id
      if (name === 'get_event_registration_states') {
        log.states.push(body.p_event_ids)
        // What PostgREST answers before the migration is applied.
        if (ctl.statesError) return json(404, err('PGRST202', 'Could not find the function public.get_event_registration_states'))
        return json(200, (body.p_event_ids || []).filter((x) => states[x]).map((x) => ({ event_id: x, ...states[x] })))
      }
      if (name === 'can_manage_event' || name === 'account_is_active') return json(200, true)
      if (name === 'get_event_registration_counts') return json(200, (body.event_ids || []).map((x) => ({ event_id: x, registration_count: 3 })))
      if (name === 'get_event_registration_form') return json(200, [])
      if (name === 'event_attendee_page') return json(200, [{ total_count: 0, attendees: [] }])
      if (name === 'my_event_registration') {
        const st = regs.get(id)
        return json(200, st ? [{ registration_id: 'r-' + id, registration_status: st, registered_at: '2026-10-01T00:00:00Z', waitlist_position: null, answers: {} }] : [])
      }
      if (name === 'register_for_event') {
        log.register.push(body)
        return json(200, [{ registration_id: 'r-' + id, registration_status: 'registered', waitlist_position: null }])
      }
      if (name === 'cancel_event_registration') {
        const prev = regs.get(id)
        regs.delete(id)
        return json(200, prev)
      }
      return json(200, rows(url))
    }
    if (m === 'PATCH' && url.includes('/events')) {
      const body = JSON.parse(req.postData() || '{}')
      const target = new URL(url).searchParams.get('id')?.replace(/^eq\./, '')
      log.patches.push({ id: target, body })
      // The trigger stamps the close with the server's time and the caller.
      if ('registration_closed_at' in body && states[target]) {
        const e = events.find((x) => x.id === target)
        if (body.registration_closed_at === null) {
          e.registration_closed_at = null; e.registration_closed_by = null
          states[target] = state('open')
        } else {
          e.registration_closed_at = '2027-01-05T09:30:00+00:00'; e.registration_closed_by = UID
          states[target] = state('closed', { registration_closed_at: e.registration_closed_at })
        }
      }
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
  async function open(url, { w = 1440, h = 900, wait = 'h1, [role=alert], main' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()) })
    await ctx.addInitScript(([uid]) => {
      const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'f@example.test', app_metadata: {}, user_metadata: {} } }
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
    }, [UID])
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    if (wait) await page.waitForSelector(wait, { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  // Any visible match: some pages render a phone-only and a desktop copy of the same line.
  const text = async (page, t) => {
    const all = page.getByText(t, { exact: false })
    const n = await all.count().catch(() => 0)
    for (let i = 0; i < n; i++) if (await all.nth(i).isVisible().catch(() => false)) return true
    return false
  }
  const btn = (page, name) => page.getByRole('button', { name, exact: false })
  const visibleButton = async (page, name) => {
    const all = btn(page, name)
    const n = await all.count()
    for (let i = 0; i < n; i++) if (await all.nth(i).isVisible()) return true
    return false
  }
  const anyRegister = async (page) =>
    (await visibleButton(page, 'Register for Event')) || (await visibleButton(page, 'Proceed to registration')) ||
    (await visibleButton(page, 'Register Now')) || (await visibleButton(page, 'Join waitlist')) || (await visibleButton(page, 'Unlock Schedule'))
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const settle = (page) => page.waitForLoadState('networkidle').catch(() => {})

  // ================= A. Attendee: Event Detail =====================================
  {
    reset()
    const { page, ctx, errors } = await open('/events/e-open')
    await page.waitForSelector('h1:has-text("Open Event")')
    rec('attendee', 'asks get_event_registration_states for this event', log.states.some((ids) => ids.length === 1 && ids[0] === 'e-open'), JSON.stringify(log.states))
    rec('attendee', 'open: Register is offered and the chip says "Registration open"', (await visibleButton(page, 'Register for Event')) && (await text(page, 'Registration open')))
    rec('attendee', 'open with a deadline: "Registration closes Feb 20, 2027, 5:00 PM (Africa/Accra)."', await text(page, 'Registration closes Feb 20, 2027, 5:00 PM (Africa/Accra).'))
    rec('attendee', 'no console/page errors (open)', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    reset()
    const { page, ctx, errors } = await open('/events/e-closed')
    await page.waitForSelector('h1:has-text("Closed Event")')
    rec('attendee', 'closed by the organizer: no Register, Join waitlist or Unlock Schedule anywhere', !(await anyRegister(page)))
    rec('attendee', 'closed: says "Registration for this event is closed."', await text(page, 'Registration for this event is closed.'))
    rec('attendee', 'closed: the status chip says "Registration closed", not "open"', (await text(page, 'Registration closed')) && !(await text(page, 'Registration open')))
    rec('attendee', 'no console/page errors (closed)', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    reset()
    const { page, ctx } = await open('/events/e-closed', { w: 390, h: 844 })
    await page.waitForSelector('h1:has-text("Closed Event")')
    rec('phone', 'closed at 390px: no sticky Register bar', !(await visibleButton(page, 'Register Now')))
    rec('phone', 'closed at 390px: the closed notice is shown', await text(page, 'Registration for this event is closed.'))
    const o = await overflow(page)
    rec('phone', 'closed at 390px: no horizontal overflow', o <= 0, `overflow=${o}`)
    await page.screenshot({ path: path.join(OUT, 'registration-closed-phone.jpg'), type: 'jpeg', quality: 70 })
    await ctx.close()
  }
  {
    reset()
    const { page, ctx } = await open('/events/e-deadline')
    await page.waitForSelector('h1:has-text("Deadline Event")')
    rec('attendee', 'deadline passed: "Registration closed on Feb 20, 2027, 5:00 PM (Africa/Accra)."', await text(page, 'Registration closed on Feb 20, 2027, 5:00 PM (Africa/Accra).'))
    rec('attendee', 'deadline passed: no Register', !(await anyRegister(page)))
    await ctx.close()
  }
  {
    reset()
    const { page, ctx } = await open('/events/e-ended')
    await page.waitForSelector('h1:has-text("Ended Today Event")')
    rec('attendee', 'ended by its end time today (still "upcoming"): "Past event", no Register', (await text(page, 'Past event')) && !(await anyRegister(page)))
    await ctx.close()
  }
  {
    reset()
    const { page, ctx } = await open('/events/e-day2')
    await page.waitForSelector('h1:has-text("Multi Day Event")')
    rec('attendee', 'day two of a multi-day event: still open, Register offered, not "Past event"', (await visibleButton(page, 'Register for Event')) && !(await text(page, 'Past event')))
    await ctx.close()
  }
  {
    reset({ statesError: true })
    const a = await open('/events/e-day2')
    await a.page.waitForSelector('h1:has-text("Multi Day Event")')
    rec('fallback', 'state unavailable: the page keeps its old date rule (day two reads as past)', (await text(a.page, 'Past event')) && !(await anyRegister(a.page)))
    rec('fallback', 'state unavailable: the page still loads without errors', a.errors.length === 0, a.errors.slice(0, 2).join(' || '))
    await a.ctx.close()
    const b = await open('/events/e-closed')
    await b.page.waitForSelector('h1:has-text("Closed Event")')
    rec('fallback', 'state unavailable: a future event offers Register; the server still decides', await visibleButton(b.page, 'Register for Event'))
    await b.ctx.close()
  }
  {
    reset()
    const { page, ctx } = await open('/events/e-mine')
    await page.waitForSelector('h1:has-text("My Closed Event")')
    rec('cancel', 'registered while closed: still Confirmed, Unregister still offered', (await text(page, 'Confirmed Attendee')) && (await visibleButton(page, 'Unregister')))
    await btn(page, 'Unregister').first().click()
    await page.waitForSelector('[role=dialog]')
    const dlg = await page.locator('[role=dialog]').innerText()
    rec('cancel', 'the cancel dialog warns they cannot register again while closed', dlg.includes('won’t be able to register or join the waitlist again'), dlg.replace(/\s+/g, ' ').slice(0, 200))
    rec('cancel', 'and does not promise "You can register again later"', !dlg.includes('You can register again later'))
    await ctx.close()
  }
  {
    reset()
    const { page, ctx } = await open('/events/e-mine-open')
    await page.waitForSelector('h1:has-text("My Open Event")')
    await btn(page, 'Unregister').first().click()
    await page.waitForSelector('[role=dialog]')
    const dlg = await page.locator('[role=dialog]').innerText()
    rec('cancel', 'while open: the usual "You can register again later", no closed warning', dlg.includes('You can register again later') && !dlg.includes('won’t be able to register'))
    await ctx.close()
  }

  // ================= B. Attendee: Events list =======================================
  {
    reset()
    const { page, ctx, errors } = await open('/events')
    await page.waitForSelector('article:has-text("Open Event")')
    const cardOf = (name) => page.locator('article', { has: page.getByRole('heading', { name, exact: true }) })
    // Development builds run the load effect twice (React StrictMode), so the
    // check is "always one batch for the whole list", never one call per event.
    const listed = ['e-open', 'e-closed', 'e-deadline', 'e-ended', 'e-day2']
    rec('list', 'registration states are asked for in one batch covering the listed events, not per event',
      log.states.length >= 1 && log.states.every((ids) => listed.every((x) => ids.includes(x))), JSON.stringify(log.states))
    rec('list', 'a closed card says "Registration closed" and has no Register button', (await cardOf('Closed Event').getByText('Registration closed').isVisible()) && (await cardOf('Closed Event').getByRole('button', { name: 'Register' }).count()) === 0)
    rec('list', 'a deadline-passed card says "Registration closed"', await cardOf('Deadline Event').getByText('Registration closed').isVisible())
    rec('list', 'an event that ended today says "Event ended"', await cardOf('Ended Today Event').getByText('Event ended').isVisible())
    rec('list', 'an open card keeps its Register button', await cardOf('Open Event').getByRole('button', { name: 'Register' }).isVisible())
    rec('list', 'no console/page errors (list)', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= C. Organizer: the Registration card ===========================
  {
    reset({ persona: 'organizer' })
    const { page, ctx, errors } = await open('/organizer/events/o-open')
    await page.waitForSelector('text=Registration')
    await page.getByText('Open until the event ends', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'open: "Open until the event ends, Mar 2, 2027, 12:00 AM (Africa/Accra)."', await text(page, 'Open until the event ends, Mar 2, 2027, 12:00 AM (Africa/Accra).'))
    rec('organizer', 'the Lifecycle card no longer promises "open for registration"', !(await text(page, 'Published and open for registration')))
    await btn(page, 'Close registration').first().click()
    await page.waitForSelector('[role=dialog]')
    const body = await page.locator('[role=dialog]').innerText()
    rec('organizer', 'Close asks first, with the confirmed and waitlisted counts that keep their places', body.includes('12 confirmed and 2 waitlisted keep their places.'), body.replace(/\s+/g, ' ').slice(0, 240))
    rec('organizer', 'the confirmation says cancellations still move the waitlist and re-registering is refused', body.includes('Cancellations still move the waitlist up') && body.includes('cannot register again while registration is closed'))
    await page.locator('[role=dialog]').getByRole('button', { name: 'Keep' }).click()
    rec('organizer', '"Keep" sends nothing', log.patches.length === 0, JSON.stringify(log.patches))
    await btn(page, 'Close registration').first().click()
    await page.locator('[role=dialog]').getByRole('button', { name: 'Close registration' }).click()
    await page.getByText('Closed by you', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    const p = log.patches[0] || {}
    rec('organizer', 'closing sends exactly { registration_closed_at } for this event (the server stamps it)',
      log.patches.length === 1 && p.id === 'o-open' && Object.keys(p.body).join() === 'registration_closed_at' && typeof p.body.registration_closed_at === 'string', JSON.stringify(log.patches))
    rec('organizer', 'then shows "Closed by you on Jan 5, 2027, 9:30 AM (Africa/Accra)." and offers Reopen',
      (await text(page, 'Closed by you on Jan 5, 2027, 9:30 AM (Africa/Accra).')) && (await visibleButton(page, 'Reopen registration')))
    rec('organizer', 'no console/page errors (close)', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await open('/organizer/events/o-closed')
    await btn(page, 'Reopen registration').first().waitFor({ timeout: 6000 }).catch(() => {})
    await btn(page, 'Reopen registration').first().click()
    await page.getByText('Open until the event ends', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    const p = log.patches[0] || {}
    rec('organizer', 'reopening sends exactly { registration_closed_at: null }', log.patches.length === 1 && p.id === 'o-closed' && JSON.stringify(p.body) === '{"registration_closed_at":null}', JSON.stringify(log.patches))
    rec('organizer', 'then shows Open with Close offered again', (await text(page, 'Open until the event ends')) && (await visibleButton(page, 'Close registration')))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await open('/organizer/events/o-deadline')
    await page.getByText('deadline passed', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'deadline passed: says when, and that the deadline must move', (await text(page, 'The registration deadline passed on Feb 20, 2027, 5:00 PM (Africa/Accra).')) && (await text(page, 'Move or remove the deadline to open registration again.')))
    rec('organizer', 'deadline passed: links to change the deadline', await page.getByRole('link', { name: 'Change the deadline' }).isVisible())
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await open('/organizer/events/o-ended')
    await page.getByText('The event has ended.', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'ended: "The event has ended." and neither Close nor Reopen', (await text(page, 'The event has ended.')) && !(await visibleButton(page, 'Close registration')) && !(await visibleButton(page, 'Reopen registration')))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await open('/organizer/events/o-fallback')
    await page.getByText('no recognised timezone', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'no timezone: explains the UTC−12 fallback and links to set one', (await text(page, 'This event has no recognised timezone')) && (await page.getByRole('link', { name: 'Set the timezone' }).isVisible()))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer', role: 'manager' })
    const { page, ctx } = await open('/organizer/events/o-open')
    await btn(page, 'Close registration').first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'an assigned event manager is offered Close registration', await visibleButton(page, 'Close registration'))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await open('/organizer/events/o-draft')
    await page.getByText('Opens on publishing', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'a draft: "Opens on publishing"', await text(page, 'Opens on publishing'))
    const publish = btn(page, 'Publish publicly')
    let allDisabled = (await publish.count()) > 0
    for (let i = 0; i < (await publish.count()); i++) allDisabled = allDisabled && (await publish.nth(i).isDisabled())
    rec('organizer', 'a draft without a timezone: Publish is disabled and the reason is shown', allDisabled && (await text(page, 'Set the event timezone before publishing.')))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer', statesError: true })
    const { page, ctx } = await open('/organizer/events/o-open')
    await page.getByText('Registration status could not be loaded.', { exact: false }).first().waitFor({ timeout: 6000 }).catch(() => {})
    rec('organizer', 'state unavailable: says so, offers Try again, offers no Close/Reopen', (await text(page, 'Registration status could not be loaded.')) && (await visibleButton(page, 'Try again')) && !(await visibleButton(page, 'Close registration')))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await open('/organizer/events/o-open', { w: 390, h: 844 })
    await btn(page, 'Close registration').first().waitFor({ timeout: 6000 }).catch(() => {})
    const o = await overflow(page)
    rec('phone', 'organizer card at 390px: Close is reachable, no horizontal overflow', (await visibleButton(page, 'Close registration')) && o <= 0, `overflow=${o}`)
    await page.screenshot({ path: path.join(OUT, 'registration-card-phone.jpg'), type: 'jpeg', quality: 70 })
    await ctx.close()
  }

  // ================= D. Organizer: the Edit form ====================================
  async function editForm(id, opts) {
    const o = await open(`/organizer/events/${id}/edit`, opts)
    await o.page.waitForSelector('#registration_deadline_date')
    return o
  }
  const save = async (page) => {
    await btn(page, 'Save changes').click()
    await settle(page)
    await page.waitForTimeout(150)
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx, errors } = await editForm('o-open')
    rec('form', 'deadline inputs are empty and enabled, read in the event timezone', (await page.inputValue('#registration_deadline_date')) === '' && !(await page.isDisabled('#registration_deadline_date')) && (await text(page, 'Registration closes at this date and time in Africa/Accra')))
    await save(page)
    rec('form', 'saving without touching the deadline sends no registration_deadline', log.patches.length === 1 && !('registration_deadline' in log.patches[0].body), JSON.stringify(log.patches))
    rec('form', 'no console/page errors (form)', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-open')
    await page.fill('#registration_deadline_date', '2027-02-20')
    await page.fill('#registration_deadline_time', '17:00')
    await save(page)
    rec('form', 'a deadline of 20 Feb 2027 17:00 in Africa/Accra is sent as 2027-02-20T17:00:00.000Z', log.patches[0]?.body.registration_deadline === '2027-02-20T17:00:00.000Z', JSON.stringify(log.patches))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-tokyo')
    rec('form', 'a stored deadline is shown in the event zone (17:00 UTC = 02:00 next day in Tokyo)', (await page.inputValue('#registration_deadline_date')) === '2027-02-21' && (await page.inputValue('#registration_deadline_time')) === '02:00')
    await btn(page, 'Remove deadline').click()
    await save(page)
    rec('form', '"Remove deadline" sends registration_deadline: null', log.patches.length === 1 && log.patches[0].body.registration_deadline === null, JSON.stringify(log.patches))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-open')
    await page.fill('#registration_deadline_date', '2027-02-20')
    await save(page)
    rec('form', 'a date without a time is refused with a message, nothing sent', (await text(page, 'Add a time for the registration deadline.')) && log.patches.length === 0)
    await page.fill('#registration_deadline_date', '2027-03-05')
    await page.fill('#registration_deadline_time', '10:00')
    rec('form', 'a deadline after the end is flagged: registration closes when the event ends', await text(page, 'This is after the event ends (Mar 2, 2027, 12:00 AM (Africa/Accra))'))
    await page.fill('#registration_deadline_date', '2020-01-01')
    rec('form', 'a deadline in the past is flagged: saving closes registration', await text(page, 'This deadline has already passed. Saving it closes registration.'))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-draft')
    rec('form', 'no timezone: the deadline inputs are disabled and say why', (await page.isDisabled('#registration_deadline_date')) && (await text(page, 'Set the event timezone above to add a deadline.')))
    await page.selectOption('#visibility', 'published')
    rec('form', 'publishing marks the timezone as required', (await page.locator('label[for=timezone]').innerText()).includes('*'))
    await save(page)
    rec('form', 'publishing without a timezone is refused before anything is sent', (await text(page, 'Choose an event timezone. A published event needs one')) && log.patches.length === 0, JSON.stringify(log.patches))
    await page.fill('#timezone', 'Mars/Olympus')
    rec('form', 'a typed name outside the list is flagged', await text(page, '“Mars/Olympus” is not in the timezone list.'))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-fallback')
    rec('form', 'legacy published event without a timezone: the fallback is explained', await text(page, 'This event has no recognised timezone'))
    await save(page)
    rec('form', 'and other changes still save (as the database allows)', log.patches.length === 1 && log.patches[0].body.timezone === null, JSON.stringify(log.patches))
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-open')
    await page.fill('#timezone', '')
    await save(page)
    rec('form', 'a published event cannot drop its timezone: refused before sending', (await text(page, 'Choose an event timezone. A published event needs one')) && log.patches.length === 0)
    await ctx.close()
  }
  {
    reset({ persona: 'organizer' })
    const { page, ctx } = await editForm('o-open', { w: 390, h: 844 })
    const o = await overflow(page)
    rec('phone', 'edit form at 390px: no horizontal overflow', o <= 0, `overflow=${o}`)
    await page.locator('#registration_deadline_date').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(OUT, 'registration-deadline-phone.jpg'), type: 'jpeg', quality: 70 })
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${results.length - fails}/${results.length} passed`)
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
