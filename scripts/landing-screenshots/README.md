# Landing page assets

Everything under `public/landing/` is produced or sourced here. Each raster carries its origin
in its own metadata (`impeccable embed-prompt --read <file>` shows it).

## Product screens (`public/landing/screens/`)

Real Rally screens, captured from the running app with **fictional sample data**:

```bash
node scripts/landing-screenshots/capture.cjs            # all shots, WebP
node scripts/landing-screenshots/capture.cjs --raw      # full-viewport PNGs to the temp dir, for review
node scripts/landing-screenshots/capture.cjs --only=organizer-checkin,organizer-team
```

The script starts Vite with `VITE_SUPABASE_URL` pointing at a port nothing listens on and
answers every request inside the browser from `fixtures.cjs`, the same method as
`tests/browser`. No Supabase project is contacted, no credential is used and no database is
written. The signed-in session is a fabricated token that only this stub accepts.

Avatars are left empty so the app shows initials. Desktop shots are 1440×900 at 1.5×; phone
shots are 390×844 at 2×. Phone variants (`*-phone.webp`) are served below 640px so the product
stays legible on small screens.

After re-capturing, re-embed provenance (capture writes plain WebP).

## Social card (`public/landing/og-card.jpg`)

```bash
node scripts/landing-screenshots/og-card.cjs http://localhost:5173   # needs a running dev server
```

Rendered from the landing hero at 1200×630 with the QR hidden (a static image must not carry
the dev server's origin). `og:image` in `index.html` is a relative URL; set it to an absolute
URL once the production domain is fixed, since some platforms ignore relative ones.

## Photography (`public/landing/photos/`)

All photos are by Pavel Danilyuk on Pexels, under the [Pexels License](https://www.pexels.com/license/):
free to use and modify, attribution not required. The licence forbids implying that the people
pictured endorse the product, so the page never names them, quotes them or attaches a Rally
card to anyone in a photo.

| File | Pexels photo | Used for |
| --- | --- | --- |
| `badges-conversation-*` | [8761634](https://www.pexels.com/photo/8761634/) | Hero |
| `speaker-session-*` | [8761620](https://www.pexels.com/photo/8761620/) | Organizer section |
| `qr-badge-*` | [8761633](https://www.pexels.com/photo/8761633/) | Attendee section |
| `networking-smile-*` | [8761642](https://www.pexels.com/photo/8761642/) | Closing section; sample event banner |
| `room-mingling-1800` | [8761555](https://www.pexels.com/photo/8761555/) | Sample event banner inside the screenshots |

Each is stored at 1800px and (where the page uses it) 900px, as WebP from the Pexels CDN.
