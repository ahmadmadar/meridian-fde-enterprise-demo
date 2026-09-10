# Architecture

*Will fill in once the build stabilizes*

## Overview

Meridian's internal systems (accounts, support tickets, product usage,
incidents) are exposed as MCP tools over a remote HTTP/SSE server, so any
MCP client (Claude Desktop, claude.ai, a custom agent) can query and act on
them through a single, authenticated, scope-controlled interface.

```
[Claude Desktop / Agent] --HTTP/SSE--> [Meridian MCP Server] --Prisma--> [Postgres]
                                              |
                                     [Meridian Dashboard]
                                     (Next.js, read-only + chat)
```

## Key design decisions

- **Composite tools over raw CRUD** — `get_account_360` joins four data
  sources server-side instead of leaving the model to make and reconcile
  four separate calls.
- **Server-enforced state machine** — ticket status transitions are
  validated in the server, not left to agent discipline.
- **Scoped API keys** — every tool call carries a scope; write operations
  require a distinct scope from reads.
- **Structured error codes** — `VALIDATION_ERROR`, `NOT_FOUND`,
  `FORBIDDEN_SCOPE`, `CONFLICT`, `INTERNAL_ERROR` — not generic failures.

## Diagram

## Deployment

The MCP server deploys to **Render** as a Docker-runtime web service on
the free tier, provisioned declaratively via the `render.yaml`
Blueprint at the repo root, alongside a free Render Postgres instance.
Schema migrations run automatically on container boot (`prisma migrate
deploy` is part of the Dockerfile `CMD`), since the free tier has no
Shell access to run them after the fact. A `GET /health` endpoint
exists solely for Render's health check and carries no business logic.

Originally planned for Fly.io; switched to Render because Fly's free
tier is a short (2hr/7-day) trial requiring a card afterward, while
Render's free web service and Postgres need none. The dashboard, once
built, deploys to Vercel — a separate repo, unaffected by this choice.

## Notes

- **Note:** invalid-enum input (e.g. an unrecognized `new_status` value)
  is rejected by the MCP SDK's own schema validation before the tool
  handler runs — it never reaches `mapErrorToToolResult()`. Business-logic
  errors (`CONFLICT`, `NOT_FOUND`, `FORBIDDEN_SCOPE`) are caught and mapped
  by our own code; schema-shape errors are caught one layer earlier, by
  the SDK itself.
