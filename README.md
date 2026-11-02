# Event Vote — two categories, two candidates each

Mobile-first voting site for a live event. Spanish by default (English strings included).
Runs entirely on **Cloudflare's free plan**: no Vercel, no server to manage, no credit card needed.

## Architecture

```
Phone browser ──HTTPS──▶ Cloudflare Worker ──▶ D1 (SQLite database)
                          ├─ serves /public (HTML/CSS/JS, free & unlimited)
                          └─ /api/*  validation, voting, admin, results
```

| Piece | Choice | Why |
|---|---|---|
| Hosting + API | One Cloudflare Worker with static assets | Cloudflare now recommends Workers static assets over Pages for new projects; one deployment, one URL |
| Database | Cloudflare D1 | Real SQL transactions and UNIQUE constraints; free tier: 5M row reads/day, 100k row writes/day, 5 GB |
| Photos | Stored in D1 (resized in the browser to ≤900px) | Avoids R2, which needs a payment method |
| Admin login | Password in a Worker *secret* + signed HttpOnly session cookie | No third-party auth service to set up |
| Frontend | Plain HTML/CSS/JS, no build step | Easy to maintain and edit after the event |

Free-tier limits to know (checked Nov 2026; confirm on Cloudflare's pricing page): Workers free = 100k API requests/day, D1 free = 5M reads + 100k writes/day. A voter makes ~3 requests, so thousands of voters fit comfortably. If a daily limit is hit, queries fail until 00:00 UTC.
Cost: **$0**. Domain: you get a free `*.workers.dev` address; a custom domain is optional and costs money (not required).

## How double voting is prevented (and what is NOT guaranteed)

* The organizer generates **unique single-use voting codes** (admin page) and hands one to each attendee, or gives them a personal link/QR (`/?c=CODE`).
* The server consumes a code **atomically in one database transaction**; `UNIQUE` constraints on `ballots.code` and `ballots.token` are the backstop. Tested with 25 simultaneous requests on one code → exactly 1 vote counted.
* Each submission carries an id, so a retry after a dropped connection **cannot create a second vote**.
* **Limitation:** this guarantees *one vote per code*, not *one vote per person*. If someone gives away or sells a code, the system can't tell. Identity is only as strong as how you distribute codes.
* "Sin código" mode (admin setting) lets anyone with the link vote with **no duplicate protection at all** (only a per-IP rate limit). Use it only for casual events.
* Whoever has database access (you, as the Cloudflare account owner) could in principle link a code to its ballot. Votes are not anonymous from the account owner.

## Deployment (beginner friendly)

You need: a computer with **Node.js 20+** ([nodejs.org](https://nodejs.org)) and a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

1. **Install**: in this folder run `npm install`.
2. **Log in**: `npx wrangler login` (opens your browser; click *Allow*).
3. **Create the database**: `npx wrangler d1 create event-vote-db`. Copy the `database_id` it prints into `wrangler.jsonc` (replace `REPLACE_WITH_YOUR_DATABASE_ID`).
4. **Create the tables**: `npm run db:remote` (answer *y*).
5. **Deploy**: `npm run deploy`. The first time it asks you to choose a free `workers.dev` subdomain. It prints your public URL, like `https://event-vote.YOURNAME.workers.dev`.
6. **Set the secrets** (never put these in files or code):
   * `npx wrangler secret put ADMIN_PASSWORD` → type a long password.
   * `npx wrangler secret put SESSION_SECRET` → paste a random value; make one with `openssl rand -hex 32` (or any 40+ random characters).
7. **Open `https://YOUR-URL/admin`**, log in, and:
   * *Evento*: set the event name, tagline, logo, results mode.
   * *Categorías y candidatos*: edit both category names, the four candidate names, descriptions, and upload photos.
   * *Códigos de votación*: generate codes (e.g. 100) and download the CSV (code + personal link).
   * *Votación*: press **Abrir votación** when ready.
8. **Test on a phone**: open the URL (or a personal link from the CSV), vote, then check the admin results. Press **Reiniciar votación** (type REINICIAR) to wipe test votes before the real event. Codes become usable again.
9. **Share**: give each attendee their code or link. For a QR code, paste the URL (or a personal link) into any free QR generator, or in a terminal: `npx qrcode "https://YOUR-URL/"`.

### Results visibility (admin → Evento → Resultados)
* **Privados**: only the logged-in admin can see counts (the API itself refuses everyone else).
* **Públicos al cerrar**: `/results.html` works only once voting is closed (shows winners).
* **Públicos durante la votación**: live results for everyone.

### After the event
Close voting, export results (CSV button), then optionally delete the Worker and database from the Cloudflare dashboard.

## Customizing
Everything customizable is in the admin page. Text is in `public/i18n.js` (add a language by copying the `en` block; link with `/?lang=xx`). Colors are CSS variables at the top of `public/style.css`.

## Local development & tests
```
npm install
npx wrangler d1 migrations apply event-vote-db --local
cp .dev.vars.example .dev.vars        # local-only secrets
npx wrangler dev --port 8799
npm test                              # 20 API/integration tests (needs the dev server running)
node test/e2e.cjs                     # optional browser test (needs Playwright)
```

## Security notes
* Admin endpoints are checked **on the server** (signed cookie + CSRF header + SameSite=Strict); the UI hiding is cosmetic.
* Voters can only call `/api/vote`; they cannot read private results, edit candidates, or reset data (covered by tests).
* All queries use bound parameters; all UI text is inserted with `textContent` (no HTML injection); strict Content-Security-Policy; uploaded images are verified by file signature (no SVG).
* Rate limiting: admin login 8 tries/15 min per IP; voting 120 requests/min per IP (high on purpose: a whole venue can share one Wi-Fi IP).
* CSV exports neutralize spreadsheet formula injection.
* Secrets live only in Cloudflare secrets (`.dev.vars` is git-ignored).

## Known limitations
* One shared admin password (no per-person accounts, no 2FA). Choose a long password; consider Cloudflare Access if you need more.
* Rate limits are per IP, so attackers with many IPs aren't stopped by them (the 40-bit random codes are what protects against guessing).
* Not load-tested beyond 40 concurrent voters locally; the free-tier daily quotas are the practical ceiling.
