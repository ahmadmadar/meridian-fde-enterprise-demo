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

## Notes

- **Note:** invalid-enum input (e.g. an unrecognized `new_status` value)
  is rejected by the MCP SDK's own schema validation before the tool
  handler runs — it never reaches `mapErrorToToolResult()`. Business-logic
  errors (`CONFLICT`, `NOT_FOUND`, `FORBIDDEN_SCOPE`) are caught and mapped
  by our own code; schema-shape errors are caught one layer earlier, by
  the SDK itself.
