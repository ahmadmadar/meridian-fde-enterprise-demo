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

- [ ] Prisma schema first draft
- [ ] Seed script for mock Meridian data
- [ ] MCP tool boilerplate (registration, Zod validation)
- [ ] Individual tool implementations (list per tool as built)
- [ ] Auth/scope middleware first draft
- [ ] Vitest test scaffolding
- [ ] README / docs first drafts

## What required architectural decisions

- Data model shape: which four domains, and why `get_account_360` is the
  composite call rather than four separate lookups
- Ticket state machine: allowed transitions, and why illegal transitions
  return `CONFLICT` instead of silently succeeding
- Auth scope design: `read:*` vs `write:*` vs `admin`, and which tools
  require which scope
- Repo structure: flat root instead of a monorepo — decided a
  shared-package monorepo wasn't earning its keep for a two-deployable
  project

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

## Engagement log

- **Day 1:** Scoped the four data domains and eight tools; decided against
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
  database and audit log completely untouched — confirms the
  `$transaction` wrapping and pre-write validation are both working as
  designed, not just returning correct-looking error messages.

