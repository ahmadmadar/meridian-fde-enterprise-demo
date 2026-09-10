# CLAUDE.md

Context for Claude Code sessions on this project. Read this before making
changes — it captures decisions already made so they don't get re-litigated
or re-broken.

## What this project is

An MCP server exposing a fictional B2B SaaS client's ("Meridian") internal
systems — accounts, support tickets, product usage, incidents — as tools
callable by Claude Desktop / any MCP client. Portfolio piece for FDE/SE
roles; the delivery process (this file included) is part of what's being
demonstrated, not just the code.

## Repo structure

Flat root — not a monorepo. `apps/mcp-server` + `apps/dashboard` was
considered and rejected; a shared-package monorepo wasn't earning its keep
for a two-deployable project. The dashboard (when built) is a separate
repo, deployed independently. Don't reintroduce an `apps/` nesting.

## Hard technical conventions — don't deviate without discussion

- **Module resolution is `NodeNext`** (`tsconfig.json`). All relative
  imports need the explicit `.js` extension, even in `.ts` source files —
  e.g. `import { x } from "./tools/foo.js"`, not `"./tools/foo"`. This has
  already caused TS2835 errors once; don't reintroduce extensionless
  imports.
- **`strict: true`** is on. Don't add `any` to silence an error — find the
  real type. Prisma transaction callbacks need an explicit
  `Prisma.TransactionClient` annotation on the `tx` param, e.g.
  `prisma.$transaction(async (tx: Prisma.TransactionClient) => { ... })`.
- **No fallback values for API keys.** `src/auth/scopes.ts` reads
  `MCP_KEY_AGENT` / `MCP_KEY_DASHBOARD` directly from `process.env` with no
  `||` default — the server throws on startup if either is missing. This
  was a deliberate fix (see `docs/ai-assisted-delivery.md`, Day X) to avoid
  shipping a guessable key in source. Don't reintroduce a fallback.
- **Every tool follows the same shape:** zod input schema → `authenticate()`
  → `requireScope()` → Prisma query/mutation → return plain object. See
  `src/tools/get_account_360.ts` (read) and
  `src/tools/update_ticket_status.ts` (write + business rule) as the
  reference pattern for any new tool.
- **Errors are structured, not generic.** Throw an `Error` with a `.code`
  property (`NOT_FOUND`, `VALIDATION_ERROR`, `FORBIDDEN_SCOPE`, `CONFLICT`,
  `UNAUTHORIZED`) — `mapErrorToToolResult()` in `server.ts` handles mapping
  it to the tool response. Don't throw bare errors or return raw 500s.
- **Writes get audited.** Any tool that mutates data (`create_ticket`,
  `update_ticket_status`) must write an `AuditLog` entry in the same
  `prisma.$transaction` as the mutation — atomic, not a separate call.
- **Ticket state machine** (`update_ticket_status.ts`,
  `ALLOWED_TRANSITIONS`): `OPEN → INVESTIGATING/CLOSED`,
  `INVESTIGATING → ESCALATED/RESOLVED`, `ESCALATED → RESOLVED`,
  `RESOLVED → CLOSED`, `CLOSED` terminal. Enforce server-side; reject
  anything else with `CONFLICT`.
- **Derived/computed filters become range queries, not in-memory
  filtering.** When a tool filters on a value that isn't a stored column
  (e.g. `search_tickets`'s `sla_risk`, derived from `slaDeadline` vs.
  `now()`), translate it into a Prisma `where` clause (a date range, here)
  rather than fetching broadly and filtering in JS — it has to stay
  correct and fast at real ticket volume, not just against a small seeded
  set. See `search_tickets.ts`.
- **List/search tools default to the active subset, not the full table.**
  An unscoped list/search call (e.g. `search_tickets` with no `status`
  filter) returns the active rows (`OPEN`/`INVESTIGATING`/`ESCALATED` for
  tickets) unless the caller passes an explicit filter that overrides it —
  matches the default `get_account_360`'s open-tickets include already
  uses. Don't default to returning every row regardless of status.
- **MCP tool content literals need `as const` on `type`.** A bare
  `content: [{ type: "text", ... }]` returned from a function with no
  explicit return type gets `type` widened from the literal `"text"` to
  `string` under `strict: true`, which fails the MCP SDK's `registerTool`
  callback signature (`tsc --noEmit` catches it; `tsx`/`npm run dev` does
  not, since it transpiles without full type-checking). Always write
  `type: "text" as const` — see `mapErrorToToolResult()` in `server.ts`.
- **Build a fresh `McpServer` per request — never a shared module-level
  instance.** `server.ts`'s `POST /mcp` handler calls `buildServer()`
  (which registers all tools and returns a new `McpServer`) on every
  request. This was originally a single instance built once at module
  scope; the underlying SDK's `Server.connect()` throws
  ("Already connected to a transport") if called while still connected
  to a previous request's transport, which only surfaces under
  overlapping requests — sequential manual curl testing never triggered
  it, but real concurrent traffic (or a parallel test suite) does.
  `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`
  is the SDK's stateless mode; a fresh server+transport pair per request
  is the correct pattern for it. Don't revert to a shared instance.

## Version control

GitHub Desktop, not `gh` CLI. Branch per feature, PR template at
`.github/PULL_REQUEST_TEMPLATE.md`, conventional commit format
(`feat:`, `fix:`, `docs:`, `test:`) in the commit summary field.

## Session workflow

One tool per Claude Code session — don't build multiple tools in a single
session. Each session follows this sequence:

1. **Start**: read this file first.
2. **Design walkthrough before code**: for any new tool, walk through the
   plan before writing it — schema, auth/scope, the Prisma shape, error
   cases, return shape. If the tool needs a real business-logic decision
   not already established here (an SLA policy, a state machine, a scope
   boundary), surface it as a question rather than inventing it
   unilaterally — audited business logic (see "Writes get audited" above)
   shouldn't be an unreviewed guess.
3. **Implement**, following the reference pattern in "Hard technical
   conventions" above.
4. **Test end-to-end** — not just the API response shape. For write
   tools, verify actual DB/audit-log state (Prisma Studio or a direct
   Prisma query), including that rejected/invalid calls write zero rows.
5. **Update docs before ending the session**: "Current build status"
   below, and `docs/ai-assisted-delivery.md` (architectural decisions,
   engagement log, and a "what got caught" entry if something was wrong
   and fixed).
6. **Commit via GitHub Desktop** — conventional commit summary, concise
   description; see "Version control" above.

The exact prompt text for each step lives in a personal, gitignored
`prompts.txt` at the repo root (not committed — see the Day 3 entry in
`docs/ai-assisted-delivery.md`).

## Automated tests

`npm test` runs the `vitest` suite in `test/` — integration tests
against the *real* running server and a *real* Postgres test database
(`meridian_test`), not mocks. This was a deliberate choice: the bugs
this build actually caught (`Prisma.DbNull` vs. `JsonNull`, the SDK
validation short-circuit, the `take:limit`-before-filter correctness
issue, the server concurrency bug below) all live at the integration
boundary — a mocked-Prisma unit-test layer would have missed every one
of them.

- **Test files live in `test/`, not `src/`.** `tsconfig.json`'s
  `include` is scoped to `src` only, so anything in `test/` is
  automatically excluded from the production build/Docker image with no
  extra config. Don't move test files into `src/tools/`.
- **`test/fixtures.ts` provides deterministic fixture creators**
  (`createAccount`, `createTicket`, `createProductUsage`,
  `createIncident`, `resetDb`). `prisma/seed.ts` is randomized
  (`Math.random()` throughout, no fixed seed) — fine for local dev data,
  useless as a base for tests needing exact expected result sets. New
  tests should use the fixtures, not depend on `prisma/seed.ts`'s
  output.
- **`vitest.config.ts` sets `fileParallelism: false`.** Every test file
  shares the one real test DB and one spawned server instance; running
  files in parallel causes one file's `resetDb()` (`TRUNCATE ... CASCADE`)
  to race against another file's fixtures mid-test. Don't re-enable
  parallelism without adding real per-worker isolation (a separate
  schema/DB per worker) — that's a bigger investment than this suite's
  size currently justifies.
- **Setup requires `.env.test`** (gitignored, same shape as `.env`) and
  a `meridian_test` database in the same Postgres container as dev
  (`CREATE DATABASE meridian_test;`). `test/global-setup.ts` applies
  migrations and spawns the server against it automatically — `npm test`
  alone is the whole story once `.env.test` exists.

## Documentation habit — do this every session, not after

- `docs/ai-assisted-delivery.md` — log what you (Claude Code) generated,
  what required a human architectural decision, and especially **what you
  got wrong and how it was caught**. This last category is the highest-value
  content in the repo; don't skip logging a real catch because it feels
  like admitting a flaw.
- `docs/setup.md` — update if a setup/run command changes or was found to
  be wrong (e.g. the missing `Accept` header on the curl example, already
  fixed once).
- Engagement log entries are dated, first-person, specific — not vague
  summaries. "Day 2: caught TS2835 errors from missing .js extensions,
  fixed across 3 files" not "fixed some bugs."

## Current build status

`get_account_360` (read), `update_ticket_status` (write + state machine),
`search_tickets` (read, filtered list), `create_ticket` (write), and
`check_incident_impact` (read, composite lookup) are done and verified
end-to-end via curl. `get_account_360` and `update_ticket_status` are
fully tested — legal/illegal/terminal transitions, scope enforcement, and
bad-input handling all confirmed against the actual database state, not
just API responses. `search_tickets` is verified for each filter
individually and in composition (`sla_risk`, `priority`, `category`,
`status`, `account_id`, `limit`) plus validation and auth rejection —
read-only, so no Prisma Studio pass needed. `create_ticket` is verified
for valid create (SLA math confirmed directly, not just trusted), bad
`account_id` → `NOT_FOUND`, invalid `priority` → rejected, and
wrong-scope key → `FORBIDDEN_SCOPE`, with DB state confirmed via direct
Prisma query that rejected calls wrote zero rows. `check_incident_impact`
is verified for a valid `incident_id` (hand-checked `total_mrr_impacted_usd`
against the affected accounts' individual `mrr`), bad `incident_id` →
`NOT_FOUND`, and bogus API key → `UNAUTHORIZED`; both API keys carry
`read:incidents`, so there's no key/scope combination to exercise a
`FORBIDDEN_SCOPE` case for this tool. It reports account-level business
exposure only — `Ticket` has no `incidentId`, so incidents and tickets
aren't directly correlated in the schema. `get_renewal_risk` (read,
portfolio list) is also done and verified — lists accounts renewing
within a window (default 90 days) with a derived `risk_level`
(high/medium/low, from `healthScore < 50` and `usageTrend === "down"`).
Verified the default window, all three `risk_level` filter values against
hand-computed expected sets, `within_days` override, `account_id` filter,
and auth rejection. Both API keys carry `read:accounts`, so — same as
`check_incident_impact` — there's no `FORBIDDEN_SCOPE` case to test for
this tool. `get_audit_log` (read, list/search) is also done and
verified — the seventh and final tool in the build order. Gated behind a
new `admin` scope (added to `claude-agent-prod` only; `dashboard-readonly`
does not have it) rather than reusing a domain read scope, since audit
rows expose before/after mutation snapshots across every entity type.
Filters: `entity_type`, `entity_id`, `account_id`, `actor`, `action`,
`since`. No "active subset" default exists for immutable history the way
`search_tickets` has ticket statuses — an unscoped call returns the most
recent entries ordered `createdAt desc`, bounded by `limit`. This is the
first tool where `FORBIDDEN_SCOPE` was actually testable (every prior
read tool's scope was shared by both API keys). Verified all six filters
against real audit data and confirmed the `scopes.ts` change didn't
regress any existing tool.

All seven planned tools are now built and verified:
`get_account_360`, `update_ticket_status`, `search_tickets`,
`create_ticket`, `check_incident_impact`, `get_renewal_risk`,
`get_audit_log`.

Deployment prep for Render is done, not yet executed. The Dockerfile's
`CMD` now runs `npx prisma migrate deploy && npm run start` on every
boot (previously a bare `npm run start`), since the free tier has no
Shell access to run migrations manually later. A `GET /health` route
was added to `server.ts` for Render's health check, since previously
only `POST /mcp` existed. Both changes were verified with a full local
`docker build` + `docker run` smoke test: booting against an
already-migrated DB correctly logged "No pending migrations to
apply," and booting against a freshly created empty DB correctly
applied migration `20260901194204_init` before the server started
listening. A `render.yaml` Blueprint was added declaring the web
service (Docker runtime, free plan, `/health` check) and a free
Postgres instance, with `MCP_KEY_AGENT` and `MCP_KEY_DASHBOARD` marked
`sync: false` so real key values are entered directly in Render's
dashboard and never touch the repo. Actual Render account setup,
Blueprint apply, and key generation are still pending as of this
writing.

An automated `vitest` integration suite now covers all seven tools plus
cross-cutting auth/validation checks — 8 test files, 40 tests, all
passing (see "Automated tests" above for how to run it). Building it
surfaced a real production bug, not just a testing gap: `server.ts`
reused one module-level `McpServer` instance across every request,
which crashes under overlapping requests (fixed via a per-request
`buildServer()` factory — see "Hard technical conventions"). Manual
curl testing every prior session was always strictly sequential, so
this had no way to surface until the suite ran multiple requests
concurrently. Verified the fix both via the suite (10 concurrent
requests) and directly against the dev server (5 concurrent curl
requests, zero errors).

## Next steps

Agreed build order (backend done, this is what's left):

1. ~~Eval scenarios + runner scripts~~ — done as the `vitest` suite above,
   after clarifying the actual goal was automating manual curl
   verification, not an LLM tool-selection eval.
2. **Next.js dashboard** — separate repo, not started. "Read-only + chat"
   per `docs/architecture.md`'s one-line sketch, not yet fully scoped.
   Key constraints already decided: the `dashboard-readonly` API key
   must stay server-side only (Next.js API routes/server components),
   never reach the browser; `get_audit_log` is out of reach for this
   dashboard since `dashboard-readonly` deliberately lacks `admin`.
   Recommend building the read-only screens (renewal-risk portfolio
   view, incidents, tickets, account drill-down) before the chat
   feature, which is a materially bigger scope jump (the dashboard
   backend becomes its own MCP client running an agent loop).
3. **Deploy** — Render (Docker-runtime web service on the free tier,
   matches the existing `Dockerfile`) for this MCP server, Vercel for
   the dashboard once built. Switched from the originally planned
   Fly.io after checking Fly's actual free-tier terms: a 2-hour/7-day
   trial that then requires a card on file. Render's free web service
   (750 hrs/month) and free Postgres need none. **Operational note:**
   Render's free Postgres instance expires 30-90 days after creation
   (confirm the exact current window in Render's dashboard). When it
   does, the database is gone and must be recreated and re-seeded
   (`npm run db:seed` against the new instance) from scratch. This is
   a recurring maintenance item, not a one-time setup cost, so check
   the instance's age before assuming demo data still exists.
4. **Connect Claude Desktop** to the deployed server and run
   `docs/demo-script.md` live — recommended to do this right after
   step 3's server deploy, *before* building the dashboard, so the
   dashboard is built against a proven-working deployed server instead
   of an unverified one. Still unverified as of this writing — every
   test so far has been against `localhost`.
5. **Finalize docs** — `README.md`, `docs/architecture.md` (still a
   stub — "*Will fill in once the build stabilizes*", empty diagram
   section), and `docs/ai-assisted-delivery.md`'s engagement log, once
   the dashboard and both deployments actually exist to describe.

`TICKET_STATUSES`, `TICKET_PRIORITIES`, and `ACTIVE_TICKET_STATUSES` now
live in `src/tools/constants.ts` (extracted once a third tool needed
them) — import from there rather than redeclaring locally in a new tool.

Known gap, not yet fixed: the MCP SDK validates each tool's
`inputSchema.shape` itself and returns a JSON-RPC `-32602` error before
the handler runs, so `mapErrorToToolResult`'s `VALIDATION_ERROR` branch
never actually fires for ordinary bad-input cases (missing fields, bad
enum values) — confirmed across multiple tools, not tool-specific. Bad
input is still rejected correctly with no DB writes; this only affects
which error envelope the caller sees. See `docs/ai-assisted-delivery.md`
for the full writeup.

Testing convention established: for any write tool, verify not just the
API response shape but the actual DB/audit-log state via Prisma Studio
(or a direct Prisma query) — especially for rejected writes, confirm
nothing changed. For any list/search tool with a derived filter, verify
the filter against hand-computed expected results, not just that it
returns *something* plausible. Keep this bar for any new tool added
beyond the original seven.