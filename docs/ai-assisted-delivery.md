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

## What required architectural decisions (yours, not generated)

- Data model shape: which four domains, and why `get_account_360` is the
  composite call rather than four separate lookups
- Ticket state machine: allowed transitions, and why illegal transitions
  return `CONFLICT` instead of silently succeeding
- Auth scope design: `read:*` vs `write:*` vs `admin`, and which tools
  require which scope
- Repo structure: flat root instead of a monorepo — decided a
  shared-package monorepo wasn't earning its keep for a two-deployable
  project

## What Claude Code got wrong (and what that shows)

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

## Engagement log

- **Day 1:** Scoped the four data domains and eight tools; decided against
  a fifth "billing history" domain to keep the demo tight.
- **Day 1:** Reconciled repo structure — dropped the initial monorepo plan
  (`apps/mcp-server` + `apps/dashboard`) in favor of a flat root for the
  server, dashboard as its own repo.
- **Day 1:** Reviewed `scopes.ts` before the first public push; caught that
  the fallback API key values were hardcoded into source rather than
  env-only. Removed the fallbacks and added a fail-closed startup check.

## Why this matters for the role

AI-assisted delivery isn't about typing less — it's about spending review
and judgment time on what actually requires it (architecture, business
rules, security boundaries) instead of boilerplate. That's the tradeoff a
client-facing engineer manages constantly under real timelines, and this
log makes that tradeoff visible rather than just claimed.

## Positioning for LinkedIn / interviews

- **README framing (above the fold):** *"Built using an AI-assisted
  delivery workflow (Claude Code) — see docs/ai-assisted-delivery.md for
  what was generated vs. architected."*
- **LinkedIn framing:** lead with the delivery model, not just the tech.
- **Interview readiness:** be ready to explain any line of code and debug
  live — review everything generated so that's true by construction.
