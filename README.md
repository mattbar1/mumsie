# Mumsie's Meals

A shared app for the family to log where Mumsie eats each meal, and to help
pick where to go next. Everyone sees the same restaurants, menus, and meal
history, refreshed automatically every ~20 seconds.

## How it's built

- **Frontend**: a static site (`index.html` + `app.js`) — no build tooling,
  no framework. Deployed on Netlify.
- **Backend**: [Supabase](https://supabase.com) (Postgres). The app's public
  "anon" key cannot read or write any table directly — every table has Row
  Level Security on with no policies, and all table grants are revoked.
  The only way in is through a handful of database functions
  (`app_sync`, `log_visit`, `delete_visit`, `add_restaurant`,
  `update_restaurant`, `delete_restaurant`) defined in `supabase_setup.sql`.
  Each function takes the caller's personal token as a parameter and checks
  it before doing anything — invalid token, no data, no exceptions.
- **Identity**: there's no login form. Each person gets a link with their
  own long random token (`?k=...`). Opening that link signs them in as
  themselves (viewer role depends on who they are — Lisa is `admin`,
  everyone else is `member`) and the token is remembered on that device.

## One-time setup

### 1. Supabase project

1. In your Supabase project, open **SQL Editor → New query**.
2. Paste in the entire contents of [`supabase_setup.sql`](supabase_setup.sql)
   and run it. This creates the tables, locks them down, creates the
   functions, and seeds the 4 restaurants and everyone's account
   (Lisa as admin; Claudia, Tee, Brian, Carrie, Sharon, Kristen, and Craig
   as members).
3. Go to **Project Settings → API**. You'll need two values from there for
   step 2 below: the **Project URL** and the `anon` **public** key. (Never
   use or share the `service_role` key — it bypasses all the locks above.)

### 2. Netlify site

1. Push this repo to GitHub (or connect it directly) and create a new
   Netlify site from it.
2. In **Site settings → Environment variables**, add:
   - `SUPABASE_URL` — the Project URL from step 1.3
   - `SUPABASE_ANON_KEY` — the anon public key from step 1.3
3. Deploy. Netlify runs `build.sh`, which writes those two values into a
   generated `config.js` (this file is git-ignored — it only ever exists on
   Netlify's build server and in your browser, never in the repo).
4. Note your site's URL (something like `https://mumsies-meals.netlify.app`).

### 3. Send everyone their link

Back in the Supabase **SQL Editor**, run:

```sql
select name, role, 'https://YOUR-SITE.netlify.app/?k=' || token as link
from people order by role desc, name;
```

(swap in your real Netlify URL). This only runs in your private SQL editor —
nobody else can see it. Copy each person's link and send it to them
individually (text message, not a group chat, so tokens don't end up in a
screenshot everyone can see).

Each person should open their link once in their phone's browser, and —
if they add it to their Home Screen — open it there once too. iOS keeps
Safari and Home Screen apps in separate storage, so the token has to be
saved in both places independently. After that first open, they won't need
the link again (and the token is dropped from the visible URL as soon as
it's saved).

### 4. Adding someone later

In the SQL editor:

```sql
insert into people (name, role) values ('New Person', 'member');
select name, token from people where name = 'New Person';
```

Build their link the same way as step 3 and send it to them.

## Day-to-day use

- **Home / Pick / Log / History** work exactly as before — tap a
  restaurant, pick a meal, log it in two taps.
- **Places**: anyone can view restaurants and menus; only Lisa (admin) can
  add, edit, or remove one.
- Anyone can delete their *own* logged entries from History; Lisa can
  delete any entry.
- Data refreshes automatically every ~20 seconds, and immediately whenever
  the app is reopened or switched back to.

## Local testing

Copy `config.example.js` to `config.js` and fill in your real Supabase URL
and anon key, then serve the folder with any static file server (e.g.
`npx serve .`). `config.js` is git-ignored, so this never gets committed.

## Costs

Everything here runs on Supabase's and Netlify's free tiers, which comfortably
cover a family of this size. Nothing in this setup requires a paid plan.
