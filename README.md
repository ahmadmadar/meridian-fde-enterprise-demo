# Meridian FDE Demo

A simulated forward-deployed engagement: an MCP server exposing a
fictional B2B SaaS client's ("Meridian") internal systems, accounts,
support tickets, product usage, and incidents, as tools any MCP client
(Claude Desktop, claude.ai) can query and act on through a single,
authenticated interface.

- **Live:** https://meridian-mcp-server-k4ki.onrender.com
- **Dashboard:** [`meridian-dashboard`](https://github.com/ahmadmadar/meridian-dashboard) (read-only ops UI over this server, deployed separately)

> Built using an AI-assisted delivery workflow (Claude Code): see
> [`docs/ai-assisted-delivery.md`](docs/ai-assisted-delivery.md) for what
> was generated versus architected.

## What this demonstrates

- A composite cross-system tool (`get_account_360`) instead of raw CRUD
- Server-enforced business rules (a real ticket state machine, not
  freeform status updates)
- Scoped API key auth and structured, distinguishable error codes
- A remote MCP server connectable directly from Claude Desktop, not just
  a custom client
- A discovery tool (`list_active_incidents`) added after a live demo run
  surfaced a real gap, not planned from the start

## Quickstart

See [`docs/setup.md`](docs/setup.md) for setup commands
(Postgres, migrate, seed, run) and a sample tool call.

## Docs

- [`docs/architecture.md`](docs/architecture.md): system design and key decisions
- [`docs/demo-script.md`](docs/demo-script.md): the live demo narrative
- [`docs/ai-assisted-delivery.md`](docs/ai-assisted-delivery.md): build log

## Status

All eight tools are built and verified end-to-end against seeded data:
`get_account_360`, `update_ticket_status`, `search_tickets`,
`create_ticket`, `check_incident_impact`, `get_renewal_risk`,
`get_audit_log` (gated behind a dedicated `admin` scope, not a shared
read scope), and `list_active_incidents`. Deployed live on Render, with
a real Claude Desktop connector run completed against the deployed
server. The companion dashboard (separate repo, linked above) is also
built and deployed, with four read-only screens; a planned chat feature
was deliberately scoped out (see `docs/architecture.md`, "Chat: scoped
out").
