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

## Version control

GitHub Desktop, not `gh` CLI. Branch per feature, PR template at
`.github/PULL_REQUEST_TEMPLATE.md`, conventional commit format
(`feat:`, `fix:`, `docs:`, `test:`) in the commit summary field.

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
and `search_tickets` (read, filtered list) are done and verified
end-to-end via curl. `get_account_360` and `update_ticket_status` are
fully tested — legal/illegal/terminal transitions, scope enforcement, and
bad-input handling all confirmed against the actual database state, not
just API responses. `search_tickets` is verified for each filter
individually and in composition (`sla_risk`, `priority`, `category`,
`status`, `account_id`, `limit`) plus validation and auth rejection —
read-only, so no Prisma Studio pass needed. Remaining tools:
`create_ticket`, `check_incident_impact`, `get_renewal_risk`,
`get_audit_log` — build in that order, following the established
pattern. `get_audit_log` should come after `create_ticket` so there's
something in the audit log to query.

Testing convention established: for any write tool, verify not just the
API response shape but the actual DB/audit-log state via Prisma Studio —
especially for rejected writes, confirm nothing changed. Keep this bar
for `create_ticket` when it's built.