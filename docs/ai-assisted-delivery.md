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
  - [x] `create_ticket`
  - [x] `check_incident_impact`
  - [x] `get_renewal_risk`
  - [x] `get_audit_log`
  - [x] `list_active_incidents`
- [x] Auth/scope middleware first draft
- [x] Vitest test scaffolding — `vitest.config.ts` + `test/` (9 files,
      45 tests) now exist, gated behind a `meridian_test` DB and
      `.env.test`. Integration-style throughout (real HTTP + real
      Postgres, no mocks) — see the architectural-decisions entry below
      for why. "Test suite" in the Day 3 log entry below still refers to
      the manual curl + Prisma Studio era, before this existed.
- [x] README / docs first drafts
- [x] Render deployment config: Dockerfile CMD update for
      migrate-on-boot, `GET /health` endpoint, `render.yaml` Blueprint

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
- `create_ticket`'s SLA policy: no SLA-hours policy existed anywhere in the
  repo before this tool (the seed script just randomizes `slaDeadline`).
  Settled with the user on a mid-market B2B SaaS support benchmark — P1=4h,
  P2=8h, P3=48h, P4=120h — as flat wall-clock hours rather than
  business-hours/timezone-aware, since the schema has no calendar concept
  to hang that on. Encoded as `SLA_HOURS_BY_PRIORITY`, parallel to how
  `ALLOWED_TRANSITIONS` encodes the ticket state machine.
- `create_ticket` validates the `account_id` foreign key exists before
  inserting, rather than letting a bad id surface as a raw Prisma
  FK-constraint error — same NOT_FOUND-before-write pattern
  `get_account_360` already uses for account lookups.
- Extracted `TICKET_STATUSES`, `TICKET_PRIORITIES`, and
  `ACTIVE_TICKET_STATUSES` into a shared `src/tools/constants.ts` once a
  third tool (`create_ticket`) needed the same enums — `update_ticket_status.ts`
  and `search_tickets.ts` were each independently duplicating the arrays.
  Decided against extracting earlier (two duplicates was fine per
  CLAUDE.md's anti-premature-abstraction guidance); three was the actual
  trigger.
- `Prisma.DbNull` vs. `Prisma.JsonNull` for the audit log's `before` field
  on create: decided `DbNull` (a real SQL NULL) is the correct semantic
  for "no prior state existed," not `JsonNull` (a stored JSON `null`
  value) — `create_ticket` is the first write tool where `before` is
  legitimately empty rather than a prior-status snapshot.
- `check_incident_impact`'s scope and metrics: confirmed with the user
  before building rather than guessing. Scoped to a single `incident_id`
  lookup (matching `get_account_360`'s composite-lookup shape) rather than
  a list/search over all active incidents. Impact metrics limited to
  `account_count` and `total_mrr_impacted_usd` — deliberately did not add
  an `enterprise_count` or a health-score-based "at risk" bucket, since no
  health-score threshold exists anywhere else in the codebase and
  inventing one for an aggregate would be an unreviewed policy call.
- `check_incident_impact` reports account-level impact only, not a
  ticket correlation — the schema has no `incidentId` on `Ticket`, so
  incidents and tickets are only indirectly related via shared
  `accountId`. Correlating them would require guessing at a heuristic
  (e.g. tickets opened during the incident window) that isn't in the data
  model; left out rather than approximated.
- `get_renewal_risk`'s scope and risk model: confirmed with the user
  before building. Portfolio list (accounts renewing within a window),
  not a single-account lookup — `account_id` is an optional narrowing
  filter, same role it plays in `search_tickets`. Risk signals limited to
  `healthScore < 50` and `usageTrend === "down"` (declined seat
  utilization and open-ticket signals, to keep the first version
  self-contained on `Account`/`ProductUsage`), combined into a
  three-tier `high`/`medium`/`low` `risk_level` — `high` requires both
  signals, `medium` exactly one, `low` neither — matching
  `search_tickets`'s `breached`/`at_risk`/`ok` three-bucket precedent.
  Default renewal window is 90 days (one quarter, standard CS
  renewal-prep horizon), overridable via `within_days`.
- `get_renewal_risk`'s `risk_level` filter is a real Prisma `where`
  clause (nested `AND`/`OR` over `healthScore` and the related
  `ProductUsage.usageTrend`), not computed in JS after fetching —
  initially drafted it as a post-fetch JS filter, then caught during
  design that applying it after Prisma's `take: limit` could silently
  return fewer results than requested (or miss later-sorted matches) as
  account volume grows, the same correctness concern
  `search_tickets`'s `sla_risk` range-query treatment exists to prevent.
  Corrected before writing the implementation, not after testing caught
  it.
- Testing philosophy for the automated suite: integration-first, not
  mocked-unit-first — deliberately not the default choice. Every real
  bug this build caught (`Prisma.DbNull` vs. `JsonNull`, the SDK
  validation short-circuit, the `take:limit`-before-filter issue in
  `get_renewal_risk`, the server concurrency bug below) lived at the
  integration boundary — a mocked-Prisma unit-test layer would have
  missed every one. The one exception:
  `get_renewal_risk`'s `computeRiskLevel()` is a standalone pure
  function with no I/O, and is the one place a true unit test would
  earn its keep.
- Test fixtures are deterministic, not built on `prisma/seed.ts` —
  discovered mid-design that the seed script uses `Math.random()`
  throughout with no fixed seed, so re-seeding produces different data
  every run. Tests asserting exact expected sets (e.g. "these two
  accounts are high risk") can't be built on top of that. Added
  `test/fixtures.ts` with small, known creators instead
  (`createAccount`, `createTicket`, etc.), each test building its own
  known data rather than depending on shared random output.
- Test database: a second database (`meridian_test`) in the existing
  `meridian-pg` container rather than a new container/service —
  Postgres supports multiple databases per instance natively, so this
  needed no new infra. `.env.test` (gitignored) points at it with a
  distinct `PORT` (avoids colliding with a locally running dev server)
  and `LOG_LEVEL=silent` (clean test output).
- `vitest.config.ts` sets `fileParallelism: false` — every test file
  shares the one real test DB and one spawned server instance, so
  running files in parallel let one file's `resetDb()`
  (`TRUNCATE ... CASCADE`) race against another file's fixtures
  mid-test. Chose serializing file execution over building real
  per-worker isolation (a separate schema/DB per worker) — the latter
  is disproportionate to this suite's actual size.
- `get_audit_log`'s access model: confirmed with the user before
  building rather than defaulting to an existing scope for convenience.
  `scopes.ts`'s `Scope` type already included `"admin"` from the start,
  but no key had ever been granted it — a signal the schema anticipated
  a privileged-only tool. Rather than reuse `read:accounts` (which both
  keys already carry, and would have made audit history as visible as
  ordinary account data), added `admin` to `claude-agent-prod` only,
  leaving `dashboard-readonly` unable to reach this tool at all. This is
  the first genuine scope boundary between the two keys since
  `write:tickets` — every prior read tool happened to be readable by
  both.
- `get_audit_log`'s unscoped-call default: no "active subset" concept
  applies to immutable audit history the way it does to ticket status,
  so the default is most-recent-N ordered `createdAt desc`, bounded by
  `limit` — never an unbounded dump, but without inventing an
  artificial status-like restriction that doesn't map onto the data.
- Deployment platform: switched from Fly.io to Render partway through,
  after checking Fly's actual free-tier terms (a short trial requiring
  a card afterward) against Render's free web service and Postgres,
  which need no card. A better fit for a portfolio project with no
  revenue behind it.
- Migration strategy for the deployed container: chose to run
  `prisma migrate deploy` as part of the Dockerfile's boot command
  rather than Render's separate Pre-Deploy Command feature. Kept the
  approach portable across hosting platforms and avoided depending on
  a feature whose free-tier behavior couldn't be confirmed ahead of
  time. Trade-off accepted: a broken migration can now take down a
  live restart, not just block a pending deploy.
- Secret generation and storage for the two deployed API keys:
  `openssl rand -hex 32` for both `MCP_KEY_AGENT` and
  `MCP_KEY_DASHBOARD`, entered directly into Render's dashboard
  (marked `sync: false` in `render.yaml` so the file never carries
  real values) and recorded in a password manager rather than any
  repo file, gitignored or not. Local `.env` keeps its existing
  placeholder values since there is no real exposure to defend
  against there.
- `list_active_incidents`'s scope: walked through the design before
  building rather than assuming `search_tickets`/`get_renewal_risk`'s
  `account_id` precedent applied automatically. Declined an `account_id`
  filter (the `IncidentAccount` join would support it) since the tool's
  only proven job right now is feeding an `incident_id` into
  `check_incident_impact` for the demo script. Ordered
  `severity asc, startedAt desc`, relying on Postgres enum comparison
  following declaration order (`SEV1`, `SEV2`, `SEV3`) to put the most
  severe incidents first without a separate rank mapping.

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

> **Issue:** Discovered while testing `create_ticket`'s validation path
> that schema-shape errors (missing required fields, invalid enum values)
> never reach `mapErrorToToolResult`'s `ZodError` branch. The MCP SDK
> validates each tool's `inputSchema.shape` itself before invoking the
> handler, and short-circuits with a JSON-RPC `-32602` protocol error —
> the handler's own `.parse()` call (and by extension our `VALIDATION_ERROR`
> mapping) never runs for these cases.
> **Caught by:** Manual curl testing during the `create_ticket` test pass —
> an invalid `priority` value returned an `-32602` error instead of the
> expected `{"error":{"code":"VALIDATION_ERROR",...}}` shape.
> **Root cause confirmed, not introduced by this session:** reproduced the
> identical `-32602` behavior against `update_ticket_status` with an
> invalid `new_status` enum value — same SDK-level short-circuit, present
> since the first tool was registered, not specific to `create_ticket`.
> **Fix:** None applied — this isn't a bug; every tool still rejects bad
> input cleanly with zero DB writes, just via a different error envelope
> than `mapErrorToToolResult` produces. Documented as a known gap instead:
> `VALIDATION_ERROR` in `mapErrorToToolResult` is currently near-dead code,
> reachable only for `.parse()` failures the JSON-Schema conversion from a
> Zod shape can't express (e.g. a future `.refine()`). Not fixed this
> session — flagged for a decision later on whether callers should be able
> to rely on one consistent error envelope for bad input.

> **Issue:** `server.ts` built one `McpServer` instance at module scope
> and reused it across every incoming request. Under concurrent/overlapping
> requests, the MCP SDK's `Server.connect()` throws
> `"Already connected to a transport. Call close() before connecting to a
> new transport..."` — it crashed the whole Node process, not just the
> one request.
> **Caught by:** Running the new automated test suite for the first time.
> `test/global-setup.ts` runs vitest's test files in parallel by default;
> multiple files' HTTP requests overlapped against the one spawned server
> and hit this immediately. This is a real production bug, not a testing
> artifact — every manual curl test across every prior session was
> strictly one-request-at-a-time, so a single shared instance never had a
> chance to fail. The deployed server would crash under real concurrent
> traffic from two MCP clients calling tools at the same moment, or even
> one client firing a second tool call before the first response
> finished.
> **Root cause:** `StreamableHTTPServerTransport` was configured with
> `sessionIdGenerator: undefined` — the SDK's stateless mode, whose
> documented pattern is a fresh server+transport pair per request, not a
> single long-lived instance connected/reconnected repeatedly.
> **Fix:** Wrapped all `server.registerTool(...)` calls in a
> `buildServer(): McpServer` factory, called fresh inside the `POST /mcp`
> handler on every request instead of once at module scope.
> **Verification:** A throwaway concurrency smoke test (`Promise.all` of
> 10 concurrent `search_tickets` calls) — all 10 succeeded post-fix,
> confirmed the crash beforehand. Also verified directly against the dev
> server (not just the test server): 5 concurrent curl requests, zero
> errors. `npx tsc --noEmit` clean; full test suite (8 files, 40 tests)
> passing with `fileParallelism: false` (a separate, unrelated fix for a
> DB-truncate race between test files sharing one database — see the
> architectural-decisions entry above).

> **Issue:** First Claude Desktop config for the deployed server used a
> `"type": "http"` `mcpServers` entry with a `headers` block for the API
> key.
> **Caught by:** Claude Desktop's own startup validation, which flagged
> the entry as invalid and skipped it; confirmed under Settings >
> Developer that no server showed connected.
> **Fix:** Replaced it with an `mcp-remote` bridge entry (`command:
> npx`, `args: -y mcp-remote <url> --header x-api-key:${MCP_KEY_AGENT}`),
> the documented workaround for MCP clients whose config only supports
> local stdio servers. Verified by relaunching and confirming the
> server showed connected.

> **Issue:** `docs/demo-script.md`'s opening line assumed the model
> could discover "the current active incident" on its own, but
> `check_incident_impact` requires a caller-supplied `incident_id` and
> no tool exists to list or discover incidents.
> **Caught by:** Running the demo line for the first time in a real
> Claude Desktop conversation against the deployed server. The model
> correctly stopped and asked for an incident ID instead of guessing or
> hallucinating one.
> **Fix:** None applied yet. Reran the demo with the incident ID
> supplied directly to confirm the rest of the tool chain still works.
> Adding a `list_active_incidents` tool is deferred to its own future
> session; see "Next steps" in `CLAUDE.md`.

> **Issue:** After redeploying `list_active_incidents` to Render, the
> first live demo attempt in Claude Desktop reproduced the exact same
> "which incident should I check?" gap the tool was built to close,
> even though the tool was confirmed registered on the server.
> **Caught by:** Running the demo line live in Claude Desktop
> immediately after the redeploy.
> **Root cause:** Claude Desktop's `mcp-remote` bridge process was
> already running from a prior session, connected before the
> redeploy. It never refetched the server's tool list after
> `list_active_incidents` went live, so the model genuinely had no
> such tool available to call.
> **Fix:** Fully quit and relaunched Claude Desktop, forcing
> `mcp-remote` to reconnect and refetch the current tool list. Reran
> the demo line; it worked immediately.
> **Verification:** Full expected chain ran end to end:
> `list_active_incidents` found the one active SEV2 incident,
> `check_incident_impact` and `search_tickets` narrowed to the single
> at-risk Enterprise ticket, and the model drafted a usable escalation
> unprompted.

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
- **Day 4:** Walked through `create_ticket`'s design before writing code.
  Two things it needed beyond the established schema → auth → Prisma →
  return pattern: validating the `account_id` foreign key exists before
  insert (NOT_FOUND instead of a raw Prisma FK-constraint error), and
  deriving `slaDeadline` server-side, since it's required by the schema
  but had no encoded policy anywhere in the repo — the seed script just
  randomizes it.
- **Day 4:** Settled the SLA policy with the user rather than inventing
  numbers unilaterally for audited business logic: mid-market B2B SaaS
  support benchmark — P1=4h, P2=8h, P3=48h, P4=120h, flat wall-clock hours
  (no business-hours/timezone calendar concept exists in this schema to
  make it business-hours-aware).
- **Day 4:** User flagged that `TICKET_STATUSES`/`TICKET_PRIORITIES` were
  now duplicated as local consts in three tool files (`update_ticket_status.ts`,
  `search_tickets.ts`, and the new `create_ticket.ts`). Extracted them into
  `src/tools/constants.ts` along with `ACTIVE_TICKET_STATUSES`; refactored
  the two existing tools to import instead of redeclaring. `tsc --noEmit`
  confirmed clean post-refactor.
- **Day 4:** Built `create_ticket` — account-existence check, SLA-deadline
  derivation, ticket + audit log write inside one `$transaction`. Used
  `Prisma.DbNull` (not `Prisma.JsonNull`) for the audit log's `before`
  field, since "no prior state" on a create is a real SQL NULL, not a
  stored JSON null value — first write tool where `before` is legitimately
  empty rather than a prior-status snapshot.
- **Day 4:** Ran the full test plan via curl + direct Prisma queries:
  valid create (verified SLA math directly — P1's created-at-to-deadline
  delta was exactly 4h), bad `account_id` → `NOT_FOUND`, invalid `priority`
  enum → rejected, wrong-scope key (`dashboard-readonly`) → `FORBIDDEN_SCOPE`.
  Confirmed via direct DB query, not just API responses, that the three
  rejected calls wrote zero rows — ticket count held at 61 (60 seeded + the
  one valid create) and the audit log holds exactly one new `create_ticket`
  entry.
- **Day 4:** The invalid-enum test surfaced a real, previously-undocumented
  finding: the MCP SDK validates `inputSchema.shape` itself and returns a
  JSON-RPC `-32602` error before the tool handler (and its `ZodError`
  catch) ever runs. Reproduced identically on `update_ticket_status`,
  confirming it's a pattern across every registered tool, not something
  `create_ticket` introduced. Not a bug — bad input is still cleanly
  rejected with no writes — but `VALIDATION_ERROR` in
  `mapErrorToToolResult` is effectively dead code today. Documented as a
  known gap rather than "fixed."
- **Day 4:** Formalized the session workflow itself into `CLAUDE.md` (new
  "Session workflow" section) after noticing it had been followed
  implicitly across every session without being written down anywhere
  repo-visible — one tool per session, design walkthrough before code,
  end-to-end testing including DB-state verification, doc updates before
  ending the session, commit via GitHub Desktop. The exact prompt text per
  step stays in the gitignored `prompts.txt`; the workflow itself now
  lives here since `prompts.txt` isn't committed and wouldn't exist for a
  collaborator or a future session on a different machine.
- **Day 4:** Walked through `check_incident_impact`'s design before
  writing code and surfaced two real decisions rather than guessing:
  whether it should take a single `incident_id` (matching
  `get_account_360`'s shape) or list across all active incidents, and
  which impact metrics to compute. User confirmed single-`incident_id`
  lookup, and `account_count` + `total_mrr_impacted_usd` as the only
  aggregates — explicitly declined an `enterprise_count` or a
  health-score-based risk bucket to avoid inventing an unreviewed
  threshold.
- **Day 4:** Built `check_incident_impact` — composite lookup joining
  `Incident` → `IncidentAccount` → `Account`, read-only (no
  `$transaction`/audit write needed, same category as `get_account_360`
  and `search_tickets`). Noted but didn't build: incidents and tickets
  have no direct schema relationship (`Ticket` has no `incidentId`), so
  the tool reports account-level business exposure only, not a ticket
  correlation.
- **Day 4:** Tested end-to-end via curl against seeded data: valid
  `incident_id` (hand-verified the `total_mrr_impacted_usd` sum against
  the six affected accounts' individual `mrr` values — matched exactly),
  bad `incident_id` → `NOT_FOUND`, bogus API key → `UNAUTHORIZED`, and
  confirmed the `dashboard-readonly` key succeeds (both API keys carry
  `read:incidents`, so unlike `write:tickets` there's no key/scope
  combination available to exercise a `FORBIDDEN_SCOPE` rejection for
  this tool — noted, not treated as a gap). Read-only, so no Prisma
  Studio pass needed, consistent with `search_tickets`.
- **Day 4:** Ended the `check_incident_impact` session and started a new
  one for `get_renewal_risk`, per the one-tool-per-session rule now
  written into `CLAUDE.md`.
- **Day 4:** Walked through `get_renewal_risk`'s design before writing
  code — two rounds of questions rather than one, since this tool had
  more open decisions than prior ones: whether it should be a portfolio
  list or single-account lookup, which signals count toward risk, the
  health-score threshold, the default renewal window, and how signals
  combine into a risk level. User confirmed each rather than any being
  guessed.
- **Day 4:** While translating the confirmed design into a query, caught
  a correctness issue before writing the implementation: an initial
  draft would have computed `risk_level` in JS after fetching a
  `take: limit`-bounded result set, which could silently return fewer
  results than requested (or miss later-sorted matches) once account
  volume grows — the exact failure mode `search_tickets`'s `sla_risk`
  range-query treatment was already established to prevent. Rebuilt
  `risk_level` filtering as a real Prisma `where` clause (nested
  `AND`/`OR` over `healthScore` and `ProductUsage.usageTrend`) before
  implementing, not as a post-hoc fix.
- **Day 4:** Built `get_renewal_risk` and tested end-to-end against
  seeded data. Hand-computed the expected risk set from the DB directly
  (7 accounts in the default 90-day window: 1 high, 2 medium, 4 low) and
  confirmed the tool's `risk_level=high/medium/low` filters matched
  exactly — verifying the actual `where`-clause logic, not just that
  results looked plausible. Also verified the default window, the
  `within_days` override, the `account_id` filter, and auth rejection.
  Same as `check_incident_impact`, both API keys carry the relevant read
  scope (`read:accounts`), so there's no `FORBIDDEN_SCOPE` case available
  to test for this tool.
- **Day 4:** Ended the `get_renewal_risk` session and started a new one
  for `get_audit_log` — the seventh and final planned tool.
- **Day 4:** Walked through `get_audit_log`'s design before writing
  code and surfaced two real decisions: what scope should gate it, and
  what an unscoped call should default to. Noticed `scopes.ts`'s `Scope`
  type already had an unused `"admin"` value — a leftover signal from
  the original schema design that a privileged-only tool was anticipated
  but never built. User confirmed granting `admin` to `claude-agent-prod`
  only (not `dashboard-readonly`) rather than reusing an existing shared
  scope, and confirmed the unscoped default should be most-recent-N
  ordered desc rather than requiring a mandatory filter.
- **Day 4:** Built `get_audit_log` — filters on `entity_type`,
  `entity_id`, `account_id`, `actor`, `action`, `since`, all straight
  Prisma `where` equality/range clauses, ordered `createdAt desc`. Added
  `admin` to `claude-agent-prod`'s scope list in `scopes.ts`.
- **Day 4:** Tested end-to-end against real audit data left over from
  earlier sessions (one `create_ticket` row, one `update_ticket_status`
  row). Verified the unscoped default (both entries, correctly ordered),
  all six filters individually against the known rows, and — for the
  first time since `write:tickets` — an actual testable
  `FORBIDDEN_SCOPE` rejection: `dashboard-readonly` correctly rejected
  for lacking `admin`, since every prior read tool happened to be
  readable by both keys. Also ran a regression check on
  `get_account_360` after the `scopes.ts` edit to confirm adding `admin`
  to `claude-agent-prod` didn't change its existing behavior.
- **Day 4:** All seven originally planned tools are now built and
  verified: `get_account_360`, `update_ticket_status`, `search_tickets`,
  `create_ticket`, `check_incident_impact`, `get_renewal_risk`,
  `get_audit_log`.
- **Day 4:** With the tool build complete, surveyed the repo for
  planning-stage docs that had gone stale and found three real issues:
  `README.md`'s "Status" section still listed all seven tools as
  in-progress; `evals/scenarios.json`'s `eval-002` expected `OPEN →
  CLOSED` to be rejected, but the actual state machine in
  `update_ticket_status.ts` explicitly allows that transition (it was
  never reconciled against the final implementation); and
  `docs/demo-script.md` referenced a `list_accounts` tool that was never
  built. Fixed all three: updated the README status, changed `eval-002`
  to test `OPEN → RESOLVED` (a transition that is actually illegal,
  preserving the scenario's original intent), and rewrote the demo
  script's steps to use `check_incident_impact`'s existing
  `plan_tier`/`mrr_usd` fields per account instead of a nonexistent
  tool. None of the eval scenarios have been executed yet — that's the
  next phase of work.
- **Day 4:** Decided on deployment targets: Fly.io for the MCP server
  (Docker-native, matches the existing `Dockerfile`), Vercel for the
  Next.js dashboard once it exists. Agreed on a build order: eval
  scenarios + a runner script, then the dashboard, then deploy both,
  then connect Claude Desktop and finalize docs — with a recommendation
  to deploy the MCP server and validate it live via Claude Desktop
  *before* building the dashboard against it, rather than after, so the
  dashboard is built against a proven deployed server instead of an
  unverified one.
- **Day 4:** Clarified what "eval runner" actually meant before
  building it — the `evals/scenarios.json` format (natural-language
  `prompt` + `expected_tool_calls`) suggested an LLM tool-selection eval,
  but the user's actual goal was automating the manual curl +
  Prisma-verification routine already run every session, not testing
  whether Claude picks the right tool from a sentence. Recharacterized
  as an integration-test suite and built it as the `vitest` suite
  instead, directly closing the long-open scaffolding gap rather than
  building parallel one-off tooling.
- **Day 4:** Chose the test-DB strategy: a second database
  (`meridian_test`) in the existing `meridian-pg` container, created via
  a single `CREATE DATABASE` against the running container, schema
  applied with `prisma migrate deploy`. `.env.test` scaffolded with a
  distinct `PORT` and `LOG_LEVEL=silent`.
- **Day 4:** While installing `dotenv` as a new dev dependency, its
  console output included an unfamiliar-domain promotional line
  (`⌁ auth for agents [www.vestauth.com]`). Traced it directly in
  `node_modules/dotenv/lib/main.js` before treating it as safe — it's a
  randomly-selected line from a `TIPS` array baked into the official
  `dotenv` package's own source (confirmed against its `CHANGELOG.md`
  too), not a supply-chain compromise or injected instruction. Flagged
  it to the user regardless, since an unfamiliar domain appearing in
  console output is worth surfacing whether or not it turns out
  malicious. Suppressed via `{ quiet: true }` per the user's call.
- **Day 4:** Built the test infra (`vitest.config.ts`,
  `test/global-setup.ts`, `test/helpers.ts`, `test/fixtures.ts`) and
  verified the whole pipeline end-to-end with a throwaway smoke test
  before writing any real test files — confirmed the spawned server,
  fixtures, and HTTP client all wired together correctly, then deleted
  the smoke test since it wasn't part of the planned file list.
- **Day 4:** Wrote all 8 planned test files (7 per-tool +
  `validation-envelope.test.ts`) covering the priority list agreed
  earlier: audit-log atomicity under rejection, the full ticket state
  machine (legal and illegal transitions), both scope boundaries
  (`write:tickets`, `admin`), derived-filter boundary conditions
  (`sla_risk`'s 24h edge, `risk_level`'s `healthScore=50` and
  `usageTrend` edges), `NOT_FOUND` coverage, exact SLA math, and a
  regression test codifying the SDK-validation-bypass finding as a
  checked invariant instead of a doc that could quietly go stale.
  Caught and fixed one type error along the way (`Prisma.DbNull` vs.
  bare `null` on a nullable `Json` field in a test fixture — the same
  class of mistake already caught once in `create_ticket.ts` itself).
- **Day 4:** First full suite run failed 32 of 40 tests with foreign-key
  violations — traced it to Vitest's default file-level parallelism:
  every file's `beforeEach` truncates the shared test database, so one
  file's `resetDb()` could wipe out another file's fixtures mid-test.
  Fixed with `fileParallelism: false` in `vitest.config.ts`, matching
  the suite's deliberate design (real shared DB, not isolated mocks).
- **Day 4:** The same first run also crashed the Node process entirely
  with an MCP SDK error — a genuine production concurrency bug in
  `server.ts`, not a test-infra artifact (see the "what Claude Code got
  wrong" entry above for the full writeup). Flagged it to the user as a
  real architectural fix versus a documented-known-issue decision rather
  than silently expanding scope; user chose to fix it now. Refactored
  `server.ts` to build a fresh `McpServer` per request via a
  `buildServer()` factory. Verified with a targeted concurrency smoke
  test (10 parallel requests, all succeeded) and directly against the
  dev server (5 concurrent curl requests, zero errors) — not just
  re-running the suite, since `fileParallelism: false` would have masked
  whether the underlying server fix actually worked.
- **Day 4:** Full suite green: 8 files, 40 tests, ~3 second run.
- **Day 5:** Switched deployment target from Fly.io to Render after
  checking Fly's free tier terms more carefully. It's a short trial
  that requires a card afterward; Render's free web service and
  Postgres need none, a better fit for this project. No code cleanup
  was needed for the switch. Searched the repo and confirmed the only
  Fly references were the two doc mentions above.
- **Day 5:** Found a gap while planning the Render blueprint: the
  Dockerfile only ran the server, nothing applied database
  migrations, and the existing `db:migrate` script (`prisma migrate
  dev`) is interactive and unusable in a container. Render's free
  tier also has no Shell access to run migrations after deploy.
  Changed the Dockerfile `CMD` to run `prisma migrate deploy` before
  the server starts, choosing that over Render's Pre-Deploy Command
  feature since it stays portable across platforms and I couldn't
  confirm its free-tier behavior on Render ahead of time.
- **Day 5:** Verified the Dockerfile change with a full local
  `docker build` and run before trusting it to a real deploy. Tested
  against an already-migrated database (correctly skipped) and a
  freshly created empty one (correctly applied the init migration
  before the server started). Also added a `GET /health` route, since
  the server only had `POST /mcp` before, needed for Render's health
  check.
- **Day 5:** Added `render.yaml` declaring the web service and a free
  Postgres instance. Marked `MCP_KEY_AGENT` and `MCP_KEY_DASHBOARD` as
  `sync: false` so real key values get entered directly in Render's
  dashboard, never in the file. Walked through Render's env var
  security model and key-generation approach with Claude Code before
  generating anything: `openssl rand -hex 32` for both keys, stored in
  a password manager rather than any file in the repo. Local `.env`
  keeps its existing placeholder values, no need to change those.
- **Day 5:** Deployment prep is done and locally verified. Render
  account setup and the actual deploy are next.
- **Day 6:** Created the Render account, connected the GitHub repo, and
  applied the `render.yaml` Blueprint. Generated real `MCP_KEY_AGENT`
  and `MCP_KEY_DASHBOARD` values with `openssl rand -hex 32` and
  entered them directly in Render's dashboard.
- **Day 6:** Seeded the live Postgres once via its external connection
  string, since the free tier has no Shell access. Verified `GET
  /health` and an authenticated `POST /mcp` `tools/list` call both
  returned 200 against the deployed URL.
- **Day 6:** First attempt at wiring Claude Desktop to the deployed
  server used a `"type": "http"` `mcpServers` entry with a `headers`
  block. Desktop rejected it on startup, since the installed version
  only supports stdio `command`/`args` entries, not a direct
  remote-HTTP config. Switched to the `mcp-remote` npm package as a
  local stdio-to-HTTP bridge, passing the API key via `--header
  x-api-key:${MCP_KEY_AGENT}`. Connected successfully on the next
  relaunch.
- **Day 6:** Ran the demo script's opening line for real for the first
  time and it failed. `check_incident_impact` requires an
  `incident_id` and there's no tool that lets the model discover the
  current active incident, so it correctly asked for one instead of
  guessing. This assumption in `docs/demo-script.md` had never been
  tested against a live conversation before, only against individual
  tools' curl behavior. Reworded the line to supply the incident ID
  directly and reran it; the full chain (`check_incident_impact` ->
  `get_account_360`, filtered to Enterprise, sorted by MRR) worked and
  produced a reasonable escalation draft. Decided to leave the demo
  script as-is for now and treat a proper `list_active_incidents`
  discovery tool as its own future session rather than adding it
  mid-deploy.
- **Day 6:** Deployment is live and verified end to end, from a real
  Claude Desktop connection, not just curl.
- **Day 6:** Walked through `list_active_incidents`'s design before
  writing code: read-only discovery tool for `check_incident_impact`,
  gated behind `read:incidents` (same scope as `check_incident_impact`,
  so no `FORBIDDEN_SCOPE` case here either). Weighed adding an
  `account_id` filter like `search_tickets`/`get_renewal_risk` have,
  then declined it since the only proven need right now is feeding an
  `incident_id` into `check_incident_impact`. Defaults to non-RESOLVED
  statuses via the same override convention as `search_tickets`'s
  `ACTIVE_TICKET_STATUSES`, defined locally since this is the first
  incident-status filter in the codebase and the three-tool threshold
  for `constants.ts` hasn't been hit.
- **Day 6:** Built `list_active_incidents` — orders
  `severity asc, startedAt desc`, relying on Postgres enum comparison
  following declaration order (`SEV1` first) instead of a separate
  severity-rank mapping. Returns a summary per incident
  (`affected_account_count`, `total_mrr_impacted_usd`), not a full
  account breakdown, since the tool's job is letting the model pick an
  `incident_id` before calling `check_incident_impact` for the full
  picture.
- **Day 6:** Tested end-to-end: default call excludes `RESOLVED`, an
  explicit `status` override replaces the default rather than
  narrowing it, `severity` filter and SEV1-first ordering, hand-verified
  `total_mrr_impacted_usd` against a fixture's account `mrr` sum, and
  bogus-API-key rejection. Cross-checked the seeded live incident
  directly via Prisma to confirm the API response matched real DB
  state. Wrote 5 new vitest tests; full suite now 9 files, 45 tests,
  all green.
- **Day 6:** Updated `docs/demo-script.md` to call
  `list_active_incidents` as the first step instead of assuming the
  model already knows the incident, closing the gap the live demo run
  surfaced earlier today.
- **Day 6:** Ran the demo line for real in Claude Desktop against the
  redeployed server. First attempt hit the exact "which incident?" gap
  again, even with `list_active_incidents` already live server-side,
  because Claude Desktop's `mcp-remote` bridge had connected before
  the redeploy and was holding a stale tool list. Restarting Claude
  Desktop fixed it.
- **Day 6:** Reran the demo line after the restart and it worked
  correctly: `list_active_incidents` found the one active SEV2,
  narrowed to the single Enterprise account with an at-risk P1
  ticket, and produced a usable escalation draft. Demo script's
  original discovery gap is closed and verified live, not just via
  curl.

