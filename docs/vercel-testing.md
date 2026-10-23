# Vercel testing project: rally-dev

A separate Vercel project used only for testing the app against the **rally-dev** Supabase
project. It is not the live site and must never point at production.

| | |
| --- | --- |
| Vercel project | `rally-dev` (team `braemma1s-projects`) |
| Repository | `BraEmma1/Rally` |
| Branch it tracks | `development` |
| Backend | Supabase `rally-dev`, project ref `pvmwouvewphbyfiblksz` |
| Stable URL | https://rally-dev-ivory.vercel.app (also `rally-dev-braemma1s-projects.vercel.app`) |
| Build | Vite preset: `npm run build` (`tsc -b && vite build`) into `dist` |

## Environment variables

Exactly the two the code reads (`src/lib/supabase.ts`), set for Production, Preview and
Development in the Vercel project:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://pvmwouvewphbyfiblksz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the rally-dev **anon** (public) key, from Supabase: Project Settings, API |

Anything prefixed `VITE_` is bundled into the browser. **Never** put a service-role key in
this project. The Edge Function secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, ...)
live in Supabase, not here. No value above is a secret and none is committed.

## Direct links and refresh

`vercel.json` rewrites every path that is not a built file to `/index.html`, so opening or
refreshing `/events/<id>`, `/events/<id>/home`, `/auth/callback` or `/reset-password` loads the
app instead of a 404. (`public/_redirects` is Netlify's format and is ignored by Vercel.)
Built files under `/assets` are matched first and are not rewritten.

## Supabase Auth redirect URLs (rally-dev only)

In the rally-dev Supabase project: Authentication, URL Configuration. **Add** these to
"Redirect URLs" and keep every entry already there (production URLs included):

```
https://rally-dev-ivory.vercel.app/**
https://rally-dev-braemma1s-projects.vercel.app/**
https://rally-*-braemma1s-projects.vercel.app/**
```

The code redirects to `${origin}/auth/callback` (sign-up confirmation, OAuth, with an optional
`?invitation=` query) and `${origin}/reset-password`. The `/**` form covers both and the query
string. The third line covers per-deployment and per-branch preview URLs.

"Site URL" decides where confirmation emails link when no redirect is given; set it to
`https://rally-dev-ivory.vercel.app` only if this project is the one place rally-dev is used,
otherwise leave it and rely on the redirect list.

Google and LinkedIn sign-in additionally need the provider consoles to allow the Supabase
callback (`https://pvmwouvewphbyfiblksz.supabase.co/auth/v1/callback`), which is unchanged.

## Deployment Protection

New Vercel projects have Vercel Authentication on, so the site is private to the Vercel team.
Testers outside the team, and Supabase email links opened in a browser that is not signed in to
Vercel, will be asked to log in to Vercel first. Turn it off under Settings, Deployment
Protection, only if the test site should be public (it holds rally-dev test data and open
sign-up).

## Production branch

`development` should be this project's Production Branch so the stable URL follows it
(Settings, Environments, Production, Branch Tracking). Until then, pushes to `development` build
as Preview deployments of the same project and use the same environment variables.

## Redeploy

Pushes to the tracked branch deploy automatically. To redeploy a build by hand from the
repository root: `npx vercel deploy --prod --scope braemma1s-projects` (this project only).
