# TradeJournal

A fast, permanent trading journal for forex, stocks, crypto, futures and
indices — log trades, track performance by week, month, quarter and year.

Built with Tailwind CSS (a real compiled/purged build, not the CDN
script), vanilla JS, no framework. Optional cloud accounts via Supabase —
works fully without one too.

## Project structure

```
index.html           — page structure, references output.css and app.js
app.js                — all application logic
src/input.css          — Tailwind source (base styles + component layer)
tailwind.config.js     — design tokens (colors map to CSS custom
                          properties in src/input.css, so light/dark
                          theming works independently of Tailwind's own
                          dark: variant)
manifest.json, sw.js, icon-*.png, screenshots/ — PWA assets
privacy.html            — required for Play Store submission
supabase_schema.sql     — run once in Supabase to enable optional accounts
package.json             — build script (Tailwind compile + asset copy)
vercel.json               — tells Vercel how to build this
dist/                      — build output (generated, not committed)
```

## Local development

```
npm install
npm run dev     # watches src/input.css and rebuilds dist/output.css
```

## Deploying

Push this repo to GitHub, then in Vercel: **Add New Project** → **Import
Git Repository** → select this repo → **Deploy**. `vercel.json` already
tells Vercel to run `npm run build` and serve the `dist` folder — no
manual configuration needed.

Once live on HTTPS, open the URL in Chrome on Android for the native
"Install app" prompt, or use [PWABuilder](https://www.pwabuilder.com) to
package it as a signed `.apk`/`.aab` for the Play Store.

## Optional cloud accounts (multi-user, cross-device sync)

By default the app runs in guest mode — all data stays on-device via
IndexedDB, no account needed. To let users create their own account and
sync trades across devices:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase SQL Editor, run everything in `supabase_schema.sql`
   (sets up `trades` and `user_settings` tables with row-level security,
   so each user can only ever see their own data).
3. In Supabase → Project Settings → API, copy your **Project URL** and
   **anon public key** (the anon key is safe to expose client-side by
   design — it has no elevated privileges).
4. Open `app.js` and fill in:
   ```js
   var SUPABASE_URL = "https://your-project.supabase.co";
   var SUPABASE_ANON_KEY = "your-anon-key";
   ```
5. Rebuild (`npm run build`) and redeploy.

Leave both values blank to keep the app local-only with no account
system at all — this is the default shipped state.

## Data & privacy

Guest mode: everything is stored locally on-device (IndexedDB), nothing
is ever transmitted anywhere. With an optional account: trade data is
stored in your own Supabase project, isolated per-user via row-level
security. See `privacy.html` for the full policy — update the contact
details there before publishing.
