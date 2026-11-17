// Renders public/landing/og-card.jpg (1200x630, the social sharing image) from the real
// landing hero. Run against a dev server that is already serving the app:
//
//   node scripts/landing-screenshots/og-card.cjs http://localhost:5173
const path = require('path')
const { launchBrowser } = require('../../tests/browser/launch.cjs')

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = path.resolve(__dirname, '../../public/landing/og-card.jpg')

;(async () => {
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.addStyleTag({
    content: `
      .rl-nav, .rl-hero .rl-lede, .rl-hero__fine, .rl-turn__button, .rl-rise,
      main > section:not(.rl-hero), .rl-foot { display: none !important; }
      /* the live QR encodes the serving origin; a static image must not bake in localhost */
      .rl-person__qr { visibility: hidden !important; }
      .rl-hero { padding-top: 56px !important; }
      .rl-hero__grid { grid-template-columns: 1.05fr 1fr !important; }
      .rl-h1 { font-size: 76px !important; }
      .rl-hand { max-width: 470px !important; margin-bottom: 0 !important; }
    `,
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 86 })
  await browser.close()
  console.log('Wrote ' + OUT)
})().catch((e) => { console.error(e); process.exit(1) })
