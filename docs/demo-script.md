# Demo script

Run this live, connected to the deployed server as a remote MCP connector
in Claude Desktop or claude.ai.

## The line

> "Show me all Enterprise accounts with SLA-risk tickets open during the
> current incident, prioritize by MRR, and draft the escalation."

## What it should trigger, step by step

1. `check_incident_impact` — find accounts affected by the active incident
2. `list_accounts` or `get_account_360` per affected account — filter to
   Enterprise tier
3. `search_tickets` — cross-reference for SLA-risk open tickets
4. Model drafts the escalation message using the assembled context

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
