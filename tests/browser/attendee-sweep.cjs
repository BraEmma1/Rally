// Every attendee route at 320 / 390 / 820 / 1440px (overflow, errors, labels, tap targets),
// Event Detail register / unregister / calendar / share, Events URL handling, Messages
// inbox regression, Follow-ups / Opportunities / Notifications / Profile / Scan, the
// tablet sidebar, keyboard focus, and signed-out / wrong-role access.
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

const exhibitorRows = [1, 2, 3].map((n) => ({ id: 'x' + n, event_id: 'e-next', organization_id: null, name: ['PayRelay', 'Verde Energy', 'Ubuntu Health'][n - 1], description: 'Fixture exhibitor ' + n + '.', logo_url: '', industry: ['Fintech', 'Clean Energy', 'Healthtech'][n - 1], booth: 'B' + n, website: 'https://example.test', linkedin: '', display_order: n }))
const names = ['Ama Boateng','Daniel Tetteh','Linda Ncube','Maya Chen','James Okafor','Amina Hassan','Kwesi Asante','Efua Owusu','Sarah Al-Mansoor','Peter Kamau','Fatima Bello']
const jobs = ['Head of Product','Partner','Program Director','Director, Africa','Founder & CEO','Founder','Managing Director','Chief Medical Officer','Partner','Head of Logistics','Head of Digital Banking']
const cos = ['Zeta Mobile','Kilimanjaro Capital','Pan-African Policy Institute','Verde Energy Partners','Lagos Neural Labs','Nile Builders Studio','Savannah Agri Group','Ubuntu Health','Gulf-Africa Ventures','Eko Freight','Harmattan Bank']
const inds = ['Fintech','Venture Capital','Public Policy','Clean Energy','Artificial Intelligence','Technology','Agritech','Healthtech','Venture Capital','Logistics','Banking']
const locs = ['Accra, Ghana','Accra, Ghana','Johannesburg, South Africa','Singapore','Lagos, Nigeria','Cairo, Egypt','Kumasi, Ghana','Accra, Ghana','Dubai, UAE','Nairobi, Kenya','Abuja, Nigeria']
const dirRows = names.map((n, i) => ({ user_id: 'u' + i, full_name: n, job_title: jobs[i], company: cos[i], industry: inds[i], location: locs[i], photo_url: 'https://randomuser.me/api/portraits/' + (i % 2 ? 'men' : 'women') + '/' + (20 + i * 3) + '.jpg', already_connected: i === 1 || i === 4 }))
const evConns = [1, 4].map((i) => ({ id: 'ec' + i, owner_id: UID, connected_user_id: 'u' + i, full_name: names[i], job_title: jobs[i], company: cos[i], industry: inds[i], location: locs[i], photo_url: dirRows[i].photo_url, relationship_type: 'Partner', event_name: 'x', event_id: 'e-next', follow_up_date: null, status: 'active', created_at: '2026-10-01', updated_at: '2026-10-01', email: '', phone: '', linkedin: '', website: '' }))

const manyConns = Array.from({ length: 11 }, (_, i) => ({ id: 'c' + (i + 1), owner_id: UID, connected_user_id: i % 2 ? null : 'u' + i, full_name: names[i], job_title: jobs[i], company: cos[i], industry: inds[i], location: locs[i], photo_url: dirRows[i].photo_url, relationship_type: ['Partner', 'Investor', 'Customer'][i % 3], event_name: 'Global Networking Mixer 2026', event_id: 'e-02', follow_up_date: null, status: 'active', created_at: '2026-10-0' + (1 + (i % 8)), updated_at: '2026-10-05', email: '', phone: '', linkedin: i === 0 ? 'https://linkedin.com/in/x' : '', website: '' }))
const noteRows = [1, 2, 3].map((n) => ({ id: 'n' + n, connection_id: 'c1', owner_id: UID, content: ['Met at the Lagos mixer. Building a mobile money API and looking for banking partners.', 'Follow-up call went well. Wants an intro to two pilot customers.', 'Sent the deck; waiting on feedback.'][n - 1], created_at: '2026-10-0' + n, updated_at: '2026-10-0' + n }))
const profile = { id: UID, full_name: 'Freda Astanga', photo_url: '', job_title: 'Founder', company: 'SheBuilds', industry: 'Technology', location: 'Accra', bio: 'Builder of things.', looking_for: 'Partners', can_offer: 'Mentorship', linkedin: '', website: '', email: 'f@example.test', phone: '', created_at: '2026-01-01', updated_at: '2026-01-01' }
const conns = [1, 2, 3].map((n) => ({ id: `c${n}`, owner_id: UID, connected_user_id: null, full_name: ['Ama Mensah', 'Kwame Asante', 'Efua Boateng'][n - 1], job_title: 'Head of Product', company: 'Zeepay', industry: 'Fintech', location: 'Accra', email: 'a@x.test', phone: '', linkedin: '', website: '', photo_url: '', relationship_type: 'Partner', event_name: 'Test Event 02', event_id: 'e-02', follow_up_date: n === 1 ? '2026-10-20' : null, status: 'Active', created_at: '2026-10-01', updated_at: '2026-10-02' }))
const followUps = [1, 2].map((n) => ({ id: `f${n}`, connection_id: `c${n}`, owner_id: UID, title: n === 1 ? 'Send proposal deck' : 'Share intro', note: 'Mentioned the payments corridor.', due_date: n === 1 ? '2026-10-20' : '2026-11-02', completed: false, completed_at: null, created_at: '2026-10-01' }))
const opps = [1, 2].map((n) => ({ id: `o${n}`, owner_id: UID, connection_id: `c${n}`, title: n === 1 ? 'Payments partnership' : 'Seed investment', description: 'Fixture opportunity.', type: n === 1 ? 'Partnership' : 'Investment', stage: n === 1 ? 'Discussing' : 'Proposal', value: n === 1 ? 25000 : 120000, expected_close_date: '2026-12-15', event_name: 'Test Event 02', event_id: 'e-02', created_at: '2026-10-01', updated_at: '2026-10-05' }))
const notifs = [1, 2, 3].map((n) => ({ id: `n${n}`, user_id: UID, type: 'new_connection', title: 'New connection', message: `You connected with Person ${n}.`, link: '/connections', read: n > 1, created_at: '2026-10-2' + n }))
const convs = [1, 2].map((n) => ({ conversation_id: `cv${n}`, other_user_id: INVITER, other_full_name: ['Kwame Asante', 'Linda Ncube'][n - 1], other_job_title: 'Director', other_company: 'UNDP', other_photo_url: '', event_id: null, event_name: null, last_message_body: 'See you at the summit!', last_message_at: '2026-10-22T10:00:00Z', last_message_sender_id: INVITER, unread_count: n === 1 ? 2 : 0, updated_at: '2026-10-22T10:00:00Z' }))
const msgs = [1, 2, 3].map((n) => ({ id: `m${n}`, sender_id: n % 2 ? INVITER : UID, body: `Fixture message ${n}`, created_at: `2026-10-22T10:0${n}:00Z`, is_mine: n % 2 === 0 }))

// ---- mock state --------------------------------------------------------------
const ctl = { delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false, failUnregister: false, failRegisterOnlyAfterStatus: false, accountType: 'attendee', accountStatus: 'active' }
let registered, invitations, regCounts, log
function reset() {
  registered = new Set(['e-next'])
  invitations = ['e-02', 'e-04', 'e-06'].map((eid, i) => ({ id: `inv-${i}`, event_id: eid, invited_user_id: UID, invited_by: INVITER, status: 'Pending', created_at: `2026-10-0${i + 1}`, responded_at: null }))
  regCounts = Object.fromEntries(events.map((e) => [e.id, 7]))
  log = []
  Object.assign(ctl, { delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false, failUnregister: false, accountType: 'attendee', accountStatus: 'active' })
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
  if (p.endsWith('/user_accounts')) return one([{ account_type: ctl.accountType, status: ctl.accountStatus }])
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
  if (p.endsWith('/rpc/get_event_exhibitors')) return exhibitorRows
  if (p.endsWith('/rpc/get_event_host')) return []
  if (p.endsWith('/rpc/event_attendee_directory')) return dirRows
  if (p.endsWith('/connections')) return manyConns
  if (p.endsWith('/notes')) return noteRows
  if (p.endsWith('/opportunities')) return opps
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
    if (m === 'DELETE' && url.includes('/event_registrations') && ctl.failUnregister) { log.push(['DELETE reg FAILED']); return json(403, err('42501', 'permission denied for table event_registrations')) }
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
  const SEEN = []
  const open = async (w, h, url, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|randomuser|net::/.test(m.text())) errors.push('console: ' + m.text().slice(0, 140)) })
    page.on('request', (r) => { if (r.url().startsWith(API)) SEEN.push(r.method() + ' ' + r.url().replace(API, '')) })
    if (!opts.signedOut) await ctx.addInitScript(([uid]) => { const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'f@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }; localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)) }, [UID])
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }) })
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, h2', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(500)
    return { page, ctx, errors }
  }
  const ov = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const vis = (p, sel) => p.locator(sel).first().isVisible().catch(() => false)
  const safe = async (g, fn) => { try { await fn() } catch (e) { rec(g, 'test crashed', false, String(e.message).split('\n')[0].slice(0, 200)) } }

  // ===== S1. every attendee route x 4 widths: errors, overflow, content, labels, touch targets =====
  const ROUTES = ['/dashboard', '/events', '/events/e-next', '/events/e-02', '/events/e-past', '/connections', '/connections/c1', '/follow-ups', '/opportunities', '/opportunities/o1', '/messages', '/messages/cv1', '/notifications', '/profile', '/scan',
    '/events/e-next/home', '/events/e-next/network', '/events/e-next/agenda', '/events/e-next/schedule', '/events/e-next/speakers', '/events/e-next/speakers/sp1', '/events/e-next/exhibitors', '/events/e-next/exhibitors/x1', '/events/e-next/info', '/events/e-next/map', '/events/e-next/deal-room', '/events/e-next/messages', '/events/e-next/messages/cv1', '/events/e-next/connections/ec1']
  const sweepIssues = { overflow: [], errors: [], empty: [], unlabeled: [], tiny: [] }
  for (const w of [320, 390, 820, 1440]) {
    reset()
    const { page, ctx, errors } = await open(w, 900, '/dashboard')
    for (const r of ROUTES) {
      errors.length = 0
      await page.goto(BASE + r, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForSelector('h1, h2, main', { timeout: 6000 }).catch(() => {})
      await page.waitForTimeout(350)
      const info = await page.evaluate((w) => {
        const vp = document.documentElement.clientWidth
        const visible = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
        const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || e.getAttribute('placeholder') || (e.querySelector('img[alt]') && e.querySelector('img[alt]').alt) || '').trim()
        const ctl = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab]')].filter(visible)
        const unlabeled = ctl.filter((e) => !name(e) && !e.closest('label')).map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''))
        const tiny = w <= 820 ? ctl.filter((e) => { if (e.closest('p, li > span') && e.tagName === 'A' && !e.className.includes('rounded')) return false; const b = e.getBoundingClientRect(); return b.height < 32 && !(e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio' || e.type === 'range')) }).map((e) => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24) + ':' + Math.round(e.getBoundingClientRect().height)) : []
        return { over: document.documentElement.scrollWidth - vp, text: (document.querySelector('main') || document.body).innerText.trim().length, unlabeled, tiny, h1s: document.querySelectorAll('h1').length, path: location.pathname }
      }, w)
      if (info.over !== 0) sweepIssues.overflow.push(`${r}@${w}:${info.over}`)
      if (errors.length) sweepIssues.errors.push(`${r}@${w}:${errors[0].slice(0, 90)}`)
      if (info.text < 20 || info.path === '/login') sweepIssues.empty.push(`${r}@${w}->${info.path}`)
      if (info.unlabeled.length) sweepIssues.unlabeled.push(`${r}@${w}:${info.unlabeled.slice(0, 3).join(',')}`)
      if (info.tiny.length) sweepIssues.tiny.push(`${r}@${w}:${info.tiny.slice(0, 3).join(',')}`)
    }
    await ctx.close()
  }
  rec('sweep', `no horizontal overflow on ${ROUTES.length} routes x 4 widths (320/390/820/1440)`, sweepIssues.overflow.length === 0, sweepIssues.overflow.slice(0, 8).join(' '))
  rec('sweep', 'no page or console errors on any route/width', sweepIssues.errors.length === 0, sweepIssues.errors.slice(0, 5).join(' | '))
  rec('sweep', 'every route renders content (no blank page / unexpected login redirect)', sweepIssues.empty.length === 0, sweepIssues.empty.slice(0, 8).join(' '))
  rec('sweep', 'every visible control has an accessible name', sweepIssues.unlabeled.length === 0, sweepIssues.unlabeled.slice(0, 8).join(' | '))
  rec('sweep', 'no tap target under 32px high on mobile/tablet', sweepIssues.tiny.length === 0, sweepIssues.tiny.slice(0, 8).join(' | '))
  const attendeeApi = SEEN.filter((u) => /event_partnerships|partnership|\/rpc\/admin_|organizer/i.test(u))
  rec('privacy', 'attendee pages never call partnership / admin_* / organizer endpoints', attendeeApi.length === 0, [...new Set(attendeeApi)].slice(0, 5).join(' '))

  // ===== S2. Event Detail =====
  await safe('detail', async () => {
    reset()
    let { page, ctx, errors } = await open(1440, 900, '/events/e-02')
    rec('detail', 'unregistered: Register button, no Enter Event Mode / Unregister, no section tabs', (await vis(page, 'button:has-text("Register Now"), button:has-text("Register")')) && !(await vis(page, 'button:has-text("Enter Event Mode")')) && !(await vis(page, 'button:has-text("Unregister")')) && (await page.locator('[role=tab]').count()) === 0)
    ctl.delay = 700
    await page.locator('button:has-text("Register Now"), button:has-text("Register")').first().click()
    rec('detail', 'Register shows an in-flight state', await page.waitForSelector('button:has-text("Registering")', { timeout: 3000 }).then(() => true).catch(() => false))
    await page.waitForSelector('button:has-text("Enter Event Mode")', { timeout: 6000 }).catch(() => {})
    ctl.delay = 0
    rec('detail', 'registered: POST sent, Enter Event Mode + Unregister + tabs shown', log.some((l) => l[0] === 'POST reg' && l[1] === 'e-02') && (await vis(page, 'button:has-text("Enter Event Mode")')) && (await vis(page, 'button:has-text("Unregister")')) && (await page.locator('[role=tab]').count()) >= 3)
    // calendar
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
    await page.locator('button:has-text("Add to Calendar")').first().click()
    const d1 = await dl
    let ics = ''
    if (d1) { const fs2 = require('fs'); const pth = await d1.path(); ics = fs2.readFileSync(pth, 'utf8') }
    rec('detail', 'Add to Calendar downloads a real .ics for the event', !!d1 && d1.suggestedFilename().endsWith('.ics') && /BEGIN:VCALENDAR/.test(ics) && /SUMMARY:Test Event 02/.test(ics), d1 ? d1.suggestedFilename() : 'no download')
    // share
    await page.locator('button[aria-label="Share event"]').first().click()
    await page.waitForTimeout(500)
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR')).catch(() => 'ERR')
    rec('detail', 'Share (no native sheet): copies the event link and says so', /\/events\/e-02$/.test(clip) && (await vis(page, 'text=Link copied')), clip.slice(0, 60))
    await page.evaluate(() => { Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared = d }, configurable: true }) })
    await page.locator('button[aria-label="Share event"]').first().click(); await page.waitForTimeout(300)
    const shared = await page.evaluate(() => window.__shared || null)
    rec('detail', 'Share (native sheet): hands the event title and link to navigator.share', !!shared && /\/events\/e-02$/.test(shared.url) && shared.title === 'Test Event 02', JSON.stringify(shared))
    // unregister failure then success
    ctl.failUnregister = true
    await page.locator('button:has-text("Unregister")').first().click()
    await page.waitForSelector('[role=alert]', { timeout: 5000 }).catch(() => {})
    rec('detail', 'Unregister failure: inline alert, stays registered, page intact', (await vis(page, '[role=alert]')) && (await vis(page, 'button:has-text("Enter Event Mode")')) && registered.has('e-02'))
    await page.locator('[role=alert] button:has-text("Dismiss")').click()
    ctl.failUnregister = false
    await page.locator('button:has-text("Unregister")').first().click()
    await page.waitForSelector('button:has-text("Register")', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)
    rec('detail', 'Unregister succeeds: DELETE sent, back to unregistered with no tabs', log.some((l) => l[0] === 'DELETE reg' && l[1] === 'e-02') && (await page.locator('[role=tab]').count()) === 0 && !registered.has('e-02'))
    // register failure
    ctl.failRegister = true
    await page.locator('button:has-text("Register Now"), button:has-text("Register")').first().click()
    await page.waitForSelector('[role=alert]', { timeout: 5000 }).catch(() => {})
    rec('detail', 'Register failure: inline alert, still unregistered, Register still offered', (await vis(page, '[role=alert]')) && !registered.has('e-02') && (await vis(page, 'button:has-text("Register")')))
    ctl.failRegister = false
    rec('detail', 'no console/page errors across registration flows', errors.length === 0, errors.slice(0, 2).join(' || '))
    await page.goto(BASE + '/events/e-past', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
    rec('detail', 'past, unregistered: "Past event" and no Register button', (await vis(page, 'text=Past event')) && !(await vis(page, 'button:has-text("Register Now")')))
    await page.goto(BASE + '/events/does-not-exist', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
    rec('detail', 'unknown event: "Event not found."', await vis(page, 'text=Event not found'))
    await ctx.close()
    // registered page: Enter Event Mode -> shell
    reset()
    ;({ page, ctx, errors } = await open(1440, 900, '/events/e-next'))
    await page.locator('button:has-text("Enter Event Mode")').first().click()
    await page.waitForURL('**/events/e-next/home', { timeout: 5000 }).catch(() => {})
    rec('detail', 'Enter Event Mode opens /events/e-next/home with the Event Mode sidebar', page.url().endsWith('/events/e-next/home') && (await vis(page, 'aside')))
    await ctx.close()
  })

  // ===== S3. Events list: URL params, persistence =====
  await safe('events', async () => {
    reset()
    const { page, ctx, errors } = await open(1440, 900, '/events')
    for (const q of ['?page=abc', '?page=-3', '?page=0', '?page=9999', '?page=2.5', '?page=2&q=Test&sort=date', '?tab=invitations', '?tab=nonsense', '?view=grid']) {
      errors.length = 0
      await page.goto(BASE + '/events' + q, { waitUntil: 'networkidle' }); await page.waitForTimeout(350)
      rec('events', `URL ${q} renders safely`, errors.length === 0 && (await ov(page)) === 0 && (await vis(page, 'h1')), errors[0] || '')
    }
    await page.goto(BASE + '/events', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
    const toggles = await page.locator('button[aria-pressed]').filter({ hasText: '' }).all()
    const listBtn = page.locator('button[aria-label="List view"]')
    await listBtn.click(); await page.waitForTimeout(250)
    const pressedBefore = await listBtn.getAttribute('aria-pressed')
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400)
    rec('events', 'grid/list choice persists across reload', pressedBefore === 'true' && (await page.locator('button[aria-label="List view"]').getAttribute('aria-pressed')) === 'true')
    await page.locator('button[aria-label="Grid view"]').click()
    const sizes = await page.locator('button[aria-label="Grid view"], button[aria-label="List view"]').evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))
    rec('events', 'view toggle buttons are at least 44x44', sizes.every(([a, b]) => a >= 44 && b >= 44), JSON.stringify(sizes))
    await ctx.close()
  })

  // ===== S4. Messages: the inbox must never be stuck loading =====
  await safe('messages', async () => {
    reset()
    const { page, ctx, errors } = await open(390, 844, '/messages')
    // slow inbox + a refresh that lands while the first load is in flight (the original infinite-spinner bug)
    await page.route('**/rpc/get_my_conversations', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.fallback() })
    await page.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('h1'); await page.waitForTimeout(350)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(4200)
    rec('messages', 'inbox leaves the loading state when a refresh overlaps the first load', (await page.locator('ul button').count()) === 2)
    await page.unroute('**/rpc/get_my_conversations')
    for (let i = 0; i < 3; i++) {
      await page.locator('ul button').first().click()
      await page.waitForSelector('[aria-label="Back to messages"]', { timeout: 5000 })
      await page.waitForTimeout(500)
      await page.click('[aria-label="Back to messages"]')
      await page.waitForSelector('ul button', { timeout: 5000 }).catch(() => {})
    }
    rec('messages', 'open chat -> back x3 always returns to the conversation list', (await page.locator('ul button').count()) === 2 && page.url().endsWith('/messages'))
    rec('messages', 'chat send button / back button are >= 44px', await (async () => { await page.locator('ul button').first().click(); await page.waitForSelector('textarea, input[type=text]', { timeout: 4000 }).catch(() => {}); return page.locator('[aria-label="Back to messages"]').evaluate((e) => e.getBoundingClientRect().width >= 44 && e.getBoundingClientRect().height >= 44) })())
    rec('messages', 'no console/page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  // ===== S5. Follow-ups, opportunities, notifications, profile, scan =====
  await safe('pages', async () => {
    reset()
    let { page, ctx, errors } = await open(1440, 900, '/follow-ups')
    await page.locator('button:has-text("Edit")').first().click()
    rec('followups', 'Edit opens a labelled dialog', await vis(page, '[role=dialog][aria-label="Edit follow-up"]'))
    await page.keyboard.press('Tab'); await page.locator('[role=dialog] button:has-text("Cancel")').click()
    rec('followups', 'Cancel closes the dialog', !(await vis(page, '[role=dialog]')))
    await page.locator('button:has-text("Mark complete")').first().click(); await page.waitForTimeout(400)
    rec('followups', 'Mark complete sends the update without errors', errors.length === 0)
    await page.goto(BASE + '/opportunities', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
    const views = ['Board', 'Grid', 'List']
    let okViews = true
    for (const v of views) { await page.click(`[role=tab]:has-text("${v}")`); await page.waitForTimeout(200); if ((await page.getAttribute(`[role=tab]:has-text("${v}")`, 'aria-selected')) !== 'true') okViews = false }
    rec('opportunities', 'Board / Grid / List views all switch', okViews)
    await page.click('button:has-text("New opportunity")')
    rec('opportunities', 'New opportunity opens the labelled form', (await vis(page, 'section[aria-label="New opportunity"] form')))
    await page.goto(BASE + '/notifications', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
    await page.click('[role=tab]:has-text("Unread")'); await page.waitForTimeout(200)
    const unreadRows = await page.locator('main ul li').count()
    rec('notifications', 'Unread filter shows only unread rows', unreadRows === 1, 'rows=' + unreadRows)
    await page.goto(BASE + '/profile', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
    await page.click('button[aria-label="Enlarge your QR code"]')
    rec('profile', 'QR enlarges in a dialog and closes', (await vis(page, '[role=dialog]')) && (await (async () => { await page.click('button[aria-label="Close"]'); return !(await vis(page, '[role=dialog]')) })()))
    await page.click('button:has-text("Edit profile")')
    rec('profile', 'Edit profile opens the form', await vis(page, 'input#full_name'))
    await page.goto(BASE + '/scan', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
    await page.click('button:has-text("Enter manually")')
    rec('scan', 'manual entry step opens (camera itself NOT exercised here)', await vis(page, 'input#manual'))
    rec('pages', 'no console/page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  // ===== S6. Event Mode: sidebar rail/open/close (tablet), bottom nav + More drawer (phone), Home back link, tiles =====
  await safe('eventmode', async () => {
    reset()
    let { page, ctx } = await open(820, 1000, '/events/e-next/home')
    const wd = () => page.evaluate(() => Math.round(document.querySelector('aside').getBoundingClientRect().width))
    const left = () => page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().left))
    rec('eventmode', 'tablet: icon rail by default', (await wd()) < 100)
    await page.click('aside button[aria-label="Expand sidebar"]'); await page.waitForTimeout(400)
    rec('eventmode', 'tablet: open sidebar pushes content (no overlap)', (await wd()) === 256 && (await left()) >= 256)
    await page.click('aside button[aria-label="Collapse sidebar"]'); await page.waitForTimeout(400)
    rec('eventmode', 'tablet: close returns to icons only', (await wd()) < 100)
    await ctx.close()
    ;({ page, ctx } = await open(390, 844, '/events/e-next/home'))
    const back = page.locator('a[aria-label], button[aria-label]').filter({ hasText: '' })
    const backLink = page.locator('a[href="/events/e-next"]:visible, button[aria-label*="Back" i]:visible, a[aria-label*="Back" i]:visible').first()
    rec('eventmode', 'Home (mobile): visible back control to Event Detail, >= 44px', (await backLink.isVisible().catch(() => false)) && (await backLink.evaluate((e) => e.getBoundingClientRect().width >= 44 && e.getBoundingClientRect().height >= 44).catch(() => false)))
    await backLink.click(); await page.waitForTimeout(700)
    rec('eventmode', 'Home back control goes to the Event Detail page', /\/events\/e-next$/.test(page.url()), page.url())
    await page.goto(BASE + '/events/e-next/agenda', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
    rec('eventmode', 'bottom nav visible on phone', await vis(page, 'nav[aria-label="Event navigation"]'))
    await page.click('button[aria-label="More menu"]'); await page.waitForTimeout(400)
    rec('eventmode', 'More drawer opens with profile, schedule, notifications, sign out', (await vis(page, '[role=dialog] >> text=My Schedule')) && (await vis(page, '[role=dialog] >> text=Notifications')) && (await vis(page, '[role=dialog] >> text=Sign out')))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    rec('eventmode', 'Escape closes the More drawer', !(await vis(page, '[role=dialog][aria-label="More menu"]')))
    await page.goto(BASE + '/events/e-next/home', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
    const tiles = await page.locator('main a[href^="/events/e-next/"], main [aria-disabled="true"]').count()
    const dead = await page.evaluate(() => [...document.querySelectorAll('main a')].filter((a) => !a.getAttribute('href') || a.getAttribute('href') === '#').length)
    rec('eventmode', 'Home tiles: every tile is a real link or visibly disabled; none is a dead "#" link', tiles >= 6 && dead === 0, `tiles=${tiles} dead=${dead}`)
    // each internal tile link resolves to a rendered page (no 404/blank)
    const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('main a[href^="/"]')].map((a) => a.getAttribute('href')))])
    let bad = []
    for (const h of hrefs.slice(0, 14)) { await page.goto(BASE + h, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(250); const t = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.trim().length); if (t < 20 || /404|Page not found/i.test(await page.title())) bad.push(h) }
    rec('eventmode', 'every Home tile destination renders a page', bad.length === 0, bad.join(' '))
    await ctx.close()
  })

  // ===== S7. Keyboard access and focus visibility =====
  await safe('a11y', async () => {
    reset()
    for (const [w, r] of [[1440, '/dashboard'], [1440, '/events'], [1440, '/events/e-next'], [1440, '/follow-ups'], [390, '/dashboard'], [390, '/events/e-next/home']]) {
      const { page, ctx } = await open(w, 900, r)
      let seen = 0, noRing = []
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab')
        const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20), ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'), shown: b.width > 0 && b.height > 0 } })
        if (f && f.shown) { seen++; if (!f.ring) noRing.push(f.tag + ':' + f.name) }
      }
      rec('a11y', `keyboard: Tab reaches controls with a visible focus indicator (${r} @${w})`, seen >= 8 && noRing.length === 0, `focused ${seen}; no ring: ${noRing.slice(0, 4).join(', ') || 'none'}`)
      await ctx.close()
    }
  })

  // ===== S8. Signed-out and other-role access =====
  await safe('auth', async () => {
    reset()
    for (const r of ['/dashboard', '/events', '/events/e-next/home', '/follow-ups', '/messages']) {
      const { page, ctx } = await open(1440, 900, r, { signedOut: true })
      rec('auth', `signed out: ${r} -> /login`, /\/login/.test(page.url()), page.url().replace(BASE, ''))
      await ctx.close()
    }
    for (const [type, status] of [['organizer', 'active'], ['sponsor', 'active'], ['vendor', 'active'], ['platform_admin', 'active'], ['attendee', 'suspended'], ['attendee', 'pending_approval']]) {
      reset(); ctl.accountType = type; ctl.accountStatus = status
      const { page, ctx } = await open(1440, 900, '/dashboard')
      const url = page.url().replace(BASE, '')
      const attendeeShell = await vis(page, 'aside nav a[href="/follow-ups"]')
      rec('auth', `${type}/${status}: cannot open the attendee dashboard`, url !== '/dashboard' && !attendeeShell, 'landed ' + url)
      await ctx.close()
    }
    reset()
  })

  await browser.close()
  console.log('TOTAL ' + results.length + '  PASS ' + results.filter((r) => r.pass).length + '  FAIL ' + fails)
  if (fails) process.exitCode = 1
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
