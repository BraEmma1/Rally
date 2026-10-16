# Rally

Rally turns event attendance into tracked business relationships. A professional scans a QR code at a conference, and Rally carries that contact forward through notes, follow-ups and opportunities, from first handshake to closed outcome.

## Local setup

**Requirements:** Node.js 22.x (the version the project is built on) and npm.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file from the template:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell: `Copy-Item .env.example .env`

3. Edit `.env` and set the two variables, found in the Supabase dashboard under **Project Settings → API**:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | The public anon / publishable key |

   Use only the public anon key. Never put a service-role key in a `VITE_` variable, because it would be bundled into the browser.

4. Start the dev server at http://localhost:5173:

   ```bash
   npm run dev
   ```

   Vite reads `.env` only at startup, so restart the server after changing it. If the page is blank and the console says `Missing Supabase environment variables`, `.env` is missing or incomplete.

Other commands: `npm run build` (type check and production build) and `npm run preview` (serve the build).

## Warning: local development uses a real Supabase project

The app talks to whichever Supabase project `.env` points at. Rally currently has no separate staging environment, so if you use the production project's URL and key, **local development reads and writes live data**. Signing up, creating events or editing connections locally changes real records.

Prefer a separate Supabase project for development. Never commit `.env` or any credentials. `.env` is git-ignored, and only `.env.example` is tracked.
