// Dashboard, Event Home (phone), Agenda / My Schedule, Speakers, Exhibitors and the
// attendee Directory.
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
const isoDay = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
const events = [
  mk(0, { id: 'e-past', name: 'Past Founders Mixer', start_date: '2026-09-04', status: 'past', location: 'Lagos' }),
  mk(0, { id: 'e-next', name: 'Africa Tech & Innovation Summit 2027', start_date: isoDay(0), end_date: isoDay(2), location: 'Accra International Conference Centre, Accra, Ghana', image_url: svg('#10b981', '#0b1c30') }),
  ...Array.from({ length: 14 }, (_, i) => mk(i + 1)),
].sort((a, b) => (a.start_date + a.id).localeCompare(b.start_date + b.id))

const MIN = 60000
const at = (m) => new Date(Date.now() + m * MIN).toISOString()
const sess = (n, title, type, startM, durM, room, descr, ev = 'e-next') => ({ id: 'ss' + n, event_id: ev, title, description: descr, start_at: at(startM), end_at: at(startM + durM), location: room, session_type: type, status: 'scheduled', display_order: n, created_by: null, created_at: '2026-10-01', updated_at: '2026-10-01', event_timezone: null })
const sessionRows = [
  sess(1, 'Registration & Executive Breakfast', 'networking', -180, 60, 'Main Foyer', 'Collect your badge, meet fellow delegates and start the day over breakfast.'),
  sess(2, "Opening Keynote: Unifying Africa's Digital Infrastructure", 'keynote', -30, 90, 'Grand Ballroom', 'The opening address on continental connectivity, interoperability and the investment needed to deliver both.'),
  sess(3, 'Panel: Cross-Border Payments and Liquidity Rails', 'panel', 35, 60, 'Hall B', 'Central banks, fintechs and banks on settlement, FX liquidity and instant payments across borders.'),
  sess(4, 'Networking Lunch', 'break', 100, 60, 'Terrace', 'Hosted lunch with themed tables by sector.'),
  sess(5, 'Workshop: Building an Investor-Ready Pitch', 'workshop', 180, 90, 'Workshop Room 1', 'A hands-on session that turns a deck into a story investors fund.'),
  sess(6, 'Fireside: Sovereign AI and Local Compute', 'session', 190, 90, 'Auditorium 1', 'Why data sovereignty is becoming a competitive advantage.'),
  sess(7, 'Keynote: The Next 100 Million Mobile Money Users', 'keynote', 24 * 60 + 60, 75, 'Grand Ballroom', 'What it takes to bring reliable, low-cost financial services to the next wave of users.'),
  sess(8, 'Panel: Venture Capital in Africa', 'panel', 24 * 60 + 150, 60, 'Hall B', 'Investors discuss deal flow and what founders should expect.'),
  sess(9, 'Startup Pitch Finals', 'session', 48 * 60 + 90, 75, 'Hall B', 'Six finalists pitch to the summit investor panel.'),
]
const savedEntries = [2, 3, 5, 6, 7].map((n) => { const s = sessionRows.find((x) => x.id === 'ss' + n); return { session_id: s.id, event_id: s.event_id, title: s.title, description: s.description, start_at: s.start_at, end_at: s.end_at, location: s.location, session_type: s.session_type, status: s.status, display_order: s.display_order, event_timezone: null, saved_at: '2026-10-20' } })
const spk = (id, name, title, company, photo) => ({ speaker_id: id, speaker_role: 'speaker', display_order: 0, full_name: name, job_title: title, company, photo_url: 'https://randomuser.me/api/portraits/' + photo + '.jpg', user_id: null })
const sessionSpeakers = [
  { ...spk('sp1', 'Dr. Amina Bello', 'Commissioner', 'Pan-African Digital Commission', 'women/21'), session_id: 'ss2' },
  { ...spk('sp2', 'Kwesi Mensah', 'Founder & CEO', 'PayRelay', 'men/36'), session_id: 'ss2', display_order: 1 },
  { ...spk('sp3', 'Linda Ncube', 'Director', 'Innovation Foundation', 'women/68'), session_id: 'ss3' },
  { ...spk('sp5', 'Sarah Al-Mansoor', 'Managing Partner', 'Gulf-Africa Ventures', 'women/33'), session_id: 'ss3', display_order: 1 },
  { ...spk('sp8', 'Daniel Asante', 'Managing Partner', 'Accra Ventures', 'men/52'), session_id: 'ss5' },
  { ...spk('sp14', 'Olu Adeyemi', 'CTO', 'Lagos Neural Labs', 'men/29'), session_id: 'ss6' },
  { ...spk('sp2', 'Kwesi Mensah', 'Founder & CEO', 'PayRelay', 'men/36'), session_id: 'ss7' },
]

const spkRow = (id, name, title, company, industry, photo, n) => ({ id, event_id: 'e-next', user_id: null, full_name: name, job_title: title, company, bio: 'Bio for ' + name + '.', photo_url: 'https://randomuser.me/api/portraits/' + photo + '.jpg', linkedin: '', website: '', industry, display_order: n, session_count: n % 3 + 1 })
const speakerRows = [
  spkRow('sp1','Dr. Amina Bello','Commissioner for Digital Economy','Pan-African Digital Commission','Public Policy','women/21',1),
  spkRow('sp2','Kwesi Mensah','Founder & CEO','PayRelay','Fintech','men/36',2),
  spkRow('sp3','Linda Ncube','Director','Pan-African Innovation Foundation','AI & Governance','women/68',3),
  spkRow('sp5','Sarah Al-Mansoor','Managing Partner','Gulf-Africa Ventures','Venture Capital','women/33',4),
  spkRow('sp8','Daniel Asante','Managing Partner','Accra Ventures','Venture Capital','men/52',5),
  spkRow('sp14','Olu Adeyemi','Chief Technology Officer','Lagos Neural Labs','Artificial Intelligence','men/29',6),
]

const names = ['Ama Boateng','Daniel Tetteh','Linda Ncube','Maya Chen','James Okafor','Amina Hassan','Kwesi Asante','Efua Owusu','Sarah Al-Mansoor','Peter Kamau','Fatima Bello']
const jobs = ['Head of Product','Partner','Program Director','Director, Africa','Founder & CEO','Founder','Managing Director','Chief Medical Officer','Partner','Head of Logistics','Head of Digital Banking']
const cos = ['Zeta Mobile','Kilimanjaro Capital','Pan-African Policy Institute','Verde Energy Partners','Lagos Neural Labs','Nile Builders Studio','Savannah Agri Group','Ubuntu Health','Gulf-Africa Ventures','Eko Freight','Harmattan Bank']
const inds = ['Fintech','Venture Capital','Public Policy','Clean Energy','Artificial Intelligence','Technology','Agritech','Healthtech','Venture Capital','Logistics','Banking']
const locs = ['Accra, Ghana','Accra, Ghana','Johannesburg, South Africa','Singapore','Lagos, Nigeria','Cairo, Egypt','Kumasi, Ghana','Accra, Ghana','Dubai, UAE','Nairobi, Kenya','Abuja, Nigeria']
const dirRows = names.map((n, i) => ({ user_id: 'u' + i, full_name: n, job_title: jobs[i], company: cos[i], industry: inds[i], location: locs[i], photo_url: 'https://randomuser.me/api/portraits/' + (i % 2 ? 'men' : 'women') + '/' + (20 + i * 3) + '.jpg', already_connected: i === 1 || i === 4 }))
const evConns = [1, 4].map((i) => ({ id: 'ec' + i, owner_id: UID, connected_user_id: 'u' + i, full_name: names[i], job_title: jobs[i], company: cos[i], industry: inds[i], location: locs[i], photo_url: dirRows[i].photo_url, relationship_type: 'Partner', event_name: 'x', event_id: 'e-next', follow_up_date: null, status: 'active', created_at: '2026-10-01', updated_at: '2026-10-01', email: '', phone: '', linkedin: '', website: '' }))
const exhRow = (id, name, industry, booth, color, descr, site) => ({ id, event_id: 'e-next', organization_id: null, name, description: descr, logo_url: 'https://ui-avatars.com/api/?name=' + name.replace(/ /g, '+') + '&size=256&background=' + color + '&color=ffffff&bold=true&format=png', industry, booth, website: site, linkedin: site ? 'https://linkedin.com/company/x' : '', display_order: 1 })
const exhibitorRows = [
  exhRow('x1','Kora Payments','Fintech','Booth A1','0A66C2','Payments infrastructure for African businesses: collections, payouts and cross-border settlement.','https://kora.example'),
  exhRow('x2','Sahel Cloud','Cloud Computing','Booth A2','0E7490','Sovereign cloud and edge computing with data centres across the Sahel.','https://sahel.example'),
  exhRow('x3','Baobab Ventures','Venture Capital','Booth A3','166534','Early-stage venture capital backing African founders from pre-seed to Series A.',''),
  exhRow('x4','Nile Analytics','Data & Analytics','Booth A4','9A3412','Data products and analytics for emerging-market businesses.','https://nile.example'),
  exhRow('x5','Zeta Mobile','Telecom','Booth B1','7C3AED','',''),
]
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
  if (p.endsWith('/event_registrations')) return [...registered].map((id) => ({ event_id: id, id: 'reg-' + id + '-0f3a9c21', user_id: UID, checked_in_at: null }))
  if (p.endsWith('/event_invitations')) return invitations
  if (p.endsWith('/connections')) return one(conns)
  if (p.endsWith('/follow_ups')) return one(followUps)
  if (p.endsWith('/opportunities')) return one(opps)
  if (p.endsWith('/notifications')) return notifs
  if (p.endsWith('/rpc/get_event_registration_counts')) return events.map((e) => ({ event_id: e.id, registration_count: regCounts[e.id] }))
  if (p.endsWith('/rpc/get_public_profiles')) return [{ id: INVITER, full_name: 'Kwame Asante' }]
  if (p.endsWith('/event_sessions')) return sessionRows
  if (p.endsWith('/rpc/get_event_agenda')) return sessionRows
  if (p.endsWith('/rpc/get_my_event_schedule')) return savedEntries
  if (p.endsWith('/rpc/get_my_saved_session_ids')) return savedEntries.map((e) => ({ session_id: e.session_id }))
  if (p.endsWith('/rpc/get_event_session_speakers')) return sessionSpeakers
  if (p.endsWith('/rpc/get_event_speakers')) return speakerRows
  if (p.endsWith('/rpc/get_event_exhibitors') || p.endsWith('/event_exhibitors')) return exhibitorRows
  if (p.endsWith('/rpc/event_attendee_directory')) return dirRows
  if (p.endsWith('/connections')) return evConns
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
  async function open(w, url) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()) })
    await ctx.addInitScript(([uid]) => { const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'f@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }; localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)) }, [UID])
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, h2', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    return { page, ctx, errors }
  }
  const ov = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const vis = (p, sel) => p.locator(sel).first().isVisible().catch(() => false)
  const safe = async (name, fn) => { try { await fn() } catch (e) { rec(name, 'test crashed', false, String(e.message).split('\n')[0].slice(0, 160)) } }

  await safe('dashboard', async () => {
    const { page, ctx, errors } = await open(1440, '/dashboard')
    const h1 = await page.textContent('h1')
    rec('dashboard', 'welcome banner names the user and the next event', h1.includes('Welcome back, Freda') && h1.includes('Africa Tech'))
    rec('dashboard', 'four stat tiles', (await page.locator('a:has(p:text-is("Connections")), a:has(p:text-is("Follow-ups")), a:has(p:text-is("Opportunities")), a:has(p:text-is("My events"))').count()) === 4)
    rec('dashboard', 'overdue follow-up flagged', await vis(page, 'text=overdue'))
    const before = await page.textContent('section[aria-label*="Calendar"] h2')
    await page.click('button[aria-label="Next month"]')
    rec('dashboard', 'calendar next month changes the heading', (await page.textContent('section[aria-label*="Calendar"] h2')) !== before)
    await page.click('button[aria-label="Previous month"]')
    rec('dashboard', 'calendar highlights event days', (await page.locator('section[aria-label*="Calendar"] span.bg-primary-600').count()) >= 1)
    await page.click('a:has(p:text-is("Follow-ups"))'); await page.waitForURL('**/follow-ups')
    rec('dashboard', 'Follow-ups tile -> /follow-ups', true)
    await page.goBack(); await page.waitForSelector('h1')
    await page.click('text=View event details'); await page.waitForURL('**/events/e-next')
    rec('dashboard', 'View event details -> /events/e-next', true)
    rec('dashboard', 'no page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })
  for (const w of [390, 820]) await safe('dashboard', async () => { const { page, ctx } = await open(w, '/dashboard'); rec('dashboard', `no horizontal overflow @${w}`, (await ov(page)) === 0); await ctx.close() })

  await safe('home-mobile', async () => {
    const { page, ctx, errors } = await open(390, '/events/e-next/home')
    const back = page.locator('a[aria-label="Back to event details"]')
    rec('home-mobile', 'back arrow -> /events/e-next, no text', (await back.getAttribute('href')) === '/events/e-next' && ((await back.textContent()) || '').trim() === '')
    const box = await back.boundingBox(); rec('home-mobile', 'back arrow >= 44x44', box.width >= 44 && box.height >= 44, Math.round(box.width) + 'x' + Math.round(box.height))
    rec('home-mobile', 'no "Rally" logo row', !(await vis(page, 'span:text-is("Rally")')))
    rec('home-mobile', 'Connect tile removed, Schedule tile present', !(await vis(page, 'button:text-is("Connect")')) && (await vis(page, 'main a[href$="/schedule"]')))
    rec('home-mobile', 'Live Announcements + Agenda sections', (await vis(page, 'text=Live Announcements')) && (await vis(page, '#home-agenda')))
    rec('home-mobile', 'My Attendee Pass row removed', !(await vis(page, 'text=My Attendee Pass')))
    await page.click('main a[href$="/schedule"]'); await page.waitForURL('**/schedule')
    rec('home-mobile', 'Schedule tile -> /schedule', true)
    rec('home-mobile', 'no page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('program', async () => {
    const { page, ctx, errors } = await open(390, '/events/e-next/agenda')
    rec('program', 'phone: PDF, Sync Calendar and description hidden', !(await vis(page, 'text=Download PDF')) && !(await vis(page, 'button:has-text("Sync Calendar")')) && !(await vis(page, 'text=Explore')))
    const tabs = await page.locator('[role=tablist][aria-label="Agenda or schedule"] button').allTextContents()
    rec('program', 'toggle reads Agenda / Schedule with counts', /^Agenda/.test(tabs[0].trim()) && /^Schedule/.test(tabs[1].trim()) && !/Full|My /.test(tabs.join(' ')), tabs.join(' | '))
    const url0 = page.url()
    await page.click('[role=tablist][aria-label="Agenda or schedule"] button:has-text("Schedule")')
    await page.waitForSelector('h1:has-text("My Schedule")')
    rec('program', 'Schedule switches in place (URL unchanged)', page.url() === url0)
    await page.click('[role=tablist][aria-label="Agenda or schedule"] button:has-text("Agenda")')
    await page.waitForSelector('h1:has-text("Agenda")')
    rec('program', 'back to Agenda in place', page.url() === url0)
    const dt = (((await page.locator('[role=tablist][aria-label="Agenda days"] button').first().textContent()) || '')).replace(/\s+/g, ' ').trim()
    rec('program', 'day cards show "Day N" + count, no date', /Day 1/.test(dt) && /session/.test(dt) && !/Oct|—/.test(dt), dt)
    rec('program', 'no horizontal overflow', (await ov(page)) === 0)
    rec('program', 'no page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })
  await safe('program', async () => { const { page, ctx } = await open(390, '/events/e-next/schedule'); rec('program', '/schedule opens on Schedule', await vis(page, 'h1:has-text("My Schedule")')); await ctx.close() })

  await safe('shell', async () => {
    const { page, ctx } = await open(390, '/events/e-next/speakers')
    const hdr = ((await page.locator('header').first().textContent()) || '').replace(/\s+/g, ' ')
    rec('shell', 'top bar shows only the event name', hdr.includes('Africa Tech') && !/Oct|Accra/.test(hdr), hdr.trim())
    await page.click('button[aria-label="Connect"]:visible')
    rec('shell', 'Connect sheet offers Scan QR Code and My Event Pass', (await vis(page, 'text=Scan QR Code')) && (await vis(page, 'text=My Event Pass')))
    await page.click('text=My Event Pass')
    rec('shell', 'event pass shows event, QR and pass id', (await vis(page, 'text=Event pass')) && (await vis(page, 'img[alt="Your event pass QR code"]')) && (await vis(page, 'text=Pass ID')))
    await ctx.close()
  })

  await safe('speakers', async () => {
    const { page, ctx, errors } = await open(390, '/events/e-next/speakers')
    rec('speakers', 'cards + featured keynote badge', (await page.locator('a[href*="/speakers/sp"]').count()) >= 5 && (await vis(page, 'article span:text-is("Keynote")')))
    await page.click('button[aria-pressed="false"]:has-text("Venture Capital")')
    const n = await page.locator('section[aria-labelledby="faculty-heading"] ul > li').count()
    rec('speakers', 'industry filter narrows the list', n === 2, 'cards=' + n)
    await page.click('button:has-text("All speakers")')
    await page.fill('input[type=search]', 'olu')
    rec('speakers', 'search finds one speaker', (await page.locator('section[aria-labelledby="faculty-heading"] ul > li').count()) === 1)
    await page.fill('input[type=search]', '')
    await page.click('section[aria-labelledby="faculty-heading"] ul > li a >> nth=0'); await page.waitForURL('**/speakers/*'); await page.waitForSelector('h1:has-text("Olu"), h1', { timeout: 8000 })
    rec('speakers', 'card -> speaker detail', await vis(page, 'h1'), await page.locator('h1').first().textContent())
    rec('speakers', 'no overflow / errors', (await ov(page)) === 0 && errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('exhibitors', async () => {
    const { page, ctx, errors } = await open(390, '/events/e-next/exhibitors')
    rec('exhibitors', 'five cards', (await page.locator('a[href*="/exhibitors/x"]').count()) === 5)
    await page.fill('input[type=search]', 'cloud')
    rec('exhibitors', 'search narrows to one', (await page.locator('a[href*="/exhibitors/x"]').count()) === 1)
    await page.fill('input[type=search]', '')
    await page.click('a[href*="/exhibitors/x1"]'); await page.waitForURL('**/exhibitors/x1'); await page.waitForSelector('h1', { timeout: 8000 })
    rec('exhibitors', 'detail: Visit website present, no globe icon', (await vis(page, 'a:has-text("Visit website")')) && (await page.locator('a[aria-label$="website"]').count()) === 0)
    rec('exhibitors', 'detail: six social icons, only LinkedIn active', (await page.locator('ul[aria-label*="social media"] li').count()) === 6 && (await page.locator('ul[aria-label*="social media"] a').count()) === 1)
    rec('exhibitors', 'detail: Book a booth meeting disabled', await page.locator('button:has-text("Book a booth meeting")').isDisabled())
    rec('exhibitors', 'no overflow / errors', (await ov(page)) === 0 && errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('directory', async () => {
    const { page, ctx, errors } = await open(390, '/events/e-next/network')
    rec('directory', '9 cards on page 1 of 11', (await page.locator('main ul > li').count()) === 9)
    await page.click('button[aria-label="Page 2"]')
    rec('directory', 'page 2 has the remaining 2', (await page.locator('main ul > li').count()) === 2)
    await page.click('button[aria-label="Page 1"]')
    await page.selectOption('select >> nth=0', { label: 'Venture Capital (2)' })
    rec('directory', 'industry filter narrows to 2', (await page.locator('main ul > li').count()) === 2)
    await page.selectOption('select >> nth=0', 'all')
    await page.click('main li button:has-text("Connect") >> nth=0')
    rec('directory', 'Connect opens the existing connect flow', await page.locator('[role=dialog]').first().isVisible().catch(() => false))
    rec('directory', 'no overflow / errors', (await ov(page)) === 0 && errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('event-detail', async () => {
    const { page, ctx, errors } = await open(390, '/events/e-next')
    rec('event-detail', 'registered: no attendance pass card', !(await vis(page, 'text=Your Attendance Pass')) && !(await vis(page, 'text=Official credential')))
    rec('event-detail', 'phone: wallet button hidden', !(await vis(page, 'text=Download Digital Pass')))
    const cal = page.locator('button[aria-label="Add to calendar"]')
    const b = await cal.boundingBox(); rec('event-detail', 'Add to calendar is a compact 44px icon', b.width >= 44 && b.width < 60 && ((await cal.innerText()) || '').trim() === '', Math.round(b.width) + 'x' + Math.round(b.height))
    rec('event-detail', 'no overflow / errors', (await ov(page)) === 0 && errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await browser.close()
  const f = results.filter((r) => !r.pass).length
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - f}  FAIL ${f}`)
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
