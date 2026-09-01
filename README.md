# Meridian FDE Demo

A simulated forward-deployed engagement: an MCP server exposing a
fictional B2B SaaS client's ("Meridian") internal systems — accounts,
support tickets, product usage, and incidents — as tools any MCP client
(Claude Desktop, claude.ai) can query and act on through a single,
authenticated interface.

> Built using an AI-assisted delivery workflow (Claude Code) — see
> [`docs/ai-assisted-delivery.md`](docs/ai-assisted-delivery.md) for what
> was generated vs. architected.

## What this demonstrates

- A composite cross-system tool (`get_account_360`) instead of raw CRUD
- Server-enforced business rules (a real ticket state machine, not
  freeform status updates)
- Scoped API key auth and structured, distinguishable error codes
- A remote MCP server connectable directly from Claude Desktop, not just
  a custom client

## Quickstart

See [`docs/setup.md`](docs/setup.md) for setup commands
(Postgres, migrate, seed, run) and a sample tool call.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — system design and key decisions
- [`docs/demo-script.md`](docs/demo-script.md) — the live demo narrative
- [`docs/ai-assisted-delivery.md`](docs/ai-assisted-delivery.md) — build log

## Status

Early build — `get_account_360` is wired end-to-end; remaining tools
(`search_tickets`, `create_ticket`, `update_ticket_status`,
`check_incident_impact`, `get_renewal_risk`, `get_audit_log`) in progress.
