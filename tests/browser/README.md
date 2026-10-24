# Browser suites (stubbed API)

Automated browser checks for the attendee experience. They drive a real Chrome
against the app, with **every Supabase request intercepted and answered from
fixtures** in each suite file.

- No real project is contacted, no database state changes, and **no credentials
  are used or stored**. The "signed-in" session is a fabricated token for a fake
  user id, and the stub treats it as valid.
- These are **mocked** checks. They prove the UI behaves correctly against the
  API contract the fixtures encode. They do not prove the backend (RLS, RPCs)
  behaves that way, so they are not a substitute for a signed-in check against a
  development project.
- Not covered: camera / QR scanning, Safari / WebKit, real devices.

## Run

```bash
npm install
npm run test:browser
```

Needs Google Chrome (or set `CHROME_PATH` to a Chrome / Chromium / Edge binary).
`BASE_URL=http://localhost:5173 npm run test:browser` tests a server you already
started (it must have been started with `VITE_SUPABASE_URL=http://localhost:54321`,
otherwise the stub will not see the traffic). `SHOTS_DIR` sets where screenshots go.

## Suites

| File | Covers |
| --- | --- |
| `events-and-invitations.cjs` | Events search / filter / sort / pagination / counts; invitation Accept and Decline including in-flight, failure and partial success |
| `event-mode-shell.cjs` | Event Mode sidebar, bottom nav, More drawer, tablet layout, signed-out and wrong-account access |
| `dashboard-and-event-mode-pages.cjs` | Dashboard, Event Home (phone), Agenda and Schedule, Speakers, Exhibitors, Directory |
| `connection-requests.cjs` | Connection requests: Connect choice (scan or send a request), send / accept / decline / cancel, the Requests tab, Connections page, notifications, and the fallback when the backend feature is missing |
| `attendee-sweep.cjs` | Every attendee route at 320 / 390 / 820 / 1440px, Event Detail flows, Messages regression, Follow-ups, Opportunities, Notifications, Profile, Scan, keyboard focus, role access |

Each suite prints `PASS` / `FAIL` lines; `run.cjs` totals them and exits non-zero
on any failure or crash.

## Writing a check

Prefer asserting on `aria-current`, roles and labels over class names: an earlier
version matched `bg-primary-600` in `className` and broke when a hover style
containing that substring was added.
