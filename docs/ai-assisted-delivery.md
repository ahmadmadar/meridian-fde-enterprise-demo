# AI-Assisted Delivery Log

This project was built using an AI-assisted delivery workflow — Claude Code
(CLI/VS Code extension) handled scaffolding, implementation drafts, and
boilerplate, while architecture, business logic, and review remained a
human-in-the-loop process. This doc makes that split explicit: what was
generated, what was decided, and what was caught and corrected along the way.

This is also, deliberately, the actual FDE/SE delivery model — clients want
speed without sacrificing engineering judgment. This project demonstrates
both.

**Tool:** Claude Code (CLI/VS Code extension)
**Version control:** GitHub Desktop
**Model of engagement:** each build-order phase run as a short Claude Code
session — scope the task, prompt, review the diff (via GitHub Desktop's
diff view), correct/redirect as needed, commit.

---

## What Claude Code generated

- [x] Prisma schema first draft
- [x] Seed script for mock Meridian data
- [x] MCP tool boilerplate (registration, Zod validation)
- Individual tool implementations:
  - [x] `get_account_360`
  - [x] `update_ticket_status`
  - [x] `search_tickets`
  - [ ] `create_ticket`
  - [ ] `check_incident_impact`
  - [ ] `get_renewal_risk`
  - [ ] `get_audit_log`
- [x] Auth/scope middleware first draft
- [ ] Vitest test scaffolding — `vitest` is a devDependency and `npm test`
      is wired in `package.json`, but no `vitest.config.*` or `*.test.ts`
      files exist yet. "Test suite" in the Day 3 log entry below refers to
      manual curl + Prisma Studio verification, not automated tests — this
      is a real gap, not just an unchecked box.
- [x] README / docs first drafts

## What required architectural decisions

- Data model shape: which four domains, why `get_account_360` is the
  composite call rather than four separate lookups, and dropping a fifth
  "billing history" domain to keep the demo scope tight
- Ticket state machine: allowed transitions, and why illegal transitions
  return `CONFLICT` instead of silently succeeding
- Auth scope design: `read:*` vs `write:*` vs `admin`, and which tools
  require which scope
- Audit logging design: every mutating tool writes its `AuditLog` entry
  inside the same `$transaction` as the mutation, not as a separate call —
  so a rejected write can never leave a partial or inconsistent audit
  trail. Verified, not just implemented: Day 3 testing confirmed via
  Prisma Studio that an illegal transition leaves both the ticket row and
  the audit log completely untouched.
- Repo structure: flat root instead of a monorepo — decided a
  shared-package monorepo wasn't earning its keep for a two-deployable
  project
- SLA risk as a derived-not-stored field: `search_tickets`'s
  `breached`/`at_risk`/`ok` filter isn't a column — decided to translate
  it into a `where`-clause date range rather than fetch-and-filter in JS,
  so it stays queryable at real ticket volume, with the 24h "at risk"
  window as a named, callable-out default rather than a buried magic
  number
- Default status scope for `search_tickets`: an unscoped search defaults
  to active tickets (`OPEN`/`INVESTIGATING`/`ESCALATED`) rather than all
  tickets, matching the same default `get_account_360` already applies to
  its open-tickets include

## What Claude Code got wrong

> **Issue:** `scopes.ts` had hardcoded fallback values (`|| "demo-agent-key"`,
> `|| "demo-dashboard-key"`) for the API keys. Since this fallback lives in
> source code, it would ship to the public repo — meaning a deployed server
> running without the env vars set would silently accept a known, guessable
> key with write access, rather than failing.
> **Caught by:** Manual review before the first public push.
> **Fix:** Removed the fallbacks entirely and added an explicit startup
> check — the server now throws on load if `MCP_KEY_AGENT` or
> `MCP_KEY_DASHBOARD` aren't set, so auth fails closed instead of falling
> back to a known value.

> **Issue:** The documented curl test command (in `docs/setup.md`) was
> missing the `Accept: application/json, text/event-stream` header. The
> server's `StreamableHTTPServerTransport` requires the client to declare
> it accepts both response formats — without it, the request fails before
> reaching the tool logic.
> **Caught by:** Manual testing — first curl attempt against `get_account_360`
> didn't return a usable response until the header was added.
> **Fix:** Added `-H "Accept: application/json, text/event-stream"` to the
> curl command and updated `docs/setup.md` so the documented command works
> as written for the next person (or future me) who runs it.

> **Issue:** TypeScript compile errors across `update_ticket_status.ts`,
> `get_account_360.ts`, and `server.ts`.
> **Root cause:** `tsconfig.json` sets `"module": "NodeNext"` /
> `"moduleResolution": "NodeNext"`, which requires relative imports to
> carry the explicit runtime `.js` extension even in `.ts` source — Node's
> native ESM resolver has no extension-inference step. All relative
> imports in the starter code omitted the extension, producing TS2835
> errors. Separately, `"strict": true` surfaced an implicit-`any` on the
> `tx` parameter of a `prisma.$transaction(async (tx) => …)` callback in
> `update_ticket_status.ts`, since Prisma's transaction-client type wasn't
> being inferred and needed an explicit annotation.
> **Caught by:** Claude Code (VS Code), running `npx tsc --noEmit` during
> the session.
> **Fix:** Added `.js` extensions to all relative imports in
> `src/server.ts`, `src/tools/get_account_360.ts`, and
> `src/tools/update_ticket_status.ts`. Imported `Prisma` from
> `@prisma/client` and annotated the transaction callback as
> `Prisma.TransactionClient` in `update_ticket_status.ts`.
> **Verification:** `npx tsc --noEmit` — both files clean post-fix.
> **Residual/out of scope:** `server.ts` has one remaining, unrelated type
> error (SDK content-array literal-type mismatch on the `registerTool`
> handler) — pre-existing, not touched by this fix, flagged for separate
> follow-up.

> **Issue:** `mapErrorToToolResult()` in `server.ts` returned
> `content: [{ type: "text", text: ... }]` with no contextual type
> annotation, so TypeScript widened `type` from the literal `"text"` to
> `string`. This silently broke all three `registerTool` handlers
> (`get_account_360`, `update_ticket_status`, and the new
> `search_tickets`) against `tsc --noEmit`, since the MCP SDK's callback
> signature requires the literal `"text"`. It went unnoticed because
> `npm run dev` runs through `tsx`, which transpiles but doesn't
> full-typecheck.
> **Caught by:** `npx tsc --noEmit`, run while building `search_tickets` —
> this was the item flagged as a residual follow-up in the Day 3 entry
> above.
> **Fix:** Added `as const` to the `type: "text"` literal in
> `mapErrorToToolResult`'s return (`server.ts`).
> **Verification:** `npx tsc --noEmit` clean across all three tools.
> `search_tickets` also verified end-to-end via curl against seeded data —
> default active-status scope, `sla_risk` (breached/at_risk/ok,
> partitioning exactly to the active-ticket total), `priority`,
> `category`, `status` override, `limit`, `account_id`, invalid-enum
> rejection, and missing-API-key rejection all confirmed correct.

## Engagement log

- **Day 1:** Scoped the four data domains and seven tools; decided against
  a fifth "billing history" domain to keep the demo tight.
- **Day 1:** Reconciled repo structure — dropped the initial monorepo plan
  (`apps/mcp-server` + `apps/dashboard`) in favor of a flat root for the
  server, dashboard as its own repo.
- **Day 1:** Reviewed `scopes.ts` before the first public push; caught that
  the fallback API key values were hardcoded into source rather than
  env-only. Removed the fallbacks and added a fail-closed startup check.
- **Day 2:** Ran the first live end-to-end test of `get_account_360` via
  curl. Initial request failed silently until adding an
  `Accept: application/json, text/event-stream` header — required by the
  streamable HTTP transport but missing from the original docs. Verified
  the full response: cross-system join across billing, usage, open
  tickets, and active incident data returned correctly for a seeded
  Enterprise account. First fully working vertical slice confirmed:
  auth → validation → Prisma query → joined result.
- **Day 3:** Ran `npx tsc --noEmit` via Claude Code and caught a batch of
  TypeScript errors across the tool files — missing `.js` extensions on
  relative imports (required by `NodeNext` module resolution) and an
  implicit-`any` on the Prisma transaction callback in
  `update_ticket_status.ts`. Fixed both classes of error; confirmed clean
  via a second `tsc` run. Left one pre-existing, unrelated SDK type
  mismatch in `server.ts` untouched and flagged for later.
- **Day 3:** Registered `update_ticket_status` in `server.ts`, following
  the same registration pattern as `get_account_360` — schema, API key
  extraction, handler, mapped errors. Import uses the explicit `.js`
  extension per the NodeNext resolution fix made earlier today.
- **Day 3:** Ran the full test suite against `update_ticket_status` —
  legal transition, illegal transition, terminal-state exit, scope
  enforcement (valid key/wrong scope, no key), and bad input (nonexistent
  id, invalid enum). All five categories passed. Verified via Prisma
  Studio, not just the API response, that rejected transitions leave the
  database and audit log completely untouched, confirms the
  `$transaction` wrapping and pre-write validation are both working as
  designed, not just returning correct-looking error messages.
- **Day 3:** Set up a gitignored `prompts.txt` for standardized session
  prompts (session initializer, end-of-session CLAUDE.md update, pre-commit
  review). Reduces variance in Claude Code's output from re-phrasing the
  same instructions differently each session and keeps the pre-commit
  review step consistent. Kept out of version control since it's a
  personal workflow aid, not project documentation; conventions that
  emerge from it that are worth documenting get promoted into `CLAUDE.md`
  directly.
- **Day 4:** Built `search_tickets` — filters by `sla_risk` (derived from
  `slaDeadline`, not a stored column; translated into a `where` range
  rather than filtered in-memory so it stays queryable at volume),
  `priority`, `category`, `status`, and `account_id`, defaulting to
  active tickets (OPEN/INVESTIGATING/ESCALATED) when no status is given.
  Registering it as a third `registerTool` caller surfaced the
  `type: "text"` widening bug flagged as a Day 3 residual; fixed with
  `as const`, confirmed `tsc --noEmit` clean across all tools. Verified
  all filters end-to-end via curl against seeded data, including that the
  SLA-risk buckets partition exactly to the active-ticket count.

