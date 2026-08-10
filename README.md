# TradeJournal

A fast, permanent trading journal for forex, stocks, crypto, futures and
indices — log trades, track performance by week, month, quarter and year.

## Files

- `index.html` — the entire app (HTML, CSS, and JavaScript, all in one
  file). **This is the only file you ever need to edit.**
- `manifest.json` — PWA manifest (name, icons, install behavior)
- `sw.js` — service worker (offline app-shell caching)
- `icon-192.png`, `icon-512.png` — app icons
- `privacy.html` — required for Play Store submission
- `supabase_schema.sql` — reference copy of the database setup (already
  run once in your Supabase project — you don't need to run it again
  unless you're setting up a fresh project)

No build step. No `npm install`. Open `index.html` in a browser and it
just works, exactly as-is.

## Editing

Open `index.html` in any text editor. The `<style>` block near the top
holds all the CSS, the `<script>` block near the bottom holds all the
app logic. Save, refresh your browser, done.

## Cloud accounts (already enabled)

This copy has real Supabase credentials wired in (`SUPABASE_URL` and
`SUPABASE_ANON_KEY` near the top of the `<script>` block), so the
Settings → Account section shows a real email/password sign-up form.
Leave those two values blank instead to run in local-only guest mode
with no account system.

## Deploying

Push these 6 files to GitHub, then in Vercel: **Add New Project** →
**Import Git Repository** → select this repo → **Deploy**. No build
command needed — leave the framework preset as "Other" and the output
directory as the repo root.

Once live on HTTPS, open the URL in Chrome on Android for the native
"Install app" prompt, or use [PWABuilder](https://www.pwabuilder.com) to
package it as a signed `.apk`/`.aab` for the Play Store.

## Data & privacy

Guest mode: everything is stored locally on-device (IndexedDB), nothing
is ever transmitted anywhere. Signed-in mode: trade data is stored in
your Supabase project, isolated per-user via row-level security. See
`privacy.html` for the full policy.
