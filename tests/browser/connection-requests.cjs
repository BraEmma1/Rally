// Connection requests (send / accept / decline / cancel) from the Event Mode directory, the Connect
// sheets, the Requests tab, the Connections page and notifications, plus the fallback when the
// backend feature is not installed.
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
const ctl = { failSend: '', failRequestsList: false,  delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false, failUnregister: false, failRegisterOnlyAfterStatus: false, accountType: 'attendee', accountStatus: 'active' }
let registered, invitations, regCounts, log, reqState
function reset() {
  registered = new Set(['e-next'])
  invitations = ['e-02', 'e-04', 'e-06'].map((eid, i) => ({ id: `inv-${i}`, event_id: eid, invited_user_id: UID, invited_by: INVITER, status: 'Pending', created_at: `2026-10-0${i + 1}`, responded_at: null }))
  regCounts = Object.fromEntries(events.map((e) => [e.id, 7]))
  log = []
  reqState = [{ id: 'rq-in-1', status: 'pending', direction: 'incoming', event_id: 'e-next', event_name: 'Africa Tech & Innovation Summit 2027', created_at: new Date().toISOString(), other_user_id: 'u2', other_full_name: 'Linda Ncube', other_job_title: 'Program Director', other_company: 'Pan-African Policy Institute', other_photo_url: '' }]
  dirRows.forEach((d, i) => { d.already_connected = i === 1 || i === 4 })
  Object.assign(ctl, { failSend: '', failRequestsList: false, delay: 0, failAcceptPatch: false, failDeclinePatch: false, failRegister: false, failUnregister: false, accountType: 'attendee', accountStatus: 'active' })
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
    if (m === 'POST' && url.includes('/rpc/')) {
      const fn = url.split('/rpc/')[1].split('?')[0]
      const b = JSON.parse(req.postData() || '{}')
      if (fn === 'my_connection_requests') {
        if (ctl.failRequestsList) return json(404, err('PGRST202', 'Could not find the function public.my_connection_requests'))
        return json(200, reqState.filter((r) => r.status === 'pending').map(({ status, ...r }) => r))
      }
      if (fn === 'send_connection_request') {
        if (ctl.delay) await sleep(ctl.delay)
        if (ctl.failSend) { log.push(['send FAILED']); return json(400, err('P0001', ctl.failSend)) }
        const i = dirRows.findIndex((d) => d.user_id === b.target_user_id)
        reqState.push({ id: 'rq-out-' + (reqState.length + 1), status: 'pending', direction: 'outgoing', event_id: b.target_event_id, event_name: 'Africa Tech & Innovation Summit 2027', created_at: new Date().toISOString(), other_user_id: b.target_user_id, other_full_name: names[i], other_job_title: jobs[i], other_company: cos[i], other_photo_url: '' })
        log.push(['send', b.target_event_id, b.target_user_id])
        return json(200, 'new-request-id')
      }
      if (fn === 'respond_to_connection_request') {
        const r = reqState.find((x) => x.id === b.request_id)
        r.status = b.accept ? 'accepted' : 'declined'
        if (b.accept) { const i = dirRows.findIndex((d) => d.user_id === r.other_user_id); if (i >= 0) dirRows[i].already_connected = true }
        log.push(['respond', b.request_id, b.accept])
        return json(200, b.accept ? 'accepted' : 'declined')
      }
      if (fn === 'cancel_connection_request') {
        reqState.find((x) => x.id === b.request_id).status = 'cancelled'
        log.push(['cancel', b.request_id])
        return route.fulfill({ status: 204, headers: cors, body: '' })
      }
      return json(200, rows(url))
    }
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
  const open = async (w, h, url) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|randomuser|net::/.test(m.text())) errors.push('console: ' + m.text().slice(0, 140)) })
    await ctx.addInitScript(([uid]) => { const session = { access_token: btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: 4102444800, role: 'authenticated' })) + '.fake', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'f@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }; localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)) }, [UID])
    await ctx.addInitScript(() => {
      window.__cam = 0
      const md = navigator.mediaDevices || {}
      md.getUserMedia = async () => { window.__cam++; throw new DOMException('denied', 'NotAllowedError') }
      Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true })
    })
    await wire(ctx)
    await page.goto(BASE + url, { waitUntil: 'networkidle' })
    await page.waitForSelector('h1, h2', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(500)
    return { page, ctx, errors }
  }
  const cam = (p) => p.evaluate(() => window.__cam)
  const vis = (p, sel) => p.locator(sel).first().isVisible().catch(() => false)
  const ov = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const card = (p, name) => p.locator('main li').filter({ hasText: name })
  const safe = async (g, fn) => { try { await fn() } catch (e) { rec(g, 'test crashed', false, String(e.message).split('\n')[0].slice(0, 200)) } }
  const NET = '/events/e-next/network'

  for (const [w, tag] of [[1440, 'desktop'], [390, 'phone']]) {
    await safe('send-' + tag, async () => {
      reset()
      const { page, ctx, errors } = await open(w, 900, NET)
      rec('send-' + tag, 'directory loads with a Requests tab showing the open count', (await vis(page, '[role=tab]:has-text("Requests (1)")')))
      await card(page, 'Maya Chen').locator('button:has-text("Connect")').click()
      rec('send-' + tag, 'Connect opens a choice: Scan QR code or Send a request', (await vis(page, '[role=dialog][aria-label="Connect with Maya Chen"]')) && (await vis(page, '[role=dialog] button:has-text("Scan QR code")')) && (await vis(page, '[role=dialog] button:has-text("Send a request")')))
      const sizes = await page.locator('[role=dialog] button:has-text("Scan QR code"), [role=dialog] button:has-text("Send a request")').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
      rec('send-' + tag, 'both options are at least 44px tall', sizes.length === 2 && sizes.every((h) => h >= 44), JSON.stringify(sizes))

      ctl.failSend = 'You are already connected with this person'
      await page.click('[role=dialog] button:has-text("Send a request")')
      await page.waitForSelector('[role=dialog] [role=alert]', { timeout: 4000 }).catch(() => {})
      rec('send-' + tag, 'a refused request shows the reason inside the sheet and keeps it open', (await vis(page, '[role=dialog] [role=alert]:has-text("already connected")')) && !log.some((l) => l[0] === 'send'))
      ctl.failSend = ''

      ctl.delay = 600
      await page.click('[role=dialog] button:has-text("Send a request")')
      rec('send-' + tag, 'Send a request shows an in-flight state', await page.waitForSelector('[role=dialog] button:has-text("Sending")', { timeout: 3000 }).then(() => true).catch(() => false))
      await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 6000 }).catch(() => {})
      ctl.delay = 0
      await page.waitForTimeout(500)
      rec('send-' + tag, 'the request is sent for this event and person', log.some((l) => l[0] === 'send' && l[1] === 'e-next' && l[2] === 'u3'), JSON.stringify(log))
      rec('send-' + tag, 'the card now says Request sent with a Cancel option (no second Connect)', (await card(page, 'Maya Chen').locator('text=Request sent').count()) === 1 && (await card(page, 'Maya Chen').locator('button:has-text("Cancel")').count()) === 1 && (await card(page, 'Maya Chen').locator('button:has-text("Connect")').count()) === 0)
      rec('send-' + tag, 'Requests tab count went 1 -> 2', await vis(page, '[role=tab]:has-text("Requests (2)")'))

      await card(page, 'Maya Chen').locator('button:has-text("Cancel")').click()
      await page.waitForTimeout(700)
      rec('send-' + tag, 'Cancel withdraws the request and Connect returns', log.some((l) => l[0] === 'cancel') && (await card(page, 'Maya Chen').locator('button:has-text("Connect")').count()) === 1)
      rec('send-' + tag, `no overflow, no errors @${w}`, (await ov(page)) === 0 && errors.length === 0, errors[0] || '')
      await ctx.close()
    })
  }

  await safe('camera', async () => {
    reset()
    const { page, ctx } = await open(390, 900, NET)
    await page.waitForTimeout(400)
    rec('camera', 'the directory page does not touch the camera', (await cam(page)) === 0)
    await card(page, 'Maya Chen').locator('button:has-text("Connect")').click()
    await page.waitForTimeout(700)
    rec('camera', 'tapping Connect shows only the choice and does NOT start the camera', (await vis(page, '[role=dialog][aria-label="Connect with Maya Chen"]')) && (await cam(page)) === 0, 'camera requests: ' + (await cam(page)))
    await page.click('[role=dialog] button:has-text("Send a request")')
    await page.waitForTimeout(900)
    rec('camera', 'Send a request does not start the camera either, and sends the request', (await cam(page)) === 0 && log.some((l) => l[0] === 'send'))
    await ctx.close()
  })

  await safe('scan', async () => {
    reset()
    const { page, ctx } = await open(390, 900, NET)
    await card(page, 'Maya Chen').locator('button:has-text("Connect")').click()
    await page.waitForTimeout(400)
    rec('scan', 'before choosing, the camera has not been asked for', (await cam(page)) === 0)
    await page.click('[role=dialog] button:has-text("Scan QR code")')
    await page.waitForTimeout(1200)
    rec('scan', 'choosing Scan QR code closes the choice and starts the camera scanner (no request sent)', !(await vis(page, '[role=dialog][aria-label="Connect with Maya Chen"]')) && (await cam(page)) >= 1 && !log.some((l) => l[0] === 'send'), 'camera requests: ' + (await cam(page)))
    rec('scan', 'the scanner screen stays up: it is not replaced by a profile lookup or an error', (await vis(page, 'h2:has-text("Scan QR Code")')) && !(await vis(page, "text=Couldn't connect")) && !(await vis(page, 'text=Loading profile')))
    await ctx.close()
  })

  await safe('incoming', async () => {
    reset()
    let { page, ctx, errors } = await open(1440, 900, NET)
    rec('incoming', 'a person who sent you a request shows Accept and Decline on their card', (await card(page, 'Linda Ncube').locator('button:has-text("Accept")').count()) === 1 && (await card(page, 'Linda Ncube').locator('button:has-text("Decline")').count()) === 1)
    await card(page, 'Linda Ncube').locator('button:has-text("Accept")').click()
    await page.waitForTimeout(700)
    rec('incoming', 'Accept sends the answer and the person shows as Connected', log.some((l) => l[0] === 'respond' && l[2] === true) && (await card(page, 'Linda Ncube').locator('text=Connected').count()) >= 1)
    rec('incoming', 'the Requests tab is empty again', await vis(page, '[role=tab]:has-text("Requests (0)")'))
    await ctx.close()

    reset()
    ;({ page, ctx, errors } = await open(1440, 900, NET))
    await page.click('[role=tab]:has-text("Requests")')
    rec('incoming', 'Requests tab lists "Requests for you" with the person and event', (await vis(page, 'section[aria-label="Requests sent to you"] >> text=Linda Ncube')) && (await vis(page, 'text=Africa Tech & Innovation Summit 2027')))
    await page.locator('section[aria-label="Requests sent to you"] button:has-text("Decline")').click()
    await page.waitForTimeout(700)
    rec('incoming', 'Decline from the Requests tab sends accept=false and clears the row', log.some((l) => l[0] === 'respond' && l[2] === false) && (await page.locator('section[aria-label="Requests sent to you"]').count()) === 0)
    rec('incoming', 'no console/page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('global-sheet', async () => {
    reset()
    const { page, ctx } = await open(390, 844, '/events/e-next/agenda')
    await page.click('nav[aria-label="Event navigation"] button[aria-label="Connect"]')
    rec('global-sheet', 'the main Connect sheet offers Scan QR Code, Send a request and My Event Pass', (await vis(page, '[role=dialog][aria-label="Connect"] >> text=Scan QR Code')) && (await vis(page, '[role=dialog][aria-label="Connect"] >> text=Send a request')) && (await vis(page, '[role=dialog][aria-label="Connect"] >> text=My Event Pass')))
    await page.click('[role=dialog][aria-label="Connect"] button:has-text("Send a request")')
    await page.waitForURL('**/events/e-next/network', { timeout: 5000 }).catch(() => {})
    rec('global-sheet', 'Send a request opens the attendee directory to pick someone', page.url().endsWith('/events/e-next/network'))
    await ctx.close()
  })

  await safe('connections-page', async () => {
    reset()
    const { page, ctx, errors } = await open(390, 900, '/connections?view=requests')
    rec('connections-page', 'the Connections page shows the request and Accept / Decline', (await vis(page, 'section[aria-label="Connection requests"] >> text=Linda Ncube')) && (await vis(page, 'section[aria-label="Connection requests"] button:has-text("Accept")')))
    await page.click('section[aria-label="Connection requests"] button:has-text("Accept")')
    await page.waitForTimeout(800)
    rec('connections-page', 'Accept there sends the answer and the section goes away', log.some((l) => l[0] === 'respond' && l[2] === true) && (await page.locator('section[aria-label="Connection requests"]').count()) === 0)
    rec('connections-page', 'no overflow, no errors @390', (await ov(page)) === 0 && errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('notifications', async () => {
    reset()
    notifs.push({ id: 'n-req', user_id: UID, type: 'connection_request', title: 'Connection request', message: 'Linda Ncube wants to connect with you at Africa Tech & Innovation Summit 2027.', link: '/connections?view=requests', read: false, created_at: new Date().toISOString() })
    notifs.push({ id: 'n-acc', user_id: UID, type: 'connection_accepted', title: 'Request accepted', message: 'Maya Chen accepted your connection request.', link: '/connections', read: false, created_at: new Date().toISOString() })
    const { page, ctx } = await open(1440, 900, '/notifications')
    rec('notifications', 'request notifications show their own labels and link to the right place', (await vis(page, 'main >> text=Connection request')) && (await vis(page, 'main >> text=Request accepted')) && (await page.locator('a[href="/connections?view=requests"]').count()) >= 1)
    await ctx.close()
  })

  await safe('fallback', async () => {
    reset(); ctl.failRequestsList = true
    const { page, ctx, errors } = await open(1440, 900, NET)
    rec('fallback', 'without the backend feature the directory still loads and Connect still works', (await page.locator('main li').count()) >= 5 && !(await vis(page, '[role=alert]')))
    await card(page, 'Maya Chen').locator('button:has-text("Connect")').click()
    rec('fallback', 'the choice sheet still opens', await vis(page, '[role=dialog][aria-label="Connect with Maya Chen"]'))
    rec('fallback', 'no console/page errors', errors.length === 0, errors[0] || '')
    await ctx.close()
  })

  await safe('narrow', async () => {
    reset()
    const { page, ctx } = await open(320, 800, NET)
    await page.click('[role=tab]:has-text("Requests")')
    rec('narrow', 'Requests tab has no horizontal overflow at 320px', (await ov(page)) === 0)
    await ctx.close()
  })

  await browser.close()
  console.log('TOTAL ' + results.length + '  PASS ' + results.filter((r) => r.pass).length + '  FAIL ' + fails)
  if (fails) process.exitCode = 1
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
