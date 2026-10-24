// Event registration flow: the registration dialog (organizer-defined form, validation,
// payload, confirmation), capacity -> waitlist, leaving the waitlist, cancelling, server
// error mapping, keyboard handling, the Event Detail waitlisted state and a phone viewport.
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
fs.mkdirSync(OUT, { recursive: true })

// ---- fixtures ----------------------------------------------------------------
const ev = (id, name, over = {}) => ({
  id, name, description: 'Fixture event.', location: 'Accra', start_date: '2027-03-01', end_date: null,
  start_time: null, end_time: null, image_url: '', capacity: null, status: 'upcoming', timezone: null,
  created_at: '2026-06-01', owner_id: null, visibility: 'published', ...over,
})
const events = [
  ev('e-open', 'Open Event', { start_date: '2027-03-01', capacity: 100 }),
  ev('e-plain', 'Plain Event', { start_date: '2027-03-02' }),
  ev('e-full', 'Full Event', { start_date: '2027-03-03', capacity: 10 }),
  ev('e-wl', 'Waitlisted Event', { start_date: '2027-03-04', capacity: 10 }),
]
const profile = { id: UID, full_name: 'Freda Astanga', photo_url: '', job_title: 'Founder', company: 'SheBuilds', industry: 'Technology', location: 'Accra', bio: 'Builder of things.', looking_for: 'Partners', can_offer: 'Mentorship', linkedin: '', website: '', email: 'f@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }

const Q = {
  company: { id: 'q-company', position: 1, label: 'Company', help_text: 'Where you work', kind: 'short_text', options: null, required: true },
  role: { id: 'q-role', position: 2, label: 'Role', help_text: null, kind: 'single_choice', options: ['Dev', 'PM', 'Designer'], required: true },
  interests: { id: 'q-interests', position: 3, label: 'Interests', help_text: null, kind: 'multi_choice', options: ['Talks', 'Workshops'], required: false },
  first: { id: 'q-first', position: 4, label: 'First time?', help_text: null, kind: 'yes_no', options: null, required: false },
  notes: { id: 'q-notes', position: 5, label: 'Anything else?', help_text: null, kind: 'long_text', options: null, required: false },
}
const forms = {
  'e-open': [Q.company, Q.role, Q.interests, Q.first, Q.notes],
  'e-plain': [],
  'e-full': [Q.company],
  'e-wl': [],
}

// ---- mock state --------------------------------------------------------------
const ctl = { delay: 0, error: null }
let regs, counts, log
function reset() {
  regs = new Map([['e-wl', 'waitlisted']])
  counts = { 'e-open': 5, 'e-plain': 3, 'e-full': 10, 'e-wl': 10 }
  log = { register: [], cancel: [] }
  ctl.delay = 0
  ctl.error = null
}
reset()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const err = (code, message) => ({ code, message, details: null, hint: null })

function rawRows(url) {
  const p = new URL(url).pathname
  if (p.endsWith('/profiles')) return [profile]
  if (p.endsWith('/user_accounts')) return [{ account_type: 'attendee', status: 'active' }]
  if (p.endsWith('/events')) return events
  if (p.endsWith('/event_registrations')) return [...regs].map(([event_id, status]) => ({ event_id, status, id: 'r-' + event_id, user_id: UID, checked_in_at: null }))
  if (p.endsWith('/rpc/get_event_registration_counts')) return events.map((e) => ({ event_id: e.id, registration_count: counts[e.id] }))
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
      const id = body.p_event_id
      if (url.endsWith('/rpc/get_event_registration_form')) return json(200, forms[id] || [])
      if (url.endsWith('/rpc/get_event_registration_counts')) return json(200, events.filter((e) => (body.event_ids || []).includes(e.id)).map((e) => ({ event_id: e.id, registration_count: counts[e.id] })))
      if (url.endsWith('/rpc/register_for_event')) {
        if (ctl.delay) await sleep(ctl.delay)
        log.register.push(body)
        if (ctl.error) return json(400, err('P0001', ctl.error))
        const e = events.find((x) => x.id === id)
        const full = e.capacity != null && counts[id] >= e.capacity
        regs.set(id, full ? 'waitlisted' : 'registered')
        if (!full) counts[id]++
        return json(200, [{ registration_id: 'r-' + id, registration_status: full ? 'waitlisted' : 'registered', waitlist_position: full ? 3 : null }])
      }
      if (url.endsWith('/rpc/cancel_event_registration')) {
        log.cancel.push(body)
        const prev = regs.get(id)
        regs.delete(id)
        if (prev === 'registered') counts[id]--
        return json(200, prev)
      }
      if (url.endsWith('/rpc/my_event_registration')) {
        const st = regs.get(id)
        return json(200, st ? [{ registration_id: 'r-' + id, registration_status: st, registered_at: '2026-10-01T00:00:00Z', waitlist_position: st === 'waitlisted' ? 2 : null, answers: {} }] : [])
      }
      return json(200, rows(url))
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
  async function open(w, h, url) {
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
    await page.waitForSelector('h1, [role=alert], main', { timeout: 8000 }).catch(() => {})
    return { page, ctx, errors }
  }
  const vis = (page, sel) => page.isVisible(sel).catch(() => false)
  const card = (name) => `article:has-text("${name}")`
  const dialog = '[role=dialog]'

  // ================= 1. The form: render, validate, payload, confirmation =========
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events')
    await page.waitForSelector(card('Open Event'))
    await page.click(`${card('Open Event')} button:has-text("Register")`)
    await page.waitForSelector(`${dialog} >> text=Company`)
    const dlg = await page.$eval(dialog, (d) => ({ modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-labelledby'), title: d.querySelector('h2')?.textContent }))
    rec('form', 'dialog is an aria-modal dialog titled "Register for this event"', dlg.modal === 'true' && !!dlg.label && dlg.title === 'Register for this event', JSON.stringify(dlg))
    rec('form', 'shows the event name and place', (await vis(page, `${dialog} >> text=Open Event`)) && (await vis(page, `${dialog} >> text=Accra`)))
    rec('form', 'all five question kinds render', (await page.locator(`${dialog} input[type=text], ${dialog} input:not([type])`).count()) >= 1 && (await page.locator(`${dialog} textarea`).count()) === 1 && (await page.locator(`${dialog} input[type=radio]`).count()) === 5 && (await page.locator(`${dialog} input[type=checkbox]`).count()) === 2)
    rec('form', 'required questions are marked, optional ones say so', (await vis(page, `${dialog} >> text=Company`)) && (await page.locator(`${dialog} .text-error-600`).count()) === 2 && (await vis(page, `${dialog} >> text=(optional)`)))
    rec('form', 'help text is shown', await vis(page, `${dialog} >> text=Where you work`))
    rec('form', 'the organizer-only notice is shown', await vis(page, `${dialog} >> text=Only they can see your answers`))
    await page.screenshot({ path: path.join(OUT, 'registration-dialog-desktop.jpg'), type: 'jpeg', quality: 70 })

    // submit empty: client-side validation, nothing sent
    await page.click(`${dialog} button:has-text("Confirm registration")`)
    await page.waitForSelector(`${dialog} [role=alert]:has-text("This question is required.")`)
    const errCount = await page.locator(`${dialog} [role=alert]:has-text("This question is required.")`).count()
    rec('validate', 'empty required questions are flagged inline (2), nothing is sent', errCount === 2 && log.register.length === 0, `errors=${errCount} sent=${log.register.length}`)
    await page.waitForTimeout(100)
    rec('validate', 'focus moves to the first invalid question', await page.evaluate(() => !!document.activeElement?.closest('[data-question="q-company"]')))
    rec('validate', 'the invalid field is aria-invalid and described by its error', await page.$eval('[data-question="q-company"] input', (i) => i.getAttribute('aria-invalid') === 'true' && !!i.getAttribute('aria-describedby')))
    rec('validate', 'whitespace-only counts as empty', await (async () => {
      await page.fill('[data-question="q-company"] input', '   ')
      await page.click(`${dialog} button:has-text("Confirm registration")`)
      return (await page.locator(`${dialog} [role=alert]:has-text("This question is required.")`).count()) >= 1 && log.register.length === 0
    })())

    // fill and submit
    await page.fill('[data-question="q-company"] input', '  Acme  ')
    await page.waitForTimeout(50)
    rec('validate', 'typing clears that question’s error', (await page.locator('[data-question="q-company"] [role=alert]').count()) === 0)
    await page.check('[data-question="q-role"] input[value], [data-question="q-role"] label:has-text("Dev") input').catch(async () => { await page.click('[data-question="q-role"] label:has-text("Dev")') })
    await page.click('[data-question="q-interests"] label:has-text("Talks")')
    await page.click('[data-question="q-interests"] label:has-text("Workshops")')
    await page.click('[data-question="q-first"] label:has-text("No")')
    ctl.delay = 600
    await page.click(`${dialog} button:has-text("Confirm registration")`)
    rec('submit', 'shows "Saving…" and disables the buttons while in flight', await page.waitForSelector(`${dialog} button:has-text("Saving")`, { timeout: 3000 }).then(async () => (await page.locator(`${dialog} button:has-text("Cancel")`).isDisabled())).catch(() => false))
    await page.waitForSelector(`${dialog} >> text=You’re registered`, { timeout: 6000 })
    ctl.delay = 0
    const sent = log.register[0] || {}
    rec('submit', 'sends the event id and exactly the answers given (trimmed, empty omitted, No = false)',
      sent.p_event_id === 'e-open' && JSON.stringify(sent.p_answers) === JSON.stringify({ 'q-company': 'Acme', 'q-role': 'Dev', 'q-interests': ['Talks', 'Workshops'], 'q-first': false }), JSON.stringify(sent))
    rec('submit', 'confirmation view replaces the form', (await vis(page, `${dialog} >> text=Your place at Open Event is confirmed`)) && !(await vis(page, `${dialog} button:has-text("Confirm registration")`)))
    await page.click(`${dialog} button:has-text("Done")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    // The earliest registered upcoming event becomes the "Your next event" card.
    const hero = 'article:has-text("Your next event")'
    rec('submit', 'the event becomes "Your next event", marked Registered, with the count 5 -> 6', (await vis(page, hero)) && (await vis(page, `${hero} >> text=Registered`)) && (await page.textContent(hero)).includes('6'))
    rec('form', 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()
  }

  // ================= 2. Keyboard + no-form events ==================================
  {
    reset()
    const { page, ctx } = await open(1440, 900, '/events')
    await page.waitForSelector(card('Plain Event'))
    await page.focus(`${card('Plain Event')} button:has-text("Register")`)
    await page.keyboard.press('Enter')
    await page.waitForSelector(dialog)
    rec('keyboard', 'an event with no questions still shows a confirmation step', (await vis(page, `${dialog} >> text=Confirm to complete your registration`)) && log.register.length === 0)
    rec('keyboard', 'focus moves into the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    rec('keyboard', 'Tab stays inside the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))
    await page.keyboard.press('Escape')
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('keyboard', 'Escape closes it without registering', log.register.length === 0 && !regs.has('e-plain'))
    rec('keyboard', 'focus returns to the Register button', await page.evaluate(() => /Register/.test(document.activeElement?.textContent || '')))
    // confirm with no questions
    await page.click(`${card('Plain Event')} button:has-text("Register")`)
    await page.click(`${dialog} button:has-text("Confirm registration")`)
    await page.waitForSelector(`${dialog} >> text=You’re registered`)
    rec('keyboard', 'no-question registration sends an empty answer set', JSON.stringify(log.register[0]?.p_answers) === '{}', JSON.stringify(log.register[0]))
    await ctx.close()
  }

  // ================= 3. Full event -> waitlist -> leave ============================
  {
    reset()
    const { page, ctx } = await open(1440, 900, '/events')
    await page.waitForSelector(card('Full Event'))
    rec('waitlist', 'a full event offers "Join waitlist" instead of Register', (await vis(page, `${card('Full Event')} button:has-text("Join waitlist")`)) && !(await vis(page, `${card('Full Event')} button:has-text("Register")`)))
    await page.click(`${card('Full Event')} button:has-text("Join waitlist")`)
    await page.waitForSelector(dialog)
    rec('waitlist', 'dialog is titled "Join the waitlist" with the full-event notice', (await page.textContent(`${dialog} h2`)) === 'Join the waitlist' && (await vis(page, `${dialog} >> text=This event is full`)))
    await page.fill('[data-question="q-company"] input', 'Waitco')
    await page.click(`${dialog} button:has-text("Join waitlist")`)
    await page.waitForSelector(`${dialog} >> text=You’re on the waitlist`)
    rec('waitlist', 'confirmation says waitlisted with the position', (await vis(page, `${dialog} >> text=number 3 on the waitlist`)) && (await vis(page, `${dialog} >> text=register you automatically`)))
    await page.screenshot({ path: path.join(OUT, 'registration-waitlisted-desktop.jpg'), type: 'jpeg', quality: 70 })
    await page.click(`${dialog} button:has-text("Done")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('waitlist', 'card shows "On the waitlist" + "Leave waitlist", not Registered/Unregister', (await vis(page, `${card('Full Event')} >> text=On the waitlist`)) && (await vis(page, `${card('Full Event')} button:has-text("Leave waitlist")`)) && !(await vis(page, `${card('Full Event')} button:has-text("Unregister")`)))
    rec('waitlist', 'registered count is unchanged (a waitlisted person has no seat)', (await page.textContent(card('Full Event'))).includes('10 / 10'))
    await page.click(`${card('Full Event')} button:has-text("Leave waitlist")`)
    await page.waitForSelector(dialog)
    rec('waitlist', 'leaving asks first, in waitlist wording', (await page.textContent(`${dialog} h2`)) === 'Leave the waitlist?')
    await page.click(`${dialog} button:has-text("Keep my place")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('waitlist', '"Keep my place" changes nothing', log.cancel.length === 0 && regs.get('e-full') === 'waitlisted')
    await page.click(`${card('Full Event')} button:has-text("Leave waitlist")`)
    await page.click(`${dialog} button:has-text("Leave waitlist")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('waitlist', 'confirming leaves the waitlist and offers Join waitlist again', log.cancel.length === 1 && (await vis(page, `${card('Full Event')} button:has-text("Join waitlist")`)))
    await ctx.close()
  }

  // ================= 4. Cancelling a real registration =============================
  {
    reset()
    // Open Event is registered too so it takes the "next event" card and Plain Event stays in the grid.
    regs.set('e-plain', 'registered'); counts['e-plain'] = 4
    regs.set('e-open', 'registered'); counts['e-open'] = 6
    const { page, ctx } = await open(1440, 900, '/events')
    await page.waitForSelector(card('Plain Event'))
    await page.click(`${card('Plain Event')} button:has-text("Unregister")`)
    await page.waitForSelector(dialog)
    rec('cancel', 'asks first and explains the consequence', (await page.textContent(`${dialog} h2`)) === 'Cancel your registration?' && (await vis(page, `${dialog} >> text=give up your place`)))
    await page.click(`${dialog} button:has-text("Cancel registration")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('cancel', 'cancelling sends the event id, offers Register again and the count drops 4 -> 3', log.cancel[0]?.p_event_id === 'e-plain' && (await vis(page, `${card('Plain Event')} button:has-text("Register")`)) && (await page.textContent(card('Plain Event'))).includes('3'))
    await ctx.close()
  }

  // ================= 5. Server errors ==============================================
  {
    reset()
    const { page, ctx } = await open(1440, 900, '/events')
    await page.waitForSelector(card('Plain Event'))
    await page.click(`${card('Plain Event')} button:has-text("Register")`)
    ctl.error = 'That event is full'
    await page.click(`${dialog} button:has-text("Confirm registration")`)
    await page.waitForSelector(`${dialog} [role=alert]`)
    rec('errors', 'a known rule is shown in the server’s own words', (await page.textContent(`${dialog} [role=alert]`)).trim() === 'That event is full')
    rec('errors', 'the dialog stays open and can be retried', await page.isEnabled(`${dialog} button:has-text("Confirm registration")`))
    ctl.error = 'duplicate key value violates unique constraint "event_registrations_pkey" (23505)'
    await page.click(`${dialog} button:has-text("Confirm registration")`)
    await page.waitForFunction(() => /Could not complete your registration/.test(document.querySelector('[role=dialog] [role=alert]')?.textContent || ''))
    const shown = await page.textContent(`${dialog} [role=alert]`)
    rec('errors', 'an unknown error is hidden behind a generic message (no database text)', /Could not complete your registration/.test(shown) && !/duplicate|constraint|23505/.test(shown), shown.trim())
    ctl.error = null
    await page.click(`${dialog} button:has-text("Confirm registration")`)
    await page.waitForSelector(`${dialog} >> text=You’re registered`)
    rec('errors', 'retry succeeds and clears the error', !(await vis(page, `${dialog} [role=alert]`)))
    await ctx.close()
  }

  // ================= 6. Event Detail ===============================================
  {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events/e-wl')
    await page.waitForSelector('text=Waitlisted Event')
    rec('detail', 'waitlisted: header says so and offers Leave waitlist', (await vis(page, 'text=On the waitlist')) && (await vis(page, 'button:has-text("Leave waitlist")')))
    rec('detail', 'waitlisted: no Enter Event Mode, no attendee tabs, no Register button', !(await vis(page, 'button:has-text("Enter Event Mode")')) && (await page.locator('[role=tab]').count()) === 0 && !(await vis(page, 'button:has-text("Register for Event")')) && !(await vis(page, 'button:has-text("Register Now")')))
    await page.screenshot({ path: path.join(OUT, 'registration-detail-waitlisted.jpg'), type: 'jpeg', quality: 70 })
    await page.click('button:has-text("Leave waitlist")')
    await page.click(`${dialog} button:has-text("Leave waitlist")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('detail', 'leaving the waitlist returns to the register state', (await page.locator('button:has-text("Join waitlist")').first().isVisible()) && regs.size === 0)
    await page.click('button:has-text("Join waitlist") >> nth=0')
    await page.waitForSelector(dialog)
    await page.click(`${dialog} button:has-text("Join waitlist")`)
    await page.waitForSelector(`${dialog} >> text=You’re on the waitlist`)
    await page.click(`${dialog} button:has-text("Done")`)
    await page.waitForSelector(dialog, { state: 'detached' })
    rec('detail', 'joining from the detail page shows the waitlisted state', await vis(page, 'text=On the waitlist'))
    rec('detail', 'no console/page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
    await ctx.close()

    reset()
    const o = await open(1440, 900, '/events/e-open')
    await o.page.waitForSelector('text=Open Event')
    await o.page.locator('button:has-text("Register for Event")').first().click()
    await o.page.waitForSelector(dialog)
    await o.page.fill('[data-question="q-company"] input', 'Acme')
    await o.page.click('[data-question="q-role"] label:has-text("PM")')
    await o.page.click(`${dialog} button:has-text("Confirm registration")`)
    await o.page.waitForSelector(`${dialog} >> text=You’re registered`)
    await o.page.click(`${dialog} button:has-text("Done")`)
    await o.page.waitForSelector(dialog, { state: 'detached' })
    rec('detail', 'registering from the detail page unlocks Event Mode and the attendee tabs', (await vis(o.page, 'button:has-text("Enter Event Mode")')) && (await o.page.locator('[role=tab]').count()) >= 3)
    await o.ctx.close()
  }

  // ================= 7. Phone viewport =============================================
  {
    reset()
    const { page, ctx } = await open(390, 844, '/events')
    await page.waitForSelector(card('Open Event'))
    await page.click(`${card('Open Event')} button:has-text("Register")`)
    await page.waitForSelector(`${dialog} >> text=Company`)
    const box = await page.$eval(dialog, (d) => { const r = d.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.innerHeight, vw: window.innerWidth } })
    rec('phone', 'the dialog is a sheet that fits the screen (390x844)', box.top >= 0 && box.bottom <= box.vh + 1 && box.left >= 0 && box.right <= box.vw + 1, JSON.stringify(box))
    rec('phone', 'no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.screenshot({ path: path.join(OUT, 'registration-dialog-phone.jpg'), type: 'jpeg', quality: 70 })
    const confirm = page.locator(`${dialog} button:has-text("Confirm registration")`)
    rec('phone', 'the Confirm button is always reachable (footer is pinned)', await confirm.isVisible() && (await confirm.boundingBox()).y + (await confirm.boundingBox()).height <= 844)
    const small = await page.locator(`${dialog} label:has(input)`).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 40).length)
    rec('phone', 'choice rows are at least 40px tall (touch targets)', small === 0, `small=${small}`)
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync(path.join(OUT, '..', 'registration-results.json'), JSON.stringify(results, null, 2))
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - fails}  FAIL ${fails}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
