# Putting CarCare online (free)

This guide puts CarCare on the internet for free, sized for you and a few
friends. You create the accounts and type the secrets. Nothing secret ever
goes into this repository, which is public.

| Piece                        | Where                                    | Cost               |
| ---------------------------- | ---------------------------------------- | ------------------ |
| Website                      | Vercel                                   | free               |
| API and worker (one program) | Render, Frankfurt                        | free               |
| Job queue (Redis)            | Render Key Value                         | free               |
| Database                     | Neon                                     | free (0.5 GB)      |
| Receipts and papers          | Cloudflare R2                            | free up to 10 GB   |
| Keeping the server awake     | GitHub Actions                           | free (public repo) |
| Email                        | not yet, see [Email later](#email-later) | —                  |

The website forwards every `/api/...` request to Render, so to your browser
the whole app lives at one address. That keeps you signed in on iPhones, which
block login cookies from a second site.

Do the steps in order. Keep a note open to paste values into as you go.

## 1. Database: Neon

1. Sign up at https://neon.tech.
2. **Create project**: name `carcare`, region **AWS Europe Central 1 (Frankfurt)**,
   the newest Postgres.
3. On the project page, click **Connect**. Turn **Connection pooling off**
   (the address must not contain `-pooler`). Copy the address. It looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
   → this is **DATABASE_URL**. Treat it like a password.

## 2. File storage: Cloudflare R2

1. Sign up at https://dash.cloudflare.com, open **R2 Object Storage**, and
   turn it on. Cloudflare asks for a card, but you're only charged above 10 GB.
2. **Create bucket**: name `carcare-documents`, location **Automatic**.
3. Back on the R2 page: **Manage API tokens → Create API token**.
   - Permissions: **Object Read & Write**
   - Specify bucket: `carcare-documents`
4. Copy the three values it shows (it shows the secret only once):
   - **Access Key ID** → `S3_ACCESS_KEY_ID`
   - **Secret Access Key** → `S3_SECRET_ACCESS_KEY`
   - The **S3 endpoint**, `https://<account-id>.r2.cloudflarestorage.com`
     → `S3_ENDPOINT`

You'll come back in step 5 to allow uploads from your website's address.

## 3. Website: Vercel

1. Sign up at https://vercel.com with your GitHub account.
2. **Add New → Project**, and import `skander2905/carcare`.
3. **Root Directory**: click **Edit** and choose `frontend`. Vercel detects Next.js.
4. **Environment Variables**, add:
   | Name                   | Value                              |
   | ---------------------- | ---------------------------------- |
   | `NEXT_PUBLIC_API_URL`  | `same-origin`                      |
   | `NEXT_PUBLIC_APP_NAME` | `CarCare`                          |
   | `API_PROXY_TARGET`     | `https://carcare-api.onrender.com` |
5. **Deploy**. When it finishes, note your address, for example
   `https://carcare-abc.vercel.app` → this is your **website address**.
   (Settings → Domains lets you pick a nicer `something.vercel.app` name.)
6. Settings → General → **Node.js Version**: `24.x`.

The site loads, but signing in fails until the API is up (step 4).

## 4. API, worker and queue: Render

1. Sign up at https://render.com with your GitHub account.
2. **New → Blueprint**, pick `skander2905/carcare`. Render reads
   `render.yaml` and plans two things: `carcare-api` and `carcare-queue`.
3. It asks for the values marked secret. Paste:
   | Name                   | Value                                                   |
   | ---------------------- | ------------------------------------------------------- |
   | `DATABASE_URL`         | from step 1                                             |
   | `WEB_APP_URL`          | your website address                                    |
   | `API_PUBLIC_URL`       | your website address too: the API is reached through it |
   | `CORS_ORIGINS`         | your website address                                    |
   | `S3_ENDPOINT`          | from step 2                                             |
   | `S3_BUCKET`            | `carcare-documents`                                     |
   | `S3_ACCESS_KEY_ID`     | from step 2                                             |
   | `S3_SECRET_ACCESS_KEY` | from step 2                                             |
4. **Apply**. The first build takes 5 to 10 minutes. In `carcare-api` → **Logs**,
   wait for:
   - `All migrations have been successfully applied` (the database is set up)
   - `CarCare API listening on port …`
   - `Reminder sweep scheduled`
5. Note its address at the top, e.g. `https://carcare-api.onrender.com`. If it
   isn't exactly that, change `API_PROXY_TARGET` in Vercel to it and redeploy
   (Vercel → Deployments → ⋯ → Redeploy).

The signing key (`JWT_ACCESS_SECRET`) is generated by Render. You never see or type it.

## 5. Allow uploads from your website

Cloudflare → R2 → `carcare-documents` → **Settings → CORS policy → Add**, and
paste this with your website address:

```json
[
  {
    "AllowedOrigins": ["https://carcare-abc.vercel.app"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

## 6. Keep the server awake

Free Render servers fall asleep after 15 quiet minutes, and a sleeping server
can't check reminders. A small GitHub job wakes it every 10 minutes.

1. GitHub → the repository → **Settings → Secrets and variables → Actions →
   Variables → New repository variable**:
   - Name: `KEEP_AWAKE_URL`
   - Value: `https://carcare-api.onrender.com/health/live` (your Render address)
2. **Actions** tab → **Keep the API awake** → **Run workflow**, to try it once.
   It should turn green.

GitHub pauses scheduled jobs in a repository with no commits for 60 days. If
that happens, the Actions tab shows a button to turn it back on.

## 7. Try it

Open your website address on your phone and **create your account**. The
online app starts empty; your computer's data stays on your computer.

On the phone, online:

- ✅ finding the station from your location works (the site is `https`)
- ✅ the camera, receipts and car papers work
- ✅ reminders appear under the bell
- ❌ no emails: no confirmation, no "forgot password" (hidden), no digests

If you forget your password before email exists, ask for it to be reset
directly in the database.

## Updating

Merging a pull request into `main` updates both: Vercel rebuilds the website
and Render rebuilds the API, running any new database migration as it starts.

## Free-plan limits worth knowing

- **Neon**: 0.5 GB of data, years of a few cars' records. The database sleeps
  when unused, so the first request after a quiet spell takes a second longer.
- **R2**: 10 GB of files, thousands of receipt photos.
- **Render**: 750 hours a month, enough for one server running all month. Its
  queue (25 MB) isn't saved across restarts, which is fine: the reminder
  sweep re-creates whatever was lost.
- **Render deploys** take a few minutes, during which the app is briefly unavailable.

## Email later

Render's free plan blocks the ports used to send email (since September
2025), so Gmail can't be used from it. Two ways to turn email on later:

1. **Free**: send through Gmail's web API, which uses normal web traffic,
   instead of the blocked email ports. It needs a one-time Google Cloud setup
   and a small change in CarCare.
2. **$7 a month**: upgrade `carcare-api` to Render's Starter plan, then add the
   Gmail settings from `docs/email.md`.

With email on, the "Confirm your email" bar and "Forgot your password?"
appear by themselves. The app asks the server whether email works (`GET /api/v1/features`).
