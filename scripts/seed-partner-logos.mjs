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

const ORGANIZER_ID = '7a4e9c12-5b3f-4d8e-9a6c-1f2b3c4d5e6f'

const { error: signInError } = await supabase.auth.signInWithPassword({
  email: 'seed.partners@rally.test',
  password: 'sample-partners-2026',
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
