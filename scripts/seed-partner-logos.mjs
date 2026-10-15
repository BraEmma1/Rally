// One-off: upload the three generated sample-partner logos to the public
// event-assets bucket so event_partnerships.logo_url can hold a real https
// URL, exactly as a normal in-app upload would produce. Signs in as the
// dedicated seed user because the bucket's INSERT policy checks auth.uid().
// Not part of the app.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readFileSync('.env', 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim()
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim()

const supabase = createClient(url, key)

// Credentials come from the environment, never from this file. A login
// committed here is a published credential for whichever database .env points
// at — which is how audit finding R-03 happened.
//
//   SEED_USER_ID=<uuid> SEED_EMAIL=<address> SEED_PASSWORD=<password> \
//     node scripts/seed-partner-logos.mjs
//
// Run it against a non-production project.
const ORGANIZER_ID = process.env.SEED_USER_ID
const SEED_EMAIL = process.env.SEED_EMAIL
const SEED_PASSWORD = process.env.SEED_PASSWORD

if (!ORGANIZER_ID || !SEED_EMAIL || !SEED_PASSWORD) {
  console.error(
    'Set SEED_USER_ID, SEED_EMAIL and SEED_PASSWORD in the environment before running this script.'
  )
  process.exit(1)
}

const { error: signInError } = await supabase.auth.signInWithPassword({
  email: SEED_EMAIL,
  password: SEED_PASSWORD,
})
if (signInError) {
  console.error('sign-in failed:', signInError.message)
  process.exit(1)
}

const logos = [
  ['partner-techflow.webp', 'image/webp'],
  ['partner-summitbank.webp', 'image/webp'],
  ['partner-lumenmedia.webp', 'image/webp'],
]

for (const [file, contentType] of logos) {
  const path = `${ORGANIZER_ID}/partners/sample-${file}`
  const body = readFileSync(`public/${file}`)
  const { error } = await supabase.storage
    .from('event-assets')
    .upload(path, body, { contentType, upsert: true })
  if (error) {
    console.error(file, error.message)
    process.exit(1)
  }
  const { data } = supabase.storage.from('event-assets').getPublicUrl(path)
  console.log(file, data.publicUrl)
}
