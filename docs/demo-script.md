# Demo script

Run this live, connected to the deployed server as a remote MCP connector
in Claude Desktop or claude.ai.

## The line

> "Show me all Enterprise accounts with SLA-risk tickets open during the
> current incident, prioritize by MRR, and draft the escalation."

## What it should trigger, step by step

1. `list_active_incidents` — discover the current active incident's
   `incident_id` (defaults to non-RESOLVED, most severe first)
2. `check_incident_impact` — find accounts affected by that incident;
   the response already includes `plan_tier` and `mrr_usd` per
   account, so filtering to Enterprise tier and sorting by MRR needs no
   extra tool call
3. `search_tickets` — cross-reference the Enterprise-tier affected
   accounts for SLA-risk open tickets
4. `get_account_360` per flagged account, if the model needs full
   context (open tickets, usage trend) before drafting
5. Model drafts the escalation message using the assembled context

## Why this is the moment that sells it

One natural-language line triggers multiple chained tool calls across
systems that don't talk to each other in a typical stack (billing,
support, incidents) — this is the actual value proposition of an MCP
integration, not just "a chatbot with a database."

## Fallback if a tool errors mid-demo

Have a second, simpler line ready:

> "Give me the account 360 for [account name]."

Single tool call, still shows the cross-system join, lower risk if
something upstream isn't fully wired yet.
