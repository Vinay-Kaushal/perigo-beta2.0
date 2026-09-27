# perigo

[![CI](https://github.com/Vinay-Kaushal/perigo-beta2.0/actions/workflows/ci.yml/badge.svg)](https://github.com/Vinay-Kaushal/perigo-beta2.0/actions/workflows/ci.yml)

Work management for organisations: a realtime **service desk** (tickets, assignment, SLAs), **projects** (kanban boards), **expense approvals**, **goal tracking**, and **dashboards**, with invite-and-approve onboarding and an audit trail.

## What is perigo?

Most small and mid-sized teams run their day-to-day operations across several tools: a helpdesk for "my laptop is broken" requests, a board for project work, a spreadsheet for expense claims and another for quarterly goals. perigo puts these in one place for one **organisation** (a company, department or agency), with the same people, roles and permissions throughout.

A typical day for an IT and operations team using it:

- Sam's VPN keeps dropping. Sam raises a **ticket**. It gets a number (`ACME-42`) and deadlines based on its priority: someone must reply within 30 minutes and fix it within 4 hours.
- Alex from the IT Support **team** picks it up, comments, and puts it **on hold** while waiting for a vendor. The deadline clock pauses. Sam and anyone **watching** the ticket are notified live in the browser and by email.
- Meanwhile Alex moves tasks on the *Q3 Infrastructure* **board**, submits an **expense** for a replacement router, and an admin approves it.
- The IT lead checks the **dashboard**: open tickets, SLA breaches, who's overloaded, and whether the quarter's **goals** are on track. The lead exports last month's tickets to CSV for a review.

Everything updates in real time for everyone looking at the same page, and sensitive actions (role changes, approvals, exports, deletions) are recorded in an audit log.

> The product is called **perigo**; this repository is `perigo-beta2.0` and may be checked out under a different folder name.

## Try it in five minutes

With Docker installed:

```bash
bun run docker:up        # builds and starts everything (see "Run with Docker" below)
bun run docker:seed      # loads the "Acme Corp" demo organisation
```

Open http://localhost:3000 and sign in with any of these (password `Password123`):

| Email | Role in Acme Corp | Try this |
|---|---|---|
| `owner@acme.test` | Owner | *Settings*: SLA targets, business hours, require 2FA, single sign-on. *Members*: change roles. |
| `admin@acme.test` | Admin | Approve Jordan's pending join request and pending expenses; download the 30-day PDF report from the overview. |
| `alex@acme.test` | Member (IT Support) | *Service desk*: pick up the unassigned printer ticket, comment with an `@mention`, put a ticket on hold. |
| `sam@acme.test` | Member (Network) | Raise a ticket, then watch it update live in a second browser signed in as Alex. |
| `jordan@acme.test` | Not a member yet | Shows the "waiting for approval" state. |

To start from scratch instead, register a new account. Email verification is required before you can create an organisation. Without SMTP or Resend configured, verification and invitation links are printed in the API logs (`bun run docker:logs`).

## Key concepts

| Term | Meaning |
|---|---|
| Organisation | A workspace (company, department). All data belongs to one organisation, and people only see organisations they're members of. A person can belong to several. |
| Role | Each member is an **owner**, **admin** or **member** in each organisation (see [Roles and permissions](#roles-and-permissions)). |
| Team | A group of members inside an organisation, such as "IT Support". Tickets can be routed to a team's **queue**. |
| Ticket | A request or problem raised with the service desk. It has a type (incident, service request, problem, change, question), a priority (low → urgent), a status, a requester and optionally an assignee and team. |
| Requester / assignee / watcher | The person who raised the ticket, the person working on it, and anyone else following it. All three are notified about changes. |
| SLA | *Service-level agreement*: the deadlines a ticket must meet, set by its priority. **First response** is the first reply from someone other than the requester; **resolution** is when it's marked resolved. Missing either counts as a **breach**. |
| Business hours | Optional working days, hours, timezone and holidays. When enabled, SLA deadlines only count working time. |
| On hold | A ticket status that pauses the SLA clock, e.g. while waiting for the requester or a vendor. |
| Board / task | A kanban board of tasks with customisable columns, used for project work. |
| Goal | A target for a period: a manual metric, a number of tickets resolved, or an approved-spend budget. Its **health** says whether it's on track. |
| Audit log | An admin-visible record of sensitive actions: who did what, and from which IP. |

## Roles and permissions

Permissions apply per organisation. Each role can do everything the roles above it in this table can.

| Role | Can |
|---|---|
| Member | Raise, comment on and work on tickets; pick up unassigned tickets; reassign tickets they requested or are assigned to; export the queue to CSV; submit expenses; create goals; use the boards they belong to; invite people (an admin must approve). |
| Admin | Edit organisation settings, SLA targets, business hours and holidays; manage teams; approve or reject join requests and expenses (never their own); reassign or delete any ticket; see every board and manage board columns; remove members (but not other admins); read the audit log; download the PDF report. |
| Owner | Change members' roles; require 2FA; verify email domains and configure single sign-on; delete the organisation. An organisation always keeps at least one owner. |

## Modules

| Module | What it does |
|---|---|
| Service desk | Per-org numbered tickets (`ACME-42`); types: incident, request, problem, change, question. Every ticket gets a first-response and a resolution target from its priority, with breach tracking. Tickets move through a status workflow (new → open → in progress / on hold → resolved → closed, or cancelled) and can be assigned to a person and a team queue. They also have watchers, comments, and a full activity timeline. The queue filters by created, updated, resolved or due date (calendar days in the org's timezone, both ends inclusive), and **exports to CSV** with the same filters: timestamps in the org's timezone, up to `EXPORT_MAX_ROWS` rows (default 50,000; larger exports are refused rather than truncated). |
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
| Dashboards | A personal dashboard across all your organisations, and an organisation overview: open, breached and unassigned tickets, task progress, goal health, spend and each member's workload, plus a live activity feed. |
| Accounts | Email verification (required before creating organisations or inviting), forgot/reset password, sign out everywhere. Security alerts are emailed when 2FA, recovery codes or the password change. |
| Two-factor authentication | Authenticator-app codes (TOTP: Google Authenticator, 1Password, Microsoft Authenticator…) set up with a QR code, plus ten single-use recovery codes. Applies to password and Google sign-in. Owners can **require 2FA** for an organisation: members without it see a lock screen (and none of that org's content on dashboards or in notifications) until they turn it on, and can't turn it off while any org requires it. |
| Single sign-on | Per-organisation OpenID Connect (Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak…). Owners verify their email domains with a DNS TXT record, connect the identity provider, and **test the connection** with a real round trip. Options: automatic account creation (people on verified domains join as members on first sign-in) and **require SSO** (no password or Google sign-in for those domains, and existing non-SSO sessions end; owners keep password access for emergencies). A session from the org's identity provider also satisfies its 2FA requirement. |
| Admin | Roles (owner/admin/member), teams, org settings, audit log, 30-day PDF report. |

## Architecture

```
apps/frontend             Next.js 15 (App Router) · Tailwind · Radix · SWR          :3000
apps/backend              Express REST API · Zod validation · Prisma                  :4000
apps/websocket            Bun native WebSockets · fans out Redis pub/sub events       :4001
packages/db               Prisma schema, migrations, generated client (PostgreSQL)
packages/typescript-config, packages/eslint-config   shared tooling config
packages/ui               starter components from the monorepo template (the web app uses its own in apps/frontend/components/ui)
```

It's a [Turborepo](https://turbo.build) monorepo run with [Bun](https://bun.sh). PostgreSQL stores all data; Redis holds rate limits, the email queue and realtime events.

- The **API** writes to Postgres, then publishes a small event to Redis on `org:<id>`, `board:<id>` or `user:<id>`.
- The **websocket service** subscribes to those channels and forwards each event to the sockets allowed to see it. Any number of instances can run side by side.
- The **frontend** keeps one socket per session. An org event revalidates that org's cached queries, so lists, stats and detail pages update for everyone without a reload. Personal notifications show up as toasts and an unread badge.

### Where things live

| Path | Contents |
|---|---|
| `apps/backend/routes/index.ts` | Every API route in one file, with its auth, role checks and rate limits. The best place to start reading the backend. |
| `apps/backend/controllers/` | One file per area (tickets, boards, expenses, SSO…). Each handler validates input with Zod, runs queries scoped to the org, and serialises the response. |
| `apps/backend/domain/` | Pure business rules with no I/O: ticket workflow and permissions, SLA and business-hours arithmetic, goal health, date ranges. Unit-tested directly. |
| `apps/backend/services/` | Logic that spans several models or talks to the outside world: notifications and the email queue, audit log, SSO, 2FA, exports. |
| `apps/backend/lib/` | Infrastructure: env validation, Prisma and Redis clients, sessions and tokens, mailer, file storage, crypto, CSV, SSRF guard. |
| `apps/backend/middleware/` | Authentication, org/board/task access checks, rate limiting, request ids, error handling. |
| `apps/backend/scripts/` | `seed.ts` (demo data) and `mock-oidc.ts` (a local identity provider for SSO tests). |
| `apps/backend/tests/` | Integration tests against real Postgres/Redis; `tests/unit/` for pure logic. |
| `apps/frontend/app/` | Pages (App Router). Org pages are under `orgs/[orgId]/` (tickets, boards, expenses, goals, members, settings). |
| `apps/frontend/components/` | UI kit (`ui/`), app shell, charts, and feature components (tickets, kanban, settings). |
| `apps/frontend/lib/` | API client, auth context, SWR hooks, realtime socket client, shared types. |
| `apps/frontend/e2e/` | Playwright end-to-end tests. |
| `apps/websocket/` | Socket auth, channel access checks and fan-out. |
| `packages/db/prisma/` | `schema.prisma` (the data model) and migrations. |

## API overview

The web app is a client of a plain JSON REST API at `http://localhost:4000`, which other clients and scripts can use too.

- **Authentication.** `POST /auth/register` or `POST /auth/login` returns a token and sets an httpOnly session cookie. Browsers use the cookie; writes made with the cookie must also send the header `X-CSRF-Protection: 1`. Other clients send `Authorization: Bearer <token>` instead.
- **Scope.** Organisation data lives under `/organisations/:orgId/…` (tickets, teams, members, invitations, expenses, goals, SLA, analytics, security). Boards and tasks are at `/boards/:boardId` and `/tasks/:taskId`; personal data (dashboard, notifications, preferences) is at `/me/…`. The full list is in `apps/backend/routes/index.ts`.
- **Tickets** are addressed by number (`/organisations/:orgId/tickets/42`). `GET …/tickets` takes the queue's filters (`status`, `priority`, `type`, `assignee`, `team`, `q`, `from`, `to`, `dateField`, `sort`, `page`…), and `GET …/tickets/export.csv` takes the same filters.
- **Errors** are JSON: `{ "error": "Human-readable message", "code": "MACHINE_CODE" }`, plus `details` or `issues` for validation failures. Resources in another organisation return 404.
- **Health.** `GET /health` (process is up) and `GET /ready` (database and Redis reachable).

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

The demo logins are listed in [Try it in five minutes](#try-it-in-five-minutes).

Other root scripts: `bun run check-types`, `bun run lint`, `bun run build`, `bun run format`.

## Configuration

Each app reads its own `.env`, and each `.env.example` is commented and is the full reference. The API validates its settings at startup and refuses to boot if any are invalid. With Docker, a single root `.env` (from `.env.docker.example`) feeds all three services.

**API (`apps/backend/.env`)**

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL and Redis connections. |
| `JWT_SECRET` | Signs sessions; at least 32 random characters. `JWT_TTL` sets the session length (default `7d`). |
| `DATA_ENCRYPTION_KEY` | 32 random bytes (hex) encrypting 2FA and SSO secrets. **Required in production; back it up.** |
| `CORS_ORIGIN`, `FRONTEND_URL`, `API_PUBLIC_URL` | Where the web app and API are served; used for CORS, email links and SSO callbacks. |
| `COOKIE_DOMAIN`, `COOKIE_SECURE` | Session cookie scope; the web app and API must be same-site. |
| `SMTP_URL` or `RESEND_API_KEY`, `MAIL_FROM` | Email delivery. With neither, emails are printed to the API log. |
| `EMAIL_BATCH_WINDOW_SEC`, `EMAIL_WORKER` | Notification email batching, and whether this process sends queued email. |
| `UPLOAD_DIR`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENTS_PER_TICKET_MAX` | Attachment storage and limits. |
| `GOOGLE_CLIENT_ID` | Enables Google sign-in (optional). |
| `SSO_ALLOW_PRIVATE_NETWORK`, `SSO_ALLOW_HTTP_ISSUERS`, `SSO_DOMAIN_VERIFICATION` | Single sign-on safety switches; the last two are for development only. |
| `TRUST_PROXY` | Number of reverse proxies in front of the API, so rate limits and audit logs see real client IPs. |
| `RATE_LIMIT_*` | Request budgets: global, per user, bad credentials, login, signup and token lookups. |
| `EXPORT_MAX_ROWS` | Largest allowed CSV export (default 50,000). |

**Websocket (`apps/websocket/.env`):** `WS_PORT`, `DATABASE_URL`, `REDIS_URL`, and `WS_ALLOWED_ORIGINS` (required in production).

**Frontend (`apps/frontend/.env`):** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

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

bun run test          # from the repo root: backend (312) + websocket (10) + frontend unit (37)
```

Override the database and Redis with `TEST_DATABASE_URL` and `TEST_REDIS_URL`. Run only the backend's fast unit tests (no database needed) with `cd apps/backend && bun run test:unit`.

**End-to-end (Playwright)** runs against a live stack with the seeded demo data. The e2e suite signs in repeatedly, so start the API with a higher login limit:

```bash
cd apps/backend && bun run seed && RATE_LIMIT_AUTH_MAX=1000 bun run dev    # plus websocket + frontend
cd apps/frontend && bunx playwright install chromium
E2E_BASE_URL=http://localhost:3000 bun run test:e2e
```

The single sign-on e2e test also needs the mock identity provider and an API that trusts it (development only):

```bash
cd apps/backend && bun scripts/mock-oidc.ts    # http://localhost:4010, client perigo-e2e / perigo-e2e-secret
# start the API with SSO_ALLOW_HTTP_ISSUERS=true SSO_ALLOW_PRIVATE_NETWORK=true SSO_DOMAIN_VERIFICATION=skip
E2E_MOCK_IDP_URL=http://localhost:4010 E2E_BASE_URL=http://localhost:3000 bun run test:e2e
```

The e2e suite covers: login redirects and open-redirect protection, httpOnly session, sign-out, forgot password; two browsers checking that ticket assignment, status changes and comments arrive live; invite → register → accept → admin approval → access; board column management and presence; SLA settings, business hours and holidays, and a ticket's SLA pausing on hold; 2FA setup and sign-in with a code or recovery code; an org's 2FA requirement locking out a member; and single sign-on end to end (domain verification, connection test through the identity provider, auto-provisioning, then enforcement redirecting a password sign-in to SSO). Every e2e test also fails on page errors, console errors or unexpected 4xx/5xx responses.

- **Frontend unit.** The API client (cookie + CSRF header, 401 handling, open-redirect guard), formatting helpers and the timezone picker's names.
- **Backend.** Unit tests cover the ticket workflow and permissions, business-time arithmetic (weekends, holidays, timezones, DST) and SLA pause/resume, date ranges in an org's timezone, CSV quoting and formula neutralising, export batching and limits, TOTP against the RFC 4226/6238 vectors, secret encryption, and the SSRF address checks, goal health and integer positioning. Integration tests cover auth, sessions and hardening; organisations, roles and IDOR protection; the full invitation flow; tickets (including concurrency, notifications and realtime publishes); SLA settings, business-hours targets and pause/resume; date filters and CSV exports (timezone boundaries, headers, formula injection, audit, multi-batch ordering, size cap, rate limit, access); 2FA (setup, challenges, replay and brute-force limits, recovery codes, org requirements); single sign-on against a real OpenID Connect mock (PKCE, state binding, forged/tampered ID tokens, unverified domains, provisioning, enforcement, SSRF guard); boards and tasks; expenses and goals; dashboards and analytics. Every API response in every test is also checked for leaked `passwordHash`, `tokenVersion` or `tokenHash`.
- **Websocket.** Ticket auth, origin checks, channel authorisation, fan-out isolation, live access revocation, presence, and flood/oversize handling.

## Security model

- **Sessions.** Browsers hold the session in an httpOnly, SameSite=Lax cookie that JavaScript can't read. Cookie-authenticated writes require an `X-CSRF-Protection` header, which cross-site forms can't send and the CORS allowlist blocks for other origins. API clients can use a bearer token instead.
- **Account recovery.** Email verification and password-reset links are single-use, expiring, and stored only as SHA-256 hashes; a new link invalidates older ones. "Forgot password" gives the same response whether or not the account exists, and a reset signs out every session.
- **Authentication.** HS256 JWTs pinned to issuer and audience. Each token carries a `tokenVersion`, so changing the password or using "sign out everywhere" revokes every existing token immediately. bcrypt hashes; login takes the same time whether or not the email exists; generic credential errors; password policy. Google sign-in only links to an existing account when Google has verified the email.
- **Authorisation.** Every org-scoped query is filtered by the org id from the URL, never by an id supplied in the body. A resource from another org returns 404, not 403, so ids can't be probed. Role checks cover: last-owner protection, admins can't remove other admins, board visibility, the approval column gate, and separation of duties on expense approval.
- **Email.** Notification emails only reach verified addresses; unsubscribe links are HMAC-signed per user and category (RFC 8058 one-click), and the unsubscribe page requires a click so mail scanners can't switch people's emails off.
- **Uploads.** File type comes from the extension and must match the file's leading bytes (no trusting browser MIME types); SVG/HTML/executables are refused; files are stored under random ids, never the user's name; downloads send `Content-Disposition`, `nosniff` and a sandboxing CSP; access goes through the same org checks as the ticket.
- **Invitations.** Tokens are 256-bit and random, and only their SHA-256 is stored. Accepting requires both the token and a matching account email. Links expire, are single-use, and are replaced when an invite is resent.
- **Two-factor authentication.** TOTP secrets are encrypted at rest (AES-256-GCM, `DATA_ENCRYPTION_KEY`); recovery codes are stored as SHA-256 hashes. A correct password only yields a five-minute challenge, not a session, and a wrong password never reveals that 2FA is on. Each challenge allows five attempts; a code is claimed atomically so it can't be replayed, even concurrently; "sign out everywhere" voids pending challenges.
- **Single sign-on.** Authorization code flow with PKCE, nonce, and state bound to the browser by an httpOnly cookie (no login CSRF); ID token signatures are verified against the provider's JWKS even when they come straight from the token endpoint. An identity provider is only trusted for email domains its organisation has verified via DNS, and a domain can be verified by one organisation only, so a rogue provider can't sign in someone from another company. Client secrets are encrypted at rest and never returned or audited. Issuer URLs are fetched through an SSRF guard: https only, no redirects, no private, loopback, link-local or metadata addresses (unless `SSO_ALLOW_PRIVATE_NETWORK` is set for a self-hosted provider). Enforcement is re-checked on every request, so turning it on ends existing password sessions; owners are exempt so a broken provider can't lock everyone out.
- **Websockets.** A short-lived, single-use ticket from `POST /auth/ws-ticket` is used instead of putting the JWT in the URL. The server checks an origin allowlist, re-checks channel access (including an organisation's 2FA requirement) on subscribe, drops subscriptions the moment access is revoked, and enforces per-socket rate limits, a payload cap and connection caps.
- **Rate limits.** Redis-backed, so they hold across instances. Anonymous traffic is limited per IP; signed-in traffic per user, so a whole office behind one NAT or VPN address doesn't share a budget; invalid or revoked credentials are counted per IP so garbage tokens can't be used to flood. Login, signup, token lookups and verification emails have their own limits.
- **Exports.** CSV cells that begin with `=`, `+`, `-`, `@`, tab, CR, LF or a full-width equivalent are prefixed with `'` so spreadsheets treat them as text, not formulas. File names are sanitised before going into `Content-Disposition`. Exports go through the same org checks as the queue, are limited to 10 a minute per user, and are written to the audit log (row count and filters) before any data is sent.
- **HTTP.** Helmet with a strict CSP, a CORS allowlist, `Cache-Control: no-store`, request ids, a 256KB body cap, env validation at boot, no stack traces in responses, and graceful shutdown.
- **Frontend.** CSP and security headers, no tokens in JavaScript, open-redirect-safe `?next=`, HTML-escaped email templates, http(s)-only avatar URLs.
- **Audit log.** Role changes, membership, invitations and approvals, expense decisions, SLA and holiday changes, 2FA policy, domain and SSO changes (including connection tests and SSO-provisioned members), deletions and ticket exports, each with actor and IP.

## Upgrading an existing install

Always run `bunx prisma migrate deploy` (in `packages/db`) before starting a new build; `bun run docker:up` does this for you. Migrations keep existing data. The ones that change behaviour for existing installs, oldest first:

- `20260913100000_service_desk_mvp`: goal targets are renamed rather than dropped, existing invitation tokens are hashed so old links keep working, and pre-existing expenses are marked approved.
- `20260914090000_auth_tokens`: existing users are marked as verified so nobody is locked out.
- `20260915090000_sla_business_hours`: adds SLA policies, holidays and business hours. Business hours are off by default, so existing orgs keep 24/7 SLAs. Tickets already on hold start with a paused clock.
- `20260916090000_mfa_sso`: adds 2FA, recovery codes, verified domains and SSO connections. Nothing changes until users or owners opt in. Production now requires `DATA_ENCRYPTION_KEY`; `scripts/docker-up.sh` adds one to an existing `.env`. Back it up: without it, stored 2FA and SSO secrets can't be decrypted.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No verification or invitation email arrives | Without `SMTP_URL` or `RESEND_API_KEY`, emails are only printed to the API log. Copy the link from there (`bun run docker:logs`). |
| "Verify your email" when creating an organisation or inviting | Both need a verified email. Use the link from the email or the API log, or resend it from the banner at the top of the app. |
| Signed in, but every request returns 401 | The web app and API must be same-site for the session cookie. Check `CORS_ORIGIN`, `COOKIE_DOMAIN`, and `COOKIE_SECURE` (it must be `false` on plain http). |
| Live updates don't appear | The websocket service must be running and the web app's origin must be in `WS_ALLOWED_ORIGINS`. `NEXT_PUBLIC_WS_URL` must point to it. |
| API refuses to start with "Invalid environment configuration" | The message lists each bad variable. In production, `DATA_ENCRYPTION_KEY` is required and the development-only SSO switches are refused. |
| Tests refuse to run against a database | The test database name must contain `test` (tests truncate every table). |
| 429 Too Many Requests in local e2e runs | Start the API with `RATE_LIMIT_AUTH_MAX=1000`. |
| Type errors about Prisma models after pulling | Run `bun install` (it regenerates the Prisma client) and `bunx prisma migrate deploy` in `packages/db`. |

## License

[MIT](LICENSE) © 2026 Vinay Kaushal
