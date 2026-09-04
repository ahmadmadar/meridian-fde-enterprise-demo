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

`get_account_360` (read) and `update_ticket_status` (write + state
machine) are done, verified end-to-end via curl, and fully tested —
legal/illegal/terminal transitions, scope enforcement, and bad-input
handling all confirmed against the actual database state, not just API
responses. Remaining tools: `search_tickets`, `create_ticket`,
`check_incident_impact`, `get_renewal_risk`, `get_audit_log` — build in
that order, following the established pattern. `get_audit_log` should
come after `create_ticket` so there's something in the audit log to
query.

Testing convention established: for any write tool, verify not just the
API response shape but the actual DB/audit-log state via Prisma Studio —
especially for rejected writes, confirm nothing changed. Keep this bar
for `create_ticket` when it's built.