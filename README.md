# perigo

[![CI](https://github.com/Vinay-Kaushal/perigo-beta2.0/actions/workflows/ci.yml/badge.svg)](https://github.com/Vinay-Kaushal/perigo-beta2.0/actions/workflows/ci.yml)

Work management for organisations: a realtime **service desk** (tickets, assignment, SLAs), **projects** (kanban boards), **expense approvals**, **goal tracking**, and **dashboards**, with invite-and-approve onboarding and an audit trail.

## Architecture

```
apps/frontend   Next.js 15 (App Router) · Tailwind · Radix · SWR          :3000
apps/backend    Express REST API · Zod validation · Prisma                  :4000
apps/websocket  Bun native WebSockets · fans out Redis pub/sub events       :4001
packages/db     Prisma schema, migrations, generated client (PostgreSQL)
```

- The **API** writes to Postgres, then publishes a small event to Redis on `org:<id>`, `board:<id>` or `user:<id>`.
- The **websocket service** subscribes to those channels and forwards each event to the sockets allowed to see it. Any number of instances can run side by side.
- The **frontend** keeps one socket per session. An org event revalidates that org's cached queries, so lists, stats and detail pages update for everyone without a reload. Personal notifications show up as toasts and an unread badge.

## Modules

| Module | What it does |
|---|---|
| Service desk | Per-org numbered tickets (`ACME-42`); types: incident, request, problem, change, question. Every ticket gets a first-response and a resolution target from its priority, with breach tracking. Tickets move through a status workflow (new → open → in progress / on hold → resolved → closed, or cancelled) and can be assigned to a person and a team queue. They also have watchers, comments, and a full activity timeline. |
| SLAs & business hours | Per-org targets for each priority (defaults: urgent 30 min / 4 h → low 1 day / 5 days), editable by owners and admins. SLAs can count only business hours: working days, opening hours, a timezone (DST-safe) and holidays. Putting a ticket **on hold pauses the clock**; resuming moves both targets out by the business time spent on hold, which is recorded in the activity log. The queue has *SLA breached*, *Response overdue* and *On hold* views. The first reply from anyone other than the requester counts as the response. New settings apply to tickets raised, re-prioritised or resumed afterwards. |
| Assignment rules | Anyone can pick up or route an unassigned ticket. Once assigned, only the requester, the assignee, or an admin can reassign it. The new assignee, the previous assignee, the requester and watchers each get a specific notification ("Marcus assigned ACME-42 to you", "…reassigned to Sam"). |
| Onboarding | You can only join by invitation. Invite → the invitee accepts via the emailed link (it must match their account's email) → an owner or admin approves. The approval step can be turned off per org, but invites sent by regular members always need approval. |
| Expenses | Members submit expenses; owners and admins approve or reject them (a reason is required to reject). Admins can't approve their own expenses. Includes monthly and category breakdowns. |
| Goals | Three kinds: *Metric* (manual check-ins), *Tickets resolved* (counted automatically) and *Budget* (approved spend, counted automatically). Health (on track / at risk / off track) compares progress with where you'd be on a straight line through the period. |
| Attachments | Files on tickets and comments (drag-and-drop, progress, image previews). Server-side type allowlist verified against the file's bytes, 10 MB cap, random storage keys, sandboxed downloads; stored on disk (persistent `uploads` volume in Docker). |
| Mentions | `@` autocomplete of org members in ticket descriptions and comments, and task comments (board members). Mentioned people are notified and start watching; non-members are ignored silently. |
| Notifications | In-app (live) and email, with per-category preferences (assignments, mentions, approvals, your requests, ticket activity). Emails are batched per user (default 60 s) into one message, skip anything already read in the app, go only to verified addresses, and include one-click unsubscribe. Delivery runs through a Redis queue with retries and a dead-letter list, via SMTP or Resend. |
| Projects | Kanban boards with drag-and-drop, live presence and cursors, task assignment and comments. |
| Projects admin | Owners/admins add, rename, retype, reorder and delete board columns; changes sync live. |
| Accounts | Email verification (required before creating organisations or inviting), forgot/reset password, sign out everywhere. |
| Admin | Roles (owner/admin/member), teams, org settings, audit log, 30-day PDF report. |

## Run with Docker (one command)

Requirements: Docker with Compose v2.

```bash
bun run docker:up        # or: bash scripts/docker-up.sh
bun run docker:seed      # optional demo data
```

The first run creates a root `.env` from `.env.docker.example` with generated secrets, builds the images, applies database migrations, and waits until every service is healthy:

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000 (`/ready` health check) |
| Websocket | ws://localhost:4001 |

Postgres and Redis stay inside the Docker network (no host ports), so they won't clash with local installs. `bun run docker:logs` follows the app logs; `bun run docker:down` stops everything (add `-v` to delete the data volumes). Change ports, origins, email (`SMTP_URL` or `RESEND_API_KEY`) and Google settings in `.env`; behind HTTPS set `COOKIE_SECURE=true`. The API container runs the email worker; with several API replicas, each runs one and Redis ensures every email is sent once.

## Getting started (without Docker)

Requirements: Bun ≥ 1.3, Node ≥ 20, PostgreSQL 16, Redis 7.

```bash
bun install                       # also generates the Prisma client
cp apps/backend/.env.example apps/backend/.env         # fill in DATABASE_URL, JWT_SECRET (openssl rand -hex 32)…
cp apps/websocket/.env.example apps/websocket/.env
cp apps/frontend/.env.example apps/frontend/.env
cp packages/db/.env.example packages/db/.env

cd packages/db && bunx prisma migrate deploy && cd ../..
cd apps/backend && bun run seed && cd ../..           # optional demo data
bun run dev                                           # all three apps via turbo
```

Demo logins after seeding (password `Password123`): `owner@acme.test`, `admin@acme.test`, `alex@acme.test`, `sam@acme.test`. `jordan@acme.test` has a pending join request for an admin to approve.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

1. **test** — installs from the lockfile, applies migrations to a fresh Postgres, fails on schema/migration drift, type-checks all three apps, runs backend, websocket and frontend unit tests, and builds the frontend.
2. **e2e** — seeds a database, starts the API, websocket and web app, and runs the Playwright suite (artifacts and server logs are uploaded on failure).
3. **docker** — builds every Docker image so the compose setup can't silently break.

## Tests

The suites run against throwaway services and **truncate every table**. They refuse any database whose name doesn't contain `test`.

```bash
docker run -d --name xsam-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=perigo_test -p 5434:5432 postgres:16-alpine
docker run -d --name xsam-test-redis -p 6381:6379 redis:7-alpine
cd apps/backend && bun run test:db:prepare    # apply migrations to the test DB

bun run test          # from the repo root: backend (234) + websocket (9) + frontend unit (32)
```

Override the database and Redis with `TEST_DATABASE_URL` and `TEST_REDIS_URL`.

**End-to-end (Playwright)** runs against a live stack with the seeded demo data. The e2e suite signs in repeatedly, so start the API with a higher login limit:

```bash
cd apps/backend && bun run seed && RATE_LIMIT_AUTH_MAX=1000 bun run dev    # plus websocket + frontend
cd apps/frontend && bunx playwright install chromium
E2E_BASE_URL=http://localhost:3000 bun run test:e2e
```

The e2e suite covers: login redirects and open-redirect protection, httpOnly session, sign-out, forgot password; two browsers checking that ticket assignment, status changes and comments arrive live; invite → register → accept → admin approval → access; board column management and presence; SLA settings, business hours and holidays, and a ticket's SLA pausing on hold. Every e2e test also fails on page errors, console errors or unexpected 4xx/5xx responses.

- **Frontend unit.** The API client (cookie + CSRF header, 401 handling, open-redirect guard), formatting helpers and the timezone picker's names.
- **Backend.** Unit tests cover the ticket workflow and permissions, business-time arithmetic (weekends, holidays, timezones, DST) and SLA pause/resume, goal health and integer positioning. Integration tests cover auth, sessions and hardening; organisations, roles and IDOR protection; the full invitation flow; tickets (including concurrency, notifications and realtime publishes); SLA settings, business-hours targets and pause/resume; boards and tasks; expenses and goals; dashboards and analytics. Every API response in every test is also checked for leaked `passwordHash`, `tokenVersion` or `tokenHash`.
- **Websocket.** Ticket auth, origin checks, channel authorisation, fan-out isolation, live access revocation, presence, and flood/oversize handling.

## Security model

- **Sessions.** Browsers hold the session in an httpOnly, SameSite=Lax cookie that JavaScript can't read. Cookie-authenticated writes require an `X-CSRF-Protection` header, which cross-site forms can't send and the CORS allowlist blocks for other origins. API clients can use a bearer token instead.
- **Account recovery.** Email verification and password-reset links are single-use, expiring, and stored only as SHA-256 hashes; a new link invalidates older ones. "Forgot password" gives the same response whether or not the account exists, and a reset signs out every session.
- **Authentication.** HS256 JWTs pinned to issuer and audience. Each token carries a `tokenVersion`, so changing the password or using "sign out everywhere" revokes every existing token immediately. bcrypt hashes; login takes the same time whether or not the email exists; generic credential errors; password policy. Google sign-in only links to an existing account when Google has verified the email.
- **Authorisation.** Every org-scoped query is filtered by the org id from the URL, never by an id supplied in the body. A resource from another org returns 404, not 403, so ids can't be probed. Role checks cover: last-owner protection, admins can't remove other admins, board visibility, the approval column gate, and separation of duties on expense approval.
- **Email.** Notification emails only reach verified addresses; unsubscribe links are HMAC-signed per user and category (RFC 8058 one-click), and the unsubscribe page requires a click so mail scanners can't switch people's emails off.
- **Uploads.** File type comes from the extension and must match the file's leading bytes (no trusting browser MIME types); SVG/HTML/executables are refused; files are stored under random ids, never the user's name; downloads send `Content-Disposition`, `nosniff` and a sandboxing CSP; access goes through the same org checks as the ticket.
- **Invitations.** Tokens are 256-bit and random, and only their SHA-256 is stored. Accepting requires both the token and a matching account email. Links expire, are single-use, and are replaced when an invite is resent.
- **Websockets.** A short-lived, single-use ticket from `POST /auth/ws-ticket` is used instead of putting the JWT in the URL. The server checks an origin allowlist, re-checks channel access on subscribe, drops subscriptions the moment access is revoked, and enforces per-socket rate limits, a payload cap and connection caps.
- **Rate limits.** Redis-backed, so they hold across instances. Anonymous traffic is limited per IP; signed-in traffic per user, so a whole office behind one NAT or VPN address doesn't share a budget; invalid or revoked credentials are counted per IP so garbage tokens can't be used to flood. Login, signup, token lookups and verification emails have their own limits.
- **HTTP.** Helmet with a strict CSP, a CORS allowlist, `Cache-Control: no-store`, request ids, a 256KB body cap, env validation at boot, no stack traces in responses, and graceful shutdown.
- **Frontend.** CSP and security headers, no tokens in JavaScript, open-redirect-safe `?next=`, HTML-escaped email templates, http(s)-only avatar URLs.
- **Audit log.** Role changes, membership, invitations and approvals, expense decisions, SLA and holiday changes, and deletions, each with actor and IP.

## Database migrations

`20260915090000_sla_business_hours` adds SLA policies, holidays and business hours (off by default, so existing orgs keep 24/7 SLAs) and starts the paused clock for tickets already on hold. `20260914090000_auth_tokens` marks existing users as verified so nobody is locked out. `20260913100000_service_desk_mvp` preserves existing data: goal targets are renamed rather than dropped, existing invitation tokens are hashed so old links keep working, and pre-existing expenses are marked approved. Always run `prisma migrate deploy` before starting a new build.
