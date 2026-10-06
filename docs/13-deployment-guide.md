# 13 — Deployment Guide (free tiers)

Step-by-step, from a fresh clone to a public URL. Everything here is free and needs no card.
Architecture and the reasoning behind the split are in doc 06 §7; this document is the procedure.

| What | Where | Free tier limit that matters |
|---|---|---|
| Web app + API | **Vercel** Hobby | 100 GB bandwidth/month, 60 s per function |
| Database | **Neon** Free | 0.5 GB storage, scales to zero when idle |
| Email (OTP, reset) | **Resend** Free | 3,000 emails/month, 100/day |
| Byte-analysis worker | **GitHub Actions** | unlimited minutes on a **public** repository |
| Measurement worker | **your own quiet machine** | — |

---

## 1. Run it locally first

Nothing to install beyond Node 22 and pnpm — the local database is PGlite (real Postgres compiled to
WebAssembly) behind a Postgres socket, so the app talks to it with the same driver it uses in
production.

```bash
pnpm install

# terminal 1 — local Postgres on 127.0.0.1:5432, data in .work/pglite
pnpm db:serve

# terminal 2 — create the tables, then start the app
pnpm db:migrate
cd apps/web && cp .env.example .env.local && pnpm dev
```

Open <http://localhost:3000>. With no `RESEND_API_KEY` set, verification codes are **printed to the
server console and shown in the UI**, so you can register and sign in with no mail provider at all.

Run the page/API test suite (51 test cases, doc 05 §9):

```bash
# terminal 2, with DEPLENS_E2E=1 so the test can read the captcha answer
cd apps/web && DEPLENS_E2E=1 pnpm dev -p 3111
# terminal 3
pnpm test:web
```

--
## 2. Create the database (Neon)

1. Sign up at <https://neon.tech> with GitHub.
2. **Create project** → name `deplens`, Postgres 16, pick the region closest to you.
3. On the dashboard, copy the **pooled** connection string. It looks like
   `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
   Use the *pooled* one — serverless functions open many short connections.
4. Apply the schema from your machine:

   ```bash
   DATABASE_URL="postgresql://…pooler…?sslmode=require" pnpm db:migrate
   ```

   It prints which migrations ran. It is idempotent, so running it again is safe.

> **Branches for free.** Neon can branch a database like Git. Create a `dev` branch and point your
> local `.env.local` at it when you want dev and production to share a schema but not rows.

---

## 3. Create the mailer (Resend) — optional but needed for real OTP emails

1. Sign up at <https://resend.com>.
2. **API Keys → Create**, copy the `re_…` value.
3. Without a verified domain you can still send from `onboarding@resend.dev`, but **only to your own
   signup address**. For a demo where others create accounts, add and verify a domain (free), then set
   `MAIL_FROM` to an address on it.
4. If you skip this step entirely the app still works — it just prints codes to the server log.

---

## 4. Deploy the web app (Vercel)

1. Push the repository to GitHub (public, so the Actions worker is free).
2. At <https://vercel.com> → **Add New → Project** → import the repository.
3. **Important — monorepo settings:**
   - Root Directory: `apps/web`
   - Framework Preset: Next.js (detected)
   - Install Command: `cd ../.. && pnpm install`
   - Build Command: `pnpm build`
4. **Environment Variables** (Production *and* Preview):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon **pooled** string from step 2 |
   | `AUTH_SECRET` | 32 random bytes — `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-project>.vercel.app` |
   | `RESEND_API_KEY` | from step 3, if you did it |
   | `MAIL_FROM` | `DepLens <noreply@yourdomain>`, if you verified a domain |

   Do **not** set `DEPLENS_E2E`. It is ignored when `NODE_ENV=production`, but leave it out anyway.
5. **Deploy.** First build takes 2–4 minutes.
6. Visit the URL, create an account, and check the server logs in Vercel → Deployments → Functions if
   an email does not arrive.

### After the first deploy

- Set `NEXT_PUBLIC_APP_URL` to the final URL (including a custom domain if you add one) and redeploy,
  otherwise the links in emails and the CSRF origin check will point at the wrong host.
- Every push to the default branch redeploys. Pull requests get their own preview URL.

---

## 5. The byte-analysis worker (GitHub Actions)

Analysing a package nobody has measured yet needs `npm install` plus two bundler runs — too slow and
too large for a 60 s serverless function, but trivial for CI. It produces **only byte counts and
features**, never timings, which is why a shared runner is acceptable (doc 06 §7.1).

1. Repository → **Settings → Secrets and variables → Actions → New repository secret**:
   `DATABASE_URL` = the same Neon string.
2. The workflow claims queued `job` rows with `tier = 'ci'`, runs the analysis, and writes the result
   back. It is triggered two ways: a `repository_dispatch` from the web app the moment a job is
   queued, and a cron sweep every 5 minutes as a safety net.
3. For the dispatch to work the app needs a token with `repo` scope; add it as `GITHUB_DISPATCH_TOKEN`
   in Vercel. Without it the cron sweep still picks jobs up within 5 minutes.

> **Status:** the job table and the queue semantics exist (`packages/db`, doc 06 §7.3). The workflow
> itself lands with Phase 3, when `packages/features` can produce a feature vector worth storing.

---

## 6. The measurement worker (your machine)

Every `measured` number comes from here. It is the only part that must not run on shared hardware,
because we measured A/A noise of ±4 ms on a busy machine against ±0.3 ms idle (research log,
1 Oct 2026).

```bash
# once, on the machine that will do the measuring
pnpm harness calibrate --cpu 1,2,3,4,6 --repeats 3   # stores .work/machine.json
pnpm harness machine                                  # shows which rate each profile resolves to
```

Before a dataset run: plug the laptop in, set the power plan to High performance, close everything
else, and re-calibrate. **Require a rate-1 spread under about 5%** — above that the machine is not
quiet enough and the harness will refuse sessions anyway (FR-33).

---

## 7. Checklist before showing it to anyone

- [ ] `pnpm test` (49 harness unit tests) and `pnpm test:web` (51 page/API test cases) both pass
- [ ] `AUTH_SECRET` in production is **not** the value from `.env.example`
- [ ] `NEXT_PUBLIC_APP_URL` matches the deployed origin exactly
- [ ] Registering a fresh account on the deployed URL delivers a real email
- [ ] The deployed site is checked at 360 px, 768 px, 1366 px and 1920 px (NFR-U4)
- [ ] Sign-out works, and the dashboard is unreachable afterwards
- [ ] `docs/research-log.md` has an entry for anything that changed how labels are produced

---

## 8. Costs if the free tiers are exceeded

Worth knowing before a demo day, so nothing is a surprise:

| Service | What happens past the free tier |
|---|---|
| Vercel Hobby | Bandwidth is throttled, not billed. Hobby may not be used commercially. |
| Neon Free | The database is suspended until the next month, or you upgrade. 0.5 GB is far more than this project needs. |
| Resend Free | Sending stops at 100 emails/day. |
| GitHub Actions | Free and unlimited while the repository is public. A private repo gets 2,000 minutes/month. |

Nothing here can produce a bill without an explicit upgrade.
