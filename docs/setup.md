# Starter slice — how to wire this in

This is the first working end-to-end vertical slice: DB → one tool
(`get_account_360`) → auth → server. Drop these files into your repo at
the paths shown (they already match the structure in your project
guideline), then:

```bash
# 1. Start Postgres (adjust docker-compose.yml if you haven't made one yet - Created now)
docker compose up -d

# 2. Install deps
npm install

# 3. Copy env
cp .env.example .env

# 4. Create tables + generate client
npx prisma migrate dev --name init

# 5. Seed mock data
npm run db:seed

# 6. Run the server
npm run dev
```

Then test it directly (before wiring up any agent) with a raw request:

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: demo-agent-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_account_360","arguments":{"account_id":"<paste an id from your seeded data>"}}}'
```

Grab a real `account_id` by checking your DB with TablePlus/DBeaver, or add
a quick `console.log` in the seed script temporarily.

# Used Prisma studio instead of TablePlus/DBeaver
```bash
  npx prisma studio
  ```

  Open in another editor, will open up a browser tab at http://localhost:5555 with a full visual editor for every table.

## What to build next, in order

1. Add `search_tickets`, `create_ticket`, `update_ticket_status` (with the
   state machine validation), `check_incident_impact`, `get_renewal_risk`,
   `get_audit_log` — same pattern as `get_account_360`: schema → auth →
   query → mapped errors
2. Add the audit log write inside every write-tool (`create_ticket`,
   `update_ticket_status`) — this is what makes `get_audit_log` meaningful
3. Wire this server up in Claude Desktop as a remote connector (Settings →
   Connectors → Add custom connector → point at your deployed `/mcp` URL)
   and run your demo script live
4. Log this session in `docs/ai-assisted-delivery.md` — what Claude Code
   generated here, what you changed, anything it got wrong

## Note on the state machine (for `update_ticket_status`, when you build it)

Enforce this transition map server-side, reject anything not listed with a
`CONFLICT` error code:

```
OPEN          -> INVESTIGATING, CLOSED
INVESTIGATING -> ESCALATED, RESOLVED
ESCALATED     -> RESOLVED
RESOLVED      -> CLOSED
CLOSED        -> (terminal)
```
