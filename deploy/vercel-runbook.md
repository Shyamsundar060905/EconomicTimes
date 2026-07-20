# Deploy the frontend to Vercel

**~10 minutes. The result: a public URL a judge can click and use — the whole
platform, live.**

## Why this is simple

The frontend reads each city's data from committed static JSON
(`app/frontend/public/data/<city>/`). So the **map, city switcher, citizen view,
action queue, memos and the Cities/Ledger/Audit tabs all work with NO backend** —
Vercel serves the built site and the data ships inside it. That is the
demo-insurance principle taken to its conclusion: nothing to keep alive, nothing
to rate-limit, nothing that dies on stage.

What the (optional) backend would add: live "Run Full Pipeline" from the browser.
Not needed for the demo — skip it for now, add later (Cloud Run) if you want it.

The citizen **report form** already posts to the live n8n webhook
(`https://aq-intel.duckdns.org/webhook/citizen-report`), which is independent of
this deploy.

---

## Step 1 — import the repo (Vercel dashboard, 3 min)

1. Go to **https://vercel.com/new** and sign in with GitHub.
2. **Import** the `coffeine16/EconomicTimes` repo.
3. In the configure screen, set:
   - **Root Directory** → `app/frontend`  ← *the one setting that matters (monorepo)*
   - Framework Preset → **Next.js** (auto-detected)
   - Build/Install commands → leave default (a `vercel.json` in the folder sets them)

## Step 2 — environment variables (1 min)

Add these in **Settings → Environment Variables** (or on the import screen):

| Name | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | *(leave empty)* | No backend → the app uses the committed static data. An explicit empty value is the "no backend" signal. |
| `NEXT_PUBLIC_N8N_WEBHOOK_URL` | `https://aq-intel.duckdns.org/webhook/citizen-report` | Where the citizen report form posts. |

> If you later deploy the backend, set `NEXT_PUBLIC_API_URL` to its URL and redeploy —
> the app will prefer it and fall back to static if it is down.

## Step 3 — deploy

Click **Deploy**. ~2 minutes to build. You get a URL like
`https://econ-times-xxxx.vercel.app`.

**Test it:**
- The map loads Delhi hotspots; the **city switcher** flips to Chennai / Bengaluru
  and the map flies there.
- **Cities** tab shows the three-city comparison.
- **Citizen View** → "Use my location" or tap the map → a ward page with its map,
  AQI, and forecast.
- An enforcement zone → **Generate Memo** opens the memo with its legal citation.
- Toggle light/dark; open on a phone.

---

## CLI alternative (if you prefer the terminal)

```bash
npm i -g vercel
cd app/frontend
vercel            # first run: links the project, asks a few questions
vercel --prod     # promote to the production URL
```

Set the env vars once with `vercel env add NEXT_PUBLIC_N8N_WEBHOOK_URL` (leave
`NEXT_PUBLIC_API_URL` empty), then `vercel --prod` again.

---

## Optional — the backend (Cloud Run), only for live pipeline runs

Skip unless you specifically want the **Run Full Pipeline** button to execute live
on stage. It is a minutes-long batch job needing the data + GEE auth, so it is not
the robust demo path. If you do want it: containerise `app/backend`, bake in a
city's `data/outputs` + `data/raw`, deploy to Cloud Run, then point
`NEXT_PUBLIC_API_URL` at it. The static frontend already covers everything else.

## After deploy

- Put the Vercel URL in the README and the deck.
- Tighten the n8n webhook CORS from `*` to the Vercel domain (n8n → the
  citizen-report workflow → Webhook node → Allowed Origins).
