# RailCast — Database (Supabase) + Hosting (Netlify)

RailCast still runs 100% offline from the embedded data. Supabase + Netlify turn it
into a **live, shared, hosted** app: a controller's typed delay is saved to a Postgres
database and seen by everyone, and the whole site is on the public internet.

If Supabase is not configured, the app quietly uses the embedded data — nothing breaks.

---

## Part A — Supabase (the database)

**1. Create the project.**
Go to https://supabase.com → sign in → **New project**. Pick a name, a strong database
password, and a region near you. Wait ~2 minutes for it to provision.

**2. Create the tables.**
Left sidebar → **SQL Editor** → **New query** → paste the entire contents of
[`db/schema.sql`](db/schema.sql) → **Run**. You should see "Success". This creates the
tables (`trains`, `stations`, `runs`, `live_trains`, `model_artifacts`) and the
row-level-security policies (public read; write only to `live_trains`).

**3. Load the data.**
Get your keys: sidebar → **Project Settings → API**. You need two things:
- **Project URL** (e.g. `https://abcd1234.supabase.co`)
- **`service_role` key** — the SECRET one, used only for this one-time load. Never commit it.

Then, from the `railcast/` folder, run the seeder (only Python stdlib — no pip installs):

```bash
export SUPABASE_URL="https://YOURPROJECT.supabase.co"
export SUPABASE_SERVICE_KEY="eyJ...your service_role key..."
python3 db/seed.py
```

It clears and loads every table (≈39 trains, ≈32k runs, the model + metrics). Re-run it
any time you regenerate the data.

**4. Point the app at the database.**
Open [`js/config.js`](js/config.js) and paste your **Project URL** and your **`anon` /
public** key (Settings → API → "Project API keys" → `anon` `public`). This key is meant
for browsers and is safe to commit — access is still gated by the RLS policies.

```js
RC.dbConfig = {
  url:     'https://YOURPROJECT.supabase.co',
  anonKey: 'eyJ...your ANON public key...'
};
```

Open `index.html` — the header should now read **"Supabase · live board"**, and the
Admin Console's **"Save delay to live board"** button is enabled. Type a delay, save it,
reload in another browser/phone — the delay is there. That is the live demo.

> Security note: for the hackathon, `live_trains` is open for anyone to write (demo-grade,
> stated in `db/schema.sql`). In production you would require an authenticated "controller"
> role. Reads are public; the `runs`/`model` tables are read-only.

---

## Part B — Netlify (hosting), via a GitHub repo

**1. Put this folder on GitHub.**
A git repo has already been initialised in `railcast/` with a first commit. Create an
empty repository on https://github.com/new (do NOT add a README), then:

```bash
git remote add origin https://github.com/<you>/railcast.git
git branch -M main
git push -u origin main
```

**2. Connect it to Netlify.**
https://app.netlify.com → **Add new site → Import an existing project → GitHub** →
authorise → pick your `railcast` repo. Netlify reads `netlify.toml`, so:
- **Build command:** leave empty
- **Publish directory:** `.`

Click **Deploy**. In ~30 seconds you get a live URL like
`https://railcast-teamrocket.netlify.app`. Every `git push` now auto-deploys.

**3. (Recommended) Keep the anon key out of Git.**
`js/config.js` already contains the (public, safe) anon key, so it just works. If you
would rather not commit even the anon key, leave the placeholders in `config.js` and
instead paste the values after each deploy — or ask and we can switch to a
`config.js` generated from a Netlify environment variable via a tiny build step.

---

## Rebuild checklist (when the data/model changes)
1. `node data/generate.js`  → regenerate the synthetic data
2. run `ml/train.ipynb`      → re-fit and re-export `data/model.json` / `data/metrics.json`
3. `python3 db/seed.py`      → reload Supabase (uses your service key env vars)
4. `git commit -am "update model" && git push`  → Netlify redeploys automatically
